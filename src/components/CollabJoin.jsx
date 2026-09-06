import React, { useState, useEffect } from 'react';
import { strings } from '../strings';
import { resolveInviteLink, joinViaLink, fragmentToKey } from '../collab';

// Join page for collab invite links (/join/<token>#k=<doc key>). The token
// authenticates against the server; the key lives in the fragment and is
// parsed right here in the browser — it is never sent anywhere. Joining wraps
// it to the member's master key, then the slate opens like any shared slate.

const goHome = () => {
  window.history.pushState({}, '', '/');
  window.dispatchEvent(new PopStateEvent('popstate'));
};

const openShared = (slateId) => {
  window.history.pushState({}, '', `/shared/${slateId}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export function CollabJoin({ token, userId, onLogin }) {
  const s = strings.collab.join;
  const [state, setState] = useState('loading'); // loading | ready | invalid | missing-key
  const [info, setInfo] = useState(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');

  const linkToken = window.location.pathname.split('/join/')[1] || '';
  const keyMatch = window.location.hash.match(/[#&]k=([A-Za-z0-9_-]+)/);
  const fragmentKey = keyMatch ? keyMatch[1] : null;

  useEffect(() => {
    if (!token || token === 'checking') return;
    if (!linkToken || !fragmentKey) {
      setState('missing-key');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await resolveInviteLink(linkToken, fragmentToKey(fragmentKey));
        if (cancelled) return;
        setInfo(data);
        setState('ready');
      } catch (e) {
        if (cancelled) return;
        setState('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token, linkToken, fragmentKey]);

  const handleJoin = async () => {
    if (joining) return;
    setJoining(true);
    setError('');
    try {
      if (info && info.alreadyMember) {
        openShared(info.slateId);
        return;
      }
      const { slateId } = await joinViaLink(linkToken, fragmentToKey(fragmentKey), userId);
      openShared(slateId);
    } catch (e) {
      setError(String(e.message || 'failed to join').toLowerCase());
      setJoining(false);
    }
  };

  return (
    <div className="h-screen bg-[var(--theme-bg)] text-[var(--theme-text-muted)] font-mono selection:bg-[var(--theme-border)] selection:text-white flex flex-col overflow-hidden">
      <style>{`
        html, body, #root { height: 100%; overflow: hidden; }
        body { font-family: 'IBM Plex Mono', monospace; background-color: var(--theme-bg, #111111); margin: 0; }
      `}</style>

      <header className="p-4 md:p-8 flex justify-between items-center border-b border-[var(--theme-border-light)]">
        <button type="button" onClick={goHome} className="text-lg md:text-xl font-medium text-[var(--theme-text-muted)] hover:text-white transition-colors select-none">
          {strings.app.logo}
        </button>
      </header>

      <main className="flex-grow flex items-center justify-center p-4">
        <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full animate-modal-content">
          {!token || token === 'checking' ? (
            <>
              <h1 className="text-lg md:text-xl text-white mb-4">{s.title}</h1>
              <p className="text-sm text-[var(--theme-text-muted)] mb-6">{s.loginFirst}</p>
              <button
                onClick={onLogin}
                className="w-full bg-white text-black py-2 md:py-3 rounded hover:bg-[#e5e5e5] transition-all text-sm font-medium"
              >
                {s.login}
              </button>
            </>
          ) : state === 'loading' ? (
            <p className="text-sm text-[var(--theme-text-dim)] animate-pulse">{s.checking}</p>
          ) : state === 'ready' ? (
            <>
              <h1 className="text-lg md:text-xl text-white mb-1">{info.title || s.untitled}</h1>
              <p className="text-sm text-[var(--theme-text-dim)] mb-6">{s.by(info.owner)}</p>
              <p className="text-sm text-[var(--theme-text-muted)] mb-6">{info.alreadyMember ? s.alreadyMember : s.explainer}</p>
              {error && <p className="text-sm mb-4" style={{ color: 'var(--theme-red)' }}>{error}</p>}
              <div className="flex gap-3">
                <button
                  onClick={handleJoin}
                  disabled={joining}
                  className="flex-1 bg-white text-black py-2 md:py-3 rounded hover:bg-[#e5e5e5] transition-all text-sm font-medium disabled:opacity-50"
                >
                  {joining ? s.joining : (info.alreadyMember ? s.open : s.join)}
                </button>
                <button
                  onClick={goHome}
                  className="flex-1 border border-[var(--theme-border)] py-2 md:py-3 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
                >
                  {s.decline}
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-lg md:text-xl text-white mb-4">{s.title}</h1>
              <p className="text-sm text-[var(--theme-text-muted)] mb-6">
                {state === 'missing-key' ? s.missingKey : s.invalid}
              </p>
              <button
                onClick={goHome}
                className="w-full border border-[var(--theme-border)] py-2 md:py-3 rounded hover:bg-[var(--theme-bg-tertiary)] hover:text-white transition-all text-sm"
              >
                {s.back}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
