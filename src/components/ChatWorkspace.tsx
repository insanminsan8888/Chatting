import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Flame,
  Lock,
  LogOut,
  Radio,
  Reply,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Smile,
  SmilePlus,
  Trash2,
  UserPlus,
  X,
  Zap,
} from 'lucide-react';
import {
  TTL_OPTIONS,
  type ChatMessage,
  type ChatThread,
  type DiscoveredUser,
  type LocalIdentity,
  type PeerContact,
  type PrivacySettings,
  type RelayHealth,
  type TTLHours,
} from '../types/kapsul';
import { isSafeAvatarDataUrl, parsePeerInput } from '../lib/crypto';
import { BrandLogo } from './BrandLogo';
import { ConnectionVisual } from './ConnectionVisual';

const COMPOSER_EMOJIS = [
  '😀', '😂', '😍', '🥰', '😎', '🤔', '😮', '😢', '😡',
  '🔥', '❤️', '💯', '👍', '👎', '👏', '🙏', '🎉', '👀',
  '💀', '🔒', '⚡', '✨',
];

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

interface ChatWorkspaceProps {
  identity: LocalIdentity;
  contacts: Record<string, PeerContact>;
  threads: Record<string, ChatThread>;
  messages: ChatMessage[];
  activePeerPubkey: string | null;
  settings: PrivacySettings;
  relayHealth: RelayHealth[];
  typingPeers: Record<string, number>;
  privacyBlurred: boolean;
  nowMs: number;
  onTogglePrivacyBlur: () => void;
  onSelectPeer: (pubkey: string | null) => void;
  onSearchUsers: (query: string) => Promise<DiscoveredUser[]>;
  onAddPeer: (peer: {
    pubkey: string;
    username?: string;
    handle?: string;
    npub: string;
    avatarDataUrl?: string;
  }) => void;
  onSendMessage: (
    peerPubkey: string,
    text: string,
    options?: {
      replyTo?: { id: string; preview: string };
      burnAfterSec?: number;
    }
  ) => Promise<void>;
  onTyping: (peerPubkey: string) => void;
  onReactMessage: (msg: ChatMessage, emoji: string) => Promise<void>;
  onDeleteMessage: (msg: ChatMessage, scope: 'local' | 'both') => Promise<void>;
  onChangeChatTTL: (peerPubkey: string, ttl: TTLHours) => Promise<void>;
  onOpenInvite: () => void;
  onOpenNetwork: () => void;
  onOpenSafety: (peer: PeerContact) => void;
  onLockVault: () => void;
  onRequestLogout: () => void;
  onRequestBurnChat: (peer: PeerContact) => void;
  onRequestRemovePeer: (peer: PeerContact) => void;
  onRequestPanicWipe: () => void;
}

