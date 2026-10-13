/**
 * System & Evaluation — live pipeline telemetry and the fusion benchmark.
 */

import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useSpectra } from '../context/SpectraContext';
import { MODALITY_COLOR, api, fmtTime } from '../lib/types';

interface Health {
  device: { selected_device: string; pytorch_version: string | null; mps_available: boolean };
  models: { key: string; status: string; name?: string; version?: string; device?: string }[];
  copilot: { enabled: boolean; model: string; last_error: string | null; calls: number };
  face_blur: boolean;
}

interface SystemResult { detection_rate: number; false_alarm_rate: number; precision: number; f1: number; median_latency_s: number | null; p90_latency_s?: number | null; per_scenario?: Record<string, { alarm_rate: number; median_latency_s: number | null }> }
interface EvalReport {
  generated_at: number;
  trials_per_scenario: number;
  scenarios: Record<string, { emergency: boolean; description: string }>;
  systems: Record<string, SystemResult>;
  confusion_spectra: Record<string, Record<string, number>>;
  stress: { description: string; systems: Record<string, SystemResult> };
  headline: { false_alarm_reduction_vs_or: number | null; spectra_detection_rate: number; spectra_false_alarm_rate: number; or_false_alarm_rate: number };
  method: string;
  limitations: string[];
}

const STAGES = [
  { key: 'vision', label: 'YOLO + ByteTrack', color: MODALITY_COLOR.vision },
  { key: 'motion', label: 'Optical flow', color: MODALITY_COLOR.motion },
  { key: 'audio', label: 'AST audio', color: MODALITY_COLOR.audio },
  { key: 'whisper', label: 'Whisper keywords', color: '#9085e9' },
  { key: 'fusion', label: 'Fusion tick', color: '#c98500' },
  { key: 'e2e', label: 'Capture → fusion', color: '#F2F2EE' },
];

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const ms = (x: number | null | undefined) => (x == null ? '—' : `${x < 10 ? x.toFixed(1) : Math.round(x)}`);

