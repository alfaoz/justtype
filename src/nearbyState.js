// Peer counts for nearby collab, kept apart from the session module so the
// writer's status strip can show "nearby · n" without pulling yjs into the
// main bundle. nearbySession.js updates this; anyone may subscribe.
const counts = new Map();
const listeners = new Set();
export function onNearbyChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const nearbyPeerCount = (slateId) => counts.get(Number(slateId)) || 0;
export function setNearbyPeerCount(slateId, n) {
  counts.set(Number(slateId), n);
  for (const l of listeners) l();
}
