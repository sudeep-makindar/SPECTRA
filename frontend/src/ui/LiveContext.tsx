/**
 * LiveProvider — one /ws/live connection for the whole app, the alert chime,
 * the zone the operator is looking at, and which dialog is open.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Announcement, LiveState, Level, ZoneState } from './live';
import { api, isAlarm, rank, wsUrl } from './live';
import { speakLocally } from './speech';

const INITIAL: LiveState = {
  connected: false, zones: {}, zoneConfigs: [], sources: [], events: [], incidents: [], scenarios: [], latencies: {}, totalPeople: 0,
  announcements: [], speakers: [],
};

export interface Copilot { enabled: boolean; provider_label: string; model: string; key_env: string | null }
export type DialogName = 'demo' | 'announce' | 'add-device' | 'speaker' | null;
export type DialogContext = { zoneId?: string; text?: string; hi?: string };

/** This computer as a speaker: plays announcements for one zone, or all zones. */
export interface SpeakerSettings { enabled: boolean; zone: string; name: string }

interface Ctx extends LiveState {
  /** Zones in configured order, with live state. */
  zoneList: ZoneState[];
  /** The zone with the highest risk, if any. */
  worst: ZoneState | null;
  /** Zones at HIGH or CRITICAL that nobody has acknowledged. */
  alarms: ZoneState[];
  copilot: Copilot | null;
  /** 'all' or a zone id; shared by the wall and the dashboard. */
  zoneFilter: string;
  setZoneFilter: (z: string) => void;
  dialog: DialogName;
  openDialog: (d: DialogName, context?: DialogContext) => void;
  dialogContext: DialogContext;
  speaker: SpeakerSettings;
  setSpeaker: (s: SpeakerSettings) => void;
  /** Speech needs one click on the page after loading; false until then. */
  speechArmed: boolean;
  muted: boolean;
  setMuted: (m: boolean) => void;
  acknowledge: (zoneId: string) => Promise<void>;
}

const LiveContext = createContext<Ctx | null>(null);

function chime(critical: boolean) {
  try {
    const ctx = new AudioContext();
    (critical ? [880, 660, 880, 660] : [660, 880]).forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.17);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* blocked until the first click */ }
}

