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
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="burn-modal-title"
    >
      <div className="w-full max-w-md bg-[#11141B] border border-red-500/25 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="w-11 h-11 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
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
          {isAll ? 'Her Şeyi Kalıcı Olarak Yak' : `${peerHandle ?? 'Sohbet'} Geçmişini Yak`}
        </h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">
          {isAll
            ? 'Bu işlem tarayıcınızdaki tüm şifreli sohbetleri, kişileri, PIN yapılandırmasını ve gizli kimlik anahtarınızı anında yok eder. Geri dönüşü yoktur.'
            : 'Bu sohbetteki tüm mesajlar cihazınızdan kalıcı olarak silinecek ve karşı tarafa da şifreli imha sinyali gönderilecektir.'}
        </p>

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
            onClick={onConfirm}
            className="h-11 px-5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Flame className="w-4 h-4" />
            <span>{isAll ? 'Tüm Veriyi Yok Et' : 'Sohbeti Yak'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
