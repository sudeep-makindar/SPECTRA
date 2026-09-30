/**
 * useSpectraSocket — WebSocket hook for live dashboard state.
 *
 * Connects to /ws/live and receives per-source status, zone risk,
 * and alert events at ~2 Hz. Auto-reconnects on disconnect.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export interface SourceState {
  id: string;
  name: string;
  kind: string;
  adapter: string;
  zone_id: string | null;
  status: string;
  fps: number;
  dropped_frames: number;
  total_frames: number;
  queue_depth: number;
  last_seen: number | null;
  last_seen_age_s: number | null;
}

export interface ZoneState {
  zone_id: string;
  name: string;
  risk_score: number;
  alert_level: 'normal' | 'elevated' | 'high' | 'critical';
  vision: { score: number; context: string; age_s: number };
  motion: { score: number; context: string; age_s: number };
  audio: { score: number; context: string; age_s: number };
  last_updated: number;
}

export interface LiveState {
  sources: SourceState[];
  active_sources: number;
  total_sources: number;
  active_zones: number;
  highest_risk: number;
  zones: Record<string, ZoneState>;
  metrics: {
    uptime_s: number;
    latencies: Record<string, { p50: number | null; p95: number | null; count: number }>;
    sources: Record<string, unknown>;
  };
  connected: boolean;
}

const INITIAL_STATE: LiveState = {
  sources: [],
  active_sources: 0,
  total_sources: 0,
  active_zones: 0,
  highest_risk: 0,
  zones: {},
  metrics: { uptime_s: 0, latencies: {}, sources: {} },
  connected: false,
};

export function useSpectraSocket(): LiveState {
  const [state, setState] = useState<LiveState>(INITIAL_STATE);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/live`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(prev => ({ ...prev, connected: true }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'state') {
          setState({
            sources: data.sources || [],
            active_sources: data.active_sources || 0,
            total_sources: data.total_sources || 0,
            active_zones: data.active_zones || 0,
            highest_risk: data.highest_risk || 0,
            zones: data.zones || {},
            metrics: data.metrics || INITIAL_STATE.metrics,
            connected: true,
          });
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setState(prev => ({ ...prev, connected: false }));
      // Reconnect after 2 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return state;
}
