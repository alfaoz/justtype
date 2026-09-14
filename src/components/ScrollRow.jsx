import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A horizontally scrolling row with its own scroll indicator.
 *
 * Native scrollbars are invisible on iOS and auto-hiding elsewhere, so a row
 * that continues past the edge looks like a row that simply got cut off. This
 * draws a thumb whose width is the visible fraction and whose position tracks
 * scrollLeft, which is the same technique the desktop settings strip uses,
 * and fades the edge the row continues past. With `wrap` the row wraps
 * instead and nothing scrolls (the space under it stays, so a row that
 * switches between the two does not jump).
 */
export function ScrollRow({ children, className = '', wrap = false }) {
  const ref = useRef(null);
  const [bar, setBar] = useState(null); // { width, left } as percentages, or null when it all fits
  const [fade, setFade] = useState({ l: false, r: false });
  // The thumb is there while the pointer is over the row or the row is
  // moving, and fades out once both have stopped
  const [hover, setHover] = useState(false);
  const [moving, setMoving] = useState(false);
  const movingTimer = useRef(null);
  const onScroll = () => {
    measure();
    setMoving(true);
    clearTimeout(movingTimer.current);
    movingTimer.current = setTimeout(() => setMoving(false), 700);
  };
  useEffect(() => () => clearTimeout(movingTimer.current), []);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    const max = scrollWidth - clientWidth;
    const l = max > 1 && scrollLeft > 1;
    const r = max > 1 && scrollLeft < max - 1;
    setFade((prev) => (prev.l === l && prev.r === r ? prev : { l, r }));
    if (scrollWidth <= clientWidth + 1) {
      setBar((prev) => (prev === null ? prev : null));
      return;
    }
    const width = Math.max(14, (clientWidth / scrollWidth) * 100);
    const left = (scrollLeft / (scrollWidth - clientWidth)) * (100 - width);
    setBar((prev) =>
      prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.width - width) < 0.5 ? prev : { width, left }
    );
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, wrap]);

  return (
    <div className={className} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <div ref={ref} onScroll={onScroll} className={wrap ? 'flex flex-wrap gap-2' : `flex gap-2 overflow-x-auto settings-strip no-native-scrollbar ${fade.l ? 'strip-fade-l' : ''} ${fade.r ? 'strip-fade-r' : ''}`}>
        {children}
      </div>
      <div className="h-[3px] mt-2 rounded-full bg-[var(--theme-border)]/40 overflow-hidden transition-opacity duration-300" style={{ opacity: bar && (hover || moving) ? 1 : 0 }}>
        <div
          className="h-full rounded-full bg-[var(--theme-text-dim)] transition-[margin] duration-75"
          style={{ width: `${bar ? bar.width : 0}%`, marginLeft: `${bar ? bar.left : 0}%` }}
        />
      </div>
    </div>
  );
}
