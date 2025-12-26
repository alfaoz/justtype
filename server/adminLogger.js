const db = require('./database');

// Helper function to mask email addresses for privacy
function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 3))}@${domain}`;
}

// Recursively mask email fields in an object
function maskEmailsInObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const masked = { ...obj };
  for (const key of Object.keys(masked)) {
    if (key === 'email' && typeof masked[key] === 'string') {
      masked[key] = maskEmail(masked[key]);
    } else if (typeof masked[key] === 'object') {
      masked[key] = maskEmailsInObject(masked[key]);
    }
  }
  return masked;
}

/**
 * Log admin actions for audit trail
 * @param {string} action - Action performed (e.g., 'delete_user', 'view_users')
 * @param {Object} options - Additional options
 * @param {string} options.targetType - Type of target (e.g., 'user', 'slate')
 * @param {number} options.targetId - ID of target
 * @param {Object} options.details - Additional details (stored as JSON)
 * @param {string} options.ipAddress - IP address of admin
 */
function logAdminAction(action, options = {}) {
  try {
    const { targetType, targetId, details, ipAddress } = options;

    db.prepare(`
      INSERT INTO admin_logs (action, target_type, target_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      action,
      targetType || null,
      targetId || null,
      details ? JSON.stringify(details) : null,
      ipAddress || null
    );
  } catch (error) {
    console.error('Failed to log admin action:', error);
    // Don't throw - logging failures shouldn't break admin operations
  }
}

/**
 * Get recent admin logs
 * @param {number} limit - Number of logs to retrieve
 * @param {number} offset - Offset for pagination
 * @param {string} actionFilter - Optional action type filter
 * @returns {Array} Array of admin log entries
 */
function getAdminLogs(limit = 100, offset = 0, actionFilter = null) {
  try {
    let query = `
      SELECT
        id,
        action,
        target_type,
        target_id,
        details,
        ip_address,
        created_at
      FROM admin_logs
    `;

    const params = [];

    if (actionFilter) {
      query += ' WHERE action = ?';
      params.push(actionFilter);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs = db.prepare(query).all(...params);

    // Parse JSON details and mask any email fields for privacy
    return logs.map(log => ({
      ...log,
      details: log.details ? maskEmailsInObject(JSON.parse(log.details)) : null
    }));
  } catch (error) {
    console.error('Failed to get admin logs:', error);
    return [];
  }
}

/**
 * Get admin log statistics
 * @returns {Object} Statistics about admin actions
 */
function getAdminLogStats() {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM admin_logs').get();
    const last24h = db.prepare(`
      SELECT COUNT(*) as count
      FROM admin_logs
      WHERE datetime(created_at) > datetime('now', '-1 day')
    `).get();

    const actionBreakdown = db.prepare(`
      SELECT action, COUNT(*) as count
      FROM admin_logs
      WHERE datetime(created_at) > datetime('now', '-7 days')
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `).all();

    return {
      total: total.count,
      last24h: last24h.count,
      actionBreakdown
    };
  } catch (error) {
    console.error('Failed to get admin log stats:', error);
    return { total: 0, last24h: 0, actionBreakdown: [] };
  }
}

module.exports = {
  logAdminAction,
  getAdminLogs,
  getAdminLogStats
};
