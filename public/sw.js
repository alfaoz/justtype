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
  } else if (p === '/build-manifest.json' || p === '/build-manifest.sig') {
    // Never stale while the network is there: this is what names the build
    event.respondWith(networkFirst(event, req, p, true));
  } else if (req.mode === 'navigate') {
    event.respondWith(navigate(event, req, p));
  } else if (SHELL_PATHS.includes(p)) {
    event.respondWith(shellFirst(event, req, p, true));
  }
});

// A page the app has said is its own opens from the last copy at once, the
// network refreshing it behind. Every other path goes to the network and
// only falls back to the shell offline: the app is not the only thing this
// origin serves, and a worker that answered for everything would speak for
// pages that are not its own. The app names its routes itself (a message
// from main.jsx on every load), so nothing about them is written here.
const ROUTES = '/__app-routes';
let claimed = null;
async function routes() {
  if (claimed) return claimed;
  const cache = await caches.open(SHELL);
  const hit = await cache.match(ROUTES, MATCH);
  const list = hit ? await hit.json().catch(() => []) : [];
  claimed = new Set(['/', ...list]);
  return claimed;
}
self.addEventListener('message', (event) => {
  const p = event.data && event.data.type === 'app-route' && event.data.path;
  if (typeof p !== 'string' || !p.startsWith('/') || p.length > 512) return;
  event.waitUntil((async () => {
    const known = await routes();
    if (known.has(p)) return;
    known.add(p);
    const cache = await caches.open(SHELL);
    await cache.put(ROUTES, new Response(JSON.stringify([...known])));
  })());
});
async function navigate(event, req, p) {
  const known = await routes();
  if (known.has(p)) return shellFirst(event, req, '/', p === '/');
  try {
    return await fetch(req);
  } catch (err) {
    const hit = await caches.open(SHELL).then(c => c.match('/', MATCH));
    if (hit) return hit;
    throw err;
  }
}

// The cached copy at once when there is one, the network's copy stored for
// next time; the network when there is none
async function shellFirst(event, req, key, store) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(key, MATCH);
  const refresh = fetch(req).then(async (res) => {
    if (res.ok && store) await cache.put(key, res.clone());
    return res;
  });
  if (hit) { event.waitUntil(refresh.catch(() => {})); return hit; }
  return refresh.catch(async (err) => { const any = await cache.match('/', MATCH); if (any) return any; throw err; });
}

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
  // The unhashed shell files are refetched once per build, not per load
  const shell = await caches.open(SHELL);
  const seen = await shell.match('/__build', MATCH).then(r => (r ? r.text() : ''), () => '');
  if (seen === String(manifest.version)) return;
  await shell.put('/__build', new Response(String(manifest.version)));
  for (const p of SHELL_PATHS) {
    if (p === '/build-manifest.json' || p === '/build-manifest.sig') continue;
    try {
      const res = await fetch(p, { cache: 'no-cache' });
      if (res.ok) await shell.put(p, res);
    } catch { /* keep the previous copy */ }
  }
}
