import React, { useState, useEffect, useRef } from 'react';
import { Writer } from './components/Writer';
import { SlateManager } from './components/SlateManager';
import { PublicViewer } from './components/PublicViewer';
import { AuthModal } from './components/AuthModal';
import { AdminConsole } from './components/AdminConsole';
import { Account } from './components/Account';
import { ManageSubscription } from './components/ManageSubscription';
import { NotFound } from './components/NotFound';
import { CommandPalette } from './components/CommandPalette';
import { CliPair } from './components/CliPair';
import { Cli } from './components/Cli';
import { Feedback } from './components/Feedback';
import { Verify } from './components/Verify';
import { Status } from './components/Status';
import { RecoveryKeyModal } from './components/RecoveryKeyModal';
import { PinSetupModal } from './components/PinSetupModal';
import { API_URL } from './config';
import { generateRecoveryPhrase, generateSalt, deriveKey, wrapKey, unwrapKey } from './crypto';
import { saveSlateKey, getSlateKey, deleteSlateKey } from './keyStore';
import { wordlist } from './bip39-wordlist';
import { strings } from './strings';
import { applyThemeVariables, themeExists, fetchAndMergePreferences } from './themes';

export default function App() {
  const [view, setView] = useState('writer'); // 'writer' | 'slates' | 'account' | 'manage-subscription' | 'public' | 'admin' | 'notfound'
  // Token state is now just a marker - actual auth is via HttpOnly cookie
  // We check if user might be logged in based on stored username
  const [token, setToken] = useState(localStorage.getItem('justtype-username') ? 'checking' : null);
  const [username, setUsername] = useState(localStorage.getItem('justtype-username'));
  const [userId, setUserId] = useState(localStorage.getItem('justtype-user-id'));
  const [email, setEmail] = useState(localStorage.getItem('justtype-email'));
  const [emailVerified, setEmailVerified] = useState(localStorage.getItem('justtype-email-verified') === 'true');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showRepublishModal, setShowRepublishModal] = useState(false);
  const [showGoogleSuccessModal, setShowGoogleSuccessModal] = useState(false);
  const [showGoogleErrorModal, setShowGoogleErrorModal] = useState(false);
  const [pendingRecoveryPhrase, setPendingRecoveryPhrase] = useState(null);
  const [recoveryKeyPending, setRecoveryKeyPending] = useState(false);
  const [pendingMigrationKey, setPendingMigrationKey] = useState(null); // Google users needing PIN setup
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [googleErrorType, setGoogleErrorType] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
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
  const writerScrollRef = useRef(0); // Preserve writer scroll position
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notificationRef = useRef(null);

  // Initialize theme on mount - this ensures CSS variables are set for all pages
  // including special pages like /verify, /status, /cli that don't render Writer
  useEffect(() => {
    const savedTheme = localStorage.getItem('justtype-theme') || 'light';
    // Validate theme exists, fallback to light if not
    const themeToApply = themeExists(savedTheme) ? savedTheme : 'light';
    applyThemeVariables(themeToApply);
  }, []);

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

  // Fetch current user data on mount to verify session and update user info
  useEffect(() => {
    const fetchUserData = async () => {
      if (!token) return;

      try {
        const response = await fetch(`${API_URL}/auth/me`, {
          credentials: 'include' // Use HttpOnly cookie for auth
        });

        if (response.ok) {
          const userData = await response.json();

          // If user needs encryption migration, force re-login to trigger it
          if (userData.requiresMigration) {
            try {
              await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
            } catch (e) { /* ignore */ }
            setToken(null);
            setUsername(null);
            setEmail(null);
            setEmailVerified(false);
            localStorage.removeItem('justtype-username');
            localStorage.removeItem('justtype-user-id');
            localStorage.removeItem('justtype-email');
            localStorage.removeItem('justtype-email-verified');
            localStorage.removeItem('justtype-auth-provider');
            setShowAuthModal(true);
            return;
          }

          setToken('authenticated'); // Confirm we're authenticated
          setUsername(userData.username);
          setUserId(userData.id);
          setEmail(userData.email);
          setEmailVerified(userData.email_verified);
          setAuthProvider(userData.auth_provider || 'local');
          localStorage.setItem('justtype-auth-provider', userData.auth_provider || 'local');
          localStorage.setItem('justtype-username', userData.username);
          localStorage.setItem('justtype-user-id', userData.id);
          localStorage.setItem('justtype-email', userData.email);
          localStorage.setItem('justtype-email-verified', userData.email_verified);

          // Fetch and merge theme preferences from server
          const prefs = await fetchAndMergePreferences();
          if (prefs.success && prefs.theme) {
            applyThemeVariables(prefs.theme);
          }

          // If recovery key was never shown to user, redirect to account to regenerate
          if (userData.recoveryKeyPending) {
            setView('account');
            setRecoveryKeyPending(true);
          }

          // Check if E2E user needs to unlock with PIN (missing IndexedDB key)
          if (userData.e2eMigrated && userData.id) {
            const existingKey = await getSlateKey(userData.id);
            if (!existingKey) {
              setShowPinSetup(true);
            }
          }

          // Google user needing first-time PIN setup (not yet migrated)
          if (userData.needsPinSetup) {
            // They need to log in via Google OAuth to trigger migration first
          }
        } else if (response.status === 401 || response.status === 403) {
          // Session is invalid, clear everything
          setToken(null);
          setUsername(null);
          setEmail(null);
          setEmailVerified(false);
          localStorage.removeItem('justtype-username');
          localStorage.removeItem('justtype-user-id');
          localStorage.removeItem('justtype-email');
          localStorage.removeItem('justtype-email-verified');
          localStorage.removeItem('justtype-auth-provider');
        }
      } catch (err) {
        console.error('Failed to fetch user data:', err);
      }
    };

    fetchUserData();
  }, []);

  // Fetch notifications when authenticated
  const fetchNotifications = async () => {
    try {
      const response = await fetch(`${API_URL}/notifications`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setNotifications(data.notifications || []);
        setUnreadCount((data.notifications || []).filter(n => !n.is_read).length);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  useEffect(() => {
    if (token && token !== 'checking') {
      fetchNotifications();
    }
  }, [token]);

  // Close notifications dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notificationRef.current && !notificationRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showNotifications]);

  // Mark all as read when opening notifications
  const handleOpenNotifications = async () => {
    setShowNotifications(!showNotifications);
    if (!showNotifications && unreadCount > 0) {
      // Mark all unread as read
      const unread = notifications.filter(n => !n.is_read);
      await Promise.all(unread.map(n =>
        fetch(`${API_URL}/notifications/${n.id}/read`, {
          method: 'POST',
          credentials: 'include'
        })
      ));
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
    }
  };

  // Check if viewing public slate or admin console or specific slate
  useEffect(() => {
    const handleRoute = () => {
      // Normalize path: remove trailing slash (except for root)
      let path = window.location.pathname;
      if (path.length > 1 && path.endsWith('/')) {
        path = path.slice(0, -1);
      }
      if (path.startsWith('/s/')) {
        setView('public');
      } else if (path.startsWith('/holyfuckwhereami')) {
        setView('admin');
      } else if (path === '/terms') {
        // Redirect to published system slate
        window.location.href = '/s/terms';
        return;
      } else if (path === '/privacy') {
        // Redirect to published system slate
        window.location.href = '/s/privacy';
        return;
      } else if (path === '/limits') {
        // Redirect to published system slate
        window.location.href = '/s/limits';
        return;
      } else if (path === '/project') {
        // Redirect to published system slate
        window.location.href = '/s/project';
        return;
      } else if (path.startsWith('/slate/')) {
        const slateId = path.split('/slate/')[1];
        if (slateId && token) {
          setCurrentSlate({ id: parseInt(slateId) });
          setView('writer');
        }
      } else if (path === '/slates') {
        if (!token) {
          // Redirect to home and show login modal if not authenticated
          setView('writer');
          setShowAuthModal(true);
          window.history.pushState({}, '', '/');
        } else {
          setView('slates');
        }
      } else if (path === '/account') {
        if (!token) {
          // Redirect to home and show login modal if not authenticated
          setView('writer');
          setShowAuthModal(true);
          window.history.pushState({}, '', '/');
        } else {
          setView('account');
        }
      } else if (path === '/manage-subscription') {
        setView('manage-subscription');
      } else if (path === '/pair') {
        setView('cli-pair');
      } else if (path === '/cli') {
        setView('cli-info');
      } else if (path === '/feedback') {
        setView('feedback');
      } else if (path === '/verify') {
        setView('verify');
      } else if (path === '/status') {
        setView('status');
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

  // Restore blank slate content and scroll position when returning to writer view
  useEffect(() => {
    if (view === 'writer') {
      // Restore blank slate content
      if (!currentSlate && blankSlateContentRef.current && writerRef.current) {
        setTimeout(() => {
          if (writerRef.current && blankSlateContentRef.current) {
            writerRef.current.setContent(blankSlateContentRef.current);
          }
        }, 50);
      }
      // Restore scroll position
      if (writerScrollRef.current > 0) {
        setTimeout(() => {
          const textarea = document.querySelector('textarea');
          if (textarea) {
            textarea.scrollTop = writerScrollRef.current;
          }
        }, 100);
      }
    }
  }, [view, currentSlate]);

  // ESC key to close overlay views (slates, account) and return to writer
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (showNotifications) {
          e.preventDefault();
          setShowNotifications(false);
          return;
        }
        if (showAuthModal) {
          e.preventDefault();
          setShowAuthModal(false);
          return;
        }
        if (view === 'slates' || view === 'account') {
          e.preventDefault();
          // Navigate back to writer
          if (lastSlateRef.current) {
            setCurrentSlate(lastSlateRef.current);
            window.history.pushState({}, '', `/slate/${lastSlateRef.current.id}`);
          } else {
            window.history.pushState({}, '', '/');
          }
          setView('writer');
        }
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [view, showAuthModal, showNotifications]);

  // Cmd+K to open command palette
  useEffect(() => {
    const handleCmdK = (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (cmdOrCtrl && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleCmdK);
    return () => window.removeEventListener('keydown', handleCmdK);
  }, []);

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
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
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

    if (googleAuth === 'success') {
      const authCode = urlParams.get('code');
      if (authCode) {
        // Exchange one-time code for session (cookie set by server)
        fetch(`${API_URL}/auth/exchange-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ code: authCode })
        })
          .then(response => response.json())
          .then(async (data) => {
            if (data.user) {
              setToken('authenticated');
              setUsername(data.user.username);
              setUserId(data.user.id);
              setEmail(data.user.email);
              setEmailVerified(data.user.email_verified);
              setShowAuthModal(false);
              localStorage.setItem('justtype-user-id', data.user.id);

              // Handle E2E migration for Google users
              if (data.migrationSlateKey) {
                const keyBytes = Uint8Array.from(atob(data.migrationSlateKey), c => c.charCodeAt(0));
                await saveSlateKey(data.user.id, keyBytes);
                // Google users need to set a PIN to wrap their key
                setPendingMigrationKey(keyBytes);
                setShowPinSetup(true);
              }

              if (data.isNewUser && !data.migrationSlateKey) {
                // New Google user: generate slate key, prompt for PIN
                const { generateSlateKey } = await import('./crypto');
                const newSlateKey = await generateSlateKey();
                await saveSlateKey(data.user.id, newSlateKey);
                setPendingMigrationKey(newSlateKey);
                setShowPinSetup(true);
              }

              return fetch(`${API_URL}/auth/me`, { credentials: 'include' });
            }
          })
          .then(response => response && response.json())
          .then(async (userData) => {
            if (userData && userData.username) {
              setAuthProvider(userData.auth_provider || 'local');
              localStorage.setItem('justtype-auth-provider', userData.auth_provider || 'local');
              localStorage.setItem('justtype-username', userData.username);
              localStorage.setItem('justtype-user-id', userData.id);
              localStorage.setItem('justtype-email', userData.email);
              localStorage.setItem('justtype-email-verified', userData.email_verified);

              if (userData.recoveryKeyPending) {
                setView('account');
                setRecoveryKeyPending(true);
              }

              // Check if E2E user needs to unlock with PIN (missing IndexedDB key after storage clear)
              if (userData.e2eMigrated && userData.id) {
                const existingKey = await getSlateKey(userData.id);
                if (!existingKey) {
                  setShowPinSetup(true);
                }
              }
            }
          })
          .catch(err => {
            console.error('Code exchange failed:', err);
            setGoogleErrorType('generic');
            setShowGoogleErrorModal(true);
          });
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

  const handleAuth = async (authData) => {
    // Token is now in HttpOnly cookie, we just track auth state
    setToken('authenticated');
    setUsername(authData.user.username);
    setUserId(authData.user.id);
    setEmail(authData.user.email);
    setEmailVerified(authData.user.email_verified);
    // Only store non-sensitive user info in localStorage for display
    localStorage.setItem('justtype-username', authData.user.username);
    localStorage.setItem('justtype-user-id', authData.user.id);
    localStorage.setItem('justtype-email', authData.user.email);
    localStorage.setItem('justtype-email-verified', authData.user.email_verified);
    setShowAuthModal(false);

    // Show recovery key modal if provided (new signup or migration)
    if (authData.recoveryPhrase) {
      setPendingRecoveryPhrase(authData.recoveryPhrase);
    } else {
      // Check if recovery key was never shown (previous migration)
      try {
        const response = await fetch(`${API_URL}/auth/me`, { credentials: 'include' });
        if (response.ok) {
          const userData = await response.json();
          setAuthProvider(userData.auth_provider || 'local');
          localStorage.setItem('justtype-auth-provider', userData.auth_provider || 'local');
          if (userData.recoveryKeyPending) {
            setView('account');
            setRecoveryKeyPending(true);
          } else {
            setRecoveryKeyPending(false);
          }
        }
      } catch (e) { /* ignore */ }
    }
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(true);
  };

  const handleLogout = async () => {
    setShowLogoutConfirm(false);

    // Clear slate key from IndexedDB
    if (userId) {
      try {
        await deleteSlateKey(userId);
      } catch (err) {
        console.error('Failed to clear slate key:', err);
      }
    }

    // Delete session from database (cookie sent automatically)
    if (token) {
      try {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          credentials: 'include'
        });
      } catch (err) {
        console.error('Logout error:', err);
        // Continue with local logout even if API call fails
      }
    }

    // Clear local state and storage
    setToken(null);
    setUsername(null);
    setUserId(null);
    setEmail(null);
    setEmailVerified(false);
    localStorage.removeItem('justtype-username');
    localStorage.removeItem('justtype-user-id');
    localStorage.removeItem('justtype-email');
    localStorage.removeItem('justtype-email-verified');
    localStorage.removeItem('justtype-auth-provider');
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

    // Save current slate if there are unsaved changes
    if (writerRef.current && currentSlate && token) {
      await writerRef.current.saveBeforeNavigate();
    }

    // Clear content
    if (writerRef.current && writerRef.current.clearContent) {
      writerRef.current.clearContent();
    }

    // Create new slate and reset nudge states
    setCurrentSlate(null);
    blankSlateContentRef.current = '';
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
      // Save scroll position before switching
      const textarea = document.querySelector('textarea');
      if (textarea) {
        writerScrollRef.current = textarea.scrollTop;
      }

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

  // Command palette execute handler
  const handleCommandExecute = async (cmd) => {
    switch (cmd.action) {
      case 'NEW_SLATE':
        handleNewSlate();
        break;

      case 'NAVIGATE_SLATES':
        if (view === 'writer') {
          lastSlateRef.current = currentSlate;
        }
        setView('slates');
        setZenMode(false);
        window.history.pushState({}, '', '/slates');
        break;

      case 'NAVIGATE_ACCOUNT':
        if (view === 'writer') {
          lastSlateRef.current = currentSlate;
        }
        setView('account');
        setZenMode(false);
        window.history.pushState({}, '', '/account');
        break;

      case 'SAVE':
        if (writerRef.current) {
          writerRef.current.saveSlate?.();
        }
        break;

      case 'SHARE':
        if (writerRef.current) {
          writerRef.current.openPublishMenu?.();
        }
        break;

      case 'EXPORT':
        if (writerRef.current) {
          writerRef.current.exportAs?.(cmd.payload);
        }
        break;

      case 'SET_THEME':
        if (writerRef.current) {
          writerRef.current.setTheme?.(cmd.payload);
        }
        break;

      case 'TOGGLE_ZEN':
        if (view === 'writer') {
          setZenMode(prev => !prev);
        }
        break;

      case 'SET_FOCUS':
        if (writerRef.current) {
          writerRef.current.setFocusMode?.(cmd.payload);
        }
        break;

      default:
        console.log('Unknown command action:', cmd.action);
    }
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

  // CLI Pair
  if (view === 'cli-pair') {
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
        `}</style>

        <CliPair token={token} username={username} onLogin={() => setShowAuthModal(true)} />
        {showAuthModal && (
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onAuth={handleAuth}
          />
        )}
      </div>
    );
  }

  // CLI Info
  if (view === 'cli-info') {
    return <Cli />;
  }

  // Feedback
  if (view === 'feedback') {
    return <Feedback token={token} username={username} email={email} />;
  }

  if (view === 'verify') {
    return <Verify />;
  }

  if (view === 'status') {
    return <Status />;
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
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-down {
          animation: slideDown 0.2s ease-out;
        }
        @keyframes modalOverlayIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalContentIn {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-modal-overlay {
          animation: modalOverlayIn 0.2s ease-out;
        }
        .animate-modal-content {
          animation: modalContentIn 0.2s ease-out;
        }
      `}</style>

      {/* HEADER */}
      <header className={`p-4 md:p-8 flex justify-between items-center border-b border-[#222] transition-opacity duration-500 ${zenMode ? 'opacity-0 hover:opacity-100' : 'opacity-100'}`}>
        <div className="flex items-center select-none">
          <button type="button" onClick={handleNewSlate} className="text-lg md:text-xl font-medium text-[#808080] hover:text-white transition-colors">
            {strings.app.logo}
          </button>
        </div>

        <div className="flex gap-3 md:gap-6 text-xs md:text-sm items-center">
          {token ? (
            <>
              <div className="relative hidden sm:inline-flex items-center" ref={notificationRef}>
                <button
                  onClick={handleOpenNotifications}
                  className="relative text-[#808080] hover:text-white transition-colors p-1"
                  aria-label={strings.notifications.title}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z" />
                  </svg>
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full" />
                  )}
                </button>
                {showNotifications && (
                  <div className="absolute top-full right-0 mt-2 w-80 bg-[#1a1a1a] border border-[#333] rounded shadow-2xl z-50 animate-modal-content">
                    <div className="p-3 border-b border-[#333]">
                      <span className="text-sm text-white">{strings.notifications.title}</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <p className="text-sm text-[#666] p-4 text-center">{strings.notifications.empty}</p>
                      ) : (
                        notifications.map(n => (
                          <div
                            key={n.id}
                            className={`p-3 border-b border-[#222] last:border-b-0 hover:bg-[#222] transition-colors ${n.link ? 'cursor-pointer' : ''}`}
                            onClick={() => {
                              if (n.link) {
                                if (n.link.startsWith('/')) {
                                  window.history.pushState({}, '', n.link);
                                  window.dispatchEvent(new PopStateEvent('popstate'));
                                } else {
                                  window.open(n.link, '_blank');
                                }
                                setShowNotifications(false);
                              }
                            }}
                          >
                            <p className="text-sm text-white font-medium">{n.title}</p>
                            <p className="text-xs text-[#888] mt-1">{n.message}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-[#555]">{new Date(n.created_at).toLocaleDateString()}</span>
                              {n.link && <span className="text-xs text-[#555]">→</span>}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
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
                  // Toggle: if already on account, go back to writer
                  if (view === 'account') {
                    if (lastSlateRef.current) {
                      setCurrentSlate(lastSlateRef.current);
                      window.history.pushState({}, '', `/slate/${lastSlateRef.current.id}`);
                    } else {
                      window.history.pushState({}, '', '/');
                    }
                    setView('writer');
                    return;
                  }

                  // Save scroll position before switching
                  if (view === 'writer') {
                    const textarea = document.querySelector('textarea');
                    if (textarea) {
                      writerScrollRef.current = textarea.scrollTop;
                    }
                  }

                  if (writerRef.current) {
                    if (currentSlate) {
                      await writerRef.current.saveBeforeNavigate();
                    } else {
                      // Preserve blank slate content
                      const content = writerRef.current.getContent();
                      if (content) {
                        blankSlateContentRef.current = content;
                      }
                    }
                  }

                  // Remember current slate for returning
                  if (view === 'writer') {
                    lastSlateRef.current = currentSlate;
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
            userId={userId}
            currentSlate={currentSlate}
            onSlateChange={setCurrentSlate}
            onLogin={() => setShowAuthModal(true)}
            onZenModeChange={setZenMode}
            onOpenAuthModal={() => setShowAuthModal(true)}
          />
        )}
        {view === 'slates' && (
          <div className="h-full animate-slide-down">
            <SlateManager
              token={token}
              userId={userId}
              onSelectSlate={handleSelectSlate}
              onNewSlate={handleNewSlate}
            />
          </div>
        )}
        {view === 'account' && (
          <div className="h-full animate-slide-down">
            <Account
              token={token}
              username={username}
              userId={userId}
              email={email}
              emailVerified={emailVerified}
              authProvider={authProvider}
              onLogout={confirmLogout}
              onForceLogout={handleLogout}
              recoveryKeyPending={recoveryKeyPending}
              onRecoveryKeyShown={(phrase) => {
                setPendingRecoveryPhrase(phrase);
              }}
              onEmailUpdate={(newEmail, verified) => {
                setEmail(newEmail);
                setEmailVerified(verified);
                localStorage.setItem('justtype-email', newEmail);
                localStorage.setItem('justtype-email-verified', verified);
              }}
            />
          </div>
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

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-[modalOverlayIn_0.15s_ease-out]" onClick={() => setShowLogoutConfirm(false)}>
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 max-w-sm w-full animate-[modalContentIn_0.15s_ease-out]" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg text-white mb-2">{strings.account.sessions.logoutConfirm.title}</h2>
            <p className="text-[#888] text-sm mb-2">{strings.account.sessions.logoutConfirm.message}</p>
            {(authProvider === 'google' || authProvider === 'both') && (
              <p className="text-yellow-400/80 text-sm mb-4">{strings.account.sessions.logoutConfirm.pinWarning}</p>
            )}
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 px-4 py-2 border border-[#333] rounded hover:bg-[#222] transition-colors text-sm"
              >
                {strings.account.sessions.logoutConfirm.cancel}
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 px-4 py-2 bg-white text-black rounded hover:bg-[#e5e5e5] transition-colors text-sm"
              >
                {strings.account.sessions.logoutConfirm.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recovery Key Modal */}
      {pendingRecoveryPhrase && (
        <RecoveryKeyModal
          recoveryPhrase={pendingRecoveryPhrase}
          onAcknowledge={() => {
            setPendingRecoveryPhrase(null);
            setRecoveryKeyPending(false);
            // Tell server user has seen their recovery key
            fetch(`${API_URL}/account/acknowledge-recovery-key`, {
              method: 'POST',
              credentials: 'include'
            }).catch(() => {});
          }}
        />
      )}

      {/* PIN Setup/Unlock Modal for Google users */}
      {showPinSetup && pendingMigrationKey && (
        <PinSetupModal
          isSetup={true}
          onSubmit={async (pin) => {
            const encryptionSalt = generateSalt();
            const pinDerivedKey = await deriveKey(pin, encryptionSalt, { pin: true });
            const wrappedKey = await wrapKey(pendingMigrationKey, pinDerivedKey);
            const recoveryPhrase = generateRecoveryPhrase(wordlist);
            const recoverySalt = generateSalt();
            const recoveryDerivedKey = await deriveKey(recoveryPhrase, recoverySalt);
            const recoveryWrappedKey = await wrapKey(pendingMigrationKey, recoveryDerivedKey);
            const response = await fetch(`${API_URL}/account/finalize-e2e-migration`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ wrappedKey, encryptionSalt, recoveryWrappedKey, recoverySalt }),
            });
            if (!response.ok) throw new Error('failed to save pin');
            setShowPinSetup(false);
            setPendingMigrationKey(null);
            setPendingRecoveryPhrase(recoveryPhrase);
          }}
        />
      )}

      {/* PIN Unlock Modal for returning Google users */}
      {showPinSetup && !pendingMigrationKey && userId && (
        <PinSetupModal
          isSetup={false}
          onSubmit={async (pin) => {
            const keyResponse = await fetch(`${API_URL}/account/wrapped-key`, { credentials: 'include' });
            if (!keyResponse.ok) throw new Error('failed to get key data');
            const keyData = await keyResponse.json();
            const pinDerivedKey = await deriveKey(pin, keyData.encryptionSalt, { pin: true });
            const slateKey = await unwrapKey(keyData.wrappedKey, pinDerivedKey);
            await saveSlateKey(userId, slateKey);
            setShowPinSetup(false);
          }}
          onRecover={async (recoveryPhrase, newPin) => {
            // Fetch recovery-wrapped key from server
            const keyResponse = await fetch(`${API_URL}/account/wrapped-key`, { credentials: 'include' });
            if (!keyResponse.ok) throw new Error('failed to get key data');
            const keyData = await keyResponse.json();

            // Fetch recovery key data
            const recoveryResponse = await fetch(`${API_URL}/account/recovery-data`, { credentials: 'include' });
            if (!recoveryResponse.ok) throw new Error('failed to get recovery data');
            const recoveryData = await recoveryResponse.json();

            // Unwrap slate key with recovery phrase
            const recoveryDerivedKey = await deriveKey(recoveryPhrase, recoveryData.recoverySalt);
            let slateKey;
            try {
              slateKey = await unwrapKey(recoveryData.recoveryWrappedKey, recoveryDerivedKey);
            } catch (err) {
              throw new Error(strings.pin.recovery.errors.invalid);
            }

            // Re-wrap with new PIN
            const newPinSalt = generateSalt();
            const newPinDerivedKey = await deriveKey(newPin, newPinSalt, { pin: true });
            const newPinWrappedKey = await wrapKey(slateKey, newPinDerivedKey);

            // Generate new recovery key
            const newRecoveryPhrase = generateRecoveryPhrase(wordlist);
            const newRecoverySalt = generateSalt();
            const newRecoveryDerivedKey = await deriveKey(newRecoveryPhrase, newRecoverySalt);
            const newRecoveryWrappedKey = await wrapKey(slateKey, newRecoveryDerivedKey);

            // Save to server
            const resetResponse = await fetch(`${API_URL}/account/reset-pin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ newPinWrappedKey, newPinSalt, newRecoveryWrappedKey, newRecoverySalt })
            });
            if (!resetResponse.ok) throw new Error('failed to save new pin');

            // Save slate key locally
            await saveSlateKey(userId, slateKey);
            setShowPinSetup(false);

            // Show new recovery key
            setPendingRecoveryPhrase(newRecoveryPhrase);
          }}
        />
      )}

      {/* Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        context={{
          view,
          token,
          currentSlate
        }}
        onExecute={handleCommandExecute}
      />

    </div>
  );
}
