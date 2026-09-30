/**
 * Zones page — create/edit zones, assign sources.
 * Phase 0: placeholder with empty state.
 */

export function ZonesPage() {
  return (
    <div style={{ padding: '8px' }}>
      <div className="card card-dark" style={{ minHeight: '400px' }}>
        <div className="card-label" style={{ marginBottom: '16px' }}>Zones</div>
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 48, height: 48 }}>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <line x1="12" y1="3" x2="12" y2="21" />
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
          <p>No zones configured yet.</p>
          <p style={{ fontSize: '0.75rem' }}>
            A zone groups cameras and microphones covering the same area.
            Create your first zone to start monitoring.
          </p>
          <button className="pill-btn pill-btn-dark" style={{ marginTop: '8px' }}>
            Create Zone
          </button>
        </div>
      </div>
    </div>
  );
}
