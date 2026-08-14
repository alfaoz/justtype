import React, { useEffect, useRef } from 'react';
import { strings } from '../strings';
import { VERSION } from '../version';

// Chrome-style "what's new" page (/whats-new): the release notification in the
// updates panel links here. Standalone view — brings its own base styles like
// the other full-page routes. Feature rows alternate visual/text sides, each
// with a small looping CSS demo of the real thing.

const goHome = () => {
  window.history.pushState({}, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export function WhatsNew() {
  const s = strings.whatsNew;
  const d = s.demos;
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
    }, { threshold: 0.2 });
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, []);

  // One looping demo per feature, in the same order as s.features:
  // collab, version history, unpublish, markdown, new justtype.
  const visuals = [
    // 01 · collab: two people finish one sentence, on loop
    <div className="wn-frame" key="collab">
      <div className="wn-line">
        <span className="wn-type wn-cd-a">{d.collab.before}</span>
        <span className="wn-caret" data-user={s.demo.userA} style={{ background: '#4a9eff' }} />
        <span className="wn-type wn-cd-b">&nbsp;{d.collab.after}</span>
        <span className="wn-caret" data-user={s.demo.userB} style={{ background: '#3ecf8e' }} />
      </div>
      <div className="wn-presence">
        <span style={{ color: '#4a9eff' }}>●</span>&nbsp;{s.demo.userA}
        <span style={{ color: '#3ecf8e', marginLeft: '0.9rem' }}>●</span>&nbsp;{s.demo.userB}
      </div>
    </div>,

    // 02 · version history: cycling checkpoint highlight + synced preview
    <div className="wn-frame" key="history">
      <div className="wn-hist">
        <div className="wn-hist-list">
          {d.history.rows.map((row, i) => (
            <div key={row} className={`wn-hist-row wn-h${i + 1}`}>{row}</div>
          ))}
        </div>
        <div className="wn-hist-preview">
          {d.history.previews.map((p, i) => (
            <span key={p} className={`wn-hp wn-hp${i + 1}`}>{p}</span>
          ))}
        </div>
      </div>
    </div>,

    // 03 · unpublish: the public link gets struck out, private takes over
    <div className="wn-frame" key="unpublish">
      <div className="wn-unpub">
        <span className="wn-url">
          <span className="wn-url-text">{d.unpublish.url}<span className="wn-url-strike" /></span>
        </span>
        <span className="wn-private">{d.unpublish.after}</span>
      </div>
    </div>,

    // 04 · markdown: source crossfades into rendered
    <div className="wn-frame" key="markdown">
      <div className="wn-md">
        <div className="wn-md-src">
          <div>{d.markdown.srcHeading}</div>
          <div>{d.markdown.srcLine}</div>
        </div>
        <div className="wn-md-out">
          <div className="wn-md-h">{d.markdown.outHeading}</div>
          <div><b>bold</b>, <i>italic</i>, <code>code</code></div>
        </div>
      </div>
    </div>,

    // 05 · a new justtype: the wordmark types itself
    <div className="wn-frame wn-frame-center" key="brand">
      <div className="wn-brand">
        <span className="wn-brand-type">{strings.app.logo}</span>
        <span className="wn-caret" style={{ background: '#fff' }} />
      </div>
    </div>,
  ];

  return (
    <div className="min-h-screen bg-[var(--theme-bg)] text-[var(--theme-text-muted)] font-mono selection:bg-[var(--theme-border)] selection:text-white">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&display=swap');
        body { font-family: 'IBM Plex Mono', monospace; background-color: var(--theme-bg, #111111); margin: 0; }

        .wn-fade-in { animation: wnFadeIn 0.7s ease-out both; }
        @keyframes wnFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

        /* Shared demo frame */
        .wn-frame {
          border: 1px solid var(--theme-border);
          border-radius: 6px;
          background: var(--theme-bg-secondary);
          padding: 1.75rem 1.25rem 1.25rem;
          min-height: 8rem;
          display: flex;
          flex-direction: column;
          justify-content: center;
          overflow: hidden;
        }
        .wn-frame-center { align-items: center; }
        .wn-demo { border: 1px solid var(--theme-border); border-radius: 6px; background: var(--theme-bg-secondary); }
        .wn-line { display: flex; align-items: center; min-height: 2rem; color: var(--theme-text); font-size: 0.9rem; }

        /* Hero: two collaborators typing on loop */
        .wn-type { display: inline-block; overflow: hidden; white-space: nowrap; width: 0; }
        .wn-type-a { animation: wnTypeA 9s steps(17, end) infinite; }
        .wn-type-b { animation: wnTypeB 9s steps(19, end) infinite; }
        @keyframes wnTypeA { 0%, 8% { width: 0; } 34% { width: 17ch; } 94% { width: 17ch; } 100% { width: 0; } }
        @keyframes wnTypeB { 0%, 40% { width: 0; } 68% { width: 19ch; } 94% { width: 19ch; } 100% { width: 0; } }
        /* Steady bars, matching the real remote carets (they don't blink) */
        .wn-caret { position: relative; display: inline-block; width: 2px; height: 1.25em; margin-left: 1px; vertical-align: text-bottom; flex-shrink: 0; }
        .wn-caret[data-user]::after { content: attr(data-user); position: absolute; bottom: calc(100% + 4px); left: -2px; padding: 1px 5px; border-radius: 3px; font-size: 0.6rem; line-height: 1.4; color: #111; background: inherit; white-space: nowrap; }

        .wn-presence { margin-top: 0.9rem; font-size: 0.7rem; color: var(--theme-text-dim); display: flex; align-items: center; }

        /* Collab card: alfa types the opening, beta finishes the sentence */
        .wn-cd-a { animation: wnCdA 10s steps(14, end) infinite; }
        .wn-cd-b { animation: wnCdB 10s steps(12, end) infinite; }
        @keyframes wnCdA { 0%, 6% { width: 0; } 32% { width: 14ch; } 94% { width: 14ch; } 100% { width: 0; } }
        @keyframes wnCdB { 0%, 40% { width: 0; } 66% { width: 12ch; } 94% { width: 12ch; } 100% { width: 0; } }

        /* Version history: highlight walks the checkpoints, preview follows */
        .wn-hist { display: flex; gap: 1.25rem; align-items: stretch; }
        .wn-hist-list { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
        .wn-hist-row { padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; color: var(--theme-text-dim); animation: wnHistRow 9s infinite; white-space: nowrap; }
        .wn-h2 { animation-delay: 3s; }
        .wn-h3 { animation-delay: 6s; }
        @keyframes wnHistRow {
          0%, 30% { background: var(--theme-bg-tertiary); color: var(--theme-text); }
          33%, 100% { background: transparent; color: var(--theme-text-dim); }
        }
        .wn-hist-preview { position: relative; flex: 1; min-width: 0; }
        .wn-hp { position: absolute; inset: 0; display: flex; align-items: center; font-size: 0.75rem; color: var(--theme-text-muted); opacity: 0; animation: wnHp 9s infinite; }
        .wn-hp2 { animation-delay: 3s; }
        .wn-hp3 { animation-delay: 6s; }
        @keyframes wnHp { 0%, 30% { opacity: 1; } 33%, 100% { opacity: 0; } }

        /* Unpublish: strike the public link, land on private */
        .wn-unpub { position: relative; min-height: 1.6em; font-size: 0.85rem; }
        .wn-url { position: absolute; inset: 0; display: flex; align-items: center; color: var(--theme-text-muted); animation: wnUrl 8s infinite; }
        .wn-url-text { position: relative; white-space: nowrap; }
        .wn-url-strike { position: absolute; left: 0; top: 50%; height: 1px; width: 0; background: #f06878; animation: wnStrike 8s infinite; }
        .wn-private { position: absolute; inset: 0; display: flex; align-items: center; color: #3ecf8e; opacity: 0; animation: wnPrivate 8s infinite; }
        @keyframes wnUrl { 0%, 48% { opacity: 1; } 54%, 94% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes wnStrike { 0%, 32% { width: 0; } 44%, 50% { width: 100%; } 54%, 100% { width: 0; } }
        @keyframes wnPrivate { 0%, 52% { opacity: 0; } 58%, 90% { opacity: 1; } 96%, 100% { opacity: 0; } }

        /* Markdown: source crossfades into rendered */
        .wn-md { position: relative; }
        .wn-md-src, .wn-md-out { display: flex; flex-direction: column; gap: 6px; font-size: 0.8rem; color: var(--theme-text-muted); }
        .wn-md-src { animation: wnMdSrc 8s infinite; }
        .wn-md-out { position: absolute; inset: 0; justify-content: center; opacity: 0; animation: wnMdOut 8s infinite; }
        .wn-md-h { color: #fff; font-weight: 600; font-size: 1rem; }
        .wn-md-out b { color: var(--theme-text); }
        .wn-md-out code { background: var(--theme-bg-tertiary); padding: 0 4px; border-radius: 3px; font-size: 0.72rem; }
        @keyframes wnMdSrc { 0%, 42% { opacity: 1; } 50%, 92% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes wnMdOut { 0%, 46% { opacity: 0; } 54%, 88% { opacity: 1; } 96%, 100% { opacity: 0; } }

        /* Brand: the wordmark types itself */
        .wn-brand { display: flex; align-items: center; font-size: 1.3rem; font-weight: 500; color: #fff; }
        .wn-brand-type { display: inline-block; overflow: hidden; white-space: nowrap; width: 0; animation: wnBrand 7s steps(11, end) infinite; }
        @keyframes wnBrand { 0%, 10% { width: 0; } 45% { width: 11ch; } 94% { width: 11ch; } 100% { width: 0; } }

        /* Alternating feature rows: frame one side, words the other */
        .wn-row { display: flex; flex-direction: column; gap: 1.25rem; }
        @media (min-width: 768px) {
          .wn-row { flex-direction: row; align-items: center; gap: 3rem; }
          .wn-row-flip { flex-direction: row-reverse; }
          .wn-row-visual { flex: 1 1 45%; min-width: 0; }
          .wn-row-text { flex: 1 1 55%; min-width: 0; }
        }

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

      <main className="max-w-3xl mx-auto px-6 pb-24">
        {/* hero */}
        <section className="pt-16 md:pt-24 pb-16 wn-fade-in">
          <p className="text-xs tracking-widest text-[var(--theme-text-dim)] mb-4">{strings.app.logo} · {s.versionTag}</p>
          <h1 className="text-4xl md:text-5xl text-white font-medium mb-5">{s.heroTitle}</h1>
          <p className="text-sm md:text-base text-[var(--theme-text-muted)] leading-relaxed max-w-lg">{s.heroSub}</p>

          <div className="wn-demo mt-10 px-5 py-6 text-sm md:text-base text-[var(--theme-text)] max-w-xl">
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
        <section ref={listRef} className="flex flex-col gap-14 md:gap-20">
          {s.features.map((f, i) => (
            <article key={f.title} className={`wn-card wn-row ${i % 2 === 1 ? 'wn-row-flip' : ''}`}>
              <div className="wn-row-visual">{visuals[i] || null}</div>
              <div className="wn-row-text">
                <p className="text-xs text-[var(--theme-text-dim)] mb-2">{String(i + 1).padStart(2, '0')}</p>
                <h2 className="text-xl md:text-2xl text-white mb-3">{f.title}</h2>
                <p className="text-sm text-[var(--theme-text-muted)] leading-relaxed">{f.body}</p>
              </div>
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
