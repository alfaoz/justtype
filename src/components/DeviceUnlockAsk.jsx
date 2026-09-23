import React from 'react';
import { strings } from '../strings';

// Asked once per phone, the first time a lock is set or opened here: may
// face id (or touch id) open locked slates on this device? Account > security
// changes the answer later. `word` is 'face id' or 'touch id'.
export function DeviceUnlockAsk({ word, onAnswer }) {
  const s = strings.writer.lock;
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay z-[60] flex items-center justify-center p-4" onClick={() => onAnswer(false)}>
      <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 max-w-sm w-full flex flex-col items-center text-center" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm text-[var(--theme-text)] mb-3">{s.deviceAskTitle(word)}</div>
        <div className="text-xs leading-relaxed text-[var(--theme-text-dim)] mb-6">{s.deviceAskBody(word)}</div>
        <div className="flex gap-3 w-full">
          <button onClick={() => onAnswer(true)} className="flex-1 sheet-primary bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors text-sm">{s.deviceAskYes(word)}</button>
          <button onClick={() => onAnswer(false)} className="flex-1 sheet-secondary border border-[var(--theme-border)] text-[var(--theme-accent)] px-6 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm">{s.deviceAskNo}</button>
        </div>
      </div>
    </div>
  );
}
