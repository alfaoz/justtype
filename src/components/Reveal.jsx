import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Three ways for a piece of the page to arrive and leave without a jump.
 * Every one of them collapses to nothing under `motion: off` (index.css).
 *
 *   <Fade show={x}>...</Fade>        fades and rises in, fades out before it
 *                                   leaves; what fades out is what was last shown
 *   <AutoHeight>...</AutoHeight>     follows its content's height with a glide
 *   <Collapse open={x}>...</Collapse> a disclosure: grows from zero and shrinks
 *                                   back, the content fading with it
 */
export const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

// Mounted while `show` or still fading out; `visible` flips one style flush
// after mounting, so there is a starting state to transition from. The flush
// is forced by reading a layout property, not by waiting for a frame: hidden
// tabs stop frames, but the transition should still be armed when they return.
function usePresence(show, duration) {
  const [present, setPresent] = useState(show);
  const [visible, setVisible] = useState(show);
  const ref = useRef(null);
  useEffect(() => {
    if (show) { setPresent(true); return; }
    setVisible(false);
    const t = setTimeout(() => setPresent(false), duration);
    return () => clearTimeout(t);
  }, [show, duration]);
  useLayoutEffect(() => {
    if (show && present && !visible) { void ref.current?.offsetHeight; setVisible(true); }
  }, [show, present, visible]);
  return { present, visible, ref };
}

export function Fade({ show, children, className = '', duration = 280 }) {
  const { present, visible, ref } = usePresence(show, duration);
  const kept = useRef(children);
  if (show) kept.current = children;
  if (!present) return null;
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(-4px)',
        transition: `opacity ${duration}ms ${EASE}, transform ${duration}ms ${EASE}`,
      }}
    >
      {kept.current}
    </div>
  );
}

// Measures the inner box and reports its height whenever it changes
// (A layout effect, so the first measure lands in the same flush that arms
// the transition: a height can only glide from a number, never from auto)
function useMeasuredHeight(ref, deps = []) {
  const [height, setHeight] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return height;
}

export function AutoHeight({ children, className = '', innerClassName = 'flex flex-col items-center', duration = 320 }) {
  const inner = useRef(null);
  const height = useMeasuredHeight(inner);
  return (
    <div className={className} style={{ height: height ?? 'auto', overflow: 'hidden', transition: `height ${duration}ms ${EASE}` }}>
      <div ref={inner} className={innerClassName}>{children}</div>
    </div>
  );
}

export function Collapse({ open, children, className = '', duration = 320 }) {
  const { present, visible, ref } = usePresence(open, duration);
  const inner = useRef(null);
  const kept = useRef(children);
  if (open) kept.current = children;
  const height = useMeasuredHeight(inner, [present]);
  if (!present) return null;
  return (
    <div
      ref={ref}
      className={className}
      style={{
        height: visible ? (height ?? 'auto') : 0,
        opacity: visible ? 1 : 0,
        overflow: 'hidden',
        transition: `height ${duration}ms ${EASE}, opacity ${duration * 0.75}ms ${EASE}`,
      }}
    >
      <div ref={inner}>{kept.current}</div>
    </div>
  );
}
