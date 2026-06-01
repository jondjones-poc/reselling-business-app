import React, { useEffect } from 'react';
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
  { to: '/', label: 'Scouting', end: true },
  { to: '/stock', label: 'Stock' },
  { to: '/orders', label: 'Orders' },
  { to: '/reporting', label: 'Reporting' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/research', label: 'Research' },
  { to: '/expenses', label: 'Accounting' },
  { to: '/sniping', label: 'Sniping' },
] as const;

/** Preserves ?tab= when opening Orders from another page (uses sessionStorage set on the Orders screen). */
function OrdersNavLink({ className }: Pick<NavLinkProps, 'className'>) {
  const location = useLocation();
  let tab: 'sales' | 'to-pack' | 'sales-summary' = 'to-pack';
  if (location.pathname === '/orders') {
    const q = new URLSearchParams(location.search).get('tab');
    if (q === 'sales') tab = 'sales';
    else if (q === 'sales-summary') tab = 'sales-summary';
  } else {
    try {
      const saved = sessionStorage.getItem('ordersTab');
      if (saved === 'sales' || saved === 'sales-summary') tab = saved;
    } catch {
      /* ignore */
    }
  }
  return (
    <NavLink to={`/orders?tab=${tab}`} className={className}>
      Orders
    </NavLink>
  );
}

function App() {
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/') {
      pingDatabase();
    }
  }, [location.pathname]);

  return (
    <AuthGate>
    <div className="App">
        <nav className="navigation" aria-label="Main">
          <div className="nav-container">
            <div id="primary-nav-menu" className="nav-menu">
              {navItems.map((item) =>
                item.to === '/orders' ? (
                  <OrdersNavLink
                    key={item.to}
                    className={({ isActive }) => `nav-button${isActive ? ' active' : ''}`}
                  />
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={'end' in item ? item.end : false}
                    className={({ isActive }) =>
                      `nav-button${isActive ? ' active' : ''}`
                    }
                  >
                    {item.label}
                  </NavLink>
                )
              )}
              {/* Stock Management menu item for mobile only */}
              <NavLink
                to="/config"
                className={({ isActive }) =>
                  `nav-button${isActive ? ' active' : ''} nav-button-mobile-only`
                }
              >
                Stock Management
              </NavLink>
              {/* Stock Management icon for desktop only */}
              <NavLink
                to="/config"
                className={({ isActive }) =>
                  `nav-settings-icon${isActive ? ' active' : ''} nav-settings-icon-desktop`
                }
                title="Stock Management"
              >
                ⚙️
              </NavLink>
            </div>
          </div>
        </nav>

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
