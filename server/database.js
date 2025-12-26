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
} catch (err) {
  console.error('Database migration error:', err);
}

console.log('✓ Database initialized');

module.exports = db;
