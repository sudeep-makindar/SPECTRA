/**
 * AddSourceDialog — form to register a new source.
 * Calls POST /api/sources and returns the token (for browser nodes).
 */

import { useState } from 'react';

interface AddSourceDialogProps {
  onClose: () => void;
  onSourceAdded: () => void;
}

export function AddSourceDialog({ onClose, onSourceAdded }: AddSourceDialogProps) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('video');
  const [adapter, setAdapter] = useState('simulated');
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          kind,
          adapter,
          url: url || undefined,
          config: { fps: 5 },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to create source');
      }

      const data = await res.json();
      
      if (adapter === 'browser_node') {
        // Show token to user so they can connect their phone
        setCreatedToken(data.token);
      } else {
        onSourceAdded();
        onClose();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (createdToken) {
    return (
      <div className="dialog-overlay">
        <div className="card card-dark dialog-content" style={{ maxWidth: '400px' }}>
          <div className="card-label">Source Created</div>
          <h2 className="card-title-display" style={{ fontSize: '1.5rem', margin: '16px 0' }}>{name}</h2>
          
          <div style={{ marginBottom: '24px' }}>
            <p style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
              Connect your device to this node using the following URL and token:
            </p>
            <div className="input-group" style={{ marginBottom: '8px' }}>
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
      <div className="card card-dark dialog-content">
        <div className="card-label" style={{ marginBottom: '16px' }}>Add Source</div>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="input-group">
            <div className="input-chip">Name</div>
            <input 
              required 
              placeholder="e.g. Gate Cam 1" 
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
                <option value="simulated">Simulated (Demo)</option>
                <option value="file_loop">File Loop</option>
                <option value="webcam">Local Webcam</option>
                <option value="rtsp_http">RTSP / HTTP Stream</option>
                <option value="browser_node">Browser Node (Phone/Laptop)</option>
              </select>
            </div>
          </div>

          {(adapter === 'file_loop' || adapter === 'rtsp_http') && (
            <div className="input-group">
              <div className="input-chip">URL / Path</div>
              <input 
                required 
                placeholder={adapter === 'file_loop' ? '/path/to/video.mp4' : 'rtsp://...'} 
                value={url} 
                onChange={e => setUrl(e.target.value)} 
              />
            </div>
          )}

          {error && <div style={{ color: 'var(--color-error)', fontSize: '0.8rem' }}>{error}</div>}

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
