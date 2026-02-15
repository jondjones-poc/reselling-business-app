import React, { useEffect, useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import * as XLSX from 'xlsx';
import './Stock.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

type Nullable<T> = T | null | undefined;

interface ExpenseRow {
  id: number;
  item: Nullable<string>;
  cost: Nullable<string | number>;
  purchase_date: Nullable<string>;
  receipt_name: Nullable<string>;
  purchase_location: Nullable<string>;
}

interface ExpensesApiResponse {
  rows: ExpenseRow[];
  count: number;
}

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

const getCurrentTaxYear = () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-11, where 0 is January
  
  // Tax year runs from April 1 to March 31
  // If we're in Jan, Feb, or Mar, the tax year started the previous year
  // If we're in Apr-Dec, the tax year started this year
  let taxYearStart: Date;
  let taxYearEnd: Date;
  
  if (currentMonth < 3) {
    // Jan, Feb, Mar - tax year started previous year on April 1
    taxYearStart = new Date(currentYear - 1, 3, 1); // April 1 of previous year
    taxYearEnd = new Date(currentYear, 2, 31, 23, 59, 59, 999); // March 31 of current year
  } else {
    // Apr-Dec - tax year started this year on April 1
    taxYearStart = new Date(currentYear, 3, 1); // April 1 of current year
    taxYearEnd = new Date(currentYear + 1, 2, 31, 23, 59, 59, 999); // March 31 of next year
  }
  
  return { start: taxYearStart, end: taxYearEnd };
};

