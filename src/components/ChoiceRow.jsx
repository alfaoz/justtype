import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * A row of words to pick one from (`sort: recent oldest ...`), with one
 * accent underline for the row that glides to whichever word is chosen
 * instead of blinking from one to the next. `label` is optional: inside an
 * account row the label is already on the left.
 */
export function ChoiceRow({ label, options, value, onChange, className = '' }) {
  const wrapRef = useRef(null);
  const [bar, setBar] = useState(null);
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
        <button
          key={option.id}
          data-choice={option.id}
          onClick={() => onChange(option.id)}
          title={option.title}
          className={`transition-colors duration-300 max-w-[12rem] truncate ${
            value === option.id ? 'text-[var(--theme-text)]' : 'text-[var(--theme-text-dim)] hover:text-[var(--theme-text)]'
          }`}
        >
          {option.label}
        </button>
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
