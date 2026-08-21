import React, { useState, useEffect, useRef } from 'react';
import { useEscape } from '../useEscape';
import JSZip from 'jszip';
import { API_URL } from '../config';
import { strings } from '../strings';
import { RecoveryKeyModal } from './RecoveryKeyModal';
import { ShareSlates } from './ShareSlates';
import { generateSalt, deriveKey, wrapKey, unwrapKey, generateRecoveryPhrase, decryptContent, decryptTitle } from '../crypto';
import { getSlateKey } from '../keyStore';
import { wordlist } from '../bip39-wordlist';
import { useToast } from './Toast';

/**
 * A labelled group of rows: one bordered card, rows divided inside it. Every
 * settings block on this page uses it, so the page reads as three short lists
 * instead of a stack of loose look-alike cards.
 */
function Section({ title, tone, children }) {
  const border = tone === 'danger' ? 'border-red-900/50' : 'border-[var(--theme-border)]';
  const divide = tone === 'danger' ? 'divide-red-900/50' : 'divide-[var(--theme-border)]';
  return (
    <section className="mb-6">
      {title && (
        <h2 className="text-[11px] uppercase tracking-wider text-[var(--theme-text-dim)] mb-2 px-1">{title}</h2>
      )}
      <div className={`border ${border} rounded-lg overflow-hidden divide-y ${divide}`}>{children}</div>
    </section>
  );
}

/** A static fact inside a Section: label left, value and its actions right. */
function InfoRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5 text-sm">
      <span className="text-[var(--theme-text-dim)] shrink-0">{label}</span>
      <div className="flex items-center gap-3 min-w-0 justify-end flex-wrap">{children}</div>
    </div>
  );
}

/** The header of an expandable row inside a Section. */
function DisclosureHeader({ label, open, onToggle, tone }) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between gap-4 px-4 py-3.5 text-sm transition-colors ${
        tone === 'danger'
          ? 'text-red-400 hover:bg-red-900/10'
          : 'hover:bg-[var(--theme-bg-secondary)]'
      }`}
    >
      <span className="text-left">{label}</span>
      <span
        className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-45' : ''} ${
          tone === 'danger' ? '' : 'text-[var(--theme-text-dim)]'
        }`}
      >
        +
      </span>
    </button>
  );
}

