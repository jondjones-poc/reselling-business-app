import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiBase';

type DraftPrice = { value: number; currency: string };

type DraftSchedule = {
  id: number;
  offerId: string;
  scheduledFor: string | null;
  status: string;
  lastError?: string | null;
};

type DraftRow = {
  offerId: string;
  sku: string | null;
  title: string;
  format: string | null;
  status: string;
  availableQuantity: number | null;
  price: DraftPrice | null;
  schedule: DraftSchedule | null;
};

type Props = {
  /** True only when eBay is linked with listing/inventory access for this tab. */
  ebaySellerConnected: boolean;
};

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new Error(text.slice(0, 200) || res.statusText);
  }
}

function formatPrice(price: DraftPrice | null): string {
  if (!price || !Number.isFinite(price.value)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: price.currency || 'GBP',
    }).format(price.value);
  } catch {
    return `${price.value} ${price.currency || ''}`.trim();
  }
}

function isEbayAccessDenied(message: string | null | undefined, status?: number): boolean {
  if (status === 401 || status === 403) return true;
  return /access denied|insufficient|not authorized|invalid_scope|inventory/i.test(
    String(message || '')
  );
}

const OrdersScheduleListing: React.FC<Props> = ({ ebaySellerConnected }) => {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [dateByOffer, setDateByOffer] = useState<Record<string, string>>({});
  const [noteByOffer, setNoteByOffer] = useState<Record<string, string>>({});

  const loadDrafts = useCallback(async () => {
    if (!ebaySellerConnected) {
      setRows([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/ebay/listing-drafts');
      const data = await readJson<{
        rows?: DraftRow[];
        error?: string;
        code?: string;
        needsInventoryScope?: boolean;
      }>(res);
      if (!res.ok) {
        if (
          data.needsInventoryScope ||
          data.code === 'EBAY_INVENTORY_SCOPE' ||
          isEbayAccessDenied(data.error, res.status)
        ) {
          setRows([]);
          setError(null);
          return;
        }
        throw new Error(data.error || res.statusText);
      }
      const next = Array.isArray(data.rows) ? data.rows : [];
      setRows(next);
      setDateByOffer((prev) => {
        const merged = { ...prev };
        for (const row of next) {
          if (row.schedule?.scheduledFor && !merged[row.offerId]) {
            merged[row.offerId] = row.schedule.scheduledFor;
          }
        }
        return merged;
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not load drafts';
      if (isEbayAccessDenied(message)) {
        setRows([]);
        setError(null);
      } else {
        setRows([]);
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [ebaySellerConnected]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  const setOfferNote = (offerId: string, message: string) => {
    setNoteByOffer((prev) => ({ ...prev, [offerId]: message }));
    window.setTimeout(() => {
      setNoteByOffer((prev) => {
        if (prev[offerId] !== message) return prev;
        const next = { ...prev };
        delete next[offerId];
        return next;
      });
    }, 4000);
  };

  const handlePublishNow = async (row: DraftRow) => {
    if (busyOfferId) return;
    setBusyOfferId(row.offerId);
    try {
      const res = await apiFetch(
        `/api/ebay/listing-drafts/${encodeURIComponent(row.offerId)}/publish`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      const data = await readJson<{
        ok?: boolean;
        listingId?: string | null;
        error?: string;
        needsInventoryScope?: boolean;
        code?: string;
      }>(res);
      if (!res.ok) {
        if (
          data.needsInventoryScope ||
          data.code === 'EBAY_INVENTORY_SCOPE' ||
          isEbayAccessDenied(data.error, res.status)
        ) {
          return;
        }
        throw new Error(data.error || res.statusText);
      }
      setOfferNote(
        row.offerId,
        data.listingId ? `Published — listing ${data.listingId}` : 'Published'
      );
      await loadDrafts();
    } catch (e) {
      setOfferNote(row.offerId, e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setBusyOfferId(null);
    }
  };

  const handleSchedule = async (row: DraftRow) => {
    if (busyOfferId) return;
    const scheduledFor = (dateByOffer[row.offerId] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor)) {
      setOfferNote(row.offerId, 'Pick a schedule date first');
      return;
    }
    setBusyOfferId(row.offerId);
    try {
      const res = await apiFetch(
        `/api/ebay/listing-drafts/${encodeURIComponent(row.offerId)}/schedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduledFor,
            title: row.title,
            sku: row.sku,
            price: row.price,
          }),
        }
      );
      const data = await readJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || res.statusText);
      setOfferNote(row.offerId, `Scheduled for ${scheduledFor}`);
      await loadDrafts();
    } catch (e) {
      setOfferNote(row.offerId, e instanceof Error ? e.message : 'Schedule failed');
    } finally {
      setBusyOfferId(null);
    }
  };

  const handleCancelSchedule = async (row: DraftRow) => {
    if (busyOfferId) return;
    setBusyOfferId(row.offerId);
    try {
      const res = await apiFetch(
        `/api/ebay/listing-drafts/${encodeURIComponent(row.offerId)}/schedule`,
        { method: 'DELETE' }
      );
      const data = await readJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || res.statusText);
      setOfferNote(row.offerId, 'Schedule cancelled');
      await loadDrafts();
    } catch (e) {
      setOfferNote(row.offerId, e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setBusyOfferId(null);
    }
  };

  if (!ebaySellerConnected) {
    return null;
  }

  return (
    <div className="orders-schedule-listing">
      <div className="orders-schedule-listing-toolbar">
        <p className="orders-schedule-listing-lead">
          Unpublished eBay drafts. Publish now, or pick a date — the daily worker publishes due
          items.
        </p>
        <button
          type="button"
          className="orders-sales-edit-button"
          onClick={() => void loadDrafts()}
          disabled={loading || busyOfferId != null}
        >
          {loading ? 'Loading…' : 'Refresh drafts'}
        </button>
      </div>

      {error ? <div className="orders-error">{error}</div> : null}

      {loading && rows.length === 0 ? (
        <p className="orders-schedule-listing-muted">Loading drafts from eBay…</p>
      ) : rows.length === 0 && !error ? (
        <p className="orders-schedule-listing-muted">No unpublished drafts found.</p>
      ) : rows.length === 0 ? null : (
        <div className="orders-schedule-listing-table-wrap">
          <table className="orders-schedule-listing-table">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">SKU</th>
                <th scope="col">Price</th>
                <th scope="col">Scheduled</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const busy = busyOfferId === row.offerId;
                return (
                  <tr key={row.offerId}>
                    <td>
                      <div className="orders-schedule-listing-title">{row.title}</div>
                      <div className="orders-schedule-listing-meta">Offer {row.offerId}</div>
                      {noteByOffer[row.offerId] ? (
                        <div className="orders-schedule-listing-note">{noteByOffer[row.offerId]}</div>
                      ) : null}
                    </td>
                    <td>{row.sku || '—'}</td>
                    <td>{formatPrice(row.price)}</td>
                    <td>
                      <input
                        type="date"
                        className="orders-schedule-listing-date"
                        value={dateByOffer[row.offerId] || row.schedule?.scheduledFor || ''}
                        onChange={(e) =>
                          setDateByOffer((prev) => ({ ...prev, [row.offerId]: e.target.value }))
                        }
                        disabled={busy}
                      />
                      {row.schedule?.scheduledFor ? (
                        <div className="orders-schedule-listing-meta">
                          Queued {row.schedule.scheduledFor}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="orders-schedule-listing-actions">
                        <button
                          type="button"
                          className="orders-schedule-listing-publish"
                          disabled={busy}
                          onClick={() => void handlePublishNow(row)}
                        >
                          {busy ? 'Working…' : 'Publish now'}
                        </button>
                        <button
                          type="button"
                          className="orders-sales-edit-button"
                          disabled={busy}
                          onClick={() => void handleSchedule(row)}
                        >
                          Set schedule
                        </button>
                        {row.schedule ? (
                          <button
                            type="button"
                            className="orders-sales-edit-button"
                            disabled={busy}
                            onClick={() => void handleCancelSchedule(row)}
                          >
                            Cancel schedule
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default OrdersScheduleListing;
