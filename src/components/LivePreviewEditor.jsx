import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
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

// Live-preview markdown editor (Typora/Obsidian-style). Same contract as the
// plain textarea: markdown string in via `content`, markdown string out via
// `onChange` — storage, encryption and export pipelines are unaffected.
const LivePreviewEditor = forwardRef(function LivePreviewEditor({ content, onChange, puntoClass = '', autofocus = false }, ref) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  useImperativeHandle(ref, () => ({ focus: () => viewRef.current?.focus() }), []);
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
          history(),
          drawSelection(),
          placeholder(strings.writer.contentPlaceholder),
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
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
    if (autofocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // External content changes (slate load, mode toggle) -> replace the doc
  useEffect(() => {
    const view = viewRef.current;
    const next = content || '';
    if (view && next !== lastContentRef.current) {
      lastContentRef.current = next;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
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
