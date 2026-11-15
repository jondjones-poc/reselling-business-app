import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getApiBase, apiFetch } from '../utils/apiBase';
import { StockFormDropdown } from './StockFormDropdown';
import './Sourcing.css';
import './Stock.css';

const API_BASE = getApiBase();

const SOURCING_CATEGORY_OPTIONS = [
  { value: 'trousers', label: 'Trousers' },
  { value: 'top', label: 'Top' },
];

// Vinted "Men's sizes" filter options (catalog[]=5), read directly from
// vinted.co.uk's own size filter dropdown — id -> label, in the order Vinted
// displays them. Used for Top / default category searches; Trousers has its
// own separate waist-size filter below and isn't affected by this list.
const VINTED_SIZE_OPTIONS = [
  { id: '206', label: 'XS' },
  { id: '207', label: 'S' },
  { id: '208', label: 'M' },
  { id: '209', label: 'L' },
  { id: '210', label: 'XL' },
  { id: '211', label: 'XXL' },
  { id: '212', label: 'XXXL' },
  { id: '308', label: '4XL' },
  { id: '309', label: '5XL' },
  { id: '1192', label: '6XL' },
  { id: '1193', label: '7XL' },
  { id: '1194', label: '8XL' },
  { id: '213', label: 'One size' },
];

const DEFAULT_SIZE_IDS = ['208', '209', '210', '211', '212'];

// Vinted "Condition" filter options (status_ids), read directly from
// vinted.co.uk's own Condition filter dropdown — id -> label.
const VINTED_CONDITION_OPTIONS = [
  { id: '6', label: 'New with tags' },
  { id: '1', label: 'New without tags' },
  { id: '2', label: 'Very good' },
  { id: '3', label: 'Good' },
  { id: '4', label: 'Satisfactory' },
];

const DEFAULT_STATUS_IDS = ['6', '1', '2'];

