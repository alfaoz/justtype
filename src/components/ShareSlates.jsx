import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';
import { getSlateKey } from '../keyStore';
import { decryptContent, decryptTitle, importAppPublicKey, reencryptForApp } from '../crypto';

// Modal for controlling which private slates a connected app can read and write.
// The streamlined default is "allow all" — one switch shares every private slate
// (current + future). A collapsible "specific slates" section keeps granular
// control. All crypto runs here in the browser: each shared slate is decrypted
// with the user's master key, re-encrypted under a fresh content key, and that
// key is wrapped to BOTH the app's public key (so the app can read) and the
// user's master key (so app edits can sync back). justtype only stores blobs.
export function ShareSlates({ clientId, appName, userId, onClose, onChanged }) {
  const s = strings.account.shareSlates;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [slates, setSlates] = useState([]);          // [{ slate_number, title }]
  const [shared, setShared] = useState(new Set());    // slate_numbers currently shared
  const [busy, setBusy] = useState(new Set());        // slate_numbers mid-toggle
  const [appKey, setAppKey] = useState(null);         // imported public key
  const [slateKey, setSlateKey] = useState(null);     // user's master key
  const [shareAll, setShareAll] = useState(false);    // blanket access on/off
  const [bulk, setBulk] = useState(null);             // { done, total } | 'off' while working
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mk = userId ? await getSlateKey(userId) : null;
        if (!mk) { if (!cancelled) { setError(s.locked); setLoading(false); } return; }

        const [grantRes, listRes] = await Promise.all([
          fetch(`${API_URL}/account/slate-grants/${encodeURIComponent(clientId)}`, { credentials: 'include' }),
          fetch(`${API_URL}/slates`, { credentials: 'include' })
        ]);
        const grantData = await grantRes.json();
        const listData = await listRes.json();
        if (!grantRes.ok) throw new Error(grantData.error || 'not grantable');
        if (!listRes.ok) throw new Error(listData.error || 'failed to load slates');

        const pubKey = await importAppPublicKey(grantData.public_key);
        const sharedSet = new Set((grantData.shared || []).map((g) => g.slate_number));

        // Only private (unpublished) slates — published ones are already readable
        // via the public scope. Decrypt titles for display.
        const all = Array.isArray(listData) ? listData : [];
        const privateSlates = [];
        for (const meta of all) {
          if (meta.is_published) continue;
          let title = (meta.title || '').trim();
          if ((!title || title === 'untitled') && meta.encrypted_title) {
            try { title = (await decryptTitle(meta.encrypted_title, mk)).trim(); } catch { title = ''; }
          }
          privateSlates.push({ slate_number: meta.slate_number, title: title || s.untitled });
        }
        privateSlates.sort((a, b) => b.slate_number - a.slate_number);

        if (!cancelled) {
          setSlateKey(mk);
          setAppKey(pubKey);
          setShared(sharedSet);
          setSlates(privateSlates);
          setShareAll(!!grantData.share_all);
          setShowAdvanced(!grantData.share_all && sharedSet.size > 0);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) { setError(e.message || s.loadError); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, userId]);

  const setBusyFor = (n, on) => setBusy((prev) => {
    const next = new Set(prev);
    if (on) next.add(n); else next.delete(n);
    return next;
  });

  // Fetch slate n, decrypt with the master key, re-encrypt for the app (+ owner).
  // Returns the grant payload without uploading, so callers can batch.
  const wrapOne = async (n) => {
    const res = await fetch(`${API_URL}/slates/${encodeURIComponent(n)}`, { credentials: 'include' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || s.toggleError);
    const content = data.encryptedContent
      ? await decryptContent(data.encryptedContent, slateKey)
      : (typeof data.content === 'string' ? data.content : '');
    let title = (data.title || '').trim();
    const encTitle = data.encrypted_title;
    if ((!title || title === 'untitled') && encTitle) {
      try { title = (await decryptTitle(encTitle, slateKey)).trim(); } catch { title = ''; }
    }
    const grant = await reencryptForApp(content, title, appKey, slateKey);
    return { slate_number: n, ...grant };
  };

  // Single-slate share (advanced per-slate toggle).
  const shareOne = async (n) => {
    const grant = await wrapOne(n);
    const up = await fetch(`${API_URL}/account/slate-grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ client_id: clientId, ...grant })
    });
    if (!up.ok) throw new Error(s.toggleError);
  };

  const unshareOne = async (n) => {
    const res = await fetch(`${API_URL}/account/slate-grants`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ client_id: clientId, slate_number: n })
    });
    if (!res.ok) throw new Error(s.toggleError);
  };

  // Per-slate toggle (advanced section).
  const toggle = async (n) => {
    if (busy.has(n)) return;
    setError('');
    setBusyFor(n, true);
    try {
      if (shared.has(n)) {
        await unshareOne(n);
        setShared((prev) => { const x = new Set(prev); x.delete(n); return x; });
      } else {
        await shareOne(n);
        setShared((prev) => { const x = new Set(prev); x.add(n); return x; });
      }
      onChanged?.();
    } catch (e) {
      setError(e.message || s.toggleError);
    } finally {
      setBusyFor(n, false);
    }
  };

  // Blanket access: record intent, then wrap every private slate. Wrapping runs
  // in small concurrent batches (network-bound) and each batch uploads in a single
  // request, so sharing a large library takes seconds rather than one slate at a time.
  const enableAll = async () => {
    setError('');
    const todo = slates.map((sl) => sl.slate_number).filter((n) => !shared.has(n));
    setBulk({ done: 0, total: todo.length });
    try {
      const flag = await fetch(`${API_URL}/account/slate-grants/share-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ client_id: clientId })
      });
      if (!flag.ok) throw new Error(s.toggleError);

      const next = new Set(shared);
      const CONCURRENCY = 8;
      let done = 0;
      for (let i = 0; i < todo.length; i += CONCURRENCY) {
        const chunk = todo.slice(i, i + CONCURRENCY);
        const wrapped = await Promise.all(chunk.map(async (n) => {
          try { return await wrapOne(n); } catch (e) { console.warn('wrap failed for', n, e); return null; }
        }));
        const ok = wrapped.filter(Boolean);
        if (ok.length) {
          const up = await fetch(`${API_URL}/account/slate-grants/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ client_id: clientId, grants: ok })
          });
          if (up.ok) ok.forEach((g) => next.add(g.slate_number));
        }
        done += chunk.length;
        setBulk({ done, total: todo.length });
      }
      setShared(next);
      setShareAll(true);
      setShowAdvanced(false);
      onChanged?.();
    } catch (e) {
      setError(e.message || s.toggleError);
    } finally {
      setBulk(null);
    }
  };

  // Turn off blanket access: server drops the flag and all grants in one call.
  const disableAll = async () => {
    setError('');
    setBulk('off');
    try {
      const res = await fetch(`${API_URL}/account/slate-grants/share-all`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ client_id: clientId })
      });
      if (!res.ok) throw new Error(s.toggleError);
      setShared(new Set());
      setShareAll(false);
      onChanged?.();
    } catch (e) {
      setError(e.message || s.toggleError);
    } finally {
      setBulk(null);
    }
  };

  const working = bulk !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div className="bg-[#111] border border-[#333] rounded-lg w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-[#333]">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-white text-sm">{s.title}</h3>
            <button onClick={onClose} className="text-[#666] hover:text-white text-sm">✕</button>
          </div>
          <p className="text-xs text-[#666] mt-1">{s.subtitle(appName)}</p>
        </div>

        <div className="p-4 overflow-y-auto">
          {loading ? (
            <p className="text-[#666] text-sm">{s.loading}</p>
          ) : error && slates.length === 0 ? (
            <p className="text-red-400 text-sm">{error}</p>
          ) : slates.length === 0 ? (
            <p className="text-[#666] text-sm">{s.none}</p>
          ) : (
            <div className="space-y-4">
              {/* master switch: all private slates */}
              <div className="flex items-start gap-3 rounded-lg border border-[#333] bg-[#1a1a1a] px-3.5 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[#d4d4d4]">{s.allTitle}</div>
                  <div className="text-xs text-[#666] mt-1 leading-relaxed">{s.allDesc}</div>
                  {bulk && bulk !== 'off' && (
                    <div className="text-xs text-[#888] mt-2">{s.sharingAll(bulk.done, bulk.total)}</div>
                  )}
                  {bulk === 'off' && <div className="text-xs text-[#888] mt-2">{s.unsharingAll}</div>}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={shareAll}
                  disabled={working}
                  onClick={() => (shareAll ? disableAll() : enableAll())}
                  className={`shrink-0 mt-0.5 w-11 h-6 rounded-full border transition-colors disabled:opacity-50 relative ${
                    shareAll ? 'bg-white border-white' : 'bg-[#0a0a0a] border-[#444]'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    shareAll ? 'left-[1.4rem] bg-black' : 'left-0.5 bg-[#666]'
                  }`} />
                </button>
              </div>

              {/* advanced: specific slates (hidden while full access is on) */}
              {!shareAll && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="flex items-center gap-2 text-xs text-[#808080] hover:text-[#d4d4d4] transition-colors"
                  >
                    <span>{showAdvanced ? '−' : '+'}</span>
                    <span>{s.advanced}</span>
                  </button>
                  {showAdvanced && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-xs text-[#666] mb-2">{s.advancedHint}</p>
                      {slates.map((sl) => {
                        const on = shared.has(sl.slate_number);
                        const wk = busy.has(sl.slate_number);
                        return (
                          <button
                            key={sl.slate_number}
                            onClick={() => toggle(sl.slate_number)}
                            disabled={wk || working}
                            className={`w-full text-left flex items-center gap-3 rounded px-3 py-2 border transition-colors disabled:opacity-60 ${
                              on ? 'border-[#333] bg-[#1a1a1a]' : 'border-transparent hover:bg-[#1a1a1a]'
                            }`}
                          >
                            <span className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                              on ? 'bg-white text-black border-white' : 'border-[#666] text-transparent'
                            }`}>✓</span>
                            <span className="flex-1 min-w-0 truncate text-sm text-[#d4d4d4]">{sl.title}</span>
                            <span className="text-[10px] text-[#666] shrink-0">
                              {wk ? s.working : (on ? s.shared : s.share)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {error && <p className="text-red-400 text-xs">{error}</p>}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#333] flex items-center justify-between">
          <span className="text-xs text-[#666]">{s.note}</span>
          <button onClick={onClose} className="text-sm text-white border border-[#333] rounded px-4 py-1.5 hover:bg-[#1a1a1a]">{s.done}</button>
        </div>
      </div>
    </div>
  );
}
