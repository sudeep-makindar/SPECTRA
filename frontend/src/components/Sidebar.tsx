/**
 * Sidebar navigation — matches the Stoken reference:
 * - Lavender background, full height, rounded
 * - Logo at top
 * - Nav items with icons; active item is huge uppercase in a bordered pill
 * - Bottom section: Search, Account, Log Out, theme toggle
 */

import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { SpectraWordmark } from './Logo';

// Simple inline SVG icons
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
  onLockSession?: () => void;
}

export function Sidebar({ onThemeToggle, isDarkMode = true, onLockSession }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Modals state
  const [showSearch, setShowSearch] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [showLogout, setShowLogout] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ title: string; category: string; path: string }>>([]);

  // Keyboard shortcut Ctrl+K / Cmd+K for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearch(prev => !prev);
      } else if (e.key === 'Escape') {
        setShowSearch(false);
        setShowAccount(false);
        setShowLogout(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Update search results
  useEffect(() => {
    if (!showSearch) return;

    const baseNav = [
      { title: 'Overview Dashboard', category: 'Navigation', path: '/' },
      { title: 'Live Ops Stream Feeds', category: 'Navigation', path: '/live' },
      { title: 'Surveillance Zones Architect', category: 'Navigation', path: '/zones' },
      { title: 'Incidents & Anomaly Log', category: 'Navigation', path: '/incidents' },
      { title: 'System Health & Hardware Telemetry', category: 'Navigation', path: '/system' },
      { title: 'Edge Perceptual Node Client', category: 'Client', path: '/node' },
    ];

    if (!searchQuery.trim()) {
      setSearchResults(baseNav);
      return;
    }

    const q = searchQuery.toLowerCase();
    const filtered = baseNav.filter(item =>
      item.title.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
    );
    setSearchResults(filtered);
  }, [searchQuery, showSearch]);

  return (
    <>
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
                id={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <button
            className="nav-item"
            type="button"
            id="sidebar-search-btn"
            onClick={() => setShowSearch(true)}
          >
            {icons.search}
            <span>Search</span>
          </button>
          <button
            className="nav-item"
            type="button"
            id="sidebar-account-btn"
            onClick={() => setShowAccount(true)}
          >
            {icons.account}
            <span>Account</span>
          </button>
          <button
            className="nav-item"
            type="button"
            id="sidebar-logout-btn"
            onClick={() => setShowLogout(true)}
          >
            {icons.logout}
            <span>Log Out</span>
          </button>

          <button
            className={`theme-toggle ${isDarkMode ? '' : 'light'}`}
            onClick={onThemeToggle}
            type="button"
            id="sidebar-theme-toggle"
            aria-label="Toggle dark/light mode"
          />
        </div>
      </aside>

      {/* ── Search Modal ── */}
      {showSearch && (
        <div className="dialog-overlay" onClick={() => setShowSearch(false)}>
          <div
            className="card card-dark dialog-content"
            style={{ maxWidth: '540px' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div style={{ color: 'var(--color-lavender)' }}>{icons.search}</div>
              <input
                autoFocus
                placeholder="Search feeds, zones, incidents, or commands..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  fontSize: '1.1rem',
                  color: 'inherit',
                  fontFamily: 'var(--font-sans)',
                }}
                id="search-input-field"
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '2px 6px' }}>
                ESC
              </span>
            </div>

            <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {searchResults.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  No matching resources or views found.
                </div>
              ) : (
                searchResults.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      navigate(item.path);
                      setShowSearch(false);
                    }}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: 'rgba(255,255,255,0.03)',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(157, 141, 247, 0.12)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                  >
                    <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{item.title}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-lavender)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
                      {item.category}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Account Modal ── */}
      {showAccount && (
        <div className="dialog-overlay" onClick={() => setShowAccount(false)}>
          <div
            className="card card-dark dialog-content"
            style={{ maxWidth: '440px' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="card-label" style={{ marginBottom: '16px' }}>Terminal Operator Clearance</div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  background: 'var(--color-lavender)',
                  color: 'var(--color-charcoal)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-display)',
                }}
              >
                VD
              </div>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700 }}>Lead Operator Vedan</h3>
                <span style={{ fontSize: '0.75rem', color: '#4ADE80', fontWeight: 600 }}>
                  ● Level 4 Fusion Clearance (Active)
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '12px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Workstation Node:</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>ALPHA-MASTER-01</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Session Channel:</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>TLS 1.3 / AES-256</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Capabilities:</span>
                <span style={{ color: 'var(--color-lavender)' }}>Perception Override & Fusion</span>
              </div>
            </div>

            <button
              className="pill-btn pill-btn-primary"
              style={{
                width: '100%',
                background: 'var(--color-cream)',
                color: 'var(--color-charcoal)',
                fontWeight: 600,
                padding: '10px',
                borderRadius: '999px',
                border: 'none',
                cursor: 'pointer',
              }}
              onClick={() => setShowAccount(false)}
            >
              Acknowledge & Close
            </button>
          </div>
        </div>
      )}

      {/* ── Logout Modal ── */}
      {showLogout && (
        <div className="dialog-overlay" onClick={() => setShowLogout(false)}>
          <div
            className="card card-dark dialog-content"
            style={{ maxWidth: '420px' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="card-label" style={{ marginBottom: '12px', color: '#EF4444' }}>
              Confirm Session Disconnect
            </div>
            <p style={{ fontSize: '0.9rem', marginBottom: '12px', lineHeight: 1.5 }}>
              Lock or terminate this operator terminal session?
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '20px', lineHeight: 1.4 }}>
              Autonomous edge AI perception, YOLO tracking, and audio anomaly detection will continue running in headless background daemon mode.
            </p>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="pill-btn pill-btn-dark"
                style={{ flex: 1, padding: '10px', borderRadius: '999px', cursor: 'pointer' }}
                onClick={() => setShowLogout(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pill-btn pill-btn-primary"
                id="confirm-lock-btn"
                style={{
                  flex: 1,
                  background: '#EF4444',
                  color: '#fff',
                  fontWeight: 600,
                  padding: '10px',
                  borderRadius: '999px',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  setShowLogout(false);
                  if (onLockSession) onLockSession();
                }}
              >
                Lock Terminal
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
