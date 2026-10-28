/** Types mirroring the backend's live payload, plus plain-language helpers. */

export type Level = 'normal' | 'elevated' | 'high' | 'critical';

export interface ModalityState {
  score: number;
  context: string;
  age_s: number;
  simulated: boolean;
}

export interface Forecast {
  slope_per_min: number;
  eta_high_s: number | null;
  eta_critical_s: number | null;
}

/** [ts, risk, vision, motion, audio] */
export type HistoryPoint = [number, number, number, number, number];

export interface ZoneState {
  zone_id: string;
  name: string;
  risk_score: number;
  alert_level: Level;
  vision: ModalityState;
  motion: ModalityState;
  audio: ModalityState;
  people_count: number;
  density_ppm2: number;
  los: string;
  fallen_count: number;
  chaos_index: number;
  avg_velocity: number;
  audio_label: string | null;
  transcript: string;
  keyword: string | null;
  hard_trigger: boolean;
  corroborated: boolean;
  active_modalities: string[];
  contributions: Record<string, number>;
  reasons: string[];
  forecast: Forecast;
  source_ids: string[];
  sources_online: number;
  blind_spot: boolean;
  scenario: string | null;
  open_incident_id: string | null;
  acknowledged: boolean;
  history: HistoryPoint[];
}

export interface ZoneConfig {
  id: string;
  name: string;
  area_m2: number;
  capacity: number;
  sop: string[];
  /** Map placement (step 2). Absent until the zone is placed on the map. */
  lat?: number | null;
  lng?: number | null;
  radius_m?: number | null;
}

/** What a device contributes. Phones and laptops can do all three. */
export interface Capabilities {
  video: boolean;
  audio: boolean;
  speaker: boolean;
}

export interface SourceState {
  id: string;
  name: string;
  kind: 'video' | 'audio';
  adapter: string;
  zone_id: string | null;
  status: string;
  fps: number;
  inference_fps: number;
  skipped_frames: number;
  total_frames: number;
  last_seen_age_s: number | null;
  has_audio: boolean;
  capabilities?: Capabilities;
  lat?: number | null;
  lng?: number | null;
}

export interface SpectraEvent {
  id: string;
  ts: number;
  zone_id: string;
  zone_name: string;
  kind: string;
  severity: 'info' | 'notice' | 'warning' | 'critical';
  message: string;
  simulated: boolean;
  incident_id?: string;
  level?: Level;
}

export type IncidentStatus = 'open' | 'acknowledged' | 'escalated' | 'resolved';

export interface IncidentSummary {
  id: string;
  zone_id: string;
  zone_name: string;
  started_at: number;
  ended_at: number | null;
  status: IncidentStatus;
  peak_level: Level;
  peak_risk: number;
  headline: string | null;
  brief_status: string;
  clip_count: number;
  thumb: string | null;
  scenario: string | null;
}

export interface IncidentBrief {
  headline: string;
  summary: string;
  likely_situation: string;
  false_alarm_check: string;
  confidence: 'low' | 'medium' | 'high';
  recommended_actions: { role: string; action: string; priority: 'now' | 'next' | 'monitor' }[];
  pa_announcement_en: string;
  pa_announcement_hi: string;
  source: 'llm' | 'template';
  model: string | null;
}

export interface Clip {
  source_id: string;
  url: string;
  thumb: string;
  face_blur: boolean;
}

export interface Incident extends IncidentSummary {
  peak_snapshot: Partial<ZoneState>;
  timeline: HistoryPoint[];
  clips: Clip[];
  brief: IncidentBrief | null;
  log: { ts: number; action: string; by: string; note: string }[];
}

export interface LatencyStats { p50: number | null; p95: number | null; count: number }

export interface ActiveScenario {
  zone_id: string;
  scenario: string;
  title: string;
  elapsed: number;
  duration_s: number;
}

export interface Announcement {
  id: string;
  ts: number;
  zone_id: string | null;
  zone_name: string;
  items: { lang: string; text: string }[];
}

export interface Speaker {
  id: string;
  name: string;
  zone_id: string | null;
  kind: 'dashboard' | 'device';
}

export interface LiveState {
  connected: boolean;
  zones: Record<string, ZoneState>;
  zoneConfigs: ZoneConfig[];
  sources: SourceState[];
  events: SpectraEvent[];
  incidents: IncidentSummary[];
  scenarios: ActiveScenario[];
  latencies: Record<string, LatencyStats>;
  totalPeople: number;
  announcements: Announcement[];
  speakers: Speaker[];
}

/**
 * Per-camera model outputs for the focus view (step 2: /ws/inspect/<id>).
 * Every block is optional so the page degrades to zone-level data.
 */
export interface Insight {
  ts: number;
  vision?: {
    model: string;
    ms: number;
    frame_w: number;
    frame_h: number;
    detections: { id: number | null; conf: number; box: [number, number, number, number] }[];
  };
  motion?: {
    ms: number;
    ratio: number;
    baseline: number;
    magnitude: number;
    direction_deg: number | null;
    calibrating: boolean;
  };
  audio?: {
    source_id: string;
    model: string;
    ms: number;
    whisper_ms: number | null;
    classes: { label: string; p: number }[];
    transcript: string;
    keyword: string | null;
    language: string | null;
    rms: number;
    hard_trigger: boolean;
    /** Log-mel energies, one column per frame, 0–1. */
    mel?: number[][];
  };
}

