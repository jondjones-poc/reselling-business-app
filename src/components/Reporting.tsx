import React, { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import './Reporting.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

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
  yearSpecificTotals?: {
    totalPurchase: number;
    totalSales: number;
    profit: number;
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
  minimumFractionDigits: 0,
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
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [profitTimeline, setProfitTimeline] = useState<ProfitTimelinePoint[]>([]);
  const [monthlyProfit, setMonthlyProfit] = useState<MonthlyProfitDatum[]>([]);
  const [monthlyExpenses, setMonthlyExpenses] = useState<MonthlyExpenseDatum[]>([]);
  const [monthlyAverageSellingPrice, setMonthlyAverageSellingPrice] = useState<MonthlyAverageSellingPriceDatum[]>([]);
  const [monthlyAverageProfitPerItem, setMonthlyAverageProfitPerItem] = useState<MonthlyAverageProfitPerItemDatum[]>([]);
  const [monthlyAverageProfitMultiple, setMonthlyAverageProfitMultiple] = useState<MonthlyAverageProfitMultipleDatum[]>([]);
  const [salesByCategory, setSalesByCategory] = useState<SalesByCategoryDatum[]>([]);
  const [unsoldStockByCategory, setUnsoldStockByCategory] = useState<UnsoldStockByCategoryDatum[]>([]);
  const [yearSpecificTotals, setYearSpecificTotals] = useState<{ totalPurchase: number; totalSales: number; profit: number } | null>(null);
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
  const [viewMode, setViewMode] = useState<'global' | 'monthly'>('global');
  const [monthlyViewYear, setMonthlyViewYear] = useState<number>(new Date().getFullYear());
  const [monthlyViewMonth, setMonthlyViewMonth] = useState<number>(new Date().getMonth() + 1);
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
    vinted: boolean | null;
    ebay: boolean | null;
  }>>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
      const response = await fetch(`${API_BASE}/api/analytics/reporting?year=${selectedYear}`);
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'Failed to load analytics data');
        }
        const data: ReportingResponse = await response.json();
        setAvailableYears(data.availableYears);
        setProfitTimeline(data.profitTimeline);
        setMonthlyProfit(data.monthlyProfit);
        setMonthlyExpenses(data.monthlyExpenses);
        setMonthlyAverageSellingPrice(data.monthlyAverageSellingPrice || []);
        setMonthlyAverageProfitPerItem(data.monthlyAverageProfitPerItem || []);
        setMonthlyAverageProfitMultiple(data.monthlyAverageProfitMultiple || []);
        setSalesByCategory(data.salesByCategory || []);
        setUnsoldStockByCategory(data.unsoldStockByCategory || []);
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
        if (data.selectedYear !== selectedYear) {
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

  // Fetch monthly platform data when in monthly view
  useEffect(() => {
    if (viewMode === 'monthly') {
      const fetchMonthlyData = async () => {
        try {
          setMonthlyLoading(true);
          const url = `${API_BASE}/api/analytics/monthly-platform?year=${monthlyViewYear}&month=${monthlyViewMonth}`;
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
          console.log('[Monthly Platform] Cash flow calculation check:', {
            vintedProfit: data.vinted?.profit,
            ebayProfit: data.ebay?.profit,
            unsoldPurchases: data.unsoldPurchases,
            calculated: (data.vinted?.profit || 0) + (data.ebay?.profit || 0) - (data.unsoldPurchases || 0)
          });
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
  }, [viewMode, monthlyViewYear, monthlyViewMonth]);

  const timelineChartData = useMemo(() => {
    if (profitTimeline.length === 0) {
      return null;
    }

    const labels = profitTimeline.map((point) => {
      const date = new Date(point.label);
      return `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}`;
    });

    const values = profitTimeline.map((point) => point.profit);

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
          borderRadius: 6,
        },
      ],
    };
  }, [profitTimeline]);

  const monthlySalesData = useMemo(() => {
    const labels = monthLabels;
    const values = labels.map((_label, index) => {
      const found = monthlyProfit.find((item) => item.month === index + 1);
      return found ? found.totalSales ?? 0 : 0;
    });

    return {
      data: {
        labels,
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
            borderRadius: 6,
          },
        ],
      },
      hasData: values.some((value) => value !== 0),
    };
  }, [monthlyProfit]);

  const monthlyExpensesData = useMemo(() => {
    const labels = monthLabels;
    const values = labels.map((_label, index) => {
      const found = monthlyExpenses.find((item) => item.month === index + 1);
      return found ? found.expense ?? 0 : 0;
    });

    return {
      labels,
      datasets: [
        {
          label: 'Monthly Expenses',
          data: values,
          backgroundColor: 'rgba(255, 120, 120, 0.45)',
          borderColor: 'rgba(255, 120, 120, 0.8)',
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  }, [monthlyExpenses]);

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

  const monthlyAverageSellingPriceData = useMemo(() => {
    const labels = monthLabels;
    const values = labels.map((_label, index) => {
      const found = monthlyAverageSellingPrice.find((item) => item.month === index + 1);
      return found ? found.average ?? 0 : 0;
    });

    return {
      labels,
      datasets: [
        {
          label: 'Average Selling Price',
          data: values,
          backgroundColor: 'rgba(140, 255, 195, 0.45)',
          borderColor: 'rgba(140, 255, 195, 0.8)',
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  }, [monthlyAverageSellingPrice]);

  const monthlyAverageProfitPerItemData = useMemo(() => {
    const labels = monthLabels;
    const values = labels.map((_label, index) => {
      const found = monthlyAverageProfitPerItem.find((item) => item.month === index + 1);
      return found ? found.average ?? 0 : 0;
    });

    return {
      labels,
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
          borderRadius: 6,
        },
      ],
    };
  }, [monthlyAverageProfitPerItem]);

  const monthlyAverageProfitMultipleData = useMemo(() => {
    const labels = monthLabels;
    const values = labels.map((_label, index) => {
      const found = monthlyAverageProfitMultiple.find((item) => item.month === index + 1);
      return found ? found.average ?? 0 : 0;
    });

    return {
      labels,
      datasets: [
        {
          label: 'Average Profit Multiple',
          data: values,
          backgroundColor: 'rgba(255, 214, 91, 0.45)',
          borderColor: 'rgba(255, 214, 91, 0.8)',
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  }, [monthlyAverageProfitMultiple]);

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

  return (
    <div className="reporting-container">

      {error && <div className="reporting-error">{error}</div>}
      {loading && <div className="reporting-status">Loading analytics...</div>}

      {/* Toggle for Global/Monthly view */}
      <div className="view-toggle-container">
        <button
          className={`view-toggle-button ${viewMode === 'global' ? 'active' : ''}`}
          onClick={() => setViewMode('global')}
        >
          Global
        </button>
        <button
          className={`view-toggle-button ${viewMode === 'monthly' ? 'active' : ''}`}
          onClick={() => setViewMode('monthly')}
        >
          Monthly
        </button>
      </div>

      {/* Global View */}
      <div className={`view-content ${viewMode === 'global' ? 'active' : ''}`}>
        {!loading && !error && (
          <>
          {/* Row 1: Total Company Profit, Total Sales, Unsold Inventory Value, Current Sales */}
          <div className="reporting-summary">
            <div className="total-profit-card">
              <div className="total-profit-label">Total Company Profit ({selectedYear})</div>
              <div className={`total-profit-value ${totalProfit >= 0 ? 'positive' : 'negative'}`}>
                {formatCurrency(totalProfit)}
              </div>
              <div className="total-profit-description">All Sales - All Expenses for {selectedYear}</div>
            </div>
            {yearSpecificTotals && (
              <div className="total-profit-card">
                <div className="total-profit-label">Total Sales ({selectedYear})</div>
                <div className="total-profit-value positive">
                  {formatCurrency(yearSpecificTotals.totalSales)}
                </div>
                <div className="total-profit-description">All sales for {selectedYear}</div>
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

          {/* Row 2: Average Profit per Item, Average Selling Price, Average Profit Multiple (All Time), Average Days to Sell */}
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
                <div className="total-profit-label">Items ({selectedYear})</div>
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
                  onChange={(event) => setSelectedYear(Number(event.target.value))}
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
                  {availableYears.length === 0 && <option value={selectedYear}>{selectedYear}</option>}
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

          <div className="reporting-grid">
          <section className="reporting-card">
            <div className="card-header">
              <h2>Month-on-Month Profit</h2>
            </div>
            {timelineChartData ? (
              <div className="chart-wrapper">
                <Bar data={timelineChartData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No profit data available yet.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Sales by Month</h2>
            </div>
            {monthlySalesData.hasData ? (
              <div className="chart-wrapper">
                <Bar data={monthlySalesData.data} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No recorded sales for {selectedYear}.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Expenses by Month</h2>
            </div>
            <div className="chart-wrapper">
              <Bar data={monthlyExpensesData} options={chartOptions} />
            </div>
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
              <h2>Unsold Stock by Category</h2>
            </div>
            {unsoldStockByCategoryData ? (
              <div className="chart-wrapper">
                <Bar data={unsoldStockByCategoryData} options={chartOptions} />
              </div>
            ) : (
              <div className="reporting-empty">No unsold stock data available for {selectedYear}.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Average Selling Price by Month</h2>
            </div>
            {monthlyAverageSellingPrice.length > 0 ? (
              <div className="chart-wrapper">
                <Bar 
                  data={monthlyAverageSellingPriceData} 
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
              <div className="reporting-empty">No sales data available for {selectedYear}.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Average Profit per Item by Month</h2>
            </div>
            {monthlyAverageProfitPerItem.length > 0 ? (
              <div className="chart-wrapper">
                <Bar 
                  data={monthlyAverageProfitPerItemData} 
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
              <div className="reporting-empty">No sales data available for {selectedYear}.</div>
            )}
          </section>

          <section className="reporting-card">
            <div className="card-header">
              <h2>Average Profit Multiple by Month</h2>
            </div>
            <div className="chart-wrapper">
              <Bar 
                data={monthlyAverageProfitMultipleData} 
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

      {/* Monthly View */}
      <div className={`view-content ${viewMode === 'monthly' ? 'active' : ''}`}>
        {monthlyLoading && <div className="reporting-status">Loading monthly data...</div>}
        {!monthlyLoading && (
          <>
            {/* Month and Year Filters */}
            <div className="monthly-filters">
              <div className="monthly-filter-group">
                <label className="monthly-filter-label">Year</label>
                <select
                  value={monthlyViewYear}
                  onChange={(e) => setMonthlyViewYear(Number(e.target.value))}
                  className="monthly-filter-select"
                >
                  {availableYears.length === 0 && <option value={monthlyViewYear}>{monthlyViewYear}</option>}
                  {availableYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
              <div className="monthly-filter-group">
                <label className="monthly-filter-label">Month</label>
                <select
                  value={monthlyViewMonth}
                  onChange={(e) => setMonthlyViewMonth(Number(e.target.value))}
                  className="monthly-filter-select"
                >
                  {monthLabels.map((label, index) => (
                    <option key={index + 1} value={index + 1}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Vinted Row */}
            <div className="monthly-platform-row">
              <div className="platform-logo-cell">
                <img src="/images/vinted-icon.svg" alt="Vinted" className="platform-logo" />
              </div>
              <div className="platform-stat-cell">
                <div className="platform-stat-label">Total Spent</div>
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

            {/* eBay Row */}
            <div className="monthly-platform-row">
              <div className="platform-logo-cell">
                <img src="/images/ebay-icon.svg" alt="eBay" className="platform-logo" />
              </div>
              <div className="platform-stat-cell">
                <div className="platform-stat-label">Total Spent</div>
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

            {/* Unsold Purchases Row */}
            <div className="monthly-platform-row">
              <div className="platform-logo-cell">
                <img src="/images/to-list-icon.svg" alt="To List" className="platform-logo" />
              </div>
              <div className="platform-stat-cell">
                <div className="platform-stat-label">Total Spent</div>
                <div className="platform-stat-value negative">
                  {formatCurrency(unsoldPurchases)}
                </div>
              </div>
              <div className="platform-stat-cell">
                {/* Empty column */}
              </div>
              <div className="platform-stat-cell">
                <div className="platform-stat-label">Cash Flow Profit</div>
                <div className={`platform-stat-value ${cashFlowProfit >= 0 ? 'positive' : 'negative'}`}>
                  {formatCurrency(cashFlowProfit)}
                </div>
              </div>
            </div>

            {/* Items Not Tagged Correctly */}
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
                        {(!item.vinted && !item.ebay) && (
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
      </div>
    </div>
  );
};

export default Reporting;
