import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Link2, X } from 'lucide-react';
import type { LocalIdentity } from '../types/kapsul';
import { createInviteToken, createInviteUrl } from '../lib/crypto';

interface InviteModalProps {
  identity: LocalIdentity;
  onClose: () => void;
}

export const InviteModal: React.FC<InviteModalProps> = ({ identity, onClose }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copiedType, setCopiedType] = useState<'handle' | 'link' | 'token' | 'npub' | null>(null);

  const inviteUrl = createInviteUrl(identity);
  const inviteToken = createInviteToken(identity);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(inviteUrl, {
      width: 220,
      margin: 2,
      color: {
        dark: '#F1F5F9',
        light: '#11141B',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [inviteUrl]);

  const copyValue = async (type: 'handle' | 'link' | 'token' | 'npub', val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
    >
      <div className="w-full max-w-md bg-[#11141B] border border-white/[0.08] rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.07]">
          <div>
            <h2 id="invite-modal-title" className="text-lg font-bold text-white">
              Kimlik ve Davet Paylaş
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Karşı taraf sizi kullanıcı adınızla arayabilir veya davet linkiyle doğrudan ekleyebilir.
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

        <div className="mt-5 flex flex-col items-center">
          <div className="p-3 rounded-2xl bg-[#11141B] border border-white/[0.08]">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Kapsül davet QR kodu" className="w-44 h-44 rounded-lg" />
            ) : (
              <div className="w-44 h-44 flex items-center justify-center text-xs text-slate-500">
                QR hazırlanıyor...
              </div>
            )}
          </div>
          <div className="mt-3 text-center">
            <p className="font-mono text-base font-semibold text-emerald-400">{identity.handle}</p>
            <p className="text-xs text-slate-500 mt-0.5">IP adresi paylaşılmaz · Yalnızca açık anahtar</p>
          </div>
        </div>

        <div className="mt-5 space-y-2.5">
          <button
            type="button"
            onClick={() => copyValue('link', inviteUrl)}
            className="w-full h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            {copiedType === 'link' ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
            <span>{copiedType === 'link' ? 'Davet Bağlantısı Kopyalandı' : 'Tek Tıkla Davet Linkini Kopyala'}</span>
          </button>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => copyValue('handle', identity.handle)}
              className="h-10 px-3 rounded-xl bg-[#171B24] hover:bg-[#1E2430] border border-white/[0.07] text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedType === 'handle' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>{copiedType === 'handle' ? 'Kopyalandı' : 'Kullanıcı Adı'}</span>
            </button>

            <button
              type="button"
              onClick={() => copyValue('token', inviteToken)}
              className="h-10 px-3 rounded-xl bg-[#171B24] hover:bg-[#1E2430] border border-white/[0.07] text-xs font-medium text-slate-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              {copiedType === 'token' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>{copiedType === 'token' ? 'Kopyalandı' : 'Kapsül Kodu'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
