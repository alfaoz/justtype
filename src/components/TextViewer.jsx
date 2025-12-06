import React, { useState, useEffect } from 'react';

export function TextViewer({ file, title }) {
  const [content, setContent] = useState('Loading...');

  useEffect(() => {
    fetch(`/${file}`)
      .then(res => res.text())
      .then(text => setContent(text))
      .catch(() => setContent('Failed to load content'));
  }, [file]);

  return (
    <div className="h-full overflow-y-auto bg-[#111111]">
      <div className="max-w-3xl mx-auto p-8">
        <div className="mb-8">
          <a href="/" className="text-[#666] hover:text-white transition-colors">
            ← back to justtype
          </a>
        </div>
        <h1 className="text-2xl text-white mb-6">{title}</h1>
        <pre className="text-sm text-white whitespace-pre-wrap font-mono leading-relaxed">
          {content}
        </pre>
      </div>
    </div>
  );
}
