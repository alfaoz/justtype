import React, { useState } from 'react';
import { strings } from '../strings';
import { SecretField } from './SecretField';
import { normalizePhrase } from '../slateLock';
import { Fade } from './Reveal';
import { useEscape } from '../useEscape';

/**
 * A forgotten lock secret. One box: the password (or the pin, or the twelve
 * words), checked with `onVerify(via)` on enter; when it is accepted,
 * `onRecover(via)` opens the slate and takes its lock off. `ways` says what
 * the slate's keypair opens with; when more than one way exists a line
 * swaps between them.
 */
const loginWord = (kinds) => {
  const w = strings.writer.lock.loginWords;
  const list = [...new Set(kinds)];
  return list.length > 1 ? w.both : w[list[0] || 'password'];
};

export function LockRecoverModal({ ways, loginKind = 'password', onVerify, onRecover, onClose }) {
  const s = strings.writer.lock;
  const kinds = ways?.logins?.length ? ways.logins : [];
  const [viaKind, setViaKind] = useState(kinds.length ? 'login' : 'phrase');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEscape(!busy, onClose);

  const word = loginWord(kinds.length ? kinds : [loginKind]);
  const pin = viaKind === 'login' && kinds.length === 1 && kinds[0] === 'pin';
  const via = () => (viaKind === 'phrase' ? { kind: 'phrase', secret: normalizePhrase(value) } : { kinds, secret: value });

  const submit = async () => {
    if (busy) return;
    if (viaKind === 'phrase' && normalizePhrase(value).split(' ').length !== 12) { setError(s.phraseInvalid); return; }
    if (!value) { setError(s.loginEmpty(word)); return; }
    setBusy(true);
    setError('');
    try {
      await onVerify(via());
      await onRecover(via());
    } catch (err) {
      const m = err?.message;
      setError(m === 'wrong phrase' ? s.wrongPhrase : m === 'wrong login' ? s.wrongLogin(word) : s.failed);
      setValue('');
      setBusy(false);
    }
  };
  const otherWay = () => { setError(''); setValue(''); setViaKind(viaKind === 'phrase' ? 'login' : 'phrase'); };

  const boxCls = 'w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded text-[var(--theme-text)] text-sm font-mono focus:outline-none focus:border-[var(--theme-text-dim)] transition-colors';

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay z-[60] flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 max-w-sm w-full flex flex-col items-center text-center" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm text-[var(--theme-text)] mb-4">{s.recoverTitle}</div>

        {pin ? (
          <div className="mb-4">
            <SecretField value={value} onChange={(v) => { setValue(v); setError(''); }} numeric autoFocus onSubmit={submit} />
          </div>
        ) : viaKind === 'phrase' ? (
          <textarea
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder={s.phrasePlaceholder}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className={`${boxCls} h-24 p-3 resize-none mb-4`}
          />
        ) : (
          <input
            type="password"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder={s.loginPlaceholder(word)}
            autoFocus
            autoComplete="new-password"
            className={`${boxCls} h-10 px-3 mb-4`}
          />
        )}

        <div className="text-xs max-w-sm leading-relaxed text-[var(--theme-text-dim)]">
          {viaKind === 'phrase' ? s.recoverHintPhrase : s.recoverHintLogin(word)}
        </div>
        <Fade show={!!error}>
          <div className="text-xs mt-2 leading-relaxed text-[var(--theme-red)]">{error}</div>
        </Fade>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-5 text-xs text-[var(--theme-text-dim)] whitespace-nowrap">
          <button onClick={onClose} disabled={busy} className="text-[var(--theme-red)] hover:opacity-70 transition-opacity disabled:opacity-40">{s.cancel}</button>
          {ways?.phrase && kinds.length > 0 && (
            <button onClick={otherWay} disabled={busy} className="hover:text-[var(--theme-text)] transition-colors disabled:opacity-40">
              {viaKind === 'phrase' ? s.useLogin(word) : s.usePhrase}
            </button>
          )}
          <button onClick={submit} disabled={busy || !value} className="text-[var(--theme-text)] hover:opacity-70 transition-opacity disabled:opacity-40 disabled:hover:opacity-40">
            {busy ? s.recovering : s.recoverGo}
          </button>
        </div>
      </div>
    </div>
  );
}
