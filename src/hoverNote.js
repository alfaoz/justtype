// The hover note for plain DOM, where React's HoverNote cannot go (inside a
// CodeMirror widget). Same rules as HoverNote.jsx: a 200 ms hold before the
// card appears, the card tracks the cursor, flips below the pointer near
// the top of the viewport and to the left near the right edge. With `copy`,
// cmd/ctrl+c while the card is up puts the note on the clipboard and the
// card says so for a moment. Returns a function that takes it all off.
export function attachHoverNote(el, note, { copy = true } = {}) {
  let card = null;
  let timer = null;
  let x = 0;
  let y = 0;
  let saidTimer = null;
  const inner = () => card?.firstChild;
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
    box.className = 'block bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded px-3 py-2 text-xs font-mono text-[var(--theme-text-muted)] shadow-lg max-w-[28rem] whitespace-pre-wrap';
    box.textContent = note;
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
  };
  const onKey = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'c') return;
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard?.writeText(note).then(() => {
      const b = inner();
      if (!b) return;
      b.textContent = 'copied';
      clearTimeout(saidTimer);
      saidTimer = setTimeout(() => { if (inner()) inner().textContent = note; }, 1200);
    }).catch(() => {});
  };
  const onEnter = (e) => { x = e.clientX; y = e.clientY; clearTimeout(timer); timer = setTimeout(show, 200); };
  const onMove = (e) => { x = e.clientX; y = e.clientY; place(); };
  el.addEventListener('mouseenter', onEnter);
  el.addEventListener('mousemove', onMove);
  el.addEventListener('mouseleave', hide);
  return () => { hide(); el.removeEventListener('mouseenter', onEnter); el.removeEventListener('mousemove', onMove); el.removeEventListener('mouseleave', hide); };
}
