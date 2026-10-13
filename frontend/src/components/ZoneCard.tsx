import { RiskDial } from './RiskDial';
import { MODALITY_COLOR } from '../lib/types';
import type { ZoneState } from '../lib/types';

function ModalityBar({ name, score, simulated, context }: { name: 'vision' | 'motion' | 'audio'; score: number; simulated: boolean; context: string }) {
  return (
    <div className="mbar" title={context}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i style={{ width: 8, height: 8, borderRadius: 2, background: MODALITY_COLOR[name], display: 'inline-block' }} />
        <span className="muted" style={{ textTransform: 'capitalize' }}>{name}</span>
      </span>
      <div className="mbar-track">
        <div className={`mbar-fill ${simulated ? 'sim' : ''}`} style={{ width: `${Math.round(score * 100)}%`, background: MODALITY_COLOR[name] }} />
      </div>
      <span className="tabular-nums" style={{ textAlign: 'right' }}>{Math.round(score * 100)}</span>
    </div>
  );
}

export function ZoneCard({ zone, selected, onClick }: { zone: ZoneState; selected?: boolean; onClick?: () => void }) {
  const z = zone;
  const eta = z.forecast?.eta_critical_s;
  return (
    <div className={`card card-dark zone-card ${z.alert_level} ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="zone-head">
        <div style={{ minWidth: 0 }}>
          <div className="zone-name">{z.name}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <span className={`level-pill level-${z.alert_level}`}>{z.alert_level}</span>
            {z.scenario && <span className="sim-badge">Sim</span>}
            {z.blind_spot && <span className="level-pill" style={{ background: 'var(--color-degraded)' }}>Blind</span>}
            {z.corroborated && <span className="chip chip-ai" style={{ padding: '2px 8px', fontSize: '0.62rem' }}>✓ Corroborated</span>}
          </div>
        </div>
        <RiskDial risk={z.risk_score} level={z.alert_level} size={84} stroke={8} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <div>
          <div className="card-label">People</div>
          <div className="tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700 }}>{z.people_count}</div>
        </div>
        <div>
          <div className="card-label">Density</div>
          <div className="tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700 }}>{z.density_ppm2.toFixed(1)}<span className="dim" style={{ fontSize: '0.7rem' }}>/m²</span></div>
        </div>
        <div title={z.los_desc}>
          <div className="card-label">Fruin LoS</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: z.los >= 'E' ? 'var(--color-risk-critical)' : z.los >= 'D' ? 'var(--color-risk-high)' : undefined }}>{z.los}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ModalityBar name="vision" {...z.vision} />
        <ModalityBar name="motion" {...z.motion} />
        <ModalityBar name="audio" {...z.audio} />
      </div>

      {eta != null && z.alert_level !== 'critical' && (
        <div className="forecast">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
          Trend → CRITICAL in ~{Math.round(eta)}s
        </div>
      )}

      {z.reasons.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {z.reasons.slice(0, 3).map(r => <div className="reason" key={r}>{r}</div>)}
        </div>
      )}
      {z.reasons.length === 0 && !z.blind_spot && (
        <div className="reason">{z.source_ids.length ? 'All signals within normal range' : 'No sensors assigned — add a camera or phone node'}</div>
      )}
    </div>
  );
}
