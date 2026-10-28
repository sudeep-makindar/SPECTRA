/**
 * Surveillance — the CCTV wall. Every camera, live, with the AI overlay.
 * A tile glows amber → red as its zone's risk rises. Click a tile to see
 * everything the models are doing on that camera.
 */

import { useNavigate } from 'react-router-dom';
import { Activity, Mic, Plus, Users, Video, VideoOff } from 'lucide-react';
import { useLive } from '../LiveContext';
import { Feed, Kpi, LevelBadge, MicBars, ZoneTabs } from '../parts';
import { DEVICE_TYPE, LEVEL_WORD, capsOf, isAlarm } from '../live';
import type { SourceState, ZoneState } from '../live';

function CameraTile({ source, zone }: { source: SourceState; zone?: ZoneState }) {
  const navigate = useNavigate();
  const caps = capsOf(source);
  const level = zone?.alert_level ?? 'normal';
  const hot = zone && level !== 'normal';
  return (
    <button className={`tile lv-${level} ${hot ? 'hot' : ''}`} onClick={() => navigate(`/camera/${source.id}`)} aria-label={`Open ${source.name}`}>
      <div className="feed">
        <Feed source={source} />
        <div className="feed-top">
          <span className="chip">{source.status === 'online' && <span className="rec" />}{source.status === 'online' ? 'LIVE' : source.status.toUpperCase()}</span>
          {zone && level !== 'normal' && <LevelBadge level={level} />}
        </div>
      </div>
      <div className="tile-foot">
        <div className="grow">
          <div className="tile-name truncate">{source.name}</div>
          <div className="tile-meta truncate">{zone?.name ?? 'No zone'} · {DEVICE_TYPE[source.adapter] ?? source.adapter}</div>
        </div>
        {caps.audio && <MicBars level={zone?.audio.score ?? 0} active={source.status === 'online'} />}
        {zone && <span className="tag num"><Users /> {zone.people_count}</span>}
      </div>
    </button>
  );
}

function MicCard({ source, zone }: { source: SourceState; zone?: ZoneState }) {
  const heard = zone?.keyword ? `“${zone.keyword}”` : zone?.audio_label;
  return (
    <div className={`panel lv-${zone?.alert_level ?? 'normal'}`} style={{ padding: 16, display: 'flex', gap: 14, alignItems: 'center' }}>
      <span className="kpi-icon" style={{ width: 46, height: 46, borderRadius: 14 }}><Mic size={20} /></span>
      <div className="grow">
        <div className="tile-name truncate">{source.name}</div>
        <div className="tile-meta truncate">{zone?.name ?? 'No zone'} · {source.status === 'online' ? (heard ? `Heard ${heard}` : 'Listening') : 'Offline'}</div>
      </div>
      <MicBars level={zone?.audio.score ?? 0} active={source.status === 'online'} n={18} />
    </div>
  );
}

export function SurveillancePage() {
  const s = useLive();
  const zoneOf = (id: string | null) => (id ? s.zones[id] : undefined);
  const inFilter = (x: SourceState) => s.zoneFilter === 'all' || x.zone_id === s.zoneFilter;
  const cameras = s.sources.filter(x => x.kind === 'video' && inFilter(x));
  const mics = s.sources.filter(x => x.kind === 'audio' && inFilter(x));
  const camsLive = s.sources.filter(x => x.kind === 'video' && x.status === 'online').length;
  const camsAll = s.sources.filter(x => x.kind === 'video').length;
  const zone = s.zoneFilter === 'all' ? null : s.zones[s.zoneFilter];
  const people = zone ? zone.people_count : s.totalPeople;
  const worst = zone ?? s.worst;
  const alarmCount = s.alarms.length;

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">Live<br />Surveillance</h1>
          <p className="subtitle">Every camera and microphone, analysed live. Click a camera to see what each AI model is doing.</p>
        </div>
        <div className="kpis">
          <Kpi icon={<Video />} label="Cameras live" value={camsLive} unit={`/ ${camsAll}`} note={camsAll && camsLive < camsAll ? `${camsAll - camsLive} not sending` : 'all sending'} />
          <Kpi icon={<Users />} label={zone ? `People in ${zone.name}` : 'People in view'} value={people} note={zone ? `${zone.density_ppm2.toFixed(1)} per m²` : `${s.zoneList.length} zones`} />
          <Kpi icon={<Activity />} label={zone ? 'Risk here' : 'Highest risk'} value={worst ? Math.round(worst.risk_score * 100) : '–'} unit="/100"
            note={worst ? `${LEVEL_WORD[worst.alert_level]}${zone ? '' : ` · ${worst.name}`}` : 'no data yet'} level={worst?.alert_level} />
        </div>
      </div>

      <div className="strip">
        <span className="strip-icon"><Video /></span>
        <div>
          <div className="strip-title">{zone ? zone.name : 'All zones'}</div>
          <div className="strip-sub">{cameras.length} cameras · {mics.length + cameras.filter(c => capsOf(c).audio).length} listening</div>
        </div>
        <ZoneTabs />
        <span className="grow" />
        {alarmCount > 0 && <span className={`strip-warn lv-${s.alarms[0].alert_level}`}>{alarmCount} zone{alarmCount > 1 ? 's' : ''} need{alarmCount > 1 ? '' : 's'} you</span>}
        <button className="btn" onClick={() => s.openDialog('add-device', { zoneId: zone?.zone_id })}><Plus /> Add device</button>
      </div>

      {!s.sources.length ? (
        <div className="panel empty">
          <VideoOff />
          <h3>No cameras yet</h3>
          <p>Add the SPECTRA computer’s webcam, an Android phone, another laptop or a CCTV stream. Each one appears here with live AI analysis.</p>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-primary" onClick={() => s.openDialog('add-device')}><Plus /> Add a device</button>
            <button className="btn" onClick={() => s.openDialog('demo')}>Run a demo instead</button>
          </div>
        </div>
      ) : (
        <>
          {cameras.length > 0 ? (
            <div className="wall">
              {[...cameras]
                .sort((a, b) => Number(isAlarm(zoneOf(b.zone_id) ?? ({} as ZoneState))) - Number(isAlarm(zoneOf(a.zone_id) ?? ({} as ZoneState))))
                .map(c => <CameraTile key={c.id} source={c} zone={zoneOf(c.zone_id)} />)}
            </div>
          ) : (
            <div className="panel empty"><VideoOff /><h3>No cameras in {zone?.name ?? 'this zone'}</h3><p>Pick another zone, or add a camera to this one.</p></div>
          )}
          {mics.length > 0 && (
            <div className="col" style={{ gap: 12 }}>
              <span className="label">Microphones</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                {mics.map(m => <MicCard key={m.id} source={m} zone={zoneOf(m.zone_id)} />)}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
