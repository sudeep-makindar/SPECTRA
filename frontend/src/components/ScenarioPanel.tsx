/**
 * ScenarioPanel — one-click, clearly-labelled simulations layered onto a zone.
 */

import { useEffect, useState } from 'react';
import { useSpectra } from '../context/SpectraContext';
import { api } from '../lib/types';

interface CatalogItem { id: string; title: string; description: string; duration_s: number; expected: string }

export function ScenarioPanel({ compact = false }: { compact?: boolean }) {
  const { zone_configs, scenarios, focusZone } = useSpectra();
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [zone, setZone] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ catalog: CatalogItem[] }>('/api/scenarios').then(r => setCatalog(r.catalog)).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (focusZone) setZone(focusZone);
    else if (!zone && zone_configs.length) setZone(zone_configs[0].id);
  }, [focusZone, zone_configs, zone]);

  const start = async (id: string) => {
    setError(null);
    try { await api('/api/scenarios/start', { method: 'POST', json: { scenario: id, zone_id: zone } }); }
    catch (e) { setError((e as Error).message); }
  };
  const stopAll = () => api('/api/scenarios/stop', { method: 'POST' });

  return (
    <div className="card card-dark" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="section-title" style={{ marginBottom: 0 }}>
        <div className="card-label" style={{ marginBottom: 0 }}>Scenario Director</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select className="text-input" style={{ flex: 'none', padding: '5px 10px', fontSize: '0.75rem' }} value={zone} onChange={e => setZone(e.target.value)}>
            {zone_configs.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
          {scenarios.length > 0 && <button className="btn btn-sm" onClick={stopAll}>Stop</button>}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
        {catalog.map(c => {
          const run = scenarios.find(s => s.scenario === c.id && s.zone_id === zone);
          return (
            <button key={c.id} className={`scenario-btn ${run ? 'running' : ''}`} onClick={() => start(c.id)} title={c.description}>
              <span style={{ fontWeight: 700, fontSize: '0.8rem' }}>{c.title}</span>
              {!compact && <span className="dim" style={{ fontSize: '0.7rem', lineHeight: 1.35 }}>{c.description}</span>}
              <span className="dim" style={{ fontSize: '0.64rem' }}>expect: <b style={{ color: 'var(--color-text-secondary)' }}>{c.expected.toUpperCase()}</b> · {c.duration_s}s</span>
              {run && <div className="progress"><div style={{ width: `${Math.min(100, (run.elapsed / run.duration_s) * 100)}%` }} /></div>}
            </button>
          );
        })}
      </div>
      {error && <div style={{ color: 'var(--color-error)', fontSize: '0.75rem' }}>{error}</div>}
      <div className="dim" style={{ fontSize: '0.68rem' }}>Simulated evidence is merged with the zone's live sensors and flagged SIM everywhere it appears.</div>
    </div>
  );
}