function Gauge({ label, value, sub }: { label: string; value: number | undefined; sub?: string }) {
  const v = value ?? 0;
  return (
    <div className="card card-dark stat span-3">
      <div className="card-label">{label}</div>
      <div className="stat-value">{value == null ? '—' : `${Math.round(v)}%`}</div>
      <div className="progress" style={{ marginTop: 10, height: 6 }}><div style={{ width: `${v}%`, background: v > 85 ? 'var(--color-risk-high)' : 'var(--color-lavender)' }} /></div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function SystemPage() {
  const { metrics, sources } = useSpectra();
  const [health, setHealth] = useState<Health | null>(null);
  const [report, setReport] = useState<EvalReport | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const load = () => api<Health>('/api/health').then(setHealth).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    api<EvalReport>('/api/eval/latest').then(setReport).catch(() => {});
    return () => clearInterval(t);
  }, []);

  const runEval = async () => {
    setRunning(true);
    try { setReport(await api<EvalReport>('/api/eval/run?trials=60', { method: 'POST' })); } finally { setRunning(false); }
  };

  const lat = metrics.latencies ?? {};
  const sys = metrics.system ?? {};
  const trend = (metrics.trend ?? []).map(p => ({ ...p }));
  const activeStages = STAGES.filter(s => lat[s.key]?.count);

  const evalBars = report ? Object.entries(report.systems).map(([name, r]) => ({ name, detection: r.detection_rate * 100, falseAlarm: r.false_alarm_rate * 100 })) : [];

  return (
    <div className="page">
      <div className="grid-12">
        <Gauge label="CPU" value={sys.cpu_percent} sub={`${sys.cpu_count ?? '?'} cores · ${health?.device.selected_device?.toUpperCase() ?? ''} accel`} />
        <Gauge label="Memory" value={sys.ram_percent} sub={`${sys.ram_used_gb ?? '?'} / ${sys.ram_total_gb ?? '?'} GB · SPECTRA ${sys.process_rss_gb ?? '?'} GB`} />
        <div className="card card-cream stat span-3">
          <div className="card-label">Capture → fusion (p95)</div>
          <div className="stat-value">{ms(lat.e2e?.p95)}<span style={{ fontSize: '1rem' }}> ms</span></div>
          <div className="stat-sub">p50 {ms(lat.e2e?.p50)} · p99 {ms(lat.e2e?.p99)} ms · 30 s window</div>
        </div>
        <div className="card card-lavender stat span-3">
          <div className="card-label">AI co-pilot</div>
          <div className="stat-value" style={{ fontSize: '1.3rem', marginTop: 6 }}>{health?.copilot.enabled ? health.copilot.model : 'Offline templates'}</div>
          <div className="stat-sub">{health?.copilot.calls ?? 0} calls · metadata only{health?.copilot.last_error ? ' · last call failed' : ''}</div>
        </div>

        <div className="card card-dark span-6">
          <div className="card-label">Pipeline latency by stage (ms)</div>
          <table className="table">
            <thead><tr><th>Stage</th><th>p50</th><th>p95</th><th>p99</th><th>samples</th></tr></thead>
            <tbody>
              {STAGES.map(s => (
                <tr key={s.key}>
                  <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.label}</span></td>
                  <td>{ms(lat[s.key]?.p50)}</td><td>{ms(lat[s.key]?.p95)}</td><td>{ms(lat[s.key]?.p99)}</td>
                  <td className="dim">{lat[s.key]?.count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card card-dark span-6">
          <div className="card-label">p95 latency trend (ms)</div>
          <div className="legend" style={{ marginBottom: 8 }}>{activeStages.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} tickFormatter={v => fmtTime(v).slice(0, 5)} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: 'rgba(18,18,21,0.96)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 12 }} labelFormatter={v => fmtTime(Number(v))} formatter={(v, k) => [`${Math.round(Number(v))} ms`, STAGES.find(s => s.key === k)?.label ?? String(k)]} />
                {activeStages.map(s => <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card card-dark span-7">
          <div className="card-label">Sources</div>
          <table className="table">
            <thead><tr><th>Source</th><th>Zone</th><th>Status</th><th>Capture fps</th><th>AI fps</th><th>Skipped</th><th>Dropped</th></tr></thead>
            <tbody>
              {sources.map(s => (
                <tr key={s.id}>
                  <td>{s.name} <span className="dim">· {s.adapter}</span></td>
                  <td>{s.zone_id}</td>
                  <td><span className={`status-dot status-dot-${s.status === 'online' ? 'online' : s.status === 'degraded' ? 'degraded' : 'offline'}`} /> {s.status}</td>
                  <td>{s.fps}</td><td>{s.inference_fps}</td><td>{s.skipped_frames}</td><td>{s.dropped_frames}</td>
                </tr>
              ))}
              {!sources.length && <tr><td colSpan={7} className="dim">No sources connected.</td></tr>}
            </tbody>
          </table>
          <div className="dim" style={{ fontSize: '0.68rem', marginTop: 8 }}>Backpressure: one inference in flight per camera; newer frames win, so latency stays flat under load.</div>
        </div>
        <div className="card card-dark span-5">
          <div className="card-label">Models (all on-device)</div>
          <table className="table">
            <tbody>
              {health?.models.map(m => (
                <tr key={m.key}><td>{m.name ?? m.key}</td><td className="dim">{m.version}</td><td>{m.device?.toUpperCase()}</td><td style={{ color: m.status === 'loaded' ? 'var(--color-online)' : 'var(--color-degraded)' }}>{m.status}</td></tr>
              ))}
              <tr><td>Head anonymisation</td><td className="dim">evidence clips</td><td /><td>{health?.face_blur ? 'on' : 'off'}</td></tr>
            </tbody>
          </table>
          <div className="dim" style={{ fontSize: '0.7rem', marginTop: 8 }}>PyTorch {health?.device.pytorch_version} · uptime {Math.round(metrics.uptime_s / 60)} min</div>
        </div>

        {/* ── Evaluation ── */}
        <div className="card card-dark span-12" style={{ padding: 24 }}>
          <div className="section-title">
            <div>
              <div className="display" style={{ fontSize: '2rem' }}>Does fusion beat single sensors?</div>
              <div className="dim" style={{ fontSize: '0.75rem', marginTop: 4 }}>{report ? `${report.trials_per_scenario} randomized trials × ${Object.keys(report.scenarios).length} scenarios · generated ${fmtTime(report.generated_at)}` : 'No report yet'}</div>
            </div>
            <button className="btn btn-primary" disabled={running} onClick={runEval}>{running ? 'Running…' : '▶ Re-run benchmark'}</button>
          </div>
          {report && (
            <div className="grid-12">
              {(() => {
                const sf = report.stress.systems['SPECTRA fusion'];
                const so = report.stress.systems['Any-sensor OR'];
                const red = so?.false_alarm_rate ? 1 - sf.false_alarm_rate / so.false_alarm_rate : null;
                return (
                  <>
                    <div className="card card-lavender stat span-3">
                      <div className="card-label">False alarms vs any-sensor OR (stress)</div>
                      <div className="stat-value">{red == null ? '—' : `−${Math.round(red * 100)}%`}</div>
                      <div className="stat-sub">{pct(so?.false_alarm_rate)} → {pct(sf?.false_alarm_rate)} under 2× noise + 15% sensor dropout</div>
                    </div>
                    <div className="card card-sage stat span-3">
                      <div className="card-label">Emergencies detected (stress)</div>
                      <div className="stat-value">{pct(sf?.detection_rate)}</div>
                      <div className="stat-sub">F1 {sf?.f1.toFixed(2)} vs {so?.f1.toFixed(2)} for any-sensor OR</div>
                    </div>
                    <div className="card card-cream stat span-3">
                      <div className="card-label">Standard suite (tuning set)</div>
                      <div className="stat-value">{pct(report.headline.spectra_detection_rate)}</div>
                      <div className="stat-sub">detected · {pct(report.headline.spectra_false_alarm_rate)} false alarms (OR: {pct(report.headline.or_false_alarm_rate)})</div>
                    </div>
                  </>
                );
              })()}
              <div className="card card-dark stat span-3" style={{ background: 'var(--color-surface)' }}>
                <div className="card-label">Median detection latency</div>
                <div className="stat-value">{report.systems['SPECTRA fusion']?.median_latency_s ?? '—'}<span style={{ fontSize: '1rem' }}> s</span></div>
                <div className="stat-sub">from event onset; negative = early warning before crush threshold</div>
              </div>

              <div className="span-7" style={{ padding: 8 }}>
                <div className="card-label">Detection vs false-alarm rate by detector (standard suite)</div>
                <div className="legend" style={{ marginBottom: 8 }}>
                  <span><i style={{ background: MODALITY_COLOR.vision }} />Detection rate (higher is better)</span>
                  <span><i style={{ background: MODALITY_COLOR.motion }} />False-alarm rate (lower is better)</span>
                </div>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={evalBars} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barGap={2}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }} tickLine={false} axisLine={false} interval={0} />
                      <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} contentStyle={{ background: 'rgba(18,18,21,0.96)', border: '1px solid var(--color-border)', borderRadius: 12, fontSize: 12 }} formatter={(v, k) => [`${Math.round(Number(v))}%`, k === 'detection' ? 'Detection rate' : 'False-alarm rate']} />
                      <Bar dataKey="detection" fill={MODALITY_COLOR.vision} radius={[4, 4, 0, 0]} maxBarSize={28} />
                      <Bar dataKey="falseAlarm" fill={MODALITY_COLOR.motion} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="span-5" style={{ padding: 8 }}>
                <div className="card-label">All detectors · standard / stress</div>
                <table className="table">
                  <thead><tr><th>Detector</th><th>Detect</th><th>False alarm</th><th>F1</th><th>Stress F1</th></tr></thead>
                  <tbody>
                    {Object.entries(report.systems).map(([name, r]) => (
                      <tr key={name} style={name === 'SPECTRA fusion' ? { fontWeight: 700 } : undefined}>
                        <td>{name}</td><td>{pct(r.detection_rate)}</td><td>{pct(r.false_alarm_rate)}</td><td>{r.f1.toFixed(2)}</td><td>{report.stress.systems[name]?.f1.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="span-7" style={{ padding: 8 }}>
                <div className="card-label">SPECTRA peak alert tier per scenario (trial counts)</div>
                <table className="table">
                  <thead><tr><th>Scenario</th><th>Truth</th>{['normal', 'elevated', 'high', 'critical'].map(l => <th key={l}>{l}</th>)}</tr></thead>
                  <tbody>
                    {Object.entries(report.confusion_spectra).map(([name, c]) => {
                      const total = Object.values(c).reduce((a, b) => a + b, 0) || 1;
                      const em = report.scenarios[name]?.emergency;
                      return (
                        <tr key={name} title={report.scenarios[name]?.description}>
                          <td>{name.replace(/_/g, ' ')}</td>
                          <td><span className={`level-pill ${em ? 'level-high' : 'level-normal'}`} style={{ animation: 'none' }}>{em ? 'emergency' : 'benign'}</span></td>
                          {['normal', 'elevated', 'high', 'critical'].map(l => {
                            const v = c[l] ?? 0;
                            const good = em ? (l === 'high' || l === 'critical') : (l === 'normal' || l === 'elevated');
                            return <td key={l} style={{ background: v ? `rgba(${good ? '57,135,229' : '217,89,38'}, ${0.12 + 0.6 * (v / total)})` : undefined, textAlign: 'center' }}>{v || ''}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="dim" style={{ fontSize: '0.66rem', marginTop: 6 }}>Blue = correct outcome (emergency → HIGH+, benign → ≤ ELEVATED); orange = error. Darker = more trials.</div>
              </div>
              <div className="span-5" style={{ padding: 8 }}>
                <div className="card-label">Method & limitations</div>
                <div className="muted" style={{ fontSize: '0.76rem', lineHeight: 1.5 }}>{report.method}</div>
                <ul style={{ margin: '10px 0 0 16px', fontSize: '0.74rem', lineHeight: 1.5 }} className="muted">
                  {report.limitations.map(l => <li key={l}>{l}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
