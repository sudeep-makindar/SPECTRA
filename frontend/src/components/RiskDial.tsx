import { LEVEL_COLOR, levelFromRisk } from '../lib/types';
import type { Level } from '../lib/types';

interface Props {
  risk: number;
  level?: Level;
  size?: number;
  stroke?: number;
  label?: string;
}

/** Circular risk gauge — 270° arc, coloured by alert tier, number in the centre. */
export function RiskDial({ risk, level, size = 112, stroke = 10, label }: Props) {
  const lvl = level ?? levelFromRisk(risk);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  const filled = arc * Math.max(0, Math.min(1, risk));
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(135deg)' }} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-3)"
          strokeWidth={stroke} strokeDasharray={`${arc} ${c}`} strokeLinecap="round" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={LEVEL_COLOR[lvl]}
          strokeWidth={stroke} strokeDasharray={`${filled} ${c}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 400ms cubic-bezier(0.16,1,0.3,1), stroke 300ms' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span className="num" style={{ fontSize: size * 0.26, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}>
          {Math.round(risk * 100)}
        </span>
        <span style={{ fontSize: Math.max(9, size * 0.085), color: 'var(--color-text-muted)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>
          {label ?? 'risk'}
        </span>
      </div>
    </div>
  );
}
