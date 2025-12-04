import React, { useState, useEffect, useRef } from 'react';
import { Writer } from './components/Writer';
import { SlateManager } from './components/SlateManager';
import { PublicViewer } from './components/PublicViewer';
import { AuthModal } from './components/AuthModal';
import { AdminConsole } from './components/AdminConsole';
import { Account } from './components/Account';
import { API_URL } from './config';
import { strings } from './strings';

export default function App() {
  const [view, setView] = useState('writer'); // 'writer' | 'slates' | 'account' | 'public' | 'admin'
  const [token, setToken] = useState(localStorage.getItem('justtype-token'));
  const [username, setUsername] = useState(localStorage.getItem('justtype-username'));
  const [email, setEmail] = useState(localStorage.getItem('justtype-email'));
  const [emailVerified, setEmailVerified] = useState(localStorage.getItem('justtype-email-verified') === 'true');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showRepublishModal, setShowRepublishModal] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [currentSlate, setCurrentSlate] = useState(null);
  const [zenMode, setZenMode] = useState(false);
  const writerRef = useRef(null);
  const lastSlateRef = useRef(null); // Track last working slate when switching views
  const blankSlateContentRef = useRef(''); // Preserve blank slate content when navigating

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
      } else if (path === '/') {
        setCurrentSlate(null);
        setView('writer');
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

    // Save current slate if it has unsaved changes
    if (writerRef.current) {
      await writerRef.current.saveBeforeNavigate();
    }
    setCurrentSlate(null);
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

    // Save current slate if it has unsaved changes
    if (writerRef.current) {
      await writerRef.current.saveBeforeNavigate();

      // Preserve blank slate content
      if (!currentSlate && writerRef.current.getContent()) {
        blankSlateContentRef.current = writerRef.current.getContent();
      }
    }

    if (view === 'writer') {
      // Switching from writer to slates - save current slate
      lastSlateRef.current = currentSlate;
      setView('slates');
      setZenMode(false);
      window.history.pushState({}, '', '/slates');
    } else if (view === 'slates' || view === 'account') {
      // Switching from slates/account to writer - restore last slate
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
          await writerRef.current.saveBeforeNavigate();
          if (!currentSlate && writerRef.current.getContent()) {
            blankSlateContentRef.current = writerRef.current.getContent();
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
      `}</style>

      {/* HEADER */}
      <header className={`p-4 md:p-8 flex justify-between items-center border-b border-[#222] transition-opacity duration-500 ${zenMode ? 'opacity-0 pointer-events-none h-0 overflow-hidden' : 'opacity-100'}`}>
        <div className="flex items-center select-none">
          <button onClick={handleNewSlate} className="text-lg md:text-xl font-medium text-[#808080] hover:text-white transition-colors">
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
            <button
              onClick={() => setShowAuthModal(true)}
              className="hover:text-white transition-colors duration-200"
            >
              {strings.app.tabs.login}
            </button>
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
            onLogout={handleLogout}
            onEmailUpdate={(newEmail, verified) => {
              setEmail(newEmail);
              setEmailVerified(verified);
              localStorage.setItem('justtype-email', newEmail);
              localStorage.setItem('justtype-email-verified', verified);
            }}
          />
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
            <h2 className="text-lg md:text-xl text-white mb-4">slate not republished</h2>
            <p className="text-sm text-[#666] mb-6">
              you've edited a published slate but haven't republished it yet. the slate is currently saved as a private draft.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleRepublishModalContinue}
                className="flex-1 bg-[#333] text-white px-6 py-3 rounded hover:bg-[#444] transition-colors text-sm"
              >
                continue without republishing
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

    </div>
  );
}
