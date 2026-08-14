import React, { useState, useRef, useCallback } from 'react';

// Minimal transient notice — the in-app replacement for native alert():
// a lowercase pill, bottom-center, fades itself out. One per surface:
//   const [showToast, toastNode] = useToast();
//   showToast('something went wrong');  ...  {toastNode}
export function useToast() {
  const [toast, setToast] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef(null);

  const show = useCallback((text) => {
    clearTimeout(timerRef.current);
    setLeaving(false);
    setToast(String(text || '').toLowerCase());
    timerRef.current = setTimeout(() => {
      setLeaving(true);
      timerRef.current = setTimeout(() => { setToast(null); setLeaving(false); }, 220);
    }, 3200);
  }, []);

  const node = toast ? (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] text-sm text-[var(--theme-text-muted)] shadow-2xl whitespace-nowrap max-w-[90vw] overflow-hidden text-ellipsis ${leaving ? 'animate-toast-out' : 'animate-toast-in'}`}>
      {toast}
    </div>
  ) : null;

  return [show, node];
}
