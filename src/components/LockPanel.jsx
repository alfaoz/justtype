import React, { useState } from 'react';
import { strings } from '../strings';
import { SecretField } from './SecretField';
import { MIN_SECRET_LENGTH, normalizeSecret } from '../slateLock';

/**
 * The lock's face: a word, a row of stars, a quiet line under it.
 *
 * `gate`  a locked slate is open and the lock is closed: enter the secret
 * `unlock` the lock is closed and you asked to lock a slate: same, cancellable
 * `setup`  no lock on the account yet: choose a secret, enter it again
 *
 * The words stay still; the stars are the motion. A wrong secret clears the
 * stars and says so under them. Enter submits, escape cancels where there is
 * a way back.
 */
export function LockPanel({ mode, onSubmit, onCancel, className = '' }) {
  const s = strings.writer.lock;
  const [secret, setSecret] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState('first');

  const title = mode === 'setup' ? s.setupTitle : mode === 'gate' ? s.gateTitle : s.unlockTitle;
  const hint = error || (mode === 'setup' ? (row === 'confirm' ? s.confirmHint : s.setupHint) : s.gateHint);

  const submit = async () => {
    if (busy) return;
    const value = normalizeSecret(secret);
    if (value.length < MIN_SECRET_LENGTH) { setError(s.tooShort); return; }
    if (mode === 'setup') {
      if (row === 'first') { setRow('confirm'); setError(''); return; }
      if (normalizeSecret(again) !== value) {
        setError(s.mismatch);
        setAgain('');
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(value);
    } catch (err) {
      setError(err?.message === 'wrong' ? s.wrong : s.failed);
      setSecret('');
      setAgain('');
      setRow('first');
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
  };

  return (
    <div className={`flex flex-col items-center justify-center text-center px-8 animate-[fadeIn_0.3s_ease-out] ${className}`} onKeyDown={onKeyDown}>
      <div className="text-sm text-[var(--theme-text)] mb-4">{busy ? s.working : title}</div>
      {mode === 'setup' && row === 'confirm' ? (
        <SecretField key="again" value={again} onChange={(v) => { setAgain(v); setError(''); }} grow autoFocus onSubmit={submit} />
      ) : (
        <SecretField key="first" value={secret} onChange={(v) => { setSecret(v); setError(''); }} grow autoFocus onSubmit={submit} />
      )}
      <div className={`text-xs mt-4 ${error ? 'text-[var(--theme-red)]' : 'text-[var(--theme-text-dim)]'}`}>
        {hint}
      </div>
      {onCancel && (
        <button onClick={onCancel} className="mt-6 text-xs text-[var(--theme-text-dim)] hover:text-[var(--theme-text)] transition-colors">
          {s.cancel}
        </button>
      )}
    </div>
  );
}
