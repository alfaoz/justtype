import React from 'react';
import { PageHeader } from './PageHeader';
import { strings } from '../strings';

// This page deliberately does not verify anything itself: a page served by
// justtype.io auditing justtype.io proves nothing against the adversary that
// matters (a compromised server would just serve a page that lies). The real
// checks happen in two places this server cannot reach:
//   - the verified bootstrap (dist/index.html) checks the manifest signature
//     and pins every file with SRI before the app runs; its verdict for THIS
//     page load is on window.__jtIntegrity
//   - the off-origin verifier + scheduled monitor on github infrastructure,
//     built from the public repo (see verify-page/ and scripts/monitor.mjs)
export function Verify() {
  const integrity = typeof window !== 'undefined' ? window.__jtIntegrity : null;

  const banner = integrity
    ? integrity.signed
      ? { color: 'var(--theme-green)', rgb: '74, 222, 128', text: `✓ ${strings.verify.loaderVerified(integrity.version, integrity.files)}` }
      : { color: 'var(--theme-blue)', rgb: '96, 165, 250', text: `✓ ${strings.verify.loaderBeta(integrity.version, integrity.files)}` }
    : { color: 'var(--theme-text-dim)', rgb: '120, 120, 120', text: strings.verify.loaderDev };

  const linkHover = {
    onMouseOver: (e) => e.currentTarget.style.color = 'var(--theme-accent)',
    onMouseOut: (e) => e.currentTarget.style.color = 'var(--theme-text-muted)',
  };

  return (
    <div className="min-h-screen font-mono flex flex-col" style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text-muted)' }}>
      <PageHeader label="verify" />

      <main className="max-w-2xl mx-auto p-4 md:p-8 flex-grow w-full">
        <h1 className="text-xl mb-2" style={{ color: 'var(--theme-accent)' }}>{strings.verify.title}</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--theme-text-dim)' }}>{strings.verify.description}</p>

        <div className="space-y-8">
          <div
            className="text-sm py-3 px-4 rounded border"
            style={{
              color: banner.color,
              borderColor: `rgba(${banner.rgb}, 0.3)`,
              backgroundColor: `rgba(${banner.rgb}, 0.1)`,
            }}
          >
            {banner.text}
          </div>

          <div className="space-y-4 text-sm" style={{ color: 'var(--theme-text-dim)' }}>
            <p>{strings.verify.whyExternal}</p>
            <p>{strings.verify.keyNote}</p>
          </div>

          <a
            href={strings.verify.verifierUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm py-3 px-4 rounded border transition-colors"
            style={{ color: 'var(--theme-accent)', borderColor: 'var(--theme-border)' }}
            onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--theme-text-dim)'}
            onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--theme-border)'}
          >
            {strings.verify.openVerifier} →
          </a>

          <div className="flex gap-6 text-xs flex-wrap">
            <a href="https://github.com/alfaoz/justtype" target="_blank" rel="noopener noreferrer" className="transition-colors" style={{ color: 'var(--theme-text-muted)' }} {...linkHover}>
              {strings.verify.githubSource} →
            </a>
            <a href={strings.verify.releasesLogUrl} target="_blank" rel="noopener noreferrer" className="transition-colors" style={{ color: 'var(--theme-text-muted)' }} {...linkHover}>
              {strings.verify.releasesLog} →
            </a>
          </div>
        </div>
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
