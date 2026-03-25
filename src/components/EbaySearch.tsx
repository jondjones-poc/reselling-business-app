import React, { useEffect, useMemo, useState } from 'react';
import BarcodeScanner from 'react-qr-barcode-scanner';
import { augmentEbaySearchQuery } from '../utils/augmentEbaySearchQuery';
import { apiUrl } from '../utils/apiBase';
import { pingDatabase } from '../utils/dbPing';
import './EbaySearch.css';
import './BrandResearch.css';

type HomeBrandTagRow = {
  id: number;
  public_url: string | null;
  caption: string | null;
  image_kind: 'tag' | 'fake_check';
  quality_tier: 'good' | 'average' | 'poor';
};

function homeTagQualityRank(tier: HomeBrandTagRow['quality_tier']): number {
  if (tier === 'good') return 0;
  if (tier === 'average') return 1;
  return 2;
}

function normalizeHomeTagImage(raw: unknown): HomeBrandTagRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'number' ? r.id : parseInt(String(r.id ?? ''), 10);
  if (!Number.isFinite(id)) return null;
  const kindRaw = r.image_kind;
  const image_kind: 'tag' | 'fake_check' =
    kindRaw === 'fake_check' || kindRaw === 'fake' ? 'fake_check' : 'tag';
  const public_url =
    r.public_url === null || r.public_url === undefined ? null : String(r.public_url);
  const cap = r.caption;
  const caption = cap === null || cap === undefined ? null : String(cap);
  let quality_tier: HomeBrandTagRow['quality_tier'] = 'average';
  const qt = r.quality_tier;
  if (qt === 'good' || qt === 'average' || qt === 'poor') {
    quality_tier = qt;
  } else if (typeof qt === 'string') {
    const s = qt.trim().toLowerCase();
    if (s === 'good' || s === 'average' || s === 'poor') quality_tier = s;
  }
  return { id, public_url, caption, image_kind, quality_tier };
}

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

