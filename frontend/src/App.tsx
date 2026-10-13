/**
 * Spectra — Root application component.
 *
 * Layout: lavender sidebar + main content area inside a rounded app frame,
 * matching the Stoken reference image. One SpectraProvider owns the live
 * WebSocket, alert tone and hotkeys for every page.
 */

import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar, AlertBanner } from './components/TopBar';
import { SpectraProvider } from './context/SpectraContext';
import { OverviewPage } from './pages/OverviewPage';
import { LiveOpsPage } from './pages/LiveOpsPage';
import { ZonesPage } from './pages/ZonesPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { SystemPage } from './pages/SystemPage';
import { NodePage } from './pages/NodePage';

function MainLayout() {
  const [isDarkMode, setIsDarkMode] = useState(true);

  return (
    <SpectraProvider>
      <div className="app-frame">
        <Sidebar isDarkMode={isDarkMode} onThemeToggle={() => setIsDarkMode(!isDarkMode)} />
        <main className="main-content">
          <TopBar />
          <AlertBanner />
          <Outlet />
        </main>
      </div>
      <div className="footer-disclaimer">
        Decision-support prototype · Not a certified safety system · Hotkeys: <b>A</b> acknowledge · <b>E</b> escalate · <b>M</b> mute
      </div>
    </SpectraProvider>
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
