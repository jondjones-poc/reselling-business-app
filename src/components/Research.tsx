import React, { useEffect, useMemo, useState } from 'react';
import brandsToBuy from '../data/brands-to-buy.json';
import brandsToAvoid from '../data/brands-to-avoid.json';
import './BrandResearch.css';
import './EbaySearch.css';

interface ResearchResult {
  query: string;
  activeCount: number;
  soldCount: number;
  sellThroughRatio: number | null;
  diagnostics?: {
    browseTotal: number | null;
    completedTotalEntries: number | null;
    completedError?: string | null;
  };
}

interface BrandResult {
  name: string;
  category: string;
  minimumPrice: number;
  status: 'good' | 'bad' | 'unknown';
}

const formatRatio = (ratio: number | null) => {
  if (ratio === null || Number.isNaN(ratio)) {
    return 'N/A';
  }
  return `${(ratio * 100).toFixed(1)}%`;
};

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

const allBrands = [...brandsToBuy, ...brandsToAvoid];
const brandCategories = Array.from(new Set(allBrands.map((brand) => brand.category))).sort();

const Research: React.FC = () => {
  const [ebayQuery, setEbayQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);

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

      if (!trimmed) {
        return;
      }

      setEbayQuery((current) => (current.trim().length > 0 ? current : trimmed));
      setBrandSearchTerm((current) => (current.trim().length > 0 ? current : trimmed));
    } catch (storageError) {
      console.warn('Unable to read stored search term for research:', storageError);
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

  const handleBrandInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setBrandSearchTerm(value);
  };

  const handleBrandResultClick = (brandName: string) => {
    setBrandSearchTerm(brandName);
    setShowBrandResults(false);
    setEbayQuery((current) => (current.trim().length > 0 ? current : brandName));
  };

  const handleBrandCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedBrandCategory(e.target.value);
  };

  const handleSettingsBrandChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedSettingsBrand(value);
    if (!value) {
      setBrandSearchTerm('');
      setShowBrandResults(false);
      return;
    }

    setBrandSearchTerm(value);
    setShowBrandResults(true);
    setEbayQuery((current) => (current.trim().length > 0 ? current : value));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = ebayQuery.trim();
    if (!trimmedQuery) {
      setError('Please enter a search term');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const params = new URLSearchParams({ q: trimmedQuery });
      const response = await fetch(`${API_BASE}/api/ebay/research?${params.toString()}`);

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to fetch research data.');
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const message = await response.text();
        throw new Error(message || 'Unexpected response format from server.');
      }

      const data: ResearchResult = await response.json();
      setResult(data);
    } catch (err: any) {
      console.error('Research fetch error:', err);
      setError(err.message || 'Unable to load research data. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const brandResultsContent = useMemo(() => {
    if (!showBrandResults || brandResults.length === 0) {
      return null;
    }

    return (
      <div className="search-results">
        {brandResults.map((result, index) => (
          <div
            key={`${result.name}-${index}`}
            className={`search-result ${result.status}`}
            onClick={() => handleBrandResultClick(result.name)}
          >
            <span className="status-icon">{result.status === 'good' ? '✓' : '✗'}</span>
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
    );
  }, [brandResults, showBrandResults]);

  return (
    <div className="research-page-container">
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

      <div className="ebay-search-container research-ebay-section">
        <form onSubmit={handleSubmit} className="ebay-search-form">
          <div className="search-bar-group">
            <div className="search-input-wrapper">
              <input
                type="text"
                value={ebayQuery}
                onChange={(e) => setEbayQuery(e.target.value)}
                placeholder="Enter search term (e.g., stone island jacket)"
                className="ebay-search-input"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="primary-action-row research-action-row">
            <button
              type="submit"
              className="ebay-search-button"
              disabled={loading || !ebayQuery.trim()}
            >
              {loading ? 'Researching...' : 'Research eBay'}
            </button>
          </div>

          {error && <div className="settings-error">{error}</div>}

          {result && !error && (
            <div className="listings-container">
              <h3>Market Snapshot for "{result.query}"</h3>
              <div className="price-stats">
                <div className="price-stat">
                  <span className="label">Active Listings</span>
                  <span className="value">{result.activeCount.toLocaleString()}</span>
                </div>
                <div className="price-stat">
                  <span className="label">Sold Listings</span>
                  <span className="value">{result.soldCount.toLocaleString()}</span>
                </div>
                <div className="price-stat">
                  <span className="label">Sell-Through</span>
                  <span className="value">{formatRatio(result.sellThroughRatio)}</span>
                </div>
              </div>
              {result.diagnostics?.completedError && (
                <div className="settings-error" style={{ marginTop: '16px' }}>
                  Sold data is temporarily unavailable: {result.diagnostics.completedError}
                </div>
              )}
              {result.diagnostics && (
                <div className="settings-status" style={{ marginTop: '16px' }}>
                  Active total: {result.diagnostics.browseTotal ?? 'n/a'} · Sold entries: {result.diagnostics.completedTotalEntries ?? 'n/a'}
                </div>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default Research;


