import React, { useState, useEffect, useRef } from 'react';
import { strings } from '../strings';
import { SecretField } from './SecretField';
import { TextMorph } from 'torph/react';

export function PinSetupModal({ onSubmit, onRecover, isSetup = true }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState(isSetup ? 'enter' : 'unlock'); // 'enter' | 'unlock' | 'recovery' | 'newPin' | 'noKey'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  // Which secret field holds the focus: the first row of a step, or the
  // confirm row once the first is full
  const [focusRow, setFocusRow] = useState('first');

  useEffect(() => { setFocusRow('first'); }, [step]);

  // Steps crossfade instead of snapping: the old one fades, then the new
  // one fades in, the same breath the password reset takes
  const [stepPhase, setStepPhase] = useState('in');
  const stepTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(stepTimerRef.current), []);
  const goToStep = (next) => {
    if (next === step) return;
    setStepPhase('out');
    clearTimeout(stepTimerRef.current);
    stepTimerRef.current = setTimeout(() => { setStep(next); setStepPhase('in'); }, 260);
  };

  const pinValue = pin;
  const confirmValue = confirmPin;
  const newPinValue = newPin;
  const confirmNewPinValue = confirmNewPin;

  const handleSubmitPin = async () => {
    if (step === 'enter') {
      if (pinValue.length !== 6 || confirmValue.length !== 6) {
        setError(strings.pin.errors.required);
        return;
      }
      if (confirmValue !== pinValue) {
        setError(strings.pin.errors.mismatch);
        setConfirmPin('');
        setFocusRow('confirm');
        return;
      }
    }

    if (step === 'newPin') {
      if (newPinValue.length !== 6 || confirmNewPinValue.length !== 6) {
        setError(strings.pin.errors.required);
        return;
      }
      if (confirmNewPinValue !== newPinValue) {
        setError(strings.pin.errors.mismatch);
        setConfirmNewPin('');
        setFocusRow('confirm');
        return;
      }
      setLoading(true);
      setError('');
      try {
        await onRecover(recoveryInput.trim().toLowerCase(), newPinValue);
      } catch (err) {
        setError(err.message || strings.pin.recovery.errors.failed);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (step === 'unlock' && pinValue.length !== 6) {
      setError(strings.pin.errors.required);
      return;
    }

    setLoading(true);
    setError('');
    try {
      await onSubmit(pinValue);
    } catch (err) {
      setError(err.message || strings.pin.errors.failed);
      if (step === 'unlock') {
        setPin('');
        setFocusRow('first');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRecoverySubmit = async () => {
    const phrase = recoveryInput.trim().toLowerCase();
    if (!phrase) {
      setError(strings.pin.recovery.errors.required);
      return;
    }
    // Validate format: should be 12 words
    const words = phrase.split(/\s+/);
    if (words.length !== 12) {
      setError(strings.pin.recovery.errors.invalid);
      return;
    }
    // Move to the new-PIN screen; actual recovery happens once the PIN is set
    goToStep('newPin');
    setError('');
  };

  // One row of six stars; the account pin is digits only
  const renderPinInputs = (value, setValue, row = 'first', onRowFull) => (
    <SecretField
      value={value}
      onChange={(v) => { setValue(v); setError(''); }}
      numeric
      autoFocus={focusRow === row}
      onComplete={onRowFull}
      onSubmit={handleSubmitPin}
    />
  );

  // Both rows of a set-a-pin screen: enter once, enter again, one button.
  const renderPinPair = (values, setValues, confirmValues, setConfirmValues) => (
    <>
      {renderPinInputs(values, setValues, 'first', () => setFocusRow('confirm'))}
      <p className="text-[var(--theme-text-muted)] text-sm mt-5 mb-2">{strings.pin.setup.confirmLabel}</p>
      {renderPinInputs(confirmValues, setConfirmValues, 'confirm')}
    </>
  );

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay z-[60] flex items-center justify-center p-4">
      <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded animate-modal-content p-6 md:p-8 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div key={step} className={`transition-opacity duration-300 ${stepPhase === 'out' ? 'opacity-0' : 'opacity-100 animate-[fadeIn_0.4s_ease-out]'}`}>

        {step === 'enter' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.setup.title}</h2>
            <p className="text-[var(--theme-text-muted)] text-sm mb-6">{strings.pin.setup.description}</p>
            {renderPinPair(pin, setPin, confirmPin, setConfirmPin)}
          </>
        )}

        {step === 'unlock' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.unlock.title}</h2>
            <p className="text-[var(--theme-text-muted)] text-sm mb-6">{strings.pin.unlock.description}</p>
            {renderPinInputs(pin, setPin)}
          </>
        )}

        {step === 'recovery' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.recovery.title}</h2>
            <p className="text-[var(--theme-text-muted)] text-sm mb-4">{strings.pin.recovery.description}</p>
            <textarea
              value={recoveryInput}
              onChange={(e) => { setRecoveryInput(e.target.value); setError(''); }}
              placeholder={strings.pin.recovery.placeholder}
              className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded p-3 text-white text-sm font-mono resize-none h-24 focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
              autoFocus
            />
          </>
        )}

        {step === 'newPin' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.recovery.newPinTitle}</h2>
            <p className="text-[var(--theme-text-muted)] text-sm mb-6">{strings.pin.recovery.newPinDescription}</p>
            {renderPinPair(newPin, setNewPin, confirmNewPin, setConfirmNewPin)}
          </>
        )}

        {step === 'noKey' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.recovery.title}</h2>
            <p className="text-[var(--theme-text-muted)] text-sm mb-4">{strings.pin.recovery.noKeyWarning}</p>
          </>
        )}

        </div>

        <p className={`text-sm text-center mt-3 transition-opacity duration-200 ${error ? 'opacity-100' : 'opacity-0'}`} style={{ color: 'var(--theme-red)' }}>
          <TextMorph>{error || ' '}</TextMorph>
        </p>

        {step === 'recovery' ? (
          <>
            <button
              onClick={handleRecoverySubmit}
              disabled={loading || !recoveryInput.trim()}
              className="w-full mt-4 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            >
              {strings.pin.recovery.submit}
            </button>
            <button
              onClick={() => { goToStep('noKey'); setError(''); }}
              className="w-full mt-2 py-2 opacity-50 hover:opacity-80 transition-opacity text-sm"
            >
              {strings.pin.recovery.noKey}
            </button>
            <button
              onClick={() => { goToStep('unlock'); setError(''); setRecoveryInput(''); }}
              className="w-full mt-1 py-2 opacity-50 hover:opacity-80 transition-opacity text-sm"
            >
              {strings.pin.setup.back}
            </button>
          </>
        ) : step === 'noKey' ? (
          <button
            onClick={() => { goToStep('recovery'); setError(''); }}
            className="w-full mt-4 border border-[var(--theme-border)] text-white px-6 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
          >
            {strings.pin.setup.back}
          </button>
        ) : step === 'newPin' ? (
          <>
            <button
              onClick={handleSubmitPin}
              disabled={loading || newPinValue.length !== 6 || confirmNewPinValue.length !== 6}
              className="w-full mt-6 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            >
              <TextMorph>{loading ? strings.pin.recovery.recovering : strings.pin.setup.submit}</TextMorph>
            </button>
            <button
              onClick={() => {
                goToStep('recovery'); setError('');
                setNewPin(''); setConfirmNewPin('');
              }}
              className="w-full mt-2 py-2 opacity-70 hover:opacity-100 transition-opacity text-sm"
            >
              {strings.pin.setup.back}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleSubmitPin}
              disabled={loading || pinValue.length !== 6 || (step === 'enter' && confirmValue.length !== 6)}
              className="w-full mt-6 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            >
              <TextMorph>
                {loading ? (isSetup ? strings.pin.setup.saving : strings.pin.unlock.unlocking) : (
                  step === 'enter' ? strings.pin.setup.submit : strings.pin.unlock.submit
                )}
              </TextMorph>
            </button>

            {step === 'unlock' && onRecover && (
              <button
                onClick={() => { goToStep('recovery'); setError(''); setPin(''); }}
                className="w-full mt-2 py-2 opacity-50 hover:opacity-80 transition-opacity text-sm"
              >
                {strings.pin.unlock.forgotPin}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
