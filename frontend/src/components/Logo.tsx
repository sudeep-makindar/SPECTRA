/**
 * Spectra SVG Wordmark/Logo
 *
 * Design: Three stacked signal lines (representing vision, motion, audio)
 * converging into a prism shape. Simple, geometric, matches the reference
 * style — works on the lavender sidebar background.
 */

interface LogoProps {
  size?: number;
  className?: string;
}

export function SpectraLogo({ size = 32, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Spectra logo"
    >
      {/* Prism body */}
      <path
        d="M16 3L28 26H4L16 3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Three signal lines (spectrum) emerging from the prism */}
      <line x1="16" y1="14" x2="10" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <line x1="16" y1="14" x2="16" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
      <line x1="16" y1="14" x2="22" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      {/* Apex dot */}
      <circle cx="16" cy="10" r="2" fill="currentColor" />
    </svg>
  );
}

export function SpectraWordmark({ className = '' }: { className?: string }) {
  return (
    <div className={`sidebar-logo ${className}`}>
      <SpectraLogo size={32} />
      <span>SPECTRA</span>
    </div>
  );
}
