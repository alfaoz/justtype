// Simple in-memory rate limiter
// Tracks operations per user to prevent abuse while keeping UX smooth

class RateLimiter {
  constructor() {
    // Store: userId -> operation -> [timestamps]
    this.store = new Map();

    // Cleanup old entries every 10 minutes
    setInterval(() => this.cleanup(), 10 * 60 * 1000);
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
  };

  check(userId, operation, factor = 1) {
    const limit = this.limits[operation];
    if (!limit) {
      console.warn(`No rate limit defined for operation: ${operation}`);
      return { allowed: true };
    }

    const key = `${userId}:${operation}`;
    const max = Math.round(limit.max * factor);
    const now = Date.now();
    const windowStart = now - limit.windowMs;

    // Get or create user's operation history
    if (!this.store.has(key)) {
      this.store.set(key, []);
    }

    const timestamps = this.store.get(key);

    // Remove timestamps outside the window
    const recentTimestamps = timestamps.filter(ts => ts > windowStart);
    this.store.set(key, recentTimestamps);

    // Check if limit exceeded
    if (recentTimestamps.length >= max) {
      const oldestTimestamp = Math.min(...recentTimestamps);
      const resetIn = Math.ceil((oldestTimestamp + limit.windowMs - now) / 1000);

      return {
        allowed: false,
        resetIn,
        limit: max,
        current: recentTimestamps.length
      };
    }

    // Add current timestamp
    recentTimestamps.push(now);
    this.store.set(key, recentTimestamps);

    return {
      allowed: true,
      limit: max,
      remaining: max - recentTimestamps.length
    };
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, timestamps] of this.store.entries()) {
      // Find the max window from all limits
      const maxWindow = Math.max(...Object.values(this.limits).map(l => l.windowMs));
      const windowStart = now - maxWindow * 2; // Keep 2x window for safety

      const recentTimestamps = timestamps.filter(ts => ts > windowStart);

      if (recentTimestamps.length === 0) {
        this.store.delete(key);
        cleaned++;
      } else if (recentTimestamps.length < timestamps.length) {
        this.store.set(key, recentTimestamps);
      }
    }

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
  ]);

  return (req, res, next) => {
    let identifier;
    const hasUser = !!(req.user && req.user.id);

    // If the operation is explicitly IP-based OR we don't have a user yet, fall back to IP-based limiting.
    // This prevents unauthenticated routes from silently bypassing rate limits.
    if (ipBasedOperations.has(operation) || !hasUser) {
      identifier = `ip:${getClientIp(req)}`;
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
