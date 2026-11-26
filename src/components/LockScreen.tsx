import React, { useState } from 'react';
import { Flame, Lock, Unlock } from 'lucide-react';

interface LockScreenProps {
  onUnlock: (pin: string) => Promise<boolean>;
  onPanicWipe: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock, onPanicWipe }) => {
  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    setChecking(true);
    setError(null);
    const ok = await onUnlock(pin.trim());
    setChecking(false);
    if (!ok) {
      setError('PIN hatalı. Kasa açılamadı.');
      setPin('');
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#090B0F] text-[#F1F5F9] flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-[#11141B] border border-white/[0.08] rounded-2xl p-7">
        <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-5">
          <Lock className="w-5 h-5" />
        </div>
        <h1 className="text-xl font-bold text-white">Kasa Kilitli</h1>
        <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
          Yerel mesaj kasasını ve şifreleme anahtarlarını açmak için PIN kodunuzu girin.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN kodunuz"
            className="w-full h-12 px-4 rounded-xl bg-[#090B0F] border border-white/10 text-white font-mono text-base tracking-widest placeholder:tracking-normal placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />

          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={checking || !pin.trim()}
            className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Unlock className="w-4 h-4" />
            <span>{checking ? 'Doğrulanıyor...' : 'Kasayı Aç'}</span>
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-white/[0.07] flex justify-end">
          <button
            type="button"
            onClick={onPanicWipe}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors py-1.5 px-2 cursor-pointer"
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Kasayı Kalıcı Sil</span>
          </button>
        </div>
      </div>
    </div>
  );
};
