// Realtime hub for E2EE collaborative slates: a WebSocket relay + ordered log
// of opaque blobs. Clients encrypt every payload under the slate's doc key
// before it reaches us; the server never sees plaintext, keys, or a usable
// document — it assigns versions, stores ciphertext, and fans frames out to
// the room. Single-instance in-memory rooms, same trade-off as dropHub's SSE
// registry.
//
// Mounted at /collab/ws (outside /api/ so nginx's API rate limit does not
// throttle the channel; the catch-all location already forwards Upgrade).
// Auth mirrors authenticateToken: cookie (or bearer) JWT at upgrade time,
// oauth-scoped tokens rejected, session must exist in the sessions table.
//
// Versions: a slate's head is the larger of its newest logged update and its
// snapshot's version, and the next update takes head + 1. The log therefore
// always holds exactly the versions after the snapshot, (snapshot, head],
// with no holes: a snapshot prunes what it covers, so a joiner loads the
// snapshot and fetches everything after it.
//
// Frame protocol (JSON text frames, payloads base64):
//   c->s  {type:'join',  slateId}
//   s->c  {type:'joined', slateId, version, snapshotVersion, epoch}  (version = head)
//   c->s  {type:'leave', slateId}
//   c->s  {type:'update', slateId, payload, epoch, seq?} -> logged + broadcast
//   s->c  {type:'rekeyed', slateId}   -> doc key rotated, re-resolve + rebuild
//   s->c  {type:'update', slateId, version, payload, authorId, seq?}
//   c->s  {type:'fetch', slateId, since}               -> catch-up
//   s->c  {type:'updates', slateId, updates:[{version,payload}], more, snapshotVersion}
//   s->c  {type:'snapshot', slateId, version}  -> a snapshot was stored; load it
//                                      when it is ahead of what you have applied
//   c->s  {type:'awareness', slateId, payload}         -> relayed, not stored
//   s->c  {type:'awareness', slateId, payload, authorId}
//   s->c  {type:'changed', slateId}    -> canonical blob changed, refetch
//   s->c  {type:'removed', slateId}    -> membership revoked / collab disabled
//   s->c  {type:'peer_left', slateId, authorId} -> user's last socket left the room
//   s->c  {type:'error', error, code?, slateId?}

const { SESSION_MATCH } = require('./sessionMatch');
const WS_PATH = '/collab/ws';
const MAX_FRAME_BYTES = 512 * 1024;      // hard cap on any inbound frame
const MAX_PAYLOAD_CHARS = 300 * 1024;    // base64 chars per update/awareness
const MAX_ROOMS_PER_SOCKET = 8;
const MAX_SOCKETS_PER_USER = 6;
const FETCH_BATCH = 500;
const HEARTBEAT_MS = 30000;
// Per-socket message budget: generous for typing bursts, hostile to floods.
const RATE_WINDOW_MS = 10000;
const RATE_MAX_MSGS = 300;

let wss = null;
let deps = null;
let stmts = null;

// Map<slateId, Set<ws>>
const rooms = new Map();

const send = (ws, obj) => {
  if (ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch { /* dying socket */ }
  }
};

// slateId lets the client route the error to that room's listeners; frames
// without one never reach a subscriber (pre-parse failures only).
const sendError = (ws, error, code, slateId) =>
  send(ws, slateId ? { type: 'error', error, code, slateId } : { type: 'error', error, code });

function joinRoom(slateId, ws) {
  let set = rooms.get(slateId);
  if (!set) { set = new Set(); rooms.set(slateId, set); }
  set.add(ws);
  ws.slateRooms.add(slateId);
}

function leaveRoom(slateId, ws) {
  const set = rooms.get(slateId);
  if (set) {
    set.delete(ws);
    if (set.size === 0) {
      rooms.delete(slateId);
    } else {
      // Tell the room when a user's LAST socket leaves, so presence
      // indicators drop immediately instead of waiting for heartbeat expiry.
      let still = false;
      for (const client of set) if (client.userId === ws.userId) { still = true; break; }
      if (!still) broadcast(slateId, { type: 'peer_left', slateId, authorId: ws.userId });
    }
  }
  ws.slateRooms.delete(slateId);
}

