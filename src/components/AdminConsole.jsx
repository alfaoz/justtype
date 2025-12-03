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

export function AdminConsole() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [adminToken, setAdminToken] = useState(localStorage.getItem('admin-token'));

  // Tab state
  const [activeTab, setActiveTab] = useState('overview');

  // Data state
  const [users, setUsers] = useState([]);
  const [usersPagination, setUsersPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [b2Stats, setB2Stats] = useState(null);
  const [healthMetrics, setHealthMetrics] = useState(null);
  const [activityLogs, setActivityLogs] = useState([]);
  const [logStats, setLogStats] = useState(null);
  const [logsPagination, setLogsPagination] = useState({ page: 1 });

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
    switch (tab) {
      case 'overview':
        fetchB2Stats();
        fetchHealthMetrics();
        break;
      case 'users':
        fetchUsers(1);
        break;
      case 'logs':
        fetchActivityLogs(1);
        break;
      case 'health':
        fetchHealthMetrics();
        break;
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
        setError(data.error || 'Authentication failed');
      }
    } catch (err) {
      setError('Failed to authenticate');
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
        setError(data.error || 'Failed to fetch users');
        if (response.status === 403) {
          setIsAuthenticated(false);
          localStorage.removeItem('admin-token');
        }
      }
    } catch (err) {
      setError('Failed to fetch users');
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

  const handleDeleteUser = async (userId, username) => {
    if (!confirm(`Are you sure you want to delete user "${username}"? This will delete all their slates and cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      const data = await response.json();

      if (response.ok) {
        alert(`User "${username}" deleted successfully`);
        fetchUsers(usersPagination.page);
      } else {
        alert(data.error || 'Failed to delete user');
      }
    } catch (err) {
      alert('Failed to delete user');
    }
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
          {['overview', 'users', 'logs', 'health'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 px-2 text-sm transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'text-white border-b-2 border-white'
                  : 'text-[#666] hover:text-[#a0a0a0]'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
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
      </div>
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
          <h2 className="text-sm text-white mb-4">b2 storage usage</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <h3 className="text-xs text-[#666] mb-2">class b (reads)</h3>
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
                {b2Stats.percentages.classB.percent}% of {b2Stats.percentages.classB.limit.toLocaleString()} daily cap
              </p>
            </div>

            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <h3 className="text-xs text-[#666] mb-2">class c (writes)</h3>
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
                {b2Stats.percentages.classC.percent}% of {b2Stats.percentages.classC.limit.toLocaleString()} daily cap
              </p>
            </div>

            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <h3 className="text-xs text-[#666] mb-2">bandwidth</h3>
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
                {b2Stats.percentages.bandwidth.percent}% of {b2Stats.percentages.bandwidth.limitGB} GB daily cap
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Stats */}
      {healthMetrics && (
        <div>
          <h2 className="text-sm text-white mb-4">quick stats</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <p className="text-xs text-[#666] mb-1">total users</p>
              <p className="text-2xl text-white">{healthMetrics.database.users.toLocaleString()}</p>
              {healthMetrics.growth.newUsers24h > 0 && (
                <p className="text-xs text-green-400 mt-1">+{healthMetrics.growth.newUsers24h} today</p>
              )}
            </div>

            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <p className="text-xs text-[#666] mb-1">total slates</p>
              <p className="text-2xl text-white">{healthMetrics.database.slates.toLocaleString()}</p>
              {healthMetrics.growth.newSlates24h > 0 && (
                <p className="text-xs text-green-400 mt-1">+{healthMetrics.growth.newSlates24h} today</p>
              )}
            </div>

            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <p className="text-xs text-[#666] mb-1">published</p>
              <p className="text-2xl text-white">{healthMetrics.database.published.toLocaleString()}</p>
            </div>

            <div className="bg-[#1a1a1a] border border-[#333] rounded p-4">
              <p className="text-xs text-[#666] mb-1">storage used</p>
              <p className="text-2xl text-white">{healthMetrics.database.totalStorageGB} GB</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Users Tab Component
function UsersTab({ users, pagination, loading, onPageChange, onDeleteUser }) {
  return (
    <div className="space-y-4">
      {/* Pagination Header */}
      {pagination.total > 0 && (
        <div className="flex justify-between items-center text-xs">
          <p className="text-[#666]">
            showing {((pagination.page - 1) * pagination.limit) + 1}-{Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} users
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page === 1 || loading}
              className="px-3 py-1 bg-[#1a1a1a] border border-[#333] rounded hover:bg-[#222] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              prev
            </button>
            <span className="px-3 py-1">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || loading}
              className="px-3 py-1 bg-[#1a1a1a] border border-[#333] rounded hover:bg-[#222] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              next
            </button>
          </div>
        </div>
      )}

      {/* Users Table */}
      {loading ? (
        <p className="text-center py-8">loading...</p>
      ) : (
        <div className="overflow-x-auto -mx-4 md:mx-0">
          <table className="w-full border-collapse min-w-[800px]">
            <thead>
              <tr className="border-b border-[#333]">
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">id</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">username</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">email</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">verified</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">slates</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">storage</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">joined</th>
                <th className="text-left py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-[#222] hover:bg-[#1a1a1a]">
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{user.id}</td>
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm text-white">{user.username}</td>
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{maskEmail(user.email)}</td>
                  <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{user.email_verified ? '✓' : '✗'}</td>
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

          {users.length === 0 && (
            <p className="text-center py-8">no users found</p>
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
