/**
 * Devices — every sensor in one table: health, throughput, zone assignment.
 */

import { useState } from 'react';
import { Camera, Link, Mic, Smartphone, Trash2 } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import { AddSourceDialog } from '../components/AddSourceDialog';
import type { ConnectTab } from '../components/AddSourceDialog';
import { api } from '../lib/types';
import type { SourceState } from '../lib/types';

const TYPE_LABEL: Record<string, string> = {
  webcam: 'Mac camera', local_mic: 'Mac microphone', browser_node: 'Phone node',
  rtsp_http: 'IP camera', file_loop: 'Recorded video', simulated: 'Simulated',
};

function statusClass(s: SourceState) {
  return s.status === 'online' ? 'online' : s.status === 'degraded' ? 'degraded' : s.status === 'error' ? 'error' : 'offline';
}

export function DevicesPage() {
  const { sources, zone_configs } = useSpectra();
  const [connect, setConnect] = useState<ConnectTab | null>(null);

  const assign = (id: string, zone_id: string) => api(`/api/sources/${id}`, { method: 'PATCH', json: { zone_id } });
  const remove = (s: SourceState) => { if (confirm(`Remove ${s.name}?`)) api(`/api/sources/${s.id}`, { method: 'DELETE' }); };

  const options: { tab: ConnectTab; icon: React.ReactNode; title: string; body: string }[] = [
    { tab: 'phone', icon: <Smartphone size={18} />, title: 'Pair a phone', body: 'Scan a QR code. Streams camera + mic and acts as a steward pager.' },
    { tab: 'mac', icon: <Camera size={18} />, title: 'This Mac', body: 'Built-in camera and microphone, one click each.' },
    { tab: 'url', icon: <Link size={18} />, title: 'IP camera or video', body: 'RTSP / HTTP stream, or loop a recorded crowd video.' },
  ];

  return (
    <>
      {connect && <AddSourceDialog initialTab={connect} onClose={() => setConnect(null)} />}
      <div className="grid-12">
        {options.map(o => (
          <button key={o.tab} className="option-card span-4" onClick={() => setConnect(o.tab)} style={{ padding: 16 }}>
            <b style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="kpi-icon" style={{ color: 'var(--color-accent)' }}>{o.icon}</span>{o.title}</b>
            <span>{o.body}</span>
          </button>
        ))}

        <div className="card span-12" style={{ padding: 0 }}>
          <div className="card-head" style={{ padding: '16px 18px 0' }}>
            <div className="card-title">Connected devices <span className="sub">{sources.length} total</span></div>
          </div>
          {sources.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr><th style={{ paddingLeft: 18 }}>Device</th><th>Type</th><th>Zone</th><th>Status</th><th>Input fps</th><th>AI fps</th><th>Skipped</th><th>Last seen</th><th /></tr>
                </thead>
                <tbody>
                  {sources.map(s => (
                    <tr key={s.id}>
                      <td style={{ paddingLeft: 18 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="kpi-icon">{s.kind === 'audio' ? <Mic /> : s.adapter === 'browser_node' ? <Smartphone /> : <Camera />}</span>
                          <div><div style={{ fontWeight: 500 }}>{s.name}</div><div className="dim mono" style={{ fontSize: '0.68rem' }}>{s.id}</div></div>
                        </div>
                      </td>
                      <td className="muted">{TYPE_LABEL[s.adapter] ?? s.adapter}{s.has_audio && s.kind === 'video' ? ' · +mic' : ''}</td>
                      <td>
                        <select className="select select-sm" value={s.zone_id ?? ''} onChange={e => assign(s.id, e.target.value)}>
                          {zone_configs.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                        </select>
                      </td>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textTransform: 'capitalize' }}><span className={`status-dot status-dot-${statusClass(s)}`} />{s.status}</span></td>
                      <td className="num">{s.fps}</td>
                      <td className="num">{s.kind === 'audio' ? '—' : s.inference_fps}</td>
                      <td className="num">{s.skipped_frames}</td>
                      <td className="num dim">{s.last_seen_age_s != null ? `${s.last_seen_age_s.toFixed(0)}s ago` : 'never'}</td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => remove(s)} aria-label={`Remove ${s.name}`}><Trash2 /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state"><Camera /><h3>No devices yet</h3><p>Choose one of the options above to add your first camera, microphone or phone.</p></div>
          )}
          <div className="dim" style={{ fontSize: '0.72rem', padding: '0 18px 14px' }}>
            Backpressure: each camera has one inference in flight and newer frames win, so latency stays flat under load and the overflow shows up as “skipped”.
          </div>
        </div>
      </div>
    </>
  );
}
