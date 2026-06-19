import React, { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation, type NavLinkProps } from 'react-router-dom';
import ScoutingRoute from './components/ScoutingRoute';
import Research from './components/Research';
import ResearchRoute from './components/ResearchRoute';
import Reporting from './components/Reporting';
import Stock from './components/Stock';
import Expenses from './components/Expenses';
import Orders from './components/Orders';
import Sourcing from './components/Sourcing';
import Config from './components/Config';
import AuthGate from './components/AuthGate';
import { pingDatabase } from './utils/dbPing';
import './App.css';

const navItems = [
  { to: '/', label: 'Pricing', end: true },
  { to: '/stock', label: 'Stock' },
  { to: '/orders', label: 'Orders' },
  { to: '/reporting', label: 'Reporting' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/research', label: 'Research' },
  { to: '/expenses', label: 'Accounting' },
  { to: '/sniping', label: 'Sniping' },
] as const;

const mobileDrawerItems = navItems.filter((item) => item.to !== '/');

function navLinkClassName(isActive: boolean, extra = '') {
  return `nav-button${isActive ? ' active' : ''}${extra ? ` ${extra}` : ''}`;
}

/** Preserves ?tab= when opening Orders from another page (uses sessionStorage set on the Orders screen). */
function OrdersNavLink({
  className,
  onNavigate,
}: Pick<NavLinkProps, 'className'> & { onNavigate?: () => void }) {
  const location = useLocation();
  let tab: 'listing-management' | 'to-pack' | 'sales-summary' = 'to-pack';
  if (location.pathname === '/orders') {
    const q = new URLSearchParams(location.search).get('tab');
    if (q === 'sales' || q === 'listing-management') tab = 'listing-management';
    else if (q === 'sales-summary') tab = 'sales-summary';
  } else {
    try {
      const saved = sessionStorage.getItem('ordersTab');
      if (saved === 'sales' || saved === 'listing-management') tab = 'listing-management';
      else if (saved === 'sales-summary') tab = saved;
    } catch {
      /* ignore */
    }
  }
  return (
    <NavLink to={`/orders?tab=${tab}`} className={className} onClick={onNavigate}>
      Orders
    </NavLink>
  );
}

function AppNavLink({
  item,
  className,
  onNavigate,
}: {
  item: (typeof navItems)[number];
  className: NavLinkProps['className'];
  onNavigate?: () => void;
}) {
  if (item.to === '/orders') {
    return <OrdersNavLink className={className} onNavigate={onNavigate} />;
  }

  return (
    <NavLink
      to={item.to}
      end={'end' in item ? item.end : false}
      className={className}
      onClick={onNavigate}
    >
      {item.label}
    </NavLink>
  );
}

function App() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (location.pathname === '/') {
      pingDatabase();
    }
  }, [location.pathname]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileNavOpen]);

  const closeMobileNav = () => setMobileNavOpen(false);

  return (
    <AuthGate>
    <div className="App">
        <nav className="navigation" aria-label="Main">
          <div className="nav-container">
            <div id="primary-nav-menu" className="nav-menu nav-menu--desktop">
              {navItems.map((item) => (
                <AppNavLink
                  key={item.to}
                  item={item}
                  className={({ isActive }) => navLinkClassName(isActive)}
                />
              ))}
              <NavLink
                to="/config"
                className={({ isActive }) =>
                  `nav-settings-icon${isActive ? ' active' : ''}`
                }
                title="Settings"
                aria-label="Settings"
              >
                ⚙️
              </NavLink>
            </div>

            <div className="nav-mobile-bar">
              <NavLink
                to="/"
                end
                className={({ isActive }) => navLinkClassName(isActive, 'nav-mobile-home')}
              >
                Pricing
              </NavLink>
              <button
                type="button"
                className={`nav-burger${mobileNavOpen ? ' nav-burger--open' : ''}`}
                aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-nav-drawer"
                onClick={() => setMobileNavOpen((open) => !open)}
              >
                <span className="nav-burger-line" aria-hidden />
                <span className="nav-burger-line" aria-hidden />
                <span className="nav-burger-line" aria-hidden />
              </button>
            </div>
          </div>

          <div
            id="mobile-nav-drawer"
            className={`nav-drawer${mobileNavOpen ? ' nav-drawer--open' : ''}`}
            aria-hidden={!mobileNavOpen}
          >
            <div className="nav-drawer-body">
              {mobileDrawerItems.map((item) => (
                <AppNavLink
                  key={item.to}
                  item={item}
                  className={({ isActive }) => navLinkClassName(isActive, 'nav-drawer-link')}
                  onNavigate={closeMobileNav}
                />
              ))}
            </div>
            <div className="nav-drawer-footer">
              <NavLink
                to="/config"
                className={({ isActive }) =>
                  navLinkClassName(isActive, 'nav-drawer-link nav-drawer-link--settings')
                }
                onClick={closeMobileNav}
              >
                Settings
              </NavLink>
            </div>
          </div>
        </nav>

        <div
          className={`nav-drawer-backdrop${mobileNavOpen ? ' nav-drawer-backdrop--open' : ''}`}
          aria-hidden={!mobileNavOpen}
          onClick={closeMobileNav}
        />

        <Routes>
          <Route path="/" element={<ScoutingRoute />} />
          <Route path="/analytics" element={<Research />} />
          <Route path="/research" element={<ResearchRoute />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/reporting" element={<Reporting />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/sniping" element={<Sourcing />} />
          <Route path="/sourcing" element={<Navigate to="/sniping" replace />} />
          <Route path="/config" element={<Config />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    </div>
    </AuthGate>
  );
}

export default App;
