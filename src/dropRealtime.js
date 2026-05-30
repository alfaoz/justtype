// Real-time drop delivery wiring for the page: opens an SSE stream so an open tab
// adopts drops within ~a second, and registers a service worker + Web Push
// subscription so closed clients can be woken. Both tiers ultimately call the
// same sweepDrops(). Degrades cleanly: SSE-only if push is unsupported/disabled.

import { API_URL } from './config';
import { sweepDrops } from './dropInbox';

let eventSource = null;
let swMessageHandler = null;

function base64UrlToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Open the SSE stream. On any "drops" event, sweep. Reconnects are handled by the
// browser's native EventSource retry. onAdopted bubbles up to refresh the UI.
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

// Register the service worker and, if Web Push is enabled server-side, subscribe.
// Service-worker messages ("drops") trigger a sweep too (push-woken background).
async function startPush(userId, masterKey, onAdopted) {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');

    // Page-side handler for nudges from the worker.
    if (!swMessageHandler) {
      swMessageHandler = (event) => {
        if (event.data && event.data.type === 'drops') sweepDrops(userId, masterKey, onAdopted);
      };
      navigator.serviceWorker.addEventListener('message', swMessageHandler);
    }

    if (!('PushManager' in window) || !('Notification' in window)) return;

    const keyRes = await fetch(`${API_URL}/account/push/key`, { credentials: 'include' });
    if (!keyRes.ok) return;
    const { enabled, public_key } = await keyRes.json();
    if (!enabled || !public_key) return; // push not configured server-side

    // Only subscribe if the user has granted (or now grants) notification access.
    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
    }

    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(public_key)
    });
    const json = sub.toJSON();
    await fetch(`${API_URL}/account/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys })
    });
  } catch (e) {
    console.warn('push setup failed', e);
  }
}

// Start all real-time delivery. Idempotent-ish; call once per unlocked session.
export function startDropRealtime(userId, masterKey, onAdopted) {
  if (!userId || !masterKey) return;
  startSse(userId, masterKey, onAdopted);
  startPush(userId, masterKey, onAdopted);
  // Catch up on anything deposited while we were away.
  sweepDrops(userId, masterKey, onAdopted);
}

// Tear down the SSE stream (on logout). We leave the push subscription in place
// so the user can still be woken; it is removed server-side on revoke/expiry.
export function stopDropRealtime() {
  if (eventSource) { try { eventSource.close(); } catch {} eventSource = null; }
}
