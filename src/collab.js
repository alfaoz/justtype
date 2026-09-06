// Client-side service for E2EE collaborative slates.
//
// A collaborative slate's content + title are encrypted under a random 32-byte
// DOC KEY that only members hold. The server stores the doc key wrapped per
// member: AES-GCM under the member's master key once accepted, RSA-OAEP under
// the invitee's drop-box public key while an invite is pending. Everything the
// server relays or stores stays opaque.

import { API_URL } from './config';
import {
  generateSlateKey, wrapKey, unwrapKey, encryptContent, decryptContent,
  encryptTitle, decryptTitle, encryptTags, decryptTags, importAppPublicKey, wrapKeyToAppKey, unwrapKeyRsa
} from './crypto';
import { getSlateKey } from './keyStore';
import { getUserPrivateKey } from './userKeys';

import { cacheSlate, getCachedSlate, cacheList, getCachedList } from './offlineStore';
import { reportNetworkFailure } from './connectivity';

// GET with the device copy as fallback: shared slates and their list are
// cached under `shared-…` keys, encrypted as the server holds them
async function cachedGet(path, userId, cacheKey, kind) {
  try {
    const data = await api(path);
    if (userId) (kind === 'list' ? cacheList(`${userId}:${cacheKey}`, data) : cacheSlate(userId, cacheKey, data, { opened: true })).catch(() => {});
    return data;
  } catch (err) {
    if (err.status) throw err; // the server answered: not a network problem
    reportNetworkFailure();
    const cached = userId ? await (kind === 'list' ? getCachedList(`${userId}:${cacheKey}`).then(c => c?.rows) : getCachedSlate(userId, cacheKey).then(c => c?.data)).catch(() => null) : null;
    if (!cached) throw err;
    return cached;
  }
}

async function api(path, opts = {}) {
  const init = { credentials: 'include', method: opts.method || (opts.body ? 'POST' : 'GET') };
  if (opts.body) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API_URL}${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `request failed (${res.status})`);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

const countWords = (content) => (content && content.trim() !== '') ? content.trim().split(/\s+/).length : 0;

async function requireMasterKey(userId) {
  const masterKey = userId ? await getSlateKey(userId) : null;
  if (!masterKey) {
    const err = new Error('unlock your slates first');
    err.code = 'LOCKED';
    throw err;
  }
  return masterKey;
}

// Enable collaboration on an owned slate: generate a doc key, re-encrypt the
// current content + title under it, wrap it to the owner's master key. Returns
// the raw doc key — the caller must use it for every subsequent save.
export async function enableCollab(slateNumber, userId, content, title) {
  const masterKey = await requireMasterKey(userId);
  const docKey = await generateSlateKey();
  const res = await api(`/slates/${encodeURIComponent(slateNumber)}/collab/enable`, {
    body: {
      ownerWrappedKey: await wrapKey(docKey, masterKey),
      encryptedContent: await encryptContent(content || '', docKey),
      encryptedTitle: await encryptTitle(title || 'untitled', docKey),
      wordCount: countWords(content),
      charCount: (content || '').length
    }
  });
  return { docKey, slateId: res.slate_id };
}

// Disable collaboration: re-encrypt back under the owner's master key; the
// server drops every membership row.
export async function disableCollab(slateNumber, userId, content, title) {
  const masterKey = await requireMasterKey(userId);
  await api(`/slates/${encodeURIComponent(slateNumber)}/collab`, {
    method: 'DELETE',
    body: {
      encryptedContent: await encryptContent(content || '', masterKey),
      encryptedTitle: await encryptTitle(title || 'untitled', masterKey)
    }
  });
}

// Invite a user by username: fetch their public key, wrap the doc key to it.
export async function inviteToSlate(slateNumber, username, docKey) {
  const { public_key, username: resolved } = await api(`/users/${encodeURIComponent(username)}/public-key`);
  const pub = await importAppPublicKey(public_key);
  const inviteWrappedKey = await wrapKeyToAppKey(docKey, pub);
  return api(`/slates/${encodeURIComponent(slateNumber)}/collab/invites`, { body: { username: resolved, inviteWrappedKey } });
}

export function fetchMembers(slateNumber) {
  return api(`/slates/${encodeURIComponent(slateNumber)}/collab/members`);
}

export function removeMember(slateNumber, username) {
  return api(`/slates/${encodeURIComponent(slateNumber)}/collab/members/${encodeURIComponent(username)}`, { method: 'DELETE' });
}

// Member's view of the group (keyed by slate id — members have no slate_number)
export function fetchMembersAsMember(slateId) {
  return api(`/collab/slates/${slateId}/members`);
}

