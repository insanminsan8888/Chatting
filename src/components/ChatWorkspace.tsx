import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Clock,
  Eye,
  EyeOff,
  Flame,
  Lock,
  Radio,
  Search,
  Send,
  Share2,
  Shield,
  ShieldCheck,
  UserPlus,
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
import { parsePeerInput } from '../lib/crypto';

interface ChatWorkspaceProps {
  identity: LocalIdentity;
  contacts: Record<string, PeerContact>;
  threads: Record<string, ChatThread>;
  messages: ChatMessage[];
  activePeerPubkey: string | null;
  settings: PrivacySettings;
  relayHealth: RelayHealth[];
  privacyBlurred: boolean;
  nowMs: number;
  onTogglePrivacyBlur: () => void;
  onSelectPeer: (pubkey: string | null) => void;
  onSearchUsers: (query: string) => Promise<DiscoveredUser[]>;
  onAddPeer: (peer: { pubkey: string; username?: string; handle?: string; npub: string }) => void;
  onSendMessage: (peerPubkey: string, text: string) => Promise<void>;
  onChangeChatTTL: (peerPubkey: string, ttl: TTLHours) => Promise<void>;
  onOpenInvite: () => void;
  onOpenNetwork: () => void;
  onOpenSafety: (peer: PeerContact) => void;
  onLockVault: () => void;
  onRequestBurnChat: (peer: PeerContact) => void;
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

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  identity,
  contacts,
  threads,
  messages,
  activePeerPubkey,
  settings,
  relayHealth,
  privacyBlurred,
  nowMs,
  onTogglePrivacyBlur,
  onSelectPeer,
  onSearchUsers,
  onAddPeer,
  onSendMessage,
  onChangeChatTTL,
  onOpenInvite,
  onOpenNetwork,
  onOpenSafety,
  onLockVault,
  onRequestBurnChat,
  onRequestPanicWipe,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<DiscoveredUser[]>([]);
  const [searchTouched, setSearchTouched] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const connectedRelayCount = relayHealth.filter((r) => r.status === 'connected').length;
  const activePeer = activePeerPubkey ? contacts[activePeerPubkey] : undefined;
  const activeThread = activePeerPubkey ? threads[activePeerPubkey] : undefined;
  const activeTTL: TTLHours = activeThread?.ttlHours ?? 24;

