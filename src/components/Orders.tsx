import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { pingDatabase } from '../utils/dbPing';
import { getApiBase, ebayOAuthStartUrl } from '../utils/apiBase';
import { computeStockInfoPanelMetrics } from './StockRowInfoOverlay';
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
  is_bulky_item?: Nullable<boolean>;
  is_ebay_draft?: Nullable<boolean>;
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
  is_bulky_item?: Nullable<boolean>;
}

/** Stock / sold row flag — used on Sales and To-pack tabs (explicit union avoids TS2559 weak-type checks). */
function stockIsBulky(row: StockRow | OrderItem): boolean {
  const v = row.is_bulky_item as unknown;
  return v === true || v === 't' || v === 'true' || v === 1 || v === '1';
}

type OrdersTab = 'to-pack' | 'sales' | 'sales-summary';
type SalesSummaryPeriodMode = 'week' | 'month';

const SALES_SUMMARY_WEEKS_BACK = 9;
const SALES_SUMMARY_MONTHS_BACK = 12;
const SALES_PAGE_SIZE = 40;

function parseOrdersTabParam(raw: string | null): OrdersTab {
  if (raw === 'sales' || raw === 'listing-management') return 'sales';
  if (raw === 'sales-summary') return 'sales-summary';
  return 'to-pack';
}

type SalesEbayGridMode = 'none' | 'unlist-ebay' | 'missing-ebay-order' | 'ending-this-week';

function weekMondayKey(d: Date): string {
  const { weekStart } = getMondayToSundayBounds(d);
  const y = weekStart.getFullYear();
  const m = String(weekStart.getMonth() + 1).padStart(2, '0');
  const day = String(weekStart.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatWeekRangeLabel(weekStart: Date, weekEnd: Date): string {
  const startOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const endOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const start = weekStart.toLocaleDateString('en-GB', startOpts);
  const end = weekEnd.toLocaleDateString('en-GB', endOpts);
  return `${start} – ${end}`;
}

const SALES_SUMMARY_NEAR_ZERO_MARGIN = 0.05;

function salesSummaryProfitMargin(row: StockRow, profit: number): number | null {
  if (Number.isNaN(profit)) return null;
  const purchase =
    row.purchase_price !== null && row.purchase_price !== undefined
      ? Number(row.purchase_price)
      : NaN;
  if (!Number.isNaN(purchase) && purchase > 0) return profit / purchase;
  const sale =
    row.sale_price !== null && row.sale_price !== undefined ? Number(row.sale_price) : NaN;
  if (!Number.isNaN(sale) && sale > 0) return profit / sale;
  return null;
}

function salesSummaryProfitClass(row: StockRow, profit: number): string {
  if (Number.isNaN(profit)) return '';
  const margin = salesSummaryProfitMargin(row, profit);
  if (margin !== null && Math.abs(margin) <= SALES_SUMMARY_NEAR_ZERO_MARGIN) {
    return 'orders-sales-summary-profit--neutral';
  }
  if (profit < 0) return 'orders-sales-summary-profit--negative';
  return 'orders-sales-summary-profit--positive';
}

function salesSummaryTotalProfitClass(totalProfit: number, totalPurchase: number): string {
  if (totalPurchase > 0) {
    const margin = totalProfit / totalPurchase;
    if (Math.abs(margin) <= SALES_SUMMARY_NEAR_ZERO_MARGIN) {
      return 'orders-sales-summary-profit--neutral';
    }
  }
  if (totalProfit < 0) return 'orders-sales-summary-profit--negative';
  return 'orders-sales-summary-profit--positive';
}

function buildSalesSummaryWeekOptions(ref: Date, weeksBack: number) {
  const options: Array<{ value: string; label: string; weekStart: Date; weekEnd: Date }> = [];
  for (let i = 0; i < weeksBack; i += 1) {
    const anchor = new Date(ref);
    anchor.setDate(anchor.getDate() - i * 7);
    const { weekStart, weekEnd } = getMondayToSundayBounds(anchor);
    options.push({
      value: weekMondayKey(anchor),
      label: formatWeekRangeLabel(weekStart, weekEnd),
      weekStart,
      weekEnd,
    });
  }
  return options;
}

function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatMonthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });
}

function buildSalesSummaryMonthOptions(ref: Date, monthsBack: number) {
  const options: Array<{ value: string; label: string; monthStart: Date; monthEnd: Date }> = [];
  for (let i = 0; i < monthsBack; i += 1) {
    const anchor = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
    options.push({
      value: monthKey(anchor),
      label: formatMonthLabel(anchor.getFullYear(), anchor.getMonth()),
      monthStart,
      monthEnd,
    });
  }
  return options;
}

function soldRowInDateRange(row: StockRow, rangeStart: Date, rangeEnd: Date): boolean {
  const d = parseSoldRowDate(row);
  if (!d) return false;
  return d >= rangeStart && d <= rangeEnd;
}

function SalesSummaryPlatformLink({
  listing,
  children,
  className = '',
  title,
}: {
  listing: { href: string; platform: string };
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const mod =
    listing.platform === 'eBay'
      ? ' orders-platform-link--ebay'
      : listing.platform === 'Vinted'
        ? ' orders-platform-link--vinted'
        : '';
  return (
    <a
      href={listing.href}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? `Open on ${listing.platform}`}
      className={`orders-platform-link${mod}${className ? ` ${className}` : ''}`}
    >
      {children}
    </a>
  );
}

function soldPlatformListingHref(row: StockRow): { href: string; platform: string } | null {
  const platformRaw = row.sold_platform?.trim() ?? '';
  const pl = platformRaw.toLowerCase();
  if (pl.includes('ebay') || platformRaw === 'eBay') {
    const href = ebayListingHref(row.ebay_id);
    if (href) return { href, platform: 'eBay' };
  }
  if (pl.includes('vinted') || platformRaw === 'Vinted') {
    const href = vintedListingHref(row.vinted_id);
    if (href) return { href, platform: 'Vinted' };
  }
  const ebay = ebayListingHref(row.ebay_id);
  if (ebay) return { href: ebay, platform: 'eBay' };
  const vinted = vintedListingHref(row.vinted_id);
  if (vinted) return { href: vinted, platform: 'Vinted' };
  return null;
}

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

function EbaySellerProfileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      aria-hidden
      focusable="false"
    >
      <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="9.25" r="3.1" fill="currentColor" />
      <path
        d="M6.2 18.4c.9-2.8 3.2-4.6 5.8-4.6s4.9 1.8 5.8 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

const ebayListingHref = (ebayId: Nullable<string>): string | null => {
  const s = ebayId?.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://www.ebay.co.uk/itm/${encodeURIComponent(s)}`;
};

const ebayReviseListingHref = (ebayId: Nullable<string>): string | null => {
  const s = ebayId?.trim();
  if (!s) return null;
  const legacy = s.replace(/\D/g, '');
  if (!legacy) return null;
  return `https://www.ebay.co.uk/sl/list?itemId=${encodeURIComponent(legacy)}&mode=ReviseItem`;
};

const vintedListingHref = (vintedId: Nullable<string>): string | null => {
  const s = vintedId?.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return `https://www.vinted.co.uk/items/${encodeURIComponent(s)}`;
};

function stockEbayIsDraft(row: Pick<StockRow, 'ebay_id' | 'is_ebay_draft'>): boolean {
  const flag = row.is_ebay_draft as unknown;
  if (flag === true || flag === 't' || flag === 'true' || flag === 1 || flag === '1') {
    return true;
  }
  const s = row.ebay_id?.trim() ?? '';
  if (!s) return false;
  const lower = s.toLowerCase();
  return lower === 'draft' || /draftid|\/lstng/i.test(s);
}

function salesRowListingIssues(row: StockRow): string[] {
  const issues: string[] = [];
  const platform = row.sold_platform?.trim().toLowerCase() ?? '';

  if (platform.includes('ebay')) {
    if (!ebayListingHref(row.ebay_id)) issues.push('No eBay');
    if (stockEbayIsDraft(row)) issues.push('eBay draft');
  } else if (platform.includes('vinted')) {
    if (!vintedListingHref(row.vinted_id)) issues.push('No Vinted');
  }

  return issues;
}

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

const SALES_SOLD_DATE_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const;

/** Local calendar date as `01 Jan 2026` (zero-padded day, short month, year). */
function formatSalesSoldDateDisplay(row: StockRow): string | null {
  const d = parseSoldRowDate(row);
  if (!d) return null;
  const day = String(d.getDate()).padStart(2, '0');
  const mon = SALES_SOLD_DATE_MONTHS[d.getMonth()];
  return `${day} ${mon} ${d.getFullYear()}`;
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

interface VintedEbaySingleCheckResponse {
  needs_unlist: boolean;
  reason?: string;
  id?: number;
  item_name?: Nullable<string>;
  ebay_id?: string;
  ebay_url?: string;
  vinted_id?: Nullable<string>;
  error?: string;
  details?: string;
}

interface ToPackEbayUnlistModalState {
  item: OrderItem;
  violation: VintedEbayViolation;
  unlistLoading: boolean;
  unlistError: string | null;
}

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
  stock_id?: number | null;
}

function normalizeListingTitleForMatch(raw: Nullable<string>): string {
  return (raw?.trim().toLowerCase() ?? '').replace(/\s+/g, ' ');
}

function stockEditIdForMissingEbaySale(
  missing: MissingEbayStockRow,
  soldRows: StockRow[]
): number | null {
  if (missing.stock_id != null && Number.isFinite(Number(missing.stock_id))) {
    return Number(missing.stock_id);
  }
  const missingTitle = normalizeListingTitleForMatch(missing.item_title);
  for (const row of soldRows) {
    const platform = row.sold_platform?.trim().toLowerCase() ?? '';
    if (!platform.includes('ebay')) continue;
    if (missingTitle && normalizeListingTitleForMatch(row.item_name) === missingTitle) {
      const rowLegacy = row.ebay_id?.replace(/\D/g, '') ?? '';
      if (!rowLegacy || rowLegacy !== missing.legacy_item_id) return row.id;
    }
  }
  return null;
}

interface MissingEbayStockMatchResponse {
  window_days: number;
  ebay_line_items_seen: number;
  ebay_distinct_listings: number;
  stock_ebay_ids_count: number;
  missing: MissingEbayStockRow[];
}

interface EbayEndingThisWeekRow {
  id: number | null;
  item_name: Nullable<string>;
  ebay_id: string;
  ebay_url: string;
  item_end_date: string;
  purchase_date?: Nullable<string>;
  still_buyable?: boolean;
  in_stock?: boolean;
}

interface EbayEndingThisWeekResponse {
  week_start: string;
  week_end: string;
  total: number;
  offset: number;
  limit: number;
  processed: number;
  done: boolean;
  matches: EbayEndingThisWeekRow[];
  apiErrors: Array<{ stock_id: number; message: string; httpStatus: number | null }>;
}

