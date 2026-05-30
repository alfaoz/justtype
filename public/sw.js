// justtype service worker — drop-box push delivery.
//
// Its only job is to wake the app when a third-party app deposits an encrypted
// "drop" (a new private slate) while no tab is focused. The push payload is
// content-free ({ type: 'drops' }) — it never carries note text. Decryption and
// adoption happen in the page context (which holds the master key), so this
// worker just nudges any open client to sweep, and otherwise shows a
// notification the user taps to open justtype and import.
//
// We deliberately do NOT decrypt/adopt inside the worker: that would mean
// duplicating the crypto and reading the master key here. Keeping all crypto in
// one place (the page) is safer. On platforms that throttle background workers
// (notably iOS Safari) this gracefully degrades to "imports when you open it".

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    // Nudge any open clients to run their inbox sweep immediately.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    let nudged = false;
    for (const client of clients) {
      try { client.postMessage({ type: 'drops' }); nudged = true; } catch {}
    }
    // If nothing is open to do the work, let the user know notes are waiting.
    if (!nudged) {
      await self.registration.showNotification('justtype', {
        body: 'new notes are waiting — open justtype to import them',
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        tag: 'justtype-drops',
        data: { url: '/slates' }
      });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if ('focus' in client) { try { await client.focus(); client.postMessage({ type: 'drops' }); return; } catch {} }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
