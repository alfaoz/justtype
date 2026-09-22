// Scale: the size of everything at once (`big text: off big bigger` on the
// account page). It sets the root font size (index.css, html[data-scale]),
// and since the chrome and the writing sizes are in rem, the whole app
// grows with it, the three writing steps included.
//
// In the app the device decides and the row is gone: big on an iPad, where
// the page is read from further away, off on an iPhone.
import { makePref } from './pref';
import { inShell, isPad } from './shell';

export const SCALES = ['off', 'big', 'bigger'];

const fixed = inShell ? (isPad() ? 'big' : 'off') : null;

const pref = makePref({ key: 'justtype-scale', values: SCALES, fallback: 'off', attr: 'scale' });
if (fixed) pref.apply(fixed);

export const getScale = fixed ? () => fixed : pref.get;
export const setScale = pref.set;
export const useScale = fixed ? () => fixed : pref.use;
