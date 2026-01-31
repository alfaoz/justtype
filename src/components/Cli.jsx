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
    <div className="min-h-screen bg-[#111111] text-[#a0a0a0] font-mono selection:bg-[#333333] selection:text-white flex items-center justify-center p-4 md:p-6">
      <div className="flex flex-col items-center">
        {/* ASCII Logo - purple tint, hidden on mobile */}
        <div className="hidden md:block mb-8">
          <pre className="text-[#8B5CF6] text-xs leading-tight select-none font-mono">{`           _           _     _
   _      (_)_   _ ___| |_  | |_ _   _ _ __   ___
 _| |_    | | | | / __| __| | __| | | | '_ \\ / _ \\
|_   _|   | | |_| \\__ \\ |_  | |_| |_| | |_) |  __/
  |_|    _/ |\\__,_|___/\\__|  \\__|\\__, | .__/ \\___|
        |__/                     |___/|_|         `}</pre>
        </div>

        {/* Mobile title */}
        <h1 className="md:hidden text-2xl text-white mb-4">
          <span className="text-[#8B5CF6]">+</span> justtype cli
        </h1>

        {/* Tagline */}
        <p className="text-[#888] text-lg mb-8">
          {strings.cli.tagline}
        </p>

        {/* The hero: install command */}
        <div
          onClick={handleCopy}
          className="group bg-[#0d0d0d] border border-[#333] hover:border-[#8B5CF6]/50 rounded-lg px-5 py-4 cursor-pointer transition-all duration-200 mb-2"
        >
          <div className="flex items-center gap-3">
            <span className="text-[#8B5CF6] select-none">$</span>
            <code className="text-white text-sm whitespace-nowrap">
              {strings.cli.install}
            </code>
          </div>
        </div>

        <button
          onClick={handleCopy}
          className="text-sm text-[#666] hover:text-[#8B5CF6] transition-colors mb-12"
        >
          {copied ? strings.cli.copied : strings.cli.copyAction}
        </button>

        {/* One line description */}
        <p className="text-[#666] text-sm mb-12">
          {strings.cli.description}
        </p>

        {/* Footer links */}
        <div className="flex items-center gap-4 text-xs">
          <span className="text-[#444]">{strings.cli.platforms}</span>
          <a
            href="https://github.com/alfaoz/justtype/tree/master/cli"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#666] hover:text-[#8B5CF6] transition-colors"
          >
            {strings.cli.github}
          </a>
          <a
            href="/"
            className="text-[#666] hover:text-[#8B5CF6] transition-colors"
          >
            justtype.io
          </a>
        </div>
      </div>
    </div>
  );
}
