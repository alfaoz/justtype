// Scale: the size of everything at once (`size: normal big bigger` on the
// account page). It sets the root font size (index.css, html[data-scale]),
// and since the chrome and the writing sizes are in rem, the whole app
// grows with it, the three writing steps included.
import { makePref } from './pref';

export const SCALES = ['normal', 'big', 'bigger'];

const pref = makePref({ key: 'justtype-scale', values: SCALES, fallback: 'normal', attr: 'scale' });

export const getScale = pref.get;
export const setScale = pref.set;
export const useScale = pref.use;
