import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../utils/apiBase';
import './StockExpenses.css';

const API_BASE = getApiBase();

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PAGE_SIZE = 50;

type ProfitFilter = 'all' | 'top20' | 'bottom20' | 'loss';

interface StockExpenseRow {
  stockId: number;
  itemName: string | null;
  platform: string;
  ebayId: string | null;
  orderId: string | null;
  departmentId: number | null;
  departmentName: string;
  categoryId: number | null;
  categoryName: string;
  purchasePrice: number | null;
  salePrice: number | null;
  sellingFees: number;
  buyerPostage: number;
  postagePaid: number;
  totalPricePaid: number | null;
  finalProfit: number | null;
  hasFeeData: boolean;
}

interface DepartmentOption {
  id: number;
  department_name: string;
}

interface CategoryOption {
  id: number;
  category_name: string;
  department_id: number | null;
}

function formatGbp(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
}

const StockExpenses: React.FC = () => {
  const [rows, setRows] = useState<StockExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const [yearFilter, setYearFilter] = useState<number | 'all'>('all');
  const [monthFilter, setMonthFilter] = useState<number | 'all'>('all');
  const [departmentFilter, setDepartmentFilter] = useState<number | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<number | 'all'>('all');
  const [profitFilter, setProfitFilter] = useState<ProfitFilter>('all');

  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, i) => currentYear - i);
  }, []);

  const categoryOptionsForDepartment = useMemo(() => {
    if (departmentFilter === 'all') return categories;
    return categories.filter((c) => c.department_id === departmentFilter);
  }, [categories, departmentFilter]);

  useEffect(() => {
    (async () => {
      try {
        const [deptRes, catRes] = await Promise.all([
          fetch(`${API_BASE}/api/departments`),
          fetch(`${API_BASE}/api/categories`),
        ]);
        const deptData = await deptRes.json();
        const catData = await catRes.json();
        setDepartments(Array.isArray(deptData.rows) ? deptData.rows : []);
        setCategories(Array.isArray(catData.rows) ? catData.rows : []);
      } catch {
        // Filters degrade to empty dropdowns; the table itself still loads.
      }
    })();
  }, []);

  // Changing department can leave a stale category selected — reset it.
  useEffect(() => {
    if (categoryFilter === 'all') return;
    if (!categoryOptionsForDepartment.some((c) => c.id === categoryFilter)) {
      setCategoryFilter('all');
    }
  }, [categoryOptionsForDepartment, categoryFilter]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (yearFilter !== 'all') params.set('year', String(yearFilter));
      if (monthFilter !== 'all') params.set('month', String(monthFilter));
      if (departmentFilter !== 'all') params.set('departmentId', String(departmentFilter));
      if (categoryFilter !== 'all') params.set('categoryId', String(categoryFilter));
      if (profitFilter !== 'all') params.set('profitFilter', profitFilter);

      const res = await fetch(`${API_BASE}/api/accounting/stock-expenses?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load stock expenses');
      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setTotalPages(Number.isInteger(data.totalPages) ? data.totalPages : 1);
      setTotalCount(Number.isInteger(data.totalCount) ? data.totalCount : 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stock expenses');
    } finally {
      setLoading(false);
    }
  }, [page, yearFilter, monthFilter, departmentFilter, categoryFilter, profitFilter]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  // Any filter change should jump back to page 1 rather than keep an out-of-range page.
  useEffect(() => {
    setPage(1);
  }, [yearFilter, monthFilter, departmentFilter, categoryFilter, profitFilter]);

  return (
    <div className="stock-expenses">
      <div className="stock-expenses-filters">
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          aria-label="Filter by year"
          className="stock-expenses-select"
        >
          <option value="all">All years</option>
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          aria-label="Filter by month"
          className="stock-expenses-select"
        >
          <option value="all">All months</option>
          {MONTH_LABELS.map((label, index) => (
            <option key={index + 1} value={index + 1}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          aria-label="Filter by department"
          className="stock-expenses-select"
        >
          <option value="all">All departments</option>
          {departments.map((dept) => (
            <option key={dept.id} value={dept.id}>
              {dept.department_name}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          aria-label="Filter by category"
          className="stock-expenses-select"
        >
          <option value="all">All categories</option>
          {categoryOptionsForDepartment.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.category_name}
            </option>
          ))}
        </select>
        <select
          value={profitFilter}
          onChange={(e) => setProfitFilter(e.target.value as ProfitFilter)}
          aria-label="Filter by profit"
          className="stock-expenses-select"
        >
          <option value="all">All items</option>
          <option value="top20">Top 20% most profitable</option>
          <option value="bottom20">Bottom 20% least profitable</option>
          <option value="loss">Items I lost money on</option>
        </select>
      </div>

      {error && <div className="stock-error">{error}</div>}
      {loading ? (
        <p className="stock-expenses-muted">Loading…</p>
      ) : (
        <>
          <div className="table-wrapper">
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Stock ID</th>
                  <th>Name</th>
                  <th>eBay ID</th>
                  <th>Order Number</th>
                  <th>Department</th>
                  <th>Category</th>
                  <th>Cost</th>
                  <th>Item Sold Price</th>
                  <th>Postage Charged To Buyer</th>
                  <th>Total Price Paid</th>
                  <th>Fees</th>
                  <th>Postage I Paid</th>
                  <th>Final Profit</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="empty-state">
                      No sold items found.
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.stockId} className={row.hasFeeData ? undefined : 'stock-expenses-row--unsynced'}>
                    <td>{row.stockId}</td>
                    <td>{row.itemName ?? '—'}</td>
                    <td>{row.ebayId ?? '—'}</td>
                    <td>{row.orderId ?? '—'}</td>
                    <td>{row.departmentName || '—'}</td>
                    <td>{row.categoryName || '—'}</td>
                    <td>{formatGbp(row.purchasePrice)}</td>
                    <td>{formatGbp(row.salePrice)}</td>
                    <td>{row.hasFeeData ? formatGbp(row.buyerPostage) : '—'}</td>
                    <td>{formatGbp(row.totalPricePaid)}</td>
                    <td>{row.hasFeeData ? formatGbp(row.sellingFees) : '—'}</td>
                    <td>{row.hasFeeData ? formatGbp(row.postagePaid) : '—'}</td>
                    <td
                      className={
                        row.finalProfit == null
                          ? undefined
                          : row.finalProfit >= 0
                            ? 'stock-expenses-profit--positive'
                            : 'stock-expenses-profit--negative'
                      }
                    >
                      {row.hasFeeData ? formatGbp(row.finalProfit) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stock-expenses-pagination">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Previous
            </button>
            <span>
              Page {page} of {totalPages} ({totalCount} items)
            </span>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default StockExpenses;
