import React, { useState } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';
import { PageHeader } from './PageHeader';

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

  const wordCount = message.trim() ? message.trim().split(/\s+/).length : 0;
  const signedIn = token && token !== 'checking';

  return (
    <div className="min-h-screen flex flex-col bg-[var(--theme-bg)] text-[var(--theme-text-muted)] font-mono">
      <PageHeader label={strings.feedback.title} onHome={goBack} />

      <main className="flex-1 w-full max-w-2xl mx-auto px-6 py-12 md:py-20">
        {!signedIn ? (
          /* Signed out: no form to submit through, so lead with the address. */
          <div>
            <h1 className="text-3xl md:text-4xl text-[var(--theme-accent)] mb-3">{strings.feedback.title}</h1>
            <p className="text-sm leading-relaxed mb-8 max-w-md">{strings.feedback.loggedOut.message}</p>
            <a
              href={`mailto:${strings.feedback.loggedOut.email}`}
              className="inline-block text-lg md:text-xl text-[var(--theme-accent)] border-b border-[var(--theme-border)] hover:border-[var(--theme-accent)] pb-1 transition-colors"
            >
              {strings.feedback.loggedOut.email}
            </a>
            <p className="text-xs text-[var(--theme-text-dim)] mt-8">{strings.feedback.loggedOut.orLogin}</p>
            <button
              onClick={goBack}
              className="text-sm text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors mt-8"
            >
              {strings.feedback.thankYou.back}
            </button>
          </div>
        ) : submitted ? (
          <div className="animate-[fadeInUp_0.4s_ease-out]">
            <div className="text-4xl text-green-500 mb-6 select-none">&#10003;</div>
            <h1 className="text-3xl md:text-4xl text-[var(--theme-accent)] mb-3">{strings.feedback.thankYou.title}</h1>
            <p className="text-sm leading-relaxed max-w-md mb-10">{strings.feedback.thankYou.message}</p>
            <button
              onClick={goBack}
              className="text-sm text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors"
            >
              {strings.feedback.thankYou.back}
            </button>
          </div>
        ) : (
          <>
            <h1 className="text-3xl md:text-4xl text-[var(--theme-accent)] mb-2">{strings.feedback.title}</h1>
            <p className="text-sm mb-1">{strings.feedback.subtitle(username)}</p>
            <p className="text-xs text-[var(--theme-text-dim)] mb-8">{strings.feedback.hint}</p>

            <form onSubmit={handleSubmit}>
              {/* The box is the writing surface, not a boxed-in form field:
                  this is a writing app, so saying something should feel like
                  writing a slate. */}
              <div className="border-b border-[var(--theme-border)] focus-within:border-[var(--theme-text-dim)] transition-colors mb-2">
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder={strings.feedback.placeholder}
                  rows={7}
                  className="w-full bg-transparent text-base leading-relaxed text-[var(--theme-text)] placeholder-[var(--theme-text-dim)] resize-none focus:outline-none py-2"
                  autoFocus
                />
              </div>
              <div className="text-xs text-[var(--theme-text-dim)] text-right mb-10 h-4">
                {wordCount > 0 && strings.feedback.words(wordCount)}
              </div>

              <label className="block text-xs text-[var(--theme-text-dim)] mb-2">{strings.feedback.emailLabel}</label>
              <input
                type="email"
                value={contactEmail}
                onChange={e => setContactEmail(e.target.value)}
                placeholder={strings.feedback.emailPlaceholder}
                className="w-full bg-transparent border-b border-[var(--theme-border)] focus:border-[var(--theme-text-dim)] py-2 text-sm text-[var(--theme-text)] placeholder-[var(--theme-text-dim)] focus:outline-none transition-colors mb-10"
              />

              {error && <p className="text-red-400 text-xs mb-4">{error}</p>}

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={goBack}
                  className="text-sm text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors"
                >
                  {strings.feedback.cancel}
                </button>
                <button
                  type="submit"
                  disabled={loading || !message.trim()}
                  className="bg-white text-black px-6 py-2.5 rounded text-sm font-medium hover:bg-[#e5e5e5] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {loading ? strings.feedback.sending : strings.feedback.submit}
                </button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
