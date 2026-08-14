// Live-preview markdown for CodeMirror 6 (Typora/Obsidian-style).
//
// The document stays plain markdown source. A view plugin walks the Lezer
// syntax tree and adds decorations: formatted text gets styled, and the syntax
// markers (**, #, `, ~~, >, link brackets, code fences) are hidden — unless
// the selection touches the enclosing element, in which case they reappear
// dimmed so they can be edited in place. This is the standard CM6 decoration
// technique used by the established live-preview implementations.

import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import { ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

// Inline replacement for a list marker ("-" -> "•", nested "2." -> "ii.")
class TextMarkerWidget extends WidgetType {
  constructor(text, cls) { super(); this.text = text; this.cls = cls; }
  eq(other) { return other.text === this.text && other.cls === this.cls; }
  toDOM() {
    const span = document.createElement('span');
    span.className = this.cls;
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() { return false; }
}

// Per-code-block copy button, absolutely positioned in the block's first line
class CopyButtonWidget extends WidgetType {
  constructor(code) { super(); this.code = code; }
  eq(other) { return other.code === this.code; }
  toDOM() {
    const btn = document.createElement('button');
    btn.className = 'cm-lp-copy';
    btn.type = 'button';
    btn.textContent = 'copy';
    btn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard?.writeText(this.code).then(() => {
        btn.textContent = 'copied';
        setTimeout(() => { btn.textContent = 'copy'; }, 1200);
      });
    };
    return btn;
  }
  ignoreEvent() { return true; }
}

const ROMAN = [[50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function toRoman(n) {
  if (!Number.isFinite(n) || n < 1 || n > 199) return String(n);
  let out = '', rest = n;
  if (rest >= 100) { out += 'c'.repeat(Math.floor(rest / 100)); rest %= 100; }
  for (const [v, s] of ROMAN) {
    while (rest >= v) { out += s; rest -= v; }
  }
  return out;
}

const HEADING_LINE = {
  ATXHeading1: Decoration.line({ class: 'cm-lp-h1' }),
  ATXHeading2: Decoration.line({ class: 'cm-lp-h2' }),
  ATXHeading3: Decoration.line({ class: 'cm-lp-h3' }),
  ATXHeading4: Decoration.line({ class: 'cm-lp-h4' }),
  ATXHeading5: Decoration.line({ class: 'cm-lp-h5' }),
  ATXHeading6: Decoration.line({ class: 'cm-lp-h6' }),
  SetextHeading1: Decoration.line({ class: 'cm-lp-h1' }),
  SetextHeading2: Decoration.line({ class: 'cm-lp-h2' }),
};

const MARK_HIDE = Decoration.replace({});
const MARK_DIM = Decoration.mark({ class: 'cm-lpmark' });
const STRONG = Decoration.mark({ class: 'cm-lp-strong' });
const EM = Decoration.mark({ class: 'cm-lp-em' });
const STRIKE = Decoration.mark({ class: 'cm-lp-strike' });
const INLINE_CODE = Decoration.mark({ class: 'cm-lp-inlinecode' });
const LINK = Decoration.mark({ class: 'cm-lp-link' });
const LIST_MARK = Decoration.mark({ class: 'cm-lp-listmark' });
const CODE_LINE = Decoration.line({ class: 'cm-lp-codeline' });
const HR = Decoration.mark({ class: 'cm-lp-hr' });
const TASK_MARK = Decoration.mark({ class: 'cm-lp-taskmark' });
const TABLE_HEADER = Decoration.mark({ class: 'cm-lp-tableheader' });
const TABLE_DELIM = Decoration.mark({ class: 'cm-lpmark' });

// Nested blockquotes draw one bar per depth level (capped at 3)
const QUOTE_DEPTH = [
  null,
  Decoration.line({ class: 'cm-lp-quoteline cm-lp-qd1' }),
  Decoration.line({ class: 'cm-lp-quoteline cm-lp-qd2' }),
  Decoration.line({ class: 'cm-lp-quoteline cm-lp-qd3' }),
];

// Styled containers whose child marks hide/reveal as one unit
const REVEAL_PARENTS = new Set([
  'Emphasis', 'StrongEmphasis', 'InlineCode', 'Strikethrough', 'Link',
  'ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
]);

const CONTENT_STYLE = {
  StrongEmphasis: STRONG,
  Emphasis: EM,
  Strikethrough: STRIKE,
  InlineCode: INLINE_CODE,
};

// Walk up from the clicked position to find a link and extract its URL
function linkUrlAt(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, 1);
  for (let cur = node; cur; cur = cur.parent) {
    if (cur.name === 'URL' && cur.parent?.name !== 'Image') {
      return { url: state.doc.sliceString(cur.from, cur.to), from: cur.parent?.name === 'Link' ? cur.parent.from : cur.from, to: cur.parent?.name === 'Link' ? cur.parent.to : cur.to };
    }
    if (cur.name === 'Link' || cur.name === 'Autolink') {
      const urlNode = cur.getChild('URL');
      if (!urlNode) return null;
      return { url: state.doc.sliceString(urlNode.from, urlNode.to), from: cur.from, to: cur.to };
    }
  }
  return null;
}

function normalizeUrl(raw) {
  let url = raw.trim();
  if (/^www\./i.test(url)) url = 'https://' + url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

export function livePreview({ reveal = true } = {}) {
  const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.compute(view);
    }

    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.compute(update.view);
      }
    }

    compute(view) {
      const { state } = view;
      const doc = state.doc;
      const all = [];
      const hidden = [];
      const quoteLines = new Map(); // line start -> nesting depth

      const touches = (from, to) =>
        reveal && state.selection.ranges.some(r => r.from <= to && r.to >= from);

      const hideOrDim = (from, to, revealed) => {
        if (from >= to) return;
        if (revealed) {
          all.push(MARK_DIM.range(from, to));
        } else {
          all.push(MARK_HIDE.range(from, to));
          hidden.push(MARK_HIDE.range(from, to));
        }
      };

      // Extend a mark range over one trailing space (for "# " and "> ")
      const withTrailingSpace = (to) =>
        to < doc.length && doc.sliceString(to, to + 1) === ' ' ? to + 1 : to;

      const addLines = (from, to, deco) => {
        let line = doc.lineAt(from);
        for (;;) {
          all.push(deco.range(line.from));
          if (line.to >= to) break;
          line = doc.lineAt(line.to + 1);
        }
      };

      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
          from, to,
          enter: (node) => {
            const name = node.name;

            if (HEADING_LINE[name]) {
              all.push(HEADING_LINE[name].range(doc.lineAt(node.from).from));
              return;
            }

            if (CONTENT_STYLE[name]) {
              all.push(CONTENT_STYLE[name].range(node.from, node.to));
              return;
            }

            if (name === 'Link' || name === 'Autolink') {
              all.push(LINK.range(node.from, node.to));
              return;
            }

            if (name === 'HeaderMark') {
              const parent = node.node.parent;
              if (!parent) return;
              hideOrDim(node.from, withTrailingSpace(node.to), touches(parent.from, parent.to));
              return;
            }

            if (name === 'EmphasisMark' || name === 'CodeMark' || name === 'StrikethroughMark') {
              const parent = node.node.parent;
              if (!parent) return;
              // Code fences hide too, revealing when the caret is anywhere in the block
              if (parent.name === 'FencedCode' || parent.name === 'CodeBlock') {
                hideOrDim(node.from, node.to, touches(parent.from, parent.to));
                return;
              }
              if (!REVEAL_PARENTS.has(parent.name)) return;
              hideOrDim(node.from, node.to, touches(parent.from, parent.to));
              return;
            }

            if (name === 'CodeInfo') {
              const parent = node.node.parent;
              if (!parent) return;
              hideOrDim(node.from, node.to, touches(parent.from, parent.to));
              return;
            }

            if (name === 'LinkMark' || name === 'URL') {
              const parent = node.node.parent;
              if (!parent || parent.name !== 'Link') {
                // Bare/auto-linked URLs get link styling; image syntax stays raw (unsupported)
                if (name === 'URL' && parent?.name !== 'Image') all.push(LINK.range(node.from, node.to));
                return;
              }
              hideOrDim(node.from, node.to, touches(parent.from, parent.to));
              return;
            }

            if (name === 'ListMark') {
              // Active line shows the raw marker; otherwise render pretty markers:
              // bullets become • (nested ◦), nested ordered numbers go roman
              const line = doc.lineAt(node.from);
              const item = node.node.parent; // ListItem
              const list = item ? item.parent : null; // BulletList | OrderedList
              if (touches(line.from, line.to) || !list) {
                all.push(LIST_MARK.range(node.from, node.to));
                return;
              }
              let depth = 0;
              for (let a = list; a; a = a.parent) {
                if (a.name === 'BulletList' || a.name === 'OrderedList') depth++;
              }
              let replacement = null;
              if (list.name === 'BulletList') {
                replacement = depth >= 2 ? '◦' : '•';
              } else if (depth >= 2) {
                const markText = doc.sliceString(node.from, node.to);
                const n = parseInt(markText, 10);
                replacement = toRoman(n) + (markText.endsWith(')') ? ')' : '.');
              }
              if (replacement === null) {
                all.push(LIST_MARK.range(node.from, node.to));
                return;
              }
              all.push(Decoration.replace({
                widget: new TextMarkerWidget(replacement, 'cm-lp-listmark'),
              }).range(node.from, node.to));
              hidden.push(MARK_HIDE.range(node.from, node.to));
              return;
            }

            if (name === 'FencedCode' || name === 'CodeBlock') {
              addLines(node.from, node.to, CODE_LINE);
              if (name === 'FencedCode') {
                const codeChild = node.node.getChild('CodeText');
                const code = codeChild ? doc.sliceString(codeChild.from, codeChild.to) : '';
                all.push(Decoration.widget({ widget: new CopyButtonWidget(code), side: 1 }).range(node.from));
              }
              return;
            }

            if (name === 'Blockquote') {
              let line = doc.lineAt(node.from);
              for (;;) {
                quoteLines.set(line.from, (quoteLines.get(line.from) || 0) + 1);
                if (line.to >= node.to) break;
                line = doc.lineAt(line.to + 1);
              }
              return;
            }

            if (name === 'QuoteMark') {
              // The ">" hides unless the caret is on its line; nesting shows as bars
              const line = doc.lineAt(node.from);
              hideOrDim(node.from, withTrailingSpace(node.to), touches(line.from, line.to));
              return;
            }

            if (name === 'HorizontalRule') {
              all.push(HR.range(node.from, node.to));
              return;
            }

            if (name === 'TaskMarker') {
              all.push(TASK_MARK.range(node.from, node.to));
              return;
            }

            if (name === 'TableHeader') {
              all.push(TABLE_HEADER.range(node.from, node.to));
              return;
            }

            if (name === 'TableDelimiter') {
              all.push(TABLE_DELIM.range(node.from, node.to));
              return;
            }
          },
        });
      }

      for (const [lineFrom, depth] of quoteLines) {
        all.push(QUOTE_DEPTH[Math.min(depth, 3)].range(lineFrom));
      }

      this.decorations = Decoration.set(all, true);
      this.hidden = Decoration.set(hidden, true);
    }
  }, {
    decorations: v => v.decorations,
    provide: p => EditorView.atomicRanges.of(view => view.plugin(p)?.hidden ?? Decoration.none),
  });

  // Click-to-open links. In the editor: plain click opens a rendered (collapsed)
  // link; once the caret is inside (syntax revealed) clicks edit as normal, and
  // cmd/ctrl+click always opens. In read-only views every click opens.
  const clickHandler = EditorView.domEventHandlers({
    mousedown: (event, view) => {
      if (event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const link = linkUrlAt(view.state, pos);
      if (!link) return false;
      const url = normalizeUrl(link.url);
      if (!url) return false;

      const modifier = event.metaKey || event.ctrlKey;
      const revealed = reveal && view.state.selection.ranges.some(r => r.from <= link.to && r.to >= link.from);
      if (!reveal || modifier || !revealed) {
        window.open(url, '_blank', 'noopener,noreferrer');
        event.preventDefault();
        return true;
      }
      return false;
    },
  });

  return [plugin, clickHandler];
}
