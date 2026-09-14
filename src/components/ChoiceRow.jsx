import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readSwipe } from '../swipe';

/**
 * A row of words to pick one from (`sort: recent oldest ...`), with one
 * accent underline for the row that glides to whichever word is chosen
 * instead of blinking from one to the next. `label` is optional: inside an
 * account row the label is already on the left. An option may bring its own
 * `node` in place of the word (a tag being renamed), and `after(option)`
 * renders something right after each word (a tag's menu). With `swipe`, a
 * two-finger swipe across the row moves the choice a word at a time: every
 * eighty pixels of travel is one step, a long swipe keeps stepping, and the
 * ends stop. Which way is the device's `swipe` setting.
 */
export function ChoiceRow({ label, options, value, onChange, className = '', after, swipe = false }) {
  const wrapRef = useRef(null);
  const [bar, setBar] = useState(null);
  const live = useRef({ value, options, onChange });
  live.current = { value, options, onChange };
  useEffect(() => {
    if (!swipe || !wrapRef.current) return;
    const STEP = 80;
    let travel = 0;
    let idle = null;
    let at = null; // the word reached within this swipe (the row may not have re-rendered yet)
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault(); // not the browser's back and forward
      if (Math.abs(e.deltaX) < 2) return; // the tail of the glide
      clearTimeout(idle);
      idle = setTimeout(() => { travel = 0; at = null; }, 200);
      travel += e.deltaX;
      while (Math.abs(travel) >= STEP) {
        const moved = Math.sign(travel);
        travel -= moved * STEP;
        // Fingers going left give a positive deltaX on a trackpad; natural
        // follows the fingers, so that is the word to the left
        const dir = readSwipe() === 'flipped' ? moved : -moved;
        const { value: v, options: opts, onChange: change } = live.current;
        const i = opts.findIndex(o => o.id === (at ?? v));
        const next = opts[i + dir];
        if (next) { at = next.id; change(next.id); }
      }
    };
    const el = wrapRef.current;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); clearTimeout(idle); };
  }, [swipe]);
  useLayoutEffect(() => {
    const place = () => {
      const el = wrapRef.current?.querySelector(`[data-choice="${value}"]`);
      if (!el) { setBar(null); return; }
      setBar({ left: el.offsetLeft, width: el.offsetWidth, top: el.offsetTop + el.offsetHeight - 1 });
    };
    place();
    const ro = new ResizeObserver(place);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [value, options.length]);
  return (
    <div ref={wrapRef} className={`relative flex items-center flex-wrap gap-x-3 gap-y-1 ${className}`}>
      {label && <span className="text-[var(--theme-text-dim)] select-none">{label}</span>}
      {options.map(option => (
        <React.Fragment key={option.id}>
          {option.node || (
            <button
              data-choice={option.id}
              onClick={() => onChange(option.id)}
              title={option.title}
              className={`transition-colors duration-300 max-w-[12rem] truncate ${
                value === option.id ? 'text-[var(--theme-text)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-text)]'
              }`}
            >
              {option.label}
            </button>
          )}
          {after?.(option)}
        </React.Fragment>
      ))}
      {bar && (
        <span
          aria-hidden="true"
          className="absolute h-px bg-[var(--theme-accent)] pointer-events-none"
          style={{ left: bar.left, width: bar.width, top: bar.top, transition: 'left 300ms cubic-bezier(0.4, 0, 0.2, 1), width 300ms cubic-bezier(0.4, 0, 0.2, 1), top 300ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      )}
    </div>
  );
}

// Plain words as options: ['on', 'off'] reads as on / off
export const wordOptions = (words) => words.map(w => ({ id: w, label: w }));
