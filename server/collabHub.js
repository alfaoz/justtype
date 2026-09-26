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
// oauth-scoped tokens rejected, session must exist in the sessions table,
// and is looked for again about once a minute while the socket lives.
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
//   s->c  {type:'ack', slateId, version, seq?, compact?} -> to the sender only;
//                                      compact: the log is large, post a snapshot
//   s->c  {type:'rekeyed', slateId}   -> doc key rotated, re-resolve + rebuild
//   s->c  {type:'update', slateId, version, payload, authorId}
//   c->s  {type:'fetch', slateId, since}               -> catch-up
//   s->c  {type:'updates', slateId, updates:[{version,payload}], more, snapshotVersion}
//   s->c  {type:'snapshot', slateId, version}  -> a snapshot was stored; load it
//                                      when it is ahead of what you have applied
//   c->s  {type:'awareness', slateId, payload}         -> relayed, not stored
//   s->c  {type:'awareness', slateId, payload, authorId}
//   s->c  {type:'changed', slateId}    -> canonical blob changed, refetch
//   s->c  {type:'removed', slateId}    -> membership revoked / collab disabled
//   s->c  {type:'peer_left', slateId, authorId} -> user's last socket left the room
//   s->c  {type:'error', error, code?, slateId?, seq?}  seq names a refused update.
//         Codes on updates: RATE_LIMITED (send it again shortly), LOG_FULL
//         (snapshot, then send it again), TOO_LARGE (only a snapshot can carry
//         it), STALE_EPOCH (the key rotated).

const { SESSION_MATCH } = require('./sessionMatch');
const WS_PATH = '/collab/ws';
const MAX_FRAME_BYTES = 512 * 1024;      // hard cap on any inbound frame
const MAX_PAYLOAD_CHARS = 300 * 1024;    // base64 chars per update/awareness
const MAX_ROOMS_PER_SOCKET = 8;
const MAX_SOCKETS_PER_USER = 6;
const FETCH_BATCH = 500;
// A catch-up reply stops at this many payload chars and says `more`, so a
// fetch never loads the whole log into memory at once.
const FETCH_MAX_CHARS = 1.5 * 1024 * 1024;
const HEARTBEAT_MS = 30000;
const SESSION_RECHECK_MS = 60 * 1000;
// A socket that has this much queued and unsent is not keeping up: it is
// dropped rather than buffered without end, and catches up when it reconnects.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
// Flood guard over every frame a socket sends, checked before any parsing.
// Tripping it closes the socket: the frame is lost unread, and a reconnecting
// client sends again whatever the relay never confirmed.
const RATE_WINDOW_MS = 10000;
const RATE_MAX_MSGS = 1200;
// Update budget per socket, as token buckets: an average of 60 frames and
// 1 MB a second, with two seconds' worth of burst. Typing and pastes stay
// well under it.
const UPDATE_MSGS_PER_S = 60;
const UPDATE_MSGS_BURST = 120;
const UPDATE_CHARS_PER_S = 1024 * 1024;
const UPDATE_CHARS_BURST = 2 * 1024 * 1024;
// Payload chars a slate's log may hold. Past the soft cap every ack asks for
// a snapshot (which prunes the log); past the hard cap updates are refused
// until one lands.
const LOG_SOFT_CHARS = 20 * 1024 * 1024;
const LOG_HARD_CHARS = 32 * 1024 * 1024;

let wss = null;
let deps = null;
let stmts = null;

// Map<slateId, Set<ws>>
const rooms = new Map();
// Map<slateId, payload chars in its log>, read from the table on first use and
// kept by the inserts here. Anything that prunes the log drops the entry
// (snapshotStored, notifyRekeyed, closeRoom), and so does an emptied room.
const logChars = new Map();

// Hand a frame to a socket, or drop the socket when it cannot keep up.
function deliver(ws, msg) {
  if (ws.readyState !== 1) return;
  if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
    ws.terminate();
    return;
  }
  try { ws.send(msg); } catch { /* dying socket */ }
}

const send = (ws, obj) => deliver(ws, JSON.stringify(obj));

// slateId lets the client route the error to that room's listeners; frames
// without one never reach a subscriber (pre-parse failures only). seq names
// the refused update, so the client can send it again or carry it otherwise.
const sendError = (ws, error, code, slateId, seq) => {
  const out = { type: 'error', error, code };
  if (slateId) out.slateId = slateId;
  if (seq != null) out.seq = seq;
  send(ws, out);
};

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
      logChars.delete(slateId);
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
    if (client !== exceptWs) deliver(client, msg);
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

