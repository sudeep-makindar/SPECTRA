/**
 * Zones — configure the venue model and see *why* each zone scores what it does.
 */

import { useEffect, useState } from 'react';
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="muted" style={{ fontSize: '0.78rem', lineHeight: 1.5 }}>
        Each sensor's evidence is <b>capped</b> (vision 72, motion 50, audio 50), so no single sensor can reach CRITICAL.
        When ≥2 sensors stay active for over a second, the evidence <b>compounds</b> (×1.2 noisy-OR).
      </div>
      {mods.map(m => {
        const s = z[m].score;
        const active = z.active_modalities.includes(m);
        return (
          <div key={m}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: 4 }}>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'capitalize' }}>
                <i style={{ width: 8, height: 8, borderRadius: 2, background: MODALITY_COLOR[m], display: 'inline-block' }} />{m}
                {active && <span className="chip chip-ai" style={{ padding: '0 6px', fontSize: '0.58rem' }}>active</span>}
                {z[m].simulated && <span className="sim-badge" style={{ padding: '0 6px', fontSize: '0.55rem' }}>sim</span>}
              </span>
              <span className="muted">{z[m].context}</span>
            </div>
            <div style={{ position: 'relative', height: 14, borderRadius: 4, background: 'var(--color-charcoal-lighter)' }}>
              <div style={{ position: 'absolute', inset: 0, width: `${s * 100}%`, borderRadius: 4, background: MODALITY_COLOR[m], opacity: 0.35 }} />
              <div style={{ position: 'absolute', inset: 0, width: `${s * CAPS[m] * 100}%`, borderRadius: 4, background: MODALITY_COLOR[m] }} />
              <div title="cap" style={{ position: 'absolute', top: -3, bottom: -3, left: `${CAPS[m] * 100}%`, width: 2, background: 'var(--color-text-muted)' }} />
            </div>
            <div className="dim" style={{ fontSize: '0.64rem', marginTop: 3 }}>
              evidence {Math.round(s * 100)} → capped contribution {Math.round(s * CAPS[m] * 100)} · share {Math.round((z.contributions[m] ?? 0) * 100)}%
            </div>
          </div>
        );
      })}
      <div style={{ padding: 10, borderRadius: 12, background: 'var(--color-surface)', fontSize: '0.78rem' }}>
        {z.corroborated
          ? <>✓ <b>Corroborated</b> by {z.active_modalities.join(' + ')} → compounded risk {Math.round(z.raw_score * 100)}</>
          : z.active_modalities.length === 1
            ? <>Single sensor ({z.active_modalities[0]}) active → held at its cap until another sensor agrees</>
            : <>No sensor above its activation threshold</>}
        {z.hard_trigger && <div style={{ marginTop: 4, color: 'var(--color-risk-high)' }}>Gunshot signature: instant HIGH; CRITICAL needs a crowd reaction</div>}
      </div>
    </div>
  );
}

function ConfigEditor({ cfg }: { cfg: ZoneConfig }) {
  const [form, setForm] = useState(cfg);
  const [saved, setSaved] = useState(false);
  useEffect(() => setForm(cfg), [cfg.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    await api(`/api/zones/${cfg.id}`, { method: 'PATCH', json: { name: form.name, area_m2: Number(form.area_m2), capacity: Number(form.capacity), sop: form.sop.filter(Boolean) } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="input-group"><div className="input-chip">Name</div><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="input-group" style={{ flex: 1 }} title="Floor area visible to this zone's cameras — converts headcount to people/m²">
          <div className="input-chip">Area m²</div><input type="number" step="0.5" min="0.5" value={form.area_m2} onChange={e => setForm({ ...form, area_m2: Number(e.target.value) })} />
        </div>
        <div className="input-group" style={{ flex: 1 }}>
          <div className="input-chip">Capacity</div><input type="number" min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: Number(e.target.value) })} />
        </div>
      </div>
      <div className="card-label" style={{ marginTop: 4 }}>Standard operating procedures (fed to the AI co-pilot)</div>
      {form.sop.map((s, i) => (
        <div className="input-group" key={i}>
          <div className="input-chip">{i + 1}</div>
          <input value={s} onChange={e => { const sop = [...form.sop]; sop[i] = e.target.value; setForm({ ...form, sop }); }} />
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={() => setForm({ ...form, sop: [...form.sop, ''] })}>+ SOP step</button>
        <button className="btn btn-primary" onClick={save}>{saved ? 'Saved ✓' : 'Save zone'}</button>
      </div>
    </div>
  );
}

export function ZonesPage() {
  const s = useSpectra();
  const [sel, setSel] = useState<string | null>(s.focusZone);
  const selected = sel ?? s.zone_configs[0]?.id;
  const cfg = s.zone_configs.find(c => c.id === selected);
  const z = selected ? s.zones[selected] : undefined;

  const addZone = async () => {
    const name = prompt('Zone name (e.g. "North Concourse")');
    if (!name) return;
    const r = await api<ZoneConfig>('/api/zones', { method: 'POST', json: { name, area_m2: 20, capacity: 40, x: 4, y: 6, w: 28, h: 46 } });
    setSel(r.id);
  };

  return (
    <div className="page">
      <div className="grid-12">
        <div className="span-3" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {s.zone_configs.map(c => {
            const zz = s.zones[c.id];
            return (
              <div key={c.id} className={`card card-dark ${selected === c.id ? 'zone-card selected' : ''}`} style={{ padding: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }} onClick={() => setSel(c.id)}>
                {zz && <RiskDial risk={zz.risk_score} level={zz.alert_level} size={54} stroke={6} label="" />}
                <div style={{ minWidth: 0 }}>
                  <div className="zone-name" style={{ fontSize: '1.15rem' }}>{c.name}</div>
                  <div className="dim" style={{ fontSize: '0.7rem' }}>{c.area_m2} m² · cap {c.capacity} · {zz?.source_ids.length ?? 0} sensors</div>
                </div>
              </div>
            );
          })}
          <button className="btn" onClick={addZone}>+ New zone</button>
        </div>

        {cfg && z && (
          <>
            <div className="card card-dark span-5">
              <div className="section-title">
                <div className="card-label" style={{ marginBottom: 0 }}>Why is {cfg.name} at {Math.round(z.risk_score * 100)}?</div>
                <span className={`level-pill level-${z.alert_level}`}>{z.alert_level}</span>
              </div>
              <Explain z={z} />
              {z.reasons.length > 0 && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {z.reasons.map(r => <div className="reason" key={r}>{r}</div>)}
                </div>
              )}
            </div>
            <div className="card card-dark span-4">
              <div className="card-label">Zone configuration</div>
              <ConfigEditor cfg={cfg} />
              <div className="hr" style={{ margin: '14px 0' }} />
              <div className="card-label">Sensors</div>
              {s.sources.filter(x => x.zone_id === cfg.id).map(x => (
                <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '4px 0' }}>
                  <span><span className={`status-dot status-dot-${x.status === 'online' ? 'online' : x.status === 'degraded' ? 'degraded' : 'offline'}`} /> {x.name}</span>
                  <span className="dim">{x.kind} · {x.adapter}</span>
                </div>
              ))}
              {!z.source_ids.length && <div className="dim" style={{ fontSize: '0.76rem' }}>No sensors. Assign one from Live Ops.</div>}
            </div>
            <div className="card card-dark span-8">
              <div className="card-label">Evidence per modality vs fused risk</div>
              <ModalityTimeline history={z.history} height={220} />
            </div>
            <div className="card card-dark span-4">
              <div className="card-label">Zone events</div>
              <EventFeed zoneId={cfg.id} height={250} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
