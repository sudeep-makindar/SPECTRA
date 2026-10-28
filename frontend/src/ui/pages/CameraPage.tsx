/**
 * Camera focus — one camera and everything the AI does with it: person
 * detection (YOLO), movement (optical flow), sound (AST + Whisper) and how
 * fusion combines them into the zone's risk. Built so a judge can see each
 * model working without being told.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Ear, Eye, EyeOff, Move, ScanFace, Sigma } from 'lucide-react';
import { useLive } from '../LiveContext';
import { Feed, LevelBadge } from '../parts';
import { CROWDING, DEVICE_TYPE, LEVEL_WORD, capsOf, levelOf, plain, wsUrl } from '../live';
import type { Insight, ZoneState } from '../live';

/** Per-camera model outputs. Quietly absent if the backend doesn't send them. */
function useInsight(sourceId: string | undefined): Insight | null {
  const [insight, setInsight] = useState<Insight | null>(null);
  useEffect(() => {
    setInsight(null);
    if (!sourceId) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      ws = new WebSocket(wsUrl(`/ws/inspect/${sourceId}`));
      ws.onmessage = ev => { try { setInsight(JSON.parse(ev.data)); } catch { /* ignore */ } };
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 3000); };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws?.close(); };
  }, [sourceId]);
  return insight;
}

/** Keeps the last thing Whisper heard on screen for a few seconds. */
function useLastHeard(text: string, keyword: string | null, holdMs = 8000) {
  const [heard, setHeard] = useState<{ text: string; keyword: string | null; at: number } | null>(null);
  useEffect(() => { if (text) setHeard({ text, keyword, at: Date.now() }); }, [text, keyword]);
  const [, setNow] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return heard && Date.now() - heard.at < holdMs ? heard : null;
}

function Sparkline({ values, max = 1, height = 46 }: { values: number[]; max?: number; height?: number }) {
  if (values.length < 2) return <div className="ink-3 xs" style={{ height }}>Collecting…</div>;
  const w = 300;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${height - 2 - (Math.min(v, max) / max) * (height - 4)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }} role="img" aria-label="Recent trend">
      <polyline points={pts} fill="none" stroke="var(--ink-2)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={w} cy={height - 2 - (Math.min(last, max) / max) * (height - 4)} r="3.5" fill="var(--ink)" />
    </svg>
  );
}

function Spectrogram({ mel }: { mel: number[][] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !mel.length) return;
    const cols = mel.length, rows = mel[0].length;
    c.width = cols; c.height = rows;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(cols, rows);
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const v = Math.max(0, Math.min(1, mel[x][rows - 1 - y]));
      const i = (y * cols + x) * 4;
      img.data[i] = 30 + v * 214; img.data[i + 1] = 30 + v * 213; img.data[i + 2] = 32 + v * 208; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [mel]);
  return <canvas ref={ref} style={{ width: '100%', height: 92, borderRadius: 10, imageRendering: 'pixelated', background: 'var(--panel-2)' }} aria-label="Live spectrogram" />;
}

function ModelPanel({ icon, title, model, ms, children }: { icon: React.ReactNode; title: string; model: string; ms?: number | null; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="model-head">
        <span className="kpi-icon" style={{ width: 40, height: 40, borderRadius: 12 }}>{icon}</span>
        <div className="col">
          <h2 className="panel-title">{title}</h2>
          <span className="model-name">{model}</span>
        </div>
        {ms != null && <span className="model-ms">{Math.round(ms)} ms</span>}
      </div>
      {children}
    </section>
  );
}

const CAPS = { vision: 0.72, motion: 0.5, audio: 0.5 } as const;
const SENSE = { vision: 'Crowd', motion: 'Movement', audio: 'Sound' } as const;

