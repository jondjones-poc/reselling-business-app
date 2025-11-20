import React, { useEffect, useMemo, useState, useRef } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './Stock.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

type Nullable<T> = T | null | undefined;

interface StockRow {
  id: number;
  item_name: Nullable<string>;
  category: Nullable<string>;
  purchase_price: Nullable<string | number>;
  purchase_date: Nullable<string>;
  sale_date: Nullable<string>;
  sale_price: Nullable<string | number>;
  sold_platform: Nullable<string>;
  net_profit: Nullable<string | number>;
  vinted: Nullable<boolean>;
  ebay: Nullable<boolean>;
}

interface StockApiResponse {
  rows: StockRow[];
  count: number;
}

const MONTHS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' }
];

const CATEGORIES = [
  'Accessories',
  'Advertising',
  'Bag',
  'Book',
  'Bottoms',
  'CD',
  'Clothes',
  'Coat',
  'DVD',
  'Electronics',
  'Game',
  'Jacket',
  'Jumper',
  'Kids',
  'Kitchenware',
  'Plush',
  'Polo',
  'Shirt',
  'Shoes',
  'Tie',
  'Toy',
  'Trousers',
  'Top',
  'VHS'
];

const PLATFORMS = ['Not Listed', 'Vinted', 'eBay'];

const formatCurrency = (value: Nullable<string | number>) => {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(parsed)) {
    return `${value}`;
  }

  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2
  }).format(parsed);
};

const formatDate = (value: Nullable<string>) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
};

const normalizeDateInput = (value: Nullable<string>) => {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const iso = date.toISOString();
  return iso.slice(0, 10);
};

const stringToDate = (value: Nullable<string>) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const dateToIsoString = (value: Date | null) => {
  if (!value) {
    return '';
  }
  const iso = value.toISOString();
  return iso.slice(0, 10);
};

