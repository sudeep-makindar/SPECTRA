import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, BellOff, FlaskConical, Users } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import { levelFromRisk } from '../lib/types';

const PAGES: Record<string, { title: string; sub: string }> = {
  '/': { title: 'Command Center', sub: 'Live risk across every zone of the venue' },
  '/live': { title: 'Live Feeds', sub: 'Camera and microphone feeds with AI overlays' },
  '/incidents': { title: 'Incidents', sub: 'Evidence, AI briefings and operator actions' },
  '/zones': { title: 'Zones', sub: 'Venue model, thresholds and why each zone scores what it does' },
  '/devices': { title: 'Devices', sub: 'Cameras, microphones and phone nodes' },
  '/system': { title: 'Performance', sub: 'Pipeline latency, resources and detection benchmark' },
};

export function TopBar() {
  const { muted, setMuted, total_people, highest_risk, zones, scenarios, setDrillOpen } = useSpectra();
  const loc = useLocation();
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const page = PAGES[loc.pathname] ?? { title: 'SPECTRA', sub: '' };
  const worst = Object.values(zones).sort((a, b) => b.risk_score - a.risk_score)[0];
  const level = worst?.alert_level ?? levelFromRisk(highest_risk);
  const drill = scenarios[0];

  return (
    <header className="topbar">
      <div className="topbar-title">
        <h1>{page.title}</h1>
        <p>{page.sub}</p>
      </div>
      <div className="topbar-spacer" />
      <span className="chip" title="Highest zone alert level">Venue <span className={`level-pill level-${level}`}>{level}</span></span>
      <span className="chip" title="People detected across all zones"><Users /> <b>{total_people}</b></span>
      <button className={`chip ${drill ? 'drill-on' : ''}`} onClick={() => setDrillOpen(true)} title="Run a simulated drill">
        <FlaskConical />
        {drill ? <>Drill running · <b style={{ fontFamily: 'inherit' }}>{zones[drill.zone_id]?.name ?? drill.zone_id}</b></> : 'Drills'}
      </button>
      <button className="chip" onClick={() => setMuted(!muted)} title="Alert tone (M)">
        {muted ? <BellOff /> : <Bell />} {muted ? 'Muted' : 'Tone on'}
      </button>
      <span className="chip"><b>{now.toLocaleTimeString([], { hour12: false })}</b></span>
    </header>
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
      <span className={`level-pill level-${worst.alert_level}`}>{worst.alert_level}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="alert-banner-title">
          {worst.name} · risk <span className="num">{Math.round(worst.risk_score * 100)}</span>
          {alarmZones.length > 1 && <span className="dim" style={{ fontWeight: 400 }}>+{alarmZones.length - 1} more zone{alarmZones.length > 2 ? 's' : ''}</span>}
          {worst.scenario && <span className="sim-badge">drill</span>}
        </div>
        <div className="alert-banner-sub">{worst.reasons.slice(0, 2).join(' · ')}</div>
      </div>
      {worst.open_incident_id && (
        <button className="btn" onClick={() => navigate(`/incidents?id=${worst.open_incident_id}`)}>View incident</button>
      )}
      <button className="btn btn-primary" onClick={acknowledgeAll}>Acknowledge <span className="kbd" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }}>A</span></button>
    </div>
  );
}
