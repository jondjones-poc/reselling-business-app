import React, { useState } from 'react';
import BrandResearch from './components/BrandResearch';
import EbaySearch from './components/EbaySearch';
import Research from './components/Research';
import './App.css';

function App() {
  const [currentPage, setCurrentPage] = useState('ebay-search');

  return (
    <div className="App">
      <nav className="navigation">
        <div className="nav-container">
          <h1 className="nav-title">Reseller App</h1>
          <div className="nav-menu">
            <button 
              className={`nav-button ${currentPage === 'ebay-search' ? 'active' : ''}`}
              onClick={() => setCurrentPage('ebay-search')}
            >
              Home
            </button>
            <button 
              className={`nav-button ${currentPage === 'brand-research' ? 'active' : ''}`}
              onClick={() => setCurrentPage('brand-research')}
            >
              Brand Research
            </button>
            <button 
              className={`nav-button ${currentPage === 'research' ? 'active' : ''}`}
              onClick={() => setCurrentPage('research')}
            >
              Research
            </button>
          </div>
        </div>
      </nav>

      {currentPage === 'ebay-search' && (
        <EbaySearch />
      )}

      {currentPage === 'brand-research' && (
        <BrandResearch />
      )}

      {currentPage === 'research' && (
        <Research />
      )}
    </div>
  );
}

export default App;
