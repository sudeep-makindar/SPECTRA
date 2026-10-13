/**
 * Command Center — the operator's single pane of glass.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, Siren, Users, X } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import { RiskDial } from '../components/RiskDial';
import { VenueMap } from '../components/VenueMap';
import { ZoneCard } from '../components/ZoneCard';
import { RiskTimeline } from '../components/RiskTimeline';
import { EventFeed } from '../components/EventFeed';
import { CopilotPanel } from '../components/CopilotPanel';
import { AddSourceDialog } from '../components/AddSourceDialog';
import type { ConnectTab } from '../components/AddSourceDialog';
import { levelFromRisk } from '../lib/types';

function flag(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function GettingStarted({ onConnect }: { onConnect: (t: ConnectTab) => void }) {
  const s = useSpectra();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => flag('spectra.onboarding.hidden'));
  const steps = [
    { title: 'Connect a camera', body: 'This Mac, a phone by QR code, or an RTSP stream.', done: s.sources.some(x => x.kind === 'video'), go: () => onConnect('phone') },
    { title: 'Add audio', body: 'Mac microphone or a phone node, for screams and distress words.', done: s.sources.some(x => x.has_audio), go: () => onConnect('mac') },
    { title: 'Calibrate zones', body: 'Set each zone’s floor area so headcount becomes people per m².', done: flag('spectra.zones.calibrated'), go: () => navigate('/zones') },
    { title: 'Run a drill', body: 'Play a scripted scenario to see the full alert → incident → briefing flow.', done: s.incidents.length > 0, go: () => s.setDrillOpen(true) },
  ];
  if (hidden || steps.every(x => x.done)) return null;
  const doneCount = steps.filter(x => x.done).length;
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">Get started <span className="sub">{doneCount} of {steps.length} complete</span></div>
        <button className="btn btn-ghost btn-sm" onClick={() => { setHidden(true); try { localStorage.setItem('spectra.onboarding.hidden', '1'); } catch { /* ignore */ } }}><X /> Dismiss</button>
      </div>
      <div className="steps">
        {steps.map((st, i) => (
          <button key={st.title} className={`step ${st.done ? 'done' : ''}`} onClick={st.go}>
            <span className="step-num">{st.done ? '✓' : i + 1}</span>
            <span><b>{st.title}</b><span>{st.body}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function OverviewPage() {
  const s = useSpectra();
  const navigate = useNavigate();
  const [connect, setConnect] = useState<ConnectTab | null>(null);
  const zones = s.zone_configs.map(c => s.zones[c.id]).filter(Boolean);
  const worst = [...zones].sort((a, b) => b.risk_score - a.risk_score)[0];
  const peakDensity = Math.max(0, ...zones.map(z => z.density_ppm2));
  const peakLos = zones.reduce((acc, z) => (z.los > acc ? z.los : acc), 'A');
  const open = s.incidents.filter(i => !i.ended_at && i.status !== 'resolved');
  const unacked = open.filter(i => i.status === 'open');
  const level = worst?.alert_level ?? levelFromRisk(s.highest_risk);
  const e2e = s.metrics.latencies?.e2e?.p95;
  const blind = zones.filter(z => z.blind_spot).length;

  return (
    <>
      {connect && <AddSourceDialog initialTab={connect} onClose={() => setConnect(null)} />}
      <GettingStarted onConnect={setConnect} />

      <div className="grid-12">
        <div className="card span-3" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <RiskDial risk={s.highest_risk} level={level} size={84} stroke={8} label="peak" />
          <div className="kpi">
            <div className="card-label" style={{ marginBottom: 0 }}>Venue status</div>
            <span className={`level-pill level-${level}`} style={{ alignSelf: 'flex-start' }}>{level}</span>
            <div className="kpi-sub">{worst ? `Highest: ${worst.name}` : 'No zones'}</div>
          </div>
        </div>
        <div className="card span-3 kpi">
          <div className="kpi-top"><div className="card-label" style={{ marginBottom: 0 }}>People on site</div><span className="kpi-icon"><Users /></span></div>
          <div className="kpi-value">{s.total_people}</div>
          <div className="kpi-sub">Peak {peakDensity.toFixed(1)} /m² · worst LoS <b>{peakLos}</b></div>
        </div>
        <div className="card span-3 kpi clickable" onClick={() => navigate('/incidents')}>
          <div className="kpi-top"><div className="card-label" style={{ marginBottom: 0 }}>Open incidents</div><span className="kpi-icon" style={unacked.length ? { color: 'var(--color-risk-critical)' } : undefined}><Siren /></span></div>
          <div className="kpi-value">{open.length}</div>
          <div className="kpi-sub">{unacked.length ? `${unacked.length} awaiting acknowledgement` : `${s.incidents.length} recorded this session`}</div>
        </div>
        <div className="card span-3 kpi clickable" onClick={() => navigate('/devices')}>
          <div className="kpi-top"><div className="card-label" style={{ marginBottom: 0 }}>Sensors online</div><span className="kpi-icon"><Radio /></span></div>
          <div className="kpi-value">{s.active_sources}<small> / {s.total_sources}</small></div>
          <div className="kpi-sub">{blind ? <span style={{ color: 'var(--color-risk-elevated)' }}>{blind} zone{blind > 1 ? 's' : ''} blind</span> : e2e != null ? `${Math.round(e2e)} ms capture → alert (p95)` : 'No sensors connected'}</div>
        </div>

        <div className="card span-8">
          <div className="card-head">
            <div className="card-title">Venue map <span className="sub">live occupancy and risk · click a zone to focus</span></div>
            <div className="legend">
              {(['normal', 'elevated', 'high', 'critical'] as const).map(l => <span key={l}><i style={{ background: `var(--color-risk-${l})`, height: 8, width: 8, borderRadius: 2 }} />{l[0].toUpperCase() + l.slice(1)}</span>)}
            </div>
          </div>
          <VenueMap selected={s.focusZone} onSelect={id => s.setFocusZone(s.focusZone === id ? null : id)} />
        </div>
        <div className="span-4"><CopilotPanel /></div>

        {zones.map(z => (
          <div key={z.zone_id} className="span-4">
            <ZoneCard zone={z} selected={s.focusZone === z.zone_id} onClick={() => s.setFocusZone(s.focusZone === z.zone_id ? null : z.zone_id)} />
          </div>
        ))}

        <div className="card span-8">
          <div className="card-head">
            <div className="card-title">Fused risk <span className="sub">last 2 minutes · dashed lines are alert thresholds</span></div>
          </div>
          <RiskTimeline zones={zones} height={230} />
        </div>
        <div className="card span-4">
          <div className="card-head"><div className="card-title">Event log</div></div>
          <EventFeed height={268} />
        </div>
      </div>
    </>
  );
}
