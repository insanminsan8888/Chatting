import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip44 from 'nostr-tools/nip44';
import { GiftWrap, PrivateDirectMessage, Seal } from 'nostr-tools/kinds';
import type { DecryptedEnvelopePayload, EnvelopeKind, LocalIdentity, TTLHours } from '../types/kapsul';

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
      throw new Error('Geçersiz gizli anahtar.');
    }
    sk = decoded.data;
  } else if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    sk = hexToBytes(trimmed);
  } else {
    throw new Error('Geçerli bir nsec1 gizli anahtarı girin.');
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
  return `golge:${encoded}`;
}

export function createInviteUrl(identity: LocalIdentity): string {
  const token = createInviteToken(identity);
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#golge=${encodeURIComponent(token.replace(/^golge:/, ''))}`;
}

export function parsePeerInput(
  rawInput: string
): { pubkey: string; username?: string; handle?: string; npub: string } | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  try {
    let token = trimmed;
    const golgeIdx = trimmed.indexOf('#golge=');
    const kapsulIdx = trimmed.indexOf('#kapsul=');
    if (golgeIdx !== -1) {
      token = `golge:${decodeURIComponent(trimmed.slice(golgeIdx + 7).split('&')[0])}`;
    } else if (kapsulIdx !== -1) {
      token = `kapsul:${decodeURIComponent(trimmed.slice(kapsulIdx + 8).split('&')[0])}`;
    }

    if (token.startsWith('golge:') || token.startsWith('kapsul:')) {
      const b64url = token.startsWith('golge:') ? token.slice(6) : token.slice(7);
      const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const parsed = JSON.parse(utf8Decoder.decode(base64ToBytes(padded))) as {
        u?: unknown;
        p?: unknown;
      };
      if (typeof parsed.p === 'string' && /^[0-9a-f]{64}$/i.test(parsed.p)) {
        const pubkey = parsed.p.toLowerCase();
        const username =
          typeof parsed.u === 'string' ? sanitizeUsername(parsed.u) || 'anonim' : 'anonim';
        return {
          pubkey,
          username,
          handle: formatHandle(username, pubkey),
          npub: nip19.npubEncode(pubkey),
        };
      }
      return null;
    }

    if (trimmed.startsWith('npub1')) {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub') {
        const pubkey = decoded.data.toLowerCase();
        return {
          pubkey,
          npub: nip19.npubEncode(pubkey),
        };
      }
      return null;
    }

    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const pubkey = trimmed.toLowerCase();
      return {
        pubkey,
        npub: nip19.npubEncode(pubkey),
      };
    }
  } catch {
    return null;
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

export async function encryptAesLayer(
  plaintext: string,
  passphrase: string
): Promise<{
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

const SAFE_AVATAR_REGEX = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;

export function isSafeAvatarDataUrl(url?: unknown): url is string {
  return typeof url === 'string' && url.length <= 24_000 && SAFE_AVATAR_REGEX.test(url);
}

/**
 * Compresses a user-selected image to an 80x80 square on an HTML5 Canvas.
 * Re-encoding pixels strips all EXIF, GPS location, and camera metadata.
 * Stored strictly as an inline data URL so zero external HTTP requests (no IP leak) ever occur.
 */
export async function compressAvatarToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Lütfen geçerli bir görsel dosyası seçin.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Görsel boyutu 10 MB sınırını aşmamalıdır.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Görsel okunamadı.'));
      el.src = objectUrl;
    });

    const size = 80;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Tarayıcı görsel işleyicisi başlatılamadı.');

    const minSide = Math.min(img.width, img.height);
    const sx = Math.floor((img.width - minSide) / 2);
    const sy = Math.floor((img.height - minSide) / 2);
    ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);

    let dataUrl = canvas.toDataURL('image/webp', 0.72);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    }
    if (dataUrl.length > 16_000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.5);
    }
    if (!isSafeAvatarDataUrl(dataUrl)) {
      throw new Error('Görsel küçültülemedi, daha küçük bir fotoğraf seçin.');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function stripUnsafeChars(input: string): string {
  // Remove ASCII control chars (except \n and \t) and Unicode bidirectional override chars
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '');
}

const VALID_KINDS = new Set<EnvelopeKind>([
  'msg',
  'ttl_sync',
  'burn_chat',
  'delete_msg',
  'typing',
  'react',
  'remove_peer',
]);

