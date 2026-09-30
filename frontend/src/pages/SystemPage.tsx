/**
 * System page — latency breakdown, per-source stats, device info.
 * Phase 0: fetches /api/health and /api/metrics on load.
 */

import { useEffect, useState } from 'react';

interface HealthData {
  status: string;
  version: string;
  device: {
    selected_device: string;
    pytorch_version: string | null;
    mps_available: boolean;
    ram_total_gb?: number;
    ram_available_gb?: number;
    cpu_count?: number;
  };
  sim_mode: boolean;
}

interface MetricsData {
  uptime_s: number;
  latencies: Record<string, { p50: number | null; p95: number | null; count: number }>;
  sources: Record<string, unknown>;
}

export function SystemPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/health').then(r => r.json()),
      fetch('/api/metrics').then(r => r.json()),
    ])
      .then(([h, m]) => { setHealth(h); setMetrics(m); })
      .catch(e => setError(`Could not reach the backend. Is it running? (${e.message})`));
  }, []);

  if (error) {
    return (
      <div style={{ padding: '8px' }}>
        <div className="card card-dark" style={{ minHeight: '200px' }}>
          <div className="card-label">System Status</div>
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" strokeWidth="1.5" style={{ width: 48, height: 48 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '8px' }}>
      <div className="bento-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {/* Device info */}
        <div className="card card-dark">
          <div className="card-label" style={{ marginBottom: '16px' }}>Device</div>
          {health ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>Status</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="status-dot status-dot-online" />
                  <span className="tabular-nums" style={{ fontSize: '0.85rem' }}>{health.status}</span>
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>Compute</span>
                <span className="badge" style={{
                  background: health.device.selected_device === 'mps' ? 'var(--color-lavender)' : 'var(--color-charcoal-lighter)',
                  color: health.device.selected_device === 'mps' ? 'var(--color-charcoal)' : 'var(--color-text-secondary)',
                }}>
                  {health.device.selected_device.toUpperCase()}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>PyTorch</span>
                <span style={{ fontSize: '0.85rem' }} className="tabular-nums">{health.device.pytorch_version ?? 'Not installed'}</span>
              </div>
              {health.device.ram_total_gb && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>RAM</span>
                  <span style={{ fontSize: '0.85rem' }} className="tabular-nums">
                    {health.device.ram_available_gb} / {health.device.ram_total_gb} GB
                  </span>
                </div>
              )}
              {health.device.cpu_count && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>CPU cores</span>
                  <span style={{ fontSize: '0.85rem' }} className="tabular-nums">{health.device.cpu_count}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>Version</span>
                <span style={{ fontSize: '0.85rem' }}>{health.version}</span>
              </div>
              {health.sim_mode && (
                <div style={{ marginTop: '4px' }}>
                  <span className="badge badge-sim">SIM MODE</span>
                </div>
              )}
            </div>
          ) : (
            <div className="skeleton" style={{ height: '160px' }} />
          )}
        </div>

        {/* Latency breakdown */}
        <div className="card card-dark">
          <div className="card-label" style={{ marginBottom: '16px' }}>Pipeline Latency (60 s window)</div>
          {metrics ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {['ingest', 'dequeue', 'inference', 'fusion', 'alert'].map((stage) => {
                const data = metrics.latencies[stage];
                return (
                  <div key={stage} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem', textTransform: 'capitalize' }}>{stage}</span>
                    <span className="tabular-nums" style={{ fontSize: '0.85rem' }}>
                      {data?.p50 != null ? `${data.p50} ms` : '—'}
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', marginLeft: '8px' }}>
                        p95: {data?.p95 != null ? `${data.p95} ms` : '—'}
                      </span>
                    </span>
                  </div>
                );
              })}
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '8px', marginTop: '4px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>Uptime</span>
                <span className="tabular-nums" style={{ fontSize: '0.85rem' }}>
                  {Math.floor(metrics.uptime_s / 60)}m {Math.floor(metrics.uptime_s % 60)}s
                </span>
              </div>
            </div>
          ) : (
            <div className="skeleton" style={{ height: '160px' }} />
          )}
        </div>

        {/* Source stats (span 2) */}
        <div className="card card-dark" style={{ gridColumn: 'span 2' }}>
          <div className="card-label" style={{ marginBottom: '16px' }}>Source Health</div>
          {metrics && Object.keys(metrics.sources).length > 0 ? (
            <div>Source stats table will go here in Phase 1</div>
          ) : (
            <div className="empty-state">
              <p>No sources registered yet. Add sources to see per-source FPS, dropped frames, and queue depth.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
