// Live-preview markdown for CodeMirror 6 (Typora/Obsidian-style).
//
// The document stays plain markdown source. A view plugin walks the Lezer
// syntax tree and adds decorations: formatted text gets styled, and the syntax
// markers (**, #, `, ~~, link brackets) are hidden — unless the selection
// touches the enclosing element, in which case they reappear dimmed so they
// can be edited in place. This is the standard CM6 decoration technique used
// by the established live-preview implementations.

import { EditorView, Decoration } from '@codemirror/view';
import { ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

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
const QUOTE_LINE = Decoration.line({ class: 'cm-lp-quoteline' });
const HR = Decoration.mark({ class: 'cm-lp-hr' });
const TASK_MARK = Decoration.mark({ class: 'cm-lp-taskmark' });
const TABLE_HEADER = Decoration.mark({ class: 'cm-lp-tableheader' });
const TABLE_DELIM = Decoration.mark({ class: 'cm-lpmark' });

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

      const touches = (from, to) =>
        reveal && state.selection.ranges.some(r => r.from <= to && r.to >= from);

      const addLines = (from, to, deco) => {
        let line = doc.lineAt(from);
        for (;;) {
          all.push(deco.range(line.from));
          if (line.to >= to) break;
          line = doc.lineAt(line.to + 1);
        }
      };

      const hideOrDim = (from, to, revealed) => {
        if (from >= to) return;
        if (revealed) {
          all.push(MARK_DIM.range(from, to));
        } else {
          all.push(MARK_HIDE.range(from, to));
          hidden.push(MARK_HIDE.range(from, to));
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

            if (name === 'Link') {
              all.push(LINK.range(node.from, node.to));
              return;
            }

            if (name === 'HeaderMark') {
              const parent = node.node.parent;
              if (!parent) return;
              // Hide "# " including the following space; setext underlines hide whole
              let markTo = node.to;
              if (markTo < doc.length && doc.sliceString(markTo, markTo + 1) === ' ') markTo += 1;
              hideOrDim(node.from, markTo, touches(parent.from, parent.to));
              return;
            }

            if (name === 'EmphasisMark' || name === 'CodeMark' || name === 'StrikethroughMark') {
              const parent = node.node.parent;
              if (!parent) return;
              // Fenced-code fences stay visible (dimmed) so block bounds are clear
              if (parent.name === 'FencedCode' || parent.name === 'CodeBlock') {
                all.push(MARK_DIM.range(node.from, node.to));
                return;
              }
              if (!REVEAL_PARENTS.has(parent.name)) return;
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
              all.push(LIST_MARK.range(node.from, node.to));
              return;
            }

            if (name === 'FencedCode' || name === 'CodeBlock') {
              addLines(node.from, node.to, CODE_LINE);
              return;
            }

            if (name === 'Blockquote') {
              addLines(node.from, node.to, QUOTE_LINE);
              return;
            }

            if (name === 'QuoteMark') {
              all.push(MARK_DIM.range(node.from, node.to));
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

            if (name === 'Autolink') {
              all.push(LINK.range(node.from, node.to));
              return;
            }
          },
        });
      }

      this.decorations = Decoration.set(all, true);
      this.hidden = Decoration.set(hidden, true);
    }
  }, {
    decorations: v => v.decorations,
    provide: p => EditorView.atomicRanges.of(view => view.plugin(p)?.hidden ?? Decoration.none),
  });

  return plugin;
}
