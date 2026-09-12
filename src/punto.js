// The writing size steps (`size: small base large larger`), shared by the
// writer, the public reader and the account page. The classes live in
// index.css as .punto-*; the choice is per device (localStorage) and every
// view hears about a change through usePunto.
import { useEffect, useState } from 'react';

export const PUNTO_SIZES = ['small', 'base', 'large', 'larger'];
const KEY = 'justtype-punto';
const listeners = new Set();

export const readPunto = () => {
  try { const v = localStorage.getItem(KEY); return PUNTO_SIZES.includes(v) ? v : 'base'; } catch { return 'base'; }
};

export function setPunto(v) {
  if (!PUNTO_SIZES.includes(v)) return;
  try { localStorage.setItem(KEY, v); } catch {}
  for (const l of listeners) l(v);
}

export const nextPunto = (p) => PUNTO_SIZES[(PUNTO_SIZES.indexOf(p) + 1) % PUNTO_SIZES.length];

export function usePunto() {
  const [p, setP] = useState(readPunto);
  useEffect(() => { listeners.add(setP); return () => listeners.delete(setP); }, []);
  return p;
}
