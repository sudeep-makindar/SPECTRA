/**
 * Overview page — dashboard landing with aggregate stats.
 * Phase 0: skeleton layout with placeholder cards.
 * Phase 1+: live data from WebSocket.
 */

import { useState } from 'react';
import { useSpectraSocket } from '../hooks/useSpectraSocket';
import { AddSourceDialog } from '../components/AddSourceDialog';

export function OverviewPage() {
  const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
  const state = useSpectraSocket();

  const activeSources = state.active_sources;
  const totalSources = state.total_sources;
  
  // Calculate stroke dasharray for the circular progress (circumference ~ 326 for r=52)
  const riskPercent = state.highest_risk;
  
  const getRiskColor = (risk: number) => {
    if (risk >= 0.8) return 'var(--color-critical, #ef4444)';
    if (risk >= 0.55) return 'var(--color-high, #f97316)';
    if (risk >= 0.3) return 'var(--color-elevated, #eab308)';
    return 'var(--color-sage)';
  };

  return (
    <div className="bento-grid" style={{ padding: '8px' }}>
      {isAddSourceOpen && (
        <AddSourceDialog 
          onClose={() => setIsAddSourceOpen(false)} 
          onSourceAdded={() => {}} 
        />
      )}
      {/* Headline stat card (cream) — Total Headcount */}
      <div className="card card-cream" style={{ gridColumn: 'span 1' }}>
        <div className="card-label">Active Sources</div>
        <div className="card-value tabular-nums">{activeSources} / {totalSources}</div>
        <div className="card-tag">Cameras & nodes</div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          <button className="pill-btn pill-btn-dark pill-btn-sm">Acknowledge</button>
          <button className="pill-btn pill-btn-outlined pill-btn-sm">Escalate</button>
        </div>
      </div>

      {/* Risk gauge (dark) — Global risk */}
      <div className="card card-dark" style={{ gridColumn: 'span 1' }}>
        <div className="card-label">Global Risk</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '120px' }}>
          <div style={{
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            border: '8px solid var(--color-charcoal-lighter)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute',
              inset: '0',
              borderRadius: '50%',
              border: '8px solid transparent',
              borderTopColor: getRiskColor(riskPercent),
              borderRightColor: riskPercent > 0.25 ? getRiskColor(riskPercent) : 'transparent',
              borderBottomColor: riskPercent > 0.5 ? getRiskColor(riskPercent) : 'transparent',
              borderLeftColor: riskPercent > 0.75 ? getRiskColor(riskPercent) : 'transparent',
              transform: 'rotate(-45deg)',
              transition: 'all 0.3s ease-out'
            }} />
            <span className="pill-btn pill-btn-sm" style={{
              background: 'var(--color-surface-overlay)',
              color: 'var(--color-text-primary)',
              border: 'none',
              fontSize: '1rem',
              fontWeight: 600,
              zIndex: 1,
            }}>
              {(riskPercent * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '16px', marginTop: '8px', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
            <span className="status-dot" style={{ background: 'var(--color-sage)' }} />Vision
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
            <span className="status-dot" style={{ background: 'var(--color-lavender)' }} />Audio
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
            <span className="status-dot" style={{ background: 'var(--color-cream)' }} />Motion
          </div>
        </div>
      </div>

      {/* Quick actions column */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div className="card card-sage" style={{ flex: 1, display: 'flex', alignItems: 'flex-end', cursor: 'pointer' }}>
          <div className="card-title-display">ACKNOWLEDGE</div>
          <div className="card-corner-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 13L13 1M13 1H5M13 1v8" /></svg>
          </div>
        </div>
        <div className="card card-lavender" style={{ flex: 1, display: 'flex', alignItems: 'flex-end', cursor: 'pointer' }}>
          <div className="card-title-display">INCIDENT REPLAY</div>
          <div className="card-corner-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 13L13 1M13 1H5M13 1v8" /></svg>
          </div>
        </div>
        <div 
          className="card card-cream" 
          style={{ flex: 1, display: 'flex', alignItems: 'flex-end', cursor: 'pointer' }}
          onClick={() => setIsAddSourceOpen(true)}
        >
          <div className="card-title-display">ADD SOURCE</div>
          <div className="card-corner-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="7" y1="1" x2="7" y2="13" /><line x1="1" y1="7" x2="13" y2="7" /></svg>
          </div>
        </div>
      </div>

      {/* Density sparkline (sage) */}
      <div className="card card-sage" style={{ gridColumn: 'span 1' }}>
        <div className="card-label">Crowd Density</div>
        <div style={{ height: '60px', display: 'flex', alignItems: 'flex-end' }}>
          {/* Placeholder sparkline — replaced with Recharts in Phase 1 */}
          <svg width="100%" height="60" viewBox="0 0 200 60" preserveAspectRatio="none">
            <polyline
              points="0,55 20,50 40,45 60,40 80,42 100,38 120,35 140,30 160,33 180,28 200,32"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              opacity="0.5"
            />
          </svg>
        </div>
        <div className="card-value card-value-sm tabular-nums" style={{ marginTop: '8px' }}>—</div>
        <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: '2px' }}>No active zone selected</div>
      </div>

      {/* Zone controls (dark) — Exchange card equivalent */}
      <div className="card card-dark" style={{ gridColumn: 'span 1' }}>
        <div className="card-label" style={{ marginBottom: '16px' }}>Zone Controls</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="input-group">
            <div className="input-chip">Zone</div>
            <select style={{
              flex: 1, background: 'none', border: 'none',
              color: 'var(--color-text-primary)', fontFamily: 'var(--font-sans)',
              fontSize: '0.875rem', outline: 'none', cursor: 'pointer',
            }}>
              {Object.values(state.zones).length > 0 ? (
                Object.values(state.zones).map(z => (
                  <option key={z.zone_id}>{z.name} ({(z.risk_score * 100).toFixed(0)}%)</option>
                ))
              ) : (
                <option>No zones configured</option>
              )}
            </select>
          </div>
          <div className="input-group">
            <div className="input-chip">Sensitivity</div>
            <input type="number" placeholder="0.50" step="0.05" min="0" max="1" />
          </div>
          <button className="pill-btn pill-btn-light" style={{ width: '100%' }}>
            Apply
          </button>
        </div>
      </div>

      {/* Audio level sparkline (lavender) */}
      <div className="card card-lavender" style={{ gridColumn: 'span 1' }}>
        <div className="card-label">Audio Level</div>
        <div style={{ height: '60px', display: 'flex', alignItems: 'flex-end' }}>
          <svg width="100%" height="60" viewBox="0 0 200 60" preserveAspectRatio="none">
            <polyline
              points="0,50 15,48 30,35 45,52 60,30 75,55 90,25 105,45 120,50 135,42 150,38 165,45 180,40 200,48"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              opacity="0.5"
            />
          </svg>
        </div>
        <div className="card-value card-value-sm tabular-nums" style={{ marginTop: '8px' }}>—</div>
        <div style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: '2px' }}>No audio sources</div>
      </div>
    </div>
  );
}
