import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { getApiBase } from '../utils/apiBase';
import './Reporting.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend);

interface ProfitTimelinePoint {
  year: number;
  month: number;
  label: string;
  totalSales: number;
  totalPurchase: number;
  profit: number;
}

interface MonthlyProfitDatum {
  month: number;
  totalSales: number;
  totalPurchase: number;
  profit: number;
}

interface MonthlyExpenseDatum {
  month: number;
  expense: number;
}

interface MonthlyAverageSellingPriceDatum {
  month: number;
  average: number;
  itemCount: number;
}

interface MonthlyAverageProfitPerItemDatum {
  month: number;
  average: number;
  itemCount: number;
}

interface MonthlyAverageProfitMultipleDatum {
  month: number;
  average: number;
  itemCount: number;
}

interface SalesByCategoryDatum {
  category: string;
  totalSales: number;
}

interface UnsoldStockByCategoryDatum {
  category: string;
  totalValue: number;
  itemCount: number;
}

interface SoldCountByCategoryDatum {
  category: string;
  soldCount: number;
}

interface SoldCategoryNetDatum {
  category: string;
  netProfit: number;
}

/** One row of the inventory vs sold stacked chart + tooltip / Ask AI context. */
interface CategoryInventorySoldStackRow {
  category: string;
  inStock: number;
  sold: number;
  unsoldBuyInValue: number;
  /** Net on sold lines in period (sale − buy); null if unknown. */
  soldNetProfit: number | null;
}

const EMPTY_CATEGORY_STACK_ROWS: CategoryInventorySoldStackRow[] = [];

interface SalesByBrandDatum {
  brand: string;
  totalSales: number;
}

interface SalesByBrandCategorySet {
  trousers: SalesByBrandDatum[];
  shirt: SalesByBrandDatum[];
  top: SalesByBrandDatum[];
  coat: SalesByBrandDatum[];
  jacket: SalesByBrandDatum[];
}

interface WorstSellingBrandsDatum {
  brand: string;
  itemCount: number;
}

interface BrandSellThroughDatum {
  brand: string;
  itemsListed: number;
  itemsSold: number;
  sellThroughRate: number;
}

interface SellThroughRate {
  totalListed: number;
  totalSold: number;
  percentage: number;
}

interface AverageSellingPrice {
  totalSales: number;
  soldCount: number;
  average: number;
}

interface AverageProfitPerItem {
  netProfit: number;
  soldCount: number;
  average: number;
}

interface ROI {
  profit: number;
  totalSpend: number;
  percentage: number;
}

interface AverageDaysToSell {
  days: number;
}

interface ActiveListingsCount {
  count: number;
}

interface UnsoldInventoryValue {
  value: number;
}

interface TrailingInventoryPoint {
  year: number;
  month: number;
  label: string;
  inventoryCost: number;
}

interface StockRowForSalesData {
  id?: number;
  item_name?: string | null;
  purchase_date: string | null;
  sale_date: string | null;
  purchase_price: number | string | null;
  sale_price: number | string | null;
  sold_platform?: string | null;
  category_id?: number | string | null;
}

interface ReportingCategoryRow {
  id: number;
  category_name: string;
}

type ItemAnalysisPreset = 'current-month' | 'last-month' | 'custom-month' | 'current-year' | 'last-3-years';

type ItemAnalysisPlatformTab = 'vinted' | 'ebay';

const monthLabelsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface ItemAnalysisSoldRow {
  id: number;
  name: string;
  purchase: number;
  sale: number;
  profit: number;
  multiplier: number | null;
}

function parseStockNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function getItemAnalysisRange(
  preset: ItemAnalysisPreset,
  customYear: number,
  customMonth: number
): { start: Date; end: Date; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const eod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  if (preset === 'current-month') {
    const start = sod(new Date(y, m, 1));
    const end = eod(new Date(y, m + 1, 0));
    return { start, end, label: `${monthLabelsShort[m]} ${y}` };
  }
  if (preset === 'last-month') {
    const start = sod(new Date(y, m - 1, 1));
    const end = eod(new Date(y, m, 0));
    const ly = m === 0 ? y - 1 : y;
    const lm = m === 0 ? 11 : m - 1;
    return { start, end, label: `${monthLabelsShort[lm]} ${ly}` };
  }
  if (preset === 'current-year') {
    const start = sod(new Date(y, 0, 1));
    const end = eod(new Date(y, 11, 31));
    return { start, end, label: `${y}` };
  }
  if (preset === 'last-3-years') {
    const startYear = y - 2;
    const start = sod(new Date(startYear, 0, 1));
    const end = eod(new Date(y, 11, 31));
    return { start, end, label: `${startYear}–${y}` };
  }
  const start = sod(new Date(customYear, customMonth - 1, 1));
  const end = eod(new Date(customYear, customMonth, 0));
  return { start, end, label: `${monthLabelsShort[customMonth - 1]} ${customYear}` };
}

function soldPlatformIsEbay(p: string | null | undefined): boolean {
  const t = p?.trim();
  return t === 'eBay' || t?.toLowerCase() === 'ebay';
}

function soldPlatformIsVinted(p: string | null | undefined): boolean {
  const t = p?.trim();
  return t === 'Vinted' || t?.toLowerCase() === 'vinted';
}

/** Left-trim monthly charts: first index where this chart has data; if none, keep full range. */
function monthlyChartLeadingTrimIndex(n: number, hasDataAtIndex: (i: number) => boolean): number {
  for (let i = 0; i < n; i += 1) {
    if (hasDataAtIndex(i)) return i;
  }
  return 0;
}

interface ReportingResponse {
  availableYears: number[];
  selectedYear: number;
  profitTimeline: ProfitTimelinePoint[];
  monthlyProfit: MonthlyProfitDatum[];
  monthlyExpenses: MonthlyExpenseDatum[];
  monthlyAverageSellingPrice: MonthlyAverageSellingPriceDatum[];
  monthlyAverageProfitPerItem: MonthlyAverageProfitPerItemDatum[];
  monthlyAverageProfitMultiple: MonthlyAverageProfitMultipleDatum[];
  salesByCategory: SalesByCategoryDatum[];
  soldCountByCategory: SoldCountByCategoryDatum[];
  soldCategoryNetProfit?: SoldCategoryNetDatum[];
  salesByBrand: SalesByBrandDatum[];
  bestSellingBrandsByCategory: SalesByBrandCategorySet;
  worstSellingBrands: WorstSellingBrandsDatum[];
  bestSellThroughBrands: BrandSellThroughDatum[];
  worstSellThroughBrands: BrandSellThroughDatum[];
  yearSpecificTotals?: {
    totalPurchase: number;
    totalSales: number;
    profit: number;
    costOfSoldItems?: number;
    totalProfitFromSoldItems?: number;
    vintedSales?: number;
    ebaySales?: number;
  };
  allTimeAverageProfitMultiple?: number;
  yearItemsStats?: {
    listed: number;
    sold: number;
  };
  unsoldStockByCategory: UnsoldStockByCategoryDatum[];
  sellThroughRate: SellThroughRate;
  averageSellingPrice: AverageSellingPrice;
  averageProfitPerItem: AverageProfitPerItem;
  roi: ROI;
  averageDaysToSell: AverageDaysToSell;
  activeListingsCount: ActiveListingsCount;
  unsoldInventoryValue: UnsoldInventoryValue;
  currentMonthSales?: number;
  currentWeekSales?: number;
}

const API_BASE = getApiBase();

const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrency = (value: number) => currencyFormatter.format(value ?? 0);

function buildStockAnalysisCategoryAskAiPrompt(args: {
  periodLabel: string;
  rows: CategoryInventorySoldStackRow[];
  yearItemsStats: { listed: number; sold: number } | null;
}): string {
  const { periodLabel, rows, yearItemsStats } = args;
  const lines: string[] = [
    'I run a UK resale business. Below is **aggregated data from my stock system**: inventory vs sold **counts** by Menswear category, unsold **buy-in value** tied up, and **net P/L on sold lines** in the period (sum of sale_price − purchase_price per sold row).',
    'Use only this data and clear inference. Be direct; no empty praise or generic encouragement.',
    '',
    '## Reporting period',
    periodLabel,
    '',
  ];
  if (yearItemsStats && (yearItemsStats.listed > 0 || yearItemsStats.sold > 0)) {
    lines.push(
      '## Portfolio snapshot (same reporting scope)',
      `- Lines counted as listed: ${yearItemsStats.listed}`,
      `- Lines counted as sold: ${yearItemsStats.sold}`,
      ''
    );
  }
  lines.push(
    '## Per category',
    '',
    '| Category | In stock (items) | Sold (items) | Unsold buy-in value (£) | Sold net P/L (£) |',
    '|---:|---:|---:|---:|---:|'
  );
  rows.forEach((r) => {
    const pnl =
      r.soldNetProfit != null && Number.isFinite(r.soldNetProfit)
        ? formatCurrency(r.soldNetProfit)
        : '—';
    lines.push(
      `| ${r.category.replace(/\|/g, '/')} | ${r.inStock} | ${r.sold} | ${formatCurrency(r.unsoldBuyInValue)} | ${pnl} |`
    );
  });
  lines.push(
    '',
    '## What I want from you',
    '1. **What should I avoid buying** (categories or patterns), grounded in stuck inventory vs what sells and P/L where it helps?',
    '2. **What should I double down on** buying?',
    '3. **What mistakes might I be making** (buying, pricing, category mix)?',
    '',
    'Answer in short sections with bullets. If the data is thin, say so and still give your best read.'
  );
  return lines.join('\n');
}

interface ReportingExpenseRow {
  id: number;
  item: string;
  cost: string | number;
  purchase_date: string | null;
  receipt_name?: string | null;
  purchase_location?: string | null;
}

function expenseInCalendarMonth(purchaseDate: string | null, year: number, month: number): boolean {
  if (!purchaseDate) return false;
  const d = new Date(purchaseDate);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === year && d.getMonth() + 1 === month;
}

const chartOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label(context) {
          const value = context.raw as number;
          return formatCurrency(value || 0);
        },
      },
    },
  },
  scales: {
    x: {
      grid: { color: 'rgba(255, 214, 91, 0.08)' },
      ticks: { color: 'rgba(255, 248, 226, 0.8)' },
    },
    y: {
      beginAtZero: true,
      grid: { color: 'rgba(255, 214, 91, 0.12)' },
      ticks: {
        color: 'rgba(255, 248, 226, 0.75)',
        callback(value) {
          if (typeof value === 'number') {
            return formatCurrency(value);
          }
          return value;
        },
      },
    },
  },
};

const itemAnalysisChartOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y',
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label(context) {
          const value = context.raw as number;
          return `Profit: ${formatCurrency(value || 0)}`;
        },
      },
    },
  },
  scales: {
    x: {
      beginAtZero: true,
      grid: { color: 'rgba(255, 214, 91, 0.12)' },
      ticks: {
        color: 'rgba(255, 248, 226, 0.75)',
        callback(value) {
          if (typeof value === 'number') {
            return formatCurrency(value);
          }
          return value;
        },
      },
    },
    y: {
      grid: { display: false },
      ticks: {
        color: 'rgba(255, 248, 226, 0.82)',
        autoSkip: false,
        font: { size: 11 },
      },
    },
  },
};