function broadcast(slateId, obj, exceptWs = null) {
  const set = rooms.get(slateId);
  if (!set) return;
  const msg = JSON.stringify(obj);
  for (const client of set) {
    if (client !== exceptWs && client.readyState === 1) {
      try { client.send(msg); } catch { /* dying socket */ }
    }
  }
}

// The iOS app's web view cannot hand its session cookie to a WebSocket (the
// cookie lives in the phone's native store, and its page is capacitor://).
// It asks POST /api/collab/ticket over its authenticated HTTP instead and
// opens the socket with ?ticket=: one use, thirty seconds, standing in for
// the session it was issued under. The session token never enters a URL.
const TICKET_MS = 30 * 1000;
const tickets = new Map(); // ticket -> { token, expires }
function issueTicket(token) {
  const now = Date.now();
  for (const [key, t] of tickets) if (t.expires < now) tickets.delete(key);
  const ticket = require('crypto').randomBytes(24).toString('hex');
  tickets.set(ticket, { token, expires: now + TICKET_MS });
  return ticket;
}
function redeemTicket(req) {
  let ticket = null;
  try { ticket = new URL(req.url, 'http://localhost').searchParams.get('ticket'); } catch { return null; }
  if (!ticket) return null;
  const t = tickets.get(ticket);
  tickets.delete(ticket);
  return t && t.expires > Date.now() ? t.token : null;
}

// Cookie header -> value of justtype_token (no cookie-parser at upgrade time),
// or the session a ticket stands for
function tokenFromRequest(req) {
  const ticketed = redeemTicket(req);
  if (ticketed) return ticketed;
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === 'justtype_token') {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  const authHeader = req.headers['authorization'];
  return (authHeader && authHeader.split(' ')[1]) || null;
}

// Same checks as authenticateToken, minus the express plumbing.
function verifyUser(req) {
  const { jwt, JWT_SECRET, crypto } = deps;
  const token = tokenFromRequest(req);
  if (!token) return null;
  let user;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
  if (!user || user.oauth) return null;
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = stmts.touchSession.run(tokenHash, tokenHash);
    if (result.changes === 0) return null;
  } catch {
    return null;
  }
  return { id: user.id, username: user.username };
}

function membership(slateId, userId) {
  return stmts.membership.get(slateId, userId);
}

function headVersion(slateId) {
  return stmts.head.get(slateId, slateId).v;
}

function snapshotVersion(slateId) {
  const row = stmts.snapshotVersion.get(slateId);
  return row ? row.snapshot_version : 0;
}

// Doc-key rotation counter (slates.collab_epoch), or null once the slate is
// no longer collaborative (disabled, trashed, deleted). Updates encrypted
// under a rotated-away key would poison the fresh log, so writers must
// present the current epoch.
function keyEpoch(slateId) {
  const row = stmts.epoch.get(slateId);
  return row ? row.e : null;
}

function userSocketCount(userId) {
  let n = 0;
  for (const client of wss.clients) if (client.userId === userId) n++;
  return n;
}

function joinedFrame(slateId) {
  return { type: 'joined', slateId, version: headVersion(slateId), snapshotVersion: snapshotVersion(slateId), epoch: keyEpoch(slateId) ?? 0 };
}