interface SavedSearch {
  id: number;
  name: string;
  search_text: string;
  category: string;
  price_from: string | number | null;
  price_to: string | number | null;
  size_ids: string[];
  status_ids: string[];
}

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
  const [priceFrom, setPriceFrom] = useState<string>('0');
  const [priceTo, setPriceTo] = useState<string>('8.00');
  const [selectedSizeIds, setSelectedSizeIds] = useState<string[]>(DEFAULT_SIZE_IDS);
  const [selectedStatusIds, setSelectedStatusIds] = useState<string[]>(DEFAULT_STATUS_IDS);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [allBrands, setAllBrands] = useState<string[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [savedSearchName, setSavedSearchName] = useState('');
  const [savedSearchError, setSavedSearchError] = useState('');
  const [savingSearch, setSavingSearch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const loadSavedSearches = useCallback(async () => {
    try {
      const response = await apiFetch('/api/saved-searches');
      if (!response.ok) return;
      const data = await response.json();
      setSavedSearches(Array.isArray(data.rows) ? data.rows : []);
    } catch (error) {
      console.error('Failed to load saved searches:', error);
    }
  }, []);

  useEffect(() => {
    loadSavedSearches();
  }, [loadSavedSearches]);

  const handleSearch = () => {
    if (!searchText.trim()) {
      return;
    }

    // URL encode the search text
    const encodedSearchText = encodeURIComponent(searchText.trim());

    // Base URL parameters
    let vintedUrl = `https://www.vinted.co.uk/catalog?search_text=${encodedSearchText}&order=newest_first&catalog[]=5`;
    for (const statusId of selectedStatusIds) {
      vintedUrl += `&status_ids[]=${encodeURIComponent(statusId)}`;
    }

    // Append size_ids parameters based on selected category.
    if (category === 'top' || category === '') {
      for (const sizeId of selectedSizeIds) {
        vintedUrl += `&size_ids[]=${encodeURIComponent(sizeId)}`;
      }
    } else if (category === 'trousers') {
      vintedUrl += `&size_ids[]=1642&size_ids[]=1662&size_ids[]=1643&size_ids[]=1644&size_ids[]=1645`;
    }
    
    // Append price_from / price_to parameters
    const priceFromValue = priceFrom.trim() || '0';
    const priceToValue = priceTo.trim() || '8.00';
    vintedUrl += `&price_from=${encodeURIComponent(priceFromValue)}&price_to=${encodeURIComponent(priceToValue)}&currency=GBP`;
    
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

  const handleToggleSize = (sizeId: string) => {
    setSelectedSizeIds((prev) =>
      prev.includes(sizeId) ? prev.filter((id) => id !== sizeId) : [...prev, sizeId]
    );
  };

  const handleClearSizes = () => {
    setSelectedSizeIds([]);
  };

  const handleToggleStatus = (statusId: string) => {
    setSelectedStatusIds((prev) =>
      prev.includes(statusId) ? prev.filter((id) => id !== statusId) : [...prev, statusId]
    );
  };

  const handleSaveSearch = async () => {
    const name = savedSearchName.trim();
    if (!name || savingSearch) return;
    setSavingSearch(true);
    setSavedSearchError('');
    try {
      const response = await apiFetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          search_text: searchText.trim(),
          category,
          price_from: priceFrom.trim() || null,
          price_to: priceTo.trim() || null,
          size_ids: selectedSizeIds,
          status_ids: selectedStatusIds,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSavedSearchError(data.error || 'Could not save this search.');
        return;
      }
      setSavedSearchName('');
      await loadSavedSearches();
    } catch (error) {
      setSavedSearchError(error instanceof Error ? error.message : 'Could not save this search.');
    } finally {
      setSavingSearch(false);
    }
  };

  const handleLoadSavedSearch = (saved: SavedSearch) => {
    setSearchText(saved.search_text);
    setCategory(saved.category);
    setPriceFrom(saved.price_from !== null && saved.price_from !== undefined ? String(saved.price_from) : '0');
    setPriceTo(saved.price_to !== null && saved.price_to !== undefined ? String(saved.price_to) : '8.00');
    setSelectedSizeIds(Array.isArray(saved.size_ids) ? saved.size_ids : []);
    setSelectedStatusIds(Array.isArray(saved.status_ids) ? saved.status_ids : []);
  };

  const handleDeleteSavedSearch = async (id: number) => {
    try {
      const response = await apiFetch(`/api/saved-searches/${id}`, { method: 'DELETE' });
      if (!response.ok) return;
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    } catch (error) {
      console.error('Failed to delete saved search:', error);
    }
  };

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
          <button
            type="button"
            className="sourcing-search-button"
            onClick={handleSearch}
            disabled={!searchText.trim()}
          >
            Search
          </button>
        </div>
        <div className="sourcing-filters-table">
          <div className="sourcing-filters-row">
            <div className="sourcing-filters-label">Condition</div>
            <div className="sourcing-filters-control">
              <div className="sourcing-sizes-list">
                {VINTED_CONDITION_OPTIONS.map((status) => (
                  <button
                    key={status.id}
                    type="button"
                    className={`sourcing-size-button ${
                      selectedStatusIds.includes(status.id) ? 'sourcing-size-button--active' : ''
                    }`}
                    onClick={() => handleToggleStatus(status.id)}
                    aria-pressed={selectedStatusIds.includes(status.id)}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="sourcing-filters-row">
            <div className="sourcing-filters-label">Sizes</div>
            <div className="sourcing-filters-control">
              <div className="sourcing-sizes-list">
                {VINTED_SIZE_OPTIONS.map((size) => (
                  <button
                    key={size.id}
                    type="button"
                    className={`sourcing-size-button ${
                      selectedSizeIds.includes(size.id) ? 'sourcing-size-button--active' : ''
                    }`}
                    onClick={() => handleToggleSize(size.id)}
                    aria-pressed={selectedSizeIds.includes(size.id)}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="sourcing-filters-row">
            <div className="sourcing-filters-label">Price (£)</div>
            <div className="sourcing-filters-control">
              <div className="sourcing-price-inputs">
                <label className="sourcing-price-field">
                  <span className="sourcing-price-field-label">Min</span>
                  <input
                    type="number"
                    className="sourcing-price-input"
                    placeholder="0.00"
                    value={priceFrom}
                    onChange={(e) => setPriceFrom(e.target.value)}
                    min="0"
                    step="0.01"
                  />
                </label>
                <label className="sourcing-price-field">
                  <span className="sourcing-price-field-label">Max</span>
                  <input
                    type="number"
                    className="sourcing-price-input"
                    placeholder="8.00"
                    value={priceTo}
                    onChange={(e) => setPriceTo(e.target.value)}
                    min="0"
                    step="0.01"
                  />
                </label>
              </div>
            </div>
          </div>
          <div className="sourcing-filters-row">
            <div className="sourcing-filters-label">Category</div>
            <div className="sourcing-filters-control">
              <StockFormDropdown
                value={category}
                options={SOURCING_CATEGORY_OPTIONS}
                onChange={setCategory}
                placeholder="Select category..."
                includeEmptyOption={true}
                ariaLabel="Vinted category filter"
                className="sourcing-category-dropdown"
              />
            </div>
          </div>
        </div>
        <hr className="sourcing-divider" />
        <div className="sourcing-brands-section">
          <div className="sourcing-save-search-row">
            <input
              type="text"
              className="sourcing-save-search-input"
              placeholder="Name this search…"
              value={savedSearchName}
              onChange={(e) => setSavedSearchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSaveSearch();
                }
              }}
            />
            <button
              type="button"
              className="sourcing-save-search-button"
              onClick={() => void handleSaveSearch()}
              disabled={!savedSearchName.trim() || savingSearch}
            >
              {savingSearch ? 'Saving…' : 'Save current search'}
            </button>
          </div>
          {savedSearchError && <div className="sourcing-save-search-error">{savedSearchError}</div>}
          <div className="sourcing-brands-list">
            {savedSearches.map((saved) => (
              <span key={saved.id} className="sourcing-saved-search-chip">
                <button
                  type="button"
                  className="sourcing-brand-button"
                  onClick={() => handleLoadSavedSearch(saved)}
                >
                  {saved.name}
                </button>
                <button
                  type="button"
                  className="sourcing-saved-search-delete"
                  onClick={() => void handleDeleteSavedSearch(saved.id)}
                  aria-label={`Delete saved search ${saved.name}`}
                  title="Delete"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="sourcing-clear-form-row">
          <button
            type="button"
            className="sourcing-sizes-clear-button"
            onClick={handleClearSizes}
            disabled={selectedSizeIds.length === 0}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};

export default Sourcing;

