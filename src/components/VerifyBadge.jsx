import React, { useState, useRef, useEffect } from 'react';

const GITHUB_HASHES_URL = 'https://alfaoz.github.io/justtype/build-hashes.json';

let cachedResult = null;

export function VerifyBadge({ children, className }) {
  const [show, setShow] = useState(false);
  const [result, setResult] = useState(cachedResult);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const fetchedRef = useRef(false);
  const timeoutRef = useRef(null);

  const handleMouseEnter = (e) => {
    updatePos(e);
    timeoutRef.current = setTimeout(() => {
      setShow(true);
      if (!fetchedRef.current && !cachedResult) {
        fetchedRef.current = true;
        runVerification();
      }
    }, 200);
  };

  const handleMouseLeave = () => {
    clearTimeout(timeoutRef.current);
    setShow(false);
  };

  const updatePos = (e) => {
    setPos({ x: e.clientX, y: e.clientY });
  };

  const runVerification = async () => {
    setLoading(true);
    try {
      const [manifestRes, ghRes] = await Promise.all([
        fetch('/build-manifest.json'),
        fetch(GITHUB_HASHES_URL)
      ]);

      if (!manifestRes.ok) throw new Error('manifest');
      const manifest = await manifestRes.json();
      const gh = ghRes.ok ? await ghRes.json() : null;

      const [jsRes, cssRes] = await Promise.all([
        fetch(`/assets/${manifest.jsFile}`),
        fetch(`/assets/${manifest.cssFile}`)
      ]);

      const [jsBuf, cssBuf] = await Promise.all([
        jsRes.arrayBuffer(),
        cssRes.arrayBuffer()
      ]);

      const [jsDigest, cssDigest] = await Promise.all([
        crypto.subtle.digest('SHA-256', jsBuf),
        crypto.subtle.digest('SHA-256', cssBuf)
      ]);

      const hex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      const computedJs = hex(jsDigest);
      const computedCss = hex(cssDigest);

      const serverMatch = manifest.jsHash === computedJs && manifest.cssHash === computedCss;
      const ghMatch = gh ? (gh.jsHash === computedJs && gh.cssHash === computedCss) : null;

      const r = {
        verified: serverMatch && ghMatch === true,
        serverMatch,
        ghMatch,
        jsHash: computedJs,
        cssHash: computedCss,
        ghJsHash: gh?.jsHash || null,
        version: manifest.version,
      };
      cachedResult = r;
      setResult(r);
    } catch {
      const r = { error: true };
      cachedResult = r;
      setResult(r);
    } finally {
      setLoading(false);
    }
  };

  // Tooltip positioning
  const tooltipStyle = {
    position: 'fixed',
    left: pos.x + 12,
    top: pos.y - 8,
    transform: 'translateY(-100%)',
    zIndex: 9999,
    pointerEvents: 'none',
  };

  // Keep tooltip near cursor if above viewport
  if (pos.y < 120) {
    tooltipStyle.transform = 'translateY(8px)';
    tooltipStyle.top = pos.y + 16;
  }

  const truncate = (h) => h ? h.slice(0, 8) + '...' + h.slice(-8) : '...';

  return (
    <span
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseMove={updatePos}
      onMouseLeave={handleMouseLeave}
      style={{ position: 'relative' }}
    >
      <a href="/verify" target="_blank" rel="noopener noreferrer" className="hover:text-[#999] transition-colors">
        {children}
      </a>

      {show && (
        <div style={tooltipStyle}>
          <div className="bg-[#1a1a1a] border border-[#333] rounded px-3 py-2 text-xs font-mono shadow-lg" style={{ minWidth: '220px' }}>
            {loading && !result && (
              <span className="text-[#666] animate-pulse">verifying...</span>
            )}
            {result && result.error && (
              <span className="text-red-400/70">verification failed</span>
            )}
            {result && !result.error && (
              <div className="space-y-1.5">
                <div className={`text-xs font-medium ${result.verified ? 'text-green-400' : 'text-yellow-400'}`}>
                  {result.verified ? '\u2713 verified' : '\u2713 server match'}
                </div>
                <div className="text-[#666] space-y-0.5">
                  <div className="flex justify-between gap-4">
                    <span>js</span>
                    <span className={result.serverMatch ? 'text-green-400/60' : 'text-red-400/60'}>{truncate(result.jsHash)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span>css</span>
                    <span className={result.serverMatch ? 'text-green-400/60' : 'text-red-400/60'}>{truncate(result.cssHash)}</span>
                  </div>
                  {result.ghMatch === false && (
                    <div className="text-yellow-400/50 pt-1">github actions: rebuilding</div>
                  )}
                  {result.ghMatch === null && (
                    <div className="text-[#555] pt-1">github: unavailable</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
