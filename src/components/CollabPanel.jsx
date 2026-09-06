import React, { useState, useEffect, useRef } from 'react';
import { useEscape } from '../useEscape';
import * as Y from 'yjs';
import { strings } from '../strings';
import { fetchCheckpoints, fetchCheckpointState, labelCheckpoint } from '../collab';
import { CollabShareModal } from './CollabShareModal';
import { NearbyTab } from './NearbyTab';

// One home for everything collaborative on a slate: who is in it (people) and
// where it has been (history). It is a side panel rather than a modal on
// purpose, because the useful thing to do with an old version is compare it
// against the document you are looking at.
//
// Checkpoints are full encrypted Y.Doc states. Each preview decrypts one and
// rebuilds the text locally; restoring applies it as an ordinary collaborative
// edit, so it broadcasts and undoes like any other keystroke.

const rebuildText = (bytes) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  const text = doc.getText('content').toString();
  doc.destroy();
  return text;
};

const formatWhen = (unixSeconds) => {
  const d = new Date(unixSeconds * 1000);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
};

// Line-level LCS. Slates are prose, so line granularity reads better than
// character granularity, and the quadratic table is bounded well under the
// sizes a checkpoint realistically holds.
const MAX_DIFF_LINES = 1200;

// The live document sits at the top of the timeline as a selectable row.
const CURRENT_ID = '__current__';

export function lineDiff(oldText, newText) {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  if (n > MAX_DIFF_LINES || m > MAX_DIFF_LINES) return null;

  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j]
        ? lcs[(i + 1) * w + (j + 1)] + 1
        : Math.max(lcs[(i + 1) * w + j], lcs[i * w + (j + 1)]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 'same', text: a[i] }); i++; j++; }
    else if (lcs[(i + 1) * w + j] >= lcs[i * w + (j + 1)]) { out.push({ t: 'del', text: a[i] }); i++; }
    else { out.push({ t: 'add', text: b[j] }); j++; }
  }
  while (i < n) out.push({ t: 'del', text: a[i++] });
  while (j < m) out.push({ t: 'add', text: b[j++] });
  return out;
}