function FusionPanel({ zone }: { zone: ZoneState }) {
  const mods = ['vision', 'motion', 'audio'] as const;
  const capped = mods.map(m => zone[m].score * CAPS[m]);
  const agree = zone.active_modalities.length;
  const raw = agree >= 2 ? Math.min(1, 1.2 * (1 - capped.reduce((p, c) => p * (1 - c), 1))) : Math.max(...capped);
  return (
    <section className={`panel lv-${zone.alert_level}`}>
      <div className="model-head">
        <span className="kpi-icon" style={{ width: 40, height: 40, borderRadius: 12 }}><Sigma size={18} /></span>
        <div className="col">
          <h2 className="panel-title">How {zone.name}’s risk is worked out</h2>
          <span className="model-name">Gated fusion · every 0.5 s</span>
        </div>
        <span style={{ marginLeft: 'auto' }}><LevelBadge level={zone.alert_level} /></span>
      </div>
      <div className="bars">
        {mods.map((m, i) => (
          <div key={m} className={`bar-row lv-${levelOf(capped[i])}`}>
            <span>
              <b>{SENSE[m]}</b> <span className="ink-3 mono xs">{zone[m].score.toFixed(2)} × cap {CAPS[m]}</span>
              {zone.active_modalities.includes(m) && <span className="tag" style={{ marginLeft: 8 }}>worried</span>}
            </span>
            <span className="bar risk"><div style={{ width: `${capped[i] * 100}%` }} /></span>
            <span className="mono num sm" style={{ textAlign: 'right' }}>{capped[i].toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="heard mono sm" style={{ marginTop: 16 }}>
        {agree >= 2
          ? <>{agree} senses agree → 1.2 × (1 − Π(1 − each)) = <b>{raw.toFixed(2)}</b></>
          : <>{agree === 1 ? 'Only one sense is worried' : 'No sense is worried'} → the highest single value = <b>{raw.toFixed(2)}</b>. No single sense can reach “Act now”.</>}
      </div>
      <div className="row" style={{ marginTop: 14, alignItems: 'baseline' }}>
        <span className="ink-2 sm grow">Smoothed risk now</span>
        <span className="kpi-value num" style={{ color: 'var(--c)' }}>{Math.round(zone.risk_score * 100)}<small>/100</small></span>
      </div>
      {zone.forecast.eta_critical_s != null && zone.alert_level !== 'critical' && (
        <p className="sm" style={{ margin: '6px 0 0', color: 'var(--c)' }}>Forecast: “Act now” in about {Math.round(zone.forecast.eta_critical_s)} s if the trend continues.</p>
      )}
    </section>
  );
}

export function CameraPage() {
  const { id } = useParams();
  const s = useLive();
  const navigate = useNavigate();
  const [ai, setAi] = useState(true);
  const cams = s.sources.filter(x => x.kind === 'video');
  const source = s.sources.find(x => x.id === id);
  const zone = source?.zone_id ? s.zones[source.zone_id] : undefined;
  const insight = useInsight(source?.id);
  const heard = useLastHeard(insight?.audio?.transcript || zone?.transcript || '', insight?.audio?.keyword ?? zone?.keyword ?? null);

  if (!source) {
    return (
      <div className="panel empty">
        <h3>{s.connected ? 'This camera is no longer connected' : 'Connecting…'}</h3>
        <Link className="btn" to="/"><ArrowLeft /> Back to surveillance</Link>
      </div>
    );
  }

  const idx = cams.findIndex(c => c.id === source.id);
  const go = (d: number) => cams.length > 1 && navigate(`/camera/${cams[(idx + d + cams.length) % cams.length].id}`);
  const zoneHasMic = s.sources.some(x => x.zone_id === source.zone_id && capsOf(x).audio);
  const hist = zone?.history ?? [];
  const people = insight?.vision ? insight.vision.detections.length : zone?.people_count ?? 0;
  const detections = [...(insight?.vision?.detections ?? [])].sort((a, b) => b.conf - a.conf).slice(0, 6);
  const classes = insight?.audio?.classes?.slice(0, 5)
    ?? (zone?.audio_label ? [{ label: zone.audio_label, p: zone.audio.score }] : []);
  const lat = s.latencies;

  return (
    <>
      <div className="row wrap" style={{ gap: 16 }}>
        <Link to="/" className="btn btn-sm"><ArrowLeft /> Surveillance</Link>
        <div className="grow">
          <h1 className="title" style={{ fontSize: 36 }}>{source.name}</h1>
          <div className="ink-2" style={{ marginTop: 6 }}>
            {zone?.name ?? 'No zone'} · {DEVICE_TYPE[source.adapter] ?? source.adapter} · {source.status === 'online' ? `${source.fps} fps in, AI ${source.inference_fps} fps` : source.status}
          </div>
        </div>
        {zone && <LevelBadge level={zone.alert_level} />}
        <button className="icon-btn" onClick={() => go(-1)} disabled={cams.length < 2} aria-label="Previous camera"><ChevronLeft /></button>
        <span className="mono sm ink-3">{idx + 1} / {cams.length}</span>
        <button className="icon-btn" onClick={() => go(1)} disabled={cams.length < 2} aria-label="Next camera"><ChevronRight /></button>
      </div>

      <div className="focus">
        <div className="col" style={{ gap: 16 }}>
          <section className={`tile lv-${zone?.alert_level ?? 'normal'} ${zone && zone.alert_level !== 'normal' ? 'hot' : ''}`}>
            <div className="feed">
              <Feed source={source} ai={ai} />
              <div className="feed-top">
                <span className="chip">{source.status === 'online' && <span className="rec" />}{ai ? 'AI VIEW' : 'PLAIN'}</span>
                <span className="chip num">{people} people</span>
              </div>
            </div>
            <div className="tile-foot">
              <span className="ink-2 sm grow">{ai ? 'Boxes are people found by YOLO; arrows show how they are moving.' : 'The camera picture without AI drawings.'}</span>
              <button className="btn btn-sm" onClick={() => setAi(!ai)}>{ai ? <><EyeOff /> Plain picture</> : <><Eye /> AI view</>}</button>
            </div>
          </section>
          {zone && <FusionPanel zone={zone} />}
        </div>

        <div className="col" style={{ gap: 16 }}>
          <ModelPanel icon={<ScanFace size={18} />} title="Person detection" model={insight?.vision?.model ?? 'YOLO26s + ByteTrack tracker'} ms={insight?.vision?.ms ?? lat.vision?.p50}>
            <div className="stats">
              <div className="stat"><b>{people}</b><span>people</span></div>
              <div className="stat"><b>{zone ? zone.density_ppm2.toFixed(1) : '–'}</b><span>per m² in zone</span></div>
              <div className={`stat lv-${levelOf(zone?.vision.score ?? 0)}`}><b style={{ fontSize: 16, paddingTop: 6, color: 'var(--c)' }}>{zone ? CROWDING[zone.los] ?? '–' : '–'}</b><span>crowding</span></div>
            </div>
            {detections.length > 0 && (
              <div className="bars" style={{ marginTop: 14 }}>
                {detections.map((d, i) => (
                  <div key={d.id ?? `d${i}`} className="bar-row">
                    <span className="mono sm">person {d.id != null ? `#${d.id}` : ''}</span>
                    <span className="bar"><div style={{ width: `${d.conf * 100}%` }} /></span>
                    <span className="mono num sm" style={{ textAlign: 'right' }}>{d.conf.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            {zone && zone.fallen_count > 0 && <p className="sm" style={{ margin: '12px 0 0', color: 'var(--danger)' }}>{zone.fallen_count} person may be on the ground.</p>}
          </ModelPanel>

          <ModelPanel icon={<Move size={18} />} title="Movement" model="Optical flow (Farnebäck) vs this camera’s normal" ms={insight?.motion?.ms ?? lat.motion?.p50}>
            <div className="stats">
              <div className={`stat lv-${levelOf(zone?.motion.score ?? 0)}`}><b style={{ color: 'var(--c)' }}>{insight?.motion ? `×${insight.motion.ratio.toFixed(1)}` : `${Math.round((zone?.motion.score ?? 0) * 100)}`}</b><span>{insight?.motion ? 'vs normal' : 'movement score'}</span></div>
              <div className="stat">
                <b style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {insight?.motion?.direction_deg != null
                    ? <svg width="22" height="22" viewBox="0 0 22 22" style={{ transform: `rotate(${insight.motion.direction_deg}deg)` }} aria-hidden="true"><path d="M3 11h14M12 6l5 5-5 5" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                    : '–'}
                </b>
                <span>main direction</span>
              </div>
              <div className="stat"><b style={{ fontSize: 16, paddingTop: 6 }}>{(zone?.chaos_index ?? 0) > 0.5 ? 'Scattering' : 'Orderly'}</b><span>directions</span></div>
            </div>
            <div style={{ marginTop: 14 }}><span className="label">Last 2 minutes</span><Sparkline values={hist.map(h => h[3])} /></div>
            {insight?.motion?.calibrating && <p className="ink-3 xs" style={{ margin: '8px 0 0' }}>Learning this camera’s normal level of movement…</p>}
          </ModelPanel>

          <ModelPanel icon={<Ear size={18} />} title="Sound" model={insight?.audio?.model ?? 'AST (AudioSet) + Whisper speech'} ms={insight?.audio?.ms ?? lat.audio?.p50}>
            {!zoneHasMic && !zone?.scenario ? (
              <p className="ink-2 sm" style={{ margin: 0 }}>No microphone in {zone?.name ?? 'this zone'}. Add a phone or laptop mic to this zone to hear screams, gunshots and calls for help.</p>
            ) : (
              <div className="col" style={{ gap: 14 }}>
                {insight?.audio?.mel && <Spectrogram mel={insight.audio.mel} />}
                <div className="bars">
                  {classes.length ? classes.map(c => (
                    <div key={c.label} className={`bar-row lv-${levelOf(c.p)}`}>
                      <span className="sm truncate">{c.label}</span>
                      <span className="bar risk"><div style={{ width: `${c.p * 100}%` }} /></span>
                      <span className="mono num sm" style={{ textAlign: 'right' }}>{c.p.toFixed(2)}</span>
                    </div>
                  )) : <span className="ink-3 sm">Quiet. Nothing alarming heard.</span>}
                </div>
                <div>
                  <span className="label">Speech heard</span>
                  <div className="heard" style={{ marginTop: 6 }}>
                    {heard ? <HighlightedHeard text={heard.text} keyword={heard.keyword} /> : <span className="ink-3">Nobody speaking</span>}
                  </div>
                </div>
                <div className="row sm">
                  <span className="ink-2 grow">Gunshot detector</span>
                  {zone?.hard_trigger ? <span className="badge lv-critical">Gunshot heard</span> : <span className="tag">Listening</span>}
                </div>
              </div>
            )}
          </ModelPanel>
        </div>
      </div>
      {zone && <p className="ink-3 xs" style={{ margin: 0 }}>{zone.name}: {LEVEL_WORD[zone.alert_level]}. {zone.reasons.slice(0, 2).map(plain).join(' · ') || 'Nothing unusual.'}</p>}
    </>
  );
}

function HighlightedHeard({ text, keyword }: { text: string; keyword: string | null }) {
  if (!keyword) return <>“{text}”</>;
  const i = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (i < 0) return <>“{text}” <mark>{keyword}</mark></>;
  return <>“{text.slice(0, i)}<mark>{text.slice(i, i + keyword.length)}</mark>{text.slice(i + keyword.length)}”</>;
}
