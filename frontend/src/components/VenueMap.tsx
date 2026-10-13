/**
 * VenueMap — a live digital twin of the venue.
 *
 * Each zone is drawn at its configured position with: a risk-tinted floor,
 * the live occupancy heatmap (from YOLO foot positions), the dominant crowd
 * heading, camera/mic coverage, and a pulsing ring when the zone is HIGH+.
 */

import { useSpectra } from '../context/SpectraContext';
import { LEVEL_COLOR } from '../lib/types';
import type { ZoneConfig, ZoneState } from '../lib/types';

const VB_W = 100;
const VB_H = 62;

function Heat({ cfg, zone }: { cfg: ZoneConfig; zone: ZoneState }) {
  const grid = zone.occupancy_grid;
  if (!grid?.length) return null;
  const rows = grid.length;
  const cols = grid[0].length;
  const pad = 1.2;
  const x0 = cfg.x + pad;
  const y0 = (cfg.y + pad) * (VB_H / 100);
  const w = cfg.w - pad * 2;
  const h = (cfg.h - pad * 2) * (VB_H / 100);
  const cw = w / cols;
  const ch = h / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      if (v < 0.04) continue;
      cells.push(
        <circle key={`${r}-${c}`} cx={x0 + (c + 0.5) * cw} cy={y0 + (r + 0.5) * ch}
          r={Math.max(cw, ch) * (0.55 + v * 0.6)} fill="url(#heat)" opacity={Math.min(0.9, 0.25 + v * 0.75)} />,
      );
    }
  }
  return <g style={{ mixBlendMode: 'screen' }}>{cells}</g>;
}

export function VenueMap({ onSelect, selected }: { onSelect?: (id: string) => void; selected?: string | null }) {
  const { zone_configs, zones, sources } = useSpectra();

  return (
    <svg className="venue-map" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label="Venue map with live zone risk">
      <defs>
        <radialGradient id="heat">
          <stop offset="0%" stopColor="#ffd27a" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#ec835a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#e5484d" stopOpacity="0" />
        </radialGradient>
        <pattern id="floor" width="2" height="2" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.12" fill="rgba(255,255,255,0.12)" />
        </pattern>
        <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#F2F2EE" />
        </marker>
      </defs>

      <rect x="0.5" y="0.5" width={VB_W - 1} height={VB_H - 1} rx="3" fill="url(#floor)" stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
      {/* Stage + perimeter hints */}
      <text x={VB_W / 2} y={VB_H - 1.2} textAnchor="middle" fontSize="1.6" fill="rgba(255,255,255,0.25)" letterSpacing="0.3">ENTRY PLAZA ↓</text>

      {zone_configs.map(cfg => {
        const z = zones[cfg.id];
        if (!z) return null;
        const y = cfg.y * (VB_H / 100);
        const h = cfg.h * (VB_H / 100);
        const color = z.blind_spot ? 'var(--color-text-muted)' : LEVEL_COLOR[z.alert_level];
        const alarm = z.alert_level === 'high' || z.alert_level === 'critical';
        const cams = sources.filter(s => z.source_ids.includes(s.id));
        const cx = cfg.x + cfg.w / 2;
        const cy = y + h / 2;
        return (
          <g key={cfg.id} className="venue-zone" onClick={() => onSelect?.(cfg.id)}>
            {alarm && (
              <rect x={cfg.x - 0.6} y={y - 0.6} width={cfg.w + 1.2} height={h + 1.2} rx="2.6"
                fill="none" stroke={color} strokeWidth="0.6" className="pulse-ring" />
            )}
            <rect x={cfg.x} y={y} width={cfg.w} height={h} rx="2.2"
              fill={color} fillOpacity={z.blind_spot ? 0.05 : 0.08 + z.risk_score * 0.22}
              stroke={selected === cfg.id ? 'var(--color-lavender)' : color}
              strokeOpacity={selected === cfg.id ? 1 : 0.6} strokeWidth={selected === cfg.id ? 0.6 : 0.35}
              strokeDasharray={z.blind_spot ? '1.2 0.8' : undefined} />
            {!z.blind_spot && <Heat cfg={cfg} zone={z} />}

            {z.flow_direction_deg != null && z.people_count > 0 && (
              <line x1={cx} y1={cy}
                x2={cx + Math.cos((z.flow_direction_deg * Math.PI) / 180) * 5}
                y2={cy + Math.sin((z.flow_direction_deg * Math.PI) / 180) * 5}
                stroke="#F2F2EE" strokeWidth="0.45" markerEnd="url(#arrow)" opacity="0.8" />
            )}

            <text x={cfg.x + 1.6} y={y + 3.4} fontSize="2.2" fontFamily="Anton, Impact, sans-serif" fill="#F2F2EE" letterSpacing="0.05">
              {cfg.name.toUpperCase()}
            </text>
            <text x={cfg.x + 1.6} y={y + 6} fontSize="1.5" fill="rgba(242,242,238,0.7)" fontFamily="Space Grotesk, sans-serif">
              {z.blind_spot ? 'NO SIGNAL — BLIND SPOT' : `${z.people_count} pax · ${z.density_ppm2.toFixed(1)}/m² · LoS ${z.los}`}
            </text>

            {/* Risk badge */}
            <g transform={`translate(${cfg.x + cfg.w - 9.5}, ${y + 1.4})`}>
              <rect width="8.2" height="3.6" rx="1.8" fill={color} />
              <text x="4.1" y="2.6" fontSize="1.9" fontWeight="700" textAnchor="middle"
                fill={z.alert_level === 'critical' ? '#fff' : '#141417'} fontFamily="Space Grotesk, sans-serif">
                {Math.round(z.risk_score * 100)}
              </text>
            </g>

            {/* Coverage icons */}
            {cams.map((s, i) => (
              <g key={s.id} transform={`translate(${cfg.x + 1.6 + i * 3.4}, ${y + h - 3.6})`}>
                <title>{s.name} · {s.status}</title>
                <rect width="2.8" height="2.2" rx="0.6"
                  fill={s.status === 'online' ? 'var(--color-online)' : s.status === 'degraded' ? 'var(--color-degraded)' : 'var(--color-offline)'} opacity="0.9" />
                <text x="1.4" y="1.6" fontSize="1.3" textAnchor="middle" fill="#141417">{s.kind === 'audio' ? '♪' : '●'}</text>
              </g>
            ))}
            {z.scenario && (
              <text x={cfg.x + cfg.w - 1.4} y={y + h - 1.4} fontSize="1.4" textAnchor="end" fill="var(--color-lavender-light)" letterSpacing="0.2">SIMULATION</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
