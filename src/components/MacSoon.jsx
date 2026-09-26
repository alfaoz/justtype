import React from 'react';
import { strings } from '../strings';

// /mac: the Mac app's icon (rendered from JT_ICON.icon) and a coming soon,
// until there is a download to put here.
export function MacSoon() {
  return (
    <div className="min-h-screen font-mono flex flex-col" style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text-muted)' }}>
      <main className="flex-grow flex flex-col items-center justify-center gap-6 p-4">
        <img
          src="/mac-icon.webp"
          alt={strings.mac.icon}
          width="160"
          height="160"
          draggable="false"
          className="w-32 h-32 md:w-40 md:h-40 select-none"
        />
        <p className="text-sm" style={{ color: 'var(--theme-text-dim)' }}>{strings.mac.soon}</p>
      </main>
    </div>
  );
}
