import React, { useState } from 'react';
import './App.css';

interface SoldItem {
  title: string;
  price: number;
  currency: string;
  soldDate: string;
}

interface PriceRange {
  min: number;
  max: number;
  average: number;
  currency: string;
  itemCount: number;
}

function App() {
  const [brand, setBrand] = useState('');
  const [loading, setLoading] = useState(false);
  const [priceRange, setPriceRange] = useState<PriceRange | null>(null);
  const [error, setError] = useState<string | null>(null);

  const searchSoldListings = async () => {
    if (!brand.trim()) {
      setError('Please enter a brand name');
      return;
    }

    setLoading(true);
    setError(null);
    setPriceRange(null);

    try {
      // eBay Finding API endpoint for sold listings
      const response = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(brand)}&filter=conditionIds:{3000}&sort=-endTime&limit=5`, {
        headers: {
          'Authorization': `Bearer ${process.env.REACT_APP_EBAY_APP_ID}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'
        }
      });

      if (!response.ok) {
        throw new Error(`eBay API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.itemSummaries && data.itemSummaries.length > 0) {
        const prices = data.itemSummaries
          .filter((item: any) => item.price && item.price.value)
          .map((item: any) => ({
            title: item.title,
            price: parseFloat(item.price.value),
            currency: item.price.currency || 'GBP',
            soldDate: item.condition || 'Unknown'
          }));

        if (prices.length > 0) {
          const priceValues = prices.map(p => p.price);
          const min = Math.min(...priceValues);
          const max = Math.max(...priceValues);
          const average = priceValues.reduce((sum, price) => sum + price, 0) / priceValues.length;

          setPriceRange({
            min,
            max,
            average,
            currency: prices[0].currency,
            itemCount: prices.length
          });
        } else {
          setError('No sold listings found with price data');
        }
      } else {
        setError('No sold listings found for this brand');
      }
    } catch (err) {
      console.error('Error searching eBay:', err);
      setError('Failed to search eBay listings. Please check your API credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>UK Charity Shop Deal Finder</h1>
        <p>Find the value of items before you buy them!</p>
        
        <div className="search-container">
          <div className="input-group">
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="Enter brand name (e.g., Nike, Adidas, Apple)"
              className="brand-input"
              onKeyPress={(e) => e.key === 'Enter' && searchSoldListings()}
            />
            <button 
              onClick={searchSoldListings}
              disabled={loading}
              className="search-button"
            >
              {loading ? 'Searching...' : 'Search Sold Listings'}
            </button>
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {priceRange && (
            <div className="price-range-container">
              <h3>Price Range for "{brand}"</h3>
              <div className="price-stats">
                <div className="price-stat">
                  <span className="label">Lowest:</span>
                  <span className="value">{priceRange.currency} {priceRange.min.toFixed(2)}</span>
                </div>
                <div className="price-stat">
                  <span className="label">Highest:</span>
                  <span className="value">{priceRange.currency} {priceRange.max.toFixed(2)}</span>
                </div>
                <div className="price-stat">
                  <span className="label">Average:</span>
                  <span className="value">{priceRange.currency} {priceRange.average.toFixed(2)}</span>
                </div>
                <div className="price-stat">
                  <span className="label">Items Found:</span>
                  <span className="value">{priceRange.itemCount}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>
    </div>
  );
}

export default App;
