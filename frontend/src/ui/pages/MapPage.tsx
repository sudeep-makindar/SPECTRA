/**
 * Map — the venue on a real street map. Zones are circles that heat up with
 * risk; devices are pins. Click a zone to see its cameras, a pin to open one.
 * "Edit layout" places zones and devices by clicking the map.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { Crosshair, LocateFixed, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useLive } from '../LiveContext';
import { LevelBadge } from '../parts';
import { LEVEL_WORD, api, capsOf } from '../live';
import type { Level, SourceState, ZoneConfig } from '../live';

const DEFAULT_CENTER: [number, number] = [12.9716, 77.5946];
const RISK_HEX: Record<Level, string> = { normal: '#8E8C87', elevated: '#E8B04B', high: '#EE7A3B', critical: '#EF4B43' };

const placed = (z: ZoneConfig) => z.lat != null && z.lng != null;

function pinIcon(s: SourceState) {
  const caps = capsOf(s);
  const glyph = caps.video
    ? '<path d="M15 10l4.5-2.5v9L15 14M3 7h12v10H3z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>'
    : caps.audio
      ? '<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" stroke-width="2" fill="none"/>'
      : '<path d="M4 9v6h4l5 4V5L8 9H4z" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/>';
  return L.divIcon({
    className: '',
    html: `<div class="pin ${s.status === 'online' ? '' : 'off'}"><svg viewBox="0 0 24 24">${glyph}</svg></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function ClickToPlace({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done || !points.length) return;
    if (points.length === 1) map.setView(points[0], 18);
    else map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 18 });
    setDone(true);
  }, [points, map, done]);
  return null;
}

function Locate() {
  const map = useMap();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-sm" style={{ position: 'absolute', zIndex: 500, right: 12, top: 12 }} disabled={busy}
      onClick={() => {
        setBusy(true);
        navigator.geolocation?.getCurrentPosition(
          p => { map.setView([p.coords.latitude, p.coords.longitude], 18); setBusy(false); },
          () => setBusy(false),
          { enableHighAccuracy: true, timeout: 8000 },
        );
      }}>
      <LocateFixed /> {busy ? 'Finding you…' : 'My location'}
    </button>
  );
}

type Placing = { kind: 'zone'; id: string } | { kind: 'device'; id: string } | { kind: 'new-zone' } | null;

export function MapPage() {
  const s = useLive();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState<Placing>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const points = useMemo<[number, number][]>(() => [
    ...s.zoneConfigs.filter(placed).map(z => [z.lat!, z.lng!] as [number, number]),
    ...s.sources.filter(x => x.lat != null && x.lng != null).map(x => [x.lat!, x.lng!] as [number, number]),
  ], [s.zoneConfigs, s.sources]);

  const place = async (lat: number, lng: number) => {
    if (!placing) return;
    setError(null);
    try {
      if (placing.kind === 'zone') await api(`/api/zones/${placing.id}`, { method: 'PATCH', json: { lat, lng } });
      if (placing.kind === 'device') await api(`/api/sources/${placing.id}`, { method: 'PATCH', json: { lat, lng } });
      if (placing.kind === 'new-zone') {
        await api('/api/zones', { method: 'POST', json: { name: newName.trim() || `Zone ${s.zoneConfigs.length + 1}`, lat, lng, radius_m: 25 } });
        setNewName('');
      }
      setPlacing(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const setRadius = (id: string, radius_m: number) => api(`/api/zones/${id}`, { method: 'PATCH', json: { radius_m } }).catch(e => setError(e.message));
  const removeZone = async (z: ZoneConfig) => {
    if (!confirm(`Delete zone “${z.name}”? Its devices move to the first zone.`)) return;
    await api(`/api/zones/${z.id}`, { method: 'DELETE' }).catch(e => setError(e.message));
  };

  const hint = placing?.kind === 'new-zone' ? 'Click the map where the new zone is.'
    : placing?.kind === 'zone' ? `Click the map to move ${s.zoneConfigs.find(z => z.id === placing.id)?.name}.`
    : placing?.kind === 'device' ? `Click the map where ${s.sources.find(x => x.id === placing.id)?.name} is.` : null;
  const unplacedDevices = s.sources.filter(x => x.lat == null || x.lng == null);

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">Venue<br />Map</h1>
          <p className="subtitle">Zones glow as their risk rises. Click a zone to see its cameras, or a pin to open that device.</p>
        </div>
        <div className="row">
          {editing
            ? <button className="btn btn-primary" onClick={() => { setEditing(false); setPlacing(null); }}>Done editing</button>
            : <button className="btn" onClick={() => setEditing(true)}><Pencil /> Edit layout</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16 }} className="map-grid">
        <div className="map-wrap" style={{ cursor: placing ? 'crosshair' : undefined }}>
          <MapContainer center={DEFAULT_CENTER} zoom={16} style={{ height: '100%', width: '100%' }} zoomControl>
            {/* Standard OpenStreetMap tiles (free, no key), darkened in CSS (.map-tiles). */}
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
              className="map-tiles"
            />
            <FitOnce points={points} />
            <Locate />
            {placing && <ClickToPlace onClick={place} />}
            {s.zoneConfigs.filter(placed).map(z => {
              const live = s.zones[z.id];
              const lvl = live?.alert_level ?? 'normal';
              return (
                <Circle key={z.id} center={[z.lat!, z.lng!]} radius={z.radius_m ?? 25}
                  pathOptions={{ color: RISK_HEX[lvl], weight: lvl === 'normal' ? 1.5 : 3, fillColor: RISK_HEX[lvl], fillOpacity: lvl === 'normal' ? 0.08 : 0.28 }}
                  eventHandlers={{ click: () => { if (!placing) { s.setZoneFilter(z.id); navigate('/'); } } }}>
                  <Tooltip permanent direction="center" className="zone-tip">{z.name}{live && lvl !== 'normal' ? ` · ${LEVEL_WORD[lvl]}` : ''}</Tooltip>
                </Circle>
              );
            })}
            {s.sources.filter(x => x.lat != null && x.lng != null).map(x => (
              <Marker key={x.id} position={[x.lat!, x.lng!]} icon={pinIcon(x)}
                eventHandlers={{ click: () => { if (!placing && x.kind === 'video') navigate(`/camera/${x.id}`); } }}>
                <Tooltip direction="top" offset={[0, -14]}>{x.name}</Tooltip>
              </Marker>
            ))}
          </MapContainer>
          {hint && (
            <div className="banner lv-offline" style={{ position: 'absolute', zIndex: 600, left: 12, bottom: 12, background: 'var(--panel)', border: '1px solid var(--line-2)' }}>
              <Crosshair size={18} /> {hint}
              <button className="btn btn-sm" onClick={() => setPlacing(null)}><X /> Cancel</button>
            </div>
          )}
        </div>

        <aside className="map-side">
          <span className="label">Zones</span>
          {s.zoneConfigs.map(z => {
            const live = s.zones[z.id];
            const lvl = live?.alert_level ?? 'normal';
            const cams = s.sources.filter(x => x.zone_id === z.id);
            return (
              <div key={z.id} className={`zone-card lv-${lvl} ${lvl !== 'normal' ? 'hot' : ''}`}>
                <div className="row">
                  <b className="grow truncate">{z.name}</b>
                  <LevelBadge level={lvl} />
                </div>
                <span className="ink-3 sm">{cams.length} devices · {live?.people_count ?? 0} people · risk {Math.round((live?.risk_score ?? 0) * 100)}</span>
                {editing && (
                  <div className="col" style={{ gap: 8, marginTop: 6 }}>
                    <div className="row">
                      <button className="btn btn-sm grow" onClick={() => setPlacing({ kind: 'zone', id: z.id })}><MapPin /> {placed(z) ? 'Move' : 'Place on map'}</button>
                      {s.zoneConfigs.length > 1 && <button className="btn btn-sm" onClick={() => removeZone(z)} aria-label={`Delete ${z.name}`}><Trash2 /></button>}
                    </div>
                    {placed(z) && (
                      <label className="field">Circle radius: {Math.round(z.radius_m ?? 25)} m
                        <input type="range" min={5} max={150} step={5} defaultValue={z.radius_m ?? 25} onPointerUp={e => setRadius(z.id, Number((e.target as HTMLInputElement).value))} onKeyUp={e => setRadius(z.id, Number((e.target as HTMLInputElement).value))} />
                      </label>
                    )}
                  </div>
                )}
                {!editing && !placed(z) && <span className="ink-3 xs">Not on the map yet. Use “Edit layout”.</span>}
              </div>
            );
          })}

          {editing && (
            <>
              <div className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <b>New zone</b>
                <input className="input" placeholder="Name, e.g. Stage front" value={newName} onChange={e => setNewName(e.target.value)} />
                <button className="btn btn-primary" onClick={() => setPlacing({ kind: 'new-zone' })}><Plus /> Click map to place</button>
              </div>
              {unplacedDevices.length > 0 && (
                <>
                  <span className="label" style={{ marginTop: 6 }}>Devices not on the map</span>
                  {unplacedDevices.map(x => (
                    <button key={x.id} className="zone-card" onClick={() => setPlacing({ kind: 'device', id: x.id })}>
                      <span className="row"><MapPin size={16} /><b className="grow truncate">{x.name}</b><span className="ink-3 xs">Place</span></span>
                    </button>
                  ))}
                </>
              )}
            </>
          )}
          {error && <div style={{ color: 'var(--danger)' }} className="sm">{error}</div>}
        </aside>
      </div>
    </>
  );
}