function HistoryTab({ slateId, docKey, currentText, onRestore, onOpenAsNewSlate }) {
  const s = strings.collab.history;
  const [checkpoints, setCheckpoints] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [texts, setTexts] = useState({});   // checkpoint id -> decrypted text
  const [loadingIds, setLoadingIds] = useState({});
  const [mode, setMode] = useState('prev'); // 'prev' | 'current' | 'text'
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);
  const restoreTimerRef = useRef(null);

  useEffect(() => () => clearTimeout(restoreTimerRef.current), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { checkpoints: list } = await fetchCheckpoints(slateId);
        if (cancelled) return;
        setCheckpoints(list || []);
        if (list && list.length) {
          setSelected(CURRENT_ID);
          ensureText(list[0]);
        }
      } catch (e) {
        if (!cancelled) { setCheckpoints([]); setError(String(e.message || '').toLowerCase()); }
      }
    })();
    return () => { cancelled = true; };
  }, [slateId]);

  // The list is newest first, so a checkpoint's "previous" is the next one
  // along; the live row's predecessor is the most recent checkpoint.
  const isCurrent = selected === CURRENT_ID;
  const index = checkpoints && !isCurrent ? checkpoints.findIndex((c) => c.id === selected) : -1;
  const selectedCp = index >= 0 ? checkpoints[index] : null;
  const previousCp = isCurrent
    ? (checkpoints && checkpoints.length ? checkpoints[0] : null)
    : (index >= 0 && index + 1 < checkpoints.length ? checkpoints[index + 1] : null);

  // Decrypt on demand and memoise: switching compare modes or tabs must not
  // refetch, and the previous checkpoint is usually needed straight away.
  const ensureText = async (cp) => {
    if (!cp || texts[cp.id] !== undefined) return;
    setLoadingIds((m) => ({ ...m, [cp.id]: true }));
    try {
      const bytes = await fetchCheckpointState(slateId, cp.id, docKey);
      const text = rebuildText(bytes);
      setTexts((m) => ({ ...m, [cp.id]: text }));
    } catch (e) {
      setError(String(e.message || 'could not open this checkpoint').toLowerCase());
    } finally {
      setLoadingIds((m) => { const n = { ...m }; delete n[cp.id]; return n; });
    }
  };

  const select = (cp) => {
    setSelected(cp ? cp.id : CURRENT_ID);
    setConfirmRestore(false);
    setNaming(false);
    setError('');
    if (!cp) {
      // live row: its comparison base is the newest checkpoint
      if (checkpoints.length) ensureText(checkpoints[0]);
      return;
    }
    ensureText(cp);
    const i = checkpoints.findIndex((c) => c.id === cp.id);
    if (i >= 0 && i + 1 < checkpoints.length) ensureText(checkpoints[i + 1]);
  };

  const submitName = async () => {
    if (!selectedCp) return;
    setSavingName(true);
    try {
      const { label } = await labelCheckpoint(slateId, selectedCp.id, nameDraft);
      setCheckpoints((list) => list.map((c) => (c.id === selectedCp.id ? { ...c, label } : c)));
      setNaming(false);
    } catch (e) {
      setError(String(e.message || '').toLowerCase());
    } finally {
      setSavingName(false);
    }
  };

  const handleRestoreClick = () => {
    if (!confirmRestore) {
      setConfirmRestore(true);
      restoreTimerRef.current = setTimeout(() => setConfirmRestore(false), 3000);
      return;
    }
    clearTimeout(restoreTimerRef.current);
    onRestore(texts[selected]);
  };

  if (checkpoints === null) {
    return <p className="text-sm text-[var(--theme-text-dim)] animate-pulse p-4">{s.loading}</p>;
  }
  if (checkpoints.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--theme-text-muted)]">{s.empty}</p>
        {error && <p className="text-sm mt-3" style={{ color: 'var(--theme-red)' }}>{error}</p>}
      </div>
    );
  }

  const selectedText = selected === null ? undefined : isCurrent ? (currentText ?? '') : texts[selected];
  // "vs current" is meaningless on the live row, and "vs previous" is
  // impossible on the oldest checkpoint; fall back without losing the choice.
  const view = isCurrent
    ? (mode === 'text' ? 'text' : 'prev')
    : (mode === 'prev' && !previousCp ? 'current' : mode);
  const busy = selected !== null && ((!isCurrent && loadingIds[selected]) || (previousCp && view === 'prev' && loadingIds[previousCp.id]));
  const baseText = view === 'prev' ? texts[previousCp?.id] : selectedText;
  const compareText = view === 'prev' ? selectedText : currentText ?? '';
  const canDiff = view !== 'text' && selectedText !== undefined && baseText !== undefined;
  const diff = canDiff ? lineDiff(baseText, compareText) : null;
  const diffTooBig = canDiff && diff === null;
  const unchanged = diff !== null && diff.every((l) => l.t === 'same');

  const Seg = ({ id, label, disabled }) => (
    <button
      onClick={() => !disabled && setMode(id)}
      disabled={disabled}
      title={disabled ? s.noPrevious : undefined}
      className={`px-2 py-1 rounded text-[0.7rem] transition-colors ${disabled ? 'opacity-30 cursor-not-allowed' : 'hover:text-white'}`}
      style={{
        background: view === id ? 'var(--theme-bg-tertiary)' : 'transparent',
        color: view === id ? 'var(--theme-accent)' : 'var(--theme-text-dim)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="overflow-y-auto flex-shrink-0 px-4 pt-3 pb-2" style={{ maxHeight: '36%' }}>
        <button onClick={() => select(null)} className="w-full text-left flex gap-3 group">
          <span className="relative flex flex-col items-center flex-shrink-0 w-3">
            <span
              className="w-2 h-2 rounded-full mt-1.5 transition-all"
              style={{
                background: isCurrent ? 'var(--theme-accent)' : 'transparent',
                boxShadow: `inset 0 0 0 1.5px var(--theme-accent)`,
              }}
            />
            <span className="flex-1 w-px" style={{ background: 'var(--theme-border-light)' }} />
          </span>
          <span
            className={`flex-1 min-w-0 rounded px-2 py-1.5 mb-1 transition-colors ${
              isCurrent ? 'bg-[var(--theme-bg-tertiary)]' : 'group-hover:bg-[var(--theme-bg-tertiary)]'
            }`}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--theme-accent)' }}>{s.currentRow}</span>
              <span className="text-[0.65rem] text-[var(--theme-text-dim)]">{s.currentRowMeta}</span>
            </span>
          </span>
        </button>

        {checkpoints.map((cp) => {
          const active = selected === cp.id;
          return (
            <button key={cp.id} onClick={() => select(cp)} className="w-full text-left flex gap-3 group">
              <span className="relative flex flex-col items-center flex-shrink-0 w-3">
                <span
                  className="w-2 h-2 rounded-full mt-1.5 transition-colors"
                  style={{ background: active ? 'var(--theme-accent)' : 'var(--theme-border)' }}
                />
                <span className="flex-1 w-px" style={{ background: 'var(--theme-border-light)' }} />
              </span>
              <span
                className={`flex-1 min-w-0 rounded px-2 py-1.5 mb-1 transition-colors ${
                  active ? 'bg-[var(--theme-bg-tertiary)]' : 'group-hover:bg-[var(--theme-bg-tertiary)]'
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`text-xs ${active ? 'text-white' : 'text-[var(--theme-text-muted)]'}`}>
                    {formatWhen(cp.created_at)}
                  </span>
                  {cp.author && <span className="text-[0.65rem] text-[var(--theme-text-dim)]">{s.by(cp.author)}</span>}
                </span>
                {cp.label && (
                  <span className="block text-[0.7rem] mt-0.5 truncate" style={{ color: 'var(--theme-accent)' }}>
                    {cp.label}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 flex flex-col border-t px-4 pt-3" style={{ borderColor: 'var(--theme-border-light)' }}>
        {selected === null ? (
          <p className="text-sm text-[var(--theme-text-dim)]">{s.pick}</p>
        ) : busy ? (
          <p className="text-sm text-[var(--theme-text-dim)] animate-pulse">{s.loadingPreview}</p>
        ) : selectedText !== undefined ? (
          <>
            <div className="flex items-center gap-1 pb-2 -ml-1">
              <Seg id="prev" label={s.comparePrev} disabled={!previousCp} />
              {!isCurrent && <Seg id="current" label={s.compareCurrent} />}
              <Seg id="text" label={s.textTab} />
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto text-xs font-mono rounded border p-3 whitespace-pre-wrap"
              style={{ background: 'var(--theme-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}
            >
              {view === 'text' ? (
                selectedText || s.emptyDoc
              ) : diffTooBig ? (
                <>
                  <div className="pb-2 text-[var(--theme-text-dim)]">{s.diffTooBig}</div>
                  {selectedText || s.emptyDoc}
                </>
              ) : unchanged ? (
                <span className="text-[var(--theme-text-dim)]">
                  {isCurrent ? s.noChangesSinceLast : view === 'prev' ? s.noChangesPrev : s.noChangesCurrent}
                </span>
              ) : diff ? (
                diff.map((line, idx) => (
                  <div
                    key={idx}
                    style={{
                      color: line.t === 'add' ? 'var(--theme-green)' : line.t === 'del' ? 'var(--theme-red)' : 'var(--theme-text-dim)',
                      opacity: line.t === 'same' ? 0.5 : 1,
                    }}
                  >
                    {line.t === 'add' ? '+ ' : line.t === 'del' ? '- ' : '  '}{line.text || ' '}
                  </div>
                ))
              ) : null}
            </div>

            {view !== 'text' && (
              <p className="text-[0.65rem] pt-1.5 text-[var(--theme-text-dim)]">
                {isCurrent ? s.legendSinceLast : view === 'prev' ? s.legendPrev : (previousCp ? s.legendCurrent : s.noPrevious)}
              </p>
            )}

            {!isCurrent && <div className="pt-3">
              {naming ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitName();
                      if (e.key === 'Escape') { e.stopPropagation(); setNaming(false); }
                    }}
                    placeholder={s.namePlaceholder}
                    maxLength={60}
                    className="flex-1 min-w-0 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-2 py-1 text-xs focus:outline-none focus:border-[var(--theme-accent)]"
                  />
                  <button onClick={submitName} disabled={savingName} className="text-xs text-white hover:opacity-70 whitespace-nowrap">
                    {savingName ? s.naming : s.nameSave}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setNameDraft(selectedCp?.label || ''); setNaming(true); }}
                  className="text-xs text-[var(--theme-text-dim)] hover:text-white transition-colors"
                >
                  {selectedCp?.label ? `${s.pinned}: ${selectedCp.label}` : s.nameVersion}
                </button>
              )}
            </div>}

            <div className="flex items-center justify-between gap-3 py-3">
              <button
                onClick={() => onOpenAsNewSlate(selectedText)}
                title={s.openAsNewHint}
                className="text-xs text-[var(--theme-text-dim)] hover:text-white transition-colors text-left"
              >
                {s.openAsNew}
              </button>
              {!isCurrent && (
                <button
                  onClick={handleRestoreClick}
                  className={`text-xs transition-colors whitespace-nowrap ${confirmRestore ? 'text-[var(--theme-red)]' : 'text-white hover:opacity-70'}`}
                >
                  {confirmRestore ? s.restoreConfirm : s.restore}
                </button>
              )}
            </div>
          </>
        ) : null}

        {error && <p className="text-xs pb-3" style={{ color: 'var(--theme-red)' }}>{error}</p>}
      </div>
    </div>
  );
}

export default function CollabPanel({
  tab, onTabChange, onClose,
  slateId, docKey, currentText, onRestore, onOpenAsNewSlate,
  canHistory, shareProps, getDoc,
}) {
  const p = strings.collab.panel;
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef(null);

  // Close is animated: flag the panel, then unmount when the exit finishes.
  // Every user-initiated close routes through here so the panel never just
  // vanishes. Parent-driven closes (restore, leave, slate change) still
  // unmount immediately, which is what you want in those cases.
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(onClose, 200);
  };

  useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  // Escape closes the panel, but only when it is the topmost overlay: the
  // shared hook keeps the stack, so a modal opened over the panel takes it
  // first and the panel stays put.
  useEscape(!closing, requestClose);

  // The history tab mounts on first use and then stays mounted, so flipping
  // tabs never refetches the checkpoint list or drops a decrypted preview.
  const [historyMounted, setHistoryMounted] = useState(tab === 'history');
  useEffect(() => { if (tab === 'history') setHistoryMounted(true); }, [tab]);

  const Tab = ({ id, label, disabled }) => (
    <button
      onClick={() => !disabled && onTabChange(id)}
      disabled={disabled}
      className={`text-sm pb-1 border-b-2 transition-colors duration-200 ${disabled ? 'opacity-30 cursor-not-allowed' : 'hover:text-white'}`}
      style={{
        borderColor: tab === id ? 'var(--theme-accent)' : 'transparent',
        color: tab === id ? 'var(--theme-accent)' : 'var(--theme-text-dim)',
      }}
    >
      {label}
    </button>
  );

  return (
    <aside
      className="collab-panel fixed inset-0 z-50 md:static md:z-auto md:flex-shrink-0 flex flex-col border-l"
      data-closing={closing ? 'true' : 'false'}
      style={{ background: 'var(--theme-bg-secondary)', borderColor: 'var(--theme-border)' }}
    >
      <div className="collab-panel-inner">
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <div className="flex items-center gap-4">
            <Tab id="people" label={p.tabPeople} />
            <Tab id="history" label={p.tabHistory} disabled={!canHistory} />
            <Tab id="nearby" label={strings.collab.nearby.tab} disabled={!canHistory} />
          </div>
          <button
            onClick={requestClose}
            aria-label={p.close}
            className="text-[var(--theme-text-dim)] hover:text-white transition-colors text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>

        <div className="collab-tabstack">
          <div className={`collab-tabpanel ${tab === 'people' ? 'is-active' : ''}`}>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              <CollabShareModal embedded {...shareProps} />
            </div>
          </div>

          <div className={`collab-tabpanel ${tab === 'nearby' ? 'is-active' : ''}`}>
            {canHistory && getDoc
              ? (tab === 'nearby' && <NearbyTab slateId={slateId} getDoc={getDoc} />)
              : <p className="text-sm text-[var(--theme-text-muted)] p-4">{strings.collab.nearby.unavailable}</p>}
          </div>

          <div className={`collab-tabpanel ${tab === 'history' ? 'is-active' : ''}`}>
            {canHistory ? (
              historyMounted && (
                <HistoryTab
                  slateId={slateId}
                  docKey={docKey}
                  currentText={currentText}
                  onRestore={onRestore}
                  onOpenAsNewSlate={onOpenAsNewSlate}
                />
              )
            ) : (
              <p className="text-sm text-[var(--theme-text-muted)] p-4">{p.historyUnavailable}</p>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
