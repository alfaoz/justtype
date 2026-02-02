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
    forgotPassword: { max: 5, windowMs: 60 * 60 * 1000 }, // 5 per hour per IP
    resetPassword: { max: 5, windowMs: 15 * 60 * 1000 }, // 5 per 15 minutes per IP
    resendVerification: { max: 1, windowMs: 60 * 1000 }, // 1 per 60 seconds per IP
    // Slate operations (user-based)
    createSlate: { max: 50, windowMs: 60 * 60 * 1000 }, // 50 per hour (reasonable for creates)
    updateSlate: { max: 2000, windowMs: 60 * 60 * 1000 }, // 2000 per hour (autosave every second = ~33/min)
    deleteSlate: { max: 30, windowMs: 60 * 60 * 1000 }, // 30 per hour
    publishSlate: { max: 30, windowMs: 60 * 60 * 1000 }, // 30 per hour
    // Admin and public operations (IP-based)
    adminAuth: { max: 5, windowMs: 15 * 60 * 1000 }, // 5 attempts per 15 minutes (IP-based)
    viewPublicSlate: { max: 100, windowMs: 60 * 1000 }, // 100 per minute per IP (generous for normal viewing)
    // CLI operations
    approveDevice: { max: 10, windowMs: 15 * 60 * 1000 }, // 10 approvals per 15 minutes
    requestDeviceCode: { max: 10, windowMs: 15 * 60 * 1000 }, // 10 device code requests per 15 minutes (IP-based)
    pollToken: { max: 120, windowMs: 15 * 60 * 1000 }, // 120 polls per 15 minutes (CLI polls every 5s for max 10 min)
  };

  check(userId, operation) {
    const limit = this.limits[operation];
    if (!limit) {
      console.warn(`No rate limit defined for operation: ${operation}`);
      return { allowed: true };
    }

    const key = `${userId}:${operation}`;
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
    if (recentTimestamps.length >= limit.max) {
      const oldestTimestamp = Math.min(...recentTimestamps);
      const resetIn = Math.ceil((oldestTimestamp + limit.windowMs - now) / 1000);

      return {
        allowed: false,
        resetIn,
        limit: limit.max,
        current: recentTimestamps.length
      };
    }

    // Add current timestamp
    recentTimestamps.push(now);
    this.store.set(key, recentTimestamps);

    return {
      allowed: true,
      limit: limit.max,
      remaining: limit.max - recentTimestamps.length
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

function createRateLimitMiddleware(operation) {
  return (req, res, next) => {
    // Use IP-based limiting for unauthenticated auth operations
    let identifier;
    if (['register', 'login', 'forgotPassword', 'resetPassword', 'resendVerification', 'adminAuth', 'viewPublicSlate', 'requestDeviceCode'].includes(operation)) {
      // Get IP address - handle X-Forwarded-For with comma-separated IPs
      let ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

      // X-Forwarded-For can be "client, proxy1, proxy2" - take the first (client) IP
      if (ipAddress.includes(',')) {
        ipAddress = ipAddress.split(',')[0].trim();
      }

      // Remove IPv6 prefix if present
      if (ipAddress.startsWith('::ffff:')) {
        ipAddress = ipAddress.substring(7);
      }

      identifier = `ip:${ipAddress}`;
    } else {
      // Skip rate limiting if no user (shouldn't happen with authenticateToken)
      if (!req.user || !req.user.id) {
        return next();
      }
      identifier = req.user.id;
    }

    const result = rateLimiter.check(identifier, operation);

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
  rateLimiter,
  createRateLimitMiddleware
};
