/**
 * SPECTRA — root component.
 *
 * Shell: sidebar navigation + sticky top bar + content. One SpectraProvider
 * owns the live WebSocket, alert tone, hotkeys and the drill drawer.
 */

import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopBar, AlertBanner } from './components/TopBar';
import { DrillDrawer } from './components/ScenarioPanel';
import { SpectraProvider } from './context/SpectraContext';
import { OverviewPage } from './pages/OverviewPage';
import { LiveOpsPage } from './pages/LiveOpsPage';
import { ZonesPage } from './pages/ZonesPage';
import { DevicesPage } from './pages/DevicesPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { SystemPage } from './pages/SystemPage';
import { NodePage } from './pages/NodePage';

function MainLayout() {
  return (
    <SpectraProvider>
      <div className="app-shell">
        <Sidebar />
        <div className="main">
          <TopBar />
          <main className="content">
            <AlertBanner />
            <Outlet />
          </main>
        </div>
      </div>
      <DrillDrawer />
      <div className="footer-disclaimer">
        Decision-support prototype · not a certified safety system · Hotkeys: <b>A</b> acknowledge · <b>E</b> escalate · <b>M</b> mute
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
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route path="/zones" element={<ZonesPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/system" element={<SystemPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
