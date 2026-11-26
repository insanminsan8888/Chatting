import React from 'react';
import type { RelayHealth } from '../types/kapsul';

interface ConnectionVisualProps {
  relayHealth: RelayHealth[];
  variant?: 'compact' | 'banner';
}

export const ConnectionVisual: React.FC<ConnectionVisualProps> = ({
  relayHealth,
  variant = 'compact',
}) => {
  const total = Math.max(1, relayHealth.length);
  const connected = relayHealth.filter((r) => r.status === 'connected').length;
  const connecting = relayHealth.filter((r) => r.status === 'connecting').length;

  const filledBars =
    connected === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((connected / total) * 4)));

  const statusLabel =
    connected > 0
      ? `Bağlı · ${connected}/${total}`
      : connecting > 0
      ? 'Bağlanıyor...'
      : 'Çevrimdışı';

  const textColor =
    connected > 0
      ? 'text-blue-300'
      : connecting > 0
      ? 'text-amber-300'
      : 'text-rose-400';

  const barHeights = ['h-1.5', 'h-2.5', 'h-3.5', 'h-4'];

  if (variant === 'banner') {
    return (
      <div className="p-3.5 rounded-xl bg-[#070A12] border border-blue-500/20 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0B1120] border border-blue-500/30 flex items-end justify-center gap-1 pb-2.5">
            {barHeights.map((hClass, idx) => {
              const active = idx < filledBars;
              return (
                <span
                  key={hClass}
                  className={`w-1 rounded-sm transition-colors ${hClass} ${
                    active
                      ? connected >= 2
                        ? 'bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.6)]'
                        : 'bg-amber-400'
                      : connecting > 0 && idx === 0
                      ? 'bg-amber-400/60'
                      : 'bg-slate-700'
                  }`}
                />
              );
            })}
          </div>
          <div>
            <p className={`text-xs font-semibold ${textColor}`}>{statusLabel}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {connected > 0
                ? 'Şifreli ağ kanalı hazır'
                : connecting > 0
                ? 'Röle sunucularına bağlanılıyor'
                : 'Ağ bağlantısı yok, yenilemeyi dene'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {relayHealth.map((r) => (
            <span
              key={r.url}
              title={`${r.url}: ${r.status}`}
              className={`w-2 h-2 rounded-full ${
                r.status === 'connected'
                  ? 'bg-blue-400 shadow-[0_0_6px_rgba(59,130,246,0.8)]'
                  : r.status === 'connecting'
                  ? 'bg-amber-400'
                  : 'bg-rose-500'
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-end gap-[2px] h-4" aria-hidden="true">
        {barHeights.map((hClass, idx) => {
          const active = idx < filledBars;
          return (
            <span
              key={hClass}
              className={`w-[3px] rounded-xs transition-colors ${hClass} ${
                active
                  ? connected >= 2
                    ? 'bg-blue-400 shadow-[0_0_6px_rgba(59,130,246,0.65)]'
                    : 'bg-amber-400'
                  : connecting > 0 && idx === 0
                  ? 'bg-amber-400/60'
                  : 'bg-rose-500/45'
              }`}
            />
          );
        })}
      </div>
      <span className={`text-xs font-medium tabular-nums ${textColor}`}>{statusLabel}</span>
    </div>
  );
};
