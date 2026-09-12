import React, { useEffect, useRef, useState } from 'react';

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

export function Fade({ show, children, className = '', duration = 280 }) {
  const [present, setPresent] = useState(show);
  const [visible, setVisible] = useState(show);
  const kept = useRef(children);
  if (show) kept.current = children;
  useEffect(() => {
    if (show) {
      setPresent(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = setTimeout(() => setPresent(false), duration);
    return () => clearTimeout(t);
  }, [show, duration]);
  if (!present) return null;
  return (
    <div
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
function useMeasuredHeight(ref, deps = []) {
  const [height, setHeight] = useState(null);
  useEffect(() => {
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
  const inner = useRef(null);
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(open);
  const kept = useRef(children);
  if (open) kept.current = children;
  useEffect(() => {
    if (open) {
      setPresent(true);
      // One frame at zero, so there is a height to grow from
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setPresent(false), duration);
    return () => clearTimeout(t);
  }, [open, duration]);
  const height = useMeasuredHeight(inner, [present]);
  if (!present) return null;
  return (
    <div
      className={className}
      style={{
        height: shown ? (height ?? 'auto') : 0,
        opacity: shown ? 1 : 0,
        overflow: 'hidden',
        transition: `height ${duration}ms ${EASE}, opacity ${duration * 0.75}ms ${EASE}`,
      }}
    >
      <div ref={inner}>{kept.current}</div>
    </div>
  );
}
