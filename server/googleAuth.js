const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto = require('crypto');
const db = require('./database');

// Configure Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'https://justtype.io/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const googleId = profile.id;
    const displayName = profile.displayName;

    // Check if user exists with this Google ID
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);

    if (user) {
      // User exists with Google auth
      return done(null, user);
    }

    // Check if user exists with this email
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (user) {
      // If user has a password (local auth), don't allow Google login
      // This prevents account takeover via Google OAuth
      if (user.password && user.password !== 'google-oauth-no-password') {
        return done(null, false, {
          message: 'account_exists_with_password',
          email: email
        });
      }

      // If user already exists with Google auth, link it
      db.prepare('UPDATE users SET google_id = ?, auth_provider = ?, email_verified = 1 WHERE id = ?')
        .run(googleId, user.auth_provider === 'local' ? 'both' : 'google', user.id);

      console.log(`Linked Google account to existing user: ${email}`);

      // Fetch updated user
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      return done(null, user);
    }

    // Create new user with Google auth
    // Generate random encryption key for Google users
    const encryptionKey = crypto.randomBytes(32); // 256-bit key

    // Encrypt the encryption key with master key
    const masterKey = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'base64');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    const encryptedKey = Buffer.concat([
      cipher.update(encryptionKey),
      cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    // Combine: IV (16 bytes) + Auth Tag (16 bytes) + Encrypted Key (32 bytes)
    const storedEncryptedKey = Buffer.concat([iv, authTag, encryptedKey]).toString('base64');

    // Generate unique username from display name
    let username = displayName.toLowerCase().replace(/\s+/g, '');
    let usernameExists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    let counter = 1;

    while (usernameExists) {
      username = `${displayName.toLowerCase().replace(/\s+/g, '')}${counter}`;
      usernameExists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      counter++;
    }

    const result = db.prepare(`
      INSERT INTO users (username, email, password, google_id, auth_provider, email_verified, encrypted_key)
      VALUES (?, ?, ?, ?, 'google', 1, ?)
    `).run(username, email, 'google-oauth-no-password', googleId, storedEncryptedKey);

    user = {
      id: result.lastInsertRowid,
      username,
      email,
      email_verified: true,
      google_id: googleId,
      auth_provider: 'google',
      encrypted_key: storedEncryptedKey
    };

    console.log(`Created new Google user: ${email}`);
    return done(null, user);

  } catch (error) {
    console.error('Google OAuth error:', error);
    return done(error, null);
  }
}));

// Helper function to decrypt encryption key for Google users
function decryptEncryptionKey(encryptedKeyBase64) {
  try {
    const masterKey = Buffer.from(process.env.MASTER_ENCRYPTION_KEY, 'base64');
    const encryptedData = Buffer.from(encryptedKeyBase64, 'base64');

    // Extract components
    const iv = encryptedData.slice(0, 16);
    const authTag = encryptedData.slice(16, 32);
    const encrypted = encryptedData.slice(32);

    // Decrypt
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    decipher.setAuthTag(authTag);

    const decryptedKey = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return decryptedKey;
  } catch (error) {
    console.error('Failed to decrypt encryption key:', error);
    throw new Error('Failed to decrypt encryption key');
  }
}

// Configure separate Google OAuth Strategy for linking
passport.use('google-link', new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: 'https://justtype.io/auth/google/link/callback',
  passReqToCallback: true
}, async (req, accessToken, refreshToken, profile, done) => {
  // For linking, we just pass through the Google profile
  // The actual linking logic is handled in the callback route
  return done(null, profile);
}));

// Serialize/deserialize (required by passport but we don't use sessions)
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

module.exports = {
  passport,
  decryptEncryptionKey
};
