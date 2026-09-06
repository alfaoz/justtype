// Connectivity as app state. Offline is a state of the world, not an error.
//
// navigator.onLine says true on captive portals and false only when the
// device has no interface at all, so it is a hint: every transition is
// confirmed by a probe against /api/health, and any failed API call in the
// app can ask for the same confirmation via reportNetworkFailure().
//
// The same module watches for a newer build: the running app compares its
// own version with the live manifest when the tab regains focus or the
// network comes back. This is the guard against sitting on a stale UI now
// that the service worker caches the shell.
import { useEffect, useState } from 'react';
import { API_URL } from './config';
import { VERSION } from './version';

const state = { online: typeof navigator === 'undefined' ? true : navigator.onLine, updateAvailable: false };
const listeners = new Set();
const emit = () => { for (const l of listeners) l({ ...state }); };

let probeTimer = null;
let probing = null;
const OFFLINE_RECHECK_MS = 15000;

function setOnline(online) {
  if (state.online !== online) {
    state.online = online;
    emit();
    if (online) checkVersion();
  }
  clearTimeout(probeTimer);
  if (!online) probeTimer = setTimeout(probe, OFFLINE_RECHECK_MS);
}

function probe() {
  if (probing) return probing;
  probing = fetch(`${API_URL}/health`, { cache: 'no-store' })
    .then(r => setOnline(r.ok), () => setOnline(false))
    .finally(() => { probing = null; });
  return probing;
}

async function checkVersion() {
  if (!import.meta.env.PROD) return;
  try {
    const res = await fetch('/build-manifest.json', { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = await res.json();
    const next = !!manifest.version && manifest.version !== VERSION;
    if (next !== state.updateAvailable) { state.updateAvailable = next; emit(); }
  } catch { /* offline or blocked: nothing to report */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', probe);
  window.addEventListener('offline', () => setOnline(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { probe(); checkVersion(); }
  });
  // One confirming probe after startup, so a page booted from the offline
  // cache reports offline without waiting for a failed call
  setTimeout(probe, 1500);
}

export const isOnline = () => state.online;
// Subscribe outside React (modules that react to reconnects)
export function onConnectivity(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Call from any API failure that looks like a network error
export function reportNetworkFailure() { if (state.online) probe(); }

export function useConnectivity() {
  const [snapshot, setSnapshot] = useState({ ...state });
  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot({ ...state });
    return () => { listeners.delete(setSnapshot); };
  }, []);
  return snapshot;
}
