import React, { useState } from 'react';
import { AlertTriangle, Flame, Trash2, UserX, X } from 'lucide-react';

interface BurnModalProps {
  mode: 'all' | 'chat' | 'remove_peer' | 'delete_account';
  peerHandle?: string;
  onConfirm: (options?: { burnRemoteAlso?: boolean }) => void | Promise<void>;
  onCancel: () => void;
}

export const BurnModal: React.FC<BurnModalProps> = ({
  mode,
  peerHandle,
  onConfirm,
  onCancel,
}) => {
  const [burnRemoteAlso, setBurnRemoteAlso] = useState(true);
  const [confirmWord, setConfirmWord] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isDeleteAccount = mode === 'delete_account';

  const title =
    mode === 'all'
      ? 'Cihazdaki Her Şeyi Yak'
      : mode === 'delete_account'
      ? 'Hesabı Kalıcı Sil'
      : mode === 'remove_peer'
      ? `${peerHandle ?? 'Kişiyi'} ve Sohbeti Sil`
      : `${peerHandle ?? 'Sohbet'} Mesajlarını Yak`;

  const description =
    mode === 'all'
      ? 'Bu cihazdaki tüm sohbetler, kişiler ve gizli anahtar anında silinir. Hesabın ağ aramalarında kalmaya devam eder; komple silmek için Ayarlar > Hesabı Kalıcı Sil seçeneğini kullanabilirsin.'
      : mode === 'delete_account'
      ? 'Kullanıcı adın ve profil fotoğrafın ağ arama listesinden silinir, tüm sohbetlerin cihazdan yok edilir ve gizli anahtarın sıfırlanır. Bu hesap bir daha geri açılamaz!'
      : mode === 'remove_peer'
      ? 'Bu kişi sohbet listenden tamamen kaldırılacak ve tüm mesajları kalıcı olarak silinecek.'
      : 'Bu sohbetteki tüm mesajlar iki taraftan da kalıcı olarak silinecek.';

  const canConfirm = !isDeleteAccount || confirmWord.trim().toUpperCase() === 'SİL';

  const handleConfirmClick = async () => {
    if (!canConfirm || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm({ burnRemoteAlso });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="burn-modal-title"
    >
      <div className="w-full max-w-md bg-[#0B1120] border border-rose-500/35 shadow-[0_0_32px_rgba(225,29,72,0.22)] rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="w-11 h-11 rounded-xl bg-rose-500/15 border border-rose-500/35 flex items-center justify-center text-rose-400 shrink-0">
            {isDeleteAccount ? <UserX className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
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

        <h2 id="burn-modal-title" className="mt-4 text-lg font-bold text-white">
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">{description}</p>

        {(mode === 'remove_peer' || isDeleteAccount) && (
          <label className="mt-4 flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={burnRemoteAlso}
              onChange={(e) => setBurnRemoteAlso(e.target.checked)}
              className="w-4 h-4 accent-rose-500 rounded"
            />
            <span>
              {isDeleteAccount
                ? 'Konuştuğum kişilerdeki mesaj geçmişini de yak'
                : 'Karşı taraftaki mesaj geçmişini de yak'}
            </span>
          </label>
        )}

        {isDeleteAccount && (
          <div className="mt-4">
            <label htmlFor="delete-confirm-input" className="block text-xs text-slate-400 mb-1.5">
              Onaylamak için aşağıya <span className="font-mono font-bold text-rose-300">SİL</span> yaz:
            </label>
            <input
              id="delete-confirm-input"
              type="text"
              autoFocus
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              placeholder="SİL"
              className="w-full h-11 px-3.5 rounded-xl bg-[#070A12] border border-rose-500/35 text-sm font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-500"
            />
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 px-4 rounded-xl bg-[#111A2E] hover:bg-[#17233D] border border-blue-500/25 text-sm font-medium text-slate-200 transition-colors cursor-pointer"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={!canConfirm || submitting}
            onClick={handleConfirmClick}
            className="h-11 px-5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-[0_0_18px_rgba(225,29,72,0.35)] transition-colors cursor-pointer"
          >
            {mode === 'remove_peer' || isDeleteAccount ? (
              <Trash2 className="w-4 h-4" />
            ) : (
              <Flame className="w-4 h-4" />
            )}
            <span>
              {submitting
                ? 'Siliniyor...'
                : mode === 'all'
                ? 'Her Şeyi Yak'
                : isDeleteAccount
                ? 'Hesabı Kalıcı Sil'
                : mode === 'remove_peer'
                ? 'Kişiyi ve Sohbeti Sil'
                : 'Sohbeti Yak'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