export function Account({ token, username, userId, email, emailVerified, authProvider, onLogout, onForceLogout, onEmailUpdate, onUsernameUpdate, recoveryKeyPending, onRecoveryKeyShown, onRecoveryKeyAcknowledged }) {
  const [showToast, toastNode] = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [emailStep, setEmailStep] = useState('input'); // 'input' | 'verify'
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');
  const [changingEmail, setChangingEmail] = useState(false);

  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [changingUsername, setChangingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState(null); // null | true | false
  const [usernameCheckReason, setUsernameCheckReason] = useState('');
  const [checkingUsername, setCheckingUsername] = useState(false);
  const usernameCheckTimeout = useRef(null);

  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [trackIpAddress, setTrackIpAddress] = useState(true);
  const [togglingIpTracking, setTogglingIpTracking] = useState(false);

  const [storageInfo, setStorageInfo] = useState(null);
  const [loadingStorage, setLoadingStorage] = useState(true);

  // Recovery key
  const [showRecoverySection, setShowRecoverySection] = useState(recoveryKeyPending || false);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [regeneratingRecovery, setRegeneratingRecovery] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState(null);

  // Modal states
  const [showLogoutEverywhereModal, setShowLogoutEverywhereModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);
  const [showLinkGoogleModal, setShowLinkGoogleModal] = useState(false);
  const [showLinkSuccessModal, setShowLinkSuccessModal] = useState(false);
  const [showLinkErrorModal, setShowLinkErrorModal] = useState(false);
  const [linkErrorMessage, setLinkErrorMessage] = useState('');
  const [showUnlinkGoogleModal, setShowUnlinkGoogleModal] = useState(false);
  const [showUnlinkSuccessModal, setShowUnlinkSuccessModal] = useState(false);

  // Google link/unlink states
  const [unlinkCode, setUnlinkCode] = useState('');
  const [unlinkError, setUnlinkError] = useState('');
  const [unlinkSuccess, setUnlinkSuccess] = useState('');
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false);
  const [requestingUnlink, setRequestingUnlink] = useState(false);

  // Set password for Google users
  const [showSetPasswordModal, setShowSetPasswordModal] = useState(false);
  const [showSetPasswordSuccess, setShowSetPasswordSuccess] = useState(false);
  const [setPasswordNew, setSetPasswordNew] = useState('');
  const [setPasswordConfirm, setSetPasswordConfirm] = useState('');
  const [newPasswordError, setNewPasswordError] = useState('');
  const [setPasswordStep, setSetPasswordStep] = useState('pin'); // 'pin' | 'password'

  // Escape dismisses whichever card is on top. The success/error confirmations
  // are included: they are the ones you most want to flick away.
  useEscape(showEmailModal, () => setShowEmailModal(false));
  useEscape(showUsernameModal, () => setShowUsernameModal(false));
  useEscape(showLogoutEverywhereModal, () => setShowLogoutEverywhereModal(false));
  useEscape(showDeleteAccountModal, () => setShowDeleteAccountModal(false));
  useEscape(showLinkGoogleModal, () => setShowLinkGoogleModal(false));
  useEscape(showLinkSuccessModal, () => setShowLinkSuccessModal(false));
  useEscape(showLinkErrorModal, () => setShowLinkErrorModal(false));
  useEscape(showUnlinkGoogleModal, () => setShowUnlinkGoogleModal(false));
  useEscape(showUnlinkSuccessModal, () => setShowUnlinkSuccessModal(false));
  useEscape(showSetPasswordModal, () => setShowSetPasswordModal(false));
  const [setPasswordPin, setSetPasswordPin] = useState(['', '', '', '', '', '']);
  const [verifiedSlateKey, setVerifiedSlateKey] = useState(null);
  const setPwPinRefs = useRef([]);
  const [settingPassword, setSettingPassword] = useState(false);
  const [setPasswordRecoveryPhrase, setSetPasswordRecoveryPhrase] = useState(null);
  const [passwordBannerDismissed, setPasswordBannerDismissed] = useState(
    localStorage.getItem('justtype-password-banner-dismissed') === 'true'
  );

  // Export slates state
  const [exportingSlates, setExportingSlates] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportMessageKind, setExportMessageKind] = useState(''); // 'progress' | 'success' | 'error'
  const [exportConfirmArmed, setExportConfirmArmed] = useState(false);
  const exportConfirmTimeoutRef = useRef(null);

  // Collapsible sections state
  const [showSessions, setShowSessions] = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [showDangerZone, setShowDangerZone] = useState(false);

  // Connected (authorized third-party) apps
  const [connectedApps, setConnectedApps] = useState([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [showConnectedApps, setShowConnectedApps] = useState(false);
  const [revokingApp, setRevokingApp] = useState(null);
  const [shareApp, setShareApp] = useState(null); // { client_id, name } when sharing slates

  useEffect(() => {
    return () => {
      if (exportConfirmTimeoutRef.current) {
        clearTimeout(exportConfirmTimeoutRef.current);
        exportConfirmTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (token) {
      loadSessions();
      loadStorage();
      loadConnectedApps();
    }

    // Check for Google link/unlink callback
    const urlParams = new URLSearchParams(window.location.search);
    const linkGoogle = urlParams.get('linkGoogle');

    if (linkGoogle === 'success') {
      setShowLinkSuccessModal(true);
      window.history.replaceState({}, '', '/account');
    } else if (linkGoogle === 'error') {
      const reason = urlParams.get('reason');
      let message = strings.account.googleAuth.link.errors.failed;
      if (reason === 'google_already_linked') {
        message = strings.account.googleAuth.link.errors.alreadyLinked;
      } else if (reason === 'invalid_token') {
        message = strings.account.googleAuth.link.errors.sessionExpired;
      }
      setLinkErrorMessage(message);
      setShowLinkErrorModal(true);
      window.history.replaceState({}, '', '/account');
    }
  }, [token]);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const response = await fetch(`${API_URL}/account/sessions`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        setSessions(data.sessions || []);
        setTrackIpAddress(data.track_ip_address !== false);
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadConnectedApps = async () => {
    setLoadingApps(true);
    try {
      const response = await fetch(`${API_URL}/account/connected-apps`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        setConnectedApps(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to load connected apps:', err);
    } finally {
      setLoadingApps(false);
    }
  };

  const revokeConnectedApp = async (clientId) => {
    setRevokingApp(clientId);
    try {
      const response = await fetch(`${API_URL}/account/connected-apps/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ client_id: clientId })
      });
      if (response.ok) {
        setConnectedApps((apps) => apps.filter((a) => a.client_id !== clientId));
      }
    } catch (err) {
      console.error('Failed to revoke app:', err);
    } finally {
      setRevokingApp(null);
    }
  };

  const toggleIpTracking = async () => {
    setTogglingIpTracking(true);
    try {
      const response = await fetch(`${API_URL}/account/toggle-ip-tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ enabled: !trackIpAddress }),
      });
      const data = await response.json();
      if (response.ok) {
        setTrackIpAddress(data.track_ip_address);
        // Reload sessions to reflect change
        loadSessions();
      }
    } catch (err) {
      console.error('Failed to toggle IP tracking:', err);
    } finally {
      setTogglingIpTracking(false);
    }
  };

  const loadStorage = async () => {
    setLoadingStorage(true);
    try {
      const response = await fetch(`${API_URL}/account/storage`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (response.ok) {
        setStorageInfo(data);
      }
    } catch (err) {
      console.error('Failed to load storage:', err);
    } finally {
      setLoadingStorage(false);
    }
  };

  const exportSlates = async () => {
    if (exportingSlates) return;

    if (!exportConfirmArmed) {
      setExportConfirmArmed(true);
      setExportMessageKind('progress');
      setExportMessage(strings.account.export.confirm);
      if (exportConfirmTimeoutRef.current) clearTimeout(exportConfirmTimeoutRef.current);
      exportConfirmTimeoutRef.current = setTimeout(() => {
        setExportConfirmArmed(false);
        setExportMessage('');
        setExportMessageKind('');
        exportConfirmTimeoutRef.current = null;
      }, 8000);
      return;
    }

    setExportConfirmArmed(false);
    if (exportConfirmTimeoutRef.current) {
      clearTimeout(exportConfirmTimeoutRef.current);
      exportConfirmTimeoutRef.current = null;
    }

    setExportingSlates(true);
    setExportMessageKind('progress');
    setExportMessage('');

    try {
      const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      };

      const parseSqliteUtc = (dateString) => {
        if (!dateString) return null;
        // Many timestamps in the DB are stored without timezone. Treat as UTC for consistent display.
        let normalized = dateString.trim();
        if (normalized.includes(' ') && !normalized.includes('T')) {
          normalized = normalized.replace(' ', 'T');
        }
        const hasTz = /([zZ]|[+-]\d{2}:\d{2})$/.test(normalized);
        if (!hasTz) normalized = `${normalized}Z`;
        const d = new Date(normalized);
        return isNaN(d.getTime()) ? null : d;
      };

      const formatExportDate = (dateString) => {
        const d = parseSqliteUtc(dateString);
        return d ? d.toLocaleString() : '';
      };

      const sanitizeFilenameBase = (name) => {
        return (name || '')
          .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 200);
      };

      const makeUniqueFilename = (base, used, ext = '.txt') => {
        const safeBase = sanitizeFilenameBase(base) || 'slate';
        const initial = `${safeBase}${ext}`;
        if (!used.has(initial)) {
          used.set(initial, 1);
          return initial;
        }

        const n = used.get(initial) + 1;
        used.set(initial, n);
        const candidate = `${safeBase}-${n}${ext}`;
        // Extremely defensive: avoid accidental collisions if sanitization truncates.
        if (!used.has(candidate)) {
          used.set(candidate, 1);
          return candidate;
        }
        let i = n;
        while (used.has(`${safeBase}-${i}${ext}`)) i++;
        const finalName = `${safeBase}-${i}${ext}`;
        used.set(finalName, 1);
        return finalName;
      };

      const formatRetryAfter = (seconds) => {
        const s = Math.max(0, Math.floor(seconds || 0));
        const hours = Math.floor(s / 3600);
        const mins = Math.floor((s % 3600) / 60);
        if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
        if (hours > 0) return `${hours}h`;
        if (mins > 0) return `${mins}m`;
        return `${s}s`;
      };

      // Avoid consuming the 24h cooldown if the user is E2E and not unlocked.
      const meRes = await fetch(`${API_URL}/auth/me`, { credentials: 'include' });
      const meData = await meRes.json();
      if (!meRes.ok) {
        setExportMessageKind('error');
        setExportMessage(meData.error || strings.account.export.errors.failed);
        return;
      }

      const slateKey = userId ? await getSlateKey(userId) : null;
      if (meData.e2eMigrated && !slateKey) {
        setExportMessageKind('error');
        setExportMessage(strings.account.export.errors.unlockRequired);
        return;
      }

      const listRes = await fetch(`${API_URL}/slates`, { credentials: 'include' });
      const listData = await listRes.json();
      if (!listRes.ok) {
        setExportMessageKind('error');
        setExportMessage(listData.error || strings.account.export.errors.failed);
        return;
      }

      const slates = Array.isArray(listData) ? listData : [];
      if (slates.length === 0) {
        setExportMessageKind('error');
        setExportMessage(strings.account.export.noSlates);
        return;
      }

      // Claim the per-account 24h cooldown before doing heavy B2 downloads.
      const claimRes = await fetch(`${API_URL}/account/export-all/claim`, {
        method: 'POST',
        credentials: 'include'
      });
      const claimData = await claimRes.json();
      if (!claimRes.ok) {
        setExportMessageKind('error');
        if (claimRes.status === 429 && claimData.retryAfterSeconds !== undefined) {
          setExportMessage(strings.account.export.cooldown(formatRetryAfter(claimData.retryAfterSeconds)));
        } else {
          setExportMessage(claimData.error || strings.account.export.errors.failed);
        }
        return;
      }

      const zip = new JSZip();
      const usedNames = new Map();
      let exported = 0;
      let skipped = 0;
      let needsUnlock = false;

      for (let i = 0; i < slates.length; i++) {
        setExportMessage(strings.account.export.progress(i + 1, slates.length));

        const slateMeta = slates[i];
        try {
          const res = await fetch(`${API_URL}/slates/${encodeURIComponent(slateMeta.slate_number)}`, { credentials: 'include' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'fetch failed');

          const isEncrypted = !!data.encryptedContent || !!data.encrypted;

          if (isEncrypted && !slateKey) {
            needsUnlock = true;
            break;
          }

          let content = '';
          if (isEncrypted) {
            content = await decryptContent(data.encryptedContent, slateKey);
          } else if (typeof data.content === 'string') {
            content = data.content;
          }

          // Prefer the resolved title on the full record; fall back to list title.
          let title = (data.title || slateMeta.title || '').trim();
          const encryptedTitle = data.encrypted_title || slateMeta.encrypted_title;
          if ((!title || title === 'untitled') && encryptedTitle) {
            if (slateKey) {
              try {
                title = (await decryptTitle(encryptedTitle, slateKey)).trim();
            } catch {
              // Ignore title decrypt failures; export content with a generic filename.
            }
          }
          }

          const fallbackTitle = `slate-${slateMeta.slate_number}`;
          const exportTitle = title || fallbackTitle;
          const filename = makeUniqueFilename(exportTitle, usedNames, '.txt');

          const createdAt = formatExportDate(data.created_at);
          const updatedAt = formatExportDate(data.updated_at);
          const header = `Title: ${exportTitle || 'Untitled'}\nCreated: ${createdAt}\nLast Updated: ${updatedAt}\n\n`;

          zip.file(filename, `${header}${content}`);
          exported++;
        } catch (err) {
          console.error('Export slate failed:', slateMeta?.id, err);
          skipped++;
        }
      }

      if (needsUnlock) {
        setExportMessageKind('error');
        setExportMessage(strings.account.export.errors.unlockRequired);
        return;
      }

      if (exported === 0) {
        setExportMessageKind('error');
        setExportMessage(strings.account.export.errors.failed);
        return;
      }

      setExportMessage(strings.account.export.preparing);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const yyyyMmDd = new Date().toISOString().split('T')[0];
      downloadBlob(zipBlob, `justtype-export-${yyyyMmDd}.zip`);

      setExportMessageKind(skipped > 0 ? 'error' : 'success');
      setExportMessage(strings.account.export.done(exported));
    } catch (err) {
      console.error('Export error:', err);
      setExportMessageKind('error');
      setExportMessage(strings.account.export.errors.failed);
    } finally {
      setExportingSlates(false);
    }
  };

  const showLogoutEverywhereConfirmation = () => {
    setShowLogoutEverywhereModal(true);
  };

  const cancelLogoutEverywhere = () => {
    setShowLogoutEverywhereModal(false);
  };

  const confirmLogoutEverywhere = async () => {
    // Close modal immediately
    setShowLogoutEverywhereModal(false);
    setLoggingOutAll(true);

    try {
      const response = await fetch(`${API_URL}/account/logout-all`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        // Immediately logout - this logs out everywhere including current device
        (onForceLogout || onLogout)();
      } else {
        const data = await response.json();
        showToast(data.error || strings.account.sessions.errors.logoutAllFailed);
        setLoggingOutAll(false);
      }
    } catch (err) {
      console.error('Failed to logout everywhere:', err);
      showToast(strings.account.sessions.errors.logoutAllFailed);
      setLoggingOutAll(false);
    }
  };

  const formatSessionDate = (dateString) => {
    if (!dateString) return '';

    // SQLite stores timestamps as UTC strings without timezone info
    // Parse as UTC explicitly by adding 'Z' suffix
    const date = new Date(dateString + 'Z');
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return strings.account.sessions.time.justNow;
    if (diffMins === 1) return '1m ago';
    if (diffMins < 60) return strings.account.sessions.time.minutesAgo(diffMins);
    if (diffHours === 1) return '1h ago';
    if (diffHours < 24) return strings.account.sessions.time.hoursAgo(diffHours);
    if (diffDays === 1) return '1d ago';
    if (diffDays < 7) return strings.account.sessions.time.daysAgo(diffDays);

    const year = date.getFullYear();
    const currentYear = now.getFullYear();

    if (year === currentYear) {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const formatIpAddress = (ip) => {
    if (!ip) return strings.account.sessions.unknownIp;

    // Clean up IPv6-mapped IPv4 addresses
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }

    // Map localhost variations to friendly name
    if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
      return strings.account.sessions.localhost;
    }

    // For other IPs, return as-is
    return ip;
  };

  const handleRegenerateRecoveryKey = async (e) => {
    e.preventDefault();
    setRecoveryError('');
    setRegeneratingRecovery(true);

    try {
      // Try E2E: generate recovery key client-side
      const slateKey = userId ? await getSlateKey(userId) : null;
      let body = { password: recoveryPassword };
      let clientRecoveryPhrase = null;

      if (slateKey) {
        clientRecoveryPhrase = generateRecoveryPhrase(wordlist);
        const newRecoverySalt = generateSalt();
        const recoveryDerivedKey = await deriveKey(clientRecoveryPhrase, newRecoverySalt);
        const newRecoveryWrappedKey = await wrapKey(slateKey, recoveryDerivedKey);
        body.newRecoveryWrappedKey = newRecoveryWrappedKey;
        body.newRecoverySalt = newRecoverySalt;
      }

      const response = await fetch(`${API_URL}/account/regenerate-recovery-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (response.ok) {
        setRecoveryPhrase(clientRecoveryPhrase || data.recoveryPhrase);
        setRecoveryPassword('');
      } else {
        setRecoveryError(data.error || 'Failed to regenerate recovery key');
      }
    } catch (err) {
      setRecoveryError('Failed to regenerate recovery key');
    } finally {
      setRegeneratingRecovery(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmPassword) {
      setPasswordError(strings.account.password.errors.mismatch);
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError(strings.account.password.errors.tooShort);
      return;
    }

    setChangingPassword(true);

    try {
      // Try E2E: re-wrap key with new password client-side
      const slateKey = userId ? await getSlateKey(userId) : null;
      const body = { currentPassword, newPassword };

      if (slateKey) {
        const newEncryptionSalt = generateSalt();
        const newPasswordDerivedKey = await deriveKey(newPassword, newEncryptionSalt);
        const newWrappedKey = await wrapKey(slateKey, newPasswordDerivedKey);
        body.newWrappedKey = newWrappedKey;
        body.newEncryptionSalt = newEncryptionSalt;

        // Also regenerate recovery key
        const newRecoveryPhrase = generateRecoveryPhrase(wordlist);
        const newRecoverySalt = generateSalt();
        const newRecoveryDerivedKey = await deriveKey(newRecoveryPhrase, newRecoverySalt);
        const newRecoveryWrappedKey = await wrapKey(slateKey, newRecoveryDerivedKey);
        body.newRecoveryWrappedKey = newRecoveryWrappedKey;
        body.newRecoverySalt = newRecoverySalt;
        // Store recovery phrase to show to user
        body._recoveryPhrase = newRecoveryPhrase;
      }

      const recoveryPhraseToShow = body._recoveryPhrase;
      delete body._recoveryPhrase;

      const response = await fetch(`${API_URL}/account/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (response.ok) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        if (recoveryPhraseToShow) {
          setRecoveryPhrase(recoveryPhraseToShow);
          setShowRecoverySection(true);
        } else {
          setPasswordSuccess(strings.account.password.success);
        }
      } else {
        setPasswordError(data.error || strings.account.password.errors.changeFailed);
      }
    } catch (err) {
      setPasswordError(strings.account.password.errors.changeFailed);
    } finally {
      setChangingPassword(false);
    }
  };

  const checkUsernameAvailability = (value) => {
    clearTimeout(usernameCheckTimeout.current);
    setUsernameAvailable(null);
    setUsernameCheckReason('');
    setUsernameError('');

    if (!value || value === username) {
      setCheckingUsername(false);
      return;
    }

    setCheckingUsername(true);
    usernameCheckTimeout.current = setTimeout(async () => {
      try {
        const response = await fetch(`${API_URL}/account/check-username/${encodeURIComponent(value)}`, {
          credentials: 'include',
        });
        const data = await response.json();
        setUsernameAvailable(data.available);
        setUsernameCheckReason(data.available ? '' : data.reason);
      } catch {
        setUsernameAvailable(null);
      } finally {
        setCheckingUsername(false);
      }
    }, 400);
  };

  const handleChangeUsername = async (e) => {
    e.preventDefault();
    setUsernameError('');
    setChangingUsername(true);

    try {
      const response = await fetch(`${API_URL}/account/change-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: newUsername })
      });

      const data = await response.json();

      if (response.ok) {
        onUsernameUpdate(data.username);
        setShowUsernameModal(false);
        setNewUsername('');
      } else {
        setUsernameError(data.error || strings.account.usernameChange.errors.failed);
      }
    } catch (err) {
      setUsernameError(strings.account.usernameChange.errors.failed);
    } finally {
      setChangingUsername(false);
    }
  };

  const handleChangeEmail = async (e) => {
    e.preventDefault();
    setEmailError('');
    setChangingEmail(true);

    try {
      const response = await fetch(`${API_URL}/account/change-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newEmail })
      });

      const data = await response.json();

      if (response.ok) {
        setEmailStep('verify');
        setEmailSuccess(strings.account.emailChange.success.codeSent());
      } else {
        setEmailError(data.error || strings.account.emailChange.errors.sendFailed);
      }
    } catch (err) {
      setEmailError(strings.account.emailChange.errors.sendFailed);
    } finally {
      setChangingEmail(false);
    }
  };

  const handleVerifyEmail = async (e) => {
    e.preventDefault();
    setEmailError('');
    setChangingEmail(true);

    try {
      const response = await fetch(`${API_URL}/account/verify-email-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: verificationCode })
      });

      const data = await response.json();

      if (response.ok) {
        onEmailUpdate(newEmail, true);
        setShowEmailModal(false);
        setEmailStep('input');
        setNewEmail('');
        setVerificationCode('');
        showToast(strings.account.emailChange.success.changed);
      } else {
        setEmailError(data.error || strings.account.emailChange.errors.verifyFailed);
      }
    } catch (err) {
      setEmailError(strings.account.emailChange.errors.verifyFailed);
    } finally {
      setChangingEmail(false);
    }
  };

  const showDeleteAccountConfirmation = () => {
    setShowDeleteAccountModal(true);
    setDeleteConfirmation('');
    setDeleteError('');
  };

  const cancelDeleteAccount = () => {
    setShowDeleteAccountModal(false);
    setDeleteConfirmation('');
    setDeleteError('');
  };

  const confirmDeleteAccount = async () => {
    setDeleteError('');

    if (deleteConfirmation !== username) {
      setDeleteError(strings.account.danger.errors.confirmMismatch(username));
      return;
    }

    // Close modal immediately
    setShowDeleteAccountModal(false);
    setDeleting(true);

    try {
      const response = await fetch(`${API_URL}/account/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok) {
        (onForceLogout || onLogout)();
      } else {
        setDeleteError(data.error || 'Failed to delete account');
        setDeleting(false);
        // Reopen modal to show error
        setShowDeleteAccountModal(true);
      }
    } catch (err) {
      setDeleteError('Failed to delete account');
      setDeleting(false);
      // Reopen modal to show error
      setShowDeleteAccountModal(true);
    }
  };

  const handleLinkGoogle = async () => {
    try {
      // Get linking token from backend
      const response = await fetch(`${API_URL}/account/generate-link-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok) {
        // Redirect to Google OAuth with linking token
        window.location.href = `https://justtype.io/auth/google/link?state=${data.linkingToken}`;
      } else {
        showToast(data.error || 'failed to initiate google linking');
      }
    } catch (err) {
      showToast('failed to initiate google linking');
    }
  };

  const handleVerifyPin = async () => {
    setNewPasswordError('');
    const pin = setPasswordPin.join('');
    if (pin.length !== 6) {
      setNewPasswordError(strings.account.googleAuth.setPassword.errors.pinRequired);
      return;
    }
    setSettingPassword(true);
    try {
      const keyResponse = await fetch(`${API_URL}/account/wrapped-key`, { credentials: 'include' });
      if (!keyResponse.ok) throw new Error('failed to get key data');
      const keyData = await keyResponse.json();
      const pinDerivedKey = await deriveKey(pin, keyData.encryptionSalt, { pin: true });
      const slateKey = await unwrapKey(keyData.wrappedKey, pinDerivedKey);
      setVerifiedSlateKey(slateKey);
      setSetPasswordStep('password');
      setNewPasswordError('');
    } catch (err) {
      setNewPasswordError(strings.account.googleAuth.setPassword.errors.wrongPin);
    } finally {
      setSettingPassword(false);
    }
  };

  const handleSetPassword = async (e) => {
    e.preventDefault();
    setNewPasswordError('');

    if (setPasswordNew.length < 6) {
      setNewPasswordError(strings.account.googleAuth.setPassword.errors.tooShort);
      return;
    }
    if (setPasswordNew !== setPasswordConfirm) {
      setNewPasswordError(strings.account.googleAuth.setPassword.errors.mismatch);
      return;
    }

    setSettingPassword(true);
    try {
      const slateKey = verifiedSlateKey;
      if (!slateKey) {
        setNewPasswordError(strings.account.googleAuth.setPassword.errors.noKey);
        setSettingPassword(false);
        return;
      }

      // Wrap slate key with password
      const encryptionSalt = generateSalt();
      const passwordDerivedKey = await deriveKey(setPasswordNew, encryptionSalt);
      const wrappedKey = await wrapKey(slateKey, passwordDerivedKey);

      // Generate recovery key
      const newRecoveryPhrase = generateRecoveryPhrase(wordlist);
      const recoverySalt = generateSalt();
      const recoveryDerivedKey = await deriveKey(newRecoveryPhrase, recoverySalt);
      const recoveryWrappedKey = await wrapKey(slateKey, recoveryDerivedKey);

      const response = await fetch(`${API_URL}/account/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: setPasswordNew, wrappedKey, encryptionSalt, recoveryWrappedKey, recoverySalt })
      });

      const data = await response.json();
      if (response.ok) {
        setSetPasswordRecoveryPhrase(newRecoveryPhrase);
        setShowSetPasswordModal(false);
        setShowSetPasswordSuccess(true);
        setSetPasswordNew('');
        setSetPasswordConfirm('');
        setSetPasswordStep('pin');
        setSetPasswordPin(['', '', '', '', '', '']);
        setVerifiedSlateKey(null);
      } else {
        setNewPasswordError(data.error || strings.account.googleAuth.setPassword.errors.failed);
      }
    } catch (err) {
      setNewPasswordError(strings.account.googleAuth.setPassword.errors.failed);
    } finally {
      setSettingPassword(false);
    }
  };

  const dismissPasswordBanner = () => {
    setPasswordBannerDismissed(true);
    localStorage.setItem('justtype-password-banner-dismissed', 'true');
  };

  const handleRequestUnlinkGoogle = async () => {
    setUnlinkError('');
    setRequestingUnlink(true);

    try {
      const response = await fetch(`${API_URL}/account/request-unlink-google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok) {
        setShowUnlinkGoogleModal(true);
        setUnlinkSuccess(strings.account.googleAuth.unlink.success.codeSent);
      } else {
        showToast(data.error || 'failed to send verification code');
      }
    } catch (err) {
      showToast('failed to send verification code');
    } finally {
      setRequestingUnlink(false);
    }
  };

  const handleUnlinkGoogle = async (e) => {
    e.preventDefault();
    setUnlinkError('');
    setUnlinkingGoogle(true);

    try {
      const response = await fetch(`${API_URL}/account/unlink-google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: unlinkCode })
      });

      const data = await response.json();

      if (response.ok) {
        setShowUnlinkGoogleModal(false);
        setUnlinkCode('');
        setShowUnlinkSuccessModal(true);
      } else {
        setUnlinkError(data.error || strings.account.googleAuth.unlink.errors.failed);
      }
    } catch (err) {
      setUnlinkError(strings.account.googleAuth.unlink.errors.failed);
    } finally {
      setUnlinkingGoogle(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        {/* identity */}
        <div className="mb-8">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <h1 className="text-xl md:text-2xl text-[var(--theme-accent)] break-all">{username || strings.account.title}</h1>
              <button
                onClick={() => setShowUsernameModal(true)}
                className="text-xs text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors"
              >
                change
              </button>
              {!loadingStorage && storageInfo && storageInfo.supporterTier && (
                <span className="text-[11px] px-1.5 py-0.5 rounded border text-purple-400 border-purple-400/30">
                  {storageInfo.supporterTier === 'quarterly'
                    ? strings.subscription.manage.plans.quarterly
                    : strings.subscription.manage.plans.oneTime}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5 mt-1.5 text-xs flex-wrap">
              <span className="text-[var(--theme-text-muted)] break-all">{email}</span>
              {emailVerified ? (
                <span className="text-green-400">verified</span>
              ) : (
                <span className="text-yellow-400">not verified</span>
              )}
              {authProvider === 'local' && (
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors"
                >
                  change
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Password banner for Google-only users */}
        {authProvider === 'google' && !passwordBannerDismissed && (
          <div className="mb-6 p-4 border border-yellow-400/20 bg-yellow-400/5 rounded flex items-center justify-between gap-4 animate-[fadeInUp_0.3s_ease-out]">
            <p className="text-yellow-400/80 text-sm">{strings.account.googleAuth.setPassword.banner}</p>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => setShowSetPasswordModal(true)}
                className="text-[var(--theme-accent)] text-sm hover:text-yellow-400 transition-colors"
              >
                {strings.account.googleAuth.setPassword.button}
              </button>
              <button
                onClick={dismissPasswordBanner}
                className="text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors text-xs"
              >
                {strings.account.googleAuth.setPassword.dismiss}
              </button>
            </div>
          </div>
        )}

        <Section title={strings.account.sections.account}>
          {/* Sign in method */}
          <InfoRow label="sign in method">
              <span className="text-[var(--theme-accent)]">
                {authProvider === 'google'
                  ? 'google'
                  : authProvider === 'both'
                  ? 'google + password'
                  : 'password'}
              </span>
              {authProvider === 'local' && (
                <button
                  onClick={() => setShowLinkGoogleModal(true)}
                  className="text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors text-xs"
                >
                  + link google
                </button>
              )}
              {authProvider === 'google' && (
                <button
                  onClick={() => setShowSetPasswordModal(true)}
                  className="text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors text-xs"
                >
                  {strings.account.googleAuth.setPassword.button}
                </button>
              )}
              {authProvider === 'both' && (
                <button
                  onClick={handleRequestUnlinkGoogle}
                  disabled={requestingUnlink}
                  className="text-red-400 hover:text-red-300 transition-colors text-xs disabled:opacity-50"
                >
                  {requestingUnlink ? 'sending...' : 'unlink google'}
                </button>
              )}
          </InfoRow>

          {/* Plan */}
          {!loadingStorage && storageInfo && (
            <InfoRow label="current plan">
                <span className="text-[var(--theme-accent)]">
                  {storageInfo.supporterTier === 'quarterly'
                    ? strings.subscription.manage.plans.quarterly
                    : storageInfo.supporterTier === 'one_time'
                    ? strings.subscription.manage.plans.oneTime
                    : strings.subscription.manage.plans.free}
                </span>
                {storageInfo.supporterTier === 'quarterly' && (
                  <button
                    onClick={() => window.location.href = '/manage-subscription'}
                    className="text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors text-xs"
                  >
                    manage
                  </button>
                )}
                {!storageInfo.supporterTier && (
                  <button
                    onClick={() => window.location.href = '/?donate=quarterly'}
                    className="text-[var(--theme-text-dim)] hover:text-[var(--theme-accent)] transition-colors text-xs"
                  >
                    upgrade
                  </button>
                )}
            </InfoRow>
          )}

          {/* Supporter badge toggle */}
          {!loadingStorage && storageInfo && storageInfo.supporterTier && (
            <InfoRow label="supporter badge">
              <button
                onClick={async () => {
                  const newValue = !storageInfo.supporterBadgeVisible;
                  try {
                    const response = await fetch(`${API_URL}/account/update-badge-visibility`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ visible: newValue })
                    });
                    if (response.ok) {
                      setStorageInfo({ ...storageInfo, supporterBadgeVisible: newValue });
                    }
                  } catch (err) {
                    console.error('Badge visibility update error:', err);
                  }
                }}
                className="text-[var(--theme-accent)] hover:opacity-70 transition-opacity"
              >
                {storageInfo.supporterBadgeVisible ? 'visible' : 'hidden'}
              </button>
            </InfoRow>
          )}
        </Section>

        {/* Upgrade prompt for free users */}
        {!loadingStorage && storageInfo && !storageInfo.supporterTier && (
          <div className="mb-6 border border-[var(--theme-border)] rounded-lg px-4 py-4 bg-[var(--theme-bg-secondary)]">
            <p className="text-xs text-[var(--theme-text-dim)] leading-relaxed mb-4">
              {strings.writer.about.support.body}{' '}
              <a href="/limits" target="_blank" rel="noopener noreferrer" className="text-[var(--theme-text-muted)] hover:text-[var(--theme-accent)] underline underline-offset-2 transition-colors">
                {strings.writer.about.support.limits}
              </a>.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => window.location.href = '/?donate=one_time'}
                className="flex-1 border border-[var(--theme-border)] rounded px-3 py-2.5 hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-accent)] transition-colors"
              >
                <span className="block text-xs">{strings.writer.about.support.donate}</span>
                <span className="block text-[10px] text-[var(--theme-text-dim)] mt-0.5">{strings.writer.about.support.donateHint}</span>
              </button>
              <button
                onClick={() => window.location.href = '/?donate=quarterly'}
                className="flex-1 border border-[var(--theme-border)] rounded px-3 py-2.5 hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-accent)] transition-colors"
              >
                <span className="block text-xs">{strings.writer.about.support.subscribe}</span>
                <span className="block text-[10px] text-[var(--theme-text-dim)] mt-0.5">{strings.writer.about.support.subscribeHint}</span>
              </button>
            </div>
          </div>
        )}

        {/* Grace Period Warning */}
        {!loadingStorage && storageInfo && storageInfo.inGracePeriod && (
          <div className="mb-8 p-4 bg-red-900/20 border border-red-500/50 rounded">
            <p className="text-sm text-red-400 mb-2">storage grace period active</p>
            <p className="text-xs text-[var(--theme-text-muted)] mb-3">
              {storageInfo.gracePeriodDaysRemaining} days remaining to reduce storage or slates will be deleted.
            </p>
            <a href="/slates" className="text-xs text-[var(--theme-accent)] hover:underline">manage slates →</a>
          </div>
        )}

        {/* Storage Warning */}
        {!loadingStorage && storageInfo && storageInfo.percentage >= 80 && storageInfo.supporterTier !== 'quarterly' && (
          <div className="mb-8 p-4 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-[var(--theme-text-dim)]">storage</span>
              <span className={storageInfo.percentage >= 100 ? 'text-red-400' : 'text-orange-400'}>
                {storageInfo.percentage.toFixed(5)}%
              </span>
            </div>
            <div className="w-full bg-[var(--theme-bg)] rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full ${storageInfo.percentage >= 100 ? 'bg-red-500' : 'bg-orange-500'}`}
                style={{ width: `${Math.min(storageInfo.percentage, 100)}%` }}
              />
            </div>
          </div>
        )}

        <Section title={strings.account.sections.security}>
          {/* Password Section - Only for local/both auth */}
          {(authProvider === 'local' || authProvider === 'both') && (
            <div>
              <DisclosureHeader
                label={<>change password</>}
                open={showPasswordSection}
                onToggle={() => setShowPasswordSection(!showPasswordSection)}
              />
              {showPasswordSection && (
                <div className="px-4 pb-4 -mt-1">
                  <form onSubmit={handleChangePassword} className="space-y-3">
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="current password"
                      className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-2 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-accent)] text-sm"
                      required
                    />
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="new password"
                      className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-2 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-accent)] text-sm"
                      required
                    />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="confirm new password"
                      className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-2 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-accent)] text-sm"
                      required
                    />
                    {passwordError && <p className="text-red-400 text-xs">{passwordError}</p>}
                    {passwordSuccess && <p className="text-green-400 text-xs">{passwordSuccess}</p>}
                    <button
                      type="submit"
                      disabled={changingPassword}
                      className="px-4 py-2 bg-white text-black rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-50 text-sm"
                    >
                      {changingPassword ? 'changing...' : 'change password'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* Recovery Key Pending Banner */}
          {recoveryKeyPending && (authProvider === 'local' || authProvider === 'both') && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-4">
              <p className="text-yellow-400 text-sm">your account was upgraded but your recovery key was never shown. please regenerate it below and save it somewhere safe.</p>
            </div>
          )}

          {/* Recovery Key Section - Only for local/both auth */}
          {(authProvider === 'local' || authProvider === 'both') && (
            <div className={recoveryKeyPending ? 'bg-yellow-500/5' : ''}>
              <DisclosureHeader
                label={<>{strings.auth.recoveryKey.regenerate.title}</>}
                open={showRecoverySection}
                onToggle={() => setShowRecoverySection(!showRecoverySection)}
              />
              {showRecoverySection && (
                <div className="px-4 pb-4 -mt-1">
                  <p className="text-[var(--theme-text-muted)] text-xs mb-3">{strings.auth.recoveryKey.regenerate.description}</p>
                  <form onSubmit={handleRegenerateRecoveryKey} className="space-y-3">
                    <input
                      type="password"
                      value={recoveryPassword}
                      onChange={(e) => setRecoveryPassword(e.target.value)}
                      placeholder={strings.auth.recoveryKey.regenerate.passwordRequired}
                      className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-2 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-accent)] text-sm"
                      required
                    />
                    {recoveryError && <p className="text-red-400 text-xs">{recoveryError}</p>}
                    <button
                      type="submit"
                      disabled={regeneratingRecovery}
                      className="px-4 py-2 bg-white text-black rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-50 text-sm"
                    >
                      {regeneratingRecovery ? 'regenerating...' : strings.auth.recoveryKey.regenerate.submit}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* Recovery Key Modal */}
          {recoveryPhrase && (
            <RecoveryKeyModal
              recoveryPhrase={recoveryPhrase}
              subtitle={strings.account.password.recoveryKeyRegenerated}
              onAcknowledge={() => {
                setRecoveryPhrase(null);
                setShowRecoverySection(false);
                // Clear App's pending flag so the yellow warning goes away
                // without a refresh
                if (onRecoveryKeyAcknowledged) onRecoveryKeyAcknowledged();
                // Tell server user has seen their recovery key
                fetch(`${API_URL}/account/acknowledge-recovery-key`, {
                  method: 'POST',
                  credentials: 'include'
                }).catch(() => {});
              }}
            />
          )}

          {/* Sessions Section */}
          <div>
            <DisclosureHeader
                label={<>sessions {!loadingSessions && sessions.length > 0 && `(${sessions.length})`}</>}
                open={showSessions}
                onToggle={() => setShowSessions(!showSessions)}
              />
            {showSessions && (
              <div className="px-4 pb-4 -mt-1">
                {loadingSessions ? (
                  <p className="text-[var(--theme-text-dim)] text-sm">loading...</p>
                ) : (
                  <div className="space-y-3">
                    {sessions.slice(0, 5).map((session, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded text-sm ${
                          session.is_current === 1 ? 'bg-blue-950/20 border border-blue-500/30' : 'bg-[var(--theme-bg)]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[var(--theme-accent)]">{session.device || 'unknown device'}</span>
                          {session.is_current === 1 && (
                            <span className="text-blue-400 text-xs">current</span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--theme-text-dim)] mt-1">
                          {formatSessionDate(session.last_activity)}
                          {session.ip_address && ` · ${formatIpAddress(session.ip_address)}`}
                        </div>
                      </div>
                    ))}
                    {sessions.length > 5 && (
                      <p className="text-xs text-[var(--theme-text-dim)]">+ {sessions.length - 5} more sessions</p>
                    )}

                    <div className="pt-3 border-t border-[var(--theme-border)]">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={trackIpAddress}
                          onChange={toggleIpTracking}
                          disabled={togglingIpTracking}
                          className="w-4 h-4 rounded border-[var(--theme-text-dim)] bg-[var(--theme-bg)] text-blue-500 focus:ring-0"
                        />
                        <span className="text-[var(--theme-text-muted)]">track IP addresses</span>
                      </label>
                    </div>

                    <button
                      onClick={showLogoutEverywhereConfirmation}
                      disabled={loggingOutAll}
                      className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50"
                    >
                      {loggingOutAll ? 'logging out...' : 'sign out everywhere'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

        </Section>

        <Section title={strings.account.sections.connections}>
          {/* Connected Apps Section */}
          <div>
            <DisclosureHeader
                label={<>{strings.account.connectedApps.title} {!loadingApps && connectedApps.length > 0 && `(${connectedApps.length})`}</>}
                open={showConnectedApps}
                onToggle={() => setShowConnectedApps(!showConnectedApps)}
              />
            {showConnectedApps && (
              <div className="px-4 pb-4 -mt-1">
                {loadingApps ? (
                  <p className="text-[var(--theme-text-dim)] text-sm">{strings.account.connectedApps.loading}</p>
                ) : connectedApps.length === 0 ? (
                  <p className="text-[var(--theme-text-dim)] text-sm">{strings.account.connectedApps.empty}</p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-[var(--theme-text-dim)]">{strings.account.connectedApps.description}</p>
                    {connectedApps.map((app) => (
                      <div key={app.client_id} className="p-3 rounded text-sm bg-[var(--theme-bg)]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[var(--theme-accent)]">{app.name}</span>
                          <button
                            onClick={() => revokeConnectedApp(app.client_id)}
                            disabled={revokingApp === app.client_id}
                            className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
                          >
                            {revokingApp === app.client_id ? strings.account.connectedApps.revoking : strings.account.connectedApps.revoke}
                          </button>
                        </div>
                        {app.website && (
                          <a href={app.website} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--theme-text-dim)] hover:text-[var(--theme-text-muted)] break-all">{app.website}</a>
                        )}
                        <div className="text-xs text-[var(--theme-text-dim)] mt-1">
                          {strings.account.connectedApps.canAccess}: {app.scopes.join(', ')}
                        </div>
                        {app.can_share && (
                          <div className="mt-2 flex items-center gap-3 flex-wrap">
                            <button
                              onClick={() => setShareApp({ client_id: app.client_id, name: app.name })}
                              className="text-xs text-[var(--theme-accent)] border border-[var(--theme-border)] rounded px-3 py-1 hover:bg-[var(--theme-bg-secondary)] transition-colors"
                            >
                              {strings.account.connectedApps.shareSlates}
                            </button>
                            {app.share_all ? (
                              <span className="text-xs text-[var(--theme-text-muted)]">{strings.account.connectedApps.sharesAll}</span>
                            ) : app.shared_count > 0 && (
                              <span className="text-xs text-[var(--theme-text-dim)]">{strings.account.connectedApps.sharedCount(app.shared_count)}</span>
                            )}
                            {app.device_count > 0 && (
                              <span className="text-xs text-[var(--theme-text-dim)]">{strings.account.connectedApps.deviceCount(app.device_count)}</span>
                            )}
                          </div>
                        )}
                        {!app.can_share && app.scopes.includes('slates:read:private') && (
                          <div className="text-xs text-[var(--theme-text-dim)] mt-2">{strings.account.connectedApps.noDeviceYet}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {shareApp && (
            <ShareSlates
              clientId={shareApp.client_id}
              appName={shareApp.name}
              userId={userId}
              onClose={() => setShareApp(null)}
              onChanged={loadConnectedApps}
            />
          )}

          <a
            href="/dev"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-4 px-4 py-3.5 text-sm hover:bg-[var(--theme-bg-secondary)] transition-colors"
          >
            <span>{strings.account.devPortal}</span>
            <span className="text-[var(--theme-text-dim)]">↗</span>
          </a>
        </Section>

        <Section tone="danger">
          {/* Danger Zone */}
          <div>
            <DisclosureHeader
                label={<>danger zone</>}
                open={showDangerZone}
                onToggle={() => setShowDangerZone(!showDangerZone)} tone="danger"
              />
            {showDangerZone && (
              <div className="px-4 pb-4 -mt-1">
                <p className="text-xs text-[var(--theme-text-dim)] mb-3">
                  permanently delete your account and all data. this cannot be undone.
                </p>
                <button
                  onClick={showDeleteAccountConfirmation}
                  disabled={deleting}
                  className="px-4 py-2 bg-red-600 text-[var(--theme-accent)] rounded hover:bg-red-700 transition-colors disabled:opacity-50 text-sm"
                >
                  {deleting ? 'deleting...' : 'delete account'}
                </button>
              </div>
            )}
          </div>
        </Section>

        {/* Account-level actions, kept apart from the settings lists above */}
        <div className="flex flex-wrap items-center gap-3 pt-2 pb-10 text-sm">
          <button
            onClick={exportSlates}
            disabled={exportingSlates}
            className="px-4 py-2 border border-[var(--theme-border)] rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors disabled:opacity-50"
          >
            {exportingSlates
              ? strings.account.export.exporting
              : (exportConfirmArmed ? strings.account.export.confirm : strings.account.export.button)
            }
          </button>
          <button
            onClick={onLogout}
            className="px-4 py-2 border border-[var(--theme-border)] rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors ml-auto"
          >
            sign out
          </button>
          {exportMessage && (
            <span className={`w-full ${
              exportMessageKind === 'success' ? 'text-green-400' :
              exportMessageKind === 'error' ? 'text-red-400' :
              'text-[var(--theme-text-dim)]'
            }`}>
              {exportMessage}
            </span>
          )}
        </div>

      {/* Email Change Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-[var(--theme-accent)] mb-6">{strings.account.emailChange.title}</h2>

            {emailStep === 'input' ? (
              <form onSubmit={handleChangeEmail} className="space-y-4">
                <div>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder={strings.account.emailChange.newEmailPlaceholder}
                    className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-3 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-accent)] text-sm"
                    required
                  />
                </div>
                {emailError && <p className="text-red-400 text-xs md:text-sm">{emailError}</p>}
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={changingEmail}
                    className="flex-1 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-50 text-sm"
                  >
                    {changingEmail ? strings.account.emailChange.submittingSend : strings.account.emailChange.submitSend}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmailModal(false);
                      setEmailStep('input');
                      setNewEmail('');
                      setEmailError('');
                    }}
                    className="flex-1 border border-[var(--theme-border)] text-[var(--theme-accent)] px-6 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
                  >
                    {strings.account.emailChange.cancel}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleVerifyEmail} className="space-y-4">
                <p className="text-sm text-[var(--theme-text-dim)]">{strings.account.emailChange.verifyInstructions(newEmail)}</p>
                <div>
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder={strings.account.emailChange.codePlaceholder}
                    maxLength={6}
                    className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-3 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-accent)] text-sm text-center tracking-widest"
                    required
                  />
                </div>
                {emailError && <p className="text-red-400 text-xs md:text-sm">{emailError}</p>}
                {emailSuccess && <p className="text-green-400 text-xs md:text-sm">{emailSuccess}</p>}
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={changingEmail}
                    className="flex-1 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-50 text-sm"
                  >
                    {changingEmail ? strings.account.emailChange.submittingVerify : strings.account.emailChange.submitVerify}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowEmailModal(false);
                      setEmailStep('input');
                      setNewEmail('');
                      setVerificationCode('');
                      setEmailError('');
                      setEmailSuccess('');
                    }}
                    className="flex-1 border border-[var(--theme-border)] text-[var(--theme-accent)] px-6 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
                  >
                    {strings.account.emailChange.cancel}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Username Change Modal */}
      {showUsernameModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-[var(--theme-accent)] mb-6">{strings.account.usernameChange.title}</h2>
            <form onSubmit={handleChangeUsername} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => {
                    const val = e.target.value.toLowerCase();
                    setNewUsername(val);
                    checkUsernameAvailability(val);
                  }}
                  placeholder={strings.account.usernameChange.placeholder}
                  className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-3 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-accent)] text-sm"
                  required
                  autoFocus
                  maxLength={20}
                />
                {newUsername && newUsername !== username && (
                  <div className="mt-2 text-xs">
                    {checkingUsername ? (
                      <span className="text-[var(--theme-text-dim)]">checking...</span>
                    ) : usernameAvailable === true ? (
                      <span className="text-green-400">available</span>
                    ) : usernameAvailable === false ? (
                      <span className="text-red-400">{usernameCheckReason}</span>
                    ) : null}
                  </div>
                )}
              </div>
              {usernameError && <p className="text-red-400 text-xs md:text-sm">{usernameError}</p>}
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={changingUsername || !newUsername.trim() || usernameAvailable === false || checkingUsername}
                  className="flex-1 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-50 text-sm"
                >
                  {changingUsername ? strings.account.usernameChange.submitting : strings.account.usernameChange.submit}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUsernameModal(false);
                    setNewUsername('');
                    setUsernameError('');
                    setUsernameAvailable(null);
                    setUsernameCheckReason('');
                  }}
                  className="flex-1 border border-[var(--theme-border)] text-[var(--theme-accent)] px-6 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
                >
                  cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Logout Everywhere Confirmation Modal */}
      {showLogoutEverywhereModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-[var(--theme-accent)] mb-4">{strings.account.sessions.everywhereModal.title}</h2>
            <p className="text-sm text-[var(--theme-text-dim)] mb-6">
              {strings.account.sessions.everywhereModal.message}
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmLogoutEverywhere}
                className="flex-1 bg-red-600 text-[var(--theme-accent)] px-6 py-3 rounded hover:bg-red-700 transition-colors text-sm"
              >
                {strings.account.sessions.everywhereModal.confirm}
              </button>
              <button
                onClick={cancelLogoutEverywhere}
                className="flex-1 border border-[var(--theme-border)] text-[var(--theme-accent)] px-6 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
              >
                {strings.account.sessions.everywhereModal.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {showDeleteAccountModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-[var(--theme-accent)] mb-4">{strings.account.danger.title}</h2>
            <p className="text-sm text-[var(--theme-text-dim)] mb-4">
              {strings.account.danger.warning}
            </p>
            <p className="text-sm text-[var(--theme-text-dim)] mb-6">
              {strings.account.danger.confirmInstruction(username)}
            </p>
            <div className="space-y-4">
              <input
                type="text"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder={strings.account.danger.confirmPlaceholder(username)}
                className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-3 focus:outline-none focus:border-red-400 text-[var(--theme-accent)] text-sm"
                autoFocus
              />
              {deleteError && <p className="text-red-400 text-xs md:text-sm">{deleteError}</p>}
              <div className="flex gap-3">
                <button
                  onClick={confirmDeleteAccount}
                  disabled={!deleteConfirmation}
                  className="flex-1 bg-red-600 text-[var(--theme-accent)] px-6 py-3 rounded hover:bg-red-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {strings.account.danger.submit}
                </button>
                <button
                  onClick={cancelDeleteAccount}
                  className="flex-1 border border-[var(--theme-border)] text-[var(--theme-accent)] px-6 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
                >
                  {strings.account.danger.modal.cancel}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Link Google Confirmation Modal */}
      {showLinkGoogleModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-[var(--theme-accent)] mb-4">{strings.account.googleAuth.link.modal.title}</h2>
            <p className="text-sm text-[var(--theme-text-dim)] mb-6">
              {strings.account.googleAuth.link.modal.message}
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleLinkGoogle}
                className="flex-1 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors text-sm"
              >
                {strings.account.googleAuth.link.modal.continue}
              </button>
              <button
                onClick={() => setShowLinkGoogleModal(false)}
                className="flex-1 border border-[var(--theme-border)] text-[var(--theme-accent)] px-6 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
              >
                {strings.account.googleAuth.link.modal.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link Google Success Modal */}
      {showLinkSuccessModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-[var(--theme-accent)] mb-4">{strings.account.googleAuth.link.success.title}</h2>
            <p className="text-sm text-[var(--theme-text-dim)] mb-6">
              {strings.account.googleAuth.link.success.message}
            </p>
            <button
              onClick={() => {
                setShowLinkSuccessModal(false);
                window.location.reload();
              }}
              className="w-full bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors text-sm"
            >
              {strings.account.googleAuth.link.success.button}
            </button>
          </div>
        </div>
      )}

      {/* Link Google Error Modal */}
      {showLinkErrorModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-[var(--theme-accent)] mb-4">{strings.account.googleAuth.link.errors.title}</h2>
            <p className="text-sm text-[var(--theme-text-dim)] mb-6">
              {linkErrorMessage}
            </p>
            <button
              onClick={() => {
                setShowLinkErrorModal(false);
                setLinkErrorMessage('');
              }}
              className="w-full bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors text-sm"
            >
              {strings.account.googleAuth.link.errors.button}
            </button>
          </div>
        </div>
      )}

      {/* Unlink Google Verification Modal */}
      {showUnlinkGoogleModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-[var(--theme-accent)] mb-4">{strings.account.googleAuth.unlink.modal.title}</h2>
            <p className="text-sm text-[var(--theme-text-dim)] mb-4">
              {strings.account.googleAuth.unlink.modal.instructions}
            </p>
            {unlinkSuccess && <p className="text-green-400 text-xs md:text-sm mb-4">{unlinkSuccess}</p>}
            <form onSubmit={handleUnlinkGoogle} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={unlinkCode}
                  onChange={(e) => setUnlinkCode(e.target.value)}
                  placeholder={strings.account.googleAuth.unlink.modal.codePlaceholder}
                  maxLength={6}
                  className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded px-4 py-3 focus:outline-none focus:border-[var(--theme-text-dim)] text-[var(--theme-accent)] text-sm text-center tracking-widest"
                  required
                  autoFocus
                />
              </div>
              {unlinkError && <p className="text-red-400 text-xs md:text-sm">{unlinkError}</p>}
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={unlinkingGoogle || unlinkCode.length !== 6}
                  className="flex-1 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {unlinkingGoogle ? strings.account.googleAuth.unlink.modal.submitting : strings.account.googleAuth.unlink.modal.submit}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUnlinkGoogleModal(false);
                    setUnlinkCode('');
                    setUnlinkError('');
                    setUnlinkSuccess('');
                  }}
                  className="flex-1 border border-[var(--theme-border)] text-[var(--theme-accent)] px-6 py-3 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
                >
                  {strings.account.googleAuth.unlink.modal.cancel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unlink Google Success Modal */}
      {showUnlinkSuccessModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md animate-modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-[var(--theme-accent)] mb-4">{strings.account.googleAuth.unlink.success.title}</h2>
            <p className="text-sm text-[var(--theme-text-dim)] mb-6">
              {strings.account.googleAuth.unlink.success.message}
            </p>
            <button
              onClick={() => {
                setShowUnlinkSuccessModal(false);
                window.location.reload();
              }}
              className="w-full bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors text-sm"
            >
              {strings.account.googleAuth.unlink.success.button}
            </button>
          </div>
        </div>
      )}

      {/* Set Password Modal */}
      {showSetPasswordModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[modalOverlayIn_0.15s_ease-out]" onClick={() => { setShowSetPasswordModal(false); setSetPasswordStep('pin'); setSetPasswordPin(['','','','','','']); setNewPasswordError(''); setVerifiedSlateKey(null); }}>
          <div className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border)] rounded p-6 md:p-8 max-w-sm w-full animate-[modalContentIn_0.15s_ease-out]" onClick={e => e.stopPropagation()}>
            {setPasswordStep === 'pin' ? (
              <>
                <h2 className="text-lg text-[var(--theme-accent)] mb-2">{strings.account.googleAuth.setPassword.modal.pinTitle}</h2>
                <p className="text-sm text-[var(--theme-text-muted)] mb-6">{strings.account.googleAuth.setPassword.modal.pinMessage}</p>
                <div className="flex gap-2 justify-center" onPaste={e => { e.preventDefault(); const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (d.length === 6) { setSetPasswordPin(d.split('')); setTimeout(() => setPwPinRefs.current[5]?.focus(), 0); } }}>
                  {setPasswordPin.map((digit, i) => (
                    <input
                      key={i}
                      ref={el => setPwPinRefs.current[i] = el}
                      autoFocus={i === 0}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={e => { if (!/^\d*$/.test(e.target.value)) return; const p = [...setPasswordPin]; p[i] = e.target.value.slice(-1); setSetPasswordPin(p); setNewPasswordError(''); e.target.value && i < 5 && setPwPinRefs.current[i + 1]?.focus(); }}
                      onKeyDown={e => { if (e.key === 'Backspace' && !setPasswordPin[i] && i > 0) { setPwPinRefs.current[i - 1]?.focus(); const p = [...setPasswordPin]; p[i - 1] = ''; setSetPasswordPin(p); } }}
                      className="w-11 h-14 bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded text-center text-2xl text-[var(--theme-accent)] focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors"
                    />
                  ))}
                </div>
                {newPasswordError && <p className="text-red-400 text-sm text-center mt-3">{newPasswordError}</p>}
                <button
                  onClick={handleVerifyPin}
                  disabled={settingPassword || setPasswordPin.join('').length !== 6}
                  className="w-full mt-6 bg-white text-black px-6 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-30 text-sm"
                >
                  {settingPassword ? strings.account.googleAuth.setPassword.modal.pinVerifying : strings.account.googleAuth.setPassword.modal.pinVerify}
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg text-[var(--theme-accent)] mb-2">{strings.account.googleAuth.setPassword.modal.title}</h2>
                <p className="text-sm text-[var(--theme-text-muted)] mb-6">{strings.account.googleAuth.setPassword.modal.message}</p>
                <form onSubmit={handleSetPassword} className="space-y-3">
                  <input
                    type="password"
                    value={setPasswordNew}
                    onChange={e => setSetPasswordNew(e.target.value)}
                    placeholder={strings.account.googleAuth.setPassword.modal.passwordPlaceholder}
                    minLength={6}
                    required
                    autoFocus
                    className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-2 text-[var(--theme-accent)] focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors rounded text-sm"
                  />
                  <input
                    type="password"
                    value={setPasswordConfirm}
                    onChange={e => setSetPasswordConfirm(e.target.value)}
                    placeholder={strings.account.googleAuth.setPassword.modal.confirmPlaceholder}
                    minLength={6}
                    required
                    className="w-full bg-[var(--theme-bg)] border border-[var(--theme-border)] px-4 py-2 text-[var(--theme-accent)] focus:border-[var(--theme-text-dim)] focus:outline-none transition-colors rounded text-sm"
                  />
                  {newPasswordError && <p className="text-red-400 text-xs">{newPasswordError}</p>}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => { setShowSetPasswordModal(false); setNewPasswordError(''); setSetPasswordNew(''); setSetPasswordConfirm(''); setSetPasswordStep('pin'); setSetPasswordPin(['','','','','','']); setVerifiedSlateKey(null); }}
                      className="flex-1 border border-[var(--theme-border)] px-4 py-2 rounded hover:bg-[var(--theme-bg-tertiary)] transition-colors text-sm"
                    >
                      {strings.account.googleAuth.setPassword.modal.cancel}
                    </button>
                    <button
                      type="submit"
                      disabled={settingPassword}
                      className="flex-1 bg-white text-black px-4 py-2 rounded hover:bg-[#e5e5e5] transition-colors text-sm disabled:opacity-50"
                    >
                      {settingPassword ? strings.account.googleAuth.setPassword.modal.submitting : strings.account.googleAuth.setPassword.modal.submit}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Set Password Success - Recovery Key Modal */}
      {showSetPasswordSuccess && setPasswordRecoveryPhrase && (
        <RecoveryKeyModal
          recoveryPhrase={setPasswordRecoveryPhrase}
          subtitle={strings.account.googleAuth.setPassword.success.subtitle}
          onAcknowledge={() => {
            setShowSetPasswordSuccess(false);
            setSetPasswordRecoveryPhrase(null);
            window.location.reload();
          }}
        />
      )}
      </div>
      {toastNode}
    </div>
  );
}
