/**
 * Announce — write a message once, have it in English, Hindi and Tamil, and
 * play it on every speaker in a zone. Speakers are dashboards switched to
 * "use this computer as a speaker" and phones on the SPECTRA device page.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Languages, Megaphone, Volume2, X } from 'lucide-react';
import { useLive } from '../LiveContext';
import { api } from '../live';
import { LANGS } from '../speech';
import type { LangId } from '../speech';

/** Ready-made messages, already translated, so they work without the AI or internet. */
const QUICK: { short: string; text: Record<LangId, string> }[] = [
  {
    short: 'Move calmly to the exit',
    text: {
      en: 'Please stay calm and move slowly towards the nearest exit.',
      hi: 'कृपया शांत रहें और धीरे-धीरे नज़दीकी निकास की ओर बढ़ें।',
      ta: 'தயவுசெய்து அமைதியாக இருங்கள், அருகிலுள்ள வெளியேறும் வழியை நோக்கி மெதுவாக நகருங்கள்.',
    },
  },
  {
    short: 'Stop pushing',
    text: {
      en: 'Please stop pushing and give the people around you space.',
      hi: 'कृपया धक्का देना बंद करें और अपने आस-पास के लोगों को जगह दें।',
      ta: 'தயவுசெய்து தள்ளுவதை நிறுத்துங்கள், உங்களைச் சுற்றியுள்ளவர்களுக்கு இடம் கொடுங்கள்.',
    },
  },
  {
    short: 'Area full, use other entrance',
    text: {
      en: 'This area is full. Please use the other entrance.',
      hi: 'यह क्षेत्र भर चुका है। कृपया दूसरे प्रवेश द्वार का उपयोग करें।',
      ta: 'இந்தப் பகுதி நிரம்பிவிட்டது. தயவுசெய்து மற்ற நுழைவாயிலைப் பயன்படுத்துங்கள்.',
    },
  },
  {
    short: 'Help is coming',
    text: {
      en: 'Help is on the way. Please make room for the security staff.',
      hi: 'मदद आ रही है। कृपया सुरक्षा कर्मियों के लिए रास्ता बनाएँ।',
      ta: 'உதவி வந்துகொண்டிருக்கிறது. தயவுசெய்து பாதுகாப்புப் பணியாளர்களுக்கு வழி விடுங்கள்.',
    },
  },
];

export function AnnounceDialog() {
  const s = useLive();
  const close = () => s.openDialog(null);
  const [message, setMessage] = useState(s.dialogContext.text ?? '');
  const [langs, setLangs] = useState<LangId[]>(['en', 'hi', 'ta']);
  const [texts, setTexts] = useState<Partial<Record<LangId, string>>>(s.dialogContext.hi ? { hi: s.dialogContext.hi } : {});
  const [zone, setZone] = useState(s.dialogContext.zoneId ?? 'all');
  const [busy, setBusy] = useState<'translate' | 'play' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Texts set together with the message (a ready-made one) must survive the message change.
  const keepTexts = useRef(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && s.openDialog(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  // Editing the English message makes old translations wrong.
  useEffect(() => {
    if (keepTexts.current) { keepTexts.current = false; return; }
    setTexts({});
  }, [message]);

  const speakers = useMemo(
    () => s.speakers.filter(x => zone === 'all' || x.zone_id === null || x.zone_id === zone),
    [s.speakers, zone],
  );
  const toggle = (id: LangId) => setLangs(l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id]));
  const pickQuick = (q: (typeof QUICK)[number]) => {
    keepTexts.current = q.text.en !== message;
    setMessage(q.text.en);
    setTexts({ hi: q.text.hi, ta: q.text.ta });
  };
  const items = () => LANGS.filter(l => langs.includes(l.id))
    .map(l => ({ lang: l.id, text: (l.id === 'en' ? message : texts[l.id] ?? '').trim() }))
    .filter(i => i.text);
  const missing = langs.filter(l => l !== 'en' && !texts[l]?.trim());
  const ready = !!message.trim() && missing.length === 0;

  const translate = async () => {
    setBusy('translate');
    setNote(null);
    try {
      const r = await api<{ translations: Partial<Record<LangId, string>> }>('/api/announce/translate', { method: 'POST', json: { text: message, languages: langs } });
      setTexts(t => ({ ...t, ...r.translations }));
    } catch (e) {
      setNote(`${(e as Error).message}. Pick a ready-made message, or type the translation yourself.`);
    } finally {
      setBusy(null);
    }
  };

  const play = async () => {
    setBusy('play');
    setNote(null);
    try {
      const r = await api<{ speakers: number; names: string[] }>('/api/announce', {
        method: 'POST', json: { zone_id: zone === 'all' ? null : zone, items: items() },
      });
      setNote(r.speakers ? `Playing on ${r.speakers} speaker${r.speakers > 1 ? 's' : ''}: ${r.names.join(', ')}.` : 'Sent, but no speaker is on in this zone. Turn one on with the speaker button in the top bar.');
    } catch (e) {
      setNote(`Couldn’t send it: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="backdrop" onClick={close}>
      <div className="dialog" role="dialog" aria-label="Make an announcement" onClick={e => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">Make an announcement</h2>
          <button className="icon-btn" onClick={close} aria-label="Close"><X /></button>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <span className="field">Ready-made (works offline, already translated)</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {QUICK.map(q => <button key={q.short} className="tag" style={{ cursor: 'pointer' }} onClick={() => pickQuick(q)}>{q.short}</button>)}
          </div>
        </div>

        <label className="field">Message in English
          <textarea className="input" value={message} onChange={e => setMessage(e.target.value)} placeholder="Or type your own…" />
        </label>

        <div className="row wrap" style={{ gap: 10 }}>
          <div className="seg">
            {LANGS.map(l => <button key={l.id} className={langs.includes(l.id) ? 'on' : ''} onClick={() => toggle(l.id)}>{l.label}</button>)}
          </div>
          <span className="grow" />
          {missing.length > 0 && (
            <button className="btn btn-sm" disabled={!message.trim() || busy !== null} onClick={translate}>
              <Languages /> {busy === 'translate' ? 'Translating…' : 'Translate with AI'}
            </button>
          )}
        </div>

        {langs.filter(l => l !== 'en').map(l => (
          <label key={l} className="field">{LANGS.find(x => x.id === l)!.label}
            <textarea className="input" style={{ minHeight: 60 }} value={texts[l] ?? ''} onChange={e => setTexts({ ...texts, [l]: e.target.value })}
              placeholder="Press “Translate with AI”, or type it" />
          </label>
        ))}

        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
          <label className="field" style={{ minWidth: 200 }}>Play in
            <select className="input" value={zone} onChange={e => setZone(e.target.value)}>
              <option value="all">Every zone</option>
              {s.zoneConfigs.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
          <div className="col grow" style={{ gap: 6 }}>
            <span className="field">Will play on</span>
            <span className="row wrap" style={{ gap: 6 }}>
              {speakers.length ? speakers.map(x => <span key={x.id} className="tag"><Volume2 /> {x.name}</span>)
                : <span className="ink-3 sm">No speaker is on yet. Use the speaker button in the top bar on the computers that should play it.</span>}
            </span>
          </div>
        </div>

        {note && <div className="heard sm">{note}</div>}
        <div className="row">
          <button className="btn" onClick={close}>Close</button>
          <span className="grow" />
          <button className="btn btn-primary" disabled={!ready || busy !== null} onClick={play}><Megaphone /> {busy === 'play' ? 'Sending…' : 'Play announcement'}</button>
        </div>
      </div>
    </div>
  );
}
