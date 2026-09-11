import React, { useState } from 'react';
import { strings } from '../strings';
import { SecretField } from './SecretField';
import { MIN_SECRET_LENGTH, normalizeSecret, normalizePhrase } from '../slateLock';

/**
 * The lock's face: a word, a row of stars, a quiet line under it.
 *
 * `setup`  choose a secret for this slate: enter it, enter it again, (give
 *          the recovery phrase once if the account has no lock-recovery key
 *          yet), then a plain confirmation that a forgotten secret only opens
 *          with the recovery key. Calls onSubmit({ secret, phrase }).
 * `gate`   the slate is locked: enter its secret, or "forgot it?" leads to
 *          the recovery phrase and a new secret. Calls onSubmit({ secret })
 *          or onRecover({ phrase, secret }).
 *
 * The words stay still; the stars are the motion. A wrong entry clears the
 * stars and says so under them. Enter submits, escape cancels where there is
 * a way back.
 */
export function LockPanel({ mode, needsRecoveryKey = false, onSubmit, onRecover, onCancel, className = '' }) {
  const s = strings.writer.lock;
  const [step, setStep] = useState('secret'); // secret | confirm | phrase | sure | newSecret | newConfirm
  const [secret, setSecret] = useState('');
  const [again, setAgain] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const title = {
    secret: mode === 'setup' ? s.setupTitle : s.gateTitle,
    confirm: s.confirmTitle,
    phrase: s.phraseTitle,
    sure: s.sureTitle,
    newSecret: s.newSecretTitle,
    newConfirm: s.confirmTitle,
  }[step];
  const hint = {
    secret: mode === 'setup' ? s.setupHint : s.gateHint,
    confirm: s.confirmHint,
    phrase: mode === 'setup' ? s.phraseHintSetup : s.phraseHintRecover,
    sure: s.sureBody,
    newSecret: s.setupHint,
    newConfirm: s.confirmHint,
  }[step];

  const fail = (err) => {
    const m = err?.message;
    setError(m === 'wrong' ? s.wrong : m === 'wrong phrase' ? s.wrongPhrase : s.failed);
  };

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const submitSecret = async () => {
    const value = normalizeSecret(secret);
    if (value.length < MIN_SECRET_LENGTH) { setError(s.tooShort); return; }
    if (mode === 'gate') {
      await run(async () => {
        try { await onSubmit({ secret: value }); } catch (err) { setSecret(''); throw err; }
      });
      return;
    }
    setError('');
    setStep('confirm');
  };

  const submitConfirm = () => {
    if (normalizeSecret(again) !== normalizeSecret(secret)) { setError(s.mismatch); setAgain(''); return; }
    setError('');
    setStep(needsRecoveryKey ? 'phrase' : 'sure');
  };

  const submitPhrase = () => {
    const words = normalizePhrase(phrase).split(' ');
    if (words.length !== 12) { setError(s.phraseInvalid); return; }
    setError('');
    if (mode === 'setup') setStep('sure');
    else setStep('newSecret');
  };

  const submitSure = () => run(() => onSubmit({ secret: normalizeSecret(secret), phrase: needsRecoveryKey ? normalizePhrase(phrase) : null }));

  const submitNewSecret = () => {
    const value = normalizeSecret(secret);
    if (value.length < MIN_SECRET_LENGTH) { setError(s.tooShort); return; }
    setError('');
    setStep('newConfirm');
  };

  const submitNewConfirm = () => {
    if (normalizeSecret(again) !== normalizeSecret(secret)) { setError(s.mismatch); setAgain(''); return; }
    run(async () => {
      try {
        await onRecover({ phrase: normalizePhrase(phrase), secret: normalizeSecret(secret) });
      } catch (err) {
        setStep('phrase'); setSecret(''); setAgain('');
        throw err;
      }
    });
  };

  const forgot = () => { setError(''); setSecret(''); setStep('phrase'); };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
  };

  const field = (value, setValue, submit) => (
    <SecretField key={step} value={value} onChange={(v) => { setValue(v); setError(''); }} grow autoFocus onSubmit={submit} />
  );

  return (
    <div className={`flex flex-col items-center justify-center text-center px-8 animate-[fadeIn_0.3s_ease-out] ${className}`} onKeyDown={onKeyDown}>
      <div className="text-sm text-[var(--theme-text)] mb-4">{title}</div>

      {step === 'secret' && field(secret, setSecret, submitSecret)}
      {step === 'confirm' && field(again, setAgain, submitConfirm)}
      {step === 'newSecret' && field(secret, setSecret, submitNewSecret)}
      {step === 'newConfirm' && field(again, setAgain, submitNewConfirm)}

      {step === 'phrase' && (
        <textarea
          key="phrase"
          value={phrase}
          onChange={(e) => { setPhrase(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitPhrase(); } }}
          placeholder={s.phrasePlaceholder}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="w-full max-w-sm bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded p-3 text-[var(--theme-text)] text-sm font-mono resize-none h-24 focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
        />
      )}

      {step === 'sure' && (
        <button
          onClick={submitSure}
          disabled={busy}
          autoFocus
          className="border border-[var(--theme-border)] rounded px-5 py-2 text-sm text-[var(--theme-text)] hover:bg-[var(--theme-bg-tertiary)] transition-colors disabled:opacity-40"
        >
          {s.lockIt}
        </button>
      )}

      {/* The explanation stays; a mistake gets its own line under it */}
      <div className="text-xs mt-4 max-w-sm leading-relaxed text-[var(--theme-text-dim)]">{hint}</div>
      {error && <div className="text-xs mt-2 max-w-sm leading-relaxed text-[var(--theme-red)] animate-[fadeIn_0.2s_ease-out]">{error}</div>}

      <div className="mt-6 flex items-center gap-5 text-xs text-[var(--theme-text-dim)]">
        {mode === 'gate' && step === 'secret' && onRecover && (
          <button onClick={forgot} className="hover:text-[var(--theme-text)] transition-colors">{s.forgot}</button>
        )}
        {step === 'phrase' && (
          <button onClick={submitPhrase} className="hover:text-[var(--theme-text)] transition-colors">{s.next}</button>
        )}
        {onCancel && (
          <button onClick={onCancel} className="hover:text-[var(--theme-text)] transition-colors">{s.cancel}</button>
        )}
      </div>
    </div>
  );
}
