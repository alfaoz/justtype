import React, { useState, useRef, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

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

        // Try executing if needed
        if (window.turnstile && turnstileWidgetId.current !== null) {
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
      const body = isLogin
        ? { username, password, turnstile_token: turnstileTokenRef.current || turnstileToken }
        : { username, password, email, termsAccepted, turnstile_token: turnstileTokenRef.current || turnstileToken };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Required for HttpOnly cookie auth
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        // Reset Turnstile on error
        if (window.turnstile && turnstileWidgetId.current !== null) {
          window.turnstile.reset(turnstileWidgetId.current);
          setTurnstileToken('');
          turnstileTokenRef.current = '';
          // Re-execute for next attempt
          setTimeout(() => {
            if (window.turnstile && turnstileWidgetId.current !== null) {
              window.turnstile.execute(turnstileWidgetId.current);
            }
          }, 100);
        }
        throw new Error(data.error || 'Authentication failed');
      }

      if (!isLogin) {
        // Show verification code screen after registration
        setRegisteredEmail(email);
        setShowVerification(true);
        setSuccess(data.message);
        // Clear form to prevent input value persistence
        e.target.reset();
      } else if (data.requiresVerification) {
        // Login successful but email not verified - show verification screen
        setRegisteredEmail(data.user.email);
        setShowVerification(true);
        setPendingAuthData(data);
        setSuccess('Please verify your email to continue');
        // Clear form to prevent input value persistence
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

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const formData = new FormData(e.target);
    const code = formData.get('code');
    const newPassword = formData.get('newPassword');

    try {
      const response = await fetch(`${API_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, code, newPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccess(data.message);
      // Go back to login after success
      setTimeout(() => {
        setShowResetPassword(false);
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
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-[#1a1a1a] border border-[#333] p-8 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-xl text-white mb-6">forgot password</h2>

          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="block text-sm opacity-70 mb-2">email address</label>
              <input
                type="email"
                name="email"
                required
                className="w-full bg-[#111111] border border-[#333] px-4 py-2 text-white focus:border-[#666] focus:outline-none transition-colors"
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
                  : 'border-[#333] hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5]'
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
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-[#1a1a1a] border border-[#333] p-8 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
          <h2 className="text-xl text-white mb-6">reset password</h2>

          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-sm opacity-70 mb-2">verification code</label>
              <input
                type="text"
                name="code"
                required
                maxLength={6}
                pattern="[0-9]{6}"
                className="w-full bg-[#111111] border border-[#333] px-4 py-2 text-white text-center text-2xl tracking-widest focus:border-[#666] focus:outline-none transition-colors"
                placeholder="000000"
              />
              <p className="text-xs opacity-50 mt-1">check your email for the code</p>
            </div>

            <div>
              <label className="block text-sm opacity-70 mb-2">new password</label>
              <input
                type="password"
                name="newPassword"
                required
                minLength={6}
                className="w-full bg-[#111111] border border-[#333] px-4 py-2 text-white focus:border-[#666] focus:outline-none transition-colors"
                placeholder="at least 6 characters"
              />
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
              className="w-full border border-[#333] py-2 hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5] transition-all duration-300 mt-6 disabled:opacity-50"
            >
              reset password
            </button>
          </form>

          <button
            onClick={() => {
              setShowResetPassword(false);
              setIsLogin(true);
            }}
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

  // Show verification form if needed
  if (showVerification) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-[#1a1a1a] border border-[#333] p-8 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
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
                className="w-full bg-[#111111] border border-[#333] px-4 py-2 text-white text-center text-2xl tracking-widest focus:border-[#666] focus:outline-none transition-colors"
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
              className="w-full border border-[#333] py-2 hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5] transition-all duration-300 mt-6 disabled:opacity-50"
            >
              {strings.auth.verify.submit}
            </button>
          </form>

          <button
            onClick={handleResendCode}
            disabled={loading}
            className="mt-4 w-full py-2 opacity-70 hover:opacity-100 transition-opacity text-sm disabled:opacity-50"
          >
            {strings.auth.verify.resend}
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
      <div className="bg-[#1a1a1a] border border-[#333] p-8 max-w-md w-full shadow-2xl animate-modal-content" onClick={e => e.stopPropagation()}>
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
              pattern="[a-z0-9_]+"
              title="username can only contain lowercase letters (a-z), numbers (0-9), and underscores (_)"
              onChange={(e) => {
                e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
              }}
              className="w-full bg-[#111111] border border-[#333] px-4 py-2 text-white focus:border-[#666] focus:outline-none transition-colors"
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
                className="w-full bg-[#111111] border border-[#333] px-4 py-2 text-white focus:border-[#666] focus:outline-none transition-colors"
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
              className="w-full bg-[#111111] border border-[#333] px-4 py-2 text-white focus:border-[#666] focus:outline-none transition-colors"
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
                : 'border-[#333] hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5]'
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
            <div className="w-full border-t border-[#333]"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-[#1a1a1a] text-[#666]">or</span>
          </div>
        </div>

        <button
          onClick={() => window.location.href = '/auth/google'}
          className="mt-4 w-full border border-[#333] py-2 hover:bg-[#e5e5e5] hover:text-black hover:border-[#e5e5e5] transition-all duration-300 flex items-center justify-center gap-2"
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
      </div>
    </div>
  );
}
