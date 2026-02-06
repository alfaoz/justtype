import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { API_URL } from '../config';
import { strings } from '../strings';
import { RecoveryKeyModal } from './RecoveryKeyModal';
import { generateSalt, deriveKey, wrapKey, unwrapKey, generateRecoveryPhrase, decryptContent, decryptTitle } from '../crypto';
import { getSlateKey } from '../keyStore';
import { wordlist } from '../bip39-wordlist';

export function Account({ token, username, userId, email, emailVerified, authProvider, onLogout, onForceLogout, onEmailUpdate, recoveryKeyPending, onRecoveryKeyShown }) {
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
          const res = await fetch(`${API_URL}/slates/${encodeURIComponent(slateMeta.id)}`, { credentials: 'include' });
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

          const fallbackTitle = `slate-${slateMeta.id}`;
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
        alert(data.error || strings.account.sessions.errors.logoutAllFailed);
        setLoggingOutAll(false);
      }
    } catch (err) {
      console.error('Failed to logout everywhere:', err);
      alert(strings.account.sessions.errors.logoutAllFailed);
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
        alert(strings.account.emailChange.success.changed);
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
        alert(data.error || 'failed to initiate google linking');
      }
    } catch (err) {
      alert('failed to initiate google linking');
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
        alert(data.error || 'failed to send verification code');
      }
    } catch (err) {
      alert('failed to send verification code');
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
        <h1 className="text-xl md:text-2xl text-white mb-8">{strings.account.title}</h1>

        {/* Password banner for Google-only users */}
        {authProvider === 'google' && !passwordBannerDismissed && (
          <div className="mb-6 p-4 border border-yellow-400/20 bg-yellow-400/5 rounded flex items-center justify-between gap-4 animate-[fadeInUp_0.3s_ease-out]">
            <p className="text-yellow-400/80 text-sm">{strings.account.googleAuth.setPassword.banner}</p>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => setShowSetPasswordModal(true)}
                className="text-white text-sm hover:text-yellow-400 transition-colors"
              >
                {strings.account.googleAuth.setPassword.button}
              </button>
              <button
                onClick={dismissPasswordBanner}
                className="text-[#666] hover:text-white transition-colors text-xs"
              >
                {strings.account.googleAuth.setPassword.dismiss}
              </button>
            </div>
          </div>
        )}

        {/* Main Info - Clean text-based layout */}
        <div className="mb-8 space-y-4 text-sm">
          {/* Username */}
          <div className="flex items-center justify-between py-3 border-b border-[#222]">
            <span className="text-[#666]">username:</span>
            <span className="text-white">{username}</span>
          </div>

          {/* Email */}
          <div className="flex items-center justify-between py-3 border-b border-[#222]">
            <span className="text-[#666]">email:</span>
            <div className="flex items-center gap-3">
              <span className="text-white">{email}</span>
              {emailVerified ? (
                <span className="text-green-400 text-xs">verified</span>
              ) : (
                <span className="text-yellow-400 text-xs">not verified</span>
              )}
              {authProvider === 'local' && (
                <button
                  onClick={() => setShowEmailModal(true)}
                  className="text-[#666] hover:text-white transition-colors text-xs"
                >
                  change
                </button>
              )}
            </div>
          </div>

          {/* Sign in method */}
          <div className="flex items-center justify-between py-3 border-b border-[#222]">
            <span className="text-[#666]">sign in method:</span>
            <div className="flex items-center gap-3">
              <span className="text-white">
                {authProvider === 'google'
                  ? 'google'
                  : authProvider === 'both'
                  ? 'google + password'
                  : 'password'}
              </span>
              {authProvider === 'local' && (
                <button
                  onClick={() => setShowLinkGoogleModal(true)}
                  className="text-[#666] hover:text-white transition-colors text-xs"
                >
                  + link google
                </button>
              )}
              {authProvider === 'google' && (
                <button
                  onClick={() => setShowSetPasswordModal(true)}
                  className="text-[#666] hover:text-white transition-colors text-xs"
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
            </div>
          </div>

          {/* Plan */}
          {!loadingStorage && storageInfo && (
            <div className="flex items-center justify-between py-3 border-b border-[#222]">
              <span className="text-[#666]">current plan:</span>
              <div className="flex items-center gap-3">
                <span className="text-white">
                  {storageInfo.supporterTier === 'quarterly' ? 'supporter · unlimited' :
                   storageInfo.supporterTier === 'one_time' ? 'supporter · 50MB' :
                   'free · 5MB'}
                </span>
                {storageInfo.supporterTier === 'quarterly' && (
                  <button
                    onClick={() => window.location.href = '/manage-subscription'}
                    className="text-[#666] hover:text-white transition-colors text-xs"
                  >
                    manage
                  </button>
                )}
                {!storageInfo.supporterTier && (
                  <button
                    onClick={() => window.location.href = '/?donate=quarterly'}
                    className="text-[#666] hover:text-white transition-colors text-xs"
                  >
                    upgrade
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Supporter badge toggle */}
          {!loadingStorage && storageInfo && storageInfo.supporterTier && (
            <div className="flex items-center justify-between py-3 border-b border-[#222]">
              <span className="text-[#666]">supporter badge:</span>
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
                className="text-white hover:opacity-70 transition-opacity"
              >
                {storageInfo.supporterBadgeVisible ? 'visible' : 'hidden'}
              </button>
            </div>
          )}
        </div>

        {/* Quick Actions Row */}
        <div className="flex flex-wrap gap-3 mb-8 text-sm">
          <button
            onClick={onLogout}
            className="px-4 py-2 border border-[#333] rounded hover:bg-[#222] transition-colors"
          >
            sign out
          </button>
          <button
            onClick={exportSlates}
            disabled={exportingSlates}
            className="px-4 py-2 border border-[#333] rounded hover:bg-[#222] transition-colors disabled:opacity-50"
          >
            {exportingSlates
              ? strings.account.export.exporting
              : (exportConfirmArmed ? strings.account.export.confirm : strings.account.export.button)
            }
          </button>
          {exportMessage && (
            <span className={`px-4 py-2 ${
              exportMessageKind === 'success' ? 'text-green-400' :
              exportMessageKind === 'error' ? 'text-red-400' :
              'text-[#666]'
            }`}>
              {exportMessage}
            </span>
          )}
        </div>

        {/* Upgrade prompt for free users */}
        {!loadingStorage && storageInfo && !storageInfo.supporterTier && (
          <div className="mb-8 p-4 bg-[#1a1a1a] border border-[#333] rounded">
            <p className="text-sm text-[#666] mb-3">support justtype and get more storage</p>
            <div className="flex gap-3 text-sm">
              <button
                onClick={() => window.location.href = '/?donate=one_time'}
                className="px-4 py-2 bg-[#222] hover:bg-[#333] rounded transition-colors"
              >
                donate once
              </button>
              <button
                onClick={() => window.location.href = '/?donate=quarterly'}
                className="px-4 py-2 bg-white text-black hover:bg-[#e5e5e5] rounded transition-colors"
              >
                subscribe
              </button>
            </div>
          </div>
        )}

        {/* Grace Period Warning */}
        {!loadingStorage && storageInfo && storageInfo.inGracePeriod && (
          <div className="mb-8 p-4 bg-red-900/20 border border-red-500/50 rounded">
            <p className="text-sm text-red-400 mb-2">storage grace period active</p>
            <p className="text-xs text-[#a0a0a0] mb-3">
              {storageInfo.gracePeriodDaysRemaining} days remaining to reduce storage or slates will be deleted.
            </p>
            <a href="/slates" className="text-xs text-white hover:underline">manage slates →</a>
          </div>
        )}

        {/* Storage Warning */}
        {!loadingStorage && storageInfo && storageInfo.percentage >= 80 && storageInfo.supporterTier !== 'quarterly' && (
          <div className="mb-8 p-4 bg-[#1a1a1a] border border-[#333] rounded">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-[#666]">storage</span>
              <span className={storageInfo.percentage >= 100 ? 'text-red-400' : 'text-orange-400'}>
                {storageInfo.percentage.toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-[#111] rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full ${storageInfo.percentage >= 100 ? 'bg-red-500' : 'bg-orange-500'}`}
                style={{ width: `${Math.min(storageInfo.percentage, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Collapsible Sections */}
        <div className="space-y-4">
          {/* Password Section - Only for local/both auth */}
          {(authProvider === 'local' || authProvider === 'both') && (
            <div className="border border-[#333] rounded">
              <button
                onClick={() => setShowPasswordSection(!showPasswordSection)}
                className="w-full flex items-center justify-between p-4 text-sm hover:bg-[#1a1a1a] transition-colors"
              >
                <span>change password</span>
                <span className="text-[#666]">{showPasswordSection ? '−' : '+'}</span>
              </button>
              {showPasswordSection && (
                <div className="p-4 border-t border-[#333]">
                  <form onSubmit={handleChangePassword} className="space-y-3">
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="current password"
                      className="w-full bg-[#111] border border-[#333] rounded px-4 py-2 focus:outline-none focus:border-[#666] text-white text-sm"
                      required
                    />
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="new password"
                      className="w-full bg-[#111] border border-[#333] rounded px-4 py-2 focus:outline-none focus:border-[#666] text-white text-sm"
                      required
                    />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="confirm new password"
                      className="w-full bg-[#111] border border-[#333] rounded px-4 py-2 focus:outline-none focus:border-[#666] text-white text-sm"
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
            <div className={`border rounded ${recoveryKeyPending ? 'border-yellow-500/30' : 'border-[#333]'}`}>
              <button
                onClick={() => setShowRecoverySection(!showRecoverySection)}
                className="w-full flex items-center justify-between p-4 text-sm hover:bg-[#1a1a1a] transition-colors"
              >
                <span>{strings.auth.recoveryKey.regenerate.title}</span>
                <span className="text-[#666]">{showRecoverySection ? '−' : '+'}</span>
              </button>
              {showRecoverySection && (
                <div className="p-4 border-t border-[#333]">
                  <p className="text-[#888] text-xs mb-3">{strings.auth.recoveryKey.regenerate.description}</p>
                  <form onSubmit={handleRegenerateRecoveryKey} className="space-y-3">
                    <input
                      type="password"
                      value={recoveryPassword}
                      onChange={(e) => setRecoveryPassword(e.target.value)}
                      placeholder={strings.auth.recoveryKey.regenerate.passwordRequired}
                      className="w-full bg-[#111] border border-[#333] rounded px-4 py-2 focus:outline-none focus:border-[#666] text-white text-sm"
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
                // Tell server user has seen their recovery key
                fetch(`${API_URL}/account/acknowledge-recovery-key`, {
                  method: 'POST',
                  credentials: 'include'
                }).catch(() => {});
              }}
            />
          )}

          {/* Sessions Section */}
          <div className="border border-[#333] rounded">
            <button
              onClick={() => setShowSessions(!showSessions)}
              className="w-full flex items-center justify-between p-4 text-sm hover:bg-[#1a1a1a] transition-colors"
            >
              <span>sessions {!loadingSessions && sessions.length > 0 && `(${sessions.length})`}</span>
              <span className="text-[#666]">{showSessions ? '−' : '+'}</span>
            </button>
            {showSessions && (
              <div className="p-4 border-t border-[#333]">
                {loadingSessions ? (
                  <p className="text-[#666] text-sm">loading...</p>
                ) : (
                  <div className="space-y-3">
                    {sessions.slice(0, 5).map((session, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded text-sm ${
                          session.is_current === 1 ? 'bg-blue-950/20 border border-blue-500/30' : 'bg-[#111]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-white">{session.device || 'unknown device'}</span>
                          {session.is_current === 1 && (
                            <span className="text-blue-400 text-xs">current</span>
                          )}
                        </div>
                        <div className="text-xs text-[#666] mt-1">
                          {formatSessionDate(session.last_activity)}
                          {session.ip_address && ` · ${formatIpAddress(session.ip_address)}`}
                        </div>
                      </div>
                    ))}
                    {sessions.length > 5 && (
                      <p className="text-xs text-[#666]">+ {sessions.length - 5} more sessions</p>
                    )}

                    <div className="pt-3 border-t border-[#333]">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={trackIpAddress}
                          onChange={toggleIpTracking}
                          disabled={togglingIpTracking}
                          className="w-4 h-4 rounded border-[#666] bg-[#111] text-blue-500 focus:ring-0"
                        />
                        <span className="text-[#a0a0a0]">track IP addresses</span>
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

          {/* Danger Zone */}
          <div className="border border-red-900/50 rounded">
            <button
              onClick={() => setShowDangerZone(!showDangerZone)}
              className="w-full flex items-center justify-between p-4 text-sm hover:bg-red-900/10 transition-colors text-red-400"
            >
              <span>danger zone</span>
              <span>{showDangerZone ? '−' : '+'}</span>
            </button>
            {showDangerZone && (
              <div className="p-4 border-t border-red-900/50">
                <p className="text-xs text-[#666] mb-3">
                  permanently delete your account and all data. this cannot be undone.
                </p>
                <button
                  onClick={showDeleteAccountConfirmation}
                  disabled={deleting}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-50 text-sm"
                >
                  {deleting ? 'deleting...' : 'delete account'}
                </button>
              </div>
            )}
          </div>
        </div>

      {/* Email Change Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-6">{strings.account.emailChange.title}</h2>

            {emailStep === 'input' ? (
              <form onSubmit={handleChangeEmail} className="space-y-4">
                <div>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder={strings.account.emailChange.newEmailPlaceholder}
                    className="w-full bg-[#111111] border border-[#333] rounded px-4 py-3 focus:outline-none focus:border-[#666] text-white text-sm"
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
                    className="flex-1 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
                  >
                    {strings.account.emailChange.cancel}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleVerifyEmail} className="space-y-4">
                <p className="text-sm text-[#666]">{strings.account.emailChange.verifyInstructions(newEmail)}</p>
                <div>
                  <input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    placeholder={strings.account.emailChange.codePlaceholder}
                    maxLength={6}
                    className="w-full bg-[#111111] border border-[#333] rounded px-4 py-3 focus:outline-none focus:border-[#666] text-white text-sm text-center tracking-widest"
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
                    className="flex-1 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
                  >
                    {strings.account.emailChange.cancel}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Logout Everywhere Confirmation Modal */}
      {showLogoutEverywhereModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.account.sessions.everywhereModal.title}</h2>
            <p className="text-sm text-[#666] mb-6">
              {strings.account.sessions.everywhereModal.message}
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmLogoutEverywhere}
                className="flex-1 bg-red-600 text-white px-6 py-3 rounded hover:bg-red-700 transition-colors text-sm"
              >
                {strings.account.sessions.everywhereModal.confirm}
              </button>
              <button
                onClick={cancelLogoutEverywhere}
                className="flex-1 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
              >
                {strings.account.sessions.everywhereModal.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Confirmation Modal */}
      {showDeleteAccountModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.account.danger.title}</h2>
            <p className="text-sm text-[#666] mb-4">
              {strings.account.danger.warning}
            </p>
            <p className="text-sm text-[#666] mb-6">
              {strings.account.danger.confirmInstruction(username)}
            </p>
            <div className="space-y-4">
              <input
                type="text"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder={strings.account.danger.confirmPlaceholder(username)}
                className="w-full bg-[#111111] border border-[#333] rounded px-4 py-3 focus:outline-none focus:border-red-400 text-white text-sm"
                autoFocus
              />
              {deleteError && <p className="text-red-400 text-xs md:text-sm">{deleteError}</p>}
              <div className="flex gap-3">
                <button
                  onClick={confirmDeleteAccount}
                  disabled={!deleteConfirmation}
                  className="flex-1 bg-red-600 text-white px-6 py-3 rounded hover:bg-red-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {strings.account.danger.submit}
                </button>
                <button
                  onClick={cancelDeleteAccount}
                  className="flex-1 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
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
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.account.googleAuth.link.modal.title}</h2>
            <p className="text-sm text-[#666] mb-6">
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
                className="flex-1 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
              >
                {strings.account.googleAuth.link.modal.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link Google Success Modal */}
      {showLinkSuccessModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.account.googleAuth.link.success.title}</h2>
            <p className="text-sm text-[#666] mb-6">
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
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.account.googleAuth.link.errors.title}</h2>
            <p className="text-sm text-[#666] mb-6">
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
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.account.googleAuth.unlink.modal.title}</h2>
            <p className="text-sm text-[#666] mb-4">
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
                  className="w-full bg-[#111111] border border-[#333] rounded px-4 py-3 focus:outline-none focus:border-[#666] text-white text-sm text-center tracking-widest"
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
                  className="flex-1 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
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
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">{strings.account.googleAuth.unlink.success.title}</h2>
            <p className="text-sm text-[#666] mb-6">
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
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-sm w-full animate-[modalContentIn_0.15s_ease-out]" onClick={e => e.stopPropagation()}>
            {setPasswordStep === 'pin' ? (
              <>
                <h2 className="text-lg text-white mb-2">{strings.account.googleAuth.setPassword.modal.pinTitle}</h2>
                <p className="text-sm text-[#888] mb-6">{strings.account.googleAuth.setPassword.modal.pinMessage}</p>
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
                      className="w-11 h-14 bg-[#111] border border-[#333] rounded text-center text-2xl text-white focus:border-[#666] focus:outline-none transition-colors"
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
                <h2 className="text-lg text-white mb-2">{strings.account.googleAuth.setPassword.modal.title}</h2>
                <p className="text-sm text-[#888] mb-6">{strings.account.googleAuth.setPassword.modal.message}</p>
                <form onSubmit={handleSetPassword} className="space-y-3">
                  <input
                    type="password"
                    value={setPasswordNew}
                    onChange={e => setSetPasswordNew(e.target.value)}
                    placeholder={strings.account.googleAuth.setPassword.modal.passwordPlaceholder}
                    minLength={6}
                    required
                    autoFocus
                    className="w-full bg-[#111] border border-[#333] px-4 py-2 text-white focus:border-[#666] focus:outline-none transition-colors rounded text-sm"
                  />
                  <input
                    type="password"
                    value={setPasswordConfirm}
                    onChange={e => setSetPasswordConfirm(e.target.value)}
                    placeholder={strings.account.googleAuth.setPassword.modal.confirmPlaceholder}
                    minLength={6}
                    required
                    className="w-full bg-[#111] border border-[#333] px-4 py-2 text-white focus:border-[#666] focus:outline-none transition-colors rounded text-sm"
                  />
                  {newPasswordError && <p className="text-red-400 text-xs">{newPasswordError}</p>}
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => { setShowSetPasswordModal(false); setNewPasswordError(''); setSetPasswordNew(''); setSetPasswordConfirm(''); setSetPasswordStep('pin'); setSetPasswordPin(['','','','','','']); setVerifiedSlateKey(null); }}
                      className="flex-1 border border-[#333] px-4 py-2 rounded hover:bg-[#222] transition-colors text-sm"
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
    </div>
  );
}
