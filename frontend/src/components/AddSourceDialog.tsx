/**
 * Connect Device — add sources in one click:
 *  - this Mac's camera / microphone
 *  - a phone (scan a QR code → /node streams camera + mic)
 *  - a video file or RTSP / IP-camera URL
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useSpectra } from '../context/SpectraContext';
import { api } from '../lib/types';

interface Props { onClose: () => void; onSourceAdded?: () => void }

type Tab = 'phone' | 'mac' | 'url';

export function AddSourceDialog({ onClose, onSourceAdded }: Props) {
  const { zone_configs, focusZone } = useSpectra();
  const [tab, setTab] = useState<Tab>('phone');
  const [zone, setZone] = useState(focusZone ?? zone_configs[0]?.id ?? '');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ link: string; qr: string; name: string } | null>(null);
  const [ips, setIps] = useState<string[]>([]);
  const [ip, setIp] = useState('');

  useEffect(() => {
    api<{ lan_ips: string[] }>('/api/network').then(r => { setIps(r.lan_ips); setIp(r.lan_ips[0] ?? window.location.hostname); }).catch(() => setIp(window.location.hostname));
  }, []);

  const create = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string; token: string; name: string }>('/api/sources', { method: 'POST', json: { zone_id: zone, config: { fps: 5 }, ...body } });
      onSourceAdded?.();
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const pairPhone = async () => {
    const n = name || `Phone ${Math.floor(Math.random() * 90 + 10)}`;
    const r = await create({ name: n, kind: 'video', adapter: 'browser_node' });
    if (!r) return;
    const host = ip && !['localhost', '127.0.0.1'].includes(window.location.hostname) ? window.location.host : `${ip}:${window.location.port || '5173'}`;
    const link = `https://${host}/node?token=${r.token}&name=${encodeURIComponent(n)}`;
    const qr = await QRCode.toDataURL(link, { margin: 1, width: 260, color: { dark: '#1B1B1F', light: '#F2F2EE' } });
    setPairing({ link, qr, name: n });
  };

  const addMac = async (what: 'cam' | 'mic') => {
    const r = what === 'cam'
      ? await create({ name: name || 'Mac Camera', kind: 'video', adapter: 'webcam', config: { fps: 5, device_index: 0 } })
      : await create({ name: name || 'Mac Microphone', kind: 'audio', adapter: 'local_mic' });
    if (r) onClose();
  };

  const addUrl = async () => {
    const isFile = !/^(rtsp|https?):\/\//i.test(url);
    const r = await create({ name: name || (isFile ? 'Recorded Video' : 'IP Camera'), kind: 'video', adapter: isFile ? 'file_loop' : 'rtsp_http', url });
    if (r) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card card-dark modal" onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          <div className="display" style={{ fontSize: '1.8rem' }}>Connect Device</div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          {(['phone', 'mac', 'url'] as Tab[]).map(t => (
            <button key={t} className={`btn ${tab === t ? 'btn-primary' : ''}`} onClick={() => { setTab(t); setPairing(null); }}>
              {t === 'phone' ? '📱 Phone' : t === 'mac' ? '💻 This Mac' : '🎞 Video / RTSP'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <select className="text-input" value={zone} onChange={e => setZone(e.target.value)} style={{ flex: 1 }}>
            {zone_configs.map(z => <option key={z.id} value={z.id}>Zone: {z.name}</option>)}
          </select>
          <input className="text-input" placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
        </div>

        {tab === 'phone' && !pairing && (
          <>
            <div className="muted" style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
              Generates a one-time token and a QR code. Scan it with a phone on the same Wi-Fi; the phone streams its camera and microphone, and all AI runs on this Mac.
            </div>
            {ips.length > 1 && (
              <select className="text-input" value={ip} onChange={e => setIp(e.target.value)}>
                {ips.map(x => <option key={x}>{x}</option>)}
              </select>
            )}
            <button className="btn btn-primary" disabled={busy} onClick={pairPhone}>Generate pairing QR</button>
          </>
        )}
        {tab === 'phone' && pairing && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <img src={pairing.qr} alt="Pairing QR code" style={{ width: 200, height: 200, borderRadius: 16 }} />
            <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <b>Scan with {pairing.name}</b>
              <div className="dim" style={{ fontSize: '0.74rem', lineHeight: 1.5 }}>
                1. Phone and Mac on the same Wi-Fi.<br />
                2. Accept the self-signed certificate warning (needed for camera access).<br />
                3. Tap <b>Start streaming</b>. The tile appears in Live Ops.
              </div>
              <input className="text-input mono" readOnly value={pairing.link} onFocus={e => e.target.select()} style={{ fontSize: '0.68rem' }} />
              <button className="btn" onClick={() => setPairing(null)}>Pair another phone</button>
            </div>
          </div>
        )}

        {tab === 'mac' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="scenario-btn" disabled={busy} onClick={() => addMac('cam')}>
              <b>Camera</b><span className="dim" style={{ fontSize: '0.72rem' }}>Built-in FaceTime camera at 5 fps → YOLO + optical flow</span>
            </button>
            <button className="scenario-btn" disabled={busy} onClick={() => addMac('mic')}>
              <b>Microphone</b><span className="dim" style={{ fontSize: '0.72rem' }}>16 kHz → AST threat classes + Whisper keywords</span>
            </button>
          </div>
        )}

        {tab === 'url' && (
          <>
            <input className="text-input mono" placeholder="/path/to/crowd.mp4  or  rtsp://…  or  http://phone:8080/video" value={url} onChange={e => setUrl(e.target.value)} />
            <button className="btn btn-primary" disabled={busy || !url} onClick={addUrl}>Add source</button>
          </>
        )}

        {error && <div style={{ color: 'var(--color-error)', fontSize: '0.78rem' }}>{error}</div>}
      </div>
    </div>
  );
}
