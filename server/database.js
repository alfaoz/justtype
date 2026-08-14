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
    db.exec(`ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'light';`);
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

  // Add pinned_at column to slates if it doesn't exist
  const slateColumnsForPins = db.pragma('table_info(slates)');
  const hasPinnedAt = slateColumnsForPins.some(col => col.name === 'pinned_at');
  if (!hasPinnedAt) {
    db.exec(`ALTER TABLE slates ADD COLUMN pinned_at INTEGER;`);
    console.log('✓ Database migrated: Added pinned_at column to slates');
  }

  // Add encrypted_tags column to slates if it doesn't exist (E2E-only tags)
  const slateColumnsForTags = db.pragma('table_info(slates)');
  const hasEncryptedTags = slateColumnsForTags.some(col => col.name === 'encrypted_tags');
  if (!hasEncryptedTags) {
    db.exec(`ALTER TABLE slates ADD COLUMN encrypted_tags TEXT;`);
    console.log('✓ Database migrated: Added encrypted_tags column to slates');
  }

  // Add per-user sequential slate_number column
  const slateColumnsForNumber = db.pragma('table_info(slates)');
  const hasSlateNumber = slateColumnsForNumber.some(col => col.name === 'slate_number');
  if (!hasSlateNumber) {
    db.exec(`ALTER TABLE slates ADD COLUMN slate_number INTEGER;`);
    // Backfill: assign sequential numbers per user ordered by creation (id)
    const users = db.prepare('SELECT DISTINCT user_id FROM slates').all();
    for (const { user_id } of users) {
      const userSlates = db.prepare('SELECT id FROM slates WHERE user_id = ? ORDER BY id').all(user_id);
      const update = db.prepare('UPDATE slates SET slate_number = ? WHERE id = ?');
      userSlates.forEach((slate, i) => update.run(i + 1, slate.id));
    }
    db.exec(`CREATE UNIQUE INDEX idx_slates_user_slate_number ON slates(user_id, slate_number);`);
    console.log('✓ Database migrated: Added per-user slate_number column');
  }

  // Helpful indexes for slates list performance (safe to run repeatedly)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_slates_user_pinned_at ON slates(user_id, pinned_at);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_slates_user_updated_at ON slates(user_id, updated_at);`);
  } catch (err) {
    // Ignore if indexes can't be created for some reason; don't block startup.
  }

  // ZK title hygiene: if a private slate already has encrypted_title, wipe its plaintext title.
  // (Title column is NOT NULL, so we store an empty string.)
  try {
    const needsWipe = db.prepare(`
      SELECT COUNT(*) as count
      FROM slates
      WHERE is_published = 0
        AND encrypted_title IS NOT NULL
        AND encrypted_title != ''
        AND title != ''
    `).get();

    if (needsWipe && needsWipe.count > 0) {
      db.prepare(`
        UPDATE slates
        SET title = ''
        WHERE is_published = 0
          AND encrypted_title IS NOT NULL
          AND encrypted_title != ''
      `).run();
      console.log(`✓ Database migrated: Wiped plaintext titles for ${needsWipe.count} private slates`);
    }
  } catch (err) {
    // Don't crash startup if this migration fails; log and continue.
    console.warn('Database migration warning: Failed to wipe plaintext titles:', err);
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

  // OAuth 2.0 provider tables (third-party "sign in with justtype")
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE NOT NULL,
      client_secret_hash TEXT,
      name TEXT NOT NULL,
      website TEXT,
      redirect_uris TEXT NOT NULL,
      allowed_scopes TEXT NOT NULL,
      is_confidential INTEGER DEFAULT 0,
      owner_user_id INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oauth_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL DEFAULT 'S256',
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_token_hash TEXT UNIQUE NOT NULL,
      refresh_token_hash TEXT UNIQUE,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      scope TEXT NOT NULL,
      access_expires_at INTEGER NOT NULL,
      refresh_expires_at INTEGER,
      revoked INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      last_used_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_oauth_codes_code ON oauth_codes(code);
    CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_codes(expires_at);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_access ON oauth_tokens(access_token_hash);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_tokens(refresh_token_hash);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client_user ON oauth_tokens(client_id, user_id);

    -- Per-slate delegated read access for third-party apps (key re-wrapping).
    -- The user's browser re-encrypts a private slate under a fresh content key
    -- and wraps that key to the app's public key. The server only ever stores
    -- these opaque blobs; it cannot read them. Revoking = deleting the row.
    CREATE TABLE IF NOT EXISTS oauth_slate_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      slate_number INTEGER NOT NULL,
      wrapped_key TEXT NOT NULL,   -- content key, RSA-OAEP wrapped to the app's public key (base64)
      enc_content TEXT NOT NULL,   -- slate content, AES-256-GCM under the content key (base64)
      enc_title TEXT,              -- slate title, AES-256-GCM under the content key (base64)
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE (client_id, user_id, slate_number),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_grants_client_user ON oauth_slate_grants(client_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_grants_user_slate ON oauth_slate_grants(user_id, slate_number);

    -- "Share all" relationships: an app the user has chosen to give access to ALL
    -- of their private slates (current + future). This is only a flag/intent — the
    -- actual readable data still lives as per-slate blobs in oauth_slate_grants,
    -- wrapped client-side. Its presence makes the client auto-wrap newly written
    -- slates for the app on save. Deleting the row stops future auto-sharing.
    CREATE TABLE IF NOT EXISTS oauth_share_all (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE (client_id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_share_all_user ON oauth_share_all(user_id);

    -- Team / shared developer access to an app. The app's registrant is the
    -- owner (oauth_clients.owner_user_id); rows here grant other justtype users
    -- collaborator access to manage or use that app in the dev portal. Roles:
    --   'editor' — can view credentials and edit the app's settings
    --   'viewer' — can view credentials and use the wizard, but not edit
    -- Only the owner can add/remove collaborators or delete the app.
    CREATE TABLE IF NOT EXISTS oauth_client_collaborators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      added_by INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE (client_id, user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_collab_client ON oauth_client_collaborators(client_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_collab_user ON oauth_client_collaborators(user_id);

    -- Shareable invite links for collaborator access. The owner generates a link
    -- carrying a role; anyone logged in who opens it is onboarded as a
    -- collaborator on accept. Reusable until revoked or expired.
    CREATE TABLE IF NOT EXISTS oauth_client_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      created_by INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      expires_at INTEGER,
      revoked INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_invite_client ON oauth_client_invites(client_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_invite_token ON oauth_client_invites(token);
  `);

  // Add public_key to oauth_clients for key delegation (apps that want private-slate access).
  const oauthClientColumns = db.pragma('table_info(oauth_clients)');
  if (!oauthClientColumns.some(col => col.name === 'public_key')) {
    db.exec(`ALTER TABLE oauth_clients ADD COLUMN public_key TEXT;`);
    console.log('✓ Database migrated: Added public_key column to oauth_clients');
  }

  // Two-way delegation: the per-slate content key is also wrapped to the user's
  // own master key (owner_wrapped_key) so the justtype client can decrypt and
  // ingest edits an app makes. last_writer tracks who touched the grant last
  // ('owner' or 'app') — the client pulls app edits into the canonical slate
  // when last_writer = 'app'.
  const oauthGrantColumns = db.pragma('table_info(oauth_slate_grants)');
  if (!oauthGrantColumns.some(col => col.name === 'owner_wrapped_key')) {
    db.exec(`ALTER TABLE oauth_slate_grants ADD COLUMN owner_wrapped_key TEXT;`);
    console.log('✓ Database migrated: Added owner_wrapped_key column to oauth_slate_grants');
  }
  if (!oauthGrantColumns.some(col => col.name === 'last_writer')) {
    db.exec(`ALTER TABLE oauth_slate_grants ADD COLUMN last_writer TEXT DEFAULT 'owner';`);
    console.log('✓ Database migrated: Added last_writer column to oauth_slate_grants');
  }
  console.log('✓ OAuth provider tables initialized');

  // ---- "drop box": app-initiated encrypted slate creation -----------------
  //
  // Third-party apps can create a NEW private slate for a user without ever
  // touching the user's master key. They encrypt the note under a fresh content
  // key and wrap that key to the USER'S published RSA public key (the one
  // inversion from the app-grant flow, where the user wraps to the app's key).
  // The user's client later decrypts the drop with its RSA private key and
  // "adopts" it as a normal master-key-encrypted slate. The server only ever
  // stores opaque blobs — it cannot read a drop, exactly like every other slate.

  // Each user publishes an RSA-OAEP public key (SPKI, base64) so apps have a
  // wrap target, and stores their RSA private key wrapped under their master key
  // (enc_private_key) so it is recoverable across devices without the server
  // ever seeing it. Both are null until the client generates a keypair on unlock.
  const userKeypairCols = db.pragma('table_info(users)');
  if (!userKeypairCols.some(col => col.name === 'public_key')) {
    db.exec(`ALTER TABLE users ADD COLUMN public_key TEXT;`);
    console.log('✓ Database migrated: Added public_key column to users');
  }
  if (!userKeypairCols.some(col => col.name === 'enc_private_key')) {
    db.exec(`ALTER TABLE users ADD COLUMN enc_private_key TEXT;`);
    console.log('✓ Database migrated: Added enc_private_key column to users');
  }

  // Provenance: a slate adopted from an app drop records which app created it,
  // so the user can see "added by X" and bulk-undo. Null for self-authored slates.
  const slateCols2 = db.pragma('table_info(slates)');
  if (!slateCols2.some(col => col.name === 'source_app')) {
    db.exec(`ALTER TABLE slates ADD COLUMN source_app TEXT;`);
    console.log('✓ Database migrated: Added source_app column to slates');
  }

  db.exec(`
    -- Pending app-created drops, awaiting adoption by the user's client.
    -- wrapped_key is the content key RSA-OAEP wrapped to the USER's public key.
    -- enc_content / enc_title are AES-256-GCM under that content key.
    CREATE TABLE IF NOT EXISTS oauth_slate_drops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      wrapped_key TEXT NOT NULL,
      enc_content TEXT NOT NULL,
      enc_title TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_drops_user ON oauth_slate_drops(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_drops_client ON oauth_slate_drops(client_id, user_id);

    -- Web Push subscriptions, so the server can instantly signal "a drop arrived"
    -- even when no tab is open. The push payload carries no plaintext — only a
    -- wake/notify ping; the actual note is decrypted client-side.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE (user_id, endpoint),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
  `);
  console.log('✓ Slate-drop (app-create) tables initialized');

  // Adoption receipts: a drop row is no longer hard-deleted on adopt/discard.
  // It becomes a thin receipt (blobs nulled) so the creating app can poll the
  // outcome (GET /api/oauth/drops[/:id]) and learn the resulting slate_number
  // instead of content-hash guessing. status: 'pending' | 'adopted' | 'discarded'.
  const dropCols = db.pragma('table_info(oauth_slate_drops)');
  if (!dropCols.some(col => col.name === 'status')) {
    db.exec(`ALTER TABLE oauth_slate_drops ADD COLUMN status TEXT DEFAULT 'pending';`);
    console.log('✓ Database migrated: Added status column to oauth_slate_drops');
  }
  if (!dropCols.some(col => col.name === 'adopted_slate_number')) {
    db.exec(`ALTER TABLE oauth_slate_drops ADD COLUMN adopted_slate_number INTEGER;`);
    console.log('✓ Database migrated: Added adopted_slate_number column to oauth_slate_drops');
  }
  if (!dropCols.some(col => col.name === 'adopted_at')) {
    db.exec(`ALTER TABLE oauth_slate_drops ADD COLUMN adopted_at INTEGER;`);
    console.log('✓ Database migrated: Added adopted_at column to oauth_slate_drops');
  }
  if (!dropCols.some(col => col.name === 'discarded_at')) {
    db.exec(`ALTER TABLE oauth_slate_drops ADD COLUMN discarded_at INTEGER;`);
    console.log('✓ Database migrated: Added discarded_at column to oauth_slate_drops');
  }
  // is_inplace = 1 marks a "create already-delegated" drop: the slate row already
  // exists (numbered, adoption_pending), so adopted_slate_number is set at create
  // time and the user's client adopts it IN PLACE (updates the row) rather than
  // inserting a new slate. 0 for ordinary drops.
  if (!dropCols.some(col => col.name === 'is_inplace')) {
    db.exec(`ALTER TABLE oauth_slate_drops ADD COLUMN is_inplace INTEGER DEFAULT 0;`);
    console.log('✓ Database migrated: Added is_inplace column to oauth_slate_drops');
  }

  // "create already-delegated": an app can create a real, numbered slate it can
  // edit immediately. The slate exists in a pending-adoption state (its canonical
  // master-key content does not exist yet) until the user's client adopts it in
  // place on next open. adoption_pending = 1 marks that state; the user-wrappable
  // payload lives in the linked oauth_slate_drops row (adopted_slate_number set).
  const slateCols3 = db.pragma('table_info(slates)');
  if (!slateCols3.some(col => col.name === 'adoption_pending')) {
    db.exec(`ALTER TABLE slates ADD COLUMN adoption_pending INTEGER DEFAULT 0;`);
    console.log('✓ Database migrated: Added adoption_pending column to slates');
  }

  // Per-document editor mode: 'plain' (textarea) or 'wysiwyg' (rich markdown editor).
  // Deliberately unencrypted metadata: low sensitivity, needed before content decrypts.
  const slateCols4 = db.pragma('table_info(slates)');
  if (!slateCols4.some(col => col.name === 'editor_mode')) {
    db.exec(`ALTER TABLE slates ADD COLUMN editor_mode TEXT DEFAULT 'plain';`);
    console.log('✓ Database migrated: Added editor_mode column to slates');
  }

  // Tombstones for incremental sync (GET /api/oauth/sync). A trigger records every
  // slate deletion regardless of which code path removed it, so third-party clients
  // can propagate deletes without a full re-list. Retained ~90 days (swept by the
  // OAuth periodic cleanup); clients offline longer must do a full re-list.
  db.exec(`
    CREATE TABLE IF NOT EXISTS slate_tombstones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      slate_number INTEGER NOT NULL,
      deleted_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_slate_tombstones_user ON slate_tombstones(user_id, deleted_at);

    -- Drop + recreate so the body always matches this definition (CREATE TRIGGER
    -- IF NOT EXISTS would keep a stale earlier version on an already-migrated db).
    DROP TRIGGER IF EXISTS trg_slate_tombstone;
    CREATE TRIGGER trg_slate_tombstone AFTER DELETE ON slates
    BEGIN
      INSERT INTO slate_tombstones (user_id, slate_number, deleted_at)
      VALUES (OLD.user_id, OLD.slate_number, strftime('%s', 'now'));
      -- A slate's per-app delegation grants die with the slate. Clean them on EVERY
      -- delete path (regular, oauth, account, admin) so slate_number reuse (MAX+1)
      -- can't collide with a stale grant — that previously 500'd create-delegated.
      -- Per-device wraps hang off the grant; delete them first (FK is not enforced
      -- on this connection, so this must be explicit) while the grant ids still resolve.
      DELETE FROM oauth_grant_device_wraps WHERE grant_id IN (
        SELECT id FROM oauth_slate_grants
          WHERE user_id = OLD.user_id AND slate_number = OLD.slate_number
      );
      DELETE FROM oauth_slate_grants
        WHERE user_id = OLD.user_id AND slate_number = OLD.slate_number;
      -- If a still-pending create-already-delegated slate is deleted, mark its
      -- linked drop discarded so the creating app sees the outcome (it never adopted).
      -- wrapped_key / enc_content are NOT NULL, so clear the ciphertext to '' (not NULL).
      UPDATE oauth_slate_drops
        SET status = 'discarded', discarded_at = strftime('%s', 'now'),
            wrapped_key = '', enc_content = '', enc_title = NULL
        WHERE is_inplace = 1 AND status = 'pending'
          AND user_id = OLD.user_id AND adopted_slate_number = OLD.slate_number;
    END;
  `);
  console.log('✓ Slate tombstone (incremental-sync) table + trigger initialized');

  // One-time cleanup: remove orphan grants left by the pre-trigger delete path
  // (regular slate delete never cleaned oauth_slate_grants), so slate_number reuse
  // stops colliding on the grant UNIQUE index. Idempotent — safe on every startup.
  const orphanCleanup = db.prepare(`DELETE FROM oauth_slate_grants
    WHERE NOT EXISTS (SELECT 1 FROM slates s
      WHERE s.user_id = oauth_slate_grants.user_id AND s.slate_number = oauth_slate_grants.slate_number)`).run();
  if (orphanCleanup.changes > 0) {
    console.log(`✓ Database cleanup: removed ${orphanCleanup.changes} orphan oauth_slate_grants`);
  }

  // ---- per-installation device keys (replaces the single global app key) ----
  //
  // A distributed app (e.g. a desktop client) cannot ship one shared
  // private key: it would be extractable from the binary and could decrypt every
  // user's private slates. Instead each INSTALL registers its own RSA-OAEP public
  // key, bound to the (user, client) grant. A user can run several installs, so a
  // grant supports MULTIPLE active device keys. The per-slate content key is then
  // wrapped once per device (oauth_grant_device_wraps). The server still only ever
  // stores public keys + ciphertext — zero-knowledge is unchanged.
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_device_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      public_key TEXT NOT NULL,          -- RSA-OAEP SPKI, base64
      key_scheme TEXT NOT NULL DEFAULT 'rsa-oaep-sha256',
      name TEXT,                         -- optional human label ("MyApp on MacBook")
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      last_seen_at INTEGER,
      revoked INTEGER DEFAULT 0,
      UNIQUE (client_id, user_id, public_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_device_keys_grant ON oauth_device_keys(client_id, user_id, revoked);
    CREATE INDEX IF NOT EXISTS idx_oauth_device_keys_device ON oauth_device_keys(device_id);

    -- The per-device wrapped content key for a delegated slate. One slate has one
    -- content key + one enc_content (on oauth_slate_grants); that key is wrapped
    -- once per device here, so a multi-device user stores the blob once plus a
    -- small RSA wrap per device. Dies with its grant (ON DELETE CASCADE).
    CREATE TABLE IF NOT EXISTS oauth_grant_device_wraps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grant_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      wrapped_key TEXT NOT NULL,         -- content key RSA-OAEP wrapped to THAT device key (base64)
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE (grant_id, device_id),
      FOREIGN KEY (grant_id) REFERENCES oauth_slate_grants(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_grant_device_wraps_grant ON oauth_grant_device_wraps(grant_id);
    CREATE INDEX IF NOT EXISTS idx_grant_device_wraps_device ON oauth_grant_device_wraps(device_id);
  `);

  // Bind a registered device to the access-token row that registered it, so reads
  // resolve the calling device transparently from the bearer token (no extra
  // params). Survives refresh rotation (refresh UPDATEs the same row in place).
  const oauthTokenCols = db.pragma('table_info(oauth_tokens)');
  if (!oauthTokenCols.some(col => col.name === 'device_id')) {
    db.exec(`ALTER TABLE oauth_tokens ADD COLUMN device_id TEXT;`);
    console.log('✓ Database migrated: Added device_id column to oauth_tokens');
  }
  // An authorization code carries the device registered during consent (when the app
  // supplied its installation public key at /oauth/authorize), so the token minted on
  // exchange can be stamped with it — enabling consent-time wrapping + instant reads.
  const oauthCodeCols = db.pragma('table_info(oauth_codes)');
  if (!oauthCodeCols.some(col => col.name === 'device_id')) {
    db.exec(`ALTER TABLE oauth_codes ADD COLUMN device_id TEXT;`);
    console.log('✓ Database migrated: Added device_id column to oauth_codes');
  }
  // Sweep device wraps whose grant is already gone (idempotent; covers any delete
  // path that ran before this table existed). Same spirit as the grant orphan sweep.
  try {
    const wrapOrphans = db.prepare(`DELETE FROM oauth_grant_device_wraps
      WHERE NOT EXISTS (SELECT 1 FROM oauth_slate_grants g WHERE g.id = oauth_grant_device_wraps.grant_id)`).run();
    if (wrapOrphans.changes > 0) {
      console.log(`✓ Database cleanup: removed ${wrapOrphans.changes} orphan oauth_grant_device_wraps`);
    }
  } catch {}
  console.log('✓ OAuth per-device key tables initialized');

  // Note: oauth_slate_grants.wrapped_key (the old single global-app-key wrap) is
  // NOT NULL and can't be cheaply dropped in SQLite. It is now dead — write '' on
  // insert and never read it; the canonical app wrap lives in
  // oauth_grant_device_wraps. better-sqlite3 enables foreign_keys by default, so
  // oauth_grant_device_wraps (grant_id -> oauth_slate_grants ON DELETE CASCADE)
  // and oauth_device_keys (user_id -> users ON DELETE CASCADE) auto-clean when
  // their parent row goes. The grant/slate delete paths still delete wraps
  // explicitly too (belt-and-suspenders + clear intent), which is a harmless no-op
  // under cascade. NOTE: grants reference user_id, not the slate, so a SLATE delete
  // does NOT cascade them — that is why the tombstone trigger below removes grants
  // (and their wraps) by slate_number on every delete path.

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

  // Add export cooldown column (epoch ms) for heavy export operations
  const hasExportCooldownUntil = userColsFinal.some(col => col.name === 'export_cooldown_until');
  if (!hasExportCooldownUntil) {
    db.exec(`ALTER TABLE users ADD COLUMN export_cooldown_until INTEGER;`);
    console.log('✓ Database migrated: Added export_cooldown_until column');
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

  // Add username_changed_at column
  try {
    db.exec(`ALTER TABLE users ADD COLUMN username_changed_at DATETIME DEFAULT NULL`);
  } catch (e) {
    // Column already exists
  }

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
