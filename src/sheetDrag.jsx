// The app's side panels (collab, share) are sheets on the phone: they rise
// from the bottom, and pulling the top edge down lets one go, the way every
// sheet on iOS does. A short pull springs back. In a browser nothing here
// runs: the panels keep their own slide.
import { useEffect, useRef } from 'react';
import { inShell } from './shell';

const GRAB = 64; // the band at the top that takes the pull (grabber + tabs)

export function useSheetDrag(ref, onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!inShell || !el) return undefined;
    let startY = null;
    let lastY = 0;
    let lastT = 0;
    let speed = 0;
    const narrow = window.matchMedia('(max-width: 767px)');
    const onStart = (e) => {
      if (!narrow.matches) return; // wider, the panel is a side panel
      const t = e.touches[0];
      if (t.clientY - el.getBoundingClientRect().top > GRAB) return;
      startY = t.clientY; lastY = t.clientY; lastT = e.timeStamp; speed = 0;
      el.style.animation = 'none';
      el.style.transition = 'none';
    };
    const onMove = (e) => {
      if (startY === null) return;
      const y = e.touches[0].clientY;
      speed = (y - lastY) / Math.max(1, e.timeStamp - lastT);
      lastY = y; lastT = e.timeStamp;
      el.style.transform = `translateY(${Math.max(0, y - startY)}px)`;
    };
    const onEnd = () => {
      if (startY === null) return;
      const pulled = lastY - startY;
      startY = null;
      if (pulled > 110 || (pulled > 24 && speed > 0.5)) {
        el.style.transition = 'transform 0.22s cubic-bezier(0.4, 0, 1, 1)';
        el.style.transform = 'translateY(100%)';
        el.dataset.leaving = 'true';
        setTimeout(() => closeRef.current(), 220);
      } else {
        el.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = '';
        // Nothing may stay applied at rest (see .collab-panel in index.css)
        setTimeout(() => { el.style.transition = ''; }, 300);
      }
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [ref]);
}

// The dimmed page behind a sheet; a tap on it closes the sheet
export function SheetBackdrop({ closing, onClose }) {
  if (!inShell) return null;
  return <div className="sheet-backdrop" data-closing={closing ? 'true' : 'false'} onClick={onClose} aria-hidden="true" />;
}
