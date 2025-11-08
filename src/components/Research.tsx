import React, { useState } from 'react';
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

const formatRatio = (ratio: number | null) => {
  if (ratio === null || Number.isNaN(ratio)) {
    return 'N/A';
  }
  return `${(ratio * 100).toFixed(1)}%`;
};

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

const Research: React.FC = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
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

  return (
    <div className="ebay-search-container">
      <form onSubmit={handleSubmit} className="ebay-search-form">
        <div className="search-input-wrapper">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter search term (e.g., stone island jacket)"
            className="ebay-search-input"
            autoComplete="off"
          />
        </div>

        <div className="search-button-wrapper">
          <button
            type="submit"
            className="ebay-search-button"
            disabled={loading || !query.trim()}
          >
            {loading ? 'Researching...' : 'Research eBay'}
          </button>
        </div>

        {error && (
          <div className="settings-error">{error}</div>
        )}

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
                Active total: {result.diagnostics.browseTotal ?? 'n/a'} ·
                Sold entries: {result.diagnostics.completedTotalEntries ?? 'n/a'}
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
};

export default Research;