const ALLOWED_REACTIONS = new Set(['👍', '❤️', '😂', '🔥', '😮', '😢']);

/**
 * Wraps a message or control envelope using NIP-59 / NIP-17 triple-layer privacy
 * and optionally produces an encrypted self-copy for multi-device synchronization.
 */
export async function createEphemeralGiftWrap(params: {
  senderIdentity: LocalIdentity;
  recipientPubkey: string;
  recipientHandle?: string;
  kind: EnvelopeKind;
  text: string;
  ttlHours: TTLHours;
  burnAfterSec?: number;
  blockPaddingBytes: 1024 | 2048;
  sharedSecret?: string;
  targetMsgId?: string;
  reaction?: string;
  replyTo?: { id: string; preview: string };
  includeSelfCopy?: boolean;
  selfOnly?: boolean;
}): Promise<{
  giftWrap?: Event;
  selfWrap?: Event;
  rumorId: string;
  sentAt: number;
  expiresAt: number;
}> {
  const sentAt = Date.now();
  const expiresAt =
    params.kind === 'typing'
      ? sentAt + 20_000
      : params.burnAfterSec
      ? sentAt + params.burnAfterSec * 1000
      : sentAt + params.ttlHours * 3600_000;

  const rumorId = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const attachAvatar =
    (params.kind === 'msg' || params.kind === 'ttl_sync') &&
    isSafeAvatarDataUrl(params.senderIdentity.avatarDataUrl);

  let basePayload: DecryptedEnvelopePayload = {
    v: 1,
    kind: params.kind,
    id: rumorId,
    text: params.text.slice(0, 8000),
    ttlHours: params.ttlHours,
    burnAfterSec: params.burnAfterSec,
    sentAt,
    expiresAt,
    senderHandle: params.senderIdentity.handle.slice(0, 48),
    senderAvatar: attachAvatar ? params.senderIdentity.avatarDataUrl : undefined,
    targetMsgId: params.targetMsgId,
    reaction: params.reaction?.slice(0, 16),
    replyToId: params.replyTo?.id,
    replyToPreview: params.replyTo?.preview.slice(0, 100),
    pad: '',
  };

  if (params.sharedSecret && params.sharedSecret.trim().length > 0 && params.kind === 'msg') {
    const aes = await encryptAesLayer(params.text, params.sharedSecret.trim());
    basePayload = {
      ...basePayload,
      text: '',
      aesSalt: aes.salt,
      aesIv: aes.iv,
      aesCiphertext: aes.ciphertext,
    };
  }

  const senderSk = hexToBytes(params.senderIdentity.secretKeyHex);
  const expirationSec = Math.ceil(expiresAt / 1000);

  const buildWrapFor = (targetPubkey: string, payloadObj: DecryptedEnvelopePayload): Event => {
    const sizedObj = { ...payloadObj, pad: '' };
    const baseLen = utf8Encoder.encode(JSON.stringify(sizedObj)).length;
    sizedObj.pad = randomPaddingString(params.blockPaddingBytes, baseLen);

    const rumor = {
      id: rumorId,
      kind: PrivateDirectMessage,
      pubkey: params.senderIdentity.pubkey,
      created_at: Math.floor(sentAt / 1000),
      tags: [['p', params.recipientPubkey]],
      content: JSON.stringify(sizedObj),
    };

    const sealConvKey = nip44.v2.utils.getConversationKey(senderSk, targetPubkey);
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

    const ephemeralSk = generateSecretKey();
    const wrapConvKey = nip44.v2.utils.getConversationKey(ephemeralSk, targetPubkey);
    const wrapContent = nip44.v2.encrypt(JSON.stringify(seal), wrapConvKey);

    return finalizeEvent(
      {
        kind: GiftWrap,
        created_at: randomizedPastTimestamp(),
        tags: [
          ['p', targetPubkey],
          ['expiration', String(expirationSec)],
        ],
        content: wrapContent,
      },
      ephemeralSk
    );
  };

  const giftWrap = params.selfOnly ? undefined : buildWrapFor(params.recipientPubkey, basePayload);

  let selfWrap: Event | undefined;
  if (params.selfOnly || params.includeSelfCopy !== false) {
    selfWrap = buildWrapFor(params.senderIdentity.pubkey, {
      ...basePayload,
      targetPeerPubkey: params.recipientPubkey,
      targetPeerHandle: params.recipientHandle?.slice(0, 48),
    });
  }

  return { giftWrap, selfWrap, rumorId, sentAt, expiresAt };
}

