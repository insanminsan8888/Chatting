import React, { useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Camera, KeyRound, Lock, X } from 'lucide-react';
import { compressAvatarToDataUrl, sanitizeUsername } from '../lib/crypto';
import { BrandLogo } from './BrandLogo';

interface OnboardingViewProps {
  onCreateIdentity: (username: string, pin?: string, avatarDataUrl?: string) => Promise<void>;
  onRestoreIdentity: (username: string, nsecOrHex: string, pin?: string, avatarDataUrl?: string) => Promise<void>;
  pendingInviteLabel?: string | null;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  onCreateIdentity,
  onRestoreIdentity,
  pendingInviteLabel,
}) => {
  const [mode, setMode] = useState<'create' | 'restore'>('create');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showPinField, setShowPinField] = useState(false);
  const [nsecInput, setNsecInput] = useState('');
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewClean = sanitizeUsername(username);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const compressed = await compressAvatarToDataUrl(file);
      setAvatarDataUrl(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fotoğraf yüklenemedi.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = sanitizeUsername(username);
    if (clean.length < 2) {
      setError('Kullanıcı adı en az 2 karakter olmalıdır.');
      return;
    }
    if (showPinField && pin.trim().length > 0 && pin.trim().length < 4) {
      setError('PIN en az 4 haneli olmalıdır.');
      return;
    }

    setSubmitting(true);
    try {
      const cleanPin = showPinField && pin.trim().length >= 4 ? pin.trim() : undefined;
      if (mode === 'create') {
        await onCreateIdentity(clean, cleanPin, avatarDataUrl);
      } else {
        await onRestoreIdentity(clean, nsecInput, cleanPin, avatarDataUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Giriş yapılamadı.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#07080C] neon-grid-bg text-[#F1F5F9] flex flex-col lg:flex-row">
      {/* Left Brand & Simple Value Column */}
      <div className="flex-1 flex flex-col justify-between p-6 sm:p-10 lg:p-16 border-b lg:border-b-0 lg:border-r border-blue-500/20">
        <div>
          <div className="flex items-center gap-3">
            <BrandLogo size="md" />
            <span className="text-2xl font-bold tracking-tight font-['Plus_Jakarta_Sans'] text-white">
              Gölge
            </span>
          </div>

          <div className="mt-10 lg:mt-20 max-w-lg">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-[1.12] [text-wrap:balance]">
              Kayıt yok. Sunucu yok. İz yok.
            </h1>
            <p className="mt-4 text-sm sm:text-base text-slate-300 leading-relaxed">
              Sadece bir kullanıcı adı seç ve konuşmaya başla. Mesajların şifrelenerek gider ve seçtiğin sürede kalıcı olarak silinir.
            </p>
          </div>
        </div>

        {/* Simple, concise 3-item strip */}
        <div className="mt-8 lg:mt-16 pt-6 border-t border-blue-500/20 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 max-w-xl">
          <div className="p-3.5 rounded-xl bg-[#0B1120]/80 border border-blue-500/20">
            <p className="text-sm font-semibold text-blue-300">IP Gizli</p>
            <p className="mt-1 text-xs text-slate-400">Kişiler birbirinin IP adresini görmez.</p>
          </div>
          <div className="p-3.5 rounded-xl bg-[#0B1120]/80 border border-rose-500/25">
            <p className="text-sm font-semibold text-rose-300">Tam Şifreli</p>
            <p className="mt-1 text-xs text-slate-400">Mesajları sadece iki taraf okuyabilir.</p>
          </div>
          <div className="p-3.5 rounded-xl bg-[#0B1120]/80 border border-blue-500/20">
            <p className="text-sm font-semibold text-white">24 / 12 / 7 / 1s</p>
            <p className="mt-1 text-xs text-slate-400">Süre dolunca otomatik yok olur.</p>
          </div>
        </div>
      </div>

      {/* Right Auth Column */}
      <div className="w-full lg:w-[490px] xl:w-[530px] flex items-center justify-center p-5 sm:p-10 bg-[#0A0E18]/90 backdrop-blur-md relative">
        <div className="hidden lg:block absolute inset-y-0 left-0 w-px bg-gradient-to-b from-blue-500/40 via-rose-500/50 to-blue-500/20" />

        <div className="w-full max-w-md">
          {pendingInviteLabel && (
            <div className="mb-5 p-3.5 rounded-xl bg-blue-600/15 border border-blue-500/35 text-xs text-blue-200">
              Davet bağlantısı: <span className="font-semibold text-white">{pendingInviteLabel}</span>
            </div>
          )}

          {/* Dikkatli Ol Warning Box */}
          <div className="mb-6 p-3.5 rounded-xl bg-rose-950/35 border border-rose-500/35 shadow-[0_0_24px_rgba(225,29,72,0.12)] flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-200 leading-relaxed">
              <span className="font-semibold text-rose-300">Dikkatli Ol:</span> Çıkış yapmadan önce gizli anahtarını mutlaka kaydet, kaybedersen hesaba tekrar giremezsin. Kasa PIN&apos;i koyman önerilir.
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#070A12] border border-blue-500/25 rounded-xl mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('create');
                setError(null);
              }}
              className={`flex-1 py-2.5 px-3 text-xs font-semibold rounded-lg transition-all whitespace-nowrap min-h-[42px] cursor-pointer ${
                mode === 'create'
                  ? 'bg-gradient-to-r from-blue-600 to-rose-600 text-white shadow-[0_0_16px_rgba(225,29,72,0.28)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Yeni Hesap
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('restore');
                setError(null);
              }}
              className={`flex-1 py-2.5 px-3 text-xs font-semibold rounded-lg transition-all whitespace-nowrap min-h-[42px] cursor-pointer ${
                mode === 'restore'
                  ? 'bg-gradient-to-r from-blue-600 to-rose-600 text-white shadow-[0_0_16px_rgba(225,29,72,0.28)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Anahtarla Giriş
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Simple Profile Photo Picker */}
            <div className="flex items-center gap-3.5 p-3 rounded-xl bg-[#070A12] border border-white/[0.08]">
              <div className="relative">
                {avatarDataUrl ? (
                  <img
                    src={avatarDataUrl}
                    alt="Profil fotoğrafı"
                    className="w-12 h-12 rounded-xl object-cover border border-rose-500/50"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Profil fotoğrafı seç"
                    className="w-12 h-12 rounded-xl bg-[#0F172A] hover:bg-[#162038] border border-blue-500/30 flex items-center justify-center text-blue-300 transition-colors cursor-pointer"
                  >
                    <Camera className="w-5 h-5" />
                  </button>
                )}
                {avatarDataUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarDataUrl(undefined)}
                    aria-label="Fotoğrafı kaldır"
                    className="w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center absolute -top-1.5 -right-1.5 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-semibold text-blue-300 hover:text-white transition-colors cursor-pointer"
                >
                  {avatarDataUrl ? 'Fotoğrafı değiştir' : 'Profil fotoğrafı ekle (İsteğe bağlı)'}
                </button>
                <p className="text-[11px] text-slate-500 mt-0.5">Sunucuya yüklenmez · Konum bilgisi silinir</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleAvatarChange}
                  className="hidden"
                />
              </div>
            </div>

            <div>
              <label htmlFor="username-input" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Kullanıcı Adı
              </label>
              <input
                id="username-input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={24}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ör. kuzey"
                className="w-full h-12 px-4 rounded-xl bg-[#070A12] border border-blue-500/25 text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500 transition-colors text-base"
              />
              <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                <span>
                  {previewClean.length >= 2 ? (
                    <>
                      Etiketin: <span className="font-mono text-rose-400">{previewClean}#••••</span>
                    </>
                  ) : (
                    'En az 2 karakter'
                  )}
                </span>
                <span className="font-mono tabular-nums">{previewClean.length}/24</span>
              </div>
            </div>

            {mode === 'restore' && (
              <div>
                <label htmlFor="nsec-input" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Gizli Anahtar
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-4" />
                  <input
                    id="nsec-input"
                    type="password"
                    autoComplete="off"
                    value={nsecInput}
                    onChange={(e) => setNsecInput(e.target.value)}
                    placeholder="nsec1..."
                    className="w-full h-12 pl-10 pr-4 rounded-xl bg-[#070A12] border border-blue-500/25 text-white font-mono text-sm placeholder:text-slate-500 focus:outline-none focus:border-rose-500 transition-colors"
                  />
                </div>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => setShowPinField((prev) => !prev)}
                className="inline-flex items-center gap-2 text-xs font-medium text-blue-300 hover:text-white transition-colors py-1.5 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5 text-rose-400" />
                {showPinField ? 'PIN alanını gizle' : 'Kasa PIN kilidi ekle (Önerilen)'}
              </button>

              {showPinField && (
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="En az 4 haneli PIN"
                  className="mt-2 w-full h-11 px-4 rounded-xl bg-[#070A12] border border-blue-500/25 text-white font-mono text-sm placeholder:text-slate-500 focus:outline-none focus:border-rose-500 transition-colors"
                />
              )}
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/35 text-xs text-rose-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || previewClean.length < 2}
              className="w-full h-12 px-5 rounded-xl bg-gradient-to-r from-blue-600 to-rose-600 hover:from-blue-500 hover:to-rose-500 disabled:opacity-45 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-[0_0_24px_rgba(225,29,72,0.28)] transition-all cursor-pointer"
            >
              <span>{submitting ? 'Hazırlanıyor...' : mode === 'create' ? 'Başla' : 'Giriş Yap'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
