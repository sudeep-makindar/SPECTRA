/**
 * Dashboard — the summary for whoever is in charge: totals, a heatmap of
 * risk over the last two minutes, the timeline of what happened, and every
 * alert in a table.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Cpu, Megaphone, Siren, Users } from 'lucide-react';
import { useLive } from '../LiveContext';
import { Kpi, LevelBadge } from '../parts';
import { LEVEL_WORD, fmtClock, fmtDuration, levelOf, plain } from '../live';
import type { HistoryPoint, IncidentSummary, Level, ZoneState } from '../live';

const BUCKET_S = 5;
const WINDOW_S = 120;
const COLS = WINDOW_S / BUCKET_S;
const HEX: Record<Level, string> = { normal: '244,243,240', elevated: '232,176,75', high: '238,122,59', critical: '239,75,67' };

/** Calm cells stay grey and get lighter with value; risky cells take the risk colour. */
function cellColor(v: number | null): string {
  if (v == null) return 'var(--panel-2)';
  const lvl = levelOf(v);
  if (lvl === 'normal') return `rgba(${HEX.normal}, ${0.05 + v * 0.35})`;
  return `rgba(${HEX[lvl]}, ${0.45 + v * 0.55})`;
}

function bucket(history: HistoryPoint[], idx: number, now: number): (number | null)[] {
  const out: (number | null)[] = Array(COLS).fill(null);
  for (const p of history) {
    const age = now - p[0];
    if (age < 0 || age >= WINDOW_S) continue;
    const col = COLS - 1 - Math.floor(age / BUCKET_S);
    out[col] = Math.max(out[col] ?? 0, p[idx]);
  }
  return out;
}

function Heatmap({ zones, focus }: { zones: ZoneState[]; focus: ZoneState | null }) {
  const now = Math.max(Date.now() / 1000, ...zones.flatMap(z => z.history.slice(-1).map(h => h[0])));
  const rows: { label: string; cells: (number | null)[] }[] = focus
    ? [
        { label: 'Crowd', cells: bucket(focus.history, 2, now) },
        { label: 'Movement', cells: bucket(focus.history, 3, now) },
        { label: 'Sound', cells: bucket(focus.history, 4, now) },
        { label: 'Combined', cells: bucket(focus.history, 1, now) },
      ]
    : zones.map(z => ({ label: z.name, cells: bucket(z.history, 1, now) }));
  const all = rows.flatMap(r => r.cells).filter((v): v is number => v != null);
  const stat = (f: (a: number[]) => number) => (all.length ? Math.round(f(all) * 100) : '–');

  return (
    <>
      <div className="stats" style={{ marginBottom: 18 }}>
        <div className="stat" style={{ background: 'none', padding: 0 }}><b style={{ fontSize: 34 }}>{stat(a => Math.min(...a))}</b><span>lowest</span></div>
        <div className="stat" style={{ background: 'none', padding: 0 }}><b style={{ fontSize: 34 }}>{stat(a => a.reduce((x, y) => x + y, 0) / a.length)}</b><span>average</span></div>
        <div className="stat" style={{ background: 'none', padding: 0 }}><b style={{ fontSize: 34 }}>{stat(a => Math.max(...a))}</b><span>highest</span></div>
      </div>
      <div className="table-wrap">
        <div className="heat" style={{ gridTemplateColumns: `max-content repeat(${COLS}, minmax(14px, 1fr))`, minWidth: 520 }}>
          {rows.map(r => (
            <div key={r.label} style={{ display: 'contents' }}>
              <span className="heat-label truncate" style={{ maxWidth: 130 }}>{r.label}</span>
              {r.cells.map((v, i) => (
                <span key={i} className="heat-cell" style={{ background: cellColor(v) }}
                  title={v == null ? 'No data' : `${r.label}: ${Math.round(v * 100)} (${LEVEL_WORD[levelOf(v)]}), ${(COLS - i) * BUCKET_S} s ago`} />
              ))}
            </div>
          ))}
          <span />
          <span className="heat-axis" style={{ gridColumn: `span ${COLS / 2}` }}>2 min ago</span>
          <span className="heat-axis" style={{ gridColumn: `span ${COLS / 2}`, textAlign: 'right' }}>now</span>
        </div>
      </div>
    </>
  );
}

const STATUS_WORD: Record<IncidentSummary['status'], string> = {
  open: 'Waiting', acknowledged: 'Handled', escalated: 'Escalated', resolved: 'Resolved',
};
type Filter = 'all' | 'open' | 'acknowledged' | 'resolved' | 'demo';

