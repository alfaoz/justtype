// Simple in-memory rate limiter
// Tracks operations per user to prevent abuse while keeping UX smooth
//
// Each key holds one number: the moment its allowance would be fully spent
// (the "theoretical arrival time" of GCRA). An allowed request moves it on
// by window / max, and a request is refused when that would put it more
// than one window ahead of now. So a burst of max still goes through at
// once and the long-run rate stays max per window, but the allowance comes
// back one request at a time instead of all at once when a window rolls
// over. Every check is constant work and constant memory, where a list of
// timestamps grew with the limit and was scanned on every request.

const net = require('net');

// Float slack so that exactly max requests in one instant still fit.
const EPSILON = 1e-6;

class RateLimiter {
  constructor() {
    // Store: "identifier:operation" -> time (ms) its allowance is spent until
    this.store = new Map();

    // Cleanup old entries every 10 minutes. unref so a script that only
    // requires this module can still exit.
    setInterval(() => this.cleanup(), 10 * 60 * 1000).unref();
  }

  // Loose limits - focused on abuse prevention, not normal usage restriction
  limits = {
    // Auth operations (IP-based)
    register: { max: 5, windowMs: 60 * 60 * 1000 }, // 5 per hour per IP
    login: { max: 10, windowMs: 15 * 60 * 1000 }, // 10 per 15 minutes per IP
    verifyEmail: { max: 20, windowMs: 15 * 60 * 1000 }, // 20 per 15 minutes per IP
    forgotPassword: { max: 5, windowMs: 60 * 60 * 1000 }, // 5 per hour per IP
    resetPassword: { max: 5, windowMs: 15 * 60 * 1000 }, // 5 per 15 minutes per IP
    resendVerification: { max: 1, windowMs: 60 * 1000 }, // 1 per 60 seconds per IP
    // Slate operations (user-based)
    createSlate: { max: 200, windowMs: 60 * 60 * 1000 },
    updateSlate: { max: 5000, windowMs: 60 * 60 * 1000 }, // autosave every second = ~33/min
    slateHistory: { max: 1200, windowMs: 60 * 60 * 1000 }, // history bundle reads and label edits
    importSlates: { max: 60, windowMs: 60 * 60 * 1000 }, // batch imports, up to 100 slates each
    deleteSlate: { max: 400, windowMs: 60 * 60 * 1000 }, // to the trash and back is cheap and reversible
    emptyTrash: { max: 40, windowMs: 60 * 60 * 1000 }, // one press clears the whole trash
    publishSlate: { max: 100, windowMs: 60 * 60 * 1000 },
    recoverySources: { max: 10, windowMs: 60 * 60 * 1000 }, // one automatic incident sweep per login
    recoveryReport: { max: 50, windowMs: 24 * 60 * 60 * 1000 }, // successful incident restores only
    // Admin and public operations (IP-based)
    adminAuth: { max: 5, windowMs: 15 * 60 * 1000 }, // 5 attempts per 15 minutes (IP-based)
    viewPublicSlate: { max: 100, windowMs: 60 * 1000 }, // 100 per minute per IP (generous for normal viewing)
    // Collaborative slates
    collabLookup: { max: 30, windowMs: 15 * 60 * 1000 }, // username -> public key lookups (enumeration guard)
    collabEnable: { max: 40, windowMs: 60 * 60 * 1000 }, // enable/disable collab (re-uploads the blob)
    collabInvite: { max: 60, windowMs: 60 * 60 * 1000 }, // invites sent
    collabRespond: { max: 120, windowMs: 60 * 60 * 1000 }, // accept/decline/leave/remove
    collabFetch: { max: 480, windowMs: 15 * 60 * 1000 }, // shared slate content fetches
    collabSnapshot: { max: 240, windowMs: 60 * 60 * 1000 }, // snapshot posts (each re-uploads the doc state)
    // OAuth token endpoint (IP-based) and account email changes (user-based)
    oauthToken: { max: 30, windowMs: 15 * 60 * 1000 }, // 30 per 15 minutes per IP: code exchanges and refreshes
    emailChange: { max: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour per user: each one mails a code to the new address
    verifyEmailChange: { max: 10, windowMs: 60 * 60 * 1000 }, // 10 per hour per user: guesses at that code
  };

  check(userId, operation, factor = 1) {
    const limit = this.limits[operation];
    if (!limit) {
      console.warn(`No rate limit defined for operation: ${operation}`);
      return { allowed: true };
    }

    const key = `${userId}:${operation}`;
    const max = Math.max(1, Math.round(limit.max * factor));
    const now = Date.now();
    const step = limit.windowMs / max;

    // A key with nothing spent, or whose spending lies in the past, starts
    // from now; the trust factor may have changed since, which only changes
    // the step and needs no bookkeeping.
    const spentUntil = Math.max(this.store.get(key) || now, now);
    const next = spentUntil + step;

    if (next - now > limit.windowMs + EPSILON) {
      return {
        allowed: false,
        resetIn: Math.max(1, Math.ceil((next - limit.windowMs - now) / 1000)),
        limit: max,
        current: max
      };
    }

    this.store.set(key, next);

    return {
      allowed: true,
      limit: max,
      remaining: Math.max(0, Math.floor((limit.windowMs - (next - now)) / step + EPSILON))
    };
  }

  // A key whose allowance is spent only until a moment already past holds
  // nothing a fresh key would not, so it goes. That is at most one window
  // of its own operation after its last request.
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, spentUntil] of this.store) {
      if (spentUntil <= now) {
        this.store.delete(key);
        cleaned++;
      }
    }

    pruneTrust(now);

    if (cleaned > 0) {
      console.log(`Rate limiter cleanup: removed ${cleaned} stale entries`);
    }
  }

  // Get current stats for monitoring
  getStats() {
    const stats = {
      totalKeys: this.store.size,
      operations: {}
    };

    for (const operation of Object.keys(this.limits)) {
      stats.operations[operation] = {
        limit: this.limits[operation].max,
        window: `${this.limits[operation].windowMs / 1000}s`
      };
    }

    return stats;
  }
}

