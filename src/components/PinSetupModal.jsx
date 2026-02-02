import React, { useState, useRef, useEffect } from 'react';
import { strings } from '../strings';

export function PinSetupModal({ onSubmit, onRecover, isSetup = true }) {
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [confirmPin, setConfirmPin] = useState(['', '', '', '', '', '']);
  const [step, setStep] = useState(isSetup ? 'enter' : 'unlock'); // 'enter' | 'confirm' | 'unlock' | 'recovery' | 'newPin' | 'confirmNewPin' | 'noKey'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newPin, setNewPin] = useState(['', '', '', '', '', '']);
  const [confirmNewPin, setConfirmNewPin] = useState(['', '', '', '', '', '']);
  const inputRefs = useRef([]);
  const confirmRefs = useRef([]);
  const newPinRefs = useRef([]);
  const confirmNewPinRefs = useRef([]);

  useEffect(() => {
    let refs;
    if (step === 'confirm') refs = confirmRefs;
    else if (step === 'newPin') refs = newPinRefs;
    else if (step === 'confirmNewPin') refs = confirmNewPinRefs;
    else refs = inputRefs;
    const timer = setTimeout(() => {
      if (refs.current[0]) refs.current[0].focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [step]);

  const handleChange = (index, value, targetPin, setTargetPin, targetRefs) => {
    if (!/^\d*$/.test(value)) return;
    const arr = [...targetPin];
    arr[index] = value.slice(-1);
    setTargetPin(arr);
    setError('');

    if (value && index < 5) {
      targetRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e, targetPin, setTargetPin, targetRefs) => {
    if (e.key === 'Backspace') {
      const arr = [...targetPin];
      if (!arr[index] && index > 0) {
        targetRefs.current[index - 1]?.focus();
        arr[index - 1] = '';
        setTargetPin(arr);
      }
    }
  };

  const handlePaste = (e, setTargetPin, targetRefs) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setTargetPin(pasted.split(''));
      targetRefs.current[5]?.focus();
    }
  };

  const pinValue = pin.join('');
  const confirmValue = confirmPin.join('');
  const newPinValue = newPin.join('');
  const confirmNewPinValue = confirmNewPin.join('');

  const handleSubmitPin = async () => {
    if (step === 'enter' && isSetup) {
      if (pinValue.length !== 6) {
        setError(strings.pin.errors.required);
        return;
      }
      setStep('confirm');
      return;
    }

    if (step === 'confirm') {
      if (confirmValue !== pinValue) {
        setError(strings.pin.errors.mismatch);
        setConfirmPin(['', '', '', '', '', '']);
        return;
      }
    }

    if (step === 'newPin') {
      if (newPinValue.length !== 6) {
        setError(strings.pin.errors.required);
        return;
      }
      setStep('confirmNewPin');
      return;
    }

    if (step === 'confirmNewPin') {
      if (confirmNewPinValue !== newPinValue) {
        setError(strings.pin.errors.mismatch);
        setConfirmNewPin(['', '', '', '', '', '']);
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

    const submitValue = step === 'unlock' ? pinValue : pinValue;
    if (submitValue.length !== 6) {
      setError(strings.pin.errors.required);
      return;
    }

    setLoading(true);
    setError('');
    try {
      await onSubmit(submitValue);
    } catch (err) {
      setError(err.message || strings.pin.errors.failed);
      if (step === 'unlock') {
        setPin(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
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
    // Move to new PIN step — actual recovery happens after PIN is confirmed
    setStep('newPin');
    setError('');
  };

  const renderPinInputs = (values, refs, setValues) => (
    <div className="flex gap-2 justify-center" onPaste={(e) => handlePaste(e, setValues, refs)}>
      {values.map((digit, i) => (
        <input
          key={i}
          ref={el => refs.current[i] = el}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(i, e.target.value, values, setValues, refs)}
          onKeyDown={(e) => handleKeyDown(i, e, values, setValues, refs)}
          className="w-11 h-14 bg-[#111] border border-[#333] rounded text-center text-2xl text-white focus:border-[#666] focus:outline-none transition-colors"
        />
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>

        {step === 'enter' && isSetup && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.setup.title}</h2>
            <p className="text-[#999] text-sm mb-6">{strings.pin.setup.description}</p>
            {renderPinInputs(pin, inputRefs, setPin)}
          </>
        )}

        {step === 'confirm' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.setup.confirmTitle}</h2>
            <p className="text-[#999] text-sm mb-6">{strings.pin.setup.confirmDescription}</p>
            {renderPinInputs(confirmPin, confirmRefs, setConfirmPin)}
          </>
        )}

        {step === 'unlock' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.unlock.title}</h2>
            <p className="text-[#999] text-sm mb-6">{strings.pin.unlock.description}</p>
            {renderPinInputs(pin, inputRefs, setPin)}
          </>
        )}

        {step === 'recovery' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.recovery.title}</h2>
            <p className="text-[#999] text-sm mb-4">{strings.pin.recovery.description}</p>
            <textarea
              value={recoveryInput}
              onChange={(e) => { setRecoveryInput(e.target.value); setError(''); }}
              placeholder={strings.pin.recovery.placeholder}
              className="w-full bg-[#111] border border-[#333] rounded p-3 text-white text-sm font-mono resize-none h-24 focus:border-[#666] focus:outline-none transition-colors"
              autoFocus
            />
          </>
        )}

        {step === 'newPin' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.recovery.newPinTitle}</h2>
            <p className="text-[#999] text-sm mb-6">{strings.pin.recovery.newPinDescription}</p>
            {renderPinInputs(newPin, newPinRefs, setNewPin)}
          </>
        )}

        {step === 'confirmNewPin' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.setup.confirmTitle}</h2>
            <p className="text-[#999] text-sm mb-6">{strings.pin.setup.confirmDescription}</p>
            {renderPinInputs(confirmNewPin, confirmNewPinRefs, setConfirmNewPin)}
          </>
        )}

        {step === 'noKey' && (
          <>
            <h2 className="text-lg text-white mb-2">{strings.pin.recovery.title}</h2>
            <p className="text-[#999] text-sm mb-4">{strings.pin.recovery.noKeyWarning}</p>
          </>
        )}

        {error && <p className="text-red-400 text-sm text-center mt-3">{error}</p>}

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
              onClick={() => { setStep('noKey'); setError(''); }}
              className="w-full mt-2 py-2 opacity-50 hover:opacity-80 transition-opacity text-sm"
            >
              {strings.pin.recovery.noKey}
            </button>
            <button
              onClick={() => { setStep('unlock'); setError(''); setRecoveryInput(''); }}
              className="w-full mt-1 py-2 opacity-50 hover:opacity-80 transition-opacity text-sm"
            >
              {strings.pin.setup.back}
            </button>
          </>
        ) : step === 'noKey' ? (
          <button
            onClick={() => { setStep('recovery'); setError(''); }}
            className="w-full mt-4 bg-[#222] border border-[#444] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
          >
            {strings.pin.setup.back}
          </button>
        ) : step === 'newPin' || step === 'confirmNewPin' ? (
          <>
            <button
              onClick={handleSubmitPin}
              disabled={loading || (step === 'newPin' ? newPinValue.length !== 6 : confirmNewPinValue.length !== 6)}
              className="w-full mt-6 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            >
              {loading ? strings.pin.recovery.recovering : (
                step === 'newPin' ? strings.pin.setup.continue : strings.pin.setup.submit
              )}
            </button>
            <button
              onClick={() => {
                if (step === 'confirmNewPin') { setStep('newPin'); setConfirmNewPin(['', '', '', '', '', '']); }
                else { setStep('recovery'); setNewPin(['', '', '', '', '', '']); }
                setError('');
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
              disabled={loading || (step === 'confirm' ? confirmValue.length !== 6 : pinValue.length !== 6)}
              className="w-full mt-6 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            >
              {loading ? (isSetup ? strings.pin.setup.saving : strings.pin.unlock.unlocking) : (
                step === 'enter' ? strings.pin.setup.continue :
                step === 'confirm' ? strings.pin.setup.submit :
                strings.pin.unlock.submit
              )}
            </button>

            {step === 'confirm' && (
              <button
                onClick={() => { setStep('enter'); setConfirmPin(['', '', '', '', '', '']); setError(''); }}
                className="w-full mt-2 py-2 opacity-70 hover:opacity-100 transition-opacity text-sm"
              >
                {strings.pin.setup.back}
              </button>
            )}

            {step === 'unlock' && onRecover && (
              <button
                onClick={() => { setStep('recovery'); setError(''); setPin(['', '', '', '', '', '']); }}
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
