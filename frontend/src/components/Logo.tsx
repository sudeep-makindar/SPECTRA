/**
 * Spectra mark — an eye with a pulse inside: watching over people's safety.
 */

export function SpectraLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M5 16c3.5-6 7.2-9 11-9s7.5 3 11 9c-3.5 6-7.2 9-11 9s-7.5-3-11-9z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M12.5 16h1.5l1.4-3.5 2.2 7 1.4-3.5h1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
