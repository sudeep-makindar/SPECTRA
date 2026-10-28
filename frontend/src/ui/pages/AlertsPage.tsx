/**
 * Alerts — what happened, what to do, the video evidence, and one click to
 * announce it on the zone's speakers.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, FileText, Lock, Megaphone, Siren, VideoOff } from 'lucide-react';
import { useLive } from '../LiveContext';
import { LevelBadge } from '../parts';
import { api, fmtAgo, fmtClock, fmtDuration, plain } from '../live';
import type { Incident, IncidentStatus } from '../live';

const STATUS_WORD: Record<IncidentStatus, string> = {
  open: 'Waiting for someone', acknowledged: 'Someone is on it', escalated: 'Escalated', resolved: 'Resolved',
};

function Detail({ inc, onChange }: { inc: Incident; onChange: (i: Incident) => void }) {
  const { openDialog } = useLive();
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [clipIdx, setClipIdx] = useState(0);
  useEffect(() => { setChecked({}); setClipIdx(0); }, [inc.id]);
  const b = inc.brief;
  const clip = inc.clips[clipIdx];
  const act = async (action: string) => onChange(await api<Incident>(`/api/incidents/${inc.id}/action`, { method: 'POST', json: { action } }));

  return (
    <div className="col" style={{ gap: 16, minWidth: 0 }}>
      <section className={`panel lv-${inc.peak_level}`}>
        <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
          <LevelBadge level={inc.peak_level} />
          {inc.scenario && <span className="badge badge-demo plain">Demo</span>}
          <span className="tag">{STATUS_WORD[inc.status]}</span>
          {!inc.ended_at && <span className="tag" style={{ color: 'var(--c)' }}><span className="rec" style={{ background: 'var(--c)' }} /> Still happening</span>}
        </div>
        <h1 className="title" style={{ fontSize: 30 }}>{b?.headline ?? `Crowd risk at ${inc.zone_name}`}</h1>
        <p className="ink-2" style={{ margin: '8px 0 18px' }}>
          {inc.zone_name} · started {fmtClock(inc.started_at)} · lasted {fmtDuration(inc.started_at, inc.ended_at)} · highest risk {Math.round(inc.peak_risk * 100)}/100
        </p>
        <div className="row wrap">
          {inc.status === 'open' && <button className="btn btn-danger" onClick={() => act('acknowledge')}>I’m on it</button>}
          {b && <button className="btn" onClick={() => openDialog('announce', { zoneId: inc.zone_id, text: b.pa_announcement_en, hi: b.pa_announcement_hi })}><Megaphone /> Announce this</button>}
          <a className="btn" href={`/api/incidents/${inc.id}/report`} target="_blank" rel="noreferrer"><FileText /> Report</a>
          <a className="btn" href={`/api/incidents/${inc.id}/report?download=1`} aria-label="Download the report"><Download /></a>
          {inc.status !== 'resolved'
            ? <button className="btn btn-primary" onClick={() => act('resolve')}>Mark as resolved</button>
            : <button className="btn" onClick={() => act('reopen')}>Reopen</button>}
        </div>
      </section>

      <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">What happened</h2>
              {b && <span className="panel-hint">{b.confidence} confidence · {b.source === 'llm' ? 'written by AI' : 'offline summary'}</span>}
            </div>
            {!b || inc.brief_status === 'pending' ? (
              <><p className="ink-2" style={{ marginTop: 0 }}>The AI is writing a summary…</p><div className="skeleton" style={{ height: 90 }} /></>
            ) : (
              <div className="col" style={{ gap: 12 }}>
                <p style={{ margin: 0 }}>{b.source === 'template' ? b.summary.replace(/\.$/, '').split('; ').map(plain).join('. ') + '.' : b.summary}</p>
                <p className="ink-2" style={{ margin: 0 }}><b style={{ color: 'var(--ink)' }}>Most likely: </b>{b.likely_situation}</p>
                <p className="ink-2" style={{ margin: 0 }}><b style={{ color: 'var(--ink)' }}>Could it be a false alarm? </b>{b.false_alarm_check}</p>
              </div>
            )}
          </section>
          {b && (
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title">What to do</h2><span className="panel-hint">tick off as you go</span></div>
              <div className="col">
                {b.recommended_actions.map((a, i) => (
                  <label key={i} className="row" style={{ alignItems: 'flex-start', padding: '12px 0', borderTop: i ? '1px solid var(--line)' : 'none', cursor: 'pointer', opacity: checked[i] ? 0.45 : 1 }}>
                    <input type="checkbox" checked={!!checked[i]} onChange={e => setChecked({ ...checked, [i]: e.target.checked })} style={{ width: 18, height: 18, marginTop: 2, accentColor: '#F4F3F0', flexShrink: 0 }} />
                    <span style={{ textDecoration: checked[i] ? 'line-through' : undefined }}>
                      {a.priority === 'now' && <span className="badge lv-critical plain" style={{ marginRight: 8 }}>Now</span>}
                      <b>{a.role}:</b> <span className="ink-2">{a.action}</span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="col" style={{ gap: 16, minWidth: 0 }}>
          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Video evidence</h2>
              {clip?.face_blur && <span className="panel-hint row" style={{ gap: 5 }}><Lock size={13} /> faces blurred</span>}
            </div>
            {clip ? (
              <>
                <video key={clip.url} src={clip.url} poster={clip.thumb} controls autoPlay muted loop playsInline style={{ width: '100%', borderRadius: 14, background: '#000', display: 'block' }} />
                {inc.clips.length > 1 && (
                  <div className="seg" style={{ marginTop: 10 }}>
                    {inc.clips.map((c, i) => <button key={c.url} className={i === clipIdx ? 'on' : ''} onClick={() => setClipIdx(i)}>Camera {i + 1}</button>)}
                  </div>
                )}
              </>
            ) : (
              <div className="empty" style={{ padding: 28 }}>
                <VideoOff />
                <p>{inc.ended_at || Date.now() / 1000 - inc.started_at > 20 ? 'No camera covered this zone, so there is no clip.' : 'Saving the clip (8 s before to 6 s after)…'}</p>
              </div>
            )}
          </section>
          {b && (
            <section className="panel col" style={{ gap: 14 }}>
              <h2 className="panel-title">Suggested announcement</h2>
              <div className="heard">{b.pa_announcement_en}</div>
              <div className="heard">{b.pa_announcement_hi}</div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export function AlertsPage() {
  const { incidents } = useLive();
  const [params, setParams] = useSearchParams();
  const selId = params.get('id') ?? incidents[0]?.id;
  const summary = incidents.find(i => i.id === selId);
  const [inc, setInc] = useState<Incident | null>(null);

  useEffect(() => {
    if (!selId) { setInc(null); return; }
    let alive = true;
    const load = () => api<Incident>(`/api/incidents/${selId}`).then(r => alive && setInc(r)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [selId, summary?.brief_status, summary?.status]);

  const clearAll = async () => {
    if (!confirm('Delete every alert and its video clips?')) return;
    await api('/api/incidents', { method: 'DELETE' });
    setInc(null);
    setParams({});
  };

  return (
    <>
      <div className="head">
        <div>
          <h1 className="title">Alerts</h1>
          <p className="subtitle">An alert opens when a zone reaches “Needs attention”. Each one has a clip, an AI summary and a to-do list.</p>
        </div>
        {incidents.length > 0 && <button className="btn btn-ghost" onClick={clearAll}>Clear history</button>}
      </div>

      {!incidents.length ? (
        <div className="panel empty">
          <Siren />
          <h3>No alerts yet</h3>
          <p>That’s good news. Press <b>Run a demo</b> at the top to see what an alert looks like.</p>
        </div>
      ) : (
        <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <div className="col" style={{ gap: 8 }}>
            {incidents.map(i => (
              <button key={i.id} className={`zone-card lv-${i.peak_level} ${i.id === selId ? 'on' : ''}`} onClick={() => setParams({ id: i.id })} style={{ flexDirection: 'row', gap: 12 }}>
                <span style={{ width: 76, height: 52, borderRadius: 10, overflow: 'hidden', background: 'var(--panel-3)', flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                  {i.thumb ? <img src={i.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <VideoOff size={18} className="ink-3" />}
                </span>
                <span className="col grow" style={{ gap: 4 }}>
                  <span className="row" style={{ gap: 6 }}><LevelBadge level={i.peak_level} />{i.scenario && <span className="badge badge-demo plain">Demo</span>}</span>
                  <b className="truncate sm">{i.headline ?? `Crowd risk at ${i.zone_name}`}</b>
                  <span className="ink-3 xs">{i.zone_name} · {fmtAgo(i.started_at)} · {STATUS_WORD[i.status]}</span>
                </span>
              </button>
            ))}
          </div>
          {inc ? <Detail inc={inc} onChange={setInc} /> : <div className="panel skeleton" style={{ height: 260 }} />}
        </div>
      )}
    </>
  );
}
