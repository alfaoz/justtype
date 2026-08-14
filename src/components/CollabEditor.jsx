import React, { useRef, useEffect, useState } from 'react';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { livePreview } from './livePreview';
import { strings } from '../strings';
import { wrapKey, unwrapKey } from '../crypto';
import { subscribeCollab, sendCollabUpdate, sendCollabAwareness, fetchCollabUpdates, requestCollabJoin } from '../collabSync';
import { API_URL } from '../config';

// Collaborative editor surface for a shared slate. Owns the whole Yjs
// lifecycle so callers stay simple: build the Y.Doc from the encrypted
// snapshot + update log (or seed it from the canonical blob the very first
// time), bind it to CodeMirror via y-codemirror.next, relay every local
// update AES-GCM-wrapped under the doc key, and render remote carets from
// the encrypted awareness channel. The server never sees anything usable.
//
// Both editor modes ride the same CM6 view — `mode` only toggles the
// live-preview extension, because the document is markdown source either
// way (a bare textarea cannot render remote cursors).
//
// Seeding detail: the first client to open an empty log inserts the blob
// content from a throwaway doc with a FIXED clientID, so if two clients race
// the two seed updates are byte-identical and Yjs deduplicates them.

const REMOTE = 'collab-remote';
const SEED_CLIENT_ID = 0x5eed;
const SNAPSHOT_EVERY = 64;
// Also snapshot on a clock during active sessions, so version history gets
// checkpoints at a human cadence even when the log grows slowly.
const CHECKPOINT_MS = 5 * 60 * 1000;

// Caret colors per user, picked by username hash: [solid, translucent]
const CURSOR_COLORS = [
  ['#4a9eff', '#4a9eff44'], ['#b478f0', '#b478f044'], ['#3ecf8e', '#3ecf8e44'],
  ['#f0a848', '#f0a84844'], ['#f06878', '#f0687844'], ['#48c8d8', '#48c8d844'],
  ['#d8b448', '#d8b44844'], ['#78b0f0', '#78b0f044'],
];
const colorFor = (name) => {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
};

