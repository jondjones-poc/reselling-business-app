import React, { useEffect, useMemo, useState } from 'react';
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
  purchase_date: string | null;
  sale_date: string | null;
  purchase_price: number | string | null;
  sale_price: number | string | null;
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

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrency = (value: number) => currencyFormatter.format(value ?? 0);

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

const Reporting: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const initialViewMode: 'sales-data' | 'stock-analysis' =
    tabFromUrl === 'stock-analysis' ? 'stock-analysis' : 'sales-data';

  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | 'all'>('all');
  const [monthlyProfit, setMonthlyProfit] = useState<MonthlyProfitDatum[]>([]);
  const [salesByCategory, setSalesByCategory] = useState<SalesByCategoryDatum[]>([]);
  const [unsoldStockByCategory, setUnsoldStockByCategory] = useState<UnsoldStockByCategoryDatum[]>([]);
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
  const [viewMode, setViewMode] = useState<'sales-data' | 'stock-analysis'>(initialViewMode);
  const [vintedData, setVintedData] = useState<{ purchases: number; sales: number; profit: number }>({ purchases: 0, sales: 0, profit: 0 });
  const [ebayData, setEbayData] = useState<{ purchases: number; sales: number; profit: number }>({ purchases: 0, sales: 0, profit: 0 });
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
    monthProfit: number;
    unsoldInventoryValue: number;
  } | null>(null);
  const [monthlySummaryLoading, setMonthlySummaryLoading] = useState(false);
  
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
      const yearParam = selectedYear === 'all' ? 'all' : selectedYear;
      const response = await fetch(`${API_BASE}/api/analytics/reporting?year=${yearParam}`);
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'Failed to load analytics data');
        }
        const data: ReportingResponse = await response.json();
        setAvailableYears(data.availableYears);
        setMonthlyProfit(data.monthlyProfit);
        setSalesByCategory(data.salesByCategory || []);
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
        if (data.selectedYear !== selectedYear && selectedYear !== 'all') {
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
  }, [selectedYear]);

  useEffect(() => {
    const nextViewMode: 'sales-data' | 'stock-analysis' =
      searchParams.get('tab') === 'stock-analysis' ? 'stock-analysis' : 'sales-data';
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

  // Fetch monthly platform data when in monthly view
  useEffect(() => {
    if (viewMode === 'sales-data') {
      const fetchMonthlyData = async () => {
        try {
          setMonthlyLoading(true);
          const url = `${API_BASE}/api/analytics/monthly-platform?year=${monthlySummaryYear}&month=${monthlySummaryMonth}`;
          console.log('[Monthly Platform] Fetching data from:', url);
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error('Failed to load monthly platform data');
          }
          const data = await response.json();
          console.log('[Monthly Platform] Full API response:', data);
          console.log('[Monthly Platform] Vinted data:', data.vinted);
          console.log('[Monthly Platform] eBay data:', data.ebay);
          console.log('[Monthly Platform] Unsold purchases:', data.unsoldPurchases);
          console.log('[Monthly Platform] Cash flow profit:', data.cashFlowProfit);
          const calcVintedProfit = data.vinted?.profit || 0;
          const calcEbayProfit = data.ebay?.profit || 0;
          const calcUnsoldPurchases = data.unsoldPurchases || 0;
          const calculatedCashFlow = calcVintedProfit + calcEbayProfit - calcUnsoldPurchases;
          console.log('[Monthly Platform] Cash flow calculation check:', {
            vintedProfit: calcVintedProfit,
            ebayProfit: calcEbayProfit,
            unsoldPurchases: calcUnsoldPurchases,
            calculated: calculatedCashFlow,
            formula: `(${calcVintedProfit} + ${calcEbayProfit}) - ${calcUnsoldPurchases} = ${calculatedCashFlow}`
          });
          console.log('[Monthly Platform] API returned cashFlowProfit:', data.cashFlowProfit, 'vs calculated:', calculatedCashFlow);
          console.log('[Monthly Platform] Untagged items count:', data.untaggedItems?.length || 0);
          if (data.untaggedItems && data.untaggedItems.length > 0) {
            console.log('[Monthly Platform] Sample untagged items:', data.untaggedItems.slice(0, 3));
          }
          setVintedData(data.vinted || { purchases: 0, sales: 0, profit: 0 });
          setEbayData(data.ebay || { purchases: 0, sales: 0, profit: 0 });
          setUnsoldPurchases(data.unsoldPurchases || 0);
          setCashFlowProfit(data.cashFlowProfit || 0);
          setUntaggedItems(data.untaggedItems || []);
        } catch (err: any) {
          console.error('[Monthly Platform] Fetch error:', err);
          setVintedData({ purchases: 0, sales: 0, profit: 0 });
          setEbayData({ purchases: 0, sales: 0, profit: 0 });
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
            monthProfit: data.totalMonthProfit || 0,
            unsoldInventoryValue: data.unsoldInventoryValue || 0
          });
        } catch (err: any) {
          console.error('[Monthly Summary] Fetch error:', err);
          setMonthlySummaryData({
            ebaySales: 0,
            vintedSales: 0,
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

  const monthlyChartBuckets = useMemo(() => {
    if (selectedYear === 'all') {
      const base = new Date(now.getFullYear(), now.getMonth(), 1);
      const buckets: Array<{ key: string; label: string }> = [];
      for (let offset = 0; offset <= 11; offset += 1) {
        const d = new Date(base);
        d.setMonth(base.getMonth() - offset);
        buckets.push({
          key: `${d.getFullYear()}-${d.getMonth() + 1}`,
          label: `${monthLabels[d.getMonth()]} ${d.getFullYear()}`
        });
      }
      return buckets;
    }

    const year = Number(selectedYear);
    return monthLabels.map((label, monthIndex) => ({
      key: `${year}-${monthIndex + 1}`,
      label
    }));
  }, [selectedYear, now]);

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

    const labels = monthlyChartBuckets.map((bucket) => bucket.label);
    const values = valuesByBucket.map((point) => point.sales - point.purchase);
    if (!values.some((value) => value !== 0)) {
      return null;
    }

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
    return {
      data: {
        labels: monthlyChartBuckets.map((bucket) => bucket.label),
        datasets: [
          {
            label: 'Monthly Sales',
            data: values,
            backgroundColor: values.map((value) =>
              value >= 0 ? 'rgba(140, 255, 195, 0.5)' : 'rgba(255, 120, 120, 0.45)'
            ),
            borderColor: values.map((value) =>
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
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: 'Monthly Expenses',
          data: values,
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
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: 'Average Selling Price',
          data: values,
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
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: 'Average Profit per Item',
          data: values,
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
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: 'Average Profit Multiple',
          data: values,
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
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: 'Items Listed',
          data: values,
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
    return {
      labels: monthlyChartBuckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: 'Items Sold',
          data: values,
          backgroundColor: 'rgba(195, 255, 140, 0.5)',
          borderColor: 'rgba(195, 255, 140, 0.85)',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    };
  }, [stockRowsForSalesData, isDateInSalesRange, monthlyChartBuckets]);

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
      </div>

      {/* Sales Data View */}
      <div className={`view-content ${viewMode === 'sales-data' ? 'active' : ''}`}>
        {!loading && !error && (
          <>
          {/* Row 1: Total Company Profit, Total Sales, Unsold Inventory Value, Current Sales */}
          <div className="reporting-summary">
            <div className="total-profit-card">
              <div className="total-profit-label">Total Company Profit {selectedYear === 'all' ? '(All Time)' : `(${selectedYear})`}</div>
              <div className={`total-profit-value ${totalProfit >= 0 ? 'positive' : 'negative'}`}>
                {formatCurrency(totalProfit)}
              </div>
              <div className="total-profit-description">All Sales - All Expenses {selectedYear === 'all' ? 'for All Time' : `for ${selectedYear}`}</div>
            </div>
            {yearSpecificTotals && (
              <div className="total-profit-card">
                <div className="total-profit-label">Total Sales {selectedYear === 'all' ? '(All Time)' : `(${selectedYear})`}</div>
                <div className="total-profit-value positive">
                  {formatCurrency(yearSpecificTotals.totalSales)}
                </div>
                <div className="total-profit-description">All sales {selectedYear === 'all' ? 'for All Time' : `for ${selectedYear}`}</div>
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
              </div>
            )}
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
          </div>

          {/* Row 2: Total Purchases, Cost of Sold Items */}
          {yearSpecificTotals && (
            <div className="reporting-summary">
              <div className="total-profit-card">
                <div className="total-profit-label">Total Purchases {selectedYear === 'all' ? '(All Time)' : `(${selectedYear})`}</div>
                <div className="total-profit-value negative">
                  {formatCurrency(yearSpecificTotals.totalPurchase)}
                </div>
                <div className="total-profit-description">All items purchased {selectedYear === 'all' ? 'across all years' : `in ${selectedYear}`}</div>
              </div>
              {yearSpecificTotals.costOfSoldItems !== undefined && (
                <div className="total-profit-card">
                  <div className="total-profit-label">Cost of Sold Items {selectedYear === 'all' ? '(All Time)' : `(${selectedYear})`}</div>
                  <div className="total-profit-value negative">
                    {formatCurrency(yearSpecificTotals.costOfSoldItems)}
                  </div>
                  <div className="total-profit-description">Purchase cost of items that have been sold {selectedYear === 'all' ? 'across all years' : `in ${selectedYear}`}</div>
                </div>
              )}
              {yearSpecificTotals.totalProfitFromSoldItems !== undefined && (
                <div className="total-profit-card">
                  <div className="total-profit-label">Total Profit from Sold Items {selectedYear === 'all' ? '(All Time)' : `(${selectedYear})`}</div>
                  <div className={`total-profit-value ${yearSpecificTotals.totalProfitFromSoldItems >= 0 ? 'positive' : 'negative'}`}>
                    {formatCurrency(yearSpecificTotals.totalProfitFromSoldItems)}
                  </div>
                  <div className="total-profit-description">Sale price - Purchase price for sold items {selectedYear === 'all' ? 'across all years' : `in ${selectedYear}`}</div>
                </div>
              )}
              {yearSpecificTotals.vintedSales !== undefined && yearSpecificTotals.ebaySales !== undefined && (
                <div className="total-profit-card">
                  <div className="total-profit-label">Platform Sales {selectedYear === 'all' ? '(All Time)' : `(${selectedYear})`}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontSize: '0.9rem', color: 'rgba(255, 248, 226, 0.7)', letterSpacing: '0.05rem', fontWeight: 600 }}>Vinted =</div>
                      <div className="total-profit-value positive" style={{ fontSize: '1.1rem', margin: 0 }}>
                        {formatCurrency(yearSpecificTotals.vintedSales)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontSize: '0.9rem', color: 'rgba(255, 248, 226, 0.7)', letterSpacing: '0.05rem', fontWeight: 600 }}>eBay =</div>
                      <div className="total-profit-value positive" style={{ fontSize: '1.1rem', margin: 0 }}>
                        {formatCurrency(yearSpecificTotals.ebaySales)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Row 3: Average Profit per Item, Average Selling Price, Average Profit Multiple (All Time), Average Days to Sell */}
          <div className="reporting-summary">
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
                <div className="total-profit-description">
                  Time from listing date to sale date
                </div>
              </div>
            )}
          </div>

          {/* Row 3: Active Listings Count, Items (2025), ROI, Year dropdown */}
          <div className="reporting-summary">
            {activeListingsCount && (
              <div className="total-profit-card">
                <div className="total-profit-label">Active Listings Count</div>
                <div className="total-profit-value positive">
                  {activeListingsCount.count.toLocaleString()}
                </div>
                <div className="total-profit-description">
                  Number of live items
                </div>
              </div>
            )}
            {yearItemsStats && (
              <div className="total-profit-card">
                <div className="total-profit-label">Items {selectedYear === 'all' ? '(All Time)' : `(${selectedYear})`}</div>
                <div className="total-profit-value positive">
                  {yearItemsStats.sold.toLocaleString()} / {yearItemsStats.listed.toLocaleString()}
                </div>
                <div className="total-profit-description">Sold / Listed</div>
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
            <div className="total-profit-card">
              <div className="total-profit-label">Year</div>
              <div className="total-profit-value" style={{ fontSize: '1.2rem', marginBottom: '8px' }}>
                <select
                  id="reporting-year"
                  value={selectedYear}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedYear(value === 'all' ? 'all' : Number(value));
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--neon-primary-strong)',
                    fontSize: '1.2rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    outline: 'none',
                    textAlign: 'center',
                    width: '100%'
                  }}
                >
                  <option value="all">All</option>
                  {availableYears.length === 0 && selectedYear !== 'all' && <option value={selectedYear}>{selectedYear}</option>}
                  {availableYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
              <div className="total-profit-description">Select reporting year</div>
            </div>
          </div>

          {/* Row 5: Monthly Sales Summary - Platform Sales (combined), Month Profit, Inventory Value, Month Filter */}
          <div className="reporting-summary">
            <div className="total-profit-card">
              <div className="total-profit-label">Platform Sales ({monthLabels[monthlySummaryMonth - 1]} {monthlySummaryYear})</div>
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
              </div>
            </div>
            <div className="total-profit-card">
              <div className="total-profit-label">Month Profit ({monthLabels[monthlySummaryMonth - 1]} {monthlySummaryYear})</div>
              <div className={`total-profit-value ${(monthlySummaryData?.monthProfit || 0) >= 0 ? 'positive' : 'negative'}`}>
                {monthlySummaryLoading ? '...' : formatCurrency(monthlySummaryData?.monthProfit || 0)}
              </div>
              <div className="total-profit-description">Sales - Purchases for this month</div>
            </div>
            <div className="total-profit-card">
              <div className="total-profit-label">Inventory Value</div>
              <div className="total-profit-value positive">
                {monthlySummaryLoading ? '...' : formatCurrency(monthlySummaryData?.unsoldInventoryValue || 0)}
              </div>
            </div>
            <div className="total-profit-card">
              <div className="total-profit-label">Month Filter</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0 }}>
                <div style={{ width: '100%' }}>
                  <div className="total-profit-value" style={{ fontSize: '1.2rem', marginBottom: '8px' }}>
                    <select
                      value={monthlySummaryMonth}
                      onChange={(e) => setMonthlySummaryMonth(Number(e.target.value))}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--neon-primary-strong)',
                        fontSize: '1.2rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        outline: 'none',
                        textAlign: 'center',
                        width: '100%'
                      }}
                    >
                      {monthLabels.map((label, index) => (
                        <option key={index + 1} value={index + 1}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ width: '100%' }}>
                  <div className="total-profit-value" style={{ fontSize: '1.2rem', marginBottom: '8px' }}>
                    <select
                      value={monthlySummaryYear}
                      onChange={(e) => setMonthlySummaryYear(Number(e.target.value))}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#8cffc3',
                        fontSize: '1.2rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        outline: 'none',
                        textAlign: 'center',
                        width: '100%'
                      }}
                    >
                      {availableYears.length === 0 && <option value={monthlySummaryYear}>{monthlySummaryYear}</option>}
                      {availableYears.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {monthlyLoading ? (
            <div className="reporting-status">Loading monthly data...</div>
          ) : (
            <>
              <div className="monthly-platform-row">
                <div className="platform-logo-cell">
                  <div className="platform-logo-tooltip">
                    <img src="/images/vinted-icon.svg" alt="Vinted" className="platform-logo" />
                    <span className="platform-icon-tooltip-text">Vinted monthly summary</span>
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
                    <span className="platform-icon-tooltip-text">eBay monthly summary</span>
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
                    <img src="/images/to-list-icon.svg" alt="To List" className="platform-logo" />
                    <span className="platform-icon-tooltip-text">Unsold stock and cash flow summary</span>
                  </div>
                </div>
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Stock Cost</div>
                  <div className="platform-stat-value negative">
                    {formatCurrency(unsoldPurchases)}
                  </div>
                </div>
                <div className="platform-stat-cell" />
                <div className="platform-stat-cell">
                  <div className="platform-stat-label">Cash Flow Profit</div>
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
            </>
          )}

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
              <div className="reporting-empty">No recorded sales {selectedYear === 'all' ? 'available.' : `for ${selectedYear}.`}</div>
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
              <div className="reporting-empty">No sales data available {selectedYear === 'all' ? '.' : `for ${selectedYear}.`}</div>
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
              <div className="reporting-empty">No sales data available {selectedYear === 'all' ? '.' : `for ${selectedYear}.`}</div>
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
              <div className="reporting-empty">No unsold stock data available {selectedYear === 'all' ? '.' : `for ${selectedYear}.`}</div>
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
    </div>
  );
};

export default Reporting;
