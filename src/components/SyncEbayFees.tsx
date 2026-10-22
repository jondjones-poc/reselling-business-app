import React, { useMemo, useState } from 'react';
import { getApiBase, ebayOAuthStartUrl } from '../utils/apiBase';
import EbaySellerStatusIcon from './EbaySellerStatusIcon';
import './SyncEbayFees.css';

const API_BASE = getApiBase();

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface SyncResultItem {
  stockId: number;
  ebayItemId: string;
  orderId?: string;
  status: 'updated' | 'no_fee_data' | 'not_found';
  note?: string;
  rows?: { feeType: string; amount: number; currency: string }[];
}

interface SyncResult {
  itemsChecked: number;
  itemsUpdated: number;
  feeRowsWritten: number;
  message: string;
  items?: SyncResultItem[];
}

interface SyncError {
  message: string;
  code?: string;
}

function syncErrorFrom(message: string, code?: string): Error & SyncError {
  return Object.assign(new Error(message), { code });
}

/** eBay's error text when a Finances/Fulfillment call isn't signed yet (see Settings > Site Settings > Integrations). */
const SIGNATURE_MISSING_HINT = 'x-ebay-signature-key';

const SyncEbayFees: React.FC = () => {
  const now = new Date();
  const [syncYear, setSyncYear] = useState(now.getFullYear());
  const [syncMonth, setSyncMonth] = useState(now.getMonth() + 1);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<SyncError | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  const [testItemId, setTestItemId] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<SyncError | null>(null);
  const [testedItems, setTestedItems] = useState<SyncResultItem[]>([]);

  const [missingSyncing, setMissingSyncing] = useState(false);
  const [missingError, setMissingError] = useState<SyncError | null>(null);
  const [missingResult, setMissingResult] = useState<SyncResult | null>(null);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => currentYear - i);
  }, []);

  const runPeriodSync = async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/accounting/sync-ebay-fees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: syncYear, month: syncMonth }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data?.details ? `${data?.error || 'Failed to sync eBay fees'} — ${data.details}` : data?.error;
        throw syncErrorFrom(message || 'Failed to sync eBay fees', data?.code);
      }
      setResult(data);
    } catch (err) {
      setError(
        err && typeof err === 'object' && 'message' in err
          ? (err as SyncError)
          : { message: 'Failed to sync eBay fees' }
      );
    } finally {
      setSyncing(false);
    }
  };

  const runTestItem = async () => {
    const ebayItemId = testItemId.trim();
    if (!ebayItemId) return;
    setTesting(true);
    setTestError(null);
    try {
      const res = await fetch(`${API_BASE}/api/accounting/sync-ebay-fees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ebayItemId }),
      });
      const data: SyncResult = await res.json();
      if (!res.ok) {
        const message = (data as any)?.details
          ? `${(data as any)?.error || 'Failed to sync eBay fees'} — ${(data as any).details}`
          : (data as any)?.error;
        throw syncErrorFrom(message || 'Failed to sync eBay fees', (data as any)?.code);
      }
      if (data.items && data.items.length > 0) {
        setTestedItems((prev) => [
          ...data.items!.filter((item) => !prev.some((p) => p.stockId === item.stockId && p.ebayItemId === item.ebayItemId)),
          ...prev,
        ]);
      } else {
        setTestError({ message: data.message || `No sold eBay stock item found with eBay item ID "${ebayItemId}".` });
      }
      setTestItemId('');
    } catch (err) {
      setTestError(
        err && typeof err === 'object' && 'message' in err
          ? (err as SyncError)
          : { message: 'Failed to sync eBay fees' }
      );
    } finally {
      setTesting(false);
    }
  };

  const runMissingSync = async () => {
    setMissingSyncing(true);
    setMissingError(null);
    setMissingResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/accounting/sync-ebay-fees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyMissing: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data?.details ? `${data?.error || 'Failed to sync eBay fees'} — ${data.details}` : data?.error;
        throw syncErrorFrom(message || 'Failed to sync eBay fees', data?.code);
      }
      setMissingResult(data);
    } catch (err) {
      setMissingError(
        err && typeof err === 'object' && 'message' in err
          ? (err as SyncError)
          : { message: 'Failed to sync eBay fees' }
      );
    } finally {
      setMissingSyncing(false);
    }
  };

  const renderError = (err: SyncError) => (
    <div className="stock-error">
      {err.message}
      {err.code === 'EBAY_FINANCES_SCOPE_MISSING' && (
        <>
          {' '}
          <a href={ebayOAuthStartUrl('/accounting?tab=sync-ebay-fees')}>Reconnect eBay to grant it</a>.
        </>
      )}
      {err.message.includes(SIGNATURE_MISSING_HINT) && (
        <>
          {' '}
          <a href="/config?tab=integrations">Set up the eBay signing key in Settings</a>.
        </>
      )}
    </div>
  );

  const renderFeeTable = (items: SyncResultItem[]) => (
    <table className="sync-ebay-fees-table">
      <thead>
        <tr>
          <th>Stock #</th>
          <th>eBay item</th>
          <th>Status</th>
          <th>Buyer postage</th>
          <th>Selling fee</th>
          <th>Postage paid</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const byType = Object.fromEntries((item.rows ?? []).map((row) => [row.feeType, row]));
          return (
            <tr key={`${item.stockId}-${item.ebayItemId}`}>
              <td>{item.stockId}</td>
              <td>{item.ebayItemId}</td>
              <td className={`sync-ebay-fees-status sync-ebay-fees-status--${item.status}`}>
                {item.status === 'updated' ? 'Updated' : item.status === 'no_fee_data' ? 'No fee data' : 'Not found'}
                {item.note ? <span className="sync-ebay-fees-note"> — {item.note}</span> : null}
              </td>
              {(['buyer_postage', 'selling_fee', 'postage_paid'] as const).map((feeType) => (
                <td key={feeType}>
                  {byType[feeType] ? `${byType[feeType].amount.toFixed(2)} ${byType[feeType].currency}` : '—'}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="sync-ebay-fees">
      <div className="sync-ebay-fees-status-row">
        <EbaySellerStatusIcon returnPath="/accounting?tab=sync-ebay-fees" />
      </div>

      <div className="sync-ebay-fees-period-row">
        <select
          value={syncYear}
          onChange={(e) => setSyncYear(Number(e.target.value))}
          aria-label="Year to sync"
          className="sync-ebay-fees-select"
        >
          {yearOptions.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <select
          value={syncMonth}
          onChange={(e) => setSyncMonth(Number(e.target.value))}
          aria-label="Month to sync"
          className="sync-ebay-fees-select"
        >
          {MONTH_LABELS.map((label, index) => (
            <option key={index + 1} value={index + 1}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" className="new-entry-button" onClick={runPeriodSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Get eBay Order Details'}
        </button>
      </div>
      {error && renderError(error)}
      {result && (
        <div className="stock-success sync-ebay-fees-result">
          {result.message}
          <dl className="sync-ebay-fees-summary">
            <div>
              <dt>Items checked</dt>
              <dd>{result.itemsChecked}</dd>
            </div>
            <div>
              <dt>Items updated</dt>
              <dd>{result.itemsUpdated}</dd>
            </div>
            <div>
              <dt>Fee rows written</dt>
              <dd>{result.feeRowsWritten}</dd>
            </div>
          </dl>
          {result.items && result.items.length > 0 && renderFeeTable(result.items)}
        </div>
      )}

      <div className="sync-ebay-fees-test">
        <h3>Get Order Details For Item</h3>
        <div className="sync-ebay-fees-test-row">
          <input
            type="text"
            value={testItemId}
            onChange={(e) => setTestItemId(e.target.value)}
            placeholder="eBay item ID"
            className="sync-ebay-fees-test-input"
          />
          <button type="button" className="new-entry-button" onClick={runTestItem} disabled={testing || !testItemId.trim()}>
            {testing ? 'Getting…' : 'Get Order Details'}
          </button>
        </div>
        {testError && renderError(testError)}
        {testedItems.length > 0 && renderFeeTable(testedItems)}
      </div>

      <div className="sync-ebay-fees-test">
        <h3>Sync Missing Items</h3>
        <p className="sync-ebay-fees-muted">
          Goes through every sold eBay item with no synced order data yet, regardless of when it sold.
        </p>
        <div className="sync-ebay-fees-button-row">
          <button type="button" className="new-entry-button" onClick={runMissingSync} disabled={missingSyncing}>
            {missingSyncing ? 'Syncing…' : 'Sync Missing Items'}
          </button>
        </div>
        {missingError && renderError(missingError)}
        {missingResult && (
          <div className="stock-success sync-ebay-fees-result">
            {missingResult.message}
            <dl className="sync-ebay-fees-summary">
              <div>
                <dt>Items checked</dt>
                <dd>{missingResult.itemsChecked}</dd>
              </div>
              <div>
                <dt>Items updated</dt>
                <dd>{missingResult.itemsUpdated}</dd>
              </div>
              <div>
                <dt>Fee rows written</dt>
                <dd>{missingResult.feeRowsWritten}</dd>
              </div>
            </dl>
            {missingResult.items && missingResult.items.length > 0 && renderFeeTable(missingResult.items)}
          </div>
        )}
      </div>
    </div>
  );
};

export default SyncEbayFees;