function handleMessage(ws, raw) {
  if (typeof raw !== 'string') {
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    else return sendError(ws, 'text frames only');
  }
  // Cheap flood guard before any parsing.
  const now = Date.now();
  if (now - ws.rateWindowStart > RATE_WINDOW_MS) { ws.rateWindowStart = now; ws.rateCount = 0; }
  if (++ws.rateCount > RATE_MAX_MSGS) return sendError(ws, 'slow down', 'RATE_LIMITED');

  let msg;
  try { msg = JSON.parse(raw); } catch { return sendError(ws, 'invalid frame'); }
  const slateId = Number(msg.slateId);
  if (!slateId) return sendError(ws, 'slateId required');

  switch (msg.type) {
    case 'join': {
      if (ws.slateRooms.has(slateId)) return send(ws, joinedFrame(slateId));
      if (ws.slateRooms.size >= MAX_ROOMS_PER_SOCKET) return sendError(ws, 'too many open slates', 'ROOM_LIMIT', slateId);
      if (!membership(slateId, ws.userId)) return sendError(ws, 'not a member', 'NOT_MEMBER', slateId);
      joinRoom(slateId, ws);
      return send(ws, joinedFrame(slateId));
    }
    case 'leave':
      return leaveRoom(slateId, ws);
    case 'update': {
      if (!ws.slateRooms.has(slateId)) return sendError(ws, 'join first', 'NOT_JOINED', slateId);
      if (typeof msg.payload !== 'string' || !msg.payload || msg.payload.length > MAX_PAYLOAD_CHARS) {
        return sendError(ws, 'bad payload', undefined, slateId);
      }
      const epoch = keyEpoch(slateId);
      if (epoch === null) {
        send(ws, { type: 'removed', slateId });
        return leaveRoom(slateId, ws);
      }
      if (Number(msg.epoch) !== epoch) {
        return sendError(ws, 'stale key epoch', 'STALE_EPOCH', slateId);
      }
      let version;
      try {
        version = stmts.append(slateId, msg.payload, ws.userId);
      } catch (e) {
        console.error('collab update insert failed:', e);
        return sendError(ws, 'update rejected', undefined, slateId);
      }
      const out = { type: 'update', slateId, version, payload: msg.payload, authorId: ws.userId };
      if (msg.seq != null) send(ws, { ...out, seq: msg.seq });
      else send(ws, out);
      broadcast(slateId, out, ws);
      return;
    }
    case 'fetch': {
      if (!ws.slateRooms.has(slateId)) return sendError(ws, 'join first', 'NOT_JOINED', slateId);
      const since = Number(msg.since) || 0;
      const rowsOut = stmts.fetchSince.all(slateId, since, FETCH_BATCH + 1);
      const more = rowsOut.length > FETCH_BATCH;
      // The reply says where the snapshot is: a client that asked from
      // below it finds the rows it lacks there, not in the log.
      return send(ws, { type: 'updates', slateId, updates: rowsOut.slice(0, FETCH_BATCH), more, snapshotVersion: snapshotVersion(slateId) });
    }
    case 'awareness': {
      if (!ws.slateRooms.has(slateId)) return sendError(ws, 'join first', 'NOT_JOINED', slateId);
      if (typeof msg.payload !== 'string' || msg.payload.length > MAX_PAYLOAD_CHARS) return sendError(ws, 'bad payload', undefined, slateId);
      return broadcast(slateId, { type: 'awareness', slateId, payload: msg.payload, authorId: ws.userId }, ws);
    }
    default:
      return sendError(ws, 'unknown type');
  }
}

// Before versions counted from the snapshot, a snapshot that pruned the whole
// log sent the next update back to version 1 while the snapshot stayed at,
// say, 64: those updates are newer than the snapshot but numbered below it,
// and a joiner loading the snapshot skipped them. The rows still left in such
// a log are one run in the order they were written (a restart only happened
// on an empty log), so moving the whole run to start right after the
// snapshot restores (snapshot, head]. A second run finds nothing to do.
function renumberStrandedUpdates(db) {
  const stranded = db.prepare(`
    SELECT u.slate_id AS slateId, MIN(u.version) AS low, d.snapshot_version AS snap
    FROM collab_updates u JOIN collab_docs d ON d.slate_id = u.slate_id
    GROUP BY u.slate_id, d.snapshot_version
    HAVING MIN(u.version) <= d.snapshot_version
  `).all();
  if (!stranded.length) return;
  // Through negative numbers, so no row ever collides with another's version.
  const negate = db.prepare('UPDATE collab_updates SET version = -version WHERE slate_id = ?');
  const shift = db.prepare('UPDATE collab_updates SET version = ? - version WHERE slate_id = ?');
  for (const { slateId, low, snap } of stranded) {
    try {
      db.transaction(() => {
        negate.run(slateId);
        shift.run(snap - low + 1, slateId);
      })();
      console.log(`✓ Collab log of slate ${slateId} renumbered to follow its snapshot (${snap})`);
    } catch (e) {
      console.error(`collab log renumbering failed for slate ${slateId}:`, e);
    }
  }
}

