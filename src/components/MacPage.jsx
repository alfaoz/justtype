import React, { useEffect, useMemo, useRef, useState } from 'react';
import LivePreviewEditor from './LivePreviewEditor';
import { TextMorph } from './TextMorph';
import { strings } from '../strings';
import { builtInThemes, themeVars } from '../themes';
import { motionOff } from '../motion';
import release from '../macRelease.json';
import shots from '../macShots.json';
import { keystrokes } from '../macTyping';
import '../macPage.css';

// /mac: the Mac app's page, dark like its installer. One scene: the app's
// window rises as you scroll to it (CSS, a scroll timeline, where the
// browser has one), then stays in place while the scroll goes through it:
// my slates, a slate picked and written in, the palette, a new tab and its
// math. The window is the app itself: its pictures (mac/site-shots.sh, a
// made-up account), with the app's own editor over the writer in each, at
// the place the pictures say (macShots.json), laid out at the window's size
// and scaled to the page. Its math card is the app's glass, pictured at
// points along the same typing (macTyping.js). The red light closes it.

const { size, first, second, texts, peeks = [] } = shots;
// The close button, over the picture's red light
const RED = { x: 25.75, y: 25.75, size: 14 };
const dark = themeVars(builtInThemes.dark);
const noop = () => {};

// The pinned part of the scroll, 0 to 1: the pointer over a slate in my
// slates, the slate open and written in, the palette, a new tab, the
// second slate written
const HOVER = [0.04, 0.07];
const OPEN = [0.1, 0.13];
const WRITE_FIRST = [0.15, 0.33];
const PALETTE = [0.36, 0.4];
const TAB = [0.47, 0.51];
const WRITE_SECOND = [0.53, 0.96];

const clamp = (v) => Math.min(1, Math.max(0, v));
const smooth = ([a, b], v) => {
  const x = clamp((v - a) / (b - a));
  return x * x * (3 - 2 * x);
};
const step = ([a, b], v, count) => Math.round(clamp((v - a) / (b - a)) * (count - 1));
const words = (text) => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length);

