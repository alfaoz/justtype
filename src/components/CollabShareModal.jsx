import React, { useState, useEffect, useCallback, useRef } from 'react';
import { strings } from '../strings';
import {
  enableCollab, disableCollab, inviteToSlate, fetchMembers, removeMember,
  fetchMembersAsMember, leaveSharedSlate, createInviteLink, revokeInviteLink, rotateDocKey
} from '../collab';
import { withViewTransition } from '../viewTransition';

// Owner-side sharing UI for a slate. All key material is generated and wrapped
// in the browser (see src/collab.js); this component only orchestrates.
//
// getCurrent() must return { content, title } for the slate as currently
// edited, so enable/disable re-encrypt exactly what the user sees. docKey is
// the live doc key (null when the slate isn't collaborative); onDocKeyChange
// hands the new key (or null after disable) back to the Writer so its save
// path encrypts with the right key.
// memberView: a collaborator (not the owner) opened this — show who's in
// the group and offer leave; inviting/removing/turning off stay owner-only.
export function CollabShareModal({ slateNumber, userId, username, docKey, getCurrent, onDocKeyChange, onClose, memberView = false, sharedSlateId = null, onLeave, onOpenHistory = null }) {
  const close = () => withViewTransition(onClose);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const leaveTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(leaveTimerRef.current), []);

  const handleLeaveClick = async () => {
    if (!confirmLeave) {
      setConfirmLeave(true);
      leaveTimerRef.current = setTimeout(() => setConfirmLeave(false), 3000);
      return;
    }
    clearTimeout(leaveTimerRef.current);
    try {
      await leaveSharedSlate(sharedSlateId);
      if (onLeave) onLeave();
    } catch (e) {
      setError(String(e.message || '').toLowerCase());
    }
  };
  const [members, setMembers] = useState([]);
  const [inviteName, setInviteName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Two-step turn-off: first click arms "sure?", reverts after 3s untouched
  const [confirmDisable, setConfirmDisable] = useState(false);
  const confirmTimerRef = useRef(null);
  // Same two-step for removing a member — armed per username
  const [confirmRemove, setConfirmRemove] = useState(null);
  const removeTimerRef = useRef(null);
  // Invite link: metadata from the server, plus the full URL when we just
  // made one (the fragment key exists only client-side, so the URL is
  // only ever shown right after creation).
  const [linkInfo, setLinkInfo] = useState(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [confirmRevokeLink, setConfirmRevokeLink] = useState(false);
  const revokeTimerRef = useRef(null);
  const [rotating, setRotating] = useState(false);

  useEffect(() => () => {
    clearTimeout(confirmTimerRef.current);
    clearTimeout(removeTimerRef.current);
    clearTimeout(revokeTimerRef.current);
  }, []);

  const enabled = !!docKey;

  const loadMembers = useCallback(async () => {
    try {
      const data = memberView ? await fetchMembersAsMember(sharedSlateId) : await fetchMembers(slateNumber);
      setMembers(data.members || []);
      if (!memberView) setLinkInfo(data.link || null);
    } catch (e) {
      setError(String(e.message || '').toLowerCase());
    }
  }, [slateNumber, memberView, sharedSlateId]);

  useEffect(() => {
    if (enabled || memberView) loadMembers();
  }, [enabled, memberView, loadMembers]);

  const handleEnable = async () => {
    setBusy(true); setError('');
    try {
      const { content, title } = getCurrent();
      const { docKey: key, slateId } = await enableCollab(slateNumber, userId, content, title);
      onDocKeyChange(key, slateId);
    } catch (e) {
      setError(String(e.message || '').toLowerCase());
    } finally {
      setBusy(false);
    }
  };

  const handleDisableClick = () => {
    if (!confirmDisable) {
      setConfirmDisable(true);
      confirmTimerRef.current = setTimeout(() => setConfirmDisable(false), 3000);
      return;
    }
    clearTimeout(confirmTimerRef.current);
    setConfirmDisable(false);
    handleDisable();
  };

  const handleDisable = async () => {
    setBusy(true); setError('');
    try {
      const { content, title } = getCurrent();
      await disableCollab(slateNumber, userId, content, title);
      onDocKeyChange(null, null);
      setMembers([]);
    } catch (e) {
      setError(String(e.message || '').toLowerCase());
    } finally {
      setBusy(false);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    const name = inviteName.trim().toLowerCase();
    if (!name || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await inviteToSlate(slateNumber, name, docKey);
      setInviteName('');
      setNotice(`invited ${name}`);
      await loadMembers();
    } catch (e2) {
      setError(String(e2.message || '').toLowerCase());
    } finally {
      setBusy(false);
    }
  };

  // Rotation is what makes removal and link revocation real: the old key
  // stops working everywhere. The new key flows back to the Writer so the
  // live editor rebuilds under it.
  const doRotate = async () => {
    setRotating(true);
    try {
      const { content, title } = getCurrent();
      const newKey = await rotateDocKey(slateNumber, userId, content, title, docKey);
      onDocKeyChange(newKey, undefined);
      setLinkUrl('');
      setLinkInfo(null);
    } finally {
      setRotating(false);
    }
  };

  const handleRemoveClick = (name) => {
    if (confirmRemove !== name) {
      clearTimeout(removeTimerRef.current);
      setConfirmRemove(name);
      removeTimerRef.current = setTimeout(() => setConfirmRemove(null), 3000);
      return;
    }
    clearTimeout(removeTimerRef.current);
    setConfirmRemove(null);
    handleRemove(name);
  };

  const handleRemove = async (name) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await removeMember(slateNumber, name);
      await doRotate();
      setNotice(strings.collab.modal.removedRotated);
      await loadMembers();
    } catch (e) {
      setError(String(e.message || '').toLowerCase());
    } finally {
      setBusy(false);
    }
  };

  const handleCreateLink = async () => {
    setBusy(true); setError(''); setNotice(''); setLinkCopied(false);
    try {
      const { url } = await createInviteLink(slateNumber, docKey);
      setLinkUrl(url);
      await loadMembers();
    } catch (e) {
      setError(String(e.message || '').toLowerCase());
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(linkUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch { /* clipboard unavailable — the url stays selectable */ }
  };

  const handleRevokeLinkClick = () => {
    if (!confirmRevokeLink) {
      setConfirmRevokeLink(true);
      revokeTimerRef.current = setTimeout(() => setConfirmRevokeLink(false), 3000);
      return;
    }
    clearTimeout(revokeTimerRef.current);
    setConfirmRevokeLink(false);
    handleRevokeLink();
  };

  const handleRevokeLink = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await revokeInviteLink(slateNumber);
      await doRotate();
      setNotice(strings.collab.modal.revokedRotated);
      await loadMembers();
    } catch (e) {
      setError(String(e.message || '').toLowerCase());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4" onClick={close}>
      <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg md:text-xl text-white mb-4">{strings.collab.modal.title}</h2>

        {memberView ? (
          <>
            <div className="mb-6">
              <p className="text-xs text-[var(--theme-text-dim)] mb-2">{strings.collab.modal.membersTitle}</p>
              <div className="flex flex-col gap-1">
                {members.map((m) => (
                  <div key={m.username} className="flex items-center justify-between text-sm py-1">
                    <span className="text-[var(--theme-text-muted)]">
                      {m.username}{m.username === username ? ` (${strings.collab.modal.you})` : ''}
                      <span className="text-[var(--theme-text-dim)] ml-2">
                        {m.role === 'owner' ? strings.collab.modal.roleOwner : (m.status === 'pending' ? strings.collab.modal.statusPending : '')}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {error && <p className="text-sm mb-3" style={{ color: 'var(--theme-red)' }}>{error}</p>}
            <div className="flex gap-3 items-center">
              <button
                onClick={handleLeaveClick}
                className={`transition-colors text-xs ${confirmLeave ? 'text-[var(--theme-red)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-red)]'}`}
              >
                {confirmLeave ? strings.collab.shared.leaveConfirm : strings.collab.shared.leave}
              </button>
              {onOpenHistory && (
                <button
                  onClick={onOpenHistory}
                  className="text-xs text-[var(--theme-text-dim)] hover:text-white transition-colors"
                >
                  {strings.collab.history.button}
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={close}
                className="border border-[var(--theme-border)] py-2 px-6 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
              >
                {strings.collab.modal.close}
              </button>
            </div>
          </>
        ) : !enabled ? (
          <>
            <p className="text-sm text-[var(--theme-text-muted)] mb-6">{strings.collab.modal.explainer}</p>
            {error && <p className="text-sm mb-4" style={{ color: 'var(--theme-red)' }}>{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={handleEnable}
                disabled={busy}
                className="flex-1 bg-white text-black py-2 md:py-3 rounded hover:bg-[#e5e5e5] transition-all text-sm font-medium disabled:opacity-50"
              >
                {busy ? strings.collab.modal.enabling : strings.collab.modal.enableButton}
              </button>
              <button
                onClick={close}
                className="flex-1 border border-[var(--theme-border)] py-2 md:py-3 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
              >
                {strings.collab.modal.close}
              </button>
            </div>
          </>
        ) : (
          <>
            <form onSubmit={handleInvite} className="flex gap-2 mb-4">
              <input
                type="text"
                value={inviteName}
                onChange={(e) => { setInviteName(e.target.value); setError(''); setNotice(''); }}
                placeholder={strings.collab.modal.inputPlaceholder}
                className="flex-1 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-3 py-2 focus:outline-none focus:border-[var(--theme-text-dim)] text-white text-sm"
                autoFocus
              />
              <button
                type="submit"
                disabled={busy || !inviteName.trim()}
                className="bg-white text-black px-4 py-2 rounded hover:bg-[#e5e5e5] transition-all text-sm font-medium disabled:opacity-50"
              >
                {busy ? strings.collab.modal.inviting : strings.collab.modal.inviteButton}
              </button>
            </form>
            {error && <p className="text-sm mb-3" style={{ color: 'var(--theme-red)' }}>{error}</p>}
            {notice && !error && <p className="text-sm mb-3 text-[var(--theme-text-muted)]">{notice}</p>}

            <div className="mb-6">
              <p className="text-xs text-[var(--theme-text-dim)] mb-2">{strings.collab.modal.membersTitle}</p>
              <div className="flex flex-col gap-1">
                {members.map((m) => (
                  <div key={m.username} className="flex items-center justify-between text-sm py-1">
                    <span className="text-[var(--theme-text-muted)]">
                      {m.username}{m.username === username ? ` (${strings.collab.modal.you})` : ''}
                      <span className="text-[var(--theme-text-dim)] ml-2">
                        {m.role === 'owner' ? strings.collab.modal.roleOwner : (m.status === 'pending' ? strings.collab.modal.statusPending : '')}
                      </span>
                    </span>
                    {m.role !== 'owner' && (
                      <button
                        onClick={() => handleRemoveClick(m.username)}
                        disabled={busy}
                        className={`transition-colors text-xs disabled:opacity-50 ${confirmRemove === m.username ? 'text-[var(--theme-red)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-red)]'}`}
                      >
                        {confirmRemove === m.username ? strings.collab.modal.removeConfirm : strings.collab.modal.remove}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Invite link: the URL exists only right after creation (its
                fragment carries the doc key, which the server never holds) */}
            <div className="mb-6">
              <p className="text-xs text-[var(--theme-text-dim)] mb-2">{strings.collab.modal.link.title}</p>
              {linkUrl ? (
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    readOnly
                    value={linkUrl}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 min-w-0 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-3 py-2 text-[var(--theme-text-muted)] text-xs focus:outline-none"
                  />
                  <button
                    onClick={copyLink}
                    className="bg-white text-black px-3 py-2 rounded hover:bg-[#e5e5e5] transition-all text-xs font-medium"
                  >
                    {linkCopied ? strings.collab.modal.link.copied : strings.collab.modal.link.copy}
                  </button>
                  <button
                    onClick={handleRevokeLinkClick}
                    disabled={busy}
                    className={`transition-colors text-xs disabled:opacity-50 ${confirmRevokeLink ? 'text-[var(--theme-red)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-red)]'}`}
                  >
                    {confirmRevokeLink ? strings.collab.modal.link.revokeConfirm : strings.collab.modal.link.revoke}
                  </button>
                </div>
              ) : linkInfo ? (
                <div className="flex gap-3 items-center text-xs">
                  <span className="text-[var(--theme-text-muted)]">{strings.collab.modal.link.active}</span>
                  <button
                    onClick={handleCreateLink}
                    disabled={busy}
                    className="text-[var(--theme-text-dim)] hover:text-white transition-colors disabled:opacity-50"
                  >
                    {strings.collab.modal.link.copyNew}
                  </button>
                  <button
                    onClick={handleRevokeLinkClick}
                    disabled={busy}
                    className={`transition-colors disabled:opacity-50 ${confirmRevokeLink ? 'text-[var(--theme-red)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-red)]'}`}
                  >
                    {confirmRevokeLink ? strings.collab.modal.link.revokeConfirm : strings.collab.modal.link.revoke}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleCreateLink}
                  disabled={busy}
                  className="text-xs text-[var(--theme-text-dim)] hover:text-white transition-colors disabled:opacity-50"
                >
                  {strings.collab.modal.link.create}
                </button>
              )}
              <p className="text-xs text-[var(--theme-text-dim)] opacity-70 mt-2">{strings.collab.modal.link.hint}</p>
            </div>

            <div className="flex gap-3 items-center">
              <button
                onClick={handleDisableClick}
                disabled={busy}
                className={`transition-colors text-xs disabled:opacity-50 ${confirmDisable ? 'text-[var(--theme-red)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-red)]'}`}
                title={strings.collab.modal.disableHint}
              >
                {busy ? strings.collab.modal.disabling : (confirmDisable ? strings.collab.modal.disableConfirm : strings.collab.modal.disableButton)}
              </button>
              {onOpenHistory && (
                <button
                  onClick={onOpenHistory}
                  disabled={busy}
                  className="text-xs text-[var(--theme-text-dim)] hover:text-white transition-colors disabled:opacity-50"
                >
                  {strings.collab.history.button}
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={close}
                className="border border-[var(--theme-border)] py-2 px-6 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
              >
                {strings.collab.modal.close}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
