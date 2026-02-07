require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
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
const { createRateLimitMiddleware, rateLimiter } = require('./rateLimiter');
const { healthChecks } = require('./startupHealth');
const { passport, decryptEncryptionKey } = require('./googleAuth');
const stripeModule = require('./stripe');
const { wordlist: bip39Wordlist } = require('./bip39-wordlist');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

// Stripe
const stripe = stripeModule?.stripe;
let stripePriceIds = null;

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

if (!process.env.TURNSTILE_SECRET_KEY) {
  console.error('FATAL: TURNSTILE_SECRET_KEY not set in .env file');
  process.exit(1);
}

// Cloudflare Turnstile verification middleware
async function verifyTurnstileToken(req, res, next) {
  const turnstileToken = req.body.turnstile_token;

  if (!turnstileToken) {
    return res.status(400).json({ error: 'Turnstile token required' });
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress
      })
    });

    const data = await response.json();

    if (!data.success) {
      return res.status(403).json({ error: 'Turnstile verification failed' });
    }

    next();
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return res.status(500).json({ error: 'Verification service unavailable' });
  }
}

// Generate short share IDs (e.g., "a3bK9qL")
const generateShareId = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8);

// Helper function to mask email addresses for privacy
// Used in admin endpoints to prevent full email exposure
// Masks both local part and domain for maximum privacy
function maskEmail(email) {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return email;

  // Mask local part
  const maskedLocal = local.length <= 2
    ? `${local[0]}***`
    : `${local[0]}${'*'.repeat(Math.min(local.length - 1, 3))}`;

  // Mask domain (keep first char and TLD)
  const domainParts = domain.split('.');
  if (domainParts.length >= 2) {
    const tld = domainParts[domainParts.length - 1];
    const domainName = domainParts.slice(0, -1).join('.');
    const maskedDomain = domainName.length <= 2
      ? `${domainName[0]}***`
      : `${domainName[0]}${'*'.repeat(Math.min(domainName.length - 1, 3))}`;
    return `${maskedLocal}@${maskedDomain}.${tld}`;
  }

  return `${maskedLocal}@${domain}`;
}

// In-memory store for one-time auth codes (for OAuth security)
// Codes expire after 30 seconds and are deleted after use
const authCodeStore = new Map();

// Generate and store one-time auth code
function generateAuthCode(userData) {
  const code = crypto.randomBytes(32).toString('hex');
  authCodeStore.set(code, {
    ...userData,
    expiresAt: Date.now() + 30000 // 30 seconds
  });

  // Auto-cleanup after 35 seconds
  setTimeout(() => authCodeStore.delete(code), 35000);

  return code;
}

// Exchange and consume one-time auth code
function consumeAuthCode(code) {
  const data = authCodeStore.get(code);
  if (!data) return null;

  // Delete immediately (one-time use)
  authCodeStore.delete(code);

  // Check expiration
  if (Date.now() > data.expiresAt) return null;

  return data;
}

// Cookie options for auth token
const getAuthCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/'
});

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
const ENCRYPTION_KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  const existing = encryptionKeyCache.get(userId);
  if (existing && existing.timeoutId) {
    clearTimeout(existing.timeoutId);
  }

  // Auto-expire keys after 24 hours
  const timeoutId = setTimeout(() => {
    // Only delete if this is still the latest timer for this user.
    const current = encryptionKeyCache.get(userId);
    if (current && current.timeoutId === timeoutId) {
      encryptionKeyCache.delete(userId);
    }
  }, ENCRYPTION_KEY_CACHE_TTL_MS);

  encryptionKeyCache.set(userId, {
    key: encryptionKey,
    timestamp: Date.now(),
    timeoutId
  });
};

const deleteCachedEncryptionKey = (userId) => {
  const existing = encryptionKeyCache.get(userId);
  if (existing && existing.timeoutId) {
    clearTimeout(existing.timeoutId);
  }
  encryptionKeyCache.delete(userId);
};

// Get cached encryption key for a user
const getCachedEncryptionKey = (userId) => {
  const cached = encryptionKeyCache.get(userId);
  return cached ? cached.key : null;
};

// Generate a 12-word BIP39 recovery phrase (128 bits of entropy)
const generateRecoveryPhrase = () => {
  const words = [];
  for (let i = 0; i < 12; i++) {
    const index = crypto.randomInt(0, bip39Wordlist.length);
    words.push(bip39Wordlist[index]);
  }
  return words.join(' ');
};

// Wrap (encrypt) a key using AES-256-GCM
const wrapKey = (keyToWrap, wrappingKey) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
  const encrypted = Buffer.concat([cipher.update(keyToWrap), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
};

// Unwrap (decrypt) a key using AES-256-GCM
const unwrapKey = (wrappedKeyBase64, wrappingKey) => {
  const data = Buffer.from(wrappedKeyBase64, 'base64');
  const iv = data.slice(0, 16);
  const authTag = data.slice(16, 32);
  const encrypted = data.slice(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', wrappingKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

// Decode base64 input strictly (prevents silently accepting malformed base64)
const decodeBase64Strict = (base64) => {
  if (typeof base64 !== 'string') {
    throw new Error('Invalid base64');
  }

  const value = base64.trim();
  if (!value) {
    throw new Error('Invalid base64');
  }

  // Require valid base64 alphabet and padding only at the end.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Invalid base64');
  }

  // btoa() output is always padded to a multiple of 4 characters.
  if (value.length % 4 !== 0) {
    throw new Error('Invalid base64');
  }

  const buf = Buffer.from(value, 'base64');

  // Round-trip check (ignoring padding) to catch forgiving decoders.
  const normalize = (s) => s.replace(/=+$/, '');
  if (normalize(buf.toString('base64')) !== normalize(value)) {
    throw new Error('Invalid base64');
  }

  return buf;
};

// Generate a new random slate key and wrap it with both password and recovery phrase
const setupKeyWrapping = (password, encryptionSalt) => {
  const slateKey = crypto.randomBytes(32);
  const passwordDerivedKey = deriveEncryptionKey(password, encryptionSalt);
  const wrappedKey = wrapKey(slateKey, passwordDerivedKey);

  const recoverySalt = crypto.randomBytes(32).toString('hex');
  const recoveryPhrase = generateRecoveryPhrase();
  const recoveryDerivedKey = deriveEncryptionKey(recoveryPhrase, recoverySalt);
  const recoveryWrappedKey = wrapKey(slateKey, recoveryDerivedKey);

  return { slateKey, wrappedKey, recoveryPhrase, recoverySalt, recoveryWrappedKey };
};

// Migrate an existing user from password-derived encryption to key-wrapping
const migrateUserEncryption = async (userId, password, encryptionSalt) => {
  const oldKey = deriveEncryptionKey(password, encryptionSalt);
  const { slateKey, wrappedKey, recoveryPhrase, recoverySalt, recoveryWrappedKey } = setupKeyWrapping(password, encryptionSalt);

  // Re-encrypt all user slates with the new slate key
  const slates = db.prepare('SELECT id, b2_file_id FROM slates WHERE user_id = ?').all(userId);

  for (const slate of slates) {
    if (!slate.b2_file_id) continue;
    try {
      const content = await b2Storage.getSlate(slate.b2_file_id, oldKey);
      const newFileId = await b2Storage.uploadSlate(`${userId}-${slate.id}-migrated-${Date.now()}`, content, slateKey);
      db.prepare('UPDATE slates SET b2_file_id = ? WHERE id = ?').run(newFileId, slate.id);
    } catch (err) {
      console.error(`Failed to migrate slate #${slate.id} for user #${userId}:`, err);
      throw new Error('Migration failed: could not re-encrypt slates');
    }
  }

  // Store wrapped keys and mark as migrated
  db.prepare(`
    UPDATE users SET wrapped_key = ?, recovery_wrapped_key = ?, recovery_salt = ?, key_migrated = 1, recovery_key_shown = 0
    WHERE id = ?
  `).run(wrappedKey, recoveryWrappedKey, recoverySalt, userId);

  console.log(`Migration succeeded for user #${userId}: ${slates.length} slates re-encrypted`);

  return { slateKey, recoveryPhrase };
};

// CORS configuration - allow our domain and CLI requests
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (CLI, mobile apps, curl, etc.)
    if (!origin) {
      return callback(null, true);
    }

    const allowedOrigins = process.env.NODE_ENV === 'production'
      ? ['https://justtype.io', 'https://www.justtype.io']
      : ['http://localhost:5173', 'http://localhost:3003', 'http://127.0.0.1:5173'];

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true // Required for HttpOnly cookies
}));

// Cookie parser for HttpOnly auth cookies
app.use(cookieParser());

// Security headers with helmet.js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://challenges.cloudflare.com", "https://alfaoz.github.io", "https://api.github.com"],
      frameSrc: ["https://challenges.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false // Allow embedding for public slates
}));

