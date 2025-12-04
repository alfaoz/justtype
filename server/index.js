require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { customAlphabet } = require('nanoid');
const db = require('./database');
const b2Storage = require('./b2Storage');
const b2Monitor = require('./b2Monitor');
const { B2Error } = require('./b2ErrorHandler');
const emailService = require('./emailService');
const { logAdminAction, getAdminLogs, getAdminLogStats } = require('./adminLogger');
const { validateEmailForRegistration } = require('./emailValidator');
const { createRateLimitMiddleware } = require('./rateLimiter');
const { healthChecks } = require('./startupHealth');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

// Validate required environment variables on startup
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET not set in .env file');
  process.exit(1);
}

if (!process.env.B2_APPLICATION_KEY_ID || !process.env.B2_APPLICATION_KEY || !process.env.B2_BUCKET_ID) {
  console.error('FATAL: B2 credentials not set in .env file');
  console.error('Required: B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_ID');
  process.exit(1);
}

if (!process.env.RESEND_API_KEY) {
  console.warn('WARNING: RESEND_API_KEY not set - email features will not work');
}

// Generate short share IDs (e.g., "a3bK9qL")
const generateShareId = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);

// Generate unique share ID with collision checking
const generateUniqueShareId = () => {
  let attempts = 0;
  while (attempts < 10) {
    const shareId = generateShareId();
    const existing = db.prepare('SELECT id FROM slates WHERE share_id = ?').get(shareId);
    if (!existing) {
      return shareId;
    }
    attempts++;
  }
  throw new Error('Failed to generate unique share ID after 10 attempts');
};

// In-memory cache for encryption keys (keyed by userId)
const encryptionKeyCache = new Map();

// Derive encryption key from password + salt using PBKDF2
const deriveEncryptionKey = (password, salt) => {
  // Use PBKDF2 with 100,000 iterations (good balance of security and performance)
  // Returns a 32-byte (256-bit) key for AES-256
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
};

// Get or create encryption salt for a user
const getOrCreateEncryptionSalt = (userId) => {
  const user = db.prepare('SELECT encryption_salt FROM users WHERE id = ?').get(userId);

  if (user.encryption_salt) {
    return user.encryption_salt;
  }

  // Generate new salt for this user
  const salt = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE users SET encryption_salt = ? WHERE id = ?').run(salt, userId);
  return salt;
};

// Cache encryption key for a user session
const cacheEncryptionKey = (userId, encryptionKey) => {
  encryptionKeyCache.set(userId, {
    key: encryptionKey,
    timestamp: Date.now()
  });

  // Auto-expire keys after 24 hours
  setTimeout(() => {
    encryptionKeyCache.delete(userId);
  }, 24 * 60 * 60 * 1000);
};

// Get cached encryption key for a user
const getCachedEncryptionKey = (userId) => {
  const cached = encryptionKeyCache.get(userId);
  if (cached) {
    return cached.key;
  }
  return null;
};

// CORS configuration - only allow our domain
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://justtype.io', 'https://www.justtype.io']
    : true // Allow all in development
  // Note: credentials not needed since we use Bearer tokens, not cookies
}));

// Security headers with helmet.js
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP to allow inline styles/scripts from Vite
  crossOriginEmbedderPolicy: false // Allow embedding for public slates
}));

app.use(express.json({ limit: '5mb' })); // Lower limit to prevent bandwidth abuse

// Handle payload too large errors
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Slate content too large. Maximum size is 5MB.',
      maxSize: '5MB'
    });
  }
  next(err);
});

// Trust proxy for correct IP addresses when behind reverse proxy (nginx, etc)
app.set('trust proxy', true);