export function DashboardPage() {
  const s = useLive();
  const navigate = useNavigate();
  const [heatZone, setHeatZone] = useState<string>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const focus = heatZone === 'all' ? null : s.zones[heatZone] ?? null;

  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() / 1000;
  const todays = s.incidents.filter(i => i.started_at >= startOfDay);
  const waiting = s.incidents.filter(i => i.status === 'open' && !i.ended_at);
  const online = s.sources.filter(x => x.status === 'online').length;

  const timeline = useMemo(
    () => s.events.filter(e => ['level_change', 'incident_opened', 'incident_closed', 'brief_ready', 'acknowledged', 'blind_spot', 'scenario'].includes(e.kind) || e.kind.startsWith('incident_')).slice(-8).reverse(),
    [s.events],
  );
  const rows = s.incidents.filter(i =>
    filter === 'all' ? true : filter === 'demo' ? !!i.scenario : filter === 'open' ? i.status === 'open' : i.status === filter,
  );

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">Venue<br />Overview</h1>
          <p className="subtitle">What is happening across every zone right now, and what has happened today.</p>
        </div>
        <div className="kpis">
          <Kpi icon={<Users />} label="People in view" value={s.totalPeople} note={`across ${s.zoneList.length} zones`} />
          <Kpi icon={<Siren />} label="Alerts today" value={todays.length} note={waiting.length ? `${waiting.length} waiting for you` : 'none waiting'} level={waiting.length ? s.worst?.alert_level : undefined} />
          <Kpi icon={<Cpu />} label="Devices online" value={online} unit={`/ ${s.sources.length}`} note={s.sources.length - online ? `${s.sources.length - online} offline` : 'all online'} />
        </div>
      </div>

      <div className="strip">
        <span className="strip-icon"><CalendarDays /></span>
        <div>
          <div className="strip-title">Today</div>
          <div className="strip-sub">{today.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        <span className="grow" />
        {waiting.length > 0 && <span className={`strip-warn lv-${s.worst?.alert_level ?? 'high'}`}><Siren size={17} /> {waiting.length} alert{waiting.length > 1 ? 's' : ''} waiting</span>}
        <button className="btn" onClick={() => s.openDialog('announce')}><Megaphone /> Announce</button>
        <button className="btn btn-primary" onClick={() => navigate('/alerts')}>Open alerts</button>
      </div>

      <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr) minmax(0, 0.9fr)', gap: 16, alignItems: 'start' }}>
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Risk heatmap</h2>
            <div className="seg">
              <button className={heatZone === 'all' ? 'on' : ''} onClick={() => setHeatZone('all')}>All zones</button>
              {s.zoneList.map(z => <button key={z.zone_id} className={heatZone === z.zone_id ? 'on' : ''} onClick={() => setHeatZone(z.zone_id)}>{z.name}</button>)}
            </div>
          </div>
          <Heatmap zones={s.zoneList} focus={focus} />
          <p className="ink-3 xs" style={{ margin: '14px 0 0' }}>Each square is 5 seconds. Grey is calm; amber, orange and red mean rising risk.</p>
        </section>

        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">What happened</h2><span className="panel-hint">latest first</span></div>
          {timeline.length ? (
            <div className="timeline">
              {timeline.map(e => (
                <div key={e.id} className={`tl-item ${e.level ? `lv-${e.level}` : ''}`}>
                  <span className="tl-dot" />
                  <div className="col" style={{ minWidth: 0 }}>
                    <span className="ink-3 xs">{e.zone_name}{e.simulated ? ' · demo' : ''}</span>
                    <span className="sm">{plain(e.message.replace(`${e.zone_name}: `, ''))}</span>
                  </div>
                  <span className="tl-time">{fmtClock(e.ts)}</span>
                </div>
              ))}
            </div>
          ) : <p className="ink-3 sm" style={{ margin: 0 }}>Nothing yet. Events appear here as risk changes.</p>}
        </section>

        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">Zones</h2></div>
          <div className="col" style={{ gap: 14 }}>
            {s.zoneList.map(z => (
              <button key={z.zone_id} className={`col lv-${z.alert_level}`} style={{ gap: 6, textAlign: 'left' }} onClick={() => { s.setZoneFilter(z.zone_id); navigate('/'); }}>
                <span className="row"><b className="grow truncate">{z.name}</b><span className="mono num sm">{Math.round(z.risk_score * 100)}</span></span>
                <span className="bar risk"><div style={{ width: `${Math.max(2, z.risk_score * 100)}%` }} /></span>
                <span className="ink-3 xs">{z.people_count} people · {LEVEL_WORD[z.alert_level]}{z.blind_spot ? ' · cameras dark' : ''}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="panel" style={{ padding: '18px 18px 8px' }}>
        <div className="panel-head" style={{ flexWrap: 'wrap' }}>
          <h2 className="panel-title">Alerts</h2>
          <div className="seg">
            {(['all', 'open', 'acknowledged', 'resolved', 'demo'] as Filter[]).map(f => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'demo' ? 'Demo' : STATUS_WORD[f]}
              </button>
            ))}
          </div>
          <span className="grow" />
          <span className="panel-hint">{rows.length} shown</span>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>What happened</th><th>Zone</th><th>Peak</th><th>Started</th><th>Lasted</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map(i => (
                  <tr key={i.id} className="click" onClick={() => navigate(`/alerts?id=${i.id}`)}>
                    <td><span className="row" style={{ gap: 8 }}>{i.scenario && <span className="badge badge-demo plain">Demo</span>}<b className="truncate" style={{ maxWidth: 360 }}>{i.headline ?? 'Crowd risk alert'}</b></span></td>
                    <td className="ink-2">{i.zone_name}</td>
                    <td><LevelBadge level={i.peak_level} /></td>
                    <td className="mono num sm ink-2">{fmtClock(i.started_at)}</td>
                    <td className="mono num sm ink-2">{fmtDuration(i.started_at, i.ended_at)}</td>
                    <td><span className="tag">{!i.ended_at && i.status !== 'resolved' ? 'Ongoing · ' : ''}{STATUS_WORD[i.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="ink-3 sm" style={{ margin: '0 4px 12px' }}>No alerts here.</p>}
      </section>
    </>
  );
}
