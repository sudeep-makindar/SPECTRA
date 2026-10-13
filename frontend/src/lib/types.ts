/** Shared types mirroring the backend's live payload. */

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
  raw_score: number;
  alert_level: Level;
  vision: ModalityState;
  motion: ModalityState;
  audio: ModalityState;
  people_count: number;
  density_ppm2: number;
  los: string;
  los_desc: string;
  fallen_count: number;
  chaos_index: number;
  avg_velocity: number;
  flow_direction_deg: number | null;
  occupancy_grid: number[][];
  audio_label: string | null;
  transcript: string;
  keyword: string | null;
  hard_trigger: boolean;
  contributions: Record<string, number>;
  active_modalities: string[];
  corroborated: boolean;
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
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sop: string[];
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
  dropped_frames: number;
  skipped_frames: number;
  total_frames: number;
  queue_depth: number;
  last_seen: number | null;
  last_seen_age_s: number | null;
  has_audio: boolean;
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

export interface IncidentSummary {
  id: string;
  zone_id: string;
  zone_name: string;
  started_at: number;
  ended_at: number | null;
  status: 'open' | 'acknowledged' | 'escalated' | 'resolved';
  peak_level: Level;
  peak_risk: number;
  headline: string | null;
  brief_status: string;
  clip_count: number;
  thumb: string | null;
  scenario: string | null;
}

export interface BriefAction {
  role: string;
  action: string;
  priority: 'now' | 'next' | 'monitor';
}

export interface IncidentBrief {
  headline: string;
  summary: string;
  likely_situation: string;
  false_alarm_check: string;
  confidence: 'low' | 'medium' | 'high';
  recommended_actions: BriefAction[];
  pa_announcement_en: string;
  pa_announcement_hi: string;
  source: 'llm' | 'template';
  model: string | null;
  generated_at: number;
  for_level: Level;
}

export interface Clip {
  source_id: string;
  url: string;
  thumb: string;
  frames: number;
  duration_s: number;
  trigger_offset_s: number;
  face_blur: boolean;
}

export interface Incident {
  id: string;
  zone_id: string;
  zone_name: string;
  started_at: number;
  ended_at: number | null;
  status: IncidentSummary['status'];
  trigger_level: Level;
  peak_level: Level;
  peak_risk: number;
  trigger_snapshot: Partial<ZoneState>;
  peak_snapshot: Partial<ZoneState>;
  timeline: HistoryPoint[];
  clips: Clip[];
  brief: IncidentBrief | null;
  brief_status: string;
  scenario: string | null;
  log: { ts: number; action: string; by: string; note: string }[];
}

export interface LatencyStats {
  p50: number | null;
  p95: number | null;
  p99: number | null;
  mean: number | null;
  count: number;
}

export interface Metrics {
  uptime_s: number;
  latencies: Record<string, LatencyStats>;
  sources: Record<string, { fps: number; inference_fps: number; skipped_frames: number; dropped_frames: number }>;
  system: {
    cpu_percent?: number;
    cpu_count?: number;
    ram_percent?: number;
    ram_used_gb?: number;
    ram_total_gb?: number;
    process_rss_gb?: number;
    threads?: number;
  };
  trend: ({ ts: number } & Record<string, number | null>)[];
}

export interface ActiveScenario {
  zone_id: string;
  scenario: string;
  title: string;
  elapsed: number;
  duration_s: number;
}

export interface LiveState {
  connected: boolean;
  ts: number;
  zones: Record<string, ZoneState>;
  zone_configs: ZoneConfig[];
  sources: SourceState[];
  events: SpectraEvent[];
  incidents: IncidentSummary[];
  scenarios: ActiveScenario[];
  metrics: Metrics;
  highest_risk: number;
  total_people: number;
  active_sources: number;
  total_sources: number;
}

export const LEVEL_COLOR: Record<Level, string> = {
  normal: 'var(--color-risk-normal)',
  elevated: 'var(--color-risk-elevated)',
  high: 'var(--color-risk-high)',
  critical: 'var(--color-risk-critical)',
};

/** Validated categorical slots (dark surface #10161D): vision, motion, audio. */
export const MODALITY_COLOR = {
  vision: '#3987e5',
  motion: '#d55181',
  audio: '#c98500',
} as const;

/** Zone lines use the same validated slots, in zone order. */
export const ZONE_SERIES = ['#3987e5', '#d55181', '#c98500'];

export function levelFromRisk(r: number): Level {
  if (r >= 0.8) return 'critical';
  if (r >= 0.55) return 'high';
  if (r >= 0.3) return 'elevated';
  return 'normal';
}

export function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function fmtAgo(ts: number): string {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* not json */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}
