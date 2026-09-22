// The iOS shell: the same app inside a WKWebView (see ../ios). Nothing here
// runs in a browser, where window.Capacitor does not exist.
//
// The keyboard floats over the page the way it does in a native app (the
// shell does not shrink the web view), and its height is published as
// --kb on <html>, so the pill, the sheet and the modals lift above it and
// the writer keeps the caret in view. The page is marked data-shell so the
// header can step aside: an app has no address bar to be told where it is.
const cap = typeof window !== 'undefined' ? window.Capacitor : null;
export const inShell = Boolean(cap?.isNativePlatform?.());
// iPadOS web views say Macintosh; a Mac has no touch points
export const isPad = () => /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// The writer's editors in the app: the caret keeps clear of the dock that
// floats over the last lines, and once the keyboard is up (the writer has shrunk above
// it, see index.css) the caret's line is brought into view. Nothing in a
// browser.
export const shellScrollMargins = (EditorView, ViewPlugin) => (inShell ? [
  EditorView.scrollMargins.of(() => ({ bottom: 88 })),
  ViewPlugin.define((view) => {
    const reveal = () => {
      if (!view.hasFocus) return;
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) });
    };
    window.addEventListener('shell:caret', reveal);
    return { destroy: () => window.removeEventListener('shell:caret', reveal) };
  }),
] : []);

// The scrolling box a field sits in (a modal's overlay, a page), if any
const scrollerOf = (el) => {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
};

// A field the keyboard would cover is brought up above it, with the line
// under it (the button that submits the form) still in view. The writer's
// own editors are left alone: they keep their caret in view themselves.
const revealField = (kb) => {
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLInputElement)) return;
  const box = scrollerOf(el);
  if (!box) return;
  const seen = window.innerHeight - kb - 72;
  const over = el.getBoundingClientRect().bottom - seen;
  if (over > 0) box.scrollBy({ top: over, behavior: 'smooth' });
};

if (inShell) {
  const html = document.documentElement;
  html.dataset.shell = cap.getPlatform();
  html.dataset.device = isPad() ? 'pad' : 'phone';
  if (cap.isPluginAvailable?.('ShellPill')) html.dataset.nativePill = '';
  if (cap.isPluginAvailable?.('ShellBar')) html.dataset.nativeBar = '';
  const kb = cap.Plugins?.Keyboard;
  const set = (h) => {
    html.style.setProperty('--kb', `${Math.max(0, Math.round(h))}px`);
    // The page hears about it too (the shell bar shows `done` while it is up)
    window.dispatchEvent(new CustomEvent('shell:keyboard', { detail: { height: Math.max(0, h) } }));
  };
  set(0);
  kb?.addListener?.('keyboardWillShow', (e) => {
    set(e.keyboardHeight);
    requestAnimationFrame(() => revealField(e.keyboardHeight));
    // The writer's caret, once its page has taken the new height
    requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event('shell:caret'))));
  });
  kb?.addListener?.('keyboardWillHide', () => set(0));
  // Moving between fields with the keyboard already up
  document.addEventListener('focusin', () => {
    const h = parseFloat(html.style.getPropertyValue('--kb')) || 0;
    if (h) setTimeout(() => revealField(h), 50);
  });
}

// The app reopens where it was left, as phone apps do (it has no address bar
// to come back through): the last page is remembered, and a fresh launch at
// the start page goes back to it, quietly, while signed in. A new slate's
// draft comes back on its own (Writer.jsx).
if (inShell) {
  const LAST = 'justtype-last-path';
  const resumable = /^\/(slates|account|slate\/[\w-]+|shared\/\d+)?$/;
  const remember = () => {
    const path = window.location.pathname;
    if (resumable.test(path)) { try { localStorage.setItem(LAST, path); } catch {} }
  };
  try {
    const last = localStorage.getItem(LAST);
    if (window.location.pathname === '/' && last && last !== '/' && localStorage.getItem('justtype-username')) {
      window.history.replaceState(null, '', last);
    }
  } catch {}
  for (const name of ['pushState', 'replaceState']) {
    const original = window.history[name].bind(window.history);
    window.history[name] = (...args) => { const result = original(...args); remember(); return result; };
  }
  window.addEventListener('popstate', remember);
}

// Native siblings otherwise sit above every HTML z-index. Yield the dock to
// full-screen web dialogs, including nested dialogs, and restore it only
// after the last one has closed. Match the app's shared overlay convention.
if (inShell && cap.isPluginAvailable?.('ShellBar')) {
  let lastVisible = false;
  let queued = false;
  const syncOverlays = () => {
    queued = false;
    const visible = [...document.querySelectorAll('.fixed.inset-0, [aria-modal="true"]')].some((el) => {
      const style = getComputedStyle(el);
      return style.position === 'fixed' && style.display !== 'none' && style.visibility !== 'hidden'
        && style.pointerEvents !== 'none' && (Number(style.zIndex) >= 50 || el.getAttribute('aria-modal') === 'true');
    });
    if (visible === lastVisible) return;
    lastVisible = visible;
    cap.nativePromise('ShellBar', 'overlay', { visible }).catch(() => {});
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(syncOverlays); } };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-modal'] });
  window.addEventListener('resize', schedule);
  schedule();
}
