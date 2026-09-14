// Archive: the row is filed. It folds in half along its middle, the top
// half hinging down over the bottom so what was written is put away under
// a blank fold, and the folded slip slides off to the right and out of the
// list, the rows below closing up; the word `archived` gives a nod. Coming
// back out of the archive is the same fold, the slip pulled out to the
// left. Returns the moment the row is gone and a way to leave it as it was
// if the server said no.
import { motionOff } from './motion';
import { settle, fold, layerOver, copyOf, clearRow, nod } from './rowMotion';

export const fileAway = (el, { away = true } = {}) => {
  if (!el || !el.animate || motionOff()) return { done: Promise.resolve(), cancel: () => {} };
  const box = layerOver(el.getBoundingClientRect());
  const paper = 'var(--theme-bg)';
  const bottom = copyOf(el, 'inset(50% 0 0 0)', { background: paper });
  const top = copyOf(el, 'inset(0 0 50% 0)', { background: paper, transformOrigin: '50% 50%', backfaceVisibility: 'hidden' });
  // The underside of the fold, seen once the top half has come over
  const back = document.createElement('div');
  Object.assign(back.style, { position: 'absolute', left: '0', right: '0', top: '50%', height: '50%', background: 'var(--theme-bg-secondary)', borderTop: '1px solid var(--theme-border)', opacity: 0 });
  box.append(bottom, back, top);
  el.style.visibility = 'hidden';
  const FOLD = 340;
  const SLIDE = 280;
  const flip = top.animate([{ transform: 'perspective(900px) rotateX(0deg)' }, { transform: 'perspective(900px) rotateX(-180deg)' }], { duration: FOLD, easing: 'cubic-bezier(0.5, 0, 0.3, 1)', fill: 'forwards' });
  const show = back.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.55 }, { opacity: 1 }], { duration: FOLD, fill: 'forwards' });
  const slip = [bottom, back].map(part => part.animate(
    [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${away ? 48 : -48}px)`, opacity: 0 }],
    { duration: SLIDE, delay: FOLD + 40, easing: 'cubic-bezier(0.5, 0, 1, 0.6)', fill: 'forwards' },
  ));
  const close = fold(el, [{}, {}], { duration: SLIDE, delay: FOLD + 40, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
  if (away) nod('archived', FOLD + 40);
  const done = settle(close).then(() => box.remove());
  const cancel = () => { [flip, show, ...slip, close].forEach(a => a.cancel()); box.remove(); clearRow(el); };
  return { done, cancel };
};
