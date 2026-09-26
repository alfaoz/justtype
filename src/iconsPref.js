// Little pictures beside the words, per device: `icons: off | on` under
// accessibility. Off, the app is words alone; on, the slate menu, the list's
// rows of words, the header's tabs and the writer's settings row each get a
// glyph before the word.
import { makePref } from './pref';

export const ICON_MODES = ['off', 'on'];
const pref = makePref({ key: 'justtype-icons', values: ICON_MODES, fallback: 'off' });
export const readIcons = pref.get;
export const setIcons = pref.set;
export const useIcons = pref.use;
