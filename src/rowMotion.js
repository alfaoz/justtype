// What the list's row motions share: a row's box closing so the rows below
// glide up, a layer over a row for pieces that move on their own, and the
// promise of an animation ending.
export const settle = (anim) => new Promise((resolve) => { anim.onfinish = resolve; anim.oncancel = resolve; });

// A row's box closing: height, padding and borders to nothing, while what
// is on it does `keyframes`
export const fold = (el, keyframes, opts) => {
  const style = getComputedStyle(el);
  const open = { height: `${el.getBoundingClientRect().height}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, borderTopWidth: style.borderTopWidth, borderBottomWidth: style.borderBottomWidth };
  const shut = { height: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' };
  el.style.overflow = 'hidden';
  el.style.pointerEvents = 'none';
  return el.animate(keyframes.map((k, i) => ({ ...k, ...(i === keyframes.length - 1 ? shut : open) })), { fill: 'forwards', ...opts });
};

// A fixed layer over a rectangle of the page, gone when the motion is
export const layerOver = ({ left, top, right, bottom }) => {
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`, pointerEvents: 'none', zIndex: 60 });
  document.body.appendChild(box);
  return box;
};

// A copy of a row for the layer: its open menu left out, its own place in
// the list forgotten, clipped to `clip` if given
export const copyOf = (el, clip, extra = {}) => {
  const c = el.cloneNode(true);
  c.querySelectorAll('[data-dropdown]').forEach(m => m.remove());
  c.removeAttribute('data-slate');
  Object.assign(c.style, { position: 'absolute', inset: '0', margin: '0', visibility: 'visible', ...(clip ? { clipPath: clip } : {}), ...extra });
  return c;
};

export const clearRow = (el) => { el.style.overflow = ''; el.style.pointerEvents = ''; el.style.visibility = ''; };

// One small nod from a word in the show row: up quickly and slowing, down
// under gravity
export const nod = (choice, delay = 0) => {
  document.querySelector(`[data-choice="${choice}"]`)?.animate([
    { transform: 'translateY(0)', easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
    { transform: 'translateY(-5px)', offset: 0.42, easing: 'cubic-bezier(0.55, 0, 0.8, 0.4)' },
    { transform: 'translateY(0)' },
  ], { duration: 320, delay });
};
