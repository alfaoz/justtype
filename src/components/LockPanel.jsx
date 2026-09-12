import React, { useEffect, useRef, useState } from 'react';
import { strings } from '../strings';
import { SecretField } from './SecretField';
import { MIN_SECRET_LENGTH, normalizeSecret, normalizePhrase } from '../slateLock';
import { Fade, AutoHeight, EASE } from './Reveal';

/**
 * The lock's face: a word, rows of stars, a quiet line under them.
 *
 * The panel grows and shrinks in place instead of swapping screens. Enter on
 * a row of stars settles it and fades the next thing in right below: the
 * second row to type the secret again, the recovery phrase when the account
 * has no lock-recovery key yet (it leaves once entered), then the one line
 * that says a forgotten secret only opens with the recovery key. Enter, or
 * "lock it" in the bottom row, locks.
 *
 * `setup`  choose a secret for this slate. Calls onSubmit({ secret, phrase }).
 * `gate`   the slate is locked: its secret opens it (onSubmit({ secret })),
 *          or "forgot it?" trades the row for the recovery phrase and a new
 *          secret (onRecover({ phrase, secret })).
 *
 * The words stay still; the stars are the motion. A mistake gets its own
 * line under the explanation and clears the row it happened on.
 */
const SETUP_ORDER = ['secret', 'confirm', 'phrase', 'sure'];
const GATE_ORDER = ['secret', 'phrase', 'newSecret', 'newConfirm'];

