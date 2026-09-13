// Caret-centred scrolling, per device: `scroll: normal | centered` in the
// writer's settings row. With it on, the line being typed stays in the
// middle of the page instead of drifting to the bottom edge. The rich
// editor asks CodeMirror to keep the caret centred; the plain textarea has
// no caret geometry of its own, so a hidden mirror of its text measures
// where the caret is.
import { makePref } from './pref';

export const SCROLL_MODES = ['normal', 'centered'];
const pref = makePref({ key: 'justtype-scroll', values: SCROLL_MODES, fallback: 'normal' });
export const readScroll = pref.get;
export const setScroll = pref.set;
export const useScroll = pref.use;
export const nextScroll = pref.next;

let mirror = null;
const MIRRORED = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth', 'boxSizing', 'tabSize'];

// The caret's top edge inside the textarea, in pixels from its top
export function caretTop(ta) {
  if (!mirror) {
    mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflowWrap: 'break-word', pointerEvents: 'none' });
    document.body.appendChild(mirror);
  }
  const cs = getComputedStyle(ta);
  for (const p of MIRRORED) mirror.style[p] = cs[p];
  mirror.style.width = `${ta.clientWidth}px`;
  mirror.textContent = ta.value.slice(0, ta.selectionEnd);
  const mark = document.createElement('span');
  mark.textContent = '​';
  mirror.appendChild(mark);
  return mark.offsetTop;
}

// Scroll `scroller` so the textarea's caret line sits in the middle
export function centerTextareaCaret(scroller, ta) {
  if (!scroller || !ta) return;
  const line = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  const top = ta.offsetTop + caretTop(ta) + line / 2;
  const target = Math.max(0, top - scroller.clientHeight / 2);
  if (Math.abs(scroller.scrollTop - target) < 2) return;
  scroller.scrollTo({ top: target, behavior: 'smooth' });
}
