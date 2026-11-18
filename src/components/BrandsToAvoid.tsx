import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getApiBase } from '../utils/apiBase';
import { StockFormDropdown } from './StockFormDropdown';
import './Reporting.css';

const API_BASE = getApiBase();

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatCurrency = (value: number) => currencyFormatter.format(value ?? 0);

function netClass(value: number): string {
  if (value > 0) return 'brand-avoid-net--profit';
  if (value < 0) return 'brand-avoid-net--loss';
  return 'brand-avoid-net--even';
}

function formatNet(value: number): string {
  if (value < 0) return `£-${formatCurrency(Math.abs(value)).replace('£', '')}`;
  return formatCurrency(value);
}

const MIN_STOCK_OPTIONS = [
  { value: '5', label: '5 or more in stock' },
  { value: '10', label: '10 or more in stock' },
  { value: '15', label: '15 or more in stock' },
  { value: '20', label: '20 or more in stock' },
  { value: '25', label: '25 or more in stock' },
];

interface AvoidCandidateRow {
  brandName: string;
  sampleBrandId: number;
  unsoldCount: number;
  soldCount: number;
  recentSoldCount: number;
  totalProfit: number;
  avgProfitPerItem: number | null;
  avoidScore: number;
}

interface DepartmentRow {
  id: number;
  name: string;
}

