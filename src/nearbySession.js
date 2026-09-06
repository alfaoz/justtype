// Bridges a collab slate's Y.Doc and awareness to nearby peers. One session
// per open collab document; it outlives the panel that created it and is
// closed when the editor unmounts. Updates from a peer are applied with the
// peer as origin, so the editor forwards them to the relay when online and
// this session forwards them to every other peer, never back to the sender.
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { wrapKey, unwrapKey } from './crypto';

import { setNearbyPeerCount, onNearbyChange } from './nearbyState';
export { onNearbyChange };

const sessions = new Map();
const emit = () => { for (const s of sessions.values()) setNearbyPeerCount(s.slateId, [...s.peers].filter(p => p.open).length); };

const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export function getNearbySession(slateId, getDoc) {
  slateId = Number(slateId);
  let s = sessions.get(slateId);
  if (s) return s;
  const doc = getDoc && getDoc();
  if (!doc) return null;
  const { ydoc, awareness, key } = doc;
  const peers = new Set();

  const broadcast = (obj, except) => { for (const p of peers) if (p !== except) p.send(obj); };
  const onUpdate = async (update, origin) => {
    if (!peers.size) return;
    broadcast({ t: 'u', d: await wrapKey(update, key) }, peers.has(origin) ? origin : null);
  };
  const onAwareness = async ({ added, updated, removed }, origin) => {
    if (!peers.size) return;
    const changed = added.concat(updated, removed);
    if (!changed.length) return;
    broadcast({ t: 'a', d: await wrapKey(awarenessProtocol.encodeAwarenessUpdate(awareness, changed), key) }, peers.has(origin) ? origin : null);
  };
  ydoc.on('update', onUpdate);
  awareness.on('update', onAwareness);

  const attach = (peer) => {
    peers.add(peer);
    peer.addEventListener('message', async (e) => {
      const m = e.detail;
      try {
        if (m.t === 'sv') {
          // Peer's state vector: reply with what it lacks
          peer.send({ t: 'u', d: await wrapKey(Y.encodeStateAsUpdate(ydoc, unb64(m.d)), key) });
        } else if (m.t === 'u') {
          Y.applyUpdate(ydoc, await unwrapKey(m.d, key), peer);
        } else if (m.t === 'a') {
          awarenessProtocol.applyAwarenessUpdate(awareness, await unwrapKey(m.d, key), peer);
        }
      } catch (err) { console.warn('nearby message failed', err); }
    });
    const bye = () => { peers.delete(peer); emit(); };
    peer.addEventListener('close', bye);
    peer.addEventListener('failed', bye);
    // Both sides start by exchanging state vectors so each pulls the delta
    peer.send({ t: 'sv', d: b64(Y.encodeStateVector(ydoc)) });
    // Our presence, so the caret shows up on the other screen right away
    awarenessProtocol.encodeAwarenessUpdate(awareness, [ydoc.clientID]);
    onAwareness({ added: [ydoc.clientID], updated: [], removed: [] }, 'local');
    emit();
  };
  const close = () => {
    for (const p of peers) p.close();
    peers.clear();
    ydoc.off('update', onUpdate);
    awareness.off('update', onAwareness);
    sessions.delete(slateId);
    setNearbyPeerCount(slateId, 0);
  };
  s = { slateId, peers, attach, close };
  sessions.set(slateId, s);
  return s;
}

export function closeNearbySession(slateId) { sessions.get(Number(slateId))?.close(); }
