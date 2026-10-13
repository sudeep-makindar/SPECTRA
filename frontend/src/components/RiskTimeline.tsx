/**
 * RiskTimeline — fused risk per zone (or per modality for one zone) over the
 * last two minutes, with the alert thresholds drawn as reference lines.
 * One y-axis (0–100), legend + direct end labels, crosshair tooltip.
 */

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MODALITY_COLOR, ZONE_SERIES, fmtTime } from '../lib/types';
import type { HistoryPoint, ZoneState } from '../lib/types';

interface Series { key: string; label: string; color: string }

const THRESHOLDS = [
  { y: 30, label: 'Elevated', color: 'var(--color-risk-elevated)' },
  { y: 55, label: 'High', color: 'var(--color-risk-high)' },
  { y: 80, label: 'Critical', color: 'var(--color-risk-critical)' },
];

function ChartTooltip({ active, payload, label, series }: { active?: boolean; payload?: { dataKey: string; value: number }[]; label?: number; series: Series[] }) {
  if (!active || !payload?.length || label == null) return null;
  return (
    <div className="chart-tooltip">
      <div className="dim mono" style={{ marginBottom: 4 }}>{fmtTime(label)}</div>
      {series.map(s => {
        const p = payload.find(x => x.dataKey === s.key);
        if (!p) return null;
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 10, height: 3, background: s.color, borderRadius: 2, display: 'inline-block' }} />{s.label}</span>
            <b className="tabular-nums">{Math.round(p.value)}</b>
          </div>
        );
      })}
    </div>
  );
}

function build(rowsBy: Record<string, HistoryPoint[]>, pick: (p: HistoryPoint) => number) {
  const map = new Map<number, Record<string, number>>();
  for (const [key, hist] of Object.entries(rowsBy)) {
    for (const p of hist) {
      const t = Math.round(p[0] * 2) / 2;
      const row = map.get(t) ?? { t };
      row[key] = Math.round(pick(p) * 1000) / 10;
      map.set(t, row);
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export function RiskTimeline({ zones, height = 220, thresholds = true }: { zones: ZoneState[]; height?: number; thresholds?: boolean }) {
  const series: Series[] = zones.map((z, i) => ({ key: z.zone_id, label: z.name, color: ZONE_SERIES[i % ZONE_SERIES.length] }));
  const data = build(Object.fromEntries(zones.map(z => [z.zone_id, z.history])), p => p[1]);
  return <Chart data={data} series={series} height={height} thresholds={thresholds} />;
}

export function ModalityTimeline({ history, height = 200 }: { history: HistoryPoint[]; height?: number }) {
  const series: Series[] = [
    { key: 'risk', label: 'Fused risk', color: '#F2F2EE' },
    { key: 'vision', label: 'Vision', color: MODALITY_COLOR.vision },
    { key: 'motion', label: 'Motion', color: MODALITY_COLOR.motion },
    { key: 'audio', label: 'Audio', color: MODALITY_COLOR.audio },
  ];
  const data = history.map(p => ({ t: p[0], risk: p[1] * 100, vision: p[2] * 100, motion: p[3] * 100, audio: p[4] * 100 }));
  return <Chart data={data} series={series} height={height} thresholds />;
}

function Chart({ data, series, height, thresholds }: { data: Record<string, number>[]; series: Series[]; height: number; thresholds: boolean }) {
  return (
    <div>
      <div className="legend" style={{ marginBottom: 8 }}>
        {series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 54, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={v => fmtTime(v).slice(0, 5)}
              stroke="rgba(255,255,255,0.25)" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis domain={[0, 100]} ticks={[0, 30, 55, 80, 100]} stroke="rgba(255,255,255,0.25)"
              tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
            {thresholds && THRESHOLDS.map(t => (
              <ReferenceLine key={t.y} y={t.y} stroke={t.color} strokeOpacity={0.45} strokeDasharray="3 4"
                label={{ value: t.label, position: 'right', fontSize: 9, fill: 'var(--color-text-muted)' }} />
            ))}
            <Tooltip content={<ChartTooltip series={series} />} cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1 }} />
            {series.map(s => (
              <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={s.key === 'risk' ? 2.5 : 2} dot={false}
                isAnimationActive={false} connectNulls activeDot={{ r: 4, stroke: '#1B1B1F', strokeWidth: 2 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