export async function unwrapEphemeralGiftWrap(
  wrapEvent: Event,
  recipientSecretKeyHex: string,
  getSharedSecret?: (peerPubkey: string) => string | undefined
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
      !parsed.kind ||
      !VALID_KINDS.has(parsed.kind) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f]{16,64}$/i.test(parsed.id) ||
      typeof parsed.sentAt !== 'number' ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.sentAt) ||
      !Number.isFinite(parsed.expiresAt) ||
      (parsed.ttlHours !== 24 &&
        parsed.ttlHours !== 12 &&
        parsed.ttlHours !== 7 &&
        parsed.ttlHours !== 1)
    ) {
      return null;
    }

    // Clamp max lifetime to 24h + 60s clock slack to prevent malicious permanent retention
    const clampedExpiresAt = Math.min(
      parsed.expiresAt,
      parsed.sentAt + 24 * 3600_000 + 60_000
    );

    if (clampedExpiresAt <= Date.now()) {
      return null;
    }

    const targetPeerPubkey =
      typeof parsed.targetPeerPubkey === 'string' && /^[0-9a-f]{64}$/i.test(parsed.targetPeerPubkey)
        ? parsed.targetPeerPubkey.toLowerCase()
        : undefined;

    let text = typeof parsed.text === 'string' ? parsed.text.slice(0, 8000) : '';
    let doubleEncrypted = false;
    let needsSharedSecret = false;

    if (parsed.aesCiphertext && parsed.aesIv && parsed.aesSalt && parsed.kind === 'msg') {
      doubleEncrypted = true;
      const secretOwnerKey = targetPeerPubkey ?? seal.pubkey;
      const secret = getSharedSecret?.(secretOwnerKey);
      if (!secret) {
        needsSharedSecret = true;
        text = '🔒 Bu mesaj ek ortak parola ile şifrelenmiş. Doğrula bölümünden parolayı girin.';
      } else {
        try {
          text = (
            await decryptAesLayer(
              {
                salt: parsed.aesSalt,
                iv: parsed.aesIv,
                ciphertext: parsed.aesCiphertext,
              },
              secret
            )
          ).slice(0, 8000);
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
        text: stripUnsafeChars(text),
        ttlHours: parsed.ttlHours,
        burnAfterSec:
          typeof parsed.burnAfterSec === 'number' &&
          parsed.burnAfterSec > 0 &&
          parsed.burnAfterSec <= 300
            ? parsed.burnAfterSec
            : undefined,
        sentAt: parsed.sentAt,
        expiresAt: clampedExpiresAt,
        senderHandle:
          typeof parsed.senderHandle === 'string'
            ? stripUnsafeChars(parsed.senderHandle).slice(0, 48)
            : `anonim#${seal.pubkey.slice(0, 4)}`,
        senderAvatar: isSafeAvatarDataUrl(parsed.senderAvatar) ? parsed.senderAvatar : undefined,
        targetPeerPubkey,
        targetPeerHandle:
          typeof parsed.targetPeerHandle === 'string'
            ? stripUnsafeChars(parsed.targetPeerHandle).slice(0, 48)
            : undefined,
        targetMsgId:
          typeof parsed.targetMsgId === 'string' && /^[0-9a-f]{16,64}$/i.test(parsed.targetMsgId)
            ? parsed.targetMsgId
            : undefined,
        reaction:
          typeof parsed.reaction === 'string' && ALLOWED_REACTIONS.has(parsed.reaction)
            ? parsed.reaction
            : undefined,
        replyToId:
          typeof parsed.replyToId === 'string' && /^[0-9a-f]{16,64}$/i.test(parsed.replyToId)
            ? parsed.replyToId
            : undefined,
        replyToPreview:
          typeof parsed.replyToPreview === 'string'
            ? stripUnsafeChars(parsed.replyToPreview).slice(0, 120)
            : undefined,
        pad: '',
      },
    };
  } catch {
    return null;
  }
}
