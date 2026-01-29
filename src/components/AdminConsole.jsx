import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

// Helper function to mask email addresses
function maskEmail(email) {
  if (!email) return '-';
  const [local, domain] = email.split('@');
  if (!domain) return email;

  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }

  return `${local[0]}${'*'.repeat(Math.min(local.length - 1, 3))}@${domain}`;
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Modal Component
function AdminModal({ isOpen, onClose, title, children, confirmText, cancelText, onConfirm, confirmDanger, confirmDisabled }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1a1a1a] border border-[#333] rounded p-6 md:p-8 max-w-md w-full">
        {title && <h2 className="text-lg md:text-xl text-white mb-4">{title}</h2>}
        <div className="mb-6">
          {children}
        </div>
        <div className="flex gap-3">
          {onConfirm && (
            <button
              onClick={onConfirm}
              disabled={confirmDisabled}
              className={`flex-1 px-6 py-3 rounded transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                confirmDanger
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-white text-black hover:bg-[#e5e5e5]'
              }`}
            >
              {confirmText || 'confirm'}
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 border border-[#333] text-white px-6 py-3 rounded hover:bg-[#333] transition-colors text-sm"
          >
            {cancelText || 'cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminConsole() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [adminToken, setAdminToken] = useState(localStorage.getItem('admin-token'));

  // Tab state - get initial tab from URL
  const getInitialTab = () => {
    const path = window.location.pathname;
    const match = path.match(/\/holyfuckwhereami\/(overview|users|logs|health|sentry|announcements|feedback)/);
    return match ? match[1] : 'overview';
  };
  const [activeTab, setActiveTab] = useState(getInitialTab());

  // Data state
  const [users, setUsers] = useState([]);
  const [usersPagination, setUsersPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [b2Stats, setB2Stats] = useState(null);
  const [healthMetrics, setHealthMetrics] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);
  const [logStats, setLogStats] = useState(null);
  const [logsPagination, setLogsPagination] = useState({ page: 1 });
  const [errorLogs, setErrorLogs] = useState('');
  const [stripeData, setStripeData] = useState(null);

  // Notification state
  const [adminNotifications, setAdminNotifications] = useState([]);
  const [newNotification, setNewNotification] = useState({ title: '', message: '', link: '', type: 'global', filter_min_slates: '', filter_max_slates: '', filter_plan: '', filter_verified_only: false, filter_min_views: '', filter_user_ids: '' });
  const [previewCount, setPreviewCount] = useState(null);
  const [showFilters, setShowFilters] = useState(false);

  // Automation state
  const [automations, setAutomations] = useState([]);
  const [newAutomation, setNewAutomation] = useState({ event_type: 'slate_views', threshold: '', title: '', message: '', link: '' });
  const [showAutomations, setShowAutomations] = useState(false);

  // Feedback state
  const [feedbackList, setFeedbackList] = useState([]);

  // Search state
  const [userSearch, setUserSearch] = useState('');
  const [stripeSearch, setStripeSearch] = useState('');

  // Modal state
  const [modal, setModal] = useState({ isOpen: false, type: null, data: null });
  const [modalInput, setModalInput] = useState('');

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (adminToken) {
      setIsAuthenticated(true);
      loadTabData(activeTab);

      // Auto-refresh B2 stats every 30 seconds when on overview tab
      if (activeTab === 'overview') {
        const interval = setInterval(() => {
          fetchB2Stats();
          fetchHealthMetrics();
        }, 30000);
        return () => clearInterval(interval);
      }
    }
  }, [adminToken, activeTab]);

  const loadTabData = (tab) => {
    // Update URL when tab changes
    window.history.pushState({}, '', `/holyfuckwhereami/${tab}`);

    switch (tab) {
      case 'overview':
        fetchB2Stats();
        fetchHealthMetrics();
        break;
      case 'users':
        fetchUsers(1);
        break;
      case 'stripe':
        fetchStripeData();
        break;
      case 'logs':
        fetchActivityLogs(1);
        break;
      case 'health':
        fetchHealthMetrics();
        break;
      case 'sentry':
        fetchErrorLogs();
        break;
      case 'announcements':
        fetchAdminNotifications();
        fetchAutomations();
        break;
      case 'feedback':
        fetchFeedback();
        break;
    }
  };

  const fetchAdminNotifications = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/notifications`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (response.ok) {
        setAdminNotifications(data.notifications || []);
      }
    } catch (err) {
      setError('failed to fetch notifications');
    } finally {
      setLoading(false);
    }
  };

  const previewEligible = async (filters) => {
    try {
      const cleaned = {
        filter_min_slates: filters.filter_min_slates ? parseInt(filters.filter_min_slates) : null,
        filter_max_slates: filters.filter_max_slates ? parseInt(filters.filter_max_slates) : null,
        filter_min_views: filters.filter_min_views ? parseInt(filters.filter_min_views) : null,
        filter_plan: filters.filter_plan || null,
        filter_verified_only: filters.filter_verified_only || false,
        filter_user_ids: filters.filter_user_ids || null
      };
      const response = await fetch(`${API_URL}/admin/notifications/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify(cleaned)
      });
      const data = await response.json();
      if (response.ok) {
        setPreviewCount(data);
      }
    } catch (err) {
      // silent
    }
  };

  const createNotification = async (e) => {
    e.preventDefault();
    if (!newNotification.title || !newNotification.message) return;
    const payload = {
      ...newNotification,
      filter_min_slates: newNotification.filter_min_slates ? parseInt(newNotification.filter_min_slates) : null,
      filter_max_slates: newNotification.filter_max_slates ? parseInt(newNotification.filter_max_slates) : null,
      filter_min_views: newNotification.filter_min_views ? parseInt(newNotification.filter_min_views) : null,
      filter_verified_only: newNotification.filter_verified_only || false,
      filter_plan: newNotification.filter_plan || null,
      filter_user_ids: newNotification.filter_user_ids || null
    };
    try {
      const response = await fetch(`${API_URL}/admin/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        setNewNotification({ title: '', message: '', link: '', type: 'global', filter_min_slates: '', filter_max_slates: '', filter_plan: '', filter_verified_only: false, filter_min_views: '', filter_user_ids: '' });
        setPreviewCount(null);
        setShowFilters(false);
        fetchAdminNotifications();
      }
    } catch (err) {
      setError('failed to create notification');
    }
  };

  const deleteNotification = async (id) => {
    try {
      await fetch(`${API_URL}/admin/notifications/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      fetchAdminNotifications();
    } catch (err) {
      setError('failed to delete notification');
    }
  };

  const fetchAutomations = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/automations`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (response.ok) {
        setAutomations(data.automations || []);
      }
    } catch (err) {
      setError('failed to fetch automations');
    }
  };

  const createAutomation = async (e) => {
    e.preventDefault();
    const threshold = newAutomation.event_type === 'on_signup' ? 1 : newAutomation.threshold;
    if (!newAutomation.event_type || !threshold || !newAutomation.title || !newAutomation.message) return;
    try {
      const response = await fetch(`${API_URL}/admin/automations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ ...newAutomation, threshold: parseInt(threshold) })
      });
      if (response.ok) {
        setNewAutomation({ event_type: 'slate_views', threshold: '', title: '', message: '', link: '' });
        fetchAutomations();
      }
    } catch (err) {
      setError('failed to create automation');
    }
  };

  const toggleAutomation = async (id, enabled) => {
    try {
      await fetch(`${API_URL}/admin/automations/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ enabled: !enabled })
      });
      fetchAutomations();
    } catch (err) {
      setError('failed to toggle automation');
    }
  };

  const deleteAutomation = async (id) => {
    try {
      await fetch(`${API_URL}/admin/automations/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      fetchAutomations();
    } catch (err) {
      setError('failed to delete automation');
    }
  };

  const fetchFeedback = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/feedback`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (response.ok) {
        setFeedbackList(data.feedback || []);
      }
    } catch (err) {
      setError('failed to fetch feedback');
    } finally {
      setLoading(false);
    }
  };

  const deleteFeedback = async (id) => {
    try {
      await fetch(`${API_URL}/admin/feedback/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      fetchFeedback();
    } catch (err) {
      setError('failed to delete feedback');
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/admin/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const data = await response.json();

      if (response.ok) {
        setAdminToken(data.token);
        localStorage.setItem('admin-token', data.token);
        setIsAuthenticated(true);
        setPassword('');
      } else {
        setError(data.error || strings.admin.login.errors.authFailed);
      }
    } catch (err) {
      setError(strings.admin.login.errors.failed);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async (page = 1) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/users?page=${page}&limit=50`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      const data = await response.json();

      if (response.ok) {
        setUsers(data.users);
        setUsersPagination(data.pagination);
      } else {
        setError(data.error || strings.admin.dashboard.users.errors.fetchFailed);
        if (response.status === 403) {
          setIsAuthenticated(false);
          localStorage.removeItem('admin-token');
        }
      }
    } catch (err) {
      setError(strings.admin.dashboard.users.errors.fetchFailed);
    } finally {
      setLoading(false);
    }
  };

  const fetchB2Stats = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/b2-stats`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      const data = await response.json();

      if (response.ok) {
        setB2Stats(data);
      } else {
        if (response.status === 403) {
          setIsAuthenticated(false);
          localStorage.removeItem('admin-token');
        }
      }
    } catch (err) {
      console.error('Failed to fetch B2 stats:', err);
    }
  };

  const fetchHealthMetrics = async () => {
    try {
      const response = await fetch(`${API_URL}/admin/health`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      const data = await response.json();

      if (response.ok) {
        setHealthMetrics(data);
      }
    } catch (err) {
      console.error('Failed to fetch health metrics:', err);
    }
  };

  const fetchActivityLogs = async (page = 1) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/logs?page=${page}&limit=50`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      const data = await response.json();

      if (response.ok) {
        setActivityLogs(data.logs);
        setLogStats(data.stats);
        setLogsPagination(data.pagination);
      }
    } catch (err) {
      console.error('Failed to fetch activity logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchErrorLogs = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/error-logs`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      const data = await response.json();

      if (response.ok) {
        setErrorLogs(data.logs);
      }
    } catch (err) {
      console.error('Failed to fetch error logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStripeData = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/stripe-subscriptions`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      const data = await response.json();

      if (response.ok) {
        setStripeData(data);
      } else {
        setError(data.error || 'failed to fetch stripe data');
      }
    } catch (err) {
      console.error('Failed to fetch stripe data:', err);
      setError('failed to fetch stripe data');
    } finally {
      setLoading(false);
    }
  };

  const handleStripeAction = async (action, userId = null, planData = null) => {
    try {
      const body = { action, userId };
      if (planData) {
        body.plan = planData;
      }

      const response = await fetch(`${API_URL}/admin/stripe-action`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (response.ok) {
        setModal({
          isOpen: true,
          type: 'success',
          data: { message: data.message || 'action completed successfully' }
        });
        fetchStripeData(); // Refresh data
      } else {
        setModal({
          isOpen: true,
          type: 'error',
          data: { message: data.error || 'action failed' }
        });
      }
    } catch (err) {
      setModal({
        isOpen: true,
        type: 'error',
        data: { message: 'action failed' }
      });
    }
  };

  const openModal = (type, data) => {
    setModal({ isOpen: true, type, data });
    setModalInput('');
  };

  const closeModal = () => {
    setModal({ isOpen: false, type: null, data: null });
    setModalInput('');
  };

  const handleDeleteUser = (userId, username) => {
    openModal('deleteUser', { userId, username });
  };

  const confirmDeleteUser = async () => {
    const { userId, username } = modal.data;
    closeModal();

    try {
      const response = await fetch(`${API_URL}/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      const data = await response.json();

      if (response.ok) {
        openModal('success', { message: strings.admin.dashboard.users.deleteSuccess(username) });
        fetchUsers(usersPagination.page);
      } else {
        openModal('error', { message: data.error || strings.admin.dashboard.users.errors.deleteFailed });
      }
    } catch (err) {
      openModal('error', { message: strings.admin.dashboard.users.errors.deleteFailed });
    }
  };

  const handleChangePlan = (userId, username, currentPlan) => {
    openModal('changePlan', { userId, username, currentPlan });
    setModalInput(currentPlan || 'free');
  };

  const confirmChangePlan = async () => {
    const { userId, username } = modal.data;
    const newPlan = modalInput.toLowerCase();

    if (!['free', 'one_time', 'quarterly'].includes(newPlan)) {
      openModal('error', { message: 'invalid plan. must be: free, one_time, or quarterly' });
      return;
    }

    closeModal();

    try {
      const response = await fetch(`${API_URL}/admin/users/${userId}/plan`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ plan: newPlan })
      });

      const data = await response.json();

      if (response.ok) {
        openModal('success', { message: `plan updated successfully for ${username}` });
        fetchUsers(usersPagination.page);
      } else {
        openModal('error', { message: data.error || 'failed to update plan' });
      }
    } catch (err) {
      openModal('error', { message: 'failed to update plan' });
    }
  };

  // Stripe-specific modal handlers
  const confirmStripeAction = async (action, userId = null) => {
    closeModal();
    await handleStripeAction(action, userId);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setAdminToken(null);
    localStorage.removeItem('admin-token');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#111111] text-[#a0a0a0] font-mono flex items-center justify-center">
        <div className="w-full max-w-md p-8">
          <h1 className="text-2xl text-white mb-8">{strings.admin.login.title}</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={strings.admin.login.tokenPlaceholder}
                className="w-full bg-[#1a1a1a] border border-[#333] rounded px-4 py-3 focus:outline-none focus:border-[#666] text-white"
                required
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black px-4 py-3 rounded hover:bg-[#e5e5e5] transition-colors disabled:opacity-50"
            >
              {strings.admin.login.submit}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111111] text-[#a0a0a0] font-mono">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 md:mb-8">
          <h1 className="text-xl md:text-2xl text-white">{strings.admin.dashboard.title}</h1>
          <button
            onClick={handleLogout}
            className="text-xs md:text-sm hover:text-white transition-colors"
          >
            {strings.admin.dashboard.logout}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-6 border-b border-[#333] overflow-x-auto">
          {['overview', 'users', 'stripe', 'logs', 'health', 'sentry', 'announcements', 'feedback'].map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                loadTabData(tab);
              }}
              className={`pb-3 px-2 text-sm transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'text-white border-b-2 border-white'
                  : 'text-[#666] hover:text-[#a0a0a0]'
              }`}
            >
              {strings.admin.dashboard.tabs[tab] || (tab === 'sentry' ? 'Sentry' : tab)}
            </button>
          ))}
        </div>

        {error && <p className="text-red-400 text-xs md:text-sm mb-4">{error}</p>}

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <OverviewTab b2Stats={b2Stats} healthMetrics={healthMetrics} />
        )}

        {activeTab === 'users' && (
          <UsersTab
            users={users}
            pagination={usersPagination}
            loading={loading}
            onPageChange={fetchUsers}
            onDeleteUser={handleDeleteUser}
            onChangePlan={handleChangePlan}
            searchQuery={userSearch}
            onSearchChange={setUserSearch}
          />
        )}

        {activeTab === 'stripe' && (
          <StripeTab
            stripeData={stripeData}
            loading={loading}
            onAction={handleStripeAction}
            onRefresh={fetchStripeData}
            searchQuery={stripeSearch}
            onSearchChange={setStripeSearch}
            onChangePlan={handleChangePlan}
            openModal={openModal}
          />
        )}

        {activeTab === 'logs' && (
          <LogsTab
            logs={activityLogs}
            stats={logStats}
            pagination={logsPagination}
            loading={loading}
            onPageChange={fetchActivityLogs}
          />
        )}

        {activeTab === 'health' && (
          <HealthTab healthMetrics={healthMetrics} b2Stats={b2Stats} />
        )}

        {activeTab === 'sentry' && (
          <SentryTab errorLogs={errorLogs} loading={loading} onRefresh={fetchErrorLogs} />
        )}

        {activeTab === 'announcements' && (
          <div>
            {/* Create notification form */}
            <form onSubmit={createNotification} className="mb-6 space-y-3">
              <div className="flex gap-2">
                <select
                  value={newNotification.type}
                  onChange={e => {
                    const type = e.target.value;
                    setNewNotification(prev => ({ ...prev, type }));
                    setShowFilters(type === 'targeted');
                  }}
                  className="bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white"
                >
                  <option value="global">global</option>
                  <option value="targeted">targeted</option>
                </select>
                <input
                  type="text"
                  value={newNotification.title}
                  onChange={e => setNewNotification(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="title"
                  className="flex-1 bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white placeholder-[#555]"
                />
              </div>
              <textarea
                value={newNotification.message}
                onChange={e => setNewNotification(prev => ({ ...prev, message: e.target.value }))}
                placeholder="message"
                rows={2}
                className="w-full bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white placeholder-[#555] resize-none"
              />
              <input
                type="text"
                value={newNotification.link}
                onChange={e => setNewNotification(prev => ({ ...prev, link: e.target.value }))}
                placeholder="link (optional, e.g. /account or https://...)"
                className="w-full bg-[#111] border border-[#333] rounded px-3 py-2 text-sm text-white placeholder-[#555]"
              />

              {/* Targeting filters */}
              {showFilters && (
                <div className="border border-[#333] rounded p-3 space-y-2 bg-[#0a0a0a]">
                  <p className="text-xs text-[#666] mb-2">filters (leave blank for no filter)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={newNotification.filter_min_slates}
                      onChange={e => setNewNotification(prev => ({ ...prev, filter_min_slates: e.target.value }))}
                      placeholder="min slates"
                      className="bg-[#111] border border-[#333] rounded px-3 py-1.5 text-xs text-white placeholder-[#555]"
                    />
                    <input
                      type="number"
                      value={newNotification.filter_max_slates}
                      onChange={e => setNewNotification(prev => ({ ...prev, filter_max_slates: e.target.value }))}
                      placeholder="max slates"
                      className="bg-[#111] border border-[#333] rounded px-3 py-1.5 text-xs text-white placeholder-[#555]"
                    />
                    <select
                      value={newNotification.filter_plan}
                      onChange={e => setNewNotification(prev => ({ ...prev, filter_plan: e.target.value }))}
                      className="bg-[#111] border border-[#333] rounded px-3 py-1.5 text-xs text-white"
                    >
                      <option value="">any plan</option>
                      <option value="free">free</option>
                      <option value="one_time">one-time supporter</option>
                      <option value="quarterly">quarterly supporter</option>
                    </select>
                    <input
                      type="number"
                      value={newNotification.filter_min_views}
                      onChange={e => setNewNotification(prev => ({ ...prev, filter_min_views: e.target.value }))}
                      placeholder="min slate views"
                      className="bg-[#111] border border-[#333] rounded px-3 py-1.5 text-xs text-white placeholder-[#555]"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-[#888]">
                    <input
                      type="checkbox"
                      checked={newNotification.filter_verified_only}
                      onChange={e => setNewNotification(prev => ({ ...prev, filter_verified_only: e.target.checked }))}
                      className="rounded"
                    />
                    verified email only
                  </label>
                  <input
                    type="text"
                    value={newNotification.filter_user_ids}
                    onChange={e => setNewNotification(prev => ({ ...prev, filter_user_ids: e.target.value }))}
                    placeholder="specific user IDs (comma-separated)"
                    className="w-full bg-[#111] border border-[#333] rounded px-3 py-1.5 text-xs text-white placeholder-[#555]"
                  />
                  <button
                    type="button"
                    onClick={() => previewEligible(newNotification)}
                    className="text-xs text-[#888] hover:text-white transition-colors"
                  >
                    preview reach →
                  </button>
                  {previewCount && (
                    <p className="text-xs text-green-400">{previewCount.eligible} / {previewCount.total} users eligible</p>
                  )}
                </div>
              )}

              <button
                type="submit"
                className="bg-white text-black px-4 py-2 rounded text-sm hover:bg-[#e5e5e5] transition-colors"
              >
                send notification
              </button>
            </form>

            {/* Notification list */}
            <h3 className="text-sm text-[#888] mb-3">sent notifications</h3>
            {loading ? (
              <p className="text-[#666] text-sm">loading...</p>
            ) : adminNotifications.length === 0 ? (
              <p className="text-[#666] text-sm">no notifications yet</p>
            ) : (
              <div className="space-y-3 mb-8">
                {adminNotifications.map(n => (
                  <div key={n.id} className="bg-[#111] border border-[#333] rounded p-4 flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-white text-sm font-medium">{n.title}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${n.type === 'global' ? 'bg-blue-900/50 text-blue-400' : n.type === 'automated' ? 'bg-purple-900/50 text-purple-400' : 'bg-orange-900/50 text-orange-400'}`}>
                          {n.type}
                        </span>
                      </div>
                      <p className="text-[#888] text-xs mt-1">{n.message}</p>
                      {n.link && <p className="text-[#555] text-xs mt-1">→ {n.link}</p>}
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[#555] text-xs">{new Date(n.created_at).toLocaleString()}</span>
                        <span className="text-xs text-green-400">{n.read_count} / {n.total_eligible} read ({n.read_percentage}%)</span>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteNotification(n.id)}
                      className="text-red-400 hover:text-red-300 text-xs ml-4 flex-shrink-0"
                    >
                      delete
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Automations section */}
            <div className="border-t border-[#333] pt-6">
              <button
                onClick={() => setShowAutomations(!showAutomations)}
                className="text-sm text-[#888] hover:text-white transition-colors mb-4"
              >
                {showAutomations ? '▼' : '▶'} automations ({automations.length})
              </button>

              {showAutomations && (
                <div>
                  <form onSubmit={createAutomation} className="mb-4 space-y-2">
                    <div className="flex gap-2">
                      <select
                        value={newAutomation.event_type}
                        onChange={e => setNewAutomation(prev => ({ ...prev, event_type: e.target.value }))}
                        className="bg-[#111] border border-[#333] rounded px-3 py-2 text-xs text-white"
                      >
                        <option value="on_signup">on signup</option>
                        <option value="slate_views">slate reaches X views</option>
                        <option value="slate_count">user creates X slates</option>
                        <option value="published_count">user publishes X slates</option>
                        <option value="account_age_days">account turns X days old</option>
                      </select>
                      {newAutomation.event_type !== 'on_signup' && (
                        <input
                          type="number"
                          value={newAutomation.threshold}
                          onChange={e => setNewAutomation(prev => ({ ...prev, threshold: e.target.value }))}
                          placeholder="threshold"
                          className="w-24 bg-[#111] border border-[#333] rounded px-3 py-2 text-xs text-white placeholder-[#555]"
                        />
                      )}
                    </div>
                    <input
                      type="text"
                      value={newAutomation.title}
                      onChange={e => setNewAutomation(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="title — use {username}, {slate_title}, {view_count}, {slate_count}"
                      className="w-full bg-[#111] border border-[#333] rounded px-3 py-1.5 text-xs text-white placeholder-[#555]"
                    />
                    <input
                      type="text"
                      value={newAutomation.message}
                      onChange={e => setNewAutomation(prev => ({ ...prev, message: e.target.value }))}
                      placeholder="message — use {username}, {slate_title}, {view_count}, {slate_count}"
                      className="w-full bg-[#111] border border-[#333] rounded px-3 py-1.5 text-xs text-white placeholder-[#555]"
                    />
                    <input
                      type="text"
                      value={newAutomation.link}
                      onChange={e => setNewAutomation(prev => ({ ...prev, link: e.target.value }))}
                      placeholder="link (optional)"
                      className="w-full bg-[#111] border border-[#333] rounded px-3 py-1.5 text-xs text-white placeholder-[#555]"
                    />
                    <button
                      type="submit"
                      className="bg-white text-black px-3 py-1.5 rounded text-xs hover:bg-[#e5e5e5] transition-colors"
                    >
                      create automation
                    </button>
                  </form>

                  {automations.length === 0 ? (
                    <p className="text-[#666] text-xs">no automations</p>
                  ) : (
                    <div className="space-y-2">
                      {automations.map(a => (
                        <div key={a.id} className="bg-[#111] border border-[#333] rounded p-3 flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-white text-xs font-medium">{a.title}</p>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${a.enabled ? 'bg-green-900/50 text-green-400' : 'bg-[#333] text-[#666]'}`}>
                                {a.enabled ? 'active' : 'paused'}
                              </span>
                            </div>
                            <p className="text-[#888] text-xs mt-1">{a.message}</p>
                            <p className="text-[#555] text-xs mt-1">
                              {a.event_type} ≥ {a.threshold} · fired {a.times_fired || 0} times
                            </p>
                          </div>
                          <div className="flex gap-2 ml-4 flex-shrink-0">
                            <button
                              onClick={() => toggleAutomation(a.id, a.enabled)}
                              className="text-xs text-[#888] hover:text-white transition-colors"
                            >
                              {a.enabled ? 'pause' : 'enable'}
                            </button>
                            <button
                              onClick={() => deleteAutomation(a.id)}
                              className="text-red-400 hover:text-red-300 text-xs"
                            >
                              delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {activeTab === 'feedback' && (
          <div>
            {loading ? (
              <p className="text-[#666] text-sm">loading...</p>
            ) : feedbackList.length === 0 ? (
              <p className="text-[#666] text-sm">no feedback yet</p>
            ) : (
              <div className="space-y-3">
                {feedbackList.map(f => (
                  <div key={f.id} className="bg-[#111] border border-[#333] rounded p-4 flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white text-sm font-medium">{f.username || 'unknown'}</span>
                        {f.contact_email && (
                          <a href={`mailto:${f.contact_email}`} className="text-xs text-blue-400 hover:text-blue-300">
                            {f.contact_email}
                          </a>
                        )}
                      </div>
                      <p className="text-[#888] text-sm whitespace-pre-wrap">{f.message}</p>
                      <p className="text-[#555] text-xs mt-2">{new Date(f.created_at).toLocaleString()}</p>
                    </div>
                    <button
                      onClick={() => deleteFeedback(f.id)}
                      className="text-red-400 hover:text-red-300 text-xs ml-4 flex-shrink-0"
                    >
                      delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {modal.type === 'deleteUser' && modal.data && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title="delete user?"
          confirmText="delete"
          cancelText="cancel"
          onConfirm={confirmDeleteUser}
          confirmDanger={true}
        >
          <p className="text-[#a0a0a0] text-sm">
            are you sure you want to delete <span className="text-white">{modal.data.username}</span>? this will permanently delete their account and all their slates. this cannot be undone!
          </p>
        </AdminModal>
      )}

      {modal.type === 'changePlan' && modal.data && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title={`change plan for ${modal.data.username}`}
          confirmText="update plan"
          cancelText="cancel"
          onConfirm={confirmChangePlan}
        >
          <div className="space-y-3">
            <p className="text-[#666] text-xs">
              current: <span className="text-white">{modal.data.currentPlan || 'free'}</span>
            </p>
            <select
              value={modalInput}
              onChange={(e) => setModalInput(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#333] rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#666]"
            >
              <option value="free">free</option>
              <option value="one_time">one_time (⭐)</option>
              <option value="quarterly">quarterly (❤️)</option>
            </select>
          </div>
        </AdminModal>
      )}

      {modal.type === 'success' && modal.data && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title="success"
          cancelText="okay"
        >
          <p className="text-green-400 text-sm">{modal.data.message}</p>
        </AdminModal>
      )}

      {modal.type === 'error' && modal.data && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title="error"
          cancelText="okay"
        >
          <p className="text-red-400 text-sm">{modal.data.message}</p>
        </AdminModal>
      )}

      {/* Stripe Tab Modals */}
      {modal.type === 'cleanTestData' && modal.data && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title="clean test data?"
          confirmText="clean"
          cancelText="cancel"
          onConfirm={() => confirmStripeAction('clean-test-data')}
        >
          <p className="text-[#a0a0a0] text-sm">
            remove test IDs from <span className="text-white">{modal.data.count}</span> users? this will NOT affect their supporter status.
          </p>
        </AdminModal>
      )}

      {modal.type === 'fixMismatches' && modal.data && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title="fix mismatches?"
          confirmText="fix"
          cancelText="cancel"
          onConfirm={() => confirmStripeAction('fix-mismatches')}
        >
          <p className="text-[#a0a0a0] text-sm">
            fix <span className="text-white">{modal.data.count}</span> mismatches? this will sync database with stripe.
          </p>
        </AdminModal>
      )}

      {modal.type === 'clearTestData' && modal.data && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title="clear test data?"
          confirmText="clear"
          cancelText="cancel"
          onConfirm={() => confirmStripeAction('clear-test-data', modal.data.userId)}
        >
          <p className="text-[#a0a0a0] text-sm">
            clear test data for <span className="text-white">{modal.data.username}</span>?
          </p>
        </AdminModal>
      )}

      {modal.type === 'clearCancellation' && modal.data && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title="clear cancellation date?"
          confirmText="clear"
          cancelText="cancel"
          onConfirm={() => confirmStripeAction('clear-cancellation', modal.data.userId)}
        >
          <p className="text-[#a0a0a0] text-sm">
            clear cancellation date for <span className="text-white">{modal.data.username}</span>? this will restore their subscription to active.
          </p>
        </AdminModal>
      )}

      {modal.type === 'cancelImmediately' && modal.data && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title="cancel subscription immediately?"
          confirmText="cancel subscription"
          cancelText="go back"
          onConfirm={() => confirmStripeAction('cancel-immediately', modal.data.userId)}
          confirmDanger={true}
        >
          <p className="text-[#a0a0a0] text-sm">
            cancel subscription for <span className="text-white">{modal.data.username}</span> immediately? they will lose access right away and revert to free tier.
          </p>
        </AdminModal>
      )}

      {modal.type === 'clearAllCancellations' && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title="clear all cancellation dates?"
          confirmText="clear all"
          cancelText="cancel"
          onConfirm={() => confirmStripeAction('clear-all-cancellations')}
        >
          <p className="text-[#a0a0a0] text-sm">
            clear ALL cancellation dates? this will restore all pending cancellations to active.
          </p>
        </AdminModal>
      )}

      {modal.type === 'cleanAllTestData' && (
        <AdminModal
          isOpen={modal.isOpen}
          onClose={closeModal}
          title="clean all test data?"
          confirmText="clean all"
          cancelText="cancel"
          onConfirm={() => confirmStripeAction('clean-all-test-data')}
        >
          <p className="text-[#a0a0a0] text-sm">
            remove ALL test stripe IDs? this will NOT affect supporter status.
          </p>
        </AdminModal>
      )}
    </div>
  );
}

// Overview Tab Component
function OverviewTab({ b2Stats, healthMetrics }) {
  return (
    <div className="space-y-6">
      {/* B2 Usage Stats */}
      {b2Stats && (
        <div>
          <h2 className="text-sm text-white mb-4">{strings.admin.dashboard.overview.b2Title}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <h3 className="text-xs text-[#666] mb-2">{strings.admin.dashboard.overview.classB}</h3>
              <p className="text-2xl text-white mb-1">{b2Stats.classB.toLocaleString()}</p>
              <div className="w-full bg-[#333] h-2 rounded overflow-hidden mb-1">
                <div
                  className={`h-full ${
                    parseFloat(b2Stats.percentages.classB.percent) > 80
                      ? 'bg-red-500'
                      : parseFloat(b2Stats.percentages.classB.percent) > 50
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, b2Stats.percentages.classB.percent)}%` }}
                ></div>
              </div>
              <p className="text-xs text-[#666]">
                {strings.admin.dashboard.overview.dailyCap(b2Stats.percentages.classB.percent, b2Stats.percentages.classB.limit.toLocaleString())}
              </p>
            </div>

            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <h3 className="text-xs text-[#666] mb-2">{strings.admin.dashboard.overview.classC}</h3>
              <p className="text-2xl text-white mb-1">{b2Stats.classC.toLocaleString()}</p>
              <div className="w-full bg-[#333] h-2 rounded overflow-hidden mb-1">
                <div
                  className={`h-full ${
                    parseFloat(b2Stats.percentages.classC.percent) > 80
                      ? 'bg-red-500'
                      : parseFloat(b2Stats.percentages.classC.percent) > 50
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, b2Stats.percentages.classC.percent)}%` }}
                ></div>
              </div>
              <p className="text-xs text-[#666]">
                {strings.admin.dashboard.overview.dailyCap(b2Stats.percentages.classC.percent, b2Stats.percentages.classC.limit.toLocaleString())}
              </p>
            </div>

            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <h3 className="text-xs text-[#666] mb-2">{strings.admin.dashboard.overview.bandwidth}</h3>
              <p className="text-2xl text-white mb-1">{b2Stats.percentages.bandwidth.usedMB} MB</p>
              <div className="w-full bg-[#333] h-2 rounded overflow-hidden mb-1">
                <div
                  className={`h-full ${
                    parseFloat(b2Stats.percentages.bandwidth.percent) > 80
                      ? 'bg-red-500'
                      : parseFloat(b2Stats.percentages.bandwidth.percent) > 50
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, b2Stats.percentages.bandwidth.percent)}%` }}
                ></div>
              </div>
              <p className="text-xs text-[#666]">
                {strings.admin.dashboard.overview.dailyCap(b2Stats.percentages.bandwidth.percent, `${b2Stats.percentages.bandwidth.limitGB} GB`)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      {healthMetrics && (
        <div>
          <h2 className="text-sm text-white mb-4">{strings.admin.dashboard.overview.quickStats}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <p className="text-xs text-[#666] mb-1">{strings.admin.dashboard.overview.totalUsers}</p>
              <p className="text-2xl text-white">{healthMetrics.database.users.toLocaleString()}</p>
              {healthMetrics.growth.newUsers24h > 0 && (
                <p className="text-xs text-green-400 mt-1">{strings.admin.dashboard.overview.todayGrowth(healthMetrics.growth.newUsers24h)}</p>
              )}
            </div>

            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <p className="text-xs text-[#666] mb-1">{strings.admin.dashboard.overview.totalSlates}</p>
              <p className="text-2xl text-white">{healthMetrics.database.slates.toLocaleString()}</p>
              {healthMetrics.growth.newSlates24h > 0 && (
                <p className="text-xs text-green-400 mt-1">{strings.admin.dashboard.overview.todayGrowth(healthMetrics.growth.newSlates24h)}</p>
              )}
            </div>

            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <p className="text-xs text-[#666] mb-1">{strings.admin.dashboard.overview.published}</p>
              <p className="text-2xl text-white">{healthMetrics.database.published.toLocaleString()}</p>
            </div>

            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <p className="text-xs text-[#666] mb-1">{strings.admin.dashboard.overview.storageUsed}</p>
              <p className="text-2xl text-white">{healthMetrics.database.totalStorageGB} GB</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Users Tab Component
function UsersTab({ users, pagination, loading, onPageChange, onDeleteUser, onChangePlan, searchQuery, onSearchChange }) {
  const [revealedEmails, setRevealedEmails] = useState({});
  const clickCountRef = React.useRef({});
  const clickTimerRef = React.useRef({});

  const handleEmailClick = (userId) => {
    const now = Date.now();
    const prev = clickCountRef.current[userId];

    if (prev && now - prev.time < 400) {
      prev.count += 1;
      prev.time = now;
    } else {
      clickCountRef.current[userId] = { count: 1, time: now };
    }

    clearTimeout(clickTimerRef.current[userId]);
    clickTimerRef.current[userId] = setTimeout(() => {
      if (clickCountRef.current[userId]?.count >= 3) {
        setRevealedEmails(prev => ({ ...prev, [userId]: !prev[userId] }));
      }
      clickCountRef.current[userId] = null;
    }, 400);
  };

  // Filter users based on search query
  const filteredUsers = users.filter(user => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.username.toLowerCase().includes(query) ||
      user.email?.toLowerCase().includes(query) ||
      user.id.toString().includes(query)
    );
  });

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="flex gap-3 items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="search by username, email, or id..."
          className="flex-1 bg-[#1a1a1a] border border-[#333] rounded px-4 py-2 text-white text-sm focus:outline-none focus:border-[#666]"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="text-xs text-[#666] hover:text-white transition-colors"
          >
            clear
          </button>
        )}
      </div>

      {/* Pagination Header */}
      {pagination.total > 0 && (
        <div className="flex justify-between items-center text-xs">
          <p className="text-[#666]">
            {searchQuery ? (
              `showing ${filteredUsers.length} of ${pagination.total} users`
            ) : (
              strings.admin.dashboard.users.pagination.showing(
                ((pagination.page - 1) * pagination.limit) + 1,
                Math.min(pagination.page * pagination.limit, pagination.total),
                pagination.total
              )
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1 || loading}
              className="px-3 py-1 bg-[#1a1a1a] border border-[#333] rounded hover:bg-[#222] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {strings.admin.dashboard.users.pagination.prev}
            </button>
            <span className="px-3 py-1">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || loading}
              className="px-3 py-1 bg-[#1a1a1a] border border-[#333] rounded hover:bg-[#222] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {strings.admin.dashboard.users.pagination.next}
            </button>
          </div>
        </div>
      )}

      {/* Users Table */}
      {loading ? (
        <p className="text-center py-8">{strings.admin.dashboard.users.loading}</p>
      ) : (
        <div className="overflow-x-auto -mx-4 md:mx-0">
          <table className="w-full border-collapse min-w-[800px]">
            <thead>
              <tr className="border-b border-[#333]">
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{strings.admin.dashboard.users.table.id}</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{strings.admin.dashboard.users.table.username}</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{strings.admin.dashboard.users.table.email}</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{strings.admin.dashboard.users.table.verified}</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">plan</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{strings.admin.dashboard.users.table.slates}</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{strings.admin.dashboard.users.table.storage}</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{strings.admin.dashboard.users.table.joined}</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{strings.admin.dashboard.users.table.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-b border-[#222] hover:bg-[#1a1a1a]">
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{user.id}</td>
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm text-white">{user.username}</td>
                  <td
                    className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm cursor-default select-none"
                    onClick={() => handleEmailClick(user.id)}
                  >
                    {revealedEmails[user.id] ? user.emailFull || user.email : maskEmail(user.email)}
                  </td>
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{user.email_verified ? '✓' : '✗'}</td>
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">
                    <button
                      onClick={() => onChangePlan(user.id, user.username, user.supporter_tier)}
                      className="text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      {user.supporter_tier === 'quarterly' && '❤️ quarterly'}
                      {user.supporter_tier === 'one_time' && '⭐ one_time'}
                      {!user.supporter_tier && 'free'}
                    </button>
                  </td>
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{user.slate_count}/50</td>
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{formatBytes(user.total_bytes)}</td>
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 md:py-3 px-2 md:px-4">
                    <button
                      onClick={() => onDeleteUser(user.id, user.username)}
                      className="text-red-400 hover:text-red-300 text-xs md:text-sm transition-colors"
                    >
                      {strings.admin.dashboard.users.deleteUser}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredUsers.length === 0 && !loading && (
            <p className="text-center py-8">
              {searchQuery ? 'no users found matching your search' : strings.admin.dashboard.users.noUsers}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Activity Logs Tab Component
function LogsTab({ logs, stats, pagination, loading, onPageChange }) {
  const formatActionName = (action) => {
    return action.split('_').join(' ');
  };

  const getActionColor = (action) => {
    if (action.includes('delete')) return 'text-red-400';
    if (action.includes('view')) return 'text-blue-400';
    return 'text-[#a0a0a0]';
  };

  return (
    <div className="space-y-6">
      {/* Log Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
            <p className="text-xs text-[#666] mb-1">total actions</p>
            <p className="text-2xl text-white">{stats.total.toLocaleString()}</p>
          </div>
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
            <p className="text-xs text-[#666] mb-1">last 24h</p>
            <p className="text-2xl text-white">{stats.last24h.toLocaleString()}</p>
          </div>
          {stats.actionBreakdown[0] && (
            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <p className="text-xs text-[#666] mb-1">most common</p>
              <p className="text-lg text-white">{formatActionName(stats.actionBreakdown[0].action)}</p>
              <p className="text-xs text-[#666]">{stats.actionBreakdown[0].count}x</p>
            </div>
          )}
        </div>
      )}

      {/* Activity Logs */}
      {loading ? (
        <p className="text-center py-8">loading...</p>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="bg-[#1a1a1a] border border-[#333] rounded p-3 hover:bg-[#222]">
              <div className="flex justify-between items-start mb-2">
                <span className={`text-sm font-medium ${getActionColor(log.action)}`}>
                  {formatActionName(log.action)}
                </span>
                <span className="text-xs text-[#666]">
                  {new Date(log.created_at).toLocaleString()}
                </span>
              </div>
              {log.details && (
                <div className="text-xs text-[#666] space-y-1">
                  {log.details.username && <p>user: {log.details.username}</p>}
                  {log.details.email && <p>email: {maskEmail(log.details.email)}</p>}
                  {log.details.slatesDeleted !== undefined && <p>slates deleted: {log.details.slatesDeleted}</p>}
                </div>
              )}
              {log.ip_address && (
                <p className="text-xs text-[#666] mt-1">ip: {log.ip_address}</p>
              )}
            </div>
          ))}

          {logs.length === 0 && (
            <p className="text-center py-8">no activity logs yet</p>
          )}
        </div>
      )}
    </div>
  );
}

// Health Tab Component
function HealthTab({ healthMetrics, b2Stats }) {
  if (!healthMetrics) {
    return <p className="text-center py-8">loading health metrics...</p>;
  }

  return (
    <div className="space-y-6">
      {/* System Health */}
      <div>
        <h2 className="text-sm text-white mb-4">system health</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
            <h3 className="text-xs text-[#666] mb-3">server</h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[#666]">uptime</span>
                <span className="text-white">{formatUptime(healthMetrics.system.uptime)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666]">node version</span>
                <span className="text-white">{healthMetrics.system.nodeVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666]">platform</span>
                <span className="text-white">{healthMetrics.system.platform}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#666]">cpus</span>
                <span className="text-white">{healthMetrics.system.cpus}</span>
              </div>
            </div>
          </div>

          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
            <h3 className="text-xs text-[#666] mb-3">memory</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[#666]">used</span>
                  <span className="text-white">{healthMetrics.system.memory.percentUsed}%</span>
                </div>
                <div className="w-full bg-[#333] h-2 rounded overflow-hidden">
                  <div
                    className={`h-full ${
                      parseFloat(healthMetrics.system.memory.percentUsed) > 80
                        ? 'bg-red-500'
                        : parseFloat(healthMetrics.system.memory.percentUsed) > 60
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                    }`}
                    style={{ width: `${healthMetrics.system.memory.percentUsed}%` }}
                  ></div>
                </div>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#666]">total</span>
                <span className="text-white">{formatBytes(healthMetrics.system.memory.total)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[#666]">free</span>
                <span className="text-white">{formatBytes(healthMetrics.system.memory.free)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Database Metrics */}
      <div>
        <h2 className="text-sm text-white mb-4">database metrics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
            <p className="text-xs text-[#666] mb-1">users</p>
            <p className="text-2xl text-white">{healthMetrics.database.users.toLocaleString()}</p>
          </div>
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
            <p className="text-xs text-[#666] mb-1">slates</p>
            <p className="text-2xl text-white">{healthMetrics.database.slates.toLocaleString()}</p>
          </div>
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
            <p className="text-xs text-[#666] mb-1">active sessions</p>
            <p className="text-2xl text-white">{healthMetrics.database.sessions.toLocaleString()}</p>
          </div>
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
            <p className="text-xs text-[#666] mb-1">published</p>
            <p className="text-2xl text-white">{healthMetrics.database.published.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* B2 Storage Health */}
      {b2Stats && (
        <div>
          <h2 className="text-sm text-white mb-4">b2 storage health</h2>
          <div className="bg-[#1a1a1a] border border-[#333] rounded p-4 space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-[#666]">class b transactions (reads)</span>
                <span className={`${parseFloat(b2Stats.percentages.classB.percent) > 80 ? 'text-red-400' : 'text-white'}`}>
                  {b2Stats.classB.toLocaleString()} / {b2Stats.percentages.classB.limit.toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-[#333] h-2 rounded overflow-hidden">
                <div
                  className={`h-full ${
                    parseFloat(b2Stats.percentages.classB.percent) > 80
                      ? 'bg-red-500'
                      : parseFloat(b2Stats.percentages.classB.percent) > 50
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, b2Stats.percentages.classB.percent)}%` }}
                ></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-[#666]">class c transactions (writes)</span>
                <span className={`${parseFloat(b2Stats.percentages.classC.percent) > 80 ? 'text-red-400' : 'text-white'}`}>
                  {b2Stats.classC.toLocaleString()} / {b2Stats.percentages.classC.limit.toLocaleString()}
                </span>
              </div>
              <div className="w-full bg-[#333] h-2 rounded overflow-hidden">
                <div
                  className={`h-full ${
                    parseFloat(b2Stats.percentages.classC.percent) > 80
                      ? 'bg-red-500'
                      : parseFloat(b2Stats.percentages.classC.percent) > 50
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, b2Stats.percentages.classC.percent)}%` }}
                ></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-2">
                <span className="text-[#666]">bandwidth</span>
                <span className={`${parseFloat(b2Stats.percentages.bandwidth.percent) > 80 ? 'text-red-400' : 'text-white'}`}>
                  {b2Stats.percentages.bandwidth.usedMB} MB / {b2Stats.percentages.bandwidth.limitGB} GB
                </span>
              </div>
              <div className="w-full bg-[#333] h-2 rounded overflow-hidden">
                <div
                  className={`h-full ${
                    parseFloat(b2Stats.percentages.bandwidth.percent) > 80
                      ? 'bg-red-500'
                      : parseFloat(b2Stats.percentages.bandwidth.percent) > 50
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, b2Stats.percentages.bandwidth.percent)}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Sentry Tab Component - Error Monitoring
function SentryTab({ errorLogs, loading, onRefresh }) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm text-white">error monitoring (last 100 lines)</h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
        >
          {loading ? 'refreshing...' : 'refresh'}
        </button>
      </div>

      {loading && !errorLogs ? (
        <div className="text-[#666] text-sm">loading error logs...</div>
      ) : !errorLogs ? (
        <div className="text-[#666] text-sm">no error logs available</div>
      ) : (
        <div className="bg-[#0a0a0a] border border-[#333] rounded p-4 overflow-x-auto">
          <pre className="text-xs text-red-400 font-mono whitespace-pre-wrap">
            {errorLogs}
          </pre>
        </div>
      )}

      <div className="text-xs text-[#666]">
        <p className="mb-2">this shows the last 100 lines of PM2 error logs for the justtype process.</p>
        <p>errors include:</p>
        <ul className="list-disc list-inside ml-2 mt-1 space-y-1">
          <li>uncaught exceptions</li>
          <li>database errors</li>
          <li>b2 storage failures</li>
          <li>authentication failures</li>
          <li>email service errors</li>
        </ul>
      </div>
    </div>
  );
}

// Stripe Tab Component - Subscription Management
function StripeTab({ stripeData, loading, onAction, onRefresh, searchQuery, onSearchChange, onChangePlan, openModal }) {
  if (loading && !stripeData) {
    return <p className="text-center py-8">loading stripe data...</p>;
  }

  if (!stripeData) {
    return <p className="text-center py-8">failed to load stripe data</p>;
  }

  const { stats, subscriptions, mismatches, testData } = stripeData;

  // Filter subscriptions based on search query
  const filteredSubscriptions = subscriptions.filter(sub => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      sub.username.toLowerCase().includes(query) ||
      sub.email?.toLowerCase().includes(query) ||
      sub.user_id.toString().includes(query) ||
      sub.stripe_customer_id?.toLowerCase().includes(query) ||
      sub.stripe_subscription_id?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header with refresh */}
      <div className="flex justify-between items-center">
        <h2 className="text-sm text-white">stripe subscription management</h2>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
        >
          {loading ? 'refreshing...' : 'refresh'}
        </button>
      </div>

      {/* Search Bar */}
      <div className="flex gap-3 items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="search by username, email, id, or stripe ids..."
          className="flex-1 bg-[#1a1a1a] border border-[#333] rounded px-4 py-2 text-white text-sm focus:outline-none focus:border-[#666]"
        />
        {searchQuery && (
          <button
            onClick={() => onSearchChange('')}
            className="text-xs text-[#666] hover:text-white transition-colors"
          >
            clear
          </button>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
          <p className="text-xs text-[#666] mb-1">total subscribers</p>
          <p className="text-2xl text-white">{stats.totalSubscriptions}</p>
        </div>
        <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
          <p className="text-xs text-[#666] mb-1">active</p>
          <p className="text-2xl text-green-400">{stats.activeSubscriptions}</p>
        </div>
        <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
          <p className="text-xs text-[#666] mb-1">pending cancellation</p>
          <p className="text-2xl text-yellow-400">{stats.pendingCancellations}</p>
        </div>
        <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
          <p className="text-xs text-[#666] mb-1">monthly revenue</p>
          <p className="text-2xl text-white">€{((stats.totalRevenue || 0) / 100).toFixed(0)}</p>
        </div>
      </div>

      {/* Data Issues Alert */}
      {(mismatches.length > 0 || testData.length > 0) && (
        <div className="bg-[#1a1a1a] border border-yellow-600 rounded p-4">
          <h3 className="text-sm text-yellow-400 mb-3">⚠ data health issues detected</h3>
          <div className="space-y-2 text-xs">
            {testData.length > 0 && (
              <p className="text-[#a0a0a0]">
                <span className="text-white font-medium">{testData.length}</span> users with test/fake stripe IDs
              </p>
            )}
            {mismatches.length > 0 && (
              <p className="text-[#a0a0a0]">
                <span className="text-white font-medium">{mismatches.length}</span> database/stripe mismatches
              </p>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            {testData.length > 0 && (
              <button
                onClick={() => openModal('cleanTestData', { count: testData.length })}
                className="text-xs px-3 py-2 bg-yellow-600 text-black rounded hover:bg-yellow-500 transition-colors"
              >
                clean test data
              </button>
            )}
            {mismatches.length > 0 && (
              <button
                onClick={() => openModal('fixMismatches', { count: mismatches.length })}
                className="text-xs px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
              >
                fix mismatches
              </button>
            )}
          </div>
        </div>
      )}

      {/* Active Subscriptions */}
      {filteredSubscriptions.length > 0 && (
        <div>
          <h3 className="text-sm text-white mb-4">
            {searchQuery ? (
              `showing ${filteredSubscriptions.length} of ${subscriptions.length} subscriptions`
            ) : (
              `active subscriptions (${subscriptions.length})`
            )}
          </h3>
          <div className="space-y-2">
            {filteredSubscriptions.map((sub) => (
              <div key={sub.user_id} className="bg-[#1a1a1a] border border-[#333] rounded p-4 hover:bg-[#222]">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-sm text-white">
                      {sub.username} <span className="text-[#666]">(#{sub.user_id})</span>
                    </p>
                    <p className="text-xs text-[#666]">{maskEmail(sub.email)}</p>
                  </div>
                  <div className="text-right">
                    <button
                      onClick={() => onChangePlan(sub.user_id, sub.username, sub.supporter_tier)}
                      className="text-xs text-white hover:text-blue-400 transition-colors"
                    >
                      {sub.supporter_tier === 'quarterly' ? '❤️ quarterly' : '⭐ one_time'}
                    </button>
                    {sub.subscription_expires_at && (
                      <p className="text-xs text-yellow-400 mt-1">
                        ends: {new Date(sub.subscription_expires_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs text-[#666] mt-3 pt-3 border-t border-[#222]">
                  <div>
                    <p>stripe customer</p>
                    <p className="text-white font-mono text-[10px] truncate">{sub.stripe_customer_id || 'none'}</p>
                  </div>
                  <div>
                    <p>stripe subscription</p>
                    <p className="text-white font-mono text-[10px] truncate">{sub.stripe_subscription_id || 'none'}</p>
                  </div>
                </div>

                {sub.is_test_data && (
                  <div className="mt-3 pt-3 border-t border-[#222]">
                    <p className="text-xs text-yellow-400">⚠ test data detected</p>
                    <button
                      onClick={() => openModal('clearTestData', { userId: sub.user_id, username: sub.username })}
                      className="text-xs text-blue-400 hover:text-blue-300 mt-2"
                    >
                      clear test data
                    </button>
                  </div>
                )}

                {sub.subscription_expires_at && (
                  <div className="mt-3 flex gap-3">
                    <button
                      onClick={() => openModal('clearCancellation', { userId: sub.user_id, username: sub.username })}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      clear cancellation date
                    </button>
                    <button
                      onClick={() => openModal('cancelImmediately', { userId: sub.user_id, username: sub.username })}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      cancel immediately
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {subscriptions.length === 0 && !searchQuery && (
        <div className="text-center py-12 text-[#666]">
          <p>no active subscriptions</p>
        </div>
      )}

      {filteredSubscriptions.length === 0 && subscriptions.length > 0 && searchQuery && (
        <div className="text-center py-12 text-[#666]">
          <p>no subscriptions found matching your search</p>
        </div>
      )}

      {/* Bulk Actions */}
      <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
        <h3 className="text-sm text-white mb-3">bulk actions</h3>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => openModal('clearAllCancellations', {})}
            className="text-xs px-3 py-2 bg-[#2a2a2a] border border-[#444] rounded hover:bg-[#333] transition-colors"
          >
            clear all cancellation dates
          </button>
          <button
            onClick={() => openModal('cleanAllTestData', {})}
            className="text-xs px-3 py-2 bg-[#2a2a2a] border border-[#444] rounded hover:bg-[#333] transition-colors"
          >
            clean all test data
          </button>
        </div>
      </div>
    </div>
  );
}
