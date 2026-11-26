import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, type Event } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import type { DiscoveredUser, LocalIdentity, RelayHealth } from '../types/kapsul';
import { formatHandle, hexToBytes, isSafeAvatarDataUrl, sanitizeUsername } from './crypto';

export const DEFAULT_RELAYS: string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://offchain.pub',
];

const APP_TAG = 'kapsul-e2ee';
const WIRE_CHANNEL_NAME = 'kapsul-wire-v1';

export class RelayNetwork {
  private pool: SimplePool;
  private relays: string[];
  private healthMap: Map<string, RelayHealth> = new Map();
  private onHealthChange?: (statuses: RelayHealth[]) => void;
  private activeSub: { close: (reason?: string) => void } | null = null;
  private wireChannel: BroadcastChannel | null = null;
  private seenWrapIds: Set<string> = new Set();

  constructor(relays: string[], onHealthChange?: (statuses: RelayHealth[]) => void) {
    this.relays = [...new Set(relays)];
    this.onHealthChange = onHealthChange;
    for (const url of this.relays) {
      this.healthMap.set(url, { url, status: 'connecting' });
    }
    this.pool = new SimplePool({
      enableReconnect: true,
    });
    this.pool.onRelayConnectionSuccess = (url: string) => {
      this.healthMap.set(url, { url, status: 'connected' });
      this.emitHealth();
    };
    this.pool.onRelayConnectionFailure = (url: string) => {
      this.healthMap.set(url, { url, status: 'error', lastError: 'Bağlanılamadı' });
      this.emitHealth();
    };
  }

  public getHealth(): RelayHealth[] {
    return this.relays.map((url) => this.healthMap.get(url) ?? { url, status: 'connecting' });
  }

  private emitHealth() {
    this.onHealthChange?.(this.getHealth());
  }

  public async connectAll(): Promise<void> {
    await Promise.allSettled(
      this.relays.map(async (url) => {
        this.healthMap.set(url, { url, status: 'connecting' });
        this.emitHealth();
        try {
          await this.pool.ensureRelay(url, { connectionTimeout: 6000 });
          this.healthMap.set(url, { url, status: 'connected' });
        } catch (err) {
          this.healthMap.set(url, {
            url,
            status: 'error',
            lastError: err instanceof Error ? err.message : 'Bağlantı başarısız',
          });
        }
        this.emitHealth();
      })
    );
  }

