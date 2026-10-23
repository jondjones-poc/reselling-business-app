import React, { useEffect, useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import '../react-datepicker-dark.css';
import { useSearchParams } from 'react-router-dom';
import { getApiBase } from '../utils/apiBase';
import AccountantExport from './AccountantExport';
import StockExpenses from './StockExpenses';
import SyncEbayFees from './SyncEbayFees';
import './Stock.css';
import './StockExpenses.css';

const API_BASE = getApiBase();

const EXPENSE_MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

const Accounting: React.FC = () => {
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
  const [expenseYearFilter, setExpenseYearFilter] = useState<number | 'all'>('all');
  const [expenseMonthFilter, setExpenseMonthFilter] = useState<number | 'all'>('all');
  const [expensesPage, setExpensesPage] = useState(1);
  const EXPENSES_PAGE_SIZE = 50;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();

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

    if (expenseYearFilter !== 'all' || expenseMonthFilter !== 'all') {
      filtered = filtered.filter((row) => {
        if (!row.purchase_date) return false;
        const date = new Date(row.purchase_date);
        if (Number.isNaN(date.getTime())) return false;
        if (expenseYearFilter !== 'all' && date.getFullYear() !== expenseYearFilter) return false;
        if (expenseMonthFilter !== 'all' && date.getMonth() + 1 !== expenseMonthFilter) return false;
        return true;
      });
    }

    return filtered;
  }, [rows, searchTerm, expenseYearFilter, expenseMonthFilter]);

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

  useEffect(() => {
    setExpensesPage(1);
  }, [searchTerm, sortConfig, expenseYearFilter, expenseMonthFilter]);

  const expenseYearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, i) => currentYear - i);
  }, []);

  const expensesTotalPages = Math.max(1, Math.ceil(sortedRows.length / EXPENSES_PAGE_SIZE));
  const pagedExpenseRows = useMemo(
    () => sortedRows.slice((expensesPage - 1) * EXPENSES_PAGE_SIZE, expensesPage * EXPENSES_PAGE_SIZE),
    [sortedRows, expensesPage]
  );

  const totals = useMemo(() => {
    let totalCost = 0;

    sortedRows.forEach((row) => {
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
  }, [sortedRows]);

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

  const renderCellContent = (
    row: ExpenseRow,
    key: keyof Omit<ExpenseRow, 'id'>,
    formatter?: (value: Nullable<string | number>) => string,
  ) => {
    const value = row[key];

    if (formatter) {
      return formatter(value as Nullable<string | number>);
    }

    return value ?? '—';
  };

  const rawTab = searchParams.get('tab');
  const accountingTab =
    rawTab === 'sales' || rawTab === 'stock-expenses' || rawTab === 'sync-ebay-fees' ? rawTab : 'expenses';

  const setAccountingTab = (next: 'expenses' | 'sales' | 'stock-expenses' | 'sync-ebay-fees') => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <div className="stock-container">
      <nav className="expenses-tabs" role="tablist" aria-label="Accounting sections">
        <button
          type="button"
          role="tab"
          id="accounting-tab-stock-expenses"
          aria-selected={accountingTab === 'stock-expenses'}
          aria-controls="accounting-panel-stock-expenses"
          className={`expenses-tab${accountingTab === 'stock-expenses' ? ' expenses-tab--active' : ''}`}
          onClick={() => setAccountingTab('stock-expenses')}
        >
          eBay Sales Expenses
        </button>
        <button
          type="button"
          role="tab"
          id="accounting-tab-expenses"
          aria-selected={accountingTab === 'expenses'}
          aria-controls="accounting-panel-expenses"
          className={`expenses-tab${accountingTab === 'expenses' ? ' expenses-tab--active' : ''}`}
          onClick={() => setAccountingTab('expenses')}
        >
          Expenses
        </button>
        <button
          type="button"
          role="tab"
          id="accounting-tab-sync-ebay-fees"
          aria-selected={accountingTab === 'sync-ebay-fees'}
          aria-controls="accounting-panel-sync-ebay-fees"
          className={`expenses-tab${accountingTab === 'sync-ebay-fees' ? ' expenses-tab--active' : ''}`}
          onClick={() => setAccountingTab('sync-ebay-fees')}
        >
          Sync eBay Fees
        </button>
        <button
          type="button"
          role="tab"
          id="accounting-tab-sales"
          aria-selected={accountingTab === 'sales'}
          aria-controls="accounting-panel-sales"
          className={`expenses-tab${accountingTab === 'sales' ? ' expenses-tab--active' : ''}`}
          onClick={() => setAccountingTab('sales')}
        >
          Company Accounts
        </button>
      </nav>

      {accountingTab === 'sales' ? (
        <div id="accounting-panel-sales" role="tabpanel" aria-labelledby="accounting-tab-sales">
          <AccountantExport />
        </div>
      ) : accountingTab === 'stock-expenses' ? (
        <div id="accounting-panel-stock-expenses" role="tabpanel" aria-labelledby="accounting-tab-stock-expenses">
          <StockExpenses />
        </div>
      ) : accountingTab === 'sync-ebay-fees' ? (
        <div id="accounting-panel-sync-ebay-fees" role="tabpanel" aria-labelledby="accounting-tab-sync-ebay-fees">
          <SyncEbayFees />
        </div>
      ) : (
        <div id="accounting-panel-expenses" role="tabpanel" aria-labelledby="accounting-tab-expenses">
      <section className="stock-summary">
        <div className="summary-card">
          <span className="summary-label">Total expense records</span>
          <span className="summary-value">{sortedRows.length.toLocaleString()}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Total price paid</span>
          <span className="summary-value">{formatCurrency(totals.cost)}</span>
        </div>
      </section>

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

      <div className="stock-filters" style={{ flexWrap: 'wrap', justifyContent: 'center', rowGap: '12px' }}>
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
          <select
            value={expenseYearFilter}
            onChange={(e) => setExpenseYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            aria-label="Filter by year"
            className="stock-expenses-select"
          >
            <option value="all">All years</option>
            {expenseYearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
          <select
            value={expenseMonthFilter}
            onChange={(e) => setExpenseMonthFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            aria-label="Filter by month"
            className="stock-expenses-select"
          >
            <option value="all">All months</option>
            {EXPENSE_MONTH_LABELS.map((label, index) => (
              <option key={index + 1} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
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
            {pagedExpenseRows.map((row) => (
              <tr key={row.id}>
                <td>{renderCellContent(row, 'item')}</td>
                <td>{renderCellContent(row, 'purchase_location')}</td>
                <td>{renderCellContent(row, 'cost', formatCurrency)}</td>
                <td>
                  {renderCellContent(
                    row,
                    'purchase_date',
                    (val) => formatDate(val as Nullable<string>),
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

      <div className="stock-expenses-pagination">
        <button type="button" onClick={() => setExpensesPage((p) => Math.max(1, p - 1))} disabled={expensesPage <= 1}>
          Previous
        </button>
        <span>
          Page {expensesPage} of {expensesTotalPages} ({sortedRows.length} items)
        </span>
        <button
          type="button"
          onClick={() => setExpensesPage((p) => Math.min(expensesTotalPages, p + 1))}
          disabled={expensesPage >= expensesTotalPages}
        >
          Next
        </button>
      </div>
        </div>
      )}
    </div>
  );
};

export default Accounting;
