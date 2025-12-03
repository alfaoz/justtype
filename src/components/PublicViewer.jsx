import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

export function PublicViewer() {
  const [slate, setSlate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const shareId = window.location.pathname.split('/s/')[1];
    if (shareId) {
      loadPublicSlate(shareId);
    }
  }, []);

  const loadPublicSlate = async (shareId) => {
    try {
      const response = await fetch(`${API_URL}/public/slates/${shareId}`);
      if (!response.ok) {
        throw new Error('Slate not found or no longer published');
      }
      const data = await response.json();
      setSlate(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#111111] text-[#a0a0a0] flex items-center justify-center font-mono">
        <div>{strings.public.loading}</div>
      </div>
    );
  }

  if (error || !slate) {
    return (
      <div className="min-h-screen bg-[#111111] text-[#a0a0a0] flex items-center justify-center font-mono">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error || 'Slate not found'}</p>
          <a href="/" className="text-white hover:underline">
            go to just type
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111111] text-[#a0a0a0] font-mono">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');
        body { font-family: 'JetBrains Mono', monospace; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #111111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #555; }
      `}</style>

      {/* HEADER */}
      <header className="p-8 border-b border-[#222]">
        <a href="/" className="text-xl font-medium text-[#808080] hover:text-white transition-colors">
          + just type
        </a>
      </header>

      {/* SLATE CONTENT */}
      <main className="max-w-3xl mx-auto p-8">
        <div className="mb-8">
          <h1 className="text-3xl text-white mb-4">{slate.title}</h1>
          <div className="text-sm text-[#666] flex gap-4">
            <span>{strings.public.byAuthor(slate.author)}</span>
            <span>|</span>
            <span>{strings.public.stats.updated(formatDate(slate.updated_at))}</span>
            <span>|</span>
            <span>{strings.public.stats.words(slate.word_count)}</span>
          </div>
        </div>

        <div className="text-lg leading-relaxed text-[#d4d4d4] whitespace-pre-wrap">
          {slate.content}
        </div>
      </main>

      {/* FOOTER */}
      <footer className="p-8 text-center border-t border-[#222] mt-16">
        <div className="text-sm opacity-50">
          created with <a href="/" className="hover:text-white transition-colors">just type</a>
        </div>
      </footer>
    </div>
  );
}
