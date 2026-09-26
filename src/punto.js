// The writing size steps (`size: small base large`), shared by the writer
// and the public reader. The classes live in index.css as .punto-*; the
// choice is per device and every view hears about a change through usePunto.
// The account page's `size` scales these along with everything else.
import { makePref } from './pref';

export const PUNTO_SIZES = ['small', 'base', 'large'];

const pref = makePref({ key: 'justtype-punto', values: PUNTO_SIZES, fallback: 'base' });

export const readPunto = pref.get;
export const setPunto = pref.set;
export const usePunto = pref.use;
export const nextPunto = pref.next;
