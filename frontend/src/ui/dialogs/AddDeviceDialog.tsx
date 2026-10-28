/**
 * Add device — four steps: what is it, what should it capture, where is it,
 * and a live test that shows it working before you leave.
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Camera, Check, Film, Laptop, Mic, MonitorSmartphone, Smartphone, Volume2, Webcam, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLive } from '../LiveContext';
import { Feed, MicBars } from '../parts';
import { api } from '../live';
import type { Capabilities } from '../live';

type DeviceType = 'webcam' | 'mic' | 'android' | 'laptop' | 'browser' | 'ip' | 'file';
type CaptureId = 'cam' | 'cam-mic' | 'cam-mic-spk' | 'mic' | 'spk';

const TYPES: { id: DeviceType; icon: ReactNode; title: string; body: string }[] = [
  { id: 'webcam', icon: <Webcam />, title: 'SPECTRA computer’s webcam', body: 'The camera built into the computer running SPECTRA.' },
  { id: 'mic', icon: <Mic />, title: 'SPECTRA computer’s microphone', body: 'The mic of the computer running SPECTRA.' },
  { id: 'android', icon: <Smartphone />, title: 'Android phone', body: 'Free “IP Webcam” app. Streams camera and mic, even with the screen off.' },
  { id: 'laptop', icon: <Laptop />, title: 'Another laptop', body: 'Any other laptop, including the one you’re using now: run the SPECTRA camera script on it.' },
  { id: 'browser', icon: <MonitorSmartphone />, title: 'Any phone, no app', body: 'Scan a QR code and stream from the browser. Can also be a speaker.' },
  { id: 'ip', icon: <Camera />, title: 'IP / CCTV camera', body: 'Any RTSP or HTTP video stream.' },
  { id: 'file', icon: <Film />, title: 'Recorded video', body: 'Loop a crowd video file from this computer.' },
];

const CAPTURES: Record<CaptureId, { title: string; body: string; caps: Capabilities; icon: ReactNode }> = {
  'cam-mic-spk': { title: 'Camera, mic and speaker', body: 'Sees, listens and plays announcements.', caps: { video: true, audio: true, speaker: true }, icon: <Laptop /> },
  'cam-mic': { title: 'Camera and mic', body: 'Sees and listens.', caps: { video: true, audio: true, speaker: false }, icon: <Camera /> },
  cam: { title: 'Camera only', body: 'Counts people and watches movement.', caps: { video: true, audio: false, speaker: false }, icon: <Camera /> },
  mic: { title: 'Microphone only', body: 'Listens for danger sounds and words.', caps: { video: false, audio: true, speaker: false }, icon: <Mic /> },
  spk: { title: 'Speaker only', body: 'Plays announcements for its zone.', caps: { video: false, audio: false, speaker: true }, icon: <Volume2 /> },
};

const OPTIONS: Record<DeviceType, CaptureId[]> = {
  webcam: ['cam-mic', 'cam'],
  mic: ['mic'],
  browser: ['cam-mic-spk', 'cam-mic', 'cam', 'mic', 'spk'],
  android: ['cam-mic', 'cam', 'mic'],
  laptop: ['cam-mic', 'cam', 'mic'],
  ip: ['cam'],
  file: ['cam'],
};

const DEFAULT_NAME: Record<DeviceType, string> = {
  webcam: 'Laptop webcam', mic: 'Laptop mic', android: 'Android phone', laptop: 'Laptop camera', browser: 'Phone', ip: 'CCTV camera', file: 'Recorded video',
};

/** Devices that stream like a network camera: SPECTRA pulls their video and audio. */
const NETWORK: Record<string, { port: number; video: string; audio: string; label: string; hint: string; help: string }> = {
  android: {
    port: 8080, video: '/video', audio: '/audio.wav',
    label: 'Phone’s IP address (shown at the bottom of the IP Webcam screen)', hint: '192.168.1.23',
    help: 'In IP Webcam, scroll to the bottom and tap “Start server”. Keep the app open.',
  },
  laptop: {
    port: 8081, video: '/stream', audio: '/audio',
    label: 'Address shown in the camera script window', hint: '192.168.1.30:8081',
    help: 'On that laptop, double-click “Start SPECTRA camera” in the tools folder.',
  },
};

