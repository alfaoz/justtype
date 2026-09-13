import React, { useEffect, useRef, useState } from 'react';
import { strings } from '../strings';
import { SecretField } from './SecretField';
import { MIN_SECRET_LENGTH, normalizeSecret } from '../slateLock';
import { Fade, AutoHeight, EASE } from './Reveal';

/**
 * The lock's face: a word, rows of stars, a quiet line under them.
 *
 * The panel grows and shrinks in place instead of swapping screens. Enter on
 * a row of stars settles it and fades the next thing in right below: the
 * second row to type the secret again, the password once when the account
 * has no lock-recovery key it opens yet, then the one line that says what
 * opens a forgotten secret. Enter, or "lock it" in the bottom row, locks.
 * A settled row can be clicked to go back to it; two rows that do not match
 * start over from the first.
 *
 * `setup`  choose a secret for this slate. Calls onSubmit({ secret, login })
 *          where login is { kind, secret } when `needsLogin` asked for it;
 *          the password is checked with `onVerify` as soon as it is typed.
 * `gate`   the slate is locked: its secret opens it (onSubmit({ secret })),
 *          or "forgot it?" hands over to `onForgot` (see LockRecoverModal).
 *
 * The words stay still; the stars are the motion. A mistake gets its own
 * line under the explanation and clears the row it happened on.
 */
const SETUP_ORDER = ['secret', 'confirm', 'login', 'sure'];

// "password", "pin", or "password or pin" for a list of login kinds
const loginWord = (kinds) => {
  const s = strings.writer.lock;
  const list = [...new Set(kinds)];
  return list.length > 1 ? s.loginWords.both : s.loginWords[list[0] || 'password'];
};
// What opens a forgotten secret, as one phrase
export const waysWord = ({ logins = [], phrase = false } = {}) => {
  const words = [];
  if (logins.length) words.push(loginWord(logins));
  if (phrase) words.push(strings.writer.lock.loginWords.phrase);
  return words.join(strings.writer.lock.loginWords.or);
};

