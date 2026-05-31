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

  // Normalize any stored timestamp to ISO8601 UTC ("…Z"), so every timestamp the
  // API returns is the same parseable format. Inputs vary by table: SQLite
  // CURRENT_TIMESTAMP ("2026-05-24 09:55:16", UTC) on slates; unix seconds
  // (strftime('%s')) on grants/drops. Returns null for null/empty/unparseable.
  const toIso = (v) => {
    if (v == null || v === '') return null;
    // Unix seconds (number or all-digit string).
    if (typeof v === 'number' || /^\d+$/.test(String(v))) {
      const d = new Date(Number(v) * 1000);
      return isNaN(d) ? null : d.toISOString();
    }
    const s = String(v);
    // SQLite datetime "YYYY-MM-DD HH:MM:SS" is UTC but lacks the T/Z markers.
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
    const d = new Date(normalized);
    return isNaN(d) ? null : d.toISOString();
  };

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
    // NOTE: client-level public_key is the deprecated single global app key. It is
    // no longer used for delegation — apps register a per-installation key via
    // POST /api/oauth/devices after authorization. Still accepted (validated) for
    // backward compatibility, but never required and never wrapped to.
    if (public_key && !validPublicKey(public_key)) {
      return res.status(400).json({ error: 'Invalid public key (expected base64 SPKI).' });
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

  // Resolve a user's relationship to an app: 'owner', a collaborator role
  // ('editor'/'viewer'), or null if they have no access. Used to gate every
  // client route below so shared collaborators get the access they were granted.
  const clientRoleFor = (clientId, userId) => {
    const owned = db.prepare('SELECT 1 FROM oauth_clients WHERE client_id = ? AND owner_user_id = ?').get(clientId, userId);
    if (owned) return 'owner';
    const collab = db.prepare('SELECT role FROM oauth_client_collaborators WHERE client_id = ? AND user_id = ?').get(clientId, userId);
    return collab ? collab.role : null;
  };

  // Serialize one client row for the portal, including the caller's role and the
  // owner's username (so shared apps can show "shared by @x").
  const serializeClient = (r, role) => ({
    client_id: r.client_id, name: r.name, website: r.website,
    redirect_uris: JSON.parse(r.redirect_uris || '[]'),
    scopes: (r.allowed_scopes || '').split(' ').filter(Boolean),
    is_confidential: !!r.is_confidential, has_public_key: !!r.public_key,
    created_at: r.created_at, role,
    owner_username: r.owner_username || null
  });

  app.get('/api/oauth/clients', deps.authenticateToken, (req, res) => {
    // Apps the user owns, plus apps shared with them as a collaborator.
    const owned = db.prepare(
      `SELECT c.*, u.username AS owner_username FROM oauth_clients c
       LEFT JOIN users u ON u.id = c.owner_user_id
       WHERE c.owner_user_id = ? ORDER BY c.created_at DESC`
    ).all(req.user.id);
    const shared = db.prepare(
      `SELECT c.*, u.username AS owner_username, col.role AS collab_role
       FROM oauth_client_collaborators col
       JOIN oauth_clients c ON c.client_id = col.client_id
       LEFT JOIN users u ON u.id = c.owner_user_id
       WHERE col.user_id = ? ORDER BY c.created_at DESC`
    ).all(req.user.id);
    res.json([
      ...owned.map(r => serializeClient(r, 'owner')),
      ...shared.map(r => serializeClient(r, r.collab_role || 'viewer'))
    ]);
  });

  // Edit an app's settings. Owners and editors may edit; viewers may not.
  app.patch('/api/oauth/clients/:clientId', deps.authenticateToken, (req, res) => {
    const role = clientRoleFor(req.params.clientId, req.user.id);
    if (!role) return res.status(404).json({ error: 'Client not found' });
    if (role === 'viewer') return res.status(403).json({ error: 'You have view-only access to this app.' });

    const { name, website, redirect_uris, scopes } = req.body || {};
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

    db.prepare(`UPDATE oauth_clients SET name = ?, website = ?, redirect_uris = ?, allowed_scopes = ? WHERE client_id = ?`)
      .run(name.trim(), website?.trim() || null, JSON.stringify(redirect_uris), requested.join(' '), req.params.clientId);

    const r = db.prepare(
      `SELECT c.*, u.username AS owner_username FROM oauth_clients c
       LEFT JOIN users u ON u.id = c.owner_user_id WHERE c.client_id = ?`
    ).get(req.params.clientId);
    res.json(serializeClient(r, role));
  });

  // --- collaborators (shared developer access) ----------------------------

  // List collaborators on an app. Anyone with access can see the team.
  app.get('/api/oauth/clients/:clientId/collaborators', deps.authenticateToken, (req, res) => {
    const role = clientRoleFor(req.params.clientId, req.user.id);
    if (!role) return res.status(404).json({ error: 'Client not found' });
    const owner = db.prepare(
      `SELECT u.id, u.username FROM oauth_clients c JOIN users u ON u.id = c.owner_user_id WHERE c.client_id = ?`
    ).get(req.params.clientId);
    const collabs = db.prepare(
      `SELECT col.user_id, col.role, col.created_at, u.username
       FROM oauth_client_collaborators col JOIN users u ON u.id = col.user_id
       WHERE col.client_id = ? ORDER BY col.created_at ASC`
    ).all(req.params.clientId);
    res.json({
      your_role: role,
      owner: owner ? { user_id: owner.id, username: owner.username, role: 'owner' } : null,
      collaborators: collabs.map(c => ({ user_id: c.user_id, username: c.username, role: c.role, created_at: c.created_at }))
    });
  });

  // Remove a collaborator (owner), or let a collaborator remove themselves.
  app.delete('/api/oauth/clients/:clientId/collaborators/:userId', deps.authenticateToken, (req, res) => {
    const role = clientRoleFor(req.params.clientId, req.user.id);
    if (!role) return res.status(404).json({ error: 'Client not found' });
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user.' });
    if (role !== 'owner' && targetId !== req.user.id) {
      return res.status(403).json({ error: 'Only the app owner can remove other collaborators.' });
    }
    db.prepare('DELETE FROM oauth_client_collaborators WHERE client_id = ? AND user_id = ?')
      .run(req.params.clientId, targetId);
    res.json({ success: true });
  });

  // --- invite links (share developer access by URL) -----------------------

  const INVITE_TTL = 30 * 24 * 3600; // 30 days

  // List active invite links for an app (owner only — they carry access).
  app.get('/api/oauth/clients/:clientId/invites', deps.authenticateToken, (req, res) => {
    const role = clientRoleFor(req.params.clientId, req.user.id);
    if (!role) return res.status(404).json({ error: 'Client not found' });
    if (role !== 'owner') return res.status(403).json({ error: 'Only the app owner can manage invite links.' });
    const rows = db.prepare(
      `SELECT token, role, created_at, expires_at FROM oauth_client_invites
       WHERE client_id = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC`
    ).all(req.params.clientId, now());
    res.json(rows.map(r => ({ token: r.token, role: r.role, created_at: r.created_at, expires_at: r.expires_at })));
  });

  // Generate a new invite link carrying a role. Owner only.
  app.post('/api/oauth/clients/:clientId/invites', deps.authenticateToken, (req, res) => {
    const role = clientRoleFor(req.params.clientId, req.user.id);
    if (!role) return res.status(404).json({ error: 'Client not found' });
    if (role !== 'owner') return res.status(403).json({ error: 'Only the app owner can create invite links.' });
    let { role: inviteRole } = req.body || {};
    if (!['editor', 'viewer'].includes(inviteRole)) inviteRole = 'editor';
    const token = randomToken(24);
    const expiresAt = now() + INVITE_TTL;
    db.prepare(
      `INSERT INTO oauth_client_invites (token, client_id, role, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(token, req.params.clientId, inviteRole, req.user.id, expiresAt);
    res.json({ token, role: inviteRole, expires_at: expiresAt });
  });

  // Revoke an invite link. Owner only.
  app.delete('/api/oauth/clients/:clientId/invites/:token', deps.authenticateToken, (req, res) => {
    const role = clientRoleFor(req.params.clientId, req.user.id);
    if (!role) return res.status(404).json({ error: 'Client not found' });
    if (role !== 'owner') return res.status(403).json({ error: 'Only the app owner can revoke invite links.' });
    db.prepare('UPDATE oauth_client_invites SET revoked = 1 WHERE token = ? AND client_id = ?')
      .run(req.params.token, req.params.clientId);
    res.json({ success: true });
  });

  // Preview an invite (any logged-in user): what app, who's inviting, what role.
  // Drives the "join app as collaborator?" onboarding screen.
  app.get('/api/oauth/invites/:token', deps.authenticateToken, (req, res) => {
    const inv = db.prepare(
      `SELECT i.*, c.name AS app_name, c.website AS app_website, c.owner_user_id, u.username AS owner_username
       FROM oauth_client_invites i
       JOIN oauth_clients c ON c.client_id = i.client_id
       LEFT JOIN users u ON u.id = c.owner_user_id
       WHERE i.token = ?`
    ).get(req.params.token);
    if (!inv || inv.revoked || (inv.expires_at && inv.expires_at <= now())) {
      return res.status(404).json({ error: 'This invite link is invalid or has expired.' });
    }
    const isOwner = inv.owner_user_id === req.user.id;
    const alreadyMember = !isOwner && !!db.prepare(
      'SELECT 1 FROM oauth_client_collaborators WHERE client_id = ? AND user_id = ?'
    ).get(inv.client_id, req.user.id);
    res.json({
      client_id: inv.client_id, app_name: inv.app_name, app_website: inv.app_website || null,
      owner_username: inv.owner_username || null, role: inv.role,
      is_owner: isOwner, already_member: alreadyMember
    });
  });

  // Accept an invite — onboard the caller as a collaborator with its role.
  app.post('/api/oauth/invites/:token/accept', deps.authenticateToken, (req, res) => {
    const inv = db.prepare('SELECT * FROM oauth_client_invites WHERE token = ?').get(req.params.token);
    if (!inv || inv.revoked || (inv.expires_at && inv.expires_at <= now())) {
      return res.status(404).json({ error: 'This invite link is invalid or has expired.' });
    }
    const owner = db.prepare('SELECT owner_user_id, name FROM oauth_clients WHERE client_id = ?').get(inv.client_id);
    if (!owner) return res.status(404).json({ error: 'This app no longer exists.' });
    if (owner.owner_user_id === req.user.id) {
      return res.status(400).json({ error: 'You own this app — you already have full access.' });
    }
    db.prepare(
      `INSERT INTO oauth_client_collaborators (client_id, user_id, role, added_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (client_id, user_id) DO UPDATE SET role = excluded.role`
    ).run(inv.client_id, req.user.id, inv.role, inv.created_by);
    res.json({ success: true, client_id: inv.client_id, app_name: owner.name, role: inv.role });
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
    // Deleting an app is owner-only — collaborators can't remove someone else's app.
    const client = db.prepare('SELECT id FROM oauth_clients WHERE client_id = ? AND owner_user_id = ?')
      .get(req.params.clientId, req.user.id);
    if (!client) {
      const role = clientRoleFor(req.params.clientId, req.user.id);
      if (role) return res.status(403).json({ error: 'Only the app owner can delete this app.' });
      return res.status(404).json({ error: 'Client not found' });
    }
    // Per-device wraps hang off this client's grants; clear them first (FK off).
    db.prepare(`DELETE FROM oauth_grant_device_wraps WHERE grant_id IN (
      SELECT id FROM oauth_slate_grants WHERE client_id = ?)`).run(req.params.clientId);
    db.prepare('DELETE FROM oauth_slate_grants WHERE client_id = ?').run(req.params.clientId);
    db.prepare('DELETE FROM oauth_device_keys WHERE client_id = ?').run(req.params.clientId);
    db.prepare('DELETE FROM oauth_tokens WHERE client_id = ?').run(req.params.clientId);
    db.prepare('DELETE FROM oauth_codes WHERE client_id = ?').run(req.params.clientId);
    db.prepare('DELETE FROM oauth_client_collaborators WHERE client_id = ?').run(req.params.clientId);
    db.prepare('DELETE FROM oauth_clients WHERE client_id = ?').run(req.params.clientId);
    res.json({ success: true });
  });

  // --- authorization endpoint --------------------------------------------

  app.get('/oauth/authorize', (req, res) => {
    sweepExpiredCodes();
    const { response_type, client_id, redirect_uri, scope, state,
            code_challenge, code_challenge_method,
            device_public_key, device_name } = req.query;

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

    // An app MAY supply its installation public key here so the device is registered
    // at consent — enabling consent-time wrapping (share-all wraps the library to this
    // key before the redirect) and instant reads. Only meaningful with private read.
    let devicePk = null;
    if (device_public_key && requested.includes('slates:read:private')) {
      if (!validPublicKey(device_public_key)) {
        return redirectError('invalid_request', 'device_public_key must be base64 SPKI (RSA-OAEP)');
      }
      if (device_name != null && (typeof device_name !== 'string' || device_name.length > 120)) {
        return redirectError('invalid_request', 'device_name too long (max 120)');
      }
      devicePk = device_public_key;
    }

    const user = getSessionUser(req);
    if (!user) {
      // Send the user through the familiar justtype sign-in / sign-up experience
      // (the SPA auth modal), then bring them straight back here to consent. The
      // return target is sealed inside a signed gate so it can't be tampered with
      // (no open redirect), and so login/register can skip the turnstile challenge
      // in this trusted, app-initiated context.
      const gate = jwt.sign(
        { purpose: 'oauth_login_gate', client_id, return_to: req.originalUrl },
        JWT_SECRET, { expiresIn: CONSENT_TTL }
      );
      const params = new URLSearchParams({ gate, app: client.name });
      return res.redirect('/login?' + params.toString());
    }

    // Signed, short-lived consent ticket binds this approval to the user + request
    // (including the device key, so /decide can register it as part of the approval).
    const ticket = jwt.sign({
      purpose: 'oauth_consent', uid: user.id, client_id,
      redirect_uri, scope: requested.join(' '), state: state || '',
      code_challenge, code_challenge_method: 'S256',
      device_pk: devicePk, device_name: devicePk ? (device_name || null) : null
    }, JWT_SECRET, { expiresIn: CONSENT_TTL });

    // Offer the inline "share all private slates" opt-in whenever private read is
    // requested. If the app supplied a device key, ticking it wraps the whole library
    // to that key during consent; otherwise it records intent and the user's client
    // wraps once the app registers an install.
    const grantable = requested.includes('slates:read:private');
    res.send(renderPage(`authorize ${client.name}`, consentPageBody(user, client, requested, ticket, grantable)));
  });

  // After a logged-out user signs in / signs up through the SPA auth modal (the
  // /login gate), the browser returns here. We verify the signed gate and bounce
  // back to the original /oauth/authorize request — now carrying a session cookie,
  // so the consent screen renders. The return target lives inside the signed gate,
  // so there is no open-redirect surface.
  app.get('/oauth/continue', (req, res) => {
    const { gate } = req.query;
    try {
      const t = jwt.verify(gate, JWT_SECRET);
      if (t.purpose !== 'oauth_login_gate' || !t.return_to) throw new Error('bad gate');
      if (!String(t.return_to).startsWith('/oauth/authorize')) throw new Error('bad return');
      return res.redirect(t.return_to);
    } catch {
      return res.status(400).send(renderPage('sign-in expired',
        '<h1>sign-in expired</h1><p class="sub">this sign-in step expired. please start again from the app.</p>'));
    }
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

    const scopeList = (t.scope || '').split(' ').filter(Boolean);
    const wantsPrivate = scopeList.includes('slates:read:private');

    // If the app supplied its installation key at /authorize, register it now as part
    // of this approval. The resulting device_id is stamped onto the authorization code
    // (and thus the token), so the app's reads resolve this install immediately.
    let deviceId = null;
    if (t.device_pk && wantsPrivate) {
      deviceId = upsertDevice(t.client_id, user.id, t.device_pk, 'rsa-oaep-sha256', t.device_name);
    }

    // Inline "allow full access": the user ticked share-all on the consent screen.
    // Record the intent (a verified approval) regardless.
    const wantsShareAll = req.body.share_all === '1' && wantsPrivate;
    if (wantsShareAll) {
      db.prepare(`INSERT INTO oauth_share_all (client_id, user_id) VALUES (?, ?)
        ON CONFLICT(client_id, user_id) DO NOTHING`).run(t.client_id, user.id);
    }

    // When share-all is ticked AND we have a device key to wrap to, detour through a
    // same-origin React page that wraps every private slate to that device key in the
    // browser (with the user's master key), then finalizes — minting the code last so
    // its 60s lifetime is unaffected by how long wrapping takes. The app therefore
    // sees its shared library the instant it exchanges the code. (If the browser is
    // locked, that page skips wrapping and still finalizes; intent is recorded, so the
    // library fills in on next unlock.) Without a device key we cannot wrap at consent,
    // so we mint the code directly and the client wraps once the app registers.
    if (wantsShareAll && deviceId) {
      const finalizeToken = jwt.sign({
        purpose: 'oauth_finalize', uid: user.id, client_id: t.client_id,
        redirect_uri: t.redirect_uri, scope: t.scope, state: t.state || '',
        code_challenge: t.code_challenge, code_challenge_method: t.code_challenge_method,
        device_id: deviceId
      }, JWT_SECRET, { expiresIn: CONSENT_TTL });
      const client = getClient(t.client_id);
      const share = new URL('/authorize/share', isProduction ? 'https://justtype.io' : 'http://localhost:3003');
      share.searchParams.set('t', finalizeToken);
      share.searchParams.set('client_id', t.client_id);
      share.searchParams.set('app', client ? client.name : 'the app');
      return res.redirect(share.toString());
    }

    const code = randomToken(32);
    db.prepare(`INSERT INTO oauth_codes
      (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, device_id, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      code, t.client_id, user.id, t.redirect_uri, t.scope,
      t.code_challenge, t.code_challenge_method, deviceId, now() + CODE_TTL
    );

    u.searchParams.set('code', code);
    res.redirect(u.toString());
  });

  // Finalize an authorization that detoured through the React share step (consent-time
  // wrapping). Verify the signed finalize token + the session, mint the one-time code
  // NOW (carrying the device_id so the token gets stamped), and return the app redirect
  // URL for the browser to follow. Minting here keeps the 60s code lifetime independent
  // of how long client-side wrapping took.
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
      (code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, device_id, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      code, t.client_id, user.id, t.redirect_uri, t.scope,
      t.code_challenge, t.code_challenge_method, t.device_id || null, now() + CODE_TTL
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
      // Carry the device registered at consent (if any) onto the token row, so the
      // app's reads resolve its installation immediately — no separate POST /devices.
      db.prepare(`INSERT INTO oauth_tokens
        (access_token_hash, refresh_token_hash, client_id, user_id, scope, device_id, access_expires_at, refresh_expires_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        sha256(accessToken), sha256(refreshToken), client_id, record.user_id,
        record.scope, record.device_id || null, now() + ACCESS_TTL, now() + REFRESH_TTL, now()
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
    // Resolve the calling INSTALL: the token row is stamped with a device_id when
    // the app registers a per-installation key (POST /api/oauth/devices). Reads use
    // this to return the wrap THIS device can decrypt. Null until a device registers,
    // or if the stamped device was revoked/removed.
    let deviceId = null;
    if (row.device_id) {
      const dev = db.prepare('SELECT device_id FROM oauth_device_keys WHERE device_id = ? AND client_id = ? AND user_id = ? AND revoked = 0')
        .get(row.device_id, row.client_id, row.user_id);
      if (dev) {
        deviceId = dev.device_id;
        db.prepare('UPDATE oauth_device_keys SET last_seen_at = ? WHERE device_id = ?').run(now(), deviceId);
      }
    }
    req.oauth = { userId: row.user_id, clientId: row.client_id, scopes, tokenId: row.id, deviceId };
    next();
  };

  // Guard for private-read/delegation endpoints: a registered device key is now
  // mandatory (no global app key). 409 tells the app to POST /api/oauth/devices.
  const requireDevice = (req, res) => {
    if (!req.oauth.deviceId) {
      res.status(409).json({
        error: 'needs_device',
        error_description: 'register an installation public key via POST /api/oauth/devices before reading or writing private slates'
      });
      return false;
    }
    return true;
  };

  // --- per-installation device keys ---------------------------------------
  //
  // Each install of an app registers its OWN RSA-OAEP public key (the matching
  // private key never leaves the device). This replaces the single global app key:
  // slates are wrapped per device, so extracting one install's key cannot decrypt
  // another user's — or even another install's — slates. Registration stamps the
  // calling token row, so subsequent reads resolve the device with no extra params.

  const mintDeviceId = () => 'dev_' + randomToken(16);

  // Validate a device public key + optional scheme/name. Returns an error string or null.
  const validateDeviceInput = (public_key, key_scheme, name) => {
    if (!validPublicKey(public_key)) return 'public_key (base64 SPKI RSA-OAEP) required';
    if (key_scheme && key_scheme !== 'rsa-oaep-sha256') return 'unsupported key_scheme (only rsa-oaep-sha256)';
    if (name != null && (typeof name !== 'string' || name.length > 120)) return 'name too long (max 120)';
    return null;
  };

  // Upsert an installation key for (clientId, userId), returning its device_id.
  // Idempotent on the key itself: the same public key reuses its device_id and is
  // un-revoked (a reinstall that kept its key keeps its access). Shared by the token
  // endpoint (POST /api/oauth/devices) and the consent flow (device registered at
  // /oauth/authorize, before any token exists).
  const upsertDevice = (clientId, userId, public_key, key_scheme, name) => {
    const existing = db.prepare('SELECT device_id FROM oauth_device_keys WHERE client_id = ? AND user_id = ? AND public_key = ?')
      .get(clientId, userId, public_key);
    if (existing) {
      db.prepare('UPDATE oauth_device_keys SET revoked = 0, last_seen_at = ?, name = COALESCE(?, name) WHERE device_id = ?')
        .run(now(), name || null, existing.device_id);
      return existing.device_id;
    }
    const deviceId = mintDeviceId();
    db.prepare(`INSERT INTO oauth_device_keys (device_id, client_id, user_id, public_key, key_scheme, name, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(deviceId, clientId, userId, public_key, key_scheme || 'rsa-oaep-sha256', name || null, now());
    return deviceId;
  };

  // Register (or re-assert) this installation's public key for the current grant.
  // Apps can also register at authorization time by passing device_public_key on
  // /oauth/authorize (see §6) — this endpoint is the post-token equivalent and the
  // way to add further installs / rotate keys.
  app.post('/api/oauth/devices', publicCors, authenticateOAuth('slates:read:private'), (req, res) => {
    const { public_key, key_scheme, name } = req.body || {};
    const bad = validateDeviceInput(public_key, key_scheme, name);
    if (bad) return res.status(400).json({ error: 'invalid_request', error_description: bad });
    const { userId, clientId, tokenId } = req.oauth;
    const deviceId = upsertDevice(clientId, userId, public_key, key_scheme, name);
    // Bind this device to the access-token row that registered it.
    db.prepare('UPDATE oauth_tokens SET device_id = ? WHERE id = ?').run(deviceId, tokenId);
    // Nudge any open justtype tab to wrap existing shared slates to this new key
    // now (closed clients reconcile on next unlock). Best-effort, content-free.
    if (dropHub) { try { dropHub.sendSse(userId, { type: 'reconcile' }); } catch {} }
    res.status(201).json({ device_id: deviceId, key_scheme: key_scheme || 'rsa-oaep-sha256' });
  });

  // List the installs registered under this grant (the caller is is_self).
  app.get('/api/oauth/devices', publicCors, authenticateOAuth('slates:read:private'), (req, res) => {
    const rows = db.prepare(`SELECT device_id, key_scheme, name, created_at, last_seen_at
      FROM oauth_device_keys WHERE client_id = ? AND user_id = ? AND revoked = 0 ORDER BY created_at ASC`)
      .all(req.oauth.clientId, req.oauth.userId);
    res.json(rows.map(r => ({
      device_id: r.device_id, key_scheme: r.key_scheme, name: r.name || null,
      created_at: toIso(r.created_at), last_seen_at: toIso(r.last_seen_at),
      is_self: r.device_id === req.oauth.deviceId
    })));
  });

  // Remove an install under this grant (the app de-registering itself or a sibling).
  // Future wraps stop and reads exclude it; existing wrap rows are dropped too.
  app.delete('/api/oauth/devices/:deviceId', publicCors, authenticateOAuth('slates:read:private'), (req, res) => {
    const dev = db.prepare('SELECT device_id FROM oauth_device_keys WHERE device_id = ? AND client_id = ? AND user_id = ?')
      .get(req.params.deviceId, req.oauth.clientId, req.oauth.userId);
    if (!dev) return res.status(404).json({ error: 'not_found' });
    db.prepare('UPDATE oauth_device_keys SET revoked = 1 WHERE device_id = ?').run(dev.device_id);
    db.prepare('DELETE FROM oauth_grant_device_wraps WHERE device_id = ?').run(dev.device_id);
    db.prepare('UPDATE oauth_tokens SET device_id = NULL WHERE device_id = ?').run(dev.device_id);
    res.json({ success: true });
  });

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
      created_at: toIso(s.created_at), updated_at: toIso(s.updated_at), published_at: toIso(s.published_at)
    })));
  });

  // Map a slate row to the meta shape used by both /slates and /sync.
  const metaRow = (s) => ({
    slate_number: s.slate_number,
    is_published: !!s.is_published,
    share_id: s.share_id || null,
    title: s.is_published ? s.title : null,
    title_encrypted: !s.is_published && !!s.encrypted_title,
    word_count: s.word_count, char_count: s.char_count,
    created_at: toIso(s.created_at), updated_at: toIso(s.updated_at), published_at: toIso(s.published_at)
  });

  // Incremental sync: return slates changed since a cursor, plus tombstones for
  // deletions, so a client propagates edits + deletes without re-listing every
  // slate. ?since=<ISO8601> is a cursor previously returned as `cursor`; omit it
  // for a full baseline (all current slates, no deletes). Results are capped and
  // paged via `has_more` + the advancing `cursor`. NOTE: timestamps are
  // second-resolution and the cursor is exclusive (>) — a client should treat
  // `changed` as upserts (idempotent) and may briefly re-see a boundary row.
  const SYNC_CAP = 500;
  app.get('/api/oauth/sync', publicCors, authenticateOAuth('slates:read:meta'), (req, res) => {
    const { since } = req.query;
    if (since != null && isNaN(new Date(since))) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'since must be an ISO8601 timestamp' });
    }
    try {
      const cols = `slate_number, is_published, share_id, word_count, char_count,
        created_at, updated_at, published_at, title, encrypted_title`;
      const changedRows = since
        ? db.prepare(`SELECT ${cols} FROM slates WHERE user_id = ? AND updated_at > datetime(?)
            ORDER BY updated_at ASC LIMIT ?`).all(req.oauth.userId, since, SYNC_CAP)
        : db.prepare(`SELECT ${cols} FROM slates WHERE user_id = ?
            ORDER BY updated_at ASC LIMIT ?`).all(req.oauth.userId, SYNC_CAP);
      const has_more = changedRows.length === SYNC_CAP;

      // A full baseline (no cursor) has no prior client state, so there is nothing
      // to reconcile deletes against — only incremental calls report tombstones.
      const delRows = since
        ? db.prepare(`SELECT slate_number, deleted_at FROM slate_tombstones
            WHERE user_id = ? AND deleted_at > CAST(strftime('%s', ?) AS INTEGER)
            ORDER BY deleted_at ASC LIMIT ?`).all(req.oauth.userId, since, SYNC_CAP)
        : [];

      // Cursor = the latest timestamp handed out, so the next call resumes after
      // it. Monotonic across both streams (ISO strings sort chronologically).
      const stamps = [];
      if (changedRows.length) stamps.push(toIso(changedRows[changedRows.length - 1].updated_at));
      if (delRows.length) stamps.push(toIso(delRows[delRows.length - 1].deleted_at));
      if (since) stamps.push(new Date(since).toISOString());
      const cursor = stamps.filter(Boolean).sort().pop() || new Date().toISOString();

      res.json({
        changed: changedRows.map(metaRow),
        deleted: delRows.map(d => ({ slate_number: d.slate_number, deleted_at: toIso(d.deleted_at) })),
        cursor,
        has_more
      });
    } catch (e) {
      console.error('oauth sync:', e);
      res.status(500).json({ error: 'server_error' });
    }
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
          created_at: toIso(s.created_at), updated_at: toIso(s.updated_at), published_at: toIso(s.published_at)
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

  // Placeholder b2_file_id for a create-already-delegated slate that has no
  // canonical (master-key) content yet. Replaced with a real B2 id when the
  // user's client adopts it in place. b2_file_id is NOT NULL, hence a sentinel.
  const PENDING_B2_SENTINEL = 'pending-adoption';

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

      res.status(201).json({ success: true, drop_id: Number(info.lastInsertRowid), status: 'pending_adoption' });
    } catch (e) {
      console.error('oauth slate drop:', e);
      res.status(500).json({ error: 'server_error' });
    }
  });

  // POST /api/oauth/slates/create-delegated — create a NEW private slate that is
  // ALREADY editable by the calling app, without waiting for the user to adopt it.
  // The app generates one fresh content key and wraps it to BOTH the user's public
  // key (wrapped_key_user — so the user can adopt it in place later) and its own
  // public key (wrapped_key_app — the content key wrapped to the CALLING install's
  // registered device key, so this install can read/edit now via the delegated
  // endpoints). A real, numbered slate is created in adoption_pending state; the
  // user's client re-keys it to their master key on next open. Requires BOTH
  // slates:create and slates:read:private, and a registered device key.
  app.post('/api/oauth/slates/create-delegated', publicCors, authenticateOAuth('slates:create'), (req, res) => {
    if (!scopeSatisfied(req.oauth.scopes, 'slates:read:private')) {
      return res.status(403).json({ error: 'insufficient_scope', error_description: 'requires scope: slates:read:private' });
    }
    if (!requireDevice(req, res)) return;
    const { wrapped_key_user, wrapped_key_app, enc_content, enc_title, word_count, char_count } = req.body || {};
    for (const [k, v] of [['wrapped_key_user', wrapped_key_user], ['wrapped_key_app', wrapped_key_app], ['enc_content', enc_content]]) {
      if (!v || typeof v !== 'string') {
        return res.status(400).json({ error: 'invalid_request', error_description: `${k} (base64 string) required` });
      }
    }
    for (const v of [wrapped_key_user, wrapped_key_app, enc_content, enc_title]) {
      if (v != null && (typeof v !== 'string' || v.length > MAX_GRANT_BLOB)) {
        return res.status(413).json({ error: 'blob too large' });
      }
    }
    try {
      const user = db.prepare('SELECT public_key FROM users WHERE id = ?').get(req.oauth.userId);
      if (!user || !user.public_key) {
        return res.status(409).json({ error: 'keypair_unavailable', error_description: 'the user has not published an encryption key yet; retry after they next open justtype' });
      }

      const wc = Number.isFinite(word_count) ? word_count : 0;
      const cc = Number.isFinite(char_count) ? char_count : 0;
      let slateNumber, dropId;
      db.transaction(() => {
        slateNumber = db.prepare('SELECT COALESCE(MAX(slate_number), 0) + 1 AS next FROM slates WHERE user_id = ?').get(req.oauth.userId).next;
        // Pending E2E slate: no canonical (master-key) content yet — b2_file_id is a
        // sentinel until the user's client adopts it in place.
        db.prepare(`INSERT INTO slates
          (user_id, slate_number, title, b2_file_id, word_count, char_count, size_bytes, encryption_version, source_app, adoption_pending)
          VALUES (?, ?, '', ?, ?, ?, 0, 1, ?, 1)`).run(
          req.oauth.userId, slateNumber, PENDING_B2_SENTINEL, wc, cc, req.oauth.clientId
        );
        // Linked drop carries the user-wrappable payload used to adopt in place.
        const info = db.prepare(`INSERT INTO oauth_slate_drops
          (client_id, user_id, wrapped_key, enc_content, enc_title, status, is_inplace, adopted_slate_number)
          VALUES (?, ?, ?, ?, ?, 'pending', 1, ?)`).run(
          req.oauth.clientId, req.oauth.userId, wrapped_key_user, enc_content, enc_title || null, slateNumber
        );
        dropId = Number(info.lastInsertRowid);
        // Grant holds the shared ciphertext; the per-device wrap (below) gives THIS
        // install immediate read/edit access. owner_wrapped_key is filled when the
        // user adopts (re-keys) the slate; other installs get their wrap on that
        // sync. wrapped_key is the dead legacy column → ''.
        // UPSERT as defense-in-depth: a freshly assigned MAX+1 slate_number is
        // strictly above every live slate, so any pre-existing grant for it is a
        // stale orphan and is safe to overwrite (matches the other grant writers).
        db.prepare(`INSERT INTO oauth_slate_grants
          (client_id, user_id, slate_number, wrapped_key, owner_wrapped_key, enc_content, enc_title, last_writer, created_at, updated_at)
          VALUES (?, ?, ?, '', NULL, ?, ?, 'app', strftime('%s','now'), strftime('%s','now'))
          ON CONFLICT(client_id, user_id, slate_number) DO UPDATE SET
            wrapped_key = '',
            owner_wrapped_key = NULL,
            enc_content = excluded.enc_content,
            enc_title = excluded.enc_title,
            last_writer = 'app',
            updated_at = strftime('%s','now')`).run(
          req.oauth.clientId, req.oauth.userId, slateNumber, enc_content, enc_title || null
        );
        const grantId = db.prepare('SELECT id FROM oauth_slate_grants WHERE client_id = ? AND user_id = ? AND slate_number = ?')
          .get(req.oauth.clientId, req.oauth.userId, slateNumber).id;
        // The app-wrapped content key for the calling install's device.
        db.prepare(`INSERT INTO oauth_grant_device_wraps (grant_id, device_id, wrapped_key, created_at, updated_at)
          VALUES (?, ?, ?, strftime('%s','now'), strftime('%s','now'))
          ON CONFLICT(grant_id, device_id) DO UPDATE SET wrapped_key = excluded.wrapped_key, updated_at = strftime('%s','now')`)
          .run(grantId, req.oauth.deviceId, wrapped_key_app);
      })();

      // Nudge any open client to adopt now (SSE/push). Best-effort, fire-and-forget.
      if (dropHub) { try { Promise.resolve(dropHub.notifyDrop(db, req.oauth.userId)).catch(() => {}); } catch {} }

      res.status(201).json({ success: true, slate_number: slateNumber, drop_id: dropId, status: 'pending_adoption' });
    } catch (e) {
      console.error('oauth create-delegated:', e);
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
    // Counts come from the drop rows' status column (drops are now kept as thin
    // receipts after adopt/discard, not deleted), so pending/delivered stay
    // consistent with GET /api/oauth/drops.
    const pendingRow = db.prepare(
      "SELECT COUNT(*) AS n, MAX(created_at) AS last FROM oauth_slate_drops WHERE client_id = ? AND user_id = ? AND status = 'pending'"
    ).get(clientId, userId);
    const deliveredRow = db.prepare(
      "SELECT COUNT(*) AS n, MAX(adopted_at) AS last FROM oauth_slate_drops WHERE client_id = ? AND user_id = ? AND status = 'adopted'"
    ).get(clientId, userId);
    const pending = pendingRow?.n || 0;
    res.json({
      keypair_ready: !!(user && user.public_key),
      public_key: user?.public_key || null,
      key_scheme: 'rsa-oaep-sha256',
      pending,
      delivered: deliveredRow?.n || 0,
      last_drop_at: toIso(pendingRow?.last),
      last_delivered_at: toIso(deliveredRow?.last),
      synced: pending === 0
    });
  });

  // Per-drop status, so an app learns when a note it pushed went live (and the
  // resulting slate_number) instead of content-hash guessing. Scoped to this app
  // + user; reveals no slate content. A drop row survives adoption/discard as a
  // thin receipt (its blobs are nulled), so this stays answerable afterwards.
  const dropReceipt = (r) => ({
    drop_id: r.id,
    status: r.status || 'pending',
    slate_number: r.adopted_slate_number ?? null,
    created_at: toIso(r.created_at),
    adopted_at: toIso(r.adopted_at),
    discarded_at: toIso(r.discarded_at)
  });

  app.get('/api/oauth/drops/:id', publicCors, authenticateOAuth('slates:create'), (req, res) => {
    const row = db.prepare(
      'SELECT id, status, adopted_slate_number, created_at, adopted_at, discarded_at FROM oauth_slate_drops WHERE id = ? AND client_id = ? AND user_id = ?'
    ).get(req.params.id, req.oauth.clientId, req.oauth.userId);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(dropReceipt(row));
  });

  // List this app's drops for the user, with status + resulting slate_number.
  // Optional ?status=pending|adopted|discarded filter. No slate content.
  app.get('/api/oauth/drops', publicCors, authenticateOAuth('slates:create'), (req, res) => {
    const { status } = req.query;
    if (status && !['pending', 'adopted', 'discarded'].includes(status)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'status must be pending, adopted, or discarded' });
    }
    const rows = status
      ? db.prepare("SELECT id, status, adopted_slate_number, created_at, adopted_at, discarded_at FROM oauth_slate_drops WHERE client_id = ? AND user_id = ? AND status = ? ORDER BY created_at DESC")
          .all(req.oauth.clientId, req.oauth.userId, status)
      : db.prepare("SELECT id, status, adopted_slate_number, created_at, adopted_at, discarded_at FROM oauth_slate_drops WHERE client_id = ? AND user_id = ? ORDER BY created_at DESC")
          .all(req.oauth.clientId, req.oauth.userId);
    res.json(rows.map(dropReceipt));
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
    if (!requireDevice(req, res)) return;
    const { enc_content, enc_title, word_count, char_count } = req.body || {};
    if (!enc_content || typeof enc_content !== 'string') {
      return res.status(400).json({ error: 'enc_content (base64 AES-256-GCM blob) required' });
    }
    if (enc_content.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'blob too large' });

    try {
      // Confirm this INSTALL was delegated the slate: a grant exists AND this
      // device holds a wrap for it. The content key is unchanged by an edit, so
      // every device wrap and the owner_wrapped_key stay valid.
      const grant = db.prepare(
        'SELECT id FROM oauth_slate_grants WHERE client_id = ? AND user_id = ? AND slate_number = ?'
      ).get(req.oauth.clientId, req.oauth.userId, req.params.n);
      if (!grant) return res.status(403).json({ error: 'this slate has not been shared with your app' });
      const hasWrap = db.prepare('SELECT 1 FROM oauth_grant_device_wraps WHERE grant_id = ? AND device_id = ?')
        .get(grant.id, req.oauth.deviceId);
      if (!hasWrap) return res.status(403).json({ error: 'this slate has not been re-wrapped to this installation yet' });

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

      // If the slate is still pending adoption (created via create-delegated), mirror
      // the new ciphertext into the linked drop so the user adopts the freshest
      // content. The content key is unchanged, so the user's wrapped_key (to their
      // key) still decrypts the new enc_content — only the AES blob changes.
      const slateRow = db.prepare('SELECT adoption_pending FROM slates WHERE slate_number = ? AND user_id = ?')
        .get(req.params.n, req.oauth.userId);
      if (slateRow && slateRow.adoption_pending) {
        db.prepare(`UPDATE oauth_slate_drops SET enc_content = ?, enc_title = ?
          WHERE client_id = ? AND user_id = ? AND adopted_slate_number = ? AND is_inplace = 1 AND status = 'pending'`).run(
          enc_content, enc_title || null, req.oauth.clientId, req.oauth.userId, req.params.n);
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

      // Drop per-device wraps before the grants they reference (FK not enforced),
      // so the tombstone trigger's grant cleanup can't leave them orphaned.
      db.prepare(`DELETE FROM oauth_grant_device_wraps WHERE grant_id IN (
        SELECT id FROM oauth_slate_grants WHERE user_id = ? AND slate_number = ?)`).run(req.oauth.userId, slate.slate_number);
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

  // List the private slates the user has delegated to THIS app, wrapped to the
  // calling INSTALL's device key. Only slates that have a wrap for this device are
  // listed; slates shared but not yet re-wrapped to this device (e.g. a freshly
  // registered install awaiting the user's next sync) are simply absent until then.
  app.get('/api/oauth/shared', publicCors, authenticateOAuth('slates:read:private'), (req, res) => {
    if (!requireDevice(req, res)) return;
    const rows = db.prepare(`SELECT g.slate_number, g.updated_at AS shared_at,
        w.wrapped_key, g.enc_title,
        s.word_count, s.char_count, s.created_at, s.updated_at
      FROM oauth_slate_grants g
      JOIN oauth_grant_device_wraps w ON w.grant_id = g.id AND w.device_id = ?
      JOIN slates s ON s.slate_number = g.slate_number AND s.user_id = g.user_id
      WHERE g.client_id = ? AND g.user_id = ? ORDER BY g.updated_at DESC`)
      .all(req.oauth.deviceId, req.oauth.clientId, req.oauth.userId);
    // wrapped_key + enc_title are included so a client can render the list with
    // real titles (unwrap the content key once, decrypt each enc_title) without
    // fetching every slate one by one. enc_content is omitted — use POST
    // /api/oauth/slates/batch for bodies.
    res.json(rows.map(r => ({
      slate_number: r.slate_number,
      shared_at: toIso(r.shared_at),
      key_scheme: 'rsa-oaep-sha256',
      content_scheme: 'aes-256-gcm',
      wrapped_key: r.wrapped_key,
      enc_title: r.enc_title || null,
      word_count: r.word_count, char_count: r.char_count,
      created_at: toIso(r.created_at), updated_at: toIso(r.updated_at)
    })));
  });

  // Shared read-view builder for one slate, used by both GET /slates/:n and the
  // batch read. Returns the response object (does not send). `grant` is the
  // calling app's delegation row for this slate (or null); `deviceWrap` is the
  // content key wrapped to the CALLING install's device key (or null if the slate
  // is shared but not yet re-wrapped to this device). includeEncrypted=false omits
  // the (potentially large) not-shared ciphertext blob — batch reads skip it since
  // an app cannot decrypt it anyway; the single GET keeps it for parity.
  const buildSlateView = async (slate, grant, deviceWrap, { includeEncrypted = false } = {}) => {
    const base = {
      slate_number: slate.slate_number,
      is_published: !!slate.is_published,
      share_id: slate.share_id || null,
      title: slate.is_published ? slate.title : null,
      word_count: slate.word_count, char_count: slate.char_count,
      created_at: toIso(slate.created_at), updated_at: toIso(slate.updated_at)
    };

    if (grant && deviceWrap) {
      // Delegated AND wrapped to this install: enc_content decrypts (with the
      // content key unwrapped from wrapped_key) to JSON { content, uploadedAt };
      // enc_title decrypts to the raw title string (null if untitled).
      return {
        ...base,
        delegated: true,
        key_scheme: 'rsa-oaep-sha256',
        content_scheme: 'aes-256-gcm',
        wrapped_key: deviceWrap.wrapped_key,
        enc_content: grant.enc_content,
        enc_title: grant.enc_title || null,
        shared_at: toIso(grant.updated_at)
      };
    }

    if (grant && !deviceWrap) {
      // Shared with the app, but no wrap exists for THIS install yet. The user's
      // client wraps to each registered device on its next save/sync; until then
      // this install cannot read it. Not an error — poll again after a sync.
      return {
        ...base,
        delegated: false,
        pending_device: true,
        note: 'this slate is shared with your app but has not been re-wrapped to this installation yet; it will appear after the user next syncs.'
      };
    }

    // Published slates are world-public plaintext anyway — return readable
    // content + title here too, so reads are uniform: one shape, content comes
    // back for anything the app may see (no branching on slate type).
    if (slate.is_published) {
      let content = null;
      try { content = await b2Storage.getSlate(slate.b2_public_file_id || slate.b2_file_id, null); } catch { content = null; }
      return { ...base, delegated: false, published: true, title: slate.title, content };
    }

    // Private + not delegated: owner-encrypted, unreadable by the app.
    const out = {
      ...base,
      delegated: false,
      title_encrypted: !slate.is_published && !!slate.encrypted_title,
      encrypted: true,
      note: 'this slate has not been shared with your app. ask the user to delegate it; otherwise it stays end-to-end encrypted and unreadable.'
    };
    if (includeEncrypted) {
      let raw = null;
      try { const buf = await b2Storage.downloadRawFile(slate.b2_file_id); raw = buf.toString('base64'); } catch { raw = null; }
      out.encrypted_content = raw;
    }
    return out;
  };

  // Single private slate. If the user delegated this slate to the calling app,
  // return the app-readable re-wrapped blob (decryptable with the app's private
  // key). Otherwise return the owner-encrypted ciphertext, which the app cannot
  // read — justtype stays zero-knowledge either way.
  app.get('/api/oauth/slates/:n', publicCors, authenticateOAuth('slates:read:private'), async (req, res) => {
    if (!requireDevice(req, res)) return;
    try {
      const slate = db.prepare('SELECT * FROM slates WHERE slate_number = ? AND user_id = ?')
        .get(req.params.n, req.oauth.userId);
      if (!slate) return res.status(404).json({ error: 'not_found' });
      const grant = db.prepare(
        'SELECT id, enc_content, enc_title, updated_at FROM oauth_slate_grants WHERE client_id = ? AND user_id = ? AND slate_number = ?'
      ).get(req.oauth.clientId, req.oauth.userId, slate.slate_number);
      const deviceWrap = grant
        ? db.prepare('SELECT wrapped_key FROM oauth_grant_device_wraps WHERE grant_id = ? AND device_id = ?')
            .get(grant.id, req.oauth.deviceId)
        : null;
      res.json(await buildSlateView(slate, grant, deviceWrap, { includeEncrypted: true }));
    } catch (e) {
      res.status(500).json({ error: 'server_error' });
    }
  });

  // Batch read: resolve many slates in one request so clients stop firing N
  // sequential GETs. Same per-slate shape as GET /slates/:n (delegated blob /
  // published plaintext / not-shared flag), minus the big ciphertext blob.
  // Published bodies are fetched from B2 with bounded concurrency.
  app.post('/api/oauth/slates/batch', publicCors, authenticateOAuth('slates:read:private'), async (req, res) => {
    if (!requireDevice(req, res)) return;
    const nums = req.body?.slate_numbers;
    if (!Array.isArray(nums) || nums.length === 0) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'slate_numbers (non-empty array) required' });
    }
    if (nums.length > 100) {
      return res.status(413).json({ error: 'too_many', error_description: 'max 100 slate_numbers per batch' });
    }
    try {
      const wanted = [...new Set(nums.map(Number).filter(n => Number.isInteger(n)))];
      if (wanted.length === 0) return res.json({ slates: [], missing: [] });
      const slates = db.prepare(
        `SELECT * FROM slates WHERE user_id = ? AND slate_number IN (${wanted.map(() => '?').join(',')})`
      ).all(req.oauth.userId, ...wanted);
      const found = new Map(slates.map(s => [s.slate_number, s]));
      const missing = wanted.filter(n => !found.has(n));
      const grants = db.prepare(
        `SELECT id, slate_number, enc_content, enc_title, updated_at FROM oauth_slate_grants
         WHERE client_id = ? AND user_id = ? AND slate_number IN (${wanted.map(() => '?').join(',')})`
      ).all(req.oauth.clientId, req.oauth.userId, ...wanted);
      const grantBy = new Map(grants.map(g => [g.slate_number, g]));
      // This install's wrap for each shared slate (keyed by grant id).
      const grantIds = grants.map(g => g.id);
      const wraps = grantIds.length
        ? db.prepare(`SELECT grant_id, wrapped_key FROM oauth_grant_device_wraps
            WHERE device_id = ? AND grant_id IN (${grantIds.map(() => '?').join(',')})`)
            .all(req.oauth.deviceId, ...grantIds)
        : [];
      const wrapByGrant = new Map(wraps.map(w => [w.grant_id, w]));

      // Bounded concurrency so a big batch of published slates doesn't open 100
      // simultaneous B2 reads. Mirrors the share-all concurrency approach.
      const out = [];
      const queue = [...slates];
      const worker = async () => {
        while (queue.length) {
          const slate = queue.shift();
          const grant = grantBy.get(slate.slate_number) || null;
          const deviceWrap = grant ? (wrapByGrant.get(grant.id) || null) : null;
          out.push(await buildSlateView(slate, grant, deviceWrap, { includeEncrypted: false }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(10, slates.length) }, worker));
      out.sort((a, b) => a.slate_number - b.slate_number);
      res.json({ slates: out, missing });
    } catch (e) {
      console.error('oauth batch read:', e);
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
      const deviceCount = db.prepare('SELECT COUNT(*) AS n FROM oauth_device_keys WHERE client_id = ? AND user_id = ? AND revoked = 0')
        .get(r.client_id, req.user.id).n;
      return {
        client_id: r.client_id, name: r.name, website: r.website,
        scopes,
        // Sharing needs the private scope AND at least one registered installation
        // key to wrap to. device_count = 0 means "authorized but no app install has
        // connected a device yet"; sharing applies once one does.
        can_share: scopes.includes('slates:read:private') && deviceCount > 0,
        device_count: deviceCount,
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
    // (per-slate grants + their per-device wraps, registered device keys, and any
    // blanket "share all" relationship). Delete wraps first (FK is not enforced).
    db.prepare(`DELETE FROM oauth_grant_device_wraps WHERE grant_id IN (
      SELECT id FROM oauth_slate_grants WHERE user_id = ? AND client_id = ?)`).run(req.user.id, client_id);
    db.prepare('DELETE FROM oauth_slate_grants WHERE user_id = ? AND client_id = ?').run(req.user.id, client_id);
    db.prepare('DELETE FROM oauth_device_keys WHERE user_id = ? AND client_id = ?').run(req.user.id, client_id);
    db.prepare('DELETE FROM oauth_share_all WHERE user_id = ? AND client_id = ?').run(req.user.id, client_id);
    // NOTE: we deliberately do NOT delete pending oauth_slate_drops here. A drop is
    // encrypted to the USER's key, not the app's, so revoking the app never locks
    // the user out of it. The user keeps any un-adopted drops and can adopt or
    // discard them on their own schedule — revocation must never cost a note.
    res.json({ success: true, revoked: result.changes });
  });

  // The installations (device keys) a connected app has registered, for the
  // Account UI ("connected devices"). Read-only view of oauth_device_keys.
  app.get('/api/account/connected-apps/:clientId/devices', deps.authenticateToken, (req, res) => {
    const rows = db.prepare(`SELECT device_id, key_scheme, name, created_at, last_seen_at
      FROM oauth_device_keys WHERE client_id = ? AND user_id = ? AND revoked = 0 ORDER BY created_at ASC`)
      .all(req.params.clientId, req.user.id);
    res.json(rows.map(r => ({
      device_id: r.device_id, key_scheme: r.key_scheme, name: r.name || null,
      created_at: r.created_at, last_seen_at: r.last_seen_at
    })));
  });

  // Remove one installation the user no longer trusts. Drops its key + wraps; that
  // install loses access going forward (it can re-register if reinstalled).
  app.delete('/api/account/connected-apps/:clientId/devices/:deviceId', deps.authenticateToken, (req, res) => {
    const dev = db.prepare('SELECT device_id FROM oauth_device_keys WHERE device_id = ? AND client_id = ? AND user_id = ?')
      .get(req.params.deviceId, req.params.clientId, req.user.id);
    if (!dev) return res.status(404).json({ error: 'device not found' });
    db.prepare('UPDATE oauth_device_keys SET revoked = 1 WHERE device_id = ?').run(dev.device_id);
    db.prepare('DELETE FROM oauth_grant_device_wraps WHERE device_id = ?').run(dev.device_id);
    db.prepare('UPDATE oauth_tokens SET device_id = NULL WHERE device_id = ?').run(dev.device_id);
    res.json({ success: true });
  });

  // --- private-slate delegation (key re-wrapping), owner-driven -----------
  // The browser does all crypto; these endpoints only move opaque blobs.

  const MAX_GRANT_BLOB = 8 * 1024 * 1024; // 8MB base64 ceiling per field

  // The active per-installation device keys an app has registered under this grant.
  // Wrapping targets these (one wrap per device); empty until an install connects.
  const activeDeviceKeys = (userId, clientId) =>
    db.prepare(`SELECT device_id, public_key, key_scheme, name FROM oauth_device_keys
      WHERE client_id = ? AND user_id = ? AND revoked = 0 ORDER BY created_at ASC`)
      .all(clientId, userId);

  // Confirm the user has actually authorized this client with the private scope.
  // (No client public-key requirement anymore — wrap targets are the per-install
  // device keys, fetched separately via activeDeviceKeys.) Returns client or null.
  const grantableClient = (userId, clientId) => {
    const client = db.prepare('SELECT client_id, name FROM oauth_clients WHERE client_id = ?').get(clientId);
    if (!client) return null;
    // Authorized to receive grants if a live token carries the private scope...
    const tok = db.prepare(`SELECT scope FROM oauth_tokens
      WHERE user_id = ? AND client_id = ? AND revoked = 0 AND refresh_expires_at > ?
      ORDER BY created_at DESC LIMIT 1`).get(userId, clientId, now());
    const tokenOk = tok && (tok.scope || '').split(' ').includes('slates:read:private');
    // ...OR the user recorded a share-all intent at consent time. That row is only
    // written after a verified private-scope approval, so its presence implies
    // authorization (and lets the client begin wrapping as soon as a device exists).
    const intentOk = !!db.prepare('SELECT 1 FROM oauth_share_all WHERE client_id = ? AND user_id = ?')
      .get(clientId, userId);
    if (!tokenOk && !intentOk) return null;
    return client;
  };

  // The app's active device keys + which slates are shared and which device(s)
  // each is already wrapped to (so the client only fills coverage gaps). share_all
  // reflects blanket access. device_keys may be empty (app hasn't connected a
  // device yet); the client should show "waiting for the app to connect".
  app.get('/api/account/slate-grants/:clientId', deps.authenticateToken, (req, res) => {
    const client = grantableClient(req.user.id, req.params.clientId);
    if (!client) return res.status(404).json({ error: 'not_grantable' });
    const deviceKeys = activeDeviceKeys(req.user.id, req.params.clientId);
    const grants = db.prepare('SELECT id, slate_number, updated_at FROM oauth_slate_grants WHERE client_id = ? AND user_id = ?')
      .all(req.params.clientId, req.user.id);
    // Which device_ids already cover each grant (for gap-only re-wrapping).
    const cover = grants.length
      ? db.prepare(`SELECT w.grant_id, w.device_id FROM oauth_grant_device_wraps w
          WHERE w.grant_id IN (${grants.map(() => '?').join(',')})`).all(...grants.map(g => g.id))
      : [];
    const coverBy = new Map();
    for (const c of cover) {
      if (!coverBy.has(c.grant_id)) coverBy.set(c.grant_id, []);
      coverBy.get(c.grant_id).push(c.device_id);
    }
    const shareAll = !!db.prepare('SELECT 1 FROM oauth_share_all WHERE client_id = ? AND user_id = ?')
      .get(req.params.clientId, req.user.id);
    res.json({
      client_id: client.client_id,
      name: client.name,
      device_keys: deviceKeys,
      share_all: shareAll,
      shared: grants.map(g => ({
        slate_number: g.slate_number, updated_at: g.updated_at,
        device_ids: coverBy.get(g.id) || []
      }))
    });
  });

  // Which apps a given slate must be kept in sync with (+ their device keys) —
  // used on save (push) and on open (pull). Includes apps with an explicit grant
  // for this slate AND apps the user gave "share all" access (so newly written
  // slates auto-share), restricted to apps that have at least one active device key
  // to wrap to. For apps that already hold a grant, the stored blobs + last_writer
  // come along so the client can pull edits the app made (last_writer = 'app') back
  // into the canonical slate. Revoked/expired apps are excluded.
  app.get('/api/account/slate-grants/by-slate/:n', deps.authenticateToken, (req, res) => {
    const rows = db.prepare(`
      SELECT c.client_id, c.name,
             g.id AS grant_id, g.enc_content, g.enc_title, g.owner_wrapped_key, g.last_writer
      FROM oauth_clients c
      LEFT JOIN oauth_slate_grants g
        ON g.client_id = c.client_id AND g.user_id = ? AND g.slate_number = ?
      WHERE (g.id IS NOT NULL
             OR c.client_id IN (SELECT client_id FROM oauth_share_all WHERE user_id = ?))
        AND c.client_id IN (
          SELECT client_id FROM oauth_tokens
          WHERE user_id = ? AND revoked = 0 AND refresh_expires_at > ?
        )
        AND EXISTS (SELECT 1 FROM oauth_device_keys d
          WHERE d.client_id = c.client_id AND d.user_id = ? AND d.revoked = 0)
    `).all(req.user.id, req.params.n, req.user.id, req.user.id, now(), req.user.id);
    res.json(rows.map(r => ({
      client_id: r.client_id, name: r.name,
      device_keys: activeDeviceKeys(req.user.id, r.client_id),
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
    // Drop the per-device wraps before the grants they hang off (FK not enforced).
    db.prepare(`DELETE FROM oauth_grant_device_wraps WHERE grant_id IN (
      SELECT id FROM oauth_slate_grants WHERE client_id = ? AND user_id = ?)`).run(client_id, req.user.id);
    const r = db.prepare('DELETE FROM oauth_slate_grants WHERE client_id = ? AND user_id = ?').run(client_id, req.user.id);
    res.json({ success: true, removed: r.changes });
  });

  // Upsert a grant + its per-device wraps. The content key is wrapped once per
  // active device (device_wraps:[{device_id, wrapped_key}]); the shared ciphertext
  // (enc_content/enc_title) and owner_wrapped_key live on the grant row. Returns
  // the resolved grant id so callers can correlate. last_writer = 'owner'.
  // Helper shared by the single + batch endpoints. Skips device_ids that aren't an
  // active key of this client+user (so a client can't write to arbitrary devices).
  const upsertGrantStmt = db.prepare(`INSERT INTO oauth_slate_grants
      (client_id, user_id, slate_number, wrapped_key, owner_wrapped_key, enc_content, enc_title, last_writer, created_at, updated_at)
    VALUES (?, ?, ?, '', ?, ?, ?, 'owner', strftime('%s','now'), strftime('%s','now'))
    ON CONFLICT(client_id, user_id, slate_number) DO UPDATE SET
      owner_wrapped_key = excluded.owner_wrapped_key,
      enc_content = excluded.enc_content,
      enc_title = excluded.enc_title,
      last_writer = 'owner',
      updated_at = strftime('%s','now')`);
  const upsertWrapStmt = db.prepare(`INSERT INTO oauth_grant_device_wraps (grant_id, device_id, wrapped_key, created_at, updated_at)
    VALUES (?, ?, ?, strftime('%s','now'), strftime('%s','now'))
    ON CONFLICT(grant_id, device_id) DO UPDATE SET wrapped_key = excluded.wrapped_key, updated_at = strftime('%s','now')`);
  const writeGrant = (clientId, userId, g, validDeviceIds) => {
    upsertGrantStmt.run(clientId, userId, g.slate_number, g.owner_wrapped_key || null, g.enc_content, g.enc_title || null);
    const grantId = db.prepare('SELECT id FROM oauth_slate_grants WHERE client_id = ? AND user_id = ? AND slate_number = ?')
      .get(clientId, userId, g.slate_number).id;
    for (const w of (g.device_wraps || [])) {
      if (w && w.device_id && w.wrapped_key && validDeviceIds.has(w.device_id)) {
        upsertWrapStmt.run(grantId, w.device_id, w.wrapped_key);
      }
    }
  };
  const validGrantBlob = (g) =>
    [g.owner_wrapped_key, g.enc_content, g.enc_title].every(v => v == null || (typeof v === 'string' && v.length <= MAX_GRANT_BLOB))
    && Array.isArray(g.device_wraps)
    && g.device_wraps.every(w => w && typeof w.device_id === 'string' && typeof w.wrapped_key === 'string' && w.wrapped_key.length <= MAX_GRANT_BLOB);

  // Bulk upsert many re-wrapped grants in a single transaction — used when sharing
  // all slates, so the client makes one request per batch instead of one per slate.
  // Each entry: { slate_number, enc_content, enc_title?, owner_wrapped_key?,
  // device_wraps:[{device_id, wrapped_key}] }. Slates the user doesn't own are skipped.
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
      if (!g || g.slate_number == null || !g.enc_content || !Array.isArray(g.device_wraps)) {
        return res.status(400).json({ error: 'each grant needs slate_number, enc_content, device_wraps[]' });
      }
      if (!validGrantBlob(g)) return res.status(413).json({ error: 'blob too large or malformed device_wraps' });
    }
    const owned = new Set(db.prepare('SELECT slate_number FROM slates WHERE user_id = ?').all(req.user.id).map(r => r.slate_number));
    const validDeviceIds = new Set(activeDeviceKeys(req.user.id, client_id).map(d => d.device_id));
    const run = db.transaction((rows) => {
      let saved = 0;
      for (const g of rows) {
        if (!owned.has(Number(g.slate_number))) continue;
        writeGrant(client_id, req.user.id, g, validDeviceIds);
        saved++;
      }
      return saved;
    });
    res.json({ success: true, saved: run(grants), devices: validDeviceIds.size });
  });

  // Upsert one re-wrapped slate (share, or refresh an existing share).
  // owner_wrapped_key (the content key wrapped to the user's own master key) is
  // optional but required for two-way sync — without it the client can't later read
  // edits the app makes. device_wraps[] carries the content key wrapped per install.
  app.post('/api/account/slate-grants', deps.authenticateToken, (req, res) => {
    const { client_id, slate_number, owner_wrapped_key, enc_content, enc_title, device_wraps } = req.body || {};
    if (!client_id || slate_number == null || !enc_content || !Array.isArray(device_wraps)) {
      return res.status(400).json({ error: 'missing required fields (client_id, slate_number, enc_content, device_wraps[])' });
    }
    if (!validGrantBlob({ owner_wrapped_key, enc_content, enc_title, device_wraps })) {
      return res.status(413).json({ error: 'blob too large or malformed device_wraps' });
    }
    if (!grantableClient(req.user.id, client_id)) {
      return res.status(403).json({ error: 'client not authorized for private slates' });
    }
    const slate = db.prepare('SELECT slate_number FROM slates WHERE slate_number = ? AND user_id = ?')
      .get(slate_number, req.user.id);
    if (!slate) return res.status(404).json({ error: 'slate not found' });

    const validDeviceIds = new Set(activeDeviceKeys(req.user.id, client_id).map(d => d.device_id));
    db.transaction(() => writeGrant(client_id, req.user.id,
      { slate_number, owner_wrapped_key, enc_content, enc_title, device_wraps }, validDeviceIds))();
    res.json({ success: true, devices: validDeviceIds.size });
  });

  // Unshare one slate, or all slates, from an app. Drops per-device wraps first.
  app.delete('/api/account/slate-grants', deps.authenticateToken, (req, res) => {
    const { client_id, slate_number } = req.body || {};
    if (!client_id) return res.status(400).json({ error: 'client_id required' });
    let result;
    if (slate_number == null) {
      db.prepare(`DELETE FROM oauth_grant_device_wraps WHERE grant_id IN (
        SELECT id FROM oauth_slate_grants WHERE user_id = ? AND client_id = ?)`).run(req.user.id, client_id);
      result = db.prepare('DELETE FROM oauth_slate_grants WHERE user_id = ? AND client_id = ?')
        .run(req.user.id, client_id);
    } else {
      db.prepare(`DELETE FROM oauth_grant_device_wraps WHERE grant_id IN (
        SELECT id FROM oauth_slate_grants WHERE user_id = ? AND client_id = ? AND slate_number = ?)`).run(req.user.id, client_id, slate_number);
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
      // Tombstone retention: ~90 days. Clients offline longer must full re-list.
      db.prepare('DELETE FROM slate_tombstones WHERE deleted_at < ?').run(t - 90 * 24 * 3600);
    } catch {}
  }, 60 * 60 * 1000).unref?.();

  console.log('✓ OAuth provider routes mounted');
}

module.exports = { mountOAuth, SCOPES };
