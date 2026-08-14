// E2EE collaborative slates: membership + per-member wrapped doc keys.
//
// A collaborative slate's content is encrypted under a random 32-byte DOC KEY
// generated in the owner's browser, never seen by the server. Each member row
// holds that doc key wrapped for that member:
//   - wrapped_key:        AES-256-GCM under the member's master key (usable copy,
//                         set by the member's own client on accept / by the owner
//                         for their own row on enable)
//   - invite_wrapped_key: RSA-OAEP under the member's public key (users.public_key,
//                         from the drop-box feature) while the invite is pending
// The server stores ciphertext and opaque wrapped keys only; the ACL itself
// (who collaborates on which slate) is plain server-side by design (v1).
//
// v1 rule: a slate is app-shared (oauth_slate_grants) XOR collaborative — the
// grant sync paths assume a single-writer owner-canonical slate. Enforced here
// on enable and in oauth.js at grant-creation time.
//
// Revocation is doc-key rotation (see /collab/rotate): the owner re-keys the
// slate, re-wraps for everyone who stays, and the epoch guard locks the old
// key out of the relay. Invite links carry the doc key in the URL FRAGMENT —
// the server stores only a hash of the link token and never sees the key.

const nodeCrypto = require('crypto');

function mountCollab(app, deps) {
  const {
    db, b2Storage, authenticateToken, createRateLimitMiddleware,
    decodeBase64Strict, B2Error, collabHub
  } = deps;

  const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
  const MAX_MEMBERS = 10;
  const LINK_TTL_SECONDS = 7 * 24 * 3600;

  const hashToken = (token) => nodeCrypto.createHash('sha256').update(String(token)).digest('hex');
  const getLinkBySlate = db.prepare('SELECT * FROM collab_link_invites WHERE slate_id = ?');
  const findValidLink = (token) => {
    const row = db.prepare('SELECT * FROM collab_link_invites WHERE token_hash = ?').get(hashToken(token));
    if (!row) return null;
    if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
    return row;
  };

  const getUser = db.prepare('SELECT id, username, e2e_migrated, public_key FROM users WHERE id = ?');
  const getUserByName = db.prepare('SELECT id, username, e2e_migrated, public_key FROM users WHERE username = ?');
  const getOwnSlate = db.prepare('SELECT * FROM slates WHERE slate_number = ? AND user_id = ?');
  const getMember = db.prepare('SELECT * FROM collab_members WHERE slate_id = ? AND user_id = ?');
  const countMembers = db.prepare('SELECT COUNT(*) AS n FROM collab_members WHERE slate_id = ?');
  const hasAppGrant = db.prepare('SELECT id FROM oauth_slate_grants WHERE user_id = ? AND slate_number = ?');

  const b2ErrorResponse = (res, error, fallback) => {
    if (B2Error && error instanceof B2Error) {
      return res.status(error.code === 'B2_RATE_LIMIT' ? 429 : 500).json({
        error: error.userMessage, code: error.code
      });
    }
    return res.status(500).json({ error: fallback });
  };

  // Decode and size-check a client-encrypted blob, or send the error response.
  // Returns the Buffer, or null if a response was already sent.
  const decodeBlob = (res, encryptedContent) => {
    if (typeof encryptedContent !== 'string' || !encryptedContent.trim()) {
      res.status(400).json({ error: 'Encrypted content required', code: 'E2E_PLAINTEXT_REJECTED' });
      return null;
    }
    try {
      return decodeBase64Strict(encryptedContent, { maxBytes: MAX_CONTENT_BYTES });
    } catch (err) {
      if (err && err.code === 'BASE64_TOO_LARGE') {
        res.status(413).json({ error: 'Content too large. Maximum size is 5 MB.' });
      } else {
        res.status(400).json({ error: 'Invalid encrypted content', code: 'E2E_INVALID_CONTENT' });
      }
      return null;
    }
  };

  // Look up a user's sharing key by username. Same 404 for "no such user" and
  // "user can't receive shares" so the endpoint doesn't confirm which usernames
  // exist beyond what sharing itself requires.
  app.get('/api/users/:username/public-key', authenticateToken, createRateLimitMiddleware('collabLookup'), (req, res) => {
    try {
      const target = getUserByName.get(String(req.params.username || '').toLowerCase().trim());
      if (!target || !target.e2e_migrated || !target.public_key) {
        return res.status(404).json({ error: 'User not available for sharing' });
      }
      res.json({ username: target.username, public_key: target.public_key });
    } catch (error) {
      console.error('Collab public-key lookup error:', error);
      res.status(500).json({ error: 'Lookup failed' });
    }
  });

  // Enable collaboration on an owned slate. The client re-encrypts the current
  // content + title under a fresh doc key and sends them with the doc key
  // wrapped to the owner's master key; the swap is atomic from the DB's view.
  app.post('/api/slates/:id/collab/enable', authenticateToken, createRateLimitMiddleware('collabEnable'), async (req, res) => {
    const { ownerWrappedKey, encryptedContent, encryptedTitle, wordCount, charCount } = req.body || {};
    try {
      const user = getUser.get(req.user.id);
      if (!user || !user.e2e_migrated) {
        return res.status(403).json({ error: 'Collaboration requires end-to-end encryption on your account', code: 'COLLAB_E2E_REQUIRED' });
      }
      const slate = getOwnSlate.get(req.params.id, req.user.id);
      if (!slate) return res.status(404).json({ error: 'Slate not found' });
      if (slate.is_system_slate) return res.status(403).json({ error: 'System slates cannot be shared' });
      if (slate.adoption_pending) return res.status(409).json({ error: 'Slate is pending adoption' });
      if (slate.is_collab) return res.status(409).json({ error: 'Slate is already collaborative' });
      if (hasAppGrant.get(req.user.id, slate.slate_number)) {
        return res.status(409).json({ error: 'This slate is shared with an app. Un-share it there first — a slate cannot be app-shared and collaborative at once.', code: 'COLLAB_APP_SHARED' });
      }
      if (typeof ownerWrappedKey !== 'string' || !ownerWrappedKey.trim()) {
        return res.status(400).json({ error: 'Wrapped doc key required' });
      }
      if (typeof encryptedTitle !== 'string' || !encryptedTitle.trim()) {
        return res.status(400).json({ error: 'Encrypted title required', code: 'E2E_TITLE_REQUIRED' });
      }
      const blob = decodeBlob(res, encryptedContent);
      if (!blob) return;

      const newFileId = await b2Storage.uploadRawSlate(`${req.user.id}-${Date.now()}`, blob);
      const oldFileId = slate.b2_file_id;

      db.transaction(() => {
        db.prepare(`
          UPDATE slates SET is_collab = 1, b2_file_id = ?, encrypted_title = ?, word_count = ?, char_count = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newFileId, encryptedTitle, wordCount || slate.word_count || 0, charCount || slate.char_count || 0, blob.length, slate.id);
        db.prepare(`
          INSERT INTO collab_members (slate_id, user_id, role, status, wrapped_key, invited_by, accepted_at)
          VALUES (?, ?, 'owner', 'accepted', ?, ?, strftime('%s','now'))
        `).run(slate.id, req.user.id, ownerWrappedKey, req.user.id);
      })();

      if (oldFileId && oldFileId !== newFileId) {
        try { await b2Storage.deleteSlate(oldFileId); } catch (err) { console.warn('Failed to delete old B2 file:', err); }
      }
      res.json({ success: true, slate_id: slate.id });
    } catch (error) {
      console.error('Collab enable error:', error);
      b2ErrorResponse(res, error, 'Failed to enable collaboration');
    }
  });

  // Disable collaboration: the owner re-encrypts content + title back under
  // their master key; every membership row is dropped.
  app.delete('/api/slates/:id/collab', authenticateToken, createRateLimitMiddleware('collabEnable'), async (req, res) => {
    const { encryptedContent, encryptedTitle } = req.body || {};
    try {
      const slate = getOwnSlate.get(req.params.id, req.user.id);
      if (!slate) return res.status(404).json({ error: 'Slate not found' });
      if (!slate.is_collab) return res.status(409).json({ error: 'Slate is not collaborative' });
      if (typeof encryptedTitle !== 'string' || !encryptedTitle.trim()) {
        return res.status(400).json({ error: 'Encrypted title required', code: 'E2E_TITLE_REQUIRED' });
      }
      const blob = decodeBlob(res, encryptedContent);
      if (!blob) return;

      const newFileId = await b2Storage.uploadRawSlate(`${req.user.id}-${Date.now()}`, blob);
      const oldFileId = slate.b2_file_id;
      const docRow = db.prepare('SELECT snapshot_b2_file_id FROM collab_docs WHERE slate_id = ?').get(slate.id);

      db.transaction(() => {
        db.prepare(`
          UPDATE slates SET is_collab = 0, b2_file_id = ?, encrypted_title = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newFileId, encryptedTitle, blob.length, slate.id);
        db.prepare('DELETE FROM collab_members WHERE slate_id = ?').run(slate.id);
        db.prepare('DELETE FROM collab_updates WHERE slate_id = ?').run(slate.id);
        db.prepare('DELETE FROM collab_docs WHERE slate_id = ?').run(slate.id);
        db.prepare('DELETE FROM collab_link_invites WHERE slate_id = ?').run(slate.id);
      })();

      if (collabHub) collabHub.closeRoom(slate.id);
      if (oldFileId && oldFileId !== newFileId) {
        try { await b2Storage.deleteSlate(oldFileId); } catch (err) { console.warn('Failed to delete old B2 file:', err); }
      }
      if (docRow && docRow.snapshot_b2_file_id) {
        try { await b2Storage.deleteSlate(docRow.snapshot_b2_file_id); } catch (err) { console.warn('Failed to delete snapshot B2 file:', err); }
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Collab disable error:', error);
      b2ErrorResponse(res, error, 'Failed to disable collaboration');
    }
  });

  // Invite a user by username. The owner's client has already wrapped the doc
  // key to the invitee's RSA public key; the server just records the invite.
  app.post('/api/slates/:id/collab/invites', authenticateToken, createRateLimitMiddleware('collabInvite'), (req, res) => {
    const { username, inviteWrappedKey } = req.body || {};
    try {
      const slate = getOwnSlate.get(req.params.id, req.user.id);
      if (!slate) return res.status(404).json({ error: 'Slate not found' });
      if (!slate.is_collab) return res.status(409).json({ error: 'Enable collaboration on this slate first' });
      if (typeof inviteWrappedKey !== 'string' || !inviteWrappedKey.trim()) {
        return res.status(400).json({ error: 'Wrapped doc key required' });
      }
      const target = getUserByName.get(String(username || '').toLowerCase().trim());
      if (!target || !target.e2e_migrated || !target.public_key) {
        return res.status(404).json({ error: 'User not available for sharing' });
      }
      if (target.id === req.user.id) {
        return res.status(400).json({ error: 'You already have access to your own slate' });
      }
      if (getMember.get(slate.id, target.id)) {
        return res.status(409).json({ error: 'Already invited or a member' });
      }
      if (countMembers.get(slate.id).n >= MAX_MEMBERS) {
        return res.status(409).json({ error: `A slate can have at most ${MAX_MEMBERS} members` });
      }
      db.prepare(`
        INSERT INTO collab_members (slate_id, user_id, role, status, invite_wrapped_key, invited_by)
        VALUES (?, ?, 'editor', 'pending', ?, ?)
      `).run(slate.id, target.id, inviteWrappedKey, req.user.id);
      // Surface the invite in the invitee's updates dropdown (content-free:
      // titles are encrypted; the accept/decline banner lives in /slates).
      try {
        db.prepare(`
          INSERT INTO notifications (type, title, message, link, filter_user_ids)
          VALUES ('automated', 'collab invite', ?, '/slates', ?)
        `).run(`${req.user.username} invited you to work on a slate together`, String(target.id));
      } catch (err) {
        console.warn('Failed to create invite notification:', err);
      }
      res.json({ success: true, username: target.username });
    } catch (error) {
      console.error('Collab invite error:', error);
      res.status(500).json({ error: 'Failed to invite' });
    }
  });

  // Member list for an owned slate.
  app.get('/api/slates/:id/collab/members', authenticateToken, (req, res) => {
    try {
      const slate = getOwnSlate.get(req.params.id, req.user.id);
      if (!slate) return res.status(404).json({ error: 'Slate not found' });
      if (!slate.is_collab) return res.json({ enabled: false, members: [] });
      const members = db.prepare(`
        SELECT u.username, m.role, m.status, m.created_at
        FROM collab_members m JOIN users u ON u.id = m.user_id
        WHERE m.slate_id = ? ORDER BY m.role = 'owner' DESC, m.created_at
      `).all(slate.id);
      const linkRow = getLinkBySlate.get(slate.id);
      const now = Math.floor(Date.now() / 1000);
      res.json({
        enabled: true, members,
        link: linkRow && linkRow.expires_at > now ? { created_at: linkRow.created_at, expires_at: linkRow.expires_at } : null
      });
    } catch (error) {
      console.error('Collab members error:', error);
      res.status(500).json({ error: 'Failed to list members' });
    }
  });

  // Remove a member (owner only). Removing the owner row is not allowed —
  // that's what disable is for.
  app.delete('/api/slates/:id/collab/members/:username', authenticateToken, createRateLimitMiddleware('collabRespond'), (req, res) => {
    try {
      const slate = getOwnSlate.get(req.params.id, req.user.id);
      if (!slate || !slate.is_collab) return res.status(404).json({ error: 'Slate not found' });
      const target = getUserByName.get(String(req.params.username || '').toLowerCase().trim());
      const member = target ? getMember.get(slate.id, target.id) : null;
      if (!member) return res.status(404).json({ error: 'Not a member' });
      if (member.role === 'owner') return res.status(400).json({ error: 'The owner cannot be removed' });
      db.prepare('DELETE FROM collab_members WHERE id = ?').run(member.id);
      if (collabHub) collabHub.kickMember(slate.id, target.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Collab remove member error:', error);
      res.status(500).json({ error: 'Failed to remove member' });
    }
  });

  // --- Invite links. The shareable URL is /join/<token>#k=<doc key>: the
  // token is the server-side credential (stored hashed), the key rides the
  // fragment and never reaches us. One active link per slate; creating a new
  // one replaces it. ---

  app.post('/api/slates/:id/collab/links', authenticateToken, createRateLimitMiddleware('collabInvite'), (req, res) => {
    try {
      const slate = getOwnSlate.get(req.params.id, req.user.id);
      if (!slate) return res.status(404).json({ error: 'Slate not found' });
      if (!slate.is_collab) return res.status(409).json({ error: 'Enable collaboration on this slate first' });
      const token = nodeCrypto.randomBytes(24).toString('base64url');
      const expiresAt = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
      db.transaction(() => {
        db.prepare('DELETE FROM collab_link_invites WHERE slate_id = ?').run(slate.id);
        db.prepare('INSERT INTO collab_link_invites (slate_id, token_hash, created_by, expires_at) VALUES (?, ?, ?, ?)')
          .run(slate.id, hashToken(token), req.user.id, expiresAt);
      })();
      res.json({ token, expires_at: expiresAt });
    } catch (error) {
      console.error('Collab link create error:', error);
      res.status(500).json({ error: 'Failed to create link' });
    }
  });

  app.delete('/api/slates/:id/collab/links', authenticateToken, createRateLimitMiddleware('collabRespond'), (req, res) => {
    try {
      const slate = getOwnSlate.get(req.params.id, req.user.id);
      if (!slate) return res.status(404).json({ error: 'Slate not found' });
      db.prepare('DELETE FROM collab_link_invites WHERE slate_id = ?').run(slate.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Collab link revoke error:', error);
      res.status(500).json({ error: 'Failed to revoke link' });
    }
  });

  // Resolve a link for the join page. Possession of the token is the
  // credential; encrypted_title only decrypts with the fragment key anyway.
  app.get('/api/collab/links/:token', authenticateToken, createRateLimitMiddleware('collabLookup'), (req, res) => {
    try {
      const link = findValidLink(req.params.token);
      const slate = link ? db.prepare(`
        SELECT s.id, s.is_collab, s.encrypted_title, u.username AS owner_username
        FROM slates s JOIN users u ON u.id = s.user_id WHERE s.id = ?
      `).get(link.slate_id) : null;
      if (!slate || !slate.is_collab) return res.status(404).json({ error: 'This link is no longer valid', code: 'LINK_INVALID' });
      const me = getMember.get(slate.id, req.user.id);
      res.json({
        slate_id: slate.id,
        owner_username: slate.owner_username,
        encrypted_title: slate.encrypted_title,
        already_member: !!(me && me.status === 'accepted')
      });
    } catch (error) {
      console.error('Collab link resolve error:', error);
      res.status(500).json({ error: 'Failed to resolve link' });
    }
  });

  // Join via link: the client read the doc key from the fragment and wrapped
  // it to its own master key. A pending username-invite upgrades in place.
  app.post('/api/collab/links/:token/join', authenticateToken, createRateLimitMiddleware('collabRespond'), (req, res) => {
    const { wrappedKey } = req.body || {};
    try {
      const user = getUser.get(req.user.id);
      if (!user || !user.e2e_migrated) {
        return res.status(403).json({ error: 'Collaboration requires end-to-end encryption on your account', code: 'COLLAB_E2E_REQUIRED' });
      }
      const link = findValidLink(req.params.token);
      const slate = link ? db.prepare('SELECT id, is_collab, user_id FROM slates WHERE id = ?').get(link.slate_id) : null;
      if (!slate || !slate.is_collab) return res.status(404).json({ error: 'This link is no longer valid', code: 'LINK_INVALID' });
      const existing = getMember.get(slate.id, req.user.id);
      if (existing && existing.status === 'accepted') {
        return res.json({ success: true, slate_id: slate.id, already_member: true });
      }
      if (typeof wrappedKey !== 'string' || !wrappedKey.trim()) {
        return res.status(400).json({ error: 'Wrapped doc key required' });
      }
      if (existing) {
        db.prepare(`
          UPDATE collab_members SET status = 'accepted', wrapped_key = ?, invite_wrapped_key = NULL, accepted_at = strftime('%s','now')
          WHERE id = ?
        `).run(wrappedKey, existing.id);
      } else {
        if (countMembers.get(slate.id).n >= MAX_MEMBERS) {
          return res.status(409).json({ error: `A slate can have at most ${MAX_MEMBERS} members` });
        }
        db.prepare(`
          INSERT INTO collab_members (slate_id, user_id, role, status, wrapped_key, invited_by, accepted_at)
          VALUES (?, ?, 'editor', 'accepted', ?, ?, strftime('%s','now'))
        `).run(slate.id, req.user.id, wrappedKey, link.created_by);
      }
      res.json({ success: true, slate_id: slate.id });
    } catch (error) {
      console.error('Collab link join error:', error);
      res.status(500).json({ error: 'Failed to join' });
    }
  });

  // --- Key rotation: real revocation. The owner's client generated a fresh
  // doc key, re-encrypted the canonical content/title/tags under it, wrapped
  // it to itself and RSA-wrapped it to everyone who stays. The old log and
  // snapshot are ciphertext under the dead key, so they are dropped and the
  // epoch guard locks stale clients out of the relay. Members named in the
  // body get their new key; member rows NOT named are removed. ---
  app.post('/api/slates/:id/collab/rotate', authenticateToken, createRateLimitMiddleware('collabEnable'), async (req, res) => {
    const { ownerWrappedKey, encryptedContent, encryptedTitle, encryptedTags, wordCount, charCount, members } = req.body || {};
    try {
      const slate = getOwnSlate.get(req.params.id, req.user.id);
      if (!slate || !slate.is_collab) return res.status(404).json({ error: 'Slate not found' });
      if (typeof ownerWrappedKey !== 'string' || !ownerWrappedKey.trim()) {
        return res.status(400).json({ error: 'Wrapped doc key required' });
      }
      if (typeof encryptedTitle !== 'string' || !encryptedTitle.trim()) {
        return res.status(400).json({ error: 'Encrypted title required', code: 'E2E_TITLE_REQUIRED' });
      }
      const blob = decodeBlob(res, encryptedContent);
      if (!blob) return;

      const memberKeys = new Map(); // username -> RSA-wrapped new key
      for (const m of Array.isArray(members) ? members : []) {
        if (m && typeof m.username === 'string' && typeof m.inviteWrappedKey === 'string' && m.inviteWrappedKey.trim()) {
          memberKeys.set(m.username.toLowerCase(), m.inviteWrappedKey);
        }
      }

      const newFileId = await b2Storage.uploadRawSlate(`${req.user.id}-${Date.now()}`, blob);
      const oldFileId = slate.b2_file_id;
      const docRow = db.prepare('SELECT snapshot_b2_file_id FROM collab_docs WHERE slate_id = ?').get(slate.id);
      const rows = db.prepare(`
        SELECT m.id, m.user_id, m.role, u.username FROM collab_members m
        JOIN users u ON u.id = m.user_id WHERE m.slate_id = ?
      `).all(slate.id);
      const dropped = [];

      db.transaction(() => {
        if (typeof encryptedTags === 'string' && encryptedTags.trim()) {
          db.prepare(`
            UPDATE slates SET b2_file_id = ?, encrypted_title = ?, encrypted_tags = ?, word_count = ?, char_count = ?, size_bytes = ?,
              collab_epoch = COALESCE(collab_epoch, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
          `).run(newFileId, encryptedTitle, encryptedTags, wordCount || slate.word_count || 0, charCount || slate.char_count || 0, blob.length, slate.id);
        } else {
          db.prepare(`
            UPDATE slates SET b2_file_id = ?, encrypted_title = ?, word_count = ?, char_count = ?, size_bytes = ?,
              collab_epoch = COALESCE(collab_epoch, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
          `).run(newFileId, encryptedTitle, wordCount || slate.word_count || 0, charCount || slate.char_count || 0, blob.length, slate.id);
        }
        for (const row of rows) {
          if (row.role === 'owner') {
            db.prepare('UPDATE collab_members SET wrapped_key = ?, invite_wrapped_key = NULL WHERE id = ?').run(ownerWrappedKey, row.id);
          } else {
            const k = memberKeys.get(row.username.toLowerCase());
            if (k) {
              db.prepare('UPDATE collab_members SET invite_wrapped_key = ?, wrapped_key = NULL WHERE id = ?').run(k, row.id);
            } else {
              db.prepare('DELETE FROM collab_members WHERE id = ?').run(row.id);
              dropped.push(row.user_id);
            }
          }
        }
        db.prepare('DELETE FROM collab_updates WHERE slate_id = ?').run(slate.id);
        db.prepare('DELETE FROM collab_docs WHERE slate_id = ?').run(slate.id);
        db.prepare('DELETE FROM collab_link_invites WHERE slate_id = ?').run(slate.id);
      })();

      const epoch = db.prepare('SELECT COALESCE(collab_epoch, 0) AS e FROM slates WHERE id = ?').get(slate.id).e;
      if (collabHub) {
        for (const uid of dropped) collabHub.kickMember(slate.id, uid);
        collabHub.notifyRekeyed(slate.id);
      }
      if (oldFileId && oldFileId !== newFileId) {
        try { await b2Storage.deleteSlate(oldFileId); } catch (err) { console.warn('Failed to delete old B2 file:', err); }
      }
      if (docRow && docRow.snapshot_b2_file_id) {
        try { await b2Storage.deleteSlate(docRow.snapshot_b2_file_id); } catch (err) { console.warn('Failed to delete snapshot B2 file:', err); }
      }
      res.json({ success: true, epoch });
    } catch (error) {
      console.error('Collab rotate error:', error);
      b2ErrorResponse(res, error, 'Failed to rotate the key');
    }
  });

  // Persist a member's re-wrapped copy after a rotation: they RSA-unwrapped
  // the new key and re-wrapped it to their master key.
  app.post('/api/collab/slates/:slateId/rewrap', authenticateToken, createRateLimitMiddleware('collabRespond'), (req, res) => {
    const { wrappedKey } = req.body || {};
    try {
      if (typeof wrappedKey !== 'string' || !wrappedKey.trim()) {
        return res.status(400).json({ error: 'Wrapped doc key required' });
      }
      const member = getMember.get(req.params.slateId, req.user.id);
      if (!member || member.status !== 'accepted') return res.status(404).json({ error: 'Slate not found' });
      db.prepare('UPDATE collab_members SET wrapped_key = ?, invite_wrapped_key = NULL WHERE id = ?').run(wrappedKey, member.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Collab rewrap error:', error);
      res.status(500).json({ error: 'Failed to store key' });
    }
  });

  // Pending invites addressed to me. encrypted_title is under the doc key the
  // invite carries (RSA-wrapped), so the client can show the real title.
  app.get('/api/collab/invites', authenticateToken, (req, res) => {
    try {
      const invites = db.prepare(`
        SELECT m.id, m.slate_id, m.invite_wrapped_key, m.created_at,
               s.encrypted_title, u.username AS owner_username
        FROM collab_members m
        JOIN slates s ON s.id = m.slate_id
        JOIN users u ON u.id = s.user_id
        WHERE m.user_id = ? AND m.status = 'pending'
        ORDER BY m.created_at DESC
      `).all(req.user.id);
      res.json({ invites });
    } catch (error) {
      console.error('Collab invites list error:', error);
      res.status(500).json({ error: 'Failed to list invites' });
    }
  });

  // Accept an invite: the client unwrapped the doc key with its RSA private
  // key and re-wrapped it to the member's master key.
  app.post('/api/collab/invites/:id/accept', authenticateToken, createRateLimitMiddleware('collabRespond'), (req, res) => {
    const { wrappedKey } = req.body || {};
    try {
      const user = getUser.get(req.user.id);
      if (!user || !user.e2e_migrated) {
        return res.status(403).json({ error: 'Collaboration requires end-to-end encryption on your account', code: 'COLLAB_E2E_REQUIRED' });
      }
      if (typeof wrappedKey !== 'string' || !wrappedKey.trim()) {
        return res.status(400).json({ error: 'Wrapped doc key required' });
      }
      const row = db.prepare('SELECT * FROM collab_members WHERE id = ? AND user_id = ? AND status = ?').get(req.params.id, req.user.id, 'pending');
      if (!row) return res.status(404).json({ error: 'Invite not found' });
      db.prepare(`
        UPDATE collab_members SET status = 'accepted', wrapped_key = ?, invite_wrapped_key = NULL, accepted_at = strftime('%s','now')
        WHERE id = ?
      `).run(wrappedKey, row.id);
      res.json({ success: true, slate_id: row.slate_id });
    } catch (error) {
      console.error('Collab invite accept error:', error);
      res.status(500).json({ error: 'Failed to accept invite' });
    }
  });

  // Decline an invite / leave a slate I accepted earlier.
  app.post('/api/collab/invites/:id/decline', authenticateToken, createRateLimitMiddleware('collabRespond'), (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM collab_members WHERE id = ? AND user_id = ? AND status = ?').get(req.params.id, req.user.id, 'pending');
      if (!row) return res.status(404).json({ error: 'Invite not found' });
      db.prepare('DELETE FROM collab_members WHERE id = ?').run(row.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Collab invite decline error:', error);
      res.status(500).json({ error: 'Failed to decline invite' });
    }
  });

  app.post('/api/collab/slates/:slateId/leave', authenticateToken, createRateLimitMiddleware('collabRespond'), (req, res) => {
    try {
      const row = getMember.get(req.params.slateId, req.user.id);
      if (!row) return res.status(404).json({ error: 'Not a member' });
      if (row.role === 'owner') return res.status(400).json({ error: 'The owner cannot leave; disable collaboration instead' });
      db.prepare('DELETE FROM collab_members WHERE id = ?').run(row.id);
      if (collabHub) collabHub.kickMember(Number(req.params.slateId), req.user.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Collab leave error:', error);
      res.status(500).json({ error: 'Failed to leave' });
    }
  });

  // Member list from a member's perspective (keyed by slate id, since only
  // the owner has a slate_number for it). Same ACL-transparency as the
  // owner view: members see who else is in the group.
  app.get('/api/collab/slates/:slateId/members', authenticateToken, (req, res) => {
    try {
      const me = getMember.get(req.params.slateId, req.user.id);
      if (!me || me.status !== 'accepted') return res.status(404).json({ error: 'Slate not found' });
      const members = db.prepare(`
        SELECT u.username, m.role, m.status, m.created_at
        FROM collab_members m JOIN users u ON u.id = m.user_id
        WHERE m.slate_id = ? ORDER BY m.role = 'owner' DESC, m.created_at
      `).all(req.params.slateId);
      res.json({ enabled: true, members });
    } catch (error) {
      console.error('Collab member-view members error:', error);
      res.status(500).json({ error: 'Failed to list members' });
    }
  });

  // Slates shared with me (accepted, not owned).
  app.get('/api/collab/slates', authenticateToken, (req, res) => {
    try {
      const shared = db.prepare(`
        SELECT s.id AS slate_id, s.encrypted_title, s.encrypted_tags, s.editor_mode, s.updated_at,
               s.word_count, s.char_count, m.wrapped_key, m.invite_wrapped_key, u.username AS owner_username
        FROM collab_members m
        JOIN slates s ON s.id = m.slate_id
        JOIN users u ON u.id = s.user_id
        WHERE m.user_id = ? AND m.status = 'accepted' AND m.role != 'owner'
        ORDER BY s.updated_at DESC
      `).all(req.user.id);
      res.json({ shared });
    } catch (error) {
      console.error('Collab shared list error:', error);
      res.status(500).json({ error: 'Failed to list shared slates' });
    }
  });

  // Fetch a shared slate's ciphertext for an accepted member (read path; the
  // realtime edit channel comes separately).
  app.get('/api/collab/slates/:slateId', authenticateToken, createRateLimitMiddleware('collabFetch'), async (req, res) => {
    try {
      const member = getMember.get(req.params.slateId, req.user.id);
      if (!member || member.status !== 'accepted') return res.status(404).json({ error: 'Slate not found' });
      const slate = db.prepare(`
        SELECT s.*, u.username AS owner_username FROM slates s JOIN users u ON u.id = s.user_id WHERE s.id = ?
      `).get(req.params.slateId);
      if (!slate || !slate.is_collab) return res.status(404).json({ error: 'Slate not found' });
      const rawData = await b2Storage.downloadRawFile(slate.b2_file_id);
      res.json({
        slate_id: slate.id,
        encryptedContent: rawData.toString('base64'),
        encrypted_title: slate.encrypted_title,
        editor_mode: slate.editor_mode === 'wysiwyg' ? 'wysiwyg' : 'plain',
        owner_username: slate.owner_username,
        updated_at: slate.updated_at,
        word_count: slate.word_count,
        char_count: slate.char_count,
        role: member.role,
        wrapped_key: member.wrapped_key,
        invite_wrapped_key: member.invite_wrapped_key,
        collab_epoch: slate.collab_epoch || 0
      });
    } catch (error) {
      console.error('Collab fetch slate error:', error);
      b2ErrorResponse(res, error, 'Failed to fetch slate');
    }
  });

  // --- Realtime log + snapshots (the ws hub handles live traffic; these are
  // the HTTP sides: catch-up reads and client-produced snapshot persistence) ---

  const acceptedMember = (slateId, userId) => {
    const m = getMember.get(slateId, userId);
    return m && m.status === 'accepted' ? m : null;
  };

  // Catch-up: encrypted updates after a version (for clients joining over
  // HTTP before/without the socket).
  app.get('/api/collab/slates/:slateId/updates', authenticateToken, createRateLimitMiddleware('collabFetch'), (req, res) => {
    try {
      if (!acceptedMember(req.params.slateId, req.user.id)) return res.status(404).json({ error: 'Slate not found' });
      const since = Number(req.query.since) || 0;
      const rows = db.prepare(
        'SELECT version, payload FROM collab_updates WHERE slate_id = ? AND version > ? ORDER BY version LIMIT 501'
      ).all(req.params.slateId, since);
      const more = rows.length > 500;
      const latest = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM collab_updates WHERE slate_id = ?').get(req.params.slateId).v;
      res.json({ updates: rows.slice(0, 500), more, latest });
    } catch (error) {
      console.error('Collab updates fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch updates' });
    }
  });

  // Current snapshot: encrypted doc state covering the log up to `version`.
  app.get('/api/collab/slates/:slateId/snapshot', authenticateToken, createRateLimitMiddleware('collabFetch'), async (req, res) => {
    try {
      if (!acceptedMember(req.params.slateId, req.user.id)) return res.status(404).json({ error: 'Slate not found' });
      const doc = db.prepare('SELECT snapshot_version, snapshot_b2_file_id FROM collab_docs WHERE slate_id = ?').get(req.params.slateId);
      if (!doc || !doc.snapshot_b2_file_id) return res.json({ version: 0, payload: null });
      const rawData = await b2Storage.downloadRawFile(doc.snapshot_b2_file_id);
      res.json({ version: doc.snapshot_version, payload: rawData.toString('base64') });
    } catch (error) {
      console.error('Collab snapshot fetch error:', error);
      b2ErrorResponse(res, error, 'Failed to fetch snapshot');
    }
  });

  // Store a client-produced snapshot and prune the log it covers. Any
  // accepted member may post one (they all hold the doc key; the server can
  // neither produce nor validate ciphertext). version = highest log version
  // the snapshot includes — never ahead of the log itself.
  app.post('/api/collab/slates/:slateId/snapshot', authenticateToken, createRateLimitMiddleware('collabSnapshot'), async (req, res) => {
    const { payload, version } = req.body || {};
    try {
      const slateId = Number(req.params.slateId);
      if (!acceptedMember(slateId, req.user.id)) return res.status(404).json({ error: 'Slate not found' });
      const coveredVersion = Number(version);
      if (!Number.isInteger(coveredVersion) || coveredVersion < 0) return res.status(400).json({ error: 'version required' });
      const latest = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM collab_updates WHERE slate_id = ?').get(slateId).v;
      if (coveredVersion > latest) return res.status(409).json({ error: 'snapshot version is ahead of the log' });
      const existing = db.prepare('SELECT snapshot_version, snapshot_b2_file_id FROM collab_docs WHERE slate_id = ?').get(slateId);
      if (existing && coveredVersion < existing.snapshot_version) {
        return res.status(409).json({ error: 'a newer snapshot already exists' });
      }
      const blob = decodeBlob(res, payload);
      if (!blob) return;

      const newFileId = await b2Storage.uploadRawSlate(`collab-snap-${slateId}-${Date.now()}`, blob);
      db.transaction(() => {
        db.prepare(`
          INSERT INTO collab_docs (slate_id, snapshot_version, snapshot_b2_file_id, updated_at)
          VALUES (?, ?, ?, strftime('%s','now'))
          ON CONFLICT(slate_id) DO UPDATE SET
            snapshot_version = excluded.snapshot_version,
            snapshot_b2_file_id = excluded.snapshot_b2_file_id,
            updated_at = strftime('%s','now')
        `).run(slateId, coveredVersion, newFileId);
        db.prepare('DELETE FROM collab_updates WHERE slate_id = ? AND version <= ?').run(slateId, coveredVersion);
      })();

      if (existing && existing.snapshot_b2_file_id && existing.snapshot_b2_file_id !== newFileId) {
        try { await b2Storage.deleteSlate(existing.snapshot_b2_file_id); } catch (err) { console.warn('Failed to delete old snapshot B2 file:', err); }
      }
      res.json({ success: true, snapshotVersion: coveredVersion });
    } catch (error) {
      console.error('Collab snapshot store error:', error);
      b2ErrorResponse(res, error, 'Failed to store snapshot');
    }
  });
}

module.exports = { mountCollab };