export function LockPanel({ mode, needsLogin = false, loginKind = 'password', ways: initialWays = null, onVerify, onSubmit, onForgot, onCancel, className = '' }) {
  const s = strings.writer.lock;
  const [stage, setStage] = useState('secret');
  const [secret, setSecret] = useState('');
  const [again, setAgain] = useState('');
  const [login, setLogin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const panelRef = useRef(null);

  const order = mode === 'setup' ? SETUP_ORDER.filter(st => st !== 'login' || needsLogin) : ['secret'];
  const at = order.indexOf(stage);
  const reached = (st) => order.indexOf(st) !== -1 && order.indexOf(st) <= at;
  const advance = () => { setError(''); setStage(order[at + 1]); };
  // Back to an earlier row: it keeps what it holds, the rows after it clear
  const goBack = (st) => {
    if (busy || order.indexOf(st) >= at) return;
    setError('');
    if (order.indexOf(st) < order.indexOf('confirm')) setAgain('');
    if (order.indexOf(st) < order.indexOf('login')) setLogin('');
    setStage(st);
  };

  const setupWays = { logins: [loginKind], phrase: false };
  const title = mode === 'setup' ? s.setupTitle : s.gateTitle;
  const hint = {
    secret: mode === 'setup' ? s.setupHint : s.gateHint,
    confirm: s.confirmHint,
    login: s.loginHintSetup(loginWord([loginKind])),
    sure: s.sureBody(waysWord(needsLogin ? setupWays : initialWays || setupWays)),
  }[stage];

  const fail = (err) => {
    const m = err?.message;
    setError(m === 'wrong' ? s.wrong : m === 'wrong login' ? s.wrongLogin(loginWord([loginKind])) : s.failed);
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
  // Two rows that do not match start over from the first
  const submitConfirm = () => {
    if (normalizeSecret(again) !== normalizeSecret(secret)) {
      setError(s.mismatch);
      setSecret('');
      setAgain('');
      setStage('secret');
      return;
    }
    advance();
  };
  // The login secret, checked right here before the panel moves on
  const submitLogin = () => {
    if (!login) { setError(s.loginEmpty(loginWord([loginKind]))); return; }
    run(async () => {
      try { if (onVerify) await onVerify({ kind: loginKind, secret: login }); } catch (err) { setLogin(''); throw err; }
      advance();
    });
  };
  const submitSure = () => run(() => onSubmit({
    secret: normalizeSecret(secret),
    login: needsLogin ? { kind: loginKind, secret: login } : null,
  }));

  // With nothing left to type, the panel itself takes the enter key
  useEffect(() => {
    if (stage === 'sure') panelRef.current?.focus();
  }, [stage]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
    if (e.key === 'Enter' && stage === 'sure') { e.preventDefault(); submitSure(); }
  };

  // A row of stars. `show` keeps it on screen; once entered it stays a
  // shade quieter, and a click brings it back
  const row = (st, value, setValue, submit, show = reached(st), extra = {}) => (
    <Fade key={st} show={show} className="mb-4">
      <div
        className={`transition-opacity duration-300 ${stage === st ? '' : 'opacity-50 cursor-pointer'}`}
        onClick={stage === st ? undefined : () => goBack(st)}
      >
        <div className={stage === st ? '' : 'pointer-events-none'}>
          <SecretField value={value} onChange={(v) => { setValue(v); setError(''); }} grow autoFocus={stage === st} onSubmit={submit} {...extra} />
        </div>
      </div>
    </Fade>
  );
  const pinLogin = loginKind === 'pin';
  const word = loginWord([loginKind]);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className={`flex flex-col items-center justify-center text-center px-8 outline-none animate-[fadeIn_0.3s_ease-out] ${className}`}
      onKeyDown={onKeyDown}
    >
      <AutoHeight className="w-full">
        <div className="text-sm text-[var(--theme-text)] mb-5">{title}</div>

        {row('secret', secret, setSecret, submitSecret, true)}
        {row('confirm', again, setAgain, submitConfirm)}

        {/* The login secret, once: the pin as a row of stars, the password
            in its box, which folds to one line once it is accepted */}
        {pinLogin ? row('login', login, setLogin, submitLogin, reached('login'), { numeric: true }) : (
          <Fade show={reached('login')} className="w-full max-w-sm mb-4">
            <div
              className={`relative w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded overflow-hidden focus-within:border-[var(--theme-text-dim)] transition-colors ${stage === 'login' ? '' : 'cursor-pointer'}`}
              style={{ height: stage === 'login' ? 42 : 34, transition: `height 320ms ${EASE}, border-color 300ms ${EASE}` }}
              onClick={stage === 'login' ? undefined : () => goBack('login')}
            >
              <Fade show={stage === 'login'} className="absolute inset-0">
                <input
                  type="password"
                  value={login}
                  onChange={(e) => { setLogin(e.target.value); setError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitLogin(); } }}
                  placeholder={s.loginPlaceholder(word)}
                  autoFocus
                  autoComplete="current-password"
                  className="w-full h-full bg-transparent px-3 text-[var(--theme-text)] text-sm font-mono focus:outline-none"
                />
              </Fade>
              <Fade show={stage !== 'login'} className="absolute inset-0 flex items-center justify-center text-xs text-[var(--theme-text-dim)]">
                {s.loginAccepted(word)}
              </Fade>
            </div>
          </Fade>
        )}

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
          {mode === 'gate' && onForgot && (
            <button onClick={onForgot} disabled={busy} className="hover:text-[var(--theme-text)] transition-colors disabled:opacity-40">{s.forgot}</button>
          )}
          {stage === 'login' && (
            <button onClick={submitLogin} disabled={busy} className="hover:text-[var(--theme-text)] transition-colors disabled:opacity-40">{s.next}</button>
          )}
          {stage === 'sure' && (
            <button onClick={submitSure} disabled={busy} className="text-[var(--theme-text)] hover:opacity-70 transition-opacity disabled:opacity-40">{s.lockIt}</button>
          )}
        </div>
      </AutoHeight>
    </div>
  );
}
