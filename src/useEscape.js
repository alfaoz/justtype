import { useEffect, useRef } from 'react';

/**
 * Close-on-Escape for overlays.
 *
 * Pass the same handler the modal's close button uses; it fires on Escape while
 * `active` is true. Handlers are kept in a stack so that when two overlays are
 * open at once (a confirm on top of a panel, say) Escape dismisses only the
 * topmost one instead of collapsing everything at once.
 *
 * The listener sits on the window in the capture phase so it still fires when
 * focus is inside an input or a CodeMirror surface that stops propagation.
 * The handler is held in a ref, so passing an inline arrow does not churn the
 * stack on every render.
 */
const stack = [];

export function useEscape(active, onEscape) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;

  useEffect(() => {
    if (!active) return;

    const entry = {};
    stack.push(entry);

    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      // Only the most recently opened overlay reacts.
      if (stack[stack.length - 1] !== entry) return;
      if (typeof handlerRef.current !== 'function') return;
      e.stopPropagation();
      handlerRef.current();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
    };
  }, [active]);
}
