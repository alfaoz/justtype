// Motion: on or off for the whole app. Off means every animation and
// transition collapses to nothing (index.css, html[data-motion="off"]), the
// text morphs render plainly, and view transitions are skipped. The default
// follows the system's reduced-motion preference; the settings row's
// `motion: on/off` pins it for this device.
import { useEffect, useState } from 'react';

const KEY = 'justtype-motion';
const listeners = new Set();
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

const stored = () => {
  try { const v = localStorage.getItem(KEY); return v === 'on' || v === 'off' ? v : null; } catch { return null; }
};

export function getMotion() {
  return stored() || (media?.matches ? 'off' : 'on');
}

function apply(v) {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = v;
  for (const l of listeners) l(v);
}

export function setMotion(v) {
  try { localStorage.setItem(KEY, v); } catch {}
  apply(v);
}

export const motionOff = () => getMotion() === 'off';

export function useMotion() {
  const [m, setM] = useState(getMotion);
  useEffect(() => { listeners.add(setM); return () => listeners.delete(setM); }, []);
  return m;
}

// Startup: mark the document, and follow the system while nothing is pinned
if (typeof document !== 'undefined') {
  apply(getMotion());
  media?.addEventListener?.('change', () => { if (!stored()) apply(getMotion()); });
}