const EbaySearch: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  /** Resolved from GET /api/brands — used for tag image brandId. */
  const [dbBrandRows, setDbBrandRows] = useState<{ id: number; brand_name: string }[]>([]);
  const [homeTagRows, setHomeTagRows] = useState<HomeBrandTagRow[]>([]);
  const [homeTagsLoading, setHomeTagsLoading] = useState(false);
  const [homeTagsError, setHomeTagsError] = useState<string | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedPattern, setSelectedPattern] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  /** Homepage eBay: when on, append `mens` to the query (server + site search). Default on. */
  const [includeMens, setIncludeMens] = useState(true);
  const [itemsSold, setItemsSold] = useState('');
  const [activeListings, setActiveListings] = useState('');
  const [ebayResearchLoading, setEbayResearchLoading] = useState(false);
  const [ebayResearchError, setEbayResearchError] = useState<string | null>(null);
  const [ebayResearchResult, setEbayResearchResult] = useState<ResearchResult | null>(null);
  
  // Potential Profit Calculator state
  const [itemPrice, setItemPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [listingFees, setListingFees] = useState('0.10');
  const [promotedFees, setPromotedFees] = useState('10');

  const hasSearchableInput = [
    searchTerm,
    selectedCategory,
    selectedMaterial,
    selectedColor,
    selectedPattern,
    selectedBrand,
    scannedData ?? ''
  ].some((value) => value.trim().length > 0);

  const buildSearchTokens = () => {
    const tokens: string[] = [];

    const trimmedSearch = searchTerm.trim();
    const trimmedCategory = selectedCategory.trim();
    const trimmedMaterial = selectedMaterial.trim();
    const trimmedColor = selectedColor.trim();
    const trimmedPattern = selectedPattern.trim();
    const trimmedBrand = selectedBrand.trim();

    if (trimmedSearch) {
      tokens.push(trimmedSearch);
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
    setSelectedCategory('');
    setSelectedMaterial('');
    setSelectedColor('');
    setSelectedPattern('');
    setSelectedBrand('');
    setIncludeMens(true);
    setScannedData(null);
    setShowScanner(false);
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

    const loadBrandsFromDatabase = async () => {
      try {
        const brRes = await fetch(`${API_BASE}/api/brands`);
        if (!brRes.ok) return;
        const data = (await brRes.json()) as { rows?: unknown[] };
        const raw = Array.isArray(data?.rows) ? data.rows : [];
        const mapped: { id: number; brand_name: string }[] = [];
        for (const row of raw) {
          if (!row || typeof row !== 'object') continue;
          const r = row as Record<string, unknown>;
          const idNum =
            typeof r.id === 'number' && Number.isFinite(r.id)
              ? Math.trunc(r.id)
              : parseInt(String(r.id ?? '').trim(), 10);
          const nameRaw = r.brand_name ?? r.name;
          const brand_name = (typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '')).trim();
          if (!Number.isFinite(idNum) || idNum < 1 || !brand_name) continue;
          mapped.push({ id: idNum, brand_name });
        }
        mapped.sort((a, b) =>
          a.brand_name.localeCompare(b.brand_name, undefined, { sensitivity: 'base' })
        );
        if (mapped.length > 0) {
          setDbBrandRows(mapped);
          setBrands(mapped.map((m) => m.brand_name));
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

        setCategories(sanitizedCategories);
        setMaterials(sortedMaterials);
        setColors(sortedColors);
        setPatterns(sortedPatterns);
        setBrands(sortedBrands);

        return (
          sanitizedCategories.length > 0 ||
          sortedColors.length > 0 ||
          sortedMaterials.length > 0 ||
          sortedBrands.length > 0 ||
          sortedPatterns.length > 0
        );
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
            if (applied && apiData.colors?.length) {
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

  const handleLoadTags = async () => {
    const name = selectedBrand.trim();
    if (!name) {
      setHomeTagsError('Select a brand in the Brands dropdown first.');
      return;
    }
    const found = dbBrandRows.find((b) => b.brand_name === name);
    if (!found) {
      setHomeTagsError(
        'Could not match that brand to the database list. Reload the page or pick another brand.'
      );
      return;
    }
    setHomeTagsLoading(true);
    setHomeTagsError(null);
    try {
      const res = await fetch(
        apiUrl(`/api/brandTagImages?brandId=${encodeURIComponent(String(found.id))}`)
      );
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
      }
      let data: { rows?: unknown[] };
      try {
        data = JSON.parse(text) as { rows?: unknown[] };
      } catch {
        throw new Error('Invalid JSON from tag images API');
      }
      const raw = Array.isArray(data?.rows) ? data.rows : [];
      const out: HomeBrandTagRow[] = [];
      for (const item of raw) {
        const n = normalizeHomeTagImage(item);
        if (n) out.push(n);
      }
      out.sort((a, b) => {
        const fa = a.image_kind === 'fake_check' ? 1 : 0;
        const fb = b.image_kind === 'fake_check' ? 1 : 0;
        if (fa !== fb) return fa - fb;
        const qa = homeTagQualityRank(a.quality_tier);
        const qb = homeTagQualityRank(b.quality_tier);
        if (qa !== qb) return qa - qb;
        return a.id - b.id;
      });
      setHomeTagRows(out);
    } catch (e) {
      setHomeTagsError(e instanceof Error ? e.message : 'Failed to load tag images');
      setHomeTagRows([]);
    } finally {
      setHomeTagsLoading(false);
    }
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

  const hasMeaningfulProfitInput =
    itemsSold.trim().length > 0 ||
    activeListings.trim().length > 0 ||
    itemPrice.trim().length > 0 ||
    salePrice.trim().length > 0 ||
    (listingFees.trim() !== '' && listingFees.trim() !== '0.10') ||
    (promotedFees.trim() !== '' && promotedFees.trim() !== '10');

  const hasAskAiContent = hasSearchableInput || hasMeaningfulProfitInput;

  const buildAskAiPrompt = (): string => {
    const tokens = buildSearchTokens();
    const ebayQuery =
      tokens.length > 0
        ? augmentEbaySearchQuery(tokens.join(' '), {
            phraseWrap: false,
            appendMens: includeMens,
          })
        : '';

    const lines: string[] = [
      "I'm at a charity shop or boot sale in the UK and need a quick resale opinion before I buy.",
      '',
      '## Item / search',
    ];

    if (searchTerm.trim()) {
      lines.push(`- Keywords typed: ${searchTerm.trim()}`);
    }
    if (ebayQuery) {
      lines.push(`- Full eBay-style search string (filters combined): ${ebayQuery}`);
    } else {
      lines.push('- (no search keywords or filters combined yet)');
    }
    lines.push(`- Mens terms appended to search: ${includeMens ? 'Yes' : 'No'}`);

    lines.push('', '## Filters selected');
    const filterLines = [
      selectedBrand.trim() && `Brand: ${selectedBrand.trim()}`,
      selectedCategory.trim() && `Category: ${selectedCategory.trim()}`,
      selectedPattern.trim() && `Pattern: ${selectedPattern.trim()}`,
      selectedColor.trim() && `Colour: ${selectedColor.trim()}`,
      selectedMaterial.trim() && `Material: ${selectedMaterial.trim()}`,
    ].filter(Boolean) as string[];
    if (filterLines.length) {
      filterLines.forEach((f) => lines.push(`- ${f}`));
    } else {
      lines.push('- (none)');
    }

    lines.push('', '## Demand / comps (from my quick notes)');
    if (itemsSold.trim()) {
      lines.push(`- Sold count (period I used): ${itemsSold.trim()}`);
    }
    if (activeListings.trim()) {
      lines.push(`- Active listings: ${activeListings.trim()}`);
    }
    if (manualSellThroughPercent !== null) {
      lines.push(
        `- Estimated sell-through: (${itemsSold} / (${itemsSold} + ${activeListings})) × 100 ≈ ${manualSellThroughPercent.toFixed(1)}%`
      );
    }
    if (!itemsSold.trim() && !activeListings.trim() && manualSellThroughPercent === null) {
      lines.push('- (not filled in)');
    }

    lines.push('', '## Potential profit inputs (£ / %, from the app form)');
    const profitLines: string[] = [];
    if (itemPrice.trim()) profitLines.push(`- Item / buy price: £${itemPrice.trim()}`);
    if (salePrice.trim()) profitLines.push(`- Expected sale price: £${salePrice.trim()}`);
    if (listingFees.trim()) profitLines.push(`- Listing fees: £${listingFees.trim()}`);
    if (promotedFees.trim()) profitLines.push(`- Promoted listing fee: ${promotedFees.trim()}%`);
    if (profitLines.length) {
      lines.push(...profitLines);
    } else {
      lines.push('- (not filled in)');
    }

    if (ebayResearchResult) {
      lines.push(
        '',
        '## eBay research snapshot (from app)',
        `- Active listings (sample): ${ebayResearchResult.activeCount}`,
        `- Sold / completed (sample): ${ebayResearchResult.soldCount}`,
        ebayResearchResult.sellThroughRatio !== null
          ? `- Sell-through ratio (app): ${(ebayResearchResult.sellThroughRatio * 100).toFixed(1)}%`
          : '- Sell-through ratio (app): n/a'
      );
    }

    lines.push(
      '',
      '## What I need from you',
      '1. Does this look like a good buy at the buy price? What would make you say yes or no?',
      '2. What might stop it selling or kill margin (condition, seasonality, fees, competition, fakes, sizing, trends, etc.)?',
      '3. Anything else I should check or ask before I hand over cash?',
      '',
      '## Format for your reply',
      'Answer in exactly 7 paragraphs. Each paragraph should be a few sentences and one main idea—no bullet lists or numbered lists as the backbone of the answer. Cover the three questions above across those paragraphs, and end paragraph 7 with a clear buy / pass / negotiate stance. Keep it practical—I am still in the shop.'
    );

    return lines.join('\n');
  };

  const handleAskAiClipboard = async () => {
    if (!hasAskAiContent) {
      return;
    }
    const text = buildAskAiPrompt();
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
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
      const params = new URLSearchParams({
        q: queryToUse,
        phraseWrap: '0',
        appendMens: includeMens ? '1' : '0',
      });
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
                <button
                  type="button"
                  onClick={handleAskAiClipboard}
                  className="ask-ai-button"
                  disabled={!hasAskAiContent}
                  title="Copy a research prompt for AI (charity shop / boot sale)"
                  aria-label="Copy Ask AI research prompt to clipboard"
                >
                  Ask AI
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
          {/* Row 1: Brands, Categories, Patterns */}
          <div className="category-filter-row">
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
          </div>

          {/* Row 2: Colors, Materials, Apply Mens Filter */}
          <div className="category-filter-row">
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
                placeholder="0.10"
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
            {(() => {
              const hasBothPrices =
                itemPrice &&
                salePrice &&
                itemPrice.trim() !== '' &&
                salePrice.trim() !== '';
              const item = parseFloat(itemPrice) || 0;
              const sale = parseFloat(salePrice) || 0;
              const listing = parseFloat(listingFees) || 0;
              const promotedPercent = parseFloat(promotedFees) || 0;
              const promotedFee = hasBothPrices ? (sale * promotedPercent) / 100 : 0;

              const fmtProfit = (profit: number) =>
                profit >= 0 ? `£${profit.toFixed(2)}` : `-£${Math.abs(profit).toFixed(2)}`;

              const profitMult = (profit: number) =>
                item > 0 ? `${(profit / item).toFixed(2)}x` : '—';

              let vintedProfit = 0;
              let profitWithoutPromo = 0;
              let profitWithPromo = 0;
              if (hasBothPrices) {
                vintedProfit = sale - item;
                profitWithoutPromo = sale - (item + listing);
                profitWithPromo = sale - (item + listing + promotedFee);
              }

              const vintedDisplay = hasBothPrices ? fmtProfit(vintedProfit) : '£0.00';
              const ebayMainDisplay = hasBothPrices ? fmtProfit(profitWithoutPromo) : '£0.00';
              const withPromoDisplay = hasBothPrices ? fmtProfit(profitWithPromo) : '£0.00';

              const isVintedBuy = hasBothPrices && item > 0 && vintedProfit >= item * 2;
              const isEbayBuyWithoutPromo =
                hasBothPrices && item > 0 && profitWithoutPromo >= item * 2;

              /** Same bands as STR UI: “skip” below 30; medium = risky+ */
              const CTR_MEDIUM_OR_GOOD_MIN = 30;
              const isClickthroughMediumOrGood =
                manualSellThroughPercent !== null &&
                manualSellThroughPercent >= CTR_MEDIUM_OR_GOOD_MIN;
              const isOverallBuy =
                hasBothPrices && isClickthroughMediumOrGood && isEbayBuyWithoutPromo;

              return (
                <div className="potential-profit-align-grid potential-profit-align-grid--four">
                  <div className="potential-profit-platform-label">Click-through</div>
                  <div className="potential-profit-platform-label">Vinted</div>
                  <div className="potential-profit-platform-label">eBay</div>
                  <div className="potential-profit-platform-label">Overall</div>

                  <div className="potential-profit-cell-body potential-profit-cell-body--str">
                    {manualSellThroughPercent !== null ? (
                      <div
                        className={`potential-profit-str-embed str-result ${getSTRColor(manualSellThroughPercent)}`}
                      >
                        <div className="str-rate-value">{manualSellThroughPercent.toFixed(1)}%</div>
                        <div className="str-rate-label">{getSTRLabel(manualSellThroughPercent)}</div>
                        <div className="str-rate-formula">
                          ({itemsSold} / ({itemsSold} + {activeListings})) × 100 ={' '}
                          {manualSellThroughPercent.toFixed(1)}%
                        </div>
                      </div>
                    ) : (
                      <div className="potential-profit-str-embed potential-profit-str-embed--empty">
                        <div className="potential-profit-str-placeholder-pct">—</div>
                        <div className="potential-profit-str-placeholder-hint">
                          Sold rate + active listings
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="potential-profit-cell-body">
                    <div
                      className={`potential-profit-platform-value potential-profit-value-row${
                        !hasBothPrices
                          ? ''
                          : isVintedBuy
                            ? ' potential-profit-value--buy'
                            : ' potential-profit-value--pass'
                      }`}
                    >
                      {vintedDisplay}
                      <span className="potential-profit-mult">
                        {' '}
                        / {hasBothPrices ? profitMult(vintedProfit) : item > 0 ? '0.00x' : '—'}
                      </span>
                    </div>
                    {hasBothPrices && (
                      <div
                        className={`potential-profit-tag ${isVintedBuy ? 'potential-profit-buy' : 'potential-profit-avoid'}`}
                      >
                        {isVintedBuy ? 'Buy' : 'Avoid'}
                      </div>
                    )}
                  </div>

                  <div className="potential-profit-cell-body potential-profit-cell-body--ebay">
                    <div
                      className={`potential-profit-platform-value potential-profit-value-row${
                        !hasBothPrices
                          ? ''
                          : isEbayBuyWithoutPromo
                            ? ' potential-profit-value--buy'
                            : ' potential-profit-value--pass'
                      }`}
                    >
                      {ebayMainDisplay}
                      <span className="potential-profit-mult">
                        {' '}
                        / {hasBothPrices ? profitMult(profitWithoutPromo) : item > 0 ? '0.00x' : '—'}
                      </span>
                    </div>
                    {hasBothPrices && (
                      <div
                        className={`potential-profit-tag ${isEbayBuyWithoutPromo ? 'potential-profit-buy' : 'potential-profit-avoid'}`}
                      >
                        {isEbayBuyWithoutPromo ? 'Buy' : 'Avoid'}
                      </div>
                    )}
                    <div className="potential-profit-ebay-sub">
                      <div className="potential-profit-with-promo-line">
                        (with promo: {withPromoDisplay})
                      </div>
                      <div className="potential-profit-promo-fee">
                        (promotion fee: £{hasBothPrices ? promotedFee.toFixed(2) : '0.00'})
                      </div>
                    </div>
                  </div>

                  <div className="potential-profit-cell-body potential-profit-cell-body--decision">
                    {!hasBothPrices ? (
                      <div className="potential-profit-decision-box potential-profit-decision-box--empty">
                        <div className="potential-profit-decision-placeholder">—</div>
                        <div className="potential-profit-decision-hint">Prices + CTR</div>
                      </div>
                    ) : (
                      <div
                        className={`potential-profit-decision-box ${
                          isOverallBuy
                            ? 'potential-profit-decision-box--buy'
                            : 'potential-profit-decision-box--avoid'
                        }`}
                      >
                        <div
                          className={`potential-profit-tag potential-profit-decision-tag ${
                            isOverallBuy ? 'potential-profit-buy' : 'potential-profit-avoid'
                          }`}
                        >
                          {isOverallBuy ? 'Buy' : 'Avoid'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="potential-profit-reset-container">
            <button
              type="button"
              onClick={() => {
                setItemsSold('');
                setActiveListings('');
                setItemPrice('');
                setSalePrice('');
                setListingFees('0.10');
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

    <section
      className="ebay-search-container homepage-brand-tags-section"
      aria-labelledby="homepage-brand-research-heading"
    >
        <h3 id="homepage-brand-research-heading" className="homepage-section-title">
          Brand Research
        </h3>
        <div className="homepage-brand-tags-actions">
          <button
            type="button"
            className="homepage-load-tags-button"
            onClick={() => void handleLoadTags()}
            disabled={homeTagsLoading || settingsLoading || !selectedBrand.trim()}
          >
            {homeTagsLoading ? 'Loading…' : 'Load...'}
          </button>
        </div>
        {homeTagsError && (
          <div className="settings-error homepage-brand-tags-error" role="alert">
            {homeTagsError}
          </div>
        )}
        {homeTagRows.length > 0 && (
          <div className="homepage-brand-tags-results">
            {(() => {
              const tagRows = homeTagRows.filter((i) => i.image_kind !== 'fake_check');
              const fakeRows = homeTagRows.filter((i) => i.image_kind === 'fake_check');
              return (
                <>
                  {tagRows.length > 0 && (
                    <div className="homepage-brand-tags-group">
                      <ul className="brand-tag-examples-grid">
                        {tagRows.map((img) => (
                          <li
                            key={img.id}
                            className="brand-tag-examples-card"
                          >
                            <div className="brand-tag-examples-card-row">
                              <div className="brand-tag-examples-card-media">
                                {img.public_url ? (
                                  <a
                                    href={img.public_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="brand-tag-examples-thumb-link"
                                  >
                                    <img
                                      src={img.public_url}
                                      alt={img.caption || 'Brand tag'}
                                      className="brand-tag-examples-thumb"
                                    />
                                  </a>
                                ) : (
                                  <div className="brand-tag-examples-thumb-fallback">No image URL</div>
                                )}
                              </div>
                              <div className="brand-tag-examples-caption-block">
                                {img.caption ? (
                                  <p className="brand-tag-examples-caption">{img.caption}</p>
                                ) : (
                                  <p className="brand-tag-examples-caption-placeholder">No description</p>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {fakeRows.length > 0 && (
                    <div className="homepage-brand-tags-group brand-tag-examples-image-section--fake">
                      <h4 className="homepage-brand-tags-subheading brand-tag-examples-fake-heading">
                        Fake warning signals
                      </h4>
                      <ul className="brand-tag-examples-grid brand-tag-examples-grid--fake">
                        {fakeRows.map((img) => (
                          <li
                            key={img.id}
                            className="brand-tag-examples-card brand-tag-examples-card--fake"
                          >
                            <div className="brand-tag-examples-card-row">
                              <div className="brand-tag-examples-card-media">
                                {img.public_url ? (
                                  <a
                                    href={img.public_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="brand-tag-examples-thumb-link"
                                  >
                                    <img
                                      src={img.public_url}
                                      alt={img.caption || 'Fake check reference'}
                                      className="brand-tag-examples-thumb"
                                    />
                                  </a>
                                ) : (
                                  <div className="brand-tag-examples-thumb-fallback">No image URL</div>
                                )}
                              </div>
                              <div className="brand-tag-examples-caption-block">
                                {img.caption ? (
                                  <p className="brand-tag-examples-caption">{img.caption}</p>
                                ) : (
                                  <p className="brand-tag-examples-caption-placeholder">No description</p>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
    </section>

    <section
      className="ebay-search-container homepage-ctr-research-section"
      aria-labelledby="homepage-ctr-heading"
    >
        <h3 id="homepage-ctr-heading" className="homepage-section-title">
          Search Click-Through Rate
        </h3>
        <form onSubmit={handleEbayResearchSubmit} className="ebay-search-form">
          <div className="primary-action-row research-action-row" style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              type="submit"
              className="ebay-search-button"
              disabled={ebayResearchLoading || !hasSearchableInput}
              aria-label="Search click-through rate"
            >
              {ebayResearchLoading ? 'Searching...' : 'Search'}
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
    </section>
    </>
  );
};

export default EbaySearch;