  const activeMessages = activePeerPubkey
    ? messages
        .filter((m) => m.peerPubkey === activePeerPubkey && m.expiresAt > nowMs)
        .sort((a, b) => a.createdAt - b.createdAt)
    : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, activePeerPubkey]);

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

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activePeer || sending) return;
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setSending(true);
    try {
      await onSendMessage(activePeer.pubkey, text);
    } finally {
      setSending(false);
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
    <div className="h-screen w-full bg-[#090B0F] text-[#F1F5F9] flex overflow-hidden">
      {/* Left Sidebar: Hidden on mobile when a chat is open */}
      <aside
        className={`${
          activePeerPubkey ? 'hidden lg:flex' : 'flex'
        } w-full lg:w-[340px] xl:w-[360px] shrink-0 flex-col bg-[#0D1016] border-r border-white/[0.07] h-full`}
      >
        {/* Top Identity Strip */}
        <div className="px-4 py-3.5 border-b border-white/[0.07] flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-bold text-base tracking-tight text-white font-['Plus_Jakarta_Sans'] truncate">
                Kapsül
              </span>
            </div>
            <p className="mt-0.5 font-mono text-xs text-emerald-400 truncate">{identity.handle}</p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onOpenInvite}
              title="Davet linki ve QR kod"
              aria-label="Davet paylaş"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
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
              onClick={onRequestPanicWipe}
              title="Her Şeyi Yak (Acil Silme)"
              aria-label="Her Şeyi Yak"
              className="w-10 h-10 rounded-xl flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Flame className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Username / Invite Search */}
        <div className="p-3.5 border-b border-white/[0.07]">
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
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
                placeholder="Kullanıcı adı ara veya link yapıştır"
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-[#141821] border border-white/[0.08] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={!searchQuery.trim() || searching}
              className="h-10 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              {parsedDirectPeer ? 'Ekle' : searching ? 'Arıyor...' : 'Bul'}
            </button>
          </form>

          {/* Search Results */}
          {(searching || searchTouched) && !parsedDirectPeer && (
            <div className="mt-3 space-y-1.5 max-h-52 overflow-y-auto">
              {searching ? (
                <p className="text-xs text-slate-400 py-2 px-1">Rölelerde kullanıcı aranıyor...</p>
              ) : searchResults.length === 0 ? (
                <div className="p-2.5 rounded-xl bg-[#141821] border border-white/[0.06] text-xs text-slate-400 leading-relaxed">
                  Eşleşen kullanıcı bulunamadı. Karşı tarafın en az bir kez Kapsül&apos;ü açmış olması veya size davet linkini göndermesi gerekir.
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
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-[#141821] hover:bg-[#1A202C] border border-white/[0.06] text-left transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{user.handle}</p>
                      <p className="font-mono text-[11px] text-slate-500 truncate">{user.npub.slice(0, 18)}...</p>
                    </div>
                    <UserPlus className="w-4 h-4 text-emerald-400 shrink-0" />
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
              <p className="text-sm font-semibold text-slate-200">Henüz aktif sohbet yok</p>
              <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                Yukarıdan bir kullanıcı adı arayın ya da arkadaşınızın gönderdiği davet bağlantısını yapıştırın.
              </p>
              <button
                type="button"
                onClick={onOpenInvite}
                className="mt-4 h-10 px-4 rounded-xl bg-[#171B24] hover:bg-[#1E2430] border border-white/[0.08] text-xs font-medium text-emerald-400 inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Kendi Davet Linkimi Paylaş</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.05]">
              {sortedThreadList.map((thread) => {
                const peer = contacts[thread.peerPubkey];
                if (!peer) return null;
                const isSelected = thread.peerPubkey === activePeerPubkey;
                const threadMsgs = messages
                  .filter((m) => m.peerPubkey === thread.peerPubkey && m.expiresAt > nowMs)
                  .sort((a, b) => b.createdAt - a.createdAt);
                const lastMsg = threadMsgs[0];

                return (
                  <button
                    key={thread.peerPubkey}
                    type="button"
                    onClick={() => onSelectPeer(thread.peerPubkey)}
                    className={`w-full px-4 py-3.5 text-left transition-colors flex items-start justify-between gap-3 cursor-pointer ${
                      isSelected ? 'bg-[#161B25]' : 'hover:bg-[#12161E]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">{peer.handle}</span>
                        {peer.verifiedFingerprint && (
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-400 truncate">
                        {privacyBlurred
                          ? '•••••• (Ekran gizli)'
                          : lastMsg
                          ? lastMsg.text
                          : 'Yeni şifreli sohbet'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {thread.ttlHours}s
                      </span>
                      {thread.unreadCount > 0 && (
                        <p className="mt-1 font-mono text-[11px] font-semibold text-emerald-400 tabular-nums">
                          +{thread.unreadCount}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Network & Privacy Toolbar */}
        <div className="px-4 py-3 border-t border-white/[0.07] flex items-center justify-between gap-2 bg-[#0B0E14]">
          <button
            type="button"
            onClick={onOpenNetwork}
            className="h-9 px-2.5 rounded-lg hover:bg-white/[0.05] text-xs text-slate-300 flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Radio
              className={`w-3.5 h-3.5 ${
                connectedRelayCount > 0 ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
            <span className="tabular-nums">
              {connectedRelayCount}/{settings.relays.length} röle
            </span>
          </button>

          <button
            type="button"
            onClick={onTogglePrivacyBlur}
            className="h-9 px-2.5 rounded-lg hover:bg-white/[0.05] text-xs text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            {privacyBlurred ? <Eye className="w-3.5 h-3.5 text-amber-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400" />}
            <span>{privacyBlurred ? 'Göster' : 'Gizle'}</span>
          </button>
        </div>
      </aside>

      {/* Right Active Chat Panel */}
      <main
        className={`${
          activePeerPubkey ? 'flex' : 'hidden lg:flex'
        } flex-1 flex-col h-full bg-[#090B0F] min-w-0 relative`}
      >
        {!activePeer ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#11141B] border border-white/[0.08] flex items-center justify-center text-emerald-400 mb-5">
              <Shield className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-bold text-white">Sıfır Sunucu · Sıfır İz</h2>
            <p className="mt-2 text-sm text-slate-400 max-w-md leading-relaxed">
              Sol taraftan bir kullanıcı adı arayın veya davet linkinizi paylaşın. Mesajlar varsayılan olarak 24 saat içinde (isterseniz 12, 7 veya 1 saatte) iki taraftan da kalıcı silinir.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onOpenInvite}
                className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Davet Kodumu Göster</span>
              </button>
              <button
                type="button"
                onClick={onOpenNetwork}
                className="h-11 px-5 rounded-xl bg-[#141821] hover:bg-[#1B202C] border border-white/[0.08] text-slate-200 text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Radio className="w-4 h-4 text-emerald-400" />
                <span>Röle ve Güvenlik Ayarları</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <header className="px-4 sm:px-6 py-3 border-b border-white/[0.07] bg-[#0D1016] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectPeer(null)}
                  aria-label="Sohbet listesine dön"
                  className="lg:hidden w-10 h-10 -ml-2 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-white truncate">{activePeer.handle}</h2>
                    {activePeer.verifiedFingerprint && (
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-slate-400 truncate">
                    Mühürlü Zarf E2EE · IP gizli{activePeer.sharedSecret ? ' · Çift katman AES' : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* TTL Segmented Selector */}
                <div
                  className="flex items-center gap-0.5 p-1 rounded-xl bg-[#141821] border border-white/[0.07]"
                  role="group"
                  aria-label="Otomatik silinme süresi"
                >
                  <Clock className="w-3.5 h-3.5 text-slate-400 ml-2 mr-1 hidden sm:block" />
                  {TTL_OPTIONS.map((hrs) => (
                    <button
                      key={hrs}
                      type="button"
                      onClick={() => onChangeChatTTL(activePeer.pubkey, hrs)}
                      className={`px-2.5 py-1.5 rounded-lg font-mono text-xs font-medium tabular-nums transition-colors cursor-pointer whitespace-nowrap ${
                        activeTTL === hrs
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {hrs}s
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => onOpenSafety(activePeer)}
                  title="Güvenlik parmak izi ve ortak parola"
                  aria-label="Güvenlik parmak izi"
                  className="h-10 px-3 rounded-xl bg-[#141821] hover:bg-[#1B202C] border border-white/[0.07] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span className="hidden sm:inline">Doğrula</span>
                </button>

                <button
                  type="button"
                  onClick={() => onRequestBurnChat(activePeer)}
                  title="Sohbeti kalıcı sil"
                  aria-label="Sohbeti yak"
                  className="w-10 h-10 rounded-xl bg-[#141821] hover:bg-red-500/15 border border-white/[0.07] text-red-400 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <Flame className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Message Stream */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-3 relative">
              {activeMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-4">
                  <p className="text-sm font-semibold text-slate-300">
                    {activePeer.handle} ile şifreli oturum hazır
                  </p>
                  <p className="mt-1.5 text-xs text-slate-500 max-w-sm leading-relaxed">
                    Gönderdiğiniz tüm mesajlar cihazınızda {settings.blockPaddingBytes} baytlık sabit bloklara doldurulur ve {activeTTL} saat sonunda otomatik silinir.
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
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap ${
                          isMine
                            ? 'bg-[#122922] border border-emerald-500/25 text-slate-100'
                            : 'bg-[#141821] border border-white/[0.07] text-slate-100'
                        }`}
                      >
                        {msg.text}
                      </div>
                      <div className="mt-1 px-1 flex items-center gap-2 text-[11px] text-slate-500 tabular-nums">
                        <span>{formatClock(msg.createdAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-slate-400">
                          {formatRemaining(msg.expiresAt, nowMs)}
                        </span>
                        {isMine && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {msg.delivery === 'sending'
                                ? 'Şifreleniyor...'
                                : msg.delivery === 'failed'
                                ? 'Röleye iletilemedi'
                                : `${msg.relayCount ?? 1} röle`}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />

              {/* Shoulder-Surfing Blur Shield */}
              {privacyBlurred && (
                <div
                  onClick={onTogglePrivacyBlur}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onTogglePrivacyBlur();
                  }}
                  className="fixed lg:absolute inset-0 z-30 bg-[#090B0F]/85 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center cursor-pointer"
                >
                  <EyeOff className="w-8 h-8 text-emerald-400 mb-3" />
                  <p className="text-base font-bold text-white">Ekran Gizlendi</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Mesajları tekrar görmek için dokunun veya tıklayın.
                  </p>
                </div>
              )}
            </div>

            {/* Message Composer */}
            <form
              onSubmit={handleSend}
              className="p-3 sm:p-4 border-t border-white/[0.07] bg-[#0D1016]"
            >
              <div className="flex items-end gap-2.5">
                <textarea
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`${activePeer.username} kullanıcısına şifreli yaz... (${activeTTL} saatte silinir)`}
                  className="flex-1 min-h-[44px] max-h-32 px-4 py-2.5 rounded-xl bg-[#141821] border border-white/[0.08] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 resize-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sending}
                  aria-label="Mesajı gönder"
                  className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors shrink-0 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Gönder</span>
                </button>
              </div>
              <div className="mt-2 px-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  Otomatik silme: {activeTTL} saat · Sabit blok dolgu: {settings.blockPaddingBytes} B
                </span>
                <span>Enter ile gönder</span>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
};
