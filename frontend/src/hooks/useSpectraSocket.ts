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

export interface ChartDataPoint {
  ts: number;
  density: number;
  audio: number;
  risk: number;
}

export interface LiveState {
  sources: SourceState[];
  active_sources: number;
  total_sources: number;
  active_zones: number;
  highest_risk: number;
  zones: Record<string, ZoneState>;
  history: ChartDataPoint[];
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
  history: [],
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
          setState(prev => {
            const zones = data.zones || {};
            // For the sparkline, just take the max density and audio across all zones
            let maxDensity = 0;
            let maxAudio = 0;
            Object.values(zones).forEach((z: any) => {
              if (z.vision && z.vision.score > maxDensity) maxDensity = z.vision.score;
              if (z.audio && z.audio.score > maxAudio) maxAudio = z.audio.score;
            });

            const newPoint: ChartDataPoint = {
              ts: data.ts,
              density: maxDensity,
              audio: maxAudio,
              risk: data.highest_risk || 0,
            };

            const newHistory = [...prev.history, newPoint].slice(-60); // Keep last 60 points (~30 seconds at 2Hz)

            return {
              sources: data.sources || [],
              active_sources: data.active_sources || 0,
              total_sources: data.total_sources || 0,
              active_zones: data.active_zones || 0,
              highest_risk: data.highest_risk || 0,
              zones: data.zones || {},
              history: newHistory,
              metrics: data.metrics || INITIAL_STATE.metrics,
              connected: true,
            };
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
