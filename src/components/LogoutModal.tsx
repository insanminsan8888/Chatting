import React, { useState } from 'react';
import { Check, Copy, Eye, EyeOff, LogOut, X } from 'lucide-react';
import type { LocalIdentity } from '../types/kapsul';
import { exportNsec } from '../lib/crypto';

interface LogoutModalProps {
  identity: LocalIdentity;
  onConfirmLogout: () => Promise<void>;
  onCancel: () => void;
}

export const LogoutModal: React.FC<LogoutModalProps> = ({
  identity,
  onConfirmLogout,
  onCancel,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmedBackup, setConfirmedBackup] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const nsec = exportNsec(identity);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(nsec);
      setCopied(true);
      setConfirmedBackup(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await onConfirmLogout();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-modal-title"
    >
      <div className="w-full max-w-md bg-[#11141B] border border-white/[0.08] rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <LogOut className="w-5 h-5" />
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="İptal"
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <h2 id="logout-modal-title" className="mt-4 text-lg font-bold text-white">
          Oturumdan Çıkış Yap
        </h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">
          Çıkış yaptığınızda bu tarayıcıdaki yerel kasa kapatılır ve silinir. Aynı hesaba ({identity.handle}) daha sonra veya başka bir cihazdan tekrar girmek için aşağıdaki <span className="font-mono text-amber-300">nsec1</span> anahtarını mutlaka kaydedin.
        </p>

        <div className="mt-4 p-3.5 rounded-xl bg-[#090B0F] border border-white/[0.07]">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-slate-300">Gizli Giriş Anahtarınız</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowKey((p) => !p)}
                className="h-8 px-2.5 rounded-lg bg-[#171B24] hover:bg-[#1E2430] text-xs text-slate-300 inline-flex items-center gap-1 cursor-pointer"
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showKey ? 'Gizle' : 'Göster'}</span>
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="h-8 px-2.5 rounded-lg bg-[#171B24] hover:bg-[#1E2430] text-xs text-emerald-400 inline-flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Kopyalandı' : 'Kopyala'}</span>
              </button>
            </div>
          </div>
          <p className="font-mono text-[11px] text-amber-300 break-all select-all">
            {showKey ? nsec : 'nsec1••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
          </p>
        </div>

        <label className="mt-4 flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={confirmedBackup}
            onChange={(e) => setConfirmedBackup(e.target.checked)}
            className="w-4 h-4 accent-emerald-500 rounded"
          />
          <span>Anahtarımı yedekledim veya bu hesaptan tamamen çıkmak istiyorum</span>
        </label>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 px-4 rounded-xl bg-[#171B24] hover:bg-[#1E2430] border border-white/[0.08] text-sm font-medium text-slate-200 transition-colors cursor-pointer"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={!confirmedBackup || loggingOut}
            onClick={handleLogout}
            className="h-11 px-5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{loggingOut ? 'Çıkış yapılıyor...' : 'Çıkış Yap'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
