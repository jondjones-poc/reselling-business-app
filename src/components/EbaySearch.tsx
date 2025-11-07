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
  brands: string[];
}

const EbaySearch: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [categorySettings, setCategorySettings] = useState<CategorySetting[]>([]);
  const [materials, setMaterials] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [selectedCategoryName, setSelectedCategoryName] = useState('');
  const [selectedSubCategory, setSelectedSubCategory] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      const applySettings = (data: Partial<AppSettings> | null) => {
        if (!data) {
          return false;
        }

        const sortedMaterials = [...(data.material ?? [])].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        const sortedColors = [...(data.colors ?? [])].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );
        const sortedBrands = [...(data.brands ?? [])].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' })
        );

        setCategorySettings(data.categories ?? []);
        setMaterials(sortedMaterials);
        setColors(sortedColors);
        setBrands(sortedBrands);

        return sortedColors.length > 0 || sortedMaterials.length > 0 || sortedBrands.length > 0;
      };

      try {
        setSettingsLoading(true);
        setSettingsError(null);

        const apiResponse = await fetch('http://localhost:5003/api/settings');
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

  const handleBrandSelect = (value: string) => {
    setSelectedBrand(value);
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
    
    const baseTerm = searchTerm.trim();
    const searchParts = [baseTerm];

    if (selectedSubCategory) {
      searchParts.push(selectedSubCategory);
    }

    if (selectedMaterial) {
      searchParts.push(selectedMaterial);
    }

    if (selectedColor) {
      searchParts.push(selectedColor);
    }

    if (selectedBrand) {
      searchParts.push(selectedBrand);
    }

    const combinedSearchTerm = searchParts.filter(Boolean).join(' ');
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

        <div className="category-section">
          <div className="category-control">
            <label htmlFor="category-select" className="dropdown-label">Category</label>
            <select
              id="category-select"
              value={selectedCategoryName}
              onChange={(e) => handleCategorySelect(e.target.value)}
              className="dropdown-select"
              disabled={settingsLoading || categorySettings.length === 0}
            >
              <option value="">All categories</option>
              {categorySettings.map((category) => (
                <option key={category.name} value={category.name}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div className="category-control">
            <label htmlFor="subcategory-select" className="dropdown-label">Details</label>
            <select
              id="subcategory-select"
              value={selectedSubCategory}
              onChange={(e) => handleSubCategorySelect(e.target.value)}
              className="dropdown-select"
              disabled={!selectedCategoryName || subCategories.length === 0}
            >
              {!selectedCategoryName && (
                <option value="">Select a category first</option>
              )}
              {selectedCategoryName && subCategories.length === 0 && (
                <option value="">No options available yet</option>
              )}
              {subCategories.map((subCategory) => (
                <option key={subCategory} value={subCategory}>
                  {subCategory}
                </option>
              ))}
            </select>
          </div>

          <div className="category-control">
            <label htmlFor="material-select" className="dropdown-label">Material</label>
            <select
              id="material-select"
              value={selectedMaterial}
              onChange={(e) => handleMaterialSelect(e.target.value)}
              className="dropdown-select"
              disabled={materials.length === 0}
            >
              <option value="">All materials</option>
              {materials.map((materialName) => (
                <option key={materialName} value={materialName}>
                  {materialName}
                </option>
              ))}
            </select>
          </div>

          <div className="category-control">
            <label htmlFor="color-select" className="dropdown-label">Color</label>
            <select
              id="color-select"
              value={selectedColor}
              onChange={(e) => handleColorSelect(e.target.value)}
              className="dropdown-select"
              disabled={colors.length === 0}
            >
              <option value="">All colors</option>
              {colors.map((colorName) => (
                <option key={colorName} value={colorName}>
                  {colorName}
                </option>
              ))}
            </select>
          </div>

          <div className="category-control">
            <label htmlFor="brand-select" className="dropdown-label">Brand</label>
            <select
              id="brand-select"
              value={selectedBrand}
              onChange={(e) => handleBrandSelect(e.target.value)}
              className="dropdown-select"
              disabled={brands.length === 0}
            >
              <option value="">All brands</option>
              {brands.map((brandName) => (
                <option key={brandName} value={brandName}>
                  {brandName}
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
  );
};

export default EbaySearch;
