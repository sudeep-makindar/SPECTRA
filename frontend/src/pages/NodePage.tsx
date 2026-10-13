/**
 * Browser Node — turns a phone into a SPECTRA sensor *and* a steward pager.
 *
 * Streams camera (JPEG, 5 fps) and microphone (PCM16) to the server over one
 * WebSocket. All AI runs on the server; nothing is stored on the phone.
 * It also polls its zone's alert level: when the zone goes HIGH/CRITICAL the
 * screen turns red and the phone vibrates.
 */

import { useEffect, useRef, useState } from 'react';
import { SpectraWordmark } from '../components/Logo';

type Status = 'idle' | 'connecting' | 'streaming' | 'error';

function frame(header: object, payload: ArrayBuffer): ArrayBuffer {
  const h = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(4 + h.length + payload.byteLength);
  new DataView(out.buffer).setUint32(0, h.length, false);
  out.set(h, 4);
  out.set(new Uint8Array(payload), 4 + h.length);
  return out.buffer;
}

export function NodePage() {
  const params = new URLSearchParams(window.location.search);
  const [token, setToken] = useState(params.get('token') ?? '');
  const name = params.get('name') ?? 'Spectra Node';
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState('');
  const [withAudio, setWithAudio] = useState(true);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [stats, setStats] = useState({ frames: 0, audioKb: 0 });
  const [zone, setZone] = useState<{ name: string | null; level: string | null }>({ name: null, level: null });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timers = useRef<number[]>([]);
  const lastLevel = useRef<string | null>(null);

  const stop = (user = true) => {
    timers.current.forEach(t => clearInterval(t));
    timers.current = [];
    wsRef.current?.close();
    wsRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (user) setStatus('idle');
  };
  useEffect(() => () => stop(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (!token) { setErr('Missing token. Scan the QR code from the SPECTRA dashboard.'); return; }
    setErr('');
    setStatus('connecting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: facing },
        audio: withAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: true } : false,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/node?token=${encodeURIComponent(token)}`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = ev => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === 'pong') {
            setZone({ name: m.zone, level: m.level });
            if ((m.level === 'high' || m.level === 'critical') && lastLevel.current !== m.level) navigator.vibrate?.([300, 120, 300, 120, 600]);
            lastLevel.current = m.level;
          }
        } catch { /* ignore */ }
      };
      ws.onclose = ev => { if (wsRef.current === ws) { setStatus('error'); setErr(ev.code === 4001 ? 'Invalid or expired token.' : 'Connection closed.'); stop(false); } };

      ws.onopen = () => {
        setStatus('streaming');
        // Video: 5 fps JPEG
        timers.current.push(window.setInterval(() => {
          const v = videoRef.current, c = canvasRef.current;
          if (!v || !c || ws.readyState !== WebSocket.OPEN || !v.videoWidth) return;
          if (ws.bufferedAmount > 2_000_000) return; // network backpressure: skip frame
          const scale = Math.min(1, 960 / v.videoWidth);
          c.width = v.videoWidth * scale;
          c.height = v.videoHeight * scale;
          c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
          c.toBlob(b => b?.arrayBuffer().then(buf => {
            ws.send(frame({ type: 'video', ts: Date.now() / 1000 }, buf));
            setStats(s => ({ ...s, frames: s.frames + 1 }));
          }), 'image/jpeg', 0.7);
        }, 200));
        // Zone status ping
        timers.current.push(window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' })), 1500));

        // Audio: PCM16 chunks of ~0.5 s at the device's native rate (server resamples)
        if (withAudio && stream.getAudioTracks().length) {
          const ctx = new AudioContext();
          audioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const proc = ctx.createScriptProcessor(4096, 1, 1);
          let acc: Float32Array[] = [];
          let n = 0;
          proc.onaudioprocess = e => {
            const d = e.inputBuffer.getChannelData(0);
            acc.push(new Float32Array(d));
            n += d.length;
            if (n >= ctx.sampleRate * 0.5 && ws.readyState === WebSocket.OPEN) {
              const pcm = new Int16Array(n);
              let o = 0;
              for (const a of acc) for (let i = 0; i < a.length; i++) pcm[o++] = Math.max(-1, Math.min(1, a[i])) * 0x7fff;
              ws.send(frame({ type: 'audio', ts: Date.now() / 1000, sample_rate: ctx.sampleRate }, pcm.buffer));
              setStats(s => ({ ...s, audioKb: s.audioKb + pcm.byteLength / 1024 }));
              acc = [];
              n = 0;
            }
          };
          src.connect(proc);
          const sink = ctx.createGain();
          sink.gain.value = 0;
          proc.connect(sink).connect(ctx.destination);
        }
      };
    } catch (e) {
      setStatus('error');
      const msg = (e as Error).message || 'Could not start camera';
      setErr(window.isSecureContext ? msg : `${msg}. Camera needs HTTPS: open the https:// link from the QR code.`);
      stop(false);
    }
  };

  const alarm = zone.level === 'high' || zone.level === 'critical';
  return (
    <div className={`node-page ${alarm ? `alarm-${zone.level}` : ''}`}>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SpectraWordmark subtitle="Sensor node" />
          <span className="tag">{name}</span>
        </div>

        {alarm && (
          <div className={`alert-banner ${zone.level === 'critical' ? '' : 'high'}`}>
            <span className={`level-pill level-${zone.level}`}>{zone.level}</span>
            <div><div className="alert-banner-title">{zone.name}</div><div className="alert-banner-sub">Check the control room for instructions.</div></div>
          </div>
        )}

        <div className="camera-wrap" style={{ aspectRatio: '4 / 3' }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          {status !== 'streaming' && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="dim">Camera off</div>}
          {status === 'streaming' && (
            <div className="camera-overlay-top">
              <span className="badge badge-live">Live</span>
              <span style={{ fontSize: '0.72rem', color: '#fff' }}>{zone.name ? `Zone: ${zone.name}` : ''}</span>
            </div>
          )}
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {status === 'streaming' ? (
          <>
            <div className="card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem' }}>
              <span>📷 {stats.frames} frames</span>
              <span>🎙 {withAudio ? `${Math.round(stats.audioKb)} KB` : 'off'}</span>
              <span className={`level-pill level-${zone.level ?? 'normal'}`}>{zone.level ?? '—'}</span>
            </div>
            <button className="btn btn-block" onClick={() => stop()}>Stop streaming</button>
          </>
        ) : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!params.get('token') && (
              <label className="field">Pairing token<input className="text-input mono" value={token} onChange={e => setToken(e.target.value)} placeholder="Paste token" /></label>
            )}
            <label style={{ display: 'flex', gap: 8, fontSize: '0.85rem', alignItems: 'center' }}>
              <input type="checkbox" checked={withAudio} onChange={e => setWithAudio(e.target.checked)} style={{ accentColor: '#4F8DF7' }} /> Stream microphone (scream / keyword detection)
            </label>
            <div className="segmented" style={{ alignSelf: 'flex-start' }}>
              <button className={facing === 'environment' ? 'on' : ''} onClick={() => setFacing('environment')}>Rear camera</button>
              <button className={facing === 'user' ? 'on' : ''} onClick={() => setFacing('user')}>Front camera</button>
            </div>
            {err && <div style={{ color: 'var(--color-error)', fontSize: '0.82rem' }}>{err}</div>}
            <button className="btn btn-primary btn-block" style={{ padding: '11px 14px' }} disabled={status === 'connecting'} onClick={start}>
              {status === 'connecting' ? 'Connecting…' : 'Start streaming'}
            </button>
            <div className="dim" style={{ fontSize: '0.7rem', lineHeight: 1.5 }}>
              Video and audio go only to the SPECTRA server on your local network. Nothing is stored on this phone. Keep the screen on while streaming.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
