/**
 * DrillDrawer — clearly-labelled simulated scenarios, kept out of the live
 * monitoring views in a slide-over. Simulated evidence is merged with the
 * zone's live sensors and flagged DRILL everywhere it appears.
 */

import { useEffect, useState } from 'react';
import { FlaskConical, Square, X } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import { api } from '../lib/types';

interface CatalogItem { id: string; title: string; description: string; duration_s: number; expected: string }

export function DrillDrawer() {
  const { drillOpen, setDrillOpen, zone_configs, scenarios, focusZone } = useSpectra();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [zone, setZone] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (drillOpen && !catalog.length) api<{ catalog: CatalogItem[] }>('/api/scenarios').then(r => setCatalog(r.catalog)).catch(e => setError(e.message));
  }, [drillOpen, catalog.length]);
  useEffect(() => {
    if (focusZone) setZone(focusZone);
    else if (!zone && zone_configs.length) setZone(zone_configs[0].id);
  }, [focusZone, zone_configs, zone]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrillOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDrillOpen]);

  if (!drillOpen) return null;

  const start = async (id: string) => {
    setError(null);
    try { await api('/api/scenarios/start', { method: 'POST', json: { scenario: id, zone_id: zone } }); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <>
      <div className="overlay" onClick={() => setDrillOpen(false)} />
      <aside className="drawer" role="dialog" aria-label="Drills">
        <div className="drawer-head">
          <div>
            <div className="card-title"><FlaskConical size={16} /> Drills</div>
            <div className="dim" style={{ fontSize: '0.76rem', marginTop: 4, lineHeight: 1.45 }}>
              Scripted scenarios for training and demos. They layer on top of the zone's real sensors and are labelled <span className="sim-badge">drill</span> everywhere.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setDrillOpen(false)} aria-label="Close"><X /></button>
        </div>
        <div className="drawer-body">
          <label className="field">
            Target zone
            <select className="select" value={zone} onChange={e => setZone(e.target.value)}>
              {zone_configs.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
          {scenarios.length > 0 && (
            <button className="btn btn-danger" onClick={() => api('/api/scenarios/stop', { method: 'POST' })}><Square /> Stop all drills</button>
          )}
          {catalog.map(c => {
            const run = scenarios.find(s => s.scenario === c.id && s.zone_id === zone);
            return (
              <button key={c.id} className={`option-card ${run ? 'running' : ''}`} onClick={() => start(c.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <b>{c.title}</b>
                  <span className={`level-pill level-${c.expected === 'blind' ? 'blind' : c.expected}`}>{c.expected === 'blind' ? 'blind spot' : `expect ${c.expected}`}</span>
                </div>
                <span>{c.description}</span>
                <span className="dim" style={{ fontSize: '0.7rem' }}>{c.duration_s}s</span>
                {run && <div className="progress"><div style={{ width: `${Math.min(100, (run.elapsed / run.duration_s) * 100)}%` }} /></div>}
              </button>
            );
          })}
          {error && <div style={{ color: 'var(--color-error)', fontSize: '0.78rem' }}>{error}</div>}
        </div>
      </aside>
    </>
  );
}
