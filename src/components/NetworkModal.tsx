import React, { useRef, useState } from 'react';
import { Camera, Check, Copy, EyeOff, Key, Lock, Plus, Radio, Trash2, Volume2, X } from 'lucide-react';
import type { LocalIdentity, PrivacySettings, RelayHealth } from '../types/kapsul';
import { compressAvatarToDataUrl, exportNsec } from '../lib/crypto';
import { ConnectionVisual } from './ConnectionVisual';

interface NetworkModalProps {
  identity: LocalIdentity;
  settings: PrivacySettings;
  relayHealth: RelayHealth[];
  onUpdateSettings: (next: Partial<PrivacySettings>) => void;
  onUpdateAvatar: (avatarDataUrl: string | undefined) => Promise<void>;
  onSetOrChangePin: (newPin: string | null) => Promise<void>;
  onReconnectRelays: () => void;
  onRequestDeleteAccount: () => void;
  onClose: () => void;
}

export const NetworkModal: React.FC<NetworkModalProps> = ({
  identity,
  settings,
  relayHealth,
  onUpdateSettings,
  onUpdateAvatar,
  onSetOrChangePin,
  onReconnectRelays,
  onRequestDeleteAccount,
  onClose,
}) => {
  const [newRelay, setNewRelay] = useState('');
  const [relayError, setRelayError] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');
  const [pinSavedMsg, setPinSavedMsg] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [showNsec, setShowNsec] = useState(false);
  const [copiedNsec, setCopiedNsec] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement | null>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);
    try {
      const compressed = await compressAvatarToDataUrl(file);
      await onUpdateAvatar(compressed);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Fotoğraf yüklenemedi.');
    }
  };

  const handleAddRelay = (e: React.FormEvent) => {
    e.preventDefault();
    setRelayError(null);
    const trimmed = newRelay.trim();
    if (!trimmed) return;
    try {
      const url = new URL(
        trimmed.startsWith('wss://') || trimmed.startsWith('ws://') ? trimmed : `wss://${trimmed}`
      );
      if (url.protocol !== 'wss:') {
        setRelayError('Yalnızca wss:// adresi eklenebilir.');
        return;
      }
      const normalized = url.toString().replace(/\/$/, '');
      if (settings.relays.includes(normalized)) {
        setRelayError('Bu röle zaten ekli.');
        return;
      }
      onUpdateSettings({ relays: [...settings.relays, normalized] });
      setNewRelay('');
    } catch {
      setRelayError('Geçerli bir adres girin.');
    }
  };

  const handleRemoveRelay = (url: string) => {
    if (settings.relays.length <= 1) return;
    onUpdateSettings({ relays: settings.relays.filter((r) => r !== url) });
  };

  const handlePinSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinSavedMsg(null);
    if (newPin.trim().length < 4) {
      setPinSavedMsg('PIN en az 4 haneli olmalı.');
      return;
    }
    await onSetOrChangePin(newPin.trim());
    setNewPin('');
    setPinSavedMsg('PIN kaydedildi.');
  };

  const handleRemovePin = async () => {
    await onSetOrChangePin(null);
    setPinSavedMsg('PIN kaldırıldı.');
  };

  const handleCopyNsec = async () => {
    try {
      await navigator.clipboard.writeText(exportNsec(identity));
      setCopiedNsec(true);
      setTimeout(() => setCopiedNsec(false), 1800);
    } catch {
      // Ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="network-modal-title"
    >
      <div className="w-full max-w-xl max-h-[90dvh] overflow-y-auto bg-[#0B1120] border border-blue-500/30 shadow-[0_0_32px_rgba(37,99,235,0.2)] rounded-2xl p-5 sm:p-6">
        <div className="flex items-center justify-between pb-4 border-b border-blue-500/20">
          <div>
            <h2 id="network-modal-title" className="text-lg font-bold text-white">
              Profil ve Ayarlar
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Görünüm, ses, gizli anahtar ve ağ bağlantısı
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 space-y-6">
          {/* Connection Status Visual Banner */}
          <ConnectionVisual relayHealth={relayHealth} variant="banner" />

          {/* Profile Avatar */}
          <section className="p-4 rounded-xl bg-[#070A12] border border-blue-500/20 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              {identity.avatarDataUrl ? (
                <img
                  src={identity.avatarDataUrl}
                  alt={identity.handle}
                  className="w-12 h-12 rounded-xl object-cover border border-rose-500/45 shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-[#0F172A] border border-blue-500/30 flex items-center justify-center text-base font-bold text-rose-400 shrink-0">
                  {identity.username.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{identity.handle}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Sunucusuz profil fotoğrafı</p>
                {avatarError && <p className="mt-1 text-xs text-rose-400">{avatarError}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                ref={avatarFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => avatarFileRef.current?.click()}
                className="h-9 px-3 rounded-lg bg-[#111A2E] hover:bg-[#17233D] border border-blue-500/25 text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5 text-blue-400" />
                <span>{identity.avatarDataUrl ? 'Değiştir' : 'Fotoğraf Seç'}</span>
              </button>
              {identity.avatarDataUrl && (
                <button
                  type="button"
                  onClick={() => onUpdateAvatar(undefined)}
                  className="h-9 px-3 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-xs font-medium text-rose-300 cursor-pointer"
                >
                  Kaldır
                </button>
              )}
            </div>
          </section>

          {/* Simple Toggles */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <label className="p-4 rounded-xl bg-[#070A12] border border-blue-500/20 flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <EyeOff className="w-4 h-4 text-rose-400" />
                  <span>Sekmede Gizle</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Başka sekmeye geçince ekranı bulanıklaştırır.
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.autoBlurOnBackground}
                onChange={(e) => onUpdateSettings({ autoBlurOnBackground: e.target.checked })}
                className="w-4 h-4 accent-rose-500 cursor-pointer shrink-0"
              />
            </label>

            <label className="p-4 rounded-xl bg-[#070A12] border border-blue-500/20 flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Volume2 className="w-4 h-4 text-blue-400" />
                  <span>Bildirim Sesi</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Yeni mesaj geldiğinde hafif uyarı sesi çalar.
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.soundEnabled}
                onChange={(e) => onUpdateSettings({ soundEnabled: e.target.checked })}
                className="w-4 h-4 accent-blue-500 cursor-pointer shrink-0"
              />
            </label>
          </section>

          {/* PIN & Secret Key */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <form onSubmit={handlePinSave} className="p-4 rounded-xl bg-[#070A12] border border-blue-500/20">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Lock className="w-4 h-4 text-rose-400" />
                <span>{settings.hasPin ? 'PIN Değiştir' : 'Kasa PIN Ekle'}</span>
              </div>
              <input
                type="password"
                inputMode="numeric"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="En az 4 haneli PIN"
                className="mt-3 w-full h-10 px-3 rounded-lg bg-[#0B1120] border border-blue-500/25 font-mono text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
              />
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="submit"
                  className="h-9 px-3 rounded-lg bg-gradient-to-r from-blue-600 to-rose-600 text-xs font-semibold text-white cursor-pointer"
                >
                  Kaydet
                </button>
                {settings.hasPin && (
                  <button
                    type="button"
                    onClick={handleRemovePin}
                    className="h-9 px-3 rounded-lg bg-rose-500/15 text-xs font-medium text-rose-300 cursor-pointer"
                  >
                    Kaldır
                  </button>
                )}
              </div>
              {pinSavedMsg && <p className="mt-2 text-xs text-blue-300">{pinSavedMsg}</p>}
              {settings.hasPin && (
                <div className="mt-3 pt-3 border-t border-white/[0.07]">
                  <p className="text-[11px] text-slate-400 mb-1.5">Otomatik Kilitle</p>
                  <div className="flex gap-1.5">
                    {([0, 5, 15] as const).map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => onUpdateSettings({ autoLockMinutes: mins })}
                        className={`flex-1 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer ${
                          settings.autoLockMinutes === mins
                            ? 'bg-blue-600 text-white'
                            : 'bg-[#111A2E] text-slate-400 hover:text-white'
                        }`}
                      >
                        {mins === 0 ? 'Kapalı' : `${mins} dk`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form>

            <div className="p-4 rounded-xl bg-[#070A12] border border-blue-500/20">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Key className="w-4 h-4 text-blue-400" />
                <span>Gizli Anahtar Yedeği</span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
                Başka cihazda aynı hesaba girmek için sakla. Kimseyle paylaşma.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowNsec((p) => !p)}
                  className="h-9 px-3 rounded-lg bg-[#111A2E] hover:bg-[#17233D] border border-blue-500/25 text-xs font-medium text-slate-200 cursor-pointer"
                >
                  {showNsec ? 'Gizle' : 'Göster'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyNsec}
                  className="h-9 px-3 rounded-lg bg-[#111A2E] hover:bg-[#17233D] border border-blue-500/25 text-xs font-medium text-blue-300 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedNsec ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedNsec ? 'Kopyalandı' : 'Kopyala'}</span>
                </button>
              </div>
              {showNsec && (
                <p className="mt-2.5 p-2 rounded-lg bg-[#0B1120] font-mono text-[11px] text-rose-300 break-all select-all">
                  {exportNsec(identity)}
                </p>
              )}
            </div>
          </section>

          {/* Relays */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Radio className="w-4 h-4 text-blue-400" />
                <span>Bağlı Röleler</span>
              </div>
              <button
                type="button"
                onClick={onReconnectRelays}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                Yenile
              </button>
            </div>

            <div className="divide-y divide-white/[0.06] border border-blue-500/20 rounded-xl bg-[#070A12]">
              {relayHealth.map((relay) => (
                <div key={relay.url} className="flex items-center justify-between px-3.5 py-2.5 gap-3">
                  <p className="font-mono text-xs text-slate-200 truncate">{relay.url}</p>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-xs font-medium ${
                        relay.status === 'connected'
                          ? 'text-blue-400'
                          : relay.status === 'connecting'
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {relay.status === 'connected'
                        ? 'Bağlı'
                        : relay.status === 'connecting'
                        ? 'Bekliyor'
                        : 'Kapalı'}
                    </span>
                    {settings.relays.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRelay(relay.url)}
                        aria-label="Röleyi kaldır"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleAddRelay} className="mt-2.5 flex gap-2">
              <input
                type="text"
                value={newRelay}
                onChange={(e) => setNewRelay(e.target.value)}
                placeholder="wss://..."
                className="flex-1 h-10 px-3 rounded-xl bg-[#070A12] border border-blue-500/25 font-mono text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-xl bg-[#111A2E] hover:bg-[#17233D] border border-blue-500/25 text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Ekle</span>
              </button>
            </form>
            {relayError && <p className="mt-1.5 text-xs text-rose-400">{relayError}</p>}
          </section>

          {/* Danger Zone: Delete Account */}
          <section className="pt-4 border-t border-rose-500/20 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-rose-300">Hesabı Kalıcı Sil</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Kullanıcı adını arama listesinden siler ve tüm verileri yok eder.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onRequestDeleteAccount();
              }}
              className="h-10 px-4 rounded-xl bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-xs font-semibold text-rose-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              Hesabı Sil
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};