// Middleware factory
const rateLimiter = new RateLimiter();

// How much room an account gets on its own slates. An account earns it by
// settling in: how long it has been here and how much it has written, with
// a supporter counted as settled at once. It only ever widens a limit, and
// only on the operations a person does to their own slates -- the guards
// around auth, lookups and recovery are the same for everyone. Read from
// the database at most once every ten minutes per account.
const TRUST_TTL = 10 * 60 * 1000;
const trust = new Map(); // userId -> { factor, at }
const EARNS_TRUST = new Set([
  'createSlate', 'updateSlate', 'slateHistory', 'importSlates',
  'deleteSlate', 'emptyTrash', 'publishSlate',
  'collabEnable', 'collabInvite', 'collabRespond', 'collabFetch', 'collabSnapshot',
]);

// Cached factors past their TTL would be read again anyway; dropping them
// keeps accounts that have gone quiet from staying in memory for good.
function pruneTrust(now = Date.now()) {
  for (const [userId, hit] of trust) {
    if (now - hit.at >= TRUST_TTL) trust.delete(userId);
  }
}

function trustFactor(userId) {
  const hit = trust.get(userId);
  if (hit && Date.now() - hit.at < TRUST_TTL) return hit.factor;
  let factor = 1;
  try {
    const db = require('./database');
    const row = db.prepare(`
      SELECT CAST(julianday('now') - julianday(created_at) AS INTEGER) AS days,
             supporter_tier,
             (SELECT COUNT(*) FROM slates WHERE user_id = users.id AND deleted_at IS NULL) AS slates
      FROM users WHERE id = ?`).get(userId);
    if (row) {
      const days = row.days || 0;
      const slates = row.slates || 0;
      if (days >= 21 && slates >= 25) factor = 10;
      else if (days >= 3 && slates >= 5) factor = 3;
      if (row.supporter_tier) factor = Math.max(factor, 10);
    }
  } catch (err) {
    console.warn('trust lookup failed, treating the account as new:', err.message);
  }
  trust.set(userId, { factor, at: Date.now() });
  return factor;
}

