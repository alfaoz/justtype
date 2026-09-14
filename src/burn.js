// Delete forever: the rows burn. Fire climbs from the bottom edge with a
// ragged, flickering front, embers lift off it, what was written goes to
// ash, and the ash falls away as the boxes close. Several rows at once burn
// as one block: the fire climbs the whole of it, slower for a taller
// block, and the rows drop together. Rows with something unburnt between
// them burn as separate blocks at the same time. Returns the moment the
// rows are gone and a way to put them back if the server said no.
import { motionOff } from './motion';

const settle = (anim) => new Promise((resolve) => { anim.onfinish = resolve; anim.oncancel = resolve; });
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const red = () => cssVar('--theme-red') || '#b33000';
// Fire is light on a dark page and shadow on a light one
const blend = () => {
  const m = /^#([0-9a-f]{6})$/i.exec(cssVar('--theme-bg') || '');
  if (!m) return 'screen';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 128 ? 'multiply' : 'screen';
};

// A row's box closing: height, padding and borders to nothing so the rows
// below glide up, while what is on it does `keyframes`
const fold = (el, keyframes, opts) => {
  const style = getComputedStyle(el);
  const open = { height: `${el.getBoundingClientRect().height}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, borderTopWidth: style.borderTopWidth, borderBottomWidth: style.borderBottomWidth };
  const shut = { height: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' };
  el.style.overflow = 'hidden';
  el.style.pointerEvents = 'none';
  return el.animate(keyframes.map((k, i) => ({ ...k, ...(i === keyframes.length - 1 ? shut : open) })), { fill: 'forwards', ...opts });
};
const clearRow = (el) => { el.style.overflow = ''; el.style.pointerEvents = ''; };

const burnBlock = ({ items, top, bottom, left, right }) => {
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`, pointerEvents: 'none', zIndex: 60 });
  document.body.appendChild(box);
  const c = red();
  const rows = items.length;
  const DRAW = Math.min(620 + (rows - 1) * 150, 1700);
  const anims = [];
  const flame = document.createElement('div');
  Object.assign(flame.style, { position: 'absolute', inset: '0', background: `linear-gradient(to top, ${c} 0%, color-mix(in srgb, ${c} 70%, orange) 35%, color-mix(in srgb, ${c} 35%, transparent) 70%, transparent 100%)`, mixBlendMode: blend() });
  box.appendChild(flame);
  const front = (ys) => `polygon(0 100%, ${ys.map((y, i) => `${(i / (ys.length - 1)) * 100}% ${y}%`).join(', ')}, 100% 100%)`;
  const jag = (base, spread) => Array.from({ length: 9 }, (_, i) => base + ((i * 7919) % 13 - 6) / 6 * spread);
  anims.push(flame.animate([
    { clipPath: front(jag(100, 0)), opacity: 0.9 },
    { clipPath: front(jag(62, 18)), opacity: 1, offset: 0.35 },
    { clipPath: front(jag(28, 22)), opacity: 1, offset: 0.65 },
    { clipPath: front(jag(-30, 20)), opacity: 0 },
  ], { duration: DRAW, easing: 'cubic-bezier(0.3, 0.1, 0.5, 1)', fill: 'forwards' }));
  const embers = Math.min(7 + (rows - 1) * 3, 18);
  for (let i = 0; i < embers; i++) {
    const ember = document.createElement('span');
    Object.assign(ember.style, { position: 'absolute', left: `${8 + ((i * 37) % 84)}%`, bottom: `${5 + ((i * 23) % 40)}%`, width: '3px', height: '3px', borderRadius: '50%', background: c, boxShadow: `0 0 4px ${c}`, opacity: 0 });
    box.appendChild(ember);
    anims.push(ember.animate([
      { transform: 'translateY(0)', opacity: 0 },
      { opacity: 1, offset: 0.2 },
      { transform: `translateY(-${28 + (i * 11) % 30}px) translateX(${(i % 2 ? 1 : -1) * (4 + i)}px)`, opacity: 0 },
    ], { duration: 520 + (i * 53) % 200, delay: 80 + (i * 45) % (DRAW - 400), easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'forwards' }));
  }
  // The lowest row goes to ash first, the fire reaching each in turn
  const ashes = items.map(({ el }, i) => el.animate([{ opacity: 1 }, { opacity: 0.25 }], { duration: 420, delay: 100 + ((rows - 1 - i) / Math.max(rows, 1)) * (DRAW - 480), easing: 'ease-in', fill: 'forwards' }));
  const drops = items.map(({ el }) => fold(el, [{ transform: 'translateY(0)', opacity: 0.25 }, { transform: 'translateY(10px)', opacity: 0 }], { duration: 240, delay: DRAW - 60, easing: 'cubic-bezier(0.5, 0, 1, 0.6)' }));
  const done = Promise.all(drops.map(settle)).then(() => box.remove());
  const cancel = () => { [...anims, ...ashes, ...drops].forEach(a => a.cancel()); box.remove(); items.forEach(({ el }) => clearRow(el)); };
  return { done, cancel };
};

export const burnAway = (els) => {
  const rows = els.filter(Boolean);
  if (!rows.length || !rows[0].animate || motionOff()) return { done: Promise.resolve(), cancel: () => {} };
  const sorted = rows.map(el => ({ el, r: el.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
  const blocks = [];
  for (const it of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && it.r.top - last.bottom < 8) {
      last.items.push(it); last.bottom = Math.max(last.bottom, it.r.bottom); last.left = Math.min(last.left, it.r.left); last.right = Math.max(last.right, it.r.right);
    } else blocks.push({ items: [it], top: it.r.top, bottom: it.r.bottom, left: it.r.left, right: it.r.right });
  }
  const parts = blocks.map(b => burnBlock({ ...b, items: b.items.sort((a, c) => a.r.top - c.r.top) }));
  return { done: Promise.all(parts.map(p => p.done)), cancel: () => parts.forEach(p => p.cancel()) };
};
