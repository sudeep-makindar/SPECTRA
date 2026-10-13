/**
 * SpectraProvider — one /ws/live connection for the whole app.
 *
 * Also owns the control-room conveniences that must work on every page:
 * the critical-alert tone (with mute), and the operator hotkeys.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LiveState, ZoneState } from '../lib/types';
import { api } from '../lib/types';

const INITIAL: LiveState = {
  connected: false,
  ts: 0,
  zones: {},
  zone_configs: [],
  sources: [],
  events: [],
  incidents: [],
  scenarios: [],
  metrics: { uptime_s: 0, latencies: {}, sources: {}, system: {}, trend: [] },
  highest_risk: 0,
  total_people: 0,
  active_sources: 0,
  total_sources: 0,
};

interface Ctx extends LiveState {
  muted: boolean;
  setMuted: (m: boolean) => void;
  focusZone: string | null;
  setFocusZone: (z: string | null) => void;
  alarmZones: ZoneState[];
  acknowledgeAll: () => Promise<void>;
}

const SpectraContext = createContext<Ctx | null>(null);

function playTone(critical: boolean) {
  try {
    const ctx = new AudioContext();
    const notes = critical ? [880, 660, 880, 660] : [660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
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
  } catch {
    /* audio blocked until first user gesture */
  }
}

export function SpectraProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LiveState>(INITIAL);
  const [muted, setMutedState] = useState<boolean>(() => {
    try { return localStorage.getItem('spectra.muted') === '1'; } catch { return false; }
  });
  const [focusZone, setFocusZone] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastToneRef = useRef<Record<string, string>>({});

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    try { localStorage.setItem('spectra.muted', m ? '1' : '0'); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let closed = false;
    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/live`);
      wsRef.current = ws;
      ws.onopen = () => setState(prev => ({ ...prev, connected: true }));
      ws.onmessage = ev => {
        try {
          const d = JSON.parse(ev.data);
          if (d.type !== 'state') return;
          setState({
            connected: true,
            ts: d.ts,
            zones: d.zones ?? {},
            zone_configs: d.zone_configs ?? [],
            sources: d.sources ?? [],
            events: d.events ?? [],
            incidents: d.incidents ?? [],
            scenarios: d.scenarios ?? [],
            metrics: d.metrics ?? INITIAL.metrics,
            highest_risk: d.highest_risk ?? 0,
            total_people: d.total_people ?? 0,
            active_sources: d.active_sources ?? 0,
            total_sources: d.total_sources ?? 0,
          });
        } catch { /* ignore malformed */ }
      };
      ws.onclose = () => {
        setState(prev => ({ ...prev, connected: false }));
        if (!closed) retryRef.current = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, []);

  const alarmZones = useMemo(
    () => Object.values(state.zones).filter(z => (z.alert_level === 'high' || z.alert_level === 'critical') && !z.acknowledged),
    [state.zones],
  );

  // Alert tone on escalation into HIGH / CRITICAL (once per escalation)
  useEffect(() => {
    for (const z of Object.values(state.zones)) {
      const prev = lastToneRef.current[z.zone_id];
      const lvl = z.alert_level;
      if ((lvl === 'high' || lvl === 'critical') && prev !== lvl && !z.acknowledged && !muted) {
        if (!(prev === 'critical' && lvl === 'high')) playTone(lvl === 'critical');
      }
      lastToneRef.current[z.zone_id] = lvl;
    }
  }, [state.zones, muted]);

  const acknowledgeAll = useCallback(async () => {
    await Promise.all(alarmZones.map(z => {
      if (z.open_incident_id) {
        return api(`/api/incidents/${z.open_incident_id}/action`, { method: 'POST', json: { action: 'acknowledge' } });
      }
      return api(`/api/zones/${z.zone_id}/acknowledge`, { method: 'POST' });
    }));
  }, [alarmZones]);

  // Hotkeys: A acknowledge, E escalate the hottest open incident, M mute
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'a') acknowledgeAll();
      if (key === 'm') setMuted(!muted);
      if (key === 'e') {
        const hottest = [...alarmZones, ...Object.values(state.zones)]
          .filter(z => z.open_incident_id)
          .sort((a, b) => b.risk_score - a.risk_score)[0];
        if (hottest?.open_incident_id) {
          api(`/api/incidents/${hottest.open_incident_id}/action`, { method: 'POST', json: { action: 'escalate', note: 'Escalated to event lead (hotkey E)' } });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [acknowledgeAll, alarmZones, muted, setMuted, state.zones]);

  const value: Ctx = { ...state, muted, setMuted, focusZone, setFocusZone, alarmZones, acknowledgeAll };
  return <SpectraContext.Provider value={value}>{children}</SpectraContext.Provider>;
}

export function useSpectra(): Ctx {
  const ctx = useContext(SpectraContext);
  if (!ctx) throw new Error('useSpectra must be used inside <SpectraProvider>');
  return ctx;
}
