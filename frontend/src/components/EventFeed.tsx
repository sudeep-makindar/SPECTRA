import { useNavigate } from 'react-router-dom';
import { useSpectra } from '../context/SpectraContext';
import { fmtTime } from '../lib/types';

export function EventFeed({ limit = 40, zoneId, height = 320 }: { limit?: number; zoneId?: string; height?: number }) {
  const { events } = useSpectra();
  const navigate = useNavigate();
  const list = events.filter(e => !zoneId || e.zone_id === zoneId).slice(-limit).reverse();
  if (!list.length) {
    return <div className="dim" style={{ fontSize: '0.8rem', padding: '24px 4px' }}>No events yet. Risk changes, incidents, AI briefs and operator actions appear here.</div>;
  }
  return (
    <div className="feed" style={{ maxHeight: height }}>
      {list.map(e => (
        <div key={e.id} className="feed-item" style={{ cursor: e.incident_id ? 'pointer' : undefined }}
          onClick={() => e.incident_id && navigate(`/incidents?id=${e.incident_id}`)}>
          <span className="dim mono" style={{ fontSize: '0.68rem', paddingTop: 1 }}>{fmtTime(e.ts)}</span>
          <span className={`feed-dot sev-${e.severity}`} aria-label={e.severity} />
          <span>
            {e.message}
            {e.simulated && <span className="sim-badge" style={{ marginLeft: 6, fontSize: '0.55rem', padding: '0 6px' }}>sim</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
