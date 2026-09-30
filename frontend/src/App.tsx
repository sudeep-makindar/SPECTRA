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

  return (
    <>
      <div className="app-frame">
        <Sidebar
          isDarkMode={isDarkMode}
          onThemeToggle={() => setIsDarkMode(!isDarkMode)}
        />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
      <div className="footer-disclaimer">
        Decision-support prototype · Not a certified safety system
      </div>
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