export default function BrandsToAvoid() {
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [showScoreInfo, setShowScoreInfo] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [minStockFilter, setMinStockFilter] = useState('10');
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [rows, setRows] = useState<AvoidCandidateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const qs = departmentFilter ? `?department_id=${departmentFilter}` : '';
        const response = await fetch(`${API_BASE}/api/brands/avoid-candidates${qs}`);
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Could not load brands to avoid.');
        setDepartments(Array.isArray(data.departments) ? data.departments : []);
        setRows(Array.isArray(data.rows) ? data.rows : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load brands to avoid.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [departmentFilter]);

  const departmentOptions = useMemo(
    () => departments.map((d) => ({ value: String(d.id), label: d.name })),
    [departments]
  );

  const minStock = Number(minStockFilter) || 0;
  const filteredRows = useMemo(() => rows.filter((r) => r.unsoldCount >= minStock), [rows, minStock]);

  return (
    <div className="channel-analytics-view">
      <div className="channel-analytics-toolbar">
        <div className="channel-toggle-group" role="group" aria-label="View">
          <div className="channel-toggle-buttons">
            <button
              type="button"
              className={`channel-toggle-button ${viewMode === 'cards' ? 'active' : ''}`}
              aria-pressed={viewMode === 'cards'}
              onClick={() => setViewMode('cards')}
            >
              Cards
            </button>
            <button
              type="button"
              className={`channel-toggle-button ${viewMode === 'table' ? 'active' : ''}`}
              aria-pressed={viewMode === 'table'}
              onClick={() => setViewMode('table')}
            >
              Table
            </button>
          </div>
        </div>
        <StockFormDropdown
          value={departmentFilter}
          options={departmentOptions}
          onChange={setDepartmentFilter}
          placeholder="All Departments"
          includeEmptyOption
          ariaLabel="Filter brands to avoid by department"
          className="stock-analysis-filter-dropdown"
        />
        <StockFormDropdown
          value={minStockFilter}
          options={MIN_STOCK_OPTIONS}
          onChange={setMinStockFilter}
          placeholder="10 or more in stock"
          includeEmptyOption={false}
          ariaLabel="Minimum items in stock"
          className="stock-analysis-filter-dropdown"
        />
      </div>
      {showScoreInfo && (
        <div
          className="brand-avoid-score-modal-backdrop"
          onClick={() => setShowScoreInfo(false)}
          role="presentation"
        >
          <div
            className="reporting-card brand-avoid-score-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="brand-avoid-score-modal-title"
          >
            <div className="card-header">
              <h3 id="brand-avoid-score-modal-title">How the Avoid score is worked out</h3>
              <button
                type="button"
                className="brand-avoid-score-info-close"
                onClick={() => setShowScoreInfo(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p>
              <code>Avoid score = In stock × Slow-selling factor × Profit shortfall</code>
            </p>
            <ul>
              <li>
                <strong>In stock</strong> — the raw number of unsold items. Used as-is (not
                square-rooted or capped) so a brand with 1-2 unsold items barely scores even if
                everything else looks bad, while one with 20+ sitting unsold is weighted heavily.
              </li>
              <li>
                <strong>Slow-selling factor</strong> (0 to 1) ={' '}
                <code>1 − min(1, sold in last 120 days ÷ in stock)</code>. It's 0 when recent
                sales are keeping pace with current stock, rising to 1 when nothing has sold
                recently at all.
              </li>
              <li>
                <strong>Profit shortfall</strong> ={' '}
                <code>max(0, (£10 − average profit per item) ÷ £10)</code>. At or above the £10
                target this is exactly 0 — which collapses the whole score to 0, no matter how
                much stock is sitting there, because a genuinely profitable brand isn't a "stop
                buying" candidate just for being a slow mover. Below £10 it scales up, reaching 1
                at £0/item and climbing past 1 for an actual loss per item. A brand that's never
                sold is treated the same as a £0 item (shortfall of 1).
              </li>
            </ul>
          </div>
        </div>
      )}
      <section className="reporting-card">
        {error ? (
          <div className="reporting-error">{error}</div>
        ) : loading ? (
          <div className="reporting-empty">Loading…</div>
        ) : filteredRows.length === 0 ? (
          <div className="reporting-empty">No brands match this filter.</div>
        ) : viewMode === 'cards' ? (
          <div className="brand-avoid-row-cards">
            {filteredRows.map((row) => (
              <Link
                key={row.sampleBrandId}
                to={`/analytics?tab=brand&brand=${row.sampleBrandId}&brandPanel=brands`}
                className="reporting-card brand-avoid-row-card"
              >
                <span className="brand-avoid-row-card-name">{row.brandName}</span>
                <div className="brand-avoid-row-card-stat">
                  <span className="brand-avoid-row-card-stat-label">In stock</span>
                  <span className="brand-avoid-row-card-stat-value">{row.unsoldCount}</span>
                </div>
                <div className="brand-avoid-row-card-stat">
                  <span className="brand-avoid-row-card-stat-label">Sold (lifetime)</span>
                  <span className="brand-avoid-row-card-stat-value">{row.soldCount}</span>
                </div>
                <div className="brand-avoid-row-card-stat">
                  <span className="brand-avoid-row-card-stat-label">Sold last 120 days</span>
                  <span className="brand-avoid-row-card-stat-value">{row.recentSoldCount}</span>
                </div>
                <div className="brand-avoid-row-card-stat">
                  <span className="brand-avoid-row-card-stat-label">Avg profit/item</span>
                  <span className="brand-avoid-row-card-stat-value">
                    {row.avgProfitPerItem != null ? formatCurrency(row.avgProfitPerItem) : '—'}
                  </span>
                </div>
                <div className="brand-avoid-row-card-stat">
                  <span className="brand-avoid-row-card-stat-label">Total profit/loss</span>
                  <span className={`brand-avoid-row-card-stat-value ${netClass(row.totalProfit)}`}>
                    {formatNet(row.totalProfit)}
                  </span>
                </div>
                <div className="brand-avoid-row-card-stat">
                  <button
                    type="button"
                    className="brand-avoid-row-card-stat-label brand-avoid-score-trigger"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowScoreInfo((v) => !v);
                    }}
                  >
                    Avoid score ⓘ
                  </button>
                  <span className="brand-avoid-row-card-score">{row.avoidScore.toFixed(1)}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="brand-avoid-table-wrap">
            <table className="brand-avoid-table">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>In stock</th>
                  <th>Sold (lifetime)</th>
                  <th>Sold last 120 days</th>
                  <th>Avg profit/item</th>
                  <th>Total profit/loss</th>
                  <th>
                    <button
                      type="button"
                      className="brand-avoid-score-trigger"
                      onClick={() => setShowScoreInfo((v) => !v)}
                    >
                      Avoid score ⓘ
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.sampleBrandId}>
                    <td>
                      <Link
                        to={`/analytics?tab=brand&brand=${row.sampleBrandId}&brandPanel=brands`}
                        className="brand-website-link"
                      >
                        {row.brandName}
                      </Link>
                    </td>
                    <td>{row.unsoldCount}</td>
                    <td>{row.soldCount}</td>
                    <td>{row.recentSoldCount}</td>
                    <td>{row.avgProfitPerItem != null ? formatCurrency(row.avgProfitPerItem) : '—'}</td>
                    <td className={netClass(row.totalProfit)}>{formatNet(row.totalProfit)}</td>
                    <td>{row.avoidScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
