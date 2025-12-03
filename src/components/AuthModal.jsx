import React, { useState } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

export function AuthModal({ onClose, onAuth }) {
  const [isLogin, setIsLogin] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [showVerification, setShowVerification] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [pendingAuthData, setPendingAuthData] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const formData = new FormData(e.target);
    const username = formData.get('username');
    const password = formData.get('password');
    const email = formData.get('email');

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const body = isLogin
        ? { username, password }
        : { username, password, email };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      if (!isLogin) {
        // Show verification code screen after registration
        setRegisteredEmail(email);
        setShowVerification(true);
        setSuccess(data.message);
      } else if (data.requiresVerification) {
        // Login successful but email not verified - show verification screen
        setRegisteredEmail(data.user.email);
        setShowVerification(true);
        setPendingAuthData(data);
        setSuccess('Please verify your email to continue');
      } else {
        onAuth(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-[#333] p-8 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl text-white mb-6">{isLogin ? strings.auth.login.title : strings.auth.signup.title}</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm opacity-70 mb-2">{isLogin ? strings.auth.login.username : strings.auth.signup.username}</label>
            <input
              type="text"
              name="username"
              required
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
            {isLogin ? strings.auth.login.submit : strings.auth.signup.submit}
          </button>
        </form>

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
