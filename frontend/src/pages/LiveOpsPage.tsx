/**
 * Live Ops — every feed with the AI overlay, grouped by zone, beside the
 * event log and a compact scenario director.
 */

import { useState } from 'react';
import { useSpectra } from '../context/SpectraContext';
import { CameraTile } from '../components/CameraTile';
import { EventFeed } from '../components/EventFeed';
import { AddSourceDialog } from '../components/AddSourceDialog';
import { ScenarioPanel } from '../components/ScenarioPanel';

export function LiveOpsPage() {
  const s = useSpectra();
  const [adding, setAdding] = useState(false);

  return (
    <div className="page">
      {adding && <AddSourceDialog onClose={() => setAdding(false)} />}
      <div className="grid-12">
        <div className="span-9" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.sources.length === 0 && (
            <div className="card card-dark" style={{ minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
              <div className="display" style={{ fontSize: '2rem' }}>No feeds yet</div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>Add this Mac's camera and mic, pair a phone by QR, or loop a recorded video.</div>
              <button className="btn btn-primary" onClick={() => setAdding(true)}>Connect device</button>
            </div>
          )}
          {s.zone_configs.map(cfg => {
            const srcs = s.sources.filter(x => x.zone_id === cfg.id);
            if (!srcs.length) return null;
            const z = s.zones[cfg.id];
            return (
              <div key={cfg.id} className="card card-dark" style={{ padding: 14 }}>
                <div className="section-title" style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="zone-name" style={{ fontSize: '1.2rem' }}>{cfg.name}</span>
                    {z && <span className={`level-pill level-${z.alert_level}`}>{z.alert_level} · {Math.round(z.risk_score * 100)}</span>}
                    {z?.scenario && <span className="sim-badge">sim</span>}
                  </div>
                  {z && <span className="muted" style={{ fontSize: '0.75rem' }}>{z.people_count} pax · {z.density_ppm2.toFixed(1)}/m² · LoS {z.los}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8 }}>
                  {srcs.map(src => <CameraTile key={src.id} source={src} />)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="span-3" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="card card-lavender" style={{ border: 'none', textAlign: 'left', cursor: 'pointer', padding: 20 }} onClick={() => setAdding(true)}>
            <div className="card-title-display">Connect device</div>
            <div style={{ fontSize: '0.75rem', marginTop: 6 }}>Mac camera · mic · phone QR · RTSP</div>
          </button>
          <div className="card card-dark">
            <div className="card-label">Event log</div>
            <EventFeed height={420} />
          </div>
          <ScenarioPanel compact />
        </div>
      </div>
    </div>
  );
}
