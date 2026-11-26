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

export default function App() {
  const [screen, setScreen] = useState<AppScreen>('booting');
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [contacts, setContacts] = useState<Record<string, PeerContact>>({});
  const [threads, setThreads] = useState<Record<string, ChatThread>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [settings, setSettings] = useState<PrivacySettings>(DEFAULT_SETTINGS);
  const [activePeerPubkey, setActivePeerPubkey] = useState<string | null>(null);
  const [relayHealth, setRelayHealth] = useState<RelayHealth[]>([]);
  const [privacyBlurred, setPrivacyBlurred] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [pendingInvite, setPendingInvite] = useState<ReturnType<typeof parsePeerInput>>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [safetyPeer, setSafetyPeer] = useState<PeerContact | null>(null);
  const [burnTarget, setBurnTarget] = useState<{ mode: 'all' } | { mode: 'chat'; peer: PeerContact } | null>(null);

  const relayRef = useRef<RelayNetwork | null>(null);
  const identityRef = useRef<LocalIdentity | null>(null);
  const contactsRef = useRef<Record<string, PeerContact>>({});
  const threadsRef = useRef<Record<string, ChatThread>>({});
  const messagesRef = useRef<ChatMessage[]>([]);
  const activePeerRef = useRef<string | null>(null);
  const settingsRef = useRef<PrivacySettings>(DEFAULT_SETTINGS);
  const lastActivityRef = useRef<number>(Date.now());

  identityRef.current = identity;
  contactsRef.current = contacts;
  threadsRef.current = threads;
  messagesRef.current = messages;
  activePeerRef.current = activePeerPubkey;
  settingsRef.current = settings;

  const hydrateFromVault = useCallback(async (hasPin: boolean) => {
    const [savedIdentity, savedContacts, savedThreads, savedMessages, savedSettings] =
      await Promise.all([
        loadEncryptedItem<LocalIdentity>('identity'),
        loadEncryptedItem<Record<string, PeerContact>>('contacts'),
        loadEncryptedItem<Record<string, ChatThread>>('threads'),
        loadEncryptedItem<ChatMessage[]>('messages'),
        loadEncryptedItem<PrivacySettings>('settings'),
      ]);

    if (!savedIdentity) {
      setScreen('onboarding');
      return;
    }

    const now = Date.now();
    const validMessages = (savedMessages ?? []).filter((m) => m.expiresAt > now);
    if (savedMessages && validMessages.length !== savedMessages.length) {
      await saveEncryptedItem('messages', validMessages);
    }

    setIdentity(savedIdentity);
    setContacts(savedContacts ?? {});
    setThreads(savedThreads ?? {});
    setMessages(validMessages);
    setSettings({
      ...DEFAULT_SETTINGS,
      ...(savedSettings ?? {}),
      hasPin,
    });
    lastActivityRef.current = Date.now();
    setScreen('ready');
  }, []);

  // Capture #kapsul=... invite hash on initial load & inspect vault state
  useEffect(() => {
    if (window.location.hash.includes('kapsul=')) {
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

      // If added via npub without profile info, opportunistically fetch their Kind-0 profile
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

  // Handle incoming Gift Wrap events (both from peers and self-copies from our other devices)
  const handleIncomingGiftWrap = useCallback(async (ev: Event) => {
    const currentId = identityRef.current;
    if (!currentId) return;

    const result = await unwrapEphemeralGiftWrap(ev, currentId.secretKeyHex, (peerKey) => {
      return contactsRef.current[peerKey]?.sharedSecret;
    });
    if (!result) return;

    const { senderPubkey, payload, doubleEncrypted } = result;
    const isSelfSync = senderPubkey === currentId.pubkey;

    // Determine which conversation peer this envelope belongs to
    const chatPeerPubkey = isSelfSync ? payload.targetPeerPubkey : senderPubkey;
    if (!chatPeerPubkey || chatPeerPubkey === currentId.pubkey) return;

    // Deduplicate by inner rumor id (except delete/burn control if already processed)
    if (messagesRef.current.some((m) => m.id === payload.id)) return;

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
            addedAt: Date.now(),
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
            addedAt: Date.now(),
            lastSeenAt: Date.now(),
          };
    }

    const nextContacts = { ...contactsRef.current, [chatPeerPubkey]: nextContact };
    contactsRef.current = nextContacts;
    setContacts(nextContacts);
    await saveEncryptedItem('contacts', nextContacts);

    // Opportunistically enrich peer profile on 2nd device if avatar/name is missing
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

    if (payload.kind === 'delete_msg') {
      if (!payload.targetMsgId) return;
      const filtered = messagesRef.current.filter(
        (m) => !(m.peerPubkey === chatPeerPubkey && m.id === payload.targetMsgId)
      );
      messagesRef.current = filtered;
      setMessages(filtered);
      await saveEncryptedItem('messages', filtered);
      return;
    }

    if (payload.kind === 'burn_chat') {
      const remaining = messagesRef.current.filter((m) => m.peerPubkey !== chatPeerPubkey);
      const notice: ChatMessage = {
        id: payload.id,
        peerPubkey: chatPeerPubkey,
        direction: 'system',
        text: isSelfSync
          ? 'Sohbet geçmişi diğer cihazınızdan yakıldı'
          : `${nextContact.handle} sohbet geçmişini sildi`,
        createdAt: payload.sentAt,
        expiresAt: payload.expiresAt,
        ttlHours: payload.ttlHours,
      };
      const nextMsgs = [...remaining, notice];
      messagesRef.current = nextMsgs;
      setMessages(nextMsgs);
      await saveEncryptedItem('messages', nextMsgs);

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
      return;
    }

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
    setShowNetworkModal(false);
    setShowInviteModal(false);
    setShowLogoutModal(false);
    setSafetyPeer(null);
    setScreen('locked');
  }, []);

  // 1-second ephemeral TTL sweeper & inactivity auto-lock
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
    setIdentity(id);
    setContacts({});
    setThreads({});
    setMessages([]);
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
    setIdentity(id);
    setContacts({});
    setThreads({});
    setMessages([]);
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
    setIdentity(null);
    setContacts({});
    setThreads({});
    setMessages([]);
    setActivePeerPubkey(null);
    setSettings(DEFAULT_SETTINGS);
    setShowLogoutModal(false);
    setScreen('onboarding');
  };

  const handleSelectPeer = async (pubkey: string | null) => {
    setActivePeerPubkey(pubkey);
    if (pubkey && threads[pubkey]?.unreadCount) {
      const nextThreads = {
        ...threads,
        [pubkey]: { ...threads[pubkey], unreadCount: 0 },
      };
      setThreads(nextThreads);
      await saveEncryptedItem('threads', nextThreads);
    }
  };

  const handleSearchUsers = async (query: string): Promise<DiscoveredUser[]> => {
    if (!relayRef.current) return [];
    return relayRef.current.searchUsersByUsername(query);
  };

  const handleSendMessage = async (
    peerPubkey: string,
    text: string,
    options?: {
      replyTo?: { id: string; preview: string };
      burnAfterSec?: number;
    }
  ) => {
    if (!identity || !relayRef.current) return;
    const peer = contacts[peerPubkey];
    const thread = threads[peerPubkey];
    const ttlHours: TTLHours = thread?.ttlHours ?? DEFAULT_TTL_HOURS;

    const { giftWrap, selfWrap, rumorId, sentAt, expiresAt } = await createEphemeralGiftWrap({
      senderIdentity: identity,
      recipientPubkey: peerPubkey,
      recipientHandle: peer?.handle,
      kind: 'msg',
      text,
      ttlHours,
      burnAfterSec: options?.burnAfterSec,
      blockPaddingBytes: settings.blockPaddingBytes,
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
      relayRef.current.publishGiftWrap(giftWrap),
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

  const handleDeleteMessage = async (msg: ChatMessage, scope: 'local' | 'both') => {
    const remaining = messagesRef.current.filter((m) => m.id !== msg.id);
    messagesRef.current = remaining;
    setMessages(remaining);
    await saveEncryptedItem('messages', remaining);

    if (scope === 'both' && identity && relayRef.current) {
      const peer = contacts[msg.peerPubkey];
      const ttl = threads[msg.peerPubkey]?.ttlHours ?? DEFAULT_TTL_HOURS;
      const { giftWrap, selfWrap } = await createEphemeralGiftWrap({
        senderIdentity: identity,
        recipientPubkey: msg.peerPubkey,
        recipientHandle: peer?.handle,
        kind: 'delete_msg',
        text: '',
        ttlHours: ttl,
        blockPaddingBytes: settings.blockPaddingBytes,
        targetMsgId: msg.id,
        includeSelfCopy: true,
      });
      await Promise.allSettled([
        relayRef.current.publishGiftWrap(giftWrap),
        selfWrap ? relayRef.current.publishGiftWrap(selfWrap) : Promise.resolve(0),
      ]);
    }
  };

  const handleChangeChatTTL = async (peerPubkey: string, ttl: TTLHours) => {
    if (!identity || !relayRef.current) return;
    const prev = threads[peerPubkey];
    if (prev?.ttlHours === ttl) return;

    const nextThreads = {
      ...threads,
      [peerPubkey]: {
        peerPubkey,
        ttlHours: ttl,
        unreadCount: 0,
        updatedAt: Date.now(),
      },
    };
    setThreads(nextThreads);
    await saveEncryptedItem('threads', nextThreads);

    const peer = contacts[peerPubkey];
    const { giftWrap, selfWrap, rumorId, sentAt, expiresAt } = await createEphemeralGiftWrap({
      senderIdentity: identity,
      recipientPubkey: peerPubkey,
      recipientHandle: peer?.handle,
      kind: 'ttl_sync',
      text: `Otomatik silme süresi ${ttl} saat olarak ayarlandı.`,
      ttlHours: ttl,
      blockPaddingBytes: settings.blockPaddingBytes,
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
      relayRef.current.publishGiftWrap(giftWrap),
      selfWrap ? relayRef.current.publishGiftWrap(selfWrap) : Promise.resolve(0),
    ]);
  };

  const handleSavePeerSecurity = async (
    pubkey: string,
    updates: { verifiedFingerprint?: boolean; sharedSecret?: string }
  ) => {
    const existing = contacts[pubkey];
    if (!existing) return;
    const updated: PeerContact = {
      ...existing,
      verifiedFingerprint: updates.verifiedFingerprint,
      sharedSecret: updates.sharedSecret,
    };
    const nextContacts = { ...contacts, [pubkey]: updated };
    setContacts(nextContacts);
    await saveEncryptedItem('contacts', nextContacts);
  };

  const handleUpdateSettings = async (patch: Partial<PrivacySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveEncryptedItem('settings', next);
  };

  const handleUpdateAvatar = async (avatarDataUrl: string | undefined) => {
    if (!identity) return;
    const updated: LocalIdentity = {
      ...identity,
      avatarDataUrl: isSafeAvatarDataUrl(avatarDataUrl) ? avatarDataUrl : undefined,
    };
    setIdentity(updated);
    await saveEncryptedItem('identity', updated);
    if (relayRef.current) {
      await relayRef.current.publishIdentityAnnouncement(updated).catch(() => {});
    }
  };

  const handleSetOrChangePin = async (newPin: string | null) => {
    const nextSettings: PrivacySettings = {
      ...settings,
      hasPin: Boolean(newPin),
      autoLockMinutes: newPin ? settings.autoLockMinutes : 0,
    };
    await rekeyVaultWithPin(newPin, {
      identity,
      contacts,
      threads,
      messages,
      settings: nextSettings,
    });
    setSettings(nextSettings);
  };

  const handleConfirmBurn = async () => {
    if (!burnTarget) return;
    if (burnTarget.mode === 'all') {
      relayRef.current?.destroy();
      relayRef.current = null;
      await wipeEntireVault();
      setIdentity(null);
      setContacts({});
      setThreads({});
      setMessages([]);
      setActivePeerPubkey(null);
      setSettings(DEFAULT_SETTINGS);
      setBurnTarget(null);
      setScreen('onboarding');
      return;
    }

    const peerPubkey = burnTarget.peer.pubkey;
    const ttl = threads[peerPubkey]?.ttlHours ?? DEFAULT_TTL_HOURS;
    if (identity && relayRef.current) {
      const { giftWrap, selfWrap } = await createEphemeralGiftWrap({
        senderIdentity: identity,
        recipientPubkey: peerPubkey,
        recipientHandle: burnTarget.peer.handle,
        kind: 'burn_chat',
        text: 'burn',
        ttlHours: ttl,
        blockPaddingBytes: settings.blockPaddingBytes,
        includeSelfCopy: true,
      });
      await Promise.allSettled([
        relayRef.current.publishGiftWrap(giftWrap),
        selfWrap ? relayRef.current.publishGiftWrap(selfWrap) : Promise.resolve(0),
      ]);
    }

    const remainingMsgs = messages.filter((m) => m.peerPubkey !== peerPubkey);
    messagesRef.current = remainingMsgs;
    setMessages(remainingMsgs);
    await saveEncryptedItem('messages', remainingMsgs);
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
            mode="all"
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
        privacyBlurred={privacyBlurred}
        nowMs={nowMs}
        onTogglePrivacyBlur={() => setPrivacyBlurred((prev) => !prev)}
        onSelectPeer={handleSelectPeer}
        onSearchUsers={handleSearchUsers}
        onAddPeer={handleAddOrSelectPeer}
        onSendMessage={handleSendMessage}
        onDeleteMessage={handleDeleteMessage}
        onChangeChatTTL={handleChangeChatTTL}
        onOpenInvite={() => setShowInviteModal(true)}
        onOpenNetwork={() => setShowNetworkModal(true)}
        onOpenSafety={(peer) => setSafetyPeer(peer)}
        onLockVault={handleLockVault}
        onRequestLogout={() => setShowLogoutModal(true)}
        onRequestBurnChat={(peer) => setBurnTarget({ mode: 'chat', peer })}
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
          onClose={() => setShowNetworkModal(false)}
        />
      )}

      {showLogoutModal && (
        <LogoutModal
          identity={identity}
          onConfirmLogout={handleLogout}
          onCancel={() => setShowLogoutModal(false)}
        />
      )}

      {burnTarget && (
        <BurnModal
          mode={burnTarget.mode}
          peerHandle={burnTarget.mode === 'chat' ? burnTarget.peer.handle : undefined}
          onConfirm={handleConfirmBurn}
          onCancel={() => setBurnTarget(null)}
        />
      )}
    </>
  );
}
