// Conflict blocks in markdown source.
//
// When a merge cannot decide between two versions of a region (see
// offlineSync.mergeTexts), both land in the document between git-style
// markers so nothing is lost and the slate still syncs as plain text:
//
//   <<<<<<< this device
//   ...ours...
//   =======
//   ...theirs...
//   >>>>>>> elsewhere
//
// This block parser claims those lines before the paragraph logic can, so
// `=======` is never read as a setext heading underline and the live preview
// can render the whole block as one card with keep-mine / keep-theirs /
// keep-both actions. Plain mode shows the raw markers, which is fine.

const OPEN = /^<{7}(?:\s|$)/;
const SEP = /^={7}\s*$/;
const CLOSE = /^>{7}(?:\s|$)/;

const conflictParser = {
  name: 'Conflict',
  parse(cx, line) {
    if (!OPEN.test(line.text.slice(line.pos))) return false;
    const from = cx.lineStart + line.pos;
    const marks = [cx.elt('ConflictMark', from, cx.lineStart + line.text.length)];
    let part = 'ours';
    let oursFrom = null, oursTo = null, theirsFrom = null, theirsTo = null;
    while (cx.nextLine()) {
      const text = line.text.slice(line.pos);
      const lFrom = cx.lineStart + line.pos, lTo = cx.lineStart + line.text.length;
      if (part === 'ours' && SEP.test(text)) {
        marks.push(cx.elt('ConflictMark', lFrom, lTo));
        part = 'theirs';
        continue;
      }
      if (CLOSE.test(text)) {
        marks.push(cx.elt('ConflictMark', lFrom, lTo));
        cx.nextLine();
        break;
      }
      if (part === 'ours') { if (oursFrom === null) oursFrom = lFrom; oursTo = lTo; }
      else { if (theirsFrom === null) theirsFrom = lFrom; theirsTo = lTo; }
    }
    if (oursFrom !== null) marks.push(cx.elt('ConflictOurs', oursFrom, oursTo));
    if (theirsFrom !== null) marks.push(cx.elt('ConflictTheirs', theirsFrom, theirsTo));
    marks.sort((a, b) => a.from - b.from);
    cx.addElement(cx.elt('Conflict', from, cx.prevLineEnd(), marks));
    return true;
  },
  // A marker line ends a paragraph, like a code fence does
  endLeaf(cx, line) { return OPEN.test(line.text.slice(line.pos)); },
  before: 'FencedCode',
};

export const markdownConflict = {
  defineNodes: [{ name: 'Conflict', block: true }, 'ConflictMark', 'ConflictOurs', 'ConflictTheirs'],
  parseBlock: [conflictParser],
};
