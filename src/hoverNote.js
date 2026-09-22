// The hover note for plain DOM, where React's HoverNote cannot go (inside a
// CodeMirror widget). Same rules as HoverNote.jsx: a 200 ms hold before the
// card appears, the card tracks the cursor, flips below the pointer near
// the top of the viewport and to the left near the right edge. A `title`
// heads the card (red with `tone: 'danger'`); with `copy`, a small line
// under the note names the key, and cmd/ctrl+c while the card is up puts
// the note on the clipboard and that line says so for a moment. Returns a
// function that takes it all off.
const copyKey = () => (/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘C' : 'ctrl+C');
export function attachHoverNote(el, note, { copy = true, title = null, tone = null, copyHint = null, copied = 'copied' } = {}) {
  let card = null;
  let timer = null;
  let x = 0;
  let y = 0;
  let saidTimer = null;
  let hintEl = null;
  const place = () => {
    if (!card) return;
    const width = card.offsetWidth;
    const flipX = x + 12 + width > window.innerWidth - 8;
    card.style.left = flipX ? '' : `${x + 12}px`;
    card.style.right = flipX ? `${window.innerWidth - x + 12}px` : '';
    if (y < 120) { card.style.top = `${y + 16}px`; card.style.transform = 'translateY(8px)'; }
    else { card.style.top = `${y - 8}px`; card.style.transform = 'translateY(-100%)'; }
  };
  const show = () => {
    if (card) return;
    card = document.createElement('span');
    Object.assign(card.style, { position: 'fixed', zIndex: 9999, pointerEvents: 'none' });
    const box = document.createElement('span');
    box.className = 'block bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded px-3 py-2 text-xs font-mono text-[var(--theme-text-muted)] shadow-lg max-w-[28rem]';
    if (title) {
      const h = document.createElement('span');
      h.className = 'block mb-1';
      h.style.color = tone === 'danger' ? 'var(--theme-red)' : 'var(--theme-text)';
      h.textContent = title;
      box.appendChild(h);
    }
    const body = document.createElement('span');
    body.className = 'block whitespace-pre-wrap';
    body.textContent = note;
    box.appendChild(body);
    if (copy) {
      hintEl = document.createElement('span');
      hintEl.className = 'block mt-1.5 text-right text-[var(--theme-text-dim)]';
      hintEl.textContent = copyHint ? copyHint(copyKey()) : copyKey();
      box.appendChild(hintEl);
    }
    card.appendChild(box);
    document.body.appendChild(card);
    place();
    if (copy) document.addEventListener('keydown', onKey, true);
  };
  const hide = () => {
    clearTimeout(timer);
    clearTimeout(saidTimer);
    if (!card) return;
    document.removeEventListener('keydown', onKey, true);
    card.remove();
    card = null;
    hintEl = null;
  };
  const onKey = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'c') return;
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard?.writeText(note).then(() => {
      if (!hintEl) return;
      hintEl.textContent = copied;
      hintEl.style.color = 'var(--theme-green)';
      clearTimeout(saidTimer);
      saidTimer = setTimeout(() => { if (hintEl) { hintEl.textContent = copyHint ? copyHint(copyKey()) : copyKey(); hintEl.style.color = ''; } }, 1200);
    }).catch(() => {});
  };
  // A finger has no hover: a tap never opens the card
  const onEnter = (e) => { if (e.pointerType !== 'mouse') return; x = e.clientX; y = e.clientY; clearTimeout(timer); timer = setTimeout(show, 200); };
  const onMove = (e) => { x = e.clientX; y = e.clientY; place(); };
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', hide);
  return () => { hide(); el.removeEventListener('pointerenter', onEnter); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', hide); };
}
