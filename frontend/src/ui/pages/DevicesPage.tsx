/**
 * Devices — everything connected, what each one captures, which zone it
 * belongs to and whether it is working. Also each zone's name and size.
 */

import { useEffect, useState } from 'react';
import { Camera, Check, Mic, Plus, Radio, Send, Trash2, Volume2 } from 'lucide-react';
import { useLive } from '../LiveContext';
import { Kpi } from '../parts';
import { DEVICE_TYPE, api, capsOf } from '../live';
import type { SourceState, ZoneConfig } from '../live';

const STATUS: Record<string, { word: string; cls: string }> = {
  online: { word: 'Working', cls: 'lv-normal' },
  degraded: { word: 'Struggling', cls: 'lv-elevated' },
  error: { word: 'Not working', cls: 'lv-critical' },
  offline: { word: 'Waiting to connect', cls: 'lv-offline' },
};

function Captures({ s }: { s: SourceState }) {
  const c = capsOf(s);
  return (
    <span className="row" style={{ gap: 6 }}>
      {c.video && <span className="tag"><Camera /> Camera</span>}
      {c.audio && <span className="tag"><Mic /> Mic</span>}
      {c.speaker && <span className="tag"><Volume2 /> Speaker</span>}
    </span>
  );
}

function ZoneSettings({ z }: { z: ZoneConfig }) {
  const [name, setName] = useState(z.name);
  const [area, setArea] = useState(String(z.area_m2));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setName(z.name); setArea(String(z.area_m2)); }, [z.name, z.area_m2]);
  const dirty = name !== z.name || Number(area) !== z.area_m2;
  const save = async () => {
    await api(`/api/zones/${z.id}`, { method: 'PATCH', json: { name: name.trim() || z.name, area_m2: Math.max(0.5, Number(area) || z.area_m2) } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <form className="row wrap" style={{ gap: 12, padding: '12px 0', borderTop: '1px solid var(--line)' }} onSubmit={e => { e.preventDefault(); save(); }}>
      <label className="field grow" style={{ minWidth: 200 }}>Zone name<input className="input" value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="field" style={{ width: 210 }}>Floor area the cameras see (m²)<input className="input num" type="number" min="0.5" step="0.5" value={area} onChange={e => setArea(e.target.value)} /></label>
      <button className="btn" style={{ alignSelf: 'flex-end' }} disabled={!dirty && !saved}>{saved ? 'Saved' : 'Save'}</button>
    </form>
  );
}

interface TelegramStatus { token_set: boolean; bot_name: string | null; chat_ids: string[]; configured: boolean; last_error: string | null; sent: number }
interface TelegramChat { id: string; name: string; type: string }

/** Send alerts to a Telegram group: find the group the bot was added to, save it, test it. */
function TelegramSettings() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [chats, setChats] = useState<TelegramChat[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState<'find' | 'test' | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<TelegramStatus>('/api/notify/telegram').then(st => { setStatus(st); setPicked(st.chat_ids); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const find = async () => {
    setBusy('find'); setNote(null);
    try {
      const r = await api<{ bot_name: string; chats: TelegramChat[] }>('/api/notify/telegram/find-chats', { method: 'POST' });
      setChats(r.chats);
      setStatus(st => st && { ...st, bot_name: r.bot_name });
      if (!r.chats.length) setNote({ ok: false, text: `No chats yet. Add @${r.bot_name} to your group, send any message in the group, then try again.` });
    } catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setBusy(null); }
  };
  const save = async (ids: string[]) => {
    setPicked(ids);
    setStatus(await api<TelegramStatus>('/api/notify/telegram/chats', { method: 'PUT', json: { chat_ids: ids } }));
  };
  const test = async () => {
    setBusy('test'); setNote(null);
    try { await api('/api/notify/telegram/test', { method: 'POST' }); setNote({ ok: true, text: 'Sent. Check the group.' }); }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); } finally { setBusy(null); load(); }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Alerts on Telegram</h2>
        {status && <span className={`badge ${status.configured ? 'lv-normal' : 'lv-offline'}`}>{status.configured ? `On · ${status.sent} sent` : 'Off'}</span>}
      </div>
      <p className="ink-2 sm" style={{ marginTop: -6 }}>
        When an alert opens, a group chat gets the reason straight away, then the AI summary with a snapshot, and the full report once it’s calm again. Needs internet.
      </p>
      {status && !status.token_set ? (
        <p className="sm" style={{ margin: 0 }}>Put <span className="mono">TELEGRAM_BOT_TOKEN=…</span> (from @BotFather on Telegram) in the <span className="mono">.env</span> file next to SPECTRA, then restart it.</p>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <ol className="ink-2 sm" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>Add {status?.bot_name ? <b>@{status.bot_name}</b> : 'your bot'} to the Telegram group that should get alerts.</li>
            <li>Send any message in that group, so the bot sees it.</li>
            <li>Press <b>Find my group</b>, tick it, and send a test message.</li>
          </ol>
          <div className="row wrap">
            <button className="btn" disabled={busy !== null} onClick={find}>{busy === 'find' ? 'Looking…' : 'Find my group'}</button>
            <button className="btn btn-primary" disabled={busy !== null || !picked.length} onClick={test}><Send /> {busy === 'test' ? 'Sending…' : 'Send a test message'}</button>
          </div>
          {chats && chats.length > 0 && (
            <div className="col" style={{ gap: 6 }}>
              {chats.map(c => (
                <label key={c.id} className="row" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.includes(c.id)} style={{ width: 18, height: 18, accentColor: '#F4F3F0' }}
                    onChange={e => save(e.target.checked ? [...picked, c.id] : picked.filter(x => x !== c.id))} />
                  <span className="grow">{c.name}</span>
                  <span className="tag">{c.type === 'private' ? 'person' : c.type}</span>
                </label>
              ))}
            </div>
          )}
          {!chats && status && status.chat_ids.length > 0 && (
            <span className="ink-2 sm row"><Check size={16} /> Sending to {status.chat_ids.length} chat{status.chat_ids.length > 1 ? 's' : ''}.</span>
          )}
          {note && <div className="heard sm" style={{ color: note.ok ? 'var(--ink)' : 'var(--watch)' }}>{note.text}</div>}
          {!note && status?.last_error && <div className="heard sm" style={{ color: 'var(--watch)' }}>Last problem: {status.last_error}</div>}
        </div>
      )}
    </section>
  );
}

