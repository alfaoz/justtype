// Per-user collab colours, picked by a stable hash of the username so the same
// person is the same colour for everyone in the slate, on every device, with no
// coordination. Used by the remote carets in the editor and by the people list
// in the collab panel, which must agree or the colour tells you nothing.
//
// Kept in its own module (imported only by the lazy collab chunks) so it never
// drags anything onto the entry chunk's critical path.

// [solid, translucent]
export const CURSOR_COLORS = [
  ['#4a9eff', '#4a9eff44'], ['#b478f0', '#b478f044'], ['#3ecf8e', '#3ecf8e44'],
  ['#f0a848', '#f0a84844'], ['#f06878', '#f0687844'], ['#48c8d8', '#48c8d844'],
  ['#d8b448', '#d8b44844'], ['#78b0f0', '#78b0f044'],
];

export const colorFor = (name) => {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
};
