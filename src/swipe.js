// The two-finger swipe over a row of words, per device: `swipe: natural |
// flipped` under accessibility. Natural moves the choice the way the fingers
// go, so a swipe to the left picks the word to the left; flipped is the
// other way round.
import { makePref } from './pref';

export const SWIPE_MODES = ['natural', 'flipped'];
const pref = makePref({ key: 'justtype-swipe', values: SWIPE_MODES, fallback: 'natural' });
export const readSwipe = pref.get;
export const setSwipe = pref.set;
export const useSwipe = pref.use;
