/**
 * SPECTRA — root component.
 *
 * Surveillance (home, the CCTV wall) → Camera focus (one camera, every
 * model), Map, Dashboard, Alerts and Devices. /node is the page a phone or
 * second laptop opens to become a camera, mic or speaker.
 */

import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LiveProvider } from './LiveContext';
import { Shell } from './Shell';
import { SurveillancePage } from './pages/SurveillancePage';
import { CameraPage } from './pages/CameraPage';
import { MapPage } from './pages/MapPage';
import { DashboardPage } from './pages/DashboardPage';
import { AlertsPage } from './pages/AlertsPage';
import { DevicesPage } from './pages/DevicesPage';
import { NodePage } from './pages/NodePage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/node" element={<NodePage />} />
        <Route element={<LiveProvider><Shell /></LiveProvider>}>
          <Route path="/" element={<SurveillancePage />} />
          <Route path="/camera/:id" element={<CameraPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/devices" element={<DevicesPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