export function LockPanel({ mode, needsRecoveryKey = false, onSubmit, onRecover, onCancel, className = '' }) {
  const s = strings.writer.lock;
  const [stage, setStage] = useState('secret');
  const [secret, setSecret] = useState('');
  const [again, setAgain] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const panelRef = useRef(null);

  const order = (mode === 'setup' ? SETUP_ORDER : GATE_ORDER).filter(st => st !== 'phrase' || mode === 'gate' || needsRecoveryKey);
  const at = order.indexOf(stage);
  const reached = (st) => order.indexOf(st) !== -1 && order.indexOf(st) <= at;
  const advance = () => { setError(''); setStage(order[at + 1]); };

  const title = mode === 'setup' ? s.setupTitle : s.gateTitle;
  const hint = {
    secret: mode === 'setup' ? s.setupHint : s.gateHint,
    confirm: s.confirmHint,
    phrase: mode === 'setup' ? s.phraseHintSetup : s.phraseHintRecover,
    sure: s.sureBody,
    newSecret: s.setupHint,
    newConfirm: s.confirmHint,
  }[stage];

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

  const submitSecret = () => {
    const value = normalizeSecret(secret);
    if (value.length < MIN_SECRET_LENGTH) { setError(s.tooShort); return; }
    if (mode === 'gate') {
      run(async () => {
        try { await onSubmit({ secret: value }); } catch (err) { setSecret(''); throw err; }
      });
      return;
    }
    advance();
  };
  const submitConfirm = () => {
    if (normalizeSecret(again) !== normalizeSecret(secret)) { setError(s.mismatch); setAgain(''); return; }
    advance();
  };
  const submitPhrase = () => {
    if (normalizePhrase(phrase).split(' ').length !== 12) { setError(s.phraseInvalid); return; }
    advance();
  };
  const submitSure = () => run(() => onSubmit({ secret: normalizeSecret(secret), phrase: needsRecoveryKey ? normalizePhrase(phrase) : null }));
  const submitNewSecret = () => {
    if (normalizeSecret(secret).length < MIN_SECRET_LENGTH) { setError(s.tooShort); return; }
    advance();
  };
  const submitNewConfirm = () => {
    if (normalizeSecret(again) !== normalizeSecret(secret)) { setError(s.mismatch); setAgain(''); return; }
    run(async () => {
      try {
        await onRecover({ phrase: normalizePhrase(phrase), secret: normalizeSecret(secret) });
      } catch (err) {
        setStage('phrase'); setSecret(''); setAgain('');
        throw err;
      }
    });
  };
  // Forgot it: the secret row leaves, the recovery phrase takes its place
  const forgot = () => { setError(''); setSecret(''); setStage('phrase'); };

  // With nothing left to type, the panel itself takes the enter key
  useEffect(() => {
    if (stage === 'sure') panelRef.current?.focus();
  }, [stage]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
    if (e.key === 'Enter' && stage === 'sure') { e.preventDefault(); submitSure(); }
  };

  // A row of stars. `show` keeps it on screen; once entered it stays a
  // shade quieter and no longer takes keys
  const row = (st, value, setValue, submit, show = reached(st)) => (
    <Fade key={st} show={show} className="mb-4">
      <div className={`transition-opacity duration-300 ${stage === st ? '' : 'opacity-50 pointer-events-none'}`}>
        <SecretField value={value} onChange={(v) => { setValue(v); setError(''); }} grow autoFocus={stage === st} onSubmit={submit} />
      </div>
    </Fade>
  );

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className={`flex flex-col items-center justify-center text-center px-8 outline-none animate-[fadeIn_0.3s_ease-out] ${className}`}
      onKeyDown={onKeyDown}
    >
      <AutoHeight className="w-full">
        <div className="text-sm text-[var(--theme-text)] mb-5">{title}</div>

        {row('secret', secret, setSecret, submitSecret, mode === 'setup' || stage === 'secret')}
        {row('confirm', again, setAgain, submitConfirm)}

        {/* The recovery phrase: a box while it is typed; once it is in, the
            box folds down to one quiet line saying so */}
        <Fade show={reached('phrase')} className="w-full max-w-sm mb-4">
          <div
            className="relative w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded overflow-hidden focus-within:border-[var(--theme-text-dim)] transition-colors"
            style={{ height: stage === 'phrase' ? 96 : 34, transition: `height 320ms ${EASE}, border-color 300ms ${EASE}` }}
          >
            <Fade show={stage === 'phrase'} className="absolute inset-0">
              <textarea
                value={phrase}
                onChange={(e) => { setPhrase(e.target.value); setError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitPhrase(); } }}
                placeholder={s.phrasePlaceholder}
                autoFocus
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="w-full h-full bg-transparent p-3 text-[var(--theme-text)] text-sm font-mono resize-none focus:outline-none"
              />
            </Fade>
            <Fade show={stage !== 'phrase'} className="absolute inset-0 flex items-center justify-center text-xs text-[var(--theme-text-dim)]">
              {s.phraseEntered}
            </Fade>
          </div>
        </Fade>

        {row('newSecret', secret, setSecret, submitNewSecret)}
        {row('newConfirm', again, setAgain, submitNewConfirm)}

        {/* The explanation for the step at hand; a mistake gets its own line */}
        <div className="text-xs max-w-sm leading-relaxed text-[var(--theme-text-dim)]">{hint}</div>
        <Fade show={!!error}>
          <div className="text-xs mt-2 max-w-sm leading-relaxed text-[var(--theme-red)]">{error}</div>
        </Fade>

        {/* The way out sits left in red; the way on sits right */}
        <div className="mt-6 flex items-center gap-5 text-xs text-[var(--theme-text-dim)]">
          {onCancel && (
            <button onClick={onCancel} className="text-[var(--theme-red)] hover:opacity-70 transition-opacity">{s.cancel}</button>
          )}
          {mode === 'gate' && stage === 'secret' && onRecover && (
            <button onClick={forgot} className="hover:text-[var(--theme-text)] transition-colors">{s.forgot}</button>
          )}
          {stage === 'phrase' && (
            <button onClick={submitPhrase} className="hover:text-[var(--theme-text)] transition-colors">{s.next}</button>
          )}
          {stage === 'sure' && (
            <button onClick={submitSure} disabled={busy} className="text-[var(--theme-text)] hover:opacity-70 transition-opacity disabled:opacity-40">{s.lockIt}</button>
          )}
        </div>
      </AutoHeight>
    </div>
  );
}
