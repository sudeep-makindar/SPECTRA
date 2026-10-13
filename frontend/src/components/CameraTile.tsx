/**
 * CameraTile — live annotated feed for a video source (tracked boxes, IDs,
 * optical-flow arrows, HUD) or a live audio meter for a microphone.
 */

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Mic, VideoOff } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import type { SourceState } from '../lib/types';

export function CameraTile({ source }: { source: SourceState }) {
  const { zones } = useSpectra();
  const imgRef = useRef<HTMLImageElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [raw, setRaw] = useState(false);
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
  const alarm = zone && (zone.alert_level === 'high' || zone.alert_level === 'critical');
  const stale = source.status === 'degraded' || source.status === 'error';

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderColor: alarm ? `var(--color-risk-${zone!.alert_level})` : undefined }}>
      <div className="camera-wrap" style={{ border: 'none', borderRadius: 0 }}>
        {isAudio ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, padding: 16 }}>
            <AudioBars level={zone?.audio.score ?? 0} active={source.status === 'online'} />
            <span className="muted" style={{ fontSize: '0.78rem' }}>{zone?.audio_label ?? (source.status === 'online' ? 'Listening' : 'Microphone offline')}</span>
            {zone?.transcript && <span className="mono" style={{ fontSize: '0.74rem', maxWidth: '90%', textAlign: 'center' }}>“{zone.transcript}”</span>}
          </div>
        ) : (
          <img ref={imgRef} alt={`${source.name} live feed`} style={{ opacity: hasFrame ? 1 : 0 }} />
        )}
        {!isAudio && !hasFrame && (
          <div className="dim" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, fontSize: '0.8rem' }}>
            <VideoOff size={22} /> {source.status === 'offline' ? 'Waiting for device' : 'Connecting…'}
          </div>
        )}
        <div className="camera-overlay-top">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', fontWeight: 600, color: '#fff', minWidth: 0 }}>
            {isAudio && <Mic size={13} />}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source.name}</span>
          </span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {alarm && <span className="rec-dot" title="Recording evidence" />}
            {source.status === 'online' && <span className="badge badge-live">Live</span>}
          </span>
        </div>
        {stale && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,11,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4 }}>
            <span className="level-pill level-blind">{source.status === 'error' ? 'source error' : 'no frames'}</span>
            <span className="dim" style={{ fontSize: '0.72rem' }}>Last data {source.last_seen_age_s?.toFixed(0) ?? '?'}s ago</span>
          </div>
        )}
        {!isAudio && (
          <div className="camera-overlay-bottom">
            <span>{source.fps} fps · AI {source.inference_fps} fps</span>
            <button className="btn btn-ghost btn-sm" style={{ color: '#fff', padding: '2px 6px' }} onClick={() => setRaw(!raw)} title="Toggle AI overlay">
              {raw ? <EyeOff /> : <Eye />} {raw ? 'Raw' : 'AI'}
            </button>
          </div>
        )}
      </div>
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
      {Array.from({ length: 22 }, (_, i) => {
        const h = active ? 4 + Math.abs(Math.sin((tick + i * 1.7) * 0.6)) * (8 + level * 38) : 3;
        return <div key={i} style={{ width: 3, height: h, borderRadius: 2, background: 'var(--color-series-audio)', transition: 'height 120ms' }} />;
      })}
    </div>
  );
}
