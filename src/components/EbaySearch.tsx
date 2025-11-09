import React, { useEffect, useState } from 'react';
import BarcodeScanner from 'react-qr-barcode-scanner';
import './EbaySearch.css';

interface CategorySetting {
  name: string;
  subCategories: string[];
}

interface AppSettings {
  categories: CategorySetting[];
  material: string[];
  colors: string[];
  patterns: string[];
  brands: string[];
  gender: string[];
}

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';
const DEFAULT_GENDER = 'Mens';

const EbaySearch: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [categorySettings, setCategorySettings] = useState<CategorySetting[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [genders, setGenders] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [selectedCategoryName, setSelectedCategoryName] = useState('');
  const [selectedSubCategory, setSelectedSubCategory] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedPattern, setSelectedPattern] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedGender, setSelectedGender] = useState(DEFAULT_GENDER);

  const genderOptions = genders.length > 0 ? genders : [DEFAULT_GENDER];

  const hasSearchableInput = [
    searchTerm,
    selectedCategoryName,
    selectedSubCategory,
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
    const trimmedCategory = selectedCategoryName.trim();
    const trimmedDetail = selectedSubCategory.trim();
    const trimmedMaterial = selectedMaterial.trim();
    const trimmedColor = selectedColor.trim();
    const trimmedPattern = selectedPattern.trim();
    const trimmedBrand = selectedBrand.trim();

    if (trimmedSearch) {
      tokens.push(trimmedSearch);
    }

    if (trimmedGender) {
      tokens.push(trimmedGender);
    }

    if (trimmedDetail) {
      tokens.push(trimmedDetail);
    } else if (trimmedCategory) {
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

    if (trimmedDetail && trimmedCategory) {
      return uniqueTokens.filter((token) => token !== trimmedCategory);
    }

    return uniqueTokens;
  };

  const clearAll = () => {
    setSearchTerm('');
    setSelectedCategoryName('');
    setSelectedSubCategory('');
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

  useEffect(() => {
    const sanitizeCategories = (rawCategories: unknown): CategorySetting[] => {
      if (!Array.isArray(rawCategories)) {
        return [];
      }

      const sanitized = rawCategories
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null;
          }

          const name = typeof (item as CategorySetting).name === 'string'
            ? (item as CategorySetting).name.trim()
            : '';
          if (!name) {
            return null;
          }

          const rawSubCategories = (item as CategorySetting).subCategories;
          const subCategories = Array.isArray(rawSubCategories)
            ? Array.from(
                new Set(
                  rawSubCategories
                    .filter((sub) => typeof sub === 'string')
                    .map((sub) => sub.trim())
                    .filter((sub) => sub.length > 0)
                )
              ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
            : [];

          return { name, subCategories };
        })
        .filter((item): item is CategorySetting => item !== null);

      return sanitized.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
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

        setCategorySettings(sanitizedCategories);
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

        const apiResponse = await fetch(`${API_BASE}/api/settings`);
        if (apiResponse.ok) {
          const apiData: AppSettings = await apiResponse.json();
          const applied = applySettings(apiData);
          if (applied && apiData.colors?.length) {
            setSettingsLoading(false);
            return;
          }
        }
      } catch (error) {
        console.warn('Falling back to static settings:', error);
      }

      try {
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

  const selectedCategory = categorySettings.find(
    (category) => category.name === selectedCategoryName
  );

  const subCategories = selectedCategory?.subCategories ?? [];

  const handleCategorySelect = (value: string) => {
    setSelectedCategoryName(value);
    setSelectedSubCategory('');
  };

  const handleSubCategorySelect = (value: string) => {
    setSelectedSubCategory(value);
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
    
    const combinedSearchTerm = searchTokens.join(' ');
    const encodedSearch = encodeURIComponent(combinedSearchTerm);
    const ebayUrl = `https://www.ebay.co.uk/sch/260012/i.html?_nkw=${encodedSearch}&_from=R40&rt=nc&LH_Sold=1&LH_Complete=1&LH_PrefLoc=1`;
    
    // Open in new tab
    window.open(ebayUrl, '_blank');
  };

  return (
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
              </div>
            </div>
            <div className="primary-action-row">
              <button
                type="submit"
                className="ebay-search-button"
                disabled={!hasSearchableInput}
              >
                Search eBay
              </button>
              <button
                type="button"
                onClick={handleCopyToClipboard}
                className="copy-button"
                disabled={!hasSearchableInput}
              >
                📋 Copy
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="clear-button"
                disabled={!hasSearchableInput}
              >
                Reset
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
              value={selectedCategoryName}
              onChange={(e) => handleCategorySelect(e.target.value)}
              className="dropdown-select"
              disabled={settingsLoading || categorySettings.length === 0}
            >
              <option value="">Categories</option>
              {categorySettings.map((category) => (
                <option key={category.name} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="category-control">
            <select
              id="subcategory-select"
              value={selectedSubCategory}
              onChange={(e) => handleSubCategorySelect(e.target.value)}
              className="dropdown-select"
              disabled={!selectedCategoryName || subCategories.length === 0}
            >
              <option value="" disabled={subCategories.length > 0}>
                {subCategories.length > 0 ? 'Details (select...)' : 'Details unavailable'}
              </option>
              {subCategories.map((subCategory) => (
                <option key={subCategory} value={subCategory}>
                  {subCategory}
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
        </div>

        <div className="gender-section">
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

        <div className="bottom-action-row">
          {!showScanner && (
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              className="scanner-button"
            >
              📷 Scan Barcode
            </button>
          )}
        </div>

        {settingsLoading && (
          <div className="settings-status">Loading settings...</div>
        )}

        {settingsError && (
          <div className="settings-error">{settingsError}</div>
        )}
      </form>
    </div>
  );
};

export default EbaySearch;
