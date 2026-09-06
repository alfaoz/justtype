import React, { useState, useEffect } from 'react';
import pages from '../pages.json';
import { API_URL } from '../config';
import { strings } from '../strings';
import { applyThemeVariables, deviceDefaultTheme } from '../themes';
import { ErrorPage } from './ErrorPage';
import { PageHeader } from './PageHeader';

// Rendered-markdown view for slates written in the rich editor (same lazy chunk as the editor)
const MarkdownView = React.lazy(() => import('./LivePreviewEditor').then(m => ({ default: m.MarkdownView })));

export function PublicViewer() {
  const [slate, setSlate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [theme, setTheme] = useState(localStorage.getItem('justtype-theme') || deviceDefaultTheme());
  const [punto, setPunto] = useState(localStorage.getItem('justtype-punto') || 'base');
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState('plain'); // 'rich' | 'plain', defaults to the author's editor mode

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
      const pageTitle = `${ogTitle} · ${pages.brand}`;
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
      document.title = pages.home.title;
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

  // Apply the theme's CSS variables (colors + fonts) so the public page matches the app
  useEffect(() => {
    applyThemeVariables(theme);
    localStorage.setItem('justtype-theme', theme);
  }, [theme]);

  // Default the view to how the author wrote the slate
  useEffect(() => {
    if (slate) {
      setViewMode(slate.editor_mode === 'wysiwyg' ? 'rich' : 'plain');
    }
  }, [slate]);

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
      <div className="min-h-screen bg-[var(--theme-bg)] text-[var(--theme-text-muted)] flex items-center justify-center font-mono">
        <div>{strings.public.loading}</div>
      </div>
    );
  }

  if (error || !slate) {
    return (
      <ErrorPage
        code="slate not found"
        message={errorMessage || 'slate not found'}
        buttonLabel={strings.slateNotFound.button}
        onButtonClick={() => { window.location.href = '/'; }}
      />
    );
  }

  // One definition of the reader's controls, rendered twice: inline in the
  // header on desktop, as a bottom bar on mobile.
  const controlButtons = [
    { key: 'theme', label: theme, onClick: toggleTheme },
    { key: 'punto', label: getPuntoLabel(), onClick: cyclePunto },
    { key: 'view', label: strings.public.viewMode(viewMode), onClick: () => setViewMode(viewMode === 'rich' ? 'plain' : 'rich') },
    { key: 'copy', label: copied ? strings.public.copied : strings.public.copy, onClick: copyContent },
  ];

  const controls = (
    <div className="text-sm flex items-center gap-3">
      {controlButtons.map((c, i) => (
        <React.Fragment key={c.key}>
          {i > 0 && <span className="opacity-30">·</span>}
          <button onClick={c.onClick} className="opacity-60 hover:opacity-100 transition-opacity">
            {c.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-[var(--theme-bg)] text-[var(--theme-text-muted)] font-mono">
      <style>{`
        html, body { background-color: var(--theme-bg); margin: 0; padding: 0; }
        body { font-family: var(--theme-font-ui, 'IBM Plex Mono', monospace); }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: var(--theme-bg); }
        ::-webkit-scrollbar-thumb { background: var(--theme-border); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--theme-text-dim); }
      `}</style>

      {/* HEADER */}
      <PageHeader right={<div className="hidden md:flex">{controls}</div>} />

      {/* SLATE CONTENT */}
      <main className="max-w-3xl mx-auto px-6 md:px-8 py-10 md:py-12">
        <div className="mb-10 md:mb-12">
          <h1 className="text-3xl md:text-4xl text-[var(--theme-accent)] leading-tight mb-4">{slate.title}</h1>

          {/* Byline first, on its own line: it is the one fact a reader
              actually looks for. The rest is provenance, kept quieter. */}
          <div className="text-sm text-[var(--theme-text-muted)] mb-3">
            {strings.public.byAuthor(slate.author)}
            {slate.supporter_badge_visible && slate.supporter_tier && (
              <span className="text-purple-400 font-medium ml-1.5">
                [{slate.supporter_tier === 'quarterly' ? 'supporter +' : 'supporter'}]
              </span>
            )}
          </div>

          <div className="text-xs text-[var(--theme-text-dim)] flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span>{strings.public.stats.updated(formatDate(slate.updated_at))}</span>
            <span className="opacity-40">·</span>
            <span>{strings.public.stats.words(slate.word_count)}</span>
            <span className="opacity-40">·</span>
            <span>{slate.view_count || 0} {slate.view_count === 1 ? 'view' : 'views'}</span>
            <span className="opacity-40">·</span>
            <a
              href={`mailto:hi@alfaoz.dev?subject=Report slate: ${encodeURIComponent(slate.title)}&body=Share ID: ${window.location.pathname.split('/s/')[1]}%0A%0AReason for report:%0A`}
              className="hover:text-[var(--theme-accent)] transition-colors"
            >
              {strings.public.report}
            </a>
          </div>
        </div>

        {viewMode === 'rich' ? (
          <React.Suspense
            fallback={<div className={`leading-relaxed text-[var(--theme-text)] whitespace-pre-wrap punto-${punto}`}>{slate.content}</div>}
          >
            <MarkdownView content={slate.content} puntoClass={`leading-relaxed punto-${punto}`} />
          </React.Suspense>
        ) : (
          <div className={`leading-relaxed text-[var(--theme-text)] whitespace-pre-wrap punto-${punto}`}>
            {slate.content}
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="p-8 pb-24 md:pb-8 text-center border-t border-[var(--theme-border-light)] mt-16">
        <div className="text-sm opacity-50">
          created with <a href="/" className="hover:text-[var(--theme-accent)] transition-colors">just type</a>
        </div>
      </footer>

      {/* CONTROLS - a real bar on mobile, folded into the header on desktop */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--theme-bg)] border-t border-[var(--theme-border-light)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch justify-between px-2 h-12">
          {controlButtons.map((c) => (
            <button
              key={c.key}
              onClick={c.onClick}
              className="flex-1 min-w-0 text-xs text-[var(--theme-text-muted)] active:text-[var(--theme-accent)] transition-colors px-1 truncate"
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
