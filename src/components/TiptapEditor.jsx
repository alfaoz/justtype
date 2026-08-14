import React, { useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';

// Shared extension set: markdown-representable nodes/marks only, so the
// serialized markdown string stays the single source of truth for storage,
// export, publishing, and (later) collab.
const buildExtensions = () => [
  StarterKit.configure({
    // Keep only what round-trips cleanly through markdown
    underline: false,
  }),
  Markdown,
];

// WYSIWYG editor over a markdown string. Contract mirrors the plain textarea:
// markdown string in via `content`, markdown string out via `onChange`.
export default function TiptapEditor({ content, onChange, puntoClass = '', autofocus = false }) {
  // Tracks the last markdown we emitted (or received) to break update loops
  const lastMarkdownRef = useRef(content || '');

  const editor = useEditor({
    extensions: buildExtensions(),
    content: content || '',
    contentType: 'markdown',
    autofocus: autofocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'wysiwyg-surface',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
      if (md !== lastMarkdownRef.current) {
        lastMarkdownRef.current = md;
        onChange(md);
      }
    },
  });

  // External content changes (slate load, mode toggle) -> reset editor
  useEffect(() => {
    if (!editor) return;
    const next = content || '';
    if (next !== lastMarkdownRef.current) {
      lastMarkdownRef.current = next;
      editor.commands.setContent(next, { contentType: 'markdown' });
    }
  }, [content, editor]);

  return (
    <div className={`wysiwyg-editor w-full max-w-3xl resize-none p-8 ${puntoClass}`}>
      <EditorContent editor={editor} />
    </div>
  );
}

// Read-only markdown renderer (public viewer for wysiwyg slates). Lives in the
// same lazy chunk as the editor so it costs nothing extra.
export function MarkdownView({ content, puntoClass = '' }) {
  const editor = useEditor({
    extensions: buildExtensions(),
    content: content || '',
    contentType: 'markdown',
    editable: false,
  });

  return (
    <div className={`wysiwyg-editor wysiwyg-readonly w-full ${puntoClass}`}>
      <EditorContent editor={editor} />
    </div>
  );
}