// ── Plain language ────────────────────────────────────────────────────

export const LEVEL_WORD: Record<Level, string> = {
  normal: 'Calm',
  elevated: 'Watch',
  high: 'Needs attention',
  critical: 'Act now',
};

export const LEVEL_SENTENCE: Record<Level, string> = {
  normal: 'Nothing unusual.',
  elevated: 'Something is a little unusual.',
  high: 'More than one sign of trouble. Check the cameras.',
  critical: 'Several sensors agree the crowd is in danger.',
};

export const CROWDING: Record<string, string> = {
  A: 'Plenty of room', B: 'Plenty of room', C: 'Getting busy', D: 'Crowded', E: 'Packed tight', F: 'Crush danger',
};

const RANK: Record<Level, number> = { normal: 0, elevated: 1, high: 2, critical: 3 };
export const rank = (l: Level) => RANK[l] ?? 0;
export const isAlarm = (z: ZoneState) => rank(z.alert_level) >= 2;

export function levelOf(score: number): Level {
  if (score >= 0.8) return 'critical';
  if (score >= 0.55) return 'high';
  if (score >= 0.3) return 'elevated';
  return 'normal';
}

/** Capabilities, inferred for devices registered before step 2. */
export function capsOf(s: SourceState): Capabilities {
  if (s.capabilities) return s.capabilities;
  return { video: s.kind === 'video', audio: s.kind === 'audio' || s.has_audio, speaker: s.adapter === 'browser_node' };
}

export const DEVICE_TYPE: Record<string, string> = {
  webcam: 'Laptop webcam',
  local_mic: 'Laptop microphone',
  browser_node: 'Phone or laptop (browser)',
  rtsp_http: 'Network camera',
  http_audio: 'Network microphone',
  file_loop: 'Recorded video',
  simulated: 'Simulated',
};

const SENSE_NAME: Record<string, string> = { vision: 'camera', motion: 'movement', audio: 'sound' };
const UPPER_LEVEL: Record<string, Level> = { NORMAL: 'normal', ELEVATED: 'elevated', HIGH: 'high', CRITICAL: 'critical' };

/**
 * The fusion engine writes its reasons and events for engineers (and for the
 * LLM). This says the same thing the way an operator would.
 */
export function plain(text: string): string {
  return text
    .replace(/Density ([\d.]+) people\/m² — Fruin LoS ([A-F]) \([^)]*\)/, (_, d, los) => `${CROWDING[los] ?? 'Crowded'} (${d} people per m²)`)
    .replace(/Sudden motion surge ([\d.]+)× camera baseline/, 'People suddenly moving $1× faster than usual')
    .replace('Sudden crowd motion surge vs baseline', 'People suddenly moving much faster than usual')
    .replace(/Crowd turbulence — heading variance [\d.]+/, 'People moving in many directions at once')
    .replace('Impulsive gunshot/explosion acoustic signature', 'Gunshot or explosion sound')
    .replace(/Acoustic threat: (.+?) \(\d+%\)/, 'Heard: $1')
    .replace(/Distress keyword “(.+?)” heard: “(.*?)”/, 'Someone shouted “$1”: “$2”')
    .replace(/Cross-modal confirmation: (.+) agree/, (_, mods: string) => `Confirmed: ${mods.split(' + ').map(m => SENSE_NAME[m] ?? m).join(' and ')} agree`)
    .replace(/Single-modality signal \((\w+)\) — capped until corroborated/, (_, m) => `Only the ${SENSE_NAME[m] ?? m} is worried, so the alarm is held back`)
    .replace(/Trend: CRITICAL in ~(\d+) s at current rate/, 'Could reach “Act now” in about $1 s')
    .replace('All sources offline — zone is blind; treat as unknown, not calm', 'Every sensor here stopped. Treat the zone as unknown, not calm')
    .replace(/(\d+) person\(s\) appear to be down/, '$1 person may be on the ground')
    .replace(/^Incident opened in (.+)$/, 'Alert opened in $1')
    .replace(/^(.+) back to NORMAL — incident closed$/, '$1 is calm again. Alert closed')
    .replace(/: all feeds lost — zone is BLIND$/, ': every sensor stopped')
    .replace(/: alert acknowledged by operator$/, ': someone is on it')
    .replace(/^AI brief: /, 'AI summary: ')
    .replace(/^SIMULATION started: /, 'Demo started: ')
    .replace(/\b(NORMAL|ELEVATED|HIGH|CRITICAL)\b/g, w => LEVEL_WORD[UPPER_LEVEL[w]]);
}

// ── Formatting ────────────────────────────────────────────────────────

export const fmtClock = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export function fmtAgo(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 10) return 'just now';
  if (s < 60) return `${Math.round(s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export function fmtDuration(a: number, b: number | null): string {
  const s = Math.round((b ?? Date.now() / 1000) - a);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* not json */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}
