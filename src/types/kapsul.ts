export type TTLHours = 24 | 12 | 7 | 1;

export const TTL_OPTIONS: TTLHours[] = [24, 12, 7, 1];

export const DEFAULT_TTL_HOURS: TTLHours = 24;

export interface LocalIdentity {
  username: string;
  handle: string; // e.g. "demir#7c3a"
  pubkey: string; // 64-char hex secp256k1 pubkey
  secretKeyHex: string; // 64-char hex secp256k1 privkey (stored encrypted in IndexedDB)
  npub: string;
  createdAt: number;
}

export interface PeerContact {
  pubkey: string;
  username: string;
  handle: string;
  npub: string;
  verifiedFingerprint?: boolean;
  sharedSecret?: string; // Optional second-layer AES-256-GCM passphrase per chat
  addedAt: number;
  lastSeenAt?: number;
}

export type MessageDirection = 'outgoing' | 'incoming' | 'system';

export type DeliveryState = 'sending' | 'relayed' | 'failed';

export interface ChatMessage {
  id: string; // Inner rumor id (unique, used for deduplication)
  peerPubkey: string;
  direction: MessageDirection;
  text: string;
  createdAt: number; // ms timestamp
  expiresAt: number; // ms timestamp
  ttlHours: TTLHours;
  delivery?: DeliveryState;
  relayCount?: number;
  doubleEncrypted?: boolean;
}

export interface ChatThread {
  peerPubkey: string;
  ttlHours: TTLHours;
  unreadCount: number;
  updatedAt: number;
}

export interface PrivacySettings {
  autoBlurOnBackground: boolean;
  blockPaddingBytes: 1024 | 2048;
  relays: string[];
  hasPin: boolean;
}

export interface RelayHealth {
  url: string;
  status: 'connecting' | 'connected' | 'error';
  lastError?: string;
}

export interface DiscoveredUser {
  pubkey: string;
  username: string;
  handle: string;
  npub: string;
  publishedAt: number;
}

export interface DecryptedEnvelopePayload {
  v: 1;
  kind: 'msg' | 'ttl_sync' | 'burn_chat';
  id: string;
  text: string;
  ttlHours: TTLHours;
  sentAt: number;
  expiresAt: number;
  senderHandle: string;
  aesSalt?: string;
  aesIv?: string;
  aesCiphertext?: string;
  pad: string;
}
