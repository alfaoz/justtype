// Motion: on or off for the whole app. Off means every animation and
// transition collapses to nothing (index.css, html[data-motion="off"]), the
// text morphs render plainly, and view transitions are skipped. The default
// follows the system's reduced-motion preference; the account page's
// accessibility section pins it for this device.
import { makePref } from './pref';

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

const pref = makePref({
  key: 'justtype-motion',
  values: ['on', 'off'],
  fallback: () => (media?.matches ? 'off' : 'on'),
  attr: 'motion',
});

export const getMotion = pref.get;
export const setMotion = pref.set;
export const useMotion = pref.use;
export const motionOff = () => pref.get() === 'off';

// Follow the system while nothing is pinned
media?.addEventListener?.('change', () => { if (!pref.stored()) pref.apply(pref.get()); });
