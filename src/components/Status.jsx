import React, { useState, useEffect, useRef } from 'react';
import { strings } from '../strings';
import { API_URL } from '../config';

export function Status() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [expandedDates, setExpandedDates] = useState({});
  const pollRef = useRef(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_URL}/status`);
      if (!res.ok) throw new Error();
      setData(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 30000);
    return () => clearInterval(pollRef.current);
  }, []);

  const s = strings.status;

  const utc = (d) => d && !d.endsWith('Z') && !d.includes('+') ? d + 'Z' : d;

  const severityColor = (sev) => ({ minor: '#eab308', major: '#f97316', critical: '#ef4444' }[sev] || '#666');
  const statusColor = (st) => ({
    investigating: 'bg-red-900/30 text-red-400',
    identified: 'bg-yellow-900/30 text-yellow-400',
    monitoring: 'bg-blue-900/30 text-blue-400',
    resolved: 'bg-green-900/30 text-green-400'
  }[st] || 'text-[#666]');

  const overallStatus = () => {
    if (!data || !data.active) return 'operational';
    if (data.active.some(i => i.severity === 'critical')) return 'outage';
    if (data.active.length > 0) return 'degraded';
    return 'operational';
  };

  const overall = overallStatus();

  // Group resolved incidents by date
  const groupByDate = (incidents) => {
    const groups = {};
    for (const inc of incidents) {
      const date = new Date(utc(inc.resolved_at || inc.created_at)).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      if (!groups[date]) groups[date] = [];
      groups[date].push(inc);
    }
    return groups;
  };

  const timeAgo = (iso) => {
    const seconds = Math.floor((Date.now() - new Date(utc(iso)).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="min-h-screen bg-[#111111] text-[#a0a0a0] flex flex-col" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&display=swap');`}</style>
      <header className="p-8 border-b border-[#222]">
        <a href="/" className="text-xl font-medium text-[#808080] hover:text-white transition-colors">
          + just type
        </a>
      </header>

      <main className="max-w-2xl mx-auto p-4 md:p-8 flex-grow w-full">
        <h1 className="text-xl text-white mb-2">{s.title}</h1>
        <p className="text-sm text-[#666] mb-8">{s.description}</p>

        {error && <div className="text-red-400 text-sm mb-6">failed to load status</div>}

        {!data && !error && (
          <div className="text-[#666] text-sm animate-pulse">loading...</div>
        )}

        {data && (
          <div className="space-y-8">
            {/* Overall status banner */}
            <div className={`text-sm py-4 px-5 rounded border ${
              overall === 'operational' ? 'border-green-800/30 bg-green-900/10 text-green-400' :
              overall === 'degraded' ? 'border-yellow-800/30 bg-yellow-900/10 text-yellow-400' :
              'border-red-800/30 bg-red-900/10 text-red-400'
            }`}>
              <span className="text-base">
                {overall === 'operational' ? s.allOperational :
                 overall === 'degraded' ? s.degraded : s.outage}
              </span>
            </div>

            {/* Active incidents */}
            {data.active.length > 0 && (
              <div>
                <h2 className="text-sm text-white mb-4">{s.activeIncidents}</h2>
                <div className="space-y-4">
                  {data.active.map(inc => (
                    <div key={inc.id} className="border border-[#333] rounded overflow-hidden">
                      <div className="flex items-center gap-3 p-4" style={{ borderLeft: `4px solid ${severityColor(inc.severity)}` }}>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white text-sm">{inc.title}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${statusColor(inc.status)}`}>
                              {s.statuses[inc.status] || inc.status}
                            </span>
                            <span className="text-xs text-[#555]">{s.severity[inc.severity]}</span>
                          </div>
                          <p className="text-xs text-[#555] mt-1">{timeAgo(inc.created_at)}</p>
                        </div>
                      </div>
                      {/* Timeline */}
                      {inc.updates && inc.updates.length > 0 && (
                        <div className="px-4 pb-4 pt-0">
                          <div className="ml-2 border-l border-[#333] pl-4 space-y-3">
                            {inc.updates.map(u => (
                              <div key={u.id} className="relative">
                                <div className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: severityColor(inc.severity) }} />
                                <div className="flex items-center gap-2 text-xs">
                                  <span className={`px-1.5 py-0.5 rounded ${statusColor(u.status)}`}>
                                    {s.statuses[u.status] || u.status}
                                  </span>
                                  <span className="text-[#555]">{timeAgo(u.created_at)}</span>
                                </div>
                                <p className="text-sm text-[#888] mt-1">{u.message}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Past incidents */}
            <div>
              <h2 className="text-sm text-white mb-4">{s.pastIncidents}</h2>
              {data.resolved.length === 0 ? (
                <p className="text-sm text-[#555]">{s.noIncidents}</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(groupByDate(data.resolved)).map(([date, incs]) => (
                    <div key={date} className="border border-[#222] rounded">
                      <button
                        onClick={() => setExpandedDates(prev => ({ ...prev, [date]: !prev[date] }))}
                        className="w-full flex items-center justify-between p-3 text-left hover:bg-[#1a1a1a] transition-colors"
                      >
                        <span className="text-sm text-[#888]">{date}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[#555]">{incs.length} incident{incs.length !== 1 ? 's' : ''}</span>
                          <span className="text-[#555] text-xs">{expandedDates[date] ? '\u25B2' : '\u25BC'}</span>
                        </div>
                      </button>
                      {expandedDates[date] && (
                        <div className="border-t border-[#222] p-3 space-y-3">
                          {incs.map(inc => (
                            <div key={inc.id} className="pl-3" style={{ borderLeft: `3px solid ${severityColor(inc.severity)}` }}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-[#ccc]">{inc.title}</span>
                                <span className="bg-green-900/30 text-green-400 text-xs px-1.5 py-0.5 rounded">{s.statuses.resolved}</span>
                              </div>
                              {inc.updates && inc.updates.length > 0 && (
                                <div className="ml-2 border-l border-[#333] pl-3 mt-2 space-y-2">
                                  {inc.updates.map(u => (
                                    <div key={u.id} className="text-xs">
                                      <span className="text-[#555]">{new Date(utc(u.created_at)).toLocaleTimeString()}</span>
                                      <span className="text-[#666] ml-2">[{s.statuses[u.status] || u.status}]</span>
                                      <p className="text-[#777] mt-0.5">{u.message}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="p-8 text-center border-t border-[#222] mt-16">
        <div className="text-sm opacity-50">
          <a href="/" className="hover:text-white transition-colors">{s.footer.home}</a>
          <span className="mx-2">·</span>
          <a href="https://github.com/alfaoz/justtype" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">{s.footer.github}</a>
          <span className="mx-2">·</span>
          <a href="/verify" className="hover:text-white transition-colors">verify</a>
        </div>
      </footer>
    </div>
  );
}