function getClientIp(req) {
  // Prefer Express's `req.ip` which respects the app's `trust proxy` setting.
  // This avoids trusting spoofable X-Forwarded-For headers when the app is hit directly.
  let ipAddress = (req && req.ip) || (req && req.socket && req.socket.remoteAddress) || '';

  if (typeof ipAddress !== 'string') {
    ipAddress = '';
  }

  // Clean up IPv6-mapped IPv4 addresses (::ffff:127.0.0.1 -> 127.0.0.1)
  if (ipAddress.startsWith('::ffff:')) {
    ipAddress = ipAddress.substring(7);
  }

  // Normalize localhost IPv6 for consistent bucketing
  if (ipAddress === '::1') {
    ipAddress = '127.0.0.1';
  }

  return ipAddress || 'unknown';
}

// One IPv6 subscriber usually gets a whole /64 and can pick any address in
// it, so an IPv6 client is limited by its /64. IPv4 stays per address.
function ipRateKey(ip) {
  if (!net.isIPv6(ip)) return ip;
  let a = ip.split('%')[0].toLowerCase();
  // A dotted IPv4 tail fills the last two groups; it counts when '::' is
  // expanded, and an IPv4-mapped address is keyed by that IPv4 address,
  // since its /64 would put every IPv4 client in one bucket.
  let v4 = null;
  if (a.includes('.')) {
    v4 = a.slice(a.lastIndexOf(':') + 1);
    a = a.slice(0, a.lastIndexOf(':') + 1) + '0:0';
  }
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  let groups = h;
  if (tail !== undefined) {
    const t = tail ? tail.split(':') : [];
    groups = [...h, ...new Array(8 - h.length - t.length).fill('0'), ...t];
  }
  if (groups.length !== 8) return ip;
  const n = groups.map(g => parseInt(g, 16));
  if (n.slice(0, 5).every(x => x === 0) && n[5] === 0xffff) {
    return v4 || `${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`;
  }
  return `${n.slice(0, 4).map(x => x.toString(16)).join(':')}::/64`;
}

function createRateLimitMiddleware(operation) {
  const ipBasedOperations = new Set([
    'register',
    'login',
    'verifyEmail',
    'forgotPassword',
    'resetPassword',
    'resendVerification',
    'adminAuth',
    'viewPublicSlate',
    'oauthToken',
  ]);

  return (req, res, next) => {
    let identifier;
    const hasUser = !!(req.user && req.user.id);

    // If the operation is explicitly IP-based OR we don't have a user yet, fall back to IP-based limiting.
    // This prevents unauthenticated routes from silently bypassing rate limits.
    if (ipBasedOperations.has(operation) || !hasUser) {
      identifier = `ip:${ipRateKey(getClientIp(req))}`;
    } else {
      identifier = req.user.id;
    }

    const factor = hasUser && EARNS_TRUST.has(operation) ? trustFactor(req.user.id) : 1;
    const result = rateLimiter.check(identifier, operation, factor);

    if (!result.allowed) {
      return res.status(429).json({
        error: `Too many ${operation} operations. Please slow down.`,
        resetIn: result.resetIn,
        limit: result.limit,
        message: `You can try again in ${result.resetIn} seconds.`
      });
    }

    // Add rate limit info to headers (useful for clients)
    if (result.limit !== undefined) {
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
    }

    next();
  };
}

module.exports = {
  trustFactor,
  rateLimiter,
  createRateLimitMiddleware
};
