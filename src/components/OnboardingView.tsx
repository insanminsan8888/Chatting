import React, { useState } from 'react';
import { ArrowRight, KeyRound, Lock, Shield, Sparkles } from 'lucide-react';
import { sanitizeUsername } from '../lib/crypto';

interface OnboardingViewProps {
  onCreateIdentity: (username: string, pin?: string) => Promise<void>;
  onRestoreIdentity: (username: string, nsecOrHex: string, pin?: string) => Promise<void>;
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewClean = sanitizeUsername(username);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = sanitizeUsername(username);
    if (clean.length < 2) {
      setError('Kullanıcı adı en az 2 geçerli karakter olmalıdır.');
      return;
    }
    if (showPinField && pin.trim().length > 0 && pin.trim().length < 4) {
      setError('Kasa PIN kodu en az 4 karakter olmalıdır.');
      return;
    }

    setSubmitting(true);
    try {
      const cleanPin = showPinField && pin.trim().length >= 4 ? pin.trim() : undefined;
      if (mode === 'create') {
        await onCreateIdentity(clean, cleanPin);
      } else {
        await onRestoreIdentity(clean, nsecInput, cleanPin);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kimlik oluşturulamadı.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#090B0F] text-[#F1F5F9] flex flex-col lg:flex-row">
      {/* Left Narrative Column */}
      <div className="flex-1 flex flex-col justify-between p-6 sm:p-10 lg:p-16 border-b lg:border-b-0 lg:border-r border-white/[0.07]">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight font-['Plus_Jakarta_Sans']">Kapsül</span>
          </div>

          <div className="mt-12 lg:mt-20 max-w-xl">
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white leading-[1.12] [text-wrap:balance]">
              Sunucusuz, kayıtsız ve otomatik silinen özel mesajlaşma.
            </h1>
            <p className="mt-5 text-base sm:text-lg text-slate-400 leading-relaxed max-w-lg">
              Telefon numarası, e-posta veya bulut veritabanı yok. Yalnızca bir kullanıcı adı seçin; mesajlar cihazınızdan uçtan uca şifrelenmiş mühürlü zarflarla çıkar ve seçtiğiniz sürede tamamen yok olur.
            </p>
          </div>
        </div>

        <div className="mt-10 lg:mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6 pt-8 border-t border-white/[0.07] max-w-2xl">
          <div>
            <p className="text-sm font-semibold text-white">IP Gizliliği</p>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Doğrudan bağlantı kurulmaz. Açık röle ağı üzerinden konuşulur; karşı taraf IP adresinizi göremez.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Mühürlü Zarf E2EE</p>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              NIP-44 + tek kullanımlık geçici anahtarlar ve sabit blok dolgu ile gönderen kimliği ve boyutu gizlenir.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">24 / 12 / 7 / 1 Saat</p>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              Varsayılan 24 saatlik sayaç dolduğunda mesajlar cihaz içi şifreli kasadan kalıcı olarak silinir.
            </p>
          </div>
        </div>
      </div>

      {/* Right Onboarding Form Column */}
      <div className="w-full lg:w-[500px] xl:w-[540px] flex items-center justify-center p-6 sm:p-10 lg:p-14 bg-[#0D1016]">
        <div className="w-full max-w-md">
          {pendingInviteLabel && (
            <div className="mb-6 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-200 leading-relaxed">
              Davet bağlantısı algılandı: <span className="font-semibold text-white">{pendingInviteLabel}</span> ile konuşmak için kullanıcı adınızı belirleyin.
            </div>
          )}

          <div className="flex items-center gap-1 p-1 bg-[#141821] border border-white/[0.07] rounded-xl mb-7">
            <button
              type="button"
              onClick={() => {
                setMode('create');
                setError(null);
              }}
              className={`flex-1 py-2.5 px-3 text-xs font-medium rounded-lg transition-colors whitespace-nowrap min-h-[40px] ${
                mode === 'create'
                  ? 'bg-[#1D2330] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Yeni Kullanıcı Adı Seç
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('restore');
                setError(null);
              }}
              className={`flex-1 py-2.5 px-3 text-xs font-medium rounded-lg transition-colors whitespace-nowrap min-h-[40px] ${
                mode === 'restore'
                  ? 'bg-[#1D2330] text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Anahtarla Geri Yükle
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="username-input" className="block text-sm font-medium text-slate-200 mb-2">
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
                className="w-full h-12 px-4 rounded-xl bg-[#141821] border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors text-base"
              />
              <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                <span>
                  {previewClean.length >= 2 ? (
                    <>
                      Görünür etiket: <span className="font-mono text-emerald-400">{previewClean}#••••</span>
                    </>
                  ) : (
                    'En az 2 karakter · Gerçek ad gerekmez'
                  )}
                </span>
                <span className="font-mono tabular-nums">{previewClean.length}/24</span>
              </div>
            </div>

            {mode === 'restore' && (
              <div>
                <label htmlFor="nsec-input" className="block text-sm font-medium text-slate-200 mb-2">
                  Gizli Anahtar (nsec1...)
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
                    className="w-full h-12 pl-10 pr-4 rounded-xl bg-[#141821] border border-white/10 text-white font-mono text-sm placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
              </div>
            )}

            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowPinField((prev) => !prev)}
                className="inline-flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white transition-colors py-1"
              >
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                {showPinField ? 'Kasa PIN korumasını kaldır' : 'Cihaz içi kasa PIN kilidi ekle (İsteğe bağlı)'}
              </button>

              {showPinField && (
                <div className="mt-3">
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="En az 4 haneli PIN belirleyin"
                    className="w-full h-11 px-4 rounded-xl bg-[#141821] border border-white/10 text-white font-mono text-sm placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                  <p className="mt-1.5 text-xs text-slate-400">
                    PIN eklendiğinde cihazınızdaki şifreli kasa yalnızca bu PIN ile açılır (PBKDF2 + AES-256-GCM).
                  </p>
                </div>
              )}
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || previewClean.length < 2}
              className="w-full h-12 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 disabled:hover:bg-emerald-600 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>{submitting ? 'Anahtarlar üretiliyor...' : mode === 'create' ? 'Anonim Kimlik Oluştur' : 'Kimliği Geri Yükle'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <div className="pt-3 flex items-center gap-2 text-xs text-slate-500">
              <Sparkles className="w-3.5 h-3.5 shrink-0 text-slate-400" />
              <span>Özel anahtarınız yalnızca bu tarayıcıda üretilir ve hiçbir sunucuya gönderilmez.</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
