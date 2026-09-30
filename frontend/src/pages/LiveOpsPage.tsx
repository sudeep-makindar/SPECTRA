/**
 * Live Ops page — primary monitoring view.
 * Phase 0: layout skeleton with camera tile placeholders.
 * Phase 1+: live camera tiles, alert feed, zone-focused charts.
 */

export function LiveOpsPage() {
  return (
    <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Camera tiles row */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="card card-dark"
            style={{
              minWidth: '280px',
              height: '200px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="4" width="20" height="14" rx="2" />
                <path d="M15 11l5-3v8l-5-3" />
              </svg>
              <p>Camera {i} — No source connected</p>
            </div>
            <div style={{ position: 'absolute', top: '12px', left: '12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span className="status-dot status-dot-offline" />
              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Offline</span>
            </div>
          </div>
        ))}
      </div>

      {/* Bento grid — same layout concept as Overview but focused on live data */}
      <div className="bento-grid">
        {/* Alert feed */}
        <div className="card card-dark" style={{ gridColumn: 'span 2', minHeight: '200px' }}>
          <div className="card-label">Alert Feed</div>
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p>No alerts yet. Alerts appear when risk thresholds are exceeded.</p>
          </div>
        </div>

        {/* Zone risk summary */}
        <div className="card card-dark" style={{ gridColumn: 'span 1', minHeight: '200px' }}>
          <div className="card-label">Zone Risk Summary</div>
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <line x1="12" y1="3" x2="12" y2="21" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
            <p>Create zones and assign sources to see risk levels.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
