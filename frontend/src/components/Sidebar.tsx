/**
 * Sidebar — grouped navigation with live badges and a system-health footer.
 */

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, LayoutDashboard, Map, PanelLeftClose, PanelLeftOpen, Radio, Siren, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import { SpectraWordmark } from './Logo';
import { useSpectra } from '../context/SpectraContext';

interface Item { to: string; label: string; icon: ReactNode; badge?: ReactNode }

export function Sidebar() {
  const { incidents, zones, active_sources, total_sources, connected, health, metrics } = useSpectra();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('spectra.sidebar') === 'collapsed'; } catch { return false; }
  });
  const toggle = () => {
    setCollapsed(c => {
      try { localStorage.setItem('spectra.sidebar', c ? 'open' : 'collapsed'); } catch { /* ignore */ }
      return !c;
    });
  };

  const open = incidents.filter(i => !i.ended_at && i.status !== 'resolved');
  const anyCritical = Object.values(zones).some(z => z.alert_level === 'critical');
  const loaded = health?.models.filter(m => m.status === 'loaded').length ?? 0;
  const e2e = metrics.latencies?.e2e?.p95;

  const groups: { title: string; items: Item[] }[] = [
    {
      title: 'Monitor',
      items: [
        { to: '/', label: 'Command Center', icon: <LayoutDashboard /> },
        { to: '/live', label: 'Live Feeds', icon: <Video /> },
        {
          to: '/incidents', label: 'Incidents', icon: <Siren />,
          badge: open.length ? <span className={`nav-badge ${anyCritical ? 'alert' : 'warn'}`}>{open.length}</span> : null,
        },
      ],
    },
    {
      title: 'Configure',
      items: [
        { to: '/zones', label: 'Zones', icon: <Map /> },
        { to: '/devices', label: 'Devices', icon: <Radio />, badge: <span className="nav-badge">{active_sources}/{total_sources}</span> },
      ],
    },
    {
      title: 'Insights',
      items: [{ to: '/system', label: 'Performance', icon: <Activity /> }],
    },
  ];

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <SpectraWordmark />
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {groups.map(g => (
          <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div className="nav-section">{g.title}</div>
            {g.items.map(it => (
              <NavLink key={it.to} to={it.to} end={it.to === '/'} title={it.label}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                {it.icon}
                <span className="nav-label">{it.label}</span>
                {it.badge}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="health">
        <div className="card-label" style={{ marginBottom: 0 }}>System health</div>
        <div className="health-row">
          <span>Pipeline</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={`status-dot ${connected ? 'status-dot-online' : 'status-dot-error'}`} />
            <b>{connected ? 'Live' : 'Reconnecting'}</b>
          </span>
        </div>
        <div className="health-row"><span>AI models</span><b>{health ? `${loaded}/${health.models.length} loaded` : '—'}</b></div>
        <div className="health-row"><span>Latency p95</span><b className="num">{e2e != null ? `${Math.round(e2e)} ms` : '—'}</b></div>
        <div className="health-row" title={health?.copilot.last_error ?? ''}>
          <span>Co-pilot</span>
          <b style={{ color: health?.copilot.enabled ? undefined : 'var(--color-text-muted)' }}>
            {health ? (health.copilot.enabled ? health.copilot.provider_label : 'Offline') : '—'}
          </b>
        </div>
      </div>
      <button className="nav-item collapse-btn" onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        <span className="nav-label">Collapse</span>
      </button>
    </aside>
  );
}
