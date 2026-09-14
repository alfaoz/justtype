// Delete forever, five ways, to try on beta and keep one. The choice lives
// on the device (`justtype-gone-lab`) and the `gone:` row under the trash
// switches it. Each way takes the row element and returns the moment it is
// gone and a way to put it back if the server said no. Once one is chosen,
// collapse this file into SlateManager and drop the row.
import { motionOff } from './motion';

const KEY = 'justtype-gone-lab';
export const GONE_WAYS = ['burn', 'pit', 'shred', 'dust', 'zap'];
export const readGone = () => {
  try { const v = localStorage.getItem(KEY); return GONE_WAYS.includes(v) ? v : 'burn'; } catch { return 'burn'; }
};
export const writeGone = (v) => { try { localStorage.setItem(KEY, v); } catch {} };

const red = () => getComputedStyle(document.documentElement).getPropertyValue('--theme-red').trim() || '#b33000';
const settle = (anim) => new Promise((resolve) => { anim.onfinish = resolve; anim.oncancel = resolve; });

// The row's box closing: height, padding and borders to nothing so the
// rows below glide up, while what is on it does `keyframes`
const fold = (el, keyframes, opts) => {
  const style = getComputedStyle(el);
  const open = { height: `${el.getBoundingClientRect().height}px`, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, borderTopWidth: style.borderTopWidth, borderBottomWidth: style.borderBottomWidth };
  const shut = { height: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' };
  el.style.overflow = 'hidden';
  el.style.pointerEvents = 'none';
  return el.animate(keyframes.map((k, i) => ({ ...k, ...(i === keyframes.length - 1 ? shut : open) })), { fill: 'forwards', ...opts });
};

// A layer over the row, in the page, that goes when the row goes
const layerOver = (el) => {
  const r = el.getBoundingClientRect();
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, pointerEvents: 'none', zIndex: 60, overflow: 'visible' });
  document.body.appendChild(box);
  return box;
};

const clearRow = (el) => { el.style.overflow = ''; el.style.pointerEvents = ''; el.style.transformOrigin = ''; el.style.visibility = ''; el.style.position = ''; };

// Burn: fire climbs the row from its bottom edge with a ragged, flickering
// front, embers lift off it, what was written goes to ash, and the ash
// falls away as the box closes.
const burn = (el) => {
  const box = layerOver(el);
  const anims = [];
  const flame = document.createElement('div');
  const c = red();
  Object.assign(flame.style, { position: 'absolute', inset: '0', background: `linear-gradient(to top, ${c} 0%, color-mix(in srgb, ${c} 70%, orange) 35%, color-mix(in srgb, ${c} 35%, transparent) 70%, transparent 100%)`, mixBlendMode: 'screen' });
  box.appendChild(flame);
  const front = (ys) => `polygon(0 100%, ${ys.map((y, i) => `${(i / (ys.length - 1)) * 100}% ${y}%`).join(', ')}, 100% 100%)`;
  const jag = (base, spread) => Array.from({ length: 9 }, (_, i) => base + ((i * 7919) % 13 - 6) / 6 * spread);
  anims.push(flame.animate([
    { clipPath: front(jag(100, 0)), opacity: 0.9 },
    { clipPath: front(jag(62, 18)), opacity: 1, offset: 0.35 },
    { clipPath: front(jag(28, 22)), opacity: 1, offset: 0.65 },
    { clipPath: front(jag(-30, 20)), opacity: 0 },
  ], { duration: 620, easing: 'cubic-bezier(0.3, 0.1, 0.5, 1)', fill: 'forwards' }));
  for (let i = 0; i < 7; i++) {
    const ember = document.createElement('span');
    const x = 8 + ((i * 37) % 84);
    Object.assign(ember.style, { position: 'absolute', left: `${x}%`, bottom: '10%', width: '3px', height: '3px', borderRadius: '50%', background: c, boxShadow: `0 0 4px ${c}`, opacity: 0 });
    box.appendChild(ember);
    anims.push(ember.animate([
      { transform: 'translateY(0)', opacity: 0 },
      { opacity: 1, offset: 0.2 },
      { transform: `translateY(-${28 + (i * 11) % 30}px) translateX(${(i % 2 ? 1 : -1) * (4 + i)}px)`, opacity: 0 },
    ], { duration: 520 + (i * 53) % 200, delay: 80 + i * 45, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'forwards' }));
  }
  const ash = el.animate([{ opacity: 1 }, { opacity: 0.25 }], { duration: 480, delay: 120, easing: 'ease-in', fill: 'forwards' });
  const drop = fold(el, [{ transform: 'translateY(0)', opacity: 0.25 }, { transform: 'translateY(10px)', opacity: 0 }], { duration: 240, delay: 560, easing: 'cubic-bezier(0.5, 0, 1, 0.6)' });
  const done = settle(drop).then(() => box.remove());
  const cancel = () => { anims.forEach(a => a.cancel()); ash.cancel(); drop.cancel(); box.remove(); clearRow(el); };
  return { done, cancel };
};

