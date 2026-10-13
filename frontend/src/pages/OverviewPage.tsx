/**
 * Command Center — the operator's single pane of glass.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpectra } from '../context/SpectraContext';
import { RiskDial } from '../components/RiskDial';
import { VenueMap } from '../components/VenueMap';
import { ZoneCard } from '../components/ZoneCard';
import { RiskTimeline } from '../components/RiskTimeline';
import { EventFeed } from '../components/EventFeed';
import { CopilotPanel } from '../components/CopilotPanel';
import { ScenarioPanel } from '../components/ScenarioPanel';
import { AddSourceDialog } from '../components/AddSourceDialog';
import { levelFromRisk } from '../lib/types';

export function OverviewPage() {
  const s = useSpectra();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const zones = s.zone_configs.map(c => s.zones[c.id]).filter(Boolean);
  const worst = [...zones].sort((a, b) => b.risk_score - a.risk_score)[0];
  const peakDensity = Math.max(0, ...zones.map(z => z.density_ppm2));
  const peakLos = zones.reduce((acc, z) => (z.los > acc ? z.los : acc), 'A');
  const openIncidents = s.incidents.filter(i => !i.ended_at && i.status !== 'resolved');
  const e2e = s.metrics.latencies?.e2e;
  const level = worst?.alert_level ?? levelFromRisk(s.highest_risk);

  return (
    <div className="page">
      {adding && <AddSourceDialog onClose={() => setAdding(false)} />}

      <div className="grid-12">
        {/* KPI row */}
        <div className="card card-dark stat span-3" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <RiskDial risk={s.highest_risk} level={level} size={96} stroke={9} label="peak" />
          <div>
            <div className="card-label">Venue risk</div>
            <span className={`level-pill level-${level}`}>{level}</span>
            <div className="stat-sub" style={{ marginTop: 8 }}>{worst ? `Hottest: ${worst.name}` : 'No zones'}</div>
          </div>
        </div>
        <div className="card card-cream stat span-3">
          <div className="card-label">People on site</div>
          <div className="stat-value">{s.total_people}</div>
          <div className="stat-sub">Peak density {peakDensity.toFixed(1)}/m² · worst LoS {peakLos}</div>
        </div>
        <div className="card card-lavender stat span-3" style={{ cursor: 'pointer' }} onClick={() => navigate('/incidents')}>
          <div className="card-label">Open incidents</div>
          <div className="stat-value">{openIncidents.length}</div>
          <div className="stat-sub">{s.incidents.length} this session · press <b>A</b> to acknowledge</div>
          <div className="card-corner-icon"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 13L13 1M13 1H5M13 1v8" /></svg></div>
        </div>
        <div className="card card-sage stat span-3" style={{ cursor: 'pointer' }} onClick={() => setAdding(true)}>
          <div className="card-label">Sensors online</div>
          <div className="stat-value">{s.active_sources}<span style={{ fontSize: '1.1rem', opacity: 0.6 }}> / {s.total_sources}</span></div>
          <div className="stat-sub">{e2e?.p95 != null ? `${Math.round(e2e.p95)} ms capture→alert p95` : 'Connect a camera, phone or mic'}</div>
          <div className="card-corner-icon"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="7" y1="1" x2="7" y2="13" /><line x1="1" y1="7" x2="13" y2="7" /></svg></div>
        </div>

        {/* Map + co-pilot */}
        <div className="card card-dark span-7">
          <div className="section-title">
            <div className="card-label" style={{ marginBottom: 0 }}>Venue digital twin · live occupancy</div>
            <div className="legend">
              <span><i style={{ background: 'var(--color-risk-normal)' }} />Normal</span>
              <span><i style={{ background: 'var(--color-risk-elevated)' }} />Elevated</span>
              <span><i style={{ background: 'var(--color-risk-high)' }} />High</span>
              <span><i style={{ background: 'var(--color-risk-critical)' }} />Critical</span>
            </div>
          </div>
          <VenueMap selected={s.focusZone} onSelect={id => s.setFocusZone(s.focusZone === id ? null : id)} />
        </div>
        <div className="span-5"><CopilotPanel /></div>

        {/* Zones */}
        {zones.map(z => (
          <div key={z.zone_id} className="span-4">
            <ZoneCard zone={z} selected={s.focusZone === z.zone_id}
              onClick={() => s.setFocusZone(s.focusZone === z.zone_id ? null : z.zone_id)} />
          </div>
        ))}

        {/* Timeline + feed */}
        <div className="card card-dark span-8">
          <div className="section-title">
            <div className="card-label" style={{ marginBottom: 0 }}>Fused risk · last 2 minutes</div>
            <span className="dim" style={{ fontSize: '0.7rem' }}>Dashed lines = alert thresholds (hysteresis applies on the way down)</span>
          </div>
          <RiskTimeline zones={zones} height={230} />
        </div>
        <div className="card card-dark span-4">
          <div className="section-title"><div className="card-label" style={{ marginBottom: 0 }}>Event log</div></div>
          <EventFeed height={262} />
        </div>

        <div className="span-12"><ScenarioPanel /></div>
      </div>
    </div>
  );
}
