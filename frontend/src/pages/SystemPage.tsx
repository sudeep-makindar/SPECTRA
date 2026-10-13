/**
 * Performance — live pipeline telemetry and the fusion benchmark.
 */

import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Cpu, MemoryStick, Play, Sparkles, Zap } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import { MODALITY_COLOR, api, fmtTime } from '../lib/types';

interface SystemResult { detection_rate: number; false_alarm_rate: number; precision: number; f1: number; median_latency_s: number | null }
interface EvalReport {
  generated_at: number;
  trials_per_scenario: number;
  scenarios: Record<string, { emergency: boolean; description: string }>;
  systems: Record<string, SystemResult>;
  confusion_spectra: Record<string, Record<string, number>>;
  stress: { description: string; systems: Record<string, SystemResult> };
  headline: { spectra_detection_rate: number; spectra_false_alarm_rate: number; or_false_alarm_rate: number };
  method: string;
  limitations: string[];
}

/** Charted stages use the validated series slots; the rest are table-only. */
const STAGES = [
  { key: 'vision', label: 'Person detection + tracking', color: MODALITY_COLOR.vision, chart: true },
  { key: 'motion', label: 'Optical flow', color: MODALITY_COLOR.motion, chart: true },
  { key: 'audio', label: 'Audio classifier', color: MODALITY_COLOR.audio, chart: true },
  { key: 'whisper', label: 'Keyword spotting (Whisper)', color: null, chart: false },
  { key: 'fusion', label: 'Fusion tick', color: null, chart: false },
  { key: 'e2e', label: 'Capture → fused risk', color: '#E6EDF3', chart: true },
];

const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const ms = (x: number | null | undefined) => (x == null ? '—' : x < 10 ? x.toFixed(1) : `${Math.round(x)}`);
const tooltipStyle = { background: '#0D1218', border: '1px solid #2B3949', borderRadius: 8, fontSize: 12 };