// Pit: the row is a trapdoor hinged along its top edge. It swings down
// into the dark, a red glow rising from under it, and the floor closes.
const pit = (el) => {
  const box = layerOver(el);
  const c = red();
  const glow = document.createElement('div');
  Object.assign(glow.style, { position: 'absolute', inset: '0', background: `radial-gradient(ellipse 70% 120% at 50% 110%, color-mix(in srgb, ${c} 55%, transparent), transparent 70%)`, opacity: 0 });
  box.appendChild(glow);
  box.style.zIndex = 0;
  const shine = glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: 560, easing: 'ease-in-out', fill: 'forwards' });
  el.style.transformOrigin = 'center top';
  const swing = fold(el, [
    { transform: 'perspective(600px) rotateX(0deg)', opacity: 1 },
    { transform: 'perspective(600px) rotateX(-88deg) translateZ(-30px)', opacity: 0.15, offset: 0.72 },
    { transform: 'perspective(600px) rotateX(-92deg) translateZ(-40px)', opacity: 0 },
  ], { duration: 520, easing: 'cubic-bezier(0.55, 0, 0.9, 0.5)' });
  const done = settle(swing).then(() => box.remove());
  const cancel = () => { shine.cancel(); swing.cancel(); box.remove(); clearRow(el); };
  return { done, cancel };
};

// Shred: the row is cut into strips that drop, each at its own speed and
// tilt, and fade on the way down; the gap closes behind them.
const shred = (el) => {
  const box = layerOver(el);
  const N = 9;
  const anims = [];
  for (let i = 0; i < N; i++) {
    const strip = el.cloneNode(true);
    strip.querySelectorAll('[data-dropdown]').forEach(m => m.remove());
    strip.removeAttribute('data-slate');
    Object.assign(strip.style, { position: 'absolute', inset: '0', margin: '0', clipPath: `inset(0 ${100 - ((i + 1) / N) * 100}% 0 ${(i / N) * 100}%)`, visibility: 'visible', willChange: 'transform' });
    box.appendChild(strip);
    const fall = 34 + (i * 29) % 40;
    anims.push(strip.animate([
      { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
      { transform: `translateY(${fall}px) rotate(${(i % 2 ? 1 : -1) * (1 + (i * 3) % 4)}deg)`, opacity: 0 },
    ], { duration: 420 + (i * 71) % 180, delay: (i * 41) % 120, easing: 'cubic-bezier(0.5, 0, 1, 0.6)', fill: 'forwards' }));
  }
  el.style.visibility = 'hidden';
  const close = fold(el, [{}, {}], { duration: 220, delay: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
  const done = Promise.all([settle(close), ...anims.map(settle)]).then(() => box.remove());
  const cancel = () => { anims.forEach(a => a.cancel()); close.cancel(); box.remove(); clearRow(el); };
  return { done, cancel };
};

// Dust: the row loses focus, blurring and drifting up as it thins to
// nothing, and the space closes.
const dust = (el) => {
  const gone = fold(el, [
    { filter: 'blur(0px)', transform: 'translateY(0) scale(1)', opacity: 1 },
    { filter: 'blur(7px)', transform: 'translateY(-10px) scale(1.03)', opacity: 0, offset: 0.62 },
    { filter: 'blur(7px)', transform: 'translateY(-10px) scale(1.03)', opacity: 0 },
  ], { duration: 520, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
  return { done: settle(gone), cancel: () => { gone.cancel(); clearRow(el); } };
};

// Zap: a thin red edge sweeps the row from left to right and nothing is
// left behind it; the box closes at once.
const zap = (el) => {
  const box = layerOver(el);
  const c = red();
  const edge = document.createElement('div');
  Object.assign(edge.style, { position: 'absolute', top: '0', bottom: '0', left: '0', width: '2px', background: c, boxShadow: `0 0 8px ${c}, 0 0 18px color-mix(in srgb, ${c} 60%, transparent)` });
  box.appendChild(edge);
  const w = box.getBoundingClientRect().width;
  const SWEEP = 340;
  const sweep = edge.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${w}px)`, opacity: 1, offset: 0.92 }, { transform: `translateX(${w}px)`, opacity: 0 }], { duration: SWEEP + 60, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'forwards' });
  // The wipe follows the edge on the same curve, then the box closes
  const wipe = fold(el, [
    { clipPath: 'inset(0 0 0 0%)', easing: 'cubic-bezier(0.45, 0, 0.55, 1)' },
    { clipPath: 'inset(0 0 0 100%)', offset: SWEEP / (SWEEP + 200), easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
    { clipPath: 'inset(0 0 0 100%)' },
  ], { duration: SWEEP + 200 });
  const done = settle(wipe).then(() => box.remove());
  const cancel = () => { sweep.cancel(); wipe.cancel(); box.remove(); clearRow(el); };
  return { done, cancel };
};

const ways = { burn, pit, shred, dust, zap };

export const goneForever = (el) => {
  if (!el || !el.animate || motionOff()) return { done: Promise.resolve(), cancel: () => {} };
  return ways[readGone()](el);
};
