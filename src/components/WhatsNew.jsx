import React, { useEffect, useRef, useState } from 'react';
import { TextMorph } from './TextMorph';
import { PageHeader } from './PageHeader';
import { HoverNote } from './HoverNote';
import { MarkGlyph } from './MarkGlyph';
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

// A phase counter that walks `delays` (ms per phase) and starts over
function useLoop(delays) {
  const [k, setK] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setK((k + 1) % delays.length), delays[k]);
    return () => clearTimeout(t);
  }, [k, delays]);
  return k;
}

// Math: someone types the formula. The editor closes each pair as it opens,
// so `$$` and `{}` land whole, as plain text. Then the source
// gives way to the set formula, holds, and the frame empties for the next go.
function MathDemo({ steps }) {
  const n = steps.length;
  const delays = useRef([...steps.map((_, i) => (i === n - 1 ? 1500 : i === 0 ? 700 : 150)), 2800, 900]).current;
  const k = useLoop(delays);
  const text = k < n ? steps[k] : k === n ? steps[n - 1] : '';
  const set = k === n;
  return (
    <div className="wn-math">
      <span className="wn-math-src" style={{ opacity: set ? 0 : 1 }}>{text}</span>
      <span className="wn-math-out" style={{ opacity: set ? 1 : 0 }}><i>e</i><sup><i>i</i>π</sup> + 1 = 0</span>
    </div>
  );
}

