// Lightweight encrypted presence for collaborative slates: each participant
// heartbeats a tiny {u: username, t: now} blob over the awareness relay,
// AES-GCM-wrapped under the doc key like everything else — the server relays
// ciphertext it cannot read. Peers expire after a quiet interval, so a closed
// tab simply fades out. (Live caret positions ride this same channel once the
// collaborative editor surface lands.)

import { useState, useEffect, useRef } from 'react';
import { wrapKey, unwrapKey } from './crypto';
import { subscribeCollab, sendCollabAwareness } from './collabSync';

const HEARTBEAT_MS = 20000;
const EXPIRE_MS = 45000;
const PRUNE_MS = 10000;

// React hook: returns [{username, lastSeen}] for everyone else currently in
// the slate's room. slateId is the slate's DB id (rooms are keyed by it).
export function usePresence({ slateId, docKey, username, enabled }) {
  const [peers, setPeers] = useState([]);
  const docKeyRef = useRef(docKey);
  docKeyRef.current = docKey;
  const usernameRef = useRef(username);
  usernameRef.current = username;

  useEffect(() => {
    if (!enabled || !slateId) {
      setPeers([]);
      return;
    }
    let cancelled = false;
    const roster = new Map(); // username -> { t: lastSeen, authorId }

    const publish = () => {
      if (cancelled) return;
      const list = [...roster.entries()]
        .map(([u, v]) => ({ username: u, lastSeen: v.t }))
        .sort((a, b) => a.username.localeCompare(b.username));
      setPeers(list);
    };

    const announce = async () => {
      const key = docKeyRef.current;
      const me = usernameRef.current;
      if (!key || !me) return;
      try {
        // k:'p' marks a presence heartbeat — caret awareness blobs use k:'y'
        // on this same relay channel (see CollabEditor).
        const blob = new TextEncoder().encode(JSON.stringify({ k: 'p', u: me, t: Date.now() }));
        sendCollabAwareness(slateId, await wrapKey(blob, key));
      } catch (e) {
        console.warn('presence announce failed', e);
      }
    };

    const unsubscribe = subscribeCollab(slateId, async (event) => {
      if (cancelled) return;
      if (event.type === 'awareness') {
        const key = docKeyRef.current;
        if (!key) return;
        try {
          const bytes = await unwrapKey(event.payload, key);
          const data = JSON.parse(new TextDecoder().decode(bytes));
          if (data && data.k && data.k !== 'p') return; // caret awareness blob — not ours
          if (data && data.u && data.u !== usernameRef.current) {
            // Answer-back only for peers we haven't seen — a fresh joiner gets
            // listed everywhere within one round-trip, and known peers don't
            // trigger echo storms.
            const isNew = !roster.has(data.u);
            roster.set(data.u, { t: Date.now(), authorId: event.authorId });
            publish();
            if (isNew) announce();
          }
        } catch { /* not a presence blob or wrong key — ignore */ }
      } else if (event.type === 'peer_left') {
        // Their last socket left the room — drop them now, no expiry wait.
        let changed = false;
        for (const [u, v] of roster) {
          if (v.authorId === event.authorId) { roster.delete(u); changed = true; }
        }
        if (changed) publish();
      } else if (event.type === 'joined' || event.type === 'reconnected') {
        announce();
      } else if (event.type === 'removed') {
        roster.clear();
        publish();
      }
    });

    const heartbeat = setInterval(announce, HEARTBEAT_MS);
    const prune = setInterval(() => {
      const cutoff = Date.now() - EXPIRE_MS;
      let changed = false;
      for (const [u, v] of roster) {
        if (v.t < cutoff) { roster.delete(u); changed = true; }
      }
      if (changed) publish();
    }, PRUNE_MS);

    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      clearInterval(prune);
      unsubscribe();
    };
  }, [slateId, enabled]);

  return peers;
}
