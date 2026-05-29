// OAuth 2.0 provider for third-party "sign in with justtype".
//
// Flow: authorization code + PKCE (RFC 7636). Public clients (web/SPA/native)
// need no secret; confidential clients may set one. Access tokens are scoped,
// short-lived JWTs that are deliberately ISOLATED from regular session tokens:
// they are never written to the `sessions` table, so authenticateToken-guarded
// routes reject them outright. An OAuth token can only reach the dedicated
// /api/oauth/* resource endpoints below, gated by scope.
//
// Zero-knowledge note: private slates are end-to-end encrypted. The
// slates:read:private scope returns the stored ciphertext + metadata only.
// The server never brokers plaintext or encryption keys to third parties.

const express = require('express');
const cors = require('cors');

// Scopes offered to third-party apps, with human descriptions for the consent screen.
const SCOPES = {
  'identity': 'confirm who you are (your justtype username)',
  'email': 'see your verified email address',
  'slates:read:public': 'read your published slates (title and full text)',
  'slates:read:meta': 'see your slate list, counts, and dates (private titles stay encrypted)',
  'slates:read:private': 'download your private slates (delivered encrypted — readable only with your key)'
};

const ACCESS_TTL = 3600;            // 1 hour
const REFRESH_TTL = 90 * 24 * 3600; // 90 days
const CODE_TTL = 60;                // 1 minute
const CONSENT_TTL = 600;            // 10 minutes

