/**
 * Live Feeds — every camera and microphone with the AI overlay, grouped by zone.
 */

import { useState } from 'react';
import { Plus, VideoOff } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import { CameraTile } from '../components/CameraTile';
import { EventFeed } from '../components/EventFeed';
import { AddSourceDialog } from '../components/AddSourceDialog';

export function LiveOpsPage() {
  const s = useSpectra();
  const [adding, setAdding] = useState(false);
  const [zoneFilter, setZoneFilter] = useState<string>('all');
  const zonesWithSources = s.zone_configs.filter(c => s.sources.some(x => x.zone_id === c.id));
  const shown = zoneFilter === 'all' ? zonesWithSources : zonesWithSources.filter(z => z.id === zoneFilter);

  return (
    <>
      {adding && <AddSourceDialog onClose={() => setAdding(false)} />}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="segmented">
          <button className={zoneFilter === 'all' ? 'on' : ''} onClick={() => setZoneFilter('all')}>All zones</button>
          {zonesWithSources.map(z => {
            const st = s.zones[z.id];
            return (
              <button key={z.id} className={zoneFilter === z.id ? 'on' : ''} onClick={() => setZoneFilter(z.id)}>
                <span className="status-dot" style={{ background: st ? `var(--color-risk-${st.alert_level})` : undefined }} />{z.name}
              </button>
            );
          })}
        </div>
        <div className="topbar-spacer" />
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus /> Connect device</button>
      </div>

      <div className="grid-12">
        <div className="span-9" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!s.sources.length && (
            <div className="card empty-state">
              <VideoOff />
              <h3>No feeds connected</h3>
              <p>Add this Mac’s camera and microphone, pair phones by QR code, or loop a recorded video. Each feed appears here with live AI overlays.</p>
              <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus /> Connect device</button>
            </div>
          )}
          {shown.map(cfg => {
            const z = s.zones[cfg.id];
            const srcs = s.sources.filter(x => x.zone_id === cfg.id);
            return (
              <div key={cfg.id} className="card">
                <div className="card-head">
                  <div className="card-title">
                    {cfg.name}
                    {z && <span className={`level-pill level-${z.alert_level}`}>{z.alert_level} · <span className="num">{Math.round(z.risk_score * 100)}</span></span>}
                    {z?.scenario && <span className="sim-badge">drill</span>}
                  </div>
                  {z && <span className="muted num" style={{ fontSize: '0.76rem' }}>{z.people_count} pax · {z.density_ppm2.toFixed(1)}/m² · LoS {z.los}</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                  {srcs.map(src => <CameraTile key={src.id} source={src} />)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="card span-3" style={{ alignSelf: 'start', position: 'sticky', top: 80 }}>
          <div className="card-head"><div className="card-title">Event log</div></div>
          <EventFeed height={560} />
        </div>
      </div>
    </>
  );
}
