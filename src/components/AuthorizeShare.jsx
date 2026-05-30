import React, { useState, useEffect, useRef } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';
import { enableShareAll } from '../shareAll';

// Inline consent → share handoff. The OAuth consent screen redirected here after
// the user ticked "allow full access". We wrap every private slate to the app
// (client-side, with the user's master key), then finalize: the server mints the
// one-time code now and hands back the app's redirect URL, which we follow. If the
// browser isn't unlocked we skip wrapping (the share-all intent is already recorded
// server-side, so future slates share and existing ones fill in on next unlock) and
// still complete the authorization rather than stranding the user.
export function AuthorizeShare() {
  const s = strings.account.authorizeShare;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t') || '';
  const clientId = params.get('client_id') || '';
  const appName = params.get('app') || 'the app';
  const [phase, setPhase] = useState('sharing'); // 'sharing' | 'finishing' | 'error'
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const ran = useRef(false);

  // Mint the code and follow the app redirect. Always attempted, even if wrapping
  // failed, so the user is never stuck mid-authorization.
  const finalize = async () => {
    setPhase('finishing');
    // The authorize family lives at /oauth/... (no /api prefix), unlike resource
    // endpoints. Strip the trailing /api so this resolves to /oauth/authorize/finalize.
    const oauthBase = API_URL.replace(/\/api$/, '');
    const res = await fetch(`${oauthBase}/oauth/authorize/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ t: token })
    });
    const data = await res.json();
    if (!res.ok || !data.redirect) throw new Error(data.error_description || data.error || s.finalizeError);
    window.location.replace(data.redirect);
  };

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) { setError(s.missing); setPhase('error'); return; }
    (async () => {
      try {
        const me = await fetch(`${API_URL}/auth/me`, { credentials: 'include' });
        if (!me.ok) throw new Error('session');
        const { id } = await me.json();
        try {
          await enableShareAll(clientId, id, { onProgress: setProgress });
        } catch (e) {
          if (e.message === 'locked') setLocked(true);   // proceed without wrapping
          else throw e;
        }
        await finalize();
      } catch (e) {
        // Last-ditch: if only the wrapping failed, still try to complete auth.
        try { await finalize(); }
        catch (e2) { setError(e2.message || s.finalizeError); setPhase('error'); }
      }
    })();
  }, []);

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#0a0a0a]">
      <div className="w-full max-w-md bg-[#111] border border-[#222] rounded-xl p-8 text-center">
        {phase === 'error' ? (
          <>
            <h1 className="text-lg text-white mb-2">{s.errorTitle}</h1>
            <p className="text-[#888] text-sm leading-relaxed">{error}</p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-5 w-8 h-8 border-2 border-[#333] border-t-white rounded-full animate-spin" />
            <h1 className="text-lg text-white mb-2">
              {phase === 'finishing' ? s.finishing(appName) : s.sharing(appName)}
            </h1>
            <p className="text-[#888] text-sm leading-relaxed">
              {locked ? s.lockedNote(appName)
                : phase === 'finishing' ? s.finishingNote
                : progress.total > 0 ? s.progress(progress.done, progress.total) : s.preparing}
            </p>
            {!locked && phase === 'sharing' && progress.total > 0 && (
              <div className="mt-4 h-1.5 bg-[#1f1f1f] rounded-full overflow-hidden">
                <div className="h-full bg-white transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            )}
            <p className="text-[#555] text-xs mt-5">{s.dontClose}</p>
          </>
        )}
      </div>
    </div>
  );
}
