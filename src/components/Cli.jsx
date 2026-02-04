import React, { useState } from 'react';
import { strings } from '../strings';

export function Cli() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(strings.cli.install);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen font-mono flex items-center justify-center p-4 md:p-6" style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text-muted)' }}>
      <div className="flex flex-col items-center">
        {/* ASCII Logo - accent color, hidden on mobile */}
        <div className="hidden md:block mb-8">
          <pre className="text-xs leading-tight select-none font-mono" style={{ color: 'var(--theme-blue)' }}>{`           _           _     _
   _      (_)_   _ ___| |_  | |_ _   _ _ __   ___
 _| |_    | | | | / __| __| | __| | | | '_ \\ / _ \\
|_   _|   | | |_| \\__ \\ |_  | |_| |_| | |_) |  __/
  |_|    _/ |\\__,_|___/\\__|  \\__|\\__, | .__/ \\___|
        |__/                     |___/|_|         `}</pre>
        </div>

        {/* Mobile title */}
        <h1 className="md:hidden text-2xl mb-4" style={{ color: 'var(--theme-accent)' }}>
          <span style={{ color: 'var(--theme-blue)' }}>+</span> justtype cli
        </h1>

        {/* Tagline */}
        <p className="text-lg mb-8" style={{ color: 'var(--theme-text-muted)' }}>
          {strings.cli.tagline}
        </p>

        {/* The hero: install command */}
        <div
          onClick={handleCopy}
          className="group rounded-lg px-5 py-4 cursor-pointer transition-all duration-200 mb-2"
          style={{ backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border)' }}
          onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--theme-blue)'}
          onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--theme-border)'}
        >
          <div className="flex items-center gap-3">
            <span className="select-none" style={{ color: 'var(--theme-blue)' }}>$</span>
            <code className="text-sm whitespace-nowrap" style={{ color: 'var(--theme-accent)' }}>
              {strings.cli.install}
            </code>
          </div>
        </div>

        <button
          onClick={handleCopy}
          className="text-sm transition-colors mb-12"
          style={{ color: 'var(--theme-text-dim)' }}
          onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-blue)'}
          onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}
        >
          {copied ? strings.cli.copied : strings.cli.copyAction}
        </button>

        {/* One line description */}
        <p className="text-sm mb-12" style={{ color: 'var(--theme-text-dim)' }}>
          {strings.cli.description}
        </p>

        {/* Footer links */}
        <div className="flex items-center gap-4 text-xs">
          <span style={{ color: 'var(--theme-text-dim)' }}>{strings.cli.platforms}</span>
          <a
            href="https://github.com/alfaoz/justtype/tree/master/cli"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors"
            style={{ color: 'var(--theme-text-dim)' }}
            onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-blue)'}
            onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}
          >
            {strings.cli.github}
          </a>
          <a
            href="/"
            className="transition-colors"
            style={{ color: 'var(--theme-text-dim)' }}
            onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-blue)'}
            onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}
          >
            justtype.io
          </a>
        </div>
      </div>
    </div>
  );
}
