import React, { useState, useEffect, useCallback, useRef } from 'react';
import { strings } from '../strings';
import { enableCollab, disableCollab, inviteToSlate, fetchMembers, removeMember } from '../collab';

// Owner-side sharing UI for a slate. All key material is generated and wrapped
// in the browser (see src/collab.js); this component only orchestrates.
//
// getCurrent() must return { content, title } for the slate as currently
// edited, so enable/disable re-encrypt exactly what the user sees. docKey is
// the live doc key (null when the slate isn't collaborative); onDocKeyChange
// hands the new key (or null after disable) back to the Writer so its save
// path encrypts with the right key.
export function CollabShareModal({ slateNumber, userId, username, docKey, getCurrent, onDocKeyChange, onClose }) {
  const [members, setMembers] = useState([]);
  const [inviteName, setInviteName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Two-step turn-off: first click arms "sure?", reverts after 3s untouched
  const [confirmDisable, setConfirmDisable] = useState(false);
  const confirmTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(confirmTimerRef.current), []);

  const enabled = !!docKey;

  const loadMembers = useCallback(async () => {
    try {
      const data = await fetchMembers(slateNumber);
      setMembers(data.members || []);
    } catch (e) {
      setError(String(e.message || '').toLowerCase());
    }
  }, [slateNumber]);

  useEffect(() => {
    if (enabled) loadMembers();
  }, [enabled, loadMembers]);

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

  const handleRemove = async (name) => {
    setBusy(true); setError('');
    try {
      await removeMember(slateNumber, name);
      await loadMembers();
    } catch (e) {
      setError(String(e.message || '').toLowerCase());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg md:text-xl text-white mb-4">{strings.collab.modal.title}</h2>

        {!enabled ? (
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
                onClick={onClose}
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
                        onClick={() => handleRemove(m.username)}
                        disabled={busy}
                        className="text-[var(--theme-text-dim)] hover:text-[var(--theme-red)] transition-colors text-xs disabled:opacity-50"
                      >
                        {strings.collab.modal.remove}
                      </button>
                    )}
                  </div>
                ))}
              </div>
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
              <div className="flex-1" />
              <button
                onClick={onClose}
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
