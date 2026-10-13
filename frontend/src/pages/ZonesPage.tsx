/**
 * Zones — configure the venue model and see *why* each zone scores what it does.
 */

import { useEffect, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import { ModalityTimeline } from '../components/RiskTimeline';
import { EventFeed } from '../components/EventFeed';
import { RiskDial } from '../components/RiskDial';
import { MODALITY_COLOR, api } from '../lib/types';
import type { ZoneConfig, ZoneState } from '../lib/types';

const CAPS = { vision: 0.72, motion: 0.5, audio: 0.5 };

function Explain({ z }: { z: ZoneState }) {
  const mods = ['vision', 'motion', 'audio'] as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {mods.map(m => {
        const s = z[m].score;
        const active = z.active_modalities.includes(m);
        return (
          <div key={m}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 6, gap: 8 }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', textTransform: 'capitalize', fontWeight: 500 }}>
                <i style={{ width: 8, height: 8, borderRadius: 2, background: MODALITY_COLOR[m], display: 'inline-block' }} />{m}
                {active && <span className="tag accent">active</span>}
                {z[m].simulated && <span className="sim-badge">drill</span>}
              </span>
              <span className="muted" style={{ textAlign: 'right' }}>{z[m].context}</span>
            </div>
            <div style={{ position: 'relative', height: 10, borderRadius: 3, background: 'var(--color-surface-3)' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${s * 100}%`, borderRadius: 3, background: MODALITY_COLOR[m], opacity: 0.3 }} />
              <div style={{ position: 'absolute', inset: 0, width: `${s * CAPS[m] * 100}%`, borderRadius: 3, background: MODALITY_COLOR[m] }} />
              <div title="single-sensor cap" style={{ position: 'absolute', top: -3, bottom: -3, left: `${CAPS[m] * 100}%`, width: 2, background: 'var(--color-text-secondary)', borderRadius: 1 }} />
            </div>
            <div className="dim num" style={{ fontSize: '0.68rem', marginTop: 4 }}>
              evidence {Math.round(s * 100)} → capped {Math.round(s * CAPS[m] * 100)} · share {Math.round((z.contributions[m] ?? 0) * 100)}%
            </div>
          </div>
        );
      })}
      <div className="card inset" style={{ padding: 12, fontSize: '0.8rem', lineHeight: 1.5 }}>
        {z.corroborated
          ? <><b>Corroborated</b> by {z.active_modalities.join(' + ')}: evidence compounds to {Math.round(z.raw_score * 100)}.</>
          : z.active_modalities.length === 1
            ? <>Only <b>{z.active_modalities[0]}</b> is active, so risk is held at that sensor’s cap until another sensor agrees.</>
            : <>No sensor is above its activation threshold.</>}
        {z.hard_trigger && <div style={{ marginTop: 4, color: 'var(--color-risk-high)' }}>Gunshot signature: instant HIGH; CRITICAL needs a crowd reaction.</div>}
      </div>
      <div className="dim" style={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
        The marker on each bar is that sensor’s cap. A single sensor can never push a zone to CRITICAL. When two or more stay active for over a second, the evidence compounds.
      </div>
    </div>
  );
}

function ConfigEditor({ cfg, onDeleted }: { cfg: ZoneConfig; onDeleted: () => void }) {
  const [form, setForm] = useState(cfg);
  const [saved, setSaved] = useState(false);
  useEffect(() => setForm(cfg), [cfg.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    await api(`/api/zones/${cfg.id}`, { method: 'PATCH', json: { name: form.name, area_m2: Number(form.area_m2), capacity: Number(form.capacity), sop: form.sop.filter(Boolean) } });
    try { localStorage.setItem('spectra.zones.calibrated', '1'); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const del = async () => {
    if (!confirm(`Delete zone ${cfg.name}? Its devices become unassigned.`)) return;
    await api(`/api/zones/${cfg.id}`, { method: 'DELETE' });
    onDeleted();
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label className="field">Name<input className="text-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <div className="field-row">
        <label className="field" title="Floor area visible to this zone's cameras — converts headcount to people/m²">Floor area (m²)
          <input className="text-input num" type="number" step="0.5" min="0.5" value={form.area_m2} onChange={e => setForm({ ...form, area_m2: Number(e.target.value) })} />
        </label>
        <label className="field">Safe capacity
          <input className="text-input num" type="number" min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: Number(e.target.value) })} />
        </label>
      </div>
      <div className="dim" style={{ fontSize: '0.72rem', marginTop: -4 }}>Area converts headcount into people/m². Measure what the cameras actually see.</div>
      <div className="field">Response procedures <span className="dim" style={{ fontSize: '0.7rem' }}>used by the AI co-pilot when it recommends actions</span></div>
      {form.sop.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="kbd">{i + 1}</span>
          <input className="text-input" value={s} onChange={e => { const sop = [...form.sop]; sop[i] = e.target.value; setForm({ ...form, sop }); }} />
          <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...form, sop: form.sop.filter((_, j) => j !== i) })} aria-label="Remove step"><Trash2 /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-sm" onClick={() => setForm({ ...form, sop: [...form.sop, ''] })}><Plus /> Add step</button>
        <div className="topbar-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={del}>Delete zone</button>
        <button className="btn btn-primary btn-sm" onClick={save}>{saved ? <><Check /> Saved</> : 'Save changes'}</button>
      </div>
    </div>
  );
}

export function ZonesPage() {
  const s = useSpectra();
  const [sel, setSel] = useState<string | null>(s.focusZone);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const selected = sel && s.zone_configs.some(c => c.id === sel) ? sel : s.zone_configs[0]?.id;
  const cfg = s.zone_configs.find(c => c.id === selected);
  const z = selected ? s.zones[selected] : undefined;

  const addZone = async () => {
    if (!newName.trim()) return;
    const r = await api<ZoneConfig>('/api/zones', { method: 'POST', json: { name: newName.trim(), area_m2: 20, capacity: 40, x: 4, y: 6, w: 28, h: 46 } });
    setSel(r.id);
    setNewName('');
    setAdding(false);
  };

  return (
    <div className="grid-12">
      <div className="card span-3" style={{ alignSelf: 'start', padding: 10 }}>
        <div className="card-head" style={{ padding: '6px 6px 0', marginBottom: 8 }}>
          <div className="card-title">Zones <span className="sub">{s.zone_configs.length}</span></div>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(!adding)}><Plus /> New</button>
        </div>
        {adding && (
          <form style={{ display: 'flex', gap: 6, padding: '0 6px 8px' }} onSubmit={e => { e.preventDefault(); addZone(); }}>
            <input autoFocus className="text-input" placeholder="e.g. North Concourse" value={newName} onChange={e => setNewName(e.target.value)} />
            <button className="btn btn-primary btn-sm" disabled={!newName.trim()}>Add</button>
          </form>
        )}
        {s.zone_configs.map(c => {
          const zz = s.zones[c.id];
          return (
            <div key={c.id} className={`list-item ${selected === c.id ? 'active' : ''}`} onClick={() => setSel(c.id)}>
              {zz && <RiskDial risk={zz.risk_score} level={zz.alert_level} size={44} stroke={5} label="" />}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{c.name}</div>
                <div className="dim" style={{ fontSize: '0.72rem' }}>{c.area_m2} m² · capacity {c.capacity} · {zz?.source_ids.length ?? 0} device{zz?.source_ids.length === 1 ? '' : 's'}</div>
              </div>
            </div>
          );
        })}
      </div>

      {cfg && z && (
        <>
          <div className="card span-5">
            <div className="card-head">
              <div className="card-title">Why is {cfg.name} at <span className="num">{Math.round(z.risk_score * 100)}</span>?</div>
              <span className={`level-pill level-${z.alert_level}`}>{z.alert_level}</span>
            </div>
            <Explain z={z} />
            {z.reasons.length > 0 && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {z.reasons.map(r => <div className="reason" key={r}>{r}</div>)}
              </div>
            )}
          </div>
          <div className="card span-4" style={{ alignSelf: 'start' }}>
            <div className="card-head"><div className="card-title">Configuration</div></div>
            <ConfigEditor cfg={cfg} onDeleted={() => setSel(null)} />
            <div className="hr" style={{ margin: '16px 0 12px' }} />
            <div className="card-label">Devices in this zone</div>
            {s.sources.filter(x => x.zone_id === cfg.id).map(x => (
              <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', padding: '5px 0' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className={`status-dot status-dot-${x.status === 'online' ? 'online' : 'offline'}`} />{x.name}</span>
                <span className="dim">{x.kind}</span>
              </div>
            ))}
            {!z.source_ids.length && <div className="dim" style={{ fontSize: '0.78rem' }}>None. Assign devices on the Devices page.</div>}
          </div>
          <div className="card span-8">
            <div className="card-head"><div className="card-title">Evidence by sensor vs fused risk <span className="sub">last 2 minutes</span></div></div>
            <ModalityTimeline history={z.history} height={220} />
          </div>
          <div className="card span-4">
            <div className="card-head"><div className="card-title">Zone events</div></div>
            <EventFeed zoneId={cfg.id} height={252} />
          </div>
        </>
      )}
    </div>
  );
}
