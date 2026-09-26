// Real-time drop delivery for the page. Two tiers, no notifications:
//   1. SSE — an open tab adopts drops within ~a second of an app depositing one.
//   2. Next unlock — anything that arrives while no tab is open is swept the next
//      time the user opens justtype unlocked (the initial sweep below).
// We deliberately do NOT use Web Push / notifications: drops surface silently in
// the user's slate list, never as a system notification.

import { API_URL } from './config';
import { sweepDrops } from './dropInbox';
import { reconcileDeviceWraps } from './shareAll';
import { inShell } from './shell';

let eventSource = null;

// Other parts of the page listen on the same stream (one connection per
// tab): App refetches its notifications when told there is a new one
const accountListeners = new Set();
export function onAccountEvent(fn) { accountListeners.add(fn); return () => accountListeners.delete(fn); }

// Open the SSE stream. Content-free pings:
//   'drops'     — an app deposited a drop → sweep + adopt.
//   'reconcile' — an app registered a new install key → wrap shared slates to it.
//   anything else goes to onAccountEvent listeners ('notifications': a new one).
// The browser's native EventSource handles reconnection. onAdopted bubbles up to
// refresh the UI after drops adopt.
// The iOS app's page (capacitor://) cannot hold this stream: the server's
// CORS refuses its origin and the session cookie does not ride it. There the
// sweep runs each time the app comes back to the front instead.
let resumeSweep = null;
function startSse(userId, masterKey, onAdopted) {
  if (inShell) {
    if (resumeSweep) return;
    resumeSweep = () => {
      if (document.visibilityState !== 'visible') return;
      sweepDrops(userId, masterKey, onAdopted);
      reconcileDeviceWraps(userId);
    };
    document.addEventListener('visibilitychange', resumeSweep);
    return;
  }
  if (eventSource) return;
  try {
    eventSource = new EventSource(`${API_URL}/account/events`, { withCredentials: true });
    eventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data && data.type === 'drops') sweepDrops(userId, masterKey, onAdopted);
        else if (data && data.type === 'reconcile') reconcileDeviceWraps(userId);
        else if (data && data.type) for (const l of accountListeners) l(data);
      } catch {}
    };
    eventSource.onerror = () => { /* browser auto-reconnects */ };
  } catch (e) {
    console.warn('SSE start failed', e);
  }
}

// Start delivery. Idempotent-ish; call once per unlocked session.
export function startDropRealtime(userId, masterKey, onAdopted) {
  if (!userId || !masterKey) return;
  startSse(userId, masterKey, onAdopted);
  // Catch up on anything that happened while we were away: adopt pending drops and
  // wrap any shared slates to installs registered since we were last open.
  sweepDrops(userId, masterKey, onAdopted);
  reconcileDeviceWraps(userId);
}

// Tear down the SSE stream (on logout).
export function stopDropRealtime() {
  if (resumeSweep) { document.removeEventListener('visibilitychange', resumeSweep); resumeSweep = null; }
  if (eventSource) { try { eventSource.close(); } catch {} eventSource = null; }
}
