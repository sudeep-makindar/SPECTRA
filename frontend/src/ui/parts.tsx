/**
 * Small building blocks shared by every page: live camera picture, mic level,
 * number tiles, zone tabs, level badge and the alarm banner.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Siren } from 'lucide-react';
import { useLive } from './LiveContext';
import { LEVEL_WORD, plain, wsUrl } from './live';
import type { Level, SourceState } from './live';

/** Live JPEG stream from /ws/preview. `ai` draws the model overlay. */
export function Feed({ source, ai = true, onFrame }: { source: SourceState; ai?: boolean; onFrame?: (img: HTMLImageElement) => void }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const online = source.status === 'online';
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (source.kind !== 'video') return;
    const ws = new WebSocket(wsUrl(`/ws/preview/${source.id}?raw=${ai ? 0 : 1}`));
    ws.binaryType = 'arraybuffer';
    let prev: string | null = null;
    ws.onmessage = ev => {
      const url = URL.createObjectURL(new Blob([ev.data], { type: 'image/jpeg' }));
      const img = imgRef.current;
      if (img) {
        img.onload = () => onFrameRef.current?.(img);
        img.src = url;
      }
      if (prev) URL.revokeObjectURL(prev);
      prev = url;
      setHasFrame(true);
    };
    ws.onerror = () => ws.close();
    return () => { ws.close(); if (prev) URL.revokeObjectURL(prev); };
  }, [source.id, source.kind, ai, source.status]);

  return (
    <>
      <img ref={imgRef} alt={`${source.name}, live`} style={{ opacity: hasFrame && online ? 1 : 0.25 }} />
      {(!hasFrame || !online) && (
        <div className="feed-empty">
          {source.status === 'offline' ? 'Waiting for the device to connect' : online ? 'Connecting…' : 'No picture from this camera'}
        </div>
      )}
    </>
  );
}

/** Mic level as a row of bars. Animated from the audio score; idle when quiet. */
export function MicBars({ level, active, n = 14 }: { level: number; active: boolean; n?: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick(x => x + 1), 140);
    return () => clearInterval(t);
  }, [active]);
  return (
    <span className="mic-bars" aria-label={active ? 'Microphone active' : 'Microphone idle'}>
      {Array.from({ length: n }, (_, i) => {
        const h = active ? 3 + Math.abs(Math.sin((tick + i * 1.9) * 0.55)) * (4 + level * 16) : 3;
        return <i key={i} style={{ height: h }} />;
      })}
    </span>
  );
}

export function Kpi({ icon, label, value, unit, note, level }: { icon: ReactNode; label: string; value: ReactNode; unit?: string; note?: ReactNode; level?: Level }) {
  const hot = level === 'elevated' || level === 'high' || level === 'critical';
  return (
    <div className={`kpi ${hot ? `hot lv-${level}` : ''}`}>
      <div className="kpi-icon">{icon}</div>
      <div className="col" style={{ gap: 2 }}>
        <span className="kpi-label">{label}</span>
        <span className="kpi-value">{value}{unit && <small> {unit}</small>}</span>
        {note && <span className="kpi-note">{note}</span>}
      </div>
    </div>
  );
}

export function LevelBadge({ level, text }: { level: Level; text?: string }) {
  return <span className={`badge lv-${level}`}>{text ?? LEVEL_WORD[level]}</span>;
}

/** All / Zone A / Zone B … with a risk dot when a zone is not calm. */
export function ZoneTabs() {
  const { zoneList, zoneFilter, setZoneFilter } = useLive();
  if (zoneList.length < 2) return null;
  return (
    <div className="seg" role="tablist" aria-label="Zones">
      <button className={zoneFilter === 'all' ? 'on' : ''} onClick={() => setZoneFilter('all')}>All zones</button>
      {zoneList.map(z => (
        <button key={z.zone_id} className={`${zoneFilter === z.zone_id ? 'on' : ''} lv-${z.alert_level}`} onClick={() => setZoneFilter(z.zone_id)}>
          {z.alert_level !== 'normal' && <span className="dot" />}{z.name}
        </button>
      ))}
    </div>
  );
}

/** Follows the operator to every page while an alarm is unanswered. */
export function AlarmBanner() {
  const { alarms, acknowledge } = useLive();
  const navigate = useNavigate();
  const z = [...alarms].sort((a, b) => b.risk_score - a.risk_score)[0];
  if (!z) return null;
  return (
    <div className={`banner lv-${z.alert_level}`} role="alert">
      <Siren size={20} />
      <span className="grow">{LEVEL_WORD[z.alert_level]} at {z.name}: {z.reasons[0] ? plain(z.reasons[0]) : 'risk is rising'}</span>
      {z.open_incident_id && <button className="btn" onClick={() => navigate(`/alerts?id=${z.open_incident_id}`)}>What to do</button>}
      <button className="btn" onClick={() => acknowledge(z.zone_id)}>I’m on it</button>
    </div>
  );
}
