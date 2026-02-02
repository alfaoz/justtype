import React, { useState, useEffect } from 'react';
import { strings } from '../strings';

const GITHUB_HASHES_URL = 'https://alfaoz.github.io/justtype/build-hashes.json';
const GITHUB_WORKFLOW_URL = 'https://github.com/alfaoz/justtype/blob/master/.github/workflows/publish-hashes.yml';

export function Verify() {
  const [manifest, setManifest] = useState(null);
  const [github, setGithub] = useState(null);
  const [githubError, setGithubError] = useState(false);
  const [computedJs, setComputedJs] = useState(null);
  const [computedCss, setComputedCss] = useState(null);
  const [error, setError] = useState(null);
  const [showLocal, setShowLocal] = useState(false);
  const [showBuild, setShowBuild] = useState(false);
  const [showTrust, setShowTrust] = useState(false);

  useEffect(() => {
    verify();
    fetchGithub();
  }, []);

  const verify = async () => {
    try {
      const manifestRes = await fetch('/build-manifest.json');
      if (!manifestRes.ok) throw new Error('manifest not found');
      const data = await manifestRes.json();
      setManifest(data);

      const [jsRes, cssRes] = await Promise.all([
        fetch(`/assets/${data.jsFile}`),
        fetch(`/assets/${data.cssFile}`)
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
      const res = await fetch(GITHUB_HASHES_URL);
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

  // Three-way match checks
  const jsServerGh = manifest && github && manifest.jsHash === github.jsHash;
  const cssServerGh = manifest && github && manifest.cssHash === github.cssHash;
  const jsServerComputed = manifest && computedJs && manifest.jsHash === computedJs;
  const cssServerComputed = manifest && computedCss && manifest.cssHash === computedCss;
  const jsGhComputed = github && computedJs && github.jsHash === computedJs;
  const cssGhComputed = github && computedCss && github.cssHash === computedCss;

  const allMatch = jsServerGh && cssServerGh && jsServerComputed && cssServerComputed && jsGhComputed && cssGhComputed;
  const anyMismatch = manifest && computedJs && computedCss && github && !allMatch;
  const loading = !error && (!manifest || computedJs === null || computedCss === null);

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="min-h-screen bg-[#111111] text-[#a0a0a0] flex flex-col">
      <header className="p-8 border-b border-[#222]">
        <a href="/" className="text-xl font-medium text-[#808080] hover:text-white transition-colors">
          + just type
        </a>
      </header>

      <main className="max-w-2xl mx-auto p-8 flex-grow w-full">
        <h1 className="text-xl text-white mb-2">{strings.verify.title}</h1>
        <p className="text-sm text-[#888] mb-8">{strings.verify.description}</p>

        {error && (
          <div className="text-red-400 text-sm mb-6">{strings.verify.error}</div>
        )}

        {!manifest && !error && (
          <div className="text-[#666] text-sm animate-pulse">{strings.verify.computing}</div>
        )}

        {manifest && (
          <div className="space-y-6">
            {/* Status */}
            <div className={`flex items-center gap-3 p-4 rounded border ${
              loading || (!github && !githubError) ? 'border-[#333] text-[#888]' :
              allMatch ? 'border-green-800/50 text-green-400' :
              anyMismatch ? 'border-red-800/50 text-red-400' :
              'border-[#333] text-[#888]'
            }`}>
              {loading ? (
                <span className="animate-pulse">{strings.verify.computing}</span>
              ) : allMatch ? (
                <>
                  <span className="text-lg">&#10003;</span>
                  <span className="text-sm">{strings.verify.verified}</span>
                </>
              ) : anyMismatch ? (
                <>
                  <span className="text-lg">&#10007;</span>
                  <span className="text-sm">{strings.verify.mismatch}</span>
                </>
              ) : (
                <span className="text-sm animate-pulse">{strings.verify.computing}</span>
              )}
            </div>

            {/* Version info */}
            <div className="text-sm text-[#666]">
              {strings.verify.version(manifest.version)}
              <span className="mx-2">·</span>
              {strings.verify.buildDate(formatDate(manifest.buildDate))}
            </div>

            {/* Three-way hash comparison */}
            <div className="space-y-4">
              <HashComparison
                label={strings.verify.jsBundle}
                file={manifest.jsFile}
                server={manifest.jsHash}
                gh={github?.jsHash}
                ghError={githubError}
                computed={computedJs}
              />
              <HashComparison
                label={strings.verify.cssBundle}
                file={manifest.cssFile}
                server={manifest.cssHash}
                gh={github?.cssHash}
                ghError={githubError}
                computed={computedCss}
              />
            </div>

            {/* GitHub Actions info */}
            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-white">{strings.verify.github.label}</span>
                {github && (
                  <span className="text-xs text-green-400">&#10003;</span>
                )}
                {githubError && (
                  <span className="text-xs text-red-400">&#10007;</span>
                )}
              </div>
              <p className="text-xs text-[#555] mb-2">{strings.verify.github.hostedOn}</p>
              {githubError ? (
                <p className="text-xs text-red-400/70">{strings.verify.github.error}</p>
              ) : (
                <div className="flex gap-4">
                  <a
                    href={GITHUB_HASHES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#888] hover:text-white transition-colors"
                  >
                    {strings.verify.github.viewEndpoint} →
                  </a>
                  <a
                    href={GITHUB_WORKFLOW_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#888] hover:text-white transition-colors"
                  >
                    {strings.verify.github.viewWorkflow} →
                  </a>
                </div>
              )}
            </div>

            {/* GitHub release link */}
            <a
              href={`https://github.com/alfaoz/justtype/releases/tag/v${manifest.version}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-[#888] hover:text-white transition-colors"
            >
              {strings.verify.githubRelease} →
            </a>

            {/* Trust model */}
            <CollapsibleSection
              title={strings.verify.trustModel.title}
              open={showTrust}
              onToggle={() => setShowTrust(!showTrust)}
            >
              <div className="space-y-3">
                {['quick', 'independent', 'full'].map((level) => (
                  <div key={level}>
                    <span className="text-xs text-white">{strings.verify.trustModel[level].label}</span>
                    <p className="text-xs text-[#666] mt-0.5">{strings.verify.trustModel[level].description}</p>
                  </div>
                ))}
              </div>
            </CollapsibleSection>

            {/* Local verification */}
            <CollapsibleSection
              title={strings.verify.localVerify.title}
              open={showLocal}
              onToggle={() => setShowLocal(!showLocal)}
            >
              <p className="text-xs text-[#666] mb-3">{strings.verify.localVerify.description}</p>
              <div className="space-y-2">
                <CodeBlock value={`curl -s https://justtype.io/assets/${manifest.jsFile} | sha256sum`} />
                <CodeBlock value={`curl -s https://justtype.io/assets/${manifest.cssFile} | sha256sum`} />
              </div>
            </CollapsibleSection>

            {/* Build it yourself */}
            <CollapsibleSection
              title={strings.verify.buildYourself.title}
              open={showBuild}
              onToggle={() => setShowBuild(!showBuild)}
            >
              <p className="text-xs text-[#666] mb-3">{strings.verify.buildYourself.description}</p>
              <div className="space-y-2">
                <CodeBlock value="git clone https://github.com/alfaoz/justtype.git" />
                <CodeBlock value="cd justtype && npm ci && npm run build" />
                <CodeBlock value="cat dist/build-manifest.json" />
              </div>
              <p className="text-xs text-[#555] mt-3">{strings.verify.buildYourself.compare}</p>
            </CollapsibleSection>
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

function HashComparison({ label, file, server, gh, ghError, computed }) {
  const allThree = server && gh && computed;
  const allMatch = allThree && server === gh && gh === computed;

  const hashRow = (source, hash, refHash) => {
    const match = hash && refHash && hash === refHash;
    const pending = !hash;
    return (
      <div className="flex gap-2 items-baseline">
        <span className="text-xs text-[#666] w-20 shrink-0">{source}</span>
        <code className={`text-xs font-mono break-all ${
          pending ? 'text-[#555] animate-pulse' :
          (refHash && !match) ? 'text-red-400/80' :
          (refHash && match) ? 'text-green-400/80' :
          'text-[#888]'
        }`}>
          {hash || '...'}
        </code>
      </div>
    );
  };

  return (
    <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-white">{label}</span>
        {allThree && (
          <span className={`text-xs ${allMatch ? 'text-green-400' : 'text-red-400'}`}>
            {allMatch ? '\u2713' : '\u2717'}
          </span>
        )}
      </div>
      <div className="text-xs text-[#555] mb-2">{file}</div>
      <div className="space-y-1">
        {hashRow(strings.verify.sources.server, server, computed)}
        {hashRow(strings.verify.sources.github, ghError ? 'unavailable' : gh, server)}
        {hashRow(strings.verify.sources.computed, computed, server)}
      </div>
    </div>
  );
}

function CollapsibleSection({ title, open, onToggle, children }) {
  return (
    <div className="border border-[#333] rounded">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-sm text-[#888] hover:text-white transition-colors"
      >
        <span>{title}</span>
        <span className="text-[#666]">{open ? '\u2212' : '+'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-[#333] pt-3">
          {children}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ value }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {}
  };

  return (
    <div className="bg-[#111] border border-[#333] rounded p-3 flex items-center justify-between gap-2">
      <code className="text-xs text-[#888] font-mono break-all">{value}</code>
      <button
        onClick={handleCopy}
        className="text-xs text-[#666] hover:text-white transition-colors shrink-0"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}
