import React, { useState } from 'react';
import { strings } from '../strings';

export function RecoveryKeyModal({ recoveryPhrase, onAcknowledge, subtitle }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleDownload = () => {
    const content = `justtype recovery key\n\n${recoveryPhrase}\n\nkeep this file safe. it is the only way to recover your slates if you forget your password.\n`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'justtype-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryPhrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // fallback
      const textarea = document.createElement('textarea');
      textarea.value = recoveryPhrase;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg md:text-xl text-white mb-3">{strings.auth.recoveryKey.title}</h2>
        {subtitle && <p className="text-green-400/80 text-sm mb-3">{subtitle}</p>}
        <p className="text-[#999] text-sm mb-2">{strings.auth.recoveryKey.description}</p>
        <p className="text-red-400 text-sm mb-4">{strings.auth.recoveryKey.warning}</p>

        <div className="bg-[#111] border border-[#333] rounded p-4 mb-4 font-mono text-sm text-white leading-relaxed select-all break-words">
          {recoveryPhrase}
        </div>

        <div className="flex gap-3 mb-6">
          <button
            onClick={handleDownload}
            className="flex-1 bg-[#222] border border-[#444] text-white px-4 py-2.5 rounded hover:bg-[#333] transition-colors text-sm"
          >
            {strings.auth.recoveryKey.download}
          </button>
          <button
            onClick={handleCopy}
            className="flex-1 bg-[#222] border border-[#444] text-white px-4 py-2.5 rounded hover:bg-[#333] transition-colors text-sm"
          >
            {copied ? strings.auth.recoveryKey.copied : strings.auth.recoveryKey.copy}
          </button>
        </div>

        <label className="flex items-start gap-3 mb-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 accent-white"
          />
          <span className="text-[#ccc] text-sm">{strings.auth.recoveryKey.acknowledge}</span>
        </label>

        <button
          onClick={onAcknowledge}
          disabled={!acknowledged}
          className="w-full bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
        >
          continue
        </button>
      </div>
    </div>
  );
}
