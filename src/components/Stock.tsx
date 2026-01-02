import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: keyof StockRow;
    direction: 'asc' | 'desc';
  } | null>(null);
  const now = useMemo(() => new Date(), []);
  const currentYear = String(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<string>(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState<string>('last-30-days');
  const [selectedWeek, setSelectedWeek] = useState<string>('off');
  const [viewMode, setViewMode] = useState<'all' | 'active-listing' | 'sales' | 'listing' | 'to-list' | 'list-on-vinted' | 'list-on-ebay'>('all');
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
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('');
  const [selectedDataRow, setSelectedDataRow] = useState<StockRow | null>(null);
  const [selectedRowElement, setSelectedRowElement] = useState<HTMLElement | null>(null);
  const [isDataPanelClosing, setIsDataPanelClosing] = useState(false);
  const [showListedDropdown, setShowListedDropdown] = useState(false);
  const listedDropdownRef = useRef<HTMLDivElement>(null);
  const [showSoldPlatformDropdown, setShowSoldPlatformDropdown] = useState(false);
  const soldPlatformDropdownRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<string[]>(CATEGORIES); // Default to hardcoded, then load from API
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const editFormRef = useRef<HTMLDivElement>(null);
  const isInitializingForm = useRef(false);
  const listingOptionsRef = useRef<string[]>([]);

  const loadStock = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/stock`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
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
      // Verify we're using the actual database id values
      if (data.rows && data.rows.length > 0) {
        console.log('Stock data loaded from API:', data.rows.length, 'rows');
        console.log('Sample row with database id:', data.rows[0]?.id, data.rows[0]);
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setEditingRowId(null);
    } catch (err: any) {
      console.error('Stock load error:', err);
      // Provide more helpful error message for network errors
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        setError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
      } else {
        setError(err.message || 'Unable to load stock data');
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStock();
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/settings`);
      if (response.ok) {
        const data = await response.json();
        if (data.stockCategories && data.stockCategories.length > 0) {
          setCategories(data.stockCategories);
        }
      }
    } catch (err) {
      console.error('Failed to load categories:', err);
      // Keep default categories if API fails
    }
  };

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      return;
    }

    const categoryName = newCategoryName.trim();
    
    // Check if category already exists
    if (categories.includes(categoryName)) {
      setNewCategoryName('');
      setShowAddCategory(false);
      return;
    }

    setSavingCategory(true);
    try {
      const updatedCategories = [...categories, categoryName].sort();
      
      const response = await fetch(`${API_BASE}/api/settings/categories`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ categories: updatedCategories }),
      });

      if (response.ok) {
        setCategories(updatedCategories);
        setNewCategoryName('');
        setShowAddCategory(false);
      } else {
        throw new Error('Failed to save category');
      }
    } catch (err) {
      console.error('Failed to add category:', err);
      setError('Failed to save category. Please try again.');
    } finally {
      setSavingCategory(false);
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showListedDropdown && listedDropdownRef.current && !listedDropdownRef.current.contains(event.target as Node)) {
        setShowListedDropdown(false);
      }
      if (showSoldPlatformDropdown && soldPlatformDropdownRef.current && !soldPlatformDropdownRef.current.contains(event.target as Node)) {
        setShowSoldPlatformDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showListedDropdown, showSoldPlatformDropdown]);

  // Memoize listingOptions to prevent accidental mutations
  // Use ref value if available and matches, otherwise use form state
  const memoizedListingOptions = useMemo(() => {
    const formOptions = Array.isArray(createForm.listingOptions) ? createForm.listingOptions : [];
    const refOptions = listingOptionsRef.current;
    
    // If ref has values and form state doesn't match, log warning
    if (refOptions.length > 0 && formOptions.length !== refOptions.length) {
      console.warn('MISMATCH: ref has', refOptions, 'but form has', formOptions);
      // Use ref value if it's more complete
      if (refOptions.length > formOptions.length) {
        console.warn('Using ref value instead of form value');
        return [...refOptions];
      }
    }
    
    return formOptions.length > 0 ? [...formOptions] : (refOptions.length > 0 ? [...refOptions] : []);
  }, [createForm.listingOptions]);

  // Debug: Log when listingOptions changes and track what caused it
  useEffect(() => {
    console.log('createForm.listingOptions changed:', createForm.listingOptions, 'length:', createForm.listingOptions.length);
    // Log stack trace to see what's calling the state change
    if (createForm.listingOptions.length === 1 && editingRowId !== null && createForm.listingOptions[0] !== 'Vinted') {
      console.warn('WARNING: listingOptions reduced to 1 item during edit! Stack:', new Error().stack);
      console.warn('Current editingRowId:', editingRowId, 'listingOptions:', createForm.listingOptions);
    }
  }, [createForm.listingOptions, editingRowId]);

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

    // If selectedYear is not "all-time", "last-30-days", and not in available years, reset to last-30-days
    if (selectedYear !== 'all-time' && selectedYear !== 'last-30-days' && !availableYears.includes(selectedYear) && selectedYear !== currentYear) {
      setSelectedYear('last-30-days');
    }
  }, [availableYears, selectedYear, currentYear]);

  // Generate weeks for the selected month and year
  const availableWeeks = useMemo(() => {
    if (selectedYear === 'all-time' || selectedYear === 'last-30-days') {
      return [];
    }

    const year = parseInt(selectedYear, 10);
    const month = parseInt(selectedMonth, 10) - 1; // JavaScript months are 0-indexed

    if (Number.isNaN(year) || Number.isNaN(month)) {
      return [];
    }

    const weeks: Array<{ value: string; label: string; startDate: Date; endDate: Date }> = [];
    
    // Get the first day of the month
    const firstDay = new Date(year, month, 1);
    
    // Find the Monday of the week containing the first day
    const firstMonday = new Date(firstDay);
    const dayOfWeek = firstMonday.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // If Sunday, go back 6 days, otherwise go back (dayOfWeek - 1) days
    firstMonday.setDate(firstMonday.getDate() - daysToMonday);
    
    // Get the last day of the month
    const lastDay = new Date(year, month + 1, 0);
    
    // Find the Sunday of the week containing the last day
    const lastSunday = new Date(lastDay);
    const lastDayOfWeek = lastSunday.getDay();
    const daysToSunday = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
    lastSunday.setDate(lastSunday.getDate() + daysToSunday);
    
    // Generate all weeks from first Monday to last Sunday
    let currentWeekStart = new Date(firstMonday);
    
    while (currentWeekStart <= lastSunday) {
      const weekEnd = new Date(currentWeekStart);
      weekEnd.setDate(weekEnd.getDate() + 6); // Sunday is 6 days after Monday
      
      // Format: "Mon DD - Sun DD MMM" or "Mon DD MMM - Sun DD MMM" if different months
      const startDay = currentWeekStart.getDate();
      const endDay = weekEnd.getDate();
      const startMonth = currentWeekStart.toLocaleString('en-GB', { month: 'short' });
      const endMonth = weekEnd.toLocaleString('en-GB', { month: 'short' });
      
      let label: string;
      if (startMonth === endMonth) {
        label = `${startDay} - ${endDay} ${startMonth}`;
      } else {
        label = `${startDay} ${startMonth} - ${endDay} ${endMonth}`;
      }
      
      // Use ISO date string for the Monday as the value
      const value = currentWeekStart.toISOString().split('T')[0];
      
      weeks.push({
        value,
        label,
        startDate: new Date(currentWeekStart),
        endDate: new Date(weekEnd)
      });
      
      // Move to next week (next Monday)
      currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    }
    
    return weeks;
  }, [selectedMonth, selectedYear]);

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

  // Check if a date falls within the last 30 days
  const matchesLast30Days = (dateValue: Nullable<string>) => {
    if (!dateValue) {
      return false;
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0); // Start of 30 days ago

    return date >= thirtyDaysAgo && date <= today;
  };

  // Check if a date falls within the selected week
  const matchesWeek = (dateValue: Nullable<string>, weekStartDate: Date, weekEndDate: Date) => {
    if (!dateValue) {
      return false;
    }

    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    // Set time to midnight for accurate comparison
    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const start = new Date(weekStartDate.getFullYear(), weekStartDate.getMonth(), weekStartDate.getDate());
    const end = new Date(weekEndDate.getFullYear(), weekEndDate.getMonth(), weekEndDate.getDate());

    return checkDate >= start && checkDate <= end;
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

  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    rows.forEach((row) => {
      if (row.category && row.category.trim()) {
        cats.add(row.category.trim());
      }
    });
    return Array.from(cats).sort();
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

      // Apply search globally even with unsold filter
      if (searchTerm.trim()) {
        const searchLower = searchTerm.toLowerCase().trim();
        filtered = filtered.filter((row) => {
          const itemName = row.item_name ? row.item_name.toLowerCase() : '';
          return itemName.includes(searchLower);
        });
      }

      return filtered;
    }

    // If search term exists, search globally first (ignore date/viewMode filters)
    // Then apply other filters (category) to narrow down
    const hasSearchTerm = searchTerm.trim();
    
    if (hasSearchTerm) {
      // First, apply global search across all rows
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter((row) => {
        const itemName = row.item_name ? row.item_name.toLowerCase() : '';
        return itemName.includes(searchLower);
      });

      // Then apply category filter to narrow down search results
      if (selectedCategoryFilter) {
        filtered = filtered.filter((row) => row.category === selectedCategoryFilter);
      }

      // Search results are global - don't apply date/viewMode filters
      return filtered;
    }

    // No search term - apply all filters normally
    return filtered.filter((row) => {
      // Handle special view modes for listing filters
      if (viewMode === 'all') {
        // Show everything - no filtering by view mode
      } else if (viewMode === 'active-listing') {
        // Show items that are actively for sale: have purchase_date but no sale_date
        if (!row.purchase_date || row.sale_date) {
          return false;
        }
      } else if (viewMode === 'list-on-vinted') {
        // Show items where vinted is FALSE (not null, not true, only false)
        if (row.vinted !== false) {
          return false;
        }
      } else if (viewMode === 'list-on-ebay') {
        // Show items where ebay is FALSE (not null, not true, only false)
        if (row.ebay !== false) {
          return false;
        }
      } else if (viewMode === 'to-list') {
        // Only show unsold items
        if (row.sale_date) {
          return false;
        }
        
        // Show items where category is "To List" OR (vinted is false/null AND ebay is false/null)
        const hasCategoryToList = row.category === 'To List';
        const notListedAnywhere = (row.vinted === false || row.vinted === null) && (row.ebay === false || row.ebay === null);
        
        if (!hasCategoryToList && !notListedAnywhere) {
          return false;
        }
      }

      let dateMatches = false;
      
      // If week filter is active, use week-based filtering
      if (selectedWeek !== 'off') {
        const selectedWeekData = availableWeeks.find(w => w.value === selectedWeek);
        if (selectedWeekData) {
          const { startDate, endDate } = selectedWeekData;
          
          if (viewMode === 'all') {
            // Filter by either sold date or purchase date falling within the selected week
            dateMatches = matchesWeek(row.purchase_date, startDate, endDate) || matchesWeek(row.sale_date, startDate, endDate);
          } else if (viewMode === 'active-listing') {
            // Show all items listed (purchased) that week but not sold
            dateMatches = matchesWeek(row.purchase_date, startDate, endDate);
          } else if (viewMode === 'sales') {
            // Filter by sold date only
            dateMatches = matchesWeek(row.sale_date, startDate, endDate);
          } else if (viewMode === 'listing' || viewMode === 'list-on-vinted' || viewMode === 'list-on-ebay' || viewMode === 'to-list') {
            // Filter by purchase date only
            dateMatches = matchesWeek(row.purchase_date, startDate, endDate);
          }
        }
      } else {
        // Use month/year filtering when week is not selected
        if (selectedYear === 'all-time') {
          // Show all items regardless of year
          dateMatches = true;
        } else if (selectedYear === 'last-30-days') {
          // Show items from last 30 days
          if (viewMode === 'all') {
            // For "all" view, check both purchase_date and sale_date
            dateMatches = matchesLast30Days(row.purchase_date) || matchesLast30Days(row.sale_date);
          } else if (viewMode === 'listing' || viewMode === 'list-on-vinted' || viewMode === 'list-on-ebay' || viewMode === 'to-list' || viewMode === 'active-listing') {
            dateMatches = matchesLast30Days(row.purchase_date);
          } else {
            dateMatches = matchesLast30Days(row.sale_date);
          }
        } else if (viewMode === 'all') {
          // For "all" view, check both purchase_date and sale_date
          dateMatches = matchesMonthYear(row.purchase_date, selectedMonth, selectedYear) || matchesMonthYear(row.sale_date, selectedMonth, selectedYear);
        } else if (viewMode === 'listing' || viewMode === 'list-on-vinted' || viewMode === 'list-on-ebay' || viewMode === 'to-list' || viewMode === 'active-listing') {
          dateMatches = matchesMonthYear(row.purchase_date, selectedMonth, selectedYear);
        } else {
          dateMatches = matchesMonthYear(row.sale_date, selectedMonth, selectedYear);
        }
      }

      if (!dateMatches) {
        return false;
      }

      // Apply category filter
      if (selectedCategoryFilter && row.category !== selectedCategoryFilter) {
        return false;
      }

      return true;
    });
  }, [rows, selectedMonth, selectedYear, selectedWeek, viewMode, searchTerm, unsoldFilter, selectedCategoryFilter, availableWeeks]);

  const computeDataPanelMetrics = (row: StockRow) => {
    const purchase = row.purchase_price !== null && row.purchase_price !== undefined
      ? Number(row.purchase_price)
      : NaN;
    
    // For unsold items, show 0 for sale price
    const sale = row.sale_price !== null && row.sale_price !== undefined
      ? Number(row.sale_price)
      : row.sale_date === null || row.sale_date === undefined
        ? 0
        : NaN;

    // For unsold items, profit is negative of purchase price (or 0 if no purchase price)
    const profit =
      row.net_profit !== null && row.net_profit !== undefined
        ? Number(row.net_profit)
        : !Number.isNaN(purchase) && !Number.isNaN(sale)
          ? sale - purchase
          : !Number.isNaN(purchase) && (row.sale_date === null || row.sale_date === undefined)
            ? -purchase
            : NaN;

    let profitMultiple: string | null = null;
    if (!Number.isNaN(purchase) && purchase > 0) {
      if (!Number.isNaN(sale) && sale > 0) {
        const multiple = sale / purchase;
        profitMultiple = `${multiple.toFixed(2)}x`;
      } else if (row.sale_date === null || row.sale_date === undefined) {
        // Unsold item - show 0x
        profitMultiple = '0.00x';
      }
    }

    let daysForSale: number | null = null;
    if (row.purchase_date) {
      if (row.sale_date) {
        // Sold item - calculate days between purchase and sale
        const purchaseDate = new Date(row.purchase_date);
        const saleDate = new Date(row.sale_date);
        if (!Number.isNaN(purchaseDate.getTime()) && !Number.isNaN(saleDate.getTime())) {
          const diffMs = saleDate.getTime() - purchaseDate.getTime();
          daysForSale = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        }
      } else {
        // Unsold item - calculate days from purchase to now
        const purchaseDate = new Date(row.purchase_date);
        if (!Number.isNaN(purchaseDate.getTime())) {
          const diffMs = Date.now() - purchaseDate.getTime();
          daysForSale = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        }
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

  const nextSku = useMemo(() => {
    if (rows.length === 0) {
      return 1;
    }
    const maxId = Math.max(...rows.map(row => row.id));
    return maxId + 1;
  }, [rows]);

  const totals = useMemo(() => {
    // Calculate stats based on date filters, not filteredRows
    // This ensures purchases and sales are calculated independently based on their respective dates
    
    let totalPurchase = 0;
    let totalSales = 0;

    rows.forEach((row) => {
      // Check if purchase_date matches the current filters
      let purchaseDateMatches = false;
      if (selectedYear === 'all-time') {
        purchaseDateMatches = true; // Show all if "all-time" is selected
      } else if (selectedYear === 'last-30-days') {
        purchaseDateMatches = matchesLast30Days(row.purchase_date);
      } else if (selectedWeek !== 'off') {
        const selectedWeekData = availableWeeks.find(w => w.value === selectedWeek);
        if (selectedWeekData) {
          purchaseDateMatches = matchesWeek(row.purchase_date, selectedWeekData.startDate, selectedWeekData.endDate);
        }
      } else {
        purchaseDateMatches = matchesMonthYear(row.purchase_date, selectedMonth, selectedYear);
      }

      // Check if sale_date matches the current filters
      let saleDateMatches = false;
      if (selectedYear === 'all-time') {
        saleDateMatches = true; // Show all if "all-time" is selected
      } else if (selectedYear === 'last-30-days') {
        saleDateMatches = matchesLast30Days(row.sale_date);
      } else if (selectedWeek !== 'off') {
        const selectedWeekData = availableWeeks.find(w => w.value === selectedWeek);
        if (selectedWeekData) {
          saleDateMatches = matchesWeek(row.sale_date, selectedWeekData.startDate, selectedWeekData.endDate);
        }
      } else {
        saleDateMatches = matchesMonthYear(row.sale_date, selectedMonth, selectedYear);
      }

      // Sum purchases based on purchase_date matching filters
      if (purchaseDateMatches && row.purchase_price) {
        const purchase = Number(row.purchase_price);
        if (!Number.isNaN(purchase)) {
          totalPurchase += purchase;
        }
      }

      // Sum sales based on sale_date matching filters
      if (saleDateMatches && row.sale_price) {
        const sale = Number(row.sale_price);
        if (!Number.isNaN(sale)) {
          totalSales += sale;
        }
      }
    });

    return {
      purchase: totalPurchase,
      sale: totalSales,
      profit: totalSales - totalPurchase
    };
  }, [rows, selectedMonth, selectedYear, selectedWeek, availableWeeks]);

  const sortedRows = useMemo(() => {
    const getComparableValue = (row: StockRow, key: keyof StockRow) => {
      const value = row[key];

      if (value === null || value === undefined) {
        return '';
      }

      if (key === 'id') {
        const numeric = Number(value);
        return Number.isNaN(numeric) ? Number.NEGATIVE_INFINITY : numeric;
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

    if (!sortConfig) {
      // Default sort: by ID descending (highest/newest first)
      return [...filteredRows].sort((a, b) => {
        const aValue = getComparableValue(a, 'id');
        const bValue = getComparableValue(b, 'id');
        
        if (aValue === bValue) {
          return 0;
        }
        
        return aValue > bValue ? -1 : 1; // Descending order
      });
    }

    const { key, direction } = sortConfig;
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...filteredRows].sort((a, b) => {
      const aValue = getComparableValue(a, key);
      const bValue = getComparableValue(b, key);

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
    if (creating) {
      return;
    }

    // Convert vinted/ebay to listingOptions
    // Handle all possible combinations to ensure all selected options are shown
    const listingOptions: string[] = [];
    
    // Debug: Log the actual values to see what we're getting
    console.log('Editing row - vinted:', row.vinted, 'type:', typeof row.vinted, 'ebay:', row.ebay, 'type:', typeof row.ebay);
    console.log('Row ID:', row.id, 'Row item_name:', row.item_name);
    
    // Check for Vinted - both can be true independently
    if (row.vinted === true) {
      listingOptions.push('Vinted');
      console.log('Added Vinted to listingOptions');
    }
    
    // Check for eBay - both can be true independently
    if (row.ebay === true) {
      listingOptions.push('eBay');
      console.log('Added eBay to listingOptions');
    }
    
    // If both are false or both are null, show "To List"
    // Only add "To List" if neither Vinted nor eBay is true
    const bothFalse = row.vinted === false && row.ebay === false;
    const bothNull = row.vinted === null && row.ebay === null;
    const oneFalseOneNull = (row.vinted === false && row.ebay === null) || (row.vinted === null && row.ebay === false);
    
    // Only show "To List" if no platform is selected (neither is true)
    if ((bothFalse || bothNull || oneFalseOneNull) && listingOptions.length === 0) {
      listingOptions.push('To List');
    }
    
    // Default to Vinted if nothing is set (shouldn't happen, but safety check)
    if (listingOptions.length === 0) {
      listingOptions.push('Vinted');
    }
    
    console.log('Final listingOptions:', listingOptions);

    setEditingRowId(row.id);
    isInitializingForm.current = true;
    // Create a new array reference and store in ref
    const listingOptionsCopy = [...listingOptions];
    listingOptionsRef.current = listingOptionsCopy;
    console.log('Setting form with listingOptions copy:', listingOptionsCopy, 'stored in ref');
    setCreateForm({
      item_name: row.item_name ?? '',
      category: row.category ?? '',
      purchase_price: row.purchase_price ? String(row.purchase_price) : '',
      purchase_date: normalizeDateInput(row.purchase_date ?? ''),
      sale_date: normalizeDateInput(row.sale_date ?? ''),
      sale_price: row.sale_price ? String(row.sale_price) : '',
      sold_platform: row.sold_platform ?? '',
      listingOptions: listingOptionsCopy
    });
    setShowNewEntry(true);
    setSuccessMessage(null);
    
    // Allow form modifications after a brief delay to ensure state is set
    setTimeout(() => {
      isInitializingForm.current = false;
      console.log('Form initialization complete, listingOptions should be:', listingOptions, 'ref has:', listingOptionsRef.current);
    }, 200);
    
    // Scroll to edit form after DOM updates
    setTimeout(() => {
      if (editFormRef.current) {
        editFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
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
    // Prevent accidentally overwriting listingOptions array with a string
    if (key === 'listingOptions') {
      console.warn('handleCreateChange called with listingOptions - this should not happen! Value:', value);
      return;
    }
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

      // Hide the edit section after successful save
      setShowNewEntry(false);
      setEditingRowId(null);
      resetCreateForm();
      listingOptionsRef.current = []; // Reset the ref
      setSortConfig(null);
    } catch (err: any) {
      console.error('Stock create error:', err);
      setError(err.message || 'Unable to create stock record');
    } finally {
      setCreating(false);
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

  const handleSort = (key: keyof StockRow) => {
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

  const resolveSortIndicator = (key: keyof StockRow) => {
    if (!sortConfig || sortConfig.key !== key) {
      return '⇅';
    }

    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const handleCloseDataPanel = useCallback(() => {
    setIsDataPanelClosing(true);
    window.setTimeout(() => {
      setSelectedDataRow(null);
      setSelectedRowElement(null);
      setIsDataPanelClosing(false);
    }, 220);
  }, []);

  // Close modal on ESC key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedDataRow) {
        handleCloseDataPanel();
      }
    };

    if (selectedDataRow) {
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [selectedDataRow, handleCloseDataPanel]);

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!editingRowId) return;

    try {
      setDeleting(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/stock/${editingRowId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        let message = 'Failed to delete stock record';
        try {
          const errorBody = await response.json();
          message = errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      // Remove the deleted row from state
      setRows((prev) => prev.filter((row) => row.id !== editingRowId));
      setSuccessMessage('Stock record deleted successfully.');
      
      // Close the form and reset
      setShowNewEntry(false);
      setEditingRowId(null);
      resetCreateForm();
      setShowDeleteConfirm(false);
    } catch (err: any) {
      console.error('Stock delete error:', err);
      setError(err.message || 'Unable to delete stock record');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  return (
    <div className="stock-container">
      {error && <div className="stock-error">{error}</div>}
      {successMessage && <div className="stock-success">{successMessage}</div>}

      {showNewEntry && (
        <div className="new-entry-card" ref={editFormRef}>
          <div className="new-entry-grid">
            {/* Row 1: Name, Category, Purchase Price (£), Purchase Date, Listed */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', width: '100%' }}>
              <label className="new-entry-field">
                <span>Name</span>
                <input
                  type="text"
                  value={createForm.item_name}
                  onChange={(event) => handleCreateChange('item_name', event.target.value)}
                  placeholder="e.g. Barbour jacket"
                />
              </label>
              <div className="new-entry-field" style={{ position: 'relative' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: 'rgba(255, 248, 226, 0.7)', letterSpacing: '0.05rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>Category</span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddCategory(!showAddCategory);
                        setNewCategoryName('');
                      }}
                      style={{
                        background: 'rgba(255, 214, 91, 0.15)',
                        border: '1px solid rgba(255, 214, 91, 0.3)',
                        borderRadius: '6px',
                        color: 'var(--neon-primary-strong)',
                        cursor: 'pointer',
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '24px',
                        height: '24px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 214, 91, 0.25)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 214, 91, 0.15)';
                      }}
                      title="Add new category"
                    >
                      +
                    </button>
                  </div>
                  <select
                    className="new-entry-select"
                    value={createForm.category}
                    onChange={(event) => handleCreateChange('category', event.target.value)}
                  >
                    <option value="">Select category...</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  {showAddCategory && (
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        alignItems: 'center',
                        marginTop: '4px',
                        padding: '8px',
                        background: 'rgba(255, 214, 91, 0.08)',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 214, 91, 0.2)'
                      }}
                    >
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAddCategory();
                          } else if (e.key === 'Escape') {
                            setShowAddCategory(false);
                            setNewCategoryName('');
                          }
                        }}
                        placeholder="New category name..."
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 214, 91, 0.28)',
                          background: 'rgba(5, 4, 3, 0.6)',
                          color: 'var(--text-strong)',
                          fontSize: '0.9rem',
                          outline: 'none'
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleAddCategory}
                        disabled={savingCategory || !newCategoryName.trim()}
                        style={{
                          padding: '8px 16px',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 214, 91, 0.3)',
                          background: savingCategory ? 'rgba(255, 214, 91, 0.2)' : 'rgba(255, 214, 91, 0.15)',
                          color: 'var(--neon-primary-strong)',
                          cursor: savingCategory ? 'not-allowed' : 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          opacity: savingCategory || !newCategoryName.trim() ? 0.6 : 1
                        }}
                      >
                        {savingCategory ? 'Saving...' : 'Add'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddCategory(false);
                          setNewCategoryName('');
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: '1px solid rgba(255, 120, 120, 0.3)',
                          background: 'rgba(255, 120, 120, 0.1)',
                          color: '#ffb0b0',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: 600
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )}
                </label>
              </div>
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
                  onClick={() => {
                    console.log('Opening Listed dropdown, current listingOptions:', createForm.listingOptions);
                    setShowListedDropdown(!showListedDropdown);
                  }}
                >
                  {createForm.listingOptions.length > 0 ? (
                    createForm.listingOptions.map((option) => {
                      const getIconSrc = (opt: string) => {
                        if (opt === 'Vinted') return '/images/vinted-icon.svg';
                        if (opt === 'eBay') return '/images/ebay-icon.svg';
                        if (opt === 'To List') return '/images/to-list-icon.svg';
                        return null;
                      };
                      const iconSrc = getIconSrc(option);
                      return (
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
                          {iconSrc && (
                            <img 
                              src={iconSrc} 
                              alt={`${option} icon`}
                              style={{
                                width: '12px',
                                height: '12px',
                                display: 'inline-block',
                                flexShrink: 0
                              }}
                            />
                          )}
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
                    );
                    })
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
                    {(() => {
                      // Use memoized listingOptions to prevent closure issues
                      const currentListingOptions = memoizedListingOptions;
                      console.log('Dropdown render - using memoized listingOptions:', currentListingOptions);
                      
                      return ['Vinted', 'eBay', 'To List'].map((option) => {
                        const getIconSrc = (opt: string) => {
                          if (opt === 'Vinted') return '/images/vinted-icon.svg';
                          if (opt === 'eBay') return '/images/ebay-icon.svg';
                          if (opt === 'To List') return '/images/to-list-icon.svg';
                          return null;
                        };
                        const iconSrc = getIconSrc(option);
                        // Use the captured value to avoid closure issues
                        const isChecked = Array.isArray(currentListingOptions) && currentListingOptions.includes(option);
                        // Debug: Log checkbox state every time dropdown is shown
                        console.log(`Rendering checkbox for "${option}": isChecked=${isChecked}, using capturedOptions=`, currentListingOptions);
                      return (
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
                            checked={isChecked}
                            onChange={(e) => {
                              // Prevent modifications during form initialization
                              if (isInitializingForm.current) {
                                console.warn(`Prevented checkbox ${option} onChange during form initialization`);
                                e.preventDefault();
                                return;
                              }
                              
                              e.preventDefault(); // Prevent default behavior
                              const newChecked = e.target.checked;
                              console.log(`Checkbox ${option} onChange triggered: newChecked=${newChecked}, currentOptions=`, createForm.listingOptions);
                              
                              setCreateForm((prev) => {
                                const currentOptions = prev.listingOptions || [];
                                let newOptions: string[];
                                
                                if (newChecked) {
                                  // Add option if not already present
                                  if (!currentOptions.includes(option)) {
                                    newOptions = [...currentOptions, option];
                                    console.log(`Adding ${option}, newOptions:`, newOptions);
                                  } else {
                                    newOptions = currentOptions;
                                    console.log(`${option} already in list, no change`);
                                  }
                                } else {
                                  // Remove option
                                  newOptions = currentOptions.filter((opt) => opt !== option);
                                  console.log(`Removing ${option}, newOptions:`, newOptions);
                                }
                                
                                // Update ref to match
                                listingOptionsRef.current = newOptions;
                                
                                return {
                                  ...prev,
                                  listingOptions: newOptions
                                };
                              });
                            }}
                            style={{
                              width: '16px',
                              height: '16px',
                              cursor: 'pointer',
                              accentColor: 'var(--neon-primary-strong)'
                            }}
                          />
                          {iconSrc && (
                            <img 
                              src={iconSrc} 
                              alt={`${option} icon`}
                              style={{
                                width: '12px',
                                height: '12px',
                                display: 'inline-block',
                                flexShrink: 0
                              }}
                            />
                          )}
                          <span style={{ color: 'var(--text-strong)', fontSize: '0.95rem' }}>{option}</span>
                        </label>
                      );
                    });
                    })()}
                  </div>
                )}
              </label>
            </div>
            </div>
            {/* Row 2: Sale Price (£), Sale Date, Sold Platform */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', width: '100%' }}>
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
            <div className="new-entry-field" style={{ position: 'relative' }} ref={soldPlatformDropdownRef}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: 'rgba(255, 248, 226, 0.7)', letterSpacing: '0.05rem' }}>
                <span>Sold Platform</span>
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
                    minHeight: 'auto',
                    height: 'auto',
                    lineHeight: '1.2'
                  }}
                  onClick={() => setShowSoldPlatformDropdown(!showSoldPlatformDropdown)}
                >
                  {createForm.sold_platform ? (() => {
                    const getIconSrc = (platform: string) => {
                      if (platform === 'Vinted') return '/images/vinted-icon.svg';
                      if (platform === 'eBay') return '/images/ebay-icon.svg';
                      if (platform === 'Not Listed') return '/images/to-list-icon.svg';
                      return null;
                    };
                    const iconSrc = getIconSrc(createForm.sold_platform);
                    return (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        {iconSrc && (
                          <img 
                            src={iconSrc} 
                            alt={`${createForm.sold_platform} icon`}
                            style={{
                              width: '12px',
                              height: '12px',
                              display: 'inline-block',
                              flexShrink: 0
                            }}
                          />
                        )}
                        {createForm.sold_platform}
                      </span>
                    );
                  })() : (
                    <span style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.95rem' }}>Select platform...</span>
                  )}
                </div>
                {showSoldPlatformDropdown && (
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
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 12px',
                        cursor: 'pointer',
                        borderRadius: '8px',
                        transition: 'background 0.2s ease',
                        background: createForm.sold_platform === '' ? 'rgba(255, 214, 91, 0.1)' : 'transparent'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 214, 91, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = createForm.sold_platform === '' ? 'rgba(255, 214, 91, 0.1)' : 'transparent';
                      }}
                      onClick={() => {
                        handleCreateChange('sold_platform', '');
                        setShowSoldPlatformDropdown(false);
                      }}
                    >
                      <span style={{ color: 'var(--text-strong)', fontSize: '0.95rem' }}>Select platform...</span>
                    </div>
                    {PLATFORMS.map((platform) => {
                      const getIconSrc = (plat: string) => {
                        if (plat === 'Vinted') return '/images/vinted-icon.svg';
                        if (plat === 'eBay') return '/images/ebay-icon.svg';
                        if (plat === 'Not Listed') return '/images/to-list-icon.svg';
                        return null;
                      };
                      const iconSrc = getIconSrc(platform);
                      const isSelected = createForm.sold_platform === platform;
                      return (
                        <div
                          key={platform}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 12px',
                            cursor: 'pointer',
                            borderRadius: '8px',
                            transition: 'background 0.2s ease',
                            background: isSelected ? 'rgba(255, 214, 91, 0.1)' : 'transparent'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 214, 91, 0.1)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = isSelected ? 'rgba(255, 214, 91, 0.1)' : 'transparent';
                          }}
                          onClick={() => {
                            handleCreateChange('sold_platform', platform);
                            setShowSoldPlatformDropdown(false);
                          }}
                        >
                          {iconSrc && (
                            <img 
                              src={iconSrc} 
                              alt={`${platform} icon`}
                              style={{
                                width: '12px',
                                height: '12px',
                                display: 'inline-block',
                                flexShrink: 0
                              }}
                            />
                          )}
                          <span style={{ color: 'var(--text-strong)', fontSize: '0.95rem' }}>{platform}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </label>
            </div>
            <div className="new-entry-actions" style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'flex-end', marginLeft: 'auto' }}>
              <button
                type="button"
                className="save-button"
                onClick={handleCreateSubmit}
                disabled={creating || deleting}
              >
                {creating ? 'Saving…' : editingRowId ? 'Update' : 'Save'}
              </button>
              <button
                type="button"
                className="cancel-button"
              onClick={() => {
                if (!creating && !deleting) {
                  setShowNewEntry(false);
                  setEditingRowId(null);
                  resetCreateForm();
                  setShowDeleteConfirm(false);
                }
              }}
                disabled={creating || deleting}
              >
                Close
              </button>
            </div>
            </div>
            {editingRowId && (
              <div style={{ width: '100%', marginTop: '20px' }}>
                <button
                  type="button"
                  className="delete-button"
                  onClick={handleDeleteClick}
                  disabled={creating || deleting}
                >
                  Delete Item
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={handleDeleteCancel}
        >
          <div 
            className="new-entry-card"
            style={{
              maxWidth: '500px',
              width: '90%',
              margin: '0 auto',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: '0 0 20px 0', color: 'var(--neon-primary-strong)', letterSpacing: '0.08rem' }}>
              Confirm Delete
            </h2>
            <p style={{ color: 'rgba(255, 248, 226, 0.85)', marginBottom: '24px', fontSize: '1rem' }}>
              Are you sure you want to delete this item? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="cancel-button"
                onClick={handleDeleteCancel}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="delete-button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="stock-filters">
        <div className="filter-group filter-actions">
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
            + Add
          </button>
        </div>

        <div className="filter-group search-group">
          <div className="search-input-wrapper" style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%' }}>
            <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
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
                style={{ paddingRight: '40px', width: '100%', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setSelectedMonth(String(now.getMonth() + 1));
                  setSelectedYear('last-30-days');
                  setSelectedWeek('off');
                  setViewMode('all');
                  setSelectedCategoryFilter('');
                  setUnsoldFilter('off');
                  loadStock();
                }}
                disabled={unsoldFilter !== 'off'}
                title="Clear all filters"
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'rgba(255, 120, 120, 0.15)',
                  border: '1px solid rgba(255, 120, 120, 0.3)',
                  borderRadius: '50%',
                  color: '#ffb0b0',
                  cursor: 'pointer',
                  padding: '0',
                  fontSize: '1.2rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '24px',
                  height: '24px',
                  transition: 'all 0.2s ease',
                  lineHeight: '1'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 120, 120, 0.3)';
                  e.currentTarget.style.boxShadow = '0 0 8px rgba(255, 120, 120, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 120, 120, 0.15)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                ×
              </button>
            </div>
            <select
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              disabled={unsoldFilter !== 'off'}
              className="filter-select"
              style={{
                minWidth: '140px',
                maxWidth: '140px',
                fontSize: '0.9rem',
                padding: '8px 12px',
                height: 'auto',
                flexShrink: 0
              }}
              title="Filter by category"
            >
              <option value="">All Categories</option>
              {uniqueCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
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

        <div className="filter-group">
          <select
            value={selectedWeek}
            onChange={(event) => setSelectedWeek(event.target.value)}
            className="filter-select"
            disabled={selectedYear === 'all-time' || selectedYear === 'last-30-days' || unsoldFilter !== 'off'}
            title="Filter By Week"
          >
            <option value="off">Filter By Week</option>
            {availableWeeks.map((week) => (
              <option key={week.value} value={week.value}>
                {week.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <select
            value={selectedMonth}
            onChange={(event) => {
              setSelectedMonth(event.target.value);
              setSelectedWeek('off'); // Reset week when month changes
            }}
            className="filter-select"
            disabled={selectedYear === 'all-time' || selectedYear === 'last-30-days' || unsoldFilter !== 'off'}
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
            onChange={(event) => {
              setSelectedYear(event.target.value);
              setSelectedWeek('off'); // Reset week when year changes
            }}
            className="filter-select"
            disabled={unsoldFilter !== 'off'}
          >
            <option value="last-30-days">Last 30 Days</option>
            <option value="all-time">All Time</option>
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
            onChange={(event) => setViewMode(event.target.value as 'all' | 'active-listing' | 'sales' | 'listing' | 'to-list' | 'list-on-vinted' | 'list-on-ebay')}
            className="filter-select"
            disabled={selectedYear === 'all-time' || unsoldFilter !== 'off'}
          >
            <option value="all">All</option>
            <option value="active-listing">Active</option>
            <option value="sales">Sold Items</option>
            <option value="listing">Add This Month</option>
            <option value="to-list">To List</option>
            <option value="list-on-vinted">To List On Vinted</option>
            <option value="list-on-ebay">To List On eBay</option>
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
                setSelectedWeek('off');
                setViewMode('all');
                setSelectedCategoryFilter('');
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
      </div>

      <section className="stock-summary">
        <div className="summary-card summary-card-next-sku">
          <span className="summary-label">Next SKU</span>
          <span className="summary-value">{nextSku}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Stock Purchases</span>
          <span className="summary-value">{formatCurrency(totals.purchase)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Sales</span>
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

      {selectedDataRow && selectedRowElement && (() => {
        const metrics = computeDataPanelMetrics(selectedDataRow);
        const rect = selectedRowElement.getBoundingClientRect();
        const container = selectedRowElement.closest('.stock-container') as HTMLElement;
        const containerRect = container?.getBoundingClientRect();
        
        if (!container || !containerRect) return null;
        
        // Calculate position relative to container
        const top = rect.top - containerRect.top - 10;
        const left = 0;
        const width = containerRect.width;
        
        return (
          <div 
            className={`stock-data-overlay${isDataPanelClosing ? ' closing' : ''}`}
            style={{
              position: 'absolute',
              top: `${top}px`,
              left: `${left}px`,
              width: `${width}px`,
              zIndex: 1000
            }}
          >
              <div 
                className="stock-data-panel"
                onClick={handleCloseDataPanel}
              >
              <div className="stock-data-panel-grid">
                <div className="stock-data-item stock-data-item-title">
                  <div className="stock-data-value stock-data-title">
                    {selectedDataRow.item_name || '—'}
                  </div>
                  <button
                    type="button"
                    className="stock-data-copy-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const title = selectedDataRow.item_name || '';
                      if (title) {
                        navigator.clipboard.writeText(title).then(() => {
                          // Optional: Show a brief success message
                        }).catch(err => {
                          console.error('Failed to copy:', err);
                        });
                      }
                    }}
                    aria-label="Copy item title to clipboard"
                  >
                    📋
                  </button>
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
                      : selectedDataRow.sale_date === null || selectedDataRow.sale_date === undefined
                        ? formatCurrency(0)
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
                    {metrics.profitMultiple || 
                      ((selectedDataRow.sale_date === null || selectedDataRow.sale_date === undefined) && !Number.isNaN(metrics.purchase) && metrics.purchase > 0
                        ? '0.00x'
                        : '—')}
                  </div>
                </div>
                <div className="stock-data-item">
                  <div className="stock-data-label">Days For Sale</div>
                  <div className="stock-data-value">
                    {metrics.daysForSale !== null 
                      ? `${metrics.daysForSale} days` 
                      : (selectedDataRow.purchase_date && (selectedDataRow.sale_date === null || selectedDataRow.sale_date === undefined))
                        ? '0 days'
                        : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="table-wrapper">
        <table className="stock-table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'id' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('id')}
                >
                  SKU <span className="sort-indicator">{resolveSortIndicator('id')}</span>
                </button>
              </th>
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
                  <td>{row.id}</td>
                  <td>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setIsDataPanelClosing(false);
                        setSelectedDataRow(row);
                        setSelectedRowElement(event.currentTarget.closest('tr') as HTMLElement);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        textDecorationColor: 'rgba(255, 214, 91, 0.5)',
                        textUnderlineOffset: '2px',
                        padding: 0,
                        font: 'inherit',
                        textAlign: 'left',
                        width: '100%'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.textDecorationColor = 'rgba(255, 214, 91, 0.8)';
                        e.currentTarget.style.color = 'var(--neon-primary-strong)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.textDecorationColor = 'rgba(255, 214, 91, 0.5)';
                        e.currentTarget.style.color = 'inherit';
                      }}
                    >
                      {renderCellContent(row, 'item_name')}
                    </button>
                  </td>
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
