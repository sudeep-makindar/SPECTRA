/**
 * Device page (/node) — turns a phone or another laptop into a SPECTRA
 * camera, microphone and/or speaker, as chosen when it was added.
 *
 * Streams camera (JPEG, 5 fps) and microphone (PCM16) to the server over one
 * WebSocket. All AI runs on the server; nothing is stored on the device.
 * As a speaker it reads announcements aloud. When its zone alarms, the
 * screen turns red and the phone vibrates.
 */

import { useEffect, useRef, useState } from 'react';
import { SpectraLogo } from '../../components/Logo';
import { speakLocally } from '../speech';
import { LEVEL_WORD } from '../live';
import type { Level } from '../live';

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
  const name = params.get('name') ?? 'SPECTRA device';
  const capsParam = (params.get('caps') ?? 'video,audio').split(',');
  const wantVideo = capsParam.includes('video');
  const isSpeaker = capsParam.includes('speaker');
  const [withAudio, setWithAudio] = useState(capsParam.includes('audio'));
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState('');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [stats, setStats] = useState({ frames: 0, audioKb: 0 });
  const [zone, setZone] = useState<{ name: string | null; level: Level | null }>({ name: null, level: null });
  const [announcement, setAnnouncement] = useState<{ lang: string; text: string }[] | null>(null);

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
    if (!token) { setErr('Missing pairing code. Scan the QR code from the SPECTRA dashboard.'); return; }
    setErr('');
    setStatus('connecting');
    // Phones only allow speech that starts from a tap: speak once now, which
    // unlocks later announcements and proves the speaker works.
    if (isSpeaker) speakLocally([{ lang: 'en', text: 'Speaker ready' }]);
    try {
      let stream: MediaStream | null = null;
      if (wantVideo || withAudio) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: wantVideo ? { width: { ideal: 960 }, height: { ideal: 540 }, facingMode: facing } : false,
          audio: withAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: true } : false,
        });
        streamRef.current = stream;
        if (wantVideo && videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      }

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
          if (m.type === 'announce' && isSpeaker) {
            setAnnouncement(m.items);
            speakLocally(m.items);
            navigator.vibrate?.([200, 100, 200]);
          }
        } catch { /* ignore */ }
      };
      ws.onclose = ev => { if (wsRef.current === ws) { setStatus('error'); setErr(ev.code === 4001 ? 'This pairing code has expired. Add the device again.' : 'Connection lost.'); stop(false); } };

      ws.onopen = () => {
        setStatus('streaming');
        if (wantVideo) {
          timers.current.push(window.setInterval(() => {
            const v = videoRef.current, c = canvasRef.current;
            if (!v || !c || ws.readyState !== WebSocket.OPEN || !v.videoWidth) return;
            if (ws.bufferedAmount > 2_000_000) return; // slow network: skip this frame
            const scale = Math.min(1, 960 / v.videoWidth);
            c.width = v.videoWidth * scale;
            c.height = v.videoHeight * scale;
            c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
            c.toBlob(b => b?.arrayBuffer().then(buf => {
              ws.send(frame({ type: 'video', ts: Date.now() / 1000 }, buf));
              setStats(s => ({ ...s, frames: s.frames + 1 }));
            }), 'image/jpeg', 0.7);
          }, 200));
        }
        timers.current.push(window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' })), 1500));

        // Audio: PCM16 chunks of ~0.5 s at the device's native rate (server resamples)
        if (withAudio && stream?.getAudioTracks().length) {
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
      const msg = (e as Error).message || 'Could not start the camera';
      setErr(window.isSecureContext ? msg : `${msg}. Camera and mic need HTTPS: open the https:// link from the QR code.`);
      stop(false);
    }
  };

  const alarm = zone.level === 'high' || zone.level === 'critical';
  const roles = [wantVideo && 'camera', withAudio && 'microphone', isSpeaker && 'speaker'].filter(Boolean).join(', ');

  return (
    <div className={`node ${alarm ? 'alarm' : ''}`}>
      <div className="col" style={{ maxWidth: 520, margin: '0 auto', gap: 14 }}>
        <div className="row">
          <span className="logo"><span className="logo-mark"><SpectraLogo size={18} /></span>SPECTRA</span>
          <span className="grow" />
          <span className="tag">{name}</span>
        </div>

        {alarm && zone.level && (
          <div className="banner lv-critical">
            <span className="grow">{LEVEL_WORD[zone.level]} in {zone.name}. Check with the control room.</span>
          </div>
        )}

        {announcement && (
          <div className="panel col" style={{ gap: 10 }}>
            <span className="label">Announcement</span>
            {announcement.map((a, i) => <p key={i} style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.4 }}>{a.text}</p>)}
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => speakLocally(announcement)}>Play again</button>
          </div>
        )}

        {wantVideo && (
          <div className="tile">
            <div className="feed" style={{ aspectRatio: '4 / 3' }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {status !== 'streaming' && <div className="feed-empty">Camera is off</div>}
              {status === 'streaming' && <div className="feed-top"><span className="chip"><span className="rec" />SENDING</span>{zone.name && <span className="chip">{zone.name}</span>}</div>}
            </div>
          </div>
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {status === 'streaming' ? (
          <>
            <div className="panel row" style={{ justifyContent: 'space-between', padding: 16 }}>
              <span className="sm">{wantVideo ? `${stats.frames} pictures sent` : `Connected to ${zone.name ?? 'SPECTRA'}`}</span>
              {withAudio && <span className="sm">{Math.round(stats.audioKb)} KB of sound</span>}
              {isSpeaker && <span className="sm">Speaker ready</span>}
            </div>
            <button className="btn" onClick={() => stop()}>Stop</button>
          </>
        ) : (
          <div className="panel col" style={{ gap: 14 }}>
            <h2 className="panel-title" style={{ fontSize: 20 }}>Use this device as a {roles || 'sensor'}</h2>
            {!params.get('token') && (
              <input className="input" value={token} onChange={e => setToken(e.target.value)} placeholder="Paste the pairing code" />
            )}
            {wantVideo && capsParam.includes('audio') && (
              <label className="row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={withAudio} onChange={e => setWithAudio(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#F4F3F0' }} />
                Also send sound (to hear screams and calls for help)
              </label>
            )}
            {wantVideo && (
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                <button className={facing === 'environment' ? 'on' : ''} onClick={() => setFacing('environment')}>Back camera</button>
                <button className={facing === 'user' ? 'on' : ''} onClick={() => setFacing('user')}>Front camera</button>
              </div>
            )}
            {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
            <button className="btn btn-primary" disabled={status === 'connecting'} onClick={start}>{status === 'connecting' ? 'Connecting…' : 'Start'}</button>
            <p className="ink-3 xs" style={{ margin: 0 }}>
              Pictures and sound go only to the SPECTRA computer on this Wi-Fi. Nothing is saved on this device. Keep the screen on.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
