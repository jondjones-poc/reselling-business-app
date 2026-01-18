import React, { useState, useRef, useEffect } from 'react';
import './Sourcing.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

// Fallback brands list (extracted from Research component's fallback data)
const fallbackBrands = [
  "AllSaints", "Aligne", "AMI Paris", "A.P.C.", "Aquascutum", "Arket", "Arc'teryx",
  "Atmosphere", "Banana Republic", "Baracuta", "Barbour", "Barbour Beacon",
  "Barbour International", "Barbour Gold Standard", "Belstaff", "Ben Sherman",
  "Bershka", "Blue Harbour", "BoohooMAN", "Brakeburn", "Burton", "Calvin Klein Jeans",
  "Carhartt WIP", "Charles Tyrwhitt", "Cheaney", "Church's", "CP Company",
  "Crockett & Jones", "Cotton On", "Crew Clothing", "Diesel", "Dr. Martens Made in England",
  "Dune Mens", "Eton Shirts", "Filson", "French Connection", "GANT", "Grenson",
  "Hackett", "H&M", "Jaeger", "John Smedley", "Lacoste", "Levi's", "Loake",
  "Patagonia", "Paul Smith", "Ralph Lauren (Standard)", "Reiss", "RM Williams",
  "Stone Island", "Ted Baker", "Timberland", "Tommy Hilfiger", "Tricker's",
  "Turnbull & Asser", "Whistles Mens", "Wrangler", "Zara"
].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

const Sourcing: React.FC = () => {
  const [searchText, setSearchText] = useState('');
  const [category, setCategory] = useState<string>('');
  const [priceTo, setPriceTo] = useState<string>('8');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [allBrands, setAllBrands] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Quick search buttons (for convenience, separate from typeahead data source)
  const quickSearchBrands = ['Diesel Jeans', 'Ralph Trousers', 'Tommy', 'Hogs Of Fife', 'Paul Smith', 'GANT', 'Nudie Jeans', 'Hackett', 'North Face', 'Levis'];

  const handleSearch = () => {
    if (!searchText.trim()) {
      return;
    }

    // URL encode the search text
    const encodedSearchText = encodeURIComponent(searchText.trim());
    
    // Base URL parameters
    let vintedUrl = `https://www.vinted.co.uk/catalog?search_text=${encodedSearchText}&order=newest_first&catalog[]=5&status_ids[]=2&status_ids[]=1&status_ids[]=6`;
    
    // Append size_ids parameters based on selected category
    if (category === 'top') {
      vintedUrl += `&size_ids[]=208&size_ids[]=209&size_ids[]=210&size_ids[]=211`;
    } else if (category === 'trousers') {
      vintedUrl += `&size_ids[]=1642&size_ids[]=1662&size_ids[]=1643&size_ids[]=1644&size_ids[]=1645`;
    }
    
    // Append price_to parameter
    const priceValue = priceTo.trim() || '8';
    vintedUrl += `&price_to=${encodeURIComponent(priceValue)}&currency=GBP`;
    
    window.open(vintedUrl, '_blank', 'noopener,noreferrer');
  };


  // Load brands from API (same source as Research page)
  useEffect(() => {
    const loadBrands = async () => {
      try {
        console.log(`Fetching brands from: ${API_BASE}/api/mens-resale-reference`);
        const response = await fetch(`${API_BASE}/api/mens-resale-reference`);
        console.log('Response status:', response.status, response.statusText);
        
        if (response.ok) {
          const data = await response.json();
          console.log('Received data:', data?.length || 0, 'items');
          
          if (Array.isArray(data) && data.length > 0) {
            const brandNames = data
              .map((item: { brand: string }) => item.brand)
              .filter((brand: string) => brand && typeof brand === 'string')
              .sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
            
            setAllBrands(brandNames);
            console.log(`Loaded ${brandNames.length} brands from API for sourcing`);
          } else {
            console.warn('API returned empty or invalid data');
          }
        } else {
          const errorText = await response.text();
          console.error('API response not OK:', response.status, errorText);
        }
      } catch (error) {
        console.error('Failed to load brands from API:', error);
        // Use fallback brands if API fails
        console.log('Using fallback brands list');
        setAllBrands(fallbackBrands);
      }
    };

    loadBrands();
  }, []);

  const filteredBrands = allBrands.filter(brand =>
    brand.toLowerCase().includes(searchText.toLowerCase())
  );

  // Debug logging
  useEffect(() => {
    console.log('Typeahead state:', {
      allBrandsCount: allBrands.length,
      searchText,
      filteredBrandsCount: filteredBrands.length,
      showSuggestions,
      filteredBrandsSample: filteredBrands.slice(0, 5)
    });
  }, [allBrands, searchText, filteredBrands, showSuggestions]);

  const handleBrandClick = (brand: string) => {
    setSearchText(brand);
    setShowSuggestions(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(e.target.value);
    setSelectedIndex(-1);
  };

  // Update suggestions visibility when filteredBrands changes
  useEffect(() => {
    if (searchText.trim().length > 0 && filteredBrands.length > 0) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [searchText, filteredBrands]);

  const handleInputFocus = () => {
    if (searchText.trim() && filteredBrands.length > 0) {
      setShowSuggestions(true);
    }
  };

  const handleInputBlur = (e: React.FocusEvent) => {
    // Delay hiding suggestions to allow click events to fire
    setTimeout(() => {
      if (!suggestionsRef.current?.contains(document.activeElement)) {
        setShowSuggestions(false);
        setSelectedIndex(-1);
      }
    }, 200);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (selectedIndex >= 0 && filteredBrands[selectedIndex]) {
        handleBrandClick(filteredBrands[selectedIndex]);
        e.preventDefault();
      } else {
        handleSearch();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setShowSuggestions(true);
      setSelectedIndex(prev => 
        prev < filteredBrands.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(event.target as Node) &&
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
        setSelectedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="sourcing-container">
      <h2>Sourcing</h2>
      <div className="sourcing-search-section">
        <div className="sourcing-input-group">
          <div className="sourcing-autocomplete-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="sourcing-search-input"
              placeholder="research page search brands"
              value={searchText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
            />
            {showSuggestions && filteredBrands.length > 0 && (
              <div ref={suggestionsRef} className="sourcing-suggestions">
                {filteredBrands.map((brand, index) => (
                  <div
                    key={brand}
                    className={`sourcing-suggestion-item ${
                      index === selectedIndex ? 'sourcing-suggestion-selected' : ''
                    }`}
                    onClick={() => handleBrandClick(brand)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    {brand}
                  </div>
                ))}
              </div>
            )}
          </div>
          <select
            className="sourcing-category-select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Select category...</option>
            <option value="trousers">Trousers</option>
            <option value="top">Top</option>
          </select>
          <input
            type="number"
            className="sourcing-price-input"
            placeholder="Max price"
            value={priceTo}
            onChange={(e) => setPriceTo(e.target.value)}
            min="0"
            step="0.01"
          />
          <button
            type="button"
            className="sourcing-search-button"
            onClick={handleSearch}
            disabled={!searchText.trim()}
          >
            Search
          </button>
        </div>
        <div className="sourcing-brands-section">
          <div className="sourcing-brands-label">Quick Search Brands:</div>
          <div className="sourcing-brands-list">
            {quickSearchBrands.map((brand) => (
              <button
                key={brand}
                type="button"
                className="sourcing-brand-button"
                onClick={() => handleBrandClick(brand)}
              >
                {brand}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sourcing;

