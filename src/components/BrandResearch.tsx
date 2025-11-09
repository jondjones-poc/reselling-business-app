import React, { useState, useEffect } from 'react';
import brandsToBuy from '../data/brands-to-buy.json';
import brandsToAvoid from '../data/brands-to-avoid.json';
import './BrandResearch.css';

interface BrandResult {
  name: string;
  category: string;
  minimumPrice: number;
  status: 'good' | 'bad' | 'unknown';
}

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

const BrandResearch: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [results, setResults] = useState<BrandResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [settingsBrands, setSettingsBrands] = useState<string[]>([]);
  const [selectedSettingsBrand, setSelectedSettingsBrand] = useState('');

  // Get unique categories from both brand lists
  const allBrands = [...brandsToBuy, ...brandsToAvoid];
  const categories = Array.from(new Set(allBrands.map(brand => brand.category))).sort();

  useEffect(() => {
    let isMounted = true;

    const applyBrands = (rawBrands: unknown) => {
      if (!Array.isArray(rawBrands)) {
        return false;
      }

      const sanitized = Array.from(
        new Set(
          rawBrands
            .filter((brand): brand is string => typeof brand === 'string')
            .map((brand) => brand.trim())
            .filter((brand) => brand.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

      if (isMounted && sanitized.length > 0) {
        setSettingsBrands(sanitized);
      }

      return sanitized.length > 0;
    };

    const loadBrands = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/settings`);
        if (response.ok) {
          const data = await response.json();
          const applied = applyBrands(data?.brands);
          if (applied) {
            return;
          }
        }
      } catch (error) {
        console.warn('Falling back to static settings for brands:', error);
      }

      try {
        const fallbackResponse = await fetch('/app-settings.json');
        if (!fallbackResponse.ok) {
          throw new Error(`Fallback settings not available: ${fallbackResponse.status}`);
        }

        const fallbackData = await fallbackResponse.json();
        applyBrands(fallbackData?.brands);
      } catch (fallbackError) {
        console.error('Unable to load brands from settings:', fallbackError);
      }
    };

    loadBrands();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || settingsBrands.length === 0) {
      return;
    }

    try {
      const stored = window.localStorage.getItem('saerch term');
      const trimmed = stored ? stored.trim() : '';

      if (!trimmed) {
        return;
      }

      setSearchTerm((current) =>
        current.trim().length > 0 ? current : trimmed
      );

      const matchedBrand = settingsBrands.find(
        (brand) => brand.toLowerCase() === trimmed.toLowerCase()
      );

      if (matchedBrand) {
        setSelectedSettingsBrand((current) =>
          current.trim().length > 0 ? current : matchedBrand
        );
      }
    } catch (storageError) {
      console.warn('Unable to read stored search term for brand research:', storageError);
    }
  }, [settingsBrands]);

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

  useEffect(() => {
    if (!selectedSettingsBrand) {
      return;
    }

    if (searchTerm.trim().toLowerCase() !== selectedSettingsBrand.toLowerCase()) {
      setSelectedSettingsBrand('');
    }
  }, [searchTerm, selectedSettingsBrand]);

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

  const handleSettingsBrandChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedSettingsBrand(value);
    if (!value) {
      setSearchTerm('');
      setShowResults(false);
      return;
    }

    setSearchTerm(value);
    setShowResults(true);
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
          {settingsBrands.length > 0 && (
            <select
              value={selectedSettingsBrand}
              onChange={handleSettingsBrandChange}
              className="settings-brand-filter"
            >
              <option value="">Brands from settings…</option>
              {settingsBrands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          )}
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

