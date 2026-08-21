import React from 'react';

/**
 * The shared look for "there is nothing at this address": /404 and the public
 * viewer's slate-not-found. They used to be built separately, and the 404 was
 * hardcoded to the legacy palette, so the two pages rendered on visibly
 * different greys. One component, one set of theme variables, one look.
 */
export function ErrorPage({ code, message, buttonLabel, onButtonClick }) {
  // "404" wants to be enormous; "slate not found" would overflow at that size.
  const isShortCode = String(code).length <= 4;
  const codeSize = isShortCode ? 'text-6xl md:text-8xl' : 'text-3xl md:text-5xl';

  return (
    <div className="h-screen bg-[var(--theme-bg)] text-[var(--theme-text-muted)] font-mono selection:bg-[var(--theme-border)] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className={`${codeSize} text-[var(--theme-text-dim)] mb-8 font-light`}>{code}</div>
        <p className="text-lg md:text-xl text-[var(--theme-text-muted)] mb-8 leading-relaxed break-words">
          {message}
        </p>
        <button
          onClick={onButtonClick}
          className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] text-[var(--theme-accent)] px-8 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-all text-sm"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}
