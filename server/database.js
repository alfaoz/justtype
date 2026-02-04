const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.join(dbDir, 'justtype.db'));

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS slates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    b2_file_id TEXT NOT NULL,
    share_id TEXT UNIQUE,
    is_published BOOLEAN DEFAULT 0,
    word_count INTEGER DEFAULT 0,
    char_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_slates_user_id ON slates(user_id);
  CREATE INDEX IF NOT EXISTS idx_slates_share_id ON slates(share_id);

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    device TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
  CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity);

  CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    details TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);
`);

// Add email columns if they don't exist (migration)
try {
  const columns = db.pragma('table_info(users)');
  const hasEmail = columns.some(col => col.name === 'email');
  const hasVerificationCodeExpires = columns.some(col => col.name === 'verification_code_expires');

  if (!hasEmail) {
    db.exec(`
      ALTER TABLE users ADD COLUMN email TEXT;
      ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT 0;
      ALTER TABLE users ADD COLUMN verification_token TEXT;
      ALTER TABLE users ADD COLUMN reset_token TEXT;
      ALTER TABLE users ADD COLUMN reset_token_expires DATETIME;
    `);

    // Create unique index on email (only for non-null values)
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;`);

    console.log('✓ Database migrated: Added email columns');
  }

  // Add code expiry columns if they don't exist
  if (!hasVerificationCodeExpires) {
    db.exec(`
      ALTER TABLE users ADD COLUMN verification_code_expires DATETIME;
      ALTER TABLE users ADD COLUMN reset_code_expires DATETIME;
    `);
    console.log('✓ Database migrated: Added code expiry columns');
  }

  // Add size_bytes column to slates if it doesn't exist
  const slateColumns = db.pragma('table_info(slates)');
  const hasSizeBytes = slateColumns.some(col => col.name === 'size_bytes');
  const hasPublishedAt = slateColumns.some(col => col.name === 'published_at');

  if (!hasSizeBytes) {
    db.exec(`ALTER TABLE slates ADD COLUMN size_bytes INTEGER DEFAULT 0;`);
    console.log('✓ Database migrated: Added size_bytes column');
  }

  if (!hasPublishedAt) {
    db.exec(`ALTER TABLE slates ADD COLUMN published_at DATETIME;`);
    console.log('✓ Database migrated: Added published_at column');
  }

  // Add pending_email column to users if it doesn't exist
  const userColumns = db.pragma('table_info(users)');
  const hasPendingEmail = userColumns.some(col => col.name === 'pending_email');

  if (!hasPendingEmail) {
    db.exec(`ALTER TABLE users ADD COLUMN pending_email TEXT;`);
    console.log('✓ Database migrated: Added pending_email column');
  }

  // Add Google OAuth columns to users if they don't exist
  const hasGoogleId = userColumns.some(col => col.name === 'google_id');
  const hasAuthProvider = userColumns.some(col => col.name === 'auth_provider');
  const hasEncryptedKey = userColumns.some(col => col.name === 'encrypted_key');

  if (!hasGoogleId) {
    db.exec(`ALTER TABLE users ADD COLUMN google_id TEXT;`);
    console.log('✓ Database migrated: Added google_id column');
  }

  // Add unique index on google_id if it doesn't exist
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;`);
  } catch (err) {
    // Ignore if index already exists
  }

  if (!hasAuthProvider) {
    db.exec(`ALTER TABLE users ADD COLUMN auth_provider TEXT DEFAULT 'local';`);
    console.log('✓ Database migrated: Added auth_provider column');
  }

  if (!hasEncryptedKey) {
    db.exec(`ALTER TABLE users ADD COLUMN encrypted_key TEXT;`);
    console.log('✓ Database migrated: Added encrypted_key column');
  }

  // Add encryption_salt to users if it doesn't exist
  const hasEncryptionSalt = userColumns.some(col => col.name === 'encryption_salt');
  if (!hasEncryptionSalt) {
    db.exec(`ALTER TABLE users ADD COLUMN encryption_salt TEXT;`);
    console.log('✓ Database migrated: Added encryption_salt column to users');
  }

  // Add encryption columns to slates if they don't exist
  const slateColumnsCheck = db.pragma('table_info(slates)');
  const hasEncryptionVersion = slateColumnsCheck.some(col => col.name === 'encryption_version');
  const hasPublicFileId = slateColumnsCheck.some(col => col.name === 'b2_public_file_id');

  if (!hasEncryptionVersion) {
    db.exec(`ALTER TABLE slates ADD COLUMN encryption_version INTEGER DEFAULT 0;`);
    console.log('✓ Database migrated: Added encryption_version column to slates');
  }

  if (!hasPublicFileId) {
    db.exec(`ALTER TABLE slates ADD COLUMN b2_public_file_id TEXT;`);
    console.log('✓ Database migrated: Added b2_public_file_id column to slates');
  }

  // Add Google unlink verification columns
  const hasUnlinkGoogleCode = userColumns.some(col => col.name === 'unlink_google_code');
  const hasUnlinkGoogleCodeExpires = userColumns.some(col => col.name === 'unlink_google_code_expires');

  if (!hasUnlinkGoogleCode) {
    db.exec(`ALTER TABLE users ADD COLUMN unlink_google_code TEXT;`);
    console.log('✓ Database migrated: Added unlink_google_code column');
  }

  if (!hasUnlinkGoogleCodeExpires) {
    db.exec(`ALTER TABLE users ADD COLUMN unlink_google_code_expires DATETIME;`);
    console.log('✓ Database migrated: Added unlink_google_code_expires column');
  }

  // Add storage tracking columns
  const hasStorageLimit = userColumns.some(col => col.name === 'storage_limit');
  const hasStorageUsed = userColumns.some(col => col.name === 'storage_used');

  if (!hasStorageLimit) {
    db.exec(`ALTER TABLE users ADD COLUMN storage_limit INTEGER DEFAULT 25000000;`); // 25MB default
    console.log('✓ Database migrated: Added storage_limit column');
  }

  if (!hasStorageUsed) {
    db.exec(`ALTER TABLE users ADD COLUMN storage_used INTEGER DEFAULT 0;`);
    console.log('✓ Database migrated: Added storage_used column');
  }

  // Add visit tracking column
  const hasVisitCount = userColumns.some(col => col.name === 'visit_count');

  if (!hasVisitCount) {
    db.exec(`ALTER TABLE users ADD COLUMN visit_count INTEGER DEFAULT 0;`);
    console.log('✓ Database migrated: Added visit_count column');
  }

  // Add supporter tier columns
  const hasSupporterTier = userColumns.some(col => col.name === 'supporter_tier');
  const hasSupporterBadgeVisible = userColumns.some(col => col.name === 'supporter_badge_visible');
  const hasDonatedAt = userColumns.some(col => col.name === 'donated_at');

  if (!hasSupporterTier) {
    db.exec(`ALTER TABLE users ADD COLUMN supporter_tier TEXT;`); // NULL, 'one_time', 'quarterly'
    console.log('✓ Database migrated: Added supporter_tier column');
  }

  if (!hasSupporterBadgeVisible) {
    db.exec(`ALTER TABLE users ADD COLUMN supporter_badge_visible BOOLEAN DEFAULT 1;`);
    console.log('✓ Database migrated: Added supporter_badge_visible column');
  }

  if (!hasDonatedAt) {
    db.exec(`ALTER TABLE users ADD COLUMN donated_at DATETIME;`);
    console.log('✓ Database migrated: Added donated_at column');
  }

  // Add Stripe integration columns
  const hasStripeCustomerId = userColumns.some(col => col.name === 'stripe_customer_id');
  const hasStripeSubscriptionId = userColumns.some(col => col.name === 'stripe_subscription_id');
  const hasSubscriptionExpiresAt = userColumns.some(col => col.name === 'subscription_expires_at');

  if (!hasStripeCustomerId) {
    db.exec(`ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;`);
    console.log('✓ Database migrated: Added stripe_customer_id column');
  }

  if (!hasStripeSubscriptionId) {
    db.exec(`ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;`);
    console.log('✓ Database migrated: Added stripe_subscription_id column');
  }

  if (!hasSubscriptionExpiresAt) {
    db.exec(`ALTER TABLE users ADD COLUMN subscription_expires_at DATETIME;`);
    console.log('✓ Database migrated: Added subscription_expires_at column');
  }

  // Add terms acceptance columns
  const hasTermsAccepted = userColumns.some(col => col.name === 'terms_accepted');
  const hasTermsAcceptedAt = userColumns.some(col => col.name === 'terms_accepted_at');

  if (!hasTermsAccepted) {
    db.exec(`ALTER TABLE users ADD COLUMN terms_accepted BOOLEAN DEFAULT 0;`);
    console.log('✓ Database migrated: Added terms_accepted column');
  }

  if (!hasTermsAcceptedAt) {
    db.exec(`ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME;`);
    console.log('✓ Database migrated: Added terms_accepted_at column');
  }

  // Add grace period columns for storage downgrade management
  const hasGracePeriodExpires = userColumns.some(col => col.name === 'grace_period_expires');
  const hasGracePeriodTargetTier = userColumns.some(col => col.name === 'grace_period_target_tier');

  if (!hasGracePeriodExpires) {
    db.exec(`ALTER TABLE users ADD COLUMN grace_period_expires DATETIME;`);
    console.log('✓ Database migrated: Added grace_period_expires column');
  }

  if (!hasGracePeriodTargetTier) {
    db.exec(`ALTER TABLE users ADD COLUMN grace_period_target_tier TEXT;`); // 'free' or 'one_time'
    console.log('✓ Database migrated: Added grace_period_target_tier column');
  }

  // Add IP tracking preference column
  const hasTrackIpAddress = userColumns.some(col => col.name === 'track_ip_address');

  if (!hasTrackIpAddress) {
    db.exec(`ALTER TABLE users ADD COLUMN track_ip_address BOOLEAN DEFAULT 1;`);
    console.log('✓ Database migrated: Added track_ip_address column');
  }

  // Add theme preference column
  const hasTheme = userColumns.some(col => col.name === 'theme');

  if (!hasTheme) {
    db.exec(`ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'dark';`);
    console.log('✓ Database migrated: Added theme column');
  }

  // Add custom_themes column for syncing custom themes (JSON, max 3 themes)
  const hasCustomThemes = userColumns.some(col => col.name === 'custom_themes');

  if (!hasCustomThemes) {
    db.exec(`ALTER TABLE users ADD COLUMN custom_themes TEXT;`); // JSON string
    console.log('✓ Database migrated: Added custom_themes column');
  }

  // Add view_count column to slates if it doesn't exist
  const hasViewCount = slateColumnsCheck.some(col => col.name === 'view_count');

  if (!hasViewCount) {
    db.exec(`ALTER TABLE slates ADD COLUMN view_count INTEGER DEFAULT 0;`);
    console.log('✓ Database migrated: Added view_count column to slates');
  }

  // Add is_system_user column to users if it doesn't exist
  const hasIsSystemUser = userColumns.some(col => col.name === 'is_system_user');

  if (!hasIsSystemUser) {
    db.exec(`ALTER TABLE users ADD COLUMN is_system_user BOOLEAN DEFAULT 0;`);
    console.log('✓ Database migrated: Added is_system_user column to users');
  }

  // Add is_system_slate column to slates if it doesn't exist
  const hasIsSystemSlate = slateColumnsCheck.some(col => col.name === 'is_system_slate');

  if (!hasIsSystemSlate) {
    db.exec(`ALTER TABLE slates ADD COLUMN is_system_slate BOOLEAN DEFAULT 0;`);
    console.log('✓ Database migrated: Added is_system_slate column to slates');
  }

  // Add encrypted_title column to slates if it doesn't exist
  const hasEncryptedTitle = slateColumnsCheck.some(col => col.name === 'encrypted_title');

  if (!hasEncryptedTitle) {
    db.exec(`ALTER TABLE slates ADD COLUMN encrypted_title TEXT;`);
    console.log('✓ Database migrated: Added encrypted_title column to slates');
  }

  // Create CLI device codes table for OAuth device flow
  db.exec(`
    CREATE TABLE IF NOT EXISTS cli_device_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_code TEXT UNIQUE NOT NULL,
      user_code TEXT UNIQUE NOT NULL,
      user_id INTEGER,
      approved INTEGER DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cli_device_codes_device_code ON cli_device_codes(device_code);
    CREATE INDEX IF NOT EXISTS idx_cli_device_codes_user_code ON cli_device_codes(user_code);
    CREATE INDEX IF NOT EXISTS idx_cli_device_codes_expires_at ON cli_device_codes(expires_at);
  `);
  console.log('✓ CLI device codes table initialized');

  // Drop old empty announcement tables if they exist
  db.exec(`DROP TABLE IF EXISTS announcement_reads;`);
  db.exec(`DROP TABLE IF EXISTS announcements;`);

  // Create notification system tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'global',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      filter_min_slates INTEGER,
      filter_max_slates INTEGER,
      filter_plan TEXT,
      filter_verified_only BOOLEAN DEFAULT 0,
      filter_min_views INTEGER,
      filter_user_ids TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notification_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      notification_id INTEGER NOT NULL,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
      UNIQUE(user_id, notification_id)
    );

    CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id);

    CREATE TABLE IF NOT EXISTS notification_automations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      enabled BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS automation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      slate_id INTEGER,
      fired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (automation_id) REFERENCES notification_automations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(automation_id, user_id, slate_id)
    );

    CREATE INDEX IF NOT EXISTS idx_automation_log_automation ON automation_log(automation_id);
    CREATE INDEX IF NOT EXISTS idx_automation_log_user ON automation_log(user_id);
  `);
  console.log('✓ Notification system tables initialized');

  // Add key-wrapping columns for encryption architecture upgrade
  const userColsFinal = db.pragma('table_info(users)');
  const hasWrappedKey = userColsFinal.some(col => col.name === 'wrapped_key');
  const hasRecoveryWrappedKey = userColsFinal.some(col => col.name === 'recovery_wrapped_key');
  const hasRecoverySalt = userColsFinal.some(col => col.name === 'recovery_salt');
  const hasKeyMigrated = userColsFinal.some(col => col.name === 'key_migrated');

  if (!hasWrappedKey) {
    db.exec(`ALTER TABLE users ADD COLUMN wrapped_key TEXT;`);
    console.log('✓ Database migrated: Added wrapped_key column');
  }
  if (!hasRecoveryWrappedKey) {
    db.exec(`ALTER TABLE users ADD COLUMN recovery_wrapped_key TEXT;`);
    console.log('✓ Database migrated: Added recovery_wrapped_key column');
  }
  if (!hasRecoverySalt) {
    db.exec(`ALTER TABLE users ADD COLUMN recovery_salt TEXT;`);
    console.log('✓ Database migrated: Added recovery_salt column');
  }
  if (!hasKeyMigrated) {
    db.exec(`ALTER TABLE users ADD COLUMN key_migrated BOOLEAN DEFAULT 0;`);
    console.log('✓ Database migrated: Added key_migrated column');
  }

  const hasRecoveryKeyShown = userColsFinal.some(col => col.name === 'recovery_key_shown');
  if (!hasRecoveryKeyShown) {
    db.exec(`ALTER TABLE users ADD COLUMN recovery_key_shown BOOLEAN DEFAULT 1;`);
    console.log('✓ Database migrated: Added recovery_key_shown column');
  }

  const hasE2eMigrated = userColsFinal.some(col => col.name === 'e2e_migrated');
  if (!hasE2eMigrated) {
    db.exec(`ALTER TABLE users ADD COLUMN e2e_migrated INTEGER DEFAULT 0;`);
    console.log('✓ Database migrated: Added e2e_migrated column');
  }

  const hasPinWrappedKey = userColsFinal.some(col => col.name === 'pin_wrapped_key');
  if (!hasPinWrappedKey) {
    db.exec(`ALTER TABLE users ADD COLUMN pin_wrapped_key TEXT;`);
    db.exec(`ALTER TABLE users ADD COLUMN pin_salt TEXT;`);
    // Migrate existing Google E2E users: move wrapped_key → pin_wrapped_key
    const googleE2eUsers = db.prepare(`SELECT id FROM users WHERE auth_provider = 'google' AND e2e_migrated = 1 AND wrapped_key IS NOT NULL`).all();
    for (const user of googleE2eUsers) {
      db.prepare(`UPDATE users SET pin_wrapped_key = wrapped_key, pin_salt = encryption_salt, wrapped_key = NULL, encryption_salt = NULL WHERE id = ?`).run(user.id);
    }
    console.log(`✓ Database migrated: Added pin_wrapped_key/pin_salt columns, migrated ${googleE2eUsers.length} Google E2E users`);
  }

  // Create incidents tables for status page
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'minor',
      status TEXT NOT NULL DEFAULT 'investigating',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS incident_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON incidents(created_at);
    CREATE INDEX IF NOT EXISTS idx_incident_updates_incident_id ON incident_updates(incident_id);
  `);
  console.log('✓ Incidents tables initialized');

  // Create feedback table
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      message TEXT NOT NULL,
      contact_email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
  console.log('✓ Feedback table initialized');
} catch (err) {
  console.error('Database migration error:', err);
}

console.log('✓ Database initialized');

module.exports = db;
