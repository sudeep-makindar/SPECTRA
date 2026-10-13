/**
 * Connect device — add a sensor in one step:
 *  - this Mac's camera / microphone
 *  - a phone (scan a QR code → /node streams camera + mic)
 *  - a video file or RTSP / IP-camera URL
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Camera, Link, Mic, Smartphone, X } from 'lucide-react';
import { useSpectra } from '../context/SpectraContext';
import { api } from '../lib/types';

export type ConnectTab = 'phone' | 'mac' | 'url';

interface Props { onClose: () => void; initialTab?: ConnectTab }

export function AddSourceDialog({ onClose, initialTab = 'phone' }: Props) {
  const { zone_configs, focusZone } = useSpectra();
  const [tab, setTab] = useState<ConnectTab>(initialTab);
  const [zone, setZone] = useState(focusZone ?? zone_configs[0]?.id ?? '');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ link: string; qr: string; name: string } | null>(null);
  const [ips, setIps] = useState<string[]>([]);
  const [ip, setIp] = useState('');

  useEffect(() => {
    api<{ lan_ips: string[] }>('/api/network')
      .then(r => { setIps(r.lan_ips); setIp(r.lan_ips[0] ?? window.location.hostname); })
      .catch(() => setIp(window.location.hostname));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      return await api<{ id: string; token: string; name: string }>('/api/sources', { method: 'POST', json: { zone_id: zone, config: { fps: 5 }, ...body } });
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
    const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const host = local ? `${ip}:${window.location.port || '5173'}` : window.location.host;
    const link = `https://${host}/node?token=${r.token}&name=${encodeURIComponent(n)}`;
    const qr = await QRCode.toDataURL(link, { margin: 1, width: 240, color: { dark: '#0A0E13', light: '#FFFFFF' } });
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
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal-wrap" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Connect device" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card-head" style={{ marginBottom: 0 }}>
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>Connect a device</div>
              <div className="dim" style={{ fontSize: '0.78rem', marginTop: 2 }}>All AI runs on this machine. Feeds never leave the local network.</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X /></button>
          </div>

          <div className="segmented">
            <button className={tab === 'phone' ? 'on' : ''} onClick={() => { setTab('phone'); setPairing(null); }}><Smartphone size={15} /> Phone</button>
            <button className={tab === 'mac' ? 'on' : ''} onClick={() => setTab('mac')}><Camera size={15} /> This Mac</button>
            <button className={tab === 'url' ? 'on' : ''} onClick={() => setTab('url')}><Link size={15} /> Stream / file</button>
          </div>

          <div className="field-row">
            <label className="field">Zone
              <select className="select" value={zone} onChange={e => setZone(e.target.value)}>
                {zone_configs.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            <label className="field">Name
              <input className="text-input" placeholder="Optional" value={name} onChange={e => setName(e.target.value)} />
            </label>
          </div>

          {tab === 'phone' && !pairing && (
            <>
              <p className="muted" style={{ fontSize: '0.8rem', lineHeight: 1.55 }}>
                Creates a one-time pairing link. The phone streams its camera and microphone and becomes a steward pager: its screen turns red and it vibrates when its zone alarms.
              </p>
              {ips.length > 1 && (
                <label className="field">Network interface
                  <select className="select" value={ip} onChange={e => setIp(e.target.value)}>{ips.map(x => <option key={x}>{x}</option>)}</select>
                </label>
              )}
              <button className="btn btn-primary" disabled={busy || !zone} onClick={pairPhone}>Generate pairing QR code</button>
            </>
          )}
          {tab === 'phone' && pairing && (
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              <img src={pairing.qr} alt="Pairing QR code" style={{ width: 180, height: 180, borderRadius: 10, background: '#fff', padding: 6 }} />
              <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <b style={{ fontWeight: 600 }}>Scan with {pairing.name}</b>
                <ol className="muted" style={{ fontSize: '0.78rem', lineHeight: 1.6, paddingLeft: 16 }}>
                  <li>Phone on the same Wi-Fi as this Mac</li>
                  <li>Accept the certificate warning (needed for camera access)</li>
                  <li>Tap <b>Start streaming</b></li>
                </ol>
                <input className="text-input mono" readOnly value={pairing.link} onFocus={e => e.target.select()} style={{ fontSize: '0.7rem' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={() => setPairing(null)}>Pair another</button>
                  <button className="btn btn-primary" onClick={onClose}>Done</button>
                </div>
              </div>
            </div>
          )}

          {tab === 'mac' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="option-card" disabled={busy} onClick={() => addMac('cam')}>
                <b style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Camera size={16} /> Camera</b>
                <span>Built-in camera at 5 fps → person tracking + optical flow</span>
              </button>
              <button className="option-card" disabled={busy} onClick={() => addMac('mic')}>
                <b style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Mic size={16} /> Microphone</b>
                <span>16 kHz → scream / gunshot classes + distress keywords</span>
              </button>
            </div>
          )}

          {tab === 'url' && (
            <>
              <label className="field">RTSP / HTTP stream or a video file path on this Mac
                <input className="text-input mono" placeholder="rtsp://…  ·  http://phone:8080/video  ·  /Users/me/crowd.mp4" value={url} onChange={e => setUrl(e.target.value)} />
              </label>
              <button className="btn btn-primary" disabled={busy || !url} onClick={addUrl}>Add source</button>
            </>
          )}

          {error && <div style={{ color: 'var(--color-error)', fontSize: '0.8rem' }}>{error}</div>}
        </div>
      </div>
    </>
  );
}
