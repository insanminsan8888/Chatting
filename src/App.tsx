import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event } from 'nostr-tools/pure';
import {
  DEFAULT_TTL_HOURS,
  type ChatMessage,
  type ChatThread,
  type DiscoveredUser,
  type LocalIdentity,
  type PeerContact,
  type PrivacySettings,
  type RelayHealth,
  type TombstoneState,
  type TTLHours,
} from './types/kapsul';
import {
  createEphemeralGiftWrap,
  createLocalIdentity,
  formatHandle,
  isSafeAvatarDataUrl,
  parsePeerInput,
  restoreIdentityFromNsec,
  unwrapEphemeralGiftWrap,
} from './lib/crypto';
import {
  initializeNewVault,
  initVaultStatus,
  loadEncryptedItem,
  lockVaultMemory,
  rekeyVaultWithPin,
  saveEncryptedItem,
  unlockVaultWithPin,
  wipeEntireVault,
} from './lib/vault';
import { DEFAULT_RELAYS, RelayNetwork } from './lib/relays';
import { OnboardingView } from './components/OnboardingView';
import { LockScreen } from './components/LockScreen';
import { ChatWorkspace } from './components/ChatWorkspace';
import { InviteModal } from './components/InviteModal';
import { SafetyModal } from './components/SafetyModal';
import { NetworkModal } from './components/NetworkModal';
import { BurnModal } from './components/BurnModal';
import { LogoutModal } from './components/LogoutModal';
import { playIncomingPing } from './lib/sound';

type AppScreen = 'booting' | 'onboarding' | 'locked' | 'ready';

const DEFAULT_SETTINGS: PrivacySettings = {
  autoBlurOnBackground: false,
  blockPaddingBytes: 1024,
  relays: DEFAULT_RELAYS,
  hasPin: false,
  autoLockMinutes: 0,
  soundEnabled: true,
};

const EMPTY_TOMBSTONES: TombstoneState = {
  deletedMsgIds: {},
  burnWatermarks: {},
  removedPeers: {},
};

