import React, { useState, useEffect } from 'react';
import * as Y from 'yjs';
import { strings } from '../strings';
import { fetchCheckpoints, fetchCheckpointState } from '../collab';
import { withViewTransition } from '../viewTransition';

// Version history for a collab slate. Checkpoints are full encrypted Y.Doc
// states; each preview decrypts one and rebuilds the text right here in the
// browser. Restoring applies the old text as a normal collaborative edit —
// nothing is rewritten, and it undoes like any other keystroke.

const rebuildText = (bytes) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  const text = doc.getText('content').toString();
  doc.destroy();
  return text;
};

const formatWhen = (unixSeconds) => {
  const d = new Date(unixSeconds * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export default function CollabHistoryModal({ slateId, docKey, onRestore, onClose }) {
  const s = strings.collab.history;
  const close = () => withViewTransition(onClose);
  const [checkpoints, setCheckpoints] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);       // checkpoint id
  const [previewText, setPreviewText] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { checkpoints: list } = await fetchCheckpoints(slateId);
        if (!cancelled) setCheckpoints(list || []);
      } catch (e) {
        if (!cancelled) { setCheckpoints([]); setError(String(e.message || '').toLowerCase()); }
      }
    })();
    return () => { cancelled = true; };
  }, [slateId]);

  const openPreview = async (cp) => {
    setSelected(cp.id);
    setConfirmRestore(false);
    setPreviewText(null);
    setPreviewLoading(true);
    setError('');
    try {
      const bytes = await fetchCheckpointState(slateId, cp.id, docKey);
      setPreviewText(rebuildText(bytes));
    } catch (e) {
      setError(String(e.message || 'could not open this checkpoint').toLowerCase());
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRestoreClick = () => {
    if (!confirmRestore) {
      setConfirmRestore(true);
      setTimeout(() => setConfirmRestore(false), 3000);
      return;
    }
    onRestore(previewText);
    close();
  };

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4" onClick={close}>
      <div
        className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-2xl w-full flex flex-col"
        style={{ maxHeight: 'min(80vh, 640px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg md:text-xl text-white mb-4">{s.title}</h2>

        {checkpoints === null ? (
          <p className="text-sm text-[var(--theme-text-dim)] animate-pulse">{s.loading}</p>
        ) : checkpoints.length === 0 ? (
          <p className="text-sm text-[var(--theme-text-muted)]">{s.empty}</p>
        ) : (
          <div className="flex gap-4 min-h-0 flex-1">
            {/* checkpoint list */}
            <div className="w-44 md:w-52 flex-shrink-0 overflow-y-auto flex flex-col gap-1 pr-1">
              {checkpoints.map((cp) => (
                <button
                  key={cp.id}
                  onClick={() => openPreview(cp)}
                  className={`text-left px-3 py-2 rounded text-xs transition-colors ${
                    selected === cp.id
                      ? 'bg-[var(--theme-bg-tertiary)] text-white'
                      : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-tertiary)]'
                  }`}
                >
                  <span className="block">{formatWhen(cp.created_at)}</span>
                  {cp.author && <span className="block text-[var(--theme-text-dim)] mt-0.5">{s.by(cp.author)}</span>}
                </button>
              ))}
            </div>

            {/* preview */}
            <div className="flex-1 min-w-0 flex flex-col">
              {selected === null ? (
                <p className="text-sm text-[var(--theme-text-dim)]">{s.pick}</p>
              ) : previewLoading ? (
                <p className="text-sm text-[var(--theme-text-dim)] animate-pulse">{s.loadingPreview}</p>
              ) : previewText !== null ? (
                <>
                  <pre className="flex-1 min-h-0 overflow-y-auto whitespace-pre-wrap text-xs text-[var(--theme-text-muted)] bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded p-3 font-mono">
                    {previewText || s.emptyDoc}
                  </pre>
                  <div className="flex justify-end mt-3">
                    <button
                      onClick={handleRestoreClick}
                      className={`text-sm transition-colors ${confirmRestore ? 'text-[var(--theme-red)]' : 'text-white hover:opacity-80'}`}
                    >
                      {confirmRestore ? s.restoreConfirm : s.restore}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}

        {error && <p className="text-sm mt-3" style={{ color: 'var(--theme-red)' }}>{error}</p>}

        <div className="flex justify-end mt-4">
          <button
            onClick={close}
            className="border border-[var(--theme-border)] py-2 px-6 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
          >
            {strings.collab.modal.close}
          </button>
        </div>
      </div>
    </div>
  );
}
