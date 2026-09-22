// A device preference: one word kept in localStorage, a hook every view can
// read it through, and (optionally) an attribute on <html> for CSS to key on.
// motion.js, scale.js and punto.js are each one of these.
import { useEffect, useState } from 'react';
import { inShell } from './shell';

// inApp: false for a choice the app does not offer; there a stored value is
// ignored (nothing could change it back) and the fallback holds.
export function makePref({ key, values, fallback, attr = null, inApp = true }) {
  const listeners = new Set();
  const stored = () => {
    if (!inApp && inShell) return null;
    try { const v = localStorage.getItem(key); return values.includes(v) ? v : null; } catch { return null; }
  };
  const get = () => stored() || (typeof fallback === 'function' ? fallback() : fallback);
  const apply = (v) => {
    if (attr && typeof document !== 'undefined') document.documentElement.dataset[attr] = v;
    for (const l of listeners) l(v);
  };
  const set = (v) => {
    if (!values.includes(v)) return;
    try { localStorage.setItem(key, v); } catch {}
    apply(v);
  };
  const use = () => {
    const [v, setV] = useState(get);
    useEffect(() => { listeners.add(setV); return () => listeners.delete(setV); }, []);
    return v;
  };
  const next = (v) => values[(values.indexOf(v) + 1) % values.length];
  // Hear every change from outside React (the value applied)
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  if (attr && typeof document !== 'undefined') apply(get());
  return { values, get, set, use, next, stored, apply, subscribe };
}
