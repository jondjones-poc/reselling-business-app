import React, { useEffect, useState } from 'react';
import BarcodeScanner from 'react-qr-barcode-scanner';
import './EbaySearch.css';
import './BrandResearch.css';

interface AppSettings {
  categories: string[];
  material: string[];
  colors: string[];
  patterns: string[];
  brands: string[];
  gender: string[];
}

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

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';
const DEFAULT_GENDER = 'Mens';

const EbaySearch: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [genders, setGenders] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedPattern, setSelectedPattern] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedGender, setSelectedGender] = useState(DEFAULT_GENDER);
  const [itemsSold, setItemsSold] = useState('');
  const [activeListings, setActiveListings] = useState('');
  const [strRate, setStrRate] = useState<number | null>(null);
  const [ebayResearchLoading, setEbayResearchLoading] = useState(false);
  const [ebayResearchError, setEbayResearchError] = useState<string | null>(null);
  const [ebayResearchResult, setEbayResearchResult] = useState<ResearchResult | null>(null);
  
  // Potential Profit Calculator state
  const [itemPrice, setItemPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [listingFees, setListingFees] = useState('1.50');
  const [promotedFees, setPromotedFees] = useState('10');

  const genderOptions = genders.length > 0 ? genders : [DEFAULT_GENDER];

  const hasSearchableInput = [
    searchTerm,
    selectedCategory,
    selectedMaterial,
    selectedColor,
    selectedPattern,
    selectedBrand,
    scannedData ?? ''
  ].some((value) => value.trim().length > 0);

  const resolveDefaultGender = (availableGenders: string[]) => {
    if (!availableGenders || availableGenders.length === 0) {
      return DEFAULT_GENDER;
    }

    const matchedDefault = availableGenders.find(
      (gender) => gender.toLowerCase() === DEFAULT_GENDER.toLowerCase()
    );

    return matchedDefault ?? availableGenders[0];
  };

  const buildSearchTokens = () => {
    const tokens: string[] = [];

    const trimmedSearch = searchTerm.trim();
    const trimmedGender = selectedGender.trim();
    const trimmedCategory = selectedCategory.trim();
    const trimmedMaterial = selectedMaterial.trim();
    const trimmedColor = selectedColor.trim();
    const trimmedPattern = selectedPattern.trim();
    const trimmedBrand = selectedBrand.trim();

    if (trimmedSearch) {
      tokens.push(trimmedSearch);
    }

    if (trimmedGender && trimmedGender.toLowerCase() !== 'none') {
      tokens.push(trimmedGender);
    }

    if (trimmedCategory) {
      tokens.push(trimmedCategory);
    }

    if (trimmedMaterial) {
      tokens.push(trimmedMaterial);
    }

    if (trimmedColor) {
      tokens.push(trimmedColor);
    }

    if (trimmedPattern) {
      tokens.push(trimmedPattern);
    }

    if (trimmedBrand) {
      tokens.push(trimmedBrand);
    }

    const uniqueTokens = tokens.filter((token, index) => tokens.indexOf(token) === index);

    return uniqueTokens;
  };

  const clearAll = () => {
    setSearchTerm('');
    setSelectedCategory('');
    setSelectedMaterial('');
    setSelectedColor('');
    setSelectedPattern('');
    setSelectedBrand('');
    setSelectedGender(resolveDefaultGender(genders));
    setScannedData(null);
    setShowScanner(false);
  };

  const handleCopyToClipboard = async () => {
    const tokens = buildSearchTokens();
    if (tokens.length === 0) {
      return;
    }

    const combined = tokens.join(' ');

    try {
      await navigator.clipboard.writeText(combined);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  // Restore search term from localStorage on mount
  useEffect(() => {
    try {
      const savedSearchTerm = window.localStorage.getItem('searchTerm');
      if (savedSearchTerm) {
        setSearchTerm(savedSearchTerm);
      }
    } catch (storageError) {
      console.warn('Unable to restore search term from localStorage:', storageError);
    }
  }, []);

  useEffect(() => {
    const sanitizeCategories = (rawCategories: unknown): string[] => {
      if (!Array.isArray(rawCategories)) {
        return [];
      }

      const sanitized = rawCategories
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

      return Array.from(new Set(sanitized)).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
    };

    const fetchSettings = async () => {
      const applySettings = (data: Partial<AppSettings> | null) => {
        if (!data) {
          return false;
        }

        const sanitizedCategories = sanitizeCategories(data.categories);
        const sortedMaterials = [...(data.material ?? [])].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        const sortedColors = [...(data.colors ?? [])].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        const sortedPatterns = [...(data.patterns ?? [])].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        const sortedBrands = [...(data.brands ?? [])].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        const sanitizedGenders = Array.from(
          new Set(
            (data.gender ?? [])
              .filter((item): item is string => typeof item === 'string')
              .map((item) => item.trim())
              .filter((item) => item.length > 0)
          )
        );

        if (sanitizedGenders.length === 0) {
          sanitizedGenders.push(DEFAULT_GENDER);
        }

        const defaultGenderValue = resolveDefaultGender(sanitizedGenders);

        setCategories(sanitizedCategories);
        setMaterials(sortedMaterials);
        setColors(sortedColors);
        setPatterns(sortedPatterns);
        setBrands(sortedBrands);
        setGenders(sanitizedGenders);
        setSelectedGender((previous) =>
          sanitizedGenders.includes(previous) ? previous : defaultGenderValue
        );

        return (
          sanitizedCategories.length > 0 ||
          sortedColors.length > 0 ||
          sortedMaterials.length > 0 ||
          sortedBrands.length > 0 ||
          sortedPatterns.length > 0 ||
          sanitizedGenders.length > 0
        );
      };

      try {
        setSettingsLoading(true);
        setSettingsError(null);

        // Try API fetch with timeout to prevent hanging on mobile
        let apiSuccess = false;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout for mobile

          const apiResponse = await fetch(`${API_BASE}/api/settings`, {
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          
          if (apiResponse.ok) {
            const apiData: AppSettings = await apiResponse.json();
            const applied = applySettings(apiData);
            if (applied && apiData.colors?.length) {
              apiSuccess = true;
            }
          }
        } catch (apiError: any) {
          // If it's an abort (timeout) or network error, log and continue to fallback
          if (apiError.name === 'AbortError') {
            console.warn('API request timed out, using fallback settings');
          } else {
            console.warn('API request failed, using fallback settings:', apiError);
          }
        }

        // If API succeeded, we're done
        if (apiSuccess) {
          setSettingsLoading(false);
          return;
        }

        // Otherwise, try fallback (this will always run if API fails or times out)
        const fallbackResponse = await fetch('/app-settings.json');
        if (!fallbackResponse.ok) {
          throw new Error(`Fallback settings not found: ${fallbackResponse.status}`);
        }
        const fallbackData: AppSettings = await fallbackResponse.json();
        const appliedFallback = applySettings(fallbackData);
        if (!appliedFallback) {
          throw new Error('Fallback settings did not contain usable data');
        }
      } catch (fallbackError) {
        console.error('Error loading fallback settings:', fallbackError);
        setSettingsError('Unable to load configuration settings.');
      } finally {
        setSettingsLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleCategorySelect = (value: string) => {
    setSelectedCategory(value);
  };

  const handleMaterialSelect = (value: string) => {
    setSelectedMaterial(value);
  };

  const handleColorSelect = (value: string) => {
    setSelectedColor(value);
  };

  const handlePatternSelect = (value: string) => {
    setSelectedPattern(value);
  };

  const handleBrandSelect = (value: string) => {
    setSelectedBrand(value);
  };

  const handleGenderSelect = (value: string) => {
    if (!value) {
      setSelectedGender(resolveDefaultGender(genders));
      return;
    }

    setSelectedGender(value);
  };

  const handleCalculateSTR = () => {
    const sold = Number(itemsSold);
    const active = Number(activeListings);

    if (isNaN(sold) || isNaN(active) || sold < 0 || active < 0) {
      setStrRate(null);
      return;
    }

    const totalInventory = sold + active;
    if (totalInventory === 0) {
      setStrRate(null);
      return;
    }

    const rate = (sold / totalInventory) * 100;
    setStrRate(rate);
  };

  const getSTRColor = (rate: number | null): string => {
    if (rate === null) return '';
    if (rate >= 70) return 'str-strong';
    if (rate >= 50) return 'str-safe';
    if (rate >= 30) return 'str-risky';
    return 'str-skip';
  };

  const getSTRLabel = (rate: number | null): string => {
    if (rate === null) return '';
    if (rate >= 70) return 'Strong buy. Sells fast.';
    if (rate >= 50) return 'Safe buy. Good demand.';
    if (rate >= 30) return 'Risky. Price must be cheap.';
    return 'Usually skip.';
  };

  const handleBarcodeScan = (err: any, result: any) => {
    if (result) {
      setScannedData(result.text);
      setSearchTerm(result.text);
      setShowScanner(false);
    } else if (err) {
      console.error('Barcode scan error:', err);
    }
  };

  const handleEbayResearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Use the main search form tokens
    const queryToUse = buildSearchTokens().join(' ');
    if (!queryToUse) {
      setEbayResearchError('Please enter a search term in the main search form');
      return;
    }

    setEbayResearchLoading(true);
    setEbayResearchError(null);
    setEbayResearchResult(null);

    try {
      const params = new URLSearchParams({ q: queryToUse });
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
      setEbayResearchResult(data);
    } catch (err: any) {
      console.error('Research fetch error:', err);
      setEbayResearchError(err.message || 'Unable to load research data. Please try again later.');
    } finally {
      setEbayResearchLoading(false);
    }
  };

  const handleClearEbayResearch = () => {
    setEbayResearchResult(null);
    setEbayResearchError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const searchTokens = [
      ...buildSearchTokens()
    ];

    if (searchTokens.length === 0) {
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
    
    const combinedSearchTerm = searchTokens.join(' ');

    // Store only the actual searchTerm value, not the combined tokens
    try {
      window.localStorage.setItem('searchTerm', searchTerm);
    } catch (storageError) {
      console.warn('Unable to persist search term to localStorage:', storageError);
    }
    const encodedSearch = encodeURIComponent(combinedSearchTerm);
    const soldUrl = `https://www.ebay.co.uk/sch/260012/i.html?_nkw=${encodedSearch}&_from=R40&rt=nc&LH_Sold=1&LH_Complete=1&LH_PrefLoc=1`;
    
    // Open sold URL directly in new tab
    window.open(soldUrl, '_blank');
  };

  const handleSearchActives = (e: React.FormEvent) => {
    e.preventDefault();
    
    const searchTokens = [
      ...buildSearchTokens()
    ];

    if (searchTokens.length === 0) {
      return;
    }

    // Build eBay UK search URL for active listings (no sold/completed filters)
    // 260012 is Men's Clothing category
    // _from=R40 - Search from category
    // rt=nc - Return type
    // Using .ebay.co.uk domain ensures UK marketplace
    // Adding LH_PrefLoc=1 for UK preferred location
    
    const combinedSearchTerm = searchTokens.join(' ');

    try {
      window.localStorage.setItem('saerch term', combinedSearchTerm);
    } catch (storageError) {
      console.warn('Unable to persist search term to localStorage:', storageError);
    }
    const encodedSearch = encodeURIComponent(combinedSearchTerm);
    // Only build active URL - no sold/completed filters
    const activeUrl = `https://www.ebay.co.uk/sch/260012/i.html?_nkw=${encodedSearch}&_from=R40&rt=nc&LH_PrefLoc=1`;
    
    // Open active URL directly in new tab
    window.open(activeUrl, '_blank');
  };

  return (
    <>
    <div className="ebay-search-container">
      <form onSubmit={handleSubmit} className="ebay-search-form">
        {!showScanner ? (
          <>
            <div className="search-bar-group">
              <div className="search-input-wrapper">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Enter search term (e.g., joop jumper, nike shoes)"
                  className="ebay-search-input"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={clearAll}
                  className="reset-icon-button"
                  disabled={!hasSearchableInput}
                  title="Reset all fields"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="primary-action-row">
              <button
                type="submit"
                className="ebay-search-button"
                disabled={!hasSearchableInput}
              >
                Search Solds
              </button>
              <button
                type="button"
                onClick={handleSearchActives}
                className="ebay-search-button"
                disabled={!hasSearchableInput}
              >
                Search Actives
              </button>
              <button
                type="button"
                onClick={handleCopyToClipboard}
                className="copy-button"
                disabled={!hasSearchableInput}
              >
                📋 Copy
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

        <div className="category-section">
          <div className="category-control">
            <select
              id="color-select"
              value={selectedColor}
              onChange={(e) => handleColorSelect(e.target.value)}
              className="dropdown-select"
              disabled={colors.length === 0}
            >
              <option value="">Colors</option>
              {colors.map((colorName) => (
                <option key={colorName} value={colorName}>
                  {colorName}
                </option>
              ))}
            </select>
          </div>

          <div className="category-control">
            <select
              id="material-select"
              value={selectedMaterial}
              onChange={(e) => handleMaterialSelect(e.target.value)}
              className="dropdown-select"
              disabled={materials.length === 0}
            >
              <option value="">Materials</option>
              {materials.map((materialName) => (
                <option key={materialName} value={materialName}>
                  {materialName}
                </option>
              ))}
            </select>
          </div>

          <div className="category-control">
            <select
              id="pattern-select"
              value={selectedPattern}
              onChange={(e) => handlePatternSelect(e.target.value)}
              className="dropdown-select"
              disabled={patterns.length === 0}
            >
              <option value="">Patterns</option>
              {patterns.map((patternName) => (
                <option key={patternName} value={patternName}>
                  {patternName}
                </option>
              ))}
            </select>
          </div>

          <div className="category-control">
            <select
              id="category-select"
              value={selectedCategory}
              onChange={(e) => handleCategorySelect(e.target.value)}
              className="dropdown-select"
              disabled={settingsLoading || categories.length === 0}
            >
              <option value="">Categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="category-control">
            <select
              id="brand-select"
              value={selectedBrand}
              onChange={(e) => handleBrandSelect(e.target.value)}
              className="dropdown-select"
              disabled={brands.length === 0}
            >
              <option value="">Brands</option>
              {brands.map((brandName) => (
                <option key={brandName} value={brandName}>
                  {brandName}
                </option>
              ))}
            </select>
          </div>

          <div className="category-control">
            <select
              id="gender-select"
              value={selectedGender}
              onChange={(e) => handleGenderSelect(e.target.value)}
              className="dropdown-select"
              disabled={genderOptions.length === 0}
            >
              {genderOptions.map((gender) => (
                <option key={gender} value={gender}>
                  {gender}
                </option>
              ))}
            </select>
          </div>
        </div>


        {settingsLoading && (
          <div className="settings-status">Loading settings...</div>
        )}

        {settingsError && (
          <div className="settings-error">{settingsError}</div>
        )}
      </form>
    </div>

    <div className="ebay-search-container">
      <div className="str-calculator-section">
        <div className="str-calculator-inputs">
          <div className="str-input-group">
            <label htmlFor="items-sold" className="str-input-label">Sold Rate</label>
            <input
              id="items-sold"
              type="number"
              value={itemsSold}
              onChange={(e) => setItemsSold(e.target.value)}
              placeholder="0"
              className="str-input"
              min="0"
            />
          </div>
          <div className="str-input-group">
            <label htmlFor="active-listings" className="str-input-label">Active Listings</label>
            <input
              id="active-listings"
              type="number"
              value={activeListings}
              onChange={(e) => setActiveListings(e.target.value)}
              placeholder="0"
              className="str-input"
              min="0"
            />
          </div>
          <button
            type="button"
            onClick={handleCalculateSTR}
            className="str-calculate-button"
            disabled={!itemsSold || !activeListings}
          >
            Item Sell Through Rate
          </button>
        </div>
        {strRate !== null && (
          <div className={`str-result ${getSTRColor(strRate)}`}>
            <div className="str-rate-value">{strRate.toFixed(1)}%</div>
            <div className="str-rate-label">{getSTRLabel(strRate)}</div>
            <div className="str-rate-formula">
              ({itemsSold} / ({itemsSold} + {activeListings})) × 100 = {strRate.toFixed(1)}%
            </div>
          </div>
        )}
      </div>
    </div>

    <div className="ebay-search-container">
      <div className="potential-profit-section">
        <h3 className="potential-profit-title">Potential Profit</h3>
        <div className="potential-profit-form">
          <div className="potential-profit-inputs">
            <div className="potential-profit-input-group">
              <label htmlFor="item-price" className="potential-profit-label">Item Price</label>
              <input
                id="item-price"
                type="number"
                value={itemPrice}
                onChange={(e) => setItemPrice(e.target.value)}
                placeholder="0.00"
                className="potential-profit-input"
                step="0.01"
                min="0"
              />
            </div>
            <div className="potential-profit-input-group">
              <label htmlFor="sale-price" className="potential-profit-label">Sale Price</label>
              <input
                id="sale-price"
                type="number"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="0.00"
                className="potential-profit-input"
                step="0.01"
                min="0"
              />
            </div>
            <div className="potential-profit-input-group">
              <label htmlFor="listing-fees" className="potential-profit-label">Listing Fees</label>
              <input
                id="listing-fees"
                type="number"
                value={listingFees}
                onChange={(e) => setListingFees(e.target.value)}
                placeholder="1.50"
                className="potential-profit-input"
                step="0.01"
                min="0"
              />
            </div>
            <div className="potential-profit-input-group">
              <label htmlFor="promoted-fees" className="potential-profit-label">Promoted Fees (%)</label>
              <input
                id="promoted-fees"
                type="number"
                value={promotedFees}
                onChange={(e) => setPromotedFees(e.target.value)}
                placeholder="10"
                className="potential-profit-input"
                step="0.1"
                min="0"
                max="100"
              />
            </div>
          </div>

          <div className="potential-profit-results">
            <div className="potential-profit-platform">
              <div className="potential-profit-platform-label">Vinted</div>
              <div className="potential-profit-platform-value">
                {(() => {
                  const hasBothPrices = itemPrice && salePrice && itemPrice.trim() !== '' && salePrice.trim() !== '';
                  if (!hasBothPrices) {
                    return '£0.00';
                  }
                  const item = parseFloat(itemPrice) || 0;
                  const sale = parseFloat(salePrice) || 0;
                  const profit = sale - item;
                  return profit >= 0 ? `£${profit.toFixed(2)}` : `-£${Math.abs(profit).toFixed(2)}`;
                })()}
              </div>
              {(() => {
                const hasBothPrices = itemPrice && salePrice && itemPrice.trim() !== '' && salePrice.trim() !== '';
                if (!hasBothPrices) {
                  return null;
                }
                const item = parseFloat(itemPrice) || 0;
                const sale = parseFloat(salePrice) || 0;
                const profit = sale - item;
                const isBuy = item > 0 && profit >= (item * 2);
                return (
                  <div className={`potential-profit-tag ${isBuy ? 'potential-profit-buy' : 'potential-profit-avoid'}`}>
                    {isBuy ? 'Buy' : 'Avoid'}
                  </div>
                );
              })()}
            </div>
            <div className="potential-profit-platform">
              <div className="potential-profit-platform-label">eBay</div>
              <div className="potential-profit-platform-values">
                {(() => {
                  const hasBothPrices = itemPrice && salePrice && itemPrice.trim() !== '' && salePrice.trim() !== '';
                  
                  if (!hasBothPrices) {
                    return (
                      <>
                        <div className="potential-profit-value-group">
                          <div className="potential-profit-platform-value">£0.00</div>
                        </div>
                        <div className="potential-profit-separator">|</div>
                        <div className="potential-profit-value-group">
                          <div className="potential-profit-platform-value">£0.00</div>
                        </div>
                        <div className="potential-profit-promo-fee">(promotion fee: £0.00)</div>
                      </>
                    );
                  }
                  
                  const item = parseFloat(itemPrice) || 0;
                  const sale = parseFloat(salePrice) || 0;
                  const listing = parseFloat(listingFees) || 0;
                  const promotedPercent = parseFloat(promotedFees) || 0;
                  const promotedFee = (sale * promotedPercent) / 100;
                  
                  // Profit without promotion
                  const profitWithoutPromo = sale - (item + listing);
                  const profitWithoutPromoDisplay = profitWithoutPromo >= 0 ? `£${profitWithoutPromo.toFixed(2)}` : `-£${Math.abs(profitWithoutPromo).toFixed(2)}`;
                  
                  // Profit with promotion
                  const totalCosts = item + listing + promotedFee;
                  const profitWithPromo = sale - totalCosts;
                  const profitWithPromoDisplay = profitWithPromo >= 0 ? `£${profitWithPromo.toFixed(2)}` : `-£${Math.abs(profitWithPromo).toFixed(2)}`;
                  
                  const isBuyWithoutPromo = item > 0 && profitWithoutPromo >= (item * 2);
                  const isBuyWithPromo = item > 0 && profitWithPromo >= (item * 2);
                  
                  return (
                    <>
                      <div className="potential-profit-value-group">
                        <div className="potential-profit-platform-value">{profitWithoutPromoDisplay}</div>
                        <div className={`potential-profit-tag ${isBuyWithoutPromo ? 'potential-profit-buy' : 'potential-profit-avoid'}`}>
                          {isBuyWithoutPromo ? 'Buy' : 'Avoid'}
                        </div>
                      </div>
                      <div className="potential-profit-separator">|</div>
                      <div className="potential-profit-value-group">
                        <div className="potential-profit-platform-value">{profitWithPromoDisplay}</div>
                        <div className={`potential-profit-tag ${isBuyWithPromo ? 'potential-profit-buy' : 'potential-profit-avoid'}`}>
                          {isBuyWithPromo ? 'Buy' : 'Avoid'}
                        </div>
                      </div>
                      <div className="potential-profit-promo-fee">(promotion fee: £{promotedFee.toFixed(2)})</div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          <div className="potential-profit-reset-container">
            <button
              type="button"
              onClick={() => {
                setItemPrice('');
                setSalePrice('');
                setListingFees('1.50');
                setPromotedFees('10');
              }}
              className="potential-profit-reset-button"
              title="Reset form"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div className="ebay-search-container">
      <div className="ebay-research-section">
        <form onSubmit={handleEbayResearchSubmit} className="ebay-search-form">
          <div className="primary-action-row research-action-row" style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              type="submit"
              className="ebay-search-button"
              disabled={ebayResearchLoading || !hasSearchableInput}
            >
              {ebayResearchLoading ? 'Searching...' : 'Search Click-Through Rate'}
            </button>
            {ebayResearchResult && (
              <button
                type="button"
                onClick={handleClearEbayResearch}
                className="research-clear-button clear-red"
              >
                Clear
              </button>
            )}
          </div>

          {ebayResearchError && <div className="settings-error">{ebayResearchError}</div>}

          {ebayResearchResult && !ebayResearchError && (() => {
            // Swap the values - API returns them backwards
            const active = ebayResearchResult.soldCount; // API's soldCount is actually active
            const sold = ebayResearchResult.activeCount; // API's activeCount is actually sold
            const totalInventory = sold + active;
            const strRate = totalInventory > 0 ? (sold / totalInventory) * 100 : null;
            
            return (
              <div className="listings-container">
                <h3>Research for "{ebayResearchResult.query}"</h3>
                <div className="price-stats">
                  <div className="price-stat">
                    <span className="label">Active Listings</span>
                    <span className="value">{active.toLocaleString()}</span>
                  </div>
                  <div className="price-stat">
                    <span className="label">Sold Listings</span>
                    <span className="value">{sold.toLocaleString()}</span>
                  </div>
                </div>
                {strRate !== null && (
                  <div className={`str-result ${getSTRColor(strRate)}`} style={{ marginTop: '24px' }}>
                    <div className="str-rate-value">{strRate.toFixed(1)}%</div>
                    <div className="str-rate-label">{getSTRLabel(strRate)}</div>
                    <div className="str-rate-formula">
                      ({sold} / ({sold} + {active})) × 100 = {strRate.toFixed(1)}%
                    </div>
                  </div>
                )}
                {ebayResearchResult.diagnostics?.completedError && (
                  <div className="settings-error" style={{ marginTop: '16px', marginBottom: '0' }}>
                    Sold data is temporarily unavailable: {ebayResearchResult.diagnostics.completedError}
                  </div>
                )}
              </div>
            );
          })()}
        </form>
      </div>
    </div>
    </>
  );
};

export default EbaySearch;
