/**
 * Incidents — the after-action workspace: evidence, AI briefing, operator
 * workflow, audit trail, printable report and Claude shift handover.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSpectra } from '../context/SpectraContext';
import { ModalityTimeline } from '../components/RiskTimeline';
import { api, fmtAgo, fmtTime } from '../lib/types';
import type { Incident } from '../lib/types';

function duration(a: number, b: number | null) {
  const s = Math.round((b ?? Date.now() / 1000) - a);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Brief({ inc, onRebrief }: { inc: Incident; onRebrief: () => void }) {
  const b = inc.brief;
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  if (!b || inc.brief_status === 'pending') {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="dim" style={{ fontSize: '0.8rem' }}>✦ Co-pilot is writing the briefing…</div>
      <div className="skeleton" style={{ height: 80 }} />
    </div>;
  }
  const copy = (t: string) => navigator.clipboard?.writeText(t);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="chip chip-ai">✦ {b.source === 'claude' ? b.model : 'offline template'}</span>
        <span className="chip">{b.confidence} confidence</span>
        <span className="dim" style={{ fontSize: '0.68rem' }}>for {b.for_level?.toUpperCase()} · {fmtAgo(b.generated_at)}</span>
        <button className="btn btn-sm btn-ghost no-print" onClick={onRebrief}>↻ Regenerate</button>
      </div>
      <div style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.25 }}>{b.headline}</div>
      <div style={{ fontSize: '0.86rem', lineHeight: 1.55 }}>{b.summary}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ padding: 12, borderRadius: 14, background: 'var(--color-surface)' }}>
          <div className="card-label">Likely situation</div>
          <div style={{ fontSize: '0.8rem', lineHeight: 1.45 }}>{b.likely_situation}</div>
        </div>
        <div style={{ padding: 12, borderRadius: 14, background: 'var(--color-surface)' }}>
          <div className="card-label">False-alarm check</div>
          <div style={{ fontSize: '0.8rem', lineHeight: 1.45 }}>{b.false_alarm_check}</div>
        </div>
      </div>
      <div>
        <div className="card-label">Recommended actions</div>
        {b.recommended_actions.map((a, i) => (
          <label key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', fontSize: '0.82rem', alignItems: 'flex-start', cursor: 'pointer', opacity: checked[i] ? 0.5 : 1 }}>
            <input type="checkbox" checked={!!checked[i]} onChange={e => setChecked({ ...checked, [i]: e.target.checked })} style={{ marginTop: 3, accentColor: '#9D8DF7' }} />
            <span className="kbd" style={{ color: a.priority === 'now' ? 'var(--color-risk-high)' : undefined, flexShrink: 0 }}>{a.priority}</span>
            <span style={{ textDecoration: checked[i] ? 'line-through' : undefined }}><b>{a.role}:</b> {a.action}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['PA · English', b.pa_announcement_en], ['PA · हिंदी', b.pa_announcement_hi]].map(([label, text]) => (
          <div key={label} style={{ padding: 12, borderRadius: 14, background: 'rgba(157,141,247,0.1)', border: '1px solid rgba(157,141,247,0.25)' }}>
            <div className="section-title" style={{ marginBottom: 6 }}>
              <div className="card-label" style={{ marginBottom: 0 }}>{label}</div>
              <button className="btn btn-sm btn-ghost no-print" onClick={() => copy(text)}>Copy</button>
            </div>
            <div style={{ fontSize: '0.84rem', lineHeight: 1.5 }}>{text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IncidentsPage() {
  const { incidents } = useSpectra();
  const [params, setParams] = useSearchParams();
  const selId = params.get('id') ?? incidents[0]?.id;
  const [inc, setInc] = useState<Incident | null>(null);
  const [clipIdx, setClipIdx] = useState(0);
  const [note, setNote] = useState('');
  const [report, setReport] = useState<{ report: string; source: string } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const summary = incidents.find(i => i.id === selId);
  useEffect(() => {
    if (!selId) return;
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
    if (!confirm('Delete all incidents and clips? (demo reset)')) return;
    await api('/api/incidents', { method: 'DELETE' });
    setInc(null);
  };

  const clip = inc?.clips[clipIdx];
  const peak = inc?.peak_snapshot ?? {};

  return (
    <div className="page">
      {report && (
        <div className="modal-backdrop" onClick={() => setReport(null)}>
          <div className="card card-dark modal" style={{ width: 'min(760px, 100%)' }} onClick={e => e.stopPropagation()}>
            <div className="section-title">
              <div className="display" style={{ fontSize: '1.6rem' }}>Shift handover</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(report.report)}>Copy</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setReport(null)}>✕</button>
              </div>
            </div>
            <div className="copilot-answer" style={{ fontSize: '0.82rem' }}>{report.report}</div>
            <div className="dim" style={{ fontSize: '0.65rem', marginTop: 10 }}>{report.source === 'claude' ? 'Written by Claude from incident metadata' : report.source}</div>
          </div>
        </div>
      )}

      <div className="grid-12">
        <div className="card card-dark span-4 no-print" style={{ padding: 16 }}>
          <div className="section-title">
            <div className="card-label" style={{ marginBottom: 0 }}>Incidents ({incidents.length})</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm btn-primary" disabled={reportBusy} onClick={shiftReport}>{reportBusy ? '…' : '✦ Shift report'}</button>
              <button className="btn btn-sm btn-ghost" onClick={clearAll} title="Demo reset">Reset</button>
            </div>
          </div>
          {!incidents.length && <div className="dim" style={{ fontSize: '0.8rem', padding: '24px 0' }}>No incidents yet. Run a scenario from the Command Center to see the full flow.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '72vh', overflowY: 'auto' }}>
            {incidents.map(i => (
              <div key={i.id} onClick={() => setParams({ id: i.id })}
                style={{ display: 'flex', gap: 10, padding: 8, borderRadius: 14, cursor: 'pointer', background: i.id === selId ? 'rgba(157,141,247,0.12)' : 'var(--color-surface)', border: `1px solid ${i.id === selId ? 'var(--color-lavender)' : 'transparent'}` }}>
                <div style={{ width: 72, height: 48, borderRadius: 10, overflow: 'hidden', background: '#000', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {i.thumb ? <img src={i.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span className="dim" style={{ fontSize: '0.6rem' }}>no clip</span>}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`level-pill level-${i.peak_level}`} style={{ animation: 'none' }}>{i.peak_level}</span>
                    {i.scenario && <span className="sim-badge" style={{ fontSize: '0.55rem' }}>sim</span>}
                    {!i.ended_at && <span className="rec-dot" title="Ongoing" />}
                  </div>
                  <div style={{ fontSize: '0.78rem', fontWeight: 600, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.headline ?? i.zone_name}</div>
                  <div className="dim" style={{ fontSize: '0.66rem' }}>{i.zone_name} · {fmtTime(i.started_at)} · {i.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {inc && (
          <div className="span-8" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="card card-dark" style={{ padding: 20 }}>
              <div className="section-title" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                    <span className={`level-pill level-${inc.peak_level}`}>{inc.peak_level}</span>
                    <span className="chip">{inc.status.toUpperCase()}</span>
                    {inc.scenario && <span className="sim-badge">simulation: {inc.scenario}</span>}
                  </div>
                  <div className="display" style={{ fontSize: '2rem' }}>{inc.zone_name}</div>
                  <div className="dim mono" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                    {inc.id} · {new Date(inc.started_at * 1000).toLocaleString()} · {duration(inc.started_at, inc.ended_at)}{!inc.ended_at && ' (ongoing)'} · peak risk {Math.round(inc.peak_risk * 100)}
                  </div>
                </div>
                <button className="btn btn-sm no-print" onClick={() => window.print()}>⎙ Report / PDF</button>
              </div>
              <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                <input className="text-input" style={{ minWidth: 200 }} placeholder="Operator note (optional)" value={note} onChange={e => setNote(e.target.value)} />
                <button className="btn" onClick={() => act('acknowledge')}>Acknowledge</button>
                <button className="btn btn-danger" onClick={() => act('escalate')}>Escalate to event lead</button>
                <button className="btn btn-primary" onClick={() => act('resolve')}>Resolve</button>
                {inc.status === 'resolved' && <button className="btn btn-ghost" onClick={() => act('reopen')}>Reopen</button>}
              </div>
            </div>

            <div className="grid-12">
              <div className="card card-dark span-7" style={{ padding: 14 }}>
                <div className="section-title">
                  <div className="card-label" style={{ marginBottom: 0 }}>Evidence</div>
                  {clip?.face_blur && <span className="chip">🔒 Heads anonymised</span>}
                </div>
                {clip ? (
                  <>
                    <video key={clip.url} src={clip.url} poster={clip.thumb} controls autoPlay muted loop playsInline style={{ width: '100%', borderRadius: 16, background: '#000' }} />
                    <div className="dim" style={{ fontSize: '0.68rem', marginTop: 6 }}>
                      {clip.source_id} · {clip.duration_s}s · trigger at {clip.trigger_offset_s}s · {clip.frames} frames
                    </div>
                    {inc.clips.length > 1 && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        {inc.clips.map((c, i) => <button key={c.url} className={`btn btn-sm ${i === clipIdx ? 'btn-primary' : ''}`} onClick={() => setClipIdx(i)}>{c.source_id}</button>)}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="dim" style={{ fontSize: '0.8rem', padding: '40px 0', textAlign: 'center' }}>
                    {inc.ended_at || Date.now() / 1000 - inc.started_at > 20 ? 'No camera covered this zone, so there is no clip.' : 'Recording post-event footage…'}
                  </div>
                )}
              </div>
              <div className="card card-dark span-5" style={{ padding: 14 }}>
                <div className="card-label">Signals at peak</div>
                <table className="table">
                  <tbody>
                    <tr><td className="dim">People / density</td><td>{peak.people_count} · {peak.density_ppm2?.toFixed?.(1)}/m²</td></tr>
                    <tr><td className="dim">Fruin LoS</td><td>{peak.los} — {peak.los_desc}</td></tr>
                    <tr><td className="dim">Vision · Motion · Audio</td><td className="tabular-nums">{[peak.vision, peak.motion, peak.audio].map(m => Math.round((m?.score ?? 0) * 100)).join(' · ')}</td></tr>
                    <tr><td className="dim">Corroborated</td><td>{peak.corroborated ? `yes (${peak.active_modalities?.join(' + ')})` : 'no'}</td></tr>
                    <tr><td className="dim">Audio</td><td>{peak.audio_label ?? '—'}{peak.hard_trigger ? ' · gunshot trigger' : ''}</td></tr>
                    {peak.keyword && <tr><td className="dim">Keyword</td><td>“{peak.keyword}” — <i>{peak.transcript}</i></td></tr>}
                  </tbody>
                </table>
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(peak.reasons ?? []).map(r => <div key={r} className="reason">{r}</div>)}
                </div>
              </div>
            </div>

            <div className="card card-dark ai-glow" style={{ padding: 20 }}>
              <div className="card-label">AI incident briefing</div>
              <Brief inc={inc} onRebrief={rebrief} />
            </div>

            <div className="grid-12">
              <div className="card card-dark span-8" style={{ padding: 14 }}>
                <div className="card-label">Risk timeline</div>
                <ModalityTimeline history={inc.timeline} height={200} />
              </div>
              <div className="card card-dark span-4" style={{ padding: 14 }}>
                <div className="card-label">Audit log</div>
                <div className="feed" style={{ maxHeight: 240 }}>
                  {inc.log.map((l, i) => (
                    <div key={i} className="feed-item" style={{ gridTemplateColumns: '62px 1fr' }}>
                      <span className="dim mono" style={{ fontSize: '0.66rem' }}>{fmtTime(l.ts)}</span>
                      <span><b style={{ textTransform: 'capitalize' }}>{l.action.replace('_', ' ')}</b> <span className="dim">· {l.by}</span>{l.note && <div className="muted" style={{ fontSize: '0.72rem' }}>{l.note}</div>}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
