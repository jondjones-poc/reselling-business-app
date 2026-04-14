import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { pingDatabase } from '../utils/dbPing';
import { getApiBase } from '../utils/apiBase';
import './Orders.css';

const API_BASE = getApiBase();

type Nullable<T> = T | null | undefined;

interface StockRow {
  id: number;
  item_name: Nullable<string>;
  purchase_price: Nullable<string | number>;
  purchase_date: Nullable<string>;
  sale_date: Nullable<string>;
  sale_price: Nullable<string | number>;
  sold_platform: Nullable<string>;
  net_profit: Nullable<string | number>;
  vinted_id: Nullable<string>;
  ebay_id: Nullable<string>;
  depop_id: Nullable<string>;
  brand_id: Nullable<number>;
  category_id: Nullable<number>;
}

interface StockApiResponse {
  rows: StockRow[];
  count: number;
}

interface OrderItem {
  id: number;
  item_name: Nullable<string>;
  purchase_price: Nullable<string | number>;
  vinted_id: Nullable<string>;
  ebay_id: Nullable<string>;
  depop_id: Nullable<string>;
  sold_platform: Nullable<string>;
  brand_id: Nullable<number>;
  category_id: Nullable<number>;
}


type OrdersTab = 'to-pack' | 'sales';

/** Compact eBay wordmark (brand colors) for buttons — not an official asset; typographic approximation. */
function EbayLogoIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 52 18"
      width={52}
      height={18}
      aria-hidden
      focusable="false"
    >
      <text
        x="0"
        y="14.5"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="15"
        fontWeight="700"
        letterSpacing="-0.03em"
      >
        <tspan fill="#E53238">e</tspan>
        <tspan fill="#0064D2">b</tspan>
        <tspan fill="#F5AF02">a</tspan>
        <tspan fill="#86B817">y</tspan>
      </text>
    </svg>
  );
}

const ebayListingHref = (ebayId: Nullable<string>): string | null => {
  const s = ebayId?.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://www.ebay.co.uk/itm/${encodeURIComponent(s)}`;
};

const vintedListingHref = (vintedId: Nullable<string>): string | null => {
  const s = vintedId?.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://www.vinted.co.uk/items/${encodeURIComponent(s)}`;
};

/** Current calendar week Monday 00:00:00 – Sunday 23:59:59.999 (local time). */
function getMondayToSundayBounds(ref: Date): { weekStart: Date; weekEnd: Date } {
  const day = ref.getDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(
    ref.getFullYear(),
    ref.getMonth(),
    ref.getDate() + offsetToMonday,
    0,
    0,
    0,
    0
  );
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
}

