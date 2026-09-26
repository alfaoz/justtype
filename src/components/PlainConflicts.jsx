import React, { useEffect, useRef } from 'react';
import { buildConflictCard } from './conflictCard';

// Merge conflicts in a plain slate: the rich editor's cards, above the text,
// one per block (a textarea cannot hold them inline). The raw markers stay in
// the text until a card's choice replaces its block.
export default function PlainConflicts({ conflicts, onChoose }) {
  const hostRef = useRef(null);
  const chooseRef = useRef(onChoose);
  chooseRef.current = onChoose;
  // Rebuilt only when the blocks themselves change, not on every keystroke
  const key = JSON.stringify(conflicts);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren(...conflicts.map((c) => buildConflictCard({
      ours: c.ours,
      theirs: c.theirs,
      choose: (text) => chooseRef.current(c, text),
    })));
  }, [key]);
  return <div ref={hostRef} className="w-full max-w-3xl px-8 pt-8 flex flex-col gap-3" />;
}
