import React, { useState, useEffect, useRef } from 'react';
import { strings } from '../strings';

const GITHUB_HASHES_URL = 'https://alfaoz.github.io/justtype/build-hashes.json';
const GITHUB_WORKFLOW_URL = 'https://github.com/alfaoz/justtype/blob/master/.github/workflows/publish-hashes.yml';

const bustCache = (url) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

export function Verify() {
  const [manifest, setManifest] = useState(null);
  const [github, setGithub] = useState(null);
  const [githubError, setGithubError] = useState(false);
  const [computedJs, setComputedJs] = useState(null);
  const [computedCss, setComputedCss] = useState(null);
  const [error, setError] = useState(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef(null);
  const manifestRef = useRef(null);

  useEffect(() => {
    verify();
    fetchGithub();
    return () => clearInterval(pollRef.current);
  }, []);

  // Start polling github if we have computed hashes but github doesn't match yet
  useEffect(() => {
    if (!manifest || !computedJs || !computedCss) return;
    if (github && github.jsHash === computedJs && github.cssHash === computedCss) return;
    if (githubError || polling) return;

    setPolling(true);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(bustCache(GITHUB_HASHES_URL));
        if (!res.ok) return;
        const data = await res.json();
        setGithub(data);
        setGithubError(false);
        // Stop polling once it matches
        if (data.jsHash === manifestRef.current?.jsHash && data.cssHash === manifestRef.current?.cssHash) {
          clearInterval(pollRef.current);
          setPolling(false);
        }
      } catch {}
    }, 5000);
  }, [manifest, computedJs, computedCss, github, githubError]);

  const verify = async () => {
    try {
      const manifestRes = await fetch(bustCache('/build-manifest.json'));
      if (!manifestRes.ok) throw new Error('manifest not found');
      const data = await manifestRes.json();
      setManifest(data);
      manifestRef.current = data;

      const [jsRes, cssRes] = await Promise.all([
        fetch(bustCache(`/assets/${data.jsFile}`)),
        fetch(bustCache(`/assets/${data.cssFile}`))
      ]);

      const [jsBuf, cssBuf] = await Promise.all([
        jsRes.arrayBuffer(),
        cssRes.arrayBuffer()
      ]);

      const [jsDigest, cssDigest] = await Promise.all([
        crypto.subtle.digest('SHA-256', jsBuf),
        crypto.subtle.digest('SHA-256', cssBuf)
      ]);

      setComputedJs(bufToHex(jsDigest));
      setComputedCss(bufToHex(cssDigest));
    } catch (err) {
      console.error('Verification failed:', err);
      setError(true);
    }
  };

  const fetchGithub = async () => {
    try {
      const res = await fetch(bustCache(GITHUB_HASHES_URL));
      if (!res.ok) throw new Error('github pages fetch failed');
      const data = await res.json();
      setGithub(data);
    } catch (err) {
      console.error('GitHub hashes fetch failed:', err);
      setGithubError(true);
    }
  };

  const bufToHex = (buf) => {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const jsAllMatch = manifest && github && computedJs && manifest.jsHash === github.jsHash && github.jsHash === computedJs;
  const cssAllMatch = manifest && github && computedCss && manifest.cssHash === github.cssHash && github.cssHash === computedCss;
  const allMatch = jsAllMatch && cssAllMatch;
  const done = manifest && computedJs && computedCss && (github || githubError);
  const anyMismatch = done && !allMatch;

  const toUnix = (iso) => Math.floor(new Date(iso).getTime() / 1000);

  const timeAgo = (iso) => {
    const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatFull = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  return (
    <div className="min-h-screen bg-[#111111] text-[#a0a0a0] flex flex-col" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');`}</style>
      <header className="p-8 border-b border-[#222]">
        <a href="/" className="text-xl font-medium text-[#808080] hover:text-white transition-colors">
          + just type
        </a>
      </header>

      <main className="max-w-2xl mx-auto p-4 md:p-8 flex-grow w-full">
        <h1 className="text-xl text-white mb-2">{strings.verify.title}</h1>
        <p className="text-sm text-[#666] mb-8">{strings.verify.description}</p>

        {error && (
          <div className="text-red-400 text-sm mb-6">{strings.verify.error}</div>
        )}

        {!manifest && !error && (
          <div className="text-[#666] text-sm animate-pulse">{strings.verify.computing}</div>
        )}

        {manifest && (
          <div className="space-y-8">

            {/* Status banner */}
            <div className={`text-sm py-3 px-4 rounded border ${
              !done ? 'border-[#333] text-[#888]' :
              allMatch ? 'border-green-800/30 bg-green-900/10 text-green-400' :
              'border-red-800/30 bg-red-900/10 text-red-400'
            }`}>
              {!done ? (
                <span className="animate-pulse">{strings.verify.computing}</span>
              ) : allMatch ? (
                <span>&#10003; {strings.verify.verified}</span>
              ) : (
                <span>&#10007; {strings.verify.mismatch}</span>
              )}
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-4 text-xs text-[#666]">
              <span>{strings.verify.version(manifest.version)}</span>
              <span className="group relative cursor-default">
                <span className="font-mono">{toUnix(manifest.buildDate)}</span>
                <span className="ml-1 text-[#555]">({timeAgo(manifest.buildDate)})</span>
                <span className="absolute bottom-full left-0 mb-1 px-2 py-1 bg-[#1a1a1a] border border-[#333] rounded text-xs text-[#888] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {formatFull(manifest.buildDate)}
                </span>
              </span>
              <a
                href="https://github.com/alfaoz/justtype"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors ml-auto"
              >
                {strings.verify.githubSource} →
              </a>
            </div>

            {/* JS bundle */}
            <HashSection
              label={strings.verify.jsBundle}
              file={manifest.jsFile}
              server={manifest.jsHash}
              gh={github?.jsHash}
              ghError={githubError}
              computed={computedJs}
              allMatch={jsAllMatch}
            />

            {/* CSS bundle */}
            <HashSection
              label={strings.verify.cssBundle}
              file={manifest.cssFile}
              server={manifest.cssHash}
              gh={github?.cssHash}
              ghError={githubError}
              computed={computedCss}
              allMatch={cssAllMatch}
            />

            {/* GitHub actions source */}
            <div className="pt-2 border-t border-[#222]">
              <div className="flex items-center justify-between py-3">
                <div>
                  <span className="text-sm text-white">{strings.verify.github.label}</span>
                  <p className="text-xs text-[#555] mt-1">{strings.verify.github.hostedOn}</p>
                </div>
                {github && !polling && <span className="text-xs text-green-400">&#10003;</span>}
                {polling && <span className="text-xs text-yellow-400 animate-pulse">rebuilding...</span>}
                {githubError && !polling && <span className="text-xs text-red-400">&#10007;</span>}
              </div>
              {githubError ? (
                <p className="text-xs text-red-400/60 pb-2">{strings.verify.github.error}</p>
              ) : (
                <div className="flex gap-6 text-xs pb-2">
                  <a href={GITHUB_HASHES_URL} target="_blank" rel="noopener noreferrer" className="text-[#888] hover:text-white transition-colors">
                    {strings.verify.github.viewEndpoint} →
                  </a>
                  <a href={GITHUB_WORKFLOW_URL} target="_blank" rel="noopener noreferrer" className="text-[#888] hover:text-white transition-colors">
                    {strings.verify.github.viewWorkflow} →
                  </a>
                </div>
              )}
            </div>

            {/* Trust levels */}
            <div className="pt-2 border-t border-[#222]">
              <p className="text-sm text-white mb-4">{strings.verify.trustModel.title}</p>
              <div className="space-y-4">
                {['quick', 'independent', 'full'].map((level, i) => (
                  <div key={level} className="flex gap-3">
                    <span className="text-xs text-[#555] font-mono mt-0.5 shrink-0">{i + 1}.</span>
                    <div>
                      <span className="text-xs text-white">{strings.verify.trustModel[level].label}</span>
                      <p className="text-xs text-[#555] mt-0.5">{strings.verify.trustModel[level].description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* DIY section */}
            <div className="pt-2 border-t border-[#222]">
              <p className="text-sm text-white mb-2">{strings.verify.buildYourself.title}</p>
              <p className="text-xs text-[#555] mb-3">{strings.verify.buildYourself.description}</p>
              <pre className="text-xs text-[#888] font-mono bg-[#0a0a0a] border border-[#222] rounded p-4 overflow-x-auto leading-6">
{`git clone https://github.com/alfaoz/justtype.git
cd justtype
npm ci
npm run build
cat dist/build-manifest.json`}
              </pre>
              <p className="text-xs text-[#555] mt-3">{strings.verify.buildYourself.compare}</p>
            </div>

            {/* Curl verify */}
            <div className="pt-2 border-t border-[#222]">
              <p className="text-sm text-white mb-2">{strings.verify.localVerify.title}</p>
              <p className="text-xs text-[#555] mb-3">{strings.verify.localVerify.description}</p>
              <pre className="text-xs text-[#888] font-mono bg-[#0a0a0a] border border-[#222] rounded p-4 overflow-x-auto leading-6">
{`curl -s https://justtype.io/assets/${manifest.jsFile} | sha256sum
curl -s https://justtype.io/assets/${manifest.cssFile} | sha256sum`}
              </pre>
            </div>

          </div>
        )}
      </main>

      <footer className="p-8 text-center border-t border-[#222] mt-16">
        <div className="text-sm opacity-50">
          <a href="/" className="hover:text-white transition-colors">just type</a>
          <span className="mx-2">·</span>
          <a href="https://github.com/alfaoz/justtype" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">github</a>
        </div>
      </footer>
    </div>
  );
}

function HashSection({ label, file, server, gh, ghError, computed, allMatch }) {
  const s = strings.verify.sources;

  const Row = ({ source, hash, ref }) => {
    const match = hash && ref && hash === ref;
    const pending = !hash;
    return (
      <div className="flex items-center justify-between py-2 border-b border-[#222] last:border-0">
        <span className="text-xs text-[#666] w-16 shrink-0">{source}</span>
        <code className={`text-xs font-mono break-all text-right ${
          pending ? 'text-[#444] animate-pulse' :
          hash === 'unavailable' ? 'text-red-400/50' :
          (ref && !match) ? 'text-red-400/80' :
          (ref && match) ? 'text-green-400/70' :
          'text-[#888]'
        }`}>
          {hash || '...'}
        </code>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-white">{label}</span>
        {server && gh && computed && (
          <span className={`text-xs ${allMatch ? 'text-green-400' : 'text-red-400'}`}>
            {allMatch ? '\u2713' : '\u2717'}
          </span>
        )}
      </div>
      <p className="text-xs text-[#555] mb-2 font-mono">{file}</p>
      <div>
        <Row source={s.server} hash={server} ref={computed} />
        <Row source={s.github} hash={ghError ? 'unavailable' : gh} ref={server} />
        <Row source={s.computed} hash={computed} ref={server} />
      </div>
    </div>
  );
}
