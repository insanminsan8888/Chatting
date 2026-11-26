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
      setError('PIN hatalı.');
      setPin('');
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#07080C] neon-grid-bg text-[#F1F5F9] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#0B1120] border border-blue-500/25 shadow-[0_0_32px_rgba(37,99,235,0.18)] rounded-2xl p-6 sm:p-7">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600/25 to-rose-600/25 border border-rose-500/35 flex items-center justify-center text-rose-400 mb-4">
          <Lock className="w-5 h-5" />
        </div>
        <h1 className="text-xl font-bold text-white">Kasa Kilitli</h1>
        <p className="mt-1 text-sm text-slate-400">
          Devam etmek için PIN kodunuzu girin.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            className="w-full h-12 px-4 rounded-xl bg-[#070A12] border border-blue-500/25 text-white font-mono text-base tracking-widest placeholder:tracking-normal placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
          />

          {error && (
            <p role="alert" className="text-xs text-rose-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={checking || !pin.trim()}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-blue-600 to-rose-600 hover:from-blue-500 hover:to-rose-500 disabled:opacity-45 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Unlock className="w-4 h-4" />
            <span>{checking ? 'Açılıyor...' : 'Kilidi Aç'}</span>
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-white/[0.07] flex justify-end">
          <button
            type="button"
            onClick={onPanicWipe}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors py-1.5 px-2 cursor-pointer"
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Her Şeyi Sil</span>
          </button>
        </div>
      </div>
    </div>
  );
};
