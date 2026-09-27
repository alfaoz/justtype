// What site-shots.sh walks the app through, and the made-up account it
// does it as: alfaoz, signed in, with the slates in slates.json and
// writer.txt as the one picked from the list (opened with its first line
// written; the page's scroll writes the rest). Everything is encrypted with
// the app's own code (repo/src/crypto.js) under a key made for the run, and
// the app answers from fixtures.json instead of the server.
// Usage: node site/make.mjs <folder>  ->  plan.json, fixtures.json, saved.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';

// The app's modules leave .js off their imports, as its bundler allows
register('data:text/javascript,export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".js")) return next(s + ".js", c); throw e; } }');
const src = new URL('../../repo/src/', import.meta.url);
const { generateSlateKey, encryptTitle, encryptContent, encryptTags } = await import(new URL('crypto.js', src));
const { keystrokes } = await import(new URL('macTyping.js', src));

const dir = process.argv[2];
const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\n+$/, '');
const writer = read('writer.txt');
const math = read('math.txt');
const others = JSON.parse(read('slates.json'));

const user = { id: 4242, username: 'alfaoz', email: 'alfaoz@example.com' };
const key = await generateSlateKey();
const now = Date.now();
const ago = (age) => now - parseFloat(age) * { m: 6e4, h: 36e5, d: 864e5 }[age.replace(/[\d.]/g, '')];
const sqlite = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const titleOf = (text) => text.split('\n')[0].replace(/^#+\s*/, '').trim();
const words = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

// The picked slate as it was saved: its first line (and the blank one after)
const saved = writer.match(/^[^\n]*\n\n?/)?.[0] ?? '';
const picked = titleOf(writer);

// The list and every slate in it, as the server would answer
const rows = [];
const bodies = {};
const slates = [{ text: writer, content: saved, age: '10m' }, ...others.map((s) => ({ ...s, content: s.text }))];
for (const [i, s] of slates.entries()) {
  const number = 101 + i;
  const title = titleOf(s.text);
  const row = {
    id: number, slate_number: number, title: s.public ? title : null,
    encrypted_title: await encryptTitle(title, key),
    encrypted_tags: s.tags?.length ? await encryptTags(s.tags, key) : null,
    word_count: words(s.content), char_count: s.content.length, size_bytes: s.content.length,
    created_at: sqlite(ago(s.age) - 3 * 864e5), updated_at: sqlite(ago(s.age)),
    published_at: s.public ? sqlite(ago(s.age)) : null,
    pinned_at: s.pinned ? Math.round(ago(s.age)) : null, archived_at: null, deleted_at: null,
    is_published: s.public ? 1 : 0, is_system_slate: 0, is_collab: 0, is_locked: 0, adoption_pending: false,
    share_id: s.public ? `m${number}` : null, view_count: s.public ? 128 : 0,
    source_app: null, source_app_name: null, collab_wrapped_key: null,
    lock_wrapped_key: null, lock_salt: null, lock_recovery_wrapped_key: null, lock_recovery_key_id: null,
  };
  rows.push(row);
  bodies[number] = {
    ...row, user_id: user.id, title: s.public ? title : '', encrypted: true,
    encryptedContent: await encryptContent(s.content, key), editor_mode: 'wysiwyg',
    share_private: 0, history_count: 0, has_grants: false,
  };
}

const fixtures = {
  'GET /api/auth/me': { ...user, email_verified: 1, auth_provider: 'local', requiresMigration: false, recoveryKeyPending: false, e2eMigrated: true, needsPinSetup: false },
  'GET /api/preferences': { theme: 'dark', customThemes: {}, whatsNewSeen: 'v4' },
  'PUT /api/preferences': {},
  'GET /api/notifications': { notifications: [] },
  'POST /api/user/visit': {},
  'GET /api/health': { ok: true },
  'GET /api/slates': rows,
  'GET /api/slates?trash=1': [],
  'GET /api/collab/invites': { invites: [] },
  'GET /api/collab/slates': { shared: [] },
  'GET /api/account/slate-drops': [],
  'GET /api/account/connected-apps': [],
  'GET /api/account/incident-recovery-sources': { sources: [] },
  'PUT /api/slates/*': { updated_at: sqlite(now) },
};
for (const [number, body] of Object.entries(bodies)) fixtures[`GET /api/slates/${number}`] = body;

// Signed in before the first load: who, the key where the app keeps it,
// and what a returning person has already seen
const stored = {
  'justtype-theme': 'dark',
  'justtype-username': user.username,
  'justtype-user-id': String(user.id),
  'justtype-email': user.email,
  'justtype-email-verified': 'true',
  'justtype-auth-provider': 'local',
  'justtype-slate-view': 'list',
  'justtype-whats-new-seen-v4': '1',
  [`justtype-whats-new-seen-v4-told-${user.id}`]: '1',
  [`justtype-visit-${user.id}`]: JSON.stringify({ at: now, tier: null }),
  [`justtype-incident-recovery-v3-${user.id}`]: JSON.stringify({ complete: true }),
};
const seed = `for (const [k, v] of Object.entries(${JSON.stringify(stored)})) localStorage.setItem(k, v);
const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(key).toString('base64'))}), (c) => c.charCodeAt(0));
const open = indexedDB.open('justtype-keys', 1);
open.onupgradeneeded = () => open.result.createObjectStore('keys');
open.onsuccess = () => { const tx = open.result.transaction('keys', 'readwrite'); tx.objectStore('keys').put(bytes, 'user-${user.id}'); tx.oncomplete = () => location.reload(); };`;

const press = (k, meta = false) => `dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, metaKey: ${meta}, bubbles: true }));`;
const write = (doc, caret) => `const v = document.querySelector('.cm-content').cmTile.root.view; v.focus(); v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(doc)} }, selection: { anchor: ${caret} } });`;
// Where the writing sits in a picture: the editor, and the counter
const layout = "(() => { const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }; const count = [...document.querySelectorAll('.writer-desktop-footer div.gap-4.ml-2')].find((el) => /words/.test(el.textContent) && /chars/.test(el.textContent)); const style = count && getComputedStyle(count); return { editor: box(document.querySelector('.wysiwyg-editor')), count: box(count), color: style && style.color, fontSize: style && style.fontSize, opacity: style && style.opacity }; })()";
const card = "(() => { const el = document.querySelector('.math-peek'); if (!el || !el.classList.contains('is-shown')) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()";

const plan = [
  { name: 'setup', activate: true, width: 1280, height: 800, js: seed, wait: 4 },
  { name: 'slates', activate: true, route: '/slates', wait: 3 },
  // The pointer over its row, as the list hears it (the page's own pointer events)
  { name: 'hover', activate: true, js: `const row = [...document.querySelectorAll('.slate-item')].find((r) => r.textContent.includes(${JSON.stringify(picked)})); const b = row.getBoundingClientRect(); row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.left + 60, clientY: b.top + b.height / 2 }));`, wait: 1 },
  { name: 'opened', activate: true, click: picked, probe: layout, wait: 3 },
  { name: 'writer', activate: true, js: write(writer, writer.length), wait: 2.5 },
  { name: 'palette', activate: true, js: press('k', true), wait: 2 },
  { name: 'closed', activate: true, js: press('Escape'), wait: 1 },
  { name: 'tabs', activate: true, tab: true, probe: layout, wait: 4 },
];
// The second slate's math typed as the page types it, its glass card
// pictured every few letters
const states = keystrokes(math);
const inside = states.map((state, i) => (state.math ? i : -1)).filter((i) => i >= 0);
for (const i of inside.filter((_, k) => k % 6 === 5 || k === inside.length - 1)) {
  plan.push({ name: `peek-${i}`, activate: true, js: write(states[i].doc, states[i].caret), probe: card, wait: 1.2 });
}

writeFileSync(`${dir}/plan.json`, JSON.stringify(plan, null, 2));
writeFileSync(`${dir}/fixtures.json`, JSON.stringify(fixtures));
writeFileSync(`${dir}/saved.txt`, saved);
console.log(`plan: ${plan.length} steps; alfaoz with ${rows.length} slates; "${picked}" picked`);
