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
    <div className="min-h-screen font-mono flex flex-col" style={{ backgroundColor: 'var(--theme-bg)', color: 'var(--theme-text-muted)' }}>
      <header className="p-8 border-b" style={{ borderColor: 'var(--theme-border-light)' }}>
        <a href="/" className="text-lg md:text-xl font-medium transition-colors" style={{ color: 'var(--theme-text-dim)' }} onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}>
          + just type
        </a>
      </header>

      <main className="max-w-2xl mx-auto p-4 md:p-8 flex-grow w-full">
        <h1 className="text-xl mb-2" style={{ color: 'var(--theme-accent)' }}>{s.title}</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--theme-text-dim)' }}>{s.description}</p>

        {error && <div className="text-sm mb-6" style={{ color: 'var(--theme-red)' }}>failed to load status</div>}

        {!data && !error && (
          <div className="text-sm animate-pulse" style={{ color: 'var(--theme-text-dim)' }}>loading...</div>
        )}

        {data && (
          <div className="space-y-8">
            {/* Overall status banner */}
            <div
              className="text-sm py-4 px-5 rounded border"
              style={{
                borderColor: overall === 'operational' ? 'rgba(74, 222, 128, 0.3)' :
                  overall === 'degraded' ? 'rgba(251, 146, 60, 0.3)' :
                  'rgba(248, 113, 113, 0.3)',
                backgroundColor: overall === 'operational' ? 'rgba(74, 222, 128, 0.1)' :
                  overall === 'degraded' ? 'rgba(251, 146, 60, 0.1)' :
                  'rgba(248, 113, 113, 0.1)',
                color: overall === 'operational' ? 'var(--theme-green)' :
                  overall === 'degraded' ? 'var(--theme-orange)' :
                  'var(--theme-red)'
              }}
            >
              <span className="text-base">
                {overall === 'operational' ? s.allOperational :
                 overall === 'degraded' ? s.degraded : s.outage}
              </span>
            </div>

            {/* Active incidents */}
            {data.active.length > 0 && (
              <div>
                <h2 className="text-sm mb-4" style={{ color: 'var(--theme-accent)' }}>{s.activeIncidents}</h2>
                <div className="space-y-4">
                  {data.active.map(inc => (
                    <div key={inc.id} className="rounded overflow-hidden" style={{ border: '1px solid var(--theme-border)' }}>
                      <div className="flex items-center gap-3 p-4" style={{ borderLeft: `4px solid ${severityColor(inc.severity)}` }}>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm" style={{ color: 'var(--theme-accent)' }}>{inc.title}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${statusColor(inc.status)}`}>
                              {s.statuses[inc.status] || inc.status}
                            </span>
                            <span className="text-xs" style={{ color: 'var(--theme-text-dim)' }}>{s.severity[inc.severity]}</span>
                          </div>
                          <p className="text-xs mt-1" style={{ color: 'var(--theme-text-dim)' }}>{timeAgo(inc.created_at)}</p>
                        </div>
                      </div>
                      {/* Timeline */}
                      {inc.updates && inc.updates.length > 0 && (
                        <div className="px-4 pb-4 pt-0">
                          <div className="ml-2 pl-4 space-y-3" style={{ borderLeft: '1px solid var(--theme-border)' }}>
                            {inc.updates.map(u => (
                              <div key={u.id} className="relative">
                                <div className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full" style={{ backgroundColor: severityColor(inc.severity) }} />
                                <div className="flex items-center gap-2 text-xs">
                                  <span className={`px-1.5 py-0.5 rounded ${statusColor(u.status)}`}>
                                    {s.statuses[u.status] || u.status}
                                  </span>
                                  <span style={{ color: 'var(--theme-text-dim)' }}>{timeAgo(u.created_at)}</span>
                                </div>
                                <p className="text-sm mt-1" style={{ color: 'var(--theme-text-muted)' }}>{u.message}</p>
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
              <h2 className="text-sm mb-4" style={{ color: 'var(--theme-accent)' }}>{s.pastIncidents}</h2>
              {data.resolved.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--theme-text-dim)' }}>{s.noIncidents}</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(groupByDate(data.resolved)).map(([date, incs]) => (
                    <div key={date} className="rounded" style={{ border: '1px solid var(--theme-border-light)' }}>
                      <button
                        onClick={() => setExpandedDates(prev => ({ ...prev, [date]: !prev[date] }))}
                        className="w-full flex items-center justify-between p-3 text-left transition-colors"
                        style={{ backgroundColor: 'transparent' }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--theme-bg-secondary)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <span className="text-sm" style={{ color: 'var(--theme-text-muted)' }}>{date}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs" style={{ color: 'var(--theme-text-dim)' }}>{incs.length} incident{incs.length !== 1 ? 's' : ''}</span>
                          <span className="text-xs" style={{ color: 'var(--theme-text-dim)' }}>{expandedDates[date] ? '\u25B2' : '\u25BC'}</span>
                        </div>
                      </button>
                      {expandedDates[date] && (
                        <div className="p-3 space-y-3" style={{ borderTop: '1px solid var(--theme-border-light)' }}>
                          {incs.map(inc => (
                            <div key={inc.id} className="pl-3" style={{ borderLeft: `3px solid ${severityColor(inc.severity)}` }}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm" style={{ color: 'var(--theme-text)' }}>{inc.title}</span>
                                <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(74, 222, 128, 0.15)', color: 'var(--theme-green)' }}>{s.statuses.resolved}</span>
                              </div>
                              {inc.updates && inc.updates.length > 0 && (
                                <div className="ml-2 pl-3 mt-2 space-y-2" style={{ borderLeft: '1px solid var(--theme-border)' }}>
                                  {inc.updates.map(u => (
                                    <div key={u.id} className="text-xs">
                                      <span style={{ color: 'var(--theme-text-dim)' }}>{new Date(utc(u.created_at)).toLocaleTimeString()}</span>
                                      <span className="ml-2" style={{ color: 'var(--theme-text-dim)' }}>[{s.statuses[u.status] || u.status}]</span>
                                      <p className="mt-0.5" style={{ color: 'var(--theme-text-muted)' }}>{u.message}</p>
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

      <footer className="p-8 text-center mt-16" style={{ borderTop: '1px solid var(--theme-border-light)' }}>
        <div className="text-sm" style={{ color: 'var(--theme-text-dim)' }}>
          <a href="/" className="transition-colors" onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}>{s.footer.home}</a>
          <span className="mx-2">·</span>
          <a href="https://github.com/alfaoz/justtype" target="_blank" rel="noopener noreferrer" className="transition-colors" onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}>{s.footer.github}</a>
          <span className="mx-2">·</span>
          <a href="/verify" className="transition-colors" onMouseOver={(e) => e.currentTarget.style.color = 'var(--theme-accent)'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--theme-text-dim)'}>verify</a>
        </div>
      </footer>
    </div>
  );
}