function endingThisWeekRowKey(row: Pick<EbayEndingThisWeekRow, 'id' | 'ebay_id'>): string {
  return row.id != null ? `stock-${row.id}` : `ebay-${row.ebay_id}`;
}

interface EbayRelistPending {
  newLegacyItemId: string;
  ebayUrl: string;
  reviseUrl: string;
  endedLegacyItemId: string;
}

interface EbayListingPreview {
  ebay_id: string | null;
  title: string | null;
  imageUrl: string | null;
  priceLabel: string | null;
  condition: string | null;
  itemEndDate: string | null;
  itemWebUrl: string | null;
  buyingOptions: string[];
  aspects: Array<{ name: string; value: string }>;
}

interface EndingThisWeekRelistModalState {
  row: EbayEndingThisWeekRow;
  rowKey: string;
  pending: EbayRelistPending;
  preview: EbayListingPreview | null;
  previewLoading: boolean;
  previewError: string | null;
}

function formatEbayEndDateDisplay(iso: Nullable<string>): string | null {
  if (iso == null || String(iso).trim() === '') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatEbayEndDateShort(iso: Nullable<string>): string | null {
  if (iso == null || String(iso).trim() === '') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  });
}

function formatTimeInStock(purchaseDate: Nullable<string>): string | null {
  if (purchaseDate == null || String(purchaseDate).trim() === '') return null;
  const match = String(purchaseDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const start = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(start.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  if (start > today) return null;

  let months =
    (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
  let days = today.getDate() - start.getDate();
  if (days < 0) {
    months -= 1;
    days += new Date(today.getFullYear(), today.getMonth(), 0).getDate();
  }

  const parts: string[] = [];
  if (months > 0) {
    parts.push(`${months} month${months === 1 ? '' : 's'}`);
  }
  if (days > 0 || months === 0) {
    parts.push(`${days} day${days === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}

function formatPurchaseDateLabel(purchaseDate: Nullable<string>): string | null {
  if (purchaseDate == null || String(purchaseDate).trim() === '') return null;
  const match = String(purchaseDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatEbayTimeRemaining(iso: Nullable<string>, listingEnded = false): string | null {
  if (listingEnded) return 'Ended';
  if (iso == null || String(iso).trim() === '') return null;
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - Date.now();
  if (ms <= 0) return 'Ended';
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function ebayTimeRemainingIsUrgent(iso: Nullable<string>): boolean {
  if (iso == null || String(iso).trim() === '') return false;
  const end = new Date(iso);
  if (Number.isNaN(end.getTime())) return false;
  const ms = end.getTime() - Date.now();
  return ms > 0 && ms <= 24 * 60 * 60 * 1000;
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
    is_bulky_item?: Nullable<boolean>;
  }>;
  count: number;
}

const Orders: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const ordersTab: OrdersTab = parseOrdersTabParam(searchParams.get('tab'));

  const setOrdersTab = (tab: OrdersTab) => {
    const urlTab = tab === 'sales' ? 'listing-management' : tab;
    try {
      sessionStorage.setItem('ordersTab', urlTab);
    } catch {
      /* ignore */
    }
    setSearchParams({ tab: urlTab }, { replace: true });
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
  const [salesMissingOnlineIdFilter, setSalesMissingOnlineIdFilter] = useState(false);
  const [salesBrands, setSalesBrands] = useState<Array<{ id: number; brand_name: string }>>([]);
  const [salesBrandsLoading, setSalesBrandsLoading] = useState(false);
  const [salesDateRangeFilter, setSalesDateRangeFilter] = useState<SalesDateRangeFilter>('all');
  const [salesPage, setSalesPage] = useState(1);
  const [salesSummaryWeekKey, setSalesSummaryWeekKey] = useState(() => weekMondayKey(new Date()));
  const [salesSummaryMonthKey, setSalesSummaryMonthKey] = useState(() => monthKey(new Date()));
  const [salesSummaryPeriodMode, setSalesSummaryPeriodMode] =
    useState<SalesSummaryPeriodMode>('week');
  const [vintedEbayCheckLoading, setVintedEbayCheckLoading] = useState(false);
  const [vintedEbayViolations, setVintedEbayViolations] = useState<VintedEbayViolation[]>([]);
  const [vintedEbayCheckError, setVintedEbayCheckError] = useState<string | null>(null);
  const [vintedEbayCheckApiErrors, setVintedEbayCheckApiErrors] = useState<
    VintedEbayCheckResponse['apiErrors']
  >([]);
  const [ebayUnlistLoadingId, setEbayUnlistLoadingId] = useState<number | null>(null);
  const [ebayUnlistErrorById, setEbayUnlistErrorById] = useState<Record<number, string>>({});
  const [ebayUnlistedStockIds, setEbayUnlistedStockIds] = useState<number[]>([]);
  const [missingEbayCheckLoading, setMissingEbayCheckLoading] = useState(false);
  const [missingEbayInStock, setMissingEbayInStock] = useState<MissingEbayStockRow[]>([]);
  const [missingEbayCheckError, setMissingEbayCheckError] = useState<string | null>(null);
  const [endingThisWeekLoading, setEndingThisWeekLoading] = useState(false);
  const [endingThisWeekRows, setEndingThisWeekRows] = useState<EbayEndingThisWeekRow[]>([]);
  const [endingThisWeekError, setEndingThisWeekError] = useState<string | null>(null);
  const [endingThisWeekApiErrors, setEndingThisWeekApiErrors] = useState<
    EbayEndingThisWeekResponse['apiErrors']
  >([]);
  const [endingThisWeekWeekLabel, setEndingThisWeekWeekLabel] = useState<string | null>(null);
  const [endingThisWeekProgress, setEndingThisWeekProgress] = useState<{
    checked: number;
    total: number;
    matchesFound: number;
  } | null>(null);
  const [endingThisWeekEndedRowKeys, setEndingThisWeekEndedRowKeys] = useState<string[]>([]);
  const [ebayRefreshEndLoadingId, setEbayRefreshEndLoadingId] = useState<string | null>(null);
  const [ebayRefreshEndErrorById, setEbayRefreshEndErrorById] = useState<Record<string, string>>({});
  const [ebayRelistPendingByStockId, setEbayRelistPendingByStockId] = useState<
    Record<string, EbayRelistPending>
  >({});
  const [ebayRelistLoadingId, setEbayRelistLoadingId] = useState<string | null>(null);
  const [ebayRelistErrorById, setEbayRelistErrorById] = useState<Record<string, string>>({});
  const [endingThisWeekRelistConfirmedRowKeys, setEndingThisWeekRelistConfirmedRowKeys] = useState<
    string[]
  >([]);
  const [ebayRelistConfirmLoadingId, setEbayRelistConfirmLoadingId] = useState<string | null>(null);
  const [toPackEbayUnlistModal, setToPackEbayUnlistModal] = useState<ToPackEbayUnlistModalState | null>(
    null
  );
  const [endingThisWeekRelistModal, setEndingThisWeekRelistModal] =
    useState<EndingThisWeekRelistModalState | null>(null);
  const [salesEbayGridMode, setSalesEbayGridMode] = useState<SalesEbayGridMode>('none');
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
      const transformed = (data.rows ?? [])
        .map((row) => ({
          id: row.id,
          item_name: row.item_name,
          purchase_price: row.purchase_price,
          vinted_id: row.vinted_id,
          ebay_id: row.ebay_id,
          depop_id: row.depop_id,
          sold_platform: row.sold_platform,
          brand_id: (row as any).brand_id ?? null,
          category_id: (row as any).category_id ?? null,
          is_bulky_item: row.is_bulky_item ?? null,
        }))
        .sort((a, b) => Number(b.id) - Number(a.id));
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
    if (
      q === 'sales' ||
      q === 'listing-management' ||
      q === 'to-pack' ||
      q === 'sales-summary'
    ) {
      try {
        sessionStorage.setItem(
          'ordersTab',
          q === 'sales' ? 'listing-management' : q
        );
      } catch {
        /* ignore */
      }
      return;
    }
    let initial: OrdersTab = 'to-pack';
    try {
      const saved = sessionStorage.getItem('ordersTab');
      if (saved === 'sales' || saved === 'listing-management') initial = 'sales';
      else if (saved === 'sales-summary') initial = saved;
    } catch {
      /* ignore */
    }
    setSearchParams({ tab: initial }, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (ordersTab !== 'sales' && ordersTab !== 'sales-summary') {
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
    if (searchParams.get('ebay_oauth') !== 'success') return;
    if (ebayOAuthStatus?.connected) return;
    if (ebayOAuthStatus?.reason && ebayOAuthStatus.reason !== 'no_row') return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts > 6) {
        window.clearInterval(timer);
        return;
      }
      void refreshEbayOAuthStatus();
    }, 1500);

    return () => window.clearInterval(timer);
  }, [ordersTab, searchParams, ebayOAuthStatus?.connected, ebayOAuthStatus?.reason, refreshEbayOAuthStatus]);

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
      setSalesEbayGridMode('none');
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

  const soldRowsForPeriod = useMemo(
    () => soldByPlatformAndBrand.filter((r) => soldRowMatchesDateRange(r, salesDateRangeFilter)),
    [soldByPlatformAndBrand, salesDateRangeFilter]
  );

  const soldRowsFiltered = useMemo(() => {
    if (!salesMissingOnlineIdFilter) return soldRowsForPeriod;
    return soldRowsForPeriod.filter((row) => salesRowListingIssues(row).length > 0);
  }, [soldRowsForPeriod, salesMissingOnlineIdFilter]);

  const vintedEbayViolationIdSet = useMemo(
    () => new Set(vintedEbayViolations.map((v) => v.id)),
    [vintedEbayViolations]
  );

  const ebayUnlistedIdSet = useMemo(() => new Set(ebayUnlistedStockIds), [ebayUnlistedStockIds]);

  const soldRowsUnlistGrid = useMemo(
    () => soldRows.filter((row) => vintedEbayViolationIdSet.has(row.id)),
    [soldRows, vintedEbayViolationIdSet]
  );

  const salesGridStockRows = useMemo(() => {
    if (salesEbayGridMode === 'unlist-ebay') return soldRowsUnlistGrid;
    return soldRowsFiltered;
  }, [salesEbayGridMode, soldRowsUnlistGrid, soldRowsFiltered]);

  const salesGridRowCount =
    salesEbayGridMode === 'missing-ebay-order'
      ? missingEbayInStock.length
      : salesEbayGridMode === 'ending-this-week'
        ? endingThisWeekRows.length
        : salesGridStockRows.length;

  const salesPageCount = useMemo(
    () => Math.max(1, Math.ceil(salesGridRowCount / SALES_PAGE_SIZE)),
    [salesGridRowCount]
  );

  const soldRowsPaged = useMemo(() => {
    const safePage = Math.min(Math.max(salesPage, 1), salesPageCount);
    const start = (safePage - 1) * SALES_PAGE_SIZE;
    return salesGridStockRows.slice(start, start + SALES_PAGE_SIZE);
  }, [salesGridStockRows, salesPage, salesPageCount]);

  const missingEbayPaged = useMemo(() => {
    const safePage = Math.min(Math.max(salesPage, 1), salesPageCount);
    const start = (safePage - 1) * SALES_PAGE_SIZE;
    return missingEbayInStock.slice(start, start + SALES_PAGE_SIZE);
  }, [missingEbayInStock, salesPage, salesPageCount]);

  const endingThisWeekPaged = useMemo(() => {
    const safePage = Math.min(Math.max(salesPage, 1), salesPageCount);
    const start = (safePage - 1) * SALES_PAGE_SIZE;
    return endingThisWeekRows.slice(start, start + SALES_PAGE_SIZE);
  }, [endingThisWeekRows, salesPage, salesPageCount]);

  const ebayRefreshEndedIdSet = useMemo(
    () => new Set(endingThisWeekEndedRowKeys),
    [endingThisWeekEndedRowKeys]
  );
  const ebayRelistConfirmedIdSet = useMemo(
    () => new Set(endingThisWeekRelistConfirmedRowKeys),
    [endingThisWeekRelistConfirmedRowKeys]
  );

  useEffect(() => {
    setSalesPage(1);
  }, [
    salesPlatformFilter,
    salesBrandFilter,
    salesDateRangeFilter,
    salesMissingOnlineIdFilter,
    salesEbayGridMode,
    vintedEbayViolations.length,
    missingEbayInStock.length,
    endingThisWeekRows.length
  ]);

  useEffect(() => {
    if (salesPage > salesPageCount) {
      setSalesPage(salesPageCount);
    }
  }, [salesPage, salesPageCount]);

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

  const salesSummaryWeekOptions = useMemo(
    () => buildSalesSummaryWeekOptions(new Date(), SALES_SUMMARY_WEEKS_BACK),
    []
  );

  const salesSummaryMonthOptions = useMemo(
    () => buildSalesSummaryMonthOptions(new Date(), SALES_SUMMARY_MONTHS_BACK),
    []
  );

  const salesSummarySelectedWeek = useMemo(() => {
    const found = salesSummaryWeekOptions.find((w) => w.value === salesSummaryWeekKey);
    if (found) return found;
    return salesSummaryWeekOptions[0] ?? null;
  }, [salesSummaryWeekOptions, salesSummaryWeekKey]);

  const salesSummarySelectedMonth = useMemo(() => {
    const found = salesSummaryMonthOptions.find((m) => m.value === salesSummaryMonthKey);
    if (found) return found;
    return salesSummaryMonthOptions[0] ?? null;
  }, [salesSummaryMonthOptions, salesSummaryMonthKey]);

  const salesSummaryPeriod = useMemo(() => {
    if (salesSummaryPeriodMode === 'week') {
      if (!salesSummarySelectedWeek) return null;
      return {
        mode: 'week' as const,
        label: salesSummarySelectedWeek.label,
        rangeStart: salesSummarySelectedWeek.weekStart,
        rangeEnd: salesSummarySelectedWeek.weekEnd,
      };
    }
    if (!salesSummarySelectedMonth) return null;
    return {
      mode: 'month' as const,
      label: salesSummarySelectedMonth.label,
      rangeStart: salesSummarySelectedMonth.monthStart,
      rangeEnd: salesSummarySelectedMonth.monthEnd,
    };
  }, [salesSummaryPeriodMode, salesSummarySelectedWeek, salesSummarySelectedMonth]);

  const salesSummaryRows = useMemo(() => {
    if (!salesSummaryPeriod) return [];
    const { rangeStart, rangeEnd } = salesSummaryPeriod;
    return soldRows
      .filter((r) => soldRowInDateRange(r, rangeStart, rangeEnd))
      .sort((a, b) => {
        const da = parseSoldRowDate(a)?.getTime() ?? 0;
        const db = parseSoldRowDate(b)?.getTime() ?? 0;
        return db - da;
      });
  }, [soldRows, salesSummaryPeriod]);

  const salesSummaryTotals = useMemo(() => {
    let totalSales = 0;
    let totalProfit = 0;
    let totalPurchase = 0;
    let hasSales = false;
    let hasProfit = false;
    for (const row of salesSummaryRows) {
      const { sale, profit } = computeStockInfoPanelMetrics(row);
      if (!Number.isNaN(sale)) {
        totalSales += sale;
        hasSales = true;
      }
      if (!Number.isNaN(profit)) {
        totalProfit += profit;
        hasProfit = true;
      }
      const purchase =
        row.purchase_price !== null && row.purchase_price !== undefined
          ? Number(row.purchase_price)
          : NaN;
      if (!Number.isNaN(purchase)) {
        totalPurchase += purchase;
      }
    }
    return {
      totalSales,
      totalProfit,
      totalPurchase,
      saleCount: salesSummaryRows.length,
      hasSales,
      hasProfit,
      hasPurchase: totalPurchase > 0 || salesSummaryRows.some(
        (row) =>
          row.purchase_price !== null &&
          row.purchase_price !== undefined &&
          !Number.isNaN(Number(row.purchase_price))
      ),
    };
  }, [salesSummaryRows]);

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

      await loadOrders();
    } catch (err: any) {
      console.error('Remove from orders error:', err);
      setError(err.message || 'Unable to remove item from orders');
    } finally {
      setOrdersLoading(false);
    }
  };

  const closeToPackEbayUnlistModal = useCallback(() => {
    setToPackEbayUnlistModal(null);
  }, []);

  const handlePostedClick = async (item: OrderItem) => {
    const soldPlatform = String(item.sold_platform ?? '').trim().toLowerCase();
    const isVintedSold =
      soldPlatform === 'vinted' || (item.vinted_id != null && String(item.vinted_id).trim() !== '');
    const hasEbayId = item.ebay_id != null && String(item.ebay_id).trim() !== '';

    if (isVintedSold && hasEbayId) {
      setOrdersLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_BASE}/api/stock/${item.id}/vinted-ebay-active-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        const text = await response.text();
        let data: VintedEbaySingleCheckResponse | null = null;
        try {
          data = text ? (JSON.parse(text) as VintedEbaySingleCheckResponse) : null;
        } catch {
          /* not JSON */
        }
        if (response.ok && data?.needs_unlist && data.ebay_id && data.ebay_url) {
          setToPackEbayUnlistModal({
            item,
            violation: {
              id: data.id ?? item.id,
              item_name: data.item_name ?? item.item_name,
              ebay_id: data.ebay_id,
              ebay_url: data.ebay_url,
              vinted_id: data.vinted_id ?? item.vinted_id ?? null
            },
            unlistLoading: false,
            unlistError: null
          });
          return;
        }
      } catch (err: unknown) {
        console.warn('Posted eBay duplicate check failed:', err);
      } finally {
        setOrdersLoading(false);
      }
    }

    await handleRemoveItem(item.id);
  };

  const handleRemoveItemRef = useRef(handleRemoveItem);
  handleRemoveItemRef.current = handleRemoveItem;

  const finishPostedAfterUnlistModal = useCallback(async (itemId: number) => {
    closeToPackEbayUnlistModal();
    await handleRemoveItemRef.current(itemId);
  }, [closeToPackEbayUnlistModal]);

  const handleToPackEbayUnlist = async () => {
    if (
      !toPackEbayUnlistModal ||
      ebayOAuthStatus?.connected !== true ||
      toPackEbayUnlistModal.unlistLoading
    ) {
      return;
    }
    const { item, violation } = toPackEbayUnlistModal;
    setToPackEbayUnlistModal((prev) =>
      prev ? { ...prev, unlistLoading: true, unlistError: null } : prev
    );
    try {
      const response = await fetch(`${API_BASE}/api/stock/${violation.id}/ebay-unlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const text = await response.text();
      let data: { error?: string; details?: string } | null = null;
      try {
        data = text ? (JSON.parse(text) as { error?: string; details?: string }) : null;
      } catch {
        /* not JSON */
      }
      if (!response.ok) {
        throw new Error(data?.details || data?.error || text || `Unlist failed (${response.status})`);
      }
      await finishPostedAfterUnlistModal(item.id);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message === 'Failed to fetch' || err.name === 'TypeError'
            ? 'Unable to connect to server. Is the API running?'
            : err.message
          : 'Unlist failed';
      setToPackEbayUnlistModal((prev) =>
        prev ? { ...prev, unlistLoading: false, unlistError: message } : prev
      );
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
    if (!ebaySellerConnected) return;
    if (salesEbayGridMode === 'unlist-ebay') {
      setSalesEbayGridMode('none');
      return;
    }
    setSalesEbayGridMode('unlist-ebay');
    setSalesPlatformFilter('ebay');
    setVintedEbayCheckLoading(true);
    setVintedEbayCheckError(null);
    setEbayUnlistedStockIds([]);
    setEbayUnlistErrorById({});
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
      setSalesEbayGridMode('none');
      setVintedEbayCheckError(
        err.message === 'Failed to fetch' || err.name === 'TypeError'
          ? 'Unable to connect to server. Is the API running?'
          : err.message || 'Check failed'
      );
    } finally {
      setVintedEbayCheckLoading(false);
    }
  };

  const handleEbayUnlist = async (row: StockRow) => {
    if (!ebaySellerConnected || ebayUnlistLoadingId != null) return;
    setEbayUnlistLoadingId(row.id);
    setEbayUnlistErrorById((prev) => {
      if (!prev[row.id]) return prev;
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    try {
      const response = await fetch(`${API_BASE}/api/stock/${row.id}/ebay-unlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const text = await response.text();
      let data: { error?: string; details?: string; code?: string } | null = null;
      try {
        data = text ? (JSON.parse(text) as { error?: string; details?: string; code?: string }) : null;
      } catch {
        /* not JSON */
      }
      if (!response.ok) {
        const msg =
          data?.details ||
          data?.error ||
          text ||
          `Unlist failed (${response.status})`;
        throw new Error(msg);
      }
      setEbayUnlistedStockIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message === 'Failed to fetch' || err.name === 'TypeError'
            ? 'Unable to connect to server. Is the API running?'
            : err.message
          : 'Unlist failed';
      setEbayUnlistErrorById((prev) => ({ ...prev, [row.id]: message }));
    } finally {
      setEbayUnlistLoadingId(null);
    }
  };

  const handleMissingEbayOrderCheck = async () => {
    if (!ebaySellerConnected) return;
    if (salesEbayGridMode === 'missing-ebay-order') {
      setSalesEbayGridMode('none');
      return;
    }
    setSalesEbayGridMode('missing-ebay-order');
    setSalesPlatformFilter('ebay');
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
      setSalesEbayGridMode('none');
      setMissingEbayCheckError(
        err.message === 'Failed to fetch' || err.name === 'TypeError'
          ? 'Unable to connect to server. Is the API running?'
          : err.message || 'Check failed'
      );
    } finally {
      setMissingEbayCheckLoading(false);
    }
  };

  const handleEndingThisWeekCheck = async () => {
    if (!ebaySellerConnected) return;
    if (salesEbayGridMode === 'ending-this-week') {
      setSalesEbayGridMode('none');
      return;
    }
    setSalesEbayGridMode('ending-this-week');
    setSalesPlatformFilter('ebay');
    setEndingThisWeekLoading(true);
    setEndingThisWeekError(null);
    setEndingThisWeekProgress({ checked: 0, total: 0, matchesFound: 0 });
    setEndingThisWeekEndedRowKeys([]);
    setEbayRefreshEndErrorById({});
    setEbayRelistPendingByStockId({});
    setEbayRelistErrorById({});
    setEndingThisWeekRelistConfirmedRowKeys([]);
    setEndingThisWeekRelistModal(null);
    setEndingThisWeekRows([]);
    setEndingThisWeekApiErrors([]);
    const batchSize = 100;
    let offset = 0;
    try {
      for (;;) {
        const response = await fetch(`${API_BASE}/api/stock/ebay-ending-this-week`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset, limit: batchSize })
        });
        const text = await response.text();
        let data: EbayEndingThisWeekResponse | null = null;
        try {
          data = text ? (JSON.parse(text) as EbayEndingThisWeekResponse) : null;
        } catch {
          /* not JSON */
        }
        if (!response.ok) {
          const msg =
            (data as { error?: string; details?: string } | null)?.details ||
            (data as { error?: string; details?: string } | null)?.error ||
            text ||
            'Check failed';
          throw new Error(msg);
        }
        if (!data) {
          throw new Error('Unexpected empty response');
        }
        const batchMatches = data.matches;
        const batchApiErrors = data.apiErrors;
        if (Array.isArray(batchMatches) && batchMatches.length > 0) {
          setEndingThisWeekRows((prev) => [...prev, ...batchMatches]);
        }
        if (Array.isArray(batchApiErrors) && batchApiErrors.length > 0) {
          setEndingThisWeekApiErrors((prev) => [...prev, ...batchApiErrors]);
        }
        const total = Number(data.total) || 0;
        const processed = Number(data.processed) || offset;
        setEndingThisWeekProgress((prev) => ({
          checked: processed,
          total,
          matchesFound: (prev?.matchesFound ?? 0) + (batchMatches?.length ?? 0)
        }));
        if (data.week_start && data.week_end) {
          const ws = new Date(data.week_start);
          const we = new Date(data.week_end);
          if (!Number.isNaN(ws.getTime()) && !Number.isNaN(we.getTime())) {
            setEndingThisWeekWeekLabel(formatWeekRangeLabel(ws, we));
          }
        }
        if (data.done || processed >= total || total === 0) {
          break;
        }
        offset = processed;
      }
    } catch (err: unknown) {
      console.error('Ending this week check:', err);
      setEndingThisWeekError(
        err instanceof Error
          ? err.message === 'Failed to fetch' || err.name === 'TypeError'
            ? 'Unable to connect to server. Is the API running?'
            : err.message || 'Check failed'
          : 'Check failed'
      );
    } finally {
      setEndingThisWeekLoading(false);
      setEndingThisWeekProgress(null);
    }
  };

  const handleEbayRefreshEnd = async (row: EbayEndingThisWeekRow) => {
    if (!ebaySellerConnected || ebayRefreshEndLoadingId != null || row.id == null) return;
    const rowKey = endingThisWeekRowKey(row);
    setEbayRefreshEndLoadingId(rowKey);
    setEbayRefreshEndErrorById((prev) => {
      if (!prev[rowKey]) return prev;
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    try {
      const response = await fetch(`${API_BASE}/api/stock/${row.id}/ebay-unlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const text = await response.text();
      let data: { error?: string; details?: string } | null = null;
      try {
        data = text ? (JSON.parse(text) as { error?: string; details?: string }) : null;
      } catch {
        /* not JSON */
      }
      if (!response.ok) {
        throw new Error(data?.details || data?.error || text || `End failed (${response.status})`);
      }
      setEndingThisWeekEndedRowKeys((prev) => (prev.includes(rowKey) ? prev : [...prev, rowKey]));
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message === 'Failed to fetch' || err.name === 'TypeError'
            ? 'Unable to connect to server. Is the API running?'
            : err.message
          : 'End failed';
      setEbayRefreshEndErrorById((prev) => ({ ...prev, [rowKey]: message }));
    } finally {
      setEbayRefreshEndLoadingId(null);
    }
  };

  const handleEbayRelist = async (row: EbayEndingThisWeekRow) => {
    if (!ebaySellerConnected || ebayRelistLoadingId != null || row.id == null) return;
    const rowKey = endingThisWeekRowKey(row);
    setEbayRelistLoadingId(rowKey);
    setEbayRelistErrorById((prev) => {
      if (!prev[rowKey]) return prev;
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    try {
      const response = await fetch(`${API_BASE}/api/stock/${row.id}/ebay-relist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ended_legacy_item_id: row.ebay_id })
      });
      const text = await response.text();
      let data: {
        error?: string;
        details?: string;
        new_legacy_item_id?: string;
        ebay_url?: string;
        revise_url?: string;
        ended_legacy_item_id?: string;
      } | null = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        /* not JSON */
      }
      if (!response.ok) {
        throw new Error(data?.details || data?.error || text || `Relist failed (${response.status})`);
      }
      const newId = data?.new_legacy_item_id;
      if (!newId) {
        throw new Error('Relist succeeded but no new eBay item id returned');
      }
      const pending: EbayRelistPending = {
        newLegacyItemId: newId,
        ebayUrl: data?.ebay_url || `https://www.ebay.co.uk/itm/${newId}`,
        reviseUrl:
          data?.revise_url ||
          `https://www.ebay.co.uk/sl/list?itemId=${encodeURIComponent(newId)}&mode=ReviseItem`,
        endedLegacyItemId: data?.ended_legacy_item_id || row.ebay_id
      };
      setEbayRelistPendingByStockId((prev) => ({
        ...prev,
        [rowKey]: pending
      }));
      void openEndingThisWeekRelistModal(row, pending);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message === 'Failed to fetch' || err.name === 'TypeError'
            ? 'Unable to connect to server. Is the API running?'
            : err.message
          : 'Relist failed';
      setEbayRelistErrorById((prev) => ({ ...prev, [rowKey]: message }));
    } finally {
      setEbayRelistLoadingId(null);
    }
  };

  const handleEbayRelistConfirm = async (row: EbayEndingThisWeekRow) => {
    if (row.id == null) return;
    const rowKey = endingThisWeekRowKey(row);
    const pending = ebayRelistPendingByStockId[rowKey];
    if (!pending || ebayRelistConfirmLoadingId != null) return;
    setEbayRelistConfirmLoadingId(rowKey);
    try {
      const response = await fetch(`${API_BASE}/api/stock/${row.id}/ebay-relist/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_ebay_id: pending.newLegacyItemId })
      });
      const text = await response.text();
      let data: { error?: string; details?: string } | null = null;
      try {
        data = text ? (JSON.parse(text) as { error?: string; details?: string }) : null;
      } catch {
        /* not JSON */
      }
      if (!response.ok) {
        throw new Error(
          data?.details || data?.error || text || `Update failed (${response.status})`
        );
      }
      setEndingThisWeekRelistConfirmedRowKeys((prev) =>
        prev.includes(rowKey) ? prev : [...prev, rowKey]
      );
      setEbayRelistPendingByStockId((prev) => {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
      setEndingThisWeekRows((prev) =>
        prev.map((r) =>
          endingThisWeekRowKey(r) === rowKey ? { ...r, ebay_id: pending.newLegacyItemId } : r
        )
      );
      setEndingThisWeekRelistModal(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message === 'Failed to fetch' || err.name === 'TypeError'
            ? 'Unable to connect to server. Is the API running?'
            : err.message
          : 'Update failed';
      setEbayRelistErrorById((prev) => ({ ...prev, [rowKey]: message }));
    } finally {
      setEbayRelistConfirmLoadingId(null);
    }
  };

  const ebaySellerConnected = ebayOAuthStatus?.connected === true;

  const closeEndingThisWeekRelistModal = useCallback(() => {
    setEndingThisWeekRelistModal(null);
  }, []);

  const openEndingThisWeekRelistModal = useCallback(
    async (row: EbayEndingThisWeekRow, pending: EbayRelistPending) => {
      const rowKey = endingThisWeekRowKey(row);
      setEndingThisWeekRelistModal({
        row,
        rowKey,
        pending,
        preview: null,
        previewLoading: true,
        previewError: null
      });
      try {
        const response = await fetch(
          `${API_BASE}/api/ebay/listing-preview?ebay_id=${encodeURIComponent(pending.newLegacyItemId)}`
        );
        const text = await response.text();
        let data: {
          error?: string;
          details?: string;
          preview?: EbayListingPreview;
          found?: boolean;
        } | null = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          /* not JSON */
        }
        if (!response.ok) {
          throw new Error(data?.details || data?.error || text || 'Preview failed');
        }
        setEndingThisWeekRelistModal((prev) => {
          if (!prev || prev.rowKey !== rowKey) return prev;
          return {
            ...prev,
            preview: data?.preview ?? null,
            previewLoading: false,
            previewError:
              data?.found === false
                ? 'Listing created — preview not indexed yet. Use Review to open on eBay.'
                : null
          };
        });
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message === 'Failed to fetch' || err.name === 'TypeError'
              ? 'Unable to connect to server. Is the API running?'
              : err.message
            : 'Preview failed';
        setEndingThisWeekRelistModal((prev) => {
          if (!prev || prev.rowKey !== rowKey) return prev;
          return { ...prev, previewLoading: false, previewError: message };
        });
      }
    },
    []
  );

  useEffect(() => {
    if (!toPackEbayUnlistModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !toPackEbayUnlistModal.unlistLoading) {
        void finishPostedAfterUnlistModal(toPackEbayUnlistModal.item.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toPackEbayUnlistModal, finishPostedAfterUnlistModal]);

  useEffect(() => {
    if (!endingThisWeekRelistModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeEndingThisWeekRelistModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [endingThisWeekRelistModal, closeEndingThisWeekRelistModal]);

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
          id="orders-tab-sales-summary"
          aria-selected={ordersTab === 'sales-summary'}
          aria-controls="orders-panel-sales-summary"
          className={`orders-tab${ordersTab === 'sales-summary' ? ' orders-tab--active' : ''}`}
          onClick={() => setOrdersTab('sales-summary')}
        >
          Sales Summary
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
          Listing Management
        </button>
      </div>

      {ordersTab === 'to-pack' && error && <div className="orders-error">{error}</div>}
      {ordersTab === 'sales' && soldError && <div className="orders-error">{soldError}</div>}
      {ordersTab === 'sales-summary' && soldError && (
        <div className="orders-error">{soldError}</div>
      )}

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
              const searchBulky = stockIsBulky(item);

              return (
                <div
                  key={item.id}
                  className={`orders-search-result-item${searchBulky ? ' orders-search-result-item--bulky' : ''}`}
                >
                  <span className="orders-result-sku orders-result-sku-with-bulk">
                    <span className="orders-result-sku-num">{item.id}</span>
                    {searchBulky ? <span className="orders-sales-bulk-badge">BULK</span> : null}
                  </span>
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
                  const packBulky = stockIsBulky(item);
                  const packRowClass = packBulky ? 'orders-row--bulky' : undefined;

                  return (
                    <tr key={item.id} className={packRowClass}>
                      <td>
                        <div className="orders-sales-id-cell">
                          <span className="orders-sales-id-num">{item.id}</span>
                          {packBulky ? <span className="orders-sales-bulk-badge">BULK</span> : null}
                        </div>
                      </td>
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
                            onClick={() => void handlePostedClick(item)}
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
              const packBulky = stockIsBulky(item);

              return (
                <div key={item.id} className={`orders-card${packBulky ? ' orders-card--bulky' : ''}`}>
                  <div className="orders-card-header">
                    <span className="orders-card-sku orders-card-sku-with-bulk">
                      <span className="orders-card-sku-label">SKU:</span>{' '}
                      <span className="orders-card-sku-num">{item.id}</span>
                      {packBulky ? <span className="orders-sales-bulk-badge">BULK</span> : null}
                    </span>
                    <button
                      type="button"
                      className="orders-posted-button"
                      onClick={() => void handlePostedClick(item)}
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
            <div className="orders-sales-toolbar-stats-row">
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
              <div className="orders-ebay-seller-status">
                {ebaySellerConnected ? (
                  <span
                    className="orders-ebay-seller-status-icon orders-ebay-seller-status-icon--connected"
                    title={
                      ebayOAuthStatus?.user_name
                        ? `eBay seller linked as ${ebayOAuthStatus.user_name}`
                        : 'eBay seller linked'
                    }
                    aria-label={
                      ebayOAuthStatus?.user_name
                        ? `eBay seller linked as ${ebayOAuthStatus.user_name}`
                        : 'eBay seller linked'
                    }
                    role="img"
                  >
                    <EbaySellerProfileIcon className="orders-ebay-seller-status-profile" />
                  </span>
                ) : (
                  <a
                    href={ebayOAuthStartUrl('/orders?tab=listing-management')}
                    className="orders-ebay-seller-status-icon orders-ebay-seller-status-icon--disconnected"
                    title="Connect eBay seller account"
                    aria-label="Connect eBay seller account"
                  >
                    <EbaySellerProfileIcon className="orders-ebay-seller-status-profile" />
                  </a>
                )}
              </div>
            </div>
            <div className="orders-sales-toolbar-controls-row">
              <div className="orders-sales-filters-group orders-sales-toolbar-filters">
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
                <div className="orders-sales-missing-online-id-toggle">
                  <span
                    className="orders-sales-missing-online-id-toggle-label"
                    id="orders-sales-missing-online-id-label"
                  >
                    Missing Online ID
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className={`orders-sales-missing-online-id-switch${
                      salesMissingOnlineIdFilter
                        ? ' orders-sales-missing-online-id-switch--on'
                        : ''
                    }`}
                    aria-checked={salesMissingOnlineIdFilter}
                    aria-labelledby="orders-sales-missing-online-id-label orders-sales-missing-online-id-state"
                    onClick={() => setSalesMissingOnlineIdFilter((active) => !active)}
                    title={
                      salesMissingOnlineIdFilter
                        ? 'Filter on — show all sold items'
                        : 'Filter off — show only items missing an online ID for their sold platform'
                    }
                  >
                    <span className="orders-sales-missing-online-id-switch-thumb" aria-hidden="true" />
                  </button>
                  <span
                    id="orders-sales-missing-online-id-state"
                    className={`orders-sales-missing-online-id-toggle-state${
                      salesMissingOnlineIdFilter
                        ? ' orders-sales-missing-online-id-toggle-state--on'
                        : ''
                    }`}
                    aria-hidden="true"
                  >
                    {salesMissingOnlineIdFilter ? 'On' : 'Off'}
                  </span>
                </div>
              </div>
              <div className="orders-sales-toolbar-right">
                <div className="orders-vinted-ebay-check-bar orders-sales-ebay-actions">
                  <button
                    type="button"
                    className={`orders-vinted-ebay-check-button${
                      salesEbayGridMode === 'unlist-ebay'
                        ? ' orders-vinted-ebay-check-button--active'
                        : ''
                    }`}
                    onClick={handleVintedEbayCheck}
                    disabled={vintedEbayCheckLoading || !ebaySellerConnected}
                    title={
                      !ebaySellerConnected
                        ? 'Connect your eBay seller account first'
                        : salesEbayGridMode === 'unlist-ebay'
                          ? 'Clear Unlist eBay filter'
                          : 'Scan and show items sold on Vinted that may still be live on eBay'
                    }
                    aria-label={
                      vintedEbayCheckLoading
                        ? 'Checking eBay listings for items sold on Vinted'
                        : !ebaySellerConnected
                          ? 'Unlist eBay (connect eBay seller account first)'
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
                    className={`orders-vinted-ebay-check-button orders-missing-ebay-order-button${
                      salesEbayGridMode === 'missing-ebay-order'
                        ? ' orders-vinted-ebay-check-button--active'
                        : ''
                    }`}
                    onClick={handleMissingEbayOrderCheck}
                    disabled={missingEbayCheckLoading || !ebaySellerConnected}
                    title={
                      !ebaySellerConnected
                        ? 'Connect your eBay seller account first'
                        : salesEbayGridMode === 'missing-ebay-order'
                          ? 'Clear Missing eBay order filter'
                          : 'Compare eBay sold orders to Stock listing IDs'
                    }
                    aria-label={
                      missingEbayCheckLoading
                        ? 'Loading eBay sold orders from your account'
                        : !ebaySellerConnected
                          ? 'Missing eBay order (connect eBay seller account first)'
                          : 'Compare eBay sold orders to Stock listing IDs'
                    }
                  >
                    <EbayLogoIcon className="orders-unlist-ebay-logo" />
                    <span className="orders-unlist-ebay-label">
                      {missingEbayCheckLoading ? 'Checking…' : 'Missing eBay order'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`orders-vinted-ebay-check-button orders-ending-this-week-button${
                      salesEbayGridMode === 'ending-this-week'
                        ? ' orders-vinted-ebay-check-button--active'
                        : ''
                    }`}
                    onClick={handleEndingThisWeekCheck}
                    disabled={endingThisWeekLoading || !ebaySellerConnected}
                    title={
                      !ebaySellerConnected
                        ? 'Connect your eBay seller account first'
                        : salesEbayGridMode === 'ending-this-week'
                          ? 'Clear Ending this week filter'
                          : 'Show unsold Stock listings whose eBay end date is this calendar week'
                    }
                    aria-label={
                      endingThisWeekLoading
                        ? 'Loading eBay listings ending this week'
                        : !ebaySellerConnected
                          ? 'Ending this week (connect eBay seller account first)'
                          : 'Show active eBay seller listings ending this week (from your account)'
                    }
                  >
                    <EbayLogoIcon className="orders-unlist-ebay-logo" />
                    <span className="orders-unlist-ebay-label">
                      {endingThisWeekLoading ? 'Checking…' : 'Ending this week'}
                    </span>
                  </button>
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
                        ? 'eBay sign-in finished but no token was saved on the API. Remove ?ebay_oauth= from the URL and connect again. If you develop on localhost but REACT_APP_API_BASE points at Render, deploy the latest API to Render first, then check Render logs for “[eBay OAuth] refresh token stored” or “callback error”. If the URL has ebay_oauth=error, read ebay_oauth_msg for the real failure.'
                        : ebayOAuthStatus?.reason === 'query_error' && ebayOAuthStatus?.error
                          ? `Could not read token from database: ${ebayOAuthStatus.error}`
                          : 'eBay redirect succeeded but this app sees no stored token. Confirm the API database env matches Supabase, clear ?ebay_oauth= from the URL, then use Connect eBay seller again.'}
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
              {endingThisWeekError && (
                <div className="orders-error orders-vinted-ebay-check-error" role="alert">
                  {endingThisWeekError}
                </div>
              )}
              {vintedEbayCheckApiErrors.length > 0 && (
                <p className="orders-vinted-ebay-api-errors" role="status">
                  {vintedEbayCheckApiErrors.length} listing
                  {vintedEbayCheckApiErrors.length === 1 ? '' : 's'} could not be checked (eBay API). Try
                  again later.
                </p>
              )}
              {endingThisWeekApiErrors.length > 0 && (
                <p className="orders-vinted-ebay-api-errors" role="status">
                  {endingThisWeekApiErrors.length} listing
                  {endingThisWeekApiErrors.length === 1 ? '' : 's'} could not be checked for end date. Try
                  again later.
                </p>
              )}
            </>
          )}
          {salesEbayGridMode === 'unlist-ebay' && !vintedEbayCheckLoading && (
            <p className="orders-sales-grid-mode-hint" role="status">
              Showing {soldRowsUnlistGrid.length} item{soldRowsUnlistGrid.length === 1 ? '' : 's'} sold on
              Vinted where eBay still looks live. Unlist ends the eBay listing via the seller API.
            </p>
          )}
          {salesEbayGridMode === 'missing-ebay-order' && !missingEbayCheckLoading && (
            <p className="orders-sales-grid-mode-hint" role="status">
              Showing {missingEbayInStock.length} eBay sale
              {missingEbayInStock.length === 1 ? '' : 's'} with no matching Stock listing ID.
            </p>
          )}
          {salesEbayGridMode === 'ending-this-week' &&
          (endingThisWeekRows.length > 0 || !endingThisWeekLoading) ? (
            <p className="orders-sales-grid-mode-hint" role="status">
              Showing {endingThisWeekRows.length} active eBay listing
              {endingThisWeekRows.length === 1 ? '' : 's'} ending
              {endingThisWeekWeekLabel ? ` (${endingThisWeekWeekLabel})` : ' this week'}
              {endingThisWeekLoading && endingThisWeekProgress
                ? ` — still scanning ${endingThisWeekProgress.checked.toLocaleString()} of ${endingThisWeekProgress.total.toLocaleString()}`
                : ''}
              . End the listing, relist via API for a new eBay item id, review the link, then confirm to
              update Stock.
            </p>
          ) : null}
          {salesEbayGridMode === 'ending-this-week' && endingThisWeekLoading ? (
            <div
              className={`orders-sales-grid-progress${
                endingThisWeekRows.length > 0 ? ' orders-sales-grid-progress--compact' : ''
              }`}
              role="status"
              aria-live="polite"
            >
              <div className="orders-sales-grid-progress__track" aria-hidden="true">
                <div
                  className="orders-sales-grid-progress__bar"
                  style={{
                    width:
                      endingThisWeekProgress && endingThisWeekProgress.total > 0
                        ? `${Math.min(
                            100,
                            Math.round(
                              (endingThisWeekProgress.checked /
                                endingThisWeekProgress.total) *
                                100
                            )
                          )}%`
                        : endingThisWeekProgress
                          ? '8%'
                          : '0%'
                  }}
                />
              </div>
              <p>
                Checking eBay end dates…{' '}
                {endingThisWeekProgress
                  ? `${endingThisWeekProgress.checked.toLocaleString()} of ${endingThisWeekProgress.total.toLocaleString()} listings`
                  : 'Starting…'}
                {endingThisWeekProgress && endingThisWeekProgress.matchesFound > 0
                  ? ` · ${endingThisWeekProgress.matchesFound} ending this week so far`
                  : ''}
              </p>
            </div>
          ) : null}
          {salesEbayGridMode === 'unlist-ebay' && vintedEbayCheckLoading ? (
            <div className="orders-sales-grid-loading" role="status" aria-live="polite">
              <span className="orders-sales-grid-loading__spinner" aria-hidden />
              <p>Checking which Vinted sales are still live on eBay…</p>
            </div>
          ) : salesEbayGridMode === 'missing-ebay-order' && missingEbayCheckLoading ? (
            <div className="orders-sales-grid-loading" role="status" aria-live="polite">
              <span className="orders-sales-grid-loading__spinner" aria-hidden />
              <p>Matching eBay orders to Stock listing IDs…</p>
            </div>
          ) : salesEbayGridMode === 'ending-this-week' &&
            endingThisWeekLoading &&
            endingThisWeekRows.length === 0 ? (
            null
          ) : salesEbayGridMode === 'ending-this-week' &&
            !endingThisWeekLoading &&
            endingThisWeekRows.length === 0 ? (
            <div className="orders-empty-state">
              <p>No active eBay listings ending this week on your seller account.</p>
              <p>
                GTC listings renew on a rolling schedule — try again later in the week, or check Item Views
                for stale listings.
              </p>
            </div>
          ) : soldLoading &&
            salesEbayGridMode !== 'ending-this-week' &&
            salesEbayGridMode !== 'missing-ebay-order' ? (
            <div className="orders-empty-state">
              <p>Loading sold items…</p>
            </div>
          ) : salesEbayGridMode !== 'ending-this-week' &&
            salesEbayGridMode !== 'missing-ebay-order' &&
            soldRows.length === 0 ? (
            <div className="orders-empty-state">
              <p>No sold items yet.</p>
              <p>Items with a sale date appear here, newest first.</p>
            </div>
          ) : salesGridRowCount === 0 ? (
            <div className="orders-empty-state">
              {salesEbayGridMode === 'unlist-ebay' ? (
                <>
                  <p>No items need unlisting on eBay.</p>
                  <p>Nothing sold on Vinted still looks buyable on eBay for your linked account.</p>
                </>
              ) : salesEbayGridMode === 'missing-ebay-order' ? (
                <>
                  <p>No missing eBay orders.</p>
                  <p>Every recent eBay sale matches a Stock listing ID.</p>
                </>
              ) : salesEbayGridMode === 'ending-this-week' ? (
                <>
                  <p>No active eBay listings ending this week on your seller account.</p>
                </>
              ) : soldByPlatformOnly.length === 0 ? (
                <>
                  <p>No sold items match this platform filter.</p>
                  <p>Choose &quot;All platforms&quot; or another option above.</p>
                </>
              ) : soldByPlatformAndBrand.length === 0 ? (
                <>
                  <p>No sold items match this brand filter.</p>
                  <p>Choose &quot;All brands&quot; or a different brand above.</p>
                </>
              ) : soldRowsForPeriod.length === 0 ? (
                <>
                  <p>No sold items in this period for the selected filters.</p>
                  <p>Try &quot;All time&quot; or adjust platform, brand, or month.</p>
                </>
              ) : (
                <>
                  <p>No sold items with a missing online ID for these filters.</p>
                  <p>Turn off Missing Online ID to show all sales.</p>
                </>
              )}
            </div>
          ) : (
            <>
            <div
              className={`table-wrapper orders-sales-table${
                salesEbayGridMode === 'ending-this-week' ? ' orders-sales-table--ending-this-week' : ''
              }`}
            >
              <table className="orders-table">
                <thead>
                  <tr>
                    {salesEbayGridMode === 'ending-this-week' ? (
                      <th className="orders-ew-col orders-ew-col--time">Time left</th>
                    ) : null}
                    <th
                      className={
                        salesEbayGridMode === 'ending-this-week' ? 'orders-ew-col orders-ew-col--id' : undefined
                      }
                    >
                      {salesEbayGridMode === 'missing-ebay-order' ? 'eBay item' : 'ID'}
                    </th>
                    <th
                      className={
                        salesEbayGridMode === 'ending-this-week' ? 'orders-ew-col orders-ew-col--name' : undefined
                      }
                    >
                      Name
                    </th>
                    <th
                      className={
                        salesEbayGridMode === 'ending-this-week' ? 'orders-ew-col orders-ew-col--time-in-stock' : undefined
                      }
                    >
                      {salesEbayGridMode === 'missing-ebay-order'
                        ? 'eBay order'
                        : salesEbayGridMode === 'ending-this-week'
                          ? 'Time In Stock'
                          : 'Sold'}
                    </th>
                    <th
                      className={
                        salesEbayGridMode === 'ending-this-week' ? 'orders-ew-col orders-ew-col--ebay' : undefined
                      }
                    >
                      {salesEbayGridMode === 'ending-this-week' ? 'Item' : 'eBay link'}
                    </th>
                    {salesEbayGridMode === 'ending-this-week' ? (
                      <th className="orders-ew-col orders-ew-col--edit">Edit</th>
                    ) : null}
                    {salesEbayGridMode !== 'ending-this-week' ? <th>Vinted link</th> : null}
                    {salesEbayGridMode === 'unlist-ebay' ? <th>Edit</th> : null}
                    {salesEbayGridMode === 'unlist-ebay' ? <th>Unlist</th> : null}
                    {salesEbayGridMode === 'ending-this-week' ? (
                      <th className="orders-ew-col orders-ew-col--end">End</th>
                    ) : null}
                    {salesEbayGridMode === 'ending-this-week' ? (
                      <th className="orders-ew-col orders-ew-col--relist">Relist</th>
                    ) : null}
                    {salesEbayGridMode !== 'ending-this-week' ? (
                      <th className="orders-sales-info-header">Info</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {salesEbayGridMode === 'missing-ebay-order'
                    ? missingEbayPaged.map((m) => {
                        const missingStockEditId = stockEditIdForMissingEbaySale(m, soldRows);
                        return (
                        <tr key={m.legacy_item_id}>
                          <td>
                            <span className="orders-missing-ebay-legacy-id">{m.legacy_item_id}</span>
                          </td>
                          <td>
                            {m.item_title?.trim() ? (
                              missingStockEditId ? (
                                <Link
                                  to={`/stock?editId=${missingStockEditId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="orders-sales-stock-name-link"
                                  title={`Edit item ${missingStockEditId} in Stock`}
                                >
                                  {m.item_title.trim()}
                                </Link>
                              ) : (
                                m.item_title.trim()
                              )
                            ) : (
                              <span className="orders-table-dash">—</span>
                            )}
                          </td>
                          <td>
                            {m.order_ids?.length ? (
                              <span className="orders-missing-ebay-order-refs">
                                {m.order_ids.join(', ')}
                              </span>
                            ) : (
                              <span className="orders-table-dash">—</span>
                            )}
                          </td>
                          <td>
                            <a
                              href={m.ebay_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="orders-table-external-link"
                            >
                              {m.legacy_item_id}
                            </a>
                          </td>
                          <td>
                            <span className="orders-table-dash">—</span>
                          </td>
                          <td className="orders-sales-info-cell">
                            {missingStockEditId ? (
                              <Link
                                to={`/stock?editId=${missingStockEditId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="orders-sales-info-button orders-sales-info-button--link"
                                title={`Edit item ${missingStockEditId} in Stock`}
                              >
                                Info
                              </Link>
                            ) : (
                              <span className="orders-table-dash">—</span>
                            )}
                          </td>
                        </tr>
                        );
                      })
                    : salesEbayGridMode === 'ending-this-week'
                    ? endingThisWeekPaged.map((row) => {
                        const rowKey = endingThisWeekRowKey(row);
                        const hasStock = row.id != null;
                        const ebayReviseHref = ebayReviseListingHref(row.ebay_id);
                        const endLoading = ebayRefreshEndLoadingId === rowKey;
                        const relistLoading = ebayRelistLoadingId === rowKey;
                        const ended = ebayRefreshEndedIdSet.has(rowKey);
                        const confirmed = ebayRelistConfirmedIdSet.has(rowKey);
                        const pending = ebayRelistPendingByStockId[rowKey];
                        const endError = ebayRefreshEndErrorById[rowKey];
                        const relistError = ebayRelistErrorById[rowKey];
                        const timeRemaining = formatEbayTimeRemaining(
                          row.item_end_date,
                          ended || confirmed
                        );
                        const timeRemainingUrgent =
                          !ended && !confirmed && ebayTimeRemainingIsUrgent(row.item_end_date);
                        const rowClass = [
                          confirmed ? 'orders-sales-row--ebay-unlisted' : '',
                          ended && !confirmed ? 'orders-sales-row--ebay-ended' : '',
                          !ended && !confirmed ? 'orders-sales-row--ebay-fix-needed' : ''
                        ]
                          .filter(Boolean)
                          .join(' ');
                        return (
                          <tr key={rowKey} className={rowClass || undefined}>
                            <td className="orders-ew-col orders-ew-col--time">
                              {timeRemaining ? (
                                <span
                                  className={
                                    timeRemainingUrgent
                                      ? 'orders-ebay-time-remaining orders-ebay-time-remaining--urgent'
                                      : 'orders-ebay-time-remaining'
                                  }
                                  title={
                                    formatEbayEndDateDisplay(row.item_end_date) || undefined
                                  }
                                >
                                  {timeRemaining}
                                </span>
                              ) : (
                                <span className="orders-table-dash">—</span>
                              )}
                            </td>
                            <td className="orders-ew-col orders-ew-col--id">
                              {hasStock ? (
                                <span className="orders-sales-id-num">{row.id}</span>
                              ) : (
                                <span className="orders-table-dash" title="Not linked to a Stock row">
                                  —
                                </span>
                              )}
                            </td>
                            <td className="orders-ew-col orders-ew-col--name">
                              {row.item_name?.trim() ? (
                                hasStock ? (
                                  <Link
                                    to={`/stock?editId=${row.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="orders-sales-stock-name-link"
                                    title={`Edit item ${row.id} in Stock`}
                                  >
                                    {row.item_name.trim()}
                                  </Link>
                                ) : (
                                  row.item_name.trim()
                                )
                              ) : (
                                <span className="orders-table-dash">—</span>
                              )}
                            </td>
                            <td className="orders-ew-col orders-ew-col--time-in-stock">
                              {formatTimeInStock(row.purchase_date) ? (
                                <span
                                  className="orders-time-in-stock"
                                  title={
                                    formatPurchaseDateLabel(row.purchase_date)
                                      ? `Purchased ${formatPurchaseDateLabel(row.purchase_date)}`
                                      : undefined
                                  }
                                >
                                  {formatTimeInStock(row.purchase_date)}
                                </span>
                              ) : (
                                <span className="orders-table-dash" title="No purchase date in Stock">
                                  —
                                </span>
                              )}
                            </td>
                            <td className="orders-ew-col orders-ew-col--ebay">
                              <a
                                href={row.ebay_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="orders-table-external-link"
                                title="View listing on eBay"
                              >
                                {row.ebay_id}
                              </a>
                            </td>
                            <td className="orders-ew-col orders-ew-col--edit">
                              {ebayReviseHref ? (
                                <a
                                  href={ebayReviseHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="orders-sales-edit-button"
                                  title="Edit this listing on eBay"
                                >
                                  Edit
                                </a>
                              ) : (
                                <span className="orders-table-dash">—</span>
                              )}
                            </td>
                            <td className="orders-ew-col orders-ew-col--end">
                              <div className="orders-sales-unlist-cell">
                                {ended || confirmed ? (
                                  <span className="orders-sales-unlist-done" title="Listing ended on eBay">
                                    Ended
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="orders-sales-unlist-button"
                                    disabled={
                                      !hasStock ||
                                      !ebaySellerConnected ||
                                      endLoading ||
                                      ebayRefreshEndLoadingId != null
                                    }
                                    title={
                                      hasStock
                                        ? 'End this listing on eBay via the seller API'
                                        : 'Link this listing in Stock to end from here'
                                    }
                                    onClick={() => handleEbayRefreshEnd(row)}
                                  >
                                    {endLoading ? 'Ending…' : 'End'}
                                  </button>
                                )}
                                {endError ? (
                                  <span className="orders-sales-unlist-error" title={endError}>
                                    {endError}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="orders-ew-col orders-ew-col--relist">
                              <div className="orders-sales-unlist-cell">
                                {confirmed ? (
                                  <span className="orders-sales-unlist-done" title="Stock updated with new eBay id">
                                    Updated
                                  </span>
                                ) : pending ? (
                                  <button
                                    type="button"
                                    className="orders-sales-relist-review-button"
                                    title="Review the new listing before saving the eBay ID"
                                    onClick={() => void openEndingThisWeekRelistModal(row, pending)}
                                  >
                                    Review
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="orders-sales-relist-button"
                                    disabled={
                                      !hasStock ||
                                      !ebaySellerConnected ||
                                      !ended ||
                                      relistLoading ||
                                      ebayRelistLoadingId != null
                                    }
                                    title={
                                      hasStock
                                        ? 'Create a new eBay listing from the ended item (new item id)'
                                        : 'Link this listing in Stock to relist from here'
                                    }
                                    onClick={() => handleEbayRelist(row)}
                                  >
                                    {relistLoading ? 'Creating…' : 'Recreate'}
                                  </button>
                                )}
                                {relistError ? (
                                  <span className="orders-sales-unlist-error" title={relistError}>
                                    {relistError}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    : soldRowsPaged.map((row) => {
                    const ebayHref = ebayListingHref(row.ebay_id);
                    const ebayReviseHref = ebayReviseListingHref(row.ebay_id);
                    const vintedHref = vintedListingHref(row.vinted_id);
                    const unlistError = ebayUnlistErrorById[row.id];
                    const unlistLoading = ebayUnlistLoadingId === row.id;
                    const rowUnlisted = ebayUnlistedIdSet.has(row.id);
                    const ebayLabel = row.ebay_id != null ? String(row.ebay_id).trim() : '';
                    const vintedLabel = row.vinted_id != null ? String(row.vinted_id).trim() : '';
                    const rowNeedsEbayFix = vintedEbayViolationIdSet.has(row.id) && !rowUnlisted;
                    const rowIsBulky = stockIsBulky(row);
                    const salesRowClass = [
                      rowUnlisted ? 'orders-sales-row--ebay-unlisted' : '',
                      rowNeedsEbayFix ? 'orders-sales-row--ebay-fix-needed' : '',
                      rowIsBulky ? 'orders-row--bulky' : ''
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <tr
                        key={row.id}
                        className={salesRowClass || undefined}
                      >
                        <td>
                          <div className="orders-sales-id-cell">
                            <span className="orders-sales-id-num">{row.id}</span>
                            {rowIsBulky ? (
                              <span className="orders-sales-bulk-badge">BULK</span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          {row.item_name?.trim() ? (
                            <Link
                              to={`/stock?editId=${row.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
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
                          {formatSalesSoldDateDisplay(row) ?? (
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
                        {salesEbayGridMode === 'unlist-ebay' ? (
                          <td>
                            {ebayReviseHref ? (
                              <a
                                href={ebayReviseHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="orders-sales-edit-button"
                                title="Edit this listing on eBay"
                              >
                                Edit
                              </a>
                            ) : (
                              <span className="orders-table-dash">—</span>
                            )}
                          </td>
                        ) : null}
                        {salesEbayGridMode === 'unlist-ebay' ? (
                          <td>
                            {row.ebay_id != null && String(row.ebay_id).trim() !== '' ? (
                              <div className="orders-sales-unlist-cell">
                                {rowUnlisted ? (
                                  <span className="orders-sales-unlist-done" title="Listing ended on eBay">
                                    Unlisted
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="orders-sales-unlist-button"
                                    title="End this listing on eBay via the seller API"
                                    disabled={
                                      !ebaySellerConnected || unlistLoading || ebayUnlistLoadingId != null
                                    }
                                    onClick={() => handleEbayUnlist(row)}
                                  >
                                    {unlistLoading ? 'Ending…' : 'Unlist'}
                                  </button>
                                )}
                                {unlistError ? (
                                  <span className="orders-sales-unlist-error" title={unlistError}>
                                    {unlistError}
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="orders-table-dash">—</span>
                            )}
                          </td>
                        ) : null}
                        <td className="orders-sales-info-cell">
                          <Link
                            to={`/stock?editId=${row.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="orders-sales-info-button orders-sales-info-button--link"
                            title={`Edit item ${row.id} in Stock`}
                          >
                            Info
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {salesGridRowCount > SALES_PAGE_SIZE ? (
              <nav className="orders-sales-pagination" aria-label="Listing Management pagination">
                <button
                  type="button"
                  className="orders-sales-pagination-button"
                  disabled={salesPage <= 1}
                  onClick={() => setSalesPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className="orders-sales-pagination-status">
                  Page {Math.min(salesPage, salesPageCount)} of {salesPageCount}
                  <span className="orders-sales-pagination-range">
                    {' '}
                    · {(Math.min(salesPage, salesPageCount) - 1) * SALES_PAGE_SIZE + 1}–
                    {Math.min(
                      Math.min(salesPage, salesPageCount) * SALES_PAGE_SIZE,
                      salesGridRowCount
                    )}{' '}
                    of {salesGridRowCount}
                  </span>
                </span>
                <button
                  type="button"
                  className="orders-sales-pagination-button"
                  disabled={salesPage >= salesPageCount}
                  onClick={() => setSalesPage((p) => Math.min(salesPageCount, p + 1))}
                >
                  Next
                </button>
              </nav>
            ) : null}
            </>
          )}
        </div>
      )}

      {ordersTab === 'sales-summary' && (
        <div
          id="orders-panel-sales-summary"
          role="tabpanel"
          aria-labelledby="orders-tab-sales-summary"
          className="orders-sales-summary-section"
        >
          <div className="orders-sales-summary-toolbar">
            <div
              className="orders-sales-summary-period-toggle"
              role="group"
              aria-label="Summary period"
            >
              <button
                type="button"
                className={`orders-sales-summary-period-toggle-btn${
                  salesSummaryPeriodMode === 'week'
                    ? ' orders-sales-summary-period-toggle-btn--active'
                    : ''
                }`}
                aria-pressed={salesSummaryPeriodMode === 'week'}
                onClick={() => setSalesSummaryPeriodMode('week')}
              >
                Week
              </button>
              <button
                type="button"
                className={`orders-sales-summary-period-toggle-btn${
                  salesSummaryPeriodMode === 'month'
                    ? ' orders-sales-summary-period-toggle-btn--active'
                    : ''
                }`}
                aria-pressed={salesSummaryPeriodMode === 'month'}
                onClick={() => setSalesSummaryPeriodMode('month')}
              >
                Month
              </button>
            </div>
            {salesSummaryPeriodMode === 'week' ? (
              <select
                id="orders-sales-summary-week"
                className="orders-sales-platform-select orders-sales-summary-week-select"
                value={salesSummarySelectedWeek?.value ?? salesSummaryWeekKey}
                onChange={(e) => setSalesSummaryWeekKey(e.target.value)}
                aria-label="Filter sales by week (last two months)"
              >
                {salesSummaryWeekOptions.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                    {w.value === weekMondayKey(new Date()) ? ' (Current)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <select
                id="orders-sales-summary-month"
                className="orders-sales-platform-select orders-sales-summary-week-select"
                value={salesSummarySelectedMonth?.value ?? salesSummaryMonthKey}
                onChange={(e) => setSalesSummaryMonthKey(e.target.value)}
                aria-label="Filter sales by month (last twelve months)"
              >
                {salesSummaryMonthOptions.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                    {m.value === monthKey(new Date()) ? ' (Current)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {!soldLoading && salesSummaryPeriod && (
            <div className="orders-sales-summary-totals" aria-live="polite">
              <span className="orders-sales-stat">
                <strong>{formatCurrency(salesSummaryTotals.totalSales)}</strong>
                <span className="orders-sales-stat-label"> Total Sales</span>
              </span>
              <span className="orders-sales-stat">
                <strong
                  className={
                    salesSummaryTotals.hasProfit
                      ? salesSummaryTotalProfitClass(
                          salesSummaryTotals.totalProfit,
                          salesSummaryTotals.totalPurchase
                        )
                      : ''
                  }
                >
                  {formatCurrency(salesSummaryTotals.totalProfit)}
                </strong>
                <span className="orders-sales-stat-label"> Total Profit</span>
              </span>
              <span className="orders-sales-stat">
                <strong>{formatCurrency(salesSummaryTotals.hasPurchase ? salesSummaryTotals.totalPurchase : null)}</strong>
                <span className="orders-sales-stat-label"> Total Expenses</span>
              </span>
              <span className="orders-sales-stat">
                <strong>{salesSummaryTotals.saleCount}</strong>
                <span className="orders-sales-stat-label">
                  {' '}
                  {salesSummaryTotals.saleCount === 1 ? 'Item Sold' : 'Items Sold'}
                </span>
              </span>
            </div>
          )}

          {soldLoading ? (
            <div className="orders-empty-state">
              <p>Loading sales…</p>
            </div>
          ) : soldRows.length === 0 ? (
            <div className="orders-empty-state">
              <p>No sold items yet.</p>
            </div>
          ) : salesSummaryRows.length === 0 ? (
            <div className="orders-empty-state">
              <p>No sales in {salesSummaryPeriod?.label ?? 'this period'}.</p>
              <p>
                Choose another {salesSummaryPeriodMode === 'week' ? 'week' : 'month'} from the filter
                above.
              </p>
            </div>
          ) : (
            <div className="table-wrapper orders-sales-summary-table-wrap">
              <table className="orders-table orders-sales-summary-table">
                <thead>
                  <tr>
                    <th>Products Sold</th>
                    <th>Sale price</th>
                    <th>Buy price</th>
                    <th>Profit</th>
                    <th>Listing</th>
                  </tr>
                </thead>
                <tbody>
                  {salesSummaryRows.map((row) => {
                    const { sale, profit } = computeStockInfoPanelMetrics(row);
                    const listing = soldPlatformListingHref(row);
                    const title = row.item_name?.trim() || '—';
                    const profitClass = salesSummaryProfitClass(row, profit);
                    return (
                      <tr key={row.id}>
                        <td>
                          {listing ? (
                            <SalesSummaryPlatformLink listing={listing} title={`Open on ${listing.platform}`}>
                              {title}
                            </SalesSummaryPlatformLink>
                          ) : (
                            <Link
                              to={`/stock?editId=${row.id}`}
                              className="orders-sales-stock-name-link"
                              title={`Edit item ${row.id} in Stock`}
                            >
                              {title}
                            </Link>
                          )}
                        </td>
                        <td>{formatCurrency(Number.isNaN(sale) ? null : sale)}</td>
                        <td>
                          {formatCurrency(
                            row.purchase_price !== null && row.purchase_price !== undefined
                              ? Number(row.purchase_price)
                              : null
                          )}
                        </td>
                        <td className={profitClass}>
                          {formatCurrency(Number.isNaN(profit) ? null : profit)}
                        </td>
                        <td>
                          {listing ? (
                            <SalesSummaryPlatformLink listing={listing}>
                              {listing.platform}
                            </SalesSummaryPlatformLink>
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

      {toPackEbayUnlistModal ? (
        <div
          className="orders-relist-modal-backdrop orders-topack-unlist-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!toPackEbayUnlistModal.unlistLoading) {
              void finishPostedAfterUnlistModal(toPackEbayUnlistModal.item.id);
            }
          }}
        >
          <div
            className="orders-relist-modal orders-topack-unlist-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="orders-topack-unlist-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="orders-relist-modal-close"
              aria-label="Close and mark posted"
              disabled={toPackEbayUnlistModal.unlistLoading}
              onClick={() => void finishPostedAfterUnlistModal(toPackEbayUnlistModal.item.id)}
            >
              ×
            </button>
            <div className="orders-topack-unlist-modal-body">
              <p className="orders-relist-modal-eyebrow">Sold on Vinted</p>
              <h2 id="orders-topack-unlist-modal-title" className="orders-relist-modal-title">
                Still live on eBay
              </h2>
              <p className="orders-topack-unlist-modal-lead">
                This item sold on Vinted but the eBay listing is still active. End it before marking
                posted.
              </p>
              <dl className="orders-relist-modal-details orders-topack-unlist-modal-details">
                <div className="orders-relist-modal-detail orders-topack-unlist-modal-detail--wide">
                  <dt>Item</dt>
                  <dd>{toPackEbayUnlistModal.violation.item_name?.trim() || '—'}</dd>
                </div>
                <div className="orders-relist-modal-detail">
                  <dt>eBay item</dt>
                  <dd>
                    <a
                      href={toPackEbayUnlistModal.violation.ebay_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="orders-table-external-link"
                    >
                      {toPackEbayUnlistModal.violation.ebay_id}
                    </a>
                  </dd>
                </div>
              </dl>
              {toPackEbayUnlistModal.unlistError ? (
                <p className="orders-relist-modal-note orders-relist-modal-note--warn" role="alert">
                  {toPackEbayUnlistModal.unlistError}
                </p>
              ) : null}
              {!ebaySellerConnected ? (
                <p className="orders-relist-modal-note orders-relist-modal-note--warn">
                  Connect your eBay seller account on Listing Management to unlist from here.
                </p>
              ) : null}
              <div className="orders-relist-modal-actions">
                <button
                  type="button"
                  className="orders-sales-unlist-button"
                  disabled={
                    !ebaySellerConnected ||
                    toPackEbayUnlistModal.unlistLoading ||
                    ebayUnlistLoadingId != null
                  }
                  onClick={() => void handleToPackEbayUnlist()}
                >
                  {toPackEbayUnlistModal.unlistLoading ? 'Unlisting…' : 'Unlist on eBay'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {endingThisWeekRelistModal ? (
        <div
          className="orders-relist-modal-backdrop"
          role="presentation"
          onClick={closeEndingThisWeekRelistModal}
        >
          <div
            className="orders-relist-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="orders-relist-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="orders-relist-modal-close"
              aria-label="Close review"
              onClick={closeEndingThisWeekRelistModal}
            >
              ×
            </button>
            <div className="orders-relist-modal-layout">
              <div className="orders-relist-modal-media" aria-hidden={endingThisWeekRelistModal.previewLoading}>
                {endingThisWeekRelistModal.previewLoading ? (
                  <div className="orders-relist-modal-media-loading">Loading preview…</div>
                ) : endingThisWeekRelistModal.preview?.imageUrl ? (
                  <img
                    src={endingThisWeekRelistModal.preview.imageUrl}
                    alt=""
                    className="orders-relist-modal-image"
                  />
                ) : (
                  <div className="orders-relist-modal-media-fallback">No image</div>
                )}
              </div>
              <div className="orders-relist-modal-body">
                <p className="orders-relist-modal-eyebrow">New eBay listing</p>
                <h2 id="orders-relist-modal-title" className="orders-relist-modal-title">
                  {endingThisWeekRelistModal.preview?.title ||
                    endingThisWeekRelistModal.row.item_name?.trim() ||
                    'Review recreated listing'}
                </h2>
                {endingThisWeekRelistModal.previewError ? (
                  <p className="orders-relist-modal-note orders-relist-modal-note--warn">
                    {endingThisWeekRelistModal.previewError}
                  </p>
                ) : null}
                <dl className="orders-relist-modal-details">
                  <div className="orders-relist-modal-detail">
                    <dt>Item ID</dt>
                    <dd>{endingThisWeekRelistModal.pending.newLegacyItemId}</dd>
                  </div>
                  {endingThisWeekRelistModal.preview?.priceLabel ? (
                    <div className="orders-relist-modal-detail">
                      <dt>Price</dt>
                      <dd>{endingThisWeekRelistModal.preview.priceLabel}</dd>
                    </div>
                  ) : null}
                  {endingThisWeekRelistModal.preview?.condition ? (
                    <div className="orders-relist-modal-detail">
                      <dt>Condition</dt>
                      <dd>{endingThisWeekRelistModal.preview.condition}</dd>
                    </div>
                  ) : null}
                  {endingThisWeekRelistModal.preview?.itemEndDate ? (
                    <div className="orders-relist-modal-detail">
                      <dt>Ends</dt>
                      <dd>
                        {formatEbayEndDateDisplay(endingThisWeekRelistModal.preview.itemEndDate) ??
                          formatEbayEndDateShort(endingThisWeekRelistModal.preview.itemEndDate) ??
                          endingThisWeekRelistModal.preview.itemEndDate}
                      </dd>
                    </div>
                  ) : null}
                  {endingThisWeekRelistModal.preview?.buyingOptions?.length ? (
                    <div className="orders-relist-modal-detail">
                      <dt>Format</dt>
                      <dd>{endingThisWeekRelistModal.preview.buyingOptions.join(', ')}</dd>
                    </div>
                  ) : null}
                  {endingThisWeekRelistModal.row.id != null ? (
                    <div className="orders-relist-modal-detail">
                      <dt>Stock ID</dt>
                      <dd>{endingThisWeekRelistModal.row.id}</dd>
                    </div>
                  ) : null}
                </dl>
                {endingThisWeekRelistModal.preview?.aspects?.length ? (
                  <ul className="orders-relist-modal-aspects">
                    {endingThisWeekRelistModal.preview.aspects.map((aspect) => (
                      <li key={`${aspect.name}-${aspect.value}`}>
                        <span className="orders-relist-modal-aspect-name">{aspect.name}</span>
                        <span className="orders-relist-modal-aspect-value">{aspect.value}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="orders-relist-modal-actions">
                  <a
                    href={endingThisWeekRelistModal.pending.ebayUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="orders-sales-edit-button"
                  >
                    Review
                  </a>
                  <a
                    href={endingThisWeekRelistModal.pending.reviseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="orders-sales-relist-modal-edit-link"
                  >
                    Edit on eBay
                  </a>
                  <button
                    type="button"
                    className="orders-sales-relist-confirm-button"
                    disabled={
                      endingThisWeekRelistModal.row.id == null ||
                      ebayRelistConfirmLoadingId === endingThisWeekRelistModal.rowKey
                    }
                    onClick={() => void handleEbayRelistConfirm(endingThisWeekRelistModal.row)}
                  >
                    {ebayRelistConfirmLoadingId === endingThisWeekRelistModal.rowKey
                      ? 'Saving…'
                      : 'Save eBay ID'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Orders;

