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
  'slates:read:private': 'read private slates you choose to share with it (you pick which ones; revocable anytime)',
  'slates:write': 'create and edit published slates on your behalf',
  'slates:create': 'drop new private (encrypted) slates into your account, which appear next time you open justtype',
  'slates:delete': 'delete slates on your behalf',
  'slates:publish': 'publish and unpublish slates on your behalf'
};

const ACCESS_TTL = 3600;            // 1 hour
const REFRESH_TTL = 90 * 24 * 3600; // 90 days
const CODE_TTL = 60;                // 1 minute
const CONSENT_TTL = 600;            // 10 minutes

// Scope implications: holding the key on the left satisfies the scopes on the
// right. Reading private slates is the "full read" scope — it also covers
// published content (which is world-public anyway). It deliberately does NOT
// imply slates:read:meta, since enumerating the whole slate list is a distinct
// privacy boundary an app must request explicitly.
const SCOPE_IMPLIES = {
  'slates:read:private': ['slates:read:public']
};
const scopeSatisfied = (granted, required) =>
  granted.includes(required) || granted.some((g) => (SCOPE_IMPLIES[g] || []).includes(required));

function mountOAuth(app, deps) {
  const { db, jwt, JWT_SECRET, crypto, b2Storage, isProduction,
          generateUniqueShareId, checkStorageLimit, updateUserStorage, dropHub } = deps;

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
      // Never allow schemes that could execute or read local resources.
      if (['javascript:', 'data:', 'file:', 'blob:', 'vbscript:'].includes(u.protocol)) return false;
      if (u.protocol === 'https:') return true;
      // Allow http only for loopback (native/dev clients).
      if (u.protocol === 'http:') return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
      // Private-use URI scheme for native apps (RFC 8252), e.g. com.example.app://callback.
      // Security comes from exact-matching the client's registered URIs, not the scheme.
      return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
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
    label.shareall { display: flex; gap: 0.6rem; align-items: flex-start; background: #161616;
            border: 1px solid #262626; border-radius: 8px; padding: 0.75rem; color: #b5b5b5;
            font-size: 0.82rem; line-height: 1.5; cursor: pointer; }
    label.shareall input { width: 1rem; height: 1rem; margin-top: 0.15rem; flex-shrink: 0; accent-color: #fff; }
    label.shareall strong { color: #eaeaea; font-weight: 600; }
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

  const consentPageBody = (user, client, scopeList, ticket, grantable) => {
    const items = scopeList.map(s =>
      `<li><span class="check">✓</span><span>${escapeHtml(SCOPES[s])}</span></li>`).join('');
    const site = client.website
      ? `<div class="sub" style="margin-top:-1rem"><a href="${escapeHtml(client.website)}" target="_blank" rel="noopener">${escapeHtml(client.website)}</a></div>` : '';
    const privacyNote = scopeList.includes('slates:read:private')
      ? `<div class="note">your private slates stay end-to-end encrypted. approving this does <strong>not</strong> hand them over — afterwards you choose, in your justtype account, exactly which private slates to share with this app, and you can stop sharing anytime. justtype never shares your password or master key.</div>` : '';
    // Disclose how app-created drops actually arrive — they are not instant and
    // they outlive the app once you open justtype.
    const createNote = scopeList.includes('slates:create')
      ? `<div class="note">new slates this app creates are <strong>end-to-end encrypted to you</strong> — justtype and the app's server never see their text. they appear in your account the next time you open justtype (instantly if it is open, otherwise once you next unlock — only your device can decrypt them). once they appear they are yours and stay even if you later remove this app.</div>` : '';
    return `
      <h1>authorize ${escapeHtml(client.name)}</h1>
      <p class="sub"><span class="app">${escapeHtml(client.name)}</span> wants permission to:</p>
      ${site}
      <ul class="scopes">${items}</ul>
      ${privacyNote}
      ${createNote}
      <form method="POST" action="/oauth/authorize/decide">
        <input type="hidden" name="ticket" value="${escapeHtml(ticket)}">
        ${grantable ? `<label class="shareall"><input type="checkbox" name="share_all" value="1"><span>also let <strong>${escapeHtml(client.name)}</strong> read &amp; write <strong>all</strong> my private slates (current + future). you can change this anytime in your account.</span></label>` : ''}
        <div class="row">
          <button type="submit" name="decision" value="deny" class="ghost">cancel</button>
          <button type="submit" name="decision" value="approve" class="primary">authorize</button>
        </div>
      </form>
      <div class="who">signed in as @${escapeHtml(user.username)}</div>`;
  };

  // --- client registration (self-serve, requires a logged-in user) --------

  // A registered app public key is base64 SPKI DER (RSA-OAEP). Light validation.
  const validPublicKey = (pk) =>
    typeof pk === 'string' && pk.length >= 100 && pk.length <= 4000 && /^[A-Za-z0-9+/=]+$/.test(pk);

  app.post('/api/oauth/clients', deps.authenticateToken, (req, res) => {
    const { name, website, redirect_uris, scopes, confidential, public_key } = req.body || {};
    if (!name || typeof name !== 'string' || name.length > 80) {
      return res.status(400).json({ error: 'A valid app name is required (max 80 chars).' });
    }
    if (!Array.isArray(redirect_uris) || redirect_uris.length === 0 || redirect_uris.length > 10) {
      return res.status(400).json({ error: 'Provide 1-10 redirect URIs.' });
    }
    for (const uri of redirect_uris) {
      if (typeof uri !== 'string' || !validRedirectUri(uri)) {
        return res.status(400).json({ error: `Invalid redirect URI: ${uri}. Use https, http://localhost, or a native app scheme like com.example.app://callback.` });
      }
    }
    const requested = Array.isArray(scopes) && scopes.length ? scopes : ['identity'];
    for (const s of requested) {
      if (!SCOPES[s]) return res.status(400).json({ error: `Unknown scope: ${s}` });
    }
    if (website && (typeof website !== 'string' || website.length > 200)) {
      return res.status(400).json({ error: 'Invalid website URL.' });
    }
    if (public_key && !validPublicKey(public_key)) {
      return res.status(400).json({ error: 'Invalid public key (expected base64 SPKI).' });
    }
    if (requested.includes('slates:read:private') && !public_key) {
      return res.status(400).json({ error: 'The slates:read:private scope requires a public key for key delegation.' });
    }

    const clientId = 'jt_' + randomToken(16);
    const isConfidential = !!confidential;
    let clientSecret = null, secretHash = null;
    if (isConfidential) {
      clientSecret = randomToken(32);
      secretHash = sha256(clientSecret);
    }

    db.prepare(`INSERT INTO oauth_clients
      (client_id, client_secret_hash, name, website, redirect_uris, allowed_scopes, is_confidential, owner_user_id, public_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      clientId, secretHash, name, website || null,
      JSON.stringify(redirect_uris), requested.join(' '),
      isConfidential ? 1 : 0, req.user.id, public_key || null
    );

    res.json({
      client_id: clientId,
      client_secret: clientSecret, // shown ONCE; not retrievable later
      name, website: website || null,
      redirect_uris, scopes: requested,
      is_confidential: isConfidential,
      has_public_key: !!public_key
    });
  });

  app.get('/api/oauth/clients', deps.authenticateToken, (req, res) => {
    const rows = db.prepare(
      'SELECT client_id, name, website, redirect_uris, allowed_scopes, is_confidential, public_key, created_at FROM oauth_clients WHERE owner_user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);
    res.json(rows.map(r => ({
      client_id: r.client_id, name: r.name, website: r.website,
      redirect_uris: JSON.parse(r.redirect_uris || '[]'),
      scopes: (r.allowed_scopes || '').split(' ').filter(Boolean),
      is_confidential: !!r.is_confidential, has_public_key: !!r.public_key, created_at: r.created_at
    })));
  });

  // Rotate / set an app's public key (owner only).
  app.put('/api/oauth/clients/:clientId/public-key', deps.authenticateToken, (req, res) => {
    const { public_key } = req.body || {};
    if (!validPublicKey(public_key)) return res.status(400).json({ error: 'Invalid public key (expected base64 SPKI).' });
    const client = db.prepare('SELECT id FROM oauth_clients WHERE client_id = ? AND owner_user_id = ?')
      .get(req.params.clientId, req.user.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    db.prepare('UPDATE oauth_clients SET public_key = ? WHERE client_id = ?').run(public_key, req.params.clientId);
    res.json({ success: true });
  });

  app.delete('/api/oauth/clients/:clientId', deps.authenticateToken, (req, res) => {
    const client = db.prepare('SELECT id FROM oauth_clients WHERE client_id = ? AND owner_user_id = ?')
      .get(req.params.clientId, req.user.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    db.prepare('DELETE FROM oauth_slate_grants WHERE client_id = ?').run(req.params.clientId);
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

    // Offer the inline "share all private slates" opt-in only when it would work:
    // the app requested private-read access and has a public key to wrap to.
    const grantable = !!(client.public_key && requested.includes('slates:read:private'));
    res.send(renderPage(`authorize ${client.name}`, consentPageBody(user, client, requested, ticket, grantable)));
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

    // Inline "allow full access": the user ticked share-all on the consent screen.
    // Only honor it if the app actually requested private-read and has a public key
    // to wrap to. We record the share-all INTENT now (server-side, no crypto — this
    // is a verified approval), which also lets the user's browser use the grant
    // endpoints before any token is issued. We then hand off to a same-origin React
    // page that does the client-side slate wrapping and finalizes the code, so the
    // authorization code is minted last and never expires while wrapping runs.
    const wantsShareAll = req.body.share_all === '1';
    const scopeList = (t.scope || '').split(' ').filter(Boolean);
    const client = getClient(t.client_id);
    const canShareAll = wantsShareAll && client && client.public_key && scopeList.includes('slates:read:private');

    if (canShareAll) {
      db.prepare(`INSERT INTO oauth_share_all (client_id, user_id) VALUES (?, ?)
        ON CONFLICT(client_id, user_id) DO NOTHING`).run(t.client_id, user.id);
      const finalizeToken = jwt.sign({
        purpose: 'oauth_finalize', uid: user.id, client_id: t.client_id,
        redirect_uri: t.redirect_uri, scope: t.scope, state: t.state || '',
        code_challenge: t.code_challenge, code_challenge_method: t.code_challenge_method
      }, JWT_SECRET, { expiresIn: CONSENT_TTL });
      const share = new URL('/authorize/share', isProduction ? 'https://justtype.io' : 'http://localhost:3003');
      share.searchParams.set('t', finalizeToken);
      share.searchParams.set('client_id', t.client_id);
      share.searchParams.set('app', client.name);
      return res.redirect(share.toString());
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

  // Finalize an authorization that detoured through the React share step: verify the
  // signed finalize token + the session, mint the one-time code now, and return the
  // app redirect URL for the browser to follow. Minting here (not at decide) keeps the
  // 60s code lifetime independent of how long client-side slate wrapping took.
  app.post('/oauth/authorize/finalize', publicCors, express.json(), (req, res) => {
    const { t: token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'invalid_request' });
    let t;
    try {
      t = jwt.verify(token, JWT_SECRET);
      if (t.purpose !== 'oauth_finalize') throw new Error('bad purpose');
    } catch {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'authorization expired; start again from the app' });
    }
    const user = getSessionUser(req);
    if (!user || user.id !== t.uid) return res.status(401).json({ error: 'session_expired' });

    const code = randomToken(32);
    db.prepare(`INSERT INTO oauth_codes
      (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      code, t.client_id, user.id, t.redirect_uri, t.scope,
      t.code_challenge, t.code_challenge_method, now() + CODE_TTL
    );
    const u = new URL(t.redirect_uri);
    if (t.state) u.searchParams.set('state', t.state);
    u.searchParams.set('code', code);
    res.json({ redirect: u.toString() });
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
    if (requiredScope && !scopeSatisfied(scopes, requiredScope)) {
      return res.status(403).json({ error: 'insufficient_scope', error_description: `requires scope: ${requiredScope}` });
    }
    db.prepare('UPDATE oauth_tokens SET last_used_at = ? WHERE id = ?').run(now(), row.id);
    req.oauth = { userId: row.user_id, clientId: row.client_id, scopes };
    next();
  };

  // --- resource endpoints -------------------------------------------------

  // Identity (+ email if scoped).
  app.get('/api/oauth/userinfo', publicCors, authenticateOAuth('identity'), (req, res) => {
    const user = db.prepare('SELECT id, username, email, email_verified, public_key FROM users WHERE id = ?').get(req.oauth.userId);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    const out = { id: user.id, username: user.username };
    if (req.oauth.scopes.includes('email')) {
      out.email = user.email;
      out.email_verified = !!user.email_verified;
    }
    // For apps with slates:create — the user's RSA-OAEP public key (base64 SPKI)
    // to wrap a drop's content key to. null if the user hasn't generated a
    // keypair yet (they will on next unlock); apps should poll/handle null.
    if (req.oauth.scopes.includes('slates:create')) {
      out.public_key = user.public_key || null;
      out.key_scheme = 'rsa-oaep-sha256';
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

  // ---- write operations --------------------------------------------------
  //
  // Apps can create/edit/delete/publish published (plaintext) slates.
  // Private (E2E encrypted) content cannot be authored via the API because the
  // server never holds the user's master key — plaintext never arrives at the
  // server side. If slates:read:private + key delegation is in use, the app can
  // edit a delegated private slate's content via PATCH /api/oauth/slates/:n/delegated.
  //
  // These endpoints mirror the logic in the corresponding authenticateToken routes
  // and reuse the same helpers (generateUniqueShareId, checkStorageLimit,
  // updateUserStorage) passed into mountOAuth.

  const MAX_CONTENT = 5 * 1024 * 1024; // 5 MB

  // A very light size guard used consistently across write paths.
  const guardSize = (contentStr, res) => {
    const bytes = Buffer.byteLength(contentStr, 'utf8');
    if (bytes > MAX_CONTENT) {
      res.status(413).json({ error: `Content too large (max 5 MB, got ${(bytes / 1024 / 1024).toFixed(2)} MB)` });
      return null;
    }
    return bytes;
  };

  // POST /api/oauth/slates — create a new published slate.
  // The slate is created in the published state (is_published = 1) with a fresh
  // share_id so third-party tools can build on top of justtype's publishing model.
  // Pass publish: false to create an unpublished (private, plaintext) slate; in
  // that case it shows in the user's slate list but its content is readable by
  // anyone with the right scope who can GET it.
  app.post('/api/oauth/slates', publicCors, authenticateOAuth('slates:write'), async (req, res) => {
    const { title = '', content = '', publish = true } = req.body || {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
    const sizeBytes = guardSize(content, res);
    if (sizeBytes === null) return;

    const storageCheck = checkStorageLimit(req.oauth.userId, sizeBytes);
    if (!storageCheck.allowed) return res.status(413).json({ error: storageCheck.error });

    try {
      const slateId = `${req.oauth.userId}-oauth-${Date.now()}`;
      const b2FileId = await b2Storage.uploadSlate(slateId, content, null); // unencrypted

      let shareId = null, b2PublicFileId = null;
      if (publish) {
        shareId = generateUniqueShareId();
        b2PublicFileId = b2FileId; // same file serves as public copy
      }

      const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
      const charCount = content.length;
      const nextNumber = db.prepare('SELECT COALESCE(MAX(slate_number), 0) + 1 AS next FROM slates WHERE user_id = ?').get(req.oauth.userId).next;

      db.prepare(`INSERT INTO slates
        (user_id, slate_number, title, b2_file_id, b2_public_file_id, word_count, char_count, size_bytes,
         encryption_version, is_published, share_id, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`).run(
        req.oauth.userId, nextNumber, title || '', b2FileId, b2PublicFileId,
        wordCount, charCount, sizeBytes,
        publish ? 1 : 0, shareId, publish ? new Date().toISOString() : null
      );

      updateUserStorage(req.oauth.userId);

      res.status(201).json({
        slate_number: nextNumber,
        title, word_count: wordCount, char_count: charCount,
        is_published: !!publish, share_id: shareId,
        share_url: shareId ? `${isProduction ? 'https://justtype.io' : 'http://localhost:3003'}/s/${shareId}` : null
      });
    } catch (e) {
      console.error('oauth create slate:', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/oauth/users/me/public-key — the user's RSA-OAEP public key (base64
  // SPKI) to wrap a drop's content key to. Convenience alias of the field in
  // userinfo. null if the user has not generated a keypair yet.
  app.get('/api/oauth/users/me/public-key', publicCors, authenticateOAuth('slates:create'), (req, res) => {
    const row = db.prepare('SELECT public_key FROM users WHERE id = ?').get(req.oauth.userId);
    res.json({ public_key: row?.public_key || null, key_scheme: 'rsa-oaep-sha256' });
  });

  // POST /api/oauth/slates/drop — "drop box": create a NEW private slate for the
  // user without the server (or the app needing the user's master key) ever
  // seeing plaintext. The app generates a fresh content key, encrypts content +
  // title under it (justtype's blob format), and wraps the content key to the
  // USER'S public key. We store the opaque blobs; the user's client decrypts on
  // next unlock and adopts the drop as a normal master-key-encrypted slate.
  //
  // This is the ONLY way an app can author private (E2E) content. slates:write
  // only produces plaintext slates. A drop cannot be created until the user has
  // published a keypair (409 keypair_unavailable) — the app should retry later.
  app.post('/api/oauth/slates/drop', publicCors, authenticateOAuth('slates:create'), async (req, res) => {
    const { wrapped_key, enc_content, enc_title } = req.body || {};
    if (!wrapped_key || typeof wrapped_key !== 'string') {
      return res.status(400).json({ error: 'wrapped_key (content key RSA-OAEP wrapped to the user public key, base64) required' });
    }
    if (!enc_content || typeof enc_content !== 'string') {
      return res.status(400).json({ error: 'enc_content (base64 AES-256-GCM blob) required' });
    }
    for (const v of [wrapped_key, enc_content, enc_title]) {
      if (v != null && (typeof v !== 'string' || v.length > MAX_GRANT_BLOB)) {
        return res.status(413).json({ error: 'blob too large' });
      }
    }
    try {
      const user = db.prepare('SELECT public_key FROM users WHERE id = ?').get(req.oauth.userId);
      if (!user || !user.public_key) {
        return res.status(409).json({ error: 'keypair_unavailable', error_description: 'the user has not published an encryption key yet; retry after they next open justtype' });
      }
      const info = db.prepare(`INSERT INTO oauth_slate_drops (client_id, user_id, wrapped_key, enc_content, enc_title)
        VALUES (?, ?, ?, ?, ?)`).run(req.oauth.clientId, req.oauth.userId, wrapped_key, enc_content, enc_title || null);

      // Nudge any open client to adopt now (SSE). Closed clients adopt on next
      // unlock — no notifications. Best-effort.
      if (dropHub) { try { await dropHub.notifyDrop(db, req.oauth.userId); } catch {} }

      res.status(201).json({ success: true, drop_id: info.lastInsertRowid, status: 'pending_adoption' });
    } catch (e) {
      console.error('oauth slate drop:', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // GET /api/oauth/dropbox — sync status for the calling app. Lets an app answer
  // "can I drop yet?" and "has the user picked up what I dropped?" without
  // guessing. All scoped to THIS app + user; reveals no slate content.
  //
  //   keypair_ready  the user has published a key, so drops will be accepted
  //   public_key     that key (or null) — same value as /users/me/public-key
  //   pending        your drops still waiting for the user to open justtype
  //   delivered      slates you created that the user has adopted (kept) so far
  //   last_drop_at   unix secs of your most recent still-pending drop (or null)
  //   last_delivered_at  ISO time the user last adopted one of your drops (or null)
  //   synced         true when you have no pending drops (everything delivered)
  app.get('/api/oauth/dropbox', publicCors, authenticateOAuth('slates:create'), (req, res) => {
    const { userId, clientId } = req.oauth;
    const user = db.prepare('SELECT public_key FROM users WHERE id = ?').get(userId);
    const pendingRow = db.prepare(
      'SELECT COUNT(*) AS n, MAX(created_at) AS last FROM oauth_slate_drops WHERE client_id = ? AND user_id = ?'
    ).get(clientId, userId);
    const deliveredRow = db.prepare(
      'SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM slates WHERE user_id = ? AND source_app = ?'
    ).get(userId, clientId);
    const pending = pendingRow?.n || 0;
    res.json({
      keypair_ready: !!(user && user.public_key),
      public_key: user?.public_key || null,
      key_scheme: 'rsa-oaep-sha256',
      pending,
      delivered: deliveredRow?.n || 0,
      last_drop_at: pendingRow?.last || null,
      last_delivered_at: deliveredRow?.last || null,
      synced: pending === 0
    });
  });

  // PUT /api/oauth/slates/:n — update the content/title of a published slate.
  // Only works on plaintext (non-E2E) slates the user owns. Editing a published
  // slate republishes it with the new content; editing an unpublished slate
  // keeps it unpublished.
  app.put('/api/oauth/slates/:n', publicCors, authenticateOAuth('slates:write'), async (req, res) => {
    const { title, content } = req.body || {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
    const sizeBytes = guardSize(content, res);
    if (sizeBytes === null) return;

    try {
      const slate = db.prepare('SELECT * FROM slates WHERE slate_number = ? AND user_id = ?')
        .get(req.params.n, req.oauth.userId);
      if (!slate) return res.status(404).json({ error: 'not_found' });
      if (slate.encryption_version === 1 && !slate.is_system_slate) {
        return res.status(403).json({ error: 'this slate is end-to-end encrypted — it cannot be edited via the api without key delegation. use PATCH /api/oauth/slates/:n/delegated for shared private slates.' });
      }
      if (slate.is_system_slate) return res.status(403).json({ error: 'system slates cannot be modified' });

      const sizeDiff = sizeBytes - (slate.size_bytes || 0);
      if (sizeDiff > 0) {
        const check = checkStorageLimit(req.oauth.userId, sizeDiff);
        if (!check.allowed) return res.status(413).json({ error: check.error });
      }

      const slateId = `${req.oauth.userId}-oauth-${Date.now()}`;
      const b2FileId = await b2Storage.uploadSlate(slateId, content, null);

      // If it was published, update the public copy in place.
      let b2PublicFileId = slate.b2_public_file_id;
      if (slate.is_published) {
        b2PublicFileId = b2FileId; // same unencrypted file
      }

      const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
      const charCount = content.length;
      const newTitle = title !== undefined ? title : (slate.title || '');

      db.prepare(`UPDATE slates SET title = ?, b2_file_id = ?, b2_public_file_id = ?,
        word_count = ?, char_count = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE slate_number = ? AND user_id = ?`).run(
        newTitle, b2FileId, b2PublicFileId,
        wordCount, charCount, sizeBytes, req.params.n, req.oauth.userId
      );

      // Best-effort delete of old B2 files.
      const toDelete = new Set([slate.b2_file_id, slate.b2_public_file_id].filter(Boolean));
      toDelete.delete(b2FileId);
      for (const id of toDelete) {
        try { await b2Storage.deleteSlate(id); } catch { /* best-effort */ }
      }

      updateUserStorage(req.oauth.userId);
      res.json({ success: true, word_count: wordCount, char_count: charCount, title: newTitle });
    } catch (e) {
      console.error('oauth update slate:', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // PATCH /api/oauth/slates/:n/delegated — update a private slate the user has
  // delegated to this app. The app sends new content encrypted under the existing
  // content key (retrieved from the grant), which the server stores verbatim.
  // The user's justtype client merges the change on next open.
  app.patch('/api/oauth/slates/:n/delegated', publicCors, authenticateOAuth('slates:read:private'), async (req, res) => {
    const { enc_content, enc_title, word_count, char_count } = req.body || {};
    if (!enc_content || typeof enc_content !== 'string') {
      return res.status(400).json({ error: 'enc_content (base64 AES-256-GCM blob) required' });
    }
    if (enc_content.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'blob too large' });

    try {
      // Confirm a grant exists (app was delegated this slate).
      const grant = db.prepare(
        'SELECT wrapped_key FROM oauth_slate_grants WHERE client_id = ? AND user_id = ? AND slate_number = ?'
      ).get(req.oauth.clientId, req.oauth.userId, req.params.n);
      if (!grant) return res.status(403).json({ error: 'this slate has not been shared with your app' });

      // Mark last_writer = 'app' so the owner's client knows to pull this edit
      // into the canonical (master-key encrypted) slate on next open. The content
      // key is unchanged, so the existing owner_wrapped_key still decrypts it.
      db.prepare(`UPDATE oauth_slate_grants
        SET enc_content = ?, enc_title = ?, last_writer = 'app', updated_at = strftime('%s','now')
        WHERE client_id = ? AND user_id = ? AND slate_number = ?`).run(
        enc_content, enc_title || null,
        req.oauth.clientId, req.oauth.userId, req.params.n
      );

      // Update word/char counts on the slate so the user sees fresh stats.
      if (word_count != null || char_count != null) {
        db.prepare('UPDATE slates SET word_count = COALESCE(?, word_count), char_count = COALESCE(?, char_count), updated_at = CURRENT_TIMESTAMP WHERE slate_number = ? AND user_id = ?')
          .run(word_count ?? null, char_count ?? null, req.params.n, req.oauth.userId);
      }

      res.json({ success: true });
    } catch (e) {
      console.error('oauth patch delegated:', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // DELETE /api/oauth/slates/:n — delete a slate the user owns.
  // Works on any slate (published or private). Does not require slates:write
  // specifically — uses slates:delete so the user can grant delete without write.
  app.delete('/api/oauth/slates/:n', publicCors, authenticateOAuth('slates:delete'), async (req, res) => {
    try {
      const slate = db.prepare('SELECT * FROM slates WHERE slate_number = ? AND user_id = ?')
        .get(req.params.n, req.oauth.userId);
      if (!slate) return res.status(404).json({ error: 'not_found' });
      if (slate.is_system_slate) return res.status(403).json({ error: 'system slates cannot be deleted' });

      try { await b2Storage.deleteSlate(slate.b2_file_id); } catch { /* best-effort */ }
      if (slate.b2_public_file_id && slate.b2_public_file_id !== slate.b2_file_id) {
        try { await b2Storage.deleteSlate(slate.b2_public_file_id); } catch { /* best-effort */ }
      }

      db.prepare('DELETE FROM oauth_slate_grants WHERE user_id = ? AND slate_number = ?').run(req.oauth.userId, slate.slate_number);
      db.prepare('DELETE FROM slates WHERE slate_number = ? AND user_id = ?').run(req.params.n, req.oauth.userId);
      updateUserStorage(req.oauth.userId);
      res.json({ success: true });
    } catch (e) {
      console.error('oauth delete slate:', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // PATCH /api/oauth/slates/:n/publish — publish or unpublish a plaintext slate.
  app.patch('/api/oauth/slates/:n/publish', publicCors, authenticateOAuth('slates:publish'), async (req, res) => {
    const { publish } = req.body || {};
    if (typeof publish !== 'boolean') return res.status(400).json({ error: 'publish (boolean) required' });

    try {
      const slate = db.prepare('SELECT * FROM slates WHERE slate_number = ? AND user_id = ?')
        .get(req.params.n, req.oauth.userId);
      if (!slate) return res.status(404).json({ error: 'not_found' });
      if (slate.is_system_slate) return res.status(403).json({ error: 'system slates cannot be toggled' });
      if (slate.encryption_version === 1 && !slate.is_system_slate) {
        return res.status(403).json({ error: 'cannot publish/unpublish an e2e-encrypted slate via the api — the user must do it from their client so plaintext can be sent for the public copy' });
      }

      let shareId = slate.share_id;
      let publicFileId = slate.b2_public_file_id;

      if (publish && !shareId) shareId = generateUniqueShareId();

      if (publish && !publicFileId) {
        // Read content and upload unencrypted public copy.
        const content = await b2Storage.getSlate(slate.b2_file_id, null);
        const pubId = `${req.oauth.userId}-public-${Date.now()}`;
        publicFileId = await b2Storage.uploadSlate(pubId, content, null);
      }

      if (!publish && publicFileId) {
        try { await b2Storage.deleteSlate(publicFileId); } catch { /* best-effort */ }
        publicFileId = null;
      }

      const publishedAt = publish && !slate.published_at ? new Date().toISOString() : slate.published_at;
      db.prepare(`UPDATE slates SET is_published = ?, share_id = ?, b2_public_file_id = ?, published_at = ?
        WHERE slate_number = ? AND user_id = ?`)
        .run(publish ? 1 : 0, shareId, publicFileId, publishedAt, req.params.n, req.oauth.userId);

      const base = isProduction ? 'https://justtype.io' : 'http://localhost:3003';
      res.json({
        success: true, is_published: publish,
        share_id: publish ? shareId : null,
        share_url: publish ? `${base}/s/${shareId}` : null
      });
    } catch (e) {
      console.error('oauth publish slate:', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // List the private slates the user has delegated to THIS app (readable ones).
  app.get('/api/oauth/shared', publicCors, authenticateOAuth('slates:read:private'), (req, res) => {
    const rows = db.prepare(`SELECT g.slate_number, g.updated_at AS shared_at,
        s.word_count, s.char_count, s.created_at, s.updated_at
      FROM oauth_slate_grants g JOIN slates s
        ON s.slate_number = g.slate_number AND s.user_id = g.user_id
      WHERE g.client_id = ? AND g.user_id = ? ORDER BY g.updated_at DESC`)
      .all(req.oauth.clientId, req.oauth.userId);
    res.json(rows.map(r => ({
      slate_number: r.slate_number,
      shared_at: r.shared_at,
      word_count: r.word_count, char_count: r.char_count,
      created_at: r.created_at, updated_at: r.updated_at
    })));
  });

  // Single private slate. If the user delegated this slate to the calling app,
  // return the app-readable re-wrapped blob (decryptable with the app's private
  // key). Otherwise return the owner-encrypted ciphertext, which the app cannot
  // read — justtype stays zero-knowledge either way.
  app.get('/api/oauth/slates/:n', publicCors, authenticateOAuth('slates:read:private'), async (req, res) => {
    try {
      const slate = db.prepare('SELECT * FROM slates WHERE slate_number = ? AND user_id = ?')
        .get(req.params.n, req.oauth.userId);
      if (!slate) return res.status(404).json({ error: 'not_found' });

      const grant = db.prepare(
        'SELECT wrapped_key, enc_content, enc_title, updated_at FROM oauth_slate_grants WHERE client_id = ? AND user_id = ? AND slate_number = ?'
      ).get(req.oauth.clientId, req.oauth.userId, slate.slate_number);

      const base = {
        slate_number: slate.slate_number,
        is_published: !!slate.is_published,
        share_id: slate.share_id || null,
        title: slate.is_published ? slate.title : null,
        word_count: slate.word_count, char_count: slate.char_count,
        created_at: slate.created_at, updated_at: slate.updated_at
      };

      if (grant) {
        // Delegated: the user re-wrapped this slate to your public key.
        // enc_content decrypts (with the unwrapped content key) to JSON { content, uploadedAt }.
        // enc_title decrypts to the raw title string (null if untitled).
        return res.json({
          ...base,
          delegated: true,
          key_scheme: 'rsa-oaep-sha256',
          content_scheme: 'aes-256-gcm',
          wrapped_key: grant.wrapped_key,
          enc_content: grant.enc_content,
          enc_title: grant.enc_title || null,
          shared_at: grant.updated_at
        });
      }

      // Published slates are world-public plaintext anyway — return readable
      // content + title here too, so reads are uniform: one endpoint, content
      // comes back for anything the app may see (no branching on slate type).
      if (slate.is_published) {
        let content = null;
        try { content = await b2Storage.getSlate(slate.b2_public_file_id || slate.b2_file_id, null); } catch { content = null; }
        return res.json({ ...base, delegated: false, published: true, title: slate.title, content });
      }

      // Private + not delegated: owner-encrypted ciphertext only (unreadable by the app).
      let raw = null;
      try {
        const buf = await b2Storage.downloadRawFile(slate.b2_file_id);
        raw = buf.toString('base64');
      } catch { raw = null; }

      res.json({
        ...base,
        delegated: false,
        title_encrypted: !slate.is_published && !!slate.encrypted_title,
        encrypted: true,
        encrypted_content: raw,
        note: 'this slate has not been shared with your app. ask the user to delegate it; otherwise it stays end-to-end encrypted and unreadable.'
      });
    } catch (e) {
      res.status(500).json({ error: 'server_error' });
    }
  });

  // --- user-facing: apps I have authorized (for Account "connected apps") --

  app.get('/api/account/connected-apps', deps.authenticateToken, (req, res) => {
    const rows = db.prepare(`SELECT t.client_id, t.scope, MIN(t.created_at) AS authorized_at,
        MAX(t.last_used_at) AS last_used_at, c.name, c.website, c.public_key
      FROM oauth_tokens t JOIN oauth_clients c ON c.client_id = t.client_id
      WHERE t.user_id = ? AND t.revoked = 0 AND t.refresh_expires_at > ?
      GROUP BY t.client_id ORDER BY last_used_at DESC`).all(req.user.id, now());
    res.json(rows.map(r => {
      const scopes = (r.scope || '').split(' ').filter(Boolean);
      const sharedCount = db.prepare('SELECT COUNT(*) AS n FROM oauth_slate_grants WHERE client_id = ? AND user_id = ?')
        .get(r.client_id, req.user.id).n;
      const shareAll = !!db.prepare('SELECT 1 FROM oauth_share_all WHERE client_id = ? AND user_id = ?')
        .get(r.client_id, req.user.id);
      return {
        client_id: r.client_id, name: r.name, website: r.website,
        scopes,
        can_share: scopes.includes('slates:read:private') && !!r.public_key,
        has_public_key: !!r.public_key,
        shared_count: sharedCount,
        share_all: shareAll,
        authorized_at: r.authorized_at, last_used_at: r.last_used_at
      };
    }));
  });

  app.post('/api/account/connected-apps/revoke', deps.authenticateToken, (req, res) => {
    const { client_id } = req.body || {};
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    const result = db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?')
      .run(req.user.id, client_id);
    // Revoking access also revokes any delegated private-slate read access
    // (per-slate grants and any blanket "share all" relationship).
    db.prepare('DELETE FROM oauth_slate_grants WHERE user_id = ? AND client_id = ?').run(req.user.id, client_id);
    db.prepare('DELETE FROM oauth_share_all WHERE user_id = ? AND client_id = ?').run(req.user.id, client_id);
    // NOTE: we deliberately do NOT delete pending oauth_slate_drops here. A drop is
    // encrypted to the USER's key, not the app's, so revoking the app never locks
    // the user out of it. The user keeps any un-adopted drops and can adopt or
    // discard them on their own schedule — revocation must never cost a note.
    res.json({ success: true, revoked: result.changes });
  });

  // --- private-slate delegation (key re-wrapping), owner-driven -----------
  // The browser does all crypto; these endpoints only move opaque blobs.

  const MAX_GRANT_BLOB = 8 * 1024 * 1024; // 8MB base64 ceiling per field

  // Confirm the user has actually authorized this client with the private scope,
  // and the client has a public key to wrap to. Returns the client row or null.
  const grantableClient = (userId, clientId) => {
    const client = db.prepare('SELECT client_id, name, public_key FROM oauth_clients WHERE client_id = ?').get(clientId);
    if (!client || !client.public_key) return null;
    // Authorized to receive grants if a live token carries the private scope...
    const tok = db.prepare(`SELECT scope FROM oauth_tokens
      WHERE user_id = ? AND client_id = ? AND revoked = 0 AND refresh_expires_at > ?
      ORDER BY created_at DESC LIMIT 1`).get(userId, clientId, now());
    const tokenOk = tok && (tok.scope || '').split(' ').includes('slates:read:private');
    // ...OR the user recorded a share-all intent at consent time. That row is only
    // written after a verified private-scope approval (consent decide, or the
    // post-token share-all endpoint), so its presence implies authorization. This
    // lets the inline consent → React share step wrap slates before the app has
    // exchanged its code for a token.
    const intentOk = !!db.prepare('SELECT 1 FROM oauth_share_all WHERE client_id = ? AND user_id = ?')
      .get(clientId, userId);
    if (!tokenOk && !intentOk) return null;
    return client;
  };

  // The app's public key + which slates are currently shared (for the share UI).
  // share_all reflects whether the user has given this app blanket access to all
  // private slates (current + future).
  app.get('/api/account/slate-grants/:clientId', deps.authenticateToken, (req, res) => {
    const client = grantableClient(req.user.id, req.params.clientId);
    if (!client) return res.status(404).json({ error: 'not_grantable' });
    const rows = db.prepare('SELECT slate_number, updated_at FROM oauth_slate_grants WHERE client_id = ? AND user_id = ?')
      .all(req.params.clientId, req.user.id);
    const shareAll = !!db.prepare('SELECT 1 FROM oauth_share_all WHERE client_id = ? AND user_id = ?')
      .get(req.params.clientId, req.user.id);
    res.json({
      client_id: client.client_id,
      name: client.name,
      public_key: client.public_key,
      share_all: shareAll,
      shared: rows.map(r => ({ slate_number: r.slate_number, updated_at: r.updated_at }))
    });
  });

  // Which apps a given slate must be kept in sync with (+ their public keys) —
  // used on save (push) and on open (pull). Includes apps with an explicit grant
  // for this slate AND apps the user gave "share all" access (so newly written
  // slates auto-share). For apps that already hold a grant, the stored blobs and
  // last_writer come along so the client can pull edits the app made
  // (last_writer = 'app') back into the canonical slate. Revoked/expired apps are
  // excluded so they stop receiving updates.
  app.get('/api/account/slate-grants/by-slate/:n', deps.authenticateToken, (req, res) => {
    const rows = db.prepare(`
      SELECT c.client_id, c.public_key, c.name,
             g.id AS grant_id, g.enc_content, g.enc_title, g.owner_wrapped_key, g.last_writer
      FROM oauth_clients c
      LEFT JOIN oauth_slate_grants g
        ON g.client_id = c.client_id AND g.user_id = ? AND g.slate_number = ?
      WHERE c.public_key IS NOT NULL
        AND (g.id IS NOT NULL
             OR c.client_id IN (SELECT client_id FROM oauth_share_all WHERE user_id = ?))
        AND c.client_id IN (
          SELECT client_id FROM oauth_tokens
          WHERE user_id = ? AND revoked = 0 AND refresh_expires_at > ?
        )
    `).all(req.user.id, req.params.n, req.user.id, req.user.id, now());
    res.json(rows.map(r => ({
      client_id: r.client_id, public_key: r.public_key, name: r.name,
      grant: (r.grant_id && r.owner_wrapped_key) ? {
        enc_content: r.enc_content, enc_title: r.enc_title,
        owner_wrapped_key: r.owner_wrapped_key, last_writer: r.last_writer
      } : null
    })));
  });

  // Give an app blanket access to all private slates (current + future), or stop.
  // Enabling only records intent; the client then bulk-wraps existing slates and
  // auto-wraps future ones on save. Disabling removes the flag AND all grants.
  app.post('/api/account/slate-grants/share-all', deps.authenticateToken, (req, res) => {
    const { client_id } = req.body || {};
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    if (!grantableClient(req.user.id, client_id)) {
      return res.status(403).json({ error: 'client not authorized for private slates' });
    }
    db.prepare(`INSERT INTO oauth_share_all (client_id, user_id) VALUES (?, ?)
      ON CONFLICT(client_id, user_id) DO NOTHING`).run(client_id, req.user.id);
    res.json({ success: true });
  });

  app.delete('/api/account/slate-grants/share-all', deps.authenticateToken, (req, res) => {
    const { client_id } = req.body || {};
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    db.prepare('DELETE FROM oauth_share_all WHERE client_id = ? AND user_id = ?').run(client_id, req.user.id);
    const r = db.prepare('DELETE FROM oauth_slate_grants WHERE client_id = ? AND user_id = ?').run(client_id, req.user.id);
    res.json({ success: true, removed: r.changes });
  });

  // Bulk upsert many re-wrapped grants in a single transaction — used when sharing
  // all slates, so the client makes one request per batch instead of one per slate.
  // Each entry is the same shape as the single POST below; all marked last_writer
  // = 'owner'. Slates the user doesn't own are skipped.
  app.post('/api/account/slate-grants/batch', deps.authenticateToken, (req, res) => {
    const { client_id, grants } = req.body || {};
    if (!client_id || !Array.isArray(grants) || grants.length === 0) {
      return res.status(400).json({ error: 'client_id and a non-empty grants[] are required' });
    }
    if (grants.length > 500) return res.status(413).json({ error: 'too many grants in one batch (max 500)' });
    if (!grantableClient(req.user.id, client_id)) {
      return res.status(403).json({ error: 'client not authorized for private slates' });
    }
    for (const g of grants) {
      if (!g || g.slate_number == null || !g.wrapped_key || !g.enc_content) {
        return res.status(400).json({ error: 'each grant needs slate_number, wrapped_key, enc_content' });
      }
      if ([g.wrapped_key, g.owner_wrapped_key, g.enc_content, g.enc_title].some(v => v != null && (typeof v !== 'string' || v.length > MAX_GRANT_BLOB))) {
        return res.status(413).json({ error: 'blob too large' });
      }
    }
    const owned = new Set(db.prepare('SELECT slate_number FROM slates WHERE user_id = ?').all(req.user.id).map(r => r.slate_number));
    const upsert = db.prepare(`INSERT INTO oauth_slate_grants
        (client_id, user_id, slate_number, wrapped_key, owner_wrapped_key, enc_content, enc_title, last_writer, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', strftime('%s','now'), strftime('%s','now'))
      ON CONFLICT(client_id, user_id, slate_number) DO UPDATE SET
        wrapped_key = excluded.wrapped_key,
        owner_wrapped_key = excluded.owner_wrapped_key,
        enc_content = excluded.enc_content,
        enc_title = excluded.enc_title,
        last_writer = 'owner',
        updated_at = strftime('%s','now')`);
    const run = db.transaction((rows) => {
      let saved = 0;
      for (const g of rows) {
        if (!owned.has(Number(g.slate_number))) continue;
        upsert.run(client_id, req.user.id, g.slate_number, g.wrapped_key, g.owner_wrapped_key || null, g.enc_content, g.enc_title || null);
        saved++;
      }
      return saved;
    });
    res.json({ success: true, saved: run(grants) });
  });

  // Upsert a re-wrapped slate blob (share, or refresh an existing share).
  // owner_wrapped_key (the content key wrapped to the user's own master key) is
  // optional but required for two-way sync — without it the client can't later
  // read edits the app makes. Writing here always marks last_writer = 'owner'
  // since the owner's content is authoritative at this moment.
  app.post('/api/account/slate-grants', deps.authenticateToken, (req, res) => {
    const { client_id, slate_number, wrapped_key, owner_wrapped_key, enc_content, enc_title } = req.body || {};
    if (!client_id || slate_number == null || !wrapped_key || !enc_content) {
      return res.status(400).json({ error: 'missing required fields' });
    }
    if ([wrapped_key, owner_wrapped_key, enc_content, enc_title].some(v => v != null && (typeof v !== 'string' || v.length > MAX_GRANT_BLOB))) {
      return res.status(413).json({ error: 'blob too large' });
    }
    if (!grantableClient(req.user.id, client_id)) {
      return res.status(403).json({ error: 'client not authorized for private slates' });
    }
    const slate = db.prepare('SELECT slate_number FROM slates WHERE slate_number = ? AND user_id = ?')
      .get(slate_number, req.user.id);
    if (!slate) return res.status(404).json({ error: 'slate not found' });

    db.prepare(`INSERT INTO oauth_slate_grants
        (client_id, user_id, slate_number, wrapped_key, owner_wrapped_key, enc_content, enc_title, last_writer, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'owner', strftime('%s','now'), strftime('%s','now'))
      ON CONFLICT(client_id, user_id, slate_number) DO UPDATE SET
        wrapped_key = excluded.wrapped_key,
        owner_wrapped_key = excluded.owner_wrapped_key,
        enc_content = excluded.enc_content,
        enc_title = excluded.enc_title,
        last_writer = 'owner',
        updated_at = strftime('%s','now')`).run(
      client_id, req.user.id, slate_number, wrapped_key, owner_wrapped_key || null, enc_content, enc_title || null
    );
    res.json({ success: true });
  });

  // Unshare one slate, or all slates, from an app.
  app.delete('/api/account/slate-grants', deps.authenticateToken, (req, res) => {
    const { client_id, slate_number } = req.body || {};
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    let result;
    if (slate_number == null) {
      result = db.prepare('DELETE FROM oauth_slate_grants WHERE user_id = ? AND client_id = ?')
        .run(req.user.id, client_id);
    } else {
      result = db.prepare('DELETE FROM oauth_slate_grants WHERE user_id = ? AND client_id = ? AND slate_number = ?')
        .run(req.user.id, client_id, slate_number);
    }
    res.json({ success: true, removed: result.changes });
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
