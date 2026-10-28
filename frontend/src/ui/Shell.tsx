/**
 * Shell — top bar (logo, five destinations, connection, sound, Announce,
 * Demo), the alarm banner, and whichever dialog is open.
 */

import { NavLink, Outlet } from 'react-router-dom';
import { Bell, BellOff, Megaphone, Play, Volume2, VolumeX } from 'lucide-react';
import { useLive } from './LiveContext';
import { AlarmBanner } from './parts';
import { DemoDialog } from './dialogs/DemoDialog';
import { AnnounceDialog } from './dialogs/AnnounceDialog';
import { AddDeviceDialog } from './dialogs/AddDeviceDialog';
import { SpeakerDialog } from './dialogs/SpeakerDialog';
import { SpectraLogo } from '../components/Logo';

export function Shell() {
  const s = useLive();
  const waiting = s.incidents.filter(i => i.status === 'open' && !i.ended_at).length;
  const hot = s.worst && s.worst.alert_level !== 'normal' ? s.worst.alert_level : null;

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="logo"><span className="logo-mark"><SpectraLogo size={19} /></span>SPECTRA</NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>{hot && <span className={`nav-dot lv-${hot}`} />}Surveillance</NavLink>
          <NavLink to="/map">Map</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/alerts">Alerts {waiting > 0 && <span className="nav-count">{waiting}</span>}</NavLink>
          <NavLink to="/devices">Devices</NavLink>
        </nav>
        <div className="topbar-right">
          <span className={`conn ${s.connected ? '' : 'down'}`}><i /><span>{s.connected ? 'Live' : 'Reconnecting…'}</span></span>
          <button className="icon-btn" onClick={() => s.setMuted(!s.muted)} aria-label={s.muted ? 'Turn alert sound on' : 'Mute alert sound'} title={s.muted ? 'Alert sound off' : 'Alert sound on'}>
            {s.muted ? <BellOff /> : <Bell />}
          </button>
          <button className="icon-btn" onClick={() => s.openDialog('speaker')} style={s.speaker.enabled ? { color: 'var(--ink)', borderColor: 'var(--ink-2)' } : undefined}
            aria-label="Use this computer as a speaker" title={s.speaker.enabled ? 'This computer is a speaker' : 'Use this computer as a speaker'}>
            {s.speaker.enabled ? <Volume2 /> : <VolumeX />}
          </button>
          <button className="icon-btn" onClick={() => s.openDialog('announce')} aria-label="Make an announcement" title="Make an announcement"><Megaphone /></button>
          <button className="btn btn-primary" onClick={() => s.openDialog('demo')}><Play /> Run a demo</button>
        </div>
      </header>

      {s.speaker.enabled && !s.speechArmed && (
        <div className="banner lv-offline" style={{ background: 'var(--panel-2)', color: 'var(--ink)' }}>
          <Volume2 size={18} /> <span className="grow">This computer is a speaker. Click anywhere on the page once so the browser lets it play announcements.</span>
        </div>
      )}
      <AlarmBanner />
      <Outlet />

      <footer className="ink-3 xs" style={{ textAlign: 'center', paddingTop: 12 }}>
        SPECTRA is a decision-support prototype, not a certified safety system. Video and audio are analysed on the SPECTRA computer on this network and never uploaded.
      </footer>

      {s.dialog === 'demo' && <DemoDialog />}
      {s.dialog === 'announce' && <AnnounceDialog />}
      {s.dialog === 'add-device' && <AddDeviceDialog />}
      {s.dialog === 'speaker' && <SpeakerDialog />}
    </div>
  );
}