function pruneTombstones(raw: TombstoneState, nowMs: number): TombstoneState {
  const deletedMsgIds: Record<string, number> = {};
  for (const [id, exp] of Object.entries(raw.deletedMsgIds)) {
    // Keep deletion records at least 72h+ or until message expires so relay replays never resurrect them
    if (exp > nowMs) {
      deletedMsgIds[id] = exp;
    }
  }
  return {
    deletedMsgIds,
    burnWatermarks: { ...raw.burnWatermarks },
    removedPeers: { ...raw.removedPeers },
  };
}

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('booting');
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [contacts, setContacts] = useState<Record<string, PeerContact>>({});
  const [threads, setThreads] = useState<Record<string, ChatThread>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [settings, setSettings] = useState<PrivacySettings>(DEFAULT_SETTINGS);
  const [tombstones, setTombstones] = useState<TombstoneState>(EMPTY_TOMBSTONES);
  const [activePeerPubkey, setActivePeerPubkey] = useState<string | null>(null);
  const [relayHealth, setRelayHealth] = useState<RelayHealth[]>([]);
  const [typingPeers, setTypingPeers] = useState<Record<string, number>>({});
  const [privacyBlurred, setPrivacyBlurred] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [pendingInvite, setPendingInvite] = useState<ReturnType<typeof parsePeerInput>>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [safetyPeer, setSafetyPeer] = useState<PeerContact | null>(null);
  const [burnTarget, setBurnTarget] = useState<
    | { mode: 'all' }
    | { mode: 'delete_account' }
    | { mode: 'chat'; peer: PeerContact }
    | { mode: 'remove_peer'; peer: PeerContact }
    | null
  >(null);

  const relayRef = useRef<RelayNetwork | null>(null);
  const identityRef = useRef<LocalIdentity | null>(null);
  const contactsRef = useRef<Record<string, PeerContact>>({});
  const threadsRef = useRef<Record<string, ChatThread>>({});
  const messagesRef = useRef<ChatMessage[]>([]);
  const activePeerRef = useRef<string | null>(null);
  const settingsRef = useRef<PrivacySettings>(DEFAULT_SETTINGS);
  const tombstonesRef = useRef<TombstoneState>(EMPTY_TOMBSTONES);
  const lastActivityRef = useRef<number>(Date.now());

  identityRef.current = identity;
  contactsRef.current = contacts;
  threadsRef.current = threads;
  messagesRef.current = messages;
  activePeerRef.current = activePeerPubkey;
  settingsRef.current = settings;
  tombstonesRef.current = tombstones;

  const hydrateFromVault = useCallback(async (hasPin: boolean) => {
    const [savedIdentity, savedContacts, savedThreads, savedMessages, savedSettings, savedTombstones] =
      await Promise.all([
        loadEncryptedItem<LocalIdentity>('identity'),
        loadEncryptedItem<Record<string, PeerContact>>('contacts'),
        loadEncryptedItem<Record<string, ChatThread>>('threads'),
        loadEncryptedItem<ChatMessage[]>('messages'),
        loadEncryptedItem<PrivacySettings>('settings'),
        loadEncryptedItem<TombstoneState>('tombstones'),
      ]);

    if (!savedIdentity) {
      setScreen('onboarding');
      return;
    }

    const now = Date.now();
    const cleanedTombstones = pruneTombstones(
      {
        deletedMsgIds: savedTombstones?.deletedMsgIds ?? {},
        burnWatermarks: savedTombstones?.burnWatermarks ?? {},
        removedPeers: savedTombstones?.removedPeers ?? {},
      },
      now
    );

    const validMessages = (savedMessages ?? []).filter((m) => {
      if (m.expiresAt <= now) return false;
      if (cleanedTombstones.deletedMsgIds[m.id]) return false;
      const burnMark = cleanedTombstones.burnWatermarks[m.peerPubkey] ?? 0;
      if (m.createdAt <= burnMark) return false;
      return true;
    });

    if (savedMessages && validMessages.length !== savedMessages.length) {
      await saveEncryptedItem('messages', validMessages);
    }

    const loadedContacts = { ...(savedContacts ?? {}) };
    const loadedThreads = { ...(savedThreads ?? {}) };

    // Remove contacts/threads that were marked removed unless newer activity happened after removal
    for (const [peerPubkey, removedAt] of Object.entries(cleanedTombstones.removedPeers)) {
      const hasNewerMsg = validMessages.some(
        (m) => m.peerPubkey === peerPubkey && m.createdAt > removedAt
      );
      if (!hasNewerMsg && (loadedContacts[peerPubkey]?.addedAt ?? 0) <= removedAt) {
        delete loadedContacts[peerPubkey];
        delete loadedThreads[peerPubkey];
      }
    }

    identityRef.current = savedIdentity;
    contactsRef.current = loadedContacts;
    threadsRef.current = loadedThreads;
    messagesRef.current = validMessages;
    tombstonesRef.current = cleanedTombstones;

    const mergedSettings: PrivacySettings = {
      ...DEFAULT_SETTINGS,
      ...(savedSettings ?? {}),
      hasPin,
    };
    settingsRef.current = mergedSettings;

    setIdentity(savedIdentity);
    setContacts(loadedContacts);
    setThreads(loadedThreads);
    setMessages(validMessages);
    setTombstones(cleanedTombstones);
    setSettings(mergedSettings);
    lastActivityRef.current = Date.now();
    setScreen('ready');
  }, []);

  // Capture #golge= or #kapsul= invite hash on initial load & inspect vault state
  useEffect(() => {
    if (window.location.hash.includes('golge=') || window.location.hash.includes('kapsul=')) {
      const parsed = parsePeerInput(window.location.href);
      if (parsed) {
        setPendingInvite(parsed);
      }
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    initVaultStatus()
      .then(async ({ status, hasPin }) => {
        if (status === 'empty') {
          setScreen('onboarding');
        } else if (status === 'locked') {
          setScreen('locked');
        } else {
          await hydrateFromVault(hasPin);
        }
      })
      .catch(() => {
        setScreen('onboarding');
      });
  }, [hydrateFromVault]);

  const handleAddOrSelectPeer = useCallback(
    async (peerInput: {
      pubkey: string;
      username?: string;
      handle?: string;
      npub: string;
      avatarDataUrl?: string;
    }) => {
      if (!identityRef.current || peerInput.pubkey === identityRef.current.pubkey) return;
      const existing = contactsRef.current[peerInput.pubkey];
      const username = peerInput.username ?? existing?.username ?? 'anonim';
      const handle = peerInput.handle ?? existing?.handle ?? formatHandle(username, peerInput.pubkey);
      const avatarDataUrl = isSafeAvatarDataUrl(peerInput.avatarDataUrl)
        ? peerInput.avatarDataUrl
        : existing?.avatarDataUrl;

      const nextContact: PeerContact = existing
        ? { ...existing, username, handle, avatarDataUrl }
        : {
            pubkey: peerInput.pubkey,
            username,
            handle,
            npub: peerInput.npub,
            avatarDataUrl,
            addedAt: Date.now(),
          };

      const nextContacts = { ...contactsRef.current, [peerInput.pubkey]: nextContact };
      contactsRef.current = nextContacts;
      setContacts(nextContacts);

      // Clear prior removedPeers marker since user explicitly added this peer again
      if (tombstonesRef.current.removedPeers[peerInput.pubkey]) {
        const nextRemoved = { ...tombstonesRef.current.removedPeers };
        delete nextRemoved[peerInput.pubkey];
        const nextTomb: TombstoneState = {
          ...tombstonesRef.current,
          removedPeers: nextRemoved,
        };
        tombstonesRef.current = nextTomb;
        setTombstones(nextTomb);
        await saveEncryptedItem('tombstones', nextTomb);
      }

      await saveEncryptedItem('contacts', nextContacts);

      const existingThread = threadsRef.current[peerInput.pubkey];
      const nextThread: ChatThread = existingThread
        ? { ...existingThread, unreadCount: 0 }
        : {
            peerPubkey: peerInput.pubkey,
            ttlHours: DEFAULT_TTL_HOURS,
            unreadCount: 0,
            updatedAt: Date.now(),
          };

      const nextThreads = { ...threadsRef.current, [peerInput.pubkey]: nextThread };
      threadsRef.current = nextThreads;
      setThreads(nextThreads);
      await saveEncryptedItem('threads', nextThreads);

      setActivePeerPubkey(peerInput.pubkey);

      // Opportunistically fetch Kind-0 profile if username/avatar missing
      if (!peerInput.username && relayRef.current) {
        relayRef.current.fetchPeerProfile(peerInput.pubkey).then((prof) => {
          if (!prof) return;
          const cur = contactsRef.current[peerInput.pubkey];
          if (!cur) return;
          const enriched: PeerContact = {
            ...cur,
            username: prof.username,
            handle: prof.handle,
            avatarDataUrl: prof.avatarDataUrl ?? cur.avatarDataUrl,
          };
          const merged = { ...contactsRef.current, [peerInput.pubkey]: enriched };
          contactsRef.current = merged;
          setContacts(merged);
          saveEncryptedItem('contacts', merged).catch(() => {});
        });
      }
    },
    []
  );

  // Apply pending invite link once app is ready
  useEffect(() => {
    if (screen === 'ready' && pendingInvite && identity) {
      handleAddOrSelectPeer(pendingInvite);
      setPendingInvite(null);
    }
  }, [screen, pendingInvite, identity, handleAddOrSelectPeer]);

  // Handle incoming Gift Wrap events (from peers AND self-sync copies from our devices)
  const handleIncomingGiftWrap = useCallback(async (ev: Event) => {
    const currentId = identityRef.current;
    if (!currentId) return;

    const result = await unwrapEphemeralGiftWrap(ev, currentId.secretKeyHex, (peerKey) => {
      return contactsRef.current[peerKey]?.sharedSecret;
    });
    if (!result) return;

    const { senderPubkey, payload, doubleEncrypted } = result;
    const isSelfSync = senderPubkey === currentId.pubkey;
    const chatPeerPubkey = isSelfSync ? payload.targetPeerPubkey : senderPubkey;
    if (!chatPeerPubkey || chatPeerPubkey === currentId.pubkey) return;

    // 1. Live typing signal (ephemeral, never persisted)
    if (payload.kind === 'typing') {
      if (isSelfSync) return;
      const ageMs = Date.now() - payload.sentAt;
      if (ageMs > 12_000 || payload.sentAt > Date.now() + 10_000) return;
      const removedAt = tombstonesRef.current.removedPeers[chatPeerPubkey] ?? 0;
      if (payload.sentAt <= removedAt) return;
      if (!contactsRef.current[chatPeerPubkey]) return;

      setTypingPeers((prev) => ({
        ...prev,
        [chatPeerPubkey]: Date.now() + 4500,
      }));
      return;
    }

    // 2. Deduplicate against active messages AND tombstones (guarantees deleted msgs never return!)
    if (messagesRef.current.some((m) => m.id === payload.id)) return;
    if (tombstonesRef.current.deletedMsgIds[payload.id]) return;

    // 3. Handle remove_peer (from our other device / self-sync replay after re-login)
    if (payload.kind === 'remove_peer') {
      const nextTomb: TombstoneState = {
        deletedMsgIds: {
          ...tombstonesRef.current.deletedMsgIds,
          [payload.id]: payload.expiresAt,
        },
        burnWatermarks: {
          ...tombstonesRef.current.burnWatermarks,
          [chatPeerPubkey]: Math.max(
            tombstonesRef.current.burnWatermarks[chatPeerPubkey] ?? 0,
            payload.sentAt
          ),
        },
        removedPeers: {
          ...tombstonesRef.current.removedPeers,
          [chatPeerPubkey]: Math.max(
            tombstonesRef.current.removedPeers[chatPeerPubkey] ?? 0,
            payload.sentAt
          ),
        },
      };
      tombstonesRef.current = nextTomb;
      setTombstones(nextTomb);
      await saveEncryptedItem('tombstones', nextTomb);

      const remainingMsgs = messagesRef.current.filter(
        (m) => !(m.peerPubkey === chatPeerPubkey && m.createdAt <= payload.sentAt)
      );
      if (remainingMsgs.length !== messagesRef.current.length) {
        messagesRef.current = remainingMsgs;
        setMessages(remainingMsgs);
        await saveEncryptedItem('messages', remainingMsgs);
      }

      if (contactsRef.current[chatPeerPubkey] && (contactsRef.current[chatPeerPubkey].addedAt <= payload.sentAt)) {
        const nextContacts = { ...contactsRef.current };
        delete nextContacts[chatPeerPubkey];
        contactsRef.current = nextContacts;
        setContacts(nextContacts);
        await saveEncryptedItem('contacts', nextContacts);
      }
      if (threadsRef.current[chatPeerPubkey] && !remainingMsgs.some((m) => m.peerPubkey === chatPeerPubkey)) {
        const nextThreads = { ...threadsRef.current };
        delete nextThreads[chatPeerPubkey];
        threadsRef.current = nextThreads;
        setThreads(nextThreads);
        await saveEncryptedItem('threads', nextThreads);
      }
      if (activePeerRef.current === chatPeerPubkey) {
        setActivePeerPubkey(null);
      }
      return;
    }

    // 4. Handle single message deletion (also records targetMsgId tombstone for out-of-order relay replay)
    if (payload.kind === 'delete_msg') {
      const targetId = payload.targetMsgId;
      const nextDeletedIds = {
        ...tombstonesRef.current.deletedMsgIds,
        [payload.id]: payload.expiresAt,
      };
      if (targetId) {
        // Keep tombstone for at least 72h+ so relay replays never resurrect deleted messages
        nextDeletedIds[targetId] = Math.max(
          nextDeletedIds[targetId] ?? 0,
          payload.expiresAt,
          Date.now() + 72 * 3600_000
        );
      }
      const nextTomb: TombstoneState = {
        ...tombstonesRef.current,
        deletedMsgIds: nextDeletedIds,
      };
      tombstonesRef.current = nextTomb;
      setTombstones(nextTomb);
      await saveEncryptedItem('tombstones', nextTomb);

      if (targetId) {
        const filtered = messagesRef.current.filter(
          (m) => !(m.peerPubkey === chatPeerPubkey && m.id === targetId)
        );
        if (filtered.length !== messagesRef.current.length) {
          messagesRef.current = filtered;
          setMessages(filtered);
          await saveEncryptedItem('messages', filtered);
        }
      }
      return;
    }

    // 5. Handle burn_chat (records burnWatermark so replayed old messages stay deleted!)
    if (payload.kind === 'burn_chat') {
      const nextWatermark = Math.max(
        tombstonesRef.current.burnWatermarks[chatPeerPubkey] ?? 0,
        payload.sentAt
      );
      const nextTomb: TombstoneState = {
        ...tombstonesRef.current,
        deletedMsgIds: {
          ...tombstonesRef.current.deletedMsgIds,
          [payload.id]: payload.expiresAt,
        },
        burnWatermarks: {
          ...tombstonesRef.current.burnWatermarks,
          [chatPeerPubkey]: nextWatermark,
        },
      };
      tombstonesRef.current = nextTomb;
      setTombstones(nextTomb);
      await saveEncryptedItem('tombstones', nextTomb);

      const remaining = messagesRef.current.filter(
        (m) => !(m.peerPubkey === chatPeerPubkey && m.createdAt <= nextWatermark)
      );

      const removedAt = nextTomb.removedPeers[chatPeerPubkey] ?? 0;
      if (removedAt >= payload.sentAt) {
        messagesRef.current = remaining;
        setMessages(remaining);
        await saveEncryptedItem('messages', remaining);
        return;
      }

      const existingContact = contactsRef.current[chatPeerPubkey];
      const peerLabel = existingContact?.handle ?? payload.senderHandle;
      const notice: ChatMessage = {
        id: payload.id,
        peerPubkey: chatPeerPubkey,
        direction: 'system',
        text: isSelfSync
          ? 'Sohbet geçmişi diğer cihazınızdan yakıldı'
          : `${peerLabel} sohbet geçmişini sildi`,
        createdAt: payload.sentAt,
        expiresAt: payload.expiresAt,
        ttlHours: payload.ttlHours,
      };
      const nextMsgs = [...remaining, notice];
      messagesRef.current = nextMsgs;
      setMessages(nextMsgs);
      await saveEncryptedItem('messages', nextMsgs);

      if (existingContact) {
        const prevThread = threadsRef.current[chatPeerPubkey];
        const isChatOpen = activePeerRef.current === chatPeerPubkey;
        const nextThreads = {
          ...threadsRef.current,
          [chatPeerPubkey]: {
            peerPubkey: chatPeerPubkey,
            ttlHours: prevThread?.ttlHours ?? payload.ttlHours,
            unreadCount: isChatOpen || isSelfSync ? 0 : (prevThread?.unreadCount ?? 0) + 1,
            updatedAt: Date.now(),
          },
        };
        threadsRef.current = nextThreads;
        setThreads(nextThreads);
        await saveEncryptedItem('threads', nextThreads);
      }
      return;
    }

    // 6. Drop any msg / ttl_sync / react that predates burnWatermark or peer removal
    const burnWatermark = tombstonesRef.current.burnWatermarks[chatPeerPubkey] ?? 0;
    const removedAt = tombstonesRef.current.removedPeers[chatPeerPubkey] ?? 0;
    if (payload.sentAt <= burnWatermark || payload.sentAt <= removedAt) {
      return;
    }

    // 7. Handle emoji reaction toggle
    if (payload.kind === 'react') {
      if (!payload.targetMsgId || !payload.reaction) return;
      if (tombstonesRef.current.deletedMsgIds[payload.targetMsgId]) return;

      const nextTomb: TombstoneState = {
        ...tombstonesRef.current,
        deletedMsgIds: {
          ...tombstonesRef.current.deletedMsgIds,
          [payload.id]: payload.expiresAt,
        },
      };
      tombstonesRef.current = nextTomb;
      setTombstones(nextTomb);
      await saveEncryptedItem('tombstones', nextTomb);

      const reactorPubkey = senderPubkey;
      const emoji = payload.reaction;
      let changed = false;

      const updatedMsgs = messagesRef.current.map((m) => {
        if (m.peerPubkey !== chatPeerPubkey || m.id !== payload.targetMsgId) return m;
        changed = true;
        const prevReactions = { ...(m.reactions ?? {}) };
        const currentList = prevReactions[emoji] ?? [];
        const hasReacted = currentList.includes(reactorPubkey);
        const nextList = hasReacted
          ? currentList.filter((p) => p !== reactorPubkey)
          : [...currentList, reactorPubkey];
        if (nextList.length === 0) {
          delete prevReactions[emoji];
        } else {
          prevReactions[emoji] = nextList;
        }
        return { ...m, reactions: prevReactions };
      });

      if (changed) {
        messagesRef.current = updatedMsgs;
        setMessages(updatedMsgs);
        await saveEncryptedItem('messages', updatedMsgs);
      }
      return;
    }

    // Clear removedPeers if genuinely newer communication arrived after removal
    if (removedAt > 0 && payload.sentAt > removedAt) {
      const nextRemoved = { ...tombstonesRef.current.removedPeers };
      delete nextRemoved[chatPeerPubkey];
      const nextTomb: TombstoneState = {
        ...tombstonesRef.current,
        removedPeers: nextRemoved,
      };
      tombstonesRef.current = nextTomb;
      setTombstones(nextTomb);
      await saveEncryptedItem('tombstones', nextTomb);
    }

    // Ensure peer exists in contacts
    const existingContact = contactsRef.current[chatPeerPubkey];
    let nextContact: PeerContact;

    if (isSelfSync) {
      const fallbackHandle = payload.targetPeerHandle ?? `anonim#${chatPeerPubkey.slice(0, 4)}`;
      const fallbackName = fallbackHandle.split('#')[0] || 'anonim';
      nextContact = existingContact
        ? { ...existingContact, lastSeenAt: Date.now() }
        : {
            pubkey: chatPeerPubkey,
            username: fallbackName,
            handle: fallbackHandle,
            npub: parsePeerInput(chatPeerPubkey)?.npub ?? chatPeerPubkey,
            addedAt: payload.sentAt,
            lastSeenAt: Date.now(),
          };
    } else {
      const senderUsername = payload.senderHandle.split('#')[0] || 'anonim';
      nextContact = existingContact
        ? {
            ...existingContact,
            username: senderUsername,
            handle: payload.senderHandle,
            avatarDataUrl: payload.senderAvatar ?? existingContact.avatarDataUrl,
            lastSeenAt: Date.now(),
          }
        : {
            pubkey: chatPeerPubkey,
            username: senderUsername,
            handle: payload.senderHandle,
            npub: parsePeerInput(chatPeerPubkey)?.npub ?? chatPeerPubkey,
            avatarDataUrl: payload.senderAvatar,
            addedAt: payload.sentAt,
            lastSeenAt: Date.now(),
          };
    }

    const nextContacts = { ...contactsRef.current, [chatPeerPubkey]: nextContact };
    contactsRef.current = nextContacts;
    setContacts(nextContacts);
    await saveEncryptedItem('contacts', nextContacts);

    if (isSelfSync && !existingContact && relayRef.current) {
      relayRef.current.fetchPeerProfile(chatPeerPubkey).then((prof) => {
        if (!prof) return;
        const cur = contactsRef.current[chatPeerPubkey];
        if (!cur) return;
        const enriched: PeerContact = {
          ...cur,
          username: prof.username,
          handle: prof.handle,
          avatarDataUrl: prof.avatarDataUrl ?? cur.avatarDataUrl,
        };
        const merged = { ...contactsRef.current, [chatPeerPubkey]: enriched };
        contactsRef.current = merged;
        setContacts(merged);
        saveEncryptedItem('contacts', merged).catch(() => {});
      });
    }

    const prevThread = threadsRef.current[chatPeerPubkey];
    const isChatOpen = activePeerRef.current === chatPeerPubkey;

    if (payload.kind === 'ttl_sync') {
      const nextThreads = {
        ...threadsRef.current,
        [chatPeerPubkey]: {
          peerPubkey: chatPeerPubkey,
          ttlHours: payload.ttlHours,
          unreadCount: isChatOpen || isSelfSync ? 0 : (prevThread?.unreadCount ?? 0) + 1,
          updatedAt: Date.now(),
        },
      };
      threadsRef.current = nextThreads;
      setThreads(nextThreads);
      await saveEncryptedItem('threads', nextThreads);

      const notice: ChatMessage = {
        id: payload.id,
        peerPubkey: chatPeerPubkey,
        direction: 'system',
        text: isSelfSync
          ? `Otomatik silme süresi ${payload.ttlHours} saat yapıldı`
          : `${nextContact.handle} otomatik silme süresini ${payload.ttlHours} saat yaptı`,
        createdAt: payload.sentAt,
        expiresAt: payload.expiresAt,
        ttlHours: payload.ttlHours,
      };
      const nextMsgs = [...messagesRef.current, notice];
      messagesRef.current = nextMsgs;
      setMessages(nextMsgs);
      await saveEncryptedItem('messages', nextMsgs);
      return;
    }

    // Standard encrypted message (incoming from peer OR synced outgoing from our 2nd device)
    if (!isSelfSync) {
      setTypingPeers((prev) => {
        if (!prev[chatPeerPubkey]) return prev;
        const copy = { ...prev };
        delete copy[chatPeerPubkey];
        return copy;
      });
    }

    const newMsg: ChatMessage = {
      id: payload.id,
      peerPubkey: chatPeerPubkey,
      direction: isSelfSync ? 'outgoing' : 'incoming',
      text: payload.text,
      createdAt: payload.sentAt,
      expiresAt: payload.expiresAt,
      ttlHours: payload.ttlHours,
      burnAfterSec: payload.burnAfterSec,
      delivery: isSelfSync ? 'relayed' : undefined,
      relayCount: isSelfSync ? 1 : undefined,
      doubleEncrypted,
      replyToId: payload.replyToId,
      replyToPreview: payload.replyToPreview,
    };

    const nextMsgs = [...messagesRef.current, newMsg];
    messagesRef.current = nextMsgs;
    setMessages(nextMsgs);
    await saveEncryptedItem('messages', nextMsgs);

    if (!isSelfSync && settingsRef.current.soundEnabled) {
      playIncomingPing();
    }

    const nextThreads = {
      ...threadsRef.current,
      [chatPeerPubkey]: {
        peerPubkey: chatPeerPubkey,
        ttlHours: prevThread?.ttlHours ?? payload.ttlHours,
        unreadCount: isChatOpen || isSelfSync ? 0 : (prevThread?.unreadCount ?? 0) + 1,
        updatedAt: Math.max(prevThread?.updatedAt ?? 0, payload.sentAt),
      },
    };
    threadsRef.current = nextThreads;
    setThreads(nextThreads);
    await saveEncryptedItem('threads', nextThreads);
  }, []);

  // Connect to public Nostr relays when ready
  const startRelaySession = useCallback(
    (activeId: LocalIdentity, relays: string[]) => {
      relayRef.current?.destroy();
      const net = new RelayNetwork(relays, (statuses) => {
        setRelayHealth(statuses);
      });
      relayRef.current = net;
      setRelayHealth(net.getHealth());

      net.connectAll().then(() => {
        net.publishIdentityAnnouncement(activeId).catch(() => {});
      });
      net.subscribeGiftWraps(activeId.pubkey, handleIncomingGiftWrap);
    },
    [handleIncomingGiftWrap]
  );

  useEffect(() => {
    if (screen === 'ready' && identity) {
      startRelaySession(identity, settings.relays);
      return () => {
        relayRef.current?.destroy();
        relayRef.current = null;
      };
    }
  }, [screen, identity, settings.relays, startRelaySession]);

  const handleLockVault = useCallback(() => {
    relayRef.current?.destroy();
    relayRef.current = null;
    lockVaultMemory();
    setIdentity(null);
    setMessages([]);
    setTypingPeers({});
    setShowNetworkModal(false);
    setShowInviteModal(false);
    setShowLogoutModal(false);
    setSafetyPeer(null);
    setScreen('locked');
  }, []);

  // 1-second ephemeral TTL sweeper, typing timeout sweeper & inactivity auto-lock
  useEffect(() => {
    if (screen !== 'ready') return;
    const timer = setInterval(() => {
      const now = Date.now();
      setNowMs(now);

      const current = messagesRef.current;
      if (current.some((m) => m.expiresAt <= now)) {
        const alive = current.filter((m) => m.expiresAt > now);
        messagesRef.current = alive;
        setMessages(alive);
        saveEncryptedItem('messages', alive).catch(() => {});
      }

      setTypingPeers((prev) => {
        let hasExpired = false;
        for (const exp of Object.values(prev)) {
          if (exp <= now) {
            hasExpired = true;
            break;
          }
        }
        if (!hasExpired) return prev;
        const next: Record<string, number> = {};
        for (const [pk, exp] of Object.entries(prev)) {
          if (exp > now) next[pk] = exp;
        }
        return next;
      });

      if (settings.hasPin && settings.autoLockMinutes > 0) {
        const idleMs = now - lastActivityRef.current;
        if (idleMs >= settings.autoLockMinutes * 60_000) {
          handleLockVault();
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [screen, settings.hasPin, settings.autoLockMinutes, handleLockVault]);

  // Activity tracking for auto-lock
  useEffect(() => {
    if (screen !== 'ready') return;
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    return () => {
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [screen]);

  // Tab-switch / background auto-blur shield
  useEffect(() => {
    if (screen !== 'ready') return;
    const onVisibility = () => {
      if (document.hidden && settings.autoBlurOnBackground) {
        setPrivacyBlurred(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [screen, settings.autoBlurOnBackground]);

  const handleCreateIdentity = async (username: string, pin?: string, avatarDataUrl?: string) => {
    await initializeNewVault(pin);
    const id = createLocalIdentity(username);
    if (isSafeAvatarDataUrl(avatarDataUrl)) {
      id.avatarDataUrl = avatarDataUrl;
    }
    const nextSettings: PrivacySettings = { ...DEFAULT_SETTINGS, hasPin: Boolean(pin) };
    await saveEncryptedItem('identity', id);
    await saveEncryptedItem('contacts', {});
    await saveEncryptedItem('threads', {});
    await saveEncryptedItem('messages', []);
    await saveEncryptedItem('settings', nextSettings);
    await saveEncryptedItem('tombstones', EMPTY_TOMBSTONES);
    identityRef.current = id;
    contactsRef.current = {};
    threadsRef.current = {};
    messagesRef.current = [];
    tombstonesRef.current = EMPTY_TOMBSTONES;
    settingsRef.current = nextSettings;
    setIdentity(id);
    setContacts({});
    setThreads({});
    setMessages([]);
    setTombstones(EMPTY_TOMBSTONES);
    setSettings(nextSettings);
    lastActivityRef.current = Date.now();
    setScreen('ready');
  };

  const handleRestoreIdentity = async (
    username: string,
    nsecOrHex: string,
    pin?: string,
    avatarDataUrl?: string
  ) => {
    const id = restoreIdentityFromNsec(username, nsecOrHex);
    if (isSafeAvatarDataUrl(avatarDataUrl)) {
      id.avatarDataUrl = avatarDataUrl;
    }
    await initializeNewVault(pin);
    const nextSettings: PrivacySettings = { ...DEFAULT_SETTINGS, hasPin: Boolean(pin) };
    await saveEncryptedItem('identity', id);
    await saveEncryptedItem('contacts', {});
    await saveEncryptedItem('threads', {});
    await saveEncryptedItem('messages', []);
    await saveEncryptedItem('settings', nextSettings);
    await saveEncryptedItem('tombstones', EMPTY_TOMBSTONES);
    identityRef.current = id;
    contactsRef.current = {};
    threadsRef.current = {};
    messagesRef.current = [];
    tombstonesRef.current = EMPTY_TOMBSTONES;
    settingsRef.current = nextSettings;
    setIdentity(id);
    setContacts({});
    setThreads({});
    setMessages([]);
    setTombstones(EMPTY_TOMBSTONES);
    setSettings(nextSettings);
    lastActivityRef.current = Date.now();
    setScreen('ready');
  };

  const handleUnlockPin = async (pin: string): Promise<boolean> => {
    const ok = await unlockVaultWithPin(pin);
    if (!ok) return false;
    await hydrateFromVault(true);
    return true;
  };

  const handleLogout = async () => {
    relayRef.current?.destroy();
    relayRef.current = null;
    await wipeEntireVault();
    identityRef.current = null;
    contactsRef.current = {};
    threadsRef.current = {};
    messagesRef.current = [];
    tombstonesRef.current = EMPTY_TOMBSTONES;
    settingsRef.current = DEFAULT_SETTINGS;
    setIdentity(null);
    setContacts({});
    setThreads({});
    setMessages([]);
    setTombstones(EMPTY_TOMBSTONES);
    setTypingPeers({});
    setActivePeerPubkey(null);
    setSettings(DEFAULT_SETTINGS);
    setShowLogoutModal(false);
    setScreen('onboarding');
  };

  const handleSelectPeer = async (pubkey: string | null) => {
    setActivePeerPubkey(pubkey);
    if (pubkey && threadsRef.current[pubkey]?.unreadCount) {
      const nextThreads = {
        ...threadsRef.current,
        [pubkey]: { ...threadsRef.current[pubkey], unreadCount: 0 },
      };
      threadsRef.current = nextThreads;
      setThreads(nextThreads);
      await saveEncryptedItem('threads', nextThreads);
    }
  };

  const handleSearchUsers = async (query: string): Promise<DiscoveredUser[]> => {
    if (!relayRef.current) return [];
    return relayRef.current.searchUsersByUsername(query);
  };

  const handleTyping = async (peerPubkey: string) => {
    const currentId = identityRef.current;
    if (!currentId || !relayRef.current) return;
    const peer = contactsRef.current[peerPubkey];
    const ttl = threadsRef.current[peerPubkey]?.ttlHours ?? DEFAULT_TTL_HOURS;
    const { giftWrap } = await createEphemeralGiftWrap({
      senderIdentity: currentId,
      recipientPubkey: peerPubkey,
      recipientHandle: peer?.handle,
      kind: 'typing',
      text: '',
      ttlHours: ttl,
      blockPaddingBytes: settingsRef.current.blockPaddingBytes,
      includeSelfCopy: false,
    });
    if (giftWrap) {
      relayRef.current.publishGiftWrap(giftWrap).catch(() => {});
    }
  };

  const handleSendMessage = async (
    peerPubkey: string,
    text: string,
    options?: {
      replyTo?: { id: string; preview: string };
      burnAfterSec?: number;
    }
  ) => {
    const currentId = identityRef.current;
    if (!currentId || !relayRef.current) return;
    const peer = contactsRef.current[peerPubkey];
    const thread = threadsRef.current[peerPubkey];
    const ttlHours: TTLHours = thread?.ttlHours ?? DEFAULT_TTL_HOURS;

    const { giftWrap, selfWrap, rumorId, sentAt, expiresAt } = await createEphemeralGiftWrap({
      senderIdentity: currentId,
      recipientPubkey: peerPubkey,
      recipientHandle: peer?.handle,
      kind: 'msg',
      text,
      ttlHours,
      burnAfterSec: options?.burnAfterSec,
      blockPaddingBytes: settingsRef.current.blockPaddingBytes,
      sharedSecret: peer?.sharedSecret,
      replyTo: options?.replyTo,
      includeSelfCopy: true,
    });

    const optimistic: ChatMessage = {
      id: rumorId,
      peerPubkey,
      direction: 'outgoing',
      text,
      createdAt: sentAt,
      expiresAt,
      ttlHours,
      burnAfterSec: options?.burnAfterSec,
      delivery: 'sending',
      doubleEncrypted: Boolean(peer?.sharedSecret),
      replyToId: options?.replyTo?.id,
      replyToPreview: options?.replyTo?.preview,
    };

    const withOptimistic = [...messagesRef.current, optimistic];
    messagesRef.current = withOptimistic;
    setMessages(withOptimistic);

    const nextThreads = {
      ...threadsRef.current,
      [peerPubkey]: {
        peerPubkey,
        ttlHours,
        unreadCount: 0,
        updatedAt: sentAt,
      },
    };
    threadsRef.current = nextThreads;
    setThreads(nextThreads);
    await saveEncryptedItem('threads', nextThreads);

    const [accepted] = await Promise.all([
      giftWrap ? relayRef.current.publishGiftWrap(giftWrap) : Promise.resolve(0),
      selfWrap ? relayRef.current.publishGiftWrap(selfWrap) : Promise.resolve(0),
    ]);

    const finalized = messagesRef.current.map((m) =>
      m.id === rumorId
        ? {
            ...m,
            delivery: accepted > 0 ? ('relayed' as const) : ('failed' as const),
            relayCount: accepted,
          }
        : m
    );
    messagesRef.current = finalized;
    setMessages(finalized);
    await saveEncryptedItem('messages', finalized);
  };

  const handleReactMessage = async (msg: ChatMessage, emoji: string) => {
    const currentId = identityRef.current;
    if (!currentId || !relayRef.current) return;

    // Optimistic local toggle
    const updatedMsgs = messagesRef.current.map((m) => {
      if (m.id !== msg.id) return m;
      const prevReactions = { ...(m.reactions ?? {}) };
      const currentList = prevReactions[emoji] ?? [];
      const hasReacted = currentList.includes(currentId.pubkey);
      const nextList = hasReacted
        ? currentList.filter((p) => p !== currentId.pubkey)
        : [...currentList, currentId.pubkey];
      if (nextList.length === 0) {
        delete prevReactions[emoji];
      } else {
        prevReactions[emoji] = nextList;
      }
      return { ...m, reactions: prevReactions };
    });
    messagesRef.current = updatedMsgs;
    setMessages(updatedMsgs);
    await saveEncryptedItem('messages', updatedMsgs);

    const peer = contactsRef.current[msg.peerPubkey];
    const ttl = threadsRef.current[msg.peerPubkey]?.ttlHours ?? DEFAULT_TTL_HOURS;
    const { giftWrap, selfWrap, rumorId, expiresAt } = await createEphemeralGiftWrap({
      senderIdentity: currentId,
      recipientPubkey: msg.peerPubkey,
      recipientHandle: peer?.handle,
      kind: 'react',
      text: '',
      ttlHours: ttl,
      blockPaddingBytes: settingsRef.current.blockPaddingBytes,
      targetMsgId: msg.id,
      reaction: emoji,
      includeSelfCopy: true,
    });

    const nextTomb: TombstoneState = {
      ...tombstonesRef.current,
      deletedMsgIds: {
        ...tombstonesRef.current.deletedMsgIds,
        [rumorId]: expiresAt,
      },
    };
    tombstonesRef.current = nextTomb;
    setTombstones(nextTomb);
    await saveEncryptedItem('tombstones', nextTomb);

    await Promise.allSettled([
      giftWrap ? relayRef.current.publishGiftWrap(giftWrap) : Promise.resolve(0),
      selfWrap ? relayRef.current.publishGiftWrap(selfWrap) : Promise.resolve(0),
    ]);
  };

  const handleDeleteMessage = async (msg: ChatMessage, scope: 'local' | 'both') => {
    const remaining = messagesRef.current.filter((m) => m.id !== msg.id);
    messagesRef.current = remaining;
    setMessages(remaining);

    // Record persistent tombstone so relay replays (reload or exit/re-enter) NEVER resurrect deleted messages
    const keepUntil = Math.max(msg.expiresAt, Date.now() + 72 * 3600_000);
    const nextTomb: TombstoneState = {
      ...tombstonesRef.current,
      deletedMsgIds: {
        ...tombstonesRef.current.deletedMsgIds,
        [msg.id]: keepUntil,
      },
    };
    tombstonesRef.current = nextTomb;
    setTombstones(nextTomb);

    await Promise.all([
      saveEncryptedItem('messages', remaining),
      saveEncryptedItem('tombstones', nextTomb),
    ]);

    const currentId = identityRef.current;
    if (currentId && relayRef.current) {
      const peer = contactsRef.current[msg.peerPubkey];
      const ttl = threadsRef.current[msg.peerPubkey]?.ttlHours ?? DEFAULT_TTL_HOURS;
      const { giftWrap, selfWrap } = await createEphemeralGiftWrap({
        senderIdentity: currentId,
        recipientPubkey: msg.peerPubkey,
        recipientHandle: peer?.handle,
        kind: 'delete_msg',
        text: '',
        ttlHours: ttl,
        blockPaddingBytes: settingsRef.current.blockPaddingBytes,
        targetMsgId: msg.id,
        includeSelfCopy: true,
        selfOnly: scope === 'local',
      });
      await Promise.allSettled([
        giftWrap ? relayRef.current.publishGiftWrap(giftWrap) : Promise.resolve(0),
        selfWrap ? relayRef.current.publishGiftWrap(selfWrap) : Promise.resolve(0),
      ]);
    }
  };

  const handleChangeChatTTL = async (peerPubkey: string, ttl: TTLHours) => {
    const currentId = identityRef.current;
    if (!currentId || !relayRef.current) return;
    const prev = threadsRef.current[peerPubkey];
    if (prev?.ttlHours === ttl) return;

    const nextThreads = {
      ...threadsRef.current,
      [peerPubkey]: {
        peerPubkey,
        ttlHours: ttl,
        unreadCount: 0,
        updatedAt: Date.now(),
      },
    };
    threadsRef.current = nextThreads;
    setThreads(nextThreads);
    await saveEncryptedItem('threads', nextThreads);

    const peer = contactsRef.current[peerPubkey];
    const { giftWrap, selfWrap, rumorId, sentAt, expiresAt } = await createEphemeralGiftWrap({
      senderIdentity: currentId,
      recipientPubkey: peerPubkey,
      recipientHandle: peer?.handle,
      kind: 'ttl_sync',
      text: `Otomatik silme süresi ${ttl} saat olarak ayarlandı.`,
      ttlHours: ttl,
      blockPaddingBytes: settingsRef.current.blockPaddingBytes,
      includeSelfCopy: true,
    });

    const sysMsg: ChatMessage = {
      id: rumorId,
      peerPubkey,
      direction: 'system',
      text: `Otomatik silme süresi ${ttl} saat yapıldı`,
      createdAt: sentAt,
      expiresAt,
      ttlHours: ttl,
    };
    const nextMsgs = [...messagesRef.current, sysMsg];
    messagesRef.current = nextMsgs;
    setMessages(nextMsgs);
    await saveEncryptedItem('messages', nextMsgs);

    await Promise.allSettled([
      giftWrap ? relayRef.current.publishGiftWrap(giftWrap) : Promise.resolve(0),
      selfWrap ? relayRef.current.publishGiftWrap(selfWrap) : Promise.resolve(0),
    ]);
  };

  const handleSavePeerSecurity = async (
    pubkey: string,
    updates: { verifiedFingerprint?: boolean; sharedSecret?: string }
  ) => {
    const existing = contactsRef.current[pubkey];
    if (!existing) return;
    const updated: PeerContact = {
      ...existing,
      verifiedFingerprint: updates.verifiedFingerprint,
      sharedSecret: updates.sharedSecret,
    };
    const nextContacts = { ...contactsRef.current, [pubkey]: updated };
    contactsRef.current = nextContacts;
    setContacts(nextContacts);
    await saveEncryptedItem('contacts', nextContacts);
  };

  const handleUpdateSettings = async (patch: Partial<PrivacySettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    await saveEncryptedItem('settings', next);
  };

  const handleUpdateAvatar = async (avatarDataUrl: string | undefined) => {
    const currentId = identityRef.current;
    if (!currentId) return;
    const updated: LocalIdentity = {
      ...currentId,
      avatarDataUrl: isSafeAvatarDataUrl(avatarDataUrl) ? avatarDataUrl : undefined,
    };
    identityRef.current = updated;
    setIdentity(updated);
    await saveEncryptedItem('identity', updated);
    if (relayRef.current) {
      await relayRef.current.publishIdentityAnnouncement(updated).catch(() => {});
    }
  };

  const handleSetOrChangePin = async (newPin: string | null) => {
    const nextSettings: PrivacySettings = {
      ...settingsRef.current,
      hasPin: Boolean(newPin),
      autoLockMinutes: newPin ? settingsRef.current.autoLockMinutes : 0,
    };
    await rekeyVaultWithPin(newPin, {
      identity: identityRef.current,
      contacts: contactsRef.current,
      threads: threadsRef.current,
      messages: messagesRef.current,
      settings: nextSettings,
      tombstones: tombstonesRef.current,
    });
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  };

  const handleConfirmBurn = async (options?: { burnRemoteAlso?: boolean }) => {
    if (!burnTarget) return;
    if (burnTarget.mode === 'delete_account') {
      const currentId = identityRef.current;
      if (currentId && relayRef.current) {
        if (options?.burnRemoteAlso) {
          const peerList = Object.values(contactsRef.current);
          await Promise.allSettled(
            peerList.map(async (peer) => {
              const ttl = threadsRef.current[peer.pubkey]?.ttlHours ?? DEFAULT_TTL_HOURS;
              const { giftWrap } = await createEphemeralGiftWrap({
                senderIdentity: currentId,
                recipientPubkey: peer.pubkey,
                recipientHandle: peer.handle,
                kind: 'burn_chat',
                text: 'burn',
                ttlHours: ttl,
                blockPaddingBytes: settingsRef.current.blockPaddingBytes,
                includeSelfCopy: false,
              });
              if (giftWrap) {
                await relayRef.current?.publishGiftWrap(giftWrap);
              }
            })
          );
        }
        await relayRef.current.publishAccountDeletion(currentId).catch(() => {});
      }

      relayRef.current?.destroy();
      relayRef.current = null;
      await wipeEntireVault();
      identityRef.current = null;
      contactsRef.current = {};
      threadsRef.current = {};
      messagesRef.current = [];
      tombstonesRef.current = EMPTY_TOMBSTONES;
      settingsRef.current = DEFAULT_SETTINGS;
      setIdentity(null);
      setContacts({});
      setThreads({});
      setMessages([]);
      setTombstones(EMPTY_TOMBSTONES);
      setTypingPeers({});
      setActivePeerPubkey(null);
      setSettings(DEFAULT_SETTINGS);
      setBurnTarget(null);
      setScreen('onboarding');
      return;
    }

    if (burnTarget.mode === 'all') {
      relayRef.current?.destroy();
      relayRef.current = null;
      await wipeEntireVault();
      identityRef.current = null;
      contactsRef.current = {};
      threadsRef.current = {};
      messagesRef.current = [];
      tombstonesRef.current = EMPTY_TOMBSTONES;
      settingsRef.current = DEFAULT_SETTINGS;
      setIdentity(null);
      setContacts({});
      setThreads({});
      setMessages([]);
      setTombstones(EMPTY_TOMBSTONES);
      setTypingPeers({});
      setActivePeerPubkey(null);
      setSettings(DEFAULT_SETTINGS);
      setBurnTarget(null);
      setScreen('onboarding');
      return;
    }

    const now = Date.now();
    const peerPubkey = burnTarget.peer.pubkey;
    const ttl = threadsRef.current[peerPubkey]?.ttlHours ?? DEFAULT_TTL_HOURS;
    const remainingMsgs = messagesRef.current.filter((m) => m.peerPubkey !== peerPubkey);
    messagesRef.current = remainingMsgs;
    setMessages(remainingMsgs);

    if (burnTarget.mode === 'remove_peer') {
      const nextTomb: TombstoneState = {
        ...tombstonesRef.current,
        burnWatermarks: {
          ...tombstonesRef.current.burnWatermarks,
          [peerPubkey]: now,
        },
        removedPeers: {
          ...tombstonesRef.current.removedPeers,
          [peerPubkey]: now,
        },
      };
      tombstonesRef.current = nextTomb;
      setTombstones(nextTomb);

      const nextContacts = { ...contactsRef.current };
      delete nextContacts[peerPubkey];
      contactsRef.current = nextContacts;
      setContacts(nextContacts);

      const nextThreads = { ...threadsRef.current };
      delete nextThreads[peerPubkey];
      threadsRef.current = nextThreads;
      setThreads(nextThreads);

      if (activePeerRef.current === peerPubkey) {
        setActivePeerPubkey(null);
      }

      await Promise.all([
        saveEncryptedItem('messages', remainingMsgs),
        saveEncryptedItem('tombstones', nextTomb),
        saveEncryptedItem('contacts', nextContacts),
        saveEncryptedItem('threads', nextThreads),
      ]);

      const currentId = identityRef.current;
      if (currentId && relayRef.current) {
        const tasks: Promise<unknown>[] = [];
        // Self-only remove marker so re-login with nsec keeps this contact deleted
        tasks.push(
          createEphemeralGiftWrap({
            senderIdentity: currentId,
            recipientPubkey: peerPubkey,
            recipientHandle: burnTarget.peer.handle,
            kind: 'remove_peer',
            text: '',
            ttlHours: ttl,
            blockPaddingBytes: settingsRef.current.blockPaddingBytes,
            selfOnly: true,
          }).then(({ selfWrap }) =>
            selfWrap ? relayRef.current?.publishGiftWrap(selfWrap) : undefined
          )
        );
        if (options?.burnRemoteAlso) {
          tasks.push(
            createEphemeralGiftWrap({
              senderIdentity: currentId,
              recipientPubkey: peerPubkey,
              recipientHandle: burnTarget.peer.handle,
              kind: 'burn_chat',
              text: 'burn',
              ttlHours: ttl,
              blockPaddingBytes: settingsRef.current.blockPaddingBytes,
              includeSelfCopy: false,
            }).then(({ giftWrap }) =>
              giftWrap ? relayRef.current?.publishGiftWrap(giftWrap) : undefined
            )
          );
        }
        await Promise.allSettled(tasks);
      }

      setBurnTarget(null);
      return;
    }

    // mode === 'chat' (burn all messages in conversation, keep contact)
    const nextTomb: TombstoneState = {
      ...tombstonesRef.current,
      burnWatermarks: {
        ...tombstonesRef.current.burnWatermarks,
        [peerPubkey]: now,
      },
    };
    tombstonesRef.current = nextTomb;
    setTombstones(nextTomb);

    await Promise.all([
      saveEncryptedItem('messages', remainingMsgs),
      saveEncryptedItem('tombstones', nextTomb),
    ]);

    const currentId = identityRef.current;
    if (currentId && relayRef.current) {
      const { giftWrap, selfWrap } = await createEphemeralGiftWrap({
        senderIdentity: currentId,
        recipientPubkey: peerPubkey,
        recipientHandle: burnTarget.peer.handle,
        kind: 'burn_chat',
        text: 'burn',
        ttlHours: ttl,
        blockPaddingBytes: settingsRef.current.blockPaddingBytes,
        includeSelfCopy: true,
      });
      await Promise.allSettled([
        giftWrap ? relayRef.current.publishGiftWrap(giftWrap) : Promise.resolve(0),
        selfWrap ? relayRef.current.publishGiftWrap(selfWrap) : Promise.resolve(0),
      ]);
    }

    setBurnTarget(null);
  };

  if (screen === 'booting') {
    return (
      <div className="min-h-screen w-full bg-[#07080C] flex items-center justify-center text-sm text-slate-400">
        Şifreli kasa hazırlanıyor...
      </div>
    );
  }

  if (screen === 'onboarding') {
    return (
      <OnboardingView
        onCreateIdentity={handleCreateIdentity}
        onRestoreIdentity={handleRestoreIdentity}
        pendingInviteLabel={pendingInvite?.handle ?? pendingInvite?.npub.slice(0, 16) ?? null}
      />
    );
  }

  if (screen === 'locked') {
    return (
      <>
        <LockScreen
          onUnlock={handleUnlockPin}
          onPanicWipe={() => setBurnTarget({ mode: 'all' })}
        />
        {burnTarget && (
          <BurnModal
            mode={burnTarget.mode}
            onConfirm={handleConfirmBurn}
            onCancel={() => setBurnTarget(null)}
          />
        )}
      </>
    );
  }

  if (!identity) return null;

  return (
    <>
      <ChatWorkspace
        identity={identity}
        contacts={contacts}
        threads={threads}
        messages={messages}
        activePeerPubkey={activePeerPubkey}
        settings={settings}
        relayHealth={relayHealth}
        typingPeers={typingPeers}
        privacyBlurred={privacyBlurred}
        nowMs={nowMs}
        onTogglePrivacyBlur={() => setPrivacyBlurred((prev) => !prev)}
        onSelectPeer={handleSelectPeer}
        onSearchUsers={handleSearchUsers}
        onAddPeer={handleAddOrSelectPeer}
        onSendMessage={handleSendMessage}
        onTyping={handleTyping}
        onReactMessage={handleReactMessage}
        onDeleteMessage={handleDeleteMessage}
        onChangeChatTTL={handleChangeChatTTL}
        onOpenInvite={() => setShowInviteModal(true)}
        onOpenNetwork={() => setShowNetworkModal(true)}
        onOpenSafety={(peer) => setSafetyPeer(peer)}
        onLockVault={handleLockVault}
        onRequestLogout={() => setShowLogoutModal(true)}
        onRequestBurnChat={(peer) => setBurnTarget({ mode: 'chat', peer })}
        onRequestRemovePeer={(peer) => setBurnTarget({ mode: 'remove_peer', peer })}
        onRequestPanicWipe={() => setBurnTarget({ mode: 'all' })}
      />

      {showInviteModal && (
        <InviteModal identity={identity} onClose={() => setShowInviteModal(false)} />
      )}

      {safetyPeer && (
        <SafetyModal
          identity={identity}
          peer={safetyPeer}
          onSavePeerSecurity={handleSavePeerSecurity}
          onClose={() => setSafetyPeer(null)}
        />
      )}

      {showNetworkModal && (
        <NetworkModal
          identity={identity}
          settings={settings}
          relayHealth={relayHealth}
          onUpdateSettings={handleUpdateSettings}
          onUpdateAvatar={handleUpdateAvatar}
          onSetOrChangePin={handleSetOrChangePin}
          onReconnectRelays={() => startRelaySession(identity, settings.relays)}
          onRequestDeleteAccount={() => setBurnTarget({ mode: 'delete_account' })}
          onClose={() => setShowNetworkModal(false)}
        />
      )}

      {showLogoutModal && (
        <LogoutModal
          identity={identity}
          onConfirmLogout={handleLogout}
          onRequestDeleteAccount={() => {
            setShowLogoutModal(false);
            setBurnTarget({ mode: 'delete_account' });
          }}
          onCancel={() => setShowLogoutModal(false)}
        />
      )}

      {burnTarget && (
        <BurnModal
          mode={burnTarget.mode}
          peerHandle={
            burnTarget.mode === 'chat' || burnTarget.mode === 'remove_peer'
              ? burnTarget.peer.handle
              : undefined
          }
          onConfirm={handleConfirmBurn}
          onCancel={() => setBurnTarget(null)}
        />
      )}
    </>
  );
}
