import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { EditorView, keymap, placeholder, drawSelection, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { markdownKeymap } from '@codemirror/lang-markdown';
import { livePreview, richMarkdown } from './livePreview';
import { strings } from '../strings';

// Shared extensions: GFM markdown (headings, emphasis, strikethrough, code,
// quotes, links, lists, task lists, tables, hr, dollar math — no images/mermaid by design)
const baseExtensions = ({ reveal }) => [
  richMarkdown(),
  livePreview({ reveal }),
  EditorView.lineWrapping,
  indentUnit.of('    '),
];

// Focus with the caret at the end of the document, where typing continues.
// A fresh view's selection sits at 0, so a bare focus() lands on the first
// letter of a restored draft.
const focusEnd = (view) => {
  const end = view.state.doc.length;
  view.dispatch({ selection: { anchor: end }, scrollIntoView: true });
  view.focus();
};

// Live-preview markdown editor (Typora/Obsidian-style). Same contract as the
// plain textarea: markdown string in via `content`, markdown string out via
// `onChange` — storage, encryption and export pipelines are unaffected.
// With `centerCaret` the line being typed is kept in the middle of the
// scroller; `initialSelection` / setNextSelection place the caret when the
// document is next replaced (a slate opening where it was left)
const centering = new Compartment();
const editing = new Compartment();
const editable = (readOnly) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
const keepCentered = (viewRef) => EditorView.updateListener.of((u) => {
  if (!(u.selectionSet || u.docChanged)) return;
  const head = u.state.selection.main.head;
  requestAnimationFrame(() => {
    const v = viewRef.current;
    if (v && v.state.selection.main.head === head) v.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
  });
});
const clampSel = (sel, len) => (sel && Number.isFinite(sel.anchor)
  ? { anchor: Math.min(Math.max(0, sel.anchor), len), head: Math.min(Math.max(0, sel.head ?? sel.anchor), len) }
  : { anchor: len });

const LivePreviewEditor = forwardRef(function LivePreviewEditor({ content, onChange, puntoClass = '', autofocus = false, centerCaret = false, initialSelection = null, readOnly = false }, ref) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const nextSelRef = useRef(initialSelection);
  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current && focusEnd(viewRef.current),
    getSelection: () => {
      const v = viewRef.current;
      if (!v) return null;
      const m = v.state.selection.main;
      return { anchor: m.anchor, head: m.head };
    },
    setNextSelection: (sel) => { nextSelRef.current = sel; },
    setSelection: (sel) => {
      const v = viewRef.current;
      if (!v) return;
      v.dispatch({ selection: clampSel(sel, v.state.doc.length), scrollIntoView: true });
    },
  }), []);
  const lastContentRef = useRef(content || '');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: lastContentRef.current,
        extensions: [
          ...baseExtensions({ reveal: true }),
          highlightActiveLine(), // marks the caret's line for line focus (index.css)
          history(),
          drawSelection(),
          placeholder(strings.writer.contentPlaceholder),
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
          centering.of(centerCaret ? keepCentered(viewRef) : []),
          editing.of(editable(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const md = update.state.doc.toString();
              lastContentRef.current = md;
              onChangeRef.current(md);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (nextSelRef.current) {
      view.dispatch({ selection: clampSel(nextSelRef.current, view.state.doc.length) });
      nextSelRef.current = null;
    }
    if (autofocus) focusEnd(view);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Caret centring follows the device setting without a remount
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: centering.reconfigure(centerCaret ? keepCentered(viewRef) : []) });
  }, [centerCaret]);
  // A slate in the trash is read, not written, until it is restored
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: editing.reconfigure(editable(readOnly)) });
  }, [readOnly]);

  // External content changes (slate load, mode toggle) -> replace the doc,
  // the caret where it was asked to go, else at the end
  useEffect(() => {
    const view = viewRef.current;
    const next = content || '';
    if (view && next !== lastContentRef.current) {
      lastContentRef.current = next;
      const sel = nextSelRef.current;
      nextSelRef.current = null;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: clampSel(sel, next.length),
      });
    }
  }, [content]);

  return (
    <div
      ref={containerRef}
      className={`wysiwyg-editor w-full max-w-3xl p-8 ${puntoClass}`}
    />
  );
});

export default LivePreviewEditor;

// Read-only rendered view (public pages for rich slates). Syntax is always
// hidden since there is no caret to reveal it for.
export function MarkdownView({ content, puntoClass = '' }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const view = new EditorView({
      parent: containerRef.current,
      state: EditorState.create({
        doc: content || '',
        extensions: [
          ...baseExtensions({ reveal: false }),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
    });
    return () => view.destroy();
  }, [content]);

  return (
    <div ref={containerRef} className={`wysiwyg-editor wysiwyg-readonly w-full ${puntoClass}`} />
  );
}
