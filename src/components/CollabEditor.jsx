import React, { useRef, useEffect, useState } from 'react';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { EditorView, ViewPlugin, keymap, placeholder, drawSelection, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { markdownKeymap } from '@codemirror/lang-markdown';
import { livePreview, richMarkdown } from './livePreview';
import { shellScrollMargins } from '../shell';
import { strings } from '../strings';
import { wrapKey, unwrapKey } from '../crypto';
import { subscribeCollab, sendCollabUpdate, sendCollabAwareness, fetchCollabUpdates, requestCollabJoin } from '../collabSync';
import { API_URL } from '../config';
import { colorFor } from '../collabColors';
import { IndexeddbPersistence } from 'y-indexeddb';
import { isOnline } from '../connectivity';
import { closeNearbySession } from '../nearbySession';

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
// Local edits made within this long of each other leave as one frame, and
// caret moves go out at most this often: the relay writes to its database
// for every update frame, and each keystroke used to send two frames.
const SEND_BATCH_MS = 90;
const AWARENESS_MS = 175;
// The relay's cap on one update (base64 chars, see collabHub.js). An update
// over it cannot be logged, so a snapshot carries it instead.
const MAX_UPDATE_CHARS = 300 * 1024;

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
  const [session, setSession] = useState(null); // { ytext, awareness, undoManager, isLocalChange }
  const [ready, setReady] = useState(false);
  const [offlineUnavailable, setOfflineUnavailable] = useState(false); // no network and no copy on this device

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
    // Every update, local or remote, lands in IndexedDB as it happens, so the
    // document survives reloads and opens with no network. Updates replayed
    // from there carry `persistence` as origin and are never re-sent.
    const persistence = new IndexeddbPersistence(`jt-collab-${slateId}`, ydoc);
    // Mirror of what the server holds, built during the first catch-up, so
    // the exact updates it lacks (written offline, here or earlier) can be
    // sent as one update once the catch-up drains.
    let serverDoc = new Y.Doc();
    let serverSynced = false;
    let offlineTimer = null;
    const awareness = new awarenessProtocol.Awareness(ydoc);
    const undoManager = new Y.UndoManager(ytext);
    const [color, colorLight] = colorFor(usernameRef.current);
    awareness.setLocalStateField('user', { name: usernameRef.current || 'anonymous', color, colorLight });

    // Whether the text's latest change was made here (typing, undo, a
    // restore) or arrived (the relay, a nearby device, this device's stored
    // copy). The editor's change listener runs right after it and passes it
    // on, so the Writer can tell a collaborator's edit from its own.
    let changeIsLocal = true;
    const localityObserver = (_event, tr) => { changeIsLocal = tr.local; };
    ytext.observe(localityObserver);

    let seeded = false;
    let becameReady = false;
    // Every log version up to appliedVersion is in the doc. It moves one
    // version at a time (or to a loaded snapshot's), so a missed frame shows
    // as a gap and is fetched rather than skipped.
    let appliedVersion = 0;
    let snapshotVersion = 0;   // the newest snapshot known to be stored
    let catchingUp = false;    // a fetch is out; gaps wait for its reply
    let catchUpAt = 0;
    let seq = 1;
    let epoch = 0;      // key-rotation counter, from the joined frame
    let stale = false;  // our doc key was rotated away — stop writing
    // Local updates not yet handed to the socket, and the ones handed over
    // that the relay has not confirmed (seq -> update). Unconfirmed ones go
    // again after a reconnect or a refusal; Yjs ignores what it already has.
    let outgoing = [];
    const unconfirmed = new Map();
    let flushTimer = null;
    let sendHeldUntil = 0;     // after a refusal, wait before sending again
    let sendDelay = 1000;
    let socketDown = false;
    // Edits the log could not take (an update over its size cap): only a
    // snapshot carries them, so one stays due until it lands.
    let unlogged = 0;
    let compactAsked = false;  // the relay says the log is large: snapshot now
    let lastSnapshotAt = Date.now();
    let snapshotInFlight = false;
    let snapshotTimer = null;
    let snapshotHeldUntil = 0;
    let snapshotDelay = 2000;
    const awarenessChanged = new Set();
    let awarenessTimer = null;

    // The doc key rotated: everything we hold is under the dead key. Freeze
    // this session and hand off — the parent re-resolves the key and remounts.
    const goStale = () => {
      if (stale) return;
      stale = true;
      outgoing = [];
      unconfirmed.clear();
      clearTimeout(flushTimer);
      clearTimeout(snapshotTimer);
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
      setSession({ ytext, awareness, undoManager, isLocalChange: () => changeIsLocal });
      setReady(true);
      if (apiRef) {
        apiRef.current = {
          // For the nearby bridge (nearbySession.js): the live document
          getDoc: () => (cancelled || stale ? null : { ydoc, awareness, key }),
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

    // First catch-up with the server complete: whatever this device holds
    // that the server does not (the seed, edits made offline in this session
    // or an earlier one) goes up as a single update.
    const catchUpDone = () => {
      finishReady();
      if (serverSynced) return;
      serverSynced = true;
      const missing = Y.encodeStateAsUpdate(ydoc, Y.encodeStateVector(serverDoc));
      serverDoc.destroy();
      serverDoc = null;
      if (missing.length > 2) {
        outgoing.push(missing);
        flush();
      }
      maybeSnapshot();
    };

    const scheduleFlush = (ms = SEND_BATCH_MS) => {
      if (flushTimer || stale || cancelled) return;
      flushTimer = setTimeout(() => { flushTimer = null; flush(); }, ms);
    };

    // One frame for everything written since the last one. Nothing goes out
    // before the first catch-up: its diff sends whatever the server lacks.
    const flush = async () => {
      clearTimeout(flushTimer);
      flushTimer = null;
      if (stale || !serverSynced || socketDown || !outgoing.length) return;
      const wait = sendHeldUntil - Date.now();
      if (wait > 0) { scheduleFlush(wait); return; }
      const update = outgoing.length === 1 ? outgoing[0] : Y.mergeUpdates(outgoing);
      outgoing = [];
      let payload;
      try {
        payload = await wrapKey(update, key);
      } catch (e) {
        console.error('collab update send failed', e);
        outgoing.unshift(update);
        return;
      }
      if (stale) return;
      if (payload.length > MAX_UPDATE_CHARS) {
        // Too large for the log (a big paste): the whole doc goes up as a
        // snapshot, which carries it
        unlogged++;
        maybeSnapshot(true);
        return;
      }
      const n = seq++;
      if (sendCollabUpdate(slateId, payload, n, epoch)) {
        unconfirmed.set(n, update);
      } else {
        // The socket is down: this waits for the rejoin
        socketDown = true;
        outgoing.unshift(update);
      }
    };

    // After a reconnect: what the relay never confirmed goes again, with
    // anything written meanwhile, as one frame.
    const resendUnconfirmed = () => {
      for (const update of unconfirmed.values()) outgoing.push(update);
      unconfirmed.clear();
      socketDown = false;
      flush();
    };

    // The relay refused an update: it goes back in line and is sent again
    // after a pause that grows while the refusals go on.
    const refused = (n) => {
      const update = unconfirmed.get(n);
      if (!update) return;
      unconfirmed.delete(n);
      outgoing.push(update);
      sendHeldUntil = Date.now() + sendDelay;
      sendDelay = Math.min(sendDelay * 2, 30000);
      scheduleFlush(sendHeldUntil - Date.now());
    };

    const updateHandler = (update, origin) => {
      if (origin === REMOTE || origin === persistence || !serverSynced) return;
      outgoing.push(update);
      scheduleFlush();
    };
    ydoc.on('update', updateHandler);

    // Leaving the window or the page: what is waiting goes now.
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('blur', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);

    // Local awareness changes (caret moves, joins, leaves) -> encrypted relay,
    // at most once per AWARENESS_MS, with the latest state.
    const sendAwareness = async () => {
      awarenessTimer = null;
      const changed = [...awarenessChanged];
      awarenessChanged.clear();
      if (!changed.length || cancelled || stale) return;
      try {
        const aw = awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
        const envelope = new TextEncoder().encode(JSON.stringify({ k: 'y', d: bytesToBase64(aw) }));
        sendCollabAwareness(slateId, await wrapKey(envelope, key));
      } catch (e) {
        console.warn('awareness send failed', e);
      }
    };
    const awarenessHandler = ({ added, updated, removed }, origin) => {
      if (origin === REMOTE) return;
      for (const id of added) awarenessChanged.add(id);
      for (const id of updated) awarenessChanged.add(id);
      for (const id of removed) awarenessChanged.add(id);
      if (awarenessChanged.size && !awarenessTimer) awarenessTimer = setTimeout(sendAwareness, AWARENESS_MS);
    };
    awareness.on('update', awarenessHandler);

    // Ask for everything after the last version applied, one fetch at a time
    // (one left unanswered for long is given up on).
    const catchUp = () => {
      if (stale || (catchingUp && Date.now() - catchUpAt < 15000)) return;
      if (fetchCollabUpdates(slateId, appliedVersion)) {
        catchingUp = true;
        catchUpAt = Date.now();
      }
    };

    const advance = (version) => {
      if (version === appliedVersion + 1) appliedVersion = version;
      else if (version > appliedVersion + 1) catchUp();
    };

    const applyLogged = async (version, payload) => {
      try {
        const bytes = await unwrapKey(payload, key);
        if (cancelled) return;
        Y.applyUpdate(ydoc, bytes, REMOTE);
        if (!serverSynced) Y.applyUpdate(serverDoc, bytes);
      } catch (e) {
        // Counted as applied all the same: it will never decrypt, and every
        // later version would otherwise wait behind it
        console.warn('collab update decrypt failed at version', version, e);
      }
      advance(version);
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
        Y.applyUpdate(ydoc, seedUpdate, 'seed'); // not REMOTE -> the catch-up diff sends it
      }
    };

    const loadSnapshot = async () => {
      const res = await fetch(`${API_URL}/collab/slates/${slateId}/snapshot`, { credentials: 'include' });
      if (!res.ok) throw new Error('snapshot fetch failed');
      const data = await res.json();
      if (!data.payload || cancelled) return;
      const bytes = await unwrapKey(data.payload, key);
      if (cancelled) return;
      Y.applyUpdate(ydoc, bytes, REMOTE);
      if (!serverSynced) Y.applyUpdate(serverDoc, bytes);
      const version = data.version || 0;
      if (version > appliedVersion) appliedVersion = version;
      if (version > snapshotVersion) snapshotVersion = version;
    };

    // Compact the log once it grows: post the full encrypted doc state, the
    // server prunes what it covers. Any member may do this; the server keeps
    // a snapshot only when it is newer than the one it has.
    const snapshotDue = () => {
      if (unlogged || compactAsked) return true;
      const since = appliedVersion - snapshotVersion;
      return since >= SNAPSHOT_EVERY || (since > 0 && Date.now() - lastSnapshotAt > CHECKPOINT_MS);
    };

    // mine: this device's own write made it due (or the relay asked), so it
    // goes at once. A peer's write makes it due in every open copy at the
    // same moment, so those wait a few seconds and the room posts one.
    const maybeSnapshot = (mine = false) => {
      if (stale || cancelled || !serverSynced || snapshotInFlight || !snapshotDue()) return;
      const wait = Math.max(snapshotHeldUntil - Date.now(), mine ? 0 : 2000 + Math.random() * 4000);
      if (wait <= 0) { postSnapshot(); return; }
      if (!snapshotTimer) snapshotTimer = setTimeout(() => { snapshotTimer = null; maybeSnapshot(true); }, wait);
    };

    const postSnapshot = async () => {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
      snapshotInFlight = true;
      const coveredVersion = appliedVersion;
      const carried = unlogged;
      let hold = 0;
      try {
        const payload = await wrapKey(Y.encodeStateAsUpdate(ydoc), key);
        if (stale || cancelled) return;
        const res = await fetch(`${API_URL}/collab/slates/${slateId}/snapshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(carried ? { payload, version: coveredVersion, unlogged: true } : { payload, version: coveredVersion })
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          // One carrying unlogged edits takes the version after the log
          const stored = Number(data.snapshotVersion) || coveredVersion;
          if (stored > appliedVersion) appliedVersion = stored;
          if (stored > snapshotVersion) snapshotVersion = stored;
          unlogged -= carried;
          compactAsked = false;
          lastSnapshotAt = Date.now();
          snapshotDelay = 2000;
        } else if (res.status === 409 && !carried) {
          // Another snapshot already covers this much
          if (coveredVersion > snapshotVersion) snapshotVersion = coveredVersion;
          compactAsked = false;
          lastSnapshotAt = Date.now();
        } else {
          // Behind the log (unlogged edits need a snapshot of all of it),
          // limited, or failed: again after a pause
          hold = res.status === 413 ? 10 * 60 * 1000 : res.status === 429 ? Math.max(snapshotDelay, 60000) : snapshotDelay;
          snapshotDelay = Math.min(snapshotDelay * 2, 60000);
        }
      } catch (e) {
        console.warn('snapshot post failed', e);
        hold = snapshotDelay;
        snapshotDelay = Math.min(snapshotDelay * 2, 60000);
      } finally {
        snapshotInFlight = false;
      }
      if (hold) snapshotHeldUntil = Date.now() + hold;
      // Still due (unlogged edits, a full log): tried again after the hold
      if (unlogged || compactAsked) maybeSnapshot(true);
    };

    const handle = async (event) => {
      switch (event.type) {
        case 'joined': {
          if (serverSynced) {
            if ((event.epoch ?? 0) !== epoch) { goStale(); break; }
            // Rejoin while live. The log was pruned past this doc while it
            // was away: the snapshot holds what it missed.
            if ((event.snapshotVersion || 0) > appliedVersion) {
              try { await loadSnapshot(); } catch (e) { console.warn('collab snapshot load failed', e); }
            }
            // Push what the relay never confirmed, pull what we missed.
            resendUnconfirmed();
            if (event.version > appliedVersion) catchUp();
            break;
          }
          epoch = event.epoch ?? 0;
          try {
            if (event.version === 0 && event.snapshotVersion === 0) {
              // Nothing on the server yet: seed from the canonical text,
              // unless this device already holds a version written offline
              if (!seeded && ytext.length === 0) { seeded = true; seed(); }
              catchUpDone();
            } else {
              if ((event.snapshotVersion || 0) > appliedVersion) await loadSnapshot();
              if (event.version > appliedVersion) {
                // Ready lands once the catch-up reply drains.
                catchUp();
                if (!catchingUp) throw new Error('socket closed mid catch-up');
              } else {
                catchUpDone();
              }
            }
          } catch (e) {
            // Transient — the retry loop re-requests a fresh `joined`.
            console.warn('collab doc load failed, retrying', e);
          }
          break;
        }
        case 'reconnected': {
          // A fresh socket: nothing asked on the old one will be answered
          catchingUp = false;
          socketDown = false;
          break;
        }
        case 'update': {
          await applyLogged(event.version, event.payload);
          maybeSnapshot();
          break;
        }
        case 'ack': {
          // Our own update, now logged: the doc has it already
          if (event.seq != null) unconfirmed.delete(event.seq);
          sendDelay = 1000;
          advance(event.version);
          if (event.compact) compactAsked = true;
          maybeSnapshot(true);
          break;
        }
        case 'updates': {
          catchingUp = false;
          // Pruned past where this fetch started: the snapshot has the rest
          if ((event.snapshotVersion || 0) > appliedVersion) {
            try { await loadSnapshot(); } catch (e) { console.warn('collab snapshot load failed', e); }
          }
          for (const u of event.updates) await applyLogged(u.version, u.payload);
          const last = event.updates.length ? event.updates[event.updates.length - 1].version : appliedVersion;
          // A reply that leaves a gap open (its snapshot would not load)
          // stops here; the next frame to arrive asks again
          if (event.more && last <= appliedVersion) catchUp();
          else catchUpDone();
          maybeSnapshot();
          break;
        }
        case 'snapshot': {
          // Someone stored a snapshot: the clock for timed ones restarts, and
          // one ahead of this doc (edits the log never had, or we fell
          // behind) is loaded
          lastSnapshotAt = Date.now();
          if (event.version > appliedVersion) {
            try { await loadSnapshot(); } catch (e) { console.warn('collab snapshot load failed', e); }
          } else if (event.version > snapshotVersion) {
            snapshotVersion = event.version;
          }
          if (snapshotTimer && !snapshotDue()) { clearTimeout(snapshotTimer); snapshotTimer = null; }
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
          // A refused update of ours: sent again after a pause, after a
          // snapshot has made room (LOG_FULL), or carried by one (TOO_LARGE)
          if (event.seq != null && unconfirmed.has(event.seq)) {
            if (event.code === 'TOO_LARGE') {
              unconfirmed.delete(event.seq);
              unlogged++;
              maybeSnapshot(true);
            } else {
              if (event.code === 'LOG_FULL') { compactAsked = true; maybeSnapshot(true); }
              refused(event.seq);
            }
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
    };

    const onAwareness = async (event) => {
      try {
        const envelope = JSON.parse(new TextDecoder().decode(await unwrapKey(event.payload, key)));
        if (cancelled) return;
        if (envelope && envelope.k === 'y' && envelope.d) {
          awarenessProtocol.applyAwarenessUpdate(awareness, base64ToBytes(envelope.d), REMOTE);
        }
      } catch { /* presence heartbeat or foreign blob: ignore */ }
    };

    // Frames are handled one at a time, in the order they arrived: most
    // handlers wait on decryption or a fetch, and versions have to land in
    // order for the gap check to mean anything. Carets skip the line.
    let queue = Promise.resolve();
    const unsubscribe = subscribeCollab(slateId, (event) => {
      if (cancelled) return;
      if (event.type === 'awareness') { onAwareness(event); return; }
      queue = queue
        .then(() => (cancelled ? undefined : handle(event)))
        .catch((e) => console.warn('collab event failed', e));
    });
    scheduleRetry();

    // With no network the local copy is the document. When there is none,
    // say so instead of pulsing "loading" forever. Online but slow, the
    // local copy shows after a moment and the server merges in behind it.
    persistence.whenSynced.then(() => {
      if (cancelled || becameReady) return;
      const hasCopy = ytext.length > 0;
      if (!isOnline()) {
        if (hasCopy) finishReady();
        else setOfflineUnavailable(true);
      } else if (hasCopy) {
        offlineTimer = setTimeout(() => { if (!cancelled && !becameReady) finishReady(); }, 4000);
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      window.removeEventListener('blur', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      closeNearbySession(slateId);
      clearRetry();
      clearTimeout(offlineTimer);
      clearTimeout(snapshotTimer);
      clearTimeout(awarenessTimer);
      // What was typed in the last moments still goes out; the room is
      // left once it has
      const last = stale ? Promise.resolve() : flush();
      persistence.destroy().catch(() => {});
      if (serverDoc) serverDoc.destroy();
      if (apiRef) apiRef.current = null;
      last.finally(unsubscribe);
      ytext.unobserve(localityObserver);
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
    const { ytext, awareness, undoManager, isLocalChange } = session;
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          ...(mode === 'wysiwyg' ? [richMarkdown(), livePreview({ reveal: true })] : []),
          EditorView.lineWrapping,
          indentUnit.of('    '),
          shellScrollMargins(EditorView, ViewPlugin),
          highlightActiveLine(), // marks the caret's line for line focus (index.css)
          drawSelection(),
          placeholder(strings.writer.contentPlaceholder),
          keymap.of([...(mode === 'wysiwyg' ? markdownKeymap : []), ...yUndoManagerKeymap, ...defaultKeymap, indentWithTab]),
          yCollab(ytext, awareness, { undoManager }),
          EditorView.updateListener.of((update) => {
            // second argument: the change came from elsewhere (a collaborator)
            if (update.docChanged && onChangeRef.current) {
              onChangeRef.current(update.state.doc.toString(), !isLocalChange());
            }
          }),
        ],
      }),
    });
    if (autofocus) view.focus();
    // The seeded/loaded text exists before the first onChange — surface it.
    if (onChangeRef.current) onChangeRef.current(ytext.toString(), true);
    return () => view.destroy();
  }, [session, ready, mode]);

  // CM6 owns the container's DOM — the loading note lives in a sibling so
  // React never fights the editor over children.
  return (
    <>
      {!ready && (
        <div className={`writer-column w-full max-w-3xl p-8 text-sm ${offlineUnavailable ? '' : 'animate-pulse'}`} style={{ color: 'var(--theme-text-dim)' }}>
          {offlineUnavailable ? strings.writer.connectivity.notAvailableOffline : strings.collab.viewer.loading}
        </div>
      )}
      <div
        ref={containerRef}
        style={ready ? undefined : { display: 'none' }}
        className={`${mode === 'wysiwyg' ? 'wysiwyg-editor' : 'wysiwyg-editor collab-plain'} writer-column w-full max-w-3xl p-8 ${puntoClass}`}
      />
    </>
  );
}
