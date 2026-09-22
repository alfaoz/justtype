// Native menus in the iOS shell: the page hands over the items and where
// they hang from, and iOS draws its own menu there (glass, nested, the way
// every menu on the phone looks). Resolves with the id picked, or null.
// In a browser there is no shell and the caller draws its own menu.
//
// item = { id, label, danger?, checked?, disabled?, children?: [item], inline?: true }
// `children` makes a submenu; `inline` makes a divided section instead.
//
// The plugin lives in the shell (ios/App/App/ShellMenuPlugin.swift). The
// page carries no Capacitor runtime of its own, so it talks to the plugin
// through the bridge the shell injects. Nothing here may throw at load: a
// missing bridge means no native menus, never no app.
import { inShell } from './shell';
import { PUBLIC_URL } from './config';

const cap = inShell ? window.Capacitor : null;
export const canNativeMenu = Boolean(cap
  && typeof cap.nativePromise === 'function'
  && typeof cap.isPluginAvailable === 'function'
  && cap.isPluginAvailable('ShellMenu'));

export async function nativeMenu(anchorEl, items) {
  if (!canNativeMenu || !anchorEl) return undefined;
  const r = anchorEl.getBoundingClientRect();
  try {
    const res = await cap.nativePromise('ShellMenu', 'show', { x: r.left, y: r.top, width: r.width, height: r.height, items });
    return res?.id ?? null;
  } catch (err) {
    // undefined, not null: the caller falls back to its own menu
    console.warn('native menu failed', err);
    return undefined;
  }
}

// The writer's pill, drawn by the phone (ios/App/App/ShellPillPlugin.swift):
// the page keeps it current and listens for `shell:pick` on window
export const canNativePill = Boolean(cap
  && typeof cap.nativePromise === 'function'
  && typeof cap.isPluginAvailable === 'function'
  && cap.isPluginAvailable('ShellPill'));
// The writing menu as last sent, for handing the pill straight back to it
let lastPill = { label: '', items: [] };
export const setNativePill = (data) => { lastPill = data; return canNativePill ? cap.nativePromise('ShellPill', 'set', data).catch(() => {}) : Promise.resolve(); };
// Without a status: a message belongs to the moment it was sent
export const restoreNativePill = () => setNativePill({ ...lastPill, status: '' });
// The updates the pill's tray opens; a pick comes back as shell:nav "update:<id>"
export const setNativeUpdates = (data) => (canNativePill ? cap.nativePromise('ShellPill', 'updates', data).catch(() => {}) : Promise.resolve());
// One word in the pill's place for a page with no writing menu ({} gives it back)
export const setNativePillAction = (data) => (canNativePill ? cap.nativePromise('ShellPill', 'action', data).catch(() => {}) : Promise.resolve());
export const hideNativePill = () => (canNativePill ? cap.nativePromise('ShellPill', 'hide', {}).catch(() => {}) : Promise.resolve());

// The words at the bottom left, drawn by the phone (ShellBarPlugin): the page
// sends the words and listens for `shell:nav` on window. The same plugin
// sets the phone's light or dark for what it draws, from the theme.
export const canNativeBar = Boolean(cap
  && typeof cap.nativePromise === 'function'
  && typeof cap.isPluginAvailable === 'function'
  && cap.isPluginAvailable('ShellBar'));
// `companion`: a pill of its own beside the words ({ id, label }), or none
export const setNativeBar = (words, leftHanded = false, companion = null) => (canNativeBar ? cap.nativePromise('ShellBar', 'set', { words, leftHanded, companion }).catch(() => {}) : Promise.resolve());
export const hideNativeBar = () => (canNativeBar ? cap.nativePromise('ShellBar', 'hide', {}).catch(() => {}) : Promise.resolve());
export const setNativeAppearance = (dark) => (canNativeBar ? cap.nativePromise('ShellBar', 'appearance', { dark }).catch(() => {}) : Promise.resolve());

// Browser downloads and window.print have no browser UI in WKWebView.
// Hand exports to the system share sheet instead.
export const nativeExportText = (text, filename) => cap.nativePromise('ShellMenu', 'exportText', { text, filename });
export const nativeExportPDF = (filename) => cap.nativePromise('ShellMenu', 'exportPDF', { filename });

// A link out through the share sheet people know from every app: the phone's
// own in the shell, the browser's on a touch screen that has one. Resolves
// with true when it went somewhere; `canShareLink` false means copy instead.
const touchShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  && typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
export const canShareLink = canNativeMenu || touchShare;
export async function shareLink(url, anchorEl = null) { return shareOut({ url }, anchorEl); }
// The same for plain text (a nearby device's code)
export async function shareText(text, anchorEl = null) { return shareOut({ text }, anchorEl); }
async function shareOut(item, anchorEl) {
  if (canNativeMenu) {
    const r = anchorEl?.getBoundingClientRect();
    const at = r ? { x: r.left, y: r.top, width: r.width, height: r.height } : {};
    return cap.nativePromise('ShellMenu', 'shareURL', { ...item, ...at }).then(res => Boolean(res?.shared)).catch(() => false);
  }
  try { await navigator.share(item); return true; } catch { return false; }
}

// The phone's own QR reader (ShellScanPlugin): the text of the first code
// it sees, or null when closed or there is no camera
export const canNativeScan = Boolean(cap && typeof cap.isPluginAvailable === 'function' && cap.isPluginAvailable('ShellScan'));
export const nativeScan = (prompt) => cap.nativePromise('ShellScan', 'scan', { prompt }).then(r => r?.text || null).catch(() => null);

// Resolve the same Tailwind status color used by the web footer to sRGB for
// UIKit, including any palette overrides. Canvas handles CSS color formats.
const statusColors = new Map();
export function nativeStatusColor(tone) {
  const css = getComputedStyle(document.documentElement).getPropertyValue(tone.replace('text-', '--color-')).trim();
  if (!statusColors.has(css)) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.fillStyle = css || '#00c951';
    context.fillRect(0, 0, 1, 1);
    statusColors.set(css, Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3));
  }
  return statusColors.get(css);
}

// Google sign-in. On the web the server's page takes over. In the app the
// system's sign-in sheet opens it (Google refuses web views), the server sends
// the result back to justtype://auth, and the app reloads with that query so
// App.jsx exchanges the code exactly as the web does.
export async function startGoogleSignIn() {
  if (!canNativeMenu) { window.location.href = '/auth/google'; return; }
  const result = await cap.nativePromise('ShellMenu', 'signIn', { url: `${PUBLIC_URL}/auth/google?app=1`, scheme: 'justtype' }).catch(() => null);
  if (!result?.url) return;
  const query = new URL(result.url).search;
  if (query) window.location.replace(`/${query}`);
}

// A page asking for a new window (terms, privacy, verify) opens in Safari's
// sheet over the app. Left alone, the web view hands its own capacitor://
// address to whatever other app claims that scheme.
if (canNativeMenu) {
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest('a[target="_blank"]') : null;
    if (!link || e.defaultPrevented) return;
    const url = new URL(link.getAttribute('href') || '', window.location.href);
    const out = url.origin === window.location.origin ? `${PUBLIC_URL}${url.pathname}${url.search}${url.hash}` : url.href;
    if (!/^https?:/.test(out)) return;
    e.preventDefault();
    cap.nativePromise('ShellMenu', 'openURL', { url: out }).catch(() => {});
  });
}
