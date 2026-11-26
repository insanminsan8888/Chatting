import React, { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, ShieldCheck, X } from 'lucide-react';
import type { LocalIdentity, PeerContact } from '../types/kapsul';
import { computeSafetyNumber } from '../lib/crypto';

interface SafetyModalProps {
  identity: LocalIdentity;
  peer: PeerContact;
  onSavePeerSecurity: (pubkey: string, updates: { verifiedFingerprint?: boolean; sharedSecret?: string }) => void;
  onClose: () => void;
}

export const SafetyModal: React.FC<SafetyModalProps> = ({
  identity,
  peer,
  onSavePeerSecurity,
  onClose,
}) => {
  const [safetyCode, setSafetyCode] = useState<string>('Hesaplanıyor...');
  const [sharedSecret, setSharedSecret] = useState<string>(peer.sharedSecret ?? '');
  const [verified, setVerified] = useState<boolean>(Boolean(peer.verifiedFingerprint));

  useEffect(() => {
    computeSafetyNumber(identity.pubkey, peer.pubkey).then(setSafetyCode);
  }, [identity.pubkey, peer.pubkey]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSavePeerSecurity(peer.pubkey, {
      verifiedFingerprint: verified,
      sharedSecret: sharedSecret.trim() || undefined,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="safety-modal-title"
    >
      <div className="w-full max-w-lg bg-[#0B1120] border border-blue-500/30 shadow-[0_0_32px_rgba(37,99,235,0.2)] rounded-2xl p-6">
        <div className="flex items-center justify-between pb-4 border-b border-blue-500/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/35 flex items-center justify-center text-blue-300">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 id="safety-modal-title" className="text-lg font-bold text-white">
                Güvenlik · {peer.handle}
              </h2>
              <p className="text-xs text-slate-400">
                Kod doğrulama ve ekstra ortak şifre
              </p>
            </div>
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

        <form onSubmit={handleSave} className="mt-5 space-y-5">
          <div>
            <p className="text-sm font-semibold text-white">Güvenlik Kodu</p>
            <p className="mt-1 text-xs text-slate-400">
              İki cihazda da aynı sayı görünüyorsa konuştuğun kişi gerçekten odur.
            </p>
            <div className="mt-3 p-4 rounded-xl bg-[#070A12] border border-blue-500/25 font-mono text-base sm:text-lg tracking-wider text-blue-300 text-center tabular-nums">
              {safetyCode}
            </div>
            <label className="mt-3 inline-flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer select-none py-1">
              <input
                type="checkbox"
                checked={verified}
                onChange={(e) => setVerified(e.target.checked)}
                className="w-4 h-4 rounded accent-rose-500"
              />
              <CheckCircle2 className={`w-4 h-4 ${verified ? 'text-blue-400' : 'text-slate-500'}`} />
              <span>Doğruladım</span>
            </label>
          </div>

          <div className="pt-4 border-t border-white/[0.07]">
            <label htmlFor="shared-secret-input" className="flex items-center gap-2 text-sm font-semibold text-white">
              <KeyRound className="w-4 h-4 text-rose-400" />
              <span>Ekstra Ortak Parola (İsteğe bağlı)</span>
            </label>
            <p className="mt-1 text-xs text-slate-400">
              İki taraf da aynı kelimeyi yazarsa mesajlar ikinci kez şifrelenir.
            </p>
            <input
              id="shared-secret-input"
              type="password"
              autoComplete="off"
              value={sharedSecret}
              onChange={(e) => setSharedSecret(e.target.value)}
              placeholder="Boş bırakılabilir"
              className="mt-2.5 w-full h-11 px-3.5 rounded-xl bg-[#070A12] border border-blue-500/25 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-xl bg-[#111A2E] hover:bg-[#17233D] border border-blue-500/25 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
            >
              Kapat
            </button>
            <button
              type="submit"
              className="h-10 px-5 rounded-xl bg-gradient-to-r from-blue-600 to-rose-600 hover:from-blue-500 hover:to-rose-500 text-white text-xs font-semibold transition-all cursor-pointer"
            >
              Kaydet
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