function formatRemaining(expiresAt: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((expiresAt - nowMs) / 1000));
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  if (h > 0) return `${h}s ${m}dk`;
  if (m > 0) return `${m}dk ${s}sn`;
  return `${s}sn`;
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const AvatarCircle: React.FC<{
  name: string;
  avatarDataUrl?: string;
  sizeClass?: string;
}> = ({ name, avatarDataUrl, sizeClass = 'w-9 h-9 text-xs' }) => {
  if (isSafeAvatarDataUrl(avatarDataUrl)) {
    return (
      <img
        src={avatarDataUrl}
        alt={name}
        className={`${sizeClass} rounded-xl object-cover border border-blue-500/35 shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-xl bg-gradient-to-br from-[#0F172A] to-[#1A1020] border border-blue-500/30 flex items-center justify-center font-bold text-rose-400 shrink-0 select-none`}
    >
      {(name.trim().slice(0, 1) || '?').toUpperCase()}
    </div>
  );
};

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  identity,
  contacts,
  threads,
  messages,
  activePeerPubkey,
  settings,
  relayHealth,
  typingPeers,
  privacyBlurred,
  nowMs,
  onTogglePrivacyBlur,
  onSelectPeer,
  onSearchUsers,
  onAddPeer,
  onSendMessage,
  onTyping,
  onReactMessage,
  onDeleteMessage,
  onChangeChatTTL,
  onOpenInvite,
  onOpenNetwork,
  onOpenSafety,
  onLockVault,
  onRequestLogout,
  onRequestBurnChat,
  onRequestRemovePeer,
  onRequestPanicWipe,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DiscoveredUser[]>([]);
  const [searchTouched, setSearchTouched] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [quickBurn15s, setQuickBurn15s] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [reactMenuMsgId, setReactMenuMsgId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<{ id: string; preview: string } | null>(null);
  const [deleteMenuMsgId, setDeleteMenuMsgId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastTypingEmitRef = useRef<number>(0);

  const activePeer = activePeerPubkey ? contacts[activePeerPubkey] : undefined;
  const activeThread = activePeerPubkey ? threads[activePeerPubkey] : undefined;
  const activeTTL: TTLHours = activeThread?.ttlHours ?? 24;
  const isPeerTyping = Boolean(activePeerPubkey && (typingPeers[activePeerPubkey] ?? 0) > nowMs);

  const activeMessages = activePeerPubkey
    ? messages
        .filter((m) => m.peerPubkey === activePeerPubkey && m.expiresAt > nowMs)
        .filter((m) =>
          chatSearchOpen && chatSearchQuery.trim()
            ? m.text.toLowerCase().includes(chatSearchQuery.trim().toLowerCase())
            : true
        )
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];

  useEffect(() => {
    setReplyTarget(null);
    setDeleteMenuMsgId(null);
    setReactMenuMsgId(null);
    setEmojiPickerOpen(false);
    setChatSearchOpen(false);
    setChatSearchQuery('');
  }, [activePeerPubkey]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activePeerPubkey, isPeerTyping]);

  const parsedDirectPeer = parsePeerInput(searchQuery);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    if (parsedDirectPeer) {
      if (parsedDirectPeer.pubkey === identity.pubkey) return;
      onAddPeer(parsedDirectPeer);
      setSearchQuery('');
      setSearchResults([]);
      setSearchTouched(false);
      return;
    }

    setSearching(true);
    setSearchTouched(true);
    try {
      const results = await onSearchUsers(q);
      setSearchResults(results.filter((u) => u.pubkey !== identity.pubkey));
    } finally {
      setSearching(false);
    }
  };

  const handleDraftChange = (val: string) => {
    setDraft(val);
    if (activePeer && val.trim().length > 0) {
      const now = Date.now();
      if (now - lastTypingEmitRef.current > 2400) {
        lastTypingEmitRef.current = now;
        onTyping(activePeer.pubkey);
      }
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activePeer || sending) return;
    const text = draft.trim();
    if (!text) return;
    const currentReply = replyTarget ?? undefined;
    const burnAfterSec = quickBurn15s ? 15 : undefined;
    setDraft('');
    setReplyTarget(null);
    setEmojiPickerOpen(false);
    setSending(true);
    try {
      await onSendMessage(activePeer.pubkey, text, {
        replyTo: currentReply,
        burnAfterSec,
      });
    } finally {
      setSending(false);
    }
  };

  const handleCopyMessage = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopiedMsgId(msg.id);
      setTimeout(() => setCopiedMsgId(null), 1400);
    } catch {
      // Ignore
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const sortedThreadList = Object.values(threads).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="h-[100dvh] w-full bg-[#07080C] text-[#F1F5F9] flex overflow-hidden">
      {/* Left Sidebar */}
      <aside
        className={`${
          activePeerPubkey ? 'hidden lg:flex' : 'flex'
        } w-full lg:w-[340px] xl:w-[360px] shrink-0 flex-col bg-[#0B1120] border-r border-blue-500/20 h-full`}
      >
        {/* Top Identity Strip */}
        <div className="px-4 py-3 border-b border-blue-500/20 flex items-center justify-between gap-2 bg-[#080C17]">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onOpenNetwork}
              title="Profil ve ayarlar"
              className="cursor-pointer rounded-xl min-h-[40px] min-w-[40px] flex items-center justify-center relative"
            >
              {identity.avatarDataUrl ? (
                <AvatarCircle name={identity.username} avatarDataUrl={identity.avatarDataUrl} />
              ) : (
                <BrandLogo size="sm" />
              )}
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm tracking-tight text-white font-['Plus_Jakarta_Sans'] truncate">
                  Gölge
                </span>
              </div>
              <p className="mt-0.5 font-mono text-xs text-blue-300 truncate">{identity.handle}</p>
            </div>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={onOpenInvite}
              title="Davet paylaş"
              aria-label="Davet paylaş"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-blue-300 hover:text-white hover:bg-blue-500/15 transition-colors cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
            </button>

            {settings.hasPin && (
              <button
                type="button"
                onClick={onLockVault}
                title="Kasayı kilitle"
                aria-label="Kasayı kilitle"
                className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={onRequestLogout}
              title="Çıkış yap"
              aria-label="Çıkış yap"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onRequestPanicWipe}
              title="Her şeyi sil"
              aria-label="Her şeyi sil"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-rose-400 hover:text-rose-300 hover:bg-rose-500/15 transition-colors cursor-pointer"
            >
              <Flame className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Neon Divider */}
        <div className="h-px w-full neon-line-x opacity-60 shrink-0" />

        {/* Username / Invite Search */}
        <div className="p-3.5 border-b border-blue-500/15 bg-[#090D18]">
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value.trim()) {
                    setSearchResults([]);
                    setSearchTouched(false);
                  }
                }}
                placeholder="Kullanıcı adı veya davet linki"
                className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#07080C] border border-blue-500/25 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={!searchQuery.trim() || searching}
              className="h-11 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-rose-600 hover:from-blue-500 hover:to-rose-500 disabled:opacity-40 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-all cursor-pointer"
            >
              {parsedDirectPeer ? 'Ekle' : searching ? 'Arıyor...' : 'Bul'}
            </button>
          </form>

          {/* Search Results */}
          {(searching || searchTouched) && !parsedDirectPeer && (
            <div className="mt-3 space-y-1.5 max-h-52 overflow-y-auto">
              {searching ? (
                <p className="text-xs text-slate-400 py-2 px-1">Aranıyor...</p>
              ) : searchResults.length === 0 ? (
                <div className="p-2.5 rounded-xl bg-[#07080C] border border-blue-500/20 text-xs text-slate-400">
                  Kullanıcı bulunamadı. Davet linkini de buraya yapıştırabilirsin.
                </div>
              ) : (
                searchResults.map((user) => (
                  <button
                    key={user.pubkey}
                    type="button"
                    onClick={() => {
                      onAddPeer(user);
                      setSearchQuery('');
                      setSearchResults([]);
                      setSearchTouched(false);
                    }}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#07080C] hover:bg-[#111A2E] border border-blue-500/20 text-left gap-2.5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AvatarCircle
                        name={user.username}
                        avatarDataUrl={user.avatarDataUrl}
                        sizeClass="w-8 h-8 text-xs"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{user.handle}</p>
                        <p className="text-[11px] text-slate-500 truncate">Sohbet başlat</p>
                      </div>
                    </div>
                    <UserPlus className="w-4 h-4 text-rose-400 shrink-0" />
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto">
          {sortedThreadList.length === 0 ? (
            <div className="p-6 text-center mt-8">
              <p className="text-sm font-semibold text-white">Henüz sohbet yok</p>
              <p className="mt-1.5 text-xs text-slate-400">
                Yukarıdan kullanıcı adı ara veya davet linkini paylaş.
              </p>
              <button
                type="button"
                onClick={onOpenInvite}
                className="mt-4 h-11 px-4 rounded-xl bg-[#070A12] hover:bg-[#111A2E] border border-blue-500/30 text-xs font-medium text-blue-300 inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5 text-rose-400" />
                <span>Davet Linkimi Paylaş</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-blue-500/10">
              {sortedThreadList.map((thread) => {
                const peer = contacts[thread.peerPubkey];
                if (!peer) return null;
                const isSelected = thread.peerPubkey === activePeerPubkey;
                const isTypingNow = (typingPeers[thread.peerPubkey] ?? 0) > nowMs;
                const threadMsgs = messages
                  .filter((m) => m.peerPubkey === thread.peerPubkey && m.expiresAt > nowMs)
                  .sort((a, b) => b.createdAt - a.createdAt);
                const lastMsg = threadMsgs[0];

                return (
                  <div
                    key={thread.peerPubkey}
                    className={`group px-3.5 py-3 transition-colors flex items-center justify-between gap-2 min-h-[64px] ${
                      isSelected
                        ? 'bg-gradient-to-r from-blue-600/15 to-rose-600/10'
                        : 'hover:bg-[#10182C]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectPeer(thread.peerPubkey)}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <AvatarCircle
                        name={peer.username}
                        avatarDataUrl={peer.avatarDataUrl}
                        sizeClass="w-10 h-10 text-sm"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-white truncate">
                            {peer.handle}
                          </span>
                          {peer.verifiedFingerprint && (
                            <ShieldCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          )}
                        </div>
                        <p
                          className={`mt-0.5 text-xs truncate ${
                            isTypingNow ? 'text-rose-400 font-medium' : 'text-slate-400'
                          }`}
                        >
                          {privacyBlurred
                            ? '••••••'
                            : isTypingNow
                            ? 'yazıyor...'
                            : lastMsg
                            ? lastMsg.text
                            : 'Yeni sohbet'}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="text-right">
                        <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                          {thread.ttlHours}s
                        </span>
                        {thread.unreadCount > 0 && (
                          <p className="mt-0.5 font-mono text-[11px] font-semibold text-rose-400 tabular-nums">
                            +{thread.unreadCount}
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onRequestRemovePeer(peer)}
                        title="Kişiyi ve sohbeti sil"
                        aria-label={`${peer.handle} kişisini ve sohbeti sil`}
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-85 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100 transition-all cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Network Visual & Privacy Toolbar */}
        <div className="px-3.5 py-2.5 border-t border-blue-500/20 flex items-center justify-between gap-2 bg-[#080C17]">
          <button
            type="button"
            onClick={onOpenNetwork}
            className="h-10 px-2.5 rounded-lg hover:bg-white/[0.05] flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            <ConnectionVisual relayHealth={relayHealth} variant="compact" />
            <span className="text-[11px] text-slate-500 hidden sm:inline">· Ayarlar</span>
          </button>

          <button
            type="button"
            onClick={onTogglePrivacyBlur}
            className="h-10 px-2.5 rounded-lg hover:bg-white/[0.05] text-xs text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            {privacyBlurred ? (
              <Eye className="w-3.5 h-3.5 text-rose-400" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>{privacyBlurred ? 'Göster' : 'Gizle'}</span>
          </button>
        </div>
      </aside>

      {/* Right Active Chat Panel */}
      <main
        className={`${
          activePeerPubkey ? 'flex' : 'hidden lg:flex'
        } flex-1 flex-col h-full bg-[#07080C] neon-grid-bg min-w-0 relative`}
      >
        {!activePeer ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-8 text-center">
            <BrandLogo size="lg" className="mb-5" />
            <h2 className="text-xl font-bold text-white">Gölge</h2>
            <p className="mt-2 text-sm text-slate-400 max-w-sm">
              Soldan kullanıcı adı ara veya davet linkini paylaş. Mesajlar varsayılan olarak 24 saatte silinir.
            </p>
            <div className="mt-4">
              <ConnectionVisual relayHealth={relayHealth} variant="compact" />
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onOpenInvite}
                className="h-11 px-5 rounded-xl bg-gradient-to-r from-blue-600 to-rose-600 hover:from-blue-500 hover:to-rose-500 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-[0_0_20px_rgba(225,29,72,0.28)] transition-all cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Davet Paylaş</span>
              </button>
              <button
                type="button"
                onClick={onOpenNetwork}
                className="h-11 px-5 rounded-xl bg-[#0B1120] hover:bg-[#111A2E] border border-blue-500/30 text-slate-200 text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Radio className="w-4 h-4 text-blue-400" />
                <span>Ayarlar</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <header className="px-3 sm:px-6 py-2.5 sm:py-3 border-b border-blue-500/20 bg-[#0B1120]/95 backdrop-blur-md flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectPeer(null)}
                  aria-label="Geri"
                  className="lg:hidden w-11 h-11 -ml-1.5 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <AvatarCircle
                  name={activePeer.username}
                  avatarDataUrl={activePeer.avatarDataUrl}
                  sizeClass="w-10 h-10 text-sm"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h2 className="text-sm sm:text-base font-bold text-white truncate">
                      {activePeer.handle}
                    </h2>
                    {activePeer.verifiedFingerprint && (
                      <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] truncate">
                    {isPeerTyping ? (
                      <span className="text-rose-400 font-semibold">yazıyor...</span>
                    ) : (
                      <span className="text-slate-400">
                        Şifreli · IP gizli{activePeer.sharedSecret ? ' · Çift kilit' : ''}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                {/* Connection status pill on mobile chat header */}
                <button
                  type="button"
                  onClick={onOpenNetwork}
                  title="Bağlantı durumu"
                  className="lg:hidden h-10 px-2.5 rounded-xl bg-[#07080C] border border-blue-500/25 flex items-center cursor-pointer"
                >
                  <ConnectionVisual relayHealth={relayHealth} variant="compact" />
                </button>

                {/* TTL Segmented Selector */}
                <div
                  className="flex items-center gap-0.5 p-1 rounded-xl bg-[#07080C] border border-blue-500/25"
                  role="group"
                  aria-label="Silinme süresi"
                >
                  <Clock className="w-3.5 h-3.5 text-blue-400 ml-1.5 mr-1 hidden sm:block" />
                  {TTL_OPTIONS.map((hrs) => (
                    <button
                      key={hrs}
                      type="button"
                      onClick={() => onChangeChatTTL(activePeer.pubkey, hrs)}
                      className={`px-2 sm:px-2.5 py-1.5 rounded-lg font-mono text-xs font-semibold tabular-nums transition-all cursor-pointer whitespace-nowrap min-h-[34px] ${
                        activeTTL === hrs
                          ? 'bg-gradient-to-r from-blue-600 to-rose-600 text-white shadow-[0_0_12px_rgba(225,29,72,0.3)]'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {hrs}s
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setChatSearchOpen((prev) => !prev);
                    setChatSearchQuery('');
                  }}
                  title="Sohbette ara"
                  aria-label="Sohbette ara"
                  className={`w-10 h-10 rounded-xl border border-blue-500/25 flex items-center justify-center transition-colors cursor-pointer ${
                    chatSearchOpen
                      ? 'bg-blue-600/25 text-blue-300'
                      : 'bg-[#07080C] hover:bg-[#111A2E] text-slate-300'
                  }`}
                >
                  <Search className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => onOpenSafety(activePeer)}
                  title="Güvenlik kodu"
                  aria-label="Doğrula"
                  className="h-10 px-2.5 sm:px-3 rounded-xl bg-[#07080C] hover:bg-[#111A2E] border border-blue-500/25 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ShieldCheck className="w-4 h-4 text-blue-400" />
                  <span className="hidden sm:inline">Doğrula</span>
                </button>

                <button
                  type="button"
                  onClick={() => onRequestBurnChat(activePeer)}
                  title="Mesajları yak"
                  aria-label="Mesajları yak"
                  className="w-10 h-10 rounded-xl bg-[#07080C] hover:bg-amber-500/15 border border-blue-500/25 text-amber-400 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <Flame className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => onRequestRemovePeer(activePeer)}
                  title="Kişiyi ve sohbeti sil"
                  aria-label="Kişiyi ve sohbeti sil"
                  className="w-10 h-10 rounded-xl bg-[#07080C] hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </header>

            <div className="h-px w-full neon-line-x opacity-45 shrink-0" />

            {chatSearchOpen && (
              <div className="px-4 sm:px-6 py-2.5 bg-[#080C17] border-b border-blue-500/20 flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-500 shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder="Mesajlarda ara..."
                  className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setChatSearchOpen(false);
                    setChatSearchQuery('');
                  }}
                  aria-label="Aramayı kapat"
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Message Stream */}
            <div className="flex-1 overflow-y-auto px-3.5 sm:px-6 py-4 space-y-3 relative">
              {activeMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-4">
                  <p className="text-sm font-semibold text-white">
                    {chatSearchQuery.trim() ? 'Sonuç bulunamadı' : `${activePeer.handle}`}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {chatSearchQuery.trim()
                      ? 'Başka bir kelime dene.'
                      : `Mesajlar ${activeTTL} saat sonra otomatik silinir.`}
                  </p>
                </div>
              ) : (
                activeMessages.map((msg) => {
                  if (msg.direction === 'system') {
                    return (
                      <div key={msg.id} className="py-1.5 text-center">
                        <span className="text-xs text-slate-400">
                          {msg.text} · {formatRemaining(msg.expiresAt, nowMs)}
                        </span>
                      </div>
                    );
                  }

                  const isMine = msg.direction === 'outgoing';
                  const isDeleteMenuOpen = deleteMenuMsgId === msg.id;
                  const isReactMenuOpen = reactMenuMsgId === msg.id;
                  const reactionEntries = Object.entries(msg.reactions ?? {}).filter(
                    ([, reactors]) => reactors.length > 0
                  );

                  return (
                    <div
                      key={msg.id}
                      className={`group flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`flex items-end gap-1.5 max-w-[94%] sm:max-w-[75%] ${
                          isMine ? 'flex-row-reverse' : 'flex-row'
                        }`}
                      >
                        <div
                          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap ${
                            msg.burnAfterSec
                              ? 'bg-[#1F0E18] border border-rose-500/45 shadow-[0_0_16px_rgba(225,29,72,0.16)] text-white'
                              : isMine
                              ? 'bg-[#101C36] border border-blue-500/35 text-slate-100'
                              : 'bg-[#0B1120] border border-white/10 text-slate-100'
                          }`}
                        >
                          {msg.replyToPreview && (
                            <div className="mb-1.5 pb-1.5 border-b border-white/10 text-xs text-blue-300 truncate max-w-[240px]">
                              {msg.replyToPreview}
                            </div>
                          )}
                          {msg.text}
                        </div>

                        {/* Actions: Emoji React, Copy, Reply, Delete */}
                        <div className="flex items-center gap-0.5 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteMenuMsgId(null);
                              setReactMenuMsgId((prev) => (prev === msg.id ? null : msg.id));
                            }}
                            title="Emoji tepkisi"
                            aria-label="Emoji tepkisi"
                            className="w-8 h-8 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-amber-300 flex items-center justify-center cursor-pointer"
                          >
                            <SmilePlus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg)}
                            title="Kopyala"
                            aria-label="Kopyala"
                            className="w-8 h-8 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
                          >
                            {copiedMsgId === msg.id ? (
                              <Check className="w-3.5 h-3.5 text-blue-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setReplyTarget({ id: msg.id, preview: msg.text.slice(0, 80) })
                            }
                            title="Yanıtla"
                            aria-label="Yanıtla"
                            className="w-8 h-8 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setReactMenuMsgId(null);
                              setDeleteMenuMsgId((prev) => (prev === msg.id ? null : msg.id));
                            }}
                            title="Sil"
                            aria-label="Sil"
                            className="w-8 h-8 rounded-lg hover:bg-rose-500/15 text-slate-400 hover:text-rose-400 flex items-center justify-center cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {isReactMenuOpen && (
                        <div className="mt-1.5 flex items-center gap-1 p-1 rounded-xl bg-[#0B1120] border border-blue-500/30 shadow-lg">
                          {QUICK_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => {
                                setReactMenuMsgId(null);
                                onReactMessage(msg, emoji);
                              }}
                              className="w-8 h-8 rounded-lg hover:bg-white/[0.08] text-base flex items-center justify-center cursor-pointer transition-transform hover:scale-110"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}

                      {reactionEntries.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {reactionEntries.map(([emoji, reactors]) => {
                            const iReacted = reactors.includes(identity.pubkey);
                            return (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => onReactMessage(msg, emoji)}
                                className={`h-6 px-2 rounded-lg text-xs inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                                  iReacted
                                    ? 'bg-blue-600/25 border-blue-500/50 text-white'
                                    : 'bg-[#0B1120] border-white/10 text-slate-300 hover:border-blue-500/35'
                                }`}
                              >
                                <span>{emoji}</span>
                                <span className="font-mono text-[10px] tabular-nums">
                                  {reactors.length}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {isDeleteMenuOpen && (
                        <div className="mt-1.5 flex items-center gap-1.5 p-1 rounded-xl bg-[#0B1120] border border-blue-500/30">
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteMenuMsgId(null);
                              onDeleteMessage(msg, 'local');
                            }}
                            className="px-2.5 py-1.5 rounded-lg hover:bg-white/[0.06] text-[11px] font-medium text-slate-200 cursor-pointer whitespace-nowrap"
                          >
                            Benden Sil
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteMenuMsgId(null);
                              onDeleteMessage(msg, 'both');
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-600/25 hover:bg-rose-600/40 text-[11px] font-semibold text-rose-200 cursor-pointer whitespace-nowrap"
                          >
                            İki Taraftan Sil
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteMenuMsgId(null)}
                            aria-label="İptal"
                            className="px-1.5 py-1 text-slate-400 hover:text-white cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      <div className="mt-1 px-1 flex items-center gap-2 text-[11px] text-slate-500 tabular-nums">
                        <span>{formatClock(msg.createdAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-mono ${
                            msg.burnAfterSec ? 'text-rose-400 font-semibold' : 'text-slate-400'
                          }`}
                        >
                          {formatRemaining(msg.expiresAt, nowMs)}
                        </span>
                        {isMine && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {msg.delivery === 'sending'
                                ? 'Gönderiliyor...'
                                : msg.delivery === 'failed'
                                ? 'İletilemedi'
                                : 'İletildi'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Live Typing Bubble */}
              {isPeerTyping && (
                <div className="flex items-start">
                  <div className="px-3.5 py-2 rounded-2xl bg-[#0B1120] border border-blue-500/25 inline-flex items-center gap-2">
                    <span className="text-xs text-blue-300 font-medium">
                      {activePeer.username} yazıyor
                    </span>
                    <span className="inline-flex items-center gap-1" aria-hidden="true">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-bounce [animation-delay:300ms]" />
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />

              {/* Manual/Optional Privacy Shield */}
              {privacyBlurred && (
                <div
                  onClick={onTogglePrivacyBlur}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onTogglePrivacyBlur();
                  }}
                  className="fixed lg:absolute inset-0 z-30 bg-[#07080C]/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center cursor-pointer"
                >
                  <EyeOff className="w-8 h-8 text-rose-400 mb-3" />
                  <p className="text-base font-bold text-white">Ekran Gizlendi</p>
                  <p className="mt-1 text-xs text-slate-400">Açmak için dokun.</p>
                </div>
              )}
            </div>

            {/* Message Composer */}
            <form
              onSubmit={handleSend}
              className="p-3 sm:p-4 border-t border-blue-500/20 bg-[#0B1120]/95 backdrop-blur-md relative"
            >
              {emojiPickerOpen && (
                <div className="mb-2.5 p-2.5 rounded-xl bg-[#070A12] border border-blue-500/30 flex flex-wrap gap-1.5 shadow-xl">
                  {COMPOSER_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleDraftChange(`${draft}${emoji}`)}
                      className="w-9 h-9 rounded-lg hover:bg-white/[0.08] text-lg flex items-center justify-center cursor-pointer transition-transform hover:scale-110"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {replyTarget && (
                <div className="mb-2.5 px-3 py-2 rounded-xl bg-[#07080C] border border-blue-500/25 flex items-center justify-between gap-3">
                  <div className="min-w-0 text-xs text-slate-300 truncate">
                    <span className="text-blue-400 font-medium">Yanıt:</span> {replyTarget.preview}
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyTarget(null)}
                    aria-label="Yanıtı iptal et"
                    className="text-slate-400 hover:text-white cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setQuickBurn15s((prev) => !prev)}
                  title="15 saniyede otomatik yok olan mesaj"
                  aria-label="15 saniyelik hızlı yakma modu"
                  className={`h-11 px-2.5 sm:px-3 rounded-xl border text-xs font-mono font-semibold inline-flex items-center gap-1 transition-all shrink-0 cursor-pointer ${
                    quickBurn15s
                      ? 'bg-rose-600/25 border-rose-500 text-rose-200 shadow-[0_0_14px_rgba(225,29,72,0.3)]'
                      : 'bg-[#07080C] border-blue-500/25 text-slate-400 hover:text-white'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>15sn</span>
                </button>

                <button
                  type="button"
                  onClick={() => setEmojiPickerOpen((prev) => !prev)}
                  title="Emoji ekle"
                  aria-label="Emoji ekle"
                  className={`w-11 h-11 rounded-xl border flex items-center justify-center transition-all shrink-0 cursor-pointer ${
                    emojiPickerOpen
                      ? 'bg-blue-600/25 border-blue-500 text-blue-200'
                      : 'bg-[#07080C] border-blue-500/25 text-slate-400 hover:text-white'
                  }`}
                >
                  <Smile className="w-4 h-4" />
                </button>

                <textarea
                  rows={1}
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    quickBurn15s
                      ? '15sn sonra silinecek mesaj yaz...'
                      : `${activePeer.username} kullanıcısına yaz...`
                  }
                  className="flex-1 min-h-[44px] max-h-32 px-3.5 py-2.5 rounded-xl bg-[#07080C] border border-blue-500/25 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500 resize-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sending}
                  aria-label="Gönder"
                  className="h-11 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-rose-600 hover:from-blue-500 hover:to-rose-500 disabled:opacity-40 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-[0_0_16px_rgba(225,29,72,0.28)] transition-all shrink-0 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Gönder</span>
                </button>
              </div>
              <div className="mt-1.5 px-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {quickBurn15s ? 'Hızlı silme: 15 saniye' : `Otomatik silme: ${activeTTL} saat`}
                </span>
                <span className="hidden sm:inline">Enter ile gönder</span>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
};
