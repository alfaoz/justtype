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
 * second row to type the secret again, the password once when the account
 * has no lock-recovery key it opens yet, then the one line that says what
 * opens a forgotten secret. Enter, or "lock it" in the bottom row, locks.
 *
 * `setup`  choose a secret for this slate. Calls onSubmit({ secret, login })
 *          where login is { kind, secret } when `needsLogin` asked for it.
 * `gate`   the slate is locked: its secret opens it (onSubmit({ secret })),
 *          or "forgot it?" trades the row for the password (or the pin, or
 *          the recovery phrase) and a new secret (onRecover({ via, secret })).
 *          `onWays()` answers what the slate's keypair opens with.
 *
 * A password or a phrase is typed into a box and checked right there with
 * `onVerify(via)`: the box folds to one line saying it was accepted, and the
 * new secret follows. The pin keeps its row of stars. The words stay still;
 * the stars are the motion. A mistake gets its own line under the
 * explanation and clears the row it happened on.
 */
const SETUP_ORDER = ['secret', 'confirm', 'login', 'sure'];
const GATE_ORDER = ['secret', 'via', 'newSecret', 'newConfirm'];

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
const pinOnly = (kinds) => kinds.length === 1 && kinds[0] === 'pin';

// A box that holds an input while it is typed and folds to one quiet line
// once what was typed is accepted
function FoldBox({ show, open, tall, accepted, children }) {
  return (
    <Fade show={show} className="w-full max-w-sm mb-4">
      <div
        className="relative w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded overflow-hidden focus-within:border-[var(--theme-text-dim)] transition-colors"
        style={{ height: open ? (tall ? 96 : 42) : 34, transition: `height 320ms ${EASE}, border-color 300ms ${EASE}` }}
      >
        <Fade show={open} className="absolute inset-0">{children}</Fade>
        <Fade show={!open} className="absolute inset-0 flex items-center justify-center text-xs text-[var(--theme-text-dim)]">
          {accepted}
        </Fade>
      </div>
    </Fade>
  );
}

