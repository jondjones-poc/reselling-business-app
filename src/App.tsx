import React, { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import EbaySearch from './components/EbaySearch';
import Research from './components/Research';
import Reporting from './components/Reporting';
import Stock from './components/Stock';
import Expenses from './components/Expenses';
import Orders from './components/Orders';
import Sourcing from './components/Sourcing';
import AuthGate from './components/AuthGate';
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
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setShowMobileMenu(false);
  }, [location.pathname]);

  const handleNavTitleDoubleClick = () => {
    setShowMobileMenu((prev) => !prev);
  };

  return (
    <AuthGate>
    <div className="App">
        <nav className="navigation">
          <div className="nav-container">
            <h1
              className="nav-title"
              onDoubleClick={handleNavTitleDoubleClick}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleNavTitleDoubleClick();
                }
              }}
            >
              Gents Rail
            </h1>
            <div
              className={`nav-menu${showMobileMenu ? ' show-mobile' : ''}`}
            >
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `nav-button${isActive ? ' active' : ''}`
                  }
                  onClick={() => setShowMobileMenu(false)}
                >
                  {item.label}
                </NavLink>
              ))}
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    </div>
    </AuthGate>
  );
}

export default App;
