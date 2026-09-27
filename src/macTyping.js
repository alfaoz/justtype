// How a person types a slate, for the window on the Mac page (MacPage.jsx)
// and the pictures taken of it (mac/site-shots.sh): a letter at a time, and
// in math the way the editor pairs things: the closing $$, brace or bracket
// arrives with its opening, the inside is filled in after, and the caret
// steps over the closer when it is typed. Every state the page shows, as
// the text and where the caret is, from nothing to the whole text.
const PAIRS = { '{': '}', '(': ')', '[': ']' };

// The math in the text, as the editor's parser finds it (markdownMath.js):
// a block on lines of its own takes its line breaks with its fences
function mathSpans(text) {
  const spans = [];
  for (const m of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$(?!\d)/g)) {
    const block = m[1] !== undefined;
    const inner = block ? m[1] : m[2];
    const open = block ? (inner.startsWith('\n') ? '$$\n' : '$$') : '$';
    const close = block ? (inner.endsWith('\n') ? '\n$$' : '$$') : '$';
    spans.push({ from: m.index, end: m.index + m[0].length - close.length, open, close });
  }
  return spans;
}

export function keystrokes(text) {
  const spans = mathSpans(text);
  const states = [{ doc: '', caret: 0, math: false }];
  const pending = []; // closers after the caret, the innermost last
  let typed = '';
  let span = null;
  const show = () => states.push({ doc: typed + [...pending].reverse().join(''), caret: typed.length, math: Boolean(span) });
  let i = 0;
  while (i < text.length) {
    if (span && i === span.end) {
      // The math's own closer: anything still open inside it goes, and the
      // caret steps past the fence
      pending.length = span.depth;
      typed += span.close;
      i += span.close.length;
      span = null;
      continue;
    }
    const top = pending[pending.length - 1];
    if (span && pending.length > span.depth + 1 && text.startsWith(top, i)) {
      typed += top;
      i += top.length;
      pending.pop();
      continue;
    }
    const opening = !span && spans.find((s) => s.from === i);
    if (opening) {
      span = { ...opening, depth: pending.length };
      typed += opening.open;
      i += opening.open.length;
      pending.push(opening.close);
      show();
      continue;
    }
    const c = text[i];
    typed += c;
    i += 1;
    if (span && PAIRS[c]) pending.push(PAIRS[c]);
    show();
  }
  const last = states[states.length - 1];
  if (last.doc !== text || last.caret !== text.length) states.push({ doc: text, caret: text.length, math: false });
  return states;
}