const Expenses: React.FC = () => {
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{
    key: keyof Omit<ExpenseRow, 'id'>;
    direction: 'asc' | 'desc';
  } | null>(null);
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    item: '',
    cost: '',
    purchase_date: '',
    receipt_name: '',
    purchase_location: ''
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadExpenses = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/expenses`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to load expenses data');
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'Unexpected response format');
      }

      const data: ExpensesApiResponse = await response.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setEditingRowId(null);
    } catch (err: any) {
      console.error('Expenses load error:', err);
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        setError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
      } else {
        setError(err.message || 'Unable to load expenses data');
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExpenses();
  }, []);

  useEffect(() => {
    if (!successMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 4000);

    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  const filteredRows = useMemo(() => {
    if (!rows.length) {
      return [];
    }

    let filtered = rows;

    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase().trim();
      filtered = filtered.filter((row) => {
        const itemName = row.item ? row.item.toLowerCase() : '';
        const receiptName = row.receipt_name ? row.receipt_name.toLowerCase() : '';
        const purchaseLocation = row.purchase_location ? row.purchase_location.toLowerCase() : '';
        return itemName.includes(searchLower) || 
               receiptName.includes(searchLower) || 
               purchaseLocation.includes(searchLower);
      });
    }

    return filtered;
  }, [rows, searchTerm]);

  const sortedRows = useMemo(() => {
    if (!sortConfig) {
      return filteredRows;
    }

    const { key, direction } = sortConfig;
    const multiplier = direction === 'asc' ? 1 : -1;

    const getComparableValue = (row: ExpenseRow) => {
      const value = row[key];

      if (value === null || value === undefined) {
        return '';
      }

      if (key === 'cost') {
        const numeric = Number(value);
        return Number.isNaN(numeric) ? Number.NEGATIVE_INFINITY : numeric;
      }

      if (key === 'purchase_date') {
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

  const totals = useMemo(() => {
    let totalCost = 0;

    rows.forEach((row) => {
      if (row.cost) {
        const cost = Number(row.cost);
        if (!Number.isNaN(cost)) {
          totalCost += cost;
        }
      }
    });

    return {
      cost: totalCost
    };
  }, [rows]);

  const handleSort = (key: keyof Omit<ExpenseRow, 'id'>) => {
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

  const resolveSortIndicator = (key: keyof Omit<ExpenseRow, 'id'>) => {
    if (!sortConfig || sortConfig.key !== key) {
      return '⇅';
    }

    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const startEditingRow = (row: ExpenseRow) => {
    if (creating) {
      return;
    }

    setEditingRowId(row.id);
    setCreateForm({
      item: row.item ?? '',
      cost: row.cost ? String(row.cost) : '',
      purchase_date: normalizeDateInput(row.purchase_date ?? ''),
      receipt_name: row.receipt_name ?? '',
      purchase_location: row.purchase_location ?? ''
    });
    setShowNewEntry(true);
    setSuccessMessage(null);
  };

  const resetCreateForm = () => {
    setCreateForm({
      item: '',
      cost: '',
      purchase_date: '',
      receipt_name: '',
      purchase_location: ''
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

      const payload = {
        item: createForm.item,
        cost: createForm.cost,
        purchase_date: createForm.purchase_date,
        receipt_name: createForm.receipt_name,
        purchase_location: createForm.purchase_location
      };

      const isEditing = editingRowId !== null;
      const url = isEditing ? `${API_BASE}/api/expenses/${editingRowId}` : `${API_BASE}/api/expenses`;
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let message = 'Failed to create expense record';
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
      const updatedRow: ExpenseRow | undefined = data?.row;

      if (!updatedRow) {
        throw new Error('Server did not return the updated row.');
      }

      if (isEditing) {
        setRows((prev) =>
          prev.map((row) => (row.id === updatedRow.id ? updatedRow : row))
        );
        setSuccessMessage('Expense record updated successfully.');
      } else {
        setRows((prev) => [updatedRow, ...prev]);
        setSuccessMessage('Expense record created successfully.');
      }

      setShowNewEntry(false);
      setEditingRowId(null);
      resetCreateForm();
      setSortConfig(null);
    } catch (err: any) {
      console.error('Expense create error:', err);
      setError(err.message || 'Unable to create expense record');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!editingRowId) return;

    try {
      setDeleting(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/expenses/${editingRowId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        let message = 'Failed to delete expense record';
        try {
          const errorBody = await response.json();
          message = errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      setRows((prev) => prev.filter((row) => row.id !== editingRowId));
      setSuccessMessage('Expense record deleted successfully.');
      
      setShowNewEntry(false);
      setEditingRowId(null);
      resetCreateForm();
      setShowDeleteConfirm(false);
    } catch (err: any) {
      console.error('Expense delete error:', err);
      setError(err.message || 'Unable to delete expense record');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const handleTaxYearExport = async () => {
    try {
      setError(null);
      
      const taxYear = getCurrentTaxYear();
      const taxYearStartStr = taxYear.start.toISOString().slice(0, 10);
      const taxYearEndStr = taxYear.end.toISOString().slice(0, 10);
      
      // Filter expenses for the current tax year
      const taxYearExpenses = rows.filter((row) => {
        if (!row.purchase_date) return false;
        const purchaseDate = new Date(row.purchase_date);
        return purchaseDate >= taxYear.start && purchaseDate <= taxYear.end;
      });
      
      // Fetch stock data
      const stockResponse = await fetch(`${API_BASE}/api/stock`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!stockResponse.ok) {
        throw new Error('Failed to fetch stock data');
      }
      
      const stockData = await stockResponse.json();
      const allStockItems = Array.isArray(stockData.rows) ? stockData.rows : [];
      
      // Filter stock items purchased within tax year
      const taxYearStockPurchases = allStockItems.filter((item: any) => {
        if (!item.purchase_date) return false;
        const purchaseDate = new Date(item.purchase_date);
        return purchaseDate >= taxYear.start && purchaseDate <= taxYear.end;
      });
      
      // Filter stock items sold within tax year
      const taxYearStockSales = allStockItems.filter((item: any) => {
        if (!item.sale_date) return false;
        const saleDate = new Date(item.sale_date);
        return saleDate >= taxYear.start && saleDate <= taxYear.end;
      });
      
      // Calculate total expenses
      const totalExpenses = taxYearExpenses.reduce((sum, row) => {
        const cost = row.cost ? Number(row.cost) : 0;
        return sum + (Number.isNaN(cost) ? 0 : cost);
      }, 0);
      
      // Calculate total clothes cost (purchase_price for items purchased in tax year)
      const totalClothesCost = taxYearStockPurchases.reduce((sum: number, item: any) => {
        const price = item.purchase_price ? Number(item.purchase_price) : 0;
        return sum + (Number.isNaN(price) ? 0 : price);
      }, 0);
      
      // Calculate total sales (sale_price for items sold in tax year)
      const totalSales = taxYearStockSales.reduce((sum: number, item: any) => {
        const price = item.sale_price ? Number(item.sale_price) : 0;
        return sum + (Number.isNaN(price) ? 0 : price);
      }, 0);
      
      // Calculate net: sales - (expenses + clothes cost) 
      // This will be negative when costs exceed sales
      const netAmount = totalSales - (totalExpenses + totalClothesCost);
      
      // Create Tax Summary sheet
      const summaryData = [
        ['Tax Year Summary'],
        [''],
        ['Tax Year Period:', `${taxYearStartStr} to ${taxYearEndStr}`],
        [''],
        ['Total Expenses:', formatCurrency(totalExpenses)],
        ['Total Clothes Cost:', formatCurrency(totalClothesCost)],
        ['Total Sales:', formatCurrency(totalSales)],
        [''],
        ['Net Amount (Sales - Expenses - Clothes Cost):', formatCurrency(netAmount)],
        [''],
        ['Number of Expense Records:', taxYearExpenses.length],
        ['Number of Clothes Purchased:', taxYearStockPurchases.length],
        ['Number of Items Sold:', taxYearStockSales.length],
      ];
      
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      
      // Set column widths for summary sheet
      summarySheet['!cols'] = [
        { wch: 40 },
        { wch: 30 }
      ];
      
      // Right-align the second column (values column)
      const range = XLSX.utils.decode_range(summarySheet['!ref'] || 'A1');
      for (let row = 0; row <= range.e.r; row++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: 1 });
        if (!summarySheet[cellAddress]) continue;
        if (!summarySheet[cellAddress].s) {
          summarySheet[cellAddress].s = {};
        }
        if (!summarySheet[cellAddress].s.alignment) {
          summarySheet[cellAddress].s.alignment = {};
        }
        summarySheet[cellAddress].s.alignment.horizontal = 'right';
      }
      
      // Create Detailed Expenses sheet
      const expensesData = taxYearExpenses.map((row) => ({
        'Item': row.item || '—',
        'Purchase Location': row.purchase_location || '—',
        'Cost (£)': row.cost ? formatCurrency(row.cost) : '—',
        'Purchase Date': row.purchase_date ? formatDate(row.purchase_date) : '—',
        'Receipt Name': row.receipt_name || '—'
      }));
      
      const expensesSheet = XLSX.utils.json_to_sheet(expensesData);
      
      // Set column widths for expenses sheet
      expensesSheet['!cols'] = [
        { wch: 30 }, // Item
        { wch: 25 }, // Purchase Location
        { wch: 12 }, // Cost
        { wch: 15 }, // Purchase Date
        { wch: 25 }  // Receipt Name
      ];
      
      // Create Stock/Clothes sheet
      const stockSheetData = taxYearStockPurchases.map((item: any) => ({
        'Item Name': item.item_name || '—',
        'Category': item.category || '—',
        'Purchase Price (£)': item.purchase_price ? formatCurrency(item.purchase_price) : '—',
        'Purchase Date': item.purchase_date ? formatDate(item.purchase_date) : '—',
        'Sale Date': item.sale_date ? formatDate(item.sale_date) : '—',
        'Sale Price (£)': item.sale_price ? formatCurrency(item.sale_price) : '—',
        'Sold Platform': item.sold_platform || '—'
      }));
      
      const stockSheet = XLSX.utils.json_to_sheet(stockSheetData);
      
      // Set column widths for stock sheet
      stockSheet['!cols'] = [
        { wch: 40 }, // Item Name
        { wch: 20 }, // Category
        { wch: 15 }, // Purchase Price
        { wch: 15 }, // Purchase Date
        { wch: 15 }, // Sale Date
        { wch: 15 }, // Sale Price
        { wch: 15 }  // Sold Platform
      ];
      
      // Create workbook with all sheets
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Tax Summary');
      XLSX.utils.book_append_sheet(workbook, expensesSheet, 'Expenses');
      XLSX.utils.book_append_sheet(workbook, stockSheet, 'Clothes Purchased');
      
      // Generate filename with tax year (e.g., 2024-2025 for April 2024 to March 2025)
      const taxYearLabel = `${taxYear.start.getFullYear()}-${taxYear.end.getFullYear()}`;
      const filename = `Tax_Year_Expenses_${taxYearLabel}.xlsx`;
      
      // Write and download
      XLSX.writeFile(workbook, filename);
      
      setSuccessMessage(`Tax year export downloaded successfully: ${filename}`);
    } catch (err: any) {
      console.error('Tax year export error:', err);
      setError(err.message || 'Failed to export tax year data');
    }
  };

  const renderCellContent = (
    row: ExpenseRow,
    key: keyof Omit<ExpenseRow, 'id'>,
    formatter?: (value: Nullable<string | number>) => string,
    isDate?: boolean
  ) => {
    const value = row[key];

    if (formatter) {
      return formatter(value as Nullable<string | number>);
    }

    return value ?? '—';
  };

  return (
    <div className="stock-container">
      {error && <div className="stock-error">{error}</div>}
      {successMessage && <div className="stock-success">{successMessage}</div>}

      {showNewEntry && (
        <div className="new-entry-card">
          <div className="new-entry-grid">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', width: '100%' }}>
              <label className="new-entry-field">
                <span>Item</span>
                <input
                  type="text"
                  value={createForm.item}
                  onChange={(event) => handleCreateChange('item', event.target.value)}
                  placeholder="e.g. Postage, Packaging"
                />
              </label>
              <label className="new-entry-field">
                <span>Cost (£)</span>
                <input
                  type="number"
                  step="0.01"
                  value={createForm.cost}
                  onChange={(event) => handleCreateChange('cost', event.target.value)}
                  placeholder="e.g. 5.50"
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
                <span>Receipt Name</span>
                <input
                  type="text"
                  value={createForm.receipt_name}
                  onChange={(event) => handleCreateChange('receipt_name', event.target.value)}
                  placeholder="e.g. receipt_2024_01_15.pdf"
                />
              </label>
              <label className="new-entry-field">
                <span>Purchase Location</span>
                <input
                  type="text"
                  value={createForm.purchase_location}
                  onChange={(event) => handleCreateChange('purchase_location', event.target.value)}
                  placeholder="e.g. Amazon, eBay, Local Store"
                />
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
              Are you sure you want to delete this expense? This action cannot be undone.
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
        <div className="filter-group search-group">
          <div className="search-input-wrapper" style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%' }}>
            <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0 }}>
              <input
                type="text"
                className="search-input"
                placeholder="Search expenses..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ paddingRight: '40px', width: '100%', boxSizing: 'border-box' }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  title="Clear search"
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
              )}
            </div>
          </div>
        </div>

        <div className="filter-group filter-actions">
          <button
            type="button"
            className="new-entry-button"
            onClick={handleTaxYearExport}
            disabled={loading || rows.length === 0}
            style={{ marginRight: '12px' }}
          >
            Download Tax Year Spreadsheet
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
            + Add
          </button>
        </div>
      </div>

      <section className="stock-summary">
        <div className="summary-card">
          <span className="summary-label">Total Expenses</span>
          <span className="summary-value">{formatCurrency(totals.cost)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Records</span>
          <span className="summary-value">{sortedRows.length.toLocaleString()}</span>
        </div>
      </section>

      <div className="table-wrapper">
        <table className="stock-table">
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'item' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('item')}
                >
                  Item <span className="sort-indicator">{resolveSortIndicator('item')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'purchase_location' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('purchase_location')}
                >
                  Purchase Location <span className="sort-indicator">{resolveSortIndicator('purchase_location')}</span>
                </button>
              </th>
              <th>
                <button
                  type="button"
                  className={`sortable-header${sortConfig?.key === 'cost' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('cost')}
                >
                  Cost <span className="sort-indicator">{resolveSortIndicator('cost')}</span>
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
                  className={`sortable-header${sortConfig?.key === 'receipt_name' ? ` sorted-${sortConfig.direction}` : ''}`}
                  onClick={() => handleSort('receipt_name')}
                >
                  Receipt Name <span className="sort-indicator">{resolveSortIndicator('receipt_name')}</span>
                </button>
              </th>
              <th className="stock-table-actions-header">Edit</th>
            </tr>
          </thead>
          <tbody>
            {!loading && sortedRows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  No expense records found.
                </td>
              </tr>
            )}
            {sortedRows.map((row) => (
              <tr key={row.id}>
                <td>{renderCellContent(row, 'item')}</td>
                <td>{renderCellContent(row, 'purchase_location')}</td>
                <td>{renderCellContent(row, 'cost', formatCurrency)}</td>
                <td>
                  {renderCellContent(
                    row,
                    'purchase_date',
                    (val) => formatDate(val as Nullable<string>),
                    true
                  )}
                </td>
                <td>{renderCellContent(row, 'receipt_name')}</td>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Expenses;

