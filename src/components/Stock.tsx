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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: keyof Omit<StockRow, 'id'>;
    direction: 'asc' | 'desc';
  } | null>(null);
  const now = useMemo(() => new Date(), []);
  const currentYear = String(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<string>(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState<string>(currentYear);
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
  const [isDataPanelClosing, setIsDataPanelClosing] = useState(false);
  const [showListedDropdown, setShowListedDropdown] = useState(false);
  const listedDropdownRef = useRef<HTMLDivElement>(null);
  const [showSoldPlatformDropdown, setShowSoldPlatformDropdown] = useState(false);
  const soldPlatformDropdownRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<string[]>(CATEGORIES); // Default to hardcoded, then load from API
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

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

    // If selectedYear is not "all-time" and not in available years, reset to current year
    if (selectedYear !== 'all-time' && !availableYears.includes(selectedYear) && selectedYear !== currentYear) {
      setSelectedYear(currentYear);
    }
  }, [availableYears, selectedYear, currentYear]);

  // Generate weeks for the selected month and year
  const availableWeeks = useMemo(() => {
    if (selectedYear === 'all-time') {
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

      return filtered;
    }

    // Apply normal filters when unsold filter is off
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

      if (!searchTerm.trim()) {
        return true;
      }

      const itemName = row.item_name ? row.item_name.toLowerCase() : '';
      return itemName.includes(searchTerm.toLowerCase().trim());
    });
  }, [rows, selectedMonth, selectedYear, selectedWeek, viewMode, searchTerm, unsoldFilter, selectedCategoryFilter, availableWeeks]);

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
    // Calculate stats based on date filters, not filteredRows
    // This ensures purchases and sales are calculated independently based on their respective dates
    
    let totalPurchase = 0;
    let totalSales = 0;

    rows.forEach((row) => {
      // Check if purchase_date matches the current filters
      let purchaseDateMatches = false;
      if (selectedYear === 'all-time') {
        purchaseDateMatches = true; // Show all if "all-time" is selected
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
    if (creating) {
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
                  onClick={() => setShowListedDropdown(!showListedDropdown)}
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
                    {['Vinted', 'eBay', 'To List'].map((option) => {
                      const getIconSrc = (opt: string) => {
                        if (opt === 'Vinted') return '/images/vinted-icon.svg';
                        if (opt === 'eBay') return '/images/ebay-icon.svg';
                        if (opt === 'To List') return '/images/to-list-icon.svg';
                        return null;
                      };
                      const iconSrc = getIconSrc(option);
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
                    })}
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
                Close
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      <div className="stock-filters">
        <div className="filter-group">
          <select
            value={selectedWeek}
            onChange={(event) => setSelectedWeek(event.target.value)}
            className="filter-select"
            disabled={selectedYear === 'all-time' || unsoldFilter !== 'off'}
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
            disabled={selectedYear === 'all-time' || unsoldFilter !== 'off'}
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
            <option value={currentYear}>{currentYear}</option>
            <option value="all-time">All Time</option>
            {availableYears
              .filter((year) => year !== currentYear)
              .map((year) => (
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
                  setSelectedYear(String(now.getFullYear()));
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
      </div>

      <section className="stock-summary">
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
