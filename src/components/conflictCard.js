// A merge conflict as one card: both versions side by side, three ways out.
// Plain DOM so both editors show the same element: the rich editor as a
// CodeMirror widget in place of the block (livePreview.js), the plain editor
// above its text (PlainConflicts.jsx). choose(text) replaces the whole block
// with the choice, so resolving is just another edit, undoable and autosaved.
import { strings } from '../strings';

export function buildConflictCard({ ours, theirs, choose }) {
  const el = document.createElement('div');
  el.className = 'conflict-card';
  const t = strings.writer.conflict;
  const pane = (label, text) => {
    const p = document.createElement('div');
    p.className = 'conflict-card-pane';
    const h = document.createElement('div'); h.className = 'conflict-card-label'; h.textContent = label;
    const b = document.createElement('pre'); b.className = 'conflict-card-text'; b.textContent = text;
    p.append(h, b);
    return p;
  };
  const panes = document.createElement('div');
  panes.className = 'conflict-card-panes';
  const ourPane = pane(t.ours, ours);
  const theirPane = pane(t.theirs, theirs);
  panes.append(ourPane, theirPane);
  const actions = document.createElement('div');
  actions.className = 'conflict-card-actions';
  // Hovering a choice lights the pane(s) it keeps and dims the rest
  const preview = (keeps) => {
    el.classList.toggle('is-choosing', keeps.length > 0);
    ourPane.classList.toggle('is-kept', keeps.includes(ourPane));
    theirPane.classList.toggle('is-kept', keeps.includes(theirPane));
  };
  const button = (label, text, keeps) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'conflict-card-btn'; btn.textContent = label; btn.cmIgnore = true;
    btn.onmouseenter = () => preview(keeps);
    btn.onmouseleave = () => preview([]);
    btn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
    btn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      choose(text);
    };
    return btn;
  };
  actions.append(
    button(t.keepOurs, ours, [ourPane]),
    button(t.keepTheirs, theirs, [theirPane]),
    button(t.keepBoth, [ours, theirs].filter(Boolean).join('\n'), [ourPane, theirPane]),
  );
  el.append(panes, actions);
  return el;
}
