/**
 * Run a demo — play a scripted situation in one zone, on top of whatever its
 * real sensors pick up. Simulated signals are labelled "Demo" everywhere.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Square, X } from 'lucide-react';
import { useLive } from '../LiveContext';
import { LevelBadge } from '../parts';
import { api } from '../live';
import type { Level } from '../live';

interface CatalogItem { id: string; title: string; description: string; duration_s: number; expected: string }

const PLAIN: Record<string, { title: string; body: string }> = {
  surge: { title: 'Crowd builds up at the gate', body: 'More and more people squeeze in until they are packed tight. Then pushing and shouting start.' },
  panic: { title: 'Sudden panic, cries for help', body: 'People start running and screaming “bachao” (Hindi for “help me”).' },
  concert: { title: 'Loud concert, but safe', body: 'Singing and dancing. A sound-only system would raise a false alarm here. SPECTRA should not.' },
  gunshot: { title: 'Gunshot, then the crowd runs', body: 'A gunshot sound, and a second later everyone scatters.' },
  blackout: { title: 'Cameras go dark', body: 'Every sensor stops. SPECTRA must say it can’t see, not that all is calm.' },
};

export function DemoDialog() {
  const s = useLive();
  const navigate = useNavigate();
  const close = () => s.openDialog(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [zone, setZone] = useState(s.zoneFilter !== 'all' ? s.zoneFilter : s.zoneConfigs[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ catalog: CatalogItem[] }>('/api/scenarios').then(r => setCatalog(r.catalog)).catch(e => setError(e.message));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && s.openDialog(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  const start = async (id: string) => {
    setError(null);
    try {
      await api('/api/scenarios/start', { method: 'POST', json: { scenario: id, zone_id: zone } });
      close();
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="backdrop" onClick={close}>
      <div className="dialog" role="dialog" aria-label="Run a demo" onClick={e => e.stopPropagation()}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <h2>Run a demo</h2>
            <p className="ink-2" style={{ margin: '6px 0 0' }}>Real emergencies can’t be staged. Pick a situation to play out in one zone. It mixes with what the real cameras and mics pick up, and is marked <span className="badge badge-demo plain">Demo</span> everywhere.</p>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close"><X /></button>
        </div>

        <div className="row wrap">
          <label className="field grow">Play it in
            <select className="input" value={zone} onChange={e => setZone(e.target.value)}>
              {s.zoneConfigs.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
          {s.scenarios.length > 0 && <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => api('/api/scenarios/stop', { method: 'POST' })}><Square /> Stop running demos</button>}
        </div>

        {!catalog.length && !error && <div className="skeleton" style={{ height: 240 }} />}
        <div className="col" style={{ gap: 10 }}>
          {catalog.map(c => {
            const p = PLAIN[c.id] ?? { title: c.title, body: c.description };
            const run = s.scenarios.find(x => x.scenario === c.id && x.zone_id === zone);
            const expect = c.expected === 'blind' ? null : (c.expected as Level);
            return (
              <button key={c.id} className={`choice ${run ? 'on' : ''}`} onClick={() => start(c.id)} style={{ flexDirection: 'column', gap: 8 }}>
                <b>{p.title}</b>
                <span>{p.body}</span>
                <span className="row xs ink-3" style={{ gap: 8 }}>
                  You should see {expect ? <LevelBadge level={expect} /> : <span className="badge lv-blind">Can’t see</span>} · {c.duration_s} s
                </span>
                {run && <span className="bar" style={{ width: '100%' }}><div style={{ width: `${Math.min(100, (run.elapsed / run.duration_s) * 100)}%`, background: 'var(--ink)' }} /></span>}
              </button>
            );
          })}
        </div>
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
      </div>
    </div>
  );
}
