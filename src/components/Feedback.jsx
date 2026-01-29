import React, { useState } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

export function Feedback({ token, username, email }) {
  const [message, setMessage] = useState('');
  const [contactEmail, setContactEmail] = useState(email || '');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, contact_email: contactEmail || null })
      });

      if (response.ok) {
        setSubmitted(true);
      } else {
        const data = await response.json();
        setError(data.error || strings.feedback.error);
      }
    } catch (err) {
      setError(strings.feedback.error);
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="min-h-screen bg-[#111] flex items-center justify-center p-4 font-mono text-[#a0a0a0]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
        {token && token !== 'checking' ? (
          submitted ? (
            <div className="text-center">
              <h2 className="text-lg md:text-xl text-white mb-4">{strings.feedback.thankYou.title}</h2>
              <p className="text-[#888] text-sm mb-6">{strings.feedback.thankYou.message}</p>
              <button
                onClick={goBack}
                className="text-sm text-[#888] hover:text-white transition-colors"
              >
                {strings.feedback.thankYou.back}
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-lg md:text-xl text-white mb-2">{strings.feedback.title}</h2>
              <p className="text-[#666] text-xs mb-6">{strings.feedback.subtitle(username)}</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={strings.feedback.placeholder}
                  rows={5}
                  className="w-full bg-[#111] border border-[#333] rounded px-4 py-3 text-sm text-white placeholder-[#555] resize-none focus:outline-none focus:border-[#555] transition-colors"
                  autoFocus
                />
                <div>
                  <label className="block text-xs text-[#666] mb-1.5">{strings.feedback.emailLabel}</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={e => setContactEmail(e.target.value)}
                    placeholder={strings.feedback.emailPlaceholder}
                    className="w-full bg-[#111] border border-[#333] rounded px-4 py-2 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#555] transition-colors"
                  />
                </div>

                {error && <p className="text-red-400 text-xs">{error}</p>}

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={goBack}
                    className="text-sm text-[#666] hover:text-white transition-colors"
                  >
                    {strings.feedback.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !message.trim()}
                    className="bg-white text-black px-5 py-2 rounded text-sm hover:bg-[#e5e5e5] transition-colors disabled:opacity-30"
                  >
                    {loading ? strings.feedback.sending : strings.feedback.submit}
                  </button>
                </div>
              </form>
            </>
          )
        ) : (
          <div className="text-center">
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.feedback.title}</h2>
            <p className="text-[#888] text-sm mb-4">{strings.feedback.loggedOut.message}</p>
            <a
              href={`mailto:${strings.feedback.loggedOut.email}`}
              className="text-white hover:text-[#ccc] transition-colors text-lg"
            >
              {strings.feedback.loggedOut.email}
            </a>
            <p className="text-[#555] text-xs mt-6">{strings.feedback.loggedOut.orLogin}</p>
            <button
              onClick={goBack}
              className="text-sm text-[#666] hover:text-white transition-colors mt-4"
            >
              {strings.feedback.thankYou.back}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
