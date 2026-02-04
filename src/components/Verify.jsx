import React, { useState, useEffect, useRef } from 'react';
import { strings } from '../strings';

const GITHUB_HASHES_URL = 'https://alfaoz.github.io/justtype/build-hashes.json';
const GITHUB_WORKFLOW_URL = 'https://github.com/alfaoz/justtype/blob/master/.github/workflows/publish-hashes.yml';
const GITHUB_RUNS_URL = 'https://api.github.com/repos/alfaoz/justtype/actions/workflows/publish-hashes.yml/runs?per_page=1';
const GITHUB_LATEST_COMMIT_URL = 'https://github.com/alfaoz/justtype/commit/HEAD';

const bustCache = (url) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

export function Verify() {
  const [manifest, setManifest] = useState(null);
  const [github, setGithub] = useState(null);
  const [githubError, setGithubError] = useState(false);
  const [computedJs, setComputedJs] = useState(null);
  const [computedCss, setComputedCss] = useState(null);
  const [error, setError] = useState(null);
  const [polling, setPolling] = useState(false);
  const [actionsStatus, setActionsStatus] = useState(null); // 'running' | 'completed' | 'failed' | null
  const pollRef = useRef(null);
  const manifestRef = useRef(null);

  useEffect(() => {
    verify();
    fetchGithub();
    fetchActionsStatus();
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

  const fetchActionsStatus = async () => {
    try {
      const res = await fetch(GITHUB_RUNS_URL);
      if (!res.ok) return;
      const data = await res.json();
      const run = data.workflow_runs?.[0];
      if (!run) return;
      if (run.status === 'queued' || run.status === 'in_progress' || run.status === 'waiting') {
        setActionsStatus('running');
      } else if (run.conclusion === 'success') {
        setActionsStatus('completed');
      } else {
        setActionsStatus('failed');
      }
    } catch {}
  };

  const bufToHex = (buf) => {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const jsAllMatch = manifest && github && computedJs && manifest.jsHash === github.jsHash && github.jsHash === computedJs;
  const cssAllMatch = manifest && github && computedCss && manifest.cssHash === github.cssHash && github.cssHash === computedCss;
  const allMatch = jsAllMatch && cssAllMatch;
  const serverMatch = manifest && computedJs && computedCss && manifest.jsHash === computedJs && manifest.cssHash === computedCss;
  const done = manifest && computedJs && computedCss && (github || githubError);
  const serverOkGithubOff = done && serverMatch && !allMatch;
  const actionsRunning = serverOkGithubOff && (actionsStatus === 'running' || actionsStatus === null);
  const actionsFailed = serverOkGithubOff && actionsStatus === 'failed';
  const actionsCompletedMismatch = serverOkGithubOff && actionsStatus === 'completed';
  const realMismatch = done && !serverMatch;

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
    <div className="min-h-screen font-mono flex flex-col" style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text-muted)' }}>
      <header className="p-8 border-b" style={{ borderColor: 'var(--theme-border-light)' }}>
        <a href="/" className="text-lg md:text-xl font-medium transition-colors" style={{ color: 'var(--theme-text-dim)' }} onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}>
          + just type
        </a>
      </header>

      <main className="max-w-2xl mx-auto p-4 md:p-8 flex-grow w-full">
        <h1 className="text-xl mb-2" style={{ color: 'var(--theme-accent)' }}>{strings.verify.title}</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--theme-text-dim)' }}>{strings.verify.description}</p>

        {error && (
          <div className="text-sm mb-6" style={{ color: 'var(--theme-red)' }}>{strings.verify.error}</div>
        )}

        {!manifest && !error && (
          <div className="text-sm animate-pulse" style={{ color: 'var(--theme-text-dim)' }}>{strings.verify.computing}</div>
        )}

        {manifest && (
          <div className="space-y-8">

            {/* Status banner */}
            <div
              className="text-sm py-3 px-4 rounded border"
              style={{
                borderColor: !done ? 'var(--theme-border)' :
                  allMatch ? 'rgba(var(--theme-green-rgb, 74, 222, 128), 0.3)' :
                  actionsRunning ? 'rgba(var(--theme-orange-rgb, 251, 146, 60), 0.3)' :
                  'rgba(var(--theme-red-rgb, 248, 113, 113), 0.3)',
                backgroundColor: !done ? 'transparent' :
                  allMatch ? 'rgba(74, 222, 128, 0.1)' :
                  actionsRunning ? 'rgba(251, 146, 60, 0.1)' :
                  'rgba(248, 113, 113, 0.1)',
                color: !done ? 'var(--theme-text-muted)' :
                  allMatch ? 'var(--theme-green)' :
                  actionsRunning ? 'var(--theme-orange)' :
                  'var(--theme-red)'
              }}
            >
              {!done ? (
                <span className="animate-pulse">{strings.verify.computing}</span>
              ) : allMatch ? (
                <span>&#10003; {strings.verify.verified}</span>
              ) : actionsRunning ? (
                <span className="flex items-center justify-between flex-wrap gap-2">
                  <span className="animate-pulse">{strings.verify.actionsRunning}</span>
                  <a href="/status" className="underline underline-offset-2" style={{ color: 'var(--theme-orange)', opacity: 0.7 }}>check status</a>
                </span>
              ) : actionsFailed ? (
                <span className="flex items-center justify-between flex-wrap gap-2">
                  <span>{strings.verify.actionsFailed}</span>
                  <a href="/status" className="underline underline-offset-2" style={{ opacity: 0.7 }}>check status</a>
                </span>
              ) : actionsCompletedMismatch ? (
                <span className="flex items-center justify-between flex-wrap gap-2">
                  <span>&#10007; {strings.verify.actionsHashMismatch}</span>
                  <a href="/status" className="underline underline-offset-2" style={{ opacity: 0.7 }}>check status</a>
                </span>
              ) : (
                <span className="flex items-center justify-between flex-wrap gap-2">
                  <span>&#10007; {strings.verify.mismatch}</span>
                  <a href="/status" className="underline underline-offset-2" style={{ opacity: 0.7 }}>check status</a>
                </span>
              )}
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--theme-text-dim)' }}>
              <span>{strings.verify.version(manifest.version)}</span>
              <span className="group relative cursor-default">
                <span className="font-mono">{toUnix(manifest.buildDate)}</span>
                <span className="ml-1" style={{ color: 'var(--theme-text-dim)' }}>({timeAgo(manifest.buildDate)})</span>
                <span className="absolute bottom-full left-0 mb-1 px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border)', color: 'var(--theme-text-muted)' }}>
                  {formatFull(manifest.buildDate)}
                </span>
              </span>
              <a
                href="https://github.com/alfaoz/justtype"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors ml-auto"
                style={{ color: 'var(--theme-text-muted)' }}
                onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'}
                onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-muted)'}
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
            <div className="pt-2 border-t" style={{ borderColor: 'var(--theme-border-light)' }}>
              <div className="flex items-center justify-between py-3">
                <div>
                  <span className="text-sm" style={{ color: 'var(--theme-accent)' }}>{strings.verify.github.label}</span>
                  <p className="text-xs mt-1" style={{ color: 'var(--theme-text-dim)' }}>{strings.verify.github.hostedOn}</p>
                </div>
                {github && !polling && <span className="text-xs" style={{ color: 'var(--theme-green)' }}>&#10003;</span>}
                {polling && <span className="text-xs animate-pulse" style={{ color: 'var(--theme-orange)' }}>{actionsStatus === 'running' ? 'actions running...' : actionsStatus === 'failed' ? 'actions failed' : 'waiting...'}</span>}
                {githubError && !polling && <span className="text-xs" style={{ color: 'var(--theme-red)' }}>&#10007;</span>}
              </div>
              {githubError ? (
                <p className="text-xs pb-2" style={{ color: 'var(--theme-red)', opacity: 0.6 }}>{strings.verify.github.error}</p>
              ) : (
                <div className="flex gap-6 text-xs pb-2 flex-wrap">
                  <a href={GITHUB_HASHES_URL} target="_blank" rel="noopener noreferrer" className="transition-colors" style={{ color: 'var(--theme-text-muted)' }} onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-muted)'}>
                    {strings.verify.github.viewEndpoint} →
                  </a>
                  <a href={GITHUB_WORKFLOW_URL} target="_blank" rel="noopener noreferrer" className="transition-colors" style={{ color: 'var(--theme-text-muted)' }} onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-muted)'}>
                    {strings.verify.github.viewWorkflow} →
                  </a>
                  <a href={GITHUB_LATEST_COMMIT_URL} target="_blank" rel="noopener noreferrer" className="transition-colors" style={{ color: 'var(--theme-text-muted)' }} onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-muted)'}>
                    {strings.verify.github.viewLatestCommit} →
                  </a>
                </div>
              )}
            </div>

            {/* Trust levels */}
            <div className="pt-2 border-t" style={{ borderColor: 'var(--theme-border-light)' }}>
              <p className="text-sm mb-4" style={{ color: 'var(--theme-accent)' }}>{strings.verify.trustModel.title}</p>
              <div className="space-y-4">
                {['quick', 'independent', 'full'].map((level, i) => (
                  <div key={level} className="flex gap-3">
                    <span className="text-xs font-mono mt-0.5 shrink-0" style={{ color: 'var(--theme-text-dim)' }}>{i + 1}.</span>
                    <div>
                      <span className="text-xs" style={{ color: 'var(--theme-accent)' }}>{strings.verify.trustModel[level].label}</span>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--theme-text-dim)' }}>{strings.verify.trustModel[level].description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* DIY section */}
            <div className="pt-2 border-t" style={{ borderColor: 'var(--theme-border-light)' }}>
              <p className="text-sm mb-2" style={{ color: 'var(--theme-accent)' }}>{strings.verify.buildYourself.title}</p>
              <p className="text-xs mb-3" style={{ color: 'var(--theme-text-dim)' }}>{strings.verify.buildYourself.description}</p>
              <pre className="text-xs font-mono rounded p-4 overflow-x-auto leading-6" style={{ color: 'var(--theme-text-muted)', backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-light)' }}>
{`git clone https://github.com/alfaoz/justtype.git
cd justtype
npm ci
npm run build
cat dist/build-manifest.json`}
              </pre>
              <p className="text-xs mt-3" style={{ color: 'var(--theme-text-dim)' }}>{strings.verify.buildYourself.compare}</p>
            </div>

            {/* Curl verify */}
            <div className="pt-2 border-t" style={{ borderColor: 'var(--theme-border-light)' }}>
              <p className="text-sm mb-2" style={{ color: 'var(--theme-accent)' }}>{strings.verify.localVerify.title}</p>
              <p className="text-xs mb-3" style={{ color: 'var(--theme-text-dim)' }}>{strings.verify.localVerify.description}</p>
              <pre className="text-xs font-mono rounded p-4 overflow-x-auto leading-6" style={{ color: 'var(--theme-text-muted)', backgroundColor: 'var(--theme-bg-secondary)', border: '1px solid var(--theme-border-light)' }}>
{`curl -s https://justtype.io/assets/${manifest.jsFile} | sha256sum
curl -s https://justtype.io/assets/${manifest.cssFile} | sha256sum`}
              </pre>
            </div>

          </div>
        )}
      </main>

      <footer className="p-8 text-center mt-16" style={{ borderTop: '1px solid var(--theme-border-light)' }}>
        <div className="text-sm" style={{ color: 'var(--theme-text-dim)' }}>
          <a href="/" className="transition-colors" onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}>just type</a>
          <span className="mx-2">·</span>
          <a href="https://github.com/alfaoz/justtype" target="_blank" rel="noopener noreferrer" className="transition-colors" onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}>github</a>
          <span className="mx-2">·</span>
          <a href="/status" className="transition-colors" onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}>status</a>
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

    const getHashColor = () => {
      if (pending) return 'var(--theme-text-dim)';
      if (hash === 'unavailable') return 'var(--theme-red)';
      if (ref && !match) return 'var(--theme-red)';
      if (ref && match) return 'var(--theme-green)';
      return 'var(--theme-text-muted)';
    };

    return (
      <div className="flex items-center justify-between py-2 last:border-0" style={{ borderBottom: '1px solid var(--theme-border-light)' }}>
        <span className="text-xs w-16 shrink-0" style={{ color: 'var(--theme-text-dim)' }}>{source}</span>
        <code
          className={`text-xs font-mono break-all text-right ${pending ? 'animate-pulse' : ''}`}
          style={{ color: getHashColor(), opacity: (hash === 'unavailable' || (ref && !match)) ? 0.8 : (ref && match) ? 0.85 : 1 }}
        >
          {hash || '...'}
        </code>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm" style={{ color: 'var(--theme-accent)' }}>{label}</span>
        {server && gh && computed && (
          <span className="text-xs" style={{ color: allMatch ? 'var(--theme-green)' : 'var(--theme-red)' }}>
            {allMatch ? '\u2713' : '\u2717'}
          </span>
        )}
      </div>
      <p className="text-xs mb-2 font-mono" style={{ color: 'var(--theme-text-dim)' }}>{file}</p>
      <div>
        <Row source={s.server} hash={server} ref={computed} />
        <Row source={s.github} hash={ghError ? 'unavailable' : gh} ref={server} />
        <Row source={s.computed} hash={computed} ref={server} />
      </div>
    </div>
  );
}
