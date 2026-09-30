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

export interface LiveState {
  sources: SourceState[];
  metrics: {
    uptime_s: number;
    latencies: Record<string, { p50: number | null; p95: number | null; count: number }>;
    sources: Record<string, unknown>;
  };
  connected: boolean;
}

const INITIAL_STATE: LiveState = {
  sources: [],
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