// Attach the hub to the app's http server. Called once at startup; every
// exported notifier is a safe no-op before then.
function attach(httpServer, dependencies) {
  deps = dependencies;
  const { db } = deps;
  const { WebSocketServer } = require('ws');
  wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  stmts = {
    touchSession: db.prepare(`UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE ${SESSION_MATCH}`),
    membership: db.prepare(`
      SELECT m.status, m.role FROM collab_members m
      JOIN slates s ON s.id = m.slate_id
      WHERE m.slate_id = ? AND m.user_id = ? AND m.status = 'accepted' AND s.is_collab = 1 AND s.deleted_at IS NULL
    `),
    head: db.prepare(`
      SELECT MAX(
        COALESCE((SELECT MAX(version) FROM collab_updates WHERE slate_id = ?), 0),
        COALESCE((SELECT snapshot_version FROM collab_docs WHERE slate_id = ?), 0)
      ) AS v
    `),
    snapshotVersion: db.prepare('SELECT snapshot_version FROM collab_docs WHERE slate_id = ?'),
    epoch: db.prepare('SELECT COALESCE(collab_epoch, 0) AS e FROM slates WHERE id = ? AND is_collab = 1 AND deleted_at IS NULL'),
    insert: db.prepare('INSERT INTO collab_updates (slate_id, version, payload, author_id) VALUES (?, ?, ?, ?)'),
    fetchSince: db.prepare('SELECT version, payload FROM collab_updates WHERE slate_id = ? AND version > ? ORDER BY version LIMIT ?'),
  };
  // Head read and insert in one transaction: the version is taken and used
  // with nothing able to run in between.
  stmts.append = db.transaction((slateId, payload, authorId) => {
    const version = stmts.head.get(slateId, slateId).v + 1;
    stmts.insert.run(slateId, version, payload, authorId);
    return version;
  });

  renumberStrandedUpdates(db);

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* fall through */ }
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    const user = verifyUser(req);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, user);
    });
  });

  wss.on('connection', (ws, req, user) => {
    if (userSocketCount(user.id) >= MAX_SOCKETS_PER_USER) {
      send(ws, { type: 'error', error: 'too many connections', code: 'CONN_LIMIT' });
      ws.close();
      return;
    }
    ws.userId = user.id;
    ws.slateRooms = new Set();
    ws.isAlive = true;
    ws.rateWindowStart = Date.now();
    ws.rateCount = 0;
    ws.on('pong', () => { ws.isAlive = true; });
    // A throw here would escape into the socket's data handler and take the
    // whole process down; one bad frame costs only itself.
    ws.on('message', (raw) => {
      try { handleMessage(ws, raw); } catch (e) { console.error('collab frame failed:', e); }
    });
    ws.on('close', () => {
      for (const slateId of [...ws.slateRooms]) leaveRoom(slateId, ws);
    });
    ws.on('error', () => { /* close handler does the cleanup */ });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.isAlive) { client.terminate(); continue; }
      client.isAlive = false;
      try { client.ping(); } catch { /* dying socket */ }
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  console.log(`✓ Collab websocket hub listening on ${WS_PATH}`);
}

// The canonical blob changed outside the update log (owner PUT save) — tell
// the room to refetch.
function notifySlateChanged(slateId) {
  if (wss) broadcast(slateId, { type: 'changed', slateId });
}

// A snapshot was stored and the log pruned under it (POST .../snapshot): the
// room learns the snapshot's version, so no one else posts the same one and
// anyone behind it loads it.
function snapshotStored(slateId, version) {
  if (wss) broadcast(slateId, { type: 'snapshot', slateId, version });
}

// The doc key rotated: every client must re-resolve its wrapped key and
// rebuild its doc from the fresh canonical blob.
function notifyRekeyed(slateId) {
  if (wss) broadcast(slateId, { type: 'rekeyed', slateId });
}

// A member lost access: drop their live sockets from the room.
function kickMember(slateId, userId) {
  const set = rooms.get(slateId);
  if (!set) return;
  for (const client of [...set]) {
    if (client.userId === userId) {
      send(client, { type: 'removed', slateId });
      leaveRoom(slateId, client);
    }
  }
}

// Collaboration ended for the slate (disabled or deleted): everyone out.
function closeRoom(slateId) {
  const set = rooms.get(slateId);
  if (!set) return;
  for (const client of [...set]) {
    send(client, { type: 'removed', slateId });
    leaveRoom(slateId, client);
  }
}

module.exports = { attach, issueTicket, notifySlateChanged, snapshotStored, notifyRekeyed, kickMember, closeRoom };
