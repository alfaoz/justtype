import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

export function PublicViewer() {
  const [slate, setSlate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [theme, setTheme] = useState(localStorage.getItem('justtype-theme') || 'light');
  const [punto, setPunto] = useState(localStorage.getItem('justtype-punto') || 'base');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const shareId = window.location.pathname.split('/s/')[1];
    if (shareId) {
      loadPublicSlate(shareId);
    }
  }, []);

  // Update meta tags when slate loads
  useEffect(() => {
    if (slate) {
      const maxOgTitleLength = 70;

      const ogTitle = slate.title.length > maxOgTitleLength
        ? `${slate.title.substring(0, maxOgTitleLength)}...`
        : slate.title;

      const description = `slate by ${slate.author}`;
      const pageTitle = description; // Use "slate by [user]" as page title
      const url = window.location.href;

      // Update page title
      document.title = pageTitle;

      // Helper to set meta tag
      const setMetaTag = (property, content, isProperty = false) => {
        const attribute = isProperty ? 'property' : 'name';
        let tag = document.querySelector(`meta[${attribute}="${property}"]`);
        if (!tag) {
          tag = document.createElement('meta');
          tag.setAttribute(attribute, property);
          document.head.appendChild(tag);
        }
        tag.setAttribute('content', content);
      };

      // Basic meta tags
      setMetaTag('description', description);

      // Open Graph tags
      setMetaTag('og:title', ogTitle, true);
      setMetaTag('og:description', description, true);
      setMetaTag('og:type', 'article', true);
      setMetaTag('og:url', url, true);
      setMetaTag('og:site_name', 'just type', true);

      // Twitter Card tags
      setMetaTag('twitter:card', 'summary');
      setMetaTag('twitter:title', ogTitle);
      setMetaTag('twitter:description', description);
    }

    // Cleanup: reset to default when component unmounts
    return () => {
      document.title = 'just type';
      const metaTags = ['description', 'og:title', 'og:description', 'og:type', 'og:url', 'twitter:card', 'twitter:title', 'twitter:description'];
      metaTags.forEach(tag => {
        const isOg = tag.startsWith('og:');
        const attribute = isOg ? 'property' : 'name';
        const element = document.querySelector(`meta[${attribute}="${tag}"]`);
        if (element) {
          element.remove();
        }
      });
    };
  }, [slate]);

  // Apply theme to body
  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-mode');
    } else {
      document.body.classList.remove('light-mode');
    }
    localStorage.setItem('justtype-theme', theme);

    // Cleanup on unmount
    return () => {
      document.body.classList.remove('light-mode');
    };
  }, [theme]);

  // Save punto to localStorage
  useEffect(() => {
    localStorage.setItem('justtype-punto', punto);
  }, [punto]);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const cyclePunto = () => {
    const sizes = ['small', 'base', 'large'];
    const currentIndex = sizes.indexOf(punto);
    const nextIndex = (currentIndex + 1) % sizes.length;
    setPunto(sizes[nextIndex]);
  };

  const getPuntoLabel = () => {
    switch (punto) {
      case 'small': return 'Aa−';
      case 'large': return 'Aa+';
      default: return 'Aa';
    }
  };

  const copyContent = async () => {
    if (!slate?.content) return;
    try {
      await navigator.clipboard.writeText(slate.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const loadPublicSlate = async (shareId) => {
    try {
      const response = await fetch(`${API_URL}/public/slates/${shareId}`);
      if (!response.ok) {
        // Pick a random message from the array
        const messages = strings.slateNotFound.messages;
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        setErrorMessage(randomMessage);
        throw new Error('Slate not found');
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
      <div className="h-screen bg-[#111111] text-[#a0a0a0] font-mono selection:bg-[#333333] selection:text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="text-4xl md:text-5xl text-[#333] mb-8 font-light">slate not found</div>
          <p className="text-lg md:text-xl text-[#808080] mb-8 leading-relaxed">
            {errorMessage || 'slate not found'}
          </p>
          <button
            onClick={() => window.location.href = '/'}
            className="bg-[#1a1a1a] border border-[#333] text-white px-8 py-3 rounded hover:bg-[#222] hover:border-[#444] transition-all text-sm"
          >
            {strings.slateNotFound.button}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111111] text-[#a0a0a0] font-mono">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');
        html, body { background-color: #111111; margin: 0; padding: 0; }
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
          <div className="text-sm text-[#666] flex gap-2 flex-wrap items-center">
            <span>
              {strings.public.byAuthor(slate.author)}
              {slate.supporter_badge_visible && slate.supporter_tier && (
                <span className="text-purple-400 font-medium ml-1.5">
                  [{slate.supporter_tier === 'quarterly' ? 'supporter +' : 'supporter'}]
                </span>
              )}
            </span>
            <span>|</span>
            <span>{strings.public.stats.updated(formatDate(slate.updated_at))}</span>
            <span>|</span>
            <span>{strings.public.stats.words(slate.word_count)}</span>
            <span>|</span>
            <span>{slate.view_count || 0} {slate.view_count === 1 ? 'view' : 'views'}</span>
            <span>|</span>
            <a
              href={`mailto:hi@alfaoz.dev?subject=Report slate: ${encodeURIComponent(slate.title)}&body=Share ID: ${window.location.pathname.split('/s/')[1]}%0A%0AReason for report:%0A`}
              className="text-[#666] hover:text-white transition-colors"
            >
              {strings.public.report}
            </a>
          </div>
        </div>

        <div className={`leading-relaxed text-[#d4d4d4] whitespace-pre-wrap punto-${punto}`}>
          {slate.content}
        </div>
      </main>

      {/* FOOTER */}
      <footer className="p-8 text-center border-t border-[#222] mt-16">
        <div className="text-sm opacity-50">
          created with <a href="/" className="hover:text-white transition-colors">just type</a>
        </div>
      </footer>

      {/* FIXED SETTINGS CONTROLS - bottom left */}
      <div className="fixed bottom-6 left-6 md:bottom-8 md:left-8 text-sm flex items-center gap-3 z-50">
        <button
          onClick={toggleTheme}
          className="opacity-50 hover:opacity-100 transition-opacity"
        >
          {theme}
        </button>
        <span className="opacity-30">·</span>
        <button
          onClick={cyclePunto}
          className="opacity-50 hover:opacity-100 transition-opacity"
        >
          {getPuntoLabel()}
        </button>
        <span className="opacity-30">·</span>
        <button
          onClick={copyContent}
          className="opacity-50 hover:opacity-100 transition-opacity"
        >
          {copied ? strings.public.copied : strings.public.copy}
        </button>
      </div>
    </div>
  );
}