function parseSoldRowDate(row: StockRow): Date | null {
  const s = row.sale_date;
  if (s == null || String(s).trim() === '') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

type SalesPlatformFilter = 'all' | 'ebay' | 'vinted';

type SalesDateRangeFilter = 'all' | 'current-month' | 'last-month';

function getLocalMonthStartEnd(year: number, monthIndex: number): { start: Date; end: Date } {
  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function soldRowMatchesDateRange(row: StockRow, filter: SalesDateRangeFilter): boolean {
  if (filter === 'all') return true;
  const d = parseSoldRowDate(row);
  if (!d) return false;
  const ref = new Date();
  const y = ref.getFullYear();
  const m = ref.getMonth();
  if (filter === 'current-month') {
    const { start, end } = getLocalMonthStartEnd(y, m);
    return d >= start && d <= end;
  }
  if (filter === 'last-month') {
    const lm = m === 0 ? 11 : m - 1;
    const ly = m === 0 ? y - 1 : y;
    const { start, end } = getLocalMonthStartEnd(ly, lm);
    return d >= start && d <= end;
  }
  return true;
}

function soldRowMatchesPlatformFilter(row: StockRow, filter: SalesPlatformFilter): boolean {
  if (filter === 'all') return true;
  const p = row.sold_platform?.trim().toLowerCase() ?? '';
  if (filter === 'ebay') {
    if (p === 'ebay') return true;
    if (!p && row.ebay_id?.trim() && !row.vinted_id?.trim()) return true;
    return false;
  }
  if (filter === 'vinted') {
    if (p === 'vinted') return true;
    if (!p && row.vinted_id?.trim() && !row.ebay_id?.trim()) return true;
    return false;
  }
  return true;
}

/** `filterBrandId` is numeric string for a brand row id, or `'all'`. */
function soldRowMatchesBrandFilter(row: StockRow, filterBrandId: string): boolean {
  if (filterBrandId === 'all') return true;
  const id = parseInt(filterBrandId, 10);
  if (!Number.isFinite(id)) return true;
  const bid = row.brand_id;
  return bid != null && Number(bid) === id;
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

interface VintedEbayViolation {
  id: number;
  item_name: Nullable<string>;
  ebay_id: string;
  ebay_url: string;
  vinted_id: Nullable<string>;
}

interface VintedEbayCheckResponse {
  checked: number;
  violations: VintedEbayViolation[];
  apiErrors: Array<{ stock_id: number; message: string; httpStatus: number | null }>;
}

interface MissingEbayStockRow {
  legacy_item_id: string;
  item_title: Nullable<string>;
  order_ids: string[];
  ebay_url: string;
}

interface MissingEbayStockMatchResponse {
  window_days: number;
  ebay_line_items_seen: number;
  ebay_distinct_listings: number;
  stock_ebay_ids_count: number;
  missing: MissingEbayStockRow[];
}

interface OrdersApiResponse {
  rows: Array<{
    order_id: number;
    stock_id: number;
    created_at: string;
    updated_at: string;
    id: number;
    item_name: Nullable<string>;
    category_id: Nullable<number>;
    purchase_price: Nullable<string | number>;
    purchase_date: Nullable<string>;
    sale_date: Nullable<string>;
    sale_price: Nullable<string | number>;
    sold_platform: Nullable<string>;
    net_profit: Nullable<string | number>;
    vinted_id: Nullable<string>;
    ebay_id: Nullable<string>;
    depop_id: Nullable<string>;
  }>;
  count: number;
}

const Orders: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const ordersTab: OrdersTab = searchParams.get('tab') === 'sales' ? 'sales' : 'to-pack';

  const setOrdersTab = (tab: OrdersTab) => {
    try {
      sessionStorage.setItem('ordersTab', tab);
    } catch {
      /* ignore */
    }
    setSearchParams({ tab }, { replace: true });
  };
  const [allStock, setAllStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [clearConfirmCount, setClearConfirmCount] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [soldRows, setSoldRows] = useState<StockRow[]>([]);
  const [soldLoading, setSoldLoading] = useState(false);
  const [soldError, setSoldError] = useState<string | null>(null);
  const [salesPlatformFilter, setSalesPlatformFilter] = useState<SalesPlatformFilter>('all');
  const [salesBrandFilter, setSalesBrandFilter] = useState<string>('all');
  const [salesBrands, setSalesBrands] = useState<Array<{ id: number; brand_name: string }>>([]);
  const [salesBrandsLoading, setSalesBrandsLoading] = useState(false);
  const [salesDateRangeFilter, setSalesDateRangeFilter] = useState<SalesDateRangeFilter>('all');
  const [vintedEbayCheckLoading, setVintedEbayCheckLoading] = useState(false);
  const [vintedEbayViolations, setVintedEbayViolations] = useState<VintedEbayViolation[]>([]);
  const [vintedEbayCheckError, setVintedEbayCheckError] = useState<string | null>(null);
  const [vintedEbayCheckApiErrors, setVintedEbayCheckApiErrors] = useState<
    VintedEbayCheckResponse['apiErrors']
  >([]);
  const [missingEbayCheckLoading, setMissingEbayCheckLoading] = useState(false);
  const [missingEbayInStock, setMissingEbayInStock] = useState<MissingEbayStockRow[]>([]);
  const [missingEbayCheckError, setMissingEbayCheckError] = useState<string | null>(null);
  const [ebayOAuthStatus, setEbayOAuthStatus] = useState<{
    connected: boolean;
    user_name?: string;
    ebay_user_id?: string;
    updated_at?: string;
    reason?: string;
    integration_key?: string;
    error?: string;
  } | null>(null);

  const refreshEbayOAuthStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/ebay/oauth/status`);
      const j = await r.json();
      setEbayOAuthStatus(j);
    } catch {
      setEbayOAuthStatus({ connected: false, reason: 'status_fetch_failed' });
    }
  }, []);

  // Load all stock data
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
      setAllStock(Array.isArray(data.rows) ? data.rows : []);
    } catch (err: any) {
      console.error('Stock load error:', err);
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        setError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
      } else {
        setError(err.message || 'Unable to load stock data');
      }
      setAllStock([]);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to get listing platform display
  const getListingPlatform = (vinted_id: Nullable<string>, ebay_id: Nullable<string>): string => {
    const platforms: string[] = [];
    if (vinted_id && vinted_id.trim()) platforms.push('Vinted');
    if (ebay_id && ebay_id.trim()) platforms.push('eBay');
    if (platforms.length === 0) return 'Not Listed';
    return platforms.join(', ');
  };

  // Load order items from API
  const loadOrders = async () => {
    try {
      setOrdersLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/orders`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to load orders data');
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'Unexpected response format');
      }

      const data: OrdersApiResponse = await response.json();
      // Transform API response to OrderItem format
      const transformed = (data.rows ?? []).map((row) => ({
        id: row.id,
        item_name: row.item_name,
        purchase_price: row.purchase_price,
        vinted_id: row.vinted_id,
        ebay_id: row.ebay_id,
        depop_id: row.depop_id,
        sold_platform: row.sold_platform,
        brand_id: (row as any).brand_id ?? null,
        category_id: (row as any).category_id ?? null
      }));
      setOrderItems(transformed);
    } catch (err: any) {
      console.error('Orders load error:', err);
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        setError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
      } else {
        setError(err.message || 'Unable to load orders data');
      }
      setOrderItems([]);
    } finally {
      setOrdersLoading(false);
    }
  };

  // Load stock and orders on mount; wake DB (free-tier cold start) before fetches
  useEffect(() => {
    pingDatabase();
    loadStock();
    loadOrders();
  }, []);

  // Normalize URL: /orders with missing/invalid ?tab= uses last tab from sessionStorage (nav + refresh).
  useEffect(() => {
    const q = searchParams.get('tab');
    if (q === 'sales' || q === 'to-pack') {
      try {
        sessionStorage.setItem('ordersTab', q);
      } catch {
        /* ignore */
      }
      return;
    }
    let initial: OrdersTab = 'to-pack';
    try {
      const saved = sessionStorage.getItem('ordersTab');
      if (saved === 'sales') initial = 'sales';
    } catch {
      /* ignore */
    }
    setSearchParams({ tab: initial }, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (ordersTab !== 'sales') {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setSoldLoading(true);
        setSoldError(null);
        const response = await fetch(`${API_BASE}/api/stock/sold`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || 'Failed to load sold items');
        }
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          throw new Error(text || 'Unexpected response format');
        }
        const data: StockApiResponse = await response.json();
        if (!cancelled) {
          setSoldRows(Array.isArray(data.rows) ? data.rows : []);
        }
      } catch (err: any) {
        console.error('Sold stock load error:', err);
        if (!cancelled) {
          if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
            setSoldError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
          } else {
            setSoldError(err.message || 'Unable to load sold items');
          }
          setSoldRows([]);
        }
      } finally {
        if (!cancelled) setSoldLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ordersTab]);

  useEffect(() => {
    if (ordersTab !== 'sales') {
      return;
    }
    void refreshEbayOAuthStatus();
  }, [ordersTab, searchParams, refreshEbayOAuthStatus]);

  useEffect(() => {
    if (ordersTab !== 'sales') return;
    const flag = searchParams.get('ebay_oauth');
    if (!flag) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      next.delete('ebay_oauth');
      next.delete('ebay_oauth_msg');
      setSearchParams(next, { replace: true });
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [ordersTab, searchParams, setSearchParams]);

  useEffect(() => {
    if (ordersTab !== 'sales') {
      setSalesPlatformFilter('all');
      setSalesBrandFilter('all');
      setSalesDateRangeFilter('all');
    }
  }, [ordersTab]);

  useEffect(() => {
    if (ordersTab !== 'sales') return;
    let cancelled = false;
    (async () => {
      try {
        setSalesBrandsLoading(true);
        const response = await fetch(`${API_BASE}/api/brands`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!response.ok) {
          throw new Error('Failed to load brands');
        }
        const data = await response.json();
        const rows = Array.isArray(data.rows) ? data.rows : [];
        const mapped = rows
          .map((b: { id?: unknown; brand_name?: unknown }) => ({
            id: Number(b.id),
            brand_name: b.brand_name != null ? String(b.brand_name).trim() : '',
          }))
          .filter((b: { id: number }) => Number.isFinite(b.id) && b.id >= 1)
          .sort((a: { brand_name: string }, b: { brand_name: string }) =>
            a.brand_name.localeCompare(b.brand_name, 'en-GB', { sensitivity: 'base' })
          );
        if (!cancelled) setSalesBrands(mapped);
      } catch (e) {
        console.error('Sales tab brands load error:', e);
        if (!cancelled) setSalesBrands([]);
      } finally {
        if (!cancelled) setSalesBrandsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ordersTab]);

  useEffect(() => {
    if (salesBrandFilter === 'all' || salesBrands.length === 0) return;
    const id = parseInt(salesBrandFilter, 10);
    if (!Number.isFinite(id) || !salesBrands.some((b) => b.id === id)) {
      setSalesBrandFilter('all');
    }
  }, [salesBrands, salesBrandFilter]);

  // Search results - search all items
  // Uses AND logic: all words must match (order doesn't matter)
  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) {
      return [];
    }

    const searchLower = searchTerm.toLowerCase().trim();
    const searchWords = searchLower.split(/\s+/).filter(word => word.length > 0);
    
    return allStock
      .filter((row) => {
        const itemName = row.item_name ? String(row.item_name).toLowerCase() : '';
        const vintedId = row.vinted_id ? String(row.vinted_id).toLowerCase() : '';
        const ebayId = row.ebay_id ? String(row.ebay_id).toLowerCase() : '';
        const skuId = String(row.id).toLowerCase();
        
        // For item name: match if ALL words are present (AND logic, order doesn't matter)
        const itemNameMatches = searchWords.length > 0 && searchWords.every(word => itemName.includes(word));
        
        // For IDs: exact match (for precise ID searches)
        const idMatches = vintedId.includes(searchLower) || ebayId.includes(searchLower) || skuId.includes(searchLower);
        
        return itemNameMatches || idMatches;
      })
      .slice(0, 10); // Limit to 10 results
  }, [searchTerm, allStock]);

  const soldByPlatformOnly = useMemo(
    () => soldRows.filter((r) => soldRowMatchesPlatformFilter(r, salesPlatformFilter)),
    [soldRows, salesPlatformFilter]
  );

  const soldByPlatformAndBrand = useMemo(
    () => soldByPlatformOnly.filter((r) => soldRowMatchesBrandFilter(r, salesBrandFilter)),
    [soldByPlatformOnly, salesBrandFilter]
  );

  const soldRowsFiltered = useMemo(
    () => soldByPlatformAndBrand.filter((r) => soldRowMatchesDateRange(r, salesDateRangeFilter)),
    [soldByPlatformAndBrand, salesDateRangeFilter]
  );

  const salesStats = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = now.getMonth();
    const { weekStart, weekEnd } = getMondayToSundayBounds(now);
    let thisMonth = 0;
    let thisWeekMonSun = 0;
    for (const row of soldRowsFiltered) {
      const d = parseSoldRowDate(row);
      if (!d) continue;
      if (d.getFullYear() === y && d.getMonth() === mo) thisMonth += 1;
      if (d >= weekStart && d <= weekEnd) thisWeekMonSun += 1;
    }
    const currentMonthName = now.toLocaleString('en-GB', { month: 'long' });
    let periodLabel: string | null = null;
    if (salesDateRangeFilter === 'current-month') {
      periodLabel = now.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    } else if (salesDateRangeFilter === 'last-month') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      periodLabel = d.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    }
    return {
      total: soldRowsFiltered.length,
      thisMonth,
      thisWeekMonSun,
      currentMonthName,
      dateRangeFilter: salesDateRangeFilter,
      periodLabel,
    };
  }, [soldRowsFiltered, salesDateRangeFilter]);

  const handleAddItem = async (item: StockRow) => {
    // Check if item is already in the order (client-side check)
    if (orderItems.some((orderItem) => orderItem.id === item.id)) {
      return;
    }

    try {
      setOrdersLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stock_id: item.id }),
      });

      if (!response.ok) {
        let message = 'Failed to add item to orders';
        try {
          const errorBody = await response.json();
          message = errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      // Reload orders to get the updated list
      await loadOrders();
      setSearchTerm(''); // Clear search after adding
    } catch (err: any) {
      console.error('Add to orders error:', err);
      setError(err.message || 'Unable to add item to orders');
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleRemoveItem = async (id: number) => {
    try {
      setOrdersLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/orders/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        let message = 'Failed to remove item from orders';
        try {
          const errorBody = await response.json();
          message = errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      // Reload orders to get the updated list
      await loadOrders();
    } catch (err: any) {
      console.error('Remove from orders error:', err);
      setError(err.message || 'Unable to remove item from orders');
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleEditItem = (item: OrderItem) => {
    // Navigate to Stock page with editId query parameter
    navigate(`/stock?editId=${item.id}`);
  };

  const handleClearList = async () => {
    if (clearConfirmCount === 0) {
      setClearConfirmCount(1);
      // Reset confirmation count after 2 seconds
      setTimeout(() => {
        setClearConfirmCount(0);
      }, 2000);
    } else {
      // Confirmed - clear the list
      try {
        setOrdersLoading(true);
        setError(null);

        const response = await fetch(`${API_BASE}/api/orders`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          let message = 'Failed to clear orders';
          try {
            const errorBody = await response.json();
            message = errorBody?.error || message;
          } catch {
            const text = await response.text();
            message = text || message;
          }
          throw new Error(message);
        }

        // Reload orders to get the updated list (should be empty)
        await loadOrders();
        setClearConfirmCount(0);
      } catch (err: any) {
        console.error('Clear orders error:', err);
        setError(err.message || 'Unable to clear orders');
      } finally {
        setOrdersLoading(false);
      }
    }
  };

  const handleVintedEbayCheck = async () => {
    setVintedEbayCheckLoading(true);
    setVintedEbayCheckError(null);
    try {
      const response = await fetch(`${API_BASE}/api/stock/vinted-sold-ebay-active-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const text = await response.text();
      let data: VintedEbayCheckResponse | null = null;
      try {
        data = text ? (JSON.parse(text) as VintedEbayCheckResponse) : null;
      } catch {
        /* not JSON */
      }
      if (!response.ok) {
        const msg =
          (data as { error?: string; details?: string } | null)?.error ||
          (data as { error?: string; details?: string } | null)?.details ||
          text ||
          'Check failed';
        throw new Error(msg);
      }
      if (!data) {
        throw new Error('Unexpected empty response');
      }
      setVintedEbayViolations(Array.isArray(data.violations) ? data.violations : []);
      setVintedEbayCheckApiErrors(Array.isArray(data.apiErrors) ? data.apiErrors : []);
      if (data.apiErrors?.length) {
        console.warn('eBay check API errors:', data.apiErrors);
      }
    } catch (err: any) {
      console.error('Vinted / eBay check error:', err);
      setVintedEbayViolations([]);
      setVintedEbayCheckApiErrors([]);
      setVintedEbayCheckError(
        err.message === 'Failed to fetch' || err.name === 'TypeError'
          ? 'Unable to connect to server. Is the API running?'
          : err.message || 'Check failed'
      );
    } finally {
      setVintedEbayCheckLoading(false);
    }
  };

  const handleMissingEbayOrderCheck = async () => {
    setMissingEbayCheckLoading(true);
    setMissingEbayCheckError(null);
    try {
      const response = await fetch(`${API_BASE}/api/stock/ebay-sold-missing-stock-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const text = await response.text();
      let data: MissingEbayStockMatchResponse | null = null;
      try {
        data = text ? (JSON.parse(text) as MissingEbayStockMatchResponse) : null;
      } catch {
        /* not JSON */
      }
      if (!response.ok) {
        const body = data as { error?: string; details?: string; code?: string } | null;
        const msg =
          body?.details ||
          body?.error ||
          text ||
          'Check failed';
        throw new Error(msg);
      }
      if (!data) {
        throw new Error('Unexpected empty response');
      }
      setMissingEbayInStock(Array.isArray(data.missing) ? data.missing : []);
    } catch (err: any) {
      console.error('Missing eBay order check:', err);
      setMissingEbayInStock([]);
      setMissingEbayCheckError(
        err.message === 'Failed to fetch' || err.name === 'TypeError'
          ? 'Unable to connect to server. Is the API running?'
          : err.message || 'Check failed'
      );
    } finally {
      setMissingEbayCheckLoading(false);
    }
  };

  const vintedEbayViolationIdSet = useMemo(
    () => new Set(vintedEbayViolations.map((v) => v.id)),
    [vintedEbayViolations]
  );

  return (
    <div className="orders-container">
      <div className="orders-tabs" role="tablist" aria-label="Orders views">
        <button
          type="button"
          role="tab"
          id="orders-tab-to-pack"
          aria-selected={ordersTab === 'to-pack'}
          aria-controls="orders-panel-to-pack"
          className={`orders-tab${ordersTab === 'to-pack' ? ' orders-tab--active' : ''}`}
          onClick={() => setOrdersTab('to-pack')}
        >
          To Pack
        </button>
        <button
          type="button"
          role="tab"
          id="orders-tab-sales"
          aria-selected={ordersTab === 'sales'}
          aria-controls="orders-panel-sales"
          className={`orders-tab${ordersTab === 'sales' ? ' orders-tab--active' : ''}`}
          onClick={() => setOrdersTab('sales')}
        >
          Sales
        </button>
      </div>

      {ordersTab === 'to-pack' && error && <div className="orders-error">{error}</div>}
      {ordersTab === 'sales' && soldError && <div className="orders-error">{soldError}</div>}

      {ordersTab === 'to-pack' && (
        <div
          id="orders-panel-to-pack"
          role="tabpanel"
          aria-labelledby="orders-tab-to-pack"
        >
      <div className="orders-search-section">
        <div className="orders-search-wrapper">
          <input
            type="text"
            className="orders-search-input"
            placeholder="Search all items by name or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={loading}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="orders-search-clear"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {searchResults.length > 0 && (
          <div className="orders-search-results">
            {searchResults.map((item) => {
              const isEbaySold = item.sold_platform === 'eBay' && item.ebay_id;
              const isVintedSold = item.sold_platform === 'Vinted' && item.vinted_id;
              const itemName = item.item_name || '—';
              
              return (
                <div key={item.id} className="orders-search-result-item">
                  <span className="orders-result-sku">{item.id}</span>
                  <span className="orders-result-name">
                    {isEbaySold ? (
                      <a
                        href={`https://www.ebay.co.uk/itm/${item.ebay_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: 'var(--neon-primary-strong)',
                          cursor: 'pointer'
                        }}
                      >
                        {itemName}
                      </a>
                    ) : isVintedSold ? (
                      <a
                        href={`https://www.vinted.co.uk/items/${item.vinted_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: 'var(--neon-primary-strong)',
                          cursor: 'pointer'
                        }}
                      >
                        {itemName}
                      </a>
                    ) : (
                      itemName
                    )}
                  </span>
                  <span className="orders-result-price">
                    {formatCurrency(item.purchase_price)}
                  </span>
                  <button
                    type="button"
                    className="orders-add-button"
                    onClick={() => handleAddItem(item)}
                    disabled={orderItems.some((orderItem) => orderItem.id === item.id) || ordersLoading}
                  >
                    {orderItems.some((orderItem) => orderItem.id === item.id) ? 'Added' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {searchTerm && searchResults.length === 0 && !loading && (
          <div className="orders-no-results">
            No items found matching "{searchTerm}"
          </div>
        )}
      </div>

      {orderItems.length > 0 && (
        <div className="orders-list-section">
          {/* Desktop Table View */}
          <div className="table-wrapper">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Item Name</th>
                  <th>Price</th>
                  <th>Platform</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orderItems.map((item) => {
                  const isEbaySold = item.sold_platform === 'eBay' && item.ebay_id;
                  const isVintedSold = item.sold_platform === 'Vinted' && item.vinted_id;
                  const itemName = item.item_name || '—';
                  
                  return (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>
                        {isEbaySold ? (
                          <a
                            href={`https://www.ebay.co.uk/itm/${item.ebay_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: 'var(--neon-primary-strong)',
                              cursor: 'pointer'
                            }}
                          >
                            {itemName}
                          </a>
                        ) : isVintedSold ? (
                          <a
                            href={`https://www.vinted.co.uk/items/${item.vinted_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: 'var(--neon-primary-strong)',
                              cursor: 'pointer'
                            }}
                          >
                            {itemName}
                          </a>
                        ) : (
                          itemName
                        )}
                      </td>
                      <td>{formatCurrency(item.purchase_price)}</td>
                      <td>{getListingPlatform(item.vinted_id, item.ebay_id)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="orders-remove-button"
                            onClick={() => handleEditItem(item)}
                            disabled={ordersLoading}
                            style={{ marginRight: '8px' }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="orders-posted-button"
                            onClick={() => handleRemoveItem(item.id)}
                            disabled={ordersLoading}
                            title="Remove from pack list — item posted / shipped"
                          >
                            Posted
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="orders-cards-wrapper">
            {orderItems.map((item) => {
              const isEbaySold = item.sold_platform === 'eBay' && item.ebay_id;
              const isVintedSold = item.sold_platform === 'Vinted' && item.vinted_id;
              const itemName = item.item_name || '—';
              
              return (
                <div key={item.id} className="orders-card">
                  <div className="orders-card-header">
                    <span className="orders-card-sku">SKU: {item.id}</span>
                    <button
                      type="button"
                      className="orders-posted-button"
                      onClick={() => handleRemoveItem(item.id)}
                      disabled={ordersLoading}
                      title="Remove from pack list — item posted / shipped"
                    >
                      Posted
                    </button>
                  </div>
                  <div className="orders-card-body">
                    <div className="orders-card-field">
                      <span className="orders-card-label">Item Name:</span>
                      <span className="orders-card-value">
                        {isEbaySold ? (
                          <a
                            href={`https://www.ebay.co.uk/itm/${item.ebay_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="orders-card-link"
                          >
                            {itemName}
                          </a>
                        ) : isVintedSold ? (
                          <a
                            href={`https://www.vinted.co.uk/items/${item.vinted_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="orders-card-link"
                          >
                            {itemName}
                          </a>
                        ) : (
                          itemName
                        )}
                      </span>
                    </div>
                    <div className="orders-card-field">
                      <span className="orders-card-label">Price:</span>
                      <span className="orders-card-value">{formatCurrency(item.purchase_price)}</span>
                    </div>
                    <div className="orders-card-field">
                      <span className="orders-card-label">Platform:</span>
                      <span className="orders-card-value">{getListingPlatform(item.vinted_id, item.ebay_id)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button
                      type="button"
                      className="orders-remove-button"
                      onClick={() => handleEditItem(item)}
                      disabled={ordersLoading}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="orders-clear-list-section">
            <button
              type="button"
              className={`orders-clear-list-button ${clearConfirmCount > 0 ? 'confirm' : ''}`}
              onClick={handleClearList}
              disabled={ordersLoading}
            >
              {clearConfirmCount > 0 ? 'Click Again to Confirm Clear List' : 'Clear List'}
            </button>
          </div>
        </div>
      )}

      {orderItems.length === 0 && !loading && (
        <div className="orders-empty-state">
          <p>No items in your order list.</p>
          <p>Search for unsold items above to add them to your pickup list.</p>
        </div>
      )}
        </div>
      )}

      {ordersTab === 'sales' && (
        <div
          id="orders-panel-sales"
          role="tabpanel"
          aria-labelledby="orders-tab-sales"
          className="orders-sales-section"
        >
          <div className="orders-sales-ebay-toolbar">
            <div className="orders-sales-stats" aria-live="polite">
              {soldLoading ? (
                <span className="orders-sales-stats-loading">Updating sold counts…</span>
              ) : salesStats.dateRangeFilter === 'all' ? (
                <>
                  <span className="orders-sales-stat">
                    <strong>{salesStats.total}</strong>
                    <span className="orders-sales-stat-label"> total items sold</span>
                  </span>
                  <span className="orders-sales-stat">
                    <strong>{salesStats.thisMonth}</strong>
                    <span className="orders-sales-stat-label"> in {salesStats.currentMonthName}</span>
                  </span>
                  <span className="orders-sales-stat">
                    <strong>{salesStats.thisWeekMonSun}</strong>
                    <span className="orders-sales-stat-label"> this week (Mon–Sun)</span>
                  </span>
                </>
              ) : (
                <span className="orders-sales-stat">
                  <strong>{salesStats.total}</strong>
                  <span className="orders-sales-stat-label">
                    {' '}
                    in {salesStats.periodLabel ?? 'selected period'}
                  </span>
                </span>
              )}
            </div>
            <div className="orders-vinted-ebay-check-bar orders-sales-ebay-actions">
              <div className="orders-ebay-toolbar-connect">
                <a href={`${API_BASE}/api/ebay/oauth/start`} className="orders-ebay-oauth-connect">
                  Connect eBay seller
                </a>
                {ebayOAuthStatus?.connected ? (
                  <span className="orders-ebay-oauth-status orders-ebay-oauth-status--ok">
                    Linked
                    {ebayOAuthStatus.user_name ? ` as ${ebayOAuthStatus.user_name}` : ''}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="orders-vinted-ebay-check-button"
                onClick={handleVintedEbayCheck}
                disabled={vintedEbayCheckLoading}
                aria-label={
                  vintedEbayCheckLoading
                    ? 'Checking eBay listings for items sold on Vinted'
                    : 'Scan eBay listings for items already sold on Vinted that may still be live'
                }
              >
                <EbayLogoIcon className="orders-unlist-ebay-logo" />
                <span className="orders-unlist-ebay-label">
                  {vintedEbayCheckLoading ? 'Checking…' : 'Unlist eBay'}
                </span>
              </button>
              <button
                type="button"
                className="orders-vinted-ebay-check-button orders-missing-ebay-order-button"
                onClick={handleMissingEbayOrderCheck}
                disabled={missingEbayCheckLoading}
                aria-label={
                  missingEbayCheckLoading
                    ? 'Loading eBay sold orders from your account'
                    : 'Compare eBay sold orders to Stock listing IDs'
                }
              >
                <EbayLogoIcon className="orders-unlist-ebay-logo" />
                <span className="orders-unlist-ebay-label">
                  {missingEbayCheckLoading ? 'Checking…' : 'Missing eBay order'}
                </span>
              </button>
              <div className="orders-sales-filters-group">
                <div className="orders-sales-date-filter-wrap">
                  <select
                    id="orders-sales-date-filter"
                    className="orders-sales-platform-select orders-sales-date-filter-select"
                    value={salesDateRangeFilter}
                    onChange={(e) => setSalesDateRangeFilter(e.target.value as SalesDateRangeFilter)}
                    aria-label="Filter sold items by sale date (all time, current month, or last month)"
                  >
                    <option value="all">All time</option>
                    <option value="current-month">Current month</option>
                    <option value="last-month">Last month</option>
                  </select>
                </div>
                <div className="orders-sales-platform-filter-wrap">
                  <select
                    id="orders-sales-platform-filter"
                    className="orders-sales-platform-select"
                    value={salesPlatformFilter}
                    onChange={(e) => setSalesPlatformFilter(e.target.value as SalesPlatformFilter)}
                    aria-label="Filter sold items by sales channel (eBay or Vinted)"
                  >
                    <option value="all">All platforms</option>
                    <option value="ebay">eBay only</option>
                    <option value="vinted">Vinted only</option>
                  </select>
                </div>
                <div className="orders-sales-brand-filter-wrap">
                  <select
                    id="orders-sales-brand-filter"
                    className="orders-sales-platform-select orders-sales-brand-filter-select"
                    value={salesBrandFilter}
                    onChange={(e) => setSalesBrandFilter(e.target.value)}
                    disabled={salesBrandsLoading && salesBrands.length === 0}
                    aria-label="Filter sold items by brand"
                  >
                    <option value="all">All brands</option>
                    {salesBrands.map((b) => (
                      <option key={b.id} value={String(b.id)}>
                        {b.brand_name || `Brand #${b.id}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {!soldLoading && (
            <>
              {searchParams.get('ebay_oauth') === 'success' &&
                (ebayOAuthStatus === null ? (
                  <div className="orders-oauth-flash orders-oauth-flash--pending" role="status">
                    Verifying eBay link with the server…
                  </div>
                ) : ebayOAuthStatus.connected ? (
                  <div className="orders-oauth-flash orders-oauth-flash--ok" role="status">
                    eBay seller account linked. You can run Missing eBay order.
                  </div>
                ) : (
                  <div className="orders-oauth-flash orders-oauth-flash--warn" role="alert">
                    {ebayOAuthStatus?.reason === 'status_fetch_failed'
                      ? 'Cannot reach the API from this site (check Netlify: redeploy after adding public/_redirects proxy, or set REACT_APP_API_BASE to your Render URL).'
                      : ebayOAuthStatus?.reason === 'no_row'
                        ? 'The API reached the database but there is no saved eBay token (this often means an old ?ebay_oauth=success bookmark, or the callback never finished). Check Render logs for “[eBay OAuth] refresh token stored”, redeploy the latest API, remove ebay_oauth from the URL, then use Connect eBay seller again.'
                        : ebayOAuthStatus?.reason === 'query_error' && ebayOAuthStatus?.error
                          ? `Could not read token from database: ${ebayOAuthStatus.error}`
                          : 'eBay redirect succeeded but this app sees no stored token. Confirm Render database env matches Supabase, redeploy the API, clear ?ebay_oauth= from the URL, then use Connect eBay seller again.'}
                  </div>
                ))}
              {searchParams.get('ebay_oauth') === 'error' && searchParams.get('ebay_oauth_msg') && (
                <div className="orders-oauth-flash orders-oauth-flash--err" role="alert">
                  eBay connection failed: {searchParams.get('ebay_oauth_msg')}
                </div>
              )}
              {vintedEbayCheckError && (
                <div className="orders-error orders-vinted-ebay-check-error" role="alert">
                  {vintedEbayCheckError}
                </div>
              )}
              {missingEbayCheckError && (
                <div className="orders-error orders-vinted-ebay-check-error" role="alert">
                  {missingEbayCheckError}
                </div>
              )}
              {(vintedEbayViolations.length > 0 || missingEbayInStock.length > 0) && (
                <div
                  className="orders-vinted-ebay-violations-banner"
                  role="region"
                  aria-label="Items that may need your attention"
                >
                  <h3 className="orders-vinted-ebay-violations-title">Needs fixing</h3>
                  {vintedEbayViolations.length > 0 && (
                    <>
                      <h4 className="orders-needs-fixing-subtitle">eBay still looks live (sold on Vinted)</h4>
                      <p className="orders-vinted-ebay-violations-intro">
                        Sold on Vinted but eBay still reports the listing as available to buy. End or remove the
                        eBay listing.
                      </p>
                      <ul className="orders-vinted-ebay-violations-list">
                        {vintedEbayViolations.map((v) => {
                          const vintedHref = vintedListingHref(v.vinted_id);
                          return (
                            <li key={v.id} className="orders-vinted-ebay-violations-item">
                              <Link
                                to={`/stock?editId=${v.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="orders-vinted-ebay-violations-sku orders-vinted-ebay-violations-stock-link"
                                title={`Edit stock SKU ${v.id} (opens in new tab)`}
                              >
                                SKU {v.id}
                              </Link>
                              {v.item_name?.trim() ? (
                                <>
                                  {' — '}
                                  <Link
                                    to={`/stock?editId=${v.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="orders-vinted-ebay-violations-name orders-vinted-ebay-violations-stock-link"
                                    title={`Edit stock SKU ${v.id} (opens in new tab)`}
                                  >
                                    {v.item_name.trim()}
                                  </Link>
                                </>
                              ) : null}{' '}
                              <span className="orders-vinted-ebay-violations-platform-links">
                                <a
                                  href={v.ebay_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="orders-vinted-ebay-violations-ebay-link"
                                >
                                  Open on eBay
                                </a>
                                {vintedHref ? (
                                  <a
                                    href={vintedHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="orders-vinted-ebay-violations-vinted-link"
                                  >
                                    Open on Vinted
                                  </a>
                                ) : null}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                  {missingEbayInStock.length > 0 && (
                    <>
                      <h4 className="orders-needs-fixing-subtitle">
                        eBay sale — listing ID not in Stock
                      </h4>
                      <p className="orders-vinted-ebay-violations-intro">
                        These lines are in your eBay sold orders (Fulfillment API) but no{' '}
                        <strong>Stock</strong> row stores this eBay item ID. Add the item or correct the eBay ID
                        in Stock. (The To Pack <strong>orders</strong> list is separate; matching is against
                        Stock only.)
                      </p>
                      <ul className="orders-vinted-ebay-violations-list">
                        {missingEbayInStock.map((m) => (
                          <li key={m.legacy_item_id} className="orders-vinted-ebay-violations-item">
                            <span className="orders-missing-ebay-legacy-id">Item {m.legacy_item_id}</span>
                            {m.item_title?.trim() ? (
                              <span className="orders-missing-ebay-title"> — {m.item_title.trim()}</span>
                            ) : null}{' '}
                            <span className="orders-vinted-ebay-violations-platform-links">
                              <a
                                href={m.ebay_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="orders-vinted-ebay-violations-ebay-link"
                              >
                                Open on eBay
                              </a>
                            </span>
                            {m.order_ids?.length ? (
                              <span className="orders-missing-ebay-order-refs">
                                {' '}
                                (eBay order{m.order_ids.length === 1 ? '' : 's'}: {m.order_ids.join(', ')})
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
              {vintedEbayCheckApiErrors.length > 0 && (
                <p className="orders-vinted-ebay-api-errors" role="status">
                  {vintedEbayCheckApiErrors.length} listing
                  {vintedEbayCheckApiErrors.length === 1 ? '' : 's'} could not be checked (eBay API). Try
                  again later.
                </p>
              )}
            </>
          )}
          {soldLoading ? (
            <div className="orders-empty-state">
              <p>Loading sold items…</p>
            </div>
          ) : soldRows.length === 0 ? (
            <div className="orders-empty-state">
              <p>No sold items yet.</p>
              <p>Items with a sale date appear here, newest first.</p>
            </div>
          ) : soldRowsFiltered.length === 0 ? (
            <div className="orders-empty-state">
              {soldByPlatformOnly.length === 0 ? (
                <>
                  <p>No sold items match this platform filter.</p>
                  <p>Choose &quot;All platforms&quot; or another option above.</p>
                </>
              ) : soldByPlatformAndBrand.length === 0 ? (
                <>
                  <p>No sold items match this brand filter.</p>
                  <p>Choose &quot;All brands&quot; or a different brand above.</p>
                </>
              ) : (
                <>
                  <p>No sold items in this period for the selected filters.</p>
                  <p>Try &quot;All time&quot; or adjust platform, brand, or month.</p>
                </>
              )}
            </div>
          ) : (
            <div className="table-wrapper orders-sales-table">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Sold on</th>
                    <th>eBay link</th>
                    <th>Vinted link</th>
                  </tr>
                </thead>
                <tbody>
                  {soldRowsFiltered.map((row) => {
                    const ebayHref = ebayListingHref(row.ebay_id);
                    const vintedHref = vintedListingHref(row.vinted_id);
                    const ebayLabel = row.ebay_id != null ? String(row.ebay_id).trim() : '';
                    const vintedLabel = row.vinted_id != null ? String(row.vinted_id).trim() : '';
                    const rowNeedsEbayFix = vintedEbayViolationIdSet.has(row.id);
                    return (
                      <tr
                        key={row.id}
                        className={rowNeedsEbayFix ? 'orders-sales-row--ebay-fix-needed' : undefined}
                      >
                        <td>{row.id}</td>
                        <td>
                          {row.item_name?.trim() ? (
                            <Link
                              to={`/stock?editId=${row.id}`}
                              className="orders-sales-stock-name-link"
                              title={`Edit item ${row.id} in Stock`}
                            >
                              {row.item_name.trim()}
                            </Link>
                          ) : (
                            <span className="orders-table-dash">—</span>
                          )}
                        </td>
                        <td>
                          {row.sold_platform?.trim() ? (
                            row.sold_platform.trim()
                          ) : (
                            <span className="orders-table-dash">—</span>
                          )}
                        </td>
                        <td>
                          {ebayHref ? (
                            <a
                              href={ebayHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="orders-table-external-link"
                              title={ebayLabel || undefined}
                            >
                              {ebayLabel}
                            </a>
                          ) : (
                            <span className="orders-table-dash">—</span>
                          )}
                        </td>
                        <td>
                          {vintedHref ? (
                            <a
                              href={vintedHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="orders-table-external-link"
                              title={vintedLabel || undefined}
                            >
                              {vintedLabel}
                            </a>
                          ) : (
                            <span className="orders-table-dash">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Orders;