// Same checks as authenticateToken, minus the express plumbing. The session
// row's id is kept: a session renews its token as it is used, so the token
// this socket opened with stops matching after a while, but the row stays
// until logout, a password reset or expiry deletes it.
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
    const session = stmts.findSession.get(tokenHash, tokenHash);
    if (!session) return null;
    stmts.touchSession.run(session.id);
    return { id: user.id, username: user.username, sessionId: session.id };
  } catch {
    return null;
  }
}

// Origins the web app is served from (the CORS list in index.js), and the
// iOS shell, whose bundled page runs at capacitor://<its server hostname>.
// Logged when unexpected, never refused: the shell's hostnames are set in its
// own project outside this repo, and the auth cookie is SameSite=lax, which
// already keeps other sites' pages from opening this socket as a user.
function knownOrigins() {
  const list = process.env.NODE_ENV === 'production'
    ? ['https://justtype.io', 'https://www.justtype.io']
    : ['http://localhost:5173', 'http://localhost:3003', 'http://127.0.0.1:5173'];
  if (process.env.PUBLIC_URL) list.push(process.env.PUBLIC_URL.replace(/\/+$/, ''));
  const set = new Set(list);
  for (const origin of list) {
    try { set.add(`capacitor://${new URL(origin).host}`); } catch { /* not a URL */ }
  }
  return set;
}
let originsSeen = null;
const originsLogged = new Set();
function noteOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || originsSeen.has(origin) || originsLogged.has(origin)) return;
  if (originsLogged.size < 100) originsLogged.add(origin);
  console.warn(`collab socket opened from an unexpected origin: ${origin}`);
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

function logSize(slateId) {
  let n = logChars.get(slateId);
  if (n === undefined) {
    n = stmts.logSize.get(slateId).n;
    logChars.set(slateId, n);
  }
  return n;
}

function userSocketCount(userId) {
  let n = 0;
  for (const client of wss.clients) if (client.userId === userId) n++;
  return n;
}

// Token buckets refilled by elapsed time: false when this update is over the
// socket's budget.
function takeUpdateBudget(ws, chars) {
  const now = Date.now();
  const elapsed = (now - ws.budgetAt) / 1000;
  ws.budgetAt = now;
  ws.msgTokens = Math.min(UPDATE_MSGS_BURST, ws.msgTokens + elapsed * UPDATE_MSGS_PER_S);
  ws.charTokens = Math.min(UPDATE_CHARS_BURST, ws.charTokens + elapsed * UPDATE_CHARS_PER_S);
  if (ws.msgTokens < 1 || ws.charTokens < chars) return false;
  ws.msgTokens -= 1;
  ws.charTokens -= chars;
  return true;
}

function joinedFrame(slateId) {
  return { type: 'joined', slateId, version: headVersion(slateId), snapshotVersion: snapshotVersion(slateId), epoch: keyEpoch(slateId) ?? 0 };
}