function Meter({ label, value, sub, icon }: { label: string; value: number | undefined; sub: string; icon: React.ReactNode }) {
  const v = value ?? 0;
  return (
    <div className="card span-3 kpi">
      <div className="kpi-top"><div className="card-label" style={{ marginBottom: 0 }}>{label}</div><span className="kpi-icon">{icon}</span></div>
      <div className="kpi-value">{value == null ? '—' : `${Math.round(v)}%`}</div>
      <div className="progress" style={{ height: 5 }}><div style={{ width: `${v}%`, background: v > 85 ? 'var(--color-risk-high)' : 'var(--color-accent)' }} /></div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

export function SystemPage() {
  const { metrics, health } = useSpectra();
  const [report, setReport] = useState<EvalReport | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => { api<EvalReport>('/api/eval/latest').then(setReport).catch(() => {}); }, []);
  const runEval = async () => {
    setRunning(true);
    try { setReport(await api<EvalReport>('/api/eval/run?trials=60', { method: 'POST' })); } finally { setRunning(false); }
  };

  const lat = metrics.latencies ?? {};
  const sys = metrics.system ?? {};
  const charted = STAGES.filter(s => s.chart && lat[s.key]?.count);
  const cp = health?.copilot;
  const sf = report?.stress.systems['SPECTRA fusion'];
  const so = report?.stress.systems['Any-sensor OR'];
  const reduction = sf && so?.false_alarm_rate ? 1 - sf.false_alarm_rate / so.false_alarm_rate : null;
  const bars = report ? Object.entries(report.stress.systems).map(([name, r]) => ({ name, detection: r.detection_rate * 100, falseAlarm: r.false_alarm_rate * 100 })) : [];

  return (
    <>
      <div className="grid-12">
        <Meter label="CPU" value={sys.cpu_percent} icon={<Cpu />} sub={`${sys.cpu_count ?? '?'} cores · ${health?.device.selected_device?.toUpperCase() ?? ''} acceleration`} />
        <Meter label="Memory" value={sys.ram_percent} icon={<MemoryStick />} sub={`${sys.ram_used_gb ?? '?'} / ${sys.ram_total_gb ?? '?'} GB · SPECTRA ${sys.process_rss_gb ?? '?'} GB`} />
        <div className="card span-3 kpi">
          <div className="kpi-top"><div className="card-label" style={{ marginBottom: 0 }}>Capture → fused risk</div><span className="kpi-icon"><Zap /></span></div>
          <div className="kpi-value">{ms(lat.e2e?.p95)}<small> ms p95</small></div>
          <div className="kpi-sub">p50 {ms(lat.e2e?.p50)} · p99 {ms(lat.e2e?.p99)} ms · last 30 s</div>
        </div>
        <div className="card span-3 kpi">
          <div className="kpi-top"><div className="card-label" style={{ marginBottom: 0 }}>AI co-pilot</div><span className="kpi-icon" style={{ color: cp?.enabled ? 'var(--color-accent)' : undefined }}><Sparkles /></span></div>
          <div style={{ fontSize: '1.05rem', fontWeight: 600, marginTop: 4 }}>{cp?.enabled ? cp.provider_label : 'Offline templates'}</div>
          <div className="kpi-sub mono" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={cp?.last_error ?? ''}>
            {cp?.enabled ? cp.model : `Set ${cp?.key_env ?? 'LLM_API_KEY'} in .env`}
          </div>
          <div className="kpi-sub">{cp?.calls ?? 0} calls · metadata only{cp?.last_error ? <span style={{ color: 'var(--color-risk-elevated)' }}> · last call failed</span> : ''}</div>
        </div>

        <div className="card span-6">
          <div className="card-head"><div className="card-title">Latency by pipeline stage <span className="sub">milliseconds · last 30 s</span></div></div>
          <table className="table">
            <thead><tr><th>Stage</th><th>p50</th><th>p95</th><th>p99</th><th>Samples</th></tr></thead>
            <tbody>
              {STAGES.map(s => (
                <tr key={s.key}>
                  <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{s.color ? <i style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} /> : <i style={{ width: 8 }} />}{s.label}</span></td>
                  <td className="num">{ms(lat[s.key]?.p50)}</td><td className="num">{ms(lat[s.key]?.p95)}</td><td className="num">{ms(lat[s.key]?.p99)}</td>
                  <td className="num dim">{lat[s.key]?.count ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card span-6">
          <div className="card-head"><div className="card-title">p95 latency over time <span className="sub">ms</span></div></div>
          <div className="legend" style={{ marginBottom: 8 }}>{charted.map(s => <span key={s.key}><i style={{ background: s.color! }} />{s.label}</span>)}</div>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={metrics.trend ?? []} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="rgba(154,167,182,0.08)" vertical={false} />
                <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} tickFormatter={v => fmtTime(v).slice(0, 5)} tick={{ fontSize: 10, fill: '#66727F' }} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: '#66727F' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={v => fmtTime(Number(v))} formatter={(v, k) => [`${Math.round(Number(v))} ms`, STAGES.find(s => s.key === k)?.label ?? String(k)]} />
                {charted.map(s => <Line key={s.key} dataKey={s.key} stroke={s.color!} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card span-12">
          <div className="card-title" style={{ marginBottom: 12 }}>Models <span className="sub">all inference runs on this machine</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {health?.models.map(m => (
              <div key={m.key} className="card inset" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontWeight: 500 }}>{m.name ?? m.key}</div><div className="dim" style={{ fontSize: '0.72rem' }}>{m.version} · {m.device?.toUpperCase()}</div></div>
                <span className={`tag ${m.status === 'loaded' ? 'ok' : ''}`}>{m.status}</span>
              </div>
            ))}
            <div className="card inset" style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div style={{ fontWeight: 500 }}>Face anonymisation</div><div className="dim" style={{ fontSize: '0.72rem' }}>stored evidence clips</div></div>
              <span className={`tag ${health?.face_blur ? 'ok' : ''}`}>{health?.face_blur ? 'on' : 'off'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head" style={{ alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>Detection benchmark: does fusion beat single sensors?</div>
            <div className="dim" style={{ fontSize: '0.76rem', marginTop: 4 }}>
              {report ? `${report.trials_per_scenario} randomized trials × ${Object.keys(report.scenarios).length} scenarios · ${report.stress.description} · generated ${fmtTime(report.generated_at)}` : 'No report yet'}
            </div>
          </div>
          <button className="btn btn-primary" disabled={running} onClick={runEval}><Play /> {running ? 'Running…' : 'Re-run'}</button>
        </div>

        {report && sf && so && (
          <div className="grid-12">
            <div className="card inset span-3 kpi">
              <div className="card-label" style={{ marginBottom: 0 }}>False alarms vs any-sensor</div>
              <div className="kpi-value" style={{ color: 'var(--color-risk-normal)' }}>−{pct(reduction)}</div>
              <div className="kpi-sub">{pct(so.false_alarm_rate)} → {pct(sf.false_alarm_rate)} of benign scenarios</div>
            </div>
            <div className="card inset span-3 kpi">
              <div className="card-label" style={{ marginBottom: 0 }}>Emergencies detected</div>
              <div className="kpi-value">{pct(sf.detection_rate)}</div>
              <div className="kpi-sub">F1 {sf.f1.toFixed(2)} vs {so.f1.toFixed(2)} for any-sensor alarm</div>
            </div>
            <div className="card inset span-3 kpi">
              <div className="card-label" style={{ marginBottom: 0 }}>Median detection latency</div>
              <div className="kpi-value">{report.systems['SPECTRA fusion']?.median_latency_s ?? '—'}<small> s</small></div>
              <div className="kpi-sub">from event onset; negative = early warning</div>
            </div>
            <div className="card inset span-3 kpi">
              <div className="card-label" style={{ marginBottom: 0 }}>Tuning suite (reference)</div>
              <div className="kpi-value">{pct(report.headline.spectra_detection_rate)}</div>
              <div className="kpi-sub">detected · {pct(report.headline.spectra_false_alarm_rate)} false alarms on the set thresholds were tuned on</div>
            </div>

            <div className="span-7">
              <div className="card-title" style={{ marginBottom: 8 }}>Detection vs false-alarm rate <span className="sub">stress suite</span></div>
              <div className="legend" style={{ marginBottom: 8 }}>
                <span><i style={{ background: MODALITY_COLOR.vision }} />Detection rate (higher is better)</span>
                <span><i style={{ background: MODALITY_COLOR.motion }} />False-alarm rate (lower is better)</span>
              </div>
              <div style={{ height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={bars} margin={{ top: 4, right: 8, left: -12, bottom: 0 }} barGap={2}>
                    <CartesianGrid stroke="rgba(154,167,182,0.08)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9AA7B6' }} tickLine={false} axisLine={false} interval={0} />
                    <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: '#66727F' }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(154,167,182,0.06)' }} contentStyle={tooltipStyle} formatter={(v, k) => [`${Math.round(Number(v))}%`, k === 'detection' ? 'Detection rate' : 'False-alarm rate']} />
                    <Bar dataKey="detection" fill={MODALITY_COLOR.vision} radius={[4, 4, 0, 0]} maxBarSize={26} />
                    <Bar dataKey="falseAlarm" fill={MODALITY_COLOR.motion} radius={[4, 4, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="span-5">
              <div className="card-title" style={{ marginBottom: 8 }}>All detectors <span className="sub">stress suite</span></div>
              <table className="table">
                <thead><tr><th>Detector</th><th>Detect</th><th>False alarm</th><th>F1</th></tr></thead>
                <tbody>
                  {Object.entries(report.stress.systems).map(([name, r]) => (
                    <tr key={name} style={name === 'SPECTRA fusion' ? { fontWeight: 600 } : undefined}>
                      <td>{name}</td><td className="num">{pct(r.detection_rate)}</td><td className="num">{pct(r.false_alarm_rate)}</td><td className="num">{r.f1.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="span-7">
              <div className="card-title" style={{ marginBottom: 8 }}>SPECTRA peak alert per scenario <span className="sub">trial counts · tuning suite</span></div>
              <table className="table">
                <thead><tr><th>Scenario</th><th>Ground truth</th>{['normal', 'elevated', 'high', 'critical'].map(l => <th key={l} style={{ textAlign: 'center' }}>{l}</th>)}</tr></thead>
                <tbody>
                  {Object.entries(report.confusion_spectra).map(([name, c]) => {
                    const total = Object.values(c).reduce((a, b) => a + b, 0) || 1;
                    const em = report.scenarios[name]?.emergency;
                    return (
                      <tr key={name} title={report.scenarios[name]?.description}>
                        <td style={{ textTransform: 'capitalize' }}>{name.replace(/_/g, ' ')}</td>
                        <td><span className="tag">{em ? 'Emergency' : 'Benign'}</span></td>
                        {['normal', 'elevated', 'high', 'critical'].map(l => {
                          const v = c[l] ?? 0;
                          const good = em ? (l === 'high' || l === 'critical') : (l === 'normal' || l === 'elevated');
                          return <td key={l} className="num" style={{ textAlign: 'center', background: v ? `rgba(${good ? '57,135,229' : '213,81,129'}, ${0.12 + 0.55 * (v / total)})` : undefined }}>{v || ''}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="dim" style={{ fontSize: '0.7rem', marginTop: 6 }}>Blue = correct (emergency → HIGH or above; benign → ELEVATED or below). Magenta = error. Darker = more trials.</div>
            </div>
            <div className="span-5">
              <div className="card-title" style={{ marginBottom: 8 }}>Method and limitations</div>
              <p className="muted" style={{ fontSize: '0.78rem', lineHeight: 1.55 }}>{report.method}</p>
              <ul className="muted" style={{ margin: '10px 0 0 16px', fontSize: '0.76rem', lineHeight: 1.55 }}>
                {report.limitations.map(l => <li key={l}>{l}</li>)}
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
