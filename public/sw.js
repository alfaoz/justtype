// justtype offline shell.
//
// Caches the built app so justtype.io opens with no network, without ever
// showing a stale build while the network is there. The rule that makes
// this safe: the manifest that names the current build is never served
// from cache while a fetch for it can succeed. Hashed assets are immutable
// by construction, so serving them cache-first can never be wrong.
//
// Never touched: /api, /collab, /oauth. Those fail honestly when offline
// and the app treats that as a state, not an error.
//
// This file is byte-stable across releases and its hash is published in the
// build manifest (swHash) so the integrity monitor can watch it like the
// loader. Keep everything version-specific in the manifest, not here.

const SHELL = 'jt-shell';
const ASSETS = 'jt-assets';

// Unhashed files the loader needs before any asset is requested
const SHELL_PATHS = ['/', '/build-manifest.json', '/build-manifest.sig', '/theme-preload.js', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith('/api/') || p.startsWith('/collab/') || p.startsWith('/oauth')) return;

  if (p.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req));
  } else if (req.mode === 'navigate') {
    // Every app route is the same loader; offline, any route boots from '/'
    event.respondWith(networkFirst(event, req, '/', p === '/'));
  } else if (SHELL_PATHS.includes(p)) {
    event.respondWith(networkFirst(event, req, p, true));
  }
});

// Responses carry `Vary: Origin` (cors middleware), which the Cache API
// honours by default; a module script request and the precache fetch send
// different Origin headers, so matching must ignore it.
const MATCH = { ignoreVary: true };

async function cacheFirst(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req, MATCH);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

// Network when reachable (the request's own cache mode is preserved, so the
// loader's no-cache manifest fetch stays no-cache); the last good copy only
// when the network fails outright. A fresh manifest also refreshes the
// offline set for the build it names.
async function networkFirst(event, req, key, store) {
  try {
    const res = await fetch(req);
    if (res.ok && store) {
      const cache = await caches.open(SHELL);
      cache.put(key, res.clone());
      if (key === '/build-manifest.json') event.waitUntil(precache(res.clone()));
    }
    return res;
  } catch (err) {
    const hit = await caches.open(SHELL).then(c => c.match(key, MATCH));
    if (hit) return hit;
    throw err;
  }
}

// Fetch every file of the build into the asset cache and drop files from
// builds that are no longer current. Runs after the manifest reached the
// page, so it never delays a load.
async function precache(manifestRes) {
  let manifest;
  try { manifest = await manifestRes.json(); } catch { return; }
  const wanted = new Set([...(manifest.files || []), ...(manifest.assets || [])].map(f => `/assets/${f.file}`));
  const cache = await caches.open(ASSETS);
  const have = new Set((await cache.keys()).map(r => new URL(r.url).pathname));
  await Promise.all([...wanted].filter(p => !have.has(p)).map(async (p) => {
    try {
      const res = await fetch(p);
      if (res.ok) await cache.put(p, res);
    } catch { /* offline again already; next manifest fetch retries */ }
  }));
  for (const p of have) if (!wanted.has(p)) await cache.delete(p);
  const shell = await caches.open(SHELL);
  for (const p of SHELL_PATHS) {
    if (p === '/build-manifest.json' || p === '/build-manifest.sig') continue;
    try {
      const res = await fetch(p, { cache: 'no-cache' });
      if (res.ok) await shell.put(p, res);
    } catch { /* keep the previous copy */ }
  }
}
