// Real-time drop delivery for the page. Two tiers, no notifications:
//   1. SSE — an open tab adopts drops within ~a second of an app depositing one.
//   2. Next unlock — anything that arrives while no tab is open is swept the next
//      time the user opens justtype unlocked (the initial sweep below).
// We deliberately do NOT use Web Push / notifications: drops surface silently in
// the user's slate list, never as a system notification.

import { API_URL } from './config';
import { sweepDrops } from './dropInbox';

let eventSource = null;

// Open the SSE stream. On any "drops" event, sweep. The browser's native
// EventSource handles reconnection. onAdopted bubbles up to refresh the UI.
function startSse(userId, masterKey, onAdopted) {
  if (eventSource) return;
  try {
    eventSource = new EventSource(`${API_URL}/account/events`, { withCredentials: true });
    eventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data && data.type === 'drops') sweepDrops(userId, masterKey, onAdopted);
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
  // Catch up on anything deposited while we were away.
  sweepDrops(userId, masterKey, onAdopted);
}

// Tear down the SSE stream (on logout).
export function stopDropRealtime() {
  if (eventSource) { try { eventSource.close(); } catch {} eventSource = null; }
}