// Serve static files from dist directory with cache control
const path = require('path');
app.use(express.static(path.join(__dirname, '..', 'dist'), {
  maxAge: 0,
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Don't cache HTML files
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // Don't cache JS/CSS files either (Vite handles hashing)
    else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// Helper function to parse device info from user agent
const parseDevice = (userAgent) => {
  if (!userAgent) return 'Unknown Device';

  // Mobile
  if (/Mobile|Android|iPhone|iPad|iPod/i.test(userAgent)) {
    if (/iPhone/i.test(userAgent)) return 'iPhone';
    if (/iPad/i.test(userAgent)) return 'iPad';
    if (/Android/i.test(userAgent)) return 'Android';
    return 'Mobile Device';
  }

  // Desktop
  if (/Windows/i.test(userAgent)) return 'Windows PC';
  if (/Mac OS X/i.test(userAgent)) return 'Mac';
  if (/Linux/i.test(userAgent)) return 'Linux';

  return 'Unknown Device';
};

// Helper function to create session
const createSession = (userId, token, req) => {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const device = parseDevice(req.headers['user-agent']);

  // Get IP address - prioritize x-forwarded-for for proxy/load balancer setups
  let ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.connection.remoteAddress || req.ip || '';

  // If x-forwarded-for has multiple IPs (proxy chain), use the first one (client IP)
  if (ipAddress.includes(',')) {
    ipAddress = ipAddress.split(',')[0].trim();
  }

  // Clean up IPv6-mapped IPv4 addresses (::ffff:127.0.0.1 -> 127.0.0.1)
  if (ipAddress && ipAddress.startsWith('::ffff:')) {
    ipAddress = ipAddress.substring(7);
  }

  // Normalize localhost variations to a consistent format
  if (ipAddress === '::1' || ipAddress === '127.0.0.1') {
    ipAddress = 'localhost';
  }

  try {
    // Create new session (cleanup handled by hourly cron)
    db.prepare('INSERT INTO sessions (user_id, token_hash, device, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)')
      .run(userId, tokenHash, device, ipAddress, req.headers['user-agent']);
  } catch (err) {
    console.error('Session creation error:', err);
  }
};

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Check if session exists in database and update last activity
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const result = db.prepare('UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE token_hash = ?').run(tokenHash);

      // If no rows were updated, the session doesn't exist (was deleted)
      if (result.changes === 0) {
        return res.status(401).json({ error: 'Session expired or logged out' });
      }
    } catch (err) {
      console.error('Session update error:', err);
      return res.status(500).json({ error: 'Session validation failed' });
    }

    req.user = user;
    req.token = token;
    next();
  });
};

// Middleware to check if encryption key exists in cache
// If missing (e.g., after server restart), force user to re-login
const requireEncryptionKey = (req, res, next) => {
  const encryptionKey = getCachedEncryptionKey(req.user.id);

  if (!encryptionKey) {
    return res.status(401).json({
      error: 'Session expired. Please log in again to access encrypted content.',
      code: 'ENCRYPTION_KEY_MISSING'
    });
  }

  req.encryptionKey = encryptionKey;
  next();
};

// ============ AUTH ROUTES ============

