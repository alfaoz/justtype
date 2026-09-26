// Transport layer for collaborative slates: one shared WebSocket to
// /collab/ws with per-slate room subscriptions and auto-reconnect. This
// module moves opaque frames only — encrypting/decrypting payloads under the
// doc key is the caller's job (see src/collab.js for the key handling).
//
// subscribeCollab(slateId, onEvent) joins the slate's room (auth rides on the
// session cookie; in the iOS app, on a one-use ticket, see wsUrl) and delivers every server frame for that slate to onEvent:
//   {type:'joined', version, snapshotVersion, epoch}
//   {type:'update', version, payload, authorId}   someone else's update
//   {type:'ack', version, seq, compact?}   our own update, logged at version
//   {type:'updates', updates:[{version,payload}], more, snapshotVersion}   (fetch reply)
//   {type:'snapshot', version}   a snapshot was stored
//   {type:'awareness', payload, authorId}
//   {type:'changed'}       canonical blob changed -> refetch
//   {type:'removed'}       access revoked / collab disabled
//   {type:'peer_left', authorId}  user's last socket left the room
//   {type:'error', error, code?, seq?}  routed only when the server tagged a slateId;
//                          seq names a refused update of ours
//   {type:'reconnected'}   socket re-established (synthetic, local)
// Returns an unsubscribe function; the socket closes when no rooms remain.

import { API_URL } from './config';
import { inShell } from './shell';

let socket = null;
let opening = false;
let openPromise = null;
let backoffMs = 1000;
let reconnectTimer = null;
let intentionallyClosed = false;

// Map<slateId, Set<fn>>
const listeners = new Map();

// The socket lives where the API does: the page's own origin on the web, the
// API's host in the iOS app (whose page is capacitor://, not https). The app's
// session cookie sits in the phone's native store, out of a WebSocket's
// reach, so the app first asks for a one-use ticket over its native HTTP.
async function wsUrl() {
  const base = `${new URL(API_URL, window.location.href).origin.replace(/^http/, 'ws')}/collab/ws`;
  if (!inShell) return base;
  const response = await fetch(`${API_URL}/collab/ticket`, { method: 'POST', credentials: 'include' });
  if (!response.ok) throw new Error('no ticket');
  const { ticket } = await response.json();
  return `${base}?ticket=${encodeURIComponent(ticket)}`;
}

function dispatch(slateId, event) {
  const set = listeners.get(slateId);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(event); } catch (e) { console.warn('collab listener failed', e); }
  }
}

function sendRaw(obj) {
  if (socket && socket.readyState === 1) {
    try { socket.send(JSON.stringify(obj)); return true; } catch { return false; }
  }
  return false;
}

function joinAllRooms() {
  for (const slateId of listeners.keys()) sendRaw({ type: 'join', slateId });
}

function scheduleReconnect() {
  if (intentionallyClosed || reconnectTimer || listeners.size === 0) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    backoffMs = Math.min(backoffMs * 2, 30000);
    connect(true);
  }, backoffMs);
}

function connect(isReconnect = false) {
  if (opening || (socket && (socket.readyState === 0 || socket.readyState === 1))) return openPromise;
  intentionallyClosed = false;
  opening = true;
  openPromise = new Promise((resolve) => (async () => {
    let ws;
    try {
      ws = new WebSocket(await wsUrl());
    } catch (e) {
      console.warn('collab socket failed to open', e);
      opening = false;
      scheduleReconnect();
      resolve(false);
      return;
    }
    opening = false;
    socket = ws;
    ws.onopen = () => {
      backoffMs = 1000;
      joinAllRooms();
      if (isReconnect) {
        for (const slateId of listeners.keys()) dispatch(slateId, { type: 'reconnected' });
      }
      resolve(true);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg && msg.slateId != null) dispatch(Number(msg.slateId), msg);
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      scheduleReconnect();
      resolve(false);
    };
    ws.onerror = () => { /* onclose follows and schedules the retry */ };
  })());
  return openPromise;
}

export function subscribeCollab(slateId, onEvent) {
  slateId = Number(slateId);
  let set = listeners.get(slateId);
  if (!set) { set = new Set(); listeners.set(slateId, set); }
  set.add(onEvent);

  if (socket && socket.readyState === 1) {
    // Always re-join: the server answers duplicate joins with a fresh
    // `joined`, so a late subscriber (a lazy-loaded editor mounting after the
    // presence hook already consumed the first reply) still gets bootstrapped.
    sendRaw({ type: 'join', slateId });
  } else {
    connect();
  }

  return () => {
    const current = listeners.get(slateId);
    if (!current) return;
    current.delete(onEvent);
    if (current.size === 0) {
      listeners.delete(slateId);
      sendRaw({ type: 'leave', slateId });
      if (listeners.size === 0 && socket) {
        intentionallyClosed = true;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        try { socket.close(); } catch { /* already closing */ }
        socket = null;
      }
    }
  };
}

// Ask the server for a fresh `joined` frame (joins are idempotent). Used by
// subscribers still waiting on their bootstrap after a lost or failed one.
export function requestCollabJoin(slateId) {
  slateId = Number(slateId);
  if (!listeners.has(slateId)) return;
  if (socket && socket.readyState === 1) sendRaw({ type: 'join', slateId });
  else connect();
}

// Fire an encrypted update into the slate's room. seq comes back on the ack
// (or on the error that refuses it) so callers can match them; epoch is the key-rotation
// counter from the joined frame (the server rejects stale epochs). Returns
// false if the socket isn't open (caller decides whether to queue or drop).
export function sendCollabUpdate(slateId, payload, seq, epoch) {
  return sendRaw({ type: 'update', slateId: Number(slateId), payload, seq, epoch });
}

// Request updates after `since` (reply arrives as a {type:'updates'} event).
export function fetchCollabUpdates(slateId, since) {
  return sendRaw({ type: 'fetch', slateId: Number(slateId), since });
}

// Encrypted presence blob, relayed to the room and never stored.
export function sendCollabAwareness(slateId, payload) {
  return sendRaw({ type: 'awareness', slateId: Number(slateId), payload });
}
