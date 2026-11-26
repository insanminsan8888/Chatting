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

type AppScreen = 'booting' | 'onboarding' | 'locked' | 'ready';

const DEFAULT_SETTINGS: PrivacySettings = {
  autoBlurOnBackground: true,
  blockPaddingBytes: 1024,
  relays: DEFAULT_RELAYS,
  hasPin: false,
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
  const [safetyPeer, setSafetyPeer] = useState<PeerContact | null>(null);
  const [burnTarget, setBurnTarget] = useState<{ mode: 'all' } | { mode: 'chat'; peer: PeerContact } | null>(null);

  const relayRef = useRef<RelayNetwork | null>(null);
  const identityRef = useRef<LocalIdentity | null>(null);
  const contactsRef = useRef<Record<string, PeerContact>>({});
  const threadsRef = useRef<Record<string, ChatThread>>({});
  const messagesRef = useRef<ChatMessage[]>([]);
  const activePeerRef = useRef<string | null>(null);

  identityRef.current = identity;
  contactsRef.current = contacts;
  threadsRef.current = threads;
  messagesRef.current = messages;
  activePeerRef.current = activePeerPubkey;

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
    async (peerInput: { pubkey: string; username?: string; handle?: string; npub: string }) => {
      if (!identityRef.current || peerInput.pubkey === identityRef.current.pubkey) return;
      const existing = contactsRef.current[peerInput.pubkey];
      const username = peerInput.username ?? existing?.username ?? 'anonim';
      const handle = peerInput.handle ?? existing?.handle ?? formatHandle(username, peerInput.pubkey);

      const nextContact: PeerContact = existing ?? {
        pubkey: peerInput.pubkey,
        username,
        handle,
        npub: peerInput.npub,
        addedAt: Date.now(),
      };

      const nextContacts = { ...contactsRef.current, [peerInput.pubkey]: nextContact };
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
      setThreads(nextThreads);
      await saveEncryptedItem('threads', nextThreads);

      setActivePeerPubkey(peerInput.pubkey);
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

  // Handle incoming Gift Wrap events
  const handleIncomingGiftWrap = useCallback(async (ev: Event) => {
    const currentId = identityRef.current;
    if (!currentId) return;

    const result = await unwrapEphemeralGiftWrap(ev, currentId.secretKeyHex, (senderPubkey) => {
      return contactsRef.current[senderPubkey]?.sharedSecret;
    });
    if (!result) return;

    const { senderPubkey, payload, doubleEncrypted } = result;
    if (senderPubkey === currentId.pubkey) return;

    // Deduplicate by inner rumor id
    if (messagesRef.current.some((m) => m.id === payload.id)) return;

    // Ensure sender exists in contacts
    const existingContact = contactsRef.current[senderPubkey];
    const senderUsername = payload.senderHandle.split('#')[0] || 'anonim';
    const updatedContact: PeerContact = existingContact
      ? { ...existingContact, lastSeenAt: Date.now() }
      : {
          pubkey: senderPubkey,
          username: senderUsername,
          handle: payload.senderHandle,
          npub: senderPubkey,
          addedAt: Date.now(),
          lastSeenAt: Date.now(),
        };

    if (!existingContact) {
      // Encode proper npub via parsePeerInput helper
      const parsed = parsePeerInput(senderPubkey);
      if (parsed) updatedContact.npub = parsed.npub;
    }

    const nextContacts = { ...contactsRef.current, [senderPubkey]: updatedContact };
    contactsRef.current = nextContacts;
    setContacts(nextContacts);
    await saveEncryptedItem('contacts', nextContacts);

    const prevThread = threadsRef.current[senderPubkey];
    const isChatOpen = activePeerRef.current === senderPubkey;

    if (payload.kind === 'burn_chat') {
      const remaining = messagesRef.current.filter((m) => m.peerPubkey !== senderPubkey);
      const notice: ChatMessage = {
        id: payload.id,
        peerPubkey: senderPubkey,
        direction: 'system',
        text: `${updatedContact.handle} sohbet geçmişini sildi`,
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
        [senderPubkey]: {
          peerPubkey: senderPubkey,
          ttlHours: prevThread?.ttlHours ?? payload.ttlHours,
          unreadCount: isChatOpen ? 0 : (prevThread?.unreadCount ?? 0) + 1,
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
        [senderPubkey]: {
          peerPubkey: senderPubkey,
          ttlHours: payload.ttlHours,
          unreadCount: isChatOpen ? 0 : (prevThread?.unreadCount ?? 0) + 1,
          updatedAt: Date.now(),
        },
      };
      threadsRef.current = nextThreads;
      setThreads(nextThreads);
      await saveEncryptedItem('threads', nextThreads);

      const notice: ChatMessage = {
        id: payload.id,
        peerPubkey: senderPubkey,
        direction: 'system',
        text: `${updatedContact.handle} otomatik silme süresini ${payload.ttlHours} saat yaptı`,
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

    // Standard encrypted message
    const newMsg: ChatMessage = {
      id: payload.id,
      peerPubkey: senderPubkey,
      direction: 'incoming',
      text: payload.text,
      createdAt: payload.sentAt,
      expiresAt: payload.expiresAt,
      ttlHours: payload.ttlHours,
      doubleEncrypted,
    };

    const nextMsgs = [...messagesRef.current, newMsg];
    messagesRef.current = nextMsgs;
    setMessages(nextMsgs);
    await saveEncryptedItem('messages', nextMsgs);

    const nextThreads = {
      ...threadsRef.current,
      [senderPubkey]: {
        peerPubkey: senderPubkey,
        ttlHours: prevThread?.ttlHours ?? payload.ttlHours,
        unreadCount: isChatOpen ? 0 : (prevThread?.unreadCount ?? 0) + 1,
        updatedAt: Date.now(),
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

  // 1-second ephemeral TTL sweeper (purges both UI state and encrypted IndexedDB)
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
    }, 1000);
    return () => clearInterval(timer);
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

  const handleCreateIdentity = async (username: string, pin?: string) => {
    await initializeNewVault(pin);
    const id = createLocalIdentity(username);
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
    setScreen('ready');
  };

  const handleRestoreIdentity = async (username: string, nsecOrHex: string, pin?: string) => {
    const id = restoreIdentityFromNsec(username, nsecOrHex);
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
    setScreen('ready');
  };

  const handleUnlockPin = async (pin: string): Promise<boolean> => {
    const ok = await unlockVaultWithPin(pin);
    if (!ok) return false;
    await hydrateFromVault(true);
    return true;
  };

  const handleLockVault = () => {
    relayRef.current?.destroy();
    relayRef.current = null;
    lockVaultMemory();
    setIdentity(null);
    setMessages([]);
    setScreen('locked');
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

  const handleSendMessage = async (peerPubkey: string, text: string) => {
    if (!identity || !relayRef.current) return;
    const peer = contacts[peerPubkey];
    const thread = threads[peerPubkey];
    const ttlHours: TTLHours = thread?.ttlHours ?? DEFAULT_TTL_HOURS;

    const { giftWrap, rumorId, sentAt, expiresAt } = await createEphemeralGiftWrap({
      senderIdentity: identity,
      recipientPubkey: peerPubkey,
      kind: 'msg',
      text,
      ttlHours,
      blockPaddingBytes: settings.blockPaddingBytes,
      sharedSecret: peer?.sharedSecret,
    });

    const optimistic: ChatMessage = {
      id: rumorId,
      peerPubkey,
      direction: 'outgoing',
      text,
      createdAt: sentAt,
      expiresAt,
      ttlHours,
      delivery: 'sending',
      doubleEncrypted: Boolean(peer?.sharedSecret),
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

    const accepted = await relayRef.current.publishGiftWrap(giftWrap);
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

    const { giftWrap, rumorId, sentAt, expiresAt } = await createEphemeralGiftWrap({
      senderIdentity: identity,
      recipientPubkey: peerPubkey,
      kind: 'ttl_sync',
      text: `Otomatik silme süresi ${ttl} saat olarak ayarlandı.`,
      ttlHours: ttl,
      blockPaddingBytes: settings.blockPaddingBytes,
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

    await relayRef.current.publishGiftWrap(giftWrap);
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

  const handleSetOrChangePin = async (newPin: string | null) => {
    const nextSettings: PrivacySettings = { ...settings, hasPin: Boolean(newPin) };
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
      const { giftWrap } = await createEphemeralGiftWrap({
        senderIdentity: identity,
        recipientPubkey: peerPubkey,
        kind: 'burn_chat',
        text: 'burn',
        ttlHours: ttl,
        blockPaddingBytes: settings.blockPaddingBytes,
      });
      relayRef.current.publishGiftWrap(giftWrap).catch(() => {});
    }

    const remainingMsgs = messages.filter((m) => m.peerPubkey !== peerPubkey);
    messagesRef.current = remainingMsgs;
    setMessages(remainingMsgs);
    await saveEncryptedItem('messages', remainingMsgs);
    setBurnTarget(null);
  };

  if (screen === 'booting') {
    return (
      <div className="min-h-screen w-full bg-[#090B0F] flex items-center justify-center text-sm text-slate-400">
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
        onChangeChatTTL={handleChangeChatTTL}
        onOpenInvite={() => setShowInviteModal(true)}
        onOpenNetwork={() => setShowNetworkModal(true)}
        onOpenSafety={(peer) => setSafetyPeer(peer)}
        onLockVault={handleLockVault}
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
          onSetOrChangePin={handleSetOrChangePin}
          onReconnectRelays={() => startRelaySession(identity, settings.relays)}
          onClose={() => setShowNetworkModal(false)}
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

