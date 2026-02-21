import React, { useState, useEffect, useMemo } from 'react';
import './Config.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

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
}

interface StockApiResponse {
  rows: StockRow[];
  count: number;
}

const MISC_BRAND_ID = 39;

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

const formatDate = (value: Nullable<string>) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  }).format(date);
};

type ConfigMenu = 'untagged-brand' | 'no-ebay-id' | 'no-vinted-id';

const Config: React.FC = () => {
  const [activeMenu, setActiveMenu] = useState<ConfigMenu>('untagged-brand');
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoTaggingId, setAutoTaggingId] = useState<number | null>(null);
  const [autoTaggedHiddenIds, setAutoTaggedHiddenIds] = useState<Set<number>>(new Set());

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
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (err: any) {
      console.error('Stock load error:', err);
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        setError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
      } else {
        setError(err.message || 'Unable to load stock data');
      }
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStock();
  }, []);

  // Filter rows based on active menu
  const filteredRows = useMemo(() => {
    if (activeMenu === 'untagged-brand') {
      return rows.filter(
        (row) => (row.brand_id === null || row.brand_id === undefined) && !autoTaggedHiddenIds.has(Number(row.id))
      );
    }
    if (activeMenu === 'no-ebay-id') {
      return rows.filter(row => !row.ebay_id || row.ebay_id.trim() === '');
    }
    if (activeMenu === 'no-vinted-id') {
      return rows.filter(row => !row.vinted_id || row.vinted_id.trim() === '');
    }
    return [];
  }, [rows, activeMenu, autoTaggedHiddenIds]);

  const handleEditItem = (row: StockRow) => {
    window.open(`/stock?editId=${row.id}`, '_blank');
  };

  const handleAutoTag = async (row: StockRow) => {
    try {
      setAutoTaggingId(row.id);
      setError(null);

      const updateResponse = await fetch(`${API_BASE}/api/stock/${row.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand_id: MISC_BRAND_ID
        }),
      });

      if (!updateResponse.ok) {
        const message = await updateResponse.text();
        throw new Error(message || 'Failed to auto-tag item');
      }

      const normalizedId = Number(row.id);
      setAutoTaggedHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(normalizedId);
        return next;
      });

      // Remove immediately for responsive UX, then refresh from server.
      setRows((prevRows) => prevRows.filter((item) => Number(item.id) !== normalizedId));

      await loadStock();
    } catch (err: any) {
      console.error('AutoTag error:', err);
      setError(err?.message || 'Unable to auto-tag item');
    } finally {
      setAutoTaggingId(null);
    }
  };

  return (
    <div className="config-container">
      {error && <div className="config-error">{error}</div>}

      <div className="config-layout">
        {/* Sidebar */}
        <div className="config-sidebar">
          <div className="config-sidebar-header">
            <h2>Settings</h2>
          </div>
          <nav className="config-sidebar-menu">
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'untagged-brand' ? 'active' : ''}`}
              onClick={() => setActiveMenu('untagged-brand')}
            >
              UnTagged Brand
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'no-ebay-id' ? 'active' : ''}`}
              onClick={() => setActiveMenu('no-ebay-id')}
            >
              No eBay ID
            </button>
            <button
              type="button"
              className={`config-menu-item ${activeMenu === 'no-vinted-id' ? 'active' : ''}`}
              onClick={() => setActiveMenu('no-vinted-id')}
            >
              No Vinted ID
            </button>
          </nav>
        </div>

        {/* Main Content */}
        <div className="config-content">
          {activeMenu === 'untagged-brand' && (
            <div className="config-section">
              <div className="config-section-header">
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={loadStock}
                  title="Refresh list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>
              {loading ? (
                <div className="config-loading">Loading...</div>
              ) : filteredRows.length === 0 ? (
                <div className="config-empty">No items found without a brand assigned.</div>
              ) : (
                <div className="config-grid">
                  {filteredRows.map((row) => (
                    <div key={row.id} className="config-grid-item">
                      <div className="config-grid-item-header">
                        <span className="config-grid-sku">SKU: {row.id}</span>
                        <button
                          type="button"
                          className="config-grid-edit-button"
                          onClick={() => handleEditItem(row)}
                        >
                          Edit
                        </button>
                      </div>
                      <div className="config-grid-item-body">
                        <div className="config-grid-field">
                          <span className="config-grid-label">Item Name</span>
                          <span className="config-grid-value">{row.item_name || '—'}</span>
                        </div>
                        <div className="config-grid-field">
                          <span className="config-grid-label">Purchase Price</span>
                          <span className="config-grid-value">{formatCurrency(row.purchase_price)}</span>
                        </div>
                        {row.purchase_date && (
                          <div className="config-grid-field">
                            <span className="config-grid-label">Purchase Date</span>
                            <span className="config-grid-value">{formatDate(row.purchase_date)}</span>
                          </div>
                        )}
                      </div>
                      <div className="config-grid-item-footer">
                        <button
                          type="button"
                          className="config-grid-autotag-button"
                          onClick={() => handleAutoTag(row)}
                          disabled={autoTaggingId === row.id}
                        >
                          {autoTaggingId === row.id ? 'AutoTagging...' : 'AutoTag'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeMenu === 'no-ebay-id' && (
            <div className="config-section">
              <div className="config-section-header">
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={loadStock}
                  title="Refresh list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>
              {loading ? (
                <div className="config-loading">Loading...</div>
              ) : filteredRows.length === 0 ? (
                <div className="config-empty">No items found without an eBay ID.</div>
              ) : (
                <div className="config-grid">
                  {filteredRows.map((row) => (
                    <div key={row.id} className="config-grid-item">
                      <div className="config-grid-item-header">
                        <span className="config-grid-sku">SKU: {row.id}</span>
                        <button
                          type="button"
                          className="config-grid-edit-button"
                          onClick={() => handleEditItem(row)}
                        >
                          Edit
                        </button>
                      </div>
                      <div className="config-grid-item-body">
                        <div className="config-grid-field">
                          <span className="config-grid-label">Item Name</span>
                          <span className="config-grid-value">{row.item_name || '—'}</span>
                        </div>
                        <div className="config-grid-field">
                          <span className="config-grid-label">Purchase Price</span>
                          <span className="config-grid-value">{formatCurrency(row.purchase_price)}</span>
                        </div>
                        {row.purchase_date && (
                          <div className="config-grid-field">
                            <span className="config-grid-label">Purchase Date</span>
                            <span className="config-grid-value">{formatDate(row.purchase_date)}</span>
                          </div>
                        )}
                        {row.vinted_id && (
                          <div className="config-grid-field">
                            <span className="config-grid-label">Vinted ID</span>
                            <span className="config-grid-value">{row.vinted_id}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeMenu === 'no-vinted-id' && (
            <div className="config-section">
              <div className="config-section-header">
                <button
                  type="button"
                  className="config-refresh-button"
                  onClick={loadStock}
                  title="Refresh list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                  </svg>
                </button>
              </div>
              {loading ? (
                <div className="config-loading">Loading...</div>
              ) : filteredRows.length === 0 ? (
                <div className="config-empty">No items found without a Vinted ID.</div>
              ) : (
                <div className="config-grid">
                  {filteredRows.map((row) => (
                    <div key={row.id} className="config-grid-item">
                      <div className="config-grid-item-header">
                        <span className="config-grid-sku">SKU: {row.id}</span>
                        <button
                          type="button"
                          className="config-grid-edit-button"
                          onClick={() => handleEditItem(row)}
                        >
                          Edit
                        </button>
                      </div>
                      <div className="config-grid-item-body">
                        <div className="config-grid-field">
                          <span className="config-grid-label">Item Name</span>
                          <span className="config-grid-value">{row.item_name || '—'}</span>
                        </div>
                        <div className="config-grid-field">
                          <span className="config-grid-label">Purchase Price</span>
                          <span className="config-grid-value">{formatCurrency(row.purchase_price)}</span>
                        </div>
                        {row.purchase_date && (
                          <div className="config-grid-field">
                            <span className="config-grid-label">Purchase Date</span>
                            <span className="config-grid-value">{formatDate(row.purchase_date)}</span>
                          </div>
                        )}
                        {row.ebay_id && (
                          <div className="config-grid-field">
                            <span className="config-grid-label">eBay ID</span>
                            <span className="config-grid-value">{row.ebay_id}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Config;
