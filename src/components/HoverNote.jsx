import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';

/**
 * A word that reveals a small note when you hover it.
 *
 * Same behaviour as the verify badge's tooltip: a 200ms hold before it appears,
 * the card tracks the cursor, and it flips below the pointer near the top of
 * the viewport and to the left of it near the right edge, so it never opens
 * off-screen. Themed rather than hardcoded, so it works in light as well.
 */
export function HoverNote({ children, note, className = '', plain = false }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [flipX, setFlipX] = useState(false);
  const timeoutRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  // Measure the card once it exists: past the right edge it opens leftward
  useLayoutEffect(() => {
    if (!show || !cardRef.current) return;
    const width = cardRef.current.offsetWidth;
    setFlipX(pos.x + 12 + width > window.innerWidth - 8);
  }, [show, pos.x, note]);

  const updatePos = (e) => setPos({ x: e.clientX, y: e.clientY });

  const handleEnter = (e) => {
    updatePos(e);
    timeoutRef.current = setTimeout(() => setShow(true), 200);
  };

  const handleLeave = () => {
    clearTimeout(timeoutRef.current);
    setShow(false);
  };

  const style = {
    position: 'fixed',
    top: pos.y - 8,
    transform: 'translateY(-100%)',
    zIndex: 9999,
    pointerEvents: 'none',
  };
  if (flipX) style.right = window.innerWidth - pos.x + 12;
  else style.left = pos.x + 12;
  if (pos.y < 120) {
    style.transform = 'translateY(8px)';
    style.top = pos.y + 16;
  }

  return (
    <span
      onMouseEnter={handleEnter}
      onMouseMove={updatePos}
      onMouseLeave={handleLeave}
      className={`${plain ? 'inline-flex items-center' : 'cursor-help underline decoration-dotted underline-offset-4 decoration-[var(--theme-text-dim)]'} hover:text-[var(--theme-accent)] transition-colors ${className}`}
    >
      {children}
      {show && (
        <span style={style} ref={cardRef}>
          <span className="block bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded px-3 py-2 text-xs font-mono text-[var(--theme-text-muted)] shadow-lg whitespace-nowrap">
            {note}
          </span>
        </span>
      )}
    </span>
  );
}
