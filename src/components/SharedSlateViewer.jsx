import React, { useState, useEffect } from 'react';
import { strings } from '../strings';
import { fetchSharedSlate } from '../collab';

// Rendered-markdown view for shared slates written in the rich editor (same lazy chunk as the editor)
const MarkdownView = React.lazy(() => import('./LivePreviewEditor').then(m => ({ default: m.MarkdownView })));

// Read view of a slate someone shared with the signed-in user. Content arrives
// as ciphertext and is decrypted here with the member's copy of the doc key
// (src/collab.js). Read-only until the realtime channel ships.
export function SharedSlateViewer({ slateId, userId, onBack }) {
  const [slate, setSlate] = useState(null);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('plain');

  useEffect(() => {
    let cancelled = false;
    setSlate(null);
    setError('');
    fetchSharedSlate(slateId, userId)
      .then((data) => {
        if (cancelled) return;
        setSlate(data);
        setViewMode(data.editorMode === 'wysiwyg' ? 'rich' : 'plain');
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message || 'failed to load').toLowerCase());
      });
    return () => { cancelled = true; };
  }, [slateId, userId]);

  return (
    <div className="min-h-screen bg-[var(--theme-bg)] text-[var(--theme-text)]">
      <main className="max-w-3xl mx-auto p-8">
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
          <>
            <div className="mb-8">
              <h1 className="text-3xl text-[var(--theme-accent)] mb-4">{slate.title || strings.slates.untitled}</h1>
              <div className="text-sm text-[var(--theme-text-dim)] flex gap-2 flex-wrap items-center">
                <span>{strings.collab.viewer.sharedBy(slate.owner)}</span>
                <span>|</span>
                <span>{strings.collab.shared.readOnlyNote}</span>
              </div>
            </div>

            {viewMode === 'rich' ? (
              <React.Suspense
                fallback={<div className="leading-relaxed text-[var(--theme-text)] whitespace-pre-wrap">{slate.content}</div>}
              >
                <MarkdownView content={slate.content} puntoClass="leading-relaxed" />
              </React.Suspense>
            ) : (
              <div className="leading-relaxed text-[var(--theme-text)] whitespace-pre-wrap">
                {slate.content}
              </div>
            )}
          </>
        )}
      </main>

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
