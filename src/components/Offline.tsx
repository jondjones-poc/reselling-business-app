import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import './BrandResearch.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

// Load mensResaleReference from JSON file
let mensResaleReference: Array<{
  brand: string;
  status: string;
  note: string;
  categories: Array<{ item: string; resaleRange: string }>;
}> = [];

// Try to load from public folder first (for production), then fallback to import
try {
  // This will be loaded via fetch in useEffect
  mensResaleReference = [];
} catch (error) {
  console.warn('Failed to load mensResaleReference:', error);
}

// Fallback array (kept for reference)
const mensResaleReferenceFallback = [
  {
    brand: "AllSaints",
    status: "✅",
    note: "Premium menswear — leather, knits, denim move fast.",
    categories: [
      { item: "Outerwear", resaleRange: "£60–£120" },
      { item: "Knitwear", resaleRange: "£40–£70" },
      { item: "Denim", resaleRange: "£40–£70" }
    ]
  },
  {
    brand: "Aligne",
    status: "❌",
    note: "Womenswear focused; no mens resale market.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "AMI Paris",
    status: "✅",
    note: "Modern French designer with loyal buyers.",
    categories: [
      { item: "Sweatshirts", resaleRange: "£60–£100" },
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Knitwear", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "A.P.C.",
    status: "✅",
    note: "French minimalist; premium selvedge denim holds strong value.",
    categories: [
      { item: "Denim", resaleRange: "£60–£100" },
      { item: "Jackets", resaleRange: "£70–£120" }
    ]
  },
  {
    brand: "Aquascutum",
    status: "✅",
    note: "British heritage tailoring and trench coats.",
    categories: [
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Suits", resaleRange: "£100–£180" }
    ]
  },
  {
    brand: "Arket",
    status: "✅",
    note: "High-quality minimalist menswear from H&M Group's premium line.",
    categories: [
      { item: "Coats", resaleRange: "£60–£100" },
      { item: "Knitwear", resaleRange: "£40–£70" },
      { item: "Shirts", resaleRange: "£30–£50" }
    ]
  },
  {
    brand: "Arc'teryx",
    status: "✅",
    note: "Technical outdoor wear with cult resale base.",
    categories: [{ item: "Outerwear", resaleRange: "£100–£200" }]
  },
  {
    brand: "Atmosphere",
    status: "❌",
    note: "Primark sub-brand; zero resale interest.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Banana Republic",
    status: "⚠️",
    note: "Buy only tailored wool coats or chinos; most slow sellers.",
    categories: [{ item: "Outerwear", resaleRange: "£30–£60" }]
  },
  {
    brand: "Baracuta",
    status: "✅",
    note: "Iconic G9 Harrington jacket; UK classic resale hit.",
    categories: [{ item: "Outerwear", resaleRange: "£70–£120" }]
  },
  {
    brand: "Barbour",
    status: "✅",
    note: "UK heritage label; wax and quilted jackets resell fast.",
    categories: [{ item: "Outerwear", resaleRange: "£80–£150" }]
  },
  {
    brand: "Barbour Beacon",
    status: "⚠️",
    note: "Cheaper Barbour range; slower sales, lower quality.",
    categories: [{ item: "Outerwear", resaleRange: "£25–£50" }]
  },
  {
    brand: "Barbour International",
    status: "✅",
    note: "Popular biker sub-line; solid resale for jackets/gilets.",
    categories: [{ item: "Outerwear", resaleRange: "£60–£100" }]
  },
  {
    brand: "Barbour Gold Standard",
    status: "✅",
    note: "Collector range; high demand and resale prices.",
    categories: [{ item: "Outerwear", resaleRange: "£120–£200" }]
  },
  {
    brand: "Belstaff",
    status: "✅",
    note: "Luxury moto outerwear; jackets flip quickly £100+.",
    categories: [{ item: "Outerwear", resaleRange: "£100–£250" }]
  },
  {
    brand: "Ben Sherman",
    status: "⚠️",
    note: "Retro Mod appeal; vintage shirts worth it only.",
    categories: [{ item: "Shirts", resaleRange: "£20–£35" }]
  },
  {
    brand: "Bershka",
    status: "❌",
    note: "Youth fast fashion; poor quality, low resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Blue Harbour",
    status: "❌",
    note: "M&S sub-line, dated and low demand.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "BoohooMAN",
    status: "❌",
    note: "Ultra-fast fashion; flooded market.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Brakeburn",
    status: "⚠️",
    note: "Casual coastal wear; only if mint condition.",
    categories: [
      { item: "Shirts", resaleRange: "£15–£25" },
      { item: "Knitwear", resaleRange: "£20–£30" }
    ]
  },
  {
    brand: "Burton",
    status: "❌",
    note: "Defunct high street label; weak resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Calvin Klein Jeans",
    status: "⚠️",
    note: "Only premium denim or heavy-logo sweats sell.",
    categories: [
      { item: "Denim", resaleRange: "£25–£40" },
      { item: "Sweatshirts", resaleRange: "£25–£35" }
    ]
  },
  {
    brand: "Carhartt WIP",
    status: "✅",
    note: "Workwear/streetwear crossover; reliable resale base.",
    categories: [
      { item: "Jackets", resaleRange: "£60–£100" },
      { item: "Workwear", resaleRange: "£40–£80" },
      { item: "Cargo", resaleRange: "£35–£60" }
    ]
  },
  {
    brand: "Charles Tyrwhitt",
    status: "⚠️",
    note: "Common businesswear; only limited or luxury cotton shirts move.",
    categories: [{ item: "Shirts", resaleRange: "£25–£40" }]
  },
  {
    brand: "Cheaney",
    status: "✅",
    note: "Heritage Northampton shoemaker; handmade leather boots.",
    categories: [
      { item: "Shoes", resaleRange: "£90–£150" },
      { item: "Boots", resaleRange: "£100–£160" }
    ]
  },
  {
    brand: "Church's",
    status: "✅",
    note: "Top-end English dress shoes with collector appeal.",
    categories: [{ item: "Shoes", resaleRange: "£120–£200" }]
  },
  {
    brand: "CP Company",
    status: "✅",
    note: "Italian technical streetwear; strong resale market.",
    categories: [
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Sweatshirts", resaleRange: "£50–£100" }
    ]
  },
  {
    brand: "Crockett & Jones",
    status: "✅",
    note: "Luxury UK-made footwear; elite resale value.",
    categories: [{ item: "Shoes", resaleRange: "£120–£250" }]
  },
  {
    brand: "Cotton On",
    status: "❌",
    note: "Low-cost fast fashion; poor resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Crew Clothing",
    status: "❌",
    note: "Too common on resale platforms.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Diesel",
    status: "✅",
    note: "Premium Italian denim; made-in-Italy lines resell well.",
    categories: [
      { item: "Denim", resaleRange: "£40–£80" },
      { item: "Jackets", resaleRange: "£50–£100" }
    ]
  },
  {
    brand: "Dr. Martens Made in England",
    status: "✅",
    note: "Strong resale, collector appeal. Avoid Asia-made lines.",
    categories: [{ item: "Boots", resaleRange: "£60–£120" }]
  },
  {
    brand: "Dune Mens",
    status: "✅",
    note: "Real leather shoes £25–£50 resale; skip synthetic pairs.",
    categories: [{ item: "Shoes", resaleRange: "£25–£50" }]
  },
  {
    brand: "Eton Shirts",
    status: "✅",
    note: "Swedish premium shirtmaker; fast resale £40–£80.",
    categories: [{ item: "Shirts", resaleRange: "£40–£80" }]
  },
  {
    brand: "Filson",
    status: "✅",
    note: "US heritage outdoor gear; jackets sell £80–£150.",
    categories: [
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Bags", resaleRange: "£60–£100" }
    ]
  },
  {
    brand: "French Connection",
    status: "❌",
    note: "Overproduced; little resale interest.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "GANT",
    status: "✅",
    note: "Premium preppy; polos and knits have steady resale.",
    categories: [
      { item: "Knitwear", resaleRange: "£30–£60" },
      { item: "Shirts", resaleRange: "£25–£45" }
    ]
  },
  {
    brand: "Grenson",
    status: "✅",
    note: "Premium British shoe brand; good market base.",
    categories: [
      { item: "Shoes", resaleRange: "£80–£150" },
      { item: "Boots", resaleRange: "£90–£160" }
    ]
  },
  {
    brand: "Hackett",
    status: "✅",
    note: "Upper-tier British casualwear, steady resale.",
    categories: [
      { item: "Shirts", resaleRange: "£30–£50" },
      { item: "Jackets", resaleRange: "£60–£100" }
    ]
  },
  {
    brand: "H&M",
    status: "❌",
    note: "Mass-market, oversaturated.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Jaeger",
    status: "✅",
    note: "British tailoring, wool coats and suits resell well.",
    categories: [
      { item: "Suits", resaleRange: "£60–£120" },
      { item: "Outerwear", resaleRange: "£70–£130" }
    ]
  },
  {
    brand: "John Smedley",
    status: "✅",
    note: "Luxury knitwear brand; Merino & Sea Island cotton strong.",
    categories: [{ item: "Knitwear", resaleRange: "£50–£90" }]
  },
  {
    brand: "Lacoste",
    status: "✅",
    note: "Polos and knitwear resell quickly.",
    categories: [
      { item: "Polos", resaleRange: "£25–£50" },
      { item: "Knitwear", resaleRange: "£30–£60" }
    ]
  },
  {
    brand: "Levi's",
    status: "✅",
    note: "Heritage denim. Vintage or 501s sell fast.",
    categories: [
      { item: "Denim", resaleRange: "£30–£70" },
      { item: "Jackets", resaleRange: "£50–£80" }
    ]
  },
  {
    brand: "Loake",
    status: "✅",
    note: "Northampton heritage shoemaker; solid resale.",
    categories: [{ item: "Shoes", resaleRange: "£60–£120" }]
  },
  {
    brand: "Patagonia",
    status: "✅",
    note: "Outdoor brand with high resale £50–£100.",
    categories: [
      { item: "Outerwear", resaleRange: "£70–£120" },
      { item: "Fleeces", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Paul Smith",
    status: "✅",
    note: "British designer, shirts & shoes strong resale.",
    categories: [
      { item: "Shirts", resaleRange: "£50–£90" },
      { item: "Shoes", resaleRange: "£70–£130" }
    ]
  },
  {
    brand: "Ralph Lauren (Standard)",
    status: "✅",
    note: "Core polos & knits steady resale.",
    categories: [
      { item: "Polos", resaleRange: "£25–£40" },
      { item: "Knitwear", resaleRange: "£30–£50" }
    ]
  },
  {
    brand: "Reiss",
    status: "✅",
    note: "Premium high-street tailoring.",
    categories: [
      { item: "Suits", resaleRange: "£70–£120" },
      { item: "Shirts", resaleRange: "£30–£60" }
    ]
  },
  {
    brand: "RM Williams",
    status: "✅",
    note: "Australian Chelsea boots; cult following.",
    categories: [{ item: "Shoes", resaleRange: "£100–£180" }]
  },
  {
    brand: "Stone Island",
    status: "✅",
    note: "Cult label, fast resale turnover.",
    categories: [
      { item: "Outerwear", resaleRange: "£100–£200" },
      { item: "Sweatshirts", resaleRange: "£60–£120" }
    ]
  },
  {
    brand: "Ted Baker",
    status: "✅",
    note: "Premium tailoring & footwear resale well.",
    categories: [
      { item: "Suits", resaleRange: "£60–£120" },
      { item: "Shoes", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Timberland",
    status: "✅",
    note: "Boots & jackets move fast £40–£100.",
    categories: [
      { item: "Shoes", resaleRange: "£50–£100" },
      { item: "Outerwear", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Tommy Hilfiger",
    status: "✅",
    note: "Classic brand; polos & jackets £25–£60.",
    categories: [
      { item: "Polos", resaleRange: "£25–£50" },
      { item: "Outerwear", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Tricker's",
    status: "✅",
    note: "Heritage British shoemaker; high-end resale.",
    categories: [{ item: "Shoes", resaleRange: "£90–£150" }]
  },
  {
    brand: "Turnbull & Asser",
    status: "✅",
    note: "Savile Row shirtmaker; luxury resale.",
    categories: [{ item: "Shirts", resaleRange: "£80–£150" }]
  },
  {
    brand: "Whistles Mens",
    status: "✅",
    note: "Premium menswear; wool coats & knits resell.",
    categories: [
      { item: "Outerwear", resaleRange: "£60–£100" },
      { item: "Knitwear", resaleRange: "£40–£70" }
    ]
  },
  {
    brand: "Wrangler",
    status: "✅",
    note: "Western/workwear denim, steady demand.",
    categories: [
      { item: "Denim", resaleRange: "£25–£45" },
      { item: "Jackets", resaleRange: "£30–£60" }
    ]
  },
  {
    brand: "Zara",
    status: "❌",
    note: "Fast fashion, oversaturated resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  }
];

// Convert status emoji to status type
const getStatusFromEmoji = (status: string): 'good' | 'bad' | 'warning' => {
  if (status === "✅") return 'good';
  if (status === "❌") return 'bad';
  if (status === "⚠️") return 'warning';
  return 'bad';
};

// Removed brandsToBuy and brandsToAvoid - now using mensResaleReference from API

interface CategoryItem {
  item: string;
  resaleRange: string;
}

interface TypeaheadResult {
  name: string;
  status: 'good' | 'bad' | 'warning';
  note?: string;
  categories?: CategoryItem[];
}

const Offline: React.FC = () => {
  const location = useLocation();
  const [searchText, setSearchText] = useState('');
  const [typeaheadResults, setTypeaheadResults] = useState<TypeaheadResult[]>([]);
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [lookupBrands, setLookupBrands] = useState<string[]>([]);
  const [selectedLookupBrand, setSelectedLookupBrand] = useState('');
  const [showLookupTool, setShowLookupTool] = useState(false);

  // Search functionality for typeahead
  useEffect(() => {
    if (!searchText.trim()) {
      setTypeaheadResults([]);
      setShowTypeahead(false);
      return;
    }

    const searchTerm = searchText.toLowerCase().trim();
    const results: TypeaheadResult[] = [];

    // Search mensResaleReference (comprehensive source)
    mensResaleReference.forEach((item) => {
      if (item.brand.toLowerCase().includes(searchTerm)) {
        results.push({
          name: item.brand,
          status: getStatusFromEmoji(item.status),
          note: item.note,
          categories: item.categories
        });
      }
    });

    setTypeaheadResults(results.slice(0, 10));
    setShowTypeahead(results.length > 0);
  }, [searchText]);

  // Handle Escape key to close typeahead and clear text
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showTypeahead) {
          setShowTypeahead(false);
        }
        setSearchText('');
        setSelectedLookupBrand('');
        setTypeaheadResults([]);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [showTypeahead]);

  useEffect(() => {
    // Load mensResaleReference from API
    const loadMensResaleReference = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/mens-resale-reference`);
        if (response.ok) {
          const data = await response.json();
          mensResaleReference.length = 0;
          mensResaleReference.push(...data);
          console.log(`Loaded ${mensResaleReference.length} brands from API`);
          
          // Populate lookup brands from mensResaleReference (all brands)
          const allBrandsList = mensResaleReference
            .map(item => item.brand)
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
          setLookupBrands(allBrandsList);
        }
      } catch (error) {
        console.warn('Failed to load mensResaleReference from API, using fallback:', error);
        // Use fallback array if API fails
        const allBrandsList = mensResaleReferenceFallback
          .map(item => item.brand)
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        setLookupBrands(allBrandsList);
      }
    };

    loadMensResaleReference();
  }, []);

  // Clear text box when navigating away or menu is clicked
  useEffect(() => {
    const clearOnNavigation = () => {
      setSearchText('');
      setSelectedLookupBrand('');
      setTypeaheadResults([]);
      setShowTypeahead(false);
    };

    // Clear when location changes (navigation)
    clearOnNavigation();
  }, [location.pathname]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(event.target.value);
    setSelectedLookupBrand('');
  };

  const handleTypeaheadClick = (brandName: string) => {
    setSearchText(brandName);
    setShowTypeahead(false);
  };

  const handleLookupBrandChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = event.target.value;
    setSelectedLookupBrand(selected);
    if (selected) {
      setSearchText(selected);
    }
  };

  const handleClear = () => {
    setSearchText('');
    setSelectedLookupBrand('');
    setTypeaheadResults([]);
    setShowTypeahead(false);
  };

  const handleCopyToClipboard = async (brandName: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent triggering the item click
    
    // Ensure we're only copying the brand name string, nothing else
    const textToCopy = String(brandName).trim();
    
    try {
      // Use the Clipboard API to copy only the brand name
      await navigator.clipboard.writeText(textToCopy);
      
      // Show visual feedback
      const button = e.currentTarget;
      const originalText = button.innerHTML;
      button.innerHTML = '✓';
      button.style.color = '#60ff9f';
      setTimeout(() => {
        button.innerHTML = originalText;
        button.style.color = '';
      }, 1000);
    } catch (err) {
      console.error('Failed to copy:', err);
      // Fallback for older browsers
      try {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        // Show feedback
        const button = e.currentTarget;
        const originalText = button.innerHTML;
        button.innerHTML = '✓';
        button.style.color = '#60ff9f';
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.color = '';
        }, 1000);
      } catch (fallbackErr) {
        console.error('Fallback copy also failed:', fallbackErr);
      }
    }
  };

  return (
    <div>
      <div className="brand-research-container">
        <div className="search-section">
          <div className="search-input-container" style={{ position: 'relative' }}>
            <input
              type="text"
              value={searchText}
              onChange={handleSearchChange}
              onFocus={() => {
                if (typeaheadResults.length > 0) {
                  setShowTypeahead(true);
                }
              }}
              onBlur={() => {
                setTimeout(() => setShowTypeahead(false), 200);
              }}
              placeholder="Search brands..."
              className="brand-search-input"
              autoComplete="off"
            />
            {showTypeahead && typeaheadResults.length > 0 && (
              <div className="brand-results-dropdown" onClick={() => setShowTypeahead(false)}>
                <div 
                  className="brand-results-dropdown-content" 
                  onClick={(e) => {
                    // On mobile, clicking the content also closes it
                    if (window.innerWidth <= 768) {
                      setShowTypeahead(false);
                    } else {
                      e.stopPropagation();
                    }
                  }}
                >
                  {typeaheadResults.map((result, index) => {
                    const brandName = result.name; // Extract brand name once
                    return (
                      <div
                        key={`${result.name}-${index}`}
                        className={`brand-result-item ${result.status}`}
                        onMouseDown={(e) => {
                          // Don't prevent default if clicking the copy button
                          if ((e.target as HTMLElement).closest('.copy-brand-button')) {
                            return;
                          }
                          e.preventDefault();
                          handleTypeaheadClick(brandName);
                        }}
                        onTouchStart={(e) => {
                          // Don't prevent default if clicking the copy button
                          if ((e.target as HTMLElement).closest('.copy-brand-button')) {
                            return;
                          }
                          // On mobile, handle touch to select and close
                          e.preventDefault();
                          handleTypeaheadClick(brandName);
                        }}
                        onClick={(e) => {
                          // Don't handle click if clicking the copy button
                          if ((e.target as HTMLElement).closest('.copy-brand-button')) {
                            return;
                          }
                          // On mobile, clicking a result selects it (handleTypeaheadClick already closes)
                          // On desktop, this is a fallback
                          if (window.innerWidth <= 768) {
                            handleTypeaheadClick(brandName);
                          }
                        }}
                      >
                        <div className="result-brand-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                            <span className="result-brand">{brandName}</span>
                            <button
                              type="button"
                              onClick={(e) => handleCopyToClipboard(brandName, e)}
                              onMouseDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              className="copy-brand-button"
                              title="Copy brand name to clipboard"
                              aria-label={`Copy ${brandName} to clipboard`}
                            >
                              📋
                            </button>
                          </div>
                          <span className={`result-status-tag ${result.status === 'good' ? 'good-tag' : result.status === 'warning' ? 'warning-tag' : 'avoid-tag'}`}>
                            {result.status === 'good' ? 'Good' : result.status === 'warning' ? 'Warning' : 'Avoid'}
                          </span>
                        </div>
                        {result.note && (
                          <div className="result-note">{result.note}</div>
                        )}
                        {result.categories && result.categories.length > 0 && (
                          <div className="result-categories-list">
                            {result.categories.map((cat, catIndex) => (
                              <div key={catIndex} className="result-category-row">
                                <span className="category-item">{cat.item}</span>
                                <span className="category-range">{cat.resaleRange}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {showLookupTool && (
          <div className="search-section">
            <h2>Brands Lookup Tool</h2>
            <div className="search-input-container">
              {lookupBrands.length > 0 && (
                <select
                  value={selectedLookupBrand}
                  onChange={handleLookupBrandChange}
                  className="settings-brand-filter"
                >
                  <option value="">Brands Lookup Tool</option>
                  {lookupBrands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '32px', marginBottom: '40px' }}>
        <button
          onClick={handleClear}
          className="research-clear-button clear-red"
        >
          Clear
        </button>
        <button
          onClick={() => setShowLookupTool(!showLookupTool)}
          className="research-clear-button"
        >
          {showLookupTool ? 'Hide Brands Lookup Tool' : 'Show Brands Lookup Tool'}
        </button>
      </div>
    </div>
  );
};

export default Offline;