// Register
app.post('/api/auth/register', createRateLimitMiddleware('register'), async (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password || !email) {
    return res.status(400).json({ error: 'Username, password, and email are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  // Validate email
  const emailValidation = await validateEmailForRegistration(email);
  if (!emailValidation.valid) {
    return res.status(400).json({ error: emailValidation.error });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate 6-digit code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    const stmt = db.prepare('INSERT INTO users (username, password, email, verification_token, verification_code_expires) VALUES (?, ?, ?, ?, ?)');
    const result = stmt.run(username, hashedPassword, email.toLowerCase(), verificationCode, expiresAt);

    // Send verification email
    const emailSent = await emailService.sendVerificationEmail(email, username, verificationCode);
    if (!emailSent) {
      console.error(`⚠️  Failed to send verification email to ${email}`);
      // Continue anyway - user can resend later
    }

    const token = jwt.sign({ id: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '30d' });

    // Create session
    createSession(result.lastInsertRowid, token, req);

    // Derive and cache encryption key for this user
    const salt = getOrCreateEncryptionSalt(result.lastInsertRowid);
    const encryptionKey = deriveEncryptionKey(password, salt);
    cacheEncryptionKey(result.lastInsertRowid, encryptionKey);

    res.status(201).json({
      token,
      user: {
        id: result.lastInsertRowid,
        username,
        email: email.toLowerCase(),
        email_verified: false
      },
      message: 'Account created! Check your email for a verification code.'
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed: users.username')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    if (error.message.includes('UNIQUE constraint failed: users.email')) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/auth/login', createRateLimitMiddleware('login'), async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Derive and cache encryption key for this user
    const salt = getOrCreateEncryptionSalt(user.id);
    const encryptionKey = deriveEncryptionKey(password, salt);
    cacheEncryptionKey(user.id, encryptionKey);

    // Check email verification - if not verified, send special response
    if (!user.email_verified) {
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

      // Create session
      createSession(user.id, token, req);

      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          email_verified: false
        },
        requiresVerification: true
      });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

    // Create session
    createSession(user.id, token, req);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        email_verified: user.email_verified
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify email with code
app.post('/api/auth/verify-email', async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND verification_token = ?').get(email.toLowerCase(), code);

    if (!user) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    if (user.email_verified) {
      return res.json({ message: 'Email already verified' });
    }

    // Check if code expired
    if (new Date(user.verification_code_expires) < new Date()) {
      return res.status(400).json({ error: 'Verification code expired. Request a new one.' });
    }

    // Mark email as verified
    db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL, verification_code_expires = NULL WHERE id = ?').run(user.id);

    res.json({ message: 'Email verified successfully!' });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Get current user info
app.get('/api/auth/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, email, email_verified FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      email_verified: user.email_verified
    });
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Resend verification email
app.post('/api/auth/resend-verification', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.email_verified) {
      return res.json({ message: 'Email already verified' });
    }

    // Generate new code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.prepare('UPDATE users SET verification_token = ?, verification_code_expires = ? WHERE id = ?')
      .run(verificationCode, expiresAt, user.id);

    await emailService.sendVerificationEmail(user.email, user.username, verificationCode);

    res.json({ message: 'Verification code sent!' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// Request password reset
app.post('/api/auth/forgot-password', createRateLimitMiddleware('forgotPassword'), async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

    if (!user) {
      // Don't reveal if email exists or not
      return res.json({ message: 'If an account exists with this email, you will receive a reset code.' });
    }

    // Generate reset code (expires in 10 minutes)
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.prepare('UPDATE users SET reset_token = ?, reset_code_expires = ? WHERE id = ?')
      .run(resetCode, expiresAt, user.id);

    await emailService.sendPasswordResetEmail(user.email, user.username, resetCode);

    res.json({ message: 'If an account exists with this email, you will receive a reset code.' });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

// Reset password
app.post('/api/auth/reset-password', createRateLimitMiddleware('resetPassword'), async (req, res) => {
  const { email, code, newPassword } = req.body;

  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, code, and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND reset_token = ?').get(email.toLowerCase(), code);

    if (!user) {
      return res.status(400).json({ error: 'Invalid reset code' });
    }

    // Check if code is expired
    if (new Date(user.reset_code_expires) < new Date()) {
      return res.status(400).json({ error: 'Reset code has expired' });
    }

    // Hash new password and clear reset code
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password = ?, reset_token = NULL, reset_code_expires = NULL WHERE id = ?')
      .run(hashedPassword, user.id);

    res.json({ message: 'Password reset successfully!' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ============ SLATE ROUTES ============

// Get all slates for authenticated user
app.get('/api/slates', authenticateToken, (req, res) => {
  try {
    const slates = db.prepare(`
      SELECT id, title, is_published, share_id, word_count, char_count, created_at, updated_at, published_at
      FROM slates
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(req.user.id);

    res.json(slates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch slates' });
  }
});

// Get single slate (with content)
app.get('/api/slates/:id', authenticateToken, requireEncryptionKey, async (req, res) => {
  try {
    const slate = db.prepare(`
      SELECT * FROM slates WHERE id = ? AND user_id = ?
    `).get(req.params.id, req.user.id);

    if (!slate) {
      return res.status(404).json({ error: 'Slate not found' });
    }

    // Use encryption key from middleware (already verified to exist)
    const encryptionKey = slate.encryption_version === 1 ? req.encryptionKey : null;

    // Fetch content from B2 (decrypt if encrypted)
    const content = await b2Storage.getSlate(slate.b2_file_id, encryptionKey);

    res.json({ ...slate, content });
  } catch (error) {
    console.error('Get slate error:', error);
    if (error instanceof B2Error) {
      return res.status(error.code === 'B2_RATE_LIMIT' ? 429 : 500).json({
        error: error.userMessage,
        code: error.code
      });
    }
    res.status(500).json({ error: 'Failed to fetch slate' });
  }
});

// Create new slate
app.post('/api/slates', authenticateToken, requireEncryptionKey, createRateLimitMiddleware('createSlate'), async (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content required' });
  }

  // Check content size (5 MB limit)
  const contentSize = Buffer.byteLength(content, 'utf8');
  const maxSize = 5 * 1024 * 1024; // 5 MB
  if (contentSize > maxSize) {
    return res.status(413).json({
      error: `Content too large. Maximum size is 5 MB, your content is ${(contentSize / 1024 / 1024).toFixed(2)} MB.`
    });
  }

  try {
    // Check slate limit (50 slates per user)
    const slateCount = db.prepare('SELECT COUNT(*) as count FROM slates WHERE user_id = ?').get(req.user.id);
    if (slateCount.count >= 50) {
      return res.status(403).json({ error: 'Slate limit reached (50 max). Delete some slates to create new ones.' });
    }

    // Use encryption key from middleware (already verified to exist)
    const encryptionKey = req.encryptionKey;

    // Upload content to B2 (encrypted)
    const slateId = `${req.user.id}-${Date.now()}`;
    const b2FileId = await b2Storage.uploadSlate(slateId, content, encryptionKey);

    // Calculate stats
    const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
    const charCount = content.length;
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    // Save metadata to database with encryption_version = 1
    const stmt = db.prepare(`
      INSERT INTO slates (user_id, title, b2_file_id, word_count, char_count, size_bytes, encryption_version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(req.user.id, title, b2FileId, wordCount, charCount, sizeBytes, encryptionKey ? 1 : 0);

    res.status(201).json({
      id: result.lastInsertRowid,
      title,
      word_count: wordCount,
      char_count: charCount,
      is_published: 0,
      share_id: null
    });
  } catch (error) {
    console.error('Create slate error:', error);
    if (error instanceof B2Error) {
      return res.status(error.code === 'B2_RATE_LIMIT' ? 429 : 500).json({
        error: error.userMessage,
        code: error.code
      });
    }
    res.status(500).json({ error: 'Failed to create slate' });
  }
});

// Update slate
app.put('/api/slates/:id', authenticateToken, requireEncryptionKey, createRateLimitMiddleware('updateSlate'), async (req, res) => {
  const { title, content } = req.body;

  // Check content size (5 MB limit)
  const contentSize = Buffer.byteLength(content, 'utf8');
  const maxSize = 5 * 1024 * 1024; // 5 MB
  if (contentSize > maxSize) {
    return res.status(413).json({
      error: `Content too large. Maximum size is 5 MB, your content is ${(contentSize / 1024 / 1024).toFixed(2)} MB.`
    });
  }

  try {
    const slate = db.prepare('SELECT * FROM slates WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

    if (!slate) {
      return res.status(404).json({ error: 'Slate not found' });
    }

    // Use encryption key from middleware (already verified to exist)
    const encryptionKey = req.encryptionKey;

    // Auto-unpublish if slate is currently published
    // This prevents accidentally publishing work-in-progress changes
    let wasUnpublished = false;
    if (slate.is_published) {
      wasUnpublished = true;

      // Delete public B2 copy if it exists
      if (slate.b2_public_file_id) {
        try {
          await b2Storage.deleteSlate(slate.b2_public_file_id);
        } catch (err) {
          console.warn('Failed to delete public B2 file:', err);
        }
      }
    }

    // Upload new version to B2 (encrypted)
    const slateId = `${req.user.id}-${Date.now()}`;
    const b2FileId = await b2Storage.uploadSlate(slateId, content, encryptionKey);

    // Delete old version from B2
    try {
      await b2Storage.deleteSlate(slate.b2_file_id);
    } catch (err) {
      console.warn('Failed to delete old B2 file:', err);
    }

    // Calculate stats
    const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
    const charCount = content.length;
    const sizeBytes = Buffer.byteLength(content, 'utf8');

    // Update database - unpublish if it was published
    const stmt = db.prepare(`
      UPDATE slates
      SET title = ?, b2_file_id = ?, word_count = ?, char_count = ?, size_bytes = ?, encryption_version = ?,
          is_published = ?, b2_public_file_id = NULL, published_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `);
    stmt.run(title, b2FileId, wordCount, charCount, sizeBytes, encryptionKey ? 1 : 0, 0, req.params.id, req.user.id);

    res.json({
      success: true,
      word_count: wordCount,
      char_count: charCount,
      was_unpublished: wasUnpublished
    });
  } catch (error) {
    console.error('Update slate error:', error);
    if (error instanceof B2Error) {
      return res.status(error.code === 'B2_RATE_LIMIT' ? 429 : 500).json({
        error: error.userMessage,
        code: error.code
      });
    }
    res.status(500).json({ error: 'Failed to update slate' });
  }
});

// Publish/unpublish slate
app.patch('/api/slates/:id/publish', authenticateToken, requireEncryptionKey, createRateLimitMiddleware('publishSlate'), async (req, res) => {
  const { isPublished } = req.body;

  try {
    const slate = db.prepare('SELECT * FROM slates WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

    if (!slate) {
      return res.status(404).json({ error: 'Slate not found' });
    }

    let shareId = slate.share_id;
    let publicFileId = slate.b2_public_file_id;

    // Generate share ID if publishing for the first time
    if (isPublished && !shareId) {
      shareId = generateUniqueShareId();
    }

    // If publishing an encrypted slate, create an unencrypted public copy
    if (isPublished && slate.encryption_version === 1) {
      // Get the encrypted content first (using key from middleware)
      const encryptionKey = req.encryptionKey;
      const content = await b2Storage.getSlate(slate.b2_file_id, encryptionKey);

      // Upload unencrypted version for public viewing
      const publicSlateId = `${req.user.id}-public-${Date.now()}`;
      publicFileId = await b2Storage.uploadSlate(publicSlateId, content, null); // null = no encryption
    }

    // If unpublishing, delete the public copy
    if (!isPublished && publicFileId) {
      try {
        await b2Storage.deleteSlate(publicFileId);
      } catch (err) {
        console.warn('Failed to delete public B2 file:', err);
      }
      publicFileId = null;
    }

    const publishedAt = isPublished ? new Date().toISOString() : null;

    const stmt = db.prepare(`
      UPDATE slates
      SET is_published = ?, share_id = ?, published_at = ?, b2_public_file_id = ?
      WHERE id = ? AND user_id = ?
    `);
    stmt.run(isPublished ? 1 : 0, shareId, publishedAt, publicFileId, req.params.id, req.user.id);

    const shareUrl = isPublished ? `${process.env.PUBLIC_URL}/s/${shareId}` : null;

    res.json({ success: true, share_id: shareId, share_url: shareUrl });
  } catch (error) {
    console.error('Publish slate error:', error);
    if (error instanceof B2Error) {
      return res.status(error.code === 'B2_RATE_LIMIT' ? 429 : 500).json({
        error: error.userMessage,
        code: error.code
      });
    }
    res.status(500).json({ error: 'Failed to publish slate' });
  }
});

// Delete slate
app.delete('/api/slates/:id', authenticateToken, createRateLimitMiddleware('deleteSlate'), async (req, res) => {
  try {
    const slate = db.prepare('SELECT * FROM slates WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);

    if (!slate) {
      return res.status(404).json({ error: 'Slate not found' });
    }

    // Delete from B2
    try {
      await b2Storage.deleteSlate(slate.b2_file_id);
    } catch (err) {
      console.warn('Failed to delete B2 file:', err);
    }

    // Delete from database
    db.prepare('DELETE FROM slates WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete slate error:', error);
    if (error instanceof B2Error) {
      return res.status(error.code === 'B2_RATE_LIMIT' ? 429 : 500).json({
        error: error.userMessage,
        code: error.code
      });
    }
    res.status(500).json({ error: 'Failed to delete slate' });
  }
});

// ============ PUBLIC ROUTES ============

// Get published slate (no auth required)
app.get('/api/public/slates/:shareId', async (req, res) => {
  try {
    const slate = db.prepare(`
      SELECT slates.*, users.username
      FROM slates
      JOIN users ON slates.user_id = users.id
      WHERE slates.share_id = ? AND slates.is_published = 1
    `).get(req.params.shareId);

    if (!slate) {
      return res.status(404).json({ error: 'Slate not found or not published' });
    }

    // Generate ETag from slate updated_at timestamp and share_id
    const etag = `"${slate.share_id}-${new Date(slate.updated_at).getTime()}"`;

    // Check if client has cached version
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end(); // Not Modified - no B2 download needed!
    }

    // Set cache headers BEFORE fetching from B2
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600'); // 5min browser, 10min nginx
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', new Date(slate.updated_at).toUTCString());

    // Use public file ID if available (for encrypted slates), otherwise use regular file ID
    const fileIdToFetch = slate.b2_public_file_id || slate.b2_file_id;

    // Fetch content from B2 (public slates are always unencrypted)
    const content = await b2Storage.getSlate(fileIdToFetch, null);

    res.json({
      title: slate.title,
      content,
      author: slate.username,
      word_count: slate.word_count,
      char_count: slate.char_count,
      created_at: slate.created_at,
      updated_at: slate.updated_at
    });
  } catch (error) {
    console.error('Get public slate error:', error);
    if (error instanceof B2Error) {
      return res.status(error.code === 'B2_RATE_LIMIT' ? 429 : 500).json({
        error: error.userMessage,
        code: error.code
      });
    }
    res.status(500).json({ error: 'Failed to fetch slate' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ ADMIN ROUTES ============

// Admin authentication (rate-limited)
app.post('/api/admin/auth', createRateLimitMiddleware('adminAuth'), async (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(503).json({ error: 'Admin access not configured' });
  }

  // Use bcrypt comparison for security
  const isValid = await bcrypt.compare(password, adminPassword);

  if (isValid) {
    // Shorter token expiry (1 hour instead of 24)
    const adminToken = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '1h' });

    // Log admin login
    logAdminAction('admin_login', null, null, 'Admin logged in', req.adminIp || req.ip);

    return res.json({ token: adminToken, message: 'Admin authenticated' });
  }

  res.status(401).json({ error: 'Invalid admin password' });
});

// Middleware to verify admin token
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Admin access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err || !payload.admin) {
      return res.status(403).json({ error: 'Invalid admin token' });
    }

    // Get IP address for logging
    let ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    if (ipAddress.startsWith('::ffff:')) {
      ipAddress = ipAddress.substring(7);
    }
    req.adminIp = ipAddress;

    next();
  });
};

// Get all users with stats (with pagination)
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    // Get total count
    const totalResult = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const total = totalResult.count;

    // Get paginated users
    const users = db.prepare(`
      SELECT
        users.id,
        users.username,
        users.email,
        users.email_verified,
        users.created_at,
        COUNT(slates.id) as slate_count,
        COALESCE(SUM(slates.word_count), 0) as total_words,
        COALESCE(SUM(slates.char_count), 0) as total_chars,
        COALESCE(SUM(slates.size_bytes), 0) as total_bytes
      FROM users
      LEFT JOIN slates ON users.id = slates.user_id
      GROUP BY users.id
      ORDER BY users.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    logAdminAction('view_users', {
      ipAddress: req.adminIp,
      details: { page, limit, total }
    });

    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Delete user
app.delete('/api/admin/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Get user info before deletion
    const user = db.prepare('SELECT username, email FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get user's slates to delete from B2
    const slates = db.prepare('SELECT b2_file_id, b2_public_file_id FROM slates WHERE user_id = ?').all(userId);

    // Delete slates from B2
    for (const slate of slates) {
      try {
        await b2Storage.deleteSlate(slate.b2_file_id);
        if (slate.b2_public_file_id) {
          await b2Storage.deleteSlate(slate.b2_public_file_id);
        }
      } catch (err) {
        console.error(`Failed to delete B2 file ${slate.b2_file_id}:`, err);
      }
    }

    // Delete user from database (CASCADE will delete slates)
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    // Log the deletion
    logAdminAction('delete_user', {
      targetType: 'user',
      targetId: userId,
      ipAddress: req.adminIp,
      details: {
        username: user.username,
        email: user.email,
        slatesDeleted: slates.length
      }
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get B2 usage stats
app.get('/api/admin/b2-stats', authenticateAdmin, (req, res) => {
  try {
    const stats = b2Monitor.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Admin get B2 stats error:', error);
    res.status(500).json({ error: 'Failed to fetch B2 stats' });
  }
});

// Get admin activity logs
app.get('/api/admin/logs', authenticateAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const actionFilter = req.query.action || null;

    const logs = getAdminLogs(limit, offset, actionFilter);
    const stats = getAdminLogStats();

    res.json({
      logs,
      stats,
      pagination: {
        page,
        limit
      }
    });
  } catch (error) {
    console.error('Admin get logs error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Get system health and metrics
app.get('/api/admin/health', authenticateAdmin, (req, res) => {
  try {
    const os = require('os');

    // System metrics
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    // Database metrics
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const slateCount = db.prepare('SELECT COUNT(*) as count FROM slates').get().count;
    const sessionCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const publishedCount = db.prepare('SELECT COUNT(*) as count FROM slates WHERE is_published = 1').get().count;

    // Growth metrics (last 24h)
    const newUsers24h = db.prepare(`
      SELECT COUNT(*) as count
      FROM users
      WHERE datetime(created_at) > datetime('now', '-1 day')
    `).get().count;

    const newSlates24h = db.prepare(`
      SELECT COUNT(*) as count
      FROM slates
      WHERE datetime(created_at) > datetime('now', '-1 day')
    `).get().count;

    // Storage metrics
    const totalStorage = db.prepare(`
      SELECT COALESCE(SUM(size_bytes), 0) as total
      FROM slates
    `).get().total;

    res.json({
      system: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        memory: {
          total: totalMemory,
          free: freeMemory,
          used: usedMemory,
          percentUsed: ((usedMemory / totalMemory) * 100).toFixed(2)
        },
        loadAverage: os.loadavg()
      },
      database: {
        users: userCount,
        slates: slateCount,
        sessions: sessionCount,
        published: publishedCount,
        totalStorageBytes: totalStorage,
        totalStorageGB: (totalStorage / (1024 * 1024 * 1024)).toFixed(4)
      },
      growth: {
        newUsers24h,
        newSlates24h
      },
      startup: global.startupHealth || null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin get health error:', error);
    res.status(500).json({ error: 'Failed to fetch health metrics' });
  }
});

// Get error logs from PM2
app.get('/api/admin/error-logs', authenticateAdmin, (req, res) => {
  try {
    const { execSync } = require('child_process');

    // Get last 100 lines of PM2 error logs for justtype process
    const errorLogs = execSync('pm2 logs justtype --err --lines 100 --nostream', {
      encoding: 'utf-8',
      timeout: 5000
    });

    res.json({ logs: errorLogs || 'No error logs found' });
  } catch (error) {
    console.error('Failed to fetch error logs:', error);
    res.status(500).json({ error: 'Failed to fetch error logs', logs: error.message });
  }
});

// ============ ACCOUNT ROUTES ============

// Change password
app.post('/api/account/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash and update new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.user.id);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Change email (send verification code)
app.post('/api/account/change-email', authenticateToken, async (req, res) => {
  const { newEmail } = req.body;

  if (!newEmail) {
    return res.status(400).json({ error: 'New email is required' });
  }

  // Validate email
  const emailValidation = await validateEmailForRegistration(newEmail);
  if (!emailValidation.valid) {
    return res.status(400).json({ error: emailValidation.error });
  }

  try {
    // Check if email is already taken
    const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(newEmail.toLowerCase(), req.user.id);
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Generate 6-digit code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Store pending email change
    db.prepare('UPDATE users SET pending_email = ?, verification_token = ?, verification_code_expires = ? WHERE id = ?')
      .run(newEmail.toLowerCase(), verificationCode, expiresAt, req.user.id);

    // Send verification email to NEW email
    await emailService.sendVerificationEmail(newEmail, req.user.username, verificationCode);

    res.json({ message: 'Verification code sent' });
  } catch (error) {
    console.error('Change email error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// Verify email change
app.post('/api/account/verify-email-change', authenticateToken, async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Verification code required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.verification_token || !user.verification_code_expires) {
      return res.status(400).json({ error: 'No pending email change' });
    }

    if (new Date(user.verification_code_expires) < new Date()) {
      return res.status(400).json({ error: 'Verification code expired' });
    }

    if (user.verification_token !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    if (!user.pending_email) {
      return res.status(400).json({ error: 'No pending email change' });
    }

    // Update email and mark as verified
    db.prepare('UPDATE users SET email = ?, email_verified = 1, pending_email = NULL, verification_token = NULL, verification_code_expires = NULL WHERE id = ?')
      .run(user.pending_email, req.user.id);

    res.json({ message: 'Email changed successfully', newEmail: user.pending_email });
  } catch (error) {
    console.error('Verify email change error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Get active sessions
app.get('/api/account/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT
        device,
        ip_address,
        created_at,
        last_activity,
        token_hash,
        CASE
          WHEN token_hash = ? THEN 1
          ELSE 0
        END as is_current
      FROM sessions
      WHERE user_id = ?
      ORDER BY last_activity DESC
    `).all(
      crypto.createHash('sha256').update(req.token).digest('hex'),
      req.user.id
    );

    res.json({ sessions });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// Logout from all sessions
app.post('/api/account/logout-all', authenticateToken, async (req, res) => {
  try {
    // Delete all sessions for this user
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);

    res.json({ message: 'Logged out from all sessions' });
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({ error: 'Failed to logout from all sessions' });
  }
});

// Delete account
app.delete('/api/account/delete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's slates to delete from B2
    const slates = db.prepare('SELECT b2_file_id FROM slates WHERE user_id = ?').all(userId);

    // Delete slates from B2
    for (const slate of slates) {
      try {
        await b2Storage.deleteSlate(slate.b2_file_id);
      } catch (err) {
        console.error(`Failed to delete B2 file ${slate.b2_file_id}:`, err);
      }
    }

    // Delete user from database (CASCADE will delete slates)
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// Serve index.html for all non-API routes (SPA routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// ============ PERIODIC CLEANUP ============

const runCleanup = () => {
  try {
    // Clean up expired verification codes
    const expiredCodes = db.prepare('UPDATE users SET verification_token = NULL, verification_code_expires = NULL WHERE verification_code_expires < datetime(\'now\')').run();

    // Clean up old sessions (older than 30 days)
    const oldSessions = db.prepare('DELETE FROM sessions WHERE datetime(last_activity) < datetime(\'now\', \'-30 days\')').run();

    if (expiredCodes.changes > 0 || oldSessions.changes > 0) {
      console.log(`✓ Cleanup: Removed ${expiredCodes.changes} expired codes and ${oldSessions.changes} old sessions`);
    }
  } catch (err) {
    console.error('Cleanup job failed:', err);
  }
};

// Run cleanup on startup
runCleanup();

// Run cleanup every hour
setInterval(runCleanup, 60 * 60 * 1000);

// Run startup health checks and start server
(async () => {
  try {
    const healthResults = await healthChecks();

    // Store results globally for admin console
    global.startupHealth = {
      results: healthResults,
      timestamp: new Date().toISOString(),
      uptime: 0
    };

    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();
