import React, { useState } from 'react';
import BarcodeScanner from 'react-qr-barcode-scanner';
import './EbaySearch.css';

const EbaySearch: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);

  const handleBarcodeScan = (err: any, result: any) => {
    if (result) {
      setScannedData(result.text);
      setSearchTerm(result.text);
      setShowScanner(false);
    } else if (err) {
      console.error('Barcode scan error:', err);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!searchTerm.trim()) {
      return;
    }

    // Build eBay UK search URL with filters
    // 260012 is Men's Clothing category
    // LH_Sold=1 - Sold items only
    // LH_Complete=1 - Completed listings only
    // _from=R40 - Search from category
    // rt=nc - Return type
    // Using .ebay.co.uk domain ensures UK marketplace
    // Adding LH_PrefLoc=1 for UK preferred location
    
    const encodedSearch = encodeURIComponent(searchTerm.trim());
    const ebayUrl = `https://www.ebay.co.uk/sch/260012/i.html?_nkw=${encodedSearch}&_from=R40&rt=nc&LH_Sold=1&LH_Complete=1&LH_PrefLoc=1`;
    
    // Open in new tab
    window.open(ebayUrl, '_blank');
  };

  return (
    <div className="ebay-search-container">
      <div className="ebay-search-header">
        <h1>eBay Search</h1>
        <p>Search eBay UK for sold items only</p>
      </div>
      
      <form onSubmit={handleSubmit} className="ebay-search-form">
        {!showScanner ? (
          <>
            <div className="search-input-wrapper">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Enter search term (e.g., joop jumper, nike shoes)"
                className="ebay-search-input"
                autoComplete="off"
              />
            </div>
            <div className="search-button-wrapper">
              <button 
                type="button"
                onClick={() => setShowScanner(true)}
                className="scanner-button"
              >
                📷 Scan Barcode
              </button>
              <button 
                type="submit"
                className="ebay-search-button"
                disabled={!searchTerm.trim()}
              >
                Search eBay
              </button>
            </div>
            {scannedData && (
              <p className="scanned-info">Last scanned: {scannedData}</p>
            )}
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
              type="button"
              onClick={() => setShowScanner(false)}
              className="close-scanner-button"
            >
              Close Scanner
            </button>
          </div>
        )}
      </form>

      <div className="example-searches">
        <h3>Example Searches:</h3>
        <div className="example-buttons">
          <button 
            onClick={() => setSearchTerm('joop jumper')}
            className="example-button"
          >
            joop jumper
          </button>
          <button 
            onClick={() => setSearchTerm('nike shoes')}
            className="example-button"
          >
            nike shoes
          </button>
          <button 
            onClick={() => setSearchTerm('burberry coat')}
            className="example-button"
          >
            burberry coat
          </button>
        </div>
      </div>
    </div>
  );
};

export default EbaySearch;