// --- Invite links. The URL is /join/<token>#k=<doc key, base64url>: the
// token authenticates against the server (stored hashed there), the key
// rides the fragment and never leaves the browser. ---

const keyToFragment = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fragmentToKey = (s) =>
  Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function createInviteLink(slateNumber, docKey) {
  const { token, expires_at } = await api(`/slates/${encodeURIComponent(slateNumber)}/collab/links`, { body: {} });
  return { url: `${window.location.origin}/join/${token}#k=${keyToFragment(docKey)}`, expiresAt: expires_at };
}

export function revokeInviteLink(slateNumber) {
  return api(`/slates/${encodeURIComponent(slateNumber)}/collab/links`, { method: 'DELETE' });
}

// Resolve a link for the join page; the title decrypts with the fragment key.
export async function resolveInviteLink(token, fragmentKey) {
  const data = await api(`/collab/links/${encodeURIComponent(token)}`);
  let title = null;
  if (data.encrypted_title && fragmentKey) {
    try { title = await decryptTitle(data.encrypted_title, fragmentKey); } catch { /* stale key in link */ }
  }
  return { slateId: data.slate_id, owner: data.owner_username, alreadyMember: data.already_member, title };
}

// Join with the fragment key: wrap it to my master key and hand that in.
export async function joinViaLink(token, fragmentKey, userId) {
  const masterKey = await requireMasterKey(userId);
  const wrappedKey = await wrapKey(fragmentKey, masterKey);
  const data = await api(`/collab/links/${encodeURIComponent(token)}/join`, { body: { wrappedKey } });
  return { slateId: data.slate_id, alreadyMember: !!data.already_member };
}

// --- Key rotation: real revocation. Generate a fresh doc key, re-encrypt the
// canonical content/title/tags under it, wrap to self, RSA-wrap to every
// remaining member (they re-wrap to their own master key on next open), and
// let the server drop the old-key log/snapshot and bump the epoch. ---
export async function rotateDocKey(slateNumber, userId, content, title, oldDocKey) {
  const masterKey = await requireMasterKey(userId);
  const newKey = await generateSlateKey();

  // Carry tags across the rotation where they decrypt (doc-key tags for
  // sure; master-key tags predate sharing and stay owner-readable anyway).
  let encryptedTags = null;
  try {
    const slateRow = await api(`/slates/${encodeURIComponent(slateNumber)}`);
    if (slateRow && slateRow.encrypted_tags) {
      let tags = null;
      if (oldDocKey) { try { tags = await decryptTags(slateRow.encrypted_tags, oldDocKey); } catch { /* try master */ } }
      if (!tags) { try { tags = await decryptTags(slateRow.encrypted_tags, masterKey); } catch { /* unreadable */ } }
      if (tags && tags.length) encryptedTags = await encryptTags(tags, newKey);
    }
  } catch (e) {
    console.warn('tag carry-over failed during rotation', e);
  }

  const { members } = await fetchMembers(slateNumber);
  const rewrapped = [];
  for (const m of members || []) {
    if (m.role === 'owner') continue;
    const { public_key } = await api(`/users/${encodeURIComponent(m.username)}/public-key`);
    const pub = await importAppPublicKey(public_key);
    rewrapped.push({ username: m.username, inviteWrappedKey: await wrapKeyToAppKey(newKey, pub) });
  }

  await api(`/slates/${encodeURIComponent(slateNumber)}/collab/rotate`, {
    body: {
      ownerWrappedKey: await wrapKey(newKey, masterKey),
      encryptedContent: await encryptContent(content || '', newKey),
      encryptedTitle: await encryptTitle(title || 'untitled', newKey),
      encryptedTags,
      wordCount: countWords(content),
      charCount: (content || '').length,
      members: rewrapped
    }
  });
  return newKey;
}

// Pending invites addressed to me, with titles decrypted where possible. Each
// entry carries the unwrapped doc key so accepting doesn't refetch.
export async function fetchInvites(userId) {
  const { invites } = await api('/collab/invites');
  if (!invites || !invites.length) return [];
  const masterKey = userId ? await getSlateKey(userId) : null;
  const priv = masterKey ? await getUserPrivateKey(userId, masterKey) : null;
  const out = [];
  for (const inv of invites) {
    let title = null, docKey = null;
    if (priv && inv.invite_wrapped_key) {
      try {
        docKey = await unwrapKeyRsa(inv.invite_wrapped_key, priv);
        if (inv.encrypted_title) title = await decryptTitle(inv.encrypted_title, docKey);
      } catch (e) {
        console.warn('invite decrypt failed', e);
      }
    }
    out.push({ id: inv.id, slateId: inv.slate_id, owner: inv.owner_username, createdAt: inv.created_at, title, docKey });
  }
  return out;
}

