import React, { useEffect, useRef } from 'react';
import { strings } from '../strings';
import { VERSION } from '../version';

// Chrome-style "what's new" page (/whats-new): the release notification in the
// updates panel links here. Standalone view — brings its own base styles like
// the other full-page routes.

const goHome = () => {
  window.history.pushState({}, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export function WhatsNew() {
  const s = strings.whatsNew;
  const listRef = useRef(null);

  // Reveal cards as they scroll into view.
  useEffect(() => {
    const cards = listRef.current ? [...listRef.current.querySelectorAll('.wn-card')] : [];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('wn-in');
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.25 });
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-[var(--theme-bg)] text-[var(--theme-text-muted)] font-mono selection:bg-[var(--theme-border)] selection:text-white">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&display=swap');
        body { font-family: 'IBM Plex Mono', monospace; background-color: var(--theme-bg, #111111); margin: 0; }

        .wn-fade-in { animation: wnFadeIn 0.7s ease-out both; }
        @keyframes wnFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

        /* Two collaborators typing in the same line, on loop */
        .wn-demo { border: 1px solid var(--theme-border); border-radius: 6px; background: var(--theme-bg-secondary); }
        .wn-line { display: flex; align-items: center; min-height: 2rem; }
        .wn-type { display: inline-block; overflow: hidden; white-space: nowrap; width: 0; }
        .wn-type-a { animation: wnTypeA 9s steps(17, end) infinite; }
        .wn-type-b { animation: wnTypeB 9s steps(19, end) infinite; }
        @keyframes wnTypeA { 0%, 8% { width: 0; } 34% { width: 17ch; } 94% { width: 17ch; } 100% { width: 0; } }
        @keyframes wnTypeB { 0%, 40% { width: 0; } 68% { width: 19ch; } 94% { width: 19ch; } 100% { width: 0; } }
        .wn-caret { position: relative; display: inline-block; width: 2px; height: 1.25em; margin-left: 1px; vertical-align: text-bottom; animation: wnBlink 1.1s step-end infinite; }
        @keyframes wnBlink { 0%, 60% { opacity: 1; } 61%, 100% { opacity: 0; } }
        .wn-caret::after { content: attr(data-user); position: absolute; bottom: calc(100% + 4px); left: -2px; padding: 1px 5px; border-radius: 3px; font-size: 0.6rem; line-height: 1.4; color: #111; background: inherit; white-space: nowrap; }

        .wn-card { opacity: 0; transform: translateY(16px); transition: opacity 0.55s ease, transform 0.55s ease; }
        .wn-card.wn-in { opacity: 1; transform: none; }
      `}</style>

      {/* header */}
      <header className="p-4 md:p-8 flex justify-between items-center border-b border-[var(--theme-border-light)]">
        <button type="button" onClick={goHome} className="text-lg md:text-xl font-medium text-[var(--theme-text-muted)] hover:text-white transition-colors select-none">
          {strings.app.logo}
        </button>
        <span className="text-xs text-[var(--theme-text-dim)]">{s.pageTitle}</span>
      </header>

      <main className="max-w-2xl mx-auto px-6 pb-24">
        {/* hero */}
        <section className="pt-16 md:pt-24 pb-14 wn-fade-in">
          <p className="text-xs tracking-widest text-[var(--theme-text-dim)] mb-4">{strings.app.logo} · {s.versionTag}</p>
          <h1 className="text-4xl md:text-5xl text-white font-medium mb-5">{s.heroTitle}</h1>
          <p className="text-sm md:text-base text-[var(--theme-text-muted)] leading-relaxed max-w-lg">{s.heroSub}</p>

          <div className="wn-demo mt-10 px-5 py-6 text-sm md:text-base text-[var(--theme-text)]">
            <div className="wn-line">
              <span className="wn-type wn-type-a">{s.demo.lineA}</span>
              <span className="wn-caret" data-user={s.demo.userA} style={{ background: '#4a9eff' }} />
            </div>
            <div className="wn-line">
              <span className="wn-type wn-type-b">{s.demo.lineB}</span>
              <span className="wn-caret" data-user={s.demo.userB} style={{ background: '#3ecf8e' }} />
            </div>
          </div>
        </section>

        {/* features */}
        <section ref={listRef} className="flex flex-col gap-12 md:gap-16">
          {s.features.map((f, i) => (
            <article key={f.title} className="wn-card">
              <p className="text-xs text-[var(--theme-text-dim)] mb-2">{String(i + 1).padStart(2, '0')}</p>
              <h2 className="text-xl md:text-2xl text-white mb-3">{f.title}</h2>
              <p className="text-sm text-[var(--theme-text-muted)] leading-relaxed max-w-lg">{f.body}</p>
            </article>
          ))}
        </section>

        {/* footer */}
        <div className="mt-20 pt-8 border-t border-[var(--theme-border-light)] flex items-center justify-between">
          <button type="button" onClick={goHome} className="text-sm text-[var(--theme-text-muted)] hover:text-white transition-colors">
            {s.backLink} →
          </button>
          <span className="text-xs text-[var(--theme-text-dim)]">{VERSION}</span>
        </div>
      </main>
    </div>
  );
}
