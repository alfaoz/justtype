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
    createSlate: { max: 50, windowMs: 60 * 60 * 1000 }, // 50 per hour (reasonable for creates)
    updateSlate: { max: 2000, windowMs: 60 * 60 * 1000 }, // 2000 per hour (autosave every second = ~33/min)
    deleteSlate: { max: 30, windowMs: 60 * 60 * 1000 }, // 30 per hour
    publishSlate: { max: 30, windowMs: 60 * 60 * 1000 }, // 30 per hour
    adminAuth: { max: 5, windowMs: 15 * 60 * 1000 }, // 5 attempts per 15 minutes (IP-based)
    // viewSlate removed - public slates should be unlimited (CDN will handle caching)
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
    // For admin auth, use IP address instead of user ID
    let identifier;
    if (operation === 'adminAuth') {
      // Get IP address
      let ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
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