// Accept: re-wrap the doc key (already RSA-unwrapped in fetchInvites) to my
// master key so it is recoverable on any of my devices.
export async function acceptInvite(invite, userId) {
  const masterKey = await requireMasterKey(userId);
  if (!invite.docKey) {
    const err = new Error('could not read the invite key');
    err.code = 'INVITE_KEY';
    throw err;
  }
  const wrappedKey = await wrapKey(invite.docKey, masterKey);
  return api(`/collab/invites/${invite.id}/accept`, { body: { wrappedKey } });
}

export function declineInvite(inviteId) {
  return api(`/collab/invites/${inviteId}/decline`, { body: {} });
}

export function leaveSharedSlate(slateId) {
  return api(`/collab/slates/${slateId}/leave`, { body: {} });
}

// --- Version history: retained encrypted checkpoints of the whole doc.
// Payloads are Y.Doc states under the doc key; rebuilding text from them is
// the history modal's job (it owns the yjs dependency). ---

export function fetchCheckpoints(slateId) {
  return api(`/collab/slates/${slateId}/checkpoints`);
}

export function labelCheckpoint(slateId, checkpointId, label) {
  return api(`/collab/slates/${slateId}/checkpoints/${checkpointId}`, { method: 'PATCH', body: { label } });
}

export async function fetchCheckpointState(slateId, checkpointId, docKey) {
  const data = await api(`/collab/slates/${slateId}/checkpoints/${checkpointId}`);
  return unwrapKey(data.payload, docKey); // raw Y.Doc update bytes
}

// Resolve my copy of a shared slate's doc key. Normal path: AES-unwrap
// wrapped_key with my master key. After a rotation my row holds only an
// RSA-wrapped copy (invite_wrapped_key): unwrap it with my drop-box private
// key, then persist a master-key-wrapped copy back so the next open is cheap.
async function resolveMemberDocKey(row, slateId, userId, masterKey) {
  if (row.wrapped_key) return unwrapKey(row.wrapped_key, masterKey);
  if (!row.invite_wrapped_key) throw new Error('no key material for this slate');
  const priv = await getUserPrivateKey(userId, masterKey);
  const docKey = await unwrapKeyRsa(row.invite_wrapped_key, priv);
  try {
    await api(`/collab/slates/${slateId}/rewrap`, { body: { wrappedKey: await wrapKey(docKey, masterKey) } });
  } catch (e) {
    console.warn('rewrap persist failed (will retry next open)', e);
  }
  return docKey;
}

// Accepted shared slates (not mine), titles decrypted where possible.
export async function fetchSharedSlates(userId) {
  const { shared } = await cachedGet('/collab/slates', userId, 'shared-list', 'list');
  if (!shared || !shared.length) return [];
  const masterKey = userId ? await getSlateKey(userId) : null;
  const out = [];
  for (const s of shared) {
    let title = null;
    let tags = [];
    if (masterKey && (s.wrapped_key || s.invite_wrapped_key)) {
      try {
        const docKey = await resolveMemberDocKey(s, s.slate_id, userId, masterKey);
        if (s.encrypted_title) title = await decryptTitle(s.encrypted_title, docKey);
        // Tags encrypted before sharing was turned on are under the owner's
        // master key and stay theirs; doc-key tags decrypt for everyone.
        if (s.encrypted_tags) {
          try { tags = await decryptTags(s.encrypted_tags, docKey); } catch { tags = []; }
        }
      } catch (e) {
        console.warn('shared slate decrypt failed', e);
      }
    }
    out.push({
      slateId: s.slate_id, owner: s.owner_username, editorMode: s.editor_mode,
      updatedAt: s.updated_at, wordCount: s.word_count, charCount: s.char_count, title, tags
    });
  }
  return out;
}

// Full shared slate for the read view: resolve my doc key copy, decrypt.
export async function fetchSharedSlate(slateId, userId) {
  const data = await cachedGet(`/collab/slates/${slateId}`, userId, `shared-${slateId}`, 'slate');
  const masterKey = await requireMasterKey(userId);
  const docKey = await resolveMemberDocKey(data, slateId, userId, masterKey);
  const content = data.encryptedContent ? await decryptContent(data.encryptedContent, docKey) : '';
  let title = null;
  if (data.encrypted_title) {
    try { title = await decryptTitle(data.encrypted_title, docKey); } catch { /* fall back below */ }
  }
  return {
    content, title, editorMode: data.editor_mode, owner: data.owner_username,
    updatedAt: data.updated_at, role: data.role, docKey
  };
}
