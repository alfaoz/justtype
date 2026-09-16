import React, { useState, useRef, useCallback } from 'react';

// Minimal transient notice — the in-app replacement for native alert():
// a lowercase pill, bottom-center, fades itself out. One per surface:
//   const [showToast, toastNode] = useToast();
//   showToast('something went wrong');  ...  {toastNode}
export function useToast() {
  const [toast, setToast] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef(null);

  // `action` { label, onClick }: one word after the notice, for an undo
  const show = useCallback((text, { action = null, hold = 3200 } = {}) => {
    clearTimeout(timerRef.current);
    setLeaving(false);
    setToast({ text: String(text || '').toLowerCase(), action });
    timerRef.current = setTimeout(() => {
      setLeaving(true);
      timerRef.current = setTimeout(() => { setToast(null); setLeaving(false); }, 220);
    }, action ? Math.max(hold, 5000) : hold);
  }, []);
  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setLeaving(true);
    timerRef.current = setTimeout(() => { setToast(null); setLeaving(false); }, 220);
  }, []);

  const node = toast ? (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] text-sm text-[var(--theme-text-muted)] shadow-2xl whitespace-nowrap max-w-[90vw] overflow-hidden text-ellipsis flex items-center gap-4 ${leaving ? 'animate-toast-out' : 'animate-toast-in'}`}>
      <span>{toast.text}</span>
      {toast.action && (
        <button onClick={() => { toast.action.onClick(); dismiss(); }} className="text-[var(--theme-text)] hover:opacity-70 transition-opacity">
          {toast.action.label}
        </button>
      )}
    </div>
  ) : null;

  return [show, node];
}