const bytesToBase64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};
const base64ToBytes = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// apiRef (optional): receives { replaceText } once the session is live, so
// the history modal can restore an earlier state as a normal collaborative
// edit (broadcast like any keystroke, undoable, nothing rewritten).
export default function CollabEditor({
  slateId, docKey, username, mode, initialContent,
  onChange, puntoClass = '', autofocus = false, onReady, onRemoved, onError, onRekeyed, apiRef
}) {
  const containerRef = useRef(null);
  const [session, setSession] = useState(null); // { ytext, awareness, undoManager }
  const [ready, setReady] = useState(false);

  // Late-bound refs so the doc effect never re-runs for changing callbacks.
  const docKeyRef = useRef(docKey); docKeyRef.current = docKey;
  const initialContentRef = useRef(initialContent); initialContentRef.current = initialContent;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;
  const onRemovedRef = useRef(onRemoved); onRemovedRef.current = onRemoved;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const onRekeyedRef = useRef(onRekeyed); onRekeyedRef.current = onRekeyed;
  const usernameRef = useRef(username); usernameRef.current = username;

  // --- Document session: Y.Doc + encrypted relay, keyed by slate ---
  useEffect(() => {
    if (!slateId) return;
    let cancelled = false;
    const key = docKeyRef.current;
    if (!key) return;

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    const awareness = new awarenessProtocol.Awareness(ydoc);
    const undoManager = new Y.UndoManager(ytext);
    const [color, colorLight] = colorFor(usernameRef.current);
    awareness.setLocalStateField('user', { name: usernameRef.current || 'anonymous', color, colorLight });

    let seeded = false;
    let loading = false;
    let becameReady = false;
    let appliedVersion = 0;
    let snapshotVersion = 0;
    let snapshotInFlight = false;
    let seq = 1;
    let epoch = 0;      // key-rotation counter, from the joined frame
    let stale = false;  // our doc key was rotated away — stop writing
    const sendQueue = [];

    // The doc key rotated: everything we hold is under the dead key. Freeze
    // this session and hand off — the parent re-resolves the key and remounts.
    const goStale = () => {
      if (stale) return;
      stale = true;
      sendQueue.length = 0;
      clearRetry();
      if (onRekeyedRef.current) onRekeyedRef.current();
    };

    // The bootstrap `joined` frame can be lost (this component lazy-loads and
    // may subscribe after the room's first join round-trip already happened,
    // or the snapshot fetch fails transiently). Joins are idempotent server-
    // side, so re-ask with backoff until we're ready.
    let retryTimer = null;
    let retryDelay = 4000;
    const clearRetry = () => { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } };
    const scheduleRetry = () => {
      if (cancelled || becameReady || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (cancelled || becameReady) return;
        requestCollabJoin(slateId);
        retryDelay = Math.min(Math.round(retryDelay * 1.5), 30000);
        scheduleRetry();
      }, retryDelay);
    };

    const finishReady = () => {
      clearRetry();
      if (cancelled || becameReady) return;
      becameReady = true;
      setSession({ ytext, awareness, undoManager });
      setReady(true);
      if (apiRef) {
        apiRef.current = {
          replaceText: (text) => {
            if (cancelled || stale) return;
            ydoc.transact(() => {
              ytext.delete(0, ytext.length);
              ytext.insert(0, String(text ?? ''));
            });
          }
        };
      }
      if (onReadyRef.current) onReadyRef.current();
    };

    const flushQueue = () => {
      while (sendQueue.length) {
        const payload = sendQueue[0];
        if (!sendCollabUpdate(slateId, payload, seq++, epoch)) return;
        sendQueue.shift();
      }
    };

    const sendUpdate = async (update) => {
      if (stale) return;
      try {
        const payload = await wrapKey(update, key);
        if (cancelled || stale) return;
        if (!sendCollabUpdate(slateId, payload, seq++, epoch)) sendQueue.push(payload);
      } catch (e) {
        console.error('collab update send failed', e);
      }
    };

    const updateHandler = (update, origin) => {
      if (origin === REMOTE) return;
      sendUpdate(update);
    };
    ydoc.on('update', updateHandler);

    // Local awareness changes (caret moves, joins, leaves) -> encrypted relay.
    const awarenessHandler = ({ added, updated, removed }, origin) => {
      if (origin === REMOTE) return;
      const changed = added.concat(updated, removed);
      if (!changed.length) return;
      (async () => {
        try {
          const aw = awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
          const envelope = new TextEncoder().encode(JSON.stringify({ k: 'y', d: bytesToBase64(aw) }));
          sendCollabAwareness(slateId, await wrapKey(envelope, key));
        } catch (e) {
          console.warn('awareness send failed', e);
        }
      })();
    };
    awareness.on('update', awarenessHandler);

    const applyLogged = async (version, payload) => {
      try {
        const bytes = await unwrapKey(payload, key);
        if (cancelled) return;
        Y.applyUpdate(ydoc, bytes, REMOTE);
        if (version > appliedVersion) appliedVersion = version;
      } catch (e) {
        console.warn('collab update decrypt failed at version', version, e);
      }
    };

    // The very first open of a collab doc: no log, no snapshot — seed the
    // Y.Doc from the canonical blob content, deterministically.
    const seed = () => {
      const text = initialContentRef.current || '';
      if (text) {
        const seedDoc = new Y.Doc();
        seedDoc.clientID = SEED_CLIENT_ID;
        seedDoc.getText('content').insert(0, text);
        const seedUpdate = Y.encodeStateAsUpdate(seedDoc);
        seedDoc.destroy();
        Y.applyUpdate(ydoc, seedUpdate, 'seed'); // not REMOTE -> gets sent too
      }
    };

    const loadSnapshot = async () => {
      const res = await fetch(`${API_URL}/collab/slates/${slateId}/snapshot`, { credentials: 'include' });
      if (!res.ok) throw new Error('snapshot fetch failed');
      const data = await res.json();
      if (data.payload) {
        const bytes = await unwrapKey(data.payload, key);
        if (cancelled) return;
        Y.applyUpdate(ydoc, bytes, REMOTE);
        appliedVersion = data.version || 0;
        snapshotVersion = data.version || 0;
      }
    };

    // Compact the log once it grows: post the full encrypted doc state, the
    // server prunes what it covers. Any member may do this; the server keeps
    // whichever snapshot covers the most versions.
    let lastSnapshotAt = Date.now();
    const maybeSnapshot = async () => {
      if (snapshotInFlight || stale) return;
      const versionsSince = appliedVersion - snapshotVersion;
      const due = versionsSince >= SNAPSHOT_EVERY
        || (versionsSince > 0 && Date.now() - lastSnapshotAt > CHECKPOINT_MS);
      if (!due) return;
      snapshotInFlight = true;
      const coveredVersion = appliedVersion;
      try {
        const payload = await wrapKey(Y.encodeStateAsUpdate(ydoc), key);
        const res = await fetch(`${API_URL}/collab/slates/${slateId}/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ payload, version: coveredVersion })
        });
        if (res.ok || res.status === 409) { snapshotVersion = coveredVersion; lastSnapshotAt = Date.now(); }
      } catch (e) {
        console.warn('snapshot post failed', e);
      } finally {
        snapshotInFlight = false;
      }
    };

    const unsubscribe = subscribeCollab(slateId, async (event) => {
      if (cancelled) return;
      switch (event.type) {
        case 'joined': {
          if (becameReady) {
            if ((event.epoch ?? 0) !== epoch) { goStale(); break; }
            // Rejoin while live: push what we wrote offline, pull what we missed.
            flushQueue();
            if (event.version > appliedVersion) fetchCollabUpdates(slateId, appliedVersion);
            break;
          }
          if (loading) break;
          loading = true;
          epoch = event.epoch ?? 0;
          try {
            if (event.version === 0 && event.snapshotVersion === 0) {
              if (!seeded) { seeded = true; seed(); }
              finishReady();
            } else {
              if (event.snapshotVersion > 0 && snapshotVersion === 0) await loadSnapshot();
              if (event.version > appliedVersion) {
                // Ready lands once the catch-up reply drains.
                if (!fetchCollabUpdates(slateId, appliedVersion)) throw new Error('socket closed mid catch-up');
              } else {
                finishReady();
              }
            }
          } catch (e) {
            // Transient — the retry loop re-requests a fresh `joined`.
            console.warn('collab doc load failed, retrying', e);
          } finally {
            loading = false;
          }
          break;
        }
        case 'update': {
          const prev = appliedVersion;
          await applyLogged(event.version, event.payload);
          if (event.version > prev + 1) fetchCollabUpdates(slateId, prev);
          maybeSnapshot();
          break;
        }
        case 'updates': {
          for (const u of event.updates) await applyLogged(u.version, u.payload);
          if (event.more) fetchCollabUpdates(slateId, appliedVersion);
          else finishReady();
          break;
        }
        case 'awareness': {
          try {
            const envelope = JSON.parse(new TextDecoder().decode(await unwrapKey(event.payload, key)));
            if (envelope && envelope.k === 'y' && envelope.d) {
              awarenessProtocol.applyAwarenessUpdate(awareness, base64ToBytes(envelope.d), REMOTE);
            }
          } catch { /* presence heartbeat or foreign blob — ignore */ }
          break;
        }
        case 'removed': {
          clearRetry();
          if (onRemovedRef.current) onRemovedRef.current();
          break;
        }
        case 'rekeyed': {
          goStale();
          break;
        }
        case 'error': {
          if (event.code === 'STALE_EPOCH') {
            goStale();
            break;
          }
          // Fatal pre-bootstrap errors (revoked membership, caps) would
          // otherwise leave the loading note up until the retries exhaust.
          if (!becameReady && (event.code === 'NOT_MEMBER' || event.code === 'ROOM_LIMIT' || event.code === 'CONN_LIMIT')) {
            clearRetry();
            if (onErrorRef.current) onErrorRef.current(new Error(event.error || 'collab error'));
          } else {
            console.warn('collab server error:', event.error, event.code);
          }
          break;
        }
        default:
          break;
      }
    });
    scheduleRetry();

    return () => {
      cancelled = true;
      clearRetry();
      if (apiRef) apiRef.current = null;
      unsubscribe();
      awareness.off('update', awarenessHandler);
      awareness.destroy();
      ydoc.off('update', updateHandler);
      ydoc.destroy();
      setSession(null);
      setReady(false);
    };
  }, [slateId]);

  // --- Editor view: rebuilt on mode toggle, the Y.Doc lives on ---
  useEffect(() => {
    if (!session || !ready || !containerRef.current) return;
    const { ytext, awareness, undoManager } = session;
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          ...(mode === 'wysiwyg' ? [markdown({ base: markdownLanguage }), livePreview({ reveal: true })] : []),
          EditorView.lineWrapping,
          indentUnit.of('    '),
          drawSelection(),
          placeholder(strings.writer.contentPlaceholder),
          keymap.of([...(mode === 'wysiwyg' ? markdownKeymap : []), ...yUndoManagerKeymap, ...defaultKeymap, indentWithTab]),
          yCollab(ytext, awareness, { undoManager }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && onChangeRef.current) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    if (autofocus) view.focus();
    // The seeded/loaded text exists before the first onChange — surface it.
    if (onChangeRef.current) onChangeRef.current(ytext.toString());
    return () => view.destroy();
  }, [session, ready, mode]);

  // CM6 owns the container's DOM — the loading note lives in a sibling so
  // React never fights the editor over children.
  return (
    <>
      {!ready && (
        <div className="w-full max-w-3xl p-8 text-sm animate-pulse" style={{ color: 'var(--theme-text-dim)' }}>
          {strings.collab.viewer.loading}
        </div>
      )}
      <div
        ref={containerRef}
        style={ready ? undefined : { display: 'none' }}
        className={`${mode === 'wysiwyg' ? 'wysiwyg-editor' : 'wysiwyg-editor collab-plain'} w-full max-w-3xl p-8 ${puntoClass}`}
      />
    </>
  );
}
