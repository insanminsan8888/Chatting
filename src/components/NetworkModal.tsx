import React, { useRef, useState } from 'react';
import { Camera, Copy, Check, EyeOff, Key, Lock, Plus, Radio, Shield, Trash2, X } from 'lucide-react';
import type { LocalIdentity, PrivacySettings, RelayHealth } from '../types/kapsul';
import { compressAvatarToDataUrl, exportNsec } from '../lib/crypto';

interface NetworkModalProps {
  identity: LocalIdentity;
  settings: PrivacySettings;
  relayHealth: RelayHealth[];
  onUpdateSettings: (next: Partial<PrivacySettings>) => void;
  onUpdateAvatar: (avatarDataUrl: string | undefined) => Promise<void>;
  onSetOrChangePin: (newPin: string | null) => Promise<void>;
  onReconnectRelays: () => void;
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
      setAvatarError(err instanceof Error ? err.message : 'Fotoğraf güncellenemedi.');
    }
  };

  const handleAddRelay = (e: React.FormEvent) => {
    e.preventDefault();
    setRelayError(null);
    const trimmed = newRelay.trim();
    if (!trimmed) return;
    try {
      const url = new URL(trimmed.startsWith('wss://') || trimmed.startsWith('ws://') ? trimmed : `wss://${trimmed}`);
      if (url.protocol !== 'wss:') {
        setRelayError('Güvenlik için yalnızca şifreli wss:// röle adresleri eklenebilir.');
        return;
      }
      const normalized = url.toString().replace(/\/$/, '');
      if (settings.relays.includes(normalized)) {
        setRelayError('Bu röle zaten listede.');
        return;
      }
      onUpdateSettings({ relays: [...settings.relays, normalized] });
      setNewRelay('');
    } catch {
      setRelayError('Geçerli bir röle adresi girin (ör. wss://relay.damus.io).');
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
      setPinSavedMsg('PIN en az 4 karakter olmalıdır.');
      return;
    }
    await onSetOrChangePin(newPin.trim());
    setNewPin('');
    setPinSavedMsg('Kasa PIN kilidi güncellendi.');
  };

  const handleRemovePin = async () => {
    await onSetOrChangePin(null);
    setPinSavedMsg('PIN kilidi kaldırıldı.');
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
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="network-modal-title"
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#11141B] border border-white/[0.08] rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.07]">
          <div>
            <h2 id="network-modal-title" className="text-lg font-bold text-white">
              Ağ, Röleler ve Gizlilik Ayarları
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Sunucusuz taşıma katmanı, paket dolgu boyutu ve cihaz içi kasa güvenliği
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

        <div className="mt-6 space-y-7">
          {/* Serverless Profile Avatar */}
          <section className="p-4 rounded-xl bg-[#090B0F] border border-white/[0.07] flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              {identity.avatarDataUrl ? (
                <img
                  src={identity.avatarDataUrl}
                  alt={identity.handle}
                  className="w-12 h-12 rounded-xl object-cover border border-emerald-500/35 shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-[#141821] border border-white/10 flex items-center justify-center text-base font-bold text-emerald-400 shrink-0">
                  {identity.username.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{identity.handle}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  Sunucusuz profil fotoğrafı (EXIF/GPS verileri silinir, IP sızdırmaz).
                </p>
                {avatarError && <p className="mt-1 text-xs text-red-400">{avatarError}</p>}
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
                className="h-9 px-3 rounded-lg bg-[#171B24] hover:bg-[#1E2430] border border-white/[0.08] text-xs font-medium text-white inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5 text-emerald-400" />
                <span>{identity.avatarDataUrl ? 'Değiştir' : 'Fotoğraf Seç'}</span>
              </button>
              {identity.avatarDataUrl && (
                <button
                  type="button"
                  onClick={() => onUpdateAvatar(undefined)}
                  className="h-9 px-3 rounded-lg bg-[#171B24] hover:bg-red-500/15 text-xs font-medium text-red-400 cursor-pointer"
                >
                  Kaldır
                </button>
              )}
            </div>
          </section>

          {/* Architecture & Honest ISP Note */}
          <section className="p-4 rounded-xl bg-[#090B0F] border border-white/[0.07]">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>Gizlilik Mimarisi ve İnternet Sağlayıcısı Notu</span>
            </div>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">
              Mesajlarınız cihazınızdan çıkmadan NIP-44 ile şifrelenir ve tek kullanımlık rastgele anahtarlarla (NIP-59 Gift Wrap) mühürlenir. Kişiler doğrudan bağlanmadığı için birbirinin IP adresini göremez; röleler ve ağ dinleyicileri kimin kime yazdığını veya ne yazdığını okuyamaz.
            </p>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">
              İnternet sağlayıcınızın bu röle adreslerine bağlandığınızı dahi görmemesini istiyorsanız, uygulamayı <span className="text-slate-200 font-medium">Tor Browser veya güvenilir bir VPN</span> üzerinden açmanız önerilir.
            </p>
          </section>

          {/* Relays */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Radio className="w-4 h-4 text-emerald-400" />
                <span>Açık WSS Röleleri (Ücretsiz)</span>
              </div>
              <button
                type="button"
                onClick={onReconnectRelays}
                className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
              >
                Yeniden Bağlan
              </button>
            </div>

            <div className="divide-y divide-white/[0.06] border border-white/[0.07] rounded-xl bg-[#090B0F]">
              {relayHealth.map((relay) => (
                <div key={relay.url} className="flex items-center justify-between px-3.5 py-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-slate-200 truncate">{relay.url}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {relay.status === 'connected'
                        ? 'Bağlı · TLS şifreli'
                        : relay.status === 'connecting'
                        ? 'Bağlanıyor...'
                        : 'Bağlantı hatası'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-xs font-medium ${
                        relay.status === 'connected'
                          ? 'text-emerald-400'
                          : relay.status === 'connecting'
                          ? 'text-amber-400'
                          : 'text-red-400'
                      }`}
                    >
                      {relay.status === 'connected' ? 'Aktif' : relay.status === 'connecting' ? 'Bekliyor' : 'Kapalı'}
                    </span>
                    {settings.relays.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRelay(relay.url)}
                        aria-label={`${relay.url} rölesini kaldır`}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-white/[0.04] transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleAddRelay} className="mt-3 flex gap-2">
              <input
                type="text"
                value={newRelay}
                onChange={(e) => setNewRelay(e.target.value)}
                placeholder="wss://..."
                className="flex-1 h-10 px-3 rounded-xl bg-[#090B0F] border border-white/10 font-mono text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                className="h-10 px-4 rounded-xl bg-[#171B24] hover:bg-[#1E2430] border border-white/[0.08] text-xs font-medium text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Röle Ekle</span>
              </button>
            </form>
            {relayError && <p className="mt-1.5 text-xs text-red-400">{relayError}</p>}
          </section>

          {/* Privacy Controls */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/[0.07]">
            <div className="p-4 rounded-xl bg-[#090B0F] border border-white/[0.07]">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <EyeOff className="w-4 h-4 text-emerald-400" />
                  <span>Otomatik Ekran Gizleme</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoBlurOnBackground}
                  onChange={(e) => onUpdateSettings({ autoBlurOnBackground: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500 cursor-pointer"
                />
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Başka sekmeye veya uygulamaya geçtiğinizde mesaj alanını otomatik bulanıklaştırır.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#090B0F] border border-white/[0.07]">
              <p className="text-sm font-semibold text-white">Sabit Paket Dolgusu (Padding)</p>
              <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                Mesaj uzunluğunun ağ trafiğinden tahmin edilmesini engeller.
              </p>
              <div className="mt-3 flex gap-2">
                {([1024, 2048] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => onUpdateSettings({ blockPaddingBytes: size })}
                    className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                      settings.blockPaddingBytes === size
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#171B24] text-slate-400 hover:text-white'
                    }`}
                  >
                    {size} B
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Local Vault PIN & Backup */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-white/[0.07]">
            <form onSubmit={handlePinSave} className="p-4 rounded-xl bg-[#090B0F] border border-white/[0.07]">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Lock className="w-4 h-4 text-emerald-400" />
                <span>{settings.hasPin ? 'Kasa PIN Kodunu Değiştir' : 'Kasa PIN Kilidi Belirle'}</span>
              </div>
              <input
                type="password"
                inputMode="numeric"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
                placeholder="En az 4 haneli yeni PIN"
                className="mt-3 w-full h-10 px-3 rounded-lg bg-[#141821] border border-white/10 font-mono text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="submit"
                  className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors cursor-pointer"
                >
                  PIN Kaydet
                </button>
                {settings.hasPin && (
                  <button
                    type="button"
                    onClick={handleRemovePin}
                    className="h-9 px-3 rounded-lg bg-[#171B24] hover:bg-red-500/15 text-xs font-medium text-red-400 transition-colors cursor-pointer"
                  >
                    PIN Kaldır
                  </button>
                )}
              </div>
              {pinSavedMsg && <p className="mt-2 text-xs text-emerald-400">{pinSavedMsg}</p>}
              {settings.hasPin && (
                <div className="mt-4 pt-3 border-t border-white/[0.07]">
                  <p className="text-[11px] text-slate-400 mb-2">Hareketsizlik Otomatik Kilidi</p>
                  <div className="flex gap-1.5">
                    {([0, 5, 15] as const).map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        onClick={() => onUpdateSettings({ autoLockMinutes: mins })}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                          settings.autoLockMinutes === mins
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#171B24] text-slate-400 hover:text-white'
                        }`}
                      >
                        {mins === 0 ? 'Kapalı' : `${mins} dk`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </form>

            <div className="p-4 rounded-xl bg-[#090B0F] border border-white/[0.07]">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Key className="w-4 h-4 text-emerald-400" />
                <span>Gizli Anahtar Yedeği</span>
              </div>
              <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
                Başka bir cihazda aynı kullanıcı kimliğini açmak için nsec anahtarınızı güvenli bir yerde saklayın.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowNsec((p) => !p)}
                  className="h-9 px-3 rounded-lg bg-[#171B24] hover:bg-[#1E2430] border border-white/[0.07] text-xs font-medium text-slate-200 transition-colors cursor-pointer"
                >
                  {showNsec ? 'Gizle' : 'Anahtarı Göster'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyNsec}
                  className="h-9 px-3 rounded-lg bg-[#171B24] hover:bg-[#1E2430] border border-white/[0.07] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedNsec ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedNsec ? 'Kopyalandı' : 'Kopyala'}</span>
                </button>
              </div>
              {showNsec && (
                <p className="mt-2.5 p-2 rounded-lg bg-[#141821] font-mono text-[11px] text-amber-300 break-all select-all">
                  {exportNsec(identity)}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
