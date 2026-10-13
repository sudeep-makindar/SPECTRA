import { useNavigate } from 'react-router-dom';
import { useSpectra } from '../context/SpectraContext';
import { fmtTime } from '../lib/types';

export function EventFeed({ limit = 40, zoneId, height = 320 }: { limit?: number; zoneId?: string; height?: number }) {
  const { events } = useSpectra();
  const navigate = useNavigate();
  const list = events.filter(e => !zoneId || e.zone_id === zoneId).slice(-limit).reverse();
  if (!list.length) {
    return <div className="dim" style={{ fontSize: '0.8rem', padding: '20px 0' }}>No events yet. Alert changes, incidents, AI briefs and operator actions appear here.</div>;
  }
  return (
    <div className="feed" style={{ maxHeight: height }}>
      {list.map(e => (
        <div key={e.id} className={`feed-item ${e.incident_id ? 'clickable' : ''}`}
          onClick={() => e.incident_id && navigate(`/incidents?id=${e.incident_id}`)}>
          <span className="dim num" style={{ fontSize: '0.7rem', paddingTop: 1 }}>{fmtTime(e.ts)}</span>
          <span className={`feed-dot sev-${e.severity}`} aria-label={e.severity} />
          <span>
            {e.message}
            {e.simulated && <span className="sim-badge" style={{ marginLeft: 6 }}>drill</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
