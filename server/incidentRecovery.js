'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RECOVERY_DIR = process.env.INCIDENT_RECOVERY_DIR
  || path.join(__dirname, '..', 'recovery', 'incident-20260821');
const MANIFEST_PATH = path.join(RECOVERY_DIR, 'manifest.json');
// Username of the operator account that receives recovery notifications.
// Unset means restores are recorded but nobody is notified.
const ADMIN_USERNAME = process.env.RECOVERY_ADMIN_USERNAME || null;

const SOURCE_LABELS = {
  device_cache: 'a private device cache',
  public_cache: 'a public-page cache',
  delegated_copy: 'a delegated encrypted copy',
  recovery_vault: 'the local recovery vault',
};

function initializeIncidentRecovery(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incident_recovery_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      slate_number INTEGER NOT NULL,
      source TEXT NOT NULL,
      notification_id INTEGER,
      recovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, slate_number),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_incident_recovery_events_user
      ON incident_recovery_events(user_id);
  `);
}

function safeArchivePath(fileName) {
  if (typeof fileName !== 'string' || path.basename(fileName) !== fileName) {
    throw new Error('invalid incident recovery archive name');
  }
  return path.join(RECOVERY_DIR, fileName);
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('incident recovery manifest must be an array');
  return parsed;
}

function getIncidentRecoverySources(userId) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId)) return [];

  return readManifest()
    .filter((source) => Number(source.userId) === numericUserId)
    .map((source) => {
      const archivePath = safeArchivePath(source.archiveFile);
      const data = fs.readFileSync(archivePath);
      const sha256 = crypto.createHash('sha256').update(data).digest('hex');
      if (data.length !== Number(source.bytes) || sha256 !== source.sha256) {
        throw new Error(`incident recovery archive failed verification: ${source.id}`);
      }
      return {
        id: source.id,
        kind: 'historical_revision',
        likely_slate_number: Number(source.slateNumber),
        uploaded_at: source.uploadedAt,
        bytes: data.length,
        sha256,
        encrypted_content: data.toString('base64'),
      };
    });
}

function getIncidentGrantSources(db, userId) {
  const numericUserId = Number(userId);
  if (!Number.isInteger(numericUserId)) return [];

  return db.prepare(`
    SELECT id, client_id, slate_number, enc_content, enc_title,
           owner_wrapped_key, last_writer, updated_at
    FROM oauth_slate_grants
    WHERE user_id = ?
      AND owner_wrapped_key IS NOT NULL
      AND enc_content IS NOT NULL
    ORDER BY slate_number, updated_at DESC, id DESC
  `).all(numericUserId).map((grant) => ({
    id: `grant-${grant.id}`,
    kind: 'delegated_copy',
    likely_slate_number: Number(grant.slate_number),
    client_id: grant.client_id,
    updated_at: Number(grant.updated_at) || null,
    last_writer: grant.last_writer || null,
    encrypted_content: grant.enc_content,
    encrypted_title: grant.enc_title || null,
    owner_wrapped_key: grant.owner_wrapped_key,
  }));
}

function recordIncidentRecovery(db, { userId, slateNumber, source, b2FileId }) {
  const numericUserId = Number(userId);
  const numericSlateNumber = Number(slateNumber);
  if (!Number.isInteger(numericUserId) || !Number.isInteger(numericSlateNumber)) {
    throw new Error('invalid recovery event identity');
  }
  if (!Object.prototype.hasOwnProperty.call(SOURCE_LABELS, source)) {
    throw new Error('invalid recovery event source');
  }

  return db.transaction(() => {
    const existing = db.prepare(`
      SELECT id, notification_id, recovered_at
      FROM incident_recovery_events
      WHERE user_id = ? AND slate_number = ?
    `).get(numericUserId, numericSlateNumber);
    if (existing) return { duplicate: true, event: existing };

    const recovered = db.prepare(`
      SELECT s.b2_file_id, u.username
      FROM slates s
      JOIN users u ON u.id = s.user_id
      WHERE s.user_id = ? AND s.slate_number = ?
    `).get(numericUserId, numericSlateNumber);
    if (!recovered || recovered.b2_file_id !== b2FileId) {
      throw new Error('recovery receipt no longer matches the canonical slate');
    }

    const admin = ADMIN_USERNAME ? db.prepare(`
      SELECT id, email, username
      FROM users
      WHERE username = ? AND COALESCE(is_system_user, 0) = 0
    `).get(ADMIN_USERNAME) : null;

    let notificationId = null;
    let title = null;
    let message = null;
    if (admin) {
      title = 'slate recovery succeeded';
      message = `@${recovered.username} recovered slate #${numericSlateNumber} from ${SOURCE_LABELS[source]}.`;
      const notification = db.prepare(`
        INSERT INTO notifications (type, title, message, filter_user_ids)
        VALUES ('incident_recovery', ?, ?, ?)
      `).run(title, message, String(admin.id));
      notificationId = notification.lastInsertRowid;
    }

    const event = db.prepare(`
      INSERT INTO incident_recovery_events
        (user_id, slate_number, source, notification_id)
      VALUES (?, ?, ?, ?)
    `).run(numericUserId, numericSlateNumber, source, notificationId);

    return {
      duplicate: false,
      eventId: Number(event.lastInsertRowid),
      notificationId: notificationId === null ? null : Number(notificationId),
      title,
      message,
      adminEmail: admin?.email || null,
    };
  })();
}

module.exports = {
  getIncidentRecoverySources,
  getIncidentGrantSources,
  initializeIncidentRecovery,
  recordIncidentRecovery,
};
