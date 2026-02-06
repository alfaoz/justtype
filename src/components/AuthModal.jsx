import React, { useState, useRef, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';
import { RecoveryKeyModal } from './RecoveryKeyModal';
import { VERSION } from '../version';
import { generateSlateKey, generateSalt, deriveKey, wrapKey, unwrapKey, generateRecoveryPhrase, encryptContent, decryptContent } from '../crypto';
import { saveSlateKey, getSlateKey } from '../keyStore';
import { wordlist } from '../bip39-wordlist';
import { VerifyBadge } from './VerifyBadge';

export function AuthModal({ onClose, onAuth }) {
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [showVerification, setShowVerification] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [pendingAuthData, setPendingAuthData] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [showLoadingAnimation, setShowLoadingAnimation] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pendingRecoveryPhrase, setPendingRecoveryPhrase] = useState(null);
  const turnstileTokenRef = useRef('');
  const turnstileWidgetId = useRef(null);
  const forgotPasswordWidgetId = useRef(null);
  const turnstileRef = useRef(null);
  const forgotPasswordTurnstileRef = useRef(null);

  // Initialize Turnstile widget when modal opens
  useEffect(() => {
    const initTurnstile = () => {
      if (window.turnstile && turnstileRef.current && !turnstileWidgetId.current) {
        try {
          turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
            sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
            theme: 'dark',
            size: 'invisible',
            callback: (token) => {
              setTurnstileToken(token);
              turnstileTokenRef.current = token;
            },
          });

          // Execute immediately after rendering so token is ready
          setTimeout(() => {
            if (turnstileWidgetId.current !== null && window.turnstile) {
              window.turnstile.execute(turnstileWidgetId.current);
            }
          }, 100);
        } catch (err) {
          console.error('Turnstile render error:', err);
        }
      }
    };

    // Wait for Turnstile script to load
    if (window.turnstile) {
      initTurnstile();
    } else {
      const checkInterval = setInterval(() => {
        if (window.turnstile) {
          clearInterval(checkInterval);
          initTurnstile();
        }
      }, 100);

      return () => clearInterval(checkInterval);
    }

    return () => {
      if (turnstileWidgetId.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(turnstileWidgetId.current);
        } catch (err) {
          // Widget already removed
        }
        turnstileWidgetId.current = null;
      }
    };
  }, []);

  // Initialize forgot password Turnstile
  useEffect(() => {
    if (!showForgotPassword) return;

    const initTurnstile = () => {
      if (window.turnstile && forgotPasswordTurnstileRef.current && !forgotPasswordWidgetId.current) {
        try {
          forgotPasswordWidgetId.current = window.turnstile.render(forgotPasswordTurnstileRef.current, {
            sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
            theme: 'dark',
            size: 'invisible',
            callback: (token) => {
              setTurnstileToken(token);
              turnstileTokenRef.current = token;
            },
          });

          // Execute immediately after rendering so token is ready
          setTimeout(() => {
            if (forgotPasswordWidgetId.current !== null && window.turnstile) {
              window.turnstile.execute(forgotPasswordWidgetId.current);
            }
          }, 100);
        } catch (err) {
          console.error('Turnstile render error:', err);
        }
      }
    };

    if (window.turnstile) {
      initTurnstile();
    }

    return () => {
      if (forgotPasswordWidgetId.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(forgotPasswordWidgetId.current);
        } catch (err) {
          // Widget already removed
        }
        forgotPasswordWidgetId.current = null;
      }
    };
  }, [showForgotPassword]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const formData = new FormData(e.target);
    const username = formData.get('username');
    const password = formData.get('password');
    const email = formData.get('email');
    const termsAccepted = formData.get('terms') === 'on';

    try {
      // Wait for Turnstile token if not ready yet
      if (!turnstileTokenRef.current) {
        // Show spinning animation after 50ms delay
        const animationTimeout = setTimeout(() => setShowLoadingAnimation(true), 50);

        // Try executing if needed (reset first to avoid "already executing" warning)
        if (window.turnstile && turnstileWidgetId.current !== null) {
          window.turnstile.reset(turnstileWidgetId.current);
          window.turnstile.execute(turnstileWidgetId.current);
        }

        // Wait up to 3 seconds for token, checking every 500ms
        let attempts = 0;
        while (!turnstileTokenRef.current && attempts < 6) {
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
        }

        clearTimeout(animationTimeout);
        setShowLoadingAnimation(false);

        // Check if we have a token after waiting
        if (!turnstileTokenRef.current) {
          setLoading(false);
          throw new Error('verification in progress. please try again in a moment.');
        }
      }

      setShowLoadingAnimation(true);

      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      let body;

      if (isLogin) {
        body = { username, password, turnstile_token: turnstileTokenRef.current || turnstileToken };
      } else {
        // E2E: generate keys client-side before registration
        const slateKey = await generateSlateKey();
        const encryptionSalt = generateSalt();
        const passwordDerivedKey = await deriveKey(password, encryptionSalt);
        const wrappedKey = await wrapKey(slateKey, passwordDerivedKey);

        const recoveryPhrase = generateRecoveryPhrase(wordlist);
        const recoverySalt = generateSalt();
        const recoveryDerivedKey = await deriveKey(recoveryPhrase, recoverySalt);
        const recoveryWrappedKey = await wrapKey(slateKey, recoveryDerivedKey);

        // Store recovery phrase temporarily to show after verification
        setPendingRecoveryPhrase(recoveryPhrase);
        // Store slate key temporarily to save to IndexedDB after we get the user ID
        window.__pendingSlateKey = slateKey;

        body = {
          username, password, email, termsAccepted,
          turnstile_token: turnstileTokenRef.current || turnstileToken,
          wrappedKey, recoveryWrappedKey, recoverySalt, encryptionSalt
        };
      }

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        if (window.turnstile && turnstileWidgetId.current !== null) {
          window.turnstile.reset(turnstileWidgetId.current);
          setTurnstileToken('');
          turnstileTokenRef.current = '';
          setTimeout(() => {
            if (window.turnstile && turnstileWidgetId.current !== null) {
              window.turnstile.execute(turnstileWidgetId.current);
            }
          }, 100);
        }
        throw new Error(data.error || 'Authentication failed');
      }

      // Handle E2E key storage after successful auth
      if (data.user?.id) {
        if (!isLogin && window.__pendingSlateKey) {
          // Registration: save the slate key we just generated
          await saveSlateKey(data.user.id, window.__pendingSlateKey);
          delete window.__pendingSlateKey;
        } else if (isLogin && data.migrationSlateKey) {
          // Migration: server gave us the slate key (one-time)
          const keyBytes = Uint8Array.from(atob(data.migrationSlateKey), c => c.charCodeAt(0));
          await saveSlateKey(data.user.id, keyBytes);
          // Re-wrap with password using client-side crypto (consistent encoding)
          const newEncryptionSalt = generateSalt();
          const passwordDerivedKey = await deriveKey(password, newEncryptionSalt);
          const newWrappedKey = await wrapKey(keyBytes, passwordDerivedKey);
          // Also generate recovery key
          const recoveryPhrase = generateRecoveryPhrase(wordlist);
          const recoverySalt = generateSalt();
          const recoveryDerivedKey = await deriveKey(recoveryPhrase, recoverySalt);
          const recoveryWrappedKey = await wrapKey(keyBytes, recoveryDerivedKey);
          await fetch(`${API_URL}/account/finalize-e2e-migration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ wrappedKey: newWrappedKey, encryptionSalt: newEncryptionSalt, recoveryWrappedKey, recoverySalt }),
          });
          data.recoveryPhrase = recoveryPhrase;
        } else if (isLogin && data.wrappedKey && data.encryptionSalt) {
          // E2E login: unwrap slate key client-side
          try {
            const passwordDerivedKey = await deriveKey(password, data.encryptionSalt);
            const slateKey = await unwrapKey(data.wrappedKey, passwordDerivedKey);
            await saveSlateKey(data.user.id, slateKey);
          } catch (unwrapErr) {
            console.error('E2E unwrap failed:', unwrapErr);
            throw new Error('failed to unlock your slates. please try again.');
          }
        }
      }

      if (!isLogin) {
        setRegisteredEmail(email);
        setShowVerification(true);
        setSuccess(data.message);
        e.target.reset();
      } else if (data.requiresVerification) {
        setRegisteredEmail(data.user.email);
        setShowVerification(true);
        setPendingAuthData(data);
        setSuccess('Please verify your email to continue');
        e.target.reset();
      } else {
        onAuth(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setShowLoadingAnimation(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const formData = new FormData(e.target);
    const code = formData.get('code');

    try {
      const response = await fetch(`${API_URL}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: registeredEmail, code }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Verification failed');
      }

      setSuccess(data.message);

      // If this was a login requiring verification, complete the auth now
      if (pendingAuthData) {
        // Update the email_verified status
        pendingAuthData.user.email_verified = true;
        onAuth(pendingAuthData);
      } else if (pendingRecoveryPhrase) {
        // Show recovery key modal after successful verification for new registrations
        // Don't close yet - the recovery modal will handle it
      } else {
        // Close modal after successful verification for new registrations
        setTimeout(() => onClose(), 2000);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: registeredEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to resend code');
      }

      setSuccess(data.message);

      // Start 60s cooldown
      setResendCooldown(60);
      const interval = setInterval(() => {
        setResendCooldown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const formData = new FormData(e.target);
    const email = formData.get('email');

    try {
      // Wait for Turnstile token if not ready yet
      if (!turnstileTokenRef.current) {
        // Show spinning animation after 50ms delay
        const animationTimeout = setTimeout(() => setShowLoadingAnimation(true), 50);

        // Try executing if needed
        if (window.turnstile && forgotPasswordWidgetId.current !== null) {
          window.turnstile.execute(forgotPasswordWidgetId.current);
        }

        // Wait up to 3 seconds for token, checking every 500ms
        let attempts = 0;
        while (!turnstileTokenRef.current && attempts < 6) {
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
        }

        clearTimeout(animationTimeout);
        setShowLoadingAnimation(false);

        // Check if we have a token after waiting
        if (!turnstileTokenRef.current) {
          setLoading(false);
          throw new Error('verification in progress. please try again in a moment.');
        }
      }

      setShowLoadingAnimation(true);

      const response = await fetch(`${API_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, turnstile_token: turnstileTokenRef.current || turnstileToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Reset Turnstile on error
        if (window.turnstile && forgotPasswordWidgetId.current !== null) {
          window.turnstile.reset(forgotPasswordWidgetId.current);
          setTurnstileToken('');
          turnstileTokenRef.current = '';
          // Re-execute for next attempt
          setTimeout(() => {
            if (window.turnstile && forgotPasswordWidgetId.current !== null) {
              window.turnstile.execute(forgotPasswordWidgetId.current);
            }
          }, 100);
        }
        throw new Error(data.error || 'Failed to send reset code');
      }

      setSuccess(data.message);
      setResetEmail(email);
      setShowForgotPassword(false);
      setShowResetPassword(true);
      // Clear form to prevent input value persistence
      e.target.reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setShowLoadingAnimation(false);
    }
  };

  const [resetStep, setResetStep] = useState('otp'); // 'otp' | 'recovery-entry' | 'recovery-submit' | 'destructive'
  const [resetOtp, setResetOtp] = useState('');
  const [resetRecoveryInput, setResetRecoveryInput] = useState('');
  const [destructiveConfirmed, setDestructiveConfirmed] = useState(false);
  const [resetRecoveryPhrase, setResetRecoveryPhrase] = useState(null); // new phrase from server

  const normalizeRecoveryPhrase = (phrase) => phrase.trim().toLowerCase().replace(/\s+/g, ' ');

  const handleResetPassword = async (method) => {
    setError('');
    setLoading(true);

    try {
      // Get new password from the form
      const passwordInput = document.querySelector('#reset-new-password');
      if (!passwordInput || !passwordInput.value) {
        throw new Error(strings.auth.resetPassword.errors.newPasswordRequired);
      }
      const newPassword = passwordInput.value;

      if (method === 'recovery') {
        const recoveryPhrase = normalizeRecoveryPhrase(resetRecoveryInput);
        if (!recoveryPhrase) {
          throw new Error(strings.auth.resetPassword.errors.recoveryRequired);
        }

        // Fetch wrapped recovery data so E2E users can unwrap/rewrap locally (ZK)
        const recoveryRes = await fetch(`${API_URL}/auth/recovery-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: resetEmail, code: resetOtp }),
        });
        const recoveryData = await recoveryRes.json();
        if (!recoveryRes.ok) {
          throw new Error(recoveryData.error || strings.auth.resetPassword.errors.recoveryDataFailed);
        }

        if (recoveryData.e2e) {
          let slateKey;
          try {
            const recoveryDerivedKey = await deriveKey(recoveryPhrase, recoveryData.recoverySalt);
            slateKey = await unwrapKey(recoveryData.recoveryWrappedKey, recoveryDerivedKey);
          } catch (unwrapErr) {
            console.error('E2E recovery unwrap failed:', unwrapErr);
            throw new Error(strings.auth.resetPassword.errors.invalidRecovery);
          }

          // Re-wrap slate key with new password + new recovery phrase (client-side)
          const newEncryptionSalt = generateSalt();
          const passwordDerivedKey = await deriveKey(newPassword, newEncryptionSalt);
          const newWrappedKey = await wrapKey(slateKey, passwordDerivedKey);

          const newRecoveryPhrase = generateRecoveryPhrase(wordlist);
          const newRecoverySalt = generateSalt();
          const newRecoveryDerivedKey = await deriveKey(newRecoveryPhrase, newRecoverySalt);
          const newRecoveryWrappedKey = await wrapKey(slateKey, newRecoveryDerivedKey);

          const response = await fetch(`${API_URL}/auth/reset-password-with-recovery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: resetEmail,
              code: resetOtp,
              newPassword,
              newWrappedKey,
              newRecoveryWrappedKey,
              newRecoverySalt,
              newEncryptionSalt,
            }),
          });

          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error || strings.auth.resetPassword.errors.resetFailed);
          }

          setSuccess(data.message);
          setResetRecoveryPhrase(newRecoveryPhrase);
          return;
        }

        // Non-E2E accounts: fallback to server-side recovery reset
        const response = await fetch(`${API_URL}/auth/reset-password-with-recovery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: resetEmail, code: resetOtp, newPassword, recoveryPhrase }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || strings.auth.resetPassword.errors.resetFailed);
        }

        setSuccess(data.message);
        if (data.recoveryPhrase) {
          setResetRecoveryPhrase(data.recoveryPhrase);
          return;
        }
      } else {
        // Destructive reset (wipes slates)
        const response = await fetch(`${API_URL}/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: resetEmail, code: resetOtp, newPassword }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || strings.auth.resetPassword.errors.resetFailed);
        }

        setSuccess(data.message);
        if (data.recoveryPhrase) {
          setResetRecoveryPhrase(data.recoveryPhrase);
          return;
        }
      }

      // Go back to login after success
      setTimeout(() => {
        setShowResetPassword(false);
        setResetStep('otp');
        setResetOtp('');
        setResetRecoveryInput('');
        setIsLogin(true);
        setError('');
        setSuccess('');
      }, 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Show forgot password form
  if (showForgotPassword) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] p-8 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-xl text-white mb-6">forgot password</h2>

          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="block text-sm opacity-70 mb-2">email address</label>
              <input
                type="email"
                name="email"
                required
                className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-2 text-white focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
                placeholder="your@email.com"
              />
              <p className="text-xs opacity-50 mt-1">we'll send you a 6-digit reset code</p>
            </div>

            {success && (
              <div className="text-green-500 text-sm">{success}</div>
            )}

            {error && (
              <div className="text-red-500 text-sm">{error}</div>
            )}

            <div ref={forgotPasswordTurnstileRef}></div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full border py-2 transition-all duration-300 mt-6 ${
                showLoadingAnimation
                  ? 'auth-button-loading border-transparent text-white cursor-wait'
                  : 'border-[var(--theme-border)] hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5]'
              }`}
            >
              send reset code
            </button>
          </form>

          <button
            onClick={() => setShowForgotPassword(false)}
            className="mt-4 w-full py-2 opacity-70 hover:opacity-100 transition-opacity text-sm"
          >
            back to login
          </button>

          <button
            onClick={onClose}
            className="mt-2 w-full py-2 opacity-50 hover:opacity-100 transition-opacity text-sm"
          >
            cancel
          </button>
        </div>
      </div>
    );
  }

  // Show reset password form
  if (showResetPassword) {
    // Show new recovery phrase after successful reset
    if (resetRecoveryPhrase) {
      return (
        <RecoveryKeyModal
          recoveryPhrase={resetRecoveryPhrase}
          onAcknowledge={() => {
            setResetRecoveryPhrase(null);
            setShowResetPassword(false);
            setResetStep('otp');
            setResetOtp('');
            setResetRecoveryInput('');
            setIsLogin(true);
            setError('');
            setSuccess('');
          }}
        />
      );
    }

    const resetBackToLogin = () => {
      setShowResetPassword(false);
      setResetStep('otp');
      setResetOtp('');
      setResetRecoveryInput('');
      setDestructiveConfirmed(false);
      setIsLogin(true);
      setError('');
      setSuccess('');
    };

    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] p-8 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>

          {/* Step 1: OTP entry */}
          {resetStep === 'otp' && (
            <div className="space-y-4">
              <h2 className="text-xl text-white mb-6">{strings.auth.resetPassword.otpStep.title}</h2>
              <div>
                <label className="block text-sm opacity-70 mb-2">{strings.auth.resetPassword.code}</label>
                <input
                  type="text"
                  value={resetOtp}
                  onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-2 text-white text-center text-2xl tracking-widest focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
                  placeholder="000000"
                  autoFocus
                />
                <p className="text-xs opacity-50 mt-1">{strings.auth.resetPassword.otpStep.description}</p>
              </div>

              {error && <div className="text-red-500 text-sm">{error}</div>}

              <button
                onClick={() => {
                  if (resetOtp.length !== 6) {
                    setError('enter the 6-digit code from your email');
                    return;
                  }
                  setError('');
                  setResetStep('recovery-entry');
                }}
                className="w-full border border-[var(--theme-border)] py-2 transition-all duration-300 hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5]"
              >
                {strings.auth.resetPassword.otpStep.submit}
              </button>

              <button
                onClick={resetBackToLogin}
                className="w-full py-2 opacity-70 hover:opacity-100 transition-opacity text-sm"
              >
                {strings.auth.forgotPassword.back}
              </button>
            </div>
          )}

          {/* Step 2: Recovery key entry */}
          {resetStep === 'recovery-entry' && (
            <div className="space-y-4">
              <h2 className="text-xl text-white mb-6">{strings.auth.resetPassword.recoveryEntry.title}</h2>
              <textarea
                value={resetRecoveryInput}
                onChange={(e) => setResetRecoveryInput(e.target.value)}
                rows={4}
                className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-3 text-white focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors text-sm font-mono"
                placeholder={strings.auth.resetPassword.recoveryEntry.placeholder}
                autoFocus
              />

              {error && <div className="text-red-500 text-sm">{error}</div>}

              <button
                onClick={() => {
                  if (!resetRecoveryInput.trim()) {
                    setError('enter your recovery key');
                    return;
                  }
                  setError('');
                  setResetStep('recovery-submit');
                }}
                className="w-full border border-[var(--theme-border)] py-2 transition-all duration-300 hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5]"
              >
                {strings.auth.resetPassword.recoveryEntry.submit}
              </button>

              <button
                onClick={() => { setError(''); setDestructiveConfirmed(false); setResetStep('destructive'); }}
                className="w-full py-2 opacity-70 hover:opacity-100 transition-opacity text-sm text-red-400"
              >
                {strings.auth.resetPassword.recoveryEntry.noKey}
              </button>
            </div>
          )}

          {/* Step 3a: New password (with recovery) */}
          {resetStep === 'recovery-submit' && (
            <div className="space-y-4">
              <h2 className="text-xl text-white mb-6">{strings.auth.resetPassword.withRecovery.title}</h2>
              <p className="text-sm text-[var(--theme-text-muted)]">{strings.auth.resetPassword.withRecovery.description}</p>

              <div>
                <label className="block text-sm opacity-70 mb-2">{strings.auth.resetPassword.newPassword}</label>
                <input
                  id="reset-new-password"
                  type="password"
                  minLength={6}
                  className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-2 text-white focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
                  placeholder={strings.auth.resetPassword.newPasswordPlaceholder}
                  autoFocus
                />
              </div>

              {success && <div className="text-green-500 text-sm">{success}</div>}
              {error && <div className="text-red-500 text-sm">{error}</div>}

              <button
                onClick={() => handleResetPassword('recovery')}
                disabled={loading}
                className="w-full border border-[var(--theme-border)] py-2 transition-all duration-300 hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5] disabled:opacity-50"
              >
                {strings.auth.resetPassword.withRecovery.submit}
              </button>

              <button
                onClick={() => { setError(''); setSuccess(''); setResetStep('recovery-entry'); }}
                className="w-full py-2 opacity-70 hover:opacity-100 transition-opacity text-sm"
              >
                back
              </button>
            </div>
          )}

          {/* Step 3b: Destructive reset */}
          {resetStep === 'destructive' && (
            <div className="space-y-4">
              <h2 className="text-xl text-white mb-6">{strings.auth.resetPassword.destructive.title}</h2>

              <div className="bg-red-500/10 border border-red-500/30 rounded p-3">
                <p className="text-red-400 text-sm mb-3">{strings.auth.resetPassword.destructive.warning}</p>
                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={destructiveConfirmed}
                    onChange={(e) => setDestructiveConfirmed(e.target.checked)}
                    className="mt-0.5 accent-red-500"
                  />
                  <span className="text-red-300 text-xs">{strings.auth.resetPassword.destructive.checkbox}</span>
                </label>
              </div>

              <div>
                <label className="block text-sm opacity-70 mb-2">{strings.auth.resetPassword.newPassword}</label>
                <input
                  id="reset-new-password"
                  type="password"
                  minLength={6}
                  className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-2 text-white focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
                  placeholder={strings.auth.resetPassword.newPasswordPlaceholder}
                  autoFocus
                />
              </div>

              {success && <div className="text-green-500 text-sm">{success}</div>}
              {error && <div className="text-red-500 text-sm">{error}</div>}

              <button
                onClick={() => handleResetPassword('destructive')}
                disabled={loading || !destructiveConfirmed}
                className="w-full border border-red-500/50 text-red-400 py-2 transition-all duration-300 hover:bg-red-500 hover:text-white hover:border-red-500 disabled:opacity-50"
              >
                {strings.auth.resetPassword.destructive.submit}
              </button>

              <button
                onClick={() => { setError(''); setSuccess(''); setDestructiveConfirmed(false); setResetStep('recovery-entry'); }}
                className="w-full py-2 opacity-70 hover:opacity-100 transition-opacity text-sm"
              >
                {strings.auth.resetPassword.destructive.back}
              </button>
            </div>
          )}

        </div>
      </div>
    );
  }

  // Show recovery key modal after verification if we have a pending phrase
  if (showVerification && pendingRecoveryPhrase && success) {
    return (
      <RecoveryKeyModal
        recoveryPhrase={pendingRecoveryPhrase}
        onAcknowledge={() => {
          setPendingRecoveryPhrase(null);
          onClose();
        }}
      />
    );
  }

  // Show verification form if needed
  if (showVerification) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] p-8 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-xl text-white mb-6">{strings.auth.verify.title}</h2>

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="block text-sm opacity-70 mb-2">{strings.auth.verify.label}</label>
              <input
                type="text"
                name="code"
                required
                maxLength={6}
                pattern="[0-9]{6}"
                className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-2 text-white text-center text-2xl tracking-widest focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
                placeholder={strings.auth.verify.codePlaceholder}
              />
              <p className="text-xs opacity-50 mt-1">{strings.auth.verify.instructions(registeredEmail)}</p>
            </div>

            {success && (
              <div className="text-green-500 text-sm">{success}</div>
            )}

            {error && (
              <div className="text-red-500 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full border border-[var(--theme-border)] py-2 hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5] transition-all duration-300 mt-6 disabled:opacity-50"
            >
              {strings.auth.verify.submit}
            </button>
          </form>

          <button
            onClick={handleResendCode}
            disabled={loading || resendCooldown > 0}
            className="mt-4 w-full py-2 opacity-70 hover:opacity-100 transition-opacity text-sm disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {resendCooldown > 0 ? strings.auth.verify.resendCountdown(resendCooldown) : strings.auth.verify.resend}
          </button>

          <button
            onClick={onClose}
            className="mt-2 w-full py-2 opacity-50 hover:opacity-100 transition-opacity text-sm"
          >
            {strings.auth.verify.skip}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-modal-overlay" onClick={onClose}>
      <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] p-8 max-w-md w-full shadow-2xl animate-modal-content" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl text-white mb-6">{isLogin ? strings.auth.login.title : strings.auth.signup.title}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm opacity-70 mb-2">{isLogin ? strings.auth.login.username : strings.auth.signup.username}</label>
            <input
              type="text"
              name="username"
              required
              minLength={3}
              maxLength={20}
              pattern="[a-z0-9][a-z0-9._\-]*[a-z0-9]|[a-z0-9]"
              title="username can only contain lowercase letters, numbers, dots, hyphens, and underscores"
              onChange={(e) => {
                e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '');
              }}
              className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-2 text-white focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
              placeholder={isLogin ? strings.auth.login.usernamePlaceholder : strings.auth.signup.usernamePlaceholder}
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-sm opacity-70 mb-2">{strings.auth.signup.email}</label>
              <input
                type="email"
                name="email"
                required
                className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-2 text-white focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
                placeholder={strings.auth.signup.emailPlaceholder}
              />
            </div>
          )}

          <div>
            <label className="block text-sm opacity-70 mb-2">{isLogin ? strings.auth.login.password : strings.auth.signup.password}</label>
            <input
              type="password"
              name="password"
              required
              minLength={6}
              className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-2 text-white focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
              placeholder={isLogin ? strings.auth.login.passwordPlaceholder : strings.auth.signup.passwordPlaceholder}
            />
          </div>

          {!isLogin && (
            <>
              <div className="flex items-start gap-2 pt-2">
                <input
                  type="checkbox"
                  name="terms"
                  id="terms"
                  required
                  className="mt-1"
                />
                <label htmlFor="terms" className="text-xs opacity-70">
                  i agree to the{' '}
                  <a href="/terms" target="_blank" className="text-white hover:underline">
                    terms
                  </a>
                  {' '}&{' '}
                  <a href="/privacy" target="_blank" className="text-white hover:underline">
                    privacy policy
                  </a>
                </label>
              </div>
              <p className="text-xs opacity-50 mt-2">{strings.auth.signup.privacyNote}</p>
            </>
          )}

          {success && (
            <div className="text-green-500 text-sm">{success}</div>
          )}

          {error && (
            <div className="text-red-500 text-sm">{error}</div>
          )}

          <div ref={turnstileRef}></div>

          <style>{`
            @keyframes rotate-gradient {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            .auth-button-loading {
              position: relative;
              border: 1px solid transparent;
              background: #1a1a1a;
            }
            .auth-button-loading::before {
              content: '';
              position: absolute;
              top: -2px;
              left: -2px;
              right: -2px;
              bottom: -2px;
              background: conic-gradient(from 0deg, #333, #999, #333);
              border-radius: inherit;
              z-index: -1;
              animation: rotate-gradient 2s linear infinite;
            }
          `}</style>

          <button
            type="submit"
            disabled={loading}
            className={`w-full border py-2 transition-all duration-300 mt-6 ${
              showLoadingAnimation
                ? 'auth-button-loading border-transparent text-white cursor-wait'
                : 'border-[var(--theme-border)] hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5]'
            }`}
          >
            {isLogin ? strings.auth.login.submit : strings.auth.signup.submit}
          </button>
        </form>

        {isLogin && (
          <button
            onClick={() => setShowForgotPassword(true)}
            className="mt-3 w-full py-2 opacity-60 hover:opacity-100 transition-opacity text-sm"
          >
            forgot password?
          </button>
        )}

        {/* Google OAuth button */}
        <div className="mt-4 relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--theme-border)]"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-[var(--theme-bg-secondary)] text-[var(--theme-text-dim)]">or</span>
          </div>
        </div>

        <button
          onClick={() => window.location.href = '/auth/google'}
          className="mt-4 w-full border border-[var(--theme-border)] py-2 hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5] transition-all duration-300 flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          continue with google
        </button>

        <button
          onClick={() => setIsLogin(!isLogin)}
          className="mt-4 w-full py-2 opacity-70 hover:opacity-100 transition-opacity text-sm"
        >
          {isLogin ? `${strings.auth.login.noAccount} ${strings.auth.login.signupLink}` : `${strings.auth.signup.haveAccount} ${strings.auth.signup.loginLink}`}
        </button>

        <button
          onClick={onClose}
          className="mt-2 w-full py-2 opacity-50 hover:opacity-100 transition-opacity text-sm"
        >
          cancel
        </button>

        <div className="mt-4 pt-3 border-t border-[var(--theme-border)] text-center text-xs text-[var(--theme-text-dim)]">
          {strings.verify.authFooter(VERSION)}
          <span className="mx-1">·</span>
          <VerifyBadge className="text-[var(--theme-text-dim)]">{strings.verify.authFooterVerify}</VerifyBadge>
        </div>
      </div>
    </div>
  );
}
