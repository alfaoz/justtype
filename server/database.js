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
} catch (err) {
  console.error('Database migration error:', err);
}

console.log('✓ Database initialized');

module.exports = db;
