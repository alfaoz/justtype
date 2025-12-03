import React, { useState, useEffect } from 'react';
import { API_URL } from '../config';
import { strings } from '../strings';

export function AdminConsole() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [adminToken, setAdminToken] = useState(localStorage.getItem('admin-token'));
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (adminToken) {
      setIsAuthenticated(true);
      fetchUsers();
    }
  }, [adminToken]);

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

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/users`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      const data = await response.json();

      if (response.ok) {
        setUsers(data.users);
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
        fetchUsers();
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
        <div className="flex justify-between items-center mb-6 md:mb-8">
          <h1 className="text-xl md:text-2xl text-white">{strings.admin.dashboard.title}</h1>
          <div className="flex gap-3 md:gap-4">
            <button
              onClick={fetchUsers}
              className="text-xs md:text-sm hover:text-white transition-colors"
            >
              refresh
            </button>
            <button
              onClick={handleLogout}
              className="text-xs md:text-sm hover:text-white transition-colors"
            >
              {strings.admin.dashboard.logout}
            </button>
          </div>
        </div>

        {error && <p className="text-red-400 text-xs md:text-sm mb-4">{error}</p>}

        {loading ? (
          <p>{strings.admin.dashboard.users.loading}</p>
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
                    <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{user.email || '-'}</td>
                    <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{user.email_verified ? '✓' : '✗'}</td>
                    <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{user.slate_count}/50</td>
                    <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">{(user.total_bytes / (1024 * 1024 * 1024)).toFixed(4)} GB</td>
                    <td className="py-2 md:py-3 px-2 md:px-4 text-xs md:text-sm">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 md:py-3 px-2 md:px-4">
                      <button
                        onClick={() => handleDeleteUser(user.id, user.username)}
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

            <div className="mt-6 md:mt-8 text-xs md:text-sm px-4 md:px-0">
              <p>{strings.admin.dashboard.stats.totalUsers} {users.length}</p>
              <p>
                {strings.admin.dashboard.stats.totalSlates} {users.reduce((sum, u) => sum + u.slate_count, 0)}
              </p>
              <p>
                total storage: {(users.reduce((sum, u) => sum + u.total_bytes, 0) / (1024 * 1024 * 1024)).toFixed(4)} GB
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
