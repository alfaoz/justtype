// Archive: nothing theatrical. The row goes quiet and slides a little to
// the right as it fades, the way a sheet is pushed aside, its box closing
// under it so the rows below come up; the word `archived` gives a nod.
// Out of the archive it slides left instead. Returns the moment the row is
// gone and a way to leave it as it was if the server said no.
import { motionOff } from './motion';
import { settle, fold, clearRow, nod } from './rowMotion';

export const fileAway = (el, { away = true } = {}) => {
  if (!el || !el.animate || motionOff()) return { done: Promise.resolve(), cancel: () => {} };
  const SLIDE = 260;
  const close = fold(el, [
    { transform: 'translateX(0)', opacity: 1 },
    { transform: `translateX(${away ? 14 : -14}px)`, opacity: 0, offset: 0.7 },
    { transform: `translateX(${away ? 14 : -14}px)`, opacity: 0 },
  ], { duration: SLIDE + 120, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' });
  if (away) nod('archived', SLIDE - 80);
  const cancel = () => { close.cancel(); clearRow(el); };
  return { done: settle(close), cancel };
};
