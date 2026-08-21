import React from 'react';
import { strings } from '../strings';

/**
 * The one header every standalone page wears: /status, /verify, /dev,
 * /whats-new, /s/:id and the error pages. Before this each page rolled its own
 * (the dev portal was even hardcoded to the legacy palette), so the chrome
 * shifted colour and height as you moved between them.
 *
 * `label` is the quiet page name on the right; `right` replaces it outright
 * when a page needs something interactive there instead.
 */
export function PageHeader({ label, right, onHome, sticky = false }) {
  const goHome = (e) => {
    if (!onHome) return; // plain anchor navigation
    e.preventDefault();
    onHome();
  };

  return (
    <header
      className={`px-4 md:px-8 h-16 md:h-20 flex justify-between items-center border-b border-[var(--theme-border-light)] bg-[var(--theme-bg)] ${
        sticky ? 'sticky top-0 z-30' : ''
      }`}
    >
      <a
        href="/"
        onClick={goHome}
        className="text-lg md:text-xl font-medium text-[var(--theme-text-muted)] hover:text-[var(--theme-accent)] transition-colors select-none"
      >
        {strings.app.logo}
      </a>
      {right !== undefined ? (
        right
      ) : label ? (
        <span className="text-xs text-[var(--theme-text-dim)]">{label}</span>
      ) : null}
    </header>
  );
}
