/**
 * Incidents page — table + detail view.
 * Phase 0: placeholder.
 */

export function IncidentsPage() {
  return (
    <div style={{ padding: '8px' }}>
      <div className="card card-dark" style={{ minHeight: '400px' }}>
        <div className="card-label" style={{ marginBottom: '16px' }}>Incidents</div>
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 48, height: 48 }}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <p>No incidents recorded.</p>
          <p style={{ fontSize: '0.75rem' }}>
            Incidents are created when a zone's risk level reaches HIGH or above.
            Each incident includes a video clip, audio snippet, score timeline, and narrative.
          </p>
        </div>
      </div>
    </div>
  );
}
