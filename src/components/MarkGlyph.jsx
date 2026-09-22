import React from 'react';

// The device mark's four glyphs, shared by the slate list and the what's new
// demo so the two never drift: cloud (not on this device), check (a copy is
// here), alert (saved here, not in the account yet), spin (syncing). Select
// mode's circle is drawn from the same pen, so it stacks on the device mark
// in one column: open (not chosen), chosen (filled, the check cut out).
const paths = {
  cloud: (
    <>
      <path d="M12 13v8l-4-4" />
      <path d="m12 21 4-4" />
      <path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </>
  ),
  spin: <path d="M21 12a9 9 0 1 1-6.219-8.56" />,
  open: <circle cx="12" cy="12" r="10" />,
  chosen: (
    <>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="m8 12 3 3 5-6" stroke="var(--theme-bg)" />
    </>
  ),
};

export function MarkGlyph({ kind, ...props }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      {paths[kind]}
    </svg>
  );
}
