import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip44 from 'nostr-tools/nip44';
import { GiftWrap, PrivateDirectMessage, Seal } from 'nostr-tools/kinds';
import type { DecryptedEnvelopePayload, LocalIdentity, TTLHours } from '../types/kapsul';

const TWO_DAYS_SEC = 2 * 24 * 60 * 60;
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Geçersiz hex anahtarı');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function sanitizeUsername(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ._-]/g, '');
  return cleaned.slice(0, 24);
}

export function formatHandle(username: string, pubkey: string): string {
  return `${username}#${pubkey.slice(0, 4)}`;
}

export function createLocalIdentity(rawUsername: string): LocalIdentity {
  const username = sanitizeUsername(rawUsername);
  if (username.length < 2) {
    throw new Error('Kullanıcı adı en az 2 karakter olmalıdır.');
  }
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return {
    username,
    handle: formatHandle(username, pubkey),
    pubkey,
    secretKeyHex: bytesToHex(sk),
    npub: nip19.npubEncode(pubkey),
    createdAt: Date.now(),
  };
}

export function restoreIdentityFromNsec(rawUsername: string, nsecOrHex: string): LocalIdentity {
  const username = sanitizeUsername(rawUsername);
  if (username.length < 2) {
    throw new Error('Kullanıcı adı en az 2 karakter olmalıdır.');
  }
  const trimmed = nsecOrHex.trim();
  let sk: Uint8Array;
  if (trimmed.startsWith('nsec1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') {
      throw new Error('Geçersiz nsec anahtarı.');
    }
    sk = decoded.data;
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    sk = hexToBytes(trimmed);
  } else {
    throw new Error('Geçerli bir nsec1 veya 64 karakterlik gizli anahtar girin.');
  }

  const pubkey = getPublicKey(sk);
  return {
    username,
    handle: formatHandle(username, pubkey),
    pubkey,
    secretKeyHex: bytesToHex(sk),
    npub: nip19.npubEncode(pubkey),
    createdAt: Date.now(),
  };
}

export function exportNsec(identity: LocalIdentity): string {
  return nip19.nsecEncode(hexToBytes(identity.secretKeyHex));
}

export function createInviteToken(identity: LocalIdentity): string {
  const payload = JSON.stringify({
    u: identity.username,
    p: identity.pubkey,
  });
  const encoded = bytesToBase64(utf8Encoder.encode(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `kapsul:${encoded}`;
}

export function createInviteUrl(identity: LocalIdentity): string {
  const token = createInviteToken(identity);
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#kapsul=${encodeURIComponent(token.replace(/^kapsul:/, ''))}`;
}

export function parsePeerInput(rawInput: string): { pubkey: string; username?: string; handle?: string; npub: string } | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Handle full URL with #kapsul=...
  const hashIdx = trimmed.indexOf('#kapsul=');
  let token = trimmed;
  if (hashIdx !== -1) {
    token = `kapsul:${decodeURIComponent(trimmed.slice(hashIdx + 8).split('&')[0])}`;
  }

  if (token.startsWith('kapsul:')) {
    try {
      const b64url = token.slice(7);
      const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const parsed = JSON.parse(utf8Decoder.decode(base64ToBytes(padded))) as { u?: unknown; p?: unknown };
      if (typeof parsed.p === 'string' && /^[0-9a-f]{64}$/i.test(parsed.p)) {
        const pubkey = parsed.p.toLowerCase();
        const username = typeof parsed.u === 'string' ? sanitizeUsername(parsed.u) || 'anonim' : 'anonim';
        return {
          pubkey,
          username,
          handle: formatHandle(username, pubkey),
          npub: nip19.npubEncode(pubkey),
        };
      }
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub') {
        const pubkey = decoded.data.toLowerCase();
        return {
          pubkey,
          npub: nip19.npubEncode(pubkey),
        };
      }
    } catch {
      return null;
    }
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const pubkey = trimmed.toLowerCase();
    return {
      pubkey,
      npub: nip19.npubEncode(pubkey),
    };
  }

  return null;
}