function mountOAuth(app, deps) {
  const { db, jwt, JWT_SECRET, crypto, b2Storage, isProduction } = deps;

  const now = () => Math.floor(Date.now() / 1000);
  const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const base64url = (buf) =>
    buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
  const escapeHtml = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // Permissive CORS for public OAuth endpoints so browser-based SPA clients work.
  // OAuth uses the Authorization header (not cookies), so reflecting the origin
  // without credentials is safe here.
  const publicCors = cors({ origin: true, credentials: false });
  const form = express.urlencoded({ extended: false });

  // --- helpers ------------------------------------------------------------

  // Resolve the logged-in justtype user from the session cookie, or null.
  // Mirrors authenticateToken but never responds; rejects OAuth tokens.
  const getSessionUser = (req) => {
    const token = req.cookies?.justtype_token;
    if (!token) return null;
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload.oauth) return null; // an OAuth token is not a session
      const hash = sha256(token);
      const session = db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(hash);
      if (!session) return null;
      return { id: payload.id, username: payload.username };
    } catch {
      return null;
    }
  };

  const getClient = (clientId) => {
    if (!clientId) return null;
    const row = db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(clientId);
    if (!row) return null;
    return {
      ...row,
      redirect_uris: JSON.parse(row.redirect_uris || '[]'),
      allowed_scopes: (row.allowed_scopes || '').split(' ').filter(Boolean)
    };
  };

  const validRedirectUri = (uri) => {
    try {
      const u = new URL(uri);
      if (u.protocol === 'https:') return true;
      // Allow http only for loopback (native/dev clients).
      if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return true;
      return false;
    } catch {
      return false;
    }
  };

  // Best-effort cleanup of expired codes (cheap, runs on token/authorize hits).
  const sweepExpiredCodes = () => {
    try { db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(now()); } catch {}
  };

  const renderPage = (title, bodyHtml) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #fff;
           min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; }
    .card { width: 100%; max-width: 420px; background: #111; border: 1px solid #222;
            border-radius: 12px; padding: 2rem; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .sub { color: #888; font-size: 0.9rem; margin-bottom: 1.5rem; line-height: 1.5; }
    .app { font-weight: 600; color: #fff; }
    ul.scopes { list-style: none; margin: 1.25rem 0; }
    ul.scopes li { display: flex; gap: 0.6rem; padding: 0.6rem 0; border-top: 1px solid #1c1c1c;
                   color: #ccc; font-size: 0.9rem; line-height: 1.4; }
    ul.scopes li:last-child { border-bottom: 1px solid #1c1c1c; }
    .check { color: #4ade80; flex-shrink: 0; }
    .note { background: #161616; border: 1px solid #262626; border-radius: 8px; padding: 0.75rem;
            color: #9a9a9a; font-size: 0.8rem; margin: 1rem 0; line-height: 1.5; }
    form { display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.5rem; }
    input { background: #1a1a1a; border: 1px solid #333; color: #fff; padding: 0.7rem 0.9rem;
            border-radius: 8px; font-size: 0.95rem; }
    input:focus { outline: none; border-color: #555; }
    .row { display: flex; gap: 0.75rem; }
    button { flex: 1; padding: 0.7rem 1rem; border-radius: 8px; font-size: 0.95rem; cursor: pointer;
             border: none; font-weight: 500; }
    .primary { background: #fff; color: #000; }
    .primary:hover { background: #eee; }
    .ghost { background: transparent; color: #aaa; border: 1px solid #333; }
    .ghost:hover { color: #fff; border-color: #555; }
    .who { color: #666; font-size: 0.8rem; margin-top: 1rem; text-align: center; }
    .error { color: #f87171; font-size: 0.85rem; margin-top: 0.75rem; display: none; }
    a { color: #888; }
  </style>
</head>
<body><div class="card">${bodyHtml}</div></body>
</html>`;

  const loginPageBody = (clientName) => `
    <h1>sign in to justtype</h1>
    <p class="sub"><span class="app">${escapeHtml(clientName)}</span> wants to connect to your justtype account. log in to continue.</p>
    <form id="loginForm">
      <input type="text" name="username" placeholder="username or email" required autocomplete="username">
      <input type="password" name="password" placeholder="password" required autocomplete="current-password">
      <button type="submit" class="primary">log in</button>
    </form>
    <div class="error" id="error"></div>
    <script>
      document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target, err = document.getElementById('error');
        try {
          const r = await fetch('/api/auth/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username: f.username.value, password: f.password.value })
          });
          const data = await r.json();
          if (r.ok && !data.requiresVerification) { window.location.reload(); }
          else { err.textContent = data.requiresVerification ? 'please verify your email first' : (data.error || 'login failed'); err.style.display = 'block'; }
        } catch { err.textContent = 'connection error'; err.style.display = 'block'; }
      });
    </script>`;

  const consentPageBody = (user, client, scopeList, ticket) => {
    const items = scopeList.map(s =>
      `<li><span class="check">✓</span><span>${escapeHtml(SCOPES[s])}</span></li>`).join('');
    const site = client.website
      ? `<div class="sub" style="margin-top:-1rem"><a href="${escapeHtml(client.website)}" target="_blank" rel="noopener">${escapeHtml(client.website)}</a></div>` : '';
    const privacyNote = scopeList.includes('slates:read:private')
      ? `<div class="note">heads up: your private slates are end-to-end encrypted. this app will receive them <strong>still encrypted</strong> — it can only read them if you separately give it your key. justtype never hands over your password or decryption key.</div>` : '';
    return `
      <h1>authorize ${escapeHtml(client.name)}</h1>
      <p class="sub"><span class="app">${escapeHtml(client.name)}</span> wants permission to:</p>
      ${site}
      <ul class="scopes">${items}</ul>
      ${privacyNote}
      <form method="POST" action="/oauth/authorize/decide">
        <input type="hidden" name="ticket" value="${escapeHtml(ticket)}">
        <div class="row">
          <button type="submit" name="decision" value="deny" class="ghost">cancel</button>
          <button type="submit" name="decision" value="approve" class="primary">authorize</button>
        </div>
      </form>
      <div class="who">signed in as @${escapeHtml(user.username)}</div>`;
  };

  // --- client registration (self-serve, requires a logged-in user) --------

  app.post('/api/oauth/clients', deps.authenticateToken, (req, res) => {
    const { name, website, redirect_uris, scopes, confidential } = req.body || {};
    if (!name || typeof name !== 'string' || name.length > 80) {
      return res.status(400).json({ error: 'A valid app name is required (max 80 chars).' });
    }
    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0 || redirect_uris.length > 10) {
      return res.status(400).json({ error: 'Provide 1-10 redirect URIs.' });
    }
    for (const uri of redirect_uris) {
      if (typeof uri !== 'string' || !validRedirectUri(uri)) {
        return res.status(400).json({ error: `Invalid redirect URI: ${uri}. Must be https (or http://localhost).` });
      }
    }
    const requested = Array.isArray(scopes) && scopes.length ? scopes : ['identity'];
    for (const s of requested) {
      if (!SCOPES[s]) return res.status(400).json({ error: `Unknown scope: ${s}` });
    }
    if (website && (typeof website !== 'string' || website.length > 200)) {
      return res.status(400).json({ error: 'Invalid website URL.' });
    }

    const clientId = 'jt_' + randomToken(16);
    const isConfidential = !!confidential;
    let clientSecret = null, secretHash = null;
    if (isConfidential) {
      clientSecret = randomToken(32);
      secretHash = sha256(clientSecret);
    }

    db.prepare(`INSERT INTO oauth_clients
      (client_id, client_secret_hash, name, website, redirect_uris, allowed_scopes, is_confidential, owner_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      clientId, secretHash, name, website || null,
      JSON.stringify(redirect_uris), requested.join(' '),
      isConfidential ? 1 : 0, req.user.id
    );

    res.json({
      client_id: clientId,
      client_secret: clientSecret, // shown ONCE; not retrievable later
      name, website: website || null,
      redirect_uris, scopes: requested,
      is_confidential: isConfidential
    });
  });

  app.get('/api/oauth/clients', deps.authenticateToken, (req, res) => {
    const rows = db.prepare(
      'SELECT client_id, name, website, redirect_uris, allowed_scopes, is_confidential, created_at FROM oauth_clients WHERE owner_user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);
    res.json(rows.map(r => ({
      client_id: r.client_id, name: r.name, website: r.website,
      redirect_uris: JSON.parse(r.redirect_uris || '[]'),
      scopes: (r.allowed_scopes || '').split(' ').filter(Boolean),
      is_confidential: !!r.is_confidential, created_at: r.created_at
    })));
  });

  app.delete('/api/oauth/clients/:clientId', deps.authenticateToken, (req, res) => {
    const client = db.prepare('SELECT id FROM oauth_clients WHERE client_id = ? AND owner_user_id = ?')
      .get(req.params.clientId, req.user.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    db.prepare('DELETE FROM oauth_tokens WHERE client_id = ?').run(req.params.clientId);
    db.prepare('DELETE FROM oauth_codes WHERE client_id = ?').run(req.params.clientId);
    db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run(req.params.clientId);
    res.json({ success: true });
  });

  // --- authorization endpoint --------------------------------------------

  app.get('/oauth/authorize', (req, res) => {
    sweepExpiredCodes();
    const { response_type, client_id, redirect_uri, scope, state,
            code_challenge, code_challenge_method } = req.query;

    const client = getClient(client_id);
    // Errors we CANNOT safely redirect (untrusted client/redirect) -> render page.
    if (!client) {
      return res.status(400).send(renderPage('invalid client',
        '<h1>invalid client</h1><p class="sub">this application is not registered with justtype.</p>'));
    }
    if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) {
      return res.status(400).send(renderPage('invalid redirect',
        '<h1>invalid redirect</h1><p class="sub">the redirect uri does not match this application\'s registration.</p>'));
    }

    const redirectError = (err, desc) => {
      const u = new URL(redirect_uri);
      u.searchParams.set('error', err);
      if (desc) u.searchParams.set('error_description', desc);
      if (state) u.searchParams.set('state', state);
      return res.redirect(u.toString());
    };

    if (response_type !== 'code') return redirectError('unsupported_response_type', 'only response_type=code is supported');
    if (!code_challenge) return redirectError('invalid_request', 'code_challenge is required (PKCE)');
    if (code_challenge_method && code_challenge_method !== 'S256') {
      return redirectError('invalid_request', 'code_challenge_method must be S256');
    }

    const requested = (scope || 'identity').split(/[\s+]+/).filter(Boolean);
    for (const s of requested) {
      if (!SCOPES[s]) return redirectError('invalid_scope', `unknown scope: ${s}`);
      if (!client.allowed_scopes.includes(s)) return redirectError('invalid_scope', `scope not allowed for this client: ${s}`);
    }

    const user = getSessionUser(req);
    if (!user) {
      return res.send(renderPage('sign in to justtype', loginPageBody(client.name)));
    }

    // Signed, short-lived consent ticket binds this approval to the user + request.
    const ticket = jwt.sign({
      purpose: 'oauth_consent', uid: user.id, client_id,
      redirect_uri, scope: requested.join(' '), state: state || '',
      code_challenge, code_challenge_method: 'S256'
    }, JWT_SECRET, { expiresIn: CONSENT_TTL });

    res.send(renderPage(`authorize ${client.name}`, consentPageBody(user, client, requested, ticket)));
  });

  app.post('/oauth/authorize/decide', form, (req, res) => {
    const { ticket, decision } = req.body || {};
    if (!ticket) return res.status(400).send('Missing ticket');

    let t;
    try {
      t = jwt.verify(ticket, JWT_SECRET);
      if (t.purpose !== 'oauth_consent') throw new Error('bad purpose');
    } catch {
      return res.status(400).send(renderPage('expired',
        '<h1>request expired</h1><p class="sub">this authorization request expired. please start again from the app.</p>'));
    }

    const user = getSessionUser(req);
    if (!user || user.id !== t.uid) {
      return res.status(401).send(renderPage('sign in',
        '<h1>session expired</h1><p class="sub">please return to the app and try again.</p>'));
    }

    const u = new URL(t.redirect_uri);
    if (t.state) u.searchParams.set('state', t.state);

    if (decision !== 'approve') {
      u.searchParams.set('error', 'access_denied');
      return res.redirect(u.toString());
    }

    const code = randomToken(32);
    db.prepare(`INSERT INTO oauth_codes
      (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      code, t.client_id, user.id, t.redirect_uri, t.scope,
      t.code_challenge, t.code_challenge_method, now() + CODE_TTL
    );

    u.searchParams.set('code', code);
    res.redirect(u.toString());
  });

  // --- token endpoint -----------------------------------------------------

  const verifyClientSecret = (client, providedSecret) => {
    if (!client.is_confidential) return true; // public client, PKCE only
    if (!providedSecret) return false;
    return client.client_secret_hash === sha256(providedSecret);
  };

  const issueTokens = (clientId, userId, scope) => {
    const username = db.prepare('SELECT username FROM users WHERE id = ?').get(userId)?.username;
    const accessToken = jwt.sign(
      { sub: userId, username, client_id: clientId, scope, oauth: true, type: 'access', jti: randomToken(8) },
      JWT_SECRET, { expiresIn: ACCESS_TTL }
    );
    const refreshToken = randomToken(48);
    return { accessToken, refreshToken, username };
  };

  app.post('/oauth/token', publicCors, form, express.json(), (req, res) => {
    sweepExpiredCodes();
    const body = req.body || {};
    const grantType = body.grant_type;

    if (grantType === 'authorization_code') {
      const { code, code_verifier, client_id, redirect_uri, client_secret } = body;
      if (!code || !code_verifier || !client_id || !redirect_uri) {
        return res.status(400).json({ error: 'invalid_request', error_description: 'missing required parameters' });
      }
      const client = getClient(client_id);
      if (!client) return res.status(401).json({ error: 'invalid_client' });
      if (!verifyClientSecret(client, client_secret)) return res.status(401).json({ error: 'invalid_client' });

      const record = db.prepare('SELECT * FROM oauth_codes WHERE code = ?').get(code);
      if (!record) return res.status(400).json({ error: 'invalid_grant', error_description: 'code not found' });
      // One-time use: consume immediately.
      db.prepare('DELETE FROM oauth_codes WHERE code = ?').run(code);
      if (record.expires_at < now()) return res.status(400).json({ error: 'invalid_grant', error_description: 'code expired' });
      if (record.client_id !== client_id) return res.status(400).json({ error: 'invalid_grant', error_description: 'client mismatch' });
      if (record.redirect_uri !== redirect_uri) return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });

      // PKCE verification (S256).
      const expected = base64url(crypto.createHash('sha256').update(code_verifier).digest());
      if (expected !== record.code_challenge) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      }

      const { accessToken, refreshToken } = issueTokens(client_id, record.user_id, record.scope);
      db.prepare(`INSERT INTO oauth_tokens
        (access_token_hash, refresh_token_hash, client_id, user_id, scope, access_expires_at, refresh_expires_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        sha256(accessToken), sha256(refreshToken), client_id, record.user_id,
        record.scope, now() + ACCESS_TTL, now() + REFRESH_TTL, now()
      );

      return res.json({
        access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL,
        refresh_token: refreshToken, scope: record.scope
      });
    }

    if (grantType === 'refresh_token') {
      const { refresh_token, client_id, client_secret } = body;
      if (!refresh_token || !client_id) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      const client = getClient(client_id);
      if (!client) return res.status(401).json({ error: 'invalid_client' });
      if (!verifyClientSecret(client, client_secret)) return res.status(401).json({ error: 'invalid_client' });

      const row = db.prepare('SELECT * FROM oauth_tokens WHERE refresh_token_hash = ?').get(sha256(refresh_token));
      if (!row || row.revoked || row.client_id !== client_id) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      if (row.refresh_expires_at && row.refresh_expires_at < now()) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token expired' });
      }

      // Rotate both tokens.
      const { accessToken, refreshToken } = issueTokens(client_id, row.user_id, row.scope);
      db.prepare(`UPDATE oauth_tokens SET access_token_hash = ?, refresh_token_hash = ?,
        access_expires_at = ?, refresh_expires_at = ?, last_used_at = ? WHERE id = ?`).run(
        sha256(accessToken), sha256(refreshToken), now() + ACCESS_TTL, now() + REFRESH_TTL, now(), row.id
      );

      return res.json({
        access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL,
        refresh_token: refreshToken, scope: row.scope
      });
    }

    return res.status(400).json({ error: 'unsupported_grant_type' });
  });

  // CORS preflight for token + resource endpoints.
  app.options('/oauth/token', publicCors);
  app.options('/oauth/revoke', publicCors);
  app.options(/^\/api\/oauth\/.*/, publicCors);

  // --- token revocation (RFC 7009-ish) ------------------------------------

  app.post('/oauth/revoke', publicCors, form, express.json(), (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'invalid_request' });
    const h = sha256(token);
    db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE access_token_hash = ? OR refresh_token_hash = ?').run(h, h);
    res.json({ success: true }); // always 200 per spec, even if unknown
  });

  // --- resource access middleware -----------------------------------------

  const authenticateOAuth = (requiredScope) => (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'invalid_token', error_description: 'missing bearer token' });
    }
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'invalid_token', error_description: 'invalid or expired token' });
    }
    if (!payload.oauth || payload.type !== 'access') {
      return res.status(401).json({ error: 'invalid_token' });
    }
    const row = db.prepare('SELECT * FROM oauth_tokens WHERE access_token_hash = ?').get(sha256(token));
    if (!row || row.revoked || row.access_expires_at < now()) {
      return res.status(401).json({ error: 'invalid_token', error_description: 'token revoked or expired' });
    }
    const scopes = (row.scope || '').split(' ').filter(Boolean);
    if (requiredScope && !scopes.includes(requiredScope)) {
      return res.status(403).json({ error: 'insufficient_scope', error_description: `requires scope: ${requiredScope}` });
    }
    db.prepare('UPDATE oauth_tokens SET last_used_at = ? WHERE id = ?').run(now(), row.id);
    req.oauth = { userId: row.user_id, clientId: row.client_id, scopes };
    next();
  };

  // --- resource endpoints -------------------------------------------------

  // Identity (+ email if scoped).
  app.get('/api/oauth/userinfo', publicCors, authenticateOAuth('identity'), (req, res) => {
    const user = db.prepare('SELECT id, username, email, email_verified FROM users WHERE id = ?').get(req.oauth.userId);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    const out = { id: user.id, username: user.username };
    if (req.oauth.scopes.includes('email')) {
      out.email = user.email;
      out.email_verified = !!user.email_verified;
    }
    res.json(out);
  });

  // Slate metadata list.
  app.get('/api/oauth/slates', publicCors, authenticateOAuth('slates:read:meta'), (req, res) => {
    const rows = db.prepare(`SELECT slate_number, is_published, share_id, word_count, char_count,
      created_at, updated_at, published_at, title, encrypted_title
      FROM slates WHERE user_id = ? ORDER BY updated_at DESC`).all(req.oauth.userId);
    res.json(rows.map(s => ({
      slate_number: s.slate_number,
      is_published: !!s.is_published,
      share_id: s.share_id || null,
      title: s.is_published ? s.title : null,        // private titles are E2E-encrypted
      title_encrypted: !s.is_published && !!s.encrypted_title,
      word_count: s.word_count, char_count: s.char_count,
      created_at: s.created_at, updated_at: s.updated_at, published_at: s.published_at
    })));
  });

  // Published slates with full plaintext (already public content).
  app.get('/api/oauth/slates/published', publicCors, authenticateOAuth('slates:read:public'), async (req, res) => {
    try {
      const rows = db.prepare(`SELECT slate_number, title, share_id, word_count, char_count,
        created_at, updated_at, published_at, b2_public_file_id, b2_file_id
        FROM slates WHERE user_id = ? AND is_published = 1 ORDER BY published_at DESC`).all(req.oauth.userId);
      const out = [];
      for (const s of rows) {
        let content = null;
        try {
          content = await b2Storage.getSlate(s.b2_public_file_id || s.b2_file_id, null);
        } catch { content = null; }
        out.push({
          slate_number: s.slate_number, title: s.title, share_id: s.share_id,
          content, word_count: s.word_count, char_count: s.char_count,
          created_at: s.created_at, updated_at: s.updated_at, published_at: s.published_at
        });
      }
      res.json(out);
    } catch (e) {
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Single private slate — ciphertext + metadata only (zero-knowledge).
  app.get('/api/oauth/slates/:n', publicCors, authenticateOAuth('slates:read:private'), async (req, res) => {
    try {
      const slate = db.prepare('SELECT * FROM slates WHERE slate_number = ? AND user_id = ?')
        .get(req.params.n, req.oauth.userId);
      if (!slate) return res.status(404).json({ error: 'not_found' });

      const userRow = db.prepare('SELECT e2e_migrated FROM users WHERE id = ?').get(req.oauth.userId);
      const isE2E = !!(userRow && userRow.e2e_migrated);

      let raw = null;
      try {
        const buf = await b2Storage.downloadRawFile(slate.b2_file_id);
        raw = buf.toString('base64');
      } catch { raw = null; }

      res.json({
        slate_number: slate.slate_number,
        is_published: !!slate.is_published,
        share_id: slate.share_id || null,
        title: slate.is_published ? slate.title : null,
        title_encrypted: !slate.is_published && !!slate.encrypted_title,
        word_count: slate.word_count, char_count: slate.char_count,
        created_at: slate.created_at, updated_at: slate.updated_at,
        encrypted: true,
        encryption_scheme: isE2E ? 'e2e-aes-256-gcm' : 'server-aes-256-gcm',
        encrypted_content: raw,
        note: 'content is encrypted; decryption requires the owner\'s key, which justtype does not provide via this api'
      });
    } catch (e) {
      res.status(500).json({ error: 'server_error' });
    }
  });

  // --- user-facing: apps I have authorized (for Account "connected apps") --

  app.get('/api/account/connected-apps', deps.authenticateToken, (req, res) => {
    const rows = db.prepare(`SELECT t.client_id, t.scope, MIN(t.created_at) AS authorized_at,
        MAX(t.last_used_at) AS last_used_at, c.name, c.website
      FROM oauth_tokens t JOIN oauth_clients c ON c.client_id = t.client_id
      WHERE t.user_id = ? AND t.revoked = 0 AND t.refresh_expires_at > ?
      GROUP BY t.client_id ORDER BY last_used_at DESC`).all(req.user.id, now());
    res.json(rows.map(r => ({
      client_id: r.client_id, name: r.name, website: r.website,
      scopes: (r.scope || '').split(' ').filter(Boolean),
      authorized_at: r.authorized_at, last_used_at: r.last_used_at
    })));
  });

  app.post('/api/account/connected-apps/revoke', deps.authenticateToken, (req, res) => {
    const { client_id } = req.body || {};
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    const result = db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?')
      .run(req.user.id, client_id);
    res.json({ success: true, revoked: result.changes });
  });

  // Expose scope catalogue (handy for docs / dynamic UIs).
  app.get('/api/oauth/scopes', (req, res) => res.json(SCOPES));

  // Periodic cleanup of expired tokens.
  setInterval(() => {
    try {
      const t = now();
      db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').run(t);
      db.prepare('DELETE FROM oauth_tokens WHERE refresh_expires_at < ? AND access_expires_at < ?').run(t, t);
    } catch {}
  }, 60 * 60 * 1000).unref?.();

  console.log('✓ OAuth provider routes mounted');
}

module.exports = { mountOAuth, SCOPES };
