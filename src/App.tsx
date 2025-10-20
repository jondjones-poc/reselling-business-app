import React, { useState } from 'react';
import BarcodeScanner from 'react-qr-barcode-scanner';
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
  const [showScanner, setShowScanner] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);

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
      const appId = process.env.REACT_APP_EBAY_APP_ID;
      const endpoint = 'https://svcs.ebay.com/services/search/FindingService/v1';
      
      const params = new URLSearchParams({
        'OPERATION-NAME': 'findCompletedItems',
        'SERVICE-VERSION': '1.0.0',
        'SECURITY-APPNAME': appId || '',
        'RESPONSE-DATA-FORMAT': 'JSON',
        'REST-PAYLOAD': '',
        'keywords': brand,
        'itemFilter(0).name': 'SoldItemsOnly',
        'itemFilter(0).value': 'true',
        'sortOrder': 'EndTimeSoonest',
        'paginationInput.entriesPerPage': '5',
        'GLOBAL-ID': 'EBAY-GB'
      });

      const response = await fetch(`${endpoint}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`eBay API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.findCompletedItemsResponse && 
          data.findCompletedItemsResponse[0].searchResult && 
          data.findCompletedItemsResponse[0].searchResult[0].item) {
        
        const items = data.findCompletedItemsResponse[0].searchResult[0].item;
        const prices = items
          .filter((item: any) => item.sellingStatus && item.sellingStatus[0].currentPrice)
          .map((item: any) => ({
            title: item.title[0],
            price: parseFloat(item.sellingStatus[0].currentPrice[0].__value__),
            currency: item.sellingStatus[0].currentPrice[0]['@currencyId'] || 'GBP',
            soldDate: item.listingInfo[0].endTime[0] || 'Unknown'
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

  const handleBarcodeScan = (err: any, result: any) => {
    if (result) {
      setScannedData(result.text);
      setBrand(result.text);
      setShowScanner(false);
      // Automatically search for the scanned barcode
      setTimeout(() => {
        searchSoldListings();
      }, 1000);
    } else if (err) {
      console.error('Barcode scan error:', err);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>UK Charity Shop Deal Finder</h1>
        <p>Find the value of items before you buy them!</p>
        
        <div className="search-container">
          {!showScanner ? (
            <>
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
              
              <div className="scanner-section">
                <button 
                  onClick={() => setShowScanner(true)}
                  className="scanner-button"
                >
                  📷 Scan Barcode
                </button>
                {scannedData && (
                  <p className="scanned-info">Last scanned: {scannedData}</p>
                )}
              </div>
            </>
          ) : (
            <div className="scanner-container">
              <h3>Scan Barcode</h3>
              <BarcodeScanner
                onUpdate={handleBarcodeScan}
                width={300}
                height={200}
              />
              <button 
                onClick={() => setShowScanner(false)}
                className="close-scanner-button"
              >
                Close Scanner
              </button>
            </div>
          )}

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
