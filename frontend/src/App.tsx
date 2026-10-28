/**
 * Spectra — Root application component.
 *
 * Layout: lavender sidebar + main content area inside a rounded app frame,
 * matching the Stoken reference image.
 */

import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { OverviewPage } from './pages/OverviewPage';
import { LiveOpsPage } from './pages/LiveOpsPage';
import { ZonesPage } from './pages/ZonesPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { SystemPage } from './pages/SystemPage';
import { NodePage } from './pages/NodePage';

function MainLayout() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  return (
    <>
      <div className={`app-frame ${isDarkMode ? 'dark-mode' : 'light-mode'}`}>
        <Sidebar
          isDarkMode={isDarkMode}
          onThemeToggle={() => setIsDarkMode(prev => !prev)}
          onLockSession={() => setIsLocked(true)}
        />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
      <div className="footer-disclaimer">
        Decision-support prototype · Not a certified safety system
      </div>

      {/* Terminal Lock Screen Overlay */}
      {isLocked && (
        <div
          className="dialog-overlay"
          style={{
            zIndex: 999,
            background: 'rgba(12, 12, 15, 0.96)',
            flexDirection: 'column',
            gap: '24px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#EF4444',
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 36, height: 36 }}>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '0.05em' }}>
              TERMINAL SECURED
            </h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginTop: '6px' }}>
              Session locked by Operator Vedan · Headless ML perception & tracking active
            </p>
          </div>

          <button
            className="pill-btn pill-btn-primary"
            id="unlock-terminal-btn"
            style={{
              background: 'var(--color-lavender)',
              color: 'var(--color-charcoal)',
              fontWeight: 600,
              padding: '12px 32px',
              borderRadius: '999px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
            onClick={() => setIsLocked(false)}
          >
            Unlock Console
          </button>
        </div>
      )}
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/node" element={<NodePage />} />
        <Route element={<MainLayout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/live" element={<LiveOpsPage />} />
          <Route path="/zones" element={<ZonesPage />} />
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route path="/system" element={<SystemPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