/** "192.168.1.5", "192.168.1.5:8080" or "http://…" → "host:port". */
function hostPort(input: string, defaultPort: number): string {
  const a = input.trim().replace(/^\w+:\/\//, '').replace(/\/.*$/, '');
  if (!a) return '';
  return a.includes(':') ? a : `${a}:${defaultPort}`;
}

function Choice({ on, icon, title, body, onClick, disabled }: { on: boolean; icon: ReactNode; title: string; body: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className={`choice ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled}>
      <span className="choice-icon">{icon}</span>
      <span className="col"><b>{title}</b><span>{body}</span></span>
    </button>
  );
}

export function AddDeviceDialog() {
  const s = useLive();
  const close = () => s.openDialog(null);
  const [step, setStep] = useState(0);
  const [type, setType] = useState<DeviceType | null>(null);
  const [capture, setCapture] = useState<CaptureId | null>(null);
  const [name, setName] = useState('');
  const [zone, setZone] = useState(s.dialogContext.zoneId ?? s.zoneConfigs[0]?.id ?? '');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string[]>([]);
  const [pairing, setPairing] = useState<{ link: string; qr: string } | null>(null);
  const [startedAt, setStartedAt] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && s.openDialog(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  const pickType = (t: DeviceType) => {
    setType(t);
    setName(DEFAULT_NAME[t]);
    const opts = OPTIONS[t];
    setCapture(opts.length === 1 ? opts[0] : null);
    setStep(opts.length === 1 ? 2 : 1);
  };

  const network = NETWORK[type ?? ''];
  const needsAddress = !!network || type === 'ip' || type === 'file';
  const addressLabel = network?.label ?? (type === 'ip' ? 'Stream address' : 'Video file path on the SPECTRA computer');
  const addressHint = network?.hint ?? (type === 'ip' ? 'rtsp://192.168.1.20:554/stream' : '/Users/me/Videos/crowd.mp4');
  const host = network ? hostPort(address, network.port) : '';
  const streamUrl = network ? (host ? `http://${host}${network.video}` : '') : address.trim();

  const post = (body: Record<string, unknown>) =>
    api<{ id: string; token: string }>('/api/sources', { method: 'POST', json: { zone_id: zone, config: { fps: 5 }, ...body } });

  const connect = async () => {
    if (!type || !capture) return;
    setBusy(true);
    setError(null);
    const caps = CAPTURES[capture].caps;
    const label = name.trim() || DEFAULT_NAME[type];
    try {
      const ids: string[] = [];
      if (type === 'webcam') {
        ids.push((await post({ name: label, kind: 'video', adapter: 'webcam', config: { fps: 5, device_index: 0 }, capabilities: { ...caps, audio: false } })).id);
        if (caps.audio) ids.push((await post({ name: `${label} mic`, kind: 'audio', adapter: 'local_mic', capabilities: { video: false, audio: true, speaker: false } })).id);
      } else if (type === 'mic') {
        ids.push((await post({ name: label, kind: 'audio', adapter: 'local_mic', capabilities: caps })).id);
      } else if (type === 'browser') {
        const r = await post({ name: label, kind: caps.video ? 'video' : 'audio', adapter: 'browser_node', capabilities: caps });
        ids.push(r.id);
        let host = window.location.host;
        if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
          const net = await api<{ lan_ips: string[] }>('/api/network').catch(() => ({ lan_ips: [] as string[] }));
          if (net.lan_ips[0]) host = `${net.lan_ips[0]}:${window.location.port || '5173'}`;
        }
        const capsParam = [caps.video && 'video', caps.audio && 'audio', caps.speaker && 'speaker'].filter(Boolean).join(',');
        const link = `https://${host}/node?token=${r.token}&name=${encodeURIComponent(label)}&caps=${capsParam}`;
        setPairing({ link, qr: await QRCode.toDataURL(link, { margin: 1, width: 260 }) });
      } else if (network) {
        // Network camera, pulled like CCTV: video and mic are separate streams.
        if (!host) throw new Error('Enter the device’s IP address.');
        if (caps.video) ids.push((await post({ name: label, kind: 'video', adapter: 'rtsp_http', url: `http://${host}${network.video}`, capabilities: { ...caps, audio: false } })).id);
        if (caps.audio) ids.push((await post({ name: caps.video ? `${label} mic` : label, kind: 'audio', adapter: 'http_audio', url: `http://${host}${network.audio}`, capabilities: { video: false, audio: true, speaker: false } })).id);
      } else {
        if (!streamUrl) throw new Error(type === 'file' ? 'Enter the video file path.' : 'Enter the camera address.');
        ids.push((await post({ name: label, kind: 'video', adapter: type === 'file' ? 'file_loop' : 'rtsp_http', url: streamUrl, capabilities: caps })).id);
      }
      setCreated(ids);
      setStartedAt(Date.now());
      setStep(3);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const devices = s.sources.filter(x => created.includes(x.id));
  const allOnline = devices.length === created.length && devices.every(d => d.status === 'online');
  const slow = !allOnline && Date.now() - startedAt > 15000;
  const video = devices.find(d => d.kind === 'video');
  const zoneState = s.zones[zone];

  const cancelCreated = async () => {
    await Promise.all(created.map(id => api(`/api/sources/${id}`, { method: 'DELETE' }).catch(() => {})));
    close();
  };

  return (
    <div className="backdrop" onClick={close}>
      <div className="dialog" role="dialog" aria-label="Add a device" onClick={e => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">{['What are you adding?', 'What should it capture?', 'Name it and choose its zone', allOnline ? 'It’s working' : 'Connect and test'][step]}</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><X /></button>
        </div>
        <div className="steps-bar" aria-hidden="true">{[0, 1, 2, 3].map(i => <i key={i} className={i <= step ? 'on' : ''} />)}</div>

        {step === 0 && (
          <div className="choice-grid">
            {TYPES.map(t => <Choice key={t.id} on={type === t.id} icon={t.icon} title={t.title} body={t.body} onClick={() => pickType(t.id)} />)}
          </div>
        )}

        {step === 1 && type && (
          <>
            <div className="choice-grid">
              {OPTIONS[type].map(id => (
                <Choice key={id} on={capture === id} icon={CAPTURES[id].icon} title={CAPTURES[id].title} body={CAPTURES[id].body} onClick={() => { setCapture(id); setStep(2); }} />
              ))}
            </div>
            <div className="row"><button className="btn" onClick={() => setStep(0)}>Back</button></div>
          </>
        )}

        {step === 2 && type && capture && (
          <>
            <div className="row wrap">
              <span className="tag">{TYPES.find(t => t.id === type)?.title}</span>
              <span className="tag">{CAPTURES[capture].title}</span>
            </div>
            <label className="field">Name<input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus /></label>
            <label className="field">Zone
              <select className="input" value={zone} onChange={e => setZone(e.target.value)}>
                {s.zoneConfigs.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            {needsAddress && (
              <label className="field">{addressLabel}
                <input className="input mono" placeholder={addressHint} value={address} onChange={e => setAddress(e.target.value)} />
                {network && host && <span className="ink-3 xs mono">SPECTRA will read http://{host}{capture && CAPTURES[capture].caps.video ? network.video : network.audio}</span>}
                {network && <span className="ink-3 xs">{network.help}</span>}
              </label>
            )}
            {error && <div style={{ color: 'var(--danger)' }} className="sm">{error}</div>}
            <div className="row">
              <button className="btn" onClick={() => setStep(OPTIONS[type].length === 1 ? 0 : 1)}>Back</button>
              <span className="grow" />
              <button className="btn btn-primary" disabled={busy} onClick={connect}>{busy ? 'Connecting…' : type === 'browser' ? 'Create pairing code' : 'Connect'}</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            {pairing && !allOnline && (
              <div className="row wrap" style={{ gap: 20, alignItems: 'flex-start' }}>
                <img src={pairing.qr} alt="Pairing QR code" style={{ width: 210, height: 210, borderRadius: 16, background: '#fff', padding: 8 }} />
                <div className="col grow" style={{ gap: 10, minWidth: 220 }}>
                  <ol className="ink-2" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
                    <li>Same Wi-Fi as this computer</li>
                    <li>Scan with the phone camera, or open the link on the other laptop</li>
                    <li>Accept the certificate warning</li>
                    <li>Tap <b>Start</b> and allow camera and mic</li>
                  </ol>
                  <input className="input mono xs" readOnly value={pairing.link} onFocus={e => e.target.select()} />
                  <span className="ink-3 sm row"><span className="rec" /> Waiting for the device…</span>
                </div>
              </div>
            )}

            {video && (video.status === 'online' || !pairing) && (
              <div className="tile"><div className="feed"><Feed source={video} /></div></div>
            )}
            {!video && devices.some(d => d.kind === 'audio') && (
              <div className="panel row" style={{ padding: 18 }}>
                <Mic size={20} /><span className="grow">{devices.every(d => d.status === 'online') ? 'Listening' : 'Starting the microphone…'}</span>
                <MicBars level={zoneState?.audio.score ?? 0} active={devices.every(d => d.status === 'online')} n={20} />
              </div>
            )}

            {allOnline && <p className="row" style={{ margin: 0 }}><Check size={18} /> Connected. It now shows on the Surveillance page.</p>}
            {slow && !pairing && (
              <div className="sm ink-2">
                <b style={{ color: 'var(--watch)' }}>Not connected yet.</b>{' '}
                {network ? `Check the ${type === 'android' ? 'IP Webcam app is running (Start server)' : 'camera script window is open'}, it is on the same Wi-Fi, and the address is right. Opening http://${host}/ in this browser should show its page.`
                  : type === 'webcam' ? 'macOS may be asking for camera permission. Allow it for the terminal running SPECTRA.'
                  : 'Check the address is reachable from this computer.'}
              </div>
            )}
            <div className="row">
              {!allOnline && <button className="btn" onClick={cancelCreated}>Cancel</button>}
              <span className="grow" />
              <button className="btn btn-primary" onClick={close}>{allOnline ? 'Done' : 'Finish later'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
