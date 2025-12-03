import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

export function Account({ token, username, email, emailVerified, onLogout, onEmailUpdate }) {
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

  // Modal states
  const [showLogoutAllModal, setShowLogoutAllModal] = useState(false);
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);

  useEffect(() => {
    if (token) {
      loadSessions();
    }
  }, [token]);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const response = await fetch(`${API_URL}/account/sessions`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok) {
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const showLogoutAllConfirmation = () => {
    setShowLogoutAllModal(true);
  };

  const cancelLogoutAll = () => {
    setShowLogoutAllModal(false);
  };

  const confirmLogoutAll = async () => {
    // Close modal immediately
    setShowLogoutAllModal(false);
    setLoggingOutAll(true);

    try {
      const response = await fetch(`${API_URL}/account/logout-all`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        // Immediately logout - don't wait for alert
        onLogout();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to logout from all sessions');
        setLoggingOutAll(false);
      }
    } catch (err) {
      console.error('Failed to logout from all sessions:', err);
      alert('Failed to logout from all sessions');
      setLoggingOutAll(false);
    }
  };

  const formatSessionDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatIpAddress = (ip) => {
    if (!ip) return 'Unknown IP';

    // Clean up IPv6-mapped IPv4 addresses
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }

    // Map localhost variations to friendly name
    if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
      return 'localhost';
    }

    // For other IPs, return as-is
    return ip;
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }

    setChangingPassword(true);

    try {
      const response = await fetch(`${API_URL}/account/change-password`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });

      const data = await response.json();

      if (response.ok) {
        setPasswordSuccess('Password changed successfully');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordError(data.error || 'Failed to change password');
      }
    } catch (err) {
      setPasswordError('Failed to change password');
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
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ newEmail })
      });

      const data = await response.json();

      if (response.ok) {
        setEmailStep('verify');
        setEmailSuccess('Verification code sent to your new email');
      } else {
        setEmailError(data.error || 'Failed to send verification code');
      }
    } catch (err) {
      setEmailError('Failed to send verification code');
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
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code: verificationCode })
      });

      const data = await response.json();

      if (response.ok) {
        onEmailUpdate(newEmail, true);
        setShowEmailModal(false);
        setEmailStep('input');
        setNewEmail('');
        setVerificationCode('');
        alert('Email changed successfully!');
      } else {
        setEmailError(data.error || 'Failed to verify code');
      }
    } catch (err) {
      setEmailError('Failed to verify code');
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
      setDeleteError(`Please type "${username}" to confirm`);
      return;
    }

    // Close modal immediately
    setShowDeleteAccountModal(false);
    setDeleting(true);

    try {
      const response = await fetch(`${API_URL}/account/delete`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (response.ok) {
        onLogout();
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-4 md:p-8">
      <h1 className="text-xl md:text-2xl text-white mb-8">{strings.account.title}</h1>

      {/* Account Info */}
      <div className="mb-8 md:mb-12 bg-[#1a1a1a] border border-[#333] rounded p-4 md:p-6">
        <h2 className="text-base md:text-lg text-white mb-4">{strings.account.info.title}</h2>
        <div className="space-y-3 text-sm">
          <p><span className="text-[#666]">{strings.account.info.username}</span> <span className="text-white">{username}</span></p>
          <div className="flex items-center justify-between">
            <p>
              <span className="text-[#666]">{strings.account.info.email}</span> <span className="text-white">{email}</span>
              {emailVerified ? (
                <span className="ml-2 text-green-400 text-xs">{strings.account.info.verified}</span>
              ) : (
                <span className="ml-2 text-yellow-400 text-xs">{strings.account.info.notVerified}</span>
              )}
            </p>
            <button
              onClick={() => setShowEmailModal(true)}
              className="text-blue-400 hover:text-blue-300 transition-colors text-xs"
            >
              {strings.account.info.change}
            </button>
          </div>
        </div>
      </div>

      {/* Change Password */}
      <div className="mb-8 md:mb-12 bg-[#1a1a1a] border border-[#333] rounded p-4 md:p-6">
        <h2 className="text-base md:text-lg text-white mb-4">{strings.account.password.title}</h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={strings.account.password.currentPlaceholder}
              className="w-full bg-[#111111] border border-[#333] rounded px-4 py-2 md:py-3 focus:outline-none focus:border-[#666] text-white text-sm"
              required
            />
          </div>
          <div>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={strings.account.password.newPlaceholder}
              className="w-full bg-[#111111] border border-[#333] rounded px-4 py-2 md:py-3 focus:outline-none focus:border-[#666] text-white text-sm"
              required
            />
          </div>
          <div>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={strings.account.password.confirmPlaceholder}
              className="w-full bg-[#111111] border border-[#333] rounded px-4 py-2 md:py-3 focus:outline-none focus:border-[#666] text-white text-sm"
              required
            />
          </div>
          {passwordError && <p className="text-red-400 text-xs md:text-sm">{passwordError}</p>}
          {passwordSuccess && <p className="text-green-400 text-xs md:text-sm">{passwordSuccess}</p>}
          <button
            type="submit"
            disabled={changingPassword}
            className="bg-white text-black px-6 py-2 md:py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-50 text-sm"
          >
            {changingPassword ? strings.account.password.submitting : strings.account.password.submit}
          </button>
        </form>
      </div>

      {/* Sessions & Logout */}
      <div className="mb-8 md:mb-12 bg-[#1a1a1a] border border-[#333] rounded p-4 md:p-6">
        <h2 className="text-base md:text-lg text-white mb-4">{strings.account.sessions.title}</h2>

        {loadingSessions ? (
          <p className="text-[#666] text-sm mb-4">{strings.account.sessions.loading}</p>
        ) : (
          <>
            {sessions.length > 0 && (
              <div className="mb-6 space-y-2">
                <p className="text-xs text-[#666] mb-3">{strings.account.sessions.count(sessions.length)}</p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {sessions.map((session, idx) => (
                    <div key={idx} className="bg-[#111111] border border-[#333] rounded p-3 text-xs">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-white">{session.device || strings.account.sessions.unknownDevice}</span>
                        {session.is_current && (
                          <span className="text-green-400 text-xs">{strings.account.sessions.currentBadge}</span>
                        )}
                      </div>
                      <div className="text-[#666] space-y-0.5">
                        <div>{formatIpAddress(session.ip_address)}</div>
                        <div>{strings.account.sessions.lastActive(formatSessionDate(session.last_activity))}</div>
                        <div>{strings.account.sessions.created(formatSessionDate(session.created_at))}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={onLogout}
                className="border border-[#333] text-white px-6 py-2 md:py-3 rounded hover:bg-[#333] transition-colors text-sm"
              >
                {strings.account.sessions.logout}
              </button>
              {sessions.length > 1 && (
                <button
                  onClick={showLogoutAllConfirmation}
                  disabled={loggingOutAll}
                  className="border border-red-600 text-red-400 px-6 py-2 md:py-3 rounded hover:bg-red-900 hover:bg-opacity-20 transition-colors text-sm disabled:opacity-50"
                >
                  {loggingOutAll ? strings.account.sessions.loggingOut : strings.account.sessions.logoutAll}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Delete Account */}
      <div className="bg-[#1a1a1a] border border-red-900 rounded p-4 md:p-6">
        <h2 className="text-base md:text-lg text-red-400 mb-2">{strings.account.danger.title}</h2>
        <p className="text-xs md:text-sm text-[#666] mb-4">{strings.account.danger.warning}</p>
        <button
          onClick={showDeleteAccountConfirmation}
          disabled={deleting}
          className="bg-red-600 text-white px-6 py-2 md:py-3 rounded hover:bg-red-700 transition-colors disabled:opacity-50 text-sm"
        >
          {deleting ? strings.account.danger.submitting : strings.account.danger.submit}
        </button>
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

      {/* Logout All Sessions Confirmation Modal */}
      {showLogoutAllModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
            <h2 className="text-lg md:text-xl text-white mb-4">logout from all devices?</h2>
            <p className="text-sm text-[#666] mb-6">
              you will need to login again on all devices, including this one.
            </p>
            <div className="flex gap-3">
              <button
                onClick={confirmLogoutAll}
                className="flex-1 bg-red-600 text-white px-6 py-3 rounded hover:bg-red-700 transition-colors text-sm"
              >
                logout all
              </button>
              <button
                onClick={cancelLogoutAll}
                className="flex-1 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
              >
                cancel
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
              type <span className="text-white font-semibold">{username}</span> to confirm:
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
                  cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