const Reporting: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const initialViewMode: 'sales-data' | 'stock-analysis' | 'item-analysis' =
    tabFromUrl === 'stock-analysis'
      ? 'stock-analysis'
      : tabFromUrl === 'item-analysis'
        ? 'item-analysis'
        : 'sales-data';

  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [monthlyProfit, setMonthlyProfit] = useState<MonthlyProfitDatum[]>([]);
  const [salesByCategory, setSalesByCategory] = useState<SalesByCategoryDatum[]>([]);
  const [unsoldStockByCategory, setUnsoldStockByCategory] = useState<UnsoldStockByCategoryDatum[]>([]);
  const [soldCountByCategory, setSoldCountByCategory] = useState<SoldCountByCategoryDatum[]>([]);
  const [soldCategoryNetProfit, setSoldCategoryNetProfit] = useState<SoldCategoryNetDatum[]>([]);
  const [reportingCategoryRows, setReportingCategoryRows] = useState<ReportingCategoryRow[]>([]);
  const [salesByBrand, setSalesByBrand] = useState<SalesByBrandDatum[]>([]);
  const [bestSellingBrandsByCategory, setBestSellingBrandsByCategory] = useState<SalesByBrandCategorySet>({
    trousers: [],
    shirt: [],
    top: [],
    coat: [],
    jacket: []
  });
  const [worstSellingBrands, setWorstSellingBrands] = useState<WorstSellingBrandsDatum[]>([]);
  const [bestSellThroughBrands, setBestSellThroughBrands] = useState<BrandSellThroughDatum[]>([]);
  const [worstSellThroughBrands, setWorstSellThroughBrands] = useState<BrandSellThroughDatum[]>([]);
  const [yearSpecificTotals, setYearSpecificTotals] = useState<{ totalPurchase: number; totalSales: number; profit: number; costOfSoldItems?: number; totalProfitFromSoldItems?: number; vintedSales?: number; ebaySales?: number } | null>(null);
  const [allTimeAverageProfitMultiple, setAllTimeAverageProfitMultiple] = useState<number | null>(null);
  const [yearItemsStats, setYearItemsStats] = useState<{ listed: number; sold: number } | null>(null);
  const [averageSellingPrice, setAverageSellingPrice] = useState<AverageSellingPrice | null>(null);
  const [averageProfitPerItem, setAverageProfitPerItem] = useState<AverageProfitPerItem | null>(null);
  const [roi, setRoi] = useState<ROI | null>(null);
  const [averageDaysToSell, setAverageDaysToSell] = useState<AverageDaysToSell | null>(null);
  const [activeListingsCount, setActiveListingsCount] = useState<ActiveListingsCount | null>(null);
  const [unsoldInventoryValue, setUnsoldInventoryValue] = useState<UnsoldInventoryValue | null>(null);
  const [currentMonthSales, setCurrentMonthSales] = useState<number>(0);
  const [currentWeekSales, setCurrentWeekSales] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Monthly view state
  const [viewMode, setViewMode] = useState<'sales-data' | 'stock-analysis' | 'item-analysis'>(initialViewMode);
  const [itemAnalysisPreset, setItemAnalysisPreset] = useState<ItemAnalysisPreset>('current-month');
  const [itemAnalysisCustomYear, setItemAnalysisCustomYear] = useState(() => new Date().getFullYear());
  const [itemAnalysisCustomMonth, setItemAnalysisCustomMonth] = useState(() => new Date().getMonth() + 1);
  const [itemAnalysisPlatform, setItemAnalysisPlatform] = useState<ItemAnalysisPlatformTab>(() => {
    if (typeof window === 'undefined') return 'vinted';
    const q = new URLSearchParams(window.location.search);
    if (q.get('tab') !== 'item-analysis') return 'vinted';
    return q.get('platform') === 'ebay' ? 'ebay' : 'vinted';
  });
  const [vintedData, setVintedData] = useState<{ purchases: number; sales: number; profit: number }>({ purchases: 0, sales: 0, profit: 0 });
  const [ebayData, setEbayData] = useState<{ purchases: number; sales: number; profit: number }>({ purchases: 0, sales: 0, profit: 0 });
  const [depopData, setDepopData] = useState<{ purchases: number; sales: number; profit: number }>({ purchases: 0, sales: 0, profit: 0 });
  const [unsoldPurchases, setUnsoldPurchases] = useState<number>(0);
  const [cashFlowProfit, setCashFlowProfit] = useState<number>(0);
  const [untaggedItems, setUntaggedItems] = useState<Array<{
    id: number;
    item_name: string | null;
    category: string | null;
    purchase_price: number | null;
    purchase_date: string | null;
    sale_date: string | null;
    sale_price: number | null;
    sold_platform: string | null;
    vinted_id: string | null;
    ebay_id: string | null;
  }>>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  
  // State for the new monthly summary row (in Global view)
  const [monthlySummaryYear, setMonthlySummaryYear] = useState<number>(new Date().getFullYear());
  const [monthlySummaryMonth, setMonthlySummaryMonth] = useState<number>(new Date().getMonth() + 1);
  const [monthlySummaryData, setMonthlySummaryData] = useState<{
    ebaySales: number;
    vintedSales: number;
    depopSales: number;
    monthProfit: number;
    unsoldInventoryValue: number;
  } | null>(null);
  const [monthlySummaryLoading, setMonthlySummaryLoading] = useState(false);

  const [reportingExpensesAll, setReportingExpensesAll] = useState<ReportingExpenseRow[]>([]);
  const [reportingExpensesLoading, setReportingExpensesLoading] = useState(false);
  const [reportingExpensesError, setReportingExpensesError] = useState<string | null>(null);

  // State for trailing inventory
  const [trailingInventory, setTrailingInventory] = useState<TrailingInventoryPoint[]>([]);
  const [trailingInventoryLoading, setTrailingInventoryLoading] = useState(false);
  const [stockRowsForSalesData, setStockRowsForSalesData] = useState<StockRowForSalesData[]>([]);
  const [salesDateFilter, setSalesDateFilter] = useState<'all-time' | 'last-30-days' | 'last-3-months' | 'current-year' | 'previous-year'>('all-time');
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
      const yearParam =
        viewMode === 'sales-data'
          ? 'all'
          : selectedYear === 'all'
            ? 'all'
            : selectedYear;
      const response = await fetch(`${API_BASE}/api/analytics/reporting?year=${yearParam}`);
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'Failed to load analytics data');
        }
        const data: ReportingResponse = await response.json();
        setAvailableYears(data.availableYears);
        setMonthlyProfit(data.monthlyProfit);
        setSalesByCategory(data.salesByCategory || []);
        const rawSold =
          data.soldCountByCategory ??
          (data as { sold_count_by_category?: SoldCountByCategoryDatum[] }).sold_count_by_category;
        setSoldCountByCategory(Array.isArray(rawSold) ? rawSold : []);
        const rawPnl =
          data.soldCategoryNetProfit ??
          (data as { sold_category_net_profit?: SoldCategoryNetDatum[] }).sold_category_net_profit;
        setSoldCategoryNetProfit(Array.isArray(rawPnl) ? rawPnl : []);
        setUnsoldStockByCategory(data.unsoldStockByCategory || []);
        setSalesByBrand(data.salesByBrand || []);
        setBestSellingBrandsByCategory(data.bestSellingBrandsByCategory || {
          trousers: [],
          shirt: [],
          top: [],
          coat: [],
          jacket: []
        });
        setWorstSellingBrands(data.worstSellingBrands || []);
        setBestSellThroughBrands(data.bestSellThroughBrands || []);
        setWorstSellThroughBrands(data.worstSellThroughBrands || []);
        setYearSpecificTotals(data.yearSpecificTotals || null);
        setAllTimeAverageProfitMultiple(data.allTimeAverageProfitMultiple ?? null);
        setYearItemsStats(data.yearItemsStats || null);
        setAverageSellingPrice(data.averageSellingPrice || null);
        setAverageProfitPerItem(data.averageProfitPerItem || null);
        setRoi(data.roi || null);
        setAverageDaysToSell(data.averageDaysToSell || null);
        setActiveListingsCount(data.activeListingsCount || null);
        setUnsoldInventoryValue(data.unsoldInventoryValue || null);
        setCurrentMonthSales(data.currentMonthSales ?? 0);
        setCurrentWeekSales(data.currentWeekSales ?? 0);
        if (
          viewMode !== 'sales-data' &&
          data.selectedYear !== selectedYear &&
          selectedYear !== 'all'
        ) {
          setSelectedYear(data.selectedYear);
        }
      } catch (err: any) {
        console.error('Reporting fetch error:', err);
        setError(err.message || 'Unable to load reporting data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedYear, viewMode]);

  useEffect(() => {
    const t = searchParams.get('tab');
    const nextViewMode: 'sales-data' | 'stock-analysis' | 'item-analysis' =
      t === 'stock-analysis' ? 'stock-analysis' : t === 'item-analysis' ? 'item-analysis' : 'sales-data';
    setViewMode((prev) => (prev === nextViewMode ? prev : nextViewMode));
  }, [searchParams]);

  useEffect(() => {
    const currentTab = searchParams.get('tab');
    if (currentTab === viewMode) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', viewMode);
    setSearchParams(nextParams, { replace: true });
  }, [viewMode, searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get('tab') !== 'item-analysis') return;
    const p = searchParams.get('platform');
    setItemAnalysisPlatform(p === 'ebay' ? 'ebay' : 'vinted');
  }, [searchParams]);

  useEffect(() => {
    const fetchStockRows = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/stock`);
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        setStockRowsForSalesData(Array.isArray(data?.rows) ? data.rows : []);
      } catch (err) {
        console.error('Failed to load stock rows for sales-data filters:', err);
        setStockRowsForSalesData([]);
      }
    };
    fetchStockRows();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/categories`);
        if (!response.ok) return;
        const data = await response.json();
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        if (cancelled) return;
        const mapped: Array<ReportingCategoryRow | null> = rows.map(
          (r: { id?: unknown; category_name?: unknown }): ReportingCategoryRow | null => {
            const id = Number(r.id);
            if (!Number.isFinite(id)) return null;
            const nm = (r.category_name != null ? String(r.category_name) : '').trim();
            return { id, category_name: nm || 'Uncategorized' };
          }
        );
        setReportingCategoryRows(mapped.filter((r): r is ReportingCategoryRow => r != null));
      } catch {
        if (!cancelled) setReportingCategoryRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (viewMode !== 'sales-data') {
      return;
    }
    let cancelled = false;
    (async () => {
      setReportingExpensesLoading(true);
      setReportingExpensesError(null);
      try {
        const res = await fetch(`${API_BASE}/api/expenses`);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || 'Failed to load expenses');
        }
        const data = await res.json();
        if (cancelled) return;
        setReportingExpensesAll(Array.isArray(data.rows) ? data.rows : []);
      } catch (e: unknown) {
        if (!cancelled) {
          setReportingExpensesError(e instanceof Error ? e.message : 'Unable to load expenses');
          setReportingExpensesAll([]);
        }
      } finally {
        if (!cancelled) {
          setReportingExpensesLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode]);

  // Fetch monthly platform data when in monthly view
  useEffect(() => {
    if (viewMode === 'sales-data') {
      const fetchMonthlyData = async () => {
        try {
          setMonthlyLoading(true);
          const url = `${API_BASE}/api/analytics/monthly-platform?year=${monthlySummaryYear}&month=${monthlySummaryMonth}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error('Failed to load monthly platform data');
          }
          const data = await response.json();
          setVintedData(data.vinted || { purchases: 0, sales: 0, profit: 0 });
          setEbayData(data.ebay || { purchases: 0, sales: 0, profit: 0 });
          setDepopData(data.depop || { purchases: 0, sales: 0, profit: 0 });
          setUnsoldPurchases(data.unsoldPurchases || 0);
          setCashFlowProfit(data.cashFlowProfit || 0);
          setUntaggedItems(data.untaggedItems || []);
        } catch (err: any) {
          console.error('[Monthly Platform] Fetch error:', err);
          setVintedData({ purchases: 0, sales: 0, profit: 0 });
          setEbayData({ purchases: 0, sales: 0, profit: 0 });
          setDepopData({ purchases: 0, sales: 0, profit: 0 });
          setUnsoldPurchases(0);
          setCashFlowProfit(0);
          setUntaggedItems([]);
        } finally {
          setMonthlyLoading(false);
        }
      };
      fetchMonthlyData();
    }
  }, [viewMode, monthlySummaryYear, monthlySummaryMonth]);

  // Fetch monthly summary data for the new row in Global view
  useEffect(() => {
    if (viewMode === 'sales-data') {
      const fetchMonthlySummary = async () => {
        try {
          setMonthlySummaryLoading(true);
          const url = `${API_BASE}/api/analytics/monthly-platform?year=${monthlySummaryYear}&month=${monthlySummaryMonth}`;
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error('Failed to load monthly summary data');
          }
          const data = await response.json();
          setMonthlySummaryData({
            ebaySales: data.ebay?.sales || 0,
            vintedSales: data.vinted?.sales || 0,
            depopSales: data.depop?.sales || 0,
            monthProfit: data.totalMonthProfit || 0,
            unsoldInventoryValue: data.unsoldInventoryValue || 0
          });
        } catch (err: any) {
          console.error('[Monthly Summary] Fetch error:', err);
          setMonthlySummaryData({
            ebaySales: 0,
            vintedSales: 0,
            depopSales: 0,
            monthProfit: 0,
            unsoldInventoryValue: 0
          });
        } finally {
          setMonthlySummaryLoading(false);
        }
      };
      fetchMonthlySummary();
    }
  }, [viewMode, monthlySummaryYear, monthlySummaryMonth]);

  // Fetch trailing inventory data
  useEffect(() => {
    if (viewMode === 'sales-data') {
      const fetchTrailingInventory = async () => {
        try {
          setTrailingInventoryLoading(true);
          const response = await fetch(`${API_BASE}/api/analytics/trailing-inventory`);
          if (!response.ok) {
            throw new Error('Failed to load trailing inventory data');
          }
          const data = await response.json();
          setTrailingInventory(data.data || []);
        } catch (err: any) {
          console.error('[Trailing Inventory] Fetch error:', err);
          setTrailingInventory([]);
        } finally {
          setTrailingInventoryLoading(false);
        }
      };
      fetchTrailingInventory();
    }
  }, [viewMode]);

  // Fetch trailing inventory data
  useEffect(() => {
    const fetchTrailingInventory = async () => {
      try {
        setTrailingInventoryLoading(true);
        const response = await fetch(`${API_BASE}/api/analytics/trailing-inventory`);
        if (!response.ok) {
          throw new Error('Failed to load trailing inventory data');
        }
        const data = await response.json();
        setTrailingInventory(data.data || []);
      } catch (err: any) {
        console.error('[Trailing Inventory] Fetch error:', err);
        setTrailingInventory([]);
      } finally {
        setTrailingInventoryLoading(false);
      }
    };
    fetchTrailingInventory();
  }, []);

  const reportingExpensesMonthTotal = useMemo(
    () =>
      reportingExpensesAll.reduce((sum, r) => {
        if (!expenseInCalendarMonth(r.purchase_date ?? null, monthlySummaryYear, monthlySummaryMonth)) {
          return sum;
        }
        const c = typeof r.cost === 'number' ? r.cost : parseFloat(String(r.cost ?? 0));
        return sum + (Number.isFinite(c) ? c : 0);
      }, 0),
    [reportingExpensesAll, monthlySummaryYear, monthlySummaryMonth]
  );

  /** Selected month: sum of sales where sold_platform is Vinted, eBay, or Depop (matches platform rows above). */
  const monthlyCombinedPlatformSales = useMemo(
    () => vintedData.sales + ebayData.sales + depopData.sales,
    [vintedData.sales, ebayData.sales, depopData.sales]
  );

  const reportingExpensesAllTimeTotal = useMemo(
    () =>
      reportingExpensesAll.reduce((sum, r) => {
        const c = typeof r.cost === 'number' ? r.cost : parseFloat(String(r.cost ?? 0));
        return sum + (Number.isFinite(c) ? c : 0);
      }, 0),
    [reportingExpensesAll]
  );

  const totalProfit = useMemo(() => {
    // Use year-specific totals if available (matches Stock page calculation)
    if (yearSpecificTotals) {
      return yearSpecificTotals.profit;
    }
    // Fallback to monthly calculation
    if (monthlyProfit.length === 0) {
      return 0;
    }
    return monthlyProfit.reduce((sum, point) => {
      const totalSales = point.totalSales ?? 0;
      const totalPurchase = point.totalPurchase ?? 0;
      return sum + (totalSales - totalPurchase);
    }, 0);
  }, [monthlyProfit, yearSpecificTotals]);

  /** Stock net (sales − inventory purchases) minus all rows in the expenses table — Sales Data / all-time scope only. */
  const allTimeCompanyProfit = useMemo(
    () => totalProfit - reportingExpensesAllTimeTotal,
    [totalProfit, reportingExpensesAllTimeTotal]
  );

  const salesByCategoryData = useMemo(() => {
    if (salesByCategory.length === 0) {
      return null;
    }

    const labels = salesByCategory.map((item) => item.category);
    const values = salesByCategory.map((item) => item.totalSales);

    const colorPalette = [
      { bg: 'rgba(255, 214, 91, 0.6)', border: 'rgba(255, 214, 91, 0.9)' },
      { bg: 'rgba(140, 255, 195, 0.6)', border: 'rgba(140, 255, 195, 0.9)' },
      { bg: 'rgba(255, 120, 120, 0.6)', border: 'rgba(255, 120, 120, 0.9)' },
      { bg: 'rgba(140, 195, 255, 0.6)', border: 'rgba(140, 195, 255, 0.9)' },
      { bg: 'rgba(255, 195, 140, 0.6)', border: 'rgba(255, 195, 140, 0.9)' },
      { bg: 'rgba(195, 140, 255, 0.6)', border: 'rgba(195, 140, 255, 0.9)' },
      { bg: 'rgba(255, 214, 140, 0.6)', border: 'rgba(255, 214, 140, 0.9)' },
      { bg: 'rgba(140, 255, 255, 0.6)', border: 'rgba(140, 255, 255, 0.9)' },
      { bg: 'rgba(255, 140, 195, 0.6)', border: 'rgba(255, 140, 195, 0.9)' },
      { bg: 'rgba(195, 255, 140, 0.6)', border: 'rgba(195, 255, 140, 0.9)' }
    ];

    const backgroundColor = labels.map((_, index) => colorPalette[index % colorPalette.length].bg);
    const borderColor = labels.map((_, index) => colorPalette[index % colorPalette.length].border);

    return {
      labels,
      datasets: [
        {
          label: 'Sales by Category',
          data: values,
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  }, [salesByCategory]);

  const salesByBrandData = useMemo(() => {
    if (salesByBrand.length === 0) {
      return null;
    }

    const labels = salesByBrand.map((item) => item.brand);
    const values = salesByBrand.map((item) => item.totalSales);

    const colorPalette = [
      { bg: 'rgba(255, 214, 91, 0.6)', border: 'rgba(255, 214, 91, 0.9)' },
      { bg: 'rgba(140, 255, 195, 0.6)', border: 'rgba(140, 255, 195, 0.9)' },
      { bg: 'rgba(255, 120, 120, 0.6)', border: 'rgba(255, 120, 120, 0.9)' },
      { bg: 'rgba(140, 195, 255, 0.6)', border: 'rgba(140, 195, 255, 0.9)' },
      { bg: 'rgba(255, 195, 140, 0.6)', border: 'rgba(255, 195, 140, 0.9)' },
      { bg: 'rgba(195, 140, 255, 0.6)', border: 'rgba(195, 140, 255, 0.9)' },
      { bg: 'rgba(255, 214, 140, 0.6)', border: 'rgba(255, 214, 140, 0.9)' },
      { bg: 'rgba(140, 255, 255, 0.6)', border: 'rgba(140, 255, 255, 0.9)' },
      { bg: 'rgba(255, 140, 195, 0.6)', border: 'rgba(255, 140, 195, 0.9)' },
      { bg: 'rgba(195, 255, 140, 0.6)', border: 'rgba(195, 255, 140, 0.9)' },
      { bg: 'rgba(255, 180, 120, 0.6)', border: 'rgba(255, 180, 120, 0.9)' },
      { bg: 'rgba(120, 255, 180, 0.6)', border: 'rgba(120, 255, 180, 0.9)' },
      { bg: 'rgba(180, 120, 255, 0.6)', border: 'rgba(180, 120, 255, 0.9)' },
      { bg: 'rgba(255, 120, 180, 0.6)', border: 'rgba(255, 120, 180, 0.9)' },
      { bg: 'rgba(120, 180, 255, 0.6)', border: 'rgba(120, 180, 255, 0.9)' }
    ];

    const backgroundColor = labels.map((_, index) => colorPalette[index % colorPalette.length].bg);
    const borderColor = labels.map((_, index) => colorPalette[index % colorPalette.length].border);

    return {
      labels,
      datasets: [
        {
          label: 'Sales by Brand',
          data: values,
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  }, [salesByBrand]);

  const buildBrandSalesChart = (items: SalesByBrandDatum[] | null) => {
    if (!items || items.length === 0) {
      return null;
    }

    const labels = items.map((item) => item.brand);
    const values = items.map((item) => item.totalSales);
    const colorPalette = [
      { bg: 'rgba(255, 214, 91, 0.6)', border: 'rgba(255, 214, 91, 0.9)' },
      { bg: 'rgba(140, 255, 195, 0.6)', border: 'rgba(140, 255, 195, 0.9)' },
      { bg: 'rgba(255, 120, 120, 0.6)', border: 'rgba(255, 120, 120, 0.9)' },
      { bg: 'rgba(140, 195, 255, 0.6)', border: 'rgba(140, 195, 255, 0.9)' },
      { bg: 'rgba(255, 195, 140, 0.6)', border: 'rgba(255, 195, 140, 0.9)' }
    ];
    const backgroundColor = labels.map((_, index) => colorPalette[index % colorPalette.length].bg);
    const borderColor = labels.map((_, index) => colorPalette[index % colorPalette.length].border);

    return {
      labels,
      datasets: [
        {
          label: 'Sales by Brand',
          data: values,
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  };

  const trousersBrandSalesData = useMemo(() => buildBrandSalesChart(bestSellingBrandsByCategory.trousers), [bestSellingBrandsByCategory]);
  const shirtBrandSalesData = useMemo(() => buildBrandSalesChart(bestSellingBrandsByCategory.shirt), [bestSellingBrandsByCategory]);
  const topBrandSalesData = useMemo(() => buildBrandSalesChart(bestSellingBrandsByCategory.top), [bestSellingBrandsByCategory]);
  const coatBrandSalesData = useMemo(() => buildBrandSalesChart(bestSellingBrandsByCategory.coat), [bestSellingBrandsByCategory]);
  const jacketBrandSalesData = useMemo(() => buildBrandSalesChart(bestSellingBrandsByCategory.jacket), [bestSellingBrandsByCategory]);

  const worstSellingBrandsData = useMemo(() => {
    if (worstSellingBrands.length === 0) {
      return null;
    }

    const labels = worstSellingBrands.map((item) => item.brand);
    const values = worstSellingBrands.map((item) => item.itemCount);

    const colorPalette = [
      { bg: 'rgba(255, 214, 91, 0.6)', border: 'rgba(255, 214, 91, 0.9)' },
      { bg: 'rgba(140, 255, 195, 0.6)', border: 'rgba(140, 255, 195, 0.9)' },
      { bg: 'rgba(255, 120, 120, 0.6)', border: 'rgba(255, 120, 120, 0.9)' },
      { bg: 'rgba(140, 195, 255, 0.6)', border: 'rgba(140, 195, 255, 0.9)' },
      { bg: 'rgba(255, 195, 140, 0.6)', border: 'rgba(255, 195, 140, 0.9)' },
      { bg: 'rgba(195, 140, 255, 0.6)', border: 'rgba(195, 140, 255, 0.9)' },
      { bg: 'rgba(255, 214, 140, 0.6)', border: 'rgba(255, 214, 140, 0.9)' },
      { bg: 'rgba(140, 255, 255, 0.6)', border: 'rgba(140, 255, 255, 0.9)' },
      { bg: 'rgba(255, 140, 195, 0.6)', border: 'rgba(255, 140, 195, 0.9)' },
      { bg: 'rgba(195, 255, 140, 0.6)', border: 'rgba(195, 255, 140, 0.9)' },
      { bg: 'rgba(255, 180, 120, 0.6)', border: 'rgba(255, 180, 120, 0.9)' },
      { bg: 'rgba(120, 255, 180, 0.6)', border: 'rgba(120, 255, 180, 0.9)' },
      { bg: 'rgba(180, 120, 255, 0.6)', border: 'rgba(180, 120, 255, 0.9)' },
      { bg: 'rgba(255, 120, 180, 0.6)', border: 'rgba(255, 120, 180, 0.9)' },
      { bg: 'rgba(120, 180, 255, 0.6)', border: 'rgba(120, 180, 255, 0.9)' }
    ];

    const backgroundColor = labels.map((_, index) => colorPalette[index % colorPalette.length].bg);
    const borderColor = labels.map((_, index) => colorPalette[index % colorPalette.length].border);

    return {
      labels,
      datasets: [
        {
          label: 'Unsold Items by Brand',
          data: values,
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  }, [worstSellingBrands]);

  const bestSellThroughBrandsData = useMemo(() => {
    if (bestSellThroughBrands.length === 0) {
      return null;
    }

    const labels = bestSellThroughBrands.map((item) => item.brand);
    const values = bestSellThroughBrands.map((item) => item.sellThroughRate);

    const colorPalette = [
      { bg: 'rgba(140, 255, 195, 0.6)', border: 'rgba(140, 255, 195, 0.9)' },
      { bg: 'rgba(255, 214, 91, 0.6)', border: 'rgba(255, 214, 91, 0.9)' },
      { bg: 'rgba(140, 195, 255, 0.6)', border: 'rgba(140, 195, 255, 0.9)' },
      { bg: 'rgba(195, 255, 140, 0.6)', border: 'rgba(195, 255, 140, 0.9)' },
      { bg: 'rgba(255, 195, 140, 0.6)', border: 'rgba(255, 195, 140, 0.9)' }
    ];

    const backgroundColor = labels.map((_, index) => colorPalette[index % colorPalette.length].bg);
    const borderColor = labels.map((_, index) => colorPalette[index % colorPalette.length].border);

    return {
      labels,
      datasets: [
        {
          label: 'Sell-Through Rate by Brand',
          data: values,
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [bestSellThroughBrands]);

  const worstSellThroughBrandsData = useMemo(() => {
    if (worstSellThroughBrands.length === 0) {
      return null;
    }

    const labels = worstSellThroughBrands.map((item) => item.brand);
    const values = worstSellThroughBrands.map((item) => item.sellThroughRate);

    const colorPalette = [
      { bg: 'rgba(255, 120, 120, 0.6)', border: 'rgba(255, 120, 120, 0.9)' },
      { bg: 'rgba(255, 180, 120, 0.6)', border: 'rgba(255, 180, 120, 0.9)' },
      { bg: 'rgba(195, 140, 255, 0.6)', border: 'rgba(195, 140, 255, 0.9)' },
      { bg: 'rgba(255, 140, 195, 0.6)', border: 'rgba(255, 140, 195, 0.9)' },
      { bg: 'rgba(120, 180, 255, 0.6)', border: 'rgba(120, 180, 255, 0.9)' }
    ];

    const backgroundColor = labels.map((_, index) => colorPalette[index % colorPalette.length].bg);
    const borderColor = labels.map((_, index) => colorPalette[index % colorPalette.length].border);

    return {
      labels,
      datasets: [
        {
          label: 'Sell-Through Rate by Brand',
          data: values,
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [worstSellThroughBrands]);


  const unsoldStockByCategoryData = useMemo(() => {
    if (unsoldStockByCategory.length === 0) {
      return null;
    }

    const labels = unsoldStockByCategory.map((item) => item.category);
    const values = unsoldStockByCategory.map((item) => item.totalValue);

    const colorPalette = [
      { bg: 'rgba(255, 214, 91, 0.6)', border: 'rgba(255, 214, 91, 0.9)' },
      { bg: 'rgba(140, 255, 195, 0.6)', border: 'rgba(140, 255, 195, 0.9)' },
      { bg: 'rgba(255, 120, 120, 0.6)', border: 'rgba(255, 120, 120, 0.9)' },
      { bg: 'rgba(140, 195, 255, 0.6)', border: 'rgba(140, 195, 255, 0.9)' },
      { bg: 'rgba(255, 195, 140, 0.6)', border: 'rgba(255, 195, 140, 0.9)' },
      { bg: 'rgba(195, 140, 255, 0.6)', border: 'rgba(195, 140, 255, 0.9)' },
      { bg: 'rgba(255, 214, 140, 0.6)', border: 'rgba(255, 214, 140, 0.9)' },
      { bg: 'rgba(140, 255, 255, 0.6)', border: 'rgba(140, 255, 255, 0.9)' },
      { bg: 'rgba(255, 140, 195, 0.6)', border: 'rgba(255, 140, 195, 0.9)' },
      { bg: 'rgba(195, 255, 140, 0.6)', border: 'rgba(195, 255, 140, 0.9)' }
    ];

    const backgroundColor = labels.map((_, index) => colorPalette[index % colorPalette.length].bg);
    const borderColor = labels.map((_, index) => colorPalette[index % colorPalette.length].border);

    return {
      labels,
      datasets: [
        {
          label: 'Unsold Stock Value by Category',
          data: values,
          backgroundColor,
          borderColor,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  }, [unsoldStockByCategory]);

  /** Prefer API field; if missing (old server), derive sold counts from stock rows + categories. */
  const soldCountForInventoryStack = useMemo((): SoldCountByCategoryDatum[] => {
    if (soldCountByCategory.length > 0) {
      return soldCountByCategory;
    }
    if (reportingCategoryRows.length === 0 || stockRowsForSalesData.length === 0) {
      return [];
    }
    const idToName = new Map(reportingCategoryRows.map((c) => [c.id, c.category_name]));
    const yearAll = selectedYear === 'all';
    const y = yearAll ? null : Number(selectedYear);
    const counts = new Map<string, number>();
    for (const row of stockRowsForSalesData) {
      if (row.sale_date == null || String(row.sale_date).trim() === '') continue;
      const d = new Date(row.sale_date);
      if (Number.isNaN(d.getTime())) continue;
      if (!yearAll && (y == null || !Number.isFinite(y) || d.getFullYear() !== y)) continue;
      const raw = row.category_id;
      const cid = raw != null && raw !== '' ? Number(raw) : NaN;
      const name =
        Number.isFinite(cid) && idToName.has(cid) ? idToName.get(cid)! : 'Uncategorized';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([category, soldCount]) => ({ category, soldCount }));
  }, [soldCountByCategory, reportingCategoryRows, stockRowsForSalesData, selectedYear]);

  /** Map category → sum(sale − buy) on sold lines in reporting period; API first, else derive from stock rows. */
  const soldPnlForInventoryStack = useMemo(() => {
    const m = new Map<string, number>();
    if (soldCategoryNetProfit.length > 0) {
      soldCategoryNetProfit.forEach((r) => m.set(r.category, r.netProfit));
      return m;
    }
    if (reportingCategoryRows.length === 0 || stockRowsForSalesData.length === 0) {
      return m;
    }
    const idToName = new Map(reportingCategoryRows.map((c) => [c.id, c.category_name]));
    const yearAll = selectedYear === 'all';
    const y = yearAll ? null : Number(selectedYear);
    for (const row of stockRowsForSalesData) {
      if (row.sale_date == null || String(row.sale_date).trim() === '') continue;
      const d = new Date(row.sale_date);
      if (Number.isNaN(d.getTime())) continue;
      if (!yearAll && (y == null || !Number.isFinite(y) || d.getFullYear() !== y)) continue;
      const sale = parseStockNumber(row.sale_price);
      if (sale == null || sale <= 0) continue;
      const buy = parseStockNumber(row.purchase_price) ?? 0;
      const raw = row.category_id;
      const cid = raw != null && raw !== '' ? Number(raw) : NaN;
      const name =
        Number.isFinite(cid) && idToName.has(cid) ? idToName.get(cid)! : 'Uncategorized';
      m.set(name, (m.get(name) ?? 0) + (sale - buy));
    }
    return m;
  }, [soldCategoryNetProfit, reportingCategoryRows, stockRowsForSalesData, selectedYear]);

  const stockAnalysisCategoryStackBundle = useMemo(() => {
    const unsoldMapCount = new Map(unsoldStockByCategory.map((u) => [u.category, u.itemCount]));
    const unsoldMapValue = new Map(unsoldStockByCategory.map((u) => [u.category, u.totalValue]));
    const soldMap = new Map(soldCountForInventoryStack.map((s) => [s.category, s.soldCount]));
    const categories = new Set<string>([
      ...Array.from(unsoldMapCount.keys()),
      ...Array.from(soldMap.keys()),
    ]);
    const rows: CategoryInventorySoldStackRow[] = Array.from(categories)
      .map((category) => {
        const sold = soldMap.get(category) ?? 0;
        return {
          category,
          inStock: unsoldMapCount.get(category) ?? 0,
          sold,
          unsoldBuyInValue: unsoldMapValue.get(category) ?? 0,
          soldNetProfit:
            sold > 0 && soldPnlForInventoryStack.has(category)
              ? soldPnlForInventoryStack.get(category)!
              : null,
        };
      })
      .filter((r) => r.inStock + r.sold > 0)
      .sort((a, b) => {
        if (b.inStock !== a.inStock) return b.inStock - a.inStock;
        if (b.sold !== a.sold) return b.sold - a.sold;
        return a.category.localeCompare(b.category, undefined, { sensitivity: 'base' });
      });
    if (rows.length === 0) return null;
    const labelMax = 36;
    const labels = rows.map((r) => {
      let l = r.category;
      if (l.length > labelMax) l = `${l.slice(0, labelMax - 1)}…`;
      return l;
    });
    const data = {
      labels,
      datasets: [
        {
          label: 'In stock',
          data: rows.map((r) => r.inStock),
          backgroundColor: 'rgba(255, 165, 120, 0.72)',
          borderColor: 'rgba(255, 214, 91, 0.45)',
          borderWidth: 1,
          stack: 'cat',
        },
        {
          label: 'Sold',
          data: rows.map((r) => r.sold),
          backgroundColor: 'rgba(130, 210, 155, 0.78)',
          borderColor: 'rgba(255, 214, 91, 0.45)',
          borderWidth: 1,
          stack: 'cat',
        },
      ],
    };
    return { data, rows };
  }, [unsoldStockByCategory, soldCountForInventoryStack, soldPnlForInventoryStack]);

  const stockAnalysisCategoryInventorySoldStackData = stockAnalysisCategoryStackBundle?.data ?? null;
  const stockAnalysisCategoryInventorySoldStackRows =
    stockAnalysisCategoryStackBundle?.rows ?? EMPTY_CATEGORY_STACK_ROWS;

  const stockAnalysisCategoryInventorySoldStackOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
        axis: 'y',
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: 'rgba(255, 248, 226, 0.85)',
            boxWidth: 12,
            boxHeight: 12,
            padding: 16,
          },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          axis: 'y',
          callbacks: {
            title(items) {
              if (!items.length) return '';
              const chart = items[0].chart;
              const i = items[0].dataIndex;
              const lab = chart.data.labels;
              const raw = lab != null && i >= 0 && i < lab.length ? lab[i] : '';
              return typeof raw === 'string' ? raw : String(raw ?? '');
            },
            label(ctx) {
              const n = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
              const label = ctx.dataset.label ?? '';
              return `${label}: ${n} item${n === 1 ? '' : 's'}`;
            },
            footer(items) {
              if (!items.length) return '';
              const i = items[0].dataIndex;
              const chart = items[0].chart;
              const sum = chart.data.datasets.reduce(
                (acc, d) => acc + Number(Array.isArray(d.data) ? d.data[i] : 0),
                0
              );
              const row = stockAnalysisCategoryInventorySoldStackRows[i];
              const parts = [`Total: ${sum} item${sum === 1 ? '' : 's'}`];
              if (row) {
                if (row.unsoldBuyInValue > 0) {
                  parts.push(`Inventory buy-in: ${formatCurrency(row.unsoldBuyInValue)}`);
                }
                if (row.sold > 0) {
                  if (row.soldNetProfit != null && Number.isFinite(row.soldNetProfit)) {
                    parts.push(
                      row.soldNetProfit >= 0
                        ? `Sold P/L: ${formatCurrency(row.soldNetProfit)} profit`
                        : `Sold P/L: ${formatCurrency(Math.abs(row.soldNetProfit))} loss`
                    );
                  } else {
                    parts.push('Sold P/L: —');
                  }
                }
              }
              return parts.join('\n');
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          title: {
            display: true,
            text: 'Number of items',
            color: 'rgba(255, 248, 226, 0.65)',
            font: { size: 12 },
          },
          ticks: {
            color: 'rgba(255, 248, 226, 0.8)',
            precision: 0,
          },
          grid: { color: 'rgba(255, 214, 91, 0.1)' },
        },
        y: {
          stacked: true,
          ticks: {
            color: 'rgba(255, 248, 226, 0.88)',
            font: { size: 11 },
          },
          grid: { display: false },
        },
      },
    }),
    [stockAnalysisCategoryInventorySoldStackRows]
  );

  const handleCopyStockCategoryAskAiPrompt = useCallback(async () => {
    if (stockAnalysisCategoryInventorySoldStackRows.length === 0) return;
    const periodLabel =
      selectedYear === 'all'
        ? 'All time (same scope as Reporting → Stock analysis year selector)'
        : `Calendar year ${selectedYear} (sale date for sold metrics; purchase date year for unsold inventory value where applicable)`;
    const text = buildStockAnalysisCategoryAskAiPrompt({
      periodLabel,
      rows: stockAnalysisCategoryInventorySoldStackRows,
      yearItemsStats,
    });
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.warn('Ask AI clipboard copy failed:', e);
    }
  }, [stockAnalysisCategoryInventorySoldStackRows, selectedYear, yearItemsStats]);

  // Line chart options for trailing inventory
  const lineChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label(context) {
            const value = context.raw as number;
            return formatCurrency(value || 0);
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(255, 214, 91, 0.08)' },
        ticks: { color: 'rgba(255, 248, 226, 0.8)' },
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(255, 214, 91, 0.12)' },
        ticks: {
          color: 'rgba(255, 248, 226, 0.75)',
          callback(value) {
            if (typeof value === 'number') {
              return formatCurrency(value);
            }
            return value;
          },
        },
      },
    },
  };

  // Trailing inventory line chart data
  const trailingInventoryChartData = useMemo(() => {
    if (trailingInventory.length === 0) {
      return null;
    }

    const labels = trailingInventory.map((item) => item.label);
    const values = trailingInventory.map((item) => item.inventoryCost);

    return {
      labels,
      datasets: [
        {
          label: 'Inventory Value',
          data: values,
          borderColor: 'rgba(255, 214, 91, 0.9)',
          backgroundColor: 'rgba(255, 214, 91, 0.1)',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: 'rgba(255, 214, 91, 0.9)',
          pointBorderColor: 'rgba(255, 214, 91, 1)',
          pointHoverRadius: 6,
          tension: 0.4,
          fill: true,
        },
      ],
    };
  }, [trailingInventory]);

  const previousDataYear = useMemo(() => {
    if (!availableYears.length) {
      return null;
    }
    const currentYear = now.getFullYear();
    const priorYears = availableYears.filter((year) => year < currentYear).sort((a, b) => b - a);
    if (priorYears.length > 0) {
      return priorYears[0];
    }
    const sortedYears = [...availableYears].sort((a, b) => b - a);
    return sortedYears.length > 1 ? sortedYears[1] : null;
  }, [availableYears, now]);

  const isDateInSalesRange = useMemo(() => {
    return (dateValue: string | null | undefined): boolean => {
      if (!dateValue) {
        return false;
      }
      const date = new Date(dateValue);
      if (Number.isNaN(date.getTime())) {
        return false;
      }

      if (salesDateFilter === 'all-time') {
        return true;
      }

      if (salesDateFilter === 'last-30-days') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 29);
        return date >= start && date <= now;
      }

      if (salesDateFilter === 'last-3-months') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setMonth(start.getMonth() - 3);
        return date >= start && date <= now;
      }

      if (salesDateFilter === 'current-year') {
        return date.getFullYear() === now.getFullYear();
      }

      if (salesDateFilter === 'previous-year') {
        return previousDataYear !== null && date.getFullYear() === previousDataYear;
      }

      return true;
    };
  }, [salesDateFilter, now, previousDataYear]);

  const chartYearForBuckets = viewMode === 'sales-data' ? 'all' : selectedYear;

  const monthlyChartBuckets = useMemo(() => {
    if (chartYearForBuckets === 'all') {
      const base = new Date(now.getFullYear(), now.getMonth(), 1);
      const buckets: Array<{ key: string; label: string }> = [];
      // Oldest month on the left, current month on the right (chronological x-axis).
      for (let offset = 11; offset >= 0; offset -= 1) {
        const d = new Date(base);
        d.setMonth(base.getMonth() - offset);
        buckets.push({
          key: `${d.getFullYear()}-${d.getMonth() + 1}`,
          label: `${monthLabels[d.getMonth()]} ${d.getFullYear()}`
        });
      }
      return buckets;
    }

    const year = Number(chartYearForBuckets);
    return monthLabels.map((label, monthIndex) => ({
      key: `${year}-${monthIndex + 1}`,
      label
    }));
  }, [chartYearForBuckets, now]);

  const salesTimelineChartData = useMemo(() => {
    if (!stockRowsForSalesData.length) {
      return null;
    }

    const valuesByBucket = monthlyChartBuckets.map(() => ({ sales: 0, purchase: 0 }));
    const bucketIndexByKey = new Map(monthlyChartBuckets.map((bucket, index) => [bucket.key, index]));
    const toNumber = (value: number | string | null | undefined) => {
      const num = Number(value ?? 0);
      return Number.isFinite(num) ? num : 0;
    };

    stockRowsForSalesData.forEach((row) => {
      if (isDateInSalesRange(row.purchase_date)) {
        const d = new Date(row.purchase_date as string);
        if (!Number.isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
          const bucketIndex = bucketIndexByKey.get(key);
          if (bucketIndex !== undefined) {
            valuesByBucket[bucketIndex].purchase += toNumber(row.purchase_price);
          }
        }
      }

      if (isDateInSalesRange(row.sale_date)) {
        const d = new Date(row.sale_date as string);
        if (!Number.isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
          const bucketIndex = bucketIndexByKey.get(key);
          if (bucketIndex !== undefined) {
            valuesByBucket[bucketIndex].sales += toNumber(row.sale_price);
          }
        }
      }
    });

    const labelsFull = monthlyChartBuckets.map((bucket) => bucket.label);
    const valuesFull = valuesByBucket.map((point) => point.sales - point.purchase);
    if (!valuesFull.some((value) => value !== 0)) {
      return null;
    }

    const t = monthlyChartLeadingTrimIndex(valuesFull.length, (i) => valuesFull[i] !== 0);
    const values = valuesFull.slice(t);
    const labels = labelsFull.slice(t);

    return {
      labels,
      datasets: [
        {
          label: 'Profit',
          data: values,
          backgroundColor: values.map((value) =>
            value >= 0 ? 'rgba(255, 214, 91, 0.6)' : 'rgba(255, 120, 120, 0.6)'
          ),
          borderColor: values.map((value) =>
            value >= 0 ? 'rgba(255, 214, 91, 0.9)' : 'rgba(255, 120, 120, 0.85)'
          ),
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [stockRowsForSalesData, isDateInSalesRange, monthlyChartBuckets]);

  const salesMonthlySalesData = useMemo(() => {
    const values = Array(monthlyChartBuckets.length).fill(0);
    const bucketIndexByKey = new Map(monthlyChartBuckets.map((bucket, index) => [bucket.key, index]));
    stockRowsForSalesData.forEach((row) => {
      if (isDateInSalesRange(row.sale_date)) {
        const d = new Date(row.sale_date as string);
        if (!Number.isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
          const bucketIndex = bucketIndexByKey.get(key);
          if (bucketIndex !== undefined) {
            values[bucketIndex] += Number(row.sale_price ?? 0) || 0;
          }
        }
      }
    });
    const t = monthlyChartLeadingTrimIndex(values.length, (i) => values[i] !== 0);
    const valuesS = values.slice(t);
    return {
      data: {
        labels: monthlyChartBuckets.map((bucket) => bucket.label).slice(t),
        datasets: [
          {
            label: 'Monthly Sales',
            data: valuesS,
            backgroundColor: valuesS.map((value) =>
              value >= 0 ? 'rgba(140, 255, 195, 0.5)' : 'rgba(255, 120, 120, 0.45)'
            ),
            borderColor: valuesS.map((value) =>
              value >= 0 ? 'rgba(140, 255, 195, 0.85)' : 'rgba(255, 120, 120, 0.8)'
            ),
            borderWidth: 1,
            borderRadius: 6
          }
        ]
      },
      hasData: values.some((value) => value !== 0)
    };
  }, [stockRowsForSalesData, isDateInSalesRange, monthlyChartBuckets]);

  /** Monthly sale revenue by platform (sale_date month); side-by-side bars. */
  const salesMonthlySalesPlatformData = useMemo(() => {
    const ebayValues: number[] = Array(monthlyChartBuckets.length).fill(0);
    const vintedValues: number[] = Array(monthlyChartBuckets.length).fill(0);
    const bucketIndexByKey = new Map(monthlyChartBuckets.map((bucket, index) => [bucket.key, index]));
    const toSale = (row: (typeof stockRowsForSalesData)[0]) => {
      const n = Number(row.sale_price ?? 0);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };

    stockRowsForSalesData.forEach((row) => {
      if (!isDateInSalesRange(row.sale_date)) return;
      const amt = toSale(row);
      if (amt <= 0) return;
      const d = new Date(row.sale_date as string);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const bucketIndex = bucketIndexByKey.get(key);
      if (bucketIndex === undefined) return;
      if (soldPlatformIsEbay(row.sold_platform)) {
        ebayValues[bucketIndex] += amt;
      } else if (soldPlatformIsVinted(row.sold_platform)) {
        vintedValues[bucketIndex] += amt;
      }
    });

    const hasData = ebayValues.some((v) => v > 0) || vintedValues.some((v) => v > 0);
    const n = ebayValues.length;
    const t = monthlyChartLeadingTrimIndex(n, (i) => ebayValues[i] > 0 || vintedValues[i] > 0);
    return {
      data: {
        labels: monthlyChartBuckets.map((bucket) => bucket.label).slice(t),
        datasets: [
          {
            label: 'eBay',
            data: ebayValues.slice(t),
            backgroundColor: 'rgba(140, 195, 255, 0.55)',
            borderColor: 'rgba(140, 195, 255, 0.9)',
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            label: 'Vinted',
            data: vintedValues.slice(t),
            backgroundColor: 'rgba(180, 140, 255, 0.5)',
            borderColor: 'rgba(200, 170, 255, 0.9)',
            borderWidth: 1,
            borderRadius: 4,
          },
        ],
      },
      hasData,
    };
  }, [stockRowsForSalesData, isDateInSalesRange, monthlyChartBuckets]);

  const salesMonthlyPlatformBarOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      ...chartOptions,
      plugins: {
        ...chartOptions.plugins,
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: 'rgba(255, 248, 226, 0.88)',
            boxWidth: 12,
            boxHeight: 12,
            padding: 14,
            font: { size: 12 },
          },
        },
        tooltip: {
          ...chartOptions.plugins?.tooltip,
          callbacks: {
            ...chartOptions.plugins?.tooltip?.callbacks,
            label(context) {
              const value = context.raw as number;
              const label = context.dataset.label ?? '';
              return `${label}: ${formatCurrency(value || 0)}`;
            },
          },
        },
      },
      scales: {
        ...chartOptions.scales,
        x: {
          ...chartOptions.scales?.x,
          title: {
            display: true,
            text: 'Sale month',
            color: 'rgba(255, 248, 226, 0.55)',
            font: { size: 12 },
          },
        },
        y: {
          ...chartOptions.scales?.y,
          title: {
            display: true,
            text: 'Sales (£)',
            color: 'rgba(255, 248, 226, 0.55)',
            font: { size: 12 },
          },
        },
      },
    }),
    []
  );

  const salesMonthlyExpensesData = useMemo(() => {
    const values = Array(monthlyChartBuckets.length).fill(0);
    const bucketIndexByKey = new Map(monthlyChartBuckets.map((bucket, index) => [bucket.key, index]));
    stockRowsForSalesData.forEach((row) => {
      if (isDateInSalesRange(row.purchase_date)) {
        const d = new Date(row.purchase_date as string);
        if (!Number.isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
          const bucketIndex = bucketIndexByKey.get(key);
          if (bucketIndex !== undefined) {
            values[bucketIndex] += Number(row.purchase_price ?? 0) || 0;
          }
        }
      }
    });
    const t = monthlyChartLeadingTrimIndex(values.length, (i) => values[i] !== 0);
    const valuesS = values.slice(t);
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label).slice(t),
      datasets: [
        {
          label: 'Monthly Expenses',
          data: valuesS,
          backgroundColor: 'rgba(255, 120, 120, 0.45)',
          borderColor: 'rgba(255, 120, 120, 0.8)',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [stockRowsForSalesData, isDateInSalesRange, monthlyChartBuckets]);

  const salesMonthlyAverageSellingPriceData = useMemo(() => {
    const sums = Array(monthlyChartBuckets.length).fill(0);
    const counts = Array(monthlyChartBuckets.length).fill(0);
    const bucketIndexByKey = new Map(monthlyChartBuckets.map((bucket, index) => [bucket.key, index]));
    stockRowsForSalesData.forEach((row) => {
      if (isDateInSalesRange(row.sale_date)) {
        const d = new Date(row.sale_date as string);
        const value = Number(row.sale_price ?? 0);
        if (!Number.isNaN(d.getTime()) && Number.isFinite(value) && value > 0) {
          const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
          const bucketIndex = bucketIndexByKey.get(key);
          if (bucketIndex !== undefined) {
            sums[bucketIndex] += value;
            counts[bucketIndex] += 1;
          }
        }
      }
    });
    const values = sums.map((sum, idx) => (counts[idx] > 0 ? sum / counts[idx] : 0));
    const t = monthlyChartLeadingTrimIndex(counts.length, (i) => counts[i] > 0);
    const valuesS = values.slice(t);
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label).slice(t),
      datasets: [
        {
          label: 'Average Selling Price',
          data: valuesS,
          backgroundColor: 'rgba(140, 255, 195, 0.45)',
          borderColor: 'rgba(140, 255, 195, 0.8)',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [stockRowsForSalesData, isDateInSalesRange, monthlyChartBuckets]);

  const salesMonthlyAverageProfitPerItemData = useMemo(() => {
    const sums = Array(monthlyChartBuckets.length).fill(0);
    const counts = Array(monthlyChartBuckets.length).fill(0);
    const bucketIndexByKey = new Map(monthlyChartBuckets.map((bucket, index) => [bucket.key, index]));
    stockRowsForSalesData.forEach((row) => {
      if (isDateInSalesRange(row.sale_date)) {
        const d = new Date(row.sale_date as string);
        const sale = Number(row.sale_price ?? 0);
        const purchase = Number(row.purchase_price ?? 0);
        if (!Number.isNaN(d.getTime()) && Number.isFinite(sale) && Number.isFinite(purchase) && sale > 0) {
          const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
          const bucketIndex = bucketIndexByKey.get(key);
          if (bucketIndex !== undefined) {
            sums[bucketIndex] += (sale - purchase);
            counts[bucketIndex] += 1;
          }
        }
      }
    });
    const values = sums.map((sum, idx) => (counts[idx] > 0 ? sum / counts[idx] : 0));
    const t = monthlyChartLeadingTrimIndex(counts.length, (i) => counts[i] > 0);
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label).slice(t),
      datasets: [
        {
          label: 'Average Profit per Item',
          data: values.slice(t),
          backgroundColor: (context: any) => {
            const value = context.parsed.y;
            return value >= 0 ? 'rgba(140, 255, 195, 0.45)' : 'rgba(255, 120, 120, 0.45)';
          },
          borderColor: (context: any) => {
            const value = context.parsed.y;
            return value >= 0 ? 'rgba(140, 255, 195, 0.8)' : 'rgba(255, 120, 120, 0.8)';
          },
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [stockRowsForSalesData, isDateInSalesRange, monthlyChartBuckets]);

  const salesMonthlyAverageProfitMultipleData = useMemo(() => {
    const sums = Array(monthlyChartBuckets.length).fill(0);
    const counts = Array(monthlyChartBuckets.length).fill(0);
    const bucketIndexByKey = new Map(monthlyChartBuckets.map((bucket, index) => [bucket.key, index]));
    stockRowsForSalesData.forEach((row) => {
      if (isDateInSalesRange(row.sale_date)) {
        const d = new Date(row.sale_date as string);
        const sale = Number(row.sale_price ?? 0);
        const purchase = Number(row.purchase_price ?? 0);
        if (!Number.isNaN(d.getTime()) && Number.isFinite(sale) && Number.isFinite(purchase) && purchase > 0 && sale > 0) {
          const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
          const bucketIndex = bucketIndexByKey.get(key);
          if (bucketIndex !== undefined) {
            sums[bucketIndex] += (sale / purchase);
            counts[bucketIndex] += 1;
          }
        }
      }
    });
    const values = sums.map((sum, idx) => (counts[idx] > 0 ? sum / counts[idx] : 0));
    const t = monthlyChartLeadingTrimIndex(counts.length, (i) => counts[i] > 0);
    const valuesS = values.slice(t);
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label).slice(t),
      datasets: [
        {
          label: 'Average Profit Multiple',
          data: valuesS,
          backgroundColor: 'rgba(255, 214, 91, 0.45)',
          borderColor: 'rgba(255, 214, 91, 0.8)',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [stockRowsForSalesData, isDateInSalesRange, monthlyChartBuckets]);

  const salesItemsListedByMonthData = useMemo(() => {
    const values = Array(monthlyChartBuckets.length).fill(0);
    const bucketIndexByKey = new Map(monthlyChartBuckets.map((bucket, index) => [bucket.key, index]));
    stockRowsForSalesData.forEach((row) => {
      if (isDateInSalesRange(row.purchase_date)) {
        const d = new Date(row.purchase_date as string);
        if (!Number.isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
          const bucketIndex = bucketIndexByKey.get(key);
          if (bucketIndex !== undefined) {
            values[bucketIndex] += 1;
          }
        }
      }
    });
    const t = monthlyChartLeadingTrimIndex(values.length, (i) => values[i] > 0);
    const valuesS = values.slice(t);
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label).slice(t),
      datasets: [
        {
          label: 'Items Listed',
          data: valuesS,
          backgroundColor: 'rgba(140, 195, 255, 0.5)',
          borderColor: 'rgba(140, 195, 255, 0.85)',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [stockRowsForSalesData, isDateInSalesRange, monthlyChartBuckets]);

  const salesItemsSoldByMonthData = useMemo(() => {
    const values = Array(monthlyChartBuckets.length).fill(0);
    const bucketIndexByKey = new Map(monthlyChartBuckets.map((bucket, index) => [bucket.key, index]));
    stockRowsForSalesData.forEach((row) => {
      if (isDateInSalesRange(row.sale_date)) {
        const d = new Date(row.sale_date as string);
        if (!Number.isNaN(d.getTime())) {
          const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
          const bucketIndex = bucketIndexByKey.get(key);
          if (bucketIndex !== undefined) {
            values[bucketIndex] += 1;
          }
        }
      }
    });
    const t = monthlyChartLeadingTrimIndex(values.length, (i) => values[i] > 0);
    const valuesS = values.slice(t);
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label).slice(t),
      datasets: [
        {
          label: 'Items Sold',
          data: valuesS,
          backgroundColor: 'rgba(195, 255, 140, 0.5)',
          borderColor: 'rgba(195, 255, 140, 0.85)',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [stockRowsForSalesData, isDateInSalesRange, monthlyChartBuckets]);

  const itemAnalysisRange = useMemo(
    () => getItemAnalysisRange(itemAnalysisPreset, itemAnalysisCustomYear, itemAnalysisCustomMonth),
    [itemAnalysisPreset, itemAnalysisCustomYear, itemAnalysisCustomMonth]
  );

  const { itemAnalysisEbayItems, itemAnalysisVintedItems } = useMemo(() => {
    const { start, end } = itemAnalysisRange;
    const build = (platformMatch: (row: StockRowForSalesData) => boolean): ItemAnalysisSoldRow[] => {
      const out: ItemAnalysisSoldRow[] = [];
      stockRowsForSalesData.forEach((row, idx) => {
        if (!platformMatch(row)) return;
        if (!row.sale_date) return;
        const sd = new Date(row.sale_date);
        if (Number.isNaN(sd.getTime())) return;
        if (sd < start || sd > end) return;
        const purchase = parseStockNumber(row.purchase_price);
        const sale = parseStockNumber(row.sale_price);
        if (purchase === null || sale === null) return;
        const profit = sale - purchase;
        const multiplier = purchase > 0 ? sale / purchase : null;
        out.push({
          id: typeof row.id === 'number' ? row.id : idx,
          name: (row.item_name && row.item_name.trim()) || '—',
          purchase,
          sale,
          profit,
          multiplier,
        });
      });
      out.sort((a, b) => b.profit - a.profit);
      return out;
    };
    return {
      itemAnalysisEbayItems: build((row) => soldPlatformIsEbay(row.sold_platform)),
      itemAnalysisVintedItems: build((row) => soldPlatformIsVinted(row.sold_platform)),
    };
  }, [stockRowsForSalesData, itemAnalysisRange]);

  const ITEM_ANALYSIS_CHART_TOP = 15;
  const ITEM_ANALYSIS_WORST_CHART_TOP = 10;

  const itemAnalysisWorstEbayItems = useMemo(
    () => [...itemAnalysisEbayItems].sort((a, b) => a.profit - b.profit),
    [itemAnalysisEbayItems]
  );

  const itemAnalysisWorstVintedItems = useMemo(
    () => [...itemAnalysisVintedItems].sort((a, b) => a.profit - b.profit),
    [itemAnalysisVintedItems]
  );

  const itemAnalysisWorstEbayTop = useMemo(
    () => itemAnalysisWorstEbayItems.slice(0, ITEM_ANALYSIS_WORST_CHART_TOP),
    [itemAnalysisWorstEbayItems]
  );

  const itemAnalysisWorstVintedTop = useMemo(
    () => itemAnalysisWorstVintedItems.slice(0, ITEM_ANALYSIS_WORST_CHART_TOP),
    [itemAnalysisWorstVintedItems]
  );

  const itemAnalysisEbayChart = useMemo(() => {
    const top = itemAnalysisEbayItems.slice(0, ITEM_ANALYSIS_CHART_TOP);
    const labelsFull = top.map((t) => t.name);
    const labels = labelsFull.map((n) => (n.length > 40 ? `${n.slice(0, 38)}…` : n));
    return {
      labelsFull,
      chartData: {
        labels,
        datasets: [
          {
            label: 'Profit',
            data: top.map((t) => t.profit),
            backgroundColor: 'rgba(140, 180, 255, 0.55)',
            borderColor: 'rgba(140, 180, 255, 0.9)',
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
    };
  }, [itemAnalysisEbayItems]);

  const itemAnalysisVintedChart = useMemo(() => {
    const top = itemAnalysisVintedItems.slice(0, ITEM_ANALYSIS_CHART_TOP);
    const labelsFull = top.map((t) => t.name);
    const labels = labelsFull.map((n) => (n.length > 40 ? `${n.slice(0, 38)}…` : n));
    return {
      labelsFull,
      chartData: {
        labels,
        datasets: [
          {
            label: 'Profit',
            data: top.map((t) => t.profit),
            backgroundColor: 'rgba(195, 255, 140, 0.55)',
            borderColor: 'rgba(195, 255, 140, 0.9)',
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
    };
  }, [itemAnalysisVintedItems]);

  const itemAnalysisWorstEbayChart = useMemo(() => {
    const worst = itemAnalysisWorstEbayTop;
    const labelsFull = worst.map((t) => t.name);
    const labels = labelsFull.map((n) => (n.length > 40 ? `${n.slice(0, 38)}…` : n));
    return {
      labelsFull,
      chartData: {
        labels,
        datasets: [
          {
            label: 'Profit',
            data: worst.map((t) => t.profit),
            backgroundColor: 'rgba(255, 120, 100, 0.55)',
            borderColor: 'rgba(255, 120, 100, 0.95)',
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
    };
  }, [itemAnalysisWorstEbayTop]);

  const itemAnalysisWorstVintedChart = useMemo(() => {
    const worst = itemAnalysisWorstVintedTop;
    const labelsFull = worst.map((t) => t.name);
    const labels = labelsFull.map((n) => (n.length > 40 ? `${n.slice(0, 38)}…` : n));
    return {
      labelsFull,
      chartData: {
        labels,
        datasets: [
          {
            label: 'Profit',
            data: worst.map((t) => t.profit),
            backgroundColor: 'rgba(255, 160, 90, 0.5)',
            borderColor: 'rgba(255, 160, 90, 0.95)',
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
    };
  }, [itemAnalysisWorstVintedTop]);

  const itemAnalysisYearOptions = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 16 }, (_, i) => y - i);
  }, []);

  const setItemAnalysisPlatformTab = useCallback(
    (p: ItemAnalysisPlatformTab) => {
      setItemAnalysisPlatform(p);
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'item-analysis');
      next.set('platform', p);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  return (
    <div className="reporting-container">

      {error && <div className="reporting-error">{error}</div>}
      {loading && <div className="reporting-status">Loading analytics...</div>}

      {/* Toggle for Global/Monthly view */}
      <div className="view-toggle-container">
        <button
          className={`view-toggle-button ${viewMode === 'sales-data' ? 'active' : ''}`}
          onClick={() => setViewMode('sales-data')}
        >
          Sales Data
        </button>
        <button
          className={`view-toggle-button ${viewMode === 'stock-analysis' ? 'active' : ''}`}
          onClick={() => setViewMode('stock-analysis')}
        >
          Stock Analysis
        </button>
        <button
          className={`view-toggle-button ${viewMode === 'item-analysis' ? 'active' : ''}`}
          onClick={() => setViewMode('item-analysis')}
        >
          Item Analysis
        </button>
      </div>

      {/* Sales Data View */}
      <div className={`view-content ${viewMode === 'sales-data' ? 'active' : ''}`}>
        {!loading && !error && (
          <>
          <div className="reporting-sales-filter-bar">
            <span className="reporting-sales-filter-label">Year &amp; month</span>
            <select
              value={monthlySummaryYear}
              onChange={(e) => setMonthlySummaryYear(Number(e.target.value))}
              aria-label="Year for current sales and monthly summaries"
              className="reporting-sales-filter-select"
            >
              {(availableYears.length > 0
                ? availableYears
                : Array.from({ length: 12 }, (_, i) => now.getFullYear() - i)
              ).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
            <select
              value={monthlySummaryMonth}
              onChange={(e) => setMonthlySummaryMonth(Number(e.target.value))}
              aria-label="Month for current sales"
              className="reporting-sales-filter-select"
            >
              {monthLabels.map((label, index) => (
                <option key={index + 1} value={index + 1}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <h2 className="reporting-section-heading">Current Sales</h2>
          <div className="reporting-summary">
            <div className="total-profit-card" style={{ paddingBottom: '12px' }}>
              <div className="total-profit-label">Current Sales</div>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', flex: 1, minHeight: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '4px' }}>
                  <div className="total-profit-value positive" style={{ fontSize: '1.1rem', margin: 0 }}>
                    {formatCurrency(currentWeekSales)}
                  </div>
                  <div className="total-profit-description" style={{ fontSize: '0.85rem', margin: 0 }}>
                    /Week
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '4px' }}>
                  <div className="total-profit-value positive" style={{ fontSize: '1.1rem', margin: 0 }}>
                    {formatCurrency(currentMonthSales)}
                  </div>
                  <div className="total-profit-description" style={{ fontSize: '0.85rem', margin: 0 }}>
                    /Month
                  </div>
                </div>
              </div>
            </div>
            <div className="total-profit-card">
              <div className="total-profit-label">
                Platform Sales ({monthLabels[monthlySummaryMonth - 1]} {monthlySummaryYear})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0 }}>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '0.9rem', color: 'rgba(255, 248, 226, 0.7)', letterSpacing: '0.05rem', fontWeight: 600 }}>Vinted =</div>
                  <div className="total-profit-value positive" style={{ fontSize: '1.1rem', margin: 0 }}>
                    {monthlySummaryLoading ? '...' : formatCurrency(monthlySummaryData?.vintedSales || 0)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '0.9rem', color: 'rgba(255, 248, 226, 0.7)', letterSpacing: '0.05rem', fontWeight: 600 }}>eBay =</div>
                  <div className="total-profit-value positive" style={{ fontSize: '1.1rem', margin: 0 }}>
                    {monthlySummaryLoading ? '...' : formatCurrency(monthlySummaryData?.ebaySales || 0)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                  <div style={{ fontSize: '0.9rem', color: 'rgba(255, 248, 226, 0.7)', letterSpacing: '0.05rem', fontWeight: 600 }}>Depop =</div>
                  <div className="total-profit-value positive" style={{ fontSize: '1.1rem', margin: 0 }}>
                    {monthlySummaryLoading ? '...' : formatCurrency(monthlySummaryData?.depopSales || 0)}
                  </div>
                </div>
              </div>
            </div>
            <div className="total-profit-card">
              <div className="total-profit-label">
                Month Profit ({monthLabels[monthlySummaryMonth - 1]} {monthlySummaryYear})
              </div>
              <div className={`total-profit-value ${(monthlySummaryData?.monthProfit || 0) >= 0 ? 'positive' : 'negative'}`}>
                {monthlySummaryLoading ? '...' : formatCurrency(monthlySummaryData?.monthProfit || 0)}
              </div>
              <div className="total-profit-description">Sales - Purchases for this month</div>
            </div>
            <div className="total-profit-card">
              <div className="total-profit-label">
                Expenses ({monthLabels[monthlySummaryMonth - 1]} {monthlySummaryYear})
              </div>
              {reportingExpensesError ? (
                <div className="reporting-empty" style={{ marginTop: 8 }}>
                  {reportingExpensesError}
                </div>
              ) : reportingExpensesLoading ? (
                <div className="total-profit-description" style={{ marginTop: 12 }}>
                  Loading expenses…
                </div>
              ) : (
                <div
                  className={`total-profit-value${reportingExpensesMonthTotal > 0 ? ' negative' : ''}`}
                >
                  {formatCurrency(reportingExpensesMonthTotal)}
                </div>
              )}
            </div>
          </div>

          {monthlyLoading ? (
            <div className="reporting-status">Loading monthly data...</div>
          ) : (
            <div className="reporting-current-sales-platform">
              <div className="monthly-platform-row">
                <div className="platform-logo-cell">
                  <div className="platform-logo-tooltip">
                    <img src="/images/vinted-icon.svg" alt="Vinted" className="platform-logo" />
                    <span className="platform-icon-tooltip-text">Vinted monthly summary (sold_platform = Vinted)</span>
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Stock Cost</div>
                  <div className="platform-stat-value negative">
                    {formatCurrency(vintedData.purchases)}
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Total Sales</div>
                  <div className="platform-stat-value positive">
                    {formatCurrency(vintedData.sales)}
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Profit</div>
                  <div className={`platform-stat-value ${vintedData.profit >= 0 ? 'positive' : 'negative'}`}>
                    {formatCurrency(vintedData.profit)}
                  </div>
                </div>
              </div>

              <div className="monthly-platform-row">
                <div className="platform-logo-cell">
                  <div className="platform-logo-tooltip">
                    <img src="/images/ebay-icon.svg" alt="eBay" className="platform-logo" />
                    <span className="platform-icon-tooltip-text">eBay monthly summary (sold_platform = eBay)</span>
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Stock Cost</div>
                  <div className="platform-stat-value negative">
                    {formatCurrency(ebayData.purchases)}
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Total Sales</div>
                  <div className="platform-stat-value positive">
                    {formatCurrency(ebayData.sales)}
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Profit</div>
                  <div className={`platform-stat-value ${ebayData.profit >= 0 ? 'positive' : 'negative'}`}>
                    {formatCurrency(ebayData.profit)}
                  </div>
                </div>
              </div>

              <div className="monthly-platform-row">
                <div className="platform-logo-cell">
                  <div className="platform-logo-tooltip">
                    <div className="platform-logo-depop" aria-hidden>
                      Depop
                    </div>
                    <span className="platform-icon-tooltip-text">Depop monthly summary (sold_platform = Depop)</span>
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Stock Cost</div>
                  <div className="platform-stat-value negative">
                    {formatCurrency(depopData.purchases)}
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Total Sales</div>
                  <div className="platform-stat-value positive">
                    {formatCurrency(depopData.sales)}
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Profit</div>
                  <div className={`platform-stat-value ${depopData.profit >= 0 ? 'positive' : 'negative'}`}>
                    {formatCurrency(depopData.profit)}
                  </div>
                </div>
              </div>

              <div className="monthly-platform-row">
                <div className="platform-logo-cell">
                  <div className="platform-logo-tooltip">
                    <img src="/images/unsold-icon.svg" alt="" className="platform-logo" aria-hidden />
                    <span className="platform-icon-tooltip-text">
                      Unsold stock bought in {monthLabels[monthlySummaryMonth - 1]} {monthlySummaryYear}, plus month
                      sales and net profit
                    </span>
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Unsold stock cost</div>
                  <div className="platform-stat-value negative">
                    {formatCurrency(unsoldPurchases)}
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Total sales</div>
                  <div className="platform-stat-value positive">
                    {formatCurrency(monthlyCombinedPlatformSales)}
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Net Profit</div>
                  <div className={`platform-stat-value ${cashFlowProfit >= 0 ? 'positive' : 'negative'}`}>
                    {formatCurrency(cashFlowProfit)}
                  </div>
                </div>
              </div>

              {untaggedItems.length > 0 && (
                <div className="untagged-items-section">
                  <h3 className="untagged-items-heading">Items Not Tagged Correctly</h3>
                  <div className="untagged-items-list">
                    {untaggedItems.map((item) => (
                      <div key={item.id} className="untagged-item-card">
                        <div className="untagged-item-name">{item.item_name || 'Unnamed Item'}</div>
                        <div className="untagged-item-details">
                          <span>Category: {item.category || 'Uncategorized'}</span>
                          {item.sale_date && (
                            <span>Sold: {new Date(item.sale_date).toLocaleDateString()}</span>
                          )}
                          {item.sale_price && (
                            <span>Sale Price: {formatCurrency(item.sale_price)}</span>
                          )}
                          {item.sold_platform ? (
                            <span>Platform: {item.sold_platform}</span>
                          ) : (
                            <span className="untagged-warning">No platform tagged</span>
                          )}
                          {(!item.vinted_id && !item.ebay_id) && (
                            <span className="untagged-warning">Not listed on any platform</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <h2 className="reporting-section-heading">All Time Sales</h2>
          <div className="reporting-summary reporting-summary--grid-4">
            <div className="total-profit-card">
              <div className="total-profit-label">Total Company Profit (All Time)</div>
              {reportingExpensesLoading ? (
                <div className="total-profit-value" style={{ fontSize: '1.1rem', color: 'rgba(255,248,226,0.75)' }}>
                  …
                </div>
              ) : (
                <div
                  className={`total-profit-value ${
                    (reportingExpensesError ? totalProfit : allTimeCompanyProfit) >= 0 ? 'positive' : 'negative'
                  }`}
                >
                  {formatCurrency(reportingExpensesError ? totalProfit : allTimeCompanyProfit)}
                </div>
              )}
              <div className="total-profit-description">
                {reportingExpensesLoading
                  ? 'Sales − purchases − expenses (loading expenses…)'
                  : reportingExpensesError
                    ? 'Sales − purchases only (expenses table could not be loaded)'
                    : 'Sales − stock purchases − expenses (sum of expenses table)'}
              </div>
            </div>
            {yearSpecificTotals && (
              <div className="total-profit-card">
                <div className="total-profit-label">Total Sales (All Time)</div>
                <div className="total-profit-value positive">
                  {formatCurrency(yearSpecificTotals.totalSales)}
                </div>
                <div className="total-profit-description">All recorded sales</div>
              </div>
            )}
            {yearSpecificTotals && (
              <div className="total-profit-card">
                <div className="total-profit-label">Total Purchases (All Time)</div>
                <div className="total-profit-value negative">
                  {formatCurrency(yearSpecificTotals.totalPurchase)}
                </div>
                <div className="total-profit-description">All items purchased (stock)</div>
              </div>
            )}
            <div className="total-profit-card">
              <div className="total-profit-label">Total Expenses (All Time)</div>
              {reportingExpensesError ? (
                <div className="total-profit-value negative" style={{ fontSize: '1rem' }}>
                  —
                </div>
              ) : reportingExpensesLoading ? (
                <div className="total-profit-value" style={{ fontSize: '1.1rem', color: 'rgba(255,248,226,0.75)' }}>
                  …
                </div>
              ) : (
                <div className={`total-profit-value${reportingExpensesAllTimeTotal > 0 ? ' negative' : ''}`}>
                  {formatCurrency(reportingExpensesAllTimeTotal)}
                </div>
              )}
              <div className="total-profit-description">
                {reportingExpensesError
                  ? reportingExpensesError
                  : 'Sum of all rows in the expenses table'}
              </div>
            </div>
          </div>

          <div className="reporting-summary reporting-summary--grid-4">
            {yearSpecificTotals?.costOfSoldItems !== undefined && (
              <div className="total-profit-card">
                <div className="total-profit-label">Cost of Sold Items (All Time)</div>
                <div className="total-profit-value negative">
                  {formatCurrency(yearSpecificTotals.costOfSoldItems)}
                </div>
                <div className="total-profit-description">Purchase cost of sold items</div>
              </div>
            )}
            {unsoldInventoryValue && (
              <div className="total-profit-card">
                <div className="total-profit-label">Unsold Inventory Value</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0 }}>
                  <div className="total-profit-value negative">
                    {formatCurrency(-unsoldInventoryValue.value)}
                  </div>
                </div>
                <div className="total-profit-description">Current unsold stock at cost</div>
              </div>
            )}
            {yearSpecificTotals?.totalProfitFromSoldItems !== undefined && (
              <div className="total-profit-card">
                <div className="total-profit-label">Total Profit from Sold Items (All Time)</div>
                <div className={`total-profit-value ${yearSpecificTotals.totalProfitFromSoldItems >= 0 ? 'positive' : 'negative'}`}>
                  {formatCurrency(yearSpecificTotals.totalProfitFromSoldItems)}
                </div>
                <div className="total-profit-description">Sale − purchase on sold lines</div>
              </div>
            )}
            {yearItemsStats && activeListingsCount && (
              <div className="total-profit-card">
                <div className="total-profit-label">Items Sold / Not Sold</div>
                <div className="total-profit-value positive">
                  {yearItemsStats.sold.toLocaleString()} / {activeListingsCount.count.toLocaleString()}
                </div>
                <div className="total-profit-description">All-time sold / current not sold</div>
              </div>
            )}
          </div>

          <div className="reporting-summary reporting-summary--grid-4 reporting-summary--grid-3">
            {allTimeAverageProfitMultiple !== null && (
              <div className="total-profit-card">
                <div className="total-profit-label">Average Profit Multiple (All Time)</div>
                <div className="total-profit-value positive">
                  {allTimeAverageProfitMultiple.toFixed(2)}x
                </div>
                <div className="total-profit-description">Average return multiple across all sales</div>
              </div>
            )}
            {averageDaysToSell && (
              <div className="total-profit-card">
                <div className="total-profit-label">Average Days to Sell</div>
                <div className="total-profit-value positive">
                  {averageDaysToSell.days.toFixed(1)} days
                </div>
                <div className="total-profit-description">Listing date to sale date</div>
              </div>
            )}
            {activeListingsCount && (
              <div className="total-profit-card">
                <div className="total-profit-label">Active Listings Count</div>
                <div className="total-profit-value positive">
                  {activeListingsCount.count.toLocaleString()}
                </div>
                <div className="total-profit-description">Live items</div>
              </div>
            )}
          </div>

          <div className="reporting-summary reporting-summary--grid-4 reporting-summary--grid-3">
            {averageProfitPerItem && (
              <div className="total-profit-card">
                <div className="total-profit-label">Average Profit per Item</div>
                <div className={`total-profit-value ${averageProfitPerItem.average >= 0 ? 'positive' : 'negative'}`}>
                  {formatCurrency(averageProfitPerItem.average)}
                </div>
                <div className="total-profit-description">
                  {formatCurrency(averageProfitPerItem.netProfit)} ÷ {averageProfitPerItem.soldCount.toLocaleString()} items
                </div>
              </div>
            )}
            {averageSellingPrice && (
              <div className="total-profit-card">
                <div className="total-profit-label">Average Selling Price</div>
                <div className="total-profit-value positive">
                  {formatCurrency(averageSellingPrice.average)}
                </div>
                <div className="total-profit-description">
                  {formatCurrency(averageSellingPrice.totalSales)} ÷ {averageSellingPrice.soldCount.toLocaleString()} items
                </div>
              </div>
            )}
            {roi && (
              <div className="total-profit-card">
                <div className="total-profit-label">Return on Investment (ROI)</div>
                <div className={`total-profit-value ${roi.percentage >= 0 ? 'positive' : 'negative'}`}>
                  {roi.percentage.toFixed(1)}%
                </div>
                <div className="total-profit-description">
                  {formatCurrency(roi.profit)} ÷ {formatCurrency(roi.totalSpend)} × 100
                </div>
              </div>
            )}
          </div>

          <div className="reporting-grid">
          <section className="reporting-card">
            <div className="card-header">
              <h2>Month-on-Month Profit</h2>
            </div>
            {salesTimelineChartData ? (
              <div className="chart-wrapper">
                <Bar data={salesTimelineChartData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No profit data available yet.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Sales by Month</h2>
            </div>
            {salesMonthlySalesData.hasData ? (
              <div className="chart-wrapper">
                <Bar data={salesMonthlySalesData.data} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">
                No recorded sales {chartYearForBuckets === 'all' ? 'available.' : `for ${chartYearForBuckets}.`}
              </div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Sale By Month/Brand</h2>
              <p>eBay vs Vinted (by sale date)</p>
            </div>
            {salesMonthlySalesPlatformData.hasData ? (
              <div className="chart-wrapper">
                <Bar
                  data={salesMonthlySalesPlatformData.data}
                  options={salesMonthlyPlatformBarOptions}
                />
              </div>
            ) : (
              <div className="reporting-empty">
                No eBay or Vinted sales in range{' '}
                {chartYearForBuckets === 'all' ? 'for these months.' : `for ${chartYearForBuckets}.`}
              </div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Expenses by Month</h2>
            </div>
            <div className="chart-wrapper">
              <Bar data={salesMonthlyExpensesData} options={chartOptions} />
            </div>
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Items Listed by Month</h2>
            </div>
            <div className="chart-wrapper">
              <Bar
                data={salesItemsListedByMonthData}
                options={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    tooltip: {
                      callbacks: {
                        label(context) {
                          const value = context.raw as number;
                          return `${value} item${value !== 1 ? 's' : ''}`;
                        }
                      }
                    }
                  },
                  scales: {
                    ...chartOptions.scales,
                    y: {
                      ...chartOptions.scales?.y,
                      ticks: {
                        ...chartOptions.scales?.y?.ticks,
                        callback(value) {
                          if (typeof value === 'number') {
                            return value.toString();
                          }
                          return value;
                        }
                      }
                    }
                  }
                }}
              />
            </div>
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Items Sold by Month</h2>
            </div>
            <div className="chart-wrapper">
              <Bar
                data={salesItemsSoldByMonthData}
                options={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    tooltip: {
                      callbacks: {
                        label(context) {
                          const value = context.raw as number;
                          return `${value} item${value !== 1 ? 's' : ''}`;
                        }
                      }
                    }
                  },
                  scales: {
                    ...chartOptions.scales,
                    y: {
                      ...chartOptions.scales?.y,
                      ticks: {
                        ...chartOptions.scales?.y?.ticks,
                        callback(value) {
                          if (typeof value === 'number') {
                            return value.toString();
                          }
                          return value;
                        }
                      }
                    }
                  }
                }}
              />
            </div>
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Average Selling Price by Month</h2>
            </div>
            {salesMonthlyAverageSellingPriceData.datasets[0].data.some((value) => value !== 0) ? (
              <div className="chart-wrapper">
                <Bar 
                  data={salesMonthlyAverageSellingPriceData} 
                  options={{
                    ...chartOptions,
                    scales: {
                      ...chartOptions.scales,
                      y: {
                        ...chartOptions.scales?.y,
                        ticks: {
                          callback: function(value) {
                            return '£' + Number(value).toFixed(2);
                          }
                        }
                      }
                    }
                  }} 
                />
              </div>
            ) : (
              <div className="reporting-empty">
                No sales data available {chartYearForBuckets === 'all' ? '.' : `for ${chartYearForBuckets}.`}
              </div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Average Profit per Item by Month</h2>
            </div>
            {salesMonthlyAverageProfitPerItemData.datasets[0].data.some((value) => value !== 0) ? (
              <div className="chart-wrapper">
                <Bar 
                  data={salesMonthlyAverageProfitPerItemData} 
                  options={{
                    ...chartOptions,
                    scales: {
                      ...chartOptions.scales,
                      y: {
                        ...chartOptions.scales?.y,
                        ticks: {
                          callback: function(value) {
                            return '£' + Number(value).toFixed(2);
                          }
                        }
                      }
                    }
                  }} 
                />
              </div>
            ) : (
              <div className="reporting-empty">
                No sales data available {chartYearForBuckets === 'all' ? '.' : `for ${chartYearForBuckets}.`}
              </div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Average Profit Multiple by Month</h2>
            </div>
            <div className="chart-wrapper">
              <Bar 
                data={salesMonthlyAverageProfitMultipleData} 
                options={{
                  ...chartOptions,
                  plugins: {
                    ...chartOptions.plugins,
                    tooltip: {
                      callbacks: {
                        label(context) {
                          const value = context.raw as number;
                          return `${Number(value).toFixed(2)}x`;
                        },
                      },
                    },
                  },
                  scales: {
                    ...chartOptions.scales,
                    y: {
                      ...chartOptions.scales?.y,
                      min: 0,
                      ticks: {
                        ...chartOptions.scales?.y?.ticks,
                        callback: function(value) {
                          return Number(value).toFixed(2) + 'x';
                        }
                      }
                    }
                  }
                }} 
              />
            </div>
          </section>
          </div>

          </>
        )}
      </div>

      {/* Stock Analysis View */}
      <div className={`view-content ${viewMode === 'stock-analysis' ? 'active' : ''}`}>
        <div className="stock-analysis-filter-row">
          <div className="stock-analysis-filter-card">
            <select
              className="stock-analysis-filter-select"
              value={salesDateFilter}
              onChange={(event) => setSalesDateFilter(event.target.value as 'all-time' | 'last-30-days' | 'last-3-months' | 'current-year' | 'previous-year')}
            >
              <option value="all-time">All Time</option>
              <option value="last-30-days">Last 30 Days</option>
              <option value="last-3-months">Last 3 Months</option>
              <option value="current-year">Current Year ({now.getFullYear()})</option>
              {previousDataYear !== null && (
                <option value="previous-year">Previous Year ({previousDataYear})</option>
              )}
            </select>
          </div>
        </div>
        <div className="reporting-grid">
          <section className="reporting-card">
            <div className="card-header">
              <h2>Inventory and sold by category</h2>
            </div>
            {stockAnalysisCategoryInventorySoldStackData ? (
              <>
                <div
                  className="chart-wrapper chart-wrapper--category-inventory-sold-stack"
                  style={{
                    height: `${Math.max(
                      280,
                      (stockAnalysisCategoryInventorySoldStackData.labels?.length ?? 0) * 40 + 120
                    )}px`,
                  }}
                >
                  <Bar
                    data={stockAnalysisCategoryInventorySoldStackData}
                    options={stockAnalysisCategoryInventorySoldStackOptions}
                  />
                </div>
                <div className="reporting-stock-category-ask-ai-wrap">
                  <button
                    type="button"
                    className="reporting-stock-category-ask-ai-btn"
                    onClick={() => void handleCopyStockCategoryAskAiPrompt()}
                  >
                    Ask AI — copy prompt for ChatGPT
                  </button>
                </div>
              </>
            ) : (
              <div className="reporting-empty">No category inventory data for this period.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Sales by Category</h2>
            </div>
            {salesByCategoryData ? (
              <div className="chart-wrapper">
                <Bar data={salesByCategoryData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No sales data available for {selectedYear}.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Best Selling Brands</h2>
            </div>
            {salesByBrandData ? (
              <div className="chart-wrapper">
                <Bar data={salesByBrandData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No sales data available for {selectedYear}.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Best Selling Brands by Trousers</h2>
            </div>
            {trousersBrandSalesData ? (
              <div className="chart-wrapper">
                <Bar data={trousersBrandSalesData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No trousers brand sales data available.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Best Selling Brands by Shirt</h2>
            </div>
            {shirtBrandSalesData ? (
              <div className="chart-wrapper">
                <Bar data={shirtBrandSalesData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No shirt brand sales data available.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Best Selling Brands by Top</h2>
            </div>
            {topBrandSalesData ? (
              <div className="chart-wrapper">
                <Bar data={topBrandSalesData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No top brand sales data available.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Best Selling Brands by Coat</h2>
            </div>
            {coatBrandSalesData ? (
              <div className="chart-wrapper">
                <Bar data={coatBrandSalesData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No coat brand sales data available.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Best Selling Brands by Jacket</h2>
            </div>
            {jacketBrandSalesData ? (
              <div className="chart-wrapper">
                <Bar data={jacketBrandSalesData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No jacket brand sales data available.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Best Brands by Sell-Through Rate</h2>
            </div>
            {bestSellThroughBrandsData ? (
              <div className="chart-wrapper">
                <Bar
                  data={bestSellThroughBrandsData}
                  options={{
                    ...chartOptions,
                    plugins: {
                      ...chartOptions.plugins,
                      tooltip: {
                        callbacks: {
                          label(context) {
                            const value = context.raw as number;
                            return `${Number(value).toFixed(1)}%`;
                          }
                        }
                      }
                    },
                    scales: {
                      ...chartOptions.scales,
                      y: {
                        ...chartOptions.scales?.y,
                        max: 100,
                        ticks: {
                          ...chartOptions.scales?.y?.ticks,
                          callback(value) {
                            if (typeof value === 'number') {
                              return `${value}%`;
                            }
                            return value;
                          }
                        }
                      }
                    }
                  }}
                />
              </div>
            ) : (
              <div className="reporting-empty">No sell-through brand data available.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Worst Brands by Sell-Through Rate</h2>
            </div>
            {worstSellThroughBrandsData ? (
              <div className="chart-wrapper">
                <Bar
                  data={worstSellThroughBrandsData}
                  options={{
                    ...chartOptions,
                    plugins: {
                      ...chartOptions.plugins,
                      tooltip: {
                        callbacks: {
                          label(context) {
                            const value = context.raw as number;
                            return `${Number(value).toFixed(1)}%`;
                          }
                        }
                      }
                    },
                    scales: {
                      ...chartOptions.scales,
                      y: {
                        ...chartOptions.scales?.y,
                        max: 100,
                        ticks: {
                          ...chartOptions.scales?.y?.ticks,
                          callback(value) {
                            if (typeof value === 'number') {
                              return `${value}%`;
                            }
                            return value;
                          }
                        }
                      }
                    }
                  }}
                />
              </div>
            ) : (
              <div className="reporting-empty">No sell-through brand data available.</div>
            )}
          </section>

          <div className="card-header">
            <h2>Inventory Data</h2>
          </div>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Inventory Value (Trailing 12 Months)</h2>
            </div>
            {trailingInventoryLoading ? (
              <div className="reporting-status">Loading trailing inventory data...</div>
            ) : trailingInventoryChartData ? (
              <div className="chart-wrapper">
                <Line data={trailingInventoryChartData} options={lineChartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No trailing inventory data available.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Unsold Stock by Category</h2>
            </div>
            {unsoldStockByCategoryData ? (
              <div className="chart-wrapper">
                <Bar data={unsoldStockByCategoryData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">
                No unsold stock data available {chartYearForBuckets === 'all' ? '.' : `for ${chartYearForBuckets}.`}
              </div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Largest Inventory Count By Brand</h2>
            </div>
            {worstSellingBrandsData ? (
              <div className="chart-wrapper">
                <Bar 
                  data={worstSellingBrandsData} 
                  options={{
                    ...chartOptions,
                    plugins: {
                      ...chartOptions.plugins,
                      tooltip: {
                        callbacks: {
                          label(context) {
                            const value = context.raw as number;
                            return `${value} unsold item${value !== 1 ? 's' : ''}`;
                          }
                        }
                      }
                    },
                    scales: {
                      ...chartOptions.scales,
                      y: {
                        ...chartOptions.scales?.y,
                        ticks: {
                          ...chartOptions.scales?.y?.ticks,
                          callback(value) {
                            if (typeof value === 'number') {
                              return value.toString();
                            }
                            return value;
                          }
                        }
                      }
                    }
                  }} 
                />
              </div>
            ) : (
              <div className="reporting-empty">No unsold items data available.</div>
            )}
          </section>

        </div>
      </div>

      <div className={`view-content ${viewMode === 'item-analysis' ? 'active' : ''}`}>
        <div className="item-analysis-toolbar">
          <div className="item-analysis-toolbar-row">
            <label className="item-analysis-field">
              <span>Period</span>
              <select
                className="item-analysis-select"
                value={itemAnalysisPreset}
                onChange={(e) => setItemAnalysisPreset(e.target.value as ItemAnalysisPreset)}
              >
                <option value="current-month">Current month</option>
                <option value="last-month">Last month</option>
                <option value="custom-month">Choose month…</option>
                <option value="current-year">Current year</option>
                <option value="last-3-years">Last 3 years</option>
              </select>
            </label>
            {itemAnalysisPreset === 'custom-month' && (
              <>
                <label className="item-analysis-field">
                  <span>Year</span>
                  <select
                    className="item-analysis-select"
                    value={itemAnalysisCustomYear}
                    onChange={(e) => setItemAnalysisCustomYear(Number(e.target.value))}
                  >
                    {itemAnalysisYearOptions.map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="item-analysis-field">
                  <span>Month</span>
                  <select
                    className="item-analysis-select"
                    value={itemAnalysisCustomMonth}
                    onChange={(e) => setItemAnalysisCustomMonth(Number(e.target.value))}
                  >
                    {monthLabelsShort.map((label, i) => (
                      <option key={label} value={i + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
        </div>

        <div className="item-analysis-platform-tabs" role="tablist" aria-label="Item analysis platform">
          <button
            type="button"
            role="tab"
            id="item-analysis-tab-vinted"
            aria-selected={itemAnalysisPlatform === 'vinted'}
            aria-controls="item-analysis-panel-vinted"
            className={`item-analysis-platform-tab${itemAnalysisPlatform === 'vinted' ? ' item-analysis-platform-tab--active' : ''}`}
            onClick={() => setItemAnalysisPlatformTab('vinted')}
          >
            Vinted
          </button>
          <button
            type="button"
            role="tab"
            id="item-analysis-tab-ebay"
            aria-selected={itemAnalysisPlatform === 'ebay'}
            aria-controls="item-analysis-panel-ebay"
            className={`item-analysis-platform-tab${itemAnalysisPlatform === 'ebay' ? ' item-analysis-platform-tab--active' : ''}`}
            onClick={() => setItemAnalysisPlatformTab('ebay')}
          >
            eBay
          </button>
        </div>

        {itemAnalysisPlatform === 'ebay' && (
          <div
            id="item-analysis-panel-ebay"
            role="tabpanel"
            aria-labelledby="item-analysis-tab-ebay"
            className="item-analysis-platform-panel"
          >
            <div className="item-analysis-section">
              <h2 className="item-analysis-heading">eBay — best profit</h2>
              {itemAnalysisEbayChart.chartData.labels.length > 0 ? (
                <div
                  className="chart-wrapper item-analysis-chart-wrap"
                  style={{
                    minHeight: Math.min(520, Math.max(200, itemAnalysisEbayChart.chartData.labels.length * 32)),
                  }}
                >
                  <Bar
                    data={itemAnalysisEbayChart.chartData}
                    options={{
                      ...itemAnalysisChartOptions,
                      plugins: {
                        ...itemAnalysisChartOptions.plugins,
                        tooltip: {
                          ...itemAnalysisChartOptions.plugins?.tooltip,
                          callbacks: {
                            ...itemAnalysisChartOptions.plugins?.tooltip?.callbacks,
                            title(items) {
                              const i = items[0]?.dataIndex;
                              return i !== undefined ? itemAnalysisEbayChart.labelsFull[i] ?? '' : '';
                            },
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="reporting-empty">No eBay sales in this period.</div>
              )}

              <div className="item-analysis-table-wrap">
                {itemAnalysisEbayItems.length > 0 ? (
                  <table className="item-analysis-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Price paid</th>
                        <th>Sold price</th>
                        <th>Price ×</th>
                        <th>Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemAnalysisEbayItems.map((row) => (
                        <tr key={`ebay-${row.id}-${row.name}`}>
                          <td className="item-analysis-name">{row.name}</td>
                          <td>{formatCurrency(row.purchase)}</td>
                          <td>{formatCurrency(row.sale)}</td>
                          <td>{row.multiplier !== null ? `${row.multiplier.toFixed(2)}×` : '—'}</td>
                          <td className={row.profit >= 0 ? 'item-analysis-profit-pos' : 'item-analysis-profit-neg'}>
                            {formatCurrency(row.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="reporting-empty item-analysis-table-empty">No rows to show.</div>
                )}
              </div>
            </div>

            <div className="item-analysis-section item-analysis-section--worst">
              <h2 className="item-analysis-heading">eBay — lowest profit (10)</h2>
              {itemAnalysisWorstEbayChart.chartData.labels.length > 0 ? (
                <div
                  className="chart-wrapper item-analysis-chart-wrap"
                  style={{
                    minHeight: Math.min(
                      400,
                      Math.max(200, itemAnalysisWorstEbayChart.chartData.labels.length * 32)
                    ),
                  }}
                >
                  <Bar
                    data={itemAnalysisWorstEbayChart.chartData}
                    options={{
                      ...itemAnalysisChartOptions,
                      plugins: {
                        ...itemAnalysisChartOptions.plugins,
                        tooltip: {
                          ...itemAnalysisChartOptions.plugins?.tooltip,
                          callbacks: {
                            ...itemAnalysisChartOptions.plugins?.tooltip?.callbacks,
                            title(items) {
                              const i = items[0]?.dataIndex;
                              return i !== undefined ? itemAnalysisWorstEbayChart.labelsFull[i] ?? '' : '';
                            },
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="reporting-empty">No eBay sales in this period.</div>
              )}

              <div className="item-analysis-table-wrap">
                {itemAnalysisWorstEbayTop.length > 0 ? (
                  <table className="item-analysis-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Price paid</th>
                        <th>Sold price</th>
                        <th>Price ×</th>
                        <th>Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemAnalysisWorstEbayTop.map((row) => (
                        <tr key={`ebay-worst-${row.id}-${row.name}`}>
                          <td className="item-analysis-name">{row.name}</td>
                          <td>{formatCurrency(row.purchase)}</td>
                          <td>{formatCurrency(row.sale)}</td>
                          <td>{row.multiplier !== null ? `${row.multiplier.toFixed(2)}×` : '—'}</td>
                          <td className={row.profit >= 0 ? 'item-analysis-profit-pos' : 'item-analysis-profit-neg'}>
                            {formatCurrency(row.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="reporting-empty item-analysis-table-empty">No rows to show.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {itemAnalysisPlatform === 'vinted' && (
          <div
            id="item-analysis-panel-vinted"
            role="tabpanel"
            aria-labelledby="item-analysis-tab-vinted"
            className="item-analysis-platform-panel item-analysis-platform-panel--vinted"
          >
            <div className="item-analysis-section item-analysis-section--vinted">
              <h2 className="item-analysis-heading">Vinted — best profit</h2>
              {itemAnalysisVintedChart.chartData.labels.length > 0 ? (
                <div
                  className="chart-wrapper item-analysis-chart-wrap"
                  style={{
                    minHeight: Math.min(520, Math.max(200, itemAnalysisVintedChart.chartData.labels.length * 32)),
                  }}
                >
                  <Bar
                    data={itemAnalysisVintedChart.chartData}
                    options={{
                      ...itemAnalysisChartOptions,
                      plugins: {
                        ...itemAnalysisChartOptions.plugins,
                        tooltip: {
                          ...itemAnalysisChartOptions.plugins?.tooltip,
                          callbacks: {
                            ...itemAnalysisChartOptions.plugins?.tooltip?.callbacks,
                            title(items) {
                              const i = items[0]?.dataIndex;
                              return i !== undefined ? itemAnalysisVintedChart.labelsFull[i] ?? '' : '';
                            },
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="reporting-empty">No Vinted sales in this period.</div>
              )}

              <div className="item-analysis-table-wrap">
                {itemAnalysisVintedItems.length > 0 ? (
                  <table className="item-analysis-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Price paid</th>
                        <th>Sold price</th>
                        <th>Price ×</th>
                        <th>Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemAnalysisVintedItems.map((row) => (
                        <tr key={`vinted-${row.id}-${row.name}`}>
                          <td className="item-analysis-name">{row.name}</td>
                          <td>{formatCurrency(row.purchase)}</td>
                          <td>{formatCurrency(row.sale)}</td>
                          <td>{row.multiplier !== null ? `${row.multiplier.toFixed(2)}×` : '—'}</td>
                          <td className={row.profit >= 0 ? 'item-analysis-profit-pos' : 'item-analysis-profit-neg'}>
                            {formatCurrency(row.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="reporting-empty item-analysis-table-empty">No rows to show.</div>
                )}
              </div>
            </div>

            <div className="item-analysis-section item-analysis-section--vinted item-analysis-section--worst">
              <h2 className="item-analysis-heading">Vinted — lowest profit (10)</h2>
              {itemAnalysisWorstVintedChart.chartData.labels.length > 0 ? (
                <div
                  className="chart-wrapper item-analysis-chart-wrap"
                  style={{
                    minHeight: Math.min(
                      400,
                      Math.max(200, itemAnalysisWorstVintedChart.chartData.labels.length * 32)
                    ),
                  }}
                >
                  <Bar
                    data={itemAnalysisWorstVintedChart.chartData}
                    options={{
                      ...itemAnalysisChartOptions,
                      plugins: {
                        ...itemAnalysisChartOptions.plugins,
                        tooltip: {
                          ...itemAnalysisChartOptions.plugins?.tooltip,
                          callbacks: {
                            ...itemAnalysisChartOptions.plugins?.tooltip?.callbacks,
                            title(items) {
                              const i = items[0]?.dataIndex;
                              return i !== undefined ? itemAnalysisWorstVintedChart.labelsFull[i] ?? '' : '';
                            },
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <div className="reporting-empty">No Vinted sales in this period.</div>
              )}

              <div className="item-analysis-table-wrap">
                {itemAnalysisWorstVintedTop.length > 0 ? (
                  <table className="item-analysis-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Price paid</th>
                        <th>Sold price</th>
                        <th>Price ×</th>
                        <th>Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itemAnalysisWorstVintedTop.map((row) => (
                        <tr key={`vinted-worst-${row.id}-${row.name}`}>
                          <td className="item-analysis-name">{row.name}</td>
                          <td>{formatCurrency(row.purchase)}</td>
                          <td>{formatCurrency(row.sale)}</td>
                          <td>{row.multiplier !== null ? `${row.multiplier.toFixed(2)}×` : '—'}</td>
                          <td className={row.profit >= 0 ? 'item-analysis-profit-pos' : 'item-analysis-profit-neg'}>
                            {formatCurrency(row.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="reporting-empty item-analysis-table-empty">No rows to show.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Reporting;
