import React, { useState, useEffect } from 'react';
import brandsToBuy from '../data/brands-to-buy.json';
import brandsToAvoid from '../data/brands-to-avoid.json';
import './BrandResearch.css';

interface BrandData {
  name: string;
  category: string;
  minimumPrice: number;
}

interface BrandResult {
  name: string;
  category: string;
  minimumPrice: number;
  status: 'good' | 'bad' | 'unknown';
}

const BrandResearch: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [results, setResults] = useState<BrandResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Get unique categories from both brand lists
  const allBrands = [...brandsToBuy, ...brandsToAvoid];
  const categories = Array.from(new Set(allBrands.map(brand => brand.category))).sort();

  useEffect(() => {
    if (searchTerm.trim().length > 0) {
      const filteredResults: BrandResult[] = [];
      
      // Check brands to buy
      brandsToBuy.forEach(brand => {
        const matchesSearch = brand.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = !selectedCategory || brand.category === selectedCategory;
        
        if (matchesSearch && matchesCategory) {
          filteredResults.push({ 
            name: brand.name, 
            category: brand.category,
            minimumPrice: brand.minimumPrice,
            status: 'good' 
          });
        }
      });
      
      // Check brands to avoid
      brandsToAvoid.forEach(brand => {
        const matchesSearch = brand.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = !selectedCategory || brand.category === selectedCategory;
        
        if (matchesSearch && matchesCategory) {
          filteredResults.push({ 
            name: brand.name, 
            category: brand.category,
            minimumPrice: brand.minimumPrice,
            status: 'bad' 
          });
        }
      });
      
      setResults(filteredResults);
      setShowResults(true);
    } else {
      setResults([]);
      setShowResults(false);
    }
  }, [searchTerm, selectedCategory]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  const handleResultClick = (brandName: string) => {
    setSearchTerm(brandName);
    setShowResults(false);
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCategory(e.target.value);
  };

  return (
    <div className="brand-research-container">
      <div className="brand-research-header">
        <h1>Brand Research</h1>
        <p>Search for brands to see if they're worth buying or should be avoided</p>
      </div>
      
      <div className="search-section">
        <div className="search-input-container">
          <input
            type="text"
            value={searchTerm}
            onChange={handleInputChange}
            placeholder="Type a brand name..."
            className="brand-search-input"
            autoComplete="off"
          />
          <select
            value={selectedCategory}
            onChange={handleCategoryChange}
            className="category-filter"
          >
            <option value="">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          {showResults && results.length > 0 && (
            <div className="search-results">
              {results.map((result, index) => (
                <div
                  key={index}
                  className={`search-result ${result.status}`}
                  onClick={() => handleResultClick(result.name)}
                >
                  <span className="status-icon">
                    {result.status === 'good' ? '✓' : '✗'}
                  </span>
                  <div className="brand-info">
                    <span className="brand-name">{result.name}</span>
                    <span className="brand-category">{result.category}</span>
                    <span className="brand-price">Min: £{result.minimumPrice}</span>
                  </div>
                  <span className="status-text">
                    {result.status === 'good' ? 'Good to buy' : 'Avoid'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {searchTerm && results.length === 0 && (
        <div className="no-results">
          <p>No brands found matching "{searchTerm}"</p>
          <p>This brand is not in our database - research manually</p>
        </div>
      )}

      {searchTerm && results.length > 0 && (
        <div className="search-summary">
          <h3>Search Results for "{searchTerm}"</h3>
          <div className="results-list">
            {results.map((result, index) => (
              <div key={index} className={`result-item ${result.status}`}>
                <span className="result-icon">
                  {result.status === 'good' ? '✓' : '✗'}
                </span>
                <div className="result-brand-info">
                  <span className="result-brand">{result.name}</span>
                  <span className="result-category">{result.category}</span>
                  <span className="result-price">Min: £{result.minimumPrice}</span>
                </div>
                <span className="result-status">
                  {result.status === 'good' ? 'Good to buy' : 'Avoid'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandResearch;

