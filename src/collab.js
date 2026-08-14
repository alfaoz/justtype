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
  encryptTitle, decryptTitle, importAppPublicKey, wrapKeyToAppKey, unwrapKeyRsa
} from './crypto';
import { getSlateKey } from './keyStore';
import { getUserPrivateKey } from './userKeys';

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
  await api(`/slates/${encodeURIComponent(slateNumber)}/collab/enable`, {
    body: {
      ownerWrappedKey: await wrapKey(docKey, masterKey),
      encryptedContent: await encryptContent(content || '', docKey),
      encryptedTitle: await encryptTitle(title || 'untitled', docKey),
      wordCount: countWords(content),
      charCount: (content || '').length
    }
  });
  return docKey;
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

// Accepted shared slates (not mine), titles decrypted where possible.
export async function fetchSharedSlates(userId) {
  const { shared } = await api('/collab/slates');
  if (!shared || !shared.length) return [];
  const masterKey = userId ? await getSlateKey(userId) : null;
  const out = [];
  for (const s of shared) {
    let title = null;
    if (masterKey && s.wrapped_key && s.encrypted_title) {
      try {
        title = await decryptTitle(s.encrypted_title, await unwrapKey(s.wrapped_key, masterKey));
      } catch (e) {
        console.warn('shared title decrypt failed', e);
      }
    }
    out.push({
      slateId: s.slate_id, owner: s.owner_username, editorMode: s.editor_mode,
      updatedAt: s.updated_at, wordCount: s.word_count, charCount: s.char_count, title
    });
  }
  return out;
}

// Full shared slate for the read view: unwrap my doc key copy, decrypt.
export async function fetchSharedSlate(slateId, userId) {
  const data = await api(`/collab/slates/${slateId}`);
  const masterKey = await requireMasterKey(userId);
  const docKey = await unwrapKey(data.wrapped_key, masterKey);
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
