import { TrendingUp } from 'lucide-react';
import { RiskDial } from './RiskDial';
import { LEVEL_COLOR, MODALITY_COLOR } from '../lib/types';
import type { ZoneState } from '../lib/types';

function ModalityBar({ name, score, simulated, context }: { name: 'vision' | 'motion' | 'audio'; score: number; simulated: boolean; context: string }) {
  return (
    <div className="mbar" title={context}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }} className="muted">
        <i style={{ width: 8, height: 8, borderRadius: 2, background: MODALITY_COLOR[name], display: 'inline-block' }} />
        <span style={{ textTransform: 'capitalize' }}>{name}</span>
      </span>
      <div className="mbar-track">
        <div className={`mbar-fill ${simulated ? 'sim' : ''}`} style={{ width: `${Math.round(score * 100)}%`, background: MODALITY_COLOR[name] }} />
      </div>
      <span className="num" style={{ textAlign: 'right', fontSize: '0.74rem' }}>{Math.round(score * 100)}</span>
    </div>
  );
}

const LOS_COLOR = (los: string) => (los >= 'E' ? 'var(--color-risk-critical)' : los >= 'D' ? 'var(--color-risk-high)' : undefined);

export function ZoneCard({ zone, selected, onClick }: { zone: ZoneState; selected?: boolean; onClick?: () => void }) {
  const z = zone;
  const eta = z.forecast?.eta_critical_s;
  const noSensors = !z.source_ids.length;
  return (
    <div className={`card zone-card ${z.alert_level === 'critical' ? 'critical' : ''} ${selected ? 'selected' : ''}`}
      style={{ ['--zc' as string]: z.blind_spot ? 'var(--color-border-strong)' : LEVEL_COLOR[z.alert_level] }} onClick={onClick}>
      <div className="zone-head">
        <div style={{ minWidth: 0 }}>
          <div className="zone-name">{z.name}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {z.blind_spot ? <span className="level-pill level-blind">blind spot</span> : <span className={`level-pill level-${z.alert_level}`}>{z.alert_level}</span>}
            {z.scenario && <span className="sim-badge">drill</span>}
            {z.corroborated && <span className="tag accent">Corroborated</span>}
          </div>
        </div>
        <RiskDial risk={z.risk_score} level={z.alert_level} size={72} stroke={7} />
      </div>

      <div className="zone-metrics">
        <div><div className="card-label">People</div><div className="v">{z.people_count}</div></div>
        <div><div className="card-label">Density</div><div className="v">{z.density_ppm2.toFixed(1)}<span className="dim" style={{ fontSize: '0.68rem' }}> /m²</span></div></div>
        <div title={z.los_desc}><div className="card-label">Fruin LoS</div><div className="v" style={{ color: LOS_COLOR(z.los) }}>{z.los}</div></div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <ModalityBar name="vision" {...z.vision} />
        <ModalityBar name="motion" {...z.motion} />
        <ModalityBar name="audio" {...z.audio} />
      </div>

      {eta != null && z.alert_level !== 'critical' && (
        <div className="forecast"><TrendingUp size={14} /> Trending to CRITICAL in ~{Math.round(eta)}s</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 20 }}>
        {z.reasons.slice(0, 3).map(r => <div className="reason" key={r}>{r}</div>)}
        {!z.reasons.length && <div className="reason">{noSensors ? 'No sensors assigned to this zone' : 'All signals within normal range'}</div>}
      </div>
    </div>
  );
}
