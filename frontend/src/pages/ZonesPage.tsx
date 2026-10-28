/**
 * Zones page — create/edit zones, assign sources, monitor live zone fusion states.
 */

import { useState, useEffect } from 'react';

interface ZoneSource {
  id: string;
  name: string;
  kind: string;
  adapter: string;
  status: string;
}

interface ZoneData {
  id: string;
  name: string;
  capacity: number;
  sources: ZoneSource[];
  source_count: number;
  risk_score: number;
  alert_level: 'normal' | 'elevated' | 'high' | 'critical';
  vision_score: number;
  motion_score: number;
  audio_score: number;
  created_at: number;
}

interface AvailableSource {
  id: string;
  name: string;
  kind: string;
  adapter: string;
  zone_id?: string;
}

export function ZonesPage() {
  const [zones, setZones] = useState<ZoneData[]>([]);
  const [sources, setSources] = useState<AvailableSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [capacity, setCapacity] = useState('50');
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchZonesAndSources = async () => {
    try {
      const [zonesRes, sourcesRes] = await Promise.all([
        fetch('/api/zones'),
        fetch('/api/sources'),
      ]);

      if (zonesRes.ok) {
        const zonesData = await zonesRes.json();
        setZones(Array.isArray(zonesData) ? zonesData : []);
      }
      if (sourcesRes.ok) {
        const sourcesData = await sourcesRes.json();
        setSources(Array.isArray(sourcesData) ? sourcesData : []);
      }
    } catch (err) {
      console.error('Failed to load zones or sources:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchZonesAndSources();
    const interval = setInterval(fetchZonesAndSources, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zoneName.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: zoneName.trim(),
          capacity: parseInt(capacity, 10) || 50,
          source_ids: selectedSources,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to create zone');
      }

      setZoneName('');
      setCapacity('50');
      setSelectedSources([]);
      setIsCreateOpen(false);
      await fetchZonesAndSources();
    } catch (err: any) {
      setError(err.message || 'Error creating zone');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteZone = async (zoneId: string) => {
    if (!confirm('Are you sure you want to remove this surveillance zone?')) return;

    try {
      const res = await fetch(`/api/zones/${zoneId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchZonesAndSources();
      }
    } catch (err) {
      console.error('Error deleting zone:', err);
    }
  };

  const toggleSourceSelection = (sourceId: string) => {
    setSelectedSources(prev =>
      prev.includes(sourceId) ? prev.filter(id => id !== sourceId) : [...prev, sourceId]
    );
  };

  const getAlertColor = (level: string) => {
    switch (level) {
      case 'critical': return 'var(--color-risk-critical)';
      case 'high': return 'var(--color-risk-high)';
      case 'elevated': return 'var(--color-risk-elevated)';
      default: return 'var(--color-risk-normal)';
    }
  };

  return (
    <div style={{ padding: '8px' }}>
      {/* Top action header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
            Zone Architect
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Group perimeter cameras, acoustic arrays, and sensors into unified spatial fusion cells.
          </p>
        </div>
        <button
          className="pill-btn pill-btn-primary"
          onClick={() => {
            setError(null);
            setIsCreateOpen(true);
          }}
          id="create-zone-btn"
          style={{
            background: 'var(--color-lavender)',
            color: 'var(--color-charcoal)',
            fontWeight: 600,
            padding: '10px 22px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 18, height: 18 }}>
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          <span>Create Zone</span>
        </button>
      </div>

      {/* Main zone cards grid */}
      {zones.length === 0 && !loading ? (
        <div className="card card-dark" style={{ minHeight: '380px' }}>
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 48, height: 48 }}>
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <line x1="12" y1="3" x2="12" y2="21" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
            <p style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--color-text-primary)' }}>No zones configured yet.</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              A zone groups cameras and microphones covering the same physical space.
              Create your first zone to begin spatial fusion monitoring.
            </p>
            <button
              className="pill-btn pill-btn-dark"
              style={{ marginTop: '12px', background: 'var(--color-lavender)', color: '#000', border: 'none', padding: '10px 20px', borderRadius: 999, cursor: 'pointer' }}
              onClick={() => setIsCreateOpen(true)}
            >
              Create Zone
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {zones.map(z => {
            const alertColor = getAlertColor(z.alert_level);
            return (
              <div key={z.id} className="card card-dark" style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                      ID: {z.id}
                    </span>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginTop: '2px' }}>{z.name}</h3>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '3px 10px',
                        borderRadius: '999px',
                        background: alertColor,
                        color: z.alert_level === 'normal' || z.alert_level === 'elevated' ? '#000' : '#fff',
                      }}
                    >
                      {z.alert_level}
                    </span>
                    <button
                      onClick={() => handleDeleteZone(z.id)}
                      title="Delete Zone"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                        padding: '4px',
                        borderRadius: '6px',
                      }}
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16 }}>
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Live risk score bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Fused Risk Index</span>
                    <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                      {Math.round(z.risk_score * 100)}%
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(0, z.risk_score * 100))}%`,
                        height: '100%',
                        background: alertColor,
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>

                {/* Multimodal break down */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', background: 'rgba(255,255,255,0.03)', padding: '10px', borderRadius: '12px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Vision</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                      {Math.round(z.vision_score * 100)}%
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.06)', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Motion</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                      {Math.round(z.motion_score * 100)}%
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Audio</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                      {Math.round(z.audio_score * 100)}%
                    </div>
                  </div>
                </div>

                {/* Capacity & Assigned sources */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}>
                    <span>Assigned Sensors:</span>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{z.source_count} Feeds</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {z.sources && z.sources.length > 0 ? (
                      z.sources.map(s => (
                        <span
                          key={s.id}
                          style={{
                            fontSize: '0.7rem',
                            background: 'rgba(255,255,255,0.08)',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.status === 'running' ? '#4ADE80' : '#888' }} />
                          {s.name}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        No sources currently bound to this zone
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Zone Modal */}
      {isCreateOpen && (
        <div className="dialog-overlay">
          <div className="card card-dark dialog-content" style={{ maxWidth: '480px' }}>
            <div className="card-label" style={{ marginBottom: '16px' }}>Create Surveillance Zone</div>

            {error && (
              <div style={{ color: '#EF4444', fontSize: '0.8rem', marginBottom: '12px', padding: '8px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleCreateZone} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="input-group">
                <div className="input-chip">Zone Name</div>
                <input
                  required
                  autoFocus
                  placeholder="e.g. North Gate Perimeter"
                  value={zoneName}
                  onChange={e => setZoneName(e.target.value)}
                  id="zone-name-input"
                />
              </div>

              <div className="input-group">
                <div className="input-chip">Max Capacity</div>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={capacity}
                  onChange={e => setCapacity(e.target.value)}
                  id="zone-capacity-input"
                />
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '8px', display: 'block', textTransform: 'uppercase' }}>
                  Assign Existing Sources to Zone
                </label>
                {sources.length === 0 ? (
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                    No sources currently registered. You can bind sources later from the Overview or Live Ops page.
                  </p>
                ) : (
                  <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '8px' }}>
                    {sources.map(s => {
                      const isSelected = selectedSources.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            padding: '4px 6px',
                            borderRadius: '4px',
                            background: isSelected ? 'rgba(157, 141, 247, 0.15)' : 'transparent',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSourceSelection(s.id)}
                          />
                          <span>{s.name} ({s.kind} / {s.adapter})</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button
                  type="button"
                  className="pill-btn pill-btn-dark"
                  style={{ flex: 1, padding: '10px', borderRadius: '999px', cursor: 'pointer' }}
                  onClick={() => setIsCreateOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="pill-btn pill-btn-primary"
                  id="submit-create-zone-btn"
                  style={{
                    flex: 1,
                    background: 'var(--color-cream)',
                    color: 'var(--color-charcoal)',
                    fontWeight: 600,
                    padding: '10px',
                    borderRadius: '999px',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {isSubmitting ? 'Creating...' : 'Create Zone'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
