import React, { useEffect } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import EbaySearch from './components/EbaySearch';
import Research from './components/Research';
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
  { to: '/', label: 'Price', end: true },
  { to: '/stock', label: 'Stock' },
  { to: '/reporting', label: 'Reporting' },
  { to: '/expenses', label: 'Expenses' },
  { to: '/orders', label: 'Orders' },
  { to: '/research', label: 'Research' },
  { to: '/sourcing', label: 'Sourcing' }
];

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
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `nav-button${isActive ? ' active' : ''}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              {/* Settings menu item for mobile only */}
              <NavLink
                to="/config"
                className={({ isActive }) =>
                  `nav-button${isActive ? ' active' : ''} nav-button-mobile-only`
                }
              >
                Settings
              </NavLink>
              {/* Settings icon for desktop only */}
              <NavLink
                to="/config"
                className={({ isActive }) =>
                  `nav-settings-icon${isActive ? ' active' : ''} nav-settings-icon-desktop`
                }
                title="Settings"
              >
                ⚙️
              </NavLink>
            </div>
          </div>
        </nav>

        <Routes>
          <Route path="/" element={<EbaySearch />} />
          <Route path="/research" element={<Research />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/reporting" element={<Reporting />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/sourcing" element={<Sourcing />} />
          <Route path="/config" element={<Config />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    </div>
    </AuthGate>
  );
}

export default App;
