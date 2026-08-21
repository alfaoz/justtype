import React from 'react';
import { strings } from '../strings';
import { useEscape } from '../useEscape';
import { withViewTransition } from '../viewTransition';

/**
 * One-time "the app you already use just changed" card, shown to a signed-in
 * user the first time they open justtype on v4. Deliberately small: it names
 * the two things that actually changed, offers the tour, and gets out of the
 * way. Dismissal is recorded per browser in localStorage.
 */
export function WhatsNewModal({ onClose, onTakeTour }) {
  const s = strings.whatsNewModal;
  const close = () => withViewTransition(onClose);

  useEscape(true, close);

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center z-[60] p-4 overflow-y-auto animate-modal-overlay"
      onClick={close}
    >
      <div
        className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded-lg w-full max-w-sm my-4 overflow-hidden animate-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes wnmCaret { 0%, 45% { opacity: 1; } 50%, 100% { opacity: 0.25; } }
          @keyframes wnmSweep { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
          .wnm-sweep::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, transparent, var(--theme-bg-tertiary), transparent);
            animation: wnmSweep 3.2s ease-in-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .wnm-sweep::after { animation: none; }
          }
        `}</style>

        {/* banner */}
        <div className="wnm-sweep relative overflow-hidden border-b border-[var(--theme-border)] bg-[var(--theme-bg)] px-6 py-8 text-center">
          <div className="relative z-10">
            <div className="text-2xl text-[var(--theme-accent)] select-none">
              {strings.app.logo}
              <span
                className="inline-block w-[2px] h-5 align-middle ml-1 bg-[var(--theme-accent)]"
                style={{ animation: 'wnmCaret 1.1s steps(1) infinite' }}
              />
            </div>
            <div className="mt-2 text-xs tracking-[0.3em] uppercase text-[var(--theme-text-dim)] pl-[0.3em]">{s.version}</div>
          </div>
        </div>

        <div className="px-6 pt-6 pb-5">
          <h2 className="text-lg text-white mb-2">{s.title}</h2>
          <p className="text-sm text-[var(--theme-text-muted)] leading-relaxed mb-5">{s.body}</p>

          <ul className="space-y-2.5 mb-6">
            {s.points.map((point) => (
              <li key={point} className="flex gap-2.5 text-sm text-[var(--theme-text-muted)]">
                <span className="text-green-500 shrink-0 mt-px">+</span>
                <span className="leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>

          <div className="flex gap-2">
            <button
              onClick={() => withViewTransition(onTakeTour)}
              className="flex-1 h-11 border border-[var(--theme-border)] rounded text-sm hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-colors"
            >
              {s.tour}
            </button>
            <button
              onClick={close}
              className="flex-1 h-11 bg-white text-black rounded text-sm font-medium hover:bg-[#e5e5e5] transition-colors"
            >
              {s.dismiss}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
