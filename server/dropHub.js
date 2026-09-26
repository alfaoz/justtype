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

// The same event to every open stream (a notice for everyone)
function broadcastSse(event) {
  let n = 0;
  for (const userId of sseClients.keys()) n += sendSse(userId, event);
  return n;
}

// --- web push --------------------------------------------------------------

// A push service that stalls must not hold anything up: each send gives up
// after PUSH_TIMEOUT_MS of silence on the socket, and a user with many
// devices is reached a few at a time rather than one after another.
const PUSH_TIMEOUT_MS = 5000;
const PUSH_CONCURRENCY = 4;

// Fire a content-free wake ping to all of a user's push subscriptions.
// db is passed in so the hub stays storage-agnostic. Prunes dead (410/404) subs.
// Resolves once every send has answered or timed out; never rejects.
async function sendPush(db, userId) {
  if (!pushEnabled || !webpush) return;
  let subs;
  try {
    subs = db.prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId);
  } catch { return; }
  if (!subs.length) return;
  const payload = JSON.stringify({ type: 'drops' });
  let next = 0;
  const worker = async () => {
    while (next < subs.length) {
      const s = subs[next++];
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { timeout: PUSH_TIMEOUT_MS }
        );
      } catch (err) {
        if (err && (err.statusCode === 410 || err.statusCode === 404)) {
          try { db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id); } catch {}
        }
      }
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(PUSH_CONCURRENCY, subs.length); i++) workers.push(worker());
  await Promise.all(workers);
}

// Notify all of a user's clients that a drop landed: instant SSE for open tabs,
// web push to wake closed ones. Best-effort and non-throwing. The pushes run
// in the background, so this resolves as soon as the SSE ping is written and
// the request that caused the drop never waits on a push service.
async function notifyDrop(db, userId) {
  try { sendSse(userId, { type: 'drops' }); } catch {}
  try { sendPush(db, userId).catch(() => {}); } catch {}
}

module.exports = {
  initPush, getPublicKey, addSseClient, removeSseClient, sendSse, broadcastSse, notifyDrop, pushEnabled: () => pushEnabled
};