// The newest release: as this build knew it, then as the server says
// (mac/release.sh --publish puts it there, with no site release needed)
function useRelease() {
  const [latest, setLatest] = useState(release);
  useEffect(() => {
    fetch('/mac/latest.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.version) setLatest(j); }).catch(() => {});
  }, []);
  return latest;
}

function Download({ release }) {
  const megabytes = `${(release.bytes / 1e6).toFixed(1)} MB`;
  return (
    <div className="mac-get">
      <a className="mac-download" href="/mac/download">{strings.mac.download}</a>
      <span className="mac-meta">{strings.mac.meta(release.version, megabytes, release.system)}</span>
    </div>
  );
}

// The app's writer and its counter, where the picture has them; `state` is
// the text so far and the caret in it
function Writing({ at, state }) {
  const { editor, count } = at;
  const editorRef = useRef(null);
  // The caret goes with the text (LivePreviewEditor applies both at once)
  editorRef.current?.setNextSelection({ anchor: state.caret });
  return (
    <>
      <div className="mac-live" aria-hidden="true" style={{ left: editor.x, top: editor.y, width: editor.width, height: editor.height }}>
        <LivePreviewEditor ref={editorRef} content={state.doc} onChange={noop} readOnly puntoClass="punto-base" />
      </div>
      <div className="mac-count" aria-hidden="true" style={{ left: count.x, top: count.y, minWidth: count.width, height: count.height, color: at.color, fontSize: at.fontSize }}>
        <div style={{ opacity: at.opacity }}>
          <TextMorph>{strings.writer.stats.words(words(state.doc))}</TextMorph>
          <TextMorph>{strings.writer.stats.chars(state.doc.length)}</TextMorph>
        </div>
      </div>
    </>
  );
}

// The app's glass card over the math being written: the picture of it
// taken at the latest point the typing has reached
function Peek({ states, at }) {
  const state = states[at];
  let shown = null;
  if (state?.math) for (const peek of peeks) if (peek.state <= at && states[peek.state].math) shown = peek;
  const [last, setLast] = useState(shown);
  if (shown && shown !== last) setLast(shown);
  const peek = shown || last;
  if (!peek) return null;
  return (
    <img
      className={`mac-peek${shown ? ' is-on' : ''}`}
      src={`/mac-page/${peek.src}`}
      alt=""
      draggable="false"
      style={{ left: peek.x, top: peek.y, width: peek.width, height: peek.height }}
    />
  );
}

export default function MacPage() {
  const sceneRef = useRef(null);
  const frameRef = useRef(null);
  const appRef = useRef(null);
  const hoverRef = useRef(null);
  const openRef = useRef(null);
  const paletteRef = useRef(null);
  const tabRef = useRef(null);
  const still = motionOff();
  // The picked slate opens as it was saved; the scroll writes from there
  const typing = useMemo(() => {
    const first = keystrokes(texts.writer);
    const from = Math.max(0, first.findIndex((s) => s.doc === texts.saved && s.caret === texts.saved.length));
    return [first.slice(from), keystrokes(texts.math)];
  }, []);
  const [written, setWritten] = useState(() => (still ? typing.map((states) => states.length - 1) : [0, 0]));
  const [closed, setClosed] = useState(false);
  const latest = useRelease();

  // The page's own ground, under the overscroll too
  useEffect(() => {
    document.documentElement.dataset.page = 'mac';
    // The math renderer, ahead of the first formula
    import('./mathRender').catch(() => {});
    return () => { delete document.documentElement.dataset.page; };
  }, []);

  // The window at its own size, scaled to the room the page gives it
  useEffect(() => {
    const frame = frameRef.current;
    const fit = () => { appRef.current.style.transform = `scale(${frame.clientWidth / size.width})`; };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(frame);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    if (still) return undefined;
    const scene = sceneRef.current;
    let frame = 0;
    let last = '';

    function update() {
      frame = 0;
      const box = scene.getBoundingClientRect();
      const span = box.height - innerHeight;
      const p = span > 0 ? clamp(-box.top / span) : 0;
      hoverRef.current.style.opacity = smooth(HOVER, p).toFixed(3);
      openRef.current.style.opacity = smooth(OPEN, p).toFixed(3);
      paletteRef.current.style.opacity = smooth(PALETTE, p).toFixed(3);
      tabRef.current.style.opacity = smooth(TAB, p).toFixed(3);
      const next = [step(WRITE_FIRST, p, typing[0].length), step(WRITE_SECOND, p, typing[1].length)];
      if (next.join() !== last) {
        last = next.join();
        setWritten(next);
      }
    }

    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule, { passive: true });
    return () => {
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [still, typing]);

  return (
    <div className={`mac-site${still ? ' is-still' : ''}`}>
      <header className="mac-hero">
        <div className="mac-hero-inner">
          <img
            src="/mac-icon.webp"
            alt={strings.mac.icon}
            width="160"
            height="160"
            draggable="false"
            className="mac-icon"
          />
          <h1 className="mac-title">{strings.mac.title}</h1>
          <Download release={latest} />
        </div>
      </header>

      <section className="mac-scene" ref={sceneRef}>
        <div className="mac-stage">
          <h2 className="mac-built">{strings.mac.built}</h2>
          <div className={`mac-shots${closed ? ' is-closed' : ''}`} ref={frameRef}>
            <span className="mac-under" aria-hidden="true">{strings.mac.egg}</span>
            <div className="mac-app" ref={appRef} style={{ ...dark, width: size.width, height: size.height }}>
              <img src="/mac-page/slates.webp" alt="" draggable="false" />
              <img src="/mac-page/hover.webp" alt="" draggable="false" ref={hoverRef} className="mac-later" />
              <div className="mac-later" ref={openRef}>
                <img src="/mac-page/opened.webp" alt="" draggable="false" />
                <Writing at={first} state={typing[0][written[0]]} />
              </div>
              <img src="/mac-page/palette.webp" alt="" draggable="false" ref={paletteRef} className="mac-later" />
              <div className="mac-later" ref={tabRef}>
                <img src="/mac-page/tabs.webp" alt="" draggable="false" />
                <Writing at={second} state={typing[1][written[1]]} />
                <Peek states={typing[1]} at={written[1]} />
              </div>
              <button
                type="button"
                className="mac-close"
                aria-label={strings.mac.close}
                onClick={() => setClosed(true)}
                style={{ left: RED.x - RED.size / 2 - 3, top: RED.y - RED.size / 2 - 3, width: RED.size + 6, height: RED.size + 6 }}
              />
            </div>
          </div>
        </div>
      </section>

      <footer className="mac-end">
        <Download release={latest} />
        <a className="mac-home" href="/">{strings.app.logo}</a>
      </footer>
    </div>
  );
}