const Stock: React.FC = () => {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<StockRow>>({});
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: keyof Omit<StockRow, 'id'>;
    direction: 'asc' | 'desc';
  } | null>(null);
  const now = useMemo(() => new Date(), []);
  const [selectedMonth, setSelectedMonth] = useState<string>(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState<string>(String(now.getFullYear()));
  const [viewMode, setViewMode] = useState<'listing' | 'sales' | 'list-on-vinted' | 'list-on-ebay'>('listing');
  const [showAllYear, setShowAllYear] = useState(false);
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    item_name: '',
    category: '',
    purchase_price: '',
    purchase_date: '',
    sale_date: '',
    sale_price: '',
    sold_platform: '',
    listingOptions: ['Vinted'] as string[]
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [showTypeahead, setShowTypeahead] = useState(false);
  const [typeaheadSuggestions, setTypeaheadSuggestions] = useState<string[]>([]);
  const [unsoldFilter, setUnsoldFilter] = useState<'off' | '3' | '6' | '12'>('off');
  const [selectedDataRow, setSelectedDataRow] = useState<StockRow | null>(null);
  const [isDataPanelClosing, setIsDataPanelClosing] = useState(false);
  const [showListedDropdown, setShowListedDropdown] = useState(false);
  const listedDropdownRef = useRef<HTMLDivElement>(null);

  const loadStock = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/stock`);
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to load stock data');
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'Unexpected response format');
      }

      const data: StockApiResponse = await response.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setEditingRowId(null);
      setEditForm({});
    } catch (err: any) {
      console.error('Stock load error:', err);
      setError(err.message || 'Unable to load stock data');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStock();
  }, []);

  // Close listed dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showListedDropdown && listedDropdownRef.current && !listedDropdownRef.current.contains(event.target as Node)) {
        setShowListedDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showListedDropdown]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const availableYears = useMemo(() => {
    const yearSet = new Set<number>([now.getFullYear()]);
    rows.forEach((row) => {
      const purchaseDate = row.purchase_date ? new Date(row.purchase_date) : null;
      if (purchaseDate && !Number.isNaN(purchaseDate.getTime())) {
        yearSet.add(purchaseDate.getFullYear());
      }

      const saleDate = row.sale_date ? new Date(row.sale_date) : null;
      if (saleDate && !Number.isNaN(saleDate.getTime())) {
        yearSet.add(saleDate.getFullYear());
      }
    });

    return Array.from(yearSet)
      .sort((a, b) => b - a)
      .map((year) => String(year));
  }, [rows, now]);

  useEffect(() => {
    if (availableYears.length === 0) {
      return;
    }

    if (!availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear]);

  const matchesMonthYear = (dateValue: Nullable<string>, month: string, year: string) => {
    if (!dateValue) {
      return false;
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    return (
      String(date.getMonth() + 1) === month &&
      String(date.getFullYear()) === year
    );
  };

  const uniqueItemNames = useMemo(() => {
    const items = new Set<string>();
    rows.forEach((row) => {
      if (row.item_name && row.item_name.trim()) {
        items.add(row.item_name.trim());
      }
    });
    return Array.from(items).sort();
  }, [rows]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setTypeaheadSuggestions([]);
      setShowTypeahead(false);
      return;
    }

    const term = searchTerm.toLowerCase().trim();
    const matches = uniqueItemNames
      .filter((name) => name.toLowerCase().includes(term))
      .slice(0, 10);

    setTypeaheadSuggestions(matches);
    setShowTypeahead(matches.length > 0);
  }, [searchTerm, uniqueItemNames]);

  const filteredRows = useMemo(() => {
    if (!rows.length) {
      return [];
    }

    let filtered = rows;

    // Apply unsold filter if active (overrides other filters)
    if (unsoldFilter !== 'off') {
      const today = new Date();
      
      filtered = filtered.filter((row) => {
        // Must not be sold (no sale_date)
        if (row.sale_date) {
          return false;
        }

        // Must have a purchase_date
        if (!row.purchase_date) {
          return false;
        }

        const purchaseDate = new Date(row.purchase_date);
        if (Number.isNaN(purchaseDate.getTime())) {
          return false;
        }

        const daysSincePurchase = Math.floor((today.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (unsoldFilter === '3') {
          return daysSincePurchase >= 90; // 3 months = ~90 days
        } else if (unsoldFilter === '6') {
          return daysSincePurchase >= 180; // 6 months = ~180 days
        } else if (unsoldFilter === '12') {
          return daysSincePurchase >= 365; // 12 months = ~365 days
        }

        return false;
      });

      return filtered;
    }

    // Apply normal filters when unsold filter is off
    return filtered.filter((row) => {
      // Handle special view modes for listing filters
      if (viewMode === 'list-on-vinted') {
        // Show items where vinted is false or null (not true)
        if (row.vinted === true) {
          return false;
        }
      } else if (viewMode === 'list-on-ebay') {
        // Show items where ebay is false or null (not true)
        if (row.ebay === true) {
          return false;
        }
      }

      const purchaseDateYear =
        row.purchase_date && new Date(row.purchase_date).getFullYear().toString();
      const saleDateYear =
        row.sale_date && new Date(row.sale_date).getFullYear().toString();

      let dateMatches = false;
      if (showAllYear) {
        dateMatches = purchaseDateYear === selectedYear || saleDateYear === selectedYear;
      } else if (viewMode === 'listing' || viewMode === 'list-on-vinted' || viewMode === 'list-on-ebay') {
        dateMatches = matchesMonthYear(row.purchase_date, selectedMonth, selectedYear);
      } else {
        dateMatches = matchesMonthYear(row.sale_date, selectedMonth, selectedYear);
      }

      if (!dateMatches) {
        return false;
      }

      if (!searchTerm.trim()) {
        return true;
      }

      const itemName = row.item_name ? row.item_name.toLowerCase() : '';
      return itemName.includes(searchTerm.toLowerCase().trim());
    });
  }, [rows, selectedMonth, selectedYear, viewMode, showAllYear, searchTerm, unsoldFilter]);

  const computeDataPanelMetrics = (row: StockRow) => {
    const purchase = row.purchase_price !== null && row.purchase_price !== undefined
      ? Number(row.purchase_price)
      : NaN;
    const sale = row.sale_price !== null && row.sale_price !== undefined
      ? Number(row.sale_price)
      : NaN;

    const profit =
      row.net_profit !== null && row.net_profit !== undefined
        ? Number(row.net_profit)
        : !Number.isNaN(purchase) && !Number.isNaN(sale)
          ? sale - purchase
          : NaN;

    let profitMultiple: string | null = null;
    if (!Number.isNaN(purchase) && purchase > 0 && !Number.isNaN(sale)) {
      const multiple = sale / purchase;
      profitMultiple = `${multiple.toFixed(2)}x`;
    }

    let daysForSale: number | null = null;
    if (row.purchase_date && row.sale_date) {
      const purchaseDate = new Date(row.purchase_date);
      const saleDate = new Date(row.sale_date);
      if (!Number.isNaN(purchaseDate.getTime()) && !Number.isNaN(saleDate.getTime())) {
        const diffMs = saleDate.getTime() - purchaseDate.getTime();
        daysForSale = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      }
    }

    return {
      purchase,
      sale,
      profit,
      profitMultiple,
      daysForSale
    };
  };

  const totals = useMemo(() => {
    if (!filteredRows.length) {
      return {
        purchase: 0,
        sale: 0,
        profit: 0
      };
    }

    return filteredRows.reduce(
      (acc, row) => {
        const purchase = Number(row.purchase_price);
        const sale = Number(row.sale_price);

        const nextPurchase = !Number.isNaN(purchase) ? acc.purchase + purchase : acc.purchase;
        const nextSale = !Number.isNaN(sale) ? acc.sale + sale : acc.sale;

        return {
          purchase: nextPurchase,
          sale: nextSale,
          profit: nextSale - nextPurchase
        };
      },
      { purchase: 0, sale: 0, profit: 0 }
    );
  }, [filteredRows]);

  const sortedRows = useMemo(() => {
    if (!sortConfig) {
      return filteredRows;
    }

    const { key, direction } = sortConfig;
    const multiplier = direction === 'asc' ? 1 : -1;

    const getComparableValue = (row: StockRow) => {
      const value = row[key];

      if (value === null || value === undefined) {
        return '';
      }

      if (key === 'purchase_price' || key === 'sale_price' || key === 'net_profit') {
        const numeric = Number(value);
        return Number.isNaN(numeric) ? Number.NEGATIVE_INFINITY : numeric;
      }

      if (key === 'purchase_date' || key === 'sale_date') {
        const date = new Date(String(value));
        return Number.isNaN(date.getTime()) ? Number.NEGATIVE_INFINITY : date.getTime();
      }

      return String(value).toLowerCase();
    };

    return [...filteredRows].sort((a, b) => {
      const aValue = getComparableValue(a);
      const bValue = getComparableValue(b);

      if (aValue === bValue) {
        return 0;
      }

      if (aValue > bValue) {
        return 1 * multiplier;
      }

      return -1 * multiplier;
    });
  }, [filteredRows, sortConfig]);

  const exportToCSV = () => {
    if (sortedRows.length === 0) {
      return;
    }

    const headers = [
      'Item Name',
      'Category',
      'Purchase Price',
      'Purchase Date',
      'Sale Date',
      'Sale Price',
      'Sold Platform',
      'Profit'
    ];

    const csvRows = [
      headers.join(','),
      ...sortedRows.map((row) => {
        const purchasePrice = row.purchase_price
          ? (typeof row.purchase_price === 'number' ? row.purchase_price : parseFloat(String(row.purchase_price)) || 0)
          : '';
        const salePrice = row.sale_price
          ? (typeof row.sale_price === 'number' ? row.sale_price : parseFloat(String(row.sale_price)) || 0)
          : '';
        const profit = row.purchase_price && row.sale_price
          ? (typeof salePrice === 'number' && typeof purchasePrice === 'number' ? salePrice - purchasePrice : '')
          : '';

        return [
          `"${(row.item_name || '').replace(/"/g, '""')}"`,
          `"${(row.category || '').replace(/"/g, '""')}"`,
          purchasePrice,
          row.purchase_date ? formatDate(row.purchase_date) : '',
          row.sale_date ? formatDate(row.sale_date) : '',
          salePrice,
          `"${(row.sold_platform || '').replace(/"/g, '""')}"`,
          profit
        ].join(',');
      })
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `stock-export-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const computeDifference = (
    purchase: Nullable<string | number>,
    sale: Nullable<string | number>
  ) => {
    const normalize = (value: Nullable<string | number>) => {
      if (value === null || value === undefined) {
        return Number.NaN;
      }

      if (typeof value === 'number') {
        return Number.isNaN(value) ? Number.NaN : value;
      }

      const trimmed = value.trim();
      if (!trimmed) {
        return Number.NaN;
      }

      const numeric = Number(trimmed);
      return Number.isNaN(numeric) ? Number.NaN : numeric;
    };

    const purchaseValue = normalize(purchase);
    const saleValue = normalize(sale);

    if (Number.isNaN(purchaseValue) || Number.isNaN(saleValue)) {
      return null;
    }

    return saleValue - purchaseValue;
  };

  const startEditingRow = (row: StockRow) => {
    if (saving || creating) {
      return;
    }

    // Convert vinted/ebay to listingOptions
    const listingOptions: string[] = [];
    if (row.vinted === true) {
      listingOptions.push('Vinted');
    }
    if (row.ebay === true) {
      listingOptions.push('eBay');
    }
    if (row.vinted === null && row.ebay === null) {
      listingOptions.push('To List');
    }
    // Default to Vinted if nothing is set
    if (listingOptions.length === 0) {
      listingOptions.push('Vinted');
    }

    setEditingRowId(row.id);
    setCreateForm({
      item_name: row.item_name ?? '',
      category: row.category ?? '',
      purchase_price: row.purchase_price ? String(row.purchase_price) : '',
      purchase_date: normalizeDateInput(row.purchase_date ?? ''),
      sale_date: normalizeDateInput(row.sale_date ?? ''),
      sale_price: row.sale_price ? String(row.sale_price) : '',
      sold_platform: row.sold_platform ?? '',
      listingOptions
    });
    setShowNewEntry(true);
    setSuccessMessage(null);
  };

  const cancelEditing = () => {
    if (saving) {
      return;
    }

    setEditingRowId(null);
    setEditForm({});
  };

  const handleEditChange = (
    key: keyof Omit<StockRow, 'id'>,
    value: string
  ) => {
    setEditForm((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const resetCreateForm = () => {
    setCreateForm({
      item_name: '',
      category: '',
      purchase_price: '',
      purchase_date: '',
      sale_date: '',
      sale_price: '',
      sold_platform: '',
      listingOptions: ['Vinted'] as string[]
    });
  };

  const handleCreateChange = (key: keyof typeof createForm, value: string) => {
    setCreateForm((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleCreateSubmit = async () => {
    try {
      setCreating(true);
      setError(null);

      // Convert listingOptions to vinted and ebay booleans
      const hasVinted = createForm.listingOptions.includes('Vinted');
      const hasEbay = createForm.listingOptions.includes('eBay');
      const hasToList = createForm.listingOptions.includes('To List');

      // If "To List" is selected, set both to null, otherwise set based on selections
      const vinted = hasToList ? null : (hasVinted ? true : false);
      const ebay = hasToList ? null : (hasEbay ? true : false);

      const payload = {
        item_name: createForm.item_name,
        category: createForm.category,
        purchase_price: createForm.purchase_price,
        purchase_date: createForm.purchase_date,
        sale_date: createForm.sale_date,
        sale_price: createForm.sale_price,
        sold_platform: createForm.sold_platform,
        vinted,
        ebay
      };

      // Check if we're editing or creating
      const isEditing = editingRowId !== null;
      const url = isEditing ? `${API_BASE}/api/stock/${editingRowId}` : `${API_BASE}/api/stock`;
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let message = 'Failed to create stock record';
        try {
          const errorBody = await response.json();
          message = errorBody?.details || errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'Unexpected response format');
      }

      const data = await response.json();
      const updatedRow: StockRow | undefined = data?.row;

      if (!updatedRow) {
        throw new Error('Server did not return the updated row.');
      }

      if (isEditing) {
        setRows((prev) =>
          prev.map((row) => (row.id === updatedRow.id ? updatedRow : row))
        );
        setSuccessMessage('Stock record updated successfully.');
      } else {
        setRows((prev) => [updatedRow, ...prev]);
        setSuccessMessage('Stock record created successfully.');
      }

      setShowNewEntry(false);
      setEditingRowId(null);
      resetCreateForm();
      setSortConfig(null);
    } catch (err: any) {
      console.error('Stock create error:', err);
      setError(err.message || 'Unable to create stock record');
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (editingRowId === null) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const payload = {
        item_name: editForm.item_name ?? '',
        category: editForm.category ?? '',
        purchase_price: editForm.purchase_price ?? '',
        purchase_date: editForm.purchase_date ?? '',
        sale_date: editForm.sale_date ?? '',
        sale_price: editForm.sale_price ?? '',
        sold_platform: editForm.sold_platform ?? ''
      };

      const response = await fetch(`${API_BASE}/api/stock/${editingRowId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let message = 'Failed to update stock record';
        try {
          const errorBody = await response.json();
          message = errorBody?.details || errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'Unexpected response format');
      }

      const data = await response.json();
      const updatedRow: StockRow | undefined = data?.row;

      if (!updatedRow) {
        throw new Error('Server did not return the updated row.');
      }

      setRows((prev) =>
        prev.map((row) => (row.id === updatedRow.id ? updatedRow : row))
      );

      setSuccessMessage('Stock record updated successfully.');
      setEditingRowId(null);
      setEditForm({});
    } catch (err: any) {
      console.error('Stock update error:', err);
      setError(err.message || 'Unable to update stock record');
    } finally {
      setSaving(false);
    }
  };

  const renderCellContent = (
    row: StockRow,
    key: keyof Omit<StockRow, 'id'>,
    formatter?: (value: Nullable<string | number>) => string,
    isDate?: boolean
  ) => {
    const value = row[key];

    if (key === 'net_profit') {
      return formatCurrency(value as Nullable<string | number>);
    }

    if (formatter) {
      return formatter(value as Nullable<string | number>);
    }

    return value ?? '—';
  };

  const handleSort = (key: keyof Omit<StockRow, 'id'>) => {
    setSortConfig((current) => {
      if (!current || current.key !== key) {
        return { key, direction: 'asc' };
      }

      if (current.direction === 'asc') {
        return { key, direction: 'desc' };
      }

      return null;
    });
  };

  const resolveSortIndicator = (key: keyof Omit<StockRow, 'id'>) => {
    if (!sortConfig || sortConfig.key !== key) {
      return '⇅';
    }

    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const handleCloseDataPanel = () => {
    setIsDataPanelClosing(true);
    window.setTimeout(() => {
      setSelectedDataRow(null);
      setIsDataPanelClosing(false);
    }, 220);
  };

  return (
    <div className="stock-container">
      {error && <div className="stock-error">{error}</div>}
      {successMessage && <div className="stock-success">{successMessage}</div>}

      {showNewEntry && (
        <div className="new-entry-card">
          <h2>{editingRowId ? 'Edit Stock Entry' : 'Add Stock Entry'}</h2>
          <div className="new-entry-grid">
            <label className="new-entry-field">
              <span>Name</span>
              <input
                type="text"
                value={createForm.item_name}
                onChange={(event) => handleCreateChange('item_name', event.target.value)}
                placeholder="e.g. Barbour jacket"
              />
            </label>
            <label className="new-entry-field">
              <span>Category</span>
              <select
                className="new-entry-select"
                value={createForm.category}
                onChange={(event) => handleCreateChange('category', event.target.value)}
              >
                <option value="">Select category...</option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="new-entry-field">
              <span>Purchase Price (£)</span>
              <input
                type="number"
                step="0.01"
                value={createForm.purchase_price}
                onChange={(event) => handleCreateChange('purchase_price', event.target.value)}
                placeholder="e.g. 45.00"
              />
            </label>
            <label className="new-entry-field">
              <span>Purchase Date</span>
              <DatePicker
                selected={stringToDate(createForm.purchase_date)}
                onChange={(date) =>
                  handleCreateChange('purchase_date', dateToIsoString(date ?? null))
                }
                dateFormat="yyyy-MM-dd"
                placeholderText="Select purchase date"
                className="date-picker-input"
                calendarClassName="date-picker-calendar"
                wrapperClassName="date-picker-wrapper"
              />
            </label>
            <label className="new-entry-field">
              <span>Sale Price (£)</span>
              <input
                type="number"
                step="0.01"
                value={createForm.sale_price}
                onChange={(event) => handleCreateChange('sale_price', event.target.value)}
                placeholder="e.g. 95.00"
              />
            </label>
            <label className="new-entry-field">
              <span>Sale Date</span>
              <DatePicker
                selected={stringToDate(createForm.sale_date)}
                onChange={(date) =>
                  handleCreateChange('sale_date', dateToIsoString(date ?? null))
                }
                dateFormat="yyyy-MM-dd"
                placeholderText="Select sale date"
                className="date-picker-input"
                calendarClassName="date-picker-calendar"
                wrapperClassName="date-picker-wrapper"
              />
            </label>
            <label className="new-entry-field">
              <span>Sold Platform</span>
              <select
                className="new-entry-select"
                value={createForm.sold_platform}
                onChange={(event) => handleCreateChange('sold_platform', event.target.value)}
              >
                <option value="">Select platform...</option>
                {PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
            </label>
            <div className="new-entry-field" style={{ position: 'relative' }} ref={listedDropdownRef}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: 'rgba(255, 248, 226, 0.7)', letterSpacing: '0.05rem' }}>
                <span>Listed</span>
                <div
                  className="new-entry-select"
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '14px 18px',
                    borderRadius: '16px',
                    border: '1px solid rgba(255, 214, 91, 0.28)',
                    background: 'rgba(255, 214, 91, 0.08)',
                    color: 'var(--text-strong)',
                    gap: '6px',
                    flexWrap: 'nowrap',
                    overflow: 'hidden',
                    minHeight: 'auto',
                    height: 'auto',
                    lineHeight: '1.2'
                  }}
                  onClick={() => setShowListedDropdown(!showListedDropdown)}
                >
                  {createForm.listingOptions.length > 0 ? (
                    createForm.listingOptions.map((option) => (
                      <span
                        key={option}
                        style={{
                          padding: '2px 6px',
                          background: 'rgba(255, 214, 91, 0.2)',
                          borderRadius: '6px',
                          fontSize: '0.85rem',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          whiteSpace: 'nowrap',
                          flexShrink: 0
                        }}
                      >
                        {option}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCreateForm((prev) => ({
                              ...prev,
                              listingOptions: prev.listingOptions.filter((opt) => opt !== option)
                            }));
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-strong)',
                            cursor: 'pointer',
                            padding: '0',
                            fontSize: '12px',
                            lineHeight: '1',
                            marginLeft: '2px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '14px',
                            height: '14px'
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  ) : (
                    <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.95rem' }}>Select options...</span>
                  )}
                </div>
                {showListedDropdown && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      marginTop: '4px',
                      background: 'rgba(5, 4, 3, 0.98)',
                      border: '1px solid rgba(255, 214, 91, 0.28)',
                      borderRadius: '16px',
                      padding: '8px',
                      zIndex: 1000,
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {['Vinted', 'eBay', 'To List'].map((option) => (
                      <label
                        key={option}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '10px 12px',
                          cursor: 'pointer',
                          borderRadius: '8px',
                          transition: 'background 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(255, 214, 91, 0.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={createForm.listingOptions.includes(option)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setCreateForm((prev) => ({
                                ...prev,
                                listingOptions: [...prev.listingOptions, option]
                              }));
                            } else {
                              setCreateForm((prev) => ({
                                ...prev,
                                listingOptions: prev.listingOptions.filter((opt) => opt !== option)
                              }));
                            }
                          }}
                          style={{
                            width: '16px',
                            height: '16px',
                            cursor: 'pointer',
                            accentColor: 'var(--neon-primary-strong)'
                          }}
                        />
                        <span style={{ color: 'var(--text-strong)', fontSize: '0.95rem' }}>{option}</span>
                      </label>
                    ))}
                  </div>
                )}
              </label>
            </div>
            <div className="new-entry-actions" style={{ gridColumn: 'span 1', display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'flex-end', marginLeft: 'auto' }}>
              <button
                type="button"
                className="save-button"
                onClick={handleCreateSubmit}
                disabled={creating}
              >
                {creating ? 'Saving…' : editingRowId ? 'Update' : 'Save'}
              </button>
              <button
                type="button"
                className="cancel-button"
              onClick={() => {
                if (!creating) {
                  setShowNewEntry(false);
                  setEditingRowId(null);
                  resetCreateForm();
                }
              }}
                disabled={creating}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="stock-filters">
        <div className="filter-group all-year-group">
          <button
            type="button"
            className={`all-year-button${showAllYear ? ' active' : ''}`}
            onClick={() => setShowAllYear((prev) => !prev)}
            disabled={unsoldFilter !== 'off'}
          >
            All Year
          </button>
        </div>

        <div className="filter-group">
          <select
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
            className="filter-select"
            disabled={showAllYear || unsoldFilter !== 'off'}
          >
            {MONTHS.map((month) => (
              <option key={month.value} value={month.value}>
                {month.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <select
            value={selectedYear}
            onChange={(event) => setSelectedYear(event.target.value)}
            className="filter-select"
            disabled={unsoldFilter !== 'off'}
          >
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group view-group">
          <select
            value={viewMode}
            onChange={(event) => setViewMode(event.target.value as 'listing' | 'sales' | 'list-on-vinted' | 'list-on-ebay')}
            className="filter-select"
            disabled={showAllYear || unsoldFilter !== 'off'}
          >
            <option value="listing">Listings</option>
            <option value="sales">Sales</option>
            <option value="list-on-vinted">List on Vinted</option>
            <option value="list-on-ebay">List on eBay</option>
          </select>
        </div>

        <div className="filter-group unsold-filter-group">
          <select
            value={unsoldFilter}
            onChange={(event) => {
              const value = event.target.value as 'off' | '3' | '6' | '12';
              setUnsoldFilter(value);
              
              // Clear other filters when a non-"Off" option is selected
              if (value !== 'off') {
                setSearchTerm('');
                setSelectedMonth(String(now.getMonth() + 1));
                setSelectedYear(String(now.getFullYear()));
                setShowAllYear(false);
                setViewMode('listing');
              }
            }}
            className="filter-select unsold-filter-select"
          >
            <option value="off">Unsold Filter</option>
            <option value="3">3 months</option>
            <option value="6">6 months</option>
            <option value="12">12 months</option>
          </select>
        </div>

        <div className="filter-group search-group">
          <div className="search-input-wrapper">
            <input
              type="text"
              className="search-input"
              placeholder="Search items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={unsoldFilter !== 'off'}
              onFocus={() => {
                if (typeaheadSuggestions.length > 0) {
                  setShowTypeahead(true);
                }
              }}
              onBlur={() => {
                setTimeout(() => setShowTypeahead(false), 200);
              }}
            />
            {showTypeahead && typeaheadSuggestions.length > 0 && (
              <div className="typeahead-dropdown">
                {typeaheadSuggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    className="typeahead-item"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setSearchTerm(suggestion);
                      setShowTypeahead(false);
                    }}
                  >
                    {suggestion}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="filter-group filter-actions">
          <button type="button" className="refresh-button" onClick={loadStock} disabled={loading || saving}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="new-entry-button"
            onClick={() => {
              setShowNewEntry(true);
              setEditingRowId(null);
              resetCreateForm();
              setSuccessMessage(null);
            }}
            disabled={showNewEntry || creating}
          >
            + Add Stock
          </button>
        </div>
      </div>

      <section className="stock-summary">
        <div className="summary-card">
          <span className="summary-label">Total Purchase</span>
          <span className="summary-value">{formatCurrency(totals.purchase)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Total Sales</span>
          <span className="summary-value">{formatCurrency(totals.sale)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Profit</span>
          <span className={`summary-value ${totals.profit >= 0 ? 'positive' : 'negative'}`}>
            {formatCurrency(totals.profit)}
          </span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Records</span>
          <span className="summary-value">{sortedRows.length.toLocaleString()}</span>
        </div>
      </section>

      {selectedDataRow && (
        <div className={`stock-data-panel${isDataPanelClosing ? ' closing' : ''}`}>
          <div className="stock-data-panel-header">
            <button
              type="button"
              className="stock-data-close-button"
              onClick={handleCloseDataPanel}
              aria-label="Close insights panel"
            >
              ×
            </button>
          </div>
          {(() => {
            const metrics = computeDataPanelMetrics(selectedDataRow);
            return (
              <div className="stock-data-panel-grid">
                <div className="stock-data-item">
                  <div className="stock-data-label">Item</div>
                  <div className="stock-data-value">
                    {selectedDataRow.item_name || '—'}
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Buy Price</div>
                  <div className="stock-data-value">
                    {!Number.isNaN(metrics.purchase)
                      ? formatCurrency(metrics.purchase)
                      : '—'}
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Sold Price</div>
                  <div className="stock-data-value">
                    {!Number.isNaN(metrics.sale)
                      ? formatCurrency(metrics.sale)
                      : '—'}
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Profit</div>
                  <div className={`stock-data-value ${!Number.isNaN(metrics.profit) && metrics.profit < 0 ? 'negative' : 'positive'}`}>
                    {!Number.isNaN(metrics.profit)
                      ? formatCurrency(metrics.profit)
                      : '—'}
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Profit Multiple</div>
                  <div className="stock-data-value">
                    {metrics.profitMultiple || '—'}
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Days For Sale</div>
                  <div className="stock-data-value">
                    {metrics.daysForSale !== null ? `${metrics.daysForSale} days` : '—'}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="table-wrapper">
        <table className="stock-table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'item_name' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('item_name')}
                >
                  Item <span className="sort-indicator">{resolveSortIndicator('item_name')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'category' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('category')}
                >
                  Category <span className="sort-indicator">{resolveSortIndicator('category')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'purchase_price' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('purchase_price')}
                >
                  Purchase Price <span className="sort-indicator">{resolveSortIndicator('purchase_price')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'purchase_date' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('purchase_date')}
                >
                  Purchase Date <span className="sort-indicator">{resolveSortIndicator('purchase_date')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'sale_date' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('sale_date')}
                >
                  Sale Date <span className="sort-indicator">{resolveSortIndicator('sale_date')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'sale_price' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('sale_price')}
                >
                  Sale Price <span className="sort-indicator">{resolveSortIndicator('sale_price')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'sold_platform' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('sold_platform')}
                >
                  Platform <span className="sort-indicator">{resolveSortIndicator('sold_platform')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'net_profit' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('net_profit')}
                >
                  Net Profit <span className="sort-indicator">{resolveSortIndicator('net_profit')}</span>
                </button>
              </th>
              <th className="stock-table-actions-header">Edit</th>
              <th className="stock-table-actions-header">Insights</th>
            </tr>
          </thead>
          <tbody>
            {!loading && sortedRows.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-state">
                  No stock records found.
                </td>
              </tr>
            )}
            {sortedRows.map((row) => {
              const storedProfit =
                row.net_profit !== null && row.net_profit !== undefined
                  ? Number(row.net_profit)
                  : computeDifference(row.purchase_price, row.sale_price);
              const profitValue = storedProfit;
              const profitClass =
                profitValue !== null
                  ? profitValue >= 0
                    ? 'profit-chip positive'
                    : 'profit-chip negative'
                  : 'profit-chip neutral';
              const profitDisplay = profitValue !== null ? formatCurrency(profitValue) : '—';

              return (
                <tr key={row.id}>
                  <td>{renderCellContent(row, 'item_name')}</td>
                  <td>{renderCellContent(row, 'category')}</td>
                  <td>{renderCellContent(row, 'purchase_price', formatCurrency)}</td>
                  <td>
                    {renderCellContent(
                      row,
                      'purchase_date',
                      (val) => formatDate(val as Nullable<string>),
                      true
                    )}
                  </td>
                  <td>
                    {renderCellContent(
                      row,
                      'sale_date',
                      (val) => formatDate(val as Nullable<string>),
                      true
                    )}
                  </td>
                  <td>{renderCellContent(row, 'sale_price', formatCurrency)}</td>
                  <td>{renderCellContent(row, 'sold_platform')}</td>
                  <td>
                    <span className={profitClass}>{profitDisplay}</span>
                  </td>
                  <td className="stock-table-actions-cell">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="row-hint-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          startEditingRow(row);
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                  <td className="stock-table-actions-cell">
                    <button
                      type="button"
                      className={`row-data-button${row.sale_date ? '' : ' disabled'}`}
                      disabled={!row.sale_date}
                      onClick={(event) => {
                        if (!row.sale_date) return;
                        event.stopPropagation();
                        setIsDataPanelClosing(false);
                        setSelectedDataRow(row);
                      }}
                    >
                      Data
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="export-section">
        <button
          type="button"
          className="export-button"
          onClick={exportToCSV}
          disabled={sortedRows.length === 0}
        >
          Export to CSV
        </button>
      </div>
    </div>
  );
};

export default Stock;
