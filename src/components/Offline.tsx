import React, { useEffect, useState } from 'react';
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

const allBrands = [...brandsToBuy, ...brandsToAvoid];
const brandCategories = Array.from(new Set(allBrands.map((brand) => brand.category))).sort();

const Offline: React.FC = () => {
  const [brandSearchTerm, setBrandSearchTerm] = useState('');
  const [selectedBrandCategory, setSelectedBrandCategory] = useState('');
  const [brandResults, setBrandResults] = useState<BrandResult[]>([]);
  const [showBrandResults, setShowBrandResults] = useState(false);
  const [settingsBrands, setSettingsBrands] = useState<string[]>([]);
  const [selectedSettingsBrand, setSelectedSettingsBrand] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = window.localStorage.getItem('saerch term');
      const trimmed = stored ? stored.trim() : '';

      if (trimmed) {
        setBrandSearchTerm((current) => (current.trim().length > 0 ? current : trimmed));
      }
    } catch (storageError) {
      console.warn('Unable to read stored search term for offline research:', storageError);
    }
  }, []);

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
    if (!selectedSettingsBrand) {
      return;
    }

    if (brandSearchTerm.trim().toLowerCase() !== selectedSettingsBrand.toLowerCase()) {
      setSelectedSettingsBrand('');
    }
  }, [brandSearchTerm, selectedSettingsBrand]);

  useEffect(() => {
    if (brandSearchTerm.trim().length > 0) {
      const filteredResults: BrandResult[] = [];

      brandsToBuy.forEach((brand) => {
        const matchesSearch = brand.name.toLowerCase().includes(brandSearchTerm.toLowerCase());
        const matchesCategory = !selectedBrandCategory || brand.category === selectedBrandCategory;

        if (matchesSearch && matchesCategory) {
          filteredResults.push({
            name: brand.name,
            category: brand.category,
            minimumPrice: brand.minimumPrice,
            status: 'good',
          });
        }
      });

      brandsToAvoid.forEach((brand) => {
        const matchesSearch = brand.name.toLowerCase().includes(brandSearchTerm.toLowerCase());
        const matchesCategory = !selectedBrandCategory || brand.category === selectedBrandCategory;

        if (matchesSearch && matchesCategory) {
          filteredResults.push({
            name: brand.name,
            category: brand.category,
            minimumPrice: brand.minimumPrice,
            status: 'bad',
          });
        }
      });

      setBrandResults(filteredResults);
      setShowBrandResults(true);
    } else {
      setBrandResults([]);
      setShowBrandResults(false);
    }
  }, [brandSearchTerm, selectedBrandCategory]);

  const handleBrandInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setBrandSearchTerm(value);
    setSelectedSettingsBrand('');
  };

  const handleBrandResultClick = (brandName: string) => {
    setBrandSearchTerm(brandName);
    setShowBrandResults(false);
  };

  const handleBrandCategoryChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedBrandCategory(event.target.value);
  };

  const handleSettingsBrandChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = event.target.value;
    setSelectedSettingsBrand(selected);
    if (selected) {
      setBrandSearchTerm(selected);
    }
  };

  const brandResultsContent = showBrandResults && brandResults.length > 0 && (
    <div className="brand-results-dropdown">
      {brandResults.slice(0, 10).map((result, index) => (
        <div
          key={`${result.name}-${index}`}
          className={`brand-result-item ${result.status}`}
          onClick={() => handleBrandResultClick(result.name)}
        >
          <span className="result-icon">{result.status === 'good' ? '✓' : '✗'}</span>
          <span className="result-brand">{result.name}</span>
          <span className="result-category">{result.category}</span>
          <span className="result-price">Min: £{result.minimumPrice}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <div className="brand-research-container">
        <div className="brand-research-header">
          <h1>Brand Research</h1>
          <p>Search for brands to see if they're worth buying or should be avoided</p>
        </div>

        <div className="search-section">
          <div className="search-input-container">
            <input
              type="text"
              value={brandSearchTerm}
              onChange={handleBrandInputChange}
              placeholder="Type a brand name..."
              className="brand-search-input"
              autoComplete="off"
            />
            <select
              value={selectedBrandCategory}
              onChange={handleBrandCategoryChange}
              className="category-filter"
            >
              <option value="">All Categories</option>
              {brandCategories.map((category) => (
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
            {brandResultsContent}
          </div>
        </div>

        {brandSearchTerm && brandResults.length === 0 && (
          <div className="no-results">
            <p>No brands found matching "{brandSearchTerm}"</p>
            <p>This brand is not in our database - research manually</p>
          </div>
        )}

        {brandSearchTerm && brandResults.length > 0 && (
          <div className="search-summary">
            <h3>Search Results for "{brandSearchTerm}"</h3>
            <div className="results-list">
              {brandResults.map((result, index) => (
                <div key={`${result.name}-${index}`} className={`result-item ${result.status}`}>
                  <span className="result-icon">{result.status === 'good' ? '✓' : '✗'}</span>
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
    </div>
  );
};

export default Offline;

