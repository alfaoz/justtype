import React, { useState, useRef } from 'react';
import { strings } from '../strings';

// The verified bootstrap (dist/index.html) checks the manifest signature and
// pins every file with SRI before the app runs, then records the outcome on
// window.__jtIntegrity. This badge just reports that verdict: if the running
// code had not verified, it would not be running. Deep, independent
// verification lives off-origin (linked from /verify).
const integrity = typeof window !== 'undefined' ? window.__jtIntegrity : null;

export function VerifyBadge({ children, className }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const timeoutRef = useRef(null);

  const handleMouseEnter = (e) => {
    setPos({ x: e.clientX, y: e.clientY });
    timeoutRef.current = setTimeout(() => setShow(true), 200);
  };

  const handleMouseLeave = () => {
    clearTimeout(timeoutRef.current);
    setShow(false);
  };

  const tooltipStyle = {
    position: 'fixed',
    left: pos.x + 12,
    top: pos.y - 8,
    transform: 'translateY(-100%)',
    zIndex: 9999,
    pointerEvents: 'none',
  };

  if (pos.y < 120) {
    tooltipStyle.transform = 'translateY(8px)';
    tooltipStyle.top = pos.y + 16;
  }

  const s = strings.verify.badge;

  return (
    <span
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative' }}
    >
      <a href="/verify" target="_blank" rel="noopener noreferrer" className="hover:text-[#999] transition-colors">
        {children}
      </a>

      {show && (
        <div style={tooltipStyle}>
          <div className="bg-[#1a1a1a] border border-[#333] rounded px-3 py-2 text-xs font-mono shadow-lg" style={{ minWidth: '220px' }}>
            {integrity ? (
              <div className="space-y-1.5">
                <div className={`text-xs font-medium ${integrity.signed ? 'text-green-400' : 'text-blue-400'}`}>
                  {integrity.signed ? `✓ ${s.signed}` : `✓ ${s.beta}`}
                </div>
                <div className="text-[#666] space-y-0.5">
                  <div className="flex justify-between gap-4">
                    <span>{s.version}</span>
                    <span>{integrity.version}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>{s.files}</span>
                    <span>{s.filesPinned(integrity.files)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <span className="text-[#666]">{s.dev}</span>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