// Stripe webhook handler - MUST be before express.json() to preserve raw body for signature verification
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    return res.status(503).send('Stripe not configured');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature (only in production with real webhook secret)
    if (webhookSecret && webhookSecret !== 'whsec_YOUR_WEBHOOK_SECRET_HERE') {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // In test mode without webhook secret, just parse the body
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = parseInt(session.metadata.userId);
        const tier = session.metadata.tier;

        if (!userId || !tier) {
          console.error('Missing metadata in checkout session:', session.id);
          break;
        }

        // Update user tier
        const now = new Date().toISOString();

        if (tier === 'one_time') {
          // One-time supporter: 50MB storage
          db.prepare(`
            UPDATE users
            SET supporter_tier = 'one_time',
                storage_limit = 50000000,
                donated_at = ?,
                stripe_customer_id = ?,
                subscription_expires_at = NULL
            WHERE id = ?
          `).run(now, session.customer, userId);
          console.log(`✓ User ${userId} upgraded to one-time supporter`);
        } else if (tier === 'quarterly') {
          // Quarterly supporter: unlimited storage
          const subscriptionId = session.subscription;
          db.prepare(`
            UPDATE users
            SET supporter_tier = 'quarterly',
                storage_limit = 999999999999,
                donated_at = ?,
                stripe_customer_id = ?,
                stripe_subscription_id = ?,
                subscription_expires_at = NULL
            WHERE id = ?
          `).run(now, session.customer, subscriptionId, userId);
          console.log(`✓ User ${userId} upgraded to quarterly supporter`);

          // Send thank you email for subscription
          const user = db.prepare('SELECT username, email FROM users WHERE id = ?').get(userId);
          if (user && user.email) {
            const { strings } = require('./strings.cjs');
            emailService.sendEmail({
              to: user.email,
              subject: strings.email.subscriptionStarted.subject,
              text: strings.email.subscriptionStarted.body(user.username)
            }).catch(err => console.error('Failed to send subscription email:', err));
          }
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        // Find user by subscription ID
        const user = db.prepare('SELECT id, username, email FROM users WHERE stripe_subscription_id = ?').get(subscriptionId);

        if (!user) {
          console.error('User not found for subscription:', subscriptionId);
          break;
        }

        // Check if subscription is scheduled to cancel
        const cancelDate = subscription.cancel_at || (subscription.cancel_at_period_end && subscription.current_period_end);

        if (cancelDate && subscription.status === 'active') {
          // Subscription will cancel at a future date - keep access until then
          const expiresAt = new Date(cancelDate * 1000).toISOString();

          // Check if we already have a cancellation date set (to avoid duplicate emails)
          const existingExpiration = db.prepare('SELECT subscription_expires_at FROM users WHERE id = ?').get(user.id);
          const alreadyScheduled = existingExpiration && existingExpiration.subscription_expires_at;

          db.prepare(`
            UPDATE users
            SET subscription_expires_at = ?
            WHERE id = ?
          `).run(expiresAt, user.id);
          console.log(`✓ User ${user.id} subscription set to cancel on ${expiresAt}`);

          // Send pending cancellation acknowledgment email (only if not already scheduled)
          if (user.email && !alreadyScheduled) {
            const daysRemaining = Math.ceil((cancelDate * 1000 - Date.now()) / (1000 * 60 * 60 * 24));

            // Check if user exceeds 50MB to include warning
            const userStorage = db.prepare('SELECT storage_used FROM users WHERE id = ?').get(user.id);
            const storageUsedMB = (userStorage.storage_used || 0) / 1024 / 1024;
            const exceedsLimit = storageUsedMB > 50;

            const storageWarning = exceedsLimit
              ? `\nnote: you're currently using ${storageUsedMB.toFixed(2)} MB. please export your slates to avoid losing files that exceed the 50 MB limit.`
              : '';

            const { strings } = require('./strings.cjs');
            emailService.sendEmail({
              to: user.email,
              subject: strings.email.subscriptionCancellationScheduled.subject,
              text: strings.email.subscriptionCancellationScheduled.body(user.username, daysRemaining, storageWarning)
            }).then(() => {
              console.log(`✓ Cancellation acknowledgment email sent to user #${user.id}`);
            }).catch(err => console.error('Failed to send cancellation scheduled email:', err));
          }
        } else if (event.type === 'customer.subscription.deleted' || subscription.status === 'canceled') {
          // Subscription is immediately canceled or deleted - downgrade to one_time supporter

          // Check if user exceeds one_time limit and needs grace period
          const userStorage = db.prepare('SELECT storage_used FROM users WHERE id = ?').get(user.id);
          const storageUsedBytes = userStorage.storage_used || 0;
          const oneTimeLimitBytes = 50000000; // 50MB
          const needsGracePeriod = storageUsedBytes > oneTimeLimitBytes;

          if (needsGracePeriod) {
            // Set 14-day grace period
            const gracePeriodExpires = new Date();
            gracePeriodExpires.setDate(gracePeriodExpires.getDate() + 14);

            db.prepare(`
              UPDATE users
              SET supporter_tier = 'one_time',
                  storage_limit = 50000000,
                  stripe_subscription_id = NULL,
                  subscription_expires_at = NULL,
                  grace_period_expires = ?,
                  grace_period_target_tier = 'one_time'
              WHERE id = ?
            `).run(gracePeriodExpires.toISOString(), user.id);
            console.log(`✓ User ${user.id} subscription cancelled, downgraded to one_time supporter with 14-day grace period (exceeds limit)`);
          } else {
            // No grace period needed, normal downgrade
            db.prepare(`
              UPDATE users
              SET supporter_tier = 'one_time',
                  storage_limit = 50000000,
                  stripe_subscription_id = NULL,
                  subscription_expires_at = NULL
              WHERE id = ?
            `).run(user.id);
            console.log(`✓ User ${user.id} subscription cancelled, downgraded to one_time supporter`);
          }

          // Send cancellation email
          if (user.email) {
            const storageUsedMB = storageUsedBytes / 1024 / 1024;

            let emailBody = `hey ${user.username},

we're sorry to see you go, but we understand!

thank you for your previous support. it really helped keep justtype running.

your account will remain as a one-time supporter with twice the storage of a free tier.`;

            if (needsGracePeriod) {
              emailBody += `\n\nimportant: you're currently using ${storageUsedMB.toFixed(2)} MB, which exceeds the one-time supporter limit of 50 MB.

you have a 14-day grace period to:
- download your slates from your account page
- delete slates to get below 50 MB

after 14 days, your latest slates will be automatically deleted until you're below the limit.`;
            }

            emailBody += `\n\nif you had any issues or feedback, we'd love to hear from you. just reply to this email.

take care!

- justtype`;

            emailService.sendEmail({
              to: user.email,
              subject: 'sad to see you go',
              text: emailBody
            }).catch(err => console.error('Failed to send cancellation email:', err));
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (subscriptionId) {
          const user = db.prepare('SELECT id, email FROM users WHERE stripe_subscription_id = ?').get(subscriptionId);
          if (user) {
            console.warn(`⚠ Payment failed for user #${user.id}`);
            // Could send email notification here
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.use(express.json({ limit: '5mb' })); // Lower limit to prevent bandwidth abuse
app.use(passport.initialize());

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

// CLI version checking middleware - respond with latest version when CLI sends its version
app.use((req, res, next) => {
  const cliVersion = req.header('X-CLI-Version');
  if (cliVersion) {
    try {
      const fs = require('fs');
      const path = require('path');
      const versionFile = path.join(__dirname, '..', 'public', 'cli', 'version.txt');
      const latestVersion = fs.readFileSync(versionFile, 'utf8').trim();
      res.setHeader('X-Latest-Version', latestVersion);
    } catch (err) {
      // Silently ignore errors reading version file
    }
  }
  next();
});

// Serve terms and privacy text files
const path = require('path');
const fs = require('fs');

app.get('/terms.txt', (req, res) => {
  const termsPath = path.join(__dirname, '..', 'terms.txt');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(termsPath);
});

app.get('/privacy.txt', (req, res) => {
  const privacyPath = path.join(__dirname, '..', 'privacy.txt');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(privacyPath);
});

app.get('/limits.txt', (req, res) => {
  const limitsPath = path.join(__dirname, '..', 'limits.txt');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(limitsPath);
});

app.get('/project.txt', (req, res) => {
  const projectPath = path.join(__dirname, '..', 'project.txt');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(projectPath);
});

// System slate routes with custom meta descriptions
const systemSlatesMeta = {
  '/terms': {
    title: 'terms of service',
    description: 'terms of service for justtype.io',
    redirect: '/s/terms'
  },
  '/privacy': {
    title: 'privacy policy',
    description: 'privacy policy for justtype.io',
    redirect: '/s/privacy'
  },
  '/limits': {
    title: 'storage limits',
    description: 'storage limits and supporter tiers for justtype.io',
    redirect: '/s/limits'
  },
  '/project': {
    title: 'about the project',
    description: 'about justtype - a minimal, encrypted writing app',
    redirect: '/s/project'
  }
};

Object.entries(systemSlatesMeta).forEach(([route, meta]) => {
  app.get(route, (req, res) => {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');

    // Replace default meta tags
    html = html.replace(
      '<title>just type</title>',
      `<title>${meta.title} - just type</title>`
    );
    html = html.replace(
      '<meta name="description" content="need to jot something down real quick? just start typing." />',
      `<meta name="description" content="${meta.description}" />`
    );

    // Add redirect meta tag for immediate redirect
    html = html.replace(
      '</head>',
      `  <meta http-equiv="refresh" content="0;url=${meta.redirect}" />\n  </head>`
    );

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(html);
  });
});

// Handle /cli page (exact match) - serve React app
app.get('/cli', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// Serve CLI binaries from public/cli directory (for /cli/*)
app.use('/cli', express.static(path.join(__dirname, '..', 'public', 'cli'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    // Never cache version.txt (needed for auto-update checks)
    if (filePath.endsWith('version.txt')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // Set correct content type for shell scripts
    if (filePath.endsWith('.sh')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    // Set download headers for tar.gz files
    if (filePath.endsWith('.tar.gz')) {
      res.setHeader('Content-Type', 'application/gzip');
    }
  }
}));

// Serve static files from dist directory with cache control
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

  // Check if user has IP tracking enabled
  const user = db.prepare('SELECT track_ip_address FROM users WHERE id = ?').get(userId);
  const trackIp = user && user.track_ip_address !== 0;

  let ipAddress = null;

  if (trackIp) {
    // Get IP address - prioritize x-forwarded-for for proxy/load balancer setups
    ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.connection.remoteAddress || req.ip || '';

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
  }

  try {
    // Delete old session with same token_hash if it exists (prevents duplicates)
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);

    // Create the new session (only store parsed device type, not full user-agent for privacy)
    db.prepare('INSERT INTO sessions (user_id, token_hash, device, ip_address) VALUES (?, ?, ?, ?)')
      .run(userId, tokenHash, device, ipAddress);

    // Keep only the 5 most recent sessions per user
    const allSessions = db.prepare('SELECT id FROM sessions WHERE user_id = ? ORDER BY last_activity DESC').all(userId);
    if (allSessions.length > 5) {
      const sessionsToDelete = allSessions.slice(5); // Keep first 5, delete rest
      const deleteStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
      for (const session of sessionsToDelete) {
        deleteStmt.run(session.id);
      }
    }
  } catch (err) {
    console.error('Session creation error:', err);
  }
};

// Helper function to update user's storage usage
const updateUserStorage = (userId) => {
  try {
    const result = db.prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM slates WHERE user_id = ?').get(userId);
    db.prepare('UPDATE users SET storage_used = ? WHERE id = ?').run(result.total, userId);
  } catch (err) {
    console.error('Storage update error:', err);
  }
};

// Helper function to check if user has exceeded storage limit
const checkStorageLimit = (userId, newContentSize) => {
  try {
    const user = db.prepare('SELECT storage_used, storage_limit, supporter_tier FROM users WHERE id = ?').get(userId);

    // Quarterly supporters have unlimited storage
    if (user.supporter_tier === 'quarterly') {
      return { allowed: true };
    }

    const currentUsage = user.storage_used || 0;
    const limit = user.storage_limit || 25000000; // Default 25MB
    const hardLimit = Math.floor(limit * 1.1); // 110% of limit
    const projectedUsage = currentUsage + newContentSize;

    if (projectedUsage > hardLimit) {
      const usedMB = (currentUsage / 1024 / 1024).toFixed(2);
      const limitMB = (limit / 1024 / 1024).toFixed(0);
      return {
        allowed: false,
        error: `Storage limit exceeded. You're using ${usedMB} MB of ${limitMB} MB. Delete some slates or upgrade to continue.`
      };
    }

    return { allowed: true };
  } catch (err) {
    console.error('Storage check error:', err);
    return { allowed: true }; // Allow on error to not block users
  }
};

// Middleware to verify JWT token (checks HttpOnly cookie first, then Authorization header)
const authenticateToken = (req, res, next) => {
  // Check HttpOnly cookie first (more secure), then fall back to Authorization header
  let token = req.cookies?.justtype_token;

  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      // Clear invalid cookie if present
      res.clearCookie('justtype_token', { path: '/' });
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Check if session exists in database and update last activity
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const result = db.prepare('UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE token_hash = ?').run(tokenHash);

      // If no rows were updated, the session doesn't exist (was deleted)
      if (result.changes === 0) {
        res.clearCookie('justtype_token', { path: '/' });
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
  // E2E users: skip server-side encryption entirely — client handles it
  const userCheck = db.prepare('SELECT e2e_migrated, auth_provider, encrypted_key FROM users WHERE id = ?').get(req.user.id);
  if (userCheck && userCheck.e2e_migrated) {
    req.e2e = true;
    return next();
  }

  // Check if user is a Google user with encrypted_key
  const user = userCheck;

  if (user && (user.auth_provider === 'google' || user.auth_provider === 'both') && user.encrypted_key) {
    // Decrypt the encryption key for Google users
    try {
      const encryptionKey = decryptEncryptionKey(user.encrypted_key);
      req.encryptionKey = encryptionKey;
      return next();
    } catch (error) {
      console.error('Failed to decrypt Google user encryption key:', error);
      return res.status(500).json({
        error: 'Failed to access encryption key',
        code: 'ENCRYPTION_KEY_ERROR'
      });
    }
  }

  // For local users, use cached key from login
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
app.post('/api/auth/register', verifyTurnstileToken, createRateLimitMiddleware('register'), async (req, res) => {
  let { username, password, email, termsAccepted, wrappedKey: clientWrappedKey, recoveryWrappedKey: clientRecoveryWrappedKey, recoverySalt: clientRecoverySalt, encryptionSalt: clientEncryptionSalt } = req.body;

  if (!username || !password || !email) {
    return res.status(400).json({ error: 'Username, password, and email are required' });
  }

  if (!termsAccepted) {
    return res.status(400).json({ error: 'You must accept the Terms and Conditions' });
  }

  // Validate username: lowercase a-z, 0-9, underscore, dot, hyphen
  username = username.toLowerCase().trim();
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(username) || /[._-]{2}/.test(username)) {
    return res.status(400).json({ error: 'username can only contain lowercase letters, numbers, dots, hyphens, and underscores' });
  }

  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be between 3 and 20 characters' });
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
    const termsAcceptedAt = new Date().toISOString();

    const stmt = db.prepare('INSERT INTO users (username, password, email, verification_token, verification_code_expires, terms_accepted, terms_accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(username, hashedPassword, email.toLowerCase(), verificationCode, expiresAt, 1, termsAcceptedAt);

    // Send verification email
    const emailSent = await emailService.sendVerificationEmail(email, username, verificationCode);
    if (!emailSent) {
      console.error(`⚠️  Failed to send verification email to user #${result.lastInsertRowid}`);
      // Continue anyway - user can resend later
    }

    const token = jwt.sign({ id: result.lastInsertRowid, username }, JWT_SECRET, { expiresIn: '30d' });

    // Create session
    createSession(result.lastInsertRowid, token, req);

    // E2E client-side encryption: client sends pre-wrapped keys
    const isE2E = !!(clientWrappedKey && clientRecoveryWrappedKey && clientRecoverySalt && clientEncryptionSalt);
    let recoveryPhrase = null;

    if (isE2E) {
      // Client generated keys — store them directly, no server-side key generation
      db.prepare(`
        UPDATE users SET wrapped_key = ?, recovery_wrapped_key = ?, recovery_salt = ?, encryption_salt = ?, key_migrated = 1, e2e_migrated = 1
        WHERE id = ?
      `).run(clientWrappedKey, clientRecoveryWrappedKey, clientRecoverySalt, clientEncryptionSalt, result.lastInsertRowid);
    } else {
      // Legacy server-side key setup (for non-E2E clients)
      const salt = getOrCreateEncryptionSalt(result.lastInsertRowid);
      const keyData = setupKeyWrapping(password, salt);
      recoveryPhrase = keyData.recoveryPhrase;

      db.prepare(`
        UPDATE users SET wrapped_key = ?, recovery_wrapped_key = ?, recovery_salt = ?, key_migrated = 1
        WHERE id = ?
      `).run(keyData.wrappedKey, keyData.recoveryWrappedKey, keyData.recoverySalt, result.lastInsertRowid);

      cacheEncryptionKey(result.lastInsertRowid, keyData.slateKey);
    }

    // Set HttpOnly cookie for secure auth
    res.cookie('justtype_token', token, getAuthCookieOptions());

    // Fire signup automations
    fireSignupAutomations(result.lastInsertRowid, username);

    res.status(201).json({
      user: {
        id: result.lastInsertRowid,
        username,
        email: email.toLowerCase(),
        email_verified: false
      },
      recoveryPhrase,
      e2e: isE2E,
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
app.post('/api/auth/login', verifyTurnstileToken, createRateLimitMiddleware('login'), async (req, res) => {
  let { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  // Normalize username to lowercase
  username = username.toLowerCase().trim();

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Google-only accounts do not support password login.
    // (Hardening: avoids bcrypt throwing on non-hash sentinel values.)
    if (user.auth_provider === 'google' || user.password === 'google-oauth-no-password' || !user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let validPassword = false;
    try {
      validPassword = await bcrypt.compare(password, user.password);
    } catch (err) {
      // Treat bcrypt errors as invalid credentials to avoid 500s + account-type leakage.
      validPassword = false;
    }
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Handle encryption key based on E2E migration status
    const salt = getOrCreateEncryptionSalt(user.id);
    let encryptionKey;
    let recoveryPhrase = null;
    let migrationSlateKey = null;

    if (user.e2e_migrated) {
      // E2E user: don't unwrap on server. Client will unwrap locally.
      // No server-side caching needed.
    } else if (!user.key_migrated) {
      // Legacy user: migrate from password-derived key to key-wrapping
      try {
        const migrationResult = await migrateUserEncryption(user.id, password, salt);
        encryptionKey = migrationResult.slateKey;
        recoveryPhrase = migrationResult.recoveryPhrase;
        // Provide slate key to client for E2E migration
        migrationSlateKey = Buffer.from(encryptionKey).toString('base64');
        // Don't mark e2e_migrated yet — client will finalize after re-wrapping
        cacheEncryptionKey(user.id, encryptionKey);
      } catch (err) {
        console.error(`Migration failed for user #${user.id}:`, err.message, err.stack);
        // Fall back to old behavior so user isn't locked out
        encryptionKey = deriveEncryptionKey(password, salt);
        cacheEncryptionKey(user.id, encryptionKey);
      }
    } else {
      // Migrated (key-wrapped) but not yet E2E: unwrap and provide to client
      const passwordDerivedKey = deriveEncryptionKey(password, salt);
      try {
        encryptionKey = unwrapKey(user.wrapped_key, passwordDerivedKey);
        // Provide slate key to client for E2E migration
        migrationSlateKey = Buffer.from(encryptionKey).toString('base64');
        // Don't mark e2e_migrated yet — client will finalize after re-wrapping
        cacheEncryptionKey(user.id, encryptionKey);
      } catch (err) {
        console.error(`Key unwrap failed for user #${user.id}:`, err);
        return res.status(401).json({ error: 'Failed to decrypt encryption key. Your password may have changed externally.' });
      }
    }

    // Only cache server-side if NOT e2e migrated (fallback path)
    if (encryptionKey && !migrationSlateKey) {
      cacheEncryptionKey(user.id, encryptionKey);
    }

    // Check email verification - if not verified, send special response
    if (!user.email_verified) {
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

      // Create session
      createSession(user.id, token, req);

      // Set HttpOnly cookie
      res.cookie('justtype_token', token, getAuthCookieOptions());

      // Check if this is a CLI request - include token in response
      const isCLI = req.headers['user-agent']?.includes('justtype-cli');

      return res.json({
        token: isCLI ? token : undefined,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          email_verified: false
        },
        recoveryPhrase,
        migrationSlateKey,
        wrappedKey: user.e2e_migrated ? user.wrapped_key : undefined,
        encryptionSalt: user.e2e_migrated ? user.encryption_salt : undefined,
        e2e: !!user.e2e_migrated,
        requiresVerification: true
      });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

    // Create session
    createSession(user.id, token, req);

    // Set HttpOnly cookie
    res.cookie('justtype_token', token, getAuthCookieOptions());

    // Check if this is a CLI request - include token in response
    const isCLI = req.headers['user-agent']?.includes('justtype-cli');

    res.json({
      token: isCLI ? token : undefined,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        email_verified: user.email_verified
      },
      recoveryPhrase,
      migrationSlateKey,
      wrappedKey: user.e2e_migrated ? user.wrapped_key : undefined,
      encryptionSalt: user.e2e_migrated ? user.encryption_salt : undefined,
      e2e: !!user.e2e_migrated
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout (delete current session)
app.post('/api/auth/logout', authenticateToken, async (req, res) => {
  try {
    const tokenHash = crypto.createHash('sha256').update(req.token).digest('hex');

    // Delete the current session from database
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);

    // Clear HttpOnly cookie
    res.clearCookie('justtype_token', { path: '/' });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Verify email with code
app.post('/api/auth/verify-email', createRateLimitMiddleware('verifyEmail'), async (req, res) => {
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
    const user = db.prepare('SELECT id, username, email, email_verified, auth_provider, key_migrated, recovery_key_shown FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userFull = db.prepare('SELECT e2e_migrated FROM users WHERE id = ?').get(req.user.id);
    const responseData = {
      id: user.id,
      username: user.username,
      email: user.email,
      email_verified: user.email_verified,
      auth_provider: user.auth_provider || 'local',
      requiresMigration: !user.key_migrated && user.auth_provider !== 'google',
      recoveryKeyPending: user.key_migrated && !user.recovery_key_shown && user.auth_provider !== 'google',
      e2eMigrated: !!(userFull && userFull.e2e_migrated),
      needsPinSetup: (user.auth_provider === 'google') && !userFull?.e2e_migrated && !user.key_migrated
    };

    if (responseData.recoveryKeyPending) {
      console.log(`[auth/me] User #${user.id} has recoveryKeyPending=true (key_migrated=${user.key_migrated}, recovery_key_shown=${user.recovery_key_shown})`);
    }

    res.json(responseData);
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Verify token (for CLI and other clients)
app.get('/api/auth/verify', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.json({ valid: false });
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Token verify error:', error);
    res.json({ valid: false });
  }
});

// ============================================================================
// User Preferences (Theme Sync)
// ============================================================================

// Get user preferences (theme and custom themes)
app.get('/api/preferences', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT theme, custom_themes FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'user not found' });
    }

    let customThemes = {};
    if (user.custom_themes) {
      try {
        customThemes = JSON.parse(user.custom_themes);
      } catch {
        customThemes = {};
      }
    }

    res.json({
      theme: user.theme || 'light',
      customThemes
    });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'failed to get preferences' });
  }
});

// Update user preferences
app.put('/api/preferences', authenticateToken, (req, res) => {
  try {
    const { theme, customThemes } = req.body;
    const updates = [];
    const params = [];

    // Validate and update theme
    if (theme !== undefined) {
      if (typeof theme !== 'string' || theme.length > 50) {
        return res.status(400).json({ error: 'invalid theme' });
      }
      updates.push('theme = ?');
      params.push(theme);
    }

    // Validate and update custom themes
    if (customThemes !== undefined) {
      if (typeof customThemes !== 'object') {
        return res.status(400).json({ error: 'customThemes must be an object' });
      }

      // Enforce max 3 custom themes
      const themeIds = Object.keys(customThemes);
      if (themeIds.length > 3) {
        return res.status(400).json({ error: 'maximum 3 custom themes allowed' });
      }

      // Validate each theme structure
      for (const id of themeIds) {
        const t = customThemes[id];
        if (!t || typeof t !== 'object' || !t.id || !t.name || !t.colors) {
          return res.status(400).json({ error: `invalid theme structure for "${id}"` });
        }
      }

      updates.push('custom_themes = ?');
      params.push(JSON.stringify(customThemes));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'no preferences to update' });
    }

    params.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    res.json({ success: true });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'failed to update preferences' });
  }
});

// ============================================================================
// CLI OAuth Device Flow
// ============================================================================

// Generate device code
app.post('/api/cli/device-code', createRateLimitMiddleware('deviceCode'), (req, res) => {
  try {
    // Generate codes
    const deviceCode = crypto.randomBytes(32).toString('hex');
    const userCode = generateUserCode();
    const expiresIn = 600; // 10 minutes
    const interval = 5; // Poll every 5 seconds
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

    // Store in database
    db.prepare(`
      INSERT INTO cli_device_codes (device_code, user_code, expires_at)
      VALUES (?, ?, ?)
    `).run(deviceCode, userCode, expiresAt);

    res.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${req.protocol}://${req.get('host')}/pair`,
      expires_in: expiresIn,
      interval: interval
    });
  } catch (error) {
    console.error('Device code error:', error);
    res.status(500).json({ error: 'Failed to generate device code' });
  }
});

// Approve device code (from browser)
app.post('/api/cli/approve', authenticateToken, createRateLimitMiddleware('approveDevice'), (req, res) => {
  const { user_code } = req.body;

  if (!user_code) {
    return res.status(400).json({ error: 'Missing user_code' });
  }

  try {
    const now = Math.floor(Date.now() / 1000);

    // Find the device code
    const deviceCode = db.prepare(`
      SELECT * FROM cli_device_codes
      WHERE user_code = ? AND expires_at > ? AND approved = 0
    `).get(user_code, now);

    if (!deviceCode) {
      return res.status(404).json({ error: 'Invalid or expired code' });
    }

    // Check if encryption key is cached
    let encryptionKey = getCachedEncryptionKey(req.user.id);

    // If key not cached, user needs to log in again
    if (!encryptionKey) {
      // For Google users, try to decrypt stored key
      if (req.user.encrypted_key) {
        try {
          encryptionKey = decryptEncryptionKey(req.user.encrypted_key);
          cacheEncryptionKey(req.user.id, encryptionKey);
        } catch (err) {
          console.error('Failed to decrypt Google user encryption key:', err);
        }
      }

      // If still no key, require re-login
      if (!encryptionKey) {
        return res.status(401).json({
          error: 'Session expired. Please log in again to authorize the CLI.',
          code: 'PASSWORD_REQUIRED'
        });
      }
    }

    // Approve the device
    db.prepare(`
      UPDATE cli_device_codes
      SET approved = 1, user_id = ?
      WHERE user_code = ?
    `).run(req.user.id, user_code);

    res.json({ success: true });
  } catch (error) {
    console.error('Approve device error:', error);
    res.status(500).json({ error: 'Failed to approve device' });
  }
});

// Poll for token (from CLI)
app.post('/api/cli/token', createRateLimitMiddleware('pollToken'), (req, res) => {
  const { device_code } = req.body;

  if (!device_code) {
    return res.status(400).json({ error: 'Missing device_code' });
  }

  try {
    const now = Math.floor(Date.now() / 1000);

    // Find the device code
    const record = db.prepare(`
      SELECT * FROM cli_device_codes
      WHERE device_code = ?
    `).get(device_code);

    if (!record) {
      return res.json({ error: 'invalid_request' });
    }

    // Check if expired
    if (record.expires_at < now) {
      return res.json({ error: 'expired' });
    }

    // Check if approved
    if (record.approved === 0) {
      return res.json({ status: 'pending' });
    }

    // Approved! Generate token
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(record.user_id);

    if (!user) {
      return res.json({ error: 'user_not_found' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '90d' });

    // Create session for this CLI token
    createSession(user.id, token, req);

    // Delete the device code (one-time use)
    db.prepare('DELETE FROM cli_device_codes WHERE device_code = ?').run(device_code);

    res.json({
      token: token,
      username: user.username
    });
  } catch (error) {
    console.error('Token poll error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});

// Helper to generate user-friendly codes (e.g., "ABC-123")
function generateUserCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed ambiguous chars
  let code = '';
  for (let i = 0; i < 3; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  code += '-';
  for (let i = 0; i < 3; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ============================================================================
// End CLI OAuth Device Flow
// ============================================================================

// CLI auth flow - redirects browser back to CLI with token
app.get('/cli-auth', (req, res) => {
  const { redirect } = req.query;

  if (!redirect) {
    return res.status(400).send('Missing redirect parameter');
  }

  // Validate redirect is to localhost
  try {
    const redirectUrl = new URL(redirect);
    if (redirectUrl.hostname !== '127.0.0.1' && redirectUrl.hostname !== 'localhost') {
      return res.status(400).send('Invalid redirect URL');
    }
  } catch {
    return res.status(400).send('Invalid redirect URL');
  }

  // Serve a simple login page that will redirect back to CLI
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>justtype CLI Login</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: system-ui, -apple-system, sans-serif;
          background: #0a0a0a;
          color: #fff;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          max-width: 400px;
          padding: 2rem;
          text-align: center;
        }
        h1 { margin-bottom: 1rem; font-size: 1.5rem; }
        p { color: #888; margin-bottom: 2rem; }
        form { display: flex; flex-direction: column; gap: 1rem; }
        input {
          background: #1a1a1a;
          border: 1px solid #333;
          color: #fff;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          font-size: 1rem;
        }
        input:focus { outline: none; border-color: #666; }
        button {
          background: #fff;
          color: #000;
          border: none;
          padding: 0.75rem 1rem;
          border-radius: 6px;
          font-size: 1rem;
          cursor: pointer;
          font-weight: 500;
        }
        button:hover { background: #eee; }
        .error { color: #f55; margin-top: 1rem; }
        .or { color: #666; margin: 1rem 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>justtype CLI</h1>
        <p>Log in to authorize the CLI</p>
        <form id="loginForm">
          <input type="text" name="username" placeholder="username or email" required autocomplete="username">
          <input type="password" name="password" placeholder="password" required autocomplete="current-password">
          <button type="submit">log in</button>
        </form>
        <div class="error" id="error" style="display: none;"></div>
      </div>
      <script>
        const redirect = ${JSON.stringify(redirect)};
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const form = e.target;
          const username = form.username.value;
          const password = form.password.value;
          const errorEl = document.getElementById('error');

          try {
            const res = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (res.ok && data.token) {
              window.location.href = redirect + '/callback?token=' + encodeURIComponent(data.token);
            } else {
              errorEl.textContent = data.error || 'Login failed';
              errorEl.style.display = 'block';
            }
          } catch (err) {
            errorEl.textContent = 'Connection error';
            errorEl.style.display = 'block';
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Resend verification email
app.post('/api/auth/resend-verification', createRateLimitMiddleware('resendVerification'), async (req, res) => {
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
app.post('/api/auth/forgot-password', verifyTurnstileToken, createRateLimitMiddleware('forgotPassword'), async (req, res) => {
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
// Reset password with recovery key (preserves slates)
// Get recovery data for E2E client-side password reset
app.post('/api/auth/recovery-data', createRateLimitMiddleware('resetPassword'), (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }
  const user = db.prepare('SELECT recovery_wrapped_key, recovery_salt, encryption_salt, e2e_migrated, reset_code_expires FROM users WHERE email = ? AND reset_token = ?')
    .get(email.toLowerCase(), code);
  if (!user) {
    return res.status(400).json({ error: 'Invalid reset code' });
  }
  if (new Date(user.reset_code_expires) < new Date()) {
    return res.status(400).json({ error: 'Reset code has expired' });
  }
  res.json({
    recoveryWrappedKey: user.recovery_wrapped_key,
    recoverySalt: user.recovery_salt,
    encryptionSalt: user.encryption_salt,
    e2e: !!user.e2e_migrated
  });
});

app.post('/api/auth/reset-password-with-recovery', createRateLimitMiddleware('resetPassword'), async (req, res) => {
  const { email, code, newPassword, recoveryPhrase,
    newWrappedKey: clientNewWrappedKey, newRecoveryWrappedKey: clientNewRecoveryWrappedKey,
    newRecoverySalt: clientNewRecoverySalt, newEncryptionSalt: clientNewEncryptionSalt } = req.body;

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

    if (new Date(user.reset_code_expires) < new Date()) {
      return res.status(400).json({ error: 'Reset code has expired' });
    }

    if (!user.key_migrated || !user.recovery_wrapped_key || !user.recovery_salt) {
      return res.status(400).json({ error: 'Account does not have a recovery key configured. Use the standard reset instead.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    let newRecoveryPhrase = null;

    if (user.e2e_migrated && clientNewWrappedKey && clientNewRecoveryWrappedKey) {
      if (!clientNewRecoverySalt || !clientNewEncryptionSalt) {
        return res.status(400).json({ error: 'Missing E2E reset data' });
      }
      // E2E user: client did all unwrap/rewrap locally
      const updateFields = [hashedPassword, clientNewWrappedKey, clientNewRecoveryWrappedKey, clientNewRecoverySalt];
      let sql = `UPDATE users SET password = ?, wrapped_key = ?, recovery_wrapped_key = ?, recovery_salt = ?`;
      sql += `, encryption_salt = ?`;
      updateFields.push(clientNewEncryptionSalt);
      sql += `, reset_token = NULL, reset_code_expires = NULL WHERE id = ?`;
      updateFields.push(user.id);
      db.prepare(sql).run(...updateFields);
    } else {
      // Non-E2E: server-side unwrap/rewrap
      if (!recoveryPhrase) {
        return res.status(400).json({ error: 'Recovery key is required' });
      }

      let slateKey;
      try {
        const recoveryDerivedKey = deriveEncryptionKey(recoveryPhrase.trim().toLowerCase(), user.recovery_salt);
        slateKey = unwrapKey(user.recovery_wrapped_key, recoveryDerivedKey);
      } catch (err) {
        return res.status(400).json({ error: 'Invalid recovery key. Please check your recovery phrase and try again.' });
      }

      const salt = user.encryption_salt || getOrCreateEncryptionSalt(user.id);
      const newPasswordKey = deriveEncryptionKey(newPassword, salt);
      const newWrappedKey = wrapKey(slateKey, newPasswordKey);

      const newRecoverySalt = crypto.randomBytes(32).toString('hex');
      newRecoveryPhrase = generateRecoveryPhrase();
      const newRecoveryKey = deriveEncryptionKey(newRecoveryPhrase, newRecoverySalt);
      const newRecoveryWrappedKey = wrapKey(slateKey, newRecoveryKey);

      db.prepare(`
        UPDATE users SET password = ?, wrapped_key = ?, recovery_wrapped_key = ?, recovery_salt = ?,
        reset_token = NULL, reset_code_expires = NULL WHERE id = ?
      `).run(hashedPassword, newWrappedKey, newRecoveryWrappedKey, newRecoverySalt, user.id);
    }

    // Invalidate all existing sessions
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    deleteCachedEncryptionKey(user.id);

    res.json({
      message: 'Password reset successfully! Your slates are preserved.',
      // E2E: client generated/shows new recovery phrase; non-E2E: server returns it
      recoveryPhrase: user.e2e_migrated ? undefined : newRecoveryPhrase,
      e2e: !!user.e2e_migrated
    });
  } catch (error) {
    console.error('Recovery password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Reset password without recovery key (destructive - wipes all slates)
app.post('/api/auth/reset-password', createRateLimitMiddleware('resetPassword'), async (req, res) => {
  const {
    email,
    code,
    newPassword,
    wrappedKey: clientWrappedKey,
    encryptionSalt: clientEncryptionSalt,
    recoveryWrappedKey: clientRecoveryWrappedKey,
    recoverySalt: clientRecoverySalt,
  } = req.body;

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

    if (new Date(user.reset_code_expires) < new Date()) {
      return res.status(400).json({ error: 'Reset code has expired' });
    }

    // Delete all user slates from B2 and DB
    const slates = db.prepare('SELECT id, b2_file_id, b2_public_file_id FROM slates WHERE user_id = ?').all(user.id);
    for (const slate of slates) {
      try {
        if (slate.b2_file_id) await b2Storage.deleteSlate(slate.b2_file_id);
        if (slate.b2_public_file_id) await b2Storage.deleteSlate(slate.b2_public_file_id);
      } catch (err) {
        console.error(`Failed to delete B2 file for slate #${slate.id}:`, err);
      }
    }
    db.prepare('DELETE FROM slates WHERE user_id = ?').run(user.id);

    // Set up fresh encryption with new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    let recoveryPhrase = undefined;

    const hasClientKeys = !!(clientWrappedKey && clientEncryptionSalt && clientRecoveryWrappedKey && clientRecoverySalt);
    if (hasClientKeys) {
      // ZK/E2E destructive reset: client generated a fresh slate key and re-wrapped it.
      db.prepare(`
        UPDATE users SET password = ?, wrapped_key = ?, encryption_salt = ?, recovery_wrapped_key = ?, recovery_salt = ?,
        key_migrated = 1, e2e_migrated = 1, storage_used = 0, reset_token = NULL, reset_code_expires = NULL
        WHERE id = ?
      `).run(hashedPassword, clientWrappedKey, clientEncryptionSalt, clientRecoveryWrappedKey, clientRecoverySalt, user.id);
    } else {
      // Legacy destructive reset (server-side wrapping). Ensure we don't leave an E2E flag pointing at a non-E2E key.
      const salt = user.encryption_salt || getOrCreateEncryptionSalt(user.id);
      const keyData = setupKeyWrapping(newPassword, salt);
      recoveryPhrase = keyData.recoveryPhrase;

      db.prepare(`
        UPDATE users SET password = ?, wrapped_key = ?, recovery_wrapped_key = ?, recovery_salt = ?,
        key_migrated = 1, e2e_migrated = 0, storage_used = 0, reset_token = NULL, reset_code_expires = NULL WHERE id = ?
      `).run(hashedPassword, keyData.wrappedKey, keyData.recoveryWrappedKey, keyData.recoverySalt, user.id);
    }

    // Invalidate all existing sessions
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    deleteCachedEncryptionKey(user.id);

    res.json({
      message: 'Password reset successfully. All slates have been deleted.',
      recoveryPhrase,
      slatesDeleted: slates.length
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ============ GOOGLE OAUTH ROUTES ============

// Initiate Google OAuth
app.get('/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false
  })
);

// Google OAuth callback
app.get('/auth/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/?googleAuth=error' }),
  (req, res) => {
    try {
      // Check if authentication failed due to existing account with password
      if (!req.user) {
        return res.redirect('/?googleAuth=account_exists');
      }

      // Check if this is a new user (just created)
      const isNewUser = req.user.created_at && (Date.now() - new Date(req.user.created_at).getTime() < 5000);

      // Generate JWT token
      const token = jwt.sign(
        {
          id: req.user.id,
          username: req.user.username
        },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      // Create session in database
      createSession(req.user.id, token, req);

      // Handle encryption key for Google users
      let migrationSlateKey = null;
      const userRecord = db.prepare('SELECT e2e_migrated, encrypted_key, wrapped_key, encryption_salt FROM users WHERE id = ?').get(req.user.id);

      if (userRecord && !userRecord.e2e_migrated && userRecord.encrypted_key) {
        // Google user not yet E2E migrated: decrypt key and pass to client (one-time)
        const encryptionKey = decryptEncryptionKey(userRecord.encrypted_key);
        migrationSlateKey = Buffer.from(encryptionKey).toString('base64');
        // Don't mark e2e_migrated yet — client will finalize after PIN setup
        cacheEncryptionKey(req.user.id, encryptionKey);
      } else if (userRecord && !userRecord.e2e_migrated) {
        // Non-Google legacy: cache for backward compat
        if (req.user.encrypted_key) {
          const encryptionKey = decryptEncryptionKey(req.user.encrypted_key);
          cacheEncryptionKey(req.user.id, encryptionKey);
        }
      }
      // E2E users: no server-side caching

      // Generate one-time auth code (prevents token/email exposure in URL)
      const authCode = generateAuthCode({
        token,
        userId: req.user.id,
        username: req.user.username,
        email: req.user.email,
        emailVerified: req.user.email_verified,
        isNewUser,
        migrationSlateKey,
        e2e: !!userRecord?.e2e_migrated
      });

      // Redirect with only the one-time code (no sensitive data in URL)
      res.redirect(`/?googleAuth=success&code=${authCode}`);
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      res.redirect('/?googleAuth=error');
    }
  }
);

// Exchange one-time auth code for session (sets HttpOnly cookie)
app.post('/api/auth/exchange-code', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Auth code required' });
  }

  const authData = consumeAuthCode(code);

  if (!authData) {
    return res.status(401).json({ error: 'Invalid or expired auth code' });
  }

  // Set HttpOnly cookie with the token
  res.cookie('justtype_token', authData.token, getAuthCookieOptions());

  res.json({
    user: {
      id: authData.userId,
      username: authData.username,
      email: authData.email,
      email_verified: authData.emailVerified
    },
    isNewUser: authData.isNewUser,
    migrationSlateKey: authData.migrationSlateKey || undefined,
    e2e: authData.e2e || false
  });
});

// Google OAuth for linking existing account
app.get('/auth/google/link', (req, res, next) => {
  const state = req.query.state;
  if (!state) {
    return res.redirect('/account?linkGoogle=error&reason=missing_state');
  }

  // Decode the state to get the user's email for login_hint
  let loginHint = null;
  try {
    const decoded = jwt.verify(state, JWT_SECRET);
    if (decoded.email) {
      loginHint = decoded.email;
    }
  } catch (err) {
    // If token is invalid, continue without login_hint
  }

  // Pass state and login_hint through passport authentication
  const authOptions = {
    scope: ['profile', 'email'],
    session: false,
    state: state
  };

  // Add login_hint to suggest the correct Google account
  if (loginHint) {
    authOptions.loginHint = loginHint;
  }

  passport.authenticate('google-link', authOptions)(req, res, next);
});

// Google OAuth linking callback
app.get('/auth/google/link/callback',
  passport.authenticate('google-link', { session: false, failureRedirect: '/account?linkGoogle=error' }),
  (req, res) => {
    try {
      // Get linking token from state parameter
      const linkingToken = req.query.state;

      if (!linkingToken) {
        return res.redirect('/account?linkGoogle=error&reason=missing_state');
      }

      // Verify linking token
      let linkingData;
      try {
        linkingData = jwt.verify(linkingToken, JWT_SECRET);
      } catch (err) {
        return res.redirect('/account?linkGoogle=error&reason=invalid_token');
      }

      if (linkingData.purpose !== 'link_google') {
        return res.redirect('/account?linkGoogle=error&reason=invalid_purpose');
      }

      const userId = linkingData.userId;
      const googleId = req.user.id;
      const googleEmail = req.user.emails[0].value;

      // Check if user exists
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (!user) {
        return res.redirect('/account?linkGoogle=error&reason=user_not_found');
      }

      // Check if this Google account is already linked to another user
      const existingGoogleUser = db.prepare('SELECT id FROM users WHERE google_id = ? AND id != ?').get(googleId, userId);
      if (existingGoogleUser) {
        return res.redirect('/account?linkGoogle=error&reason=google_already_linked');
      }

      // Link Google account
      db.prepare('UPDATE users SET google_id = ?, auth_provider = ? WHERE id = ?')
        .run(googleId, 'both', userId);

      console.log(`Linked Google account (${googleEmail}) to user ID ${userId}`);

      res.redirect('/account?linkGoogle=success');
    } catch (error) {
      console.error('Google linking callback error:', error);
      res.redirect('/account?linkGoogle=error');
    }
  }
);

// ============ SLATE ROUTES ============

// Get all slates for authenticated user
// Client handles search/sort - server just returns all slates
app.get('/api/slates', authenticateToken, (req, res) => {
  try {
    const slates = db.prepare(`
      SELECT id, title, encrypted_title, encrypted_tags, pinned_at, is_published, share_id, word_count, char_count, created_at, updated_at, published_at
      FROM slates
      WHERE user_id = ?
    `).all(req.user.id);

    // For unpublished slates with encrypted_title, hide plaintext (client decrypts)
    const result = slates.map(slate => {
      if (!slate.is_published && slate.encrypted_title) {
        return { ...slate, title: null };
      }
      return slate;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch slates' });
  }
});

// Update slate metadata (pinning, tags, etc.)
app.patch('/api/slates/:id/metadata', authenticateToken, (req, res) => {
  const { pinned, encryptedTags } = req.body || {};

  try {
    const slate = db.prepare('SELECT id FROM slates WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);

    if (!slate) {
      return res.status(404).json({ error: 'Slate not found' });
    }

    const updates = [];
    const params = [];

    let pinnedAt = undefined;
    if (typeof pinned === 'boolean') {
      pinnedAt = pinned ? Date.now() : null;
      updates.push('pinned_at = ?');
      params.push(pinnedAt);
    } else if (pinned !== undefined) {
      return res.status(400).json({ error: 'Invalid pinned value' });
    }

    if (encryptedTags !== undefined) {
      const userCheck = db.prepare('SELECT e2e_migrated FROM users WHERE id = ?').get(req.user.id);
      if (!userCheck || !userCheck.e2e_migrated) {
        return res.status(400).json({ error: 'Tags require E2E to be enabled on your account.', code: 'E2E_REQUIRED' });
      }

      if (encryptedTags !== null && typeof encryptedTags !== 'string') {
        return res.status(400).json({ error: 'Invalid encryptedTags value' });
      }

      // Avoid unbounded payloads.
      if (typeof encryptedTags === 'string' && encryptedTags.length > 10000) {
        return res.status(413).json({ error: 'Tags payload too large' });
      }

      updates.push('encrypted_tags = ?');
      params.push(encryptedTags);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No metadata updates provided' });
    }

    db.prepare(`UPDATE slates SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...params, req.params.id, req.user.id);

    res.json({ success: true, pinned_at: pinnedAt });
  } catch (error) {
    console.error('Update slate metadata error:', error);
    res.status(500).json({ error: 'Failed to update slate metadata' });
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

    if (req.e2e) {
      // E2E user: download raw encrypted blob from B2, return as base64
      const rawData = await b2Storage.downloadRawFile(slate.b2_file_id);
      const encryptedContent = rawData.toString('base64');
      return res.json({ ...slate, encryptedContent, encrypted: true });
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
  const { title, encryptedTitle, content, encryptedContent, wordCount: clientWordCount, charCount: clientCharCount, sizeBytes: clientSizeBytes } = req.body;

  const isE2E = !!req.e2e;
  let encryptedBuffer = null;

  // Legacy users: title + plaintext required. E2E users: encrypted content + encrypted title required.
  if (req.e2e) {
    // E2E users must send encrypted content — reject plaintext to prevent unencrypted storage
    if (!encryptedContent) {
      return res.status(400).json({ error: 'Encrypted content required. Please unlock your slates first.', code: 'E2E_PLAINTEXT_REJECTED' });
    }
    // Titles must be zero-knowledge for E2E users — do not accept plaintext titles as the source of truth.
    if (!encryptedTitle) {
      return res.status(400).json({ error: 'Encrypted title required. Please update your app and try again.', code: 'E2E_TITLE_REQUIRED' });
    }

    try {
      encryptedBuffer = decodeBase64Strict(encryptedContent);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid encrypted content', code: 'E2E_INVALID_CONTENT' });
    }
  } else {
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content required' });
    }
  }

  // Check content size (5 MB limit)
  const contentSize = isE2E ? encryptedBuffer.length : Buffer.byteLength(content, 'utf8');
  const maxSize = 5 * 1024 * 1024; // 5 MB
  if (contentSize > maxSize) {
    return res.status(413).json({
      error: `Content too large. Maximum size is 5 MB, your content is ${(contentSize / 1024 / 1024).toFixed(2)} MB.`
    });
  }

  // Check storage limit
  const storageCheck = checkStorageLimit(req.user.id, contentSize);
  if (!storageCheck.allowed) {
    return res.status(413).json({ error: storageCheck.error });
  }

  try {
    // Check slate limit (50 slates per user)
    const slateCount = db.prepare('SELECT COUNT(*) as count FROM slates WHERE user_id = ?').get(req.user.id);
    if (slateCount.count >= 50) {
      return res.status(403).json({ error: 'Slate limit reached (50 max). Delete some slates to create new ones.' });
    }

    const slateId = `${req.user.id}-${Date.now()}`;
    let b2FileId;
    let wordCount, charCount, sizeBytes;

    if (isE2E) {
      // E2E: upload pre-encrypted blob directly
      b2FileId = await b2Storage.uploadRawSlate(slateId, encryptedBuffer);
      wordCount = clientWordCount || 0;
      charCount = clientCharCount || 0;
      sizeBytes = contentSize;
    } else {
      // Legacy: server encrypts
      const encryptionKey = req.encryptionKey;
      b2FileId = await b2Storage.uploadSlate(slateId, content, encryptionKey);
      wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
      charCount = content.length;
      sizeBytes = contentSize;
    }

	    // Save metadata to database with encryption_version = 1
	    const stmt = db.prepare(`
	      INSERT INTO slates (user_id, title, encrypted_title, b2_file_id, word_count, char_count, size_bytes, encryption_version)
	      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	    `);
	    // For E2E private slates, never store plaintext title in the DB (ZK). Keep it empty and rely on encrypted_title.
	    const titleToStore = isE2E ? '' : title;
	    const encryptedTitleToStore = isE2E ? encryptedTitle : null;
	    const result = stmt.run(req.user.id, titleToStore, encryptedTitleToStore, b2FileId, wordCount, charCount, sizeBytes, 1);

    // Update user's total storage usage
    updateUserStorage(req.user.id);

    // Get updated slate count
    const updatedSlateCount = db.prepare('SELECT COUNT(*) as count FROM slates WHERE user_id = ?').get(req.user.id);

	    res.status(201).json({
	      id: result.lastInsertRowid,
	      title: isE2E ? '' : title,
	      word_count: wordCount,
	      char_count: charCount,
	      is_published: 0,
	      share_id: null,
	      slateCount: updatedSlateCount.count
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
app.put('/api/slates/:id', authenticateToken, createRateLimitMiddleware('updateSlate'), async (req, res) => {
  const { title, encryptedTitle, content, encryptedContent, wordCount: clientWordCount, charCount: clientCharCount, sizeBytes: clientSizeBytes } = req.body;

  // Determine if E2E
  const userE2E = db.prepare('SELECT e2e_migrated, auth_provider, encrypted_key FROM users WHERE id = ?').get(req.user.id);
  const isE2E = userE2E && userE2E.e2e_migrated && encryptedContent;
  let encryptedBuffer = null;

  // E2E users must send encrypted content — reject plaintext to prevent unencrypted storage
  if (userE2E && userE2E.e2e_migrated && !encryptedContent && content) {
    return res.status(400).json({ error: 'Encrypted content required. Please unlock your slates first.', code: 'E2E_PLAINTEXT_REJECTED' });
  }

  // E2E users must always provide encryptedTitle so private titles remain zero-knowledge.
  if (isE2E && !encryptedTitle) {
    return res.status(400).json({ error: 'Encrypted title required. Please update your app and try again.', code: 'E2E_TITLE_REQUIRED' });
  }

  if (isE2E) {
    try {
      encryptedBuffer = decodeBase64Strict(encryptedContent);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid encrypted content', code: 'E2E_INVALID_CONTENT' });
    }
  }

  // Check content size (5 MB limit)
  const contentSize = isE2E ? encryptedBuffer.length : Buffer.byteLength(content || '', 'utf8');
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

    // Get encryption key - handle based on slate type and user auth method
    let encryptionKey = null;

    if (!isE2E && !slate.is_system_slate) {
      // Non-E2E: normal slates need server-side encryption
      if (userE2E && (userE2E.auth_provider === 'google' || userE2E.auth_provider === 'both') && userE2E.encrypted_key) {
        try {
          encryptionKey = decryptEncryptionKey(userE2E.encrypted_key);
        } catch (error) {
          console.error('Failed to decrypt Google user encryption key:', error);
          return res.status(500).json({
            error: 'Failed to access encryption key',
            code: 'ENCRYPTION_KEY_ERROR'
          });
        }
      } else {
        encryptionKey = getCachedEncryptionKey(req.user.id);
        if (!encryptionKey) {
          return res.status(401).json({
            error: 'Encryption key missing. Please re-login to continue.',
            code: 'ENCRYPTION_KEY_MISSING'
          });
        }
      }
    }

    // Check storage limit (account for size difference)
    const sizeDifference = contentSize - (slate.size_bytes || 0);
    if (sizeDifference > 0) {
      const storageCheck = checkStorageLimit(req.user.id, sizeDifference);
      if (!storageCheck.allowed) {
        return res.status(413).json({ error: storageCheck.error });
      }
    }

    // Auto-unpublish if slate is currently published (unless it's a system slate)
    const oldB2FileId = slate.b2_file_id;
    const oldPublicFileId = slate.b2_public_file_id;
    let wasUnpublished = false;
    let newPublicFileId = slate.b2_public_file_id;
    let publicFileIdToDelete = null;

    if (slate.is_published && !slate.is_system_slate) {
      wasUnpublished = true;
      publicFileIdToDelete = oldPublicFileId;
      newPublicFileId = null;
    }

    // Upload new version to B2
    let b2FileId;

    if (slate.is_system_slate) {
      const slateId = `system-${slate.share_id}-${Date.now()}`;
      b2FileId = await b2Storage.uploadSlate(slateId, content, null);
      newPublicFileId = b2FileId;
    } else if (isE2E) {
      const slateId = `${req.user.id}-${Date.now()}`;
      b2FileId = await b2Storage.uploadRawSlate(slateId, encryptedBuffer);
    } else {
      const slateId = `${req.user.id}-${Date.now()}`;
      b2FileId = await b2Storage.uploadSlate(slateId, content, encryptionKey);
    }

    // Calculate stats
	    const wordCount = isE2E ? (clientWordCount || 0) : (content.trim() === '' ? 0 : content.trim().split(/\s+/).length);
	    const charCount = isE2E ? (clientCharCount || 0) : content.length;
	    const sizeBytes = contentSize;

	    const newPublishedState = slate.is_system_slate ? slate.is_published : 0;
	    const encryptionVersion = slate.is_system_slate ? 0 : 1;

	    // For E2E private slates, never store plaintext title in the DB (ZK).
	    const titleToStore = (!slate.is_system_slate && isE2E) ? '' : title;
	    const encryptedTitleToStore = (!slate.is_system_slate && isE2E) ? encryptedTitle : (encryptedTitle || null);
	    const stmt = db.prepare(`
	      UPDATE slates
	      SET title = ?, encrypted_title = ?, b2_file_id = ?, word_count = ?, char_count = ?, size_bytes = ?, encryption_version = ?,
	          is_published = ?, b2_public_file_id = ?, updated_at = CURRENT_TIMESTAMP
	      WHERE id = ? AND user_id = ?
	    `);
	    stmt.run(titleToStore, encryptedTitleToStore, b2FileId, wordCount, charCount, sizeBytes, encryptionVersion, newPublishedState, newPublicFileId, req.params.id, req.user.id);

    // Best-effort cleanup of old B2 files AFTER the DB update (prevents data loss if the DB write fails).
    const fileIdsToDelete = new Set();
    if (oldB2FileId) fileIdsToDelete.add(oldB2FileId);
    if (oldPublicFileId && oldPublicFileId !== oldB2FileId) fileIdsToDelete.add(oldPublicFileId);
    if (publicFileIdToDelete) fileIdsToDelete.add(publicFileIdToDelete);

    // Never delete newly-referenced files.
    fileIdsToDelete.delete(b2FileId);
    if (newPublicFileId) fileIdsToDelete.delete(newPublicFileId);

    for (const fileId of fileIdsToDelete) {
      try {
        await b2Storage.deleteSlate(fileId);
      } catch (err) {
        console.warn('Failed to delete old B2 file:', err);
      }
    }

    // Update user's total storage usage
    updateUserStorage(req.user.id);

    // Get current slate count
    const currentSlateCount = db.prepare('SELECT COUNT(*) as count FROM slates WHERE user_id = ?').get(req.user.id);

    res.json({
      success: true,
      word_count: wordCount,
      char_count: charCount,
      was_unpublished: wasUnpublished,
      is_published: newPublishedState === 1,
      share_id: slate.share_id,
      slateCount: currentSlateCount.count
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
  const { isPublished, publicContent, publicTitle, encryptedTitle } = req.body;

  // For E2E users, private titles must be zero-knowledge. When unpublishing, require an encrypted title.
  if (req.e2e && isPublished === false && !encryptedTitle) {
    return res.status(400).json({ error: 'Encrypted title required. Please unlock your slates first.', code: 'E2E_TITLE_REQUIRED' });
  }

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
      let content;
      if (req.e2e && publicContent) {
        // E2E user: client sends plaintext for public copy
        content = publicContent;
      } else {
        // Non-E2E: server decrypts
        const encryptionKey = req.encryptionKey;
        content = await b2Storage.getSlate(slate.b2_file_id, encryptionKey);
      }

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

    // Only set published_at when publishing for the first time
    // Keep existing published_at when unpublishing (to track that it was published before)
    const publishedAt = isPublished && !slate.published_at ? new Date().toISOString() : slate.published_at;

    // Handle title encryption state based on publish action
    let titleToStore = slate.title;
    let encryptedTitleToStore = slate.encrypted_title;

    if (isPublished && publicTitle) {
      // Publishing: store plaintext title for public view, clear encrypted
      titleToStore = publicTitle;
      encryptedTitleToStore = null;
    } else if (!isPublished) {
      // Unpublishing: store encrypted title. For E2E users, wipe plaintext title (ZK).
      if (encryptedTitle) {
        encryptedTitleToStore = encryptedTitle;
      }
      if (req.e2e && !slate.is_system_slate) {
        titleToStore = '';
      }
    }

    const stmt = db.prepare(`
      UPDATE slates
      SET is_published = ?, share_id = ?, published_at = ?, b2_public_file_id = ?, title = ?, encrypted_title = ?
      WHERE id = ? AND user_id = ?
    `);
    stmt.run(isPublished ? 1 : 0, shareId, publishedAt, publicFileId, titleToStore, encryptedTitleToStore, req.params.id, req.user.id);

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

    // Protect system slates from deletion
    if (slate.is_system_slate) {
      return res.status(403).json({ error: 'System slates cannot be deleted' });
    }

    // Delete from B2
    try {
      await b2Storage.deleteSlate(slate.b2_file_id);
    } catch (err) {
      console.warn('Failed to delete B2 file:', err);
    }

    // Delete from database
    db.prepare('DELETE FROM slates WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);

    // Update user's total storage usage
    updateUserStorage(req.user.id);

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

// Migrate slate title to encrypted (one-time operation for existing slates)
app.post('/api/slates/:id/migrate-title', authenticateToken, async (req, res) => {
  const { encryptedTitle } = req.body;

  if (!encryptedTitle) {
    return res.status(400).json({ error: 'Encrypted title required' });
  }

  try {
    const slate = db.prepare('SELECT * FROM slates WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);

    if (!slate) {
      return res.status(404).json({ error: 'Slate not found' });
    }

    // Only migrate unpublished slates. If already migrated, still wipe plaintext title if present.
    if (slate.is_published) {
      return res.json({ success: true, skipped: true });
    }

    if (slate.encrypted_title) {
      // Already encrypted: just wipe plaintext title.
      db.prepare('UPDATE slates SET title = ? WHERE id = ?')
        .run('', req.params.id);
      return res.json({ success: true, skipped: true, wipedPlaintextTitle: true });
    }

    db.prepare('UPDATE slates SET encrypted_title = ?, title = ? WHERE id = ?')
      .run(encryptedTitle, '', req.params.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Migrate title error:', error);
    res.status(500).json({ error: 'Failed to migrate title' });
  }
});

// ============ PUBLIC ROUTES ============

// Get published slate (no auth required)
app.get('/api/public/slates/:shareId', createRateLimitMiddleware('viewPublicSlate'), async (req, res) => {
  try {
    const slate = db.prepare(`
      SELECT slates.*, users.username, users.supporter_tier, users.supporter_badge_visible, users.is_system_user
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

    // Increment view count (only for non-cached requests)
    db.prepare(`
      UPDATE slates SET view_count = view_count + 1 WHERE id = ?
    `).run(slate.id);

    // Set cache headers BEFORE fetching from B2
    // Use no-cache to force revalidation on every request (checks ETag)
    // This prevents stale content after edits while still allowing 304 responses
    res.setHeader('Cache-Control', 'public, no-cache, must-revalidate');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', new Date(slate.updated_at).toUTCString());

    // Use public file ID if available (for encrypted slates), otherwise use regular file ID
    const fileIdToFetch = slate.b2_public_file_id || slate.b2_file_id;

    // Fetch content from B2 (public slates are always unencrypted)
    const content = await b2Storage.getSlate(fileIdToFetch, null);

    // Display "alfaoz" for system users
    const displayUsername = slate.is_system_user ? 'alfaoz' : slate.username;

    res.json({
      title: slate.title,
      content,
      author: displayUsername,
      supporter_tier: slate.supporter_tier,
      supporter_badge_visible: slate.supporter_badge_visible === 1,
      word_count: slate.word_count,
      char_count: slate.char_count,
      view_count: slate.view_count + 1, // Return updated count
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
  const adminSecret = process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;

  if (!adminSecret) {
    return res.status(503).json({ error: 'Admin access not configured' });
  }

  // Direct string comparison for simplicity and reliability
  // (ADMIN_SECRET should be a long random string in .env)
  const isValid = password === adminSecret;

  if (isValid) {
    const adminToken = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' });

    // Log admin login
    logAdminAction('admin_login', {
      ipAddress: req.adminIp || req.ip,
      details: { message: 'Admin logged in' }
    });

    // Email admin token if ADMIN_EMAIL is configured
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      emailService.sendEmail({
        to: adminEmail,
        subject: 'justtype admin token issued',
        text: `A new admin token was issued.\n\nToken: ${adminToken}\n\nExpires in 24 hours.\nIP: ${req.adminIp || req.ip}\nTime: ${new Date().toISOString()}`
      }).catch(err => console.error('Failed to send admin token email:', err));
    }

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
        users.supporter_tier,
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

    // Send both masked and full emails - admin can reveal via triple-click
    const maskedUsers = users.map(user => ({
      ...user,
      emailFull: user.email,
      email: maskEmail(user.email)
    }));

    res.json({
      users: maskedUsers,
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
        email: maskEmail(user.email),
        slatesDeleted: slates.length
      }
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Update user plan (admin only)
app.patch('/api/admin/users/:id/plan', authenticateAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { plan } = req.body; // 'free', 'one_time', or 'quarterly'

    if (!['free', 'one_time', 'quarterly'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const user = db.prepare('SELECT username, email, supporter_tier FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date().toISOString();
    let storageLimit, supporterTier;

    if (plan === 'free') {
      storageLimit = 25000000; // 25 MB
      supporterTier = null;
    } else if (plan === 'one_time') {
      storageLimit = 50000000; // 50 MB
      supporterTier = 'one_time';
    } else if (plan === 'quarterly') {
      storageLimit = 999999999999; // Unlimited
      supporterTier = 'quarterly';
    }

    // Update user plan
    db.prepare(`
      UPDATE users
      SET supporter_tier = ?,
          storage_limit = ?,
          donated_at = ?
      WHERE id = ?
    `).run(supporterTier, storageLimit, supporterTier ? now : null, userId);

    // Log the action
    logAdminAction('update_user_plan', {
      targetType: 'user',
      targetId: userId,
      ipAddress: req.adminIp,
      details: {
        username: user.username,
        oldPlan: user.supporter_tier || 'free',
        newPlan: plan
      }
    });

    // Send email notification if plan changed
    if (supporterTier && !user.supporter_tier && user.email) {
      // Upgraded to supporter
      const { strings } = require('./strings.cjs');
      emailService.sendEmail({
        to: user.email,
        subject: strings.email.subscriptionStarted.subject,
        text: strings.email.subscriptionStarted.body(user.username)
      }).catch(err => console.error('Failed to send plan change email:', err));
    } else if (!supporterTier && user.supporter_tier && user.email) {
      // Downgraded to free
      const { strings } = require('./strings.cjs');
      emailService.sendEmail({
        to: user.email,
        subject: strings.email.subscriptionCancelled.subject,
        text: strings.email.subscriptionCancelled.body(user.username)
      }).catch(err => console.error('Failed to send plan change email:', err));
    }

    res.json({ message: 'User plan updated successfully', plan });
  } catch (error) {
    console.error('Admin update plan error:', error);
    res.status(500).json({ error: 'Failed to update user plan' });
  }
});

// Get B2 usage stats
app.get('/api/admin/b2-stats', authenticateAdmin, (req, res) => {
  try {
    const stats = b2Monitor.getStats();
    logAdminAction('view_b2_stats', {
      ipAddress: req.adminIp || req.ip
    });
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

    logAdminAction('view_health', {
      ipAddress: req.adminIp || req.ip
    });

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

    logAdminAction('view_error_logs', {
      ipAddress: req.adminIp || req.ip
    });

    res.json({ logs: errorLogs || 'No error logs found' });
  } catch (error) {
    console.error('Failed to fetch error logs:', error);
    res.status(500).json({ error: 'Failed to fetch error logs', logs: error.message });
  }
});

// Get Stripe subscription data with health checks
app.get('/api/admin/stripe-subscriptions', authenticateAdmin, (req, res) => {
  try {
    // Get all users with subscriptions
    const subscriptions = db.prepare(`
      SELECT
        id as user_id,
        username,
        email,
        supporter_tier,
        stripe_customer_id,
        stripe_subscription_id,
        subscription_expires_at,
        storage_used,
        created_at
      FROM users
      WHERE supporter_tier IS NOT NULL
      ORDER BY created_at DESC
    `).all();

    // Detect test data (fake stripe IDs)
    const testData = subscriptions.filter(sub =>
      sub.stripe_customer_id && sub.stripe_customer_id.startsWith('test_cus_')
    );

    // Calculate stats
    const stats = {
      totalSubscriptions: subscriptions.length,
      activeSubscriptions: subscriptions.filter(s => !s.subscription_expires_at).length,
      pendingCancellations: subscriptions.filter(s => s.subscription_expires_at).length,
      totalRevenue: subscriptions.filter(s => s.supporter_tier === 'quarterly').length * 700 // 7 EUR per quarter
    };

    // Mark subscriptions with issues and mask emails for privacy
    const enrichedSubscriptions = subscriptions.map(sub => ({
      ...sub,
      email: maskEmail(sub.email),
      is_test_data: sub.stripe_customer_id && sub.stripe_customer_id.startsWith('test_cus_')
    }));

    // Log admin action
    logAdminAction('view_stripe_subscriptions', {
      details: { count: subscriptions.length },
      ipAddress: req.adminIp || req.ip
    });

    res.json({
      stats,
      subscriptions: enrichedSubscriptions,
      mismatches: [], // Future: could check against Stripe API
      testData
    });
  } catch (error) {
    console.error('Failed to fetch stripe subscriptions:', error);
    res.status(500).json({ error: 'Failed to fetch stripe subscriptions' });
  }
});

// Perform Stripe management actions
app.post('/api/admin/stripe-action', authenticateAdmin, async (req, res) => {
  try {
    const { action, userId } = req.body;

    switch (action) {
      case 'clear-test-data': {
        if (userId) {
          // Clear test data for specific user
          const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
          db.prepare(`
            UPDATE users
            SET stripe_customer_id = NULL,
                stripe_subscription_id = NULL
            WHERE id = ? AND stripe_customer_id LIKE 'test_cus_%'
          `).run(userId);
          logAdminAction('stripe_clear_test_data', {
            targetType: 'user',
            targetId: userId,
            details: { username: user?.username },
            ipAddress: req.adminIp || req.ip
          });
          return res.json({ message: 'Test data cleared for user' });
        }
        break;
      }

      case 'clean-test-data':
      case 'clean-all-test-data': {
        // Remove all test stripe IDs (keeps supporter_tier intact)
        const result = db.prepare(`
          UPDATE users
          SET stripe_customer_id = NULL,
              stripe_subscription_id = NULL
          WHERE stripe_customer_id LIKE 'test_cus_%'
        `).run();
        logAdminAction('stripe_clean_all_test_data', {
          details: { count: result.changes },
          ipAddress: req.adminIp || req.ip
        });
        return res.json({
          message: `Cleaned test data from ${result.changes} users`
        });
      }

      case 'clear-cancellation': {
        if (!userId) {
          return res.status(400).json({ error: 'userId required' });
        }
        // Clear cancellation date for specific user
        const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
        db.prepare(`
          UPDATE users
          SET subscription_expires_at = NULL
          WHERE id = ?
        `).run(userId);
        logAdminAction('stripe_clear_cancellation', {
          targetType: 'user',
          targetId: userId,
          details: { username: user?.username },
          ipAddress: req.adminIp || req.ip
        });
        return res.json({ message: 'Cancellation date cleared' });
      }

      case 'clear-all-cancellations': {
        // Clear all cancellation dates
        const result = db.prepare(`
          UPDATE users
          SET subscription_expires_at = NULL
          WHERE subscription_expires_at IS NOT NULL
        `).run();
        logAdminAction('stripe_clear_all_cancellations', {
          details: { count: result.changes },
          ipAddress: req.adminIp || req.ip
        });
        return res.json({
          message: `Cleared cancellation dates for ${result.changes} users`
        });
      }

      case 'cancel-immediately': {
        if (!userId) {
          return res.status(400).json({ error: 'userId required' });
        }

        // Get user info including email and Stripe subscription ID
        const user = db.prepare('SELECT username, email, supporter_tier, stripe_subscription_id FROM users WHERE id = ?').get(userId);

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Cancel subscription in Stripe if it exists
        if (user.stripe_subscription_id && stripeModule && stripeModule.stripe) {
          try {
            await stripeModule.stripe.subscriptions.cancel(user.stripe_subscription_id);
            console.log(`✓ Cancelled Stripe subscription ${user.stripe_subscription_id} for user ${userId}`);
          } catch (error) {
            console.error('Failed to cancel subscription in Stripe:', error);
            // Continue with database update even if Stripe cancellation fails
          }
        }

        // Downgrade to one_time supporter (keeps increased storage)
        db.prepare(`
          UPDATE users
          SET supporter_tier = 'one_time',
              storage_limit = 50000000,
              subscription_expires_at = NULL,
              stripe_subscription_id = NULL
          WHERE id = ?
        `).run(userId);

        // Send immediate cancellation email
        if (user.email) {
          const { strings } = require('./strings.cjs');
          emailService.sendEmail({
            to: user.email,
            subject: strings.email.subscriptionCancelledImmediate.subject,
            text: strings.email.subscriptionCancelledImmediate.body(user.username)
          }).then(() => {
            console.log(`✓ Immediate cancellation email sent to user #${userId}`);
          }).catch(err => console.error('Failed to send immediate cancellation email:', err));
        }

        logAdminAction('stripe_cancel_immediately', {
          targetType: 'user',
          targetId: userId,
          details: { username: user?.username, previous_tier: user?.supporter_tier },
          ipAddress: req.adminIp || req.ip
        });

        return res.json({ message: 'Subscription cancelled immediately' });
      }

      case 'fix-mismatches': {
        // Future: could sync with Stripe API
        logAdminAction('stripe_fix_mismatches', {
          details: { status: 'not_implemented' },
          ipAddress: req.adminIp || req.ip
        });
        return res.json({ message: 'Mismatch fixing not yet implemented' });
      }

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Stripe action error:', error);
    res.status(500).json({ error: 'Action failed' });
  }
});

// ============ NOTIFICATION ROUTES ============

// Helper: check if a user matches notification filters
function userMatchesFilters(notification, userStats) {
  const n = notification;
  if (n.filter_user_ids) {
    const ids = n.filter_user_ids.split(',').map(id => parseInt(id.trim()));
    if (!ids.includes(userStats.id)) return false;
  }
  if (n.filter_min_slates != null && n.filter_min_slates !== '' && userStats.slate_count < Number(n.filter_min_slates)) return false;
  if (n.filter_max_slates != null && n.filter_max_slates !== '' && userStats.slate_count > Number(n.filter_max_slates)) return false;
  if (n.filter_plan && n.filter_plan !== '') {
    const userPlan = userStats.supporter_tier || 'free';
    if (n.filter_plan !== userPlan) return false;
  }
  if (n.filter_verified_only && !userStats.email_verified) return false;
  if (n.filter_min_views != null && n.filter_min_views !== '' && (userStats.max_view_count || 0) < Number(n.filter_min_views)) return false;
  return true;
}

// Get notifications for current user (with filtering and read status)
app.get('/api/notifications', authenticateToken, (req, res) => {
  try {
    const userStats = db.prepare(`
      SELECT u.id, u.supporter_tier, u.email_verified,
        (SELECT COUNT(*) FROM slates WHERE user_id = u.id) as slate_count,
        (SELECT MAX(view_count) FROM slates WHERE user_id = u.id) as max_view_count
      FROM users u WHERE u.id = ?
    `).get(req.user.id);

    const allNotifications = db.prepare(`
      SELECT n.id, n.type, n.title, n.message, n.link, n.created_at,
        n.filter_min_slates, n.filter_max_slates, n.filter_plan,
        n.filter_verified_only, n.filter_min_views, n.filter_user_ids,
        CASE WHEN nr.id IS NOT NULL THEN 1 ELSE 0 END as is_read
      FROM notifications n
      LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 100
    `).all(req.user.id);

    const filtered = allNotifications.filter(n => userMatchesFilters(n, userStats));

    // Strip filter fields from response
    const notifications = filtered.map(({ filter_min_slates, filter_max_slates, filter_plan, filter_verified_only, filter_min_views, filter_user_ids, ...rest }) => rest);

    res.json({ notifications });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
app.post('/api/notifications/:id/read', authenticateToken, (req, res) => {
  try {
    db.prepare(`
      INSERT OR IGNORE INTO notification_reads (user_id, notification_id)
      VALUES (?, ?)
    `).run(req.user.id, req.params.id);

    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// Admin: create notification
app.post('/api/admin/notifications', authenticateAdmin, (req, res) => {
  const { title, message, link, type, filter_min_slates, filter_max_slates, filter_plan, filter_verified_only, filter_min_views, filter_user_ids } = req.body;

  if (!title || !message) {
    return res.status(400).json({ error: 'Title and message are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO notifications (type, title, message, link, filter_min_slates, filter_max_slates, filter_plan, filter_verified_only, filter_min_views, filter_user_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      type || 'global', title, message, link || null,
      filter_min_slates || null, filter_max_slates || null, filter_plan || null,
      filter_verified_only ? 1 : 0, filter_min_views || null, filter_user_ids || null
    );
    logAdminAction('create_notification', {
      details: { id: result.lastInsertRowid, title, type: type || 'global' },
      ipAddress: req.adminIp || req.ip
    });
    res.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

// Admin: get all notifications with analytics
app.get('/api/admin/notifications', authenticateAdmin, (req, res) => {
  try {
    const notifications = db.prepare(`
      SELECT n.*,
        (SELECT COUNT(*) FROM notification_reads WHERE notification_id = n.id) as read_count
      FROM notifications n
      ORDER BY n.created_at DESC
    `).all();

    // Calculate eligible count for each notification
    const users = db.prepare(`
      SELECT u.id, u.supporter_tier, u.email_verified,
        (SELECT COUNT(*) FROM slates WHERE user_id = u.id) as slate_count,
        (SELECT MAX(view_count) FROM slates WHERE user_id = u.id) as max_view_count
      FROM users u
    `).all();

    const result = notifications.map(n => {
      const eligible = users.filter(u => userMatchesFilters(n, u)).length;
      return {
        ...n,
        total_eligible: eligible,
        read_percentage: eligible > 0 ? Math.round((n.read_count / eligible) * 100) : 0
      };
    });

    res.json({ notifications: result });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Admin: delete notification
app.delete('/api/admin/notifications/:id', authenticateAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM notification_reads WHERE notification_id = ?').run(req.params.id);
    db.prepare('DELETE FROM notifications WHERE id = ?').run(req.params.id);
    logAdminAction('delete_notification', {
      details: { id: req.params.id },
      ipAddress: req.adminIp || req.ip
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Admin: preview eligible user count for filters
app.post('/api/admin/notifications/preview', authenticateAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.supporter_tier, u.email_verified,
        (SELECT COUNT(*) FROM slates WHERE user_id = u.id) as slate_count,
        (SELECT MAX(view_count) FROM slates WHERE user_id = u.id) as max_view_count
      FROM users u
    `).all();

    const eligible = users.filter(u => userMatchesFilters(req.body, u)).length;
    res.json({ eligible, total: users.length });
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: 'Failed to preview' });
  }
});

// ============ AUTOMATION ROUTES ============

// Admin: get all automation rules
app.get('/api/admin/automations', authenticateAdmin, (req, res) => {
  try {
    const automations = db.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM automation_log WHERE automation_id = a.id) as times_fired
      FROM notification_automations a
      ORDER BY a.created_at DESC
    `).all();
    res.json({ automations });
  } catch (error) {
    console.error('Fetch automations error:', error);
    res.status(500).json({ error: 'Failed to fetch automations' });
  }
});

// Admin: create automation rule
app.post('/api/admin/automations', authenticateAdmin, (req, res) => {
  const { event_type, threshold, title, message, link } = req.body;

  if (!event_type || !threshold || !title || !message) {
    return res.status(400).json({ error: 'event_type, threshold, title, and message are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO notification_automations (event_type, threshold, title, message, link)
      VALUES (?, ?, ?, ?, ?)
    `).run(event_type, threshold, title, message, link || null);
    logAdminAction('create_automation', {
      details: { id: result.lastInsertRowid, event_type, threshold },
      ipAddress: req.adminIp || req.ip
    });
    res.json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error('Create automation error:', error);
    res.status(500).json({ error: 'Failed to create automation' });
  }
});

// Admin: toggle automation enabled/disabled
app.put('/api/admin/automations/:id', authenticateAdmin, (req, res) => {
  const { enabled } = req.body;
  try {
    db.prepare('UPDATE notification_automations SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Update automation error:', error);
    res.status(500).json({ error: 'Failed to update automation' });
  }
});

// Admin: delete automation rule
app.delete('/api/admin/automations/:id', authenticateAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM automation_log WHERE automation_id = ?').run(req.params.id);
    db.prepare('DELETE FROM notification_automations WHERE id = ?').run(req.params.id);
    logAdminAction('delete_automation', {
      details: { id: req.params.id },
      ipAddress: req.adminIp || req.ip
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete automation error:', error);
    res.status(500).json({ error: 'Failed to delete automation' });
  }
});

// ============ AUTOMATION ENGINE ============

function runAutomations() {
  try {
    const automations = db.prepare('SELECT * FROM notification_automations WHERE enabled = 1').all();

    for (const auto of automations) {
      let matches = [];

      switch (auto.event_type) {
        case 'slate_views': {
          // Find slates that crossed the view threshold, not yet logged
          matches = db.prepare(`
            SELECT s.id as slate_id, s.user_id, s.title as slate_title, s.view_count, u.username
            FROM slates s
            JOIN users u ON u.id = s.user_id
            WHERE s.view_count >= ?
              AND NOT EXISTS (
                SELECT 1 FROM automation_log
                WHERE automation_id = ? AND user_id = s.user_id AND slate_id = s.id
              )
          `).all(auto.threshold, auto.id);
          break;
        }
        case 'slate_count': {
          // Find users whose total slate count crossed the threshold
          matches = db.prepare(`
            SELECT u.id as user_id, u.username, COUNT(s.id) as slate_count
            FROM users u
            JOIN slates s ON s.user_id = u.id
            GROUP BY u.id
            HAVING slate_count >= ?
              AND NOT EXISTS (
                SELECT 1 FROM automation_log
                WHERE automation_id = ? AND user_id = u.id AND slate_id IS NULL
              )
          `).all(auto.threshold, auto.id);
          break;
        }
        case 'account_age_days': {
          // Find users whose account age crossed the threshold
          matches = db.prepare(`
            SELECT u.id as user_id, u.username,
              CAST((julianday('now') - julianday(u.created_at)) AS INTEGER) as age_days
            FROM users u
            WHERE CAST((julianday('now') - julianday(u.created_at)) AS INTEGER) >= ?
              AND NOT EXISTS (
                SELECT 1 FROM automation_log
                WHERE automation_id = ? AND user_id = u.id AND slate_id IS NULL
              )
          `).all(auto.threshold, auto.id);
          break;
        }
        case 'published_count': {
          // Find users whose published slate count crossed the threshold
          matches = db.prepare(`
            SELECT u.id as user_id, u.username, COUNT(s.id) as published_count
            FROM users u
            JOIN slates s ON s.user_id = u.id AND s.is_published = 1
            GROUP BY u.id
            HAVING published_count >= ?
              AND NOT EXISTS (
                SELECT 1 FROM automation_log
                WHERE automation_id = ? AND user_id = u.id AND slate_id IS NULL
              )
          `).all(auto.threshold, auto.id);
          break;
        }
      }

      for (const match of matches) {
        // Substitute placeholders in title and message
        let title = auto.title
          .replace(/\{username\}/g, match.username || '')
          .replace(/\{slate_title\}/g, match.slate_title || '')
          .replace(/\{view_count\}/g, match.view_count || '')
          .replace(/\{slate_count\}/g, match.slate_count || '')
          .replace(/\{published_count\}/g, match.published_count || '');
        let message = auto.message
          .replace(/\{username\}/g, match.username || '')
          .replace(/\{slate_title\}/g, match.slate_title || '')
          .replace(/\{view_count\}/g, match.view_count || '')
          .replace(/\{slate_count\}/g, match.slate_count || '')
          .replace(/\{published_count\}/g, match.published_count || '');

        // Create targeted notification for this user
        const notifResult = db.prepare(`
          INSERT INTO notifications (type, title, message, link, filter_user_ids)
          VALUES ('automated', ?, ?, ?, ?)
        `).run(title, message, auto.link || null, String(match.user_id));

        // Log that this automation fired
        db.prepare(`
          INSERT OR IGNORE INTO automation_log (automation_id, user_id, slate_id)
          VALUES (?, ?, ?)
        `).run(auto.id, match.user_id, match.slate_id || null);
      }
    }
  } catch (error) {
    console.error('Automation engine error:', error);
  }
}

// Fire signup automations for a new user (called from registration route)
function fireSignupAutomations(userId, username) {
  try {
    const automations = db.prepare(
      "SELECT * FROM notification_automations WHERE enabled = 1 AND event_type = 'on_signup'"
    ).all();

    for (const auto of automations) {
      // Check not already fired (shouldn't happen, but safety)
      const already = db.prepare(
        'SELECT 1 FROM automation_log WHERE automation_id = ? AND user_id = ?'
      ).get(auto.id, userId);
      if (already) continue;

      let title = auto.title.replace(/\{username\}/g, username);
      let message = auto.message.replace(/\{username\}/g, username);

      db.prepare(`
        INSERT INTO notifications (type, title, message, link, filter_user_ids)
        VALUES ('automated', ?, ?, ?, ?)
      `).run(title, message, auto.link || null, String(userId));

      db.prepare(`
        INSERT OR IGNORE INTO automation_log (automation_id, user_id, slate_id)
        VALUES (?, ?, NULL)
      `).run(auto.id, userId);
    }
  } catch (error) {
    console.error('Signup automation error:', error);
  }
}

// Run automations every hour
setInterval(runAutomations, 60 * 60 * 1000);
// Also run once on startup after a short delay
setTimeout(runAutomations, 10000);

// ============ FEEDBACK ROUTES ============

// Submit feedback (authenticated users only)
app.post('/api/feedback', authenticateToken, (req, res) => {
  const { message, contact_email } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    db.prepare(`
      INSERT INTO feedback (user_id, username, message, contact_email)
      VALUES (?, ?, ?, ?)
    `).run(req.user.id, req.user.username, message.trim(), contact_email || null);

    res.json({ success: true });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Admin: get all feedback
app.get('/api/admin/feedback', authenticateAdmin, (req, res) => {
  try {
    const feedback = db.prepare(`
      SELECT * FROM feedback ORDER BY created_at DESC
    `).all();
    res.json({ feedback });
  } catch (error) {
    console.error('Fetch feedback error:', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// Admin: delete feedback
app.delete('/api/admin/feedback/:id', authenticateAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete feedback error:', error);
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
});

// ============ INCIDENT / STATUS ROUTES ============

// Public: get status
app.get('/api/status', (req, res) => {
  try {
    const active = db.prepare(`SELECT * FROM incidents WHERE status != 'resolved' ORDER BY created_at DESC`).all();
    const resolved = db.prepare(`SELECT * FROM incidents WHERE status = 'resolved' ORDER BY resolved_at DESC LIMIT 20`).all();
    const allIds = [...active, ...resolved].map(i => i.id);
    let updates = [];
    if (allIds.length > 0) {
      updates = db.prepare(`SELECT * FROM incident_updates WHERE incident_id IN (${allIds.map(() => '?').join(',')}) ORDER BY created_at ASC`).all(...allIds);
    }
    const updatesByIncident = {};
    for (const u of updates) {
      if (!updatesByIncident[u.incident_id]) updatesByIncident[u.incident_id] = [];
      updatesByIncident[u.incident_id].push(u);
    }
    const attach = (list) => list.map(i => ({ ...i, updates: updatesByIncident[i.id] || [] }));
    res.json({ active: attach(active), resolved: attach(resolved) });
  } catch (error) {
    console.error('Fetch status error:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// Admin: create incident
app.post('/api/admin/incidents', authenticateAdmin, (req, res) => {
  try {
    const { title, severity, message } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'Title and message required' });
    const sev = ['minor', 'major', 'critical'].includes(severity) ? severity : 'minor';
    const result = db.prepare(`INSERT INTO incidents (title, severity, status) VALUES (?, ?, 'investigating')`).run(title, sev);
    db.prepare(`INSERT INTO incident_updates (incident_id, message, status) VALUES (?, ?, 'investigating')`).run(result.lastInsertRowid, message);
    const incident = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(result.lastInsertRowid);
    const updates = db.prepare(`SELECT * FROM incident_updates WHERE incident_id = ?`).all(result.lastInsertRowid);
    res.json({ incident: { ...incident, updates } });
  } catch (error) {
    console.error('Create incident error:', error);
    res.status(500).json({ error: 'Failed to create incident' });
  }
});

// Admin: update incident
app.patch('/api/admin/incidents/:id', authenticateAdmin, (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Status required' });
    const validStatuses = ['investigating', 'identified', 'monitoring', 'resolved'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const updates = { status, updated_at: new Date().toISOString() };
    if (status === 'resolved') updates.resolved_at = new Date().toISOString();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE incidents SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);
    const incident = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(req.params.id);
    res.json({ incident });
  } catch (error) {
    console.error('Update incident error:', error);
    res.status(500).json({ error: 'Failed to update incident' });
  }
});

// Admin: delete incident
app.delete('/api/admin/incidents/:id', authenticateAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM incident_updates WHERE incident_id = ?').run(req.params.id);
    db.prepare('DELETE FROM incidents WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete incident error:', error);
    res.status(500).json({ error: 'Failed to delete incident' });
  }
});

// Admin: add update to incident
app.post('/api/admin/incidents/:id/updates', authenticateAdmin, (req, res) => {
  try {
    const { message, status } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });
    const incident = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Incident not found' });
    const updateStatus = status || incident.status;
    db.prepare(`INSERT INTO incident_updates (incident_id, message, status) VALUES (?, ?, ?)`).run(req.params.id, message, updateStatus);
    if (status && status !== incident.status) {
      const changes = { status, updated_at: new Date().toISOString() };
      if (status === 'resolved') changes.resolved_at = new Date().toISOString();
      const setClauses = Object.keys(changes).map(k => `${k} = ?`).join(', ');
      db.prepare(`UPDATE incidents SET ${setClauses} WHERE id = ?`).run(...Object.values(changes), req.params.id);
    }
    const updated = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(req.params.id);
    const updates = db.prepare(`SELECT * FROM incident_updates WHERE incident_id = ? ORDER BY created_at ASC`).all(req.params.id);
    res.json({ incident: { ...updated, updates } });
  } catch (error) {
    console.error('Add incident update error:', error);
    res.status(500).json({ error: 'Failed to add update' });
  }
});

// ============ ACCOUNT ROUTES ============

// Change password
app.post('/api/account/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword, newWrappedKey: clientNewWrappedKey, newEncryptionSalt, newRecoveryWrappedKey, newRecoverySalt } = req.body;

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

    if (user.e2e_migrated && !clientNewWrappedKey) {
      // E2E user must provide client-wrapped key — server cannot re-wrap with matching iterations
      return res.status(400).json({ error: 'Client-side key re-wrap required. Please log out and log back in before changing your password.' });
    } else if (user.e2e_migrated && clientNewWrappedKey) {
      // E2E user: client re-wrapped the key, just store it
      const fields = ['password = ?', 'wrapped_key = ?'];
      const params = [hashedPassword, clientNewWrappedKey];
      if (newEncryptionSalt) {
        fields.push('encryption_salt = ?');
        params.push(newEncryptionSalt);
      }
      if (newRecoveryWrappedKey && newRecoverySalt) {
        fields.push('recovery_wrapped_key = ?', 'recovery_salt = ?', 'recovery_key_shown = 0');
        params.push(newRecoveryWrappedKey, newRecoverySalt);
      }
      params.push(req.user.id);
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    } else if (user.key_migrated && user.wrapped_key) {
      // Non-E2E migrated user: server re-wraps
      const salt = user.encryption_salt;
      const oldPasswordKey = deriveEncryptionKey(currentPassword, salt);
      const newPasswordKey = deriveEncryptionKey(newPassword, salt);

      try {
        const slateKey = unwrapKey(user.wrapped_key, oldPasswordKey);
        const newWrappedKey = wrapKey(slateKey, newPasswordKey);

        db.prepare('UPDATE users SET password = ?, wrapped_key = ? WHERE id = ?')
          .run(hashedPassword, newWrappedKey, req.user.id);

        cacheEncryptionKey(req.user.id, slateKey);
      } catch (err) {
        console.error('Key re-wrap failed during password change:', err);
        return res.status(500).json({ error: 'Failed to update encryption key' });
      }
    } else {
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.user.id);
    }

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Get wrapped key data for client-side PIN unlock
app.get('/api/account/wrapped-key', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT wrapped_key, encryption_salt, pin_wrapped_key, pin_salt, e2e_migrated FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.e2e_migrated) {
      return res.status(404).json({ error: 'No wrapped key found' });
    }
    // Prefer PIN-wrapped key (for Google/PIN unlock), fall back to wrapped_key
    const key = user.pin_wrapped_key || user.wrapped_key;
    const salt = user.pin_wrapped_key ? user.pin_salt : user.encryption_salt;
    if (!key || !salt) {
      return res.status(404).json({ error: 'No wrapped key found' });
    }
    res.json({ wrappedKey: key, encryptionSalt: salt });
  } catch (error) {
    console.error('Get wrapped key error:', error);
    res.status(500).json({ error: 'Failed to get key data' });
  }
});

// Acknowledge recovery key was shown
app.post('/api/account/acknowledge-recovery-key', authenticateToken, (req, res) => {
  try {
    db.prepare('UPDATE users SET recovery_key_shown = 1 WHERE id = ?').run(req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Acknowledge recovery key error:', error);
    res.status(500).json({ error: 'Failed to acknowledge recovery key' });
  }
});

// Finalize E2E migration — client sends re-wrapped keys after receiving migrationSlateKey
app.post('/api/account/finalize-e2e-migration', authenticateToken, (req, res) => {
  const { wrappedKey, encryptionSalt, recoveryWrappedKey, recoverySalt } = req.body;
  if (!wrappedKey || !encryptionSalt || !recoveryWrappedKey || !recoverySalt) {
    return res.status(400).json({ error: 'Wrapped key, encryption salt, recovery wrapped key, and recovery salt are required' });
  }
  try {
    const user = db.prepare('SELECT auth_provider FROM users WHERE id = ?').get(req.user.id);
    const isGoogleUser = user && (user.auth_provider === 'google' || user.auth_provider === 'both');
    if (isGoogleUser) {
      // Google users: PIN-wrapped key goes to pin_wrapped_key columns
      db.prepare(`
        UPDATE users SET pin_wrapped_key = ?, pin_salt = ?, recovery_wrapped_key = ?, recovery_salt = ?, recovery_key_shown = 0, e2e_migrated = 1
        WHERE id = ?
      `).run(wrappedKey, encryptionSalt, recoveryWrappedKey, recoverySalt, req.user.id);
    } else {
      db.prepare(`
        UPDATE users SET wrapped_key = ?, encryption_salt = ?, recovery_wrapped_key = ?, recovery_salt = ?, recovery_key_shown = 0, e2e_migrated = 1
        WHERE id = ?
      `).run(wrappedKey, encryptionSalt, recoveryWrappedKey, recoverySalt, req.user.id);
    }
    // Clear server-side cache — no longer needed for E2E users
    deleteCachedEncryptionKey(req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Finalize E2E migration error:', error);
    res.status(500).json({ error: 'Failed to finalize migration' });
  }
});

// Set password for Google-only users
app.post('/api/account/set-password', authenticateToken, async (req, res) => {
  const { password, wrappedKey, encryptionSalt, recoveryWrappedKey, recoverySalt } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!wrappedKey || !encryptionSalt || !recoveryWrappedKey || !recoverySalt) {
    return res.status(400).json({ error: 'Wrapped key data required' });
  }

  try {
    const user = db.prepare('SELECT auth_provider, username FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.auth_provider !== 'google') {
      return res.status(400).json({ error: 'Password already set' });
    }

    // Check username isn't taken by another user (Google usernames may conflict)
    const hashedPassword = await bcrypt.hash(password, 10);

    db.prepare(`
      UPDATE users SET password = ?, wrapped_key = ?, encryption_salt = ?, recovery_wrapped_key = ?, recovery_salt = ?,
        auth_provider = 'both', key_migrated = 1, recovery_key_shown = 0
      WHERE id = ?
    `).run(hashedPassword, wrappedKey, encryptionSalt, recoveryWrappedKey, recoverySalt, req.user.id);

    res.json({ success: true, username: user.username });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ error: 'Failed to set password' });
  }
});

// Regenerate recovery key
app.post('/api/account/regenerate-recovery-key', authenticateToken, async (req, res) => {
  const { password, newRecoveryWrappedKey: clientRecoveryWrappedKey, newRecoverySalt: clientRecoverySalt } = req.body;

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: 'Incorrect password' });

    if (!user.key_migrated || !user.wrapped_key) {
      return res.status(400).json({ error: 'Account encryption not yet migrated. Please log out and log back in first.' });
    }

    if (user.e2e_migrated && clientRecoveryWrappedKey && clientRecoverySalt) {
      // E2E user: client already wrapped the key, just store it
      db.prepare('UPDATE users SET recovery_wrapped_key = ?, recovery_salt = ?, recovery_key_shown = 1 WHERE id = ?')
        .run(clientRecoveryWrappedKey, clientRecoverySalt, user.id);
      return res.json({ success: true });
    }

    // Non-E2E: server generates recovery phrase and wraps
    const salt = user.encryption_salt;
    const passwordKey = deriveEncryptionKey(password, salt);
    const slateKey = unwrapKey(user.wrapped_key, passwordKey);

    const newRecoverySalt = crypto.randomBytes(32).toString('hex');
    const newRecoveryPhrase = generateRecoveryPhrase();
    const newRecoveryKey = deriveEncryptionKey(newRecoveryPhrase, newRecoverySalt);
    const newRecoveryWrappedKey = wrapKey(slateKey, newRecoveryKey);

    db.prepare('UPDATE users SET recovery_wrapped_key = ?, recovery_salt = ?, recovery_key_shown = 1 WHERE id = ?')
      .run(newRecoveryWrappedKey, newRecoverySalt, user.id);

    res.json({ recoveryPhrase: newRecoveryPhrase });
  } catch (error) {
    console.error('Regenerate recovery key error:', error);
    res.status(500).json({ error: 'Failed to regenerate recovery key' });
  }
});

// Get recovery key data for authenticated user (for PIN reset)
app.get('/api/account/recovery-data', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT recovery_wrapped_key, recovery_salt FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.recovery_wrapped_key || !user.recovery_salt) {
      return res.status(404).json({ error: 'No recovery key configured' });
    }
    res.json({ recoveryWrappedKey: user.recovery_wrapped_key, recoverySalt: user.recovery_salt });
  } catch (error) {
    console.error('Get recovery data error:', error);
    res.status(500).json({ error: 'Failed to get recovery data' });
  }
});

// Reset PIN using recovery key (for Google users who forgot their PIN)
app.post('/api/account/reset-pin', authenticateToken, async (req, res) => {
  const { newPinWrappedKey, newPinSalt, newRecoveryWrappedKey, newRecoverySalt } = req.body;

  if (!newPinWrappedKey || !newPinSalt || !newRecoveryWrappedKey || !newRecoverySalt) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.e2e_migrated) {
      return res.status(400).json({ error: 'Account is not E2E encrypted' });
    }

    if (user.auth_provider === 'local') {
      return res.status(400).json({ error: 'PIN reset is only for Google users' });
    }

    // Update PIN-wrapped key and recovery key
    if (user.pin_wrapped_key) {
      db.prepare(`
        UPDATE users SET pin_wrapped_key = ?, pin_salt = ?, recovery_wrapped_key = ?, recovery_salt = ?, recovery_key_shown = 0 WHERE id = ?
      `).run(newPinWrappedKey, newPinSalt, newRecoveryWrappedKey, newRecoverySalt, user.id);
    } else {
      // Fallback: user might have wrapped_key as PIN key (pre-migration)
      db.prepare(`
        UPDATE users SET wrapped_key = ?, encryption_salt = ?, recovery_wrapped_key = ?, recovery_salt = ?, recovery_key_shown = 0 WHERE id = ?
      `).run(newPinWrappedKey, newPinSalt, newRecoveryWrappedKey, newRecoverySalt, user.id);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Reset PIN error:', error);
    res.status(500).json({ error: 'Failed to reset PIN' });
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
    // Get user's IP tracking preference
    const user = db.prepare('SELECT track_ip_address FROM users WHERE id = ?').get(req.user.id);

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

    res.json({
      sessions,
      track_ip_address: user ? user.track_ip_address === 1 : true
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to get sessions' });
  }
});

// Toggle IP address tracking
app.post('/api/account/toggle-ip-tracking', authenticateToken, async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid value for enabled' });
    }

    // Update user preference
    db.prepare('UPDATE users SET track_ip_address = ? WHERE id = ?').run(enabled ? 1 : 0, req.user.id);

    // If disabling, clear IP addresses from existing sessions
    if (!enabled) {
      db.prepare('UPDATE sessions SET ip_address = NULL WHERE user_id = ?').run(req.user.id);
    }

    res.json({ success: true, track_ip_address: enabled });
  } catch (error) {
    console.error('Toggle IP tracking error:', error);
    res.status(500).json({ error: 'Failed to update IP tracking preference' });
  }
});

// Get user storage info
app.get('/api/account/storage', authenticateToken, async (req, res) => {
  try {
    const user = db.prepare('SELECT storage_used, storage_limit, supporter_tier, subscription_expires_at, supporter_badge_visible, grace_period_expires, grace_period_target_tier FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const storageUsedMB = (user.storage_used || 0) / 1024 / 1024;
    const storageLimitMB = (user.storage_limit || 25000000) / 1024 / 1024;
    const percentage = (storageUsedMB / storageLimitMB) * 100;

    // Check if in grace period
    const inGracePeriod = user.grace_period_expires && new Date(user.grace_period_expires) > new Date();
    const gracePeriodDaysRemaining = inGracePeriod
      ? Math.ceil((new Date(user.grace_period_expires) - new Date()) / (1000 * 60 * 60 * 24))
      : 0;

    res.json({
      storageUsedMB,
      storageLimitMB,
      percentage,
      supporterTier: user.supporter_tier,
      subscriptionExpiresAt: user.subscription_expires_at,
      supporterBadgeVisible: user.supporter_badge_visible === 1,
      gracePeriodExpires: user.grace_period_expires,
      gracePeriodTargetTier: user.grace_period_target_tier,
      inGracePeriod,
      gracePeriodDaysRemaining
    });
  } catch (error) {
    console.error('Get storage error:', error);
    res.status(500).json({ error: 'Failed to get storage info' });
  }
});

// Update supporter badge visibility
app.post('/api/account/update-badge-visibility', authenticateToken, async (req, res) => {
  try {
    const { visible } = req.body;

    if (typeof visible !== 'boolean') {
      return res.status(400).json({ error: 'Invalid visibility value' });
    }

    db.prepare('UPDATE users SET supporter_badge_visible = ? WHERE id = ?').run(visible ? 1 : 0, req.user.id);

    res.json({ message: 'Badge visibility updated successfully', visible });
  } catch (error) {
    console.error('Update badge visibility error:', error);
    res.status(500).json({ error: 'Failed to update badge visibility' });
  }
});

// Track user visit
app.post('/api/user/visit', authenticateToken, async (req, res) => {
  try {
    const user = db.prepare('SELECT visit_count, supporter_tier FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Increment visit count
    const newVisitCount = (user.visit_count || 0) + 1;
    db.prepare('UPDATE users SET visit_count = ? WHERE id = ?').run(newVisitCount, req.user.id);

    // Get slate count
    const slateCount = db.prepare('SELECT COUNT(*) as count FROM slates WHERE user_id = ?').get(req.user.id);

    res.json({
      visitCount: newVisitCount,
      slateCount: slateCount.count,
      supporterTier: user.supporter_tier
    });
  } catch (error) {
    console.error('Track visit error:', error);
    res.status(500).json({ error: 'Failed to track visit' });
  }
});

// Logout from a specific session
app.post('/api/account/logout-session', authenticateToken, async (req, res) => {
  try {
    const { token_hash } = req.body;

    if (!token_hash) {
      return res.status(400).json({ error: 'Session token hash required' });
    }

    // Delete the specific session (must belong to the user)
    const result = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash = ?')
      .run(req.user.id, token_hash);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ message: 'Session logged out successfully' });
  } catch (error) {
    console.error('Logout session error:', error);
    res.status(500).json({ error: 'Failed to logout session' });
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

// Claim the 24h export cooldown for heavy export operations (per account, across devices)
// Client should call this BEFORE fetching every slate for a full export.
const EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
app.post('/api/account/export-all/claim', authenticateToken, (req, res) => {
  try {
    const now = Date.now();
    const cooldownUntil = now + EXPORT_COOLDOWN_MS;

    // Atomic check+set: only one request can claim when not in cooldown.
    const result = db.prepare(`
      UPDATE users
      SET export_cooldown_until = ?
      WHERE id = ?
        AND (export_cooldown_until IS NULL OR export_cooldown_until <= ?)
    `).run(cooldownUntil, req.user.id, now);

    if (result.changes === 0) {
      const row = db.prepare('SELECT export_cooldown_until FROM users WHERE id = ?').get(req.user.id);
      const until = row?.export_cooldown_until || cooldownUntil;
      const retryAfterSeconds = Math.max(0, Math.ceil((until - now) / 1000));
      return res.status(429).json({
        error: 'Export cooldown active. Please try again later.',
        cooldownUntil: until,
        retryAfterSeconds
      });
    }

    res.json({ ok: true, cooldownUntil });
  } catch (error) {
    console.error('Export cooldown claim error:', error);
    res.status(500).json({ error: 'Failed to start export. Please try again.' });
  }
});

// Export all slates as ZIP (sent via email)
app.post('/api/account/export-slates', authenticateToken, async (req, res) => {
  try {
    // Per-account 24h cooldown (prevents repeated heavy exports / B2 downloads)
    const now = Date.now();
    const cooldownUntil = now + EXPORT_COOLDOWN_MS;
    const claim = db.prepare(`
      UPDATE users
      SET export_cooldown_until = ?
      WHERE id = ?
        AND (export_cooldown_until IS NULL OR export_cooldown_until <= ?)
    `).run(cooldownUntil, req.user.id, now);

    if (claim.changes === 0) {
      const row = db.prepare('SELECT export_cooldown_until FROM users WHERE id = ?').get(req.user.id);
      const until = row?.export_cooldown_until || cooldownUntil;
      const retryAfterSeconds = Math.max(0, Math.ceil((until - now) / 1000));
      return res.status(429).json({
        error: 'Export cooldown active. Please try again later.',
        cooldownUntil: until,
        retryAfterSeconds
      });
    }

    const user = db.prepare('SELECT username, email FROM users WHERE id = ?').get(req.user.id);

    if (!user.email) {
      return res.status(400).json({ error: 'Email required for export. Please add an email to your account first.' });
    }

    // Get all slates for the user
    const slates = db.prepare(`
      SELECT id, title, b2_file_id, created_at, updated_at
      FROM slates
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `).all(req.user.id);

    if (slates.length === 0) {
      return res.status(400).json({ error: 'No slates to export' });
    }

    // Start export in background (don't make user wait)
    res.json({ message: `Exporting ${slates.length} slate(s). You'll receive an email at ${user.email} with the download link shortly.` });

    // Background processing
    (async () => {
      try {
        const archiver = require('archiver');
        const stream = require('stream');

        // Create ZIP in memory
        const buffers = [];
        const bufferStream = new stream.PassThrough();
        bufferStream.on('data', (chunk) => buffers.push(chunk));

        const archive = archiver('zip', {
          zlib: { level: 9 } // Maximum compression
        });

        archive.pipe(bufferStream);

        // Get encryption key for this user
        let encryptionKey = getCachedEncryptionKey(req.user.id);

        // Add each slate to the ZIP
        for (const slate of slates) {
          try {
            // Download and decrypt slate content
            let content;
            if (encryptionKey) {
              content = await b2Storage.getSlate(slate.b2_file_id, encryptionKey);
            } else {
              // If no cached key, try to decrypt with stored data (for Google users)
              const userWithKey = db.prepare('SELECT encrypted_encryption_key FROM users WHERE id = ?').get(req.user.id);
              if (userWithKey && userWithKey.encrypted_encryption_key) {
                encryptionKey = decryptEncryptionKey(userWithKey.encrypted_encryption_key);
                content = await b2Storage.getSlate(slate.b2_file_id, encryptionKey);
              } else {
                console.error(`No encryption key for user ${req.user.id}, slate ${slate.id}`);
                continue; // Skip this slate
              }
            }

            // Sanitize filename (remove invalid characters)
            const sanitizedTitle = (slate.title || `slate-${slate.id}`)
              .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
              .substring(0, 200); // Limit length

            const filename = `${sanitizedTitle}.txt`;

            // Add metadata header to file
            const fileContent = `Title: ${slate.title || 'Untitled'}\nCreated: ${new Date(slate.created_at).toLocaleString()}\nLast Updated: ${new Date(slate.updated_at).toLocaleString()}\n\n${content}`;

            archive.append(fileContent, { name: filename });
          } catch (err) {
            console.error(`Failed to export slate ${slate.id}:`, err);
            // Continue with other slates
          }
        }

        await archive.finalize();

        // Wait for all buffers to be written
        await new Promise((resolve) => bufferStream.on('end', resolve));

        const zipBuffer = Buffer.concat(buffers);
        const zipBase64 = zipBuffer.toString('base64');

        // Send email with ZIP attachment
        await emailService.sendEmail({
          to: user.email,
          subject: 'your justtype slates export',
          text: `hi ${user.username},\n\nattached is a ZIP file containing all ${slates.length} of your slates as text files.\n\neach slate includes its title, creation date, and last updated date at the top of the file.\n\nthanks for using justtype!\n\n- justtype`,
          attachments: [{
            filename: `justtype-export-${new Date().toISOString().split('T')[0]}.zip`,
            content: zipBase64,
            encoding: 'base64',
            type: 'application/zip'
          }]
        });

        console.log(`✓ Exported ${slates.length} slates for user #${req.user.id}`);
      } catch (err) {
        console.error('Export processing error:', err);
        // Try to send error email
        try {
          await emailService.sendEmail({
            to: user.email,
            subject: 'export failed - justtype',
            text: `hi ${user.username},\n\nsorry, we encountered an error while exporting your slates. please try again later or contact support.\n\nerror: ${err.message}\n\n- justtype`
          });
        } catch (emailErr) {
          console.error('Failed to send error email:', emailErr);
        }
      }
    })();
  } catch (error) {
    console.error('Export slates error:', error);
    res.status(500).json({ error: 'Failed to start export. Please try again.' });
  }
});

// Delete account
app.delete('/api/account/delete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's slates to delete from B2
    const slates = db.prepare('SELECT b2_file_id, b2_public_file_id FROM slates WHERE user_id = ?').all(userId);

    // Delete slates from B2
    for (const slate of slates) {
      const fileIdsToDelete = new Set();
      if (slate.b2_file_id) fileIdsToDelete.add(slate.b2_file_id);
      if (slate.b2_public_file_id) fileIdsToDelete.add(slate.b2_public_file_id);

      for (const fileId of fileIdsToDelete) {
        try {
          await b2Storage.deleteSlate(fileId);
        } catch (err) {
          console.error(`Failed to delete B2 file ${fileId}:`, err);
        }
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

// =========================
// STRIPE DONATION ENDPOINTS
// =========================

// Create Stripe checkout session
app.post('/api/stripe/create-checkout', async (req, res) => {
  if (!stripe || !stripePriceIds) {
    return res.status(503).json({ error: 'Payment system not configured' });
  }

  const { tier, amount, email } = req.body; // 'one_time' or 'quarterly', amount in EUR (optional, for one_time), email (required if not authenticated)

  if (!tier || !['one_time', 'quarterly'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier' });
  }

  // Check authentication
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  let user = null;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      user = db.prepare('SELECT id, email, username FROM users WHERE id = ?').get(decoded.id);
    } catch (err) {
      // Invalid token, treat as unauthenticated
    }
  }

  // Subscriptions require authentication
  if (tier === 'quarterly' && !user) {
    return res.status(401).json({ error: 'Authentication required for subscriptions' });
  }

  // For one-time, validate custom amount
  if (tier === 'one_time') {
    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum < 1) {
      return res.status(400).json({ error: 'Amount must be at least 1 EUR' });
    }

    // If not authenticated, require email
    if (!user && !email) {
      return res.status(400).json({ error: 'Email required for donations without account' });
    }
  }

  try {
    let sessionConfig = {
      customer_email: user ? user.email : email,
      success_url: `${process.env.PUBLIC_URL || 'https://justtype.io'}/?payment=success`,
      cancel_url: `${process.env.PUBLIC_URL || 'https://justtype.io'}/?payment=cancelled`,
      metadata: {
        tier: tier
      }
    };

    // Add user info to metadata if authenticated
    if (user) {
      sessionConfig.metadata.userId = user.id.toString();
      sessionConfig.metadata.username = user.username;
    }

    if (tier === 'one_time') {
      // Custom amount for one-time donation
      const amountInCents = Math.round(parseFloat(amount) * 100);
      sessionConfig.mode = 'payment';
      sessionConfig.line_items = [
        {
          price_data: {
            currency: 'eur',
            product: stripePriceIds.oneTimeProductId,
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ];
    } else {
      // Fixed price for quarterly subscription
      sessionConfig.mode = 'subscription';
      sessionConfig.line_items = [
        {
          price: stripePriceIds.quarterlyPriceId,
          quantity: 1,
        },
      ];
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    res.json({ url: session.url });
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Create Stripe customer portal session
app.post('/api/stripe/create-portal-session', authenticateToken, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Payment system not configured' });
  }

  try {
    const user = db.prepare('SELECT stripe_customer_id, supporter_tier FROM users WHERE id = ?').get(req.user.id);

    if (!user || !user.stripe_customer_id) {
      return res.status(400).json({ error: 'no subscription found. complete a purchase first to manage your subscription.' });
    }

    // Create portal session (works for both test and live mode)
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: `${process.env.PUBLIC_URL || 'https://justtype.io'}/account`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Create portal session error:', error);

    // More helpful error message for portal not configured
    if (error.code === 'account_invalid' || error.message?.includes('portal')) {
      return res.status(400).json({ error: 'customer portal not configured. activate it in stripe dashboard: settings → customer portal' });
    }

    res.status(500).json({ error: 'failed to create portal session. please try again or contact support.' });
  }
});
// Test endpoint to manually upgrade user (for Stripe test mode without webhooks)
app.post('/api/stripe/test-upgrade', authenticateToken, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  const { tier } = req.body;

  if (!tier || !['one_time', 'quarterly'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier' });
  }

  try {
    // IMPORTANT: Prevent overwriting real Stripe customer IDs
    const user = db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?').get(req.user.id);
    if (user && user.stripe_customer_id && !user.stripe_customer_id.startsWith('test_cus_')) {
      return res.status(400).json({
        error: 'Cannot use test upgrade - you have a real Stripe subscription. Use the Stripe portal to manage it.'
      });
    }

    const now = new Date().toISOString();

    if (tier === 'one_time') {
      db.prepare(`
        UPDATE users
        SET supporter_tier = 'one_time',
            storage_limit = 50000000,
            donated_at = ?,
            stripe_customer_id = ?
        WHERE id = ?
      `).run(now, `test_cus_${req.user.id}`, req.user.id);
      console.log(`✓ User ${req.user.id} upgraded to one-time supporter (TEST)`);
    } else if (tier === 'quarterly') {
      db.prepare(`
        UPDATE users
        SET supporter_tier = 'quarterly',
            storage_limit = 999999999999,
            donated_at = ?,
            stripe_customer_id = ?,
            stripe_subscription_id = ?
        WHERE id = ?
      `).run(now, `test_cus_${req.user.id}`, `test_sub_${req.user.id}`, req.user.id);
      console.log(`✓ User ${req.user.id} upgraded to quarterly supporter (TEST)`);
    }

    res.json({ success: true, message: 'User upgraded successfully (TEST MODE)' });
  } catch (error) {
    console.error('Test upgrade error:', error);
    res.status(500).json({ error: 'Failed to upgrade user' });
  }
});

// Generate linking token for Google account linking
app.post('/api/account/generate-link-token', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT auth_provider, email FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Only allow linking if user has password auth (local)
    if (user.auth_provider === 'google') {
      return res.status(400).json({ error: 'Cannot link Google to Google-only account' });
    }

    if (user.auth_provider === 'both') {
      return res.status(400).json({ error: 'Google account is already linked' });
    }

    // Create a temporary linking token valid for 5 minutes
    const linkingToken = jwt.sign({ userId: req.user.id, email: user.email, purpose: 'link_google' }, JWT_SECRET, { expiresIn: '5m' });

    res.json({ linkingToken });
  } catch (error) {
    console.error('Generate link token error:', error);
    res.status(500).json({ error: 'Failed to generate linking token' });
  }
});

// Request unlink Google account (send verification code)
app.post('/api/account/request-unlink-google', authenticateToken, async (req, res) => {
  try {
    const user = db.prepare('SELECT auth_provider, email, password FROM users WHERE id = ?').get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has Google auth linked
    if (user.auth_provider !== 'google' && user.auth_provider !== 'both') {
      return res.status(400).json({ error: 'Google account is not linked' });
    }

    // Ensure user has password auth before unlinking Google
    if (user.auth_provider === 'google') {
      return res.status(400).json({ error: 'Cannot unlink Google without setting up password authentication first' });
    }

    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Store verification code
    db.prepare('UPDATE users SET unlink_google_code = ?, unlink_google_code_expires = ? WHERE id = ?')
      .run(verificationCode, expiresAt, req.user.id);

    // Send verification email
    const { strings } = require('./strings.cjs');
    await emailService.sendEmail({
      to: user.email,
      subject: strings.email.unlinkGoogle.subject,
      text: strings.email.unlinkGoogle.body(verificationCode)
    });

    res.json({ message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Request unlink Google error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// Verify and unlink Google account
app.post('/api/account/unlink-google', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || code.length !== 6) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    const user = db.prepare('SELECT auth_provider, unlink_google_code, unlink_google_code_expires FROM users WHERE id = ?')
      .get(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if code exists and hasn't expired
    if (!user.unlink_google_code || !user.unlink_google_code_expires) {
      return res.status(400).json({ error: 'No unlink request found. Please request a new code.' });
    }

    if (new Date(user.unlink_google_code_expires) < new Date()) {
      return res.status(400).json({ error: 'Verification code expired. Please request a new code.' });
    }

    if (user.unlink_google_code !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Unlink Google account
    db.prepare(`
      UPDATE users
      SET google_id = NULL,
          auth_provider = 'local',
          unlink_google_code = NULL,
          unlink_google_code_expires = NULL
      WHERE id = ?
    `).run(req.user.id);

    res.json({ message: 'Google account unlinked successfully' });
  } catch (error) {
    console.error('Unlink Google error:', error);
    res.status(500).json({ error: 'Failed to unlink Google account' });
  }
});

// Server-side rendering for published slates (for proper OpenGraph meta tags)
app.get('/s/:shareId', async (req, res) => {
  try {
    // Fetch slate data
    const slate = db.prepare(`
      SELECT slates.*, users.username, users.is_system_user
      FROM slates
      JOIN users ON slates.user_id = users.id
      WHERE slates.share_id = ? AND slates.is_published = 1
    `).get(req.params.shareId);

    // If slate not found, serve regular index.html (React will show error)
    if (!slate) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
    }

    // HTML escape helper
    const escapeHtml = (text) => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    // Prepare meta tag values
    const maxOgTitleLength = 70;
    const ogTitle = slate.title.length > maxOgTitleLength
      ? `${slate.title.substring(0, maxOgTitleLength)}...`
      : slate.title;
    // Display "alfaoz" for system users
    const displayUsername = slate.is_system_user ? 'alfaoz' : slate.username;
    const description = `slate by ${displayUsername}`;
    const pageTitle = description; // Use "slate by [user]" as page title
    const url = `${process.env.PUBLIC_URL}/s/${slate.share_id}`;

    // Escape all values for HTML
    const escapedPageTitle = escapeHtml(pageTitle);
    const escapedOgTitle = escapeHtml(ogTitle);
    const escapedDescription = escapeHtml(description);

    // Read the built index.html
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    const fs = require('fs');
    let html = fs.readFileSync(indexPath, 'utf8');

    // Inject meta tags (replace the default ones)
    html = html.replace(
      '<title>just type</title>',
      `<title>${escapedPageTitle}</title>`
    );
    html = html.replace(
      '<meta name="description" content="need to jot something down real quick? just start typing." />',
      `<meta name="description" content="${escapedDescription}" />`
    );

    // Add OpenGraph and Twitter meta tags after the description tag
    const additionalMetaTags = `
    <meta property="og:title" content="${escapedOgTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${url}" />
    <meta property="og:site_name" content="just type" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapedOgTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />`;

    html = html.replace(
      '</head>',
      `${additionalMetaTags}\n  </head>`
    );

    // Set cache headers to prevent caching entirely
    // This ensures users always get fresh HTML with correct JS/CSS hashes
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(html);
  } catch (error) {
    console.error('Error rendering slate page:', error);
    // Fallback to regular index.html
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
});

// Helper to serve index.html with no-cache headers
const serveIndexHtml = (res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
};

// Serve index.html for all non-API routes (SPA routing)
app.get('*', (req, res) => {
  serveIndexHtml(res);
});

// ============ PERIODIC CLEANUP ============

const runCleanup = async () => {
  try {
    // Clean up expired verification codes
    const expiredCodes = db.prepare(`
      UPDATE users
      SET verification_token = NULL, verification_code_expires = NULL
      WHERE verification_code_expires IS NOT NULL
      AND datetime(verification_code_expires) < datetime('now')
    `).run();

    // Clean up old sessions (older than 30 days)
    const oldSessions = db.prepare('DELETE FROM sessions WHERE datetime(last_activity) < datetime(\'now\', \'-30 days\')').run();

    if (expiredCodes.changes > 0 || oldSessions.changes > 0) {
      console.log(`✓ Cleanup: Removed ${expiredCodes.changes} expired codes and ${oldSessions.changes} old sessions`);
    }

    // Handle expired grace periods - delete latest slates until storage is below limit
    const usersWithExpiredGrace = db.prepare(`
      SELECT id, username, storage_used, storage_limit, grace_period_target_tier
      FROM users
      WHERE grace_period_expires IS NOT NULL
      AND datetime(grace_period_expires) < datetime('now')
    `).all();

    for (const user of usersWithExpiredGrace) {
      if (user.storage_used > user.storage_limit) {
        console.log(`⚠️  Grace period expired for user ${user.username} (${user.id}). Deleting latest slates...`);

        let currentStorage = user.storage_used;
        let deletedCount = 0;

        // Get user's slates ordered by created_at DESC (latest first)
        const userSlates = db.prepare(`
          SELECT id, title, size_bytes, b2_file_id, b2_public_file_id, is_published
          FROM slates
          WHERE user_id = ?
          ORDER BY created_at DESC
        `).all(user.id);

        // Delete latest slates until below limit
        for (const slate of userSlates) {
          if (currentStorage <= user.storage_limit) {
            break; // Storage is now below limit
          }

          try {
            // Delete from B2
            if (slate.b2_file_id) {
              await b2Storage.deleteSlate(slate.b2_file_id);
            }
            if (slate.b2_public_file_id && slate.is_published === 1) {
              await b2Storage.deleteSlate(slate.b2_public_file_id);
            }

            // Delete from database
            db.prepare('DELETE FROM slates WHERE id = ?').run(slate.id);

            currentStorage -= slate.size_bytes;
            deletedCount++;
            console.log(`  Deleted slate "${slate.title}" (${slate.size_bytes} bytes)`);
          } catch (err) {
            console.error(`  Failed to delete slate ${slate.id}:`, err);
          }
        }

        // Update user's storage and clear grace period
        db.prepare(`
          UPDATE users
          SET storage_used = ?,
              grace_period_expires = NULL,
              grace_period_target_tier = NULL
          WHERE id = ?
        `).run(currentStorage, user.id);

        console.log(`✓ User ${user.username}: Deleted ${deletedCount} slates, storage now ${(currentStorage / 1024 / 1024).toFixed(2)} MB`);
      } else {
        // User is already below limit, just clear grace period
        db.prepare(`
          UPDATE users
          SET grace_period_expires = NULL,
              grace_period_target_tier = NULL
          WHERE id = ?
        `).run(user.id);
        console.log(`✓ User ${user.username}: Already below limit, grace period cleared`);
      }
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

    // Initialize Stripe products
    if (stripeModule) {
      stripePriceIds = await stripeModule.ensureStripeProducts();
      if (stripePriceIds) {
        console.log('✓ Stripe products initialized');
      }
    }

    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
})();
