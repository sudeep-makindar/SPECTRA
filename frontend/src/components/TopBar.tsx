import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSpectra } from '../context/SpectraContext';

const TITLES: Record<string, string> = {
  '/': 'Command Center',
  '/live': 'Live Ops',
  '/zones': 'Zones',
  '/incidents': 'Incidents',
  '/system': 'System & Evaluation',
};

export function TopBar() {
  const { connected, muted, setMuted, active_sources, total_sources, total_people, metrics } = useSpectra();
  const loc = useLocation();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const e2e = metrics.latencies?.e2e?.p95;

  return (
    <div className="topbar">
      <div className="topbar-title">{TITLES[loc.pathname] ?? 'SPECTRA'}</div>
      <span className={`chip ${connected ? 'chip-live' : ''}`}>
        <span className={`status-dot ${connected ? 'status-dot-online' : 'status-dot-error'}`} />
        {connected ? 'LIVE' : 'RECONNECTING'}
      </span>
      <div className="topbar-spacer" />
      <span className="chip" title="People currently detected across all zones">👥 <b className="tabular-nums">{total_people}</b></span>
      <span className="chip" title="Sources online">◉ <b className="tabular-nums">{active_sources}/{total_sources}</b> sources</span>
      {e2e != null && <span className="chip" title="Capture → fusion latency, p95 (30 s)">⚡ <b className="tabular-nums">{Math.round(e2e)}</b> ms p95</span>}
      <span className="chip" title="All inference runs on this machine">🔒 On-device</span>
      <button className="chip" onClick={() => setMuted(!muted)} title="Alert tone (M)">
        {muted ? '🔕 Muted' : '🔔 Tone on'}
      </button>
      <span className="chip mono tabular-nums">{now.toLocaleTimeString([], { hour12: false })}</span>
    </div>
  );
}

export function AlertBanner() {
  const { alarmZones, acknowledgeAll } = useSpectra();
  const navigate = useNavigate();
  if (!alarmZones.length) return null;
  const worst = [...alarmZones].sort((a, b) => b.risk_score - a.risk_score)[0];
  const critical = worst.alert_level === 'critical';
  return (
    <div className={`alert-banner ${critical ? '' : 'high'}`} role="alert">
      <span className="display">{worst.alert_level}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>
          {worst.name}{alarmZones.length > 1 ? ` + ${alarmZones.length - 1} more zone${alarmZones.length > 2 ? 's' : ''}` : ''}
          {worst.scenario && <span className="sim-badge" style={{ marginLeft: 8, borderColor: 'currentColor', color: 'inherit' }}>simulation</span>}
        </div>
        <div style={{ fontSize: '0.8rem', opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {worst.reasons.slice(0, 2).join(' · ')}
        </div>
      </div>
      {worst.open_incident_id && (
        <button className="btn" style={{ background: 'rgba(0,0,0,0.25)', color: 'inherit', borderColor: 'transparent' }}
          onClick={() => navigate(`/incidents?id=${worst.open_incident_id}`)}>Open incident</button>
      )}
      <button className="btn" style={{ background: '#fff', color: '#141417', borderColor: '#fff' }} onClick={acknowledgeAll}>
        Acknowledge <span className="kbd" style={{ borderColor: 'rgba(0,0,0,0.2)', color: '#141417' }}>A</span>
      </button>
    </div>
  );
}
