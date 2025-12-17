import React, { useState, useEffect, useRef } from 'react';
import { Writer } from './components/Writer';
import { SlateManager } from './components/SlateManager';
import { PublicViewer } from './components/PublicViewer';
import { AuthModal } from './components/AuthModal';
import { AdminConsole } from './components/AdminConsole';
import { Account } from './components/Account';
import { ManageSubscription } from './components/ManageSubscription';
import { TextViewer } from './components/TextViewer';
import { NotFound } from './components/NotFound';
import { API_URL } from './config';
import { strings } from './strings';

export default function App() {
  const [view, setView] = useState('writer'); // 'writer' | 'slates' | 'account' | 'manage-subscription' | 'public' | 'admin' | 'terms' | 'privacy' | 'limits' | 'notfound'
  const [token, setToken] = useState(localStorage.getItem('justtype-token'));
  const [username, setUsername] = useState(localStorage.getItem('justtype-username'));
  const [email, setEmail] = useState(localStorage.getItem('justtype-email'));
  const [emailVerified, setEmailVerified] = useState(localStorage.getItem('justtype-email-verified') === 'true');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showRepublishModal, setShowRepublishModal] = useState(false);
  const [showGoogleSuccessModal, setShowGoogleSuccessModal] = useState(false);
  const [showGoogleErrorModal, setShowGoogleErrorModal] = useState(false);
  const [googleErrorType, setGoogleErrorType] = useState('');
  const [showPaymentSuccessModal, setShowPaymentSuccessModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [authProvider, setAuthProvider] = useState(localStorage.getItem('justtype-auth-provider') || 'local');
  const [currentSlate, setCurrentSlate] = useState(null);
  const [zenMode, setZenMode] = useState(false);
  const [showLoginNudge, setShowLoginNudge] = useState(false);
  const [loginNudgeDismissed, setLoginNudgeDismissed] = useState(false);
  const writerRef = useRef(null);
  const lastSlateRef = useRef(null); // Track last working slate when switching views
  const blankSlateContentRef = useRef(''); // Preserve blank slate content when navigating

  // Setup global login nudge trigger for Writer component
  useEffect(() => {
    const triggerNudge = () => {
      if (!showLoginNudge && !loginNudgeDismissed && !token) {
        setShowLoginNudge(true);
      }
    };

    window.triggerLoginNudge = triggerNudge;

    return () => {
      delete window.triggerLoginNudge;
    };
  }, [token, showLoginNudge, loginNudgeDismissed]);

  // Fetch current user data on mount to ensure email_verified is up to date
  useEffect(() => {
    const fetchUserData = async () => {
      if (!token) return;

      try {
        const response = await fetch(`${API_URL}/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });

        if (response.ok) {
          const userData = await response.json();
          setUsername(userData.username);
          setEmail(userData.email);
          setEmailVerified(userData.email_verified);
          setAuthProvider(userData.auth_provider || 'local');
          localStorage.setItem('justtype-auth-provider', userData.auth_provider || 'local');
          localStorage.setItem('justtype-username', userData.username);
          localStorage.setItem('justtype-email', userData.email);
          localStorage.setItem('justtype-email-verified', userData.email_verified);
        } else if (response.status === 401 || response.status === 403) {
          // Token is invalid, clear everything
          setToken(null);
          setUsername(null);
          setEmail(null);
          setEmailVerified(false);
          localStorage.removeItem('justtype-token');
          localStorage.removeItem('justtype-username');
          localStorage.removeItem('justtype-email');
          localStorage.removeItem('justtype-email-verified');
        }
      } catch (err) {
        console.error('Failed to fetch user data:', err);
      }
    };

    fetchUserData();
  }, [token]);

  // Check if viewing public slate or admin console or specific slate
  useEffect(() => {
    const handleRoute = () => {
      const path = window.location.pathname;
      if (path.startsWith('/s/')) {
        setView('public');
      } else if (path.startsWith('/holyfuckwhereami')) {
        setView('admin');
      } else if (path === '/terms') {
        setView('terms');
      } else if (path === '/privacy') {
        setView('privacy');
      } else if (path === '/limits') {
        setView('limits');
      } else if (path.startsWith('/slate/')) {
        const slateId = path.split('/slate/')[1];
        if (slateId && token) {
          setCurrentSlate({ id: parseInt(slateId) });
          setView('writer');
        }
      } else if (path === '/slates') {
        setView('slates');
      } else if (path === '/account') {
        setView('account');
      } else if (path === '/manage-subscription') {
        setView('manage-subscription');
      } else if (path === '/') {
        setCurrentSlate(null);
        setView('writer');
      } else {
        // Unknown route - show 404
        setView('notfound');
      }
    };

    handleRoute();

    // Listen for browser back/forward
    window.addEventListener('popstate', handleRoute);
    return () => window.removeEventListener('popstate', handleRoute);
  }, [token]);

  // Restore blank slate content when returning to writer view
  useEffect(() => {
    if (view === 'writer' && !currentSlate && blankSlateContentRef.current && writerRef.current) {
      // Small delay to ensure Writer has mounted
      setTimeout(() => {
        if (writerRef.current && blankSlateContentRef.current) {
          writerRef.current.setContent(blankSlateContentRef.current);
        }
      }, 50);
    }
  }, [view, currentSlate]);

  // Handle Google OAuth callback and payment status
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const googleAuth = urlParams.get('googleAuth');
    const tokenFromOAuth = urlParams.get('token');
    const usernameFromOAuth = urlParams.get('username');
    const emailFromOAuth = urlParams.get('email');
    const emailVerifiedFromOAuth = urlParams.get('emailVerified');
    const isNewUser = urlParams.get('isNewUser');
    const payment = urlParams.get('payment');

    // Handle payment success/cancelled
    if (payment === 'success') {
      setShowPaymentSuccessModal(true);

      // Clean URL first
      window.history.replaceState({}, '', '/');

      // In test mode, trigger upgrade via test endpoint
      const tier = localStorage.getItem('justtype-pending-tier');

      if (tier && token) {
        fetch(`${API_URL}/stripe/test-upgrade`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ tier })
        }).then(response => {
          return response.json();
        }).then(data => {
          localStorage.removeItem('justtype-pending-tier');
          // Refresh user data to get updated storage info
          fetchUserData();
        }).catch(err => console.error('Test upgrade failed:', err));
      }
    } else if (payment === 'cancelled') {
      // Just clean URL, no modal needed
      localStorage.removeItem('justtype-pending-tier');
      window.history.replaceState({}, '', '/');
    }

    if (googleAuth === 'success' && tokenFromOAuth) {
      setToken(tokenFromOAuth);
      setUsername(usernameFromOAuth);
      setEmail(emailFromOAuth);
      setEmailVerified(emailVerifiedFromOAuth === 'true');
      setAuthProvider('google');
      localStorage.setItem('justtype-token', tokenFromOAuth);
      localStorage.setItem('justtype-username', usernameFromOAuth);
      localStorage.setItem('justtype-email', emailFromOAuth);
      localStorage.setItem('justtype-email-verified', emailVerifiedFromOAuth);
      localStorage.setItem('justtype-auth-provider', 'google');
      setShowAuthModal(false);

      // Show welcome modal for new users
      if (isNewUser === 'true') {
        setShowGoogleSuccessModal(true);
      }

      // Clean URL parameters
      window.history.replaceState({}, '', '/');
    } else if (googleAuth === 'account_exists') {
      console.error('Google OAuth failed: account exists with password');
      setGoogleErrorType('account_exists');
      setShowGoogleErrorModal(true);
      window.history.replaceState({}, '', '/');
    } else if (googleAuth === 'error') {
      console.error('Google OAuth authentication failed');
      setGoogleErrorType('generic');
      setShowGoogleErrorModal(true);
      window.history.replaceState({}, '', '/');
    }
  }, []); // Run once on mount, will detect URL params

  const handleAuth = (authData) => {
    setToken(authData.token);
    setUsername(authData.user.username);
    setEmail(authData.user.email);
    setEmailVerified(authData.user.email_verified);
    localStorage.setItem('justtype-token', authData.token);
    localStorage.setItem('justtype-username', authData.user.username);
    localStorage.setItem('justtype-email', authData.user.email);
    localStorage.setItem('justtype-email-verified', authData.user.email_verified);
    setShowAuthModal(false);
  };

  const handleLogout = () => {
    setToken(null);
    setUsername(null);
    setEmail(null);
    setEmailVerified(false);
    localStorage.removeItem('justtype-token');
    localStorage.removeItem('justtype-username');
    localStorage.removeItem('justtype-email');
    localStorage.removeItem('justtype-email-verified');
    setCurrentSlate(null);
    setView('writer');
    window.history.pushState({}, '', '/');
  };

  const handleSelectSlate = async (slate) => {
    // Check if current slate needs republish
    if (writerRef.current && writerRef.current.needsRepublish()) {
      setPendingNavigation({ type: 'selectSlate', data: slate });
      setShowRepublishModal(true);
      return;
    }

    // Save current slate if it has unsaved changes
    if (writerRef.current) {
      await writerRef.current.saveBeforeNavigate();
    }
    setCurrentSlate(slate);
    setView('writer');
    setZenMode(false); // Reset zen mode when switching slates
    window.history.pushState({}, '', `/slate/${slate.id}`);
  };

  const handleNewSlate = async () => {
    // Check if current slate needs republish
    if (writerRef.current && writerRef.current.needsRepublish()) {
      setPendingNavigation({ type: 'newSlate' });
      setShowRepublishModal(true);
      return;
    }

    // Check if there's content - if yes, simulate reload to trigger beforeunload
    if (writerRef.current) {
      const content = writerRef.current.getContent();
      if (content && content.trim()) {
        window.location.reload();
        return;
      }
    }

    // No content - clear normally
    if (writerRef.current && writerRef.current.clearContent) {
      writerRef.current.clearContent();
    }

    // Create new slate and reset nudge states
    setCurrentSlate(null);
    setShowLoginNudge(false);
    setLoginNudgeDismissed(false);
    setView('writer');
    window.history.pushState({}, '', '/');
  };

  const handleToggleView = async () => {
    // Check if current slate needs republish
    if (view === 'writer' && writerRef.current && writerRef.current.needsRepublish()) {
      setPendingNavigation({ type: 'toggleView' });
      setShowRepublishModal(true);
      return;
    }

    if (view === 'writer') {
      // Only save if there's a currentSlate (existing slate)
      // Don't save blank slates - just preserve content locally
      if (writerRef.current) {
        if (currentSlate) {
          await writerRef.current.saveBeforeNavigate();
        } else {
          // Preserve blank slate content without saving to server
          const content = writerRef.current.getContent();
          if (content) {
            blankSlateContentRef.current = content;
          }
        }
      }

      // Switching from writer to slates
      lastSlateRef.current = currentSlate;
      setView('slates');
      setZenMode(false);
      window.history.pushState({}, '', '/slates');
    } else if (view === 'slates' || view === 'account' || view === 'manage-subscription') {
      // Switching from slates/account/manage-subscription to writer - restore last slate
      if (lastSlateRef.current) {
        setCurrentSlate(lastSlateRef.current);
        window.history.pushState({}, '', `/slate/${lastSlateRef.current.id}`);
      } else {
        window.history.pushState({}, '', '/');
      }
      setView('writer');
      setZenMode(false);
    }
  };

  const handleRepublishModalContinue = async () => {
    setShowRepublishModal(false);

    // Execute the pending navigation
    if (pendingNavigation) {
      const { type, data } = pendingNavigation;
      setPendingNavigation(null);

      if (type === 'selectSlate') {
        // Save current slate if it has unsaved changes
        if (writerRef.current) {
          await writerRef.current.saveBeforeNavigate();
        }
        setCurrentSlate(data);
        setView('writer');
        setZenMode(false);
        window.history.pushState({}, '', `/slate/${data.id}`);
      } else if (type === 'newSlate') {
        if (writerRef.current) {
          await writerRef.current.saveBeforeNavigate();
        }
        setCurrentSlate(null);
        setView('writer');
        window.history.pushState({}, '', '/');
      } else if (type === 'toggleView') {
        if (writerRef.current) {
          if (currentSlate) {
            await writerRef.current.saveBeforeNavigate();
          } else {
            const content = writerRef.current.getContent();
            if (content) {
              blankSlateContentRef.current = content;
            }
          }
        }
        if (view === 'writer') {
          lastSlateRef.current = currentSlate;
          setView('slates');
          setZenMode(false);
          window.history.pushState({}, '', '/slates');
        }
      }
    }
  };

  const handleRepublishModalCancel = () => {
    setShowRepublishModal(false);
    setPendingNavigation(null);
  };

  // Public viewer
  if (view === 'public') {
    return <PublicViewer />;
  }

  // Admin console
  if (view === 'admin') {
    return <AdminConsole />;
  }

  // 404 Not Found
  if (view === 'notfound') {
    return <NotFound />;
  }

  return (
    <div className="h-screen bg-[#111111] text-[#a0a0a0] font-mono selection:bg-[#333333] selection:text-white flex flex-col overflow-hidden">

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');
        html, body, #root {
          height: 100%;
          overflow: hidden;
        }
        body {
          font-family: 'JetBrains Mono', monospace;
          background-color: #111111;
          margin: 0;
          padding: 0;
        }
        textarea:focus { outline: none; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #111111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #555; }
        @keyframes fade-in {
          from { opacity: 0; transform: translateX(-10px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out;
        }
      `}</style>

      {/* HEADER */}
      <header className={`p-4 md:p-8 flex justify-between items-center border-b border-[#222] transition-opacity duration-500 ${zenMode ? 'opacity-0 pointer-events-none h-0 overflow-hidden' : 'opacity-100'}`}>
        <div className="flex items-center select-none">
          <button type="button" onClick={handleNewSlate} className="text-lg md:text-xl font-medium text-[#808080] hover:text-white transition-colors">
            {strings.app.logo}
          </button>
        </div>

        <div className="flex gap-3 md:gap-6 text-xs md:text-sm items-center">
          {token ? (
            <>
              <span className="text-[#808080] hidden sm:inline">{strings.app.welcome(username)}</span>
              <span className="text-[#333] hidden sm:inline">|</span>
              {/* Toggle button for writer/slates */}
              <button
                onClick={handleToggleView}
                className="relative h-5 w-[68px] md:w-24 overflow-hidden hover:text-white transition-colors flex-shrink-0"
              >
                <div
                  className={`absolute inset-0 flex flex-col transition-transform duration-150 ease-out ${
                    view === 'writer' ? '-translate-y-5' : 'translate-y-0'
                  }`}
                >
                  <span className="h-5 flex items-center justify-center whitespace-nowrap px-1 leading-5">{strings.app.tabs.writer}</span>
                  <span className="h-5 flex items-center justify-center whitespace-nowrap px-1 leading-5">{strings.app.tabs.slates}</span>
                </div>
              </button>
              <button
                onClick={async () => {
                  if (writerRef.current) {
                    await writerRef.current.saveBeforeNavigate();
                  }
                  setView('account');
                  setZenMode(false);
                  window.history.pushState({}, '', '/account');
                }}
                className={`hover:text-white transition-colors ${view === 'account' ? 'text-white' : ''}`}
              >
                {strings.app.tabs.account}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3 md:gap-4">
              {showLoginNudge && (
                <span className="text-xs md:text-sm text-[#666] animate-fade-in flex items-center gap-2">
                  <button
                    onClick={() => {
                      setShowLoginNudge(false);
                      setLoginNudgeDismissed(true);
                    }}
                    className="text-[#444] hover:text-[#666] transition-colors"
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                  {strings.nudges.loginHeader}
                </span>
              )}
              <button
                onClick={() => setShowAuthModal(true)}
                className="hover:text-white transition-colors duration-200"
              >
                {strings.app.tabs.login}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-grow overflow-hidden">
        {view === 'writer' && (
          <Writer
            ref={writerRef}
            token={token}
            currentSlate={currentSlate}
            onSlateChange={setCurrentSlate}
            onLogin={() => setShowAuthModal(true)}
            onZenModeChange={setZenMode}
            onOpenAuthModal={() => setShowAuthModal(true)}
          />
        )}
        {view === 'slates' && (
          <SlateManager
            token={token}
            onSelectSlate={handleSelectSlate}
            onNewSlate={handleNewSlate}
          />
        )}
        {view === 'account' && (
          <Account
            token={token}
            username={username}
            email={email}
            emailVerified={emailVerified}
            authProvider={authProvider}
            onLogout={handleLogout}
            onEmailUpdate={(newEmail, verified) => {
              setEmail(newEmail);
              setEmailVerified(verified);
              localStorage.setItem('justtype-email', newEmail);
              localStorage.setItem('justtype-email-verified', verified);
            }}
          />
        )}
        {view === 'manage-subscription' && (
          <ManageSubscription
            token={token}
            onBack={() => {
              setView('account');
              window.history.pushState({}, '', '/account');
            }}
          />
        )}
        {view === 'terms' && (
          <TextViewer file="terms.txt" title="terms & conditions" />
        )}
        {view === 'privacy' && (
          <TextViewer file="privacy.txt" title="privacy policy" />
        )}
        {view === 'limits' && (
          <TextViewer file="limits.txt" title="storage limits" />
        )}
      </main>

      {/* AUTH MODAL */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onAuth={handleAuth}
        />
      )}

      {/* REPUBLISH WARNING MODAL */}
      {showRepublishModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">unpublished changes</h2>
            <p className="text-sm text-[#666] mb-6">
              your edits won't be visible to others until you republish.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleRepublishModalContinue}
                className="flex-1 bg-[#333] text-white px-6 py-3 rounded hover:bg-[#444] transition-colors text-sm"
              >
                keep as draft
              </button>
              <button
                onClick={handleRepublishModalCancel}
                className="flex-1 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
              >
                go back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GOOGLE OAUTH SUCCESS MODAL */}
      {showGoogleSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">welcome to justtype!</h2>
            <p className="text-sm text-[#666] mb-4">
              you've successfully signed in with google as <span className="text-white">{username}</span>.
            </p>
            <p className="text-sm text-[#666] mb-6">
              your slates are encrypted and saved automatically. happy writing!
            </p>
            <button
              onClick={() => setShowGoogleSuccessModal(false)}
              className="w-full bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors text-sm"
            >
              get started
            </button>
          </div>
        </div>
      )}

      {/* PAYMENT SUCCESS MODAL */}
      {showPaymentSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <style>{`
            @keyframes confetti-fall {
              0% { transform: translateY(-100vh) rotate(0deg); opacity: 1; }
              100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
            }
            @keyframes celebration-bounce {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.05); }
            }
            .confetti {
              position: fixed;
              width: 10px;
              height: 10px;
              animation: confetti-fall 3s linear forwards;
              pointer-events: none;
            }
            .celebration-modal {
              animation: celebration-bounce 0.5s ease-out;
            }
          `}</style>

          {/* Confetti elements */}
          {[...Array(50)].map((_, i) => (
            <div
              key={i}
              className="confetti"
              style={{
                left: `${Math.random() * 100}%`,
                top: `-20px`,
                backgroundColor: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9'][Math.floor(Math.random() * 6)],
                animationDelay: `${Math.random() * 0.5}s`,
                animationDuration: `${2 + Math.random() * 2}s`
              }}
            />
          ))}

          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full celebration-modal">
            <div className="text-center">
              <div className="text-6xl mb-4">🎉</div>
              <h2 className="text-2xl md:text-3xl text-white mb-4">thank you!</h2>
              <p className="text-sm text-[#a0a0a0] mb-4">
                your support means the world to us. your payment was successful!
              </p>
              {token && (
                <p className="text-sm text-[#666] mb-6">
                  your storage benefits have been updated. check the account tab to see your new plan.
                </p>
              )}
              {!token && (
                <p className="text-sm text-[#666] mb-6">
                  to receive storage benefits, please sign up and we'll link your donation automatically.
                </p>
              )}
              <button
                onClick={() => {
                  setShowPaymentSuccessModal(false);
                  if (token) {
                    setView('account');
                  }
                }}
                className="w-full bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors text-sm font-medium"
              >
                {token ? 'view my account' : 'continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GOOGLE OAUTH ERROR MODAL */}
      {showGoogleErrorModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">
              {googleErrorType === 'account_exists' ? 'account already exists' : 'sign in failed'}
            </h2>
            <p className="text-sm text-[#666] mb-6">
              {googleErrorType === 'account_exists'
                ? 'an account with this email already exists with a password. please sign in using your username and password instead.'
                : 'google authentication failed. please try again or use email/password to sign in.'}
            </p>
            <button
              onClick={() => {
                setShowGoogleErrorModal(false);
                if (googleErrorType === 'account_exists') {
                  setShowAuthModal(true);
                }
              }}
              className="w-full bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors text-sm"
            >
              {googleErrorType === 'account_exists' ? 'sign in with password' : 'ok'}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
