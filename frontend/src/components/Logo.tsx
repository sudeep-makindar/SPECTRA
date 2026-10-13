/**
 * Spectra mark — a prism splitting one signal into three (vision, motion, audio).
 */

export function SpectraLogo({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-label="Spectra">
      <path d="M16 4L28 26H4L16 4Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
      <line x1="16" y1="14" x2="10.5" y2="22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <line x1="16" y1="14" x2="16" y2="22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="16" y1="14" x2="21.5" y2="22" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
      <circle cx="16" cy="11" r="1.8" fill="currentColor" />
    </svg>
  );
}

export function SpectraWordmark({ subtitle = 'Crowd Safety Ops' }: { subtitle?: string }) {
  return (
    <div className="brand">
      <div className="brand-mark"><SpectraLogo /></div>
      <div className="brand-text">
        <b>SPECTRA</b>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}