function handleMessage(ws, raw) {
  if (ws.readyState !== 1) return;
  if (typeof raw !== 'string') {
    if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
    else return sendError(ws, 'text frames only');
  }
  // Cheap flood guard before any parsing.
  const now = Date.now();
  if (now - ws.rateWindowStart > RATE_WINDOW_MS) { ws.rateWindowStart = now; ws.rateCount = 0; }
  if (++ws.rateCount > RATE_MAX_MSGS) {
    sendError(ws, 'slow down', 'RATE_LIMITED');
    ws.close(1008, 'too many frames');
    return;
  }

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
      const seq = msg.seq != null ? msg.seq : undefined;
      if (!ws.slateRooms.has(slateId)) return sendError(ws, 'join first', 'NOT_JOINED', slateId, seq);
      if (typeof msg.payload !== 'string' || !msg.payload) {
        return sendError(ws, 'bad payload', undefined, slateId, seq);
      }
      if (msg.payload.length > MAX_PAYLOAD_CHARS) {
        return sendError(ws, 'update too large', 'TOO_LARGE', slateId, seq);
      }
      if (!takeUpdateBudget(ws, msg.payload.length)) {
        return sendError(ws, 'slow down', 'RATE_LIMITED', slateId, seq);
      }
      const epoch = keyEpoch(slateId);
      if (epoch === null) {
        send(ws, { type: 'removed', slateId });
        return leaveRoom(slateId, ws);
      }
      if (Number(msg.epoch) !== epoch) {
        return sendError(ws, 'stale key epoch', 'STALE_EPOCH', slateId, seq);
      }
      const size = logSize(slateId);
      if (size + msg.payload.length > LOG_HARD_CHARS) {
        return sendError(ws, 'the log is full until a snapshot lands', 'LOG_FULL', slateId, seq);
      }
      let version;
      try {
        version = stmts.append(slateId, msg.payload, ws.userId);
      } catch (e) {
        console.error('collab update insert failed:', e);
        return sendError(ws, 'update rejected', undefined, slateId, seq);
      }
      logChars.set(slateId, size + msg.payload.length);
      // The sender already holds its update: it gets the version, not the payload back.
      const ack = { type: 'ack', slateId, version };
      if (seq !== undefined) ack.seq = seq;
      if (size + msg.payload.length > LOG_SOFT_CHARS) ack.compact = true;
      send(ws, ack);
      broadcast(slateId, { type: 'update', slateId, version, payload: msg.payload, authorId: ws.userId }, ws);
      return;
    }
    case 'fetch': {
      if (!ws.slateRooms.has(slateId)) return sendError(ws, 'join first', 'NOT_JOINED', slateId);
      const since = Math.max(0, Number(msg.since) || 0);
      // The reply says where the snapshot is: a client that asked from
      // below it finds the rows it lacks there, not in the log.
      const snap = snapshotVersion(slateId);
      const updates = [];
      let chars = 0;
      let more = false;
      for (const row of stmts.fetchSince.iterate(slateId, since, FETCH_BATCH + 1)) {
        if (updates.length === FETCH_BATCH || (updates.length && chars + row.payload.length > FETCH_MAX_CHARS)) {
          more = true;
          break;
        }
        updates.push(row);
        chars += row.payload.length;
      }
      return send(ws, { type: 'updates', slateId, updates, more, snapshotVersion: snap });
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
  originsSeen = knownOrigins();

  stmts = {
    findSession: db.prepare(`SELECT id FROM sessions WHERE ${SESSION_MATCH} LIMIT 1`),
    touchSession: db.prepare('UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?'),
    sessionAlive: db.prepare('SELECT 1 FROM sessions WHERE id = ?'),
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
    logSize: db.prepare('SELECT COALESCE(SUM(LENGTH(payload)), 0) AS n FROM collab_updates WHERE slate_id = ?'),
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
    noteOrigin(req);
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
    ws.sessionId = user.sessionId;
    ws.sessionCheckedAt = Date.now();
    ws.slateRooms = new Set();
    ws.isAlive = true;
    ws.rateWindowStart = Date.now();
    ws.rateCount = 0;
    ws.budgetAt = Date.now();
    ws.msgTokens = UPDATE_MSGS_BURST;
    ws.charTokens = UPDATE_CHARS_BURST;
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
    const now = Date.now();
    for (const client of wss.clients) {
      if (!client.isAlive) { client.terminate(); continue; }
      // Logged out, password reset, or expired: the session row is gone and
      // the socket goes with it.
      if (client.sessionId && now - client.sessionCheckedAt >= SESSION_RECHECK_MS) {
        client.sessionCheckedAt = now;
        let alive = true;
        try { alive = !!stmts.sessionAlive.get(client.sessionId); } catch { /* a failed read keeps the socket */ }
        if (!alive) {
          client.close(1008, 'session ended');
          continue;
        }
      }
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
// log's size is read again, and the room learns the snapshot's version, so
// no one else posts the same one and anyone behind it loads it.
function snapshotStored(slateId, version) {
  logChars.delete(slateId);
  if (wss) broadcast(slateId, { type: 'snapshot', slateId, version });
}

// The doc key rotated: every client must re-resolve its wrapped key and
// rebuild its doc from the fresh canonical blob.
function notifyRekeyed(slateId) {
  logChars.delete(slateId);
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
  logChars.delete(slateId);
  const set = rooms.get(slateId);
  if (!set) return;
  for (const client of [...set]) {
    send(client, { type: 'removed', slateId });
    leaveRoom(slateId, client);
  }
}

module.exports = { attach, issueTicket, notifySlateChanged, snapshotStored, notifyRekeyed, kickMember, closeRoom };
