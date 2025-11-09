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

interface ReportingResponse {
  availableYears: number[];
  selectedYear: number;
  profitTimeline: ProfitTimelinePoint[];
  monthlyProfit: MonthlyProfitDatum[];
  monthlyExpenses: MonthlyExpenseDatum[];
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="reporting-container">
      <div className="reporting-header">
        <h1>Performance Reporting</h1>
        <div className="year-filter">
          <label htmlFor="reporting-year">Year</label>
          <select
            id="reporting-year"
            value={selectedYear}
            onChange={(event) => setSelectedYear(Number(event.target.value))}
          >
            {availableYears.length === 0 && <option value={selectedYear}>{selectedYear}</option>}
            {availableYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="reporting-error">{error}</div>}
      {loading && <div className="reporting-status">Loading analytics...</div>}

      {!loading && !error && (
        <div className="reporting-grid">
          <section className="reporting-card">
            <div className="card-header">
              <h2>Month-on-Month Profit</h2>
              <p>Profit trend across all recorded months.</p>
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
              <p>Monthly sales totals for {selectedYear}.</p>
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
              <p>Total purchase costs during {selectedYear}.</p>
            </div>
            <div className="chart-wrapper">
              <Bar data={monthlyExpensesData} options={chartOptions} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default Reporting;
