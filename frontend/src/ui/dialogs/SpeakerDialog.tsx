/**
 * Speaker — make this computer play announcements for one zone, or all.
 * Shows which languages this computer can say aloud, and lets you test it.
 */

import { useEffect, useState } from 'react';
import { Check, Volume2, X } from 'lucide-react';
import { useLive } from '../LiveContext';
import { LANGS, hasVoice, speakLocally, useVoices } from '../speech';

const TEST: Record<string, string> = {
  en: 'This is a SPECTRA speaker test.',
  hi: 'यह स्पेक्ट्रा स्पीकर की जाँच है।',
  ta: 'இது ஸ்பெக்ட்ரா ஒலிபெருக்கி சோதனை.',
};

export function SpeakerDialog() {
  const s = useLive();
  const close = () => s.openDialog(null);
  const voices = useVoices();
  const [name, setName] = useState(s.speaker.name);
  const [zone, setZone] = useState(s.speaker.zone);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && s.openDialog(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  const save = (enabled: boolean) => s.setSpeaker({ enabled, zone, name: name.trim() || 'Control room' });
  const isWindows = navigator.userAgent.includes('Windows');
  const isEdge = navigator.userAgent.includes('Edg/');

  return (
    <div className="backdrop" onClick={close}>
      <div className="dialog" role="dialog" aria-label="Use this computer as a speaker" onClick={e => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">Use this computer as a speaker</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><X /></button>
        </div>
        <p className="ink-2" style={{ margin: 0 }}>
          Announcements for the chosen zone are read aloud here, in every language they are sent in. Keep this page open, and turn the volume up.
        </p>

        <div className="row wrap" style={{ gap: 12 }}>
          <label className="field grow" style={{ minWidth: 200 }}>Name
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gate laptop" />
          </label>
          <label className="field" style={{ minWidth: 200 }}>Plays announcements for
            <select className="input" value={zone} onChange={e => setZone(e.target.value)}>
              <option value="all">Every zone</option>
              {s.zoneConfigs.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
        </div>

        <div className="panel col" style={{ padding: 16, gap: 10 }}>
          <span className="label">Voices on this computer</span>
          {LANGS.map(l => {
            const ok = hasVoice(voices, l.id);
            return (
              <div key={l.id} className="row">
                <span className="grow">{l.label}</span>
                {ok ? <span className="tag"><Check /> available</span> : <span className="tag" style={{ color: 'var(--watch)' }}>no voice</span>}
                <button className="btn btn-sm" onClick={() => speakLocally([{ lang: l.id, text: TEST[l.id] }])}>Test</button>
              </div>
            );
          })}
          {LANGS.some(l => !hasVoice(voices, l.id)) && (
            <p className="ink-3 xs" style={{ margin: 0 }}>
              {isWindows && !isEdge
                ? 'Open SPECTRA in Microsoft Edge: it has natural Hindi and Tamil voices built in.'
                : isWindows
                  ? 'Add the language in Settings → Time & language → Language & region, including “Text-to-speech”.'
                  : 'On a Mac: System Settings → Accessibility → Spoken Content → System voice → Manage voices, and add Hindi or Tamil.'}
            </p>
          )}
        </div>

        <div className="row">
          {s.speaker.enabled
            ? <span className="row grow"><Volume2 size={18} /> On, as “{s.speaker.name}” for {s.speaker.zone === 'all' ? 'every zone' : s.zoneConfigs.find(z => z.id === s.speaker.zone)?.name ?? 'a deleted zone'}</span>
            : <span className="ink-3 grow">Off</span>}
          {s.speaker.enabled && <button className="btn" onClick={() => save(false)}>Turn off</button>}
          <button className="btn btn-primary" onClick={() => { save(true); close(); }}>{s.speaker.enabled ? 'Save' : 'Turn on'}</button>
        </div>
      </div>
    </div>
  );
}
