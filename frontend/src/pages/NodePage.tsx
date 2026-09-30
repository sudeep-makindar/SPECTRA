/**
 * Browser Node Page
 *
 * This page runs on a smartphone or remote laptop. It asks for camera/mic
 * permissions and streams data back to the Spectra server via WebSocket.
 */

import { useEffect, useRef, useState } from 'react';

export function NodePage() {
  const [token, setToken] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'streaming' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const loopRef = useRef<number>();

  // Check URL for token on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (t) setToken(t);
  }, []);

  const startStreaming = async () => {
    if (!token) {
      setErrorMsg('Token is required');
      return;
    }

    try {
      setStatus('connecting');
      
      // 1. Get camera
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' },
        audio: false // Phase 1: video only for browser nodes to keep it simple, audio in Phase 2
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // 2. Connect WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/node?token=${token}`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('streaming');
        // Start capture loop (5 fps)
        const captureInterval = 1000 / 5;
        
        const captureFrame = () => {
          if (ws.readyState === WebSocket.OPEN && videoRef.current && canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) {
              canvasRef.current.width = videoRef.current.videoWidth;
              canvasRef.current.height = videoRef.current.videoHeight;
              ctx.drawImage(videoRef.current, 0, 0);
              
              // Convert to JPEG
              canvasRef.current.toBlob((blob) => {
                if (blob) {
                  blob.arrayBuffer().then(buffer => {
                    // Binary protocol: [4 bytes header len] [header JSON] [payload]
                    const headerStr = JSON.stringify({ type: 'video', ts: Date.now() / 1000 });
                    const headerBytes = new TextEncoder().encode(headerStr);
                    
                    const out = new Uint8Array(4 + headerBytes.length + buffer.byteLength);
                    // Write length (BE)
                    const view = new DataView(out.buffer);
                    view.setUint32(0, headerBytes.length, false);
                    
                    out.set(headerBytes, 4);
                    out.set(new Uint8Array(buffer), 4 + headerBytes.length);
                    
                    ws.send(out.buffer);
                  });
                }
              }, 'image/jpeg', 0.6);
            }
          }
          loopRef.current = window.setTimeout(captureFrame, captureInterval);
        };
        
        captureFrame();
      };

      ws.onclose = () => {
        setStatus('error');
        setErrorMsg('Connection closed');
        stopStreaming(false);
      };

      ws.onerror = () => {
        setStatus('error');
        setErrorMsg('WebSocket error');
      };

    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Failed to start camera');
    }
  };

  const stopStreaming = (userInitiated = true) => {
    if (userInitiated) setStatus('idle');
    
    if (loopRef.current) clearTimeout(loopRef.current);
    if (wsRef.current) wsRef.current.close();
    
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopStreaming(false);
  }, []);

  return (
    <div style={{ padding: '24px', maxWidth: '600px', margin: '0 auto' }}>
      <h1 className="card-title-display" style={{ marginBottom: '8px' }}>Spectra Node</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
        Stream camera data from this device to the Spectra server.
      </p>

      {status === 'idle' || status === 'error' ? (
        <div className="card card-dark">
          <div className="input-group">
            <div className="input-chip">Token</div>
            <input 
              value={token} 
              onChange={e => setToken(e.target.value)} 
              placeholder="Paste token here"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          
          {errorMsg && (
            <div style={{ color: 'var(--color-error)', margin: '16px 0', fontSize: '0.9rem' }}>
              {errorMsg}
              {errorMsg.includes('camera') && window.location.protocol !== 'https:' && (
                <div style={{ marginTop: '8px', color: 'var(--color-text-muted)' }}>
                  Note: Browsers block camera access on non-HTTPS connections (unless localhost).
                </div>
              )}
            </div>
          )}

          <button 
            className="pill-btn pill-btn-light" 
            style={{ width: '100%', marginTop: '16px' }}
            onClick={startStreaming}
            disabled={!token}
          >
            Start Streaming
          </button>
        </div>
      ) : (
        <div className="card card-dark" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className={`status-dot ${status === 'streaming' ? '' : 'status-dot-offline'}`} 
                    style={{ background: status === 'streaming' ? 'var(--color-online)' : undefined }} />
              <span style={{ fontWeight: 600 }}>
                {status === 'connecting' ? 'Connecting...' : 'Live Streaming'}
              </span>
            </div>
          </div>
          
          <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#000', borderRadius: 'var(--radius-card)', overflow: 'hidden' }}>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
          
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          <button 
            className="pill-btn pill-btn-outlined" 
            style={{ width: '100%' }}
            onClick={() => stopStreaming()}
          >
            Stop Streaming
          </button>
        </div>
      )}
    </div>
  );
}
