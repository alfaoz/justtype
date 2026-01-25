import React, { useState } from 'react';
import { API_URL } from '../config';

export function CliPair({ token, onLogin }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/cli/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ user_code: code.toUpperCase().trim() })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'failed to authorize');
        setLoading(false);
        return;
      }

      setSuccess(true);
      setLoading(false);
    } catch (err) {
      setError('network error');
      setLoading(false);
    }
  };

  // Redirect to login if not logged in
  if (!token) {
    return (
      <div className="min-h-screen bg-[#111111] flex items-center justify-center p-4 font-mono">
        <div className="max-w-md w-full text-center">
          <h1 className="text-xl text-white mb-4">authorize justtype cli by entering the code shown in your terminal</h1>
          <p className="text-[#666666] mb-8">you need to be logged in first</p>
          <button
            onClick={onLogin}
            className="px-6 py-2 bg-[#8B5CF6] text-white rounded hover:bg-[#7C3AED] transition"
          >
            log in
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#111111] flex items-center justify-center p-4 font-mono">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4">✓</div>
          <h1 className="text-xl text-[#10B981] mb-4">authorized!</h1>
          <p className="text-[#666666]">you can now return to your terminal</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111111] flex items-center justify-center p-4 font-mono">
      <div className="max-w-md w-full">
        <h1 className="text-xl text-white mb-8 text-center leading-relaxed">authorize justtype cli by entering the code shown in your terminal</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABC-123"
              maxLength={7}
              className="w-full px-4 py-3 bg-[#1a1a1a] border border-[#333333] rounded text-[#d4d4d4] text-center text-2xl font-mono tracking-wider focus:outline-none focus:border-[#8B5CF6] transition"
              autoFocus
              disabled={loading}
            />
          </div>

          {error && (
            <div className="text-[#EF4444] text-sm text-center">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || code.length < 6}
            className="w-full py-3 bg-[#8B5CF6] text-white rounded hover:bg-[#7C3AED] transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'authorizing...' : 'authorize'}
          </button>
        </form>

        <p className="text-[#666666] text-sm text-center mt-8">
          this will grant the cli access to your account
        </p>
      </div>
    </div>
  );
}
