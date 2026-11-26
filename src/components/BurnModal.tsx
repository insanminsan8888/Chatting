import React from 'react';
import { AlertTriangle, Flame, X } from 'lucide-react';

interface BurnModalProps {
  mode: 'all' | 'chat';
  peerHandle?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const BurnModal: React.FC<BurnModalProps> = ({
  mode,
  peerHandle,
  onConfirm,
  onCancel,
}) => {
  const isAll = mode === 'all';

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
            <AlertTriangle className="w-5 h-5" />
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
          {isAll ? 'Her Şeyi Kalıcı Sil' : `${peerHandle ?? 'Sohbet'} Geçmişini Sil`}
        </h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">
          {isAll
            ? 'Tüm sohbetler, kişiler ve gizli anahtarın cihazdan anında silinir. Geri alınamaz.'
            : 'Bu sohbetteki tüm mesajlar iki taraftan da kalıcı olarak silinecek.'}
        </p>

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
            onClick={onConfirm}
            className="h-11 px-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-[0_0_18px_rgba(225,29,72,0.35)] transition-colors cursor-pointer"
          >
            <Flame className="w-4 h-4" />
            <span>{isAll ? 'Her Şeyi Yak' : 'Sohbeti Yak'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
