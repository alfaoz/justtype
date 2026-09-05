// Line-based three-way merge of slate text (base, ours, theirs). Regions
// only one side changed merge silently; regions both changed become a
// conflict block the editor renders as a card (markdownConflict.js).
import { diff3Merge } from 'node-diff3';

export const CONFLICT_OURS = '<<<<<<< this device';
export const CONFLICT_SEP = '=======';
export const CONFLICT_THEIRS = '>>>>>>> elsewhere';

export function mergeTexts(base, ours, theirs) {
  const regions = diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), { excludeFalseConflicts: true });
  const out = [];
  let conflicts = 0;
  for (const r of regions) {
    if (r.ok) { out.push(...r.ok); continue; }
    conflicts++;
    out.push(CONFLICT_OURS, ...r.conflict.a, CONFLICT_SEP, ...r.conflict.b, CONFLICT_THEIRS);
  }
  return { text: out.join('\n'), conflicts };
}
