// Drop delivery hub: how a user's clients learn that an app deposited an
// encrypted "drop" (a new slate created via the API) so they can adopt it
// promptly. Three tiers, none of which ever transmit plaintext:
//
//   1. SSE  — for clients with an open tab. We hold a per-user set of live
//             EventSource connections and push a tiny "drops" ping. The client
//             then runs its normal authenticated inbox sweep + adopt.
//   2. Web Push — for clients with no open tab (service worker wakes, reads the
//             master key from IndexedDB, sweeps, adopts). Best-effort; requires
//             VAPID keys in the environment, otherwise this tier silently no-ops.
//   3. Nothing here — if every device is offline the drop simply waits; the
//             client sweeps on next unlock. That residual latency is the
//             zero-knowledge guarantee, not a bug: only the user's device holds
//             the key that can open a drop.
//
// The ping payload is deliberately content-free: { type: 'drops' }. It tells a
// client "check your inbox", never what is in it.

let webpush = null;
let pushEnabled = false;

// Map<userId, Set<res>> of live SSE responses.
const sseClients = new Map();

function initPush() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('ℹ web push disabled (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to enable)');
    return;
  }
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:hello@justtype.io', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushEnabled = true;
    console.log('✓ web push enabled');
  } catch (e) {
    console.warn('web push init failed:', e.message);
  }
}

function getPublicKey() {
  return pushEnabled ? process.env.VAPID_PUBLIC_KEY : null;
}

// --- SSE registry ----------------------------------------------------------

function addSseClient(userId, res) {
  let set = sseClients.get(userId);
  if (!set) { set = new Set(); sseClients.set(userId, set); }
  set.add(res);
}

function removeSseClient(userId, res) {
  const set = sseClients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseClients.delete(userId);
}

function sendSse(userId, event) {
  const set = sseClients.get(userId);
  if (!set || set.size === 0) return 0;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  let n = 0;
  for (const res of set) {
    try { res.write(line); n++; } catch { /* dead connection; cleaned on close */ }
  }
  return n;
}

// --- web push --------------------------------------------------------------

// Fire a content-free wake ping to all of a user's push subscriptions.
// db is passed in so the hub stays storage-agnostic. Prunes dead (410/404) subs.
async function sendPush(db, userId) {
  if (!pushEnabled || !webpush) return;
  let subs;
  try {
    subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  } catch { return; }
  const payload = JSON.stringify({ type: 'drops' });
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      );
    } catch (err) {
      if (err && (err.statusCode === 410 || err.statusCode === 404)) {
        try { db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id); } catch {}
      }
    }
  }
}

// Notify all of a user's clients that a drop landed: instant SSE for open tabs,
// web push to wake closed ones. Best-effort and non-throwing.
async function notifyDrop(db, userId) {
  try { sendSse(userId, { type: 'drops' }); } catch {}
  try { await sendPush(db, userId); } catch {}
}

module.exports = {
  initPush, getPublicKey, addSseClient, removeSseClient, sendSse, notifyDrop, pushEnabled: () => pushEnabled
};
