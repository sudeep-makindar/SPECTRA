/**
 * Speech — read announcements aloud with the browser's built-in voices.
 * Used by the speaker dashboards, the phone device page and voice tests.
 */

import { useEffect, useState } from 'react';

export const LANGS = [
  { id: 'en', label: 'English', voice: 'en-IN' },
  { id: 'hi', label: 'हिंदी · Hindi', voice: 'hi-IN' },
  { id: 'ta', label: 'தமிழ் · Tamil', voice: 'ta-IN' },
] as const;
export type LangId = (typeof LANGS)[number]['id'];

/** Speak each text in turn with the best local voice for its language. */
export function speakLocally(items: { lang: string; text: string }[]) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  synth.cancel();
  const voices = synth.getVoices();
  for (const it of items) {
    const tag = LANGS.find(l => l.id === it.lang)?.voice ?? 'en-IN';
    const u = new SpeechSynthesisUtterance(it.text);
    u.lang = tag;
    u.voice = voices.find(v => v.lang === tag) ?? voices.find(v => v.lang.replace('_', '-').startsWith(tag.slice(0, 2))) ?? null;
    u.rate = 0.95;
    synth.speak(u);
  }
}

export function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => window.speechSynthesis?.getVoices() ?? []);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

export function hasVoice(voices: SpeechSynthesisVoice[], id: LangId) {
  const tag = LANGS.find(l => l.id === id)!.voice;
  return voices.some(v => v.lang.replace('_', '-').startsWith(tag.slice(0, 2)));
}
