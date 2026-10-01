import { useEffect, useState } from 'react';
import { X, PlayCircle, Clock, Video } from 'lucide-react';

interface IncidentInfo {
  id: string;
  zone_id: string;
  source_id: string;
  timestamp: number;
  filename: string;
  size_mb: number;
  url: string;
}

interface Props {
  onClose: () => void;
}

export function IncidentReplayModal({ onClose }: Props) {
  const [incidents, setIncidents] = useState<IncidentInfo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchIncidents = async () => {
      try {
        const url = `${window.location.protocol}//${window.location.host}/api/incidents/`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setIncidents(data);
        }
      } catch (err) {
        console.error("Failed to fetch incidents:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchIncidents();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative flex flex-col w-full max-w-4xl max-h-[85vh] bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-[24px] shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--color-lavender)]/20 flex items-center justify-center text-[var(--color-lavender)]">
              <PlayCircle size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold font-display uppercase tracking-wider text-[var(--color-text-primary)]">Incident Replay</h2>
              <p className="text-xs text-[var(--color-text-secondary)]">Review automatically captured 15s evidence clips.</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[var(--color-surface-overlay)] transition-colors text-[var(--color-text-secondary)]"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* List */}
          <div className="w-1/3 border-r border-[var(--color-border-subtle)] overflow-y-auto p-4 flex flex-col gap-2">
            {loading ? (
              <div className="text-center text-[var(--color-text-secondary)] py-8 text-sm">Loading evidence...</div>
            ) : incidents.length === 0 ? (
              <div className="text-center py-8 text-[var(--color-text-muted)]">
                <div className="flex justify-center mb-3">
                  <Video size={24} className="opacity-20" />
                </div>
                <p className="text-sm">No incidents recorded yet.</p>
              </div>
            ) : (
              incidents.map(inc => (
                <button
                  key={inc.id}
                  onClick={() => setSelectedVideo(inc.url)}
                  className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all ${
                    selectedVideo === inc.url 
                      ? 'bg-[var(--color-lavender)]/10 border-[var(--color-lavender)]' 
                      : 'bg-[var(--color-surface-overlay)] border-transparent hover:border-[var(--color-border)]'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-semibold text-sm text-[var(--color-text-primary)]">{inc.zone_id}</span>
                    <span className="text-[10px] uppercase font-bold text-[var(--color-critical)] px-2 py-0.5 rounded-full bg-[var(--color-critical)]/10">Critical</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] mt-1">
                    <Clock size={12} />
                    {new Date(inc.timestamp * 1000).toLocaleTimeString()}
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] mt-1 truncate">
                    Source: {inc.source_id} | {inc.size_mb} MB
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Player */}
          <div className="flex-1 bg-black p-6 flex items-center justify-center relative">
            {selectedVideo ? (
              <div className="w-full h-full flex flex-col relative group rounded-lg overflow-hidden border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
                <video 
                  src={selectedVideo} 
                  controls 
                  autoPlay
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <PlayCircle size={48} className="mb-4 opacity-20" />
                <p className="text-sm">Select an incident from the timeline to replay evidence.</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