export async function computeSafetyNumber(pubkeyA: string, pubkeyB: string): Promise<string> {
  const pair = [pubkeyA.toLowerCase(), pubkeyB.toLowerCase()].sort().join(':');
  const digest = await crypto.subtle.digest('SHA-256', utf8Encoder.encode(pair));
  const bytes = new Uint8Array(digest);
  const groups: string[] = [];
  for (let i = 0; i < 12; i += 2) {
    const val = ((bytes[i] << 8) | bytes[i + 1]) % 10000;
    groups.push(val.toString().padStart(4, '0'));
  }
  return groups.join(' ');
}

async function deriveSharedAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    utf8Encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 200_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptAesLayer(plaintext: string, passphrase: string): Promise<{
  salt: string;
  iv: string;
  ciphertext: string;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveSharedAesKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    utf8Encoder.encode(plaintext)
  );
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptAesLayer(
  payload: { salt: string; iv: string; ciphertext: string },
  passphrase: string
): Promise<string> {
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.ciphertext);
  const key = await deriveSharedAesKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    data as BufferSource
  );
  return utf8Decoder.decode(decrypted);
}

function randomPaddingString(targetBytes: number, currentLen: number): string {
  const needed = Math.max(16, targetBytes - currentLen);
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(needed * 0.75)));
  return bytesToBase64(bytes).slice(0, needed);
}

function randomizedPastTimestamp(): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const jitter = Math.floor(Math.random() * TWO_DAYS_SEC);
  return nowSec - jitter;
}

/**
 * Wraps a message using NIP-59 / NIP-17 triple-layer privacy:
 * 1. Optional inner AES-256-GCM layer (when shared chat passphrase is set)
 * 2. Fixed-size block padding (masks message length from traffic observers)
 * 3. NIP-44 Seal (Kind 13) signed by real sender, encrypted to recipient (no p-tags, jittered timestamp)
 * 4. NIP-44 Gift Wrap (Kind 1059) signed by a disposable one-time random keypair + NIP-40 expiration
 */
export async function createEphemeralGiftWrap(params: {
  senderIdentity: LocalIdentity;
  recipientPubkey: string;
  kind: 'msg' | 'ttl_sync' | 'burn_chat';
  text: string;
  ttlHours: TTLHours;
  blockPaddingBytes: 1024 | 2048;
  sharedSecret?: string;
}): Promise<{
  giftWrap: Event;
  rumorId: string;
  sentAt: number;
  expiresAt: number;
}> {
  const sentAt = Date.now();
  const expiresAt = sentAt + params.ttlHours * 3600_000;
  const rumorId = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));

  let payload: DecryptedEnvelopePayload = {
    v: 1,
    kind: params.kind,
    id: rumorId,
    text: params.text,
    ttlHours: params.ttlHours,
    sentAt,
    expiresAt,
    senderHandle: params.senderIdentity.handle,
    pad: '',
  };

  if (params.sharedSecret && params.sharedSecret.trim().length > 0 && params.kind === 'msg') {
    const aes = await encryptAesLayer(params.text, params.sharedSecret.trim());
    payload = {
      ...payload,
      text: '',
      aesSalt: aes.salt,
      aesIv: aes.iv,
      aesCiphertext: aes.ciphertext,
    };
  }

  const baseLength = utf8Encoder.encode(JSON.stringify(payload)).length;
  payload.pad = randomPaddingString(params.blockPaddingBytes, baseLength);

  const senderSk = hexToBytes(params.senderIdentity.secretKeyHex);
  const rumor = {
    id: rumorId,
    kind: PrivateDirectMessage,
    pubkey: params.senderIdentity.pubkey,
    created_at: Math.floor(sentAt / 1000),
    tags: [['p', params.recipientPubkey]],
    content: JSON.stringify(payload),
  };

  // Seal (Kind 13) — hides sender inside recipient-encrypted envelope
  const sealConvKey = nip44.v2.utils.getConversationKey(senderSk, params.recipientPubkey);
  const sealContent = nip44.v2.encrypt(JSON.stringify(rumor), sealConvKey);
  const seal = finalizeEvent(
    {
      kind: Seal,
      created_at: randomizedPastTimestamp(),
      tags: [],
      content: sealContent,
    },
    senderSk
  );

  // Gift Wrap (Kind 1059) — signed with ephemeral one-time random key
  const ephemeralSk = generateSecretKey();
  const wrapConvKey = nip44.v2.utils.getConversationKey(ephemeralSk, params.recipientPubkey);
  const wrapContent = nip44.v2.encrypt(JSON.stringify(seal), wrapConvKey);
  const expirationSec = Math.ceil(expiresAt / 1000);

  const giftWrap = finalizeEvent(
    {
      kind: GiftWrap,
      created_at: randomizedPastTimestamp(),
      tags: [
        ['p', params.recipientPubkey],
        ['expiration', String(expirationSec)],
      ],
      content: wrapContent,
    },
    ephemeralSk
  );

  return { giftWrap, rumorId, sentAt, expiresAt };
}

