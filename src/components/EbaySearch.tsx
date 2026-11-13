import React, { useEffect, useMemo, useState } from 'react';
import BarcodeScanner from 'react-qr-barcode-scanner';
import { augmentEbaySearchQuery } from '../utils/augmentEbaySearchQuery';
import { buildEbayUkSearchUrl } from '../utils/ebayUkSearchUrl';
import { getApiBase } from '../utils/apiBase';
import { pingDatabase } from '../utils/dbPing';
import ScoutItemIdentify from './ScoutItemIdentify';
import {
  calculateEbayFees,
  calculateProfit,
  type EbaySellerLevel,
  type EbaySellerType,
} from '../utils/ebayFeeCalculator';
import './EbaySearch.css';

interface AppSettings {
  material: string[];
  patterns: string[];
  brands: string[];
  gender: string[];
}

const API_BASE = getApiBase();

const EbaySearch: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [materials, setMaterials] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState('');
  /** Homepage eBay: when on, append `mens` to the query (server + site search). Default on. */
  const [includeMens, setIncludeMens] = useState(true);
  const [itemsSold, setItemsSold] = useState('');
  const [activeListings, setActiveListings] = useState('');

  // eBay fee calculator state
  const [itemPrice, setItemPrice] = useState('');
  const [soldPrice, setSoldPrice] = useState('');
  const [sellerType, setSellerType] = useState<EbaySellerType>('business');
  const [sellerLevel, setSellerLevel] = useState<EbaySellerLevel>('top_rated');
  const [promotedFees, setPromotedFees] = useState('0');
  const [vatPercent, setVatPercent] = useState('20');

  /** Combined, deduplicated options for the patterns/materials tag picker. */
  const materialsAndPatterns = useMemo(() => {
    const combined = Array.from(new Set([...patterns, ...materials]));
    return combined.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [patterns, materials]);

  const hasSearchableInput = [searchTerm, selectedBrand, scannedData ?? ''].some(
    (value) => value.trim().length > 0
  );

  const buildSearchTokens = () => {
    const tokens: string[] = [];

    const trimmedSearch = searchTerm.trim();
    const trimmedBrand = selectedBrand.trim();

    if (trimmedSearch) {
      tokens.push(trimmedSearch);
    }

    if (trimmedBrand) {
      tokens.push(trimmedBrand);
    }

    const uniqueTokens = tokens.filter((token, index) => tokens.indexOf(token) === index);

    return uniqueTokens;
  };

  const SEARCH_TERM_STORAGE_KEY = 'searchTerm';
  const SEARCH_COMBINED_STORAGE_KEY = 'saerch term';

  const clearRelatedSearchPersistence = () => {
    try {
      window.localStorage.removeItem(SEARCH_TERM_STORAGE_KEY);
      window.localStorage.removeItem(SEARCH_COMBINED_STORAGE_KEY);
    } catch (err) {
      console.warn('Unable to clear search localStorage:', err);
    }
    try {
      document.cookie.split(';').forEach((raw) => {
        const name = raw.split('=')[0]?.trim();
        if (!name) return;
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      });
    } catch (err) {
      console.warn('Unable to clear cookies:', err);
    }
  };

  const clearAll = () => {
    clearRelatedSearchPersistence();
    setItemsSold('');
    setActiveListings('');
    setSearchTerm('');
    setSelectedBrand('');
    setScannedData(null);
    setShowScanner(false);
  };

  /** Patterns/materials tag picker: each pick appends to the search text instead of replacing it. */
  const handleAppendTag = (value: string) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) return;
    setSearchTerm((prev) => {
      const trimmedPrev = prev.trim();
      return trimmedPrev ? `${trimmedPrev} ${trimmedValue}` : trimmedValue;
    });
  };

  const handleCopyToClipboard = async () => {
    const tokens = buildSearchTokens();
    if (tokens.length === 0) {
      return;
    }

    const combined = augmentEbaySearchQuery(tokens.join(' '), {
      phraseWrap: false,
      appendMens: includeMens,
    });

    try {
      await navigator.clipboard.writeText(combined);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  // Restore search term from localStorage on mount
  useEffect(() => {
    try {
      const savedSearchTerm = window.localStorage.getItem(SEARCH_TERM_STORAGE_KEY);
      if (savedSearchTerm) {
        setSearchTerm(savedSearchTerm);
      }
    } catch (storageError) {
      console.warn('Unable to restore search term from localStorage:', storageError);
    }
  }, []);

  /** Wake DB / warm pool (App.tsx also pings on `/` route). */
  useEffect(() => {
    pingDatabase();
  }, []);

  useEffect(() => {
    const loadBrandsFromDatabase = async () => {
      try {
        const brRes = await fetch(`${API_BASE}/api/brands`);
        if (!brRes.ok) return;
        const data = (await brRes.json()) as { rows?: unknown[] };
        const raw = Array.isArray(data?.rows) ? data.rows : [];
        const seen = new Set<string>();
        const names: string[] = [];
        for (const row of raw) {
          if (!row || typeof row !== 'object') continue;
          const r = row as Record<string, unknown>;
          const nameRaw = r.brand_name ?? r.name;
          const brand_name = (typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '')).trim();
          if (!brand_name) continue;
          const key = brand_name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          names.push(brand_name);
        }
        names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        if (names.length > 0) {
          setBrands(names);
        }
      } catch {
        /* keep brands from settings / fallback */
      }
    };

    const fetchSettings = async () => {
      const applySettings = (data: Partial<AppSettings> | null) => {
        if (!data) {
          return false;
        }

        const sortedMaterials = [...(data.material ?? [])].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        const sortedPatterns = [...(data.patterns ?? [])].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        const seenBrands = new Set<string>();
        const sortedBrands = (data.brands ?? [])
          .filter((brand) => {
            const key = brand.trim().toLowerCase();
            if (!key || seenBrands.has(key)) return false;
            seenBrands.add(key);
            return true;
          })
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

        setMaterials(sortedMaterials);
        setPatterns(sortedPatterns);
        setBrands(sortedBrands);

        return sortedMaterials.length > 0 || sortedBrands.length > 0 || sortedPatterns.length > 0;
      };

      try {
        setSettingsLoading(true);
        setSettingsError(null);

        let apiSuccess = false;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000);

          const apiResponse = await fetch(`${API_BASE}/api/settings`, {
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (apiResponse.ok) {
            const apiData: AppSettings = await apiResponse.json();
            const applied = applySettings(apiData);
            if (applied && apiData.material?.length) {
              apiSuccess = true;
            }
          }
        } catch (apiError: unknown) {
          const name = apiError && typeof apiError === 'object' && 'name' in apiError ? (apiError as { name?: string }).name : '';
          if (name === 'AbortError') {
            console.warn('API request timed out, using fallback settings');
          } else {
            console.warn('API request failed, using fallback settings:', apiError);
          }
        }

        if (!apiSuccess) {
          const fallbackResponse = await fetch('/app-settings.json');
          if (!fallbackResponse.ok) {
            throw new Error(`Fallback settings not found: ${fallbackResponse.status}`);
          }
          const fallbackData: AppSettings = await fallbackResponse.json();
          const appliedFallback = applySettings(fallbackData);
          if (!appliedFallback) {
            throw new Error('Fallback settings did not contain usable data');
          }
        }
      } catch (fallbackError) {
        console.error('Error loading fallback settings:', fallbackError);
        setSettingsError('Unable to load configuration settings.');
      } finally {
        setSettingsLoading(false);
        await loadBrandsFromDatabase();
      }
    };

    fetchSettings();
  }, []);

  const handleBrandSelect = (value: string) => {
    setSelectedBrand(value);
  };

  /** Same formula as former “Item Sell Through Rate” button: sold / (sold + active) × 100 */
  const manualSellThroughPercent = useMemo(() => {
    if (!itemsSold?.trim() || !activeListings?.trim()) return null;
    const sold = Number(itemsSold);
    const active = Number(activeListings);
    if (Number.isNaN(sold) || Number.isNaN(active) || sold < 0 || active < 0) return null;
    const totalInventory = sold + active;
    if (totalInventory <= 0) return null;
    return (sold / totalInventory) * 100;
  }, [itemsSold, activeListings]);

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
    
    const combinedSearchTerm = augmentEbaySearchQuery(searchTokens.join(' '), {
      phraseWrap: false,
      appendMens: includeMens,
    });

    // Store only the actual searchTerm value, not the combined tokens
    try {
      window.localStorage.setItem(SEARCH_TERM_STORAGE_KEY, searchTerm);
    } catch (storageError) {
      console.warn('Unable to persist search term to localStorage:', storageError);
    }
    const encodedSearch = encodeURIComponent(combinedSearchTerm);
    const soldUrl = buildEbayUkSearchUrl(encodedSearch, { sold: true, includeMens });

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
    
    const combinedSearchTerm = augmentEbaySearchQuery(searchTokens.join(' '), {
      phraseWrap: false,
      appendMens: includeMens,
    });

    try {
      window.localStorage.setItem(SEARCH_COMBINED_STORAGE_KEY, combinedSearchTerm);
    } catch (storageError) {
      console.warn('Unable to persist search term to localStorage:', storageError);
    }
    const encodedSearch = encodeURIComponent(combinedSearchTerm);
    const activeUrl = buildEbayUkSearchUrl(encodedSearch, { sold: false, includeMens });

    // Open active URL directly in new tab
    window.open(activeUrl, '_blank');
  };

  return (
    <>
    <div className="ebay-search-container">
      <form onSubmit={handleSubmit} className="ebay-search-form">
        {!showScanner ? (
          <div className="ebay-search-query-block">
            <div className="search-bar-group">
              <div className="search-input-wrapper">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Enter search term..."
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
              <div className="primary-action-row__duo">
                <button
                  type="button"
                  onClick={handleCopyToClipboard}
                  className="copy-button copy-button--icon-only"
                  disabled={!hasSearchableInput}
                  title="Copy eBay search query"
                  aria-label="Copy eBay search query to clipboard"
                >
                  <span aria-hidden>📋</span>
                </button>
              </div>
            </div>
            {scannedData && (
              <p className="scanned-info">Last scanned: {scannedData}</p>
            )}
          </div>
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
          {/* Row 1: Apply Mens Filter, Brands */}
          <div className="category-filter-row">
            <div className="category-control category-control--toggle">
              <button
                type="button"
                id="include-mens-toggle"
                className={
                  'ebay-include-mens-toggle' + (includeMens ? ' ebay-include-mens-toggle--on' : '')
                }
                onClick={() => setIncludeMens((v) => !v)}
                aria-pressed={includeMens}
                aria-label={
                  includeMens
                    ? 'Mens filter applied to search, press to turn off'
                    : 'Mens filter not applied, press to turn on'
                }
              >
                {includeMens ? 'Apply Mens Filter' : 'Off'}
              </button>
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
                id="pattern-material-select"
                value=""
                onChange={(e) => handleAppendTag(e.target.value)}
                className="dropdown-select"
                disabled={materialsAndPatterns.length === 0}
                title="Pick as many as you like — each one is added to the search text"
              >
                <option value="">Keywords</option>
                {materialsAndPatterns.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </div>
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

    <ScoutItemIdentify onIdentified={setSearchTerm} />

    <div className="ebay-search-container">
      <div className="potential-profit-section">
        <div className="potential-profit-form">
          <div className="potential-profit-str-inputs-row">
            <div className="potential-profit-input-group">
              <label htmlFor="items-sold" className="potential-profit-label">Sold Rate</label>
              <input
                id="items-sold"
                type="number"
                value={itemsSold}
                onChange={(e) => setItemsSold(e.target.value)}
                placeholder="0"
                className="potential-profit-input"
                min="0"
              />
            </div>
            <div className="potential-profit-input-group">
              <label htmlFor="active-listings" className="potential-profit-label">Active Listings</label>
              <input
                id="active-listings"
                type="number"
                value={activeListings}
                onChange={(e) => setActiveListings(e.target.value)}
                placeholder="0"
                className="potential-profit-input"
                min="0"
              />
            </div>
          </div>

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
              <label htmlFor="sold-price" className="potential-profit-label">Sold Price</label>
              <input
                id="sold-price"
                type="number"
                value={soldPrice}
                onChange={(e) => setSoldPrice(e.target.value)}
                placeholder="0.00"
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
                placeholder="0"
                className="potential-profit-input"
                step="0.1"
                min="0"
                max="100"
              />
            </div>
            <div className="potential-profit-input-group">
              <label htmlFor="vat-percent" className="potential-profit-label">VAT (%)</label>
              <input
                id="vat-percent"
                type="number"
                value={vatPercent}
                onChange={(e) => setVatPercent(e.target.value)}
                placeholder="20"
                className="potential-profit-input"
                step="0.1"
                min="0"
                max="100"
              />
            </div>
          </div>

          <div className="potential-profit-inputs">
            <div className="potential-profit-input-group">
              <label htmlFor="seller-type" className="potential-profit-label">Seller Type</label>
              <select
                id="seller-type"
                value={sellerType}
                onChange={(e) => setSellerType(e.target.value as EbaySellerType)}
                className="dropdown-select"
              >
                <option value="business">Business</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div className="potential-profit-input-group">
              <label htmlFor="seller-level" className="potential-profit-label">Seller Level</label>
              <select
                id="seller-level"
                value={sellerLevel}
                onChange={(e) => setSellerLevel(e.target.value as EbaySellerLevel)}
                className="dropdown-select"
              >
                <option value="top_rated">Top Rated</option>
                <option value="above_standard">Above Standard</option>
                <option value="below_standard">Below Standard</option>
              </select>
            </div>
          </div>

          {(() => {
            const soldPriceNum = parseFloat(soldPrice) || 0;
            const itemPriceNum = parseFloat(itemPrice) || 0;
            const promotedFeesNum = parseFloat(promotedFees) || 0;
            const vatPercentNum = parseFloat(vatPercent) || 0;
            const hasSoldPrice = soldPrice.trim() !== '' && soldPriceNum > 0;

            const fees = calculateEbayFees({
              soldPrice: soldPriceNum,
              sellerType,
              sellerLevel,
              promotedFeesPercent: promotedFeesNum,
              vatPercent: vatPercentNum,
            });
            const { totalProfit, profitMarginPercent } = calculateProfit(
              soldPriceNum,
              itemPriceNum,
              fees.totalEbayFee
            );

            const fmtGbp = (value: number) =>
              value >= 0 ? `£${value.toFixed(2)}` : `-£${Math.abs(value).toFixed(2)}`;

            const isGoodBuy = hasSoldPrice && totalProfit > 10;
            const hasCalculatedProfit = hasSoldPrice;
            const showBuyVerdict = hasSoldPrice;
            const showStrBox = manualSellThroughPercent !== null;

            return (
              <div className="potential-profit-bottom-row">
                <div
                  className="potential-profit-bottom-col potential-profit-str-pair"
                  style={{ order: hasCalculatedProfit ? 2 : 1 }}
                >
                  {showBuyVerdict && (
                    <div
                      className={`potential-profit-buy-verdict ${
                        isGoodBuy ? 'potential-profit-buy-verdict--buy' : 'potential-profit-buy-verdict--skip'
                      }`}
                    >
                      <div className="potential-profit-buy-verdict-label">{isGoodBuy ? 'Buy' : 'Skip'}</div>
                      <div className="potential-profit-buy-verdict-amount">{fmtGbp(totalProfit)} profit</div>
                    </div>
                  )}

                  {showStrBox && (
                    <div className={`str-result ${getSTRColor(manualSellThroughPercent as number)}`}>
                      <div className="str-rate-value">{(manualSellThroughPercent as number).toFixed(1)}%</div>
                      <div className="str-rate-label">{getSTRLabel(manualSellThroughPercent as number)}</div>
                      <div className="str-rate-formula">
                        ({itemsSold} / ({itemsSold} + {activeListings})) × 100 ={' '}
                        {(manualSellThroughPercent as number).toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>

                <div
                  className="potential-profit-bottom-col potential-profit-results"
                  style={{ order: hasCalculatedProfit ? 1 : 2 }}
                >
                  <div className="ebay-fee-summary" aria-live="polite">
                    <div className="ebay-fee-summary-line">
                      <span>eBay Fee</span>
                      <strong>{hasSoldPrice ? fmtGbp(fees.totalEbayFee) : '£0.00'}</strong>
                    </div>
                    <div className="ebay-fee-summary-line ebay-fee-summary-line--sub">
                      <span>Final Fee</span>
                      <span>{hasSoldPrice ? fmtGbp(fees.finalFee) : '£0.00'}</span>
                    </div>
                    <div className="ebay-fee-summary-line ebay-fee-summary-line--sub">
                      <span>Transaction fee</span>
                      <span>{hasSoldPrice ? fmtGbp(fees.transactionFee) : '£0.00'}</span>
                    </div>
                    <div className="ebay-fee-summary-line ebay-fee-summary-line--sub">
                      <span>Regulatory Operating fee</span>
                      <span>{hasSoldPrice ? fmtGbp(fees.regulatoryFee) : '£0.00'}</span>
                    </div>
                    {promotedFeesNum > 0 && (
                      <div className="ebay-fee-summary-line ebay-fee-summary-line--sub">
                        <span>Promoted fee</span>
                        <span>{hasSoldPrice ? fmtGbp(fees.promotedFee) : '£0.00'}</span>
                      </div>
                    )}
                    <div className="ebay-fee-summary-line ebay-fee-summary-line--sub">
                      <span>{vatPercentNum % 1 === 0 ? vatPercentNum.toFixed(0) : vatPercentNum} % VAT</span>
                      <span>{hasSoldPrice ? fmtGbp(fees.vat) : '£0.00'}</span>
                    </div>

                    <div className="ebay-fee-summary-divider" />

                    <div
                      className={`ebay-fee-summary-line ebay-fee-summary-line--total${
                        hasSoldPrice ? (totalProfit >= 0 ? ' ebay-fee-summary--positive' : ' ebay-fee-summary--negative') : ''
                      }`}
                    >
                      <span>Total Profit</span>
                      <strong>{hasSoldPrice ? fmtGbp(totalProfit) : '£0.00'}</strong>
                    </div>
                    <div className="ebay-fee-summary-line ebay-fee-summary-line--sub">
                      <span>Profit margin</span>
                      <span>
                        {hasSoldPrice && profitMarginPercent !== null
                          ? `${profitMarginPercent.toFixed(2)}% of sold price`
                          : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="potential-profit-reset-container">
            <button
              type="button"
              onClick={() => {
                setItemsSold('');
                setActiveListings('');
                setItemPrice('');
                setSoldPrice('');
                setPromotedFees('0');
                setVatPercent('20');
                setSellerType('business');
                setSellerLevel('top_rated');
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
    </>
  );
};

export default EbaySearch;
