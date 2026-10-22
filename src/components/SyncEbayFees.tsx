import React, { useState } from 'react';
import { getApiBase, ebayOAuthStartUrl } from '../utils/apiBase';
import EbaySellerStatusIcon from './EbaySellerStatusIcon';
import './SyncEbayFees.css';

const API_BASE = getApiBase();

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

/** eBay's error text when a Finances/Fulfillment call isn't signed yet (see Settings > Site Settings > Integrations). */
const SIGNATURE_MISSING_HINT = 'x-ebay-signature-key';

const SyncEbayFees: React.FC = () => {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<SyncError | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  const [testItemId, setTestItemId] = useState('');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<SyncError | null>(null);
  const [testResult, setTestResult] = useState<SyncResult | null>(null);

  const runSync = async (ebayItemId?: string) => {
    const isTest = Boolean(ebayItemId);
    if (isTest) {
      setTesting(true);
      setTestError(null);
      setTestResult(null);
    } else {
      setSyncing(true);
      setError(null);
      setResult(null);
    }
    try {
      const res = await fetch(`${API_BASE}/api/accounting/sync-ebay-fees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ebayItemId ? { ebayItemId } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data?.details ? `${data?.error || 'Failed to sync eBay fees'} — ${data.details}` : data?.error;
        const syncError: SyncError = { message: message || 'Failed to sync eBay fees', code: data?.code };
        throw syncError;
      }
      if (isTest) {
        setTestResult(data);
      } else {
        setResult(data);
      }
    } catch (err) {
      const syncError: SyncError =
        err && typeof err === 'object' && 'message' in err
          ? (err as SyncError)
          : { message: 'Failed to sync eBay fees' };
      if (isTest) {
        setTestError(syncError);
      } else {
        setError(syncError);
      }
    } finally {
      if (isTest) {
        setTesting(false);
      } else {
        setSyncing(false);
      }
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

  const renderResult = (data: SyncResult) => (
    <div className="stock-success sync-ebay-fees-result">
      {data.message}
      <dl className="sync-ebay-fees-summary">
        <div>
          <dt>Items checked</dt>
          <dd>{data.itemsChecked}</dd>
        </div>
        <div>
          <dt>Items updated</dt>
          <dd>{data.itemsUpdated}</dd>
        </div>
        <div>
          <dt>Fee rows written</dt>
          <dd>{data.feeRowsWritten}</dd>
        </div>
      </dl>
      {data.items && data.items.length > 0 && (
        <ul className="sync-ebay-fees-items">
          {data.items.map((item) => (
            <li key={`${item.stockId}-${item.ebayItemId}`}>
              <strong>Stock #{item.stockId}</strong> (eBay {item.ebayItemId}) — {item.status}
              {item.note ? `: ${item.note}` : ''}
              {item.rows && item.rows.length > 0 && (
                <ul>
                  {item.rows.map((row) => (
                    <li key={row.feeType}>
                      {row.feeType}: {row.amount.toFixed(2)} {row.currency}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="sync-ebay-fees">
      <div className="sync-ebay-fees-status-row">
        <EbaySellerStatusIcon returnPath="/accounting?tab=sync-ebay-fees" />
      </div>
      <div className="sync-ebay-fees-button-row">
        <button type="button" className="new-entry-button" onClick={() => runSync()} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync eBay Fees'}
        </button>
      </div>
      {error && renderError(error)}
      {result && renderResult(result)}

      <div className="sync-ebay-fees-test">
        <h3>Test a single item</h3>
        <p className="sync-ebay-fees-muted">
          Enter the eBay item ID of one sold item to run the same sync for just that item.
        </p>
        <div className="sync-ebay-fees-test-row">
          <input
            type="text"
            value={testItemId}
            onChange={(e) => setTestItemId(e.target.value)}
            placeholder="eBay item ID"
            className="sync-ebay-fees-test-input"
          />
          <button
            type="button"
            className="new-entry-button"
            onClick={() => runSync(testItemId.trim())}
            disabled={testing || !testItemId.trim()}
          >
            {testing ? 'Testing…' : 'Test Item'}
          </button>
        </div>
        {testError && renderError(testError)}
        {testResult && renderResult(testResult)}
      </div>
    </div>
  );
};

export default SyncEbayFees;
