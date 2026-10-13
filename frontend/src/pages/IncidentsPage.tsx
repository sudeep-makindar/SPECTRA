/**
 * Incidents — the response workspace: evidence, AI briefing, operator
 * workflow, audit trail, printable report and AI shift handover.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Copy, FileText, Lock, Printer, RotateCcw, Siren, Sparkles, X } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import { ModalityTimeline } from '../components/RiskTimeline';
import { api, fmtAgo, fmtTime } from '../lib/types';
import type { Incident, IncidentSummary } from '../lib/types';

type Filter = 'active' | 'all' | 'resolved';

function duration(a: number, b: number | null) {
  const s = Math.round((b ?? Date.now() / 1000) - a);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Active = still ongoing and not resolved — same rule as the sidebar badge. */
const isActive = (i: IncidentSummary) => !i.ended_at && i.status !== 'resolved';

function Brief({ inc, onRebrief }: { inc: Incident; onRebrief: () => void }) {
  const b = inc.brief;
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  if (!b || inc.brief_status === 'pending') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="muted" style={{ fontSize: '0.8rem' }}>The co-pilot is writing the briefing…</div>
        <div className="skeleton" style={{ height: 90 }} />
      </div>
    );
  }
  const copy = (k: string, t: string) => { navigator.clipboard?.writeText(t); setCopied(k); setTimeout(() => setCopied(null), 1200); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`tag ${b.source === 'llm' ? 'accent' : ''}`}>{b.source === 'llm' ? b.model : 'Offline template'}</span>
        <span className="tag">{b.confidence} confidence</span>
        <span className="dim" style={{ fontSize: '0.72rem' }}>written for {b.for_level?.toUpperCase()} · {fmtAgo(b.generated_at)}</span>
        <div className="topbar-spacer" />
        <button className="btn btn-ghost btn-sm no-print" onClick={onRebrief}><RotateCcw /> Regenerate</button>
      </div>
      <div>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.3 }}>{b.headline}</div>
        <div className="muted" style={{ fontSize: '0.86rem', lineHeight: 1.6, marginTop: 6 }}>{b.summary}</div>
      </div>
      <div className="field-row" style={{ flexWrap: 'wrap' }}>
        <div className="card inset" style={{ flex: 1, minWidth: 220, padding: 12 }}>
          <div className="card-label">Likely situation</div>
          <div style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>{b.likely_situation}</div>
        </div>
        <div className="card inset" style={{ flex: 1, minWidth: 220, padding: 12 }}>
          <div className="card-label">False-alarm check</div>
          <div style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>{b.false_alarm_check}</div>
        </div>
      </div>
      <div>
        <div className="card-label">Recommended actions</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {b.recommended_actions.map((a, i) => (
            <label key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', fontSize: '0.84rem', alignItems: 'flex-start', cursor: 'pointer', borderBottom: '1px solid var(--color-border)', opacity: checked[i] ? 0.5 : 1 }}>
              <input type="checkbox" checked={!!checked[i]} onChange={e => setChecked({ ...checked, [i]: e.target.checked })} style={{ marginTop: 3, accentColor: '#4F8DF7' }} />
              <span className="kbd" style={{ color: a.priority === 'now' ? 'var(--color-risk-high)' : undefined, flexShrink: 0 }}>{a.priority}</span>
              <span style={{ textDecoration: checked[i] ? 'line-through' : undefined, lineHeight: 1.45 }}><b style={{ fontWeight: 600 }}>{a.role}</b> — {a.action}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="field-row" style={{ flexWrap: 'wrap' }}>
        {([['en', 'PA announcement · English', b.pa_announcement_en], ['hi', 'PA announcement · हिंदी', b.pa_announcement_hi]] as const).map(([k, label, text]) => (
          <div key={k} className="pa-box" style={{ flex: 1, minWidth: 240 }}>
            <div className="card-head" style={{ marginBottom: 6 }}>
              <div className="card-label" style={{ marginBottom: 0 }}>{label}</div>
              <button className="btn btn-ghost btn-sm no-print" onClick={() => copy(k, text)}>{copied === k ? <Check /> : <Copy />}</button>
            </div>
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}

export function IncidentsPage() {
  const { incidents } = useSpectra();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const list = incidents.filter(i => filter === 'all' || (filter === 'active' ? isActive(i) : i.status === 'resolved'));
  const selId = params.get('id') ?? list[0]?.id;
  const [inc, setInc] = useState<Incident | null>(null);
  const [clipIdx, setClipIdx] = useState(0);
  const [note, setNote] = useState('');
  const [report, setReport] = useState<{ report: string; source: string } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const summary = incidents.find(i => i.id === selId);
  useEffect(() => {
    if (!selId) { setInc(null); return; }
    let alive = true;
    const load = () => api<Incident>(`/api/incidents/${selId}`).then(r => alive && setInc(r)).catch(() => {});
    load();
    const t = setInterval(load, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [selId, summary?.brief_status, summary?.clip_count]);
  useEffect(() => setClipIdx(0), [selId]);

  const act = async (action: string) => {
    if (!inc) return;
    setInc(await api<Incident>(`/api/incidents/${inc.id}/action`, { method: 'POST', json: { action, note } }));
    setNote('');
  };
  const rebrief = async () => {
    if (!inc) return;
    await api(`/api/incidents/${inc.id}/rebrief`, { method: 'POST' });
    setInc({ ...inc, brief_status: 'pending' });
  };
  const shiftReport = async () => {
    setReportBusy(true);
    try { setReport(await api('/api/incidents/report/shift')); } finally { setReportBusy(false); }
  };
  const clearAll = async () => {
    if (!confirm('Delete all incidents and evidence clips? This is meant for resetting before a demo.')) return;
    await api('/api/incidents', { method: 'DELETE' });
    setInc(null);
    setParams({});
  };

  const clip = inc?.clips[clipIdx];
  const peak = inc?.peak_snapshot ?? {};
  const counts = { active: incidents.filter(isActive).length, all: incidents.length, resolved: incidents.filter(i => i.status === 'resolved').length };

  return (
    <>
      {report && (
        <>
          <div className="overlay" onClick={() => setReport(null)} />
          <div className="modal-wrap" onClick={() => setReport(null)}>
            <div className="modal" style={{ width: 'min(760px, 100%)' }} onClick={e => e.stopPropagation()}>
              <div className="card-head">
                <div className="card-title"><FileText size={16} /> Shift handover</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(report.report)}><Copy /> Copy</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setReport(null)} aria-label="Close"><X /></button>
                </div>
              </div>
              <div className="copilot-answer">{report.report}</div>
              <div className="dim" style={{ fontSize: '0.68rem', marginTop: 12 }}>{report.source === 'llm' ? 'Written by the AI co-pilot from incident metadata' : report.source}</div>
            </div>
          </div>
        </>
      )}

      <div className="grid-12">
        <div className="card span-4 no-print" style={{ padding: 12, alignSelf: 'start' }}>
          <div className="card-head" style={{ padding: '4px 4px 0' }}>
            <div className="segmented">
              {(['active', 'all', 'resolved'] as Filter[]).map(f => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} style={{ textTransform: 'capitalize' }}>{f} <span className="dim num">{counts[f]}</span></button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, padding: '0 4px 10px' }}>
            <button className="btn btn-sm" disabled={reportBusy || !incidents.length} onClick={shiftReport}><Sparkles /> {reportBusy ? 'Writing…' : 'Shift handover'}</button>
            <div className="topbar-spacer" />
            <button className="btn btn-ghost btn-sm" onClick={clearAll} disabled={!incidents.length}>Clear all</button>
          </div>
          {!list.length && (
            <div className="empty-state" style={{ padding: '28px 10px' }}>
              <Siren />
              <h3>{incidents.length ? 'Nothing here' : 'No incidents yet'}</h3>
              <p>Incidents open automatically when a zone reaches HIGH. Run a drill from the top bar to see the full flow.</p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: '70vh', overflowY: 'auto' }}>
            {list.map(i => (
              <div key={i.id} className={`list-item ${i.id === selId ? 'active' : ''}`} onClick={() => setParams({ id: i.id })} style={{ alignItems: 'flex-start' }}>
                <div style={{ width: 64, height: 44, borderRadius: 6, overflow: 'hidden', background: '#05080B', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)' }}>
                  {i.thumb ? <img src={i.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="dim" style={{ fontSize: '0.6rem' }}>no clip</span>}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={`level-pill level-${i.peak_level}`}>{i.peak_level}</span>
                    {i.scenario && <span className="sim-badge">drill</span>}
                    {!i.ended_at && <span className="rec-dot" title="Ongoing" />}
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 500, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.headline ?? i.zone_name}</div>
                  <div className="dim" style={{ fontSize: '0.7rem', marginTop: 2 }}>{i.zone_name} · <span className="num">{fmtTime(i.started_at)}</span> · <span style={{ textTransform: 'capitalize' }}>{i.status}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {inc ? (
          <div className="span-8" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-head" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                    <span className={`level-pill level-${inc.peak_level}`}>{inc.peak_level}</span>
                    <span className="tag" style={{ textTransform: 'capitalize' }}>{inc.status}</span>
                    {inc.scenario && <span className="sim-badge">drill · {inc.scenario}</span>}
                    {!inc.ended_at && <span className="tag" style={{ color: 'var(--color-risk-critical)' }}><span className="rec-dot" /> ongoing</span>}
                  </div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 600 }}>{inc.zone_name}</div>
                  <div className="dim num" style={{ fontSize: '0.72rem', marginTop: 4 }}>
                    {inc.id} · {new Date(inc.started_at * 1000).toLocaleString()} · {duration(inc.started_at, inc.ended_at)} · peak risk {Math.round(inc.peak_risk * 100)}
                  </div>
                </div>
                <button className="btn btn-sm no-print" onClick={() => window.print()}><Printer /> Report</button>
              </div>
              <div className="no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="text-input" style={{ minWidth: 220 }} placeholder="Add an operator note (optional)" value={note} onChange={e => setNote(e.target.value)} />
                {inc.status === 'open' && <button className="btn" onClick={() => act('acknowledge')}>Acknowledge</button>}
                {inc.status !== 'resolved' && inc.status !== 'escalated' && <button className="btn btn-danger" onClick={() => act('escalate')}>Escalate to event lead</button>}
                {inc.status !== 'resolved' ? <button className="btn btn-primary" onClick={() => act('resolve')}>Resolve</button>
                  : <button className="btn" onClick={() => act('reopen')}>Reopen</button>}
              </div>
            </div>

            <div className="grid-12">
              <div className="card span-7">
                <div className="card-head">
                  <div className="card-title">Evidence</div>
                  {clip?.face_blur && <span className="tag"><Lock size={12} /> Faces anonymised</span>}
                </div>
                {clip ? (
                  <>
                    <video key={clip.url} src={clip.url} poster={clip.thumb} controls autoPlay muted loop playsInline style={{ width: '100%', borderRadius: 8, background: '#000', display: 'block' }} />
                    <div className="dim num" style={{ fontSize: '0.7rem', marginTop: 8 }}>
                      {clip.source_id} · {clip.duration_s}s · trigger at {clip.trigger_offset_s}s · {clip.frames} frames
                    </div>
                    {inc.clips.length > 1 && (
                      <div className="segmented" style={{ marginTop: 8 }}>
                        {inc.clips.map((c, i) => <button key={c.url} className={i === clipIdx ? 'on' : ''} onClick={() => setClipIdx(i)}>{c.source_id}</button>)}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="empty-state" style={{ padding: '36px 12px' }}>
                    <p>{inc.ended_at || Date.now() / 1000 - inc.started_at > 20 ? 'No camera covered this zone, so no clip was recorded.' : 'Recording post-event footage…'}</p>
                  </div>
                )}
              </div>
              <div className="card span-5">
                <div className="card-head"><div className="card-title">Signals at peak</div></div>
                <table className="table">
                  <tbody>
                    <tr><td className="dim">People</td><td className="num">{peak.people_count} · {peak.density_ppm2?.toFixed?.(1)}/m²</td></tr>
                    <tr><td className="dim">Fruin LoS</td><td>{peak.los} — {peak.los_desc}</td></tr>
                    <tr><td className="dim">Vision / motion / audio</td><td className="num">{[peak.vision, peak.motion, peak.audio].map(m => Math.round((m?.score ?? 0) * 100)).join(' / ')}</td></tr>
                    <tr><td className="dim">Corroborated</td><td>{peak.corroborated ? `Yes (${peak.active_modalities?.join(' + ')})` : 'No'}</td></tr>
                    <tr><td className="dim">Audio</td><td>{peak.audio_label ?? '—'}{peak.hard_trigger ? ' · gunshot trigger' : ''}</td></tr>
                    {peak.keyword && <tr><td className="dim">Keyword</td><td>“{peak.keyword}” <span className="muted">— {peak.transcript}</span></td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><div className="card-title"><Sparkles size={15} color="var(--color-accent)" /> AI briefing</div></div>
              <Brief inc={inc} onRebrief={rebrief} />
            </div>

            <div className="grid-12">
              <div className="card span-8">
                <div className="card-head"><div className="card-title">Risk timeline</div></div>
                <ModalityTimeline history={inc.timeline} height={200} />
              </div>
              <div className="card span-4">
                <div className="card-head"><div className="card-title">Audit log</div></div>
                <div className="feed" style={{ maxHeight: 260 }}>
                  {inc.log.map((l, i) => (
                    <div key={i} className="feed-item" style={{ gridTemplateColumns: '58px 1fr' }}>
                      <span className="dim num" style={{ fontSize: '0.68rem' }}>{fmtTime(l.ts)}</span>
                      <span>
                        <b style={{ fontWeight: 600, textTransform: 'capitalize' }}>{l.action.replace(/_/g, ' ')}</b> <span className="dim">· {l.by}</span>
                        {l.note && <div className="muted" style={{ fontSize: '0.74rem' }}>{l.note}</div>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="card span-8 empty-state"><Siren /><h3>Select an incident</h3><p>Pick an incident on the left to see its evidence, AI briefing and timeline.</p></div>
        )}
      </div>
    </>
  );
}
