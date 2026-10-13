/**
 * CopilotPanel — Claude incident co-pilot: latest briefing + "Ask SPECTRA".
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSpectra } from '../context/SpectraContext';
import { api, fmtAgo } from '../lib/types';
import type { Incident } from '../lib/types';

const SUGGESTIONS = [
  'Which zone needs attention first, and why?',
  'Is the Stage Front alarm likely a false alarm?',
  'What should the gate stewards do right now?',
];

export function CopilotPanel() {
  const { incidents } = useSpectra();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<{ text: string; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<Incident | null>(null);
  const [status, setStatus] = useState<{ enabled: boolean; model: string } | null>(null);

  const latestSummary = incidents.find(i => i.brief_status === 'ready');
  useEffect(() => {
    api<{ enabled: boolean; model: string }>('/api/copilot/status').then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    if (!latestSummary) return;
    api<Incident>(`/api/incidents/${latestSummary.id}`).then(setLatest).catch(() => {});
  }, [latestSummary?.id, latestSummary?.headline, latestSummary]);

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const r = await api<{ answer: string; source: string }>('/api/copilot/ask', { method: 'POST', json: { question } });
      setAnswer({ text: r.answer, source: r.source });
    } catch (e) {
      setAnswer({ text: `Error: ${(e as Error).message}`, source: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const brief = latest?.brief;
  return (
    <div className="card card-dark ai-glow" style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>
      <div className="section-title" style={{ marginBottom: 0 }}>
        <div className="card-label" style={{ marginBottom: 0 }}>AI Co-pilot</div>
        <span className="chip chip-ai">✦ {status?.enabled ? status.model : 'offline templates'}</span>
      </div>

      {brief && latest ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' }} onClick={() => navigate(`/incidents?id=${latest.id}`)}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`level-pill level-${latest.peak_level}`}>{latest.peak_level}</span>
            <span className="dim" style={{ fontSize: '0.7rem' }}>{latest.zone_name} · {fmtAgo(latest.started_at)} · {brief.confidence} confidence</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.3 }}>{brief.headline}</div>
          <div className="muted" style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>{brief.summary}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {brief.recommended_actions.slice(0, 3).map((a, i) => (
              <div key={i} style={{ fontSize: '0.76rem', display: 'flex', gap: 8 }}>
                <span className="kbd" style={{ color: a.priority === 'now' ? 'var(--color-risk-high)' : undefined }}>{a.priority}</span>
                <span><b>{a.role}:</b> {a.action}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '0.78rem', padding: '8px 10px', borderRadius: 12, background: 'var(--color-surface)' }}>
            <div className="card-label">PA announcement · हिंदी</div>
            {brief.pa_announcement_hi}
          </div>
        </div>
      ) : (
        <div className="dim" style={{ fontSize: '0.8rem' }}>
          When a zone reaches HIGH, SPECTRA writes a briefing: what the sensors show, how confident it is, what to do, and a bilingual PA announcement. Only signal metadata is shared; video and audio stay on this machine.
        </div>
      )}

      <div className="hr" />
      <form style={{ display: 'flex', gap: 8 }} onSubmit={e => { e.preventDefault(); ask(q); }}>
        <input className="text-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask SPECTRA about the live situation…" />
        <button className="btn btn-primary" disabled={busy || !q.trim()}>{busy ? '…' : 'Ask'}</button>
      </form>
      {!answer && !busy && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SUGGESTIONS.map(s => <button key={s} className="chip" onClick={() => { setQ(s); ask(s); }}>{s}</button>)}
        </div>
      )}
      {busy && <div className="skeleton" style={{ height: 48 }} />}
      {answer && (
        <div className="copilot-answer" style={{ padding: 12, borderRadius: 14, background: 'var(--color-surface)' }}>
          {answer.text}
          <div className="dim" style={{ fontSize: '0.65rem', marginTop: 6 }}>{answer.source === 'claude' ? 'Claude · signal metadata only' : answer.source}</div>
        </div>
      )}
    </div>
  );
}
