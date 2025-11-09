import React, { useEffect, useState } from 'react';
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import BrandResearch from './components/BrandResearch';
import EbaySearch from './components/EbaySearch';
import Research from './components/Research';
import Stock from './components/Stock';
import AuthGate from './components/AuthGate';
import './App.css';

const navItems = [
  { to: '/', label: 'Home', end: true },
  { to: '/brand-research', label: 'Brand Research' },
  { to: '/research', label: 'Research' },
  { to: '/stock', label: 'Stock' }
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
              Reseller App
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
          <Route path="/brand-research" element={<BrandResearch />} />
          <Route path="/research" element={<Research />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </AuthGate>
  );
}

export default App;