  public async publishIdentityAnnouncement(identity: LocalIdentity): Promise<number> {
    const sk = hexToBytes(identity.secretKeyHex);
    const contentPayload: Record<string, unknown> = {
      name: identity.username,
      display_name: identity.handle,
      kapsul: 1,
    };
    if (isSafeAvatarDataUrl(identity.avatarDataUrl)) {
      contentPayload.picture = identity.avatarDataUrl;
    }

    const evt = finalizeEvent(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['t', APP_TAG],
          ['name', identity.username.toLowerCase()],
        ],
        content: JSON.stringify(contentPayload),
      },
      sk
    );

    let accepted = 0;
    const results = await Promise.allSettled(this.pool.publish(this.relays, evt));
    for (const res of results) {
      if (res.status === 'fulfilled') accepted++;
    }
    return accepted;
  }

  public async searchUsersByUsername(query: string): Promise<DiscoveredUser[]> {
    const clean = query.trim().toLowerCase();
    if (!clean) return [];

    // Also search locally announced users on BroadcastChannel cache if present
    const found = new Map<string, DiscoveredUser>();

    const events = await new Promise<Event[]>((resolve) => {
      const collected: Event[] = [];
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve(collected);
      };

      const timer = setTimeout(done, 3200);
      try {
        const sub = this.pool.subscribeMany(
          this.relays,
          {
            kinds: [0],
            '#t': [APP_TAG],
            limit: 120,
          },
          {
            onevent(ev) {
              collected.push(ev);
            },
            oneose() {
              clearTimeout(timer);
              sub.close();
              done();
            },
          }
        );
      } catch {
        clearTimeout(timer);
        done();
      }
    });

    for (const ev of events) {
      try {
        const data = JSON.parse(ev.content) as {
          name?: unknown;
          display_name?: unknown;
          picture?: unknown;
          kapsul?: unknown;
        };
        if (typeof data.name !== 'string') continue;
        const username = sanitizeUsername(data.name);
        if (!username) continue;
        const handle = formatHandle(username, ev.pubkey);
        const matches =
          username.toLowerCase().includes(clean) ||
          handle.toLowerCase().includes(clean);
        if (!matches) continue;

        const existing = found.get(ev.pubkey);
        if (!existing || ev.created_at > existing.publishedAt) {
          found.set(ev.pubkey, {
            pubkey: ev.pubkey,
            username,
            handle,
            npub: nip19.npubEncode(ev.pubkey),
            avatarDataUrl: isSafeAvatarDataUrl(data.picture) ? data.picture : undefined,
            publishedAt: ev.created_at,
          });
        }
      } catch {
        // Ignore malformed profile events from public relays
      }
    }

    return Array.from(found.values()).sort((a, b) => b.publishedAt - a.publishedAt);
  }

  public async fetchPeerProfile(pubkey: string): Promise<DiscoveredUser | null> {
    try {
      const ev = await this.pool.get(this.relays, {
        kinds: [0],
        authors: [pubkey],
      });
      if (!ev) return null;
      const data = JSON.parse(ev.content) as {
        name?: unknown;
        picture?: unknown;
      };
      const username = typeof data.name === 'string' ? sanitizeUsername(data.name) : '';
      if (!username) return null;
      return {
        pubkey: ev.pubkey,
        username,
        handle: formatHandle(username, ev.pubkey),
        npub: nip19.npubEncode(ev.pubkey),
        avatarDataUrl: isSafeAvatarDataUrl(data.picture) ? data.picture : undefined,
        publishedAt: ev.created_at,
      };
    } catch {
      return null;
    }
  }

  public subscribeGiftWraps(
    myPubkey: string,
    onGiftWrap: (ev: Event) => void
  ): void {
    this.activeSub?.close();
    this.wireChannel?.close();

    // NIP-59 outer timestamps are jittered up to 48 hours in the past; fetch 72h window
    const sinceSec = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;

    const handleIncoming = (ev: Event) => {
      if (this.seenWrapIds.has(ev.id)) return;
      this.seenWrapIds.add(ev.id);
      onGiftWrap(ev);
    };

    try {
      this.activeSub = this.pool.subscribeMany(
        this.relays,
        {
          kinds: [1059],
          '#p': [myPubkey],
          since: sinceSec,
        },
        {
          onevent: handleIncoming,
        }
      );
    } catch {
      // Relay subscription errors are reflected in relay health
    }

    if (typeof BroadcastChannel !== 'undefined') {
      this.wireChannel = new BroadcastChannel(WIRE_CHANNEL_NAME);
      this.wireChannel.onmessage = (msg: MessageEvent<unknown>) => {
        const ev = msg.data as Event | undefined;
        if (ev && typeof ev === 'object' && ev.kind === 1059 && typeof ev.id === 'string') {
          const isForMe = Array.isArray(ev.tags) && ev.tags.some((t) => t[0] === 'p' && t[1] === myPubkey);
          if (isForMe) {
            handleIncoming(ev);
          }
        }
      };
    }
  }

  public async publishGiftWrap(giftWrap: Event): Promise<number> {
    if (this.wireChannel) {
      try {
        this.wireChannel.postMessage(giftWrap);
      } catch {
        // Ignore BroadcastChannel post error
      }
    } else if (typeof BroadcastChannel !== 'undefined') {
      try {
        const ch = new BroadcastChannel(WIRE_CHANNEL_NAME);
        ch.postMessage(giftWrap);
        ch.close();
      } catch {
        // Ignore
      }
    }

    let accepted = 0;
    const results = await Promise.allSettled(this.pool.publish(this.relays, giftWrap));
    for (const res of results) {
      if (res.status === 'fulfilled') accepted++;
    }
    return accepted;
  }

  public destroy(): void {
    this.activeSub?.close();
    this.activeSub = null;
    this.wireChannel?.close();
    this.wireChannel = null;
    this.pool.close(this.relays);
  }
}
