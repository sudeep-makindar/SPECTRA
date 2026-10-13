/**
 * VenueMap — a live digital twin of the venue.
 *
 * Each zone is drawn at its configured position with: a risk-tinted floor,
 * the live occupancy heatmap (from YOLO foot positions), the dominant crowd
 * heading, sensor coverage, and a pulsing outline when the zone is HIGH+.
 */

import { useSpectra } from '../context/SpectraContext';
import { LEVEL_COLOR } from '../lib/types';
import type { ZoneConfig, ZoneState } from '../lib/types';

const VB_W = 100;
const VB_H = 56;
const FONT = 'Inter, system-ui, sans-serif';

function Heat({ cfg, zone }: { cfg: ZoneConfig; zone: ZoneState }) {
  const grid = zone.occupancy_grid;
  if (!grid?.length) return null;
  const rows = grid.length;
  const cols = grid[0].length;
  const pad = 1.4;
  const x0 = cfg.x + pad;
  const y0 = (cfg.y + pad) * (VB_H / 100) + 4;
  const w = cfg.w - pad * 2;
  const h = (cfg.h - pad * 2) * (VB_H / 100) - 6;
  const cw = w / cols;
  const ch = h / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      if (v < 0.05) continue;
      cells.push(<circle key={`${r}-${c}`} cx={x0 + (c + 0.5) * cw} cy={y0 + (r + 0.5) * ch}
        r={Math.max(cw, ch) * (0.6 + v * 0.7)} fill="url(#heat)" opacity={Math.min(0.85, 0.2 + v * 0.7)} />);
    }
  }
  return <g>{cells}</g>;
}

export function VenueMap({ onSelect, selected }: { onSelect?: (id: string) => void; selected?: string | null }) {
  const { zone_configs, zones, sources } = useSpectra();

  return (
    <svg className="venue-map" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label="Venue map with live zone risk">
      <defs>
        <radialGradient id="heat">
          <stop offset="0%" stopColor="#F0883E" stopOpacity="0.9" />
          <stop offset="55%" stopColor="#F0883E" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#F0883E" stopOpacity="0" />
        </radialGradient>
        <pattern id="grid" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M 4 0 L 0 0 0 4" fill="none" stroke="rgba(154,167,182,0.06)" strokeWidth="0.15" />
        </pattern>
        <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#E6EDF3" />
        </marker>
      </defs>

      <rect x="0.3" y="0.3" width={VB_W - 0.6} height={VB_H - 0.6} rx="1.5" fill="#0C1117" stroke="#1F2A36" strokeWidth="0.25" />
      <rect x="0.3" y="0.3" width={VB_W - 0.6} height={VB_H - 0.6} rx="1.5" fill="url(#grid)" />
      <text x={VB_W / 2} y={VB_H - 1} textAnchor="middle" fontSize="1.4" fill="#66727F" fontFamily={FONT} letterSpacing="0.3">ENTRY PLAZA ↓</text>

      {zone_configs.map(cfg => {
        const z = zones[cfg.id];
        if (!z) return null;
        const y = cfg.y * (VB_H / 100);
        const h = cfg.h * (VB_H / 100);
        const color = z.blind_spot ? '#66727F' : LEVEL_COLOR[z.alert_level];
        const alarm = z.alert_level === 'high' || z.alert_level === 'critical';
        const sens = sources.filter(s => z.source_ids.includes(s.id));
        const cx = cfg.x + cfg.w / 2;
        const cy = y + h / 2 + 2;
        const isSel = selected === cfg.id;
        return (
          <g key={cfg.id} className="venue-zone" onClick={() => onSelect?.(cfg.id)}>
            {alarm && <rect x={cfg.x - 0.5} y={y - 0.5} width={cfg.w + 1} height={h + 1} rx="1.6" fill="none" stroke={color} strokeWidth="0.5" className="pulse-ring" />}
            <rect x={cfg.x} y={y} width={cfg.w} height={h} rx="1.2"
              fill={color} fillOpacity={z.blind_spot ? 0.03 : z.alert_level === 'normal' ? 0.04 : 0.1 + z.risk_score * 0.12}
              stroke={isSel ? '#4F8DF7' : color} strokeOpacity={isSel ? 1 : alarm ? 0.9 : 0.45}
              strokeWidth={isSel ? 0.45 : 0.3} strokeDasharray={z.blind_spot ? '1 0.7' : undefined} />
            {!z.blind_spot && <Heat cfg={cfg} zone={z} />}

            {z.flow_direction_deg != null && z.people_count > 0 && (
              <line x1={cx} y1={cy}
                x2={cx + Math.cos((z.flow_direction_deg * Math.PI) / 180) * 4.5}
                y2={cy + Math.sin((z.flow_direction_deg * Math.PI) / 180) * 4.5}
                stroke="#E6EDF3" strokeWidth="0.4" markerEnd="url(#arrow)" opacity="0.75" />
            )}

            <text x={cfg.x + 1.5} y={y + 3} fontSize="1.75" fontWeight="600" fill="#E6EDF3" fontFamily={FONT}>{cfg.name}</text>
            <text x={cfg.x + 1.5} y={y + 5.2} fontSize="1.25" fill="#9AA7B6" fontFamily={FONT}>
              {z.blind_spot ? 'No signal — blind spot' : `${z.people_count} pax · ${z.density_ppm2.toFixed(1)}/m² · LoS ${z.los}`}
            </text>

            <g transform={`translate(${cfg.x + cfg.w - 7.6}, ${y + 1.2})`}>
              <rect width="6.4" height="3" rx="0.8" fill={z.alert_level === 'critical' ? color : '#151D26'} stroke={color} strokeWidth="0.2" />
              <text x="3.2" y="2.15" fontSize="1.6" fontWeight="600" textAnchor="middle" fill={z.alert_level === 'critical' ? '#fff' : color} fontFamily="JetBrains Mono, monospace">
                {Math.round(z.risk_score * 100)}
              </text>
            </g>

            {sens.map((s, i) => (
              <g key={s.id} transform={`translate(${cfg.x + 1.5 + i * 3}, ${y + h - 3.2})`}>
                <title>{s.name} · {s.status}</title>
                <rect width="2.4" height="2" rx="0.4" fill="#151D26" stroke={s.status === 'online' ? '#3FB950' : s.status === 'degraded' ? '#E3B341' : '#66727F'} strokeWidth="0.2" />
                <circle cx="1.2" cy="1" r="0.45" fill={s.status === 'online' ? '#3FB950' : '#66727F'} />
              </g>
            ))}
            {z.scenario && <text x={cfg.x + cfg.w - 1.4} y={y + h - 1.3} fontSize="1.2" textAnchor="end" fill="#B9C7DA" fontFamily={FONT} letterSpacing="0.15">DRILL</text>}
          </g>
        );
      })}
    </svg>
  );
}