// Content search: the word is typed into the box and this device answers
// with the slates that hold it, snippet and all
function SearchDemo({ demo }) {
  const n = demo.steps.length;
  const delays = useRef([...demo.steps.map((_, i) => (i === n - 1 ? 600 : 170)), 3200, 900]).current;
  const k = useLoop(delays);
  const query = k < n ? demo.steps[k] : k === n ? demo.steps[n - 1] : '';
  const hits = k === n;
  const word = demo.steps[n - 1];
  const mark = (text) => {
    const at = text.indexOf(word);
    if (at < 0) return text;
    return <>{text.slice(0, at)}<b>{text.slice(at, at + word.length)}</b>{text.slice(at + word.length)}</>;
  };
  return (
    <div className="wn-search">
      <div className="wn-search-box">
        {query}<span className="wn-search-caret" />
      </div>
      <div className="wn-hits">
        {demo.hits.map((h) => (
          <div key={h.title} className="wn-hit" style={{ opacity: hits ? 1 : 0, transform: hits ? 'none' : 'translateY(4px)' }}>
            <span className="wn-hit-title">{h.title}</span>
            <span className="wn-hit-snippet">{mark(h.snippet)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

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

  // An option row as the account draws it: label, words, one underline
  const optionRow = (label, words, r) => (
    <div key={label} className="wn-opt">
      <span className="wn-opt-label">{label}</span>
      <span className="wn-opt-words">
        {words.map((w, i) => <span key={w} className={`wn-opt-w wn-opt-w-${r}-${i}`}>{w}</span>)}
        <i className={`wn-opt-bar wn-opt-bar-${r}`} />
      </span>
    </div>
  );

  // One looping demo per feature, keyed by the feature's `id` so the copy in
  // strings.js can be reordered freely without silently pairing the wrong demo
  // with the wrong paragraph.
  const visuals = {
    collab: (
    <div className="wn-frame" key="collab">
      <div className="wn-line">
        <span className="wn-type wn-type-a">{s.demo.lineA}</span>
        <span className="wn-caret" data-user={s.demo.userA} style={{ background: '#4a9eff' }} />
      </div>
      <div className="wn-line">
        <span className="wn-type wn-type-b">{s.demo.lineB}</span>
        <span className="wn-caret" data-user={s.demo.userB} style={{ background: '#3ecf8e' }} />
      </div>
    </div>
    ),

    history: (
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
    </div>
    ),

    unpublish: (
    <div className="wn-frame" key="unpublish">
      <div className="wn-unpub">
        <span className="wn-url">
          <span className="wn-url-text">{d.unpublish.url}<span className="wn-url-strike" /></span>
        </span>
        <span className="wn-private">{d.unpublish.after}</span>
      </div>
    </div>
    ),

    markdown: (
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
    </div>
    ),

    brand: (
    <div className="wn-frame wn-frame-center" key="brand">
      <div className="wn-brand">
        <span className="wn-brand-type">{strings.app.logo}</span>
        <span className="wn-caret" style={{ background: 'var(--theme-accent)' }} />
      </div>
    </div>
    ),

    // Lock: the stars fill one by one, then the word turns
    lock: (
    <div className="wn-frame wn-frame-center" key="lock">
      <div className="wn-lock">
        <div className="wn-lock-stars">
          {Array.from({ length: d.lock.stars }, (_, i) => (
            <span key={i} className="wn-star" style={{ animationDelay: `${i * 0.35}s` }}>*</span>
          ))}
        </div>
        <div className="wn-lock-status">
          <span className="wn-lock-a">{d.lock.before}</span>
          <span className="wn-lock-b">{d.lock.after}</span>
        </div>
      </div>
    </div>
    ),

    math: (
    <div className="wn-frame wn-frame-center" key="math">
      <MathDemo steps={d.math.steps} />
    </div>
    ),

    // Accessibility: three option rows, one underline each, gliding
    a11y: (
    <div className="wn-frame" key="a11y">
      <div className="wn-opts">
        {d.a11y.rows.map(([label, words], r) => optionRow(label, words, r))}
      </div>
    </div>
    ),

    // Private links: the share panel's link row reaches `private`, and the
    // address shows its key after the hash
    share: (
    <div className="wn-frame" key="share">
      <div className="wn-opts">
        {optionRow(d.share.label, d.share.words, 'share')}
        <div className="wn-share-url">{d.share.url}<span className="wn-share-key">{d.share.key}</span></div>
      </div>
    </div>
    ),

    // Trash: a row is struck through, squished away, and the word nods
    trash: (
    <div className="wn-frame" key="trash">
      <div className="wn-trash">
        <div className="wn-trash-show"><span>archived</span><span className="wn-trash-word">trash</span></div>
        <div className="wn-trash-rows">
          {d.trash.slates.map((t, i) => (
            <div key={t} className={`wn-trash-row ${i === d.trash.gone ? 'wn-trash-gone' : ''}`}>
              <span className="wn-trash-title">{t}<i className="wn-trash-line" /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
    ),

    search: (
    <div className="wn-frame wn-frame-list" key="search">
      <SearchDemo demo={d.search} />
    </div>
    ),

    // Offline: the real list, marks only. Copies land on their own, cloud by
    // cloud; then one slate is written while offline, waits orange, spins,
    // lands green and settles.
    offline: (
    <div className="wn-frame wn-frame-list" key="offline">
      <div className="wn-slates">
        {d.offline.slates.map((title, i) => (
          <div key={title} className="wn-slate">
            <span className="wn-slate-title">{title}</span>
            <span className="wn-slate-meta">
              <span className={`wn-mark wn-mark-${i + 1}`}>
                <span className="wn-mk wn-mk-cloud"><MarkGlyph kind="cloud" /></span>
                <span className="wn-mk wn-mk-check"><MarkGlyph kind="check" /></span>
                {i === d.offline.written && (
                  <>
                    <span className="wn-mk wn-mk-alert"><MarkGlyph kind="alert" /></span>
                    <span className="wn-mk wn-mk-spin"><MarkGlyph kind="spin" className="mark-spin" /></span>
                    <span className="wn-mk wn-mk-green"><MarkGlyph kind="check" /></span>
                  </>
                )}
              </span>
              <span>{strings.slates.status.private}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
    ),
  };

  // Offline demo timeline, in percent of one 12s loop. Each row's copy lands
  // at its own moment (cloud out, check in); the written row then goes orange
  // at 40%, spins at 60%, pops green at 70% and settles dim at 86%. The list
  // dips out at the end so the marks reset out of sight.
  const offlineCss = d.offline.slates.map((_, i) => {
    const t = 8 + i * 4;
    const n = i + 1;
    const check = i === d.offline.written
      ? `0%, ${t}% { opacity: 0; } ${t + 2}%, 40% { opacity: 0.7; } 42%, 84% { opacity: 0; } 86%, 96% { opacity: 0.7; } 98%, 100% { opacity: 0; }`
      : `0%, ${t}% { opacity: 0; } ${t + 2}%, 96% { opacity: 0.7; } 98%, 100% { opacity: 0; }`;
    return `
        .wn-mark-${n} .wn-mk-cloud { animation: wnCloud${n} 12s infinite; }
        .wn-mark-${n} .wn-mk-check { animation: wnCheck${n} 12s infinite; }
        @keyframes wnCloud${n} { 0%, ${t}% { opacity: 1; } ${t + 2}%, 96% { opacity: 0; } 98%, 100% { opacity: 1; } }
        @keyframes wnCheck${n} { ${check} }`;
  }).join('');

  // An option row's underline walks its words on a 9s loop: word widths are
  // 1ch a letter (monospace), gaps 0.75rem. `r` names the row's classes.
  const walk = (words, r, delay) => {
    const stops = words.map((_, i) => {
      const before = words.slice(0, i).reduce((n, w) => n + w.length, 0);
      return { left: `calc(${before}ch + ${i * 0.75}rem)`, width: `${words[i].length}ch` };
    });
    const n = stops.length;
    const frames = stops.map((st, i) => {
      const a = Math.round((i / n) * 100);
      const b = Math.round(((i + 1) / n) * 100) - 6;
      return `${a}%, ${b}% { left: ${st.left}; width: ${st.width}; }`;
    }).join(' ') + ` 100% { left: ${stops[0].left}; width: ${stops[0].width}; }`;
    const lit = stops.map((_, i) => {
      const a = Math.round((i / n) * 100);
      const b = Math.round(((i + 1) / n) * 100) - 6;
      return `.wn-opt-w-${r}-${i} { animation: wnOptW${r}${i} 9s infinite; animation-delay: ${delay}s; }
        @keyframes wnOptW${r}${i} { 0%, 100% { color: var(--theme-text-dim); } ${a}%, ${b}% { color: var(--theme-text); } }`;
    }).join('');
    return `
        .wn-opt-bar-${r} { animation: wnOptBar${r} 9s cubic-bezier(0.4, 0, 0.2, 1) infinite; animation-delay: ${delay}s; }
        @keyframes wnOptBar${r} { ${frames} }
        ${lit}`;
  };
  const a11yCss = d.a11y.rows.map(([, words], r) => walk(words, r, r * 0.6)).join('');
  const shareCss = walk(d.share.words, 'share', 0);

  return (
    <div className="min-h-screen bg-[var(--theme-bg)] text-[var(--theme-text-muted)] font-mono selection:bg-[var(--theme-border)] selection:text-white">
      <style>{`
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
        .wn-line { display: flex; align-items: center; min-height: 2rem; color: var(--theme-text); font-size: 0.9rem; }

        /* Collab card: two collaborators typing on loop */
        .wn-type { display: inline-block; overflow: hidden; white-space: nowrap; width: 0; }
        /* Step count and end width are derived from the copy: hardcoding them
           silently truncates the line the moment the demo text changes. */
        .wn-type-a { animation: wnTypeA 9s steps(${s.demo.lineA.length}, end) infinite; }
        .wn-type-b { animation: wnTypeB 9s steps(${s.demo.lineB.length}, end) infinite; }
        @keyframes wnTypeA { 0%, 8% { width: 0; } 34% { width: ${s.demo.lineA.length}ch; } 94% { width: ${s.demo.lineA.length}ch; } 100% { width: 0; } }
        @keyframes wnTypeB { 0%, 40% { width: 0; } 68% { width: ${s.demo.lineB.length}ch; } 94% { width: ${s.demo.lineB.length}ch; } 100% { width: 0; } }
        /* Steady bars, matching the real remote carets (they don't blink) */
        .wn-caret { position: relative; display: inline-block; width: 2px; height: 1.25em; margin-left: 1px; vertical-align: text-bottom; flex-shrink: 0; }
        .wn-caret[data-user]::after { content: attr(data-user); position: absolute; bottom: calc(100% + 4px); left: -2px; padding: 1px 5px; border-radius: 3px; font-size: 0.6rem; line-height: 1.4; color: #111; background: inherit; white-space: nowrap; }


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
        .wn-url-strike { position: absolute; left: 0; top: 50%; height: 1px; width: 0; background: var(--theme-red); animation: wnStrike 8s infinite; }
        .wn-private { position: absolute; inset: 0; display: flex; align-items: center; color: var(--theme-green); opacity: 0; animation: wnPrivate 8s infinite; }
        @keyframes wnUrl { 0%, 48% { opacity: 1; } 54%, 94% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes wnStrike { 0%, 32% { width: 0; } 44%, 50% { width: 100%; } 54%, 100% { width: 0; } }
        @keyframes wnPrivate { 0%, 52% { opacity: 0; } 58%, 90% { opacity: 1; } 96%, 100% { opacity: 0; } }

        /* Markdown: source crossfades into rendered */
        .wn-md { position: relative; }
        .wn-md-src, .wn-md-out { display: flex; flex-direction: column; gap: 6px; font-size: 0.8rem; color: var(--theme-text-muted); }
        .wn-md-src { animation: wnMdSrc 8s infinite; }
        .wn-md-out { position: absolute; inset: 0; justify-content: center; opacity: 0; animation: wnMdOut 8s infinite; }
        .wn-md-h { color: var(--theme-accent); font-weight: 600; font-size: 1rem; }
        .wn-md-out b { color: var(--theme-text); }
        .wn-md-out code { background: var(--theme-bg-tertiary); padding: 0 4px; border-radius: 3px; font-size: 0.72rem; }
        @keyframes wnMdSrc { 0%, 42% { opacity: 1; } 50%, 92% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes wnMdOut { 0%, 46% { opacity: 0; } 54%, 88% { opacity: 1; } 96%, 100% { opacity: 0; } }

        /* Brand: the wordmark types itself */
        .wn-brand { display: flex; align-items: center; font-size: 1.3rem; font-weight: 500; color: var(--theme-accent); }
        .wn-brand-type { display: inline-block; overflow: hidden; white-space: nowrap; width: 0; animation: wnBrand 7s steps(11, end) infinite; }
        @keyframes wnBrand { 0%, 10% { width: 0; } 45% { width: 11ch; } 94% { width: 11ch; } 100% { width: 0; } }

        /* Offline: the slate list as the list draws it, marks stacked in one
           cell and crossfaded on the timeline in offlineCss */
        .wn-frame-list { padding: 1rem 1.25rem; }
        .wn-slates { display: flex; flex-direction: column; font-size: 0.75rem; animation: wnSlates 12s infinite; }
        @keyframes wnSlates { 0%, 93% { opacity: 1; } 95%, 98% { opacity: 0; } 100% { opacity: 1; } }
        .wn-slate { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.45rem 0; border-top: 1px solid var(--theme-border-light); }
        .wn-slate:first-child { border-top: 0; }
        .wn-slate-title { color: var(--theme-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .wn-slate-meta { display: flex; align-items: center; gap: 0.6rem; color: var(--theme-text-dim); flex-shrink: 0; }
        .wn-mark { position: relative; display: inline-block; width: 1em; height: 1em; }
        .wn-mk { position: absolute; inset: 0; opacity: 0; transform-origin: center; }
        .wn-mk svg { width: 100%; height: 100%; display: block; }
        .wn-mk-alert, .wn-mk-spin { color: var(--theme-orange); }
        .wn-mk-green { color: var(--theme-green); }
        .wn-mk-alert { animation: wnMkAlert 12s infinite; }
        .wn-mk-spin { animation: wnMkSpin 12s infinite; }
        .wn-mk-green { animation: wnMkGreen 12s infinite; }
        @keyframes wnMkAlert { 0%, 40% { opacity: 0; } 42%, 58% { opacity: 1; } 60%, 100% { opacity: 0; } }
        @keyframes wnMkSpin { 0%, 58% { opacity: 0; } 60%, 68% { opacity: 1; } 70%, 100% { opacity: 0; } }
        @keyframes wnMkGreen {
          0%, 68% { opacity: 0; transform: scale(0.4); }
          70% { opacity: 1; transform: scale(1.35); }
          72%, 82% { opacity: 1; transform: scale(1); }
          84%, 100% { opacity: 0; transform: scale(1); }
        }
        ${offlineCss}

        /* Lock: stars brighten in turn (delays inline), the word turns after */
        .wn-lock { display: flex; flex-direction: column; align-items: center; gap: 0.9rem; }
        .wn-lock-stars { display: flex; gap: 0.6rem; font-size: 1.4rem; line-height: 1; }
        .wn-star { color: var(--theme-text-dim); opacity: 0.3; animation: wnStar 8s infinite; }
        @keyframes wnStar { 0%, 6% { opacity: 0.3; color: var(--theme-text-dim); } 10%, 86% { opacity: 1; color: var(--theme-accent); } 92%, 100% { opacity: 0.3; color: var(--theme-text-dim); } }
        .wn-lock-status { position: relative; font-size: 0.8rem; min-width: 5em; text-align: center; color: var(--theme-text-muted); }
        .wn-lock-a, .wn-lock-b { position: absolute; left: 0; right: 0; }
        .wn-lock-a { animation: wnLockA 8s infinite; }
        .wn-lock-b { opacity: 0; animation: wnLockB 8s infinite; }
        @keyframes wnLockA { 0%, 44% { opacity: 1; } 50%, 92% { opacity: 0; } 98%, 100% { opacity: 1; } }
        @keyframes wnLockB { 0%, 48% { opacity: 0; } 54%, 88% { opacity: 1; } 94%, 100% { opacity: 0; } }

        /* Math: typed source, then the set formula (MathDemo drives the swap) */
        .wn-math { position: relative; min-height: 2.2em; display: flex; align-items: center; justify-content: center; font-size: 0.95rem; }
        .wn-math-src { color: var(--theme-text-muted); white-space: pre; transition: opacity 400ms ease; }
        .wn-math-out { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--theme-text); font-family: 'KaTeX_Main', 'Times New Roman', Times, serif; font-size: 1.35rem; white-space: nowrap; transition: opacity 400ms ease; }
        .wn-math-out sup { font-size: 0.7em; margin-left: 1px; }

        /* Accessibility: the account rows, underline on the move */
        .wn-opts { display: flex; flex-direction: column; font-size: 0.75rem; }
        .wn-opt { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.55rem 0; border-top: 1px solid var(--theme-border-light); }
        .wn-opt:first-child { border-top: 0; }
        .wn-opt-label { color: var(--theme-text-dim); }
        .wn-opt-words { position: relative; display: flex; gap: 0.75rem; }
        .wn-opt-w { color: var(--theme-text-dim); transition: color 300ms; }
        .wn-opt-bar { position: absolute; bottom: -3px; height: 1px; background: var(--theme-accent); }
        ${a11yCss}

        /* Private links: the address appears while the underline rests on private */
        ${shareCss}
        .wn-share-url { padding-top: 0.75rem; font-size: 0.75rem; color: var(--theme-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; animation: wnShareUrl 9s infinite; }
        .wn-share-key { color: var(--theme-accent); }
        @keyframes wnShareUrl { 0%, 68% { opacity: 0; } 74%, 92% { opacity: 1; } 97%, 100% { opacity: 0; } }

        /* Trash: the red line draws like a pencil, the row is squished from the top, the word nods */
        .wn-trash { display: flex; flex-direction: column; font-size: 0.8rem; }
        /* The show line sits on top and the rows' box keeps its height, so nothing moves when a row goes */
        .wn-trash-rows { height: calc(3 * 2.2em); }
        .wn-trash-row { height: 2.2em; padding: 0.5rem 0; box-sizing: border-box; border-bottom: 1px solid var(--theme-border-light); color: var(--theme-text); overflow: hidden; transform-origin: center top; }
        .wn-trash-title { position: relative; display: inline-block; }
        .wn-trash-line { position: absolute; left: 0; right: 0; top: 50%; height: 1.5px; background: var(--theme-red); transform: scaleX(0); transform-origin: left center; }
        .wn-trash-gone { animation: wnTrashRow 9s infinite; }
        .wn-trash-gone .wn-trash-title { animation: wnTrashDim 9s infinite; }
        .wn-trash-gone .wn-trash-line { animation: wnTrashLine 9s cubic-bezier(0.55, 0.05, 0.25, 1) infinite; }
        @keyframes wnTrashLine { 0%, 20% { transform: scaleX(0); } 28%, 40% { transform: scaleX(1); } 40.1%, 100% { transform: scaleX(0); } }
        @keyframes wnTrashDim { 0%, 20% { opacity: 1; } 28%, 40% { opacity: 0.6; } 40.1%, 100% { opacity: 1; } }
        @keyframes wnTrashRow { 0%, 36% { height: 2.2em; padding: 0.5rem 0; transform: scaleY(1); opacity: 1; } 39%, 88% { height: 0; padding: 0; border-bottom-width: 0; transform: scaleY(0); opacity: 0; } 93%, 100% { height: 2.2em; padding: 0.5rem 0; transform: scaleY(1); opacity: 1; } }
        .wn-trash-show { display: flex; justify-content: flex-end; gap: 0.75rem; padding-bottom: 0.6rem; font-size: 0.75rem; color: var(--theme-text-dim); }
        .wn-trash-word { color: var(--theme-red); display: inline-block; animation: wnTrashNod 9s infinite; }
        @keyframes wnTrashNod { 0%, 36% { transform: none; } 37.5% { transform: translateY(-4px); } 39%, 100% { transform: none; } }

        /* Content search: the box, the hits, the deeper line (SearchDemo drives it) */
        .wn-search { display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.75rem; }
        .wn-search-box { display: flex; align-items: center; min-height: 2rem; padding: 0 0.75rem; border: 1px solid var(--theme-border); border-radius: 4px; background: var(--theme-bg); color: var(--theme-text); white-space: pre; }
        .wn-search-caret { display: inline-block; width: 1px; height: 1.1em; margin-left: 1px; background: var(--theme-text); animation: wnBlink 1s steps(1) infinite; }
        @keyframes wnBlink { 50% { opacity: 0; } }
        .wn-hits { display: flex; flex-direction: column; gap: 0.35rem; min-height: 2.6rem; }
        .wn-hit { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; transition: opacity 350ms ease, transform 350ms ease; }
        .wn-hit-title { color: var(--theme-text); white-space: nowrap; }
        .wn-hit-snippet { color: var(--theme-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .wn-hit-snippet b { color: var(--theme-text); font-weight: 500; }

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
      <PageHeader label={s.pageTitle} onHome={goHome} />

      <main className="max-w-3xl mx-auto px-6 pb-24">
        {/* hero */}
        <section className="pt-16 md:pt-28 pb-16 md:pb-20 wn-fade-in">
          <p className="text-base md:text-lg text-[var(--theme-accent)] mb-4 md:mb-6">{s.heroEyebrow}</p>
          <h1 className="text-5xl md:text-7xl text-white font-medium leading-[1.05] tracking-tight mb-6 md:mb-8">
            {s.heroTitle.split('. ').map((part, i, arr) => (
              <span key={part} className="block">{i < arr.length - 1 ? `${part}.` : part}</span>
            ))}
          </h1>
          <p className="text-sm md:text-base text-[var(--theme-text-muted)] leading-relaxed max-w-xl">{s.heroSub}</p>
        </section>

        {/* features */}
        <section ref={listRef} className="flex flex-col gap-14 md:gap-20">
          {s.features.map((f, i) => (
            <article key={f.id} className={`wn-card wn-row ${i % 2 === 1 ? 'wn-row-flip' : ''}`}>
              <div className="wn-row-visual">{visuals[f.id] || null}</div>
              <div className="wn-row-text">
                <p className="text-xs text-[var(--theme-text-dim)] mb-2">{String(i + 1).padStart(2, '0')}</p>
                <h2 className="text-xl md:text-2xl text-white mb-3">{f.title}</h2>
                <p className="text-sm text-[var(--theme-text-muted)] leading-relaxed">
                  {f.notePhrase && f.body.includes(f.notePhrase)
                    ? (() => {
                        const [before, after] = f.body.split(f.notePhrase);
                        return (
                          <>
                            {before}
                            <HoverNote note={f.note}>{f.notePhrase}</HoverNote>
                            {after}
                          </>
                        );
                      })()
                    : f.body}
                </p>
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
