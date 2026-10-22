import React, { useEffect, useState } from 'react';
import { getApiBase } from '../utils/apiBase';
import './StockExpenses.css';

const API_BASE = getApiBase();

interface StockExpenseRow {
  stockId: number;
  itemName: string | null;
  platform: string;
  ebayId: string | null;
  orderId: string | null;
  purchasePrice: number | null;
  salePrice: number | null;
  sellingFees: number;
  buyerPostage: number;
  postagePaid: number;
  totalPricePaid: number | null;
  finalProfit: number | null;
  hasFeeData: boolean;
}

function formatGbp(value: number | null): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
}

const StockExpenses: React.FC = () => {
  const [rows, setRows] = useState<StockExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/accounting/stock-expenses`);
        if (!res.ok) throw new Error('Failed to load stock expenses');
        const data = await res.json();
        if (!cancelled) setRows(Array.isArray(data.rows) ? data.rows : []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load stock expenses');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="stock-expenses">
      {error && <div className="stock-error">{error}</div>}
      {loading ? (
        <p className="stock-expenses-muted">Loading…</p>
      ) : (
        <div className="table-wrapper">
          <table className="stock-table">
            <thead>
              <tr>
                <th>Stock ID</th>
                <th>Name</th>
                <th>Sold On</th>
                <th>eBay ID</th>
                <th>Order Number</th>
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
                  <td colSpan={12} className="empty-state">
                    No sold items found.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.stockId} className={row.hasFeeData ? undefined : 'stock-expenses-row--unsynced'}>
                  <td>{row.stockId}</td>
                  <td>{row.itemName ?? '—'}</td>
                  <td>{row.platform || '—'}</td>
                  <td>{row.ebayId ?? '—'}</td>
                  <td>{row.orderId ?? '—'}</td>
                  <td>{formatGbp(row.purchasePrice)}</td>
                  <td>{formatGbp(row.salePrice)}</td>
                  <td>{row.hasFeeData ? formatGbp(row.buyerPostage) : '—'}</td>
                  <td>{formatGbp(row.totalPricePaid)}</td>
                  <td>{row.hasFeeData ? formatGbp(row.sellingFees) : '—'}</td>
                  <td>{row.hasFeeData ? formatGbp(row.postagePaid) : '—'}</td>
                  <td>{row.hasFeeData ? formatGbp(row.finalProfit) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default StockExpenses;
