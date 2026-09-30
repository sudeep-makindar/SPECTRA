/**
 * Spectra — Root application component.
 *
 * Layout: lavender sidebar + main content area inside a rounded app frame,
 * matching the Stoken reference image.
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { OverviewPage } from './pages/OverviewPage';
import { LiveOpsPage } from './pages/LiveOpsPage';
import { ZonesPage } from './pages/ZonesPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { SystemPage } from './pages/SystemPage';

function App() {
  const [isDarkMode, setIsDarkMode] = useState(true);

  return (
    <BrowserRouter>
      <div className="app-frame">
        <Sidebar
          isDarkMode={isDarkMode}
          onThemeToggle={() => setIsDarkMode(!isDarkMode)}
        />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/live" element={<LiveOpsPage />} />
            <Route path="/zones" element={<ZonesPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/system" element={<SystemPage />} />
          </Routes>
        </main>
      </div>

      {/* Always-visible disclaimer */}
      <div className="footer-disclaimer">
        Decision-support prototype · Not a certified safety system
      </div>
    </BrowserRouter>
  );
}

export default App;