function stored(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>(INITIAL);
  const [copilot, setCopilot] = useState<Copilot | null>(null);
  const [zoneFilter, setZoneFilterState] = useState(() => stored('spectra.zone', 'all'));
  const [dialog, setDialog] = useState<DialogName>(null);
  const [dialogContext, setDialogContext] = useState<DialogContext>({});
  const [speaker, setSpeakerState] = useState<SpeakerSettings>(() => {
    try { return { enabled: false, zone: 'all', name: 'Control room', ...JSON.parse(localStorage.getItem('spectra.speaker') ?? '{}') }; }
    catch { return { enabled: false, zone: 'all', name: 'Control room' }; }
  });
  const [speechArmed, setSpeechArmed] = useState(() => !!navigator.userActivation?.hasBeenActive);
  const speakerId = useRef(stored('spectra.speaker.id', '') || `dash-${Math.random().toString(36).slice(2, 10)}`);
  const seenAnnouncements = useRef<Set<string> | null>(null);
  const [muted, setMutedState] = useState(() => stored('spectra.muted', '0') === '1');
  const lastLevels = useRef<Record<string, Level>>({});

  const setZoneFilter = useCallback((z: string) => { setZoneFilterState(z); store('spectra.zone', z); }, []);
  const setMuted = useCallback((m: boolean) => { setMutedState(m); store('spectra.muted', m ? '1' : '0'); }, []);
  const setSpeaker = useCallback((s: SpeakerSettings) => { setSpeakerState(s); store('spectra.speaker', JSON.stringify(s)); }, []);
  const openDialog = useCallback((d: DialogName, context: DialogContext = {}) => {
    setDialogContext(context);
    setDialog(d);
  }, []);

  useEffect(() => {
    const load = () => api<{ copilot: Copilot }>('/api/health').then(h => setCopilot(h.copilot)).catch(() => setCopilot(null));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      ws = new WebSocket(wsUrl('/ws/live'));
      ws.onmessage = ev => {
        try {
          const d = JSON.parse(ev.data);
          if (d.type !== 'state') return;
          setState({
            connected: true,
            zones: d.zones ?? {},
            zoneConfigs: d.zone_configs ?? [],
            sources: d.sources ?? [],
            events: d.events ?? [],
            incidents: d.incidents ?? [],
            scenarios: d.scenarios ?? [],
            latencies: d.metrics?.latencies ?? {},
            totalPeople: d.total_people ?? 0,
            announcements: d.announcements ?? [],
            speakers: d.speakers ?? [],
          });
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        setState(prev => ({ ...prev, connected: false }));
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => { closed = true; clearTimeout(retry); ws?.close(); };
  }, []);

  const zoneList = useMemo(
    () => state.zoneConfigs.map(c => state.zones[c.id]).filter((z): z is ZoneState => !!z),
    [state.zoneConfigs, state.zones],
  );
  const worst = useMemo(() => zoneList.reduce<ZoneState | null>((w, z) => (!w || z.risk_score > w.risk_score ? z : w), null), [zoneList]);
  const alarms = useMemo(() => zoneList.filter(z => isAlarm(z) && !z.acknowledged), [zoneList]);

  // Chime once each time a zone escalates into HIGH or CRITICAL.
  useEffect(() => {
    for (const z of zoneList) {
      const prev = lastLevels.current[z.zone_id];
      if (prev && rank(z.alert_level) > rank(prev) && isAlarm(z) && !z.acknowledged && !muted) chime(z.alert_level === 'critical');
      lastLevels.current[z.zone_id] = z.alert_level;
    }
  }, [zoneList, muted]);

  // Browsers only allow speech after the first click on the page.
  useEffect(() => {
    if (speechArmed) return;
    const arm = () => setSpeechArmed(true);
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => { window.removeEventListener('pointerdown', arm); window.removeEventListener('keydown', arm); };
  }, [speechArmed]);

  // As a speaker, check in with SPECTRA so announcements count this computer.
  useEffect(() => {
    store('spectra.speaker.id', speakerId.current);
    if (!speaker.enabled) {
      api(`/api/speakers/${speakerId.current}`, { method: 'DELETE' }).catch(() => {});
      return;
    }
    const beat = () => api('/api/speakers/heartbeat', {
      method: 'POST', json: { id: speakerId.current, name: speaker.name, zone_id: speaker.zone === 'all' ? null : speaker.zone },
    }).catch(() => {});
    beat();
    const t = setInterval(beat, 8000);
    return () => clearInterval(t);
  }, [speaker]);

  // Play announcements that arrive while this page is open (never old ones).
  useEffect(() => {
    if (!state.connected) return;
    if (seenAnnouncements.current === null) {
      seenAnnouncements.current = new Set(state.announcements.map(a => a.id));
      return;
    }
    const fresh: Announcement[] = state.announcements.filter(a => !seenAnnouncements.current!.has(a.id));
    for (const a of fresh) {
      seenAnnouncements.current.add(a.id);
      const forMe = a.zone_id === null || speaker.zone === 'all' || a.zone_id === speaker.zone;
      if (speaker.enabled && forMe) speakLocally(a.items);
    }
  }, [state.announcements, state.connected, speaker]);

  // A filter pointing at a deleted zone falls back to "all".
  useEffect(() => {
    if (zoneFilter !== 'all' && state.zoneConfigs.length && !state.zoneConfigs.some(z => z.id === zoneFilter)) setZoneFilter('all');
  }, [state.zoneConfigs, zoneFilter, setZoneFilter]);

  const acknowledge = useCallback(async (zoneId: string) => {
    const z = state.zones[zoneId];
    if (!z) return;
    if (z.open_incident_id) {
      await api(`/api/incidents/${z.open_incident_id}/action`, { method: 'POST', json: { action: 'acknowledge' } });
    } else {
      await api(`/api/zones/${zoneId}/acknowledge`, { method: 'POST' });
    }
  }, [state.zones]);

  const value: Ctx = {
    ...state, zoneList, worst, alarms, copilot,
    zoneFilter, setZoneFilter, dialog, openDialog, dialogContext, muted, setMuted, acknowledge,
    speaker, setSpeaker, speechArmed,
  };
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): Ctx {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used inside <LiveProvider>');
  return ctx;
}