export async function unwrapEphemeralGiftWrap(
  wrapEvent: Event,
  recipientSecretKeyHex: string,
  getSharedSecret?: (senderPubkey: string) => string | undefined
): Promise<{
  senderPubkey: string;
  payload: DecryptedEnvelopePayload;
  doubleEncrypted: boolean;
  needsSharedSecret?: boolean;
} | null> {
  try {
    if (wrapEvent.kind !== GiftWrap) return null;
    if (!verifyEvent(wrapEvent)) return null;

    const recipientSk = hexToBytes(recipientSecretKeyHex);
    const wrapConvKey = nip44.v2.utils.getConversationKey(recipientSk, wrapEvent.pubkey);
    const sealRaw = nip44.v2.decrypt(wrapEvent.content, wrapConvKey);
    const seal = JSON.parse(sealRaw) as Event;

    if (!seal || seal.kind !== Seal || !verifyEvent(seal)) return null;

    const sealConvKey = nip44.v2.utils.getConversationKey(recipientSk, seal.pubkey);
    const rumorRaw = nip44.v2.decrypt(seal.content, sealConvKey);
    const rumor = JSON.parse(rumorRaw) as {
      id?: string;
      pubkey?: string;
      content?: string;
      kind?: number;
    };

    if (!rumor || rumor.pubkey !== seal.pubkey || typeof rumor.content !== 'string') {
      return null;
    }

    const parsed = JSON.parse(rumor.content) as Partial<DecryptedEnvelopePayload>;
    if (
      parsed.v !== 1 ||
      (parsed.kind !== 'msg' && parsed.kind !== 'ttl_sync' && parsed.kind !== 'burn_chat') ||
      typeof parsed.id !== 'string' ||
      typeof parsed.sentAt !== 'number' ||
      typeof parsed.expiresAt !== 'number' ||
      (parsed.ttlHours !== 24 && parsed.ttlHours !== 12 && parsed.ttlHours !== 7 && parsed.ttlHours !== 1)
    ) {
      return null;
    }

    // Discard already-expired envelopes immediately before persisting
    if (parsed.expiresAt <= Date.now()) {
      return null;
    }

    let text = typeof parsed.text === 'string' ? parsed.text : '';
    let doubleEncrypted = false;
    let needsSharedSecret = false;

    if (parsed.aesCiphertext && parsed.aesIv && parsed.aesSalt) {
      doubleEncrypted = true;
      const secret = getSharedSecret?.(seal.pubkey);
      if (!secret) {
        needsSharedSecret = true;
        text = '🔒 Bu mesaj ek ortak parola ile şifrelenmiş. Sohbet ayarlarından parolayı girin.';
      } else {
        try {
          text = await decryptAesLayer(
            {
              salt: parsed.aesSalt,
              iv: parsed.aesIv,
              ciphertext: parsed.aesCiphertext,
            },
            secret
          );
        } catch {
          needsSharedSecret = true;
          text = '🔒 Ek ortak parola eşleşmediği için mesaj çözülemedi.';
        }
      }
    }

    return {
      senderPubkey: seal.pubkey,
      doubleEncrypted,
      needsSharedSecret,
      payload: {
        v: 1,
        kind: parsed.kind,
        id: parsed.id,
        text,
        ttlHours: parsed.ttlHours,
        sentAt: parsed.sentAt,
        expiresAt: parsed.expiresAt,
        senderHandle: typeof parsed.senderHandle === 'string' ? parsed.senderHandle : `anonim#${seal.pubkey.slice(0, 4)}`,
        pad: '',
      },
    };
  } catch {
    return null;
  }
}
