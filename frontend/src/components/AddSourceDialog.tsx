/**
 * AddSourceDialog — form to register a new source.
 * Calls POST /api/sources and returns the token (for browser nodes).
 */

import { useState, useEffect } from 'react';

interface AddSourceDialogProps {
  onClose: () => void;
  onSourceAdded: () => void;
}

interface ZoneOption {
  id: string;
  name: string;
}

export function AddSourceDialog({ onClose, onSourceAdded }: AddSourceDialogProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('video');
  const [adapter, setAdapter] = useState('simulated');
  const [url, setUrl] = useState('');
  const [deviceIndex, setDeviceIndex] = useState('0');
  const [zoneId, setZoneId] = useState<string>('');
  const [availableZones, setAvailableZones] = useState<ZoneOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/zones')
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        if (Array.isArray(data)) {
          setAvailableZones(data.map((z: any) => ({ id: z.id, name: z.name })));
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      let finalUrl = url.trim();
      let finalConfig: Record<string, any> = { fps: 5 };

      if (adapter === 'webcam') {
        finalConfig.device_index = parseInt(deviceIndex, 10) || 0;
      }

      if ((adapter === 'file_loop' || adapter === 'rtsp_http') && !finalUrl) {
        throw new Error(`Please provide a URL or path for ${adapter === 'file_loop' ? 'File Loop' : 'RTSP/HTTP stream'}`);
      }

      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          adapter,
          url: finalUrl || undefined,
          zone_id: zoneId || undefined,
          config: finalConfig,
        }),
      });

      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // text is plain string or HTML
      }

      if (!res.ok) {
        let msg = 'Failed to create source';
        if (data) {
          if (typeof data.detail === 'string') {
            msg = data.detail;
          } else if (Array.isArray(data.detail)) {
            msg = data.detail.map((d: any) => `${d.loc?.slice(1).join('.') || 'error'}: ${d.msg}`).join(', ');
          } else if (data.message) {
            msg = data.message;
          }
        } else if (text) {
          msg = text;
        } else {
          msg = `Server returned HTTP ${res.status}`;
        }
        throw new Error(msg);
      }

      if (adapter === 'browser_node') {
        setCreatedToken(data?.token || 'node-token');
      } else {
        onSourceAdded();
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add source');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (createdToken) {
    return (
      <div className="dialog-overlay">
        <div className="card card-dark dialog-content" style={{ maxWidth: '440px' }}>
          <div className="card-label">Source Created</div>
          <h2 className="card-title-display" style={{ fontSize: '1.5rem', margin: '16px 0' }}>{name}</h2>
          
          <div style={{ marginBottom: '24px' }}>
            <p style={{ fontSize: '0.85rem', marginBottom: '12px', color: 'var(--color-text-secondary)' }}>
              Connect your phone or remote laptop camera/mic directly over your local WiFi network:
            </p>
            <div className="input-group" style={{ marginBottom: '10px' }}>
              <div className="input-chip">URL</div>
              <input readOnly value={`${window.location.origin}/node`} />
            </div>
            <div className="input-group">
              <div className="input-chip">Token</div>
              <input readOnly value={createdToken} style={{ fontFamily: 'var(--font-mono)' }} />
            </div>
          </div>
          
          <button 
            className="pill-btn pill-btn-light" 
            style={{ width: '100%' }}
            onClick={() => {
              onSourceAdded();
              onClose();
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-overlay">
      <div className="card card-dark dialog-content" style={{ maxWidth: '520px' }}>
        <div className="card-label" style={{ marginBottom: '16px' }}>Add Perception Source</div>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="input-group">
            <div className="input-chip">Name</div>
            <input 
              required 
              placeholder="e.g. Gate Cam 2" 
              value={name} 
              onChange={e => setName(e.target.value)} 
            />
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="input-group" style={{ flex: 1 }}>
              <div className="input-chip">Kind</div>
              <select 
                value={kind} 
                onChange={e => setKind(e.target.value)}
                style={{ flex: 1, background: 'none', border: 'none', color: 'inherit', outline: 'none' }}
              >
                <option value="video">Video</option>
                <option value="audio">Audio</option>
              </select>
            </div>

            <div className="input-group" style={{ flex: 2 }}>
              <div className="input-chip">Adapter</div>
              <select 
                value={adapter} 
                onChange={e => setAdapter(e.target.value)}
                style={{ flex: 1, background: 'none', border: 'none', color: 'inherit', outline: 'none' }}
              >
                <option value="simulated">Simulated (Demo Scenarios)</option>
                <option value="webcam">Local Webcam</option>
                <option value="rtsp_http">RTSP / HTTP Camera Stream</option>
                <option value="file_loop">Video File Loop</option>
                <option value="browser_node">Browser Node (Phone/Laptop)</option>
              </select>
            </div>
          </div>

          {availableZones.length > 0 && (
            <div className="input-group">
              <div className="input-chip">Assign Zone</div>
              <select
                value={zoneId}
                onChange={e => setZoneId(e.target.value)}
                style={{ flex: 1, background: 'none', border: 'none', color: 'inherit', outline: 'none' }}
              >
                <option value="">Default / Unassigned</option>
                {availableZones.map(z => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            </div>
          )}

          {adapter === 'webcam' && (
            <div className="input-group">
              <div className="input-chip">Device Index</div>
              <input 
                type="number" 
                min="0" 
                max="10" 
                value={deviceIndex} 
                onChange={e => setDeviceIndex(e.target.value)}
                placeholder="0 = default webcam, 1 = USB camera" 
              />
            </div>
          )}

          {adapter === 'file_loop' && (
            <div>
              <div className="input-group">
                <div className="input-chip">File Path</div>
                <input 
                  required 
                  placeholder="data/test_loop.mp4" 
                  value={url} 
                  onChange={e => setUrl(e.target.value)} 
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Tip: Use <code>data/test_loop.mp4</code> or any local <code>.mp4</code> video file path.
              </div>
            </div>
          )}

          {adapter === 'rtsp_http' && (
            <div>
              <div className="input-group">
                <div className="input-chip">Stream URL</div>
                <input 
                  required 
                  placeholder="http://192.168.1.50:8080/video or rtsp://..." 
                  value={url} 
                  onChange={e => setUrl(e.target.value)} 
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Format: <code>rtsp://&lt;ip&gt;:&lt;port&gt;/h264</code> or for phone apps (like IP Webcam) <code>http://&lt;ip&gt;:&lt;port&gt;/video</code>
              </div>
            </div>
          )}

          {adapter === 'browser_node' && (
            <div style={{ fontSize: '0.8rem', color: 'var(--color-lavender-light)', padding: '6px 0' }}>
              Connects directly to any mobile phone or computer via browser without installing an app.
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--color-error)', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', padding: '8px 12px', borderRadius: '8px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button 
              type="button" 
              className="pill-btn pill-btn-outlined" 
              style={{ flex: 1 }}
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="pill-btn pill-btn-light" 
              style={{ flex: 1 }}
              disabled={isSubmitting || !name}
            >
              {isSubmitting ? 'Adding...' : 'Add Source'}
            </button>
          </div>
        </form>
      </div>
      <style>{`
        .dialog-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          backdrop-filter: blur(4px);
        }
        .dialog-content {
          width: 100%;
          max-width: 500px;
          margin: 16px;
          animation: modal-pop var(--duration-fast) var(--ease-out);
        }
        @keyframes modal-pop {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
