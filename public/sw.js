// justtype no longer uses a service worker or Web Push for drop delivery — drops
// surface silently via SSE + next-unlock, with no notifications. This stub exists
// only to retire any worker that was briefly registered in an earlier build: it
// unsubscribes from push and unregisters itself, so no stale notification code
// can run in users' browsers.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {}
    try { await self.registration.unregister(); } catch {}
  })());
});
