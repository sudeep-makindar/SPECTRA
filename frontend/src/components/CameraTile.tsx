/**
 * CameraTile — live annotated feed for a video source (tracked boxes, IDs,
 * optical-flow arrows, HUD), with zone assignment and health overlays.
 */

import { useEffect, useRef, useState } from 'react';
import { useSpectra } from '../context/SpectraContext';
import { api } from '../lib/types';
import type { SourceState } from '../lib/types';

export function CameraTile({ source, showControls = true }: { source: SourceState; showControls?: boolean }) {
  const { zones, zone_configs } = useSpectra();
  const imgRef = useRef<HTMLImageElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [raw, setRaw] = useState(false);
  const offline = source.status === 'offline' && !hasFrame;
  const isAudio = source.kind === 'audio';

  useEffect(() => {
    if (isAudio) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/preview/${source.id}?raw=${raw ? 1 : 0}`);
    ws.binaryType = 'arraybuffer';
    let prevUrl: string | null = null;
    ws.onmessage = ev => {
      const url = URL.createObjectURL(new Blob([ev.data], { type: 'image/jpeg' }));
      if (imgRef.current) imgRef.current.src = url;
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      prevUrl = url;
      setHasFrame(true);
    };
    ws.onerror = () => ws.close();
    return () => { ws.close(); if (prevUrl) URL.revokeObjectURL(prevUrl); };
  }, [source.id, raw, isAudio, source.status]);

  const zone = source.zone_id ? zones[source.zone_id] : undefined;
  const statusColor = { online: 'var(--color-online)', degraded: 'var(--color-degraded)', error: 'var(--color-error)' }[source.status] ?? 'var(--color-offline)';
  const alarm = zone && (zone.alert_level === 'high' || zone.alert_level === 'critical');

  const assign = (zid: string) => api(`/api/sources/${source.id}`, { method: 'PATCH', json: { zone_id: zid } });
  const remove = () => { if (confirm(`Remove ${source.name}?`)) api(`/api/sources/${source.id}`, { method: 'DELETE' }); };

  return (
    <div className="card card-dark" style={{ padding: 0, overflow: 'hidden', boxShadow: alarm ? `inset 0 0 0 2px var(--color-risk-${zone!.alert_level})` : undefined }}>
      <div className="camera-wrap">
        {isAudio ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
            <AudioBars level={zone?.audio.score ?? 0} active={source.status === 'online'} />
            <span className="muted" style={{ fontSize: '0.75rem' }}>{zone?.audio_label ?? 'Listening…'}</span>
            {zone?.transcript && <span className="mono" style={{ fontSize: '0.72rem', maxWidth: '85%', textAlign: 'center' }}>“{zone.transcript}”</span>}
          </div>
        ) : (
          <img ref={imgRef} alt={`${source.name} live feed`} style={{ opacity: hasFrame ? 1 : 0 }} />
        )}
        {!isAudio && !hasFrame && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="dim">
            {offline ? 'No signal' : 'Connecting…'}
          </div>
        )}
        <div className="camera-overlay-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span className="status-dot" style={{ background: statusColor }} />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source.name}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {alarm && <span className="rec-dot" title="Recording evidence" />}
            {source.adapter === 'simulated' ? <span className="badge badge-sim">SIM</span>
              : source.status === 'online' ? <span className="badge badge-live">LIVE</span> : null}
          </div>
        </div>
        {(source.status === 'degraded' || source.status === 'error') && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4, color: 'var(--color-degraded)' }}>
            <b>{source.status === 'error' ? 'SOURCE ERROR' : 'BLIND SPOT'}</b>
            <span className="dim" style={{ fontSize: '0.7rem' }}>No frames for {source.last_seen_age_s?.toFixed(0) ?? '?'}s</span>
          </div>
        )}
        <div className="camera-overlay-bottom">
          <span className="tabular-nums">{source.fps} fps in · {source.inference_fps} fps AI</span>
          {source.skipped_frames > 0 && <span className="tabular-nums" title="Frames skipped by backpressure (latest-wins)">{source.skipped_frames} skipped</span>}
        </div>
      </div>
      {showControls && (
        <div style={{ display: 'flex', gap: 6, padding: 10, alignItems: 'center' }}>
          <select className="text-input" style={{ padding: '5px 10px', fontSize: '0.74rem' }} value={source.zone_id ?? ''} onChange={e => assign(e.target.value)}>
            {zone_configs.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          {!isAudio && <button className="btn btn-sm btn-ghost" onClick={() => setRaw(!raw)} title="Toggle AI overlay">{raw ? 'Raw' : 'AI view'}</button>}
          <button className="btn btn-sm btn-ghost" onClick={remove} title="Remove source">✕</button>
        </div>
      )}
    </div>
  );
}

function AudioBars({ level, active }: { level: number; active: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick(x => x + 1), 120);
    return () => clearInterval(t);
  }, [active]);
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 48 }}>
      {Array.from({ length: 18 }, (_, i) => {
        const h = active ? 6 + Math.abs(Math.sin((tick + i * 1.7) * 0.6)) * (10 + level * 38) : 4;
        return <div key={i} style={{ width: 4, height: h, borderRadius: 2, background: 'var(--color-series-audio)', transition: 'height 120ms' }} />;
      })}
    </div>
  );
}
