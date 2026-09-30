/**
 * Sidebar navigation — matches the Stoken reference:
 * - Lavender background, full height, rounded
 * - Logo at top
 * - Nav items with icons; active item is huge uppercase in a bordered pill
 * - Bottom section: Search, Account, Log Out, theme toggle
 */

import { NavLink, useLocation } from 'react-router-dom';
import { SpectraWordmark } from './Logo';

// Simple inline SVG icons — keeps dependencies minimal
const icons = {
  overview: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="nav-icon">
      <rect x="2" y="2" width="7" height="7" rx="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" />
    </svg>
  ),
  liveOps: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="nav-icon">
      <circle cx="10" cy="10" r="3" />
      <path d="M5.5 5.5a6.5 6.5 0 0 1 9 0" strokeLinecap="round" />
      <path d="M3 3a10 10 0 0 1 14 0" strokeLinecap="round" />
    </svg>
  ),
  zones: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="nav-icon">
      <rect x="2" y="3" width="16" height="14" rx="2" />
      <line x1="9" y1="3" x2="9" y2="17" />
      <line x1="2" y1="10" x2="18" y2="10" />
    </svg>
  ),
  incidents: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="nav-icon">
      <path d="M10 2L18 17H2L10 2Z" strokeLinejoin="round" />
      <line x1="10" y1="8" x2="10" y2="12" strokeLinecap="round" />
      <circle cx="10" cy="14.5" r="0.5" fill="currentColor" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="nav-icon">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="nav-icon">
      <circle cx="9" cy="9" r="5" />
      <line x1="13" y1="13" x2="17" y2="17" strokeLinecap="round" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="nav-icon">
      <circle cx="10" cy="7" r="3" />
      <path d="M4 17c0-3.3 2.7-6 6-6s6 2.7 6 6" strokeLinecap="round" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="nav-icon">
      <path d="M7 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3" strokeLinecap="round" />
      <path d="M10 10h7m0 0l-3-3m3 3l-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

const navItems = [
  { path: '/', label: 'Overview', icon: icons.overview },
  { path: '/live', label: 'Live Ops', icon: icons.liveOps },
  { path: '/zones', label: 'Zones', icon: icons.zones },
  { path: '/incidents', label: 'Incidents', icon: icons.incidents },
  { path: '/system', label: 'System', icon: icons.system },
];

interface SidebarProps {
  onThemeToggle?: () => void;
  isDarkMode?: boolean;
}

export function Sidebar({ onThemeToggle, isDarkMode = true }: SidebarProps) {
  const location = useLocation();

  return (
    <aside className="sidebar">
      <SpectraWordmark />

      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`nav-item ${isActive ? 'active' : ''}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <button className="nav-item" type="button">
          {icons.search}
          <span>Search</span>
        </button>
        <button className="nav-item" type="button">
          {icons.account}
          <span>Account</span>
        </button>
        <button className="nav-item" type="button">
          {icons.logout}
          <span>Log Out</span>
        </button>

        <button
          className={`theme-toggle ${isDarkMode ? '' : 'light'}`}
          onClick={onThemeToggle}
          type="button"
          aria-label="Toggle dark/light mode"
        />
      </div>
    </aside>
  );
}
