// Dollar-delimited math for the Lezer markdown parser.
//
// One inline parser handles both forms: `$...$` (single, same line) and
// `$$...$$` (double, may span lines inside a paragraph). A `$$` pair that
// owns whole lines is what people think of as a math block; the live
// preview decides block-vs-inline rendering from the node's position, so
// the parser only needs to produce one node type. Unclosed delimiters are
// left as plain text rather than swallowing the rest of the document.
//
// Single-dollar rules follow Pandoc so prices stay prose: the opening `$`
// must be followed by a non-space, the closing `$` must be preceded by a
// non-space and not followed by a digit ("$5 and $10" is not math).

const DOLLAR = 36;
const BACKSLASH = 92;
const SPACE = 32;
const NEWLINE = 10;

const isDigit = (ch) => ch >= 48 && ch <= 57;
const isBlank = (ch) => ch === SPACE || ch === NEWLINE || ch === 9;

function parseMath(cx, next, pos) {
  if (next !== DOLLAR) return -1;
  // Part of a longer dollar run ("$$$"): not ours
  if (pos > cx.offset && cx.char(pos - 1) === DOLLAR) return -1;
  const size = cx.char(pos + 1) === DOLLAR ? 2 : 1;
  const start = pos + size;
  if (start >= cx.end) return -1;
  if (size === 1 && isBlank(cx.char(start))) return -1;

  for (let i = start; i < cx.end; i++) {
    const ch = cx.char(i);
    if (ch === BACKSLASH) { i++; continue; }
    if (size === 1 && ch === NEWLINE) return -1;
    if (ch !== DOLLAR) continue;
    if (size === 2) {
      if (cx.char(i + 1) !== DOLLAR) continue;
      if (i === start) return -1;
      return cx.addElement(cx.elt('Math', pos, i + 2, [
        cx.elt('MathMark', pos, pos + 2),
        cx.elt('MathMark', i, i + 2),
      ]));
    }
    if (isBlank(cx.char(i - 1)) || isDigit(cx.char(i + 1))) continue;
    return cx.addElement(cx.elt('Math', pos, i + 1, [
      cx.elt('MathMark', pos, pos + 1),
      cx.elt('MathMark', i, i + 1),
    ]));
  }
  return -1;
}

export const markdownMath = {
  defineNodes: ['Math', 'MathMark'],
  parseInline: [{ name: 'Math', parse: parseMath, before: 'Emphasis' }],
};
