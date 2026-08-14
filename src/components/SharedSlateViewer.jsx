import React, { useState, useEffect } from 'react';
import { strings } from '../strings';
import { fetchSharedSlate } from '../collab';
import { usePresence } from '../presence';

// Collaborative editor loads on demand (yjs + CM6 live in lazy chunks)
const CollabEditor = React.lazy(() => import('./CollabEditor'));

// A slate someone shared with the signed-in user: full live editing over the
// encrypted relay. The doc key arrives wrapped to this member's master key
// (src/collab.js); the editor decrypts, merges and renders remote carets.
export function SharedSlateViewer({ slateId, userId, onBack }) {
  const [slate, setSlate] = useState(null);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('plain');
  const [live, setLive] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [title, setTitle] = useState(null);

  const peers = usePresence({
    slateId,
    docKey: slate ? slate.docKey : null,
    username: localStorage.getItem('justtype-username'),
    enabled: !!(slate && slate.docKey && !removed)
  });

  useEffect(() => {
    let cancelled = false;
    setSlate(null);
    setError('');
    setRemoved(false);
    setLive(false);
    fetchSharedSlate(slateId, userId)
      .then((data) => {
        if (cancelled) return;
        setSlate(data);
        setTitle(data.title);
        setViewMode(data.editorMode === 'wysiwyg' ? 'rich' : 'plain');
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message || 'failed to load').toLowerCase());
      });
    return () => { cancelled = true; };
  }, [slateId, userId]);

  // Keep the shown title in step with the doc's first line as people edit.
  const handleContentChange = (text) => {
    const firstLine = (text || '').split('\n')[0].trim().replace(/^#{1,6}\s+/, '');
    setTitle(firstLine || null);
  };

  return (
    <div className="min-h-screen bg-[var(--theme-bg)] text-[var(--theme-text)] flex flex-col">
      <div className="max-w-3xl mx-auto w-full px-8 pt-8">
        <div className="mb-8">
          <button onClick={onBack} className="text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors text-sm">
            {strings.collab.viewer.back}
          </button>
        </div>

        {error ? (
          <p className="text-sm" style={{ color: 'var(--theme-red)' }}>{error}</p>
        ) : !slate ? (
          <p className="text-sm text-[var(--theme-text-dim)]">{strings.collab.viewer.loading}</p>
        ) : (
          <div className="mb-4">
            <h1 className="text-3xl text-[var(--theme-accent)] mb-4">{title || strings.slates.untitled}</h1>
            <div className="text-sm text-[var(--theme-text-dim)] flex gap-2 flex-wrap items-center">
              <span>{strings.collab.viewer.sharedBy(slate.owner)}</span>
              {removed ? (
                <>
                  <span>|</span>
                  <span style={{ color: 'var(--theme-red)' }}>{strings.collab.viewer.accessRemoved}</span>
                </>
              ) : live && (
                <>
                  <span>|</span>
                  <span className="text-[var(--theme-green)]">{strings.collab.viewer.live}</span>
                </>
              )}
              {peers.length > 0 && !removed && (
                <>
                  <span>|</span>
                  <span className="text-[var(--theme-green)]" title={peers.map(p => p.username).join(', ')}>
                    {strings.collab.presence.here(peers)}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {slate && !error && (
        <main className="flex-grow flex justify-center w-full overflow-y-auto">
          <React.Suspense
            fallback={
              <div className="w-full max-w-3xl p-8 text-sm animate-pulse" style={{ color: 'var(--theme-text-dim)' }}>
                {strings.collab.viewer.loading}
              </div>
            }
          >
            <CollabEditor
              slateId={slateId}
              docKey={slate.docKey}
              username={localStorage.getItem('justtype-username')}
              mode={viewMode === 'rich' ? 'wysiwyg' : 'plain'}
              initialContent={slate.content}
              onChange={handleContentChange}
              onReady={() => setLive(true)}
              onRemoved={() => { setRemoved(true); setLive(false); }}
              onError={(e) => setError(String(e.message || 'failed to load').toLowerCase())}
            />
          </React.Suspense>
        </main>
      )}

      {slate && (
        <div className="fixed bottom-6 left-6 md:bottom-8 md:left-8 text-sm flex items-center gap-3 z-50">
          <button
            onClick={() => setViewMode(viewMode === 'rich' ? 'plain' : 'rich')}
            className="opacity-50 hover:opacity-100 transition-opacity"
          >
            {strings.collab.viewer.view(viewMode === 'rich' ? 'wysiwyg' : 'plain')}
          </button>
        </div>
      )}
    </div>
  );
}