export function LockPanel({ mode, needsLogin = false, loginKind = 'password', ways: initialWays = null, onWays, onVerify, onSubmit, onRecover, onCancel, className = '' }) {
  const s = strings.writer.lock;
  const [stage, setStage] = useState('secret');
  const [secret, setSecret] = useState('');
  const [again, setAgain] = useState('');
  const [login, setLogin] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Gate: what the slate's keypair opens with, and which of them is on screen
  const [ways, setWays] = useState(initialWays);
  const [viaKind, setViaKind] = useState('login');
  const panelRef = useRef(null);

  const order = (mode === 'setup' ? SETUP_ORDER : GATE_ORDER).filter(st => st !== 'login' || needsLogin);
  const at = order.indexOf(stage);
  const reached = (st) => order.indexOf(st) !== -1 && order.indexOf(st) <= at;
  const advance = () => { setError(''); setStage(order[at + 1]); };

  const setupWays = { logins: [loginKind], phrase: false };
  const gateKinds = ways?.logins?.length ? ways.logins : [loginKind];
  const gateLoginWord = loginWord(gateKinds);
  const title = mode === 'setup' ? s.setupTitle : s.gateTitle;
  const hint = {
    secret: mode === 'setup' ? s.setupHint : s.gateHint,
    confirm: s.confirmHint,
    login: s.loginHintSetup(loginWord([loginKind])),
    via: viaKind === 'phrase' ? s.phraseHintRecover : s.loginHintRecover(gateLoginWord),
    sure: s.sureBody(waysWord(needsLogin ? setupWays : initialWays || setupWays)),
    newSecret: s.setupHint,
    newConfirm: s.confirmHint,
  }[stage];

  const fail = (err) => {
    const m = err?.message;
    setError(m === 'wrong' ? s.wrong : m === 'wrong phrase' ? s.wrongPhrase : m === 'wrong login' ? s.wrongLogin(stage === 'login' ? loginWord([loginKind]) : gateLoginWord) : s.failed);
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
  // The way in without the secret: the login secret, or the phrase
  const via = () => (viaKind === 'phrase'
    ? { kind: 'phrase', secret: normalizePhrase(phrase) }
    : { kinds: gateKinds, secret: login });
  const submitVia = () => {
    if (viaKind === 'phrase') {
      if (normalizePhrase(phrase).split(' ').length !== 12) { setError(s.phraseInvalid); return; }
    } else if (!login) { setError(s.loginEmpty(gateLoginWord)); return; }
    run(async () => {
      try { if (onVerify) await onVerify(via()); } catch (err) {
        if (viaKind === 'phrase') setPhrase(''); else setLogin('');
        throw err;
      }
      advance();
    });
  };
  const submitNewSecret = () => {
    if (normalizeSecret(secret).length < MIN_SECRET_LENGTH) { setError(s.tooShort); return; }
    advance();
  };
  const submitNewConfirm = () => {
    if (normalizeSecret(again) !== normalizeSecret(secret)) { setError(s.mismatch); setAgain(''); return; }
    run(async () => {
      try {
        await onRecover({ via: via(), secret: normalizeSecret(secret) });
      } catch (err) {
        setStage('via'); setSecret(''); setAgain('');
        if (viaKind === 'phrase') setPhrase(''); else setLogin('');
        throw err;
      }
    });
  };
  // Forgot it: the secret row leaves; the login secret (or the phrase, for
  // a slate whose keypair only the phrase opens) takes its place
  const forgot = () => run(async () => {
    const w = ways || (onWays ? await onWays() : null) || { logins: [loginKind], phrase: false };
    setWays(w);
    setViaKind(w.logins.length ? 'login' : 'phrase');
    setSecret('');
    setStage('via');
  });
  const otherWay = () => { setError(''); setViaKind(viaKind === 'phrase' ? 'login' : 'phrase'); };

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
  const row = (st, value, setValue, submit, show = reached(st), extra = {}) => (
    <Fade key={st} show={show} className="mb-4">
      <div className={`transition-opacity duration-300 ${stage === st ? '' : 'opacity-50 pointer-events-none'}`}>
        <SecretField value={value} onChange={(v) => { setValue(v); setError(''); }} grow autoFocus={stage === st} onSubmit={submit} {...extra} />
      </div>
    </Fade>
  );
  // The password, typed into an ordinary box that folds once accepted
  const passwordBox = (st, submit, word) => (
    <FoldBox key={`${st}-box`} show={reached(st)} open={stage === st} accepted={s.loginAccepted(word)}>
      <input
        type="password"
        value={login}
        onChange={(e) => { setLogin(e.target.value); setError(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        placeholder={s.loginPlaceholder(word)}
        autoFocus
        autoComplete="current-password"
        className="w-full h-full bg-transparent px-3 text-[var(--theme-text)] text-sm font-mono focus:outline-none"
      />
    </FoldBox>
  );

  // Where the login secret is typed: the pin keeps its stars
  const setupPin = pinOnly([loginKind]);
  const gatePin = pinOnly(gateKinds);

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
        {setupPin
          ? row('login', login, setLogin, submitLogin, reached('login'), { numeric: true })
          : passwordBox('login', submitLogin, loginWord([loginKind]))}

        {/* The way in without the secret: the pin as stars, the password
            in its box, the phrase in a taller one; a box folds to one line
            once accepted */}
        {gatePin
          ? row('via', login, setLogin, submitVia, reached('via') && viaKind !== 'phrase', { numeric: true })
          : (reached('via') && viaKind !== 'phrase') && passwordBox('via', submitVia, gateLoginWord)}
        <FoldBox show={reached('via') && viaKind === 'phrase'} open={stage === 'via'} tall accepted={s.phraseEntered}>
          <textarea
            value={phrase}
            onChange={(e) => { setPhrase(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitVia(); } }}
            placeholder={s.phrasePlaceholder}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="w-full h-full bg-transparent p-3 text-[var(--theme-text)] text-sm font-mono resize-none focus:outline-none"
          />
        </FoldBox>

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
            <button onClick={forgot} disabled={busy} className="hover:text-[var(--theme-text)] transition-colors disabled:opacity-40">{s.forgot}</button>
          )}
          {stage === 'via' && ways?.phrase && ways?.logins?.length > 0 && (
            <button onClick={otherWay} className="hover:text-[var(--theme-text)] transition-colors">
              {viaKind === 'phrase' ? s.useLogin(gateLoginWord) : s.usePhrase}
            </button>
          )}
          {(stage === 'via' || stage === 'login') && (
            <button onClick={stage === 'via' ? submitVia : submitLogin} disabled={busy} className="hover:text-[var(--theme-text)] transition-colors disabled:opacity-40">{s.next}</button>
          )}
          {stage === 'sure' && (
            <button onClick={submitSure} disabled={busy} className="text-[var(--theme-text)] hover:opacity-70 transition-opacity disabled:opacity-40">{s.lockIt}</button>
          )}
        </div>
      </AutoHeight>
    </div>
  );
}
