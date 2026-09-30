/**
 * CameraTile — live preview for a video source.
 *
 * Shows: JPEG preview stream, status dot, FPS, SIM/LIVE badge,
 * source name, and last-seen age for degraded/offline sources.
 */

import { useEffect, useRef, useState } from 'react';
import type { SourceState } from '../hooks/useSpectraSocket';

interface CameraTileProps {
  source: SourceState;
}

export function CameraTile({ source }: CameraTileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [previewActive, setPreviewActive] = useState(false);

  useEffect(() => {
    if (source.status === 'offline') return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/preview/${source.id}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => setPreviewActive(true);

    ws.onmessage = (event) => {
      const blob = new Blob([event.data], { type: 'image/jpeg' });
      const imgUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0);
        }
        URL.revokeObjectURL(imgUrl);
      };
      img.src = imgUrl;
    };

    ws.onclose = () => setPreviewActive(false);
    ws.onerror = () => ws.close();

    return () => {
      ws.close();
    };
  }, [source.id, source.status]);

  const statusColor = {
    online: 'var(--color-online)',
    offline: 'var(--color-offline)',
    degraded: 'var(--color-degraded)',
    calibrating: 'var(--color-lavender)',
    error: 'var(--color-error)',
  }[source.status] || 'var(--color-offline)';

  const isSimulated = source.adapter === 'simulated';

  return (
    <div className="card card-dark" style={{
      minWidth: '280px',
      height: '220px',
      position: 'relative',
      overflow: 'hidden',
      padding: 0,
    }}>
      {/* Preview canvas / placeholder */}
      {source.status !== 'offline' ? (
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            borderRadius: 'var(--radius-card)',
          }}
        />
      ) : (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '8px',
          color: 'var(--color-text-muted)',
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 32, height: 32 }}>
            <rect x="2" y="4" width="20" height="14" rx="2" />
            <line x1="2" y1="4" x2="22" y2="18" strokeLinecap="round" />
          </svg>
          <span style={{ fontSize: '0.75rem' }}>No signal</span>
        </div>
      )}

      {/* Overlay: top info bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'linear-gradient(rgba(0,0,0,0.6), transparent)',
        borderRadius: 'var(--radius-card) var(--radius-card) 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="status-dot" style={{ background: statusColor }} />
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#fff' }}>
            {source.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isSimulated && <span className="badge badge-sim">SIM</span>}
          {!isSimulated && source.status === 'online' && <span className="badge badge-live">LIVE</span>}
        </div>
      </div>

      {/* Overlay: bottom stats bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
        borderRadius: '0 0 var(--radius-card) var(--radius-card)',
        fontSize: '0.7rem',
        color: 'rgba(255,255,255,0.7)',
      }}>
        <span className="tabular-nums">{source.fps} fps</span>
        {source.dropped_frames > 0 && (
          <span style={{ color: 'var(--color-degraded)' }}>
            {source.dropped_frames} dropped
          </span>
        )}
        {source.last_seen_age_s != null && source.last_seen_age_s > 5 && (
          <span style={{ color: 'var(--color-degraded)' }}>
            {source.last_seen_age_s.toFixed(0)}s ago
          </span>
        )}
      </div>

      {/* Degraded overlay — "blind spot" warning */}
      {(source.status === 'degraded' || source.status === 'error') && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.7)',
          borderRadius: 'var(--radius-card)',
        }}>
          <div style={{ textAlign: 'center', color: 'var(--color-degraded)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 32, height: 32, margin: '0 auto 8px' }}>
              <path d="M10 2L18 17H2L10 2Z" strokeLinejoin="round" />
              <line x1="10" y1="8" x2="10" y2="12" strokeLinecap="round" />
              <circle cx="10" cy="14.5" r="0.5" fill="currentColor" />
            </svg>
            <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>
              {source.status === 'error' ? 'Source Error' : 'Blind Spot'}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
              {source.name} stopped sending frames
              {source.last_seen_age_s != null && ` ${source.last_seen_age_s.toFixed(0)} s ago`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