export function DevicesPage() {
  const s = useLive();
  const count = (pred: (x: SourceState) => boolean) => {
    const all = s.sources.filter(pred);
    return { all: all.length, on: all.filter(x => x.status === 'online').length };
  };
  const cams = count(x => capsOf(x).video);
  const mics = count(x => capsOf(x).audio);
  const spk = count(x => capsOf(x).speaker);

  const assign = (id: string, zone_id: string) => api(`/api/sources/${id}`, { method: 'PATCH', json: { zone_id } });
  const remove = (x: SourceState) => { if (confirm(`Disconnect ${x.name}?`)) api(`/api/sources/${x.id}`, { method: 'DELETE' }); };

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">Devices</h1>
          <p className="subtitle">Every camera and microphone acts like CCTV: laptops, Android phones (IP Webcam), any phone’s browser, and CCTV streams.</p>
        </div>
        <div className="kpis">
          <Kpi icon={<Camera />} label="Cameras" value={cams.on} unit={`/ ${cams.all}`} note="working" />
          <Kpi icon={<Mic />} label="Microphones" value={mics.on} unit={`/ ${mics.all}`} note="listening" />
          <Kpi icon={<Volume2 />} label="Speakers" value={spk.on} unit={`/ ${spk.all}`} note="ready to announce" />
        </div>
      </div>

      <div className="strip">
        <span className="strip-icon"><Radio /></span>
        <div className="grow">
          <div className="strip-title">Connected devices</div>
          <div className="strip-sub">Everything is analysed on the SPECTRA computer. Video and audio never go to the internet.</div>
        </div>
        <button className="btn btn-primary" onClick={() => s.openDialog('add-device')}><Plus /> Add device</button>
      </div>

      <section className="panel" style={{ padding: '18px 18px 8px' }}>
        {s.sources.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Device</th><th>Captures</th><th>Zone</th><th>Status</th><th>Data in</th><th /></tr></thead>
              <tbody>
                {s.sources.map(x => {
                  const st = STATUS[x.status] ?? STATUS.offline;
                  return (
                    <tr key={x.id}>
                      <td>
                        <div className="col">
                          <b>{x.name}</b>
                          <span className="ink-3 xs">{DEVICE_TYPE[x.adapter] ?? x.adapter}{x.lat == null ? ' · not on map' : ''}</span>
                        </div>
                      </td>
                      <td><Captures s={x} /></td>
                      <td>
                        <select className="input" style={{ height: 38, width: 170 }} value={x.zone_id ?? ''} onChange={e => assign(x.id, e.target.value)} aria-label={`Zone for ${x.name}`}>
                          {s.zoneConfigs.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                        </select>
                      </td>
                      <td><span className={`badge ${st.cls}`}>{st.word}</span></td>
                      <td className="mono num sm ink-2">{x.status === 'online' ? (x.kind === 'video' ? `${x.fps} fps` : 'audio') : x.last_seen_age_s != null ? `${Math.round(x.last_seen_age_s)} s ago` : '–'}</td>
                      <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-ghost" onClick={() => remove(x)} aria-label={`Disconnect ${x.name}`}><Trash2 /> Disconnect</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <Radio />
            <h3>Nothing connected yet</h3>
            <p>Start with the SPECTRA computer’s webcam, then add phones and other laptops.</p>
            <button className="btn btn-primary" onClick={() => s.openDialog('add-device')}><Plus /> Add device</button>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Zones</h2>
          <span className="panel-hint">Add and place zones on the Map page</span>
        </div>
        <p className="ink-2 sm" style={{ marginTop: -6 }}>
          The floor area turns a head count into how tightly people are packed. Over 5 people per m² is dangerous. A rough guess is fine: a gate lane is about 4 m², a small room about 10 m².
        </p>
        {s.zoneConfigs.map(z => <ZoneSettings key={z.id} z={z} />)}
      </section>

      <TelegramSettings />
    </>
  );
}
