// Reading aids, per device, from the account page's accessibility section.
// Each stamps <html> for index.css to key on.
//
//   readable font  `html[data-readable="on"]`   Atkinson Hyperlegible (self-hosted)
//                                               replaces the theme's fonts
//   line focus     `html[data-linefocus="on"]`  in the rich editor, every line but
//                                               the one with the caret dims
import { makePref } from './pref';

export const readableFont = makePref({ key: 'justtype-readable-font', values: ['off', 'on'], fallback: 'off', attr: 'readable' });
export const lineFocus = makePref({ key: 'justtype-line-focus', values: ['off', 'on'], fallback: 'off', attr: 'linefocus' });
