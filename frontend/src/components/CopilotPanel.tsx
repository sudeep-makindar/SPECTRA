/**
 * CopilotPanel — AI co-pilot: latest incident briefing + "Ask SPECTRA".
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Sparkles } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import { api, fmtAgo } from '../lib/types';
import type { Incident } from '../lib/types';

const SUGGESTIONS = [
  'Which zone needs attention first, and why?',
  'Is the current alarm likely a false alarm?',
  'What should the stewards do right now?',
];

export function CopilotPanel() {
  const { incidents, health } = useSpectra();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<{ text: string; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<Incident | null>(null);
  const cp = health?.copilot;

  const latestSummary = incidents.find(i => i.brief_status === 'ready' && !i.ended_at) ?? incidents.find(i => i.brief_status === 'ready');
  useEffect(() => {
    if (!latestSummary) { setLatest(null); return; }
    api<Incident>(`/api/incidents/${latestSummary.id}`).then(setLatest).catch(() => {});
  }, [latestSummary?.id, latestSummary?.headline]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%' }}>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div className="card-title"><Sparkles size={15} color="var(--color-accent)" /> AI Co-pilot</div>
        <span className={`tag ${cp?.enabled ? 'accent' : ''}`} title={cp?.last_error ?? ''}>
          {cp?.enabled ? `${cp.provider_label} · ${cp.model}` : `Offline templates${cp?.key_env ? ` · set ${cp.key_env}` : ''}`}
        </span>
      </div>

      {brief && latest ? (
        <div className="card inset clickable" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }} onClick={() => navigate(`/incidents?id=${latest.id}`)}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {latest.ended_at
              ? <span className="tag">Last briefing · closed</span>
              : <span className={`level-pill level-${latest.peak_level}`}>{latest.peak_level} · active</span>}
            <span className="dim" style={{ fontSize: '0.72rem' }}>{latest.zone_name} · {fmtAgo(latest.started_at)} · {brief.confidence} confidence</span>
          </div>
          <div style={{ fontWeight: 600, fontSize: '0.92rem', lineHeight: 1.35 }}>{brief.headline}</div>
          <div className="muted" style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>{brief.summary}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 }}>
            {brief.recommended_actions.slice(0, 3).map((a, i) => (
              <div key={i} style={{ fontSize: '0.78rem', display: 'flex', gap: 8, lineHeight: 1.4 }}>
                <span className="kbd" style={{ color: a.priority === 'now' ? 'var(--color-risk-high)' : undefined, flexShrink: 0 }}>{a.priority}</span>
                <span><b style={{ fontWeight: 600 }}>{a.role}:</b> <span className="muted">{a.action}</span></span>
              </div>
            ))}
          </div>
          <span style={{ fontSize: '0.74rem', color: 'var(--color-accent)' }}>Open incident →</span>
        </div>
      ) : (
        <div className="muted" style={{ fontSize: '0.8rem', lineHeight: 1.55 }}>
          When a zone reaches HIGH, the co-pilot writes a briefing: what the sensors show, how confident it is, what to do, and a bilingual PA announcement. It receives signal metadata only; video and audio never leave this machine.
        </div>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {answer && (
          <div className="pa-box copilot-answer">
            {answer.text}
            <div className="dim" style={{ fontSize: '0.66rem', marginTop: 6 }}>{answer.source === 'llm' ? `${cp?.provider_label} · metadata only` : answer.source}</div>
          </div>
        )}
        {busy && <div className="skeleton" style={{ height: 44 }} />}
        {!answer && !busy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {SUGGESTIONS.map(s => <button key={s} className="suggestion" onClick={() => { setQ(s); ask(s); }}>{s}</button>)}
          </div>
        )}
        <form style={{ display: 'flex', gap: 8 }} onSubmit={e => { e.preventDefault(); ask(q); }}>
          <input className="text-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about the live situation…" />
          <button className="btn btn-primary" disabled={busy || !q.trim()} aria-label="Ask"><Send /></button>
        </form>
      </div>
    </div>
  );
}
