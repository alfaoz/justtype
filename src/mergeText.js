// Three-way merge of slate text (base, ours, theirs). Lines only one side
// changed merge silently. A line both sides changed is tried again on words:
// different words on the same line merge too, and only the same words
// changed both ways become a conflict block, which the editor renders as a
// card (livePreview.js).
import { diff3Merge } from 'node-diff3';

export const CONFLICT_OURS = '<<<<<<< this device';
export const CONFLICT_SEP = '=======';
export const CONFLICT_THEIRS = '>>>>>>> elsewhere';

// The conflict blocks in a text, with the same spans the rich editor's
// parser (components/markdownConflict.js) turns into cards: from the start of
// the opening marker line to the end of the closing one (or the end of the
// text when a block never closes). The plain editor shows these as cards
// above the text.
const OPEN = /^<{7}(?:\s|$)/;
const SEP = /^={7}\s*$/;
const CLOSE = /^>{7}(?:\s|$)/;
export function findConflicts(text) {
  if (!text || !text.includes('<<<<<<<')) return [];
  const lines = text.split('\n');
  const out = [];
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineStart = start;
    start += lines[i].length + 1;
    if (!OPEN.test(lines[i])) continue;
    const ours = [], theirs = [];
    let part = ours;
    let j = i + 1;
    let at = start;
    for (; j < lines.length; j++) {
      if (part === ours && SEP.test(lines[j])) { part = theirs; at += lines[j].length + 1; continue; }
      if (CLOSE.test(lines[j])) break;
      part.push(lines[j]);
      at += lines[j].length + 1;
    }
    const last = Math.min(j, lines.length - 1);
    const end = j < lines.length ? at + lines[j].length : text.length;
    out.push({ from: lineStart, to: end, ours: ours.join('\n'), theirs: theirs.join('\n') });
    start = end + 1;
    i = last;
  }
  return out;
}

// Words and the whitespace between them, kept, so the text goes back
// together exactly as it was
const tokens = (text) => text.split(/(\s+)/).filter((t) => t.length);

// null when both sides touched the same words
function mergeWords(base, ours, theirs) {
  const regions = diff3Merge(tokens(ours), tokens(base), tokens(theirs), { excludeFalseConflicts: true });
  if (regions.some((r) => !r.ok)) return null;
  return regions.flatMap((r) => r.ok).join('');
}

export function mergeTexts(base, ours, theirs) {
  const regions = diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), { excludeFalseConflicts: true });
  const out = [];
  let conflicts = 0;
  for (const r of regions) {
    if (r.ok) { out.push(...r.ok); continue; }
    const words = mergeWords(r.conflict.o.join('\n'), r.conflict.a.join('\n'), r.conflict.b.join('\n'));
    if (words !== null) { out.push(...words.split('\n')); continue; }
    conflicts++;
    out.push(CONFLICT_OURS, ...r.conflict.a, CONFLICT_SEP, ...r.conflict.b, CONFLICT_THEIRS);
  }
  return { text: out.join('\n'), conflicts };
}
