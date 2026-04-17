import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './StockRowInfoOverlay.css';

type Nullable<T> = T | null | undefined;

/** Row shape required by the info panel (matches sold stock API fields). */
export interface StockInfoPanelRow {
  id: number;
  item_name: Nullable<string>;
  purchase_price: Nullable<string | number>;
  purchase_date: Nullable<string>;
  sale_date: Nullable<string>;
  sale_price: Nullable<string | number>;
  net_profit: Nullable<string | number>;
  vinted_id: Nullable<string>;
  ebay_id: Nullable<string>;
  depop_id: Nullable<string>;
}

export function computeStockInfoPanelMetrics(row: StockInfoPanelRow) {
  const purchase =
    row.purchase_price !== null && row.purchase_price !== undefined
      ? Number(row.purchase_price)
      : NaN;

  const sale =
    row.sale_price !== null && row.sale_price !== undefined
      ? Number(row.sale_price)
      : row.sale_date === null || row.sale_date === undefined
        ? 0
        : NaN;

  const profit =
    row.net_profit !== null && row.net_profit !== undefined
      ? Number(row.net_profit)
      : !Number.isNaN(purchase) && !Number.isNaN(sale)
        ? sale - purchase
        : !Number.isNaN(purchase) && (row.sale_date === null || row.sale_date === undefined)
          ? -purchase
          : NaN;

  let profitMultiple: string | null = null;
  if (!Number.isNaN(purchase) && purchase > 0) {
    if (!Number.isNaN(sale) && sale > 0) {
      profitMultiple = `${(sale / purchase).toFixed(2)}x`;
    } else if (row.sale_date === null || row.sale_date === undefined) {
      profitMultiple = '0.00x';
    }
  }

  let daysForSale: number | null = null;
  if (row.purchase_date) {
    if (row.sale_date) {
      const purchaseDate = new Date(row.purchase_date);
      const saleDate = new Date(row.sale_date);
      if (!Number.isNaN(purchaseDate.getTime()) && !Number.isNaN(saleDate.getTime())) {
        const diffMs = saleDate.getTime() - purchaseDate.getTime();
        daysForSale = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      }
    } else {
      const purchaseDate = new Date(row.purchase_date);
      if (!Number.isNaN(purchaseDate.getTime())) {
        const diffMs = Date.now() - purchaseDate.getTime();
        daysForSale = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      }
    }
  }

  return {
    purchase,
    sale,
    profit,
    profitMultiple,
    daysForSale,
  };
}

export interface StockRowInfoOverlayProps {
  row: StockInfoPanelRow | null;
  anchorElement: HTMLElement | null;
  /** CSS class on positioned ancestor (no leading dot), e.g. orders-container */
  containerClassName?: string;
  formatCurrency: (value: Nullable<string | number>) => string;
  onDismiss: () => void;
}

export const StockRowInfoOverlay: React.FC<StockRowInfoOverlayProps> = ({
  row,
  anchorElement,
  containerClassName = 'orders-container',
  formatCurrency,
  onDismiss,
}) => {
  const navigate = useNavigate();
  const [isClosing, setIsClosing] = useState(false);
  const [offerPrice, setOfferPrice] = useState('');
  const [promotedFee, setPromotedFee] = useState('10');

  useEffect(() => {
    if (row) {
      setIsClosing(false);
      setOfferPrice('');
      setPromotedFee('10');
    }
  }, [row]);

  const requestDismiss = useCallback(() => {
    setIsClosing(true);
    window.setTimeout(() => {
      setIsClosing(false);
      onDismiss();
    }, 220);
  }, [onDismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && row) {
        requestDismiss();
      }
    };
    if (row) {
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }
  }, [row, requestDismiss]);

  if (!row || !anchorElement) return null;

  const container = anchorElement.closest(`.${containerClassName}`) as HTMLElement | null;
  if (!container) return null;

  const metrics = computeStockInfoPanelMetrics(row);
  const rect = anchorElement.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const top = rect.top - containerRect.top - 10;
  const width = containerRect.width;

  return (
    <div
      className={`stock-data-overlay${isClosing ? ' closing' : ''}`}
      style={{
        position: 'absolute',
        top: `${top}px`,
        left: 0,
        width: `${width}px`,
        zIndex: 1000,
      }}
    >
      <div className="stock-data-panel">
        <div className="stock-data-panel-grid" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="stock-data-close-button stock-data-close-button-mobile"
            onClick={(e) => {
              e.stopPropagation();
              requestDismiss();
            }}
            aria-label="Close panel"
          >
            × Close
          </button>
          <div className="stock-data-item stock-data-item-title">
            <div className="stock-data-value stock-data-title">{row.item_name || '—'}</div>
            <div className="stock-data-title-actions">
              <button
                type="button"
                className="stock-data-copy-button"
                onClick={(e) => {
                  e.stopPropagation();
                  const title = row.item_name || '';
                  if (title) {
                    void navigator.clipboard.writeText(title).catch((err) => {
                      console.error('Failed to copy:', err);
                    });
                  }
                }}
                aria-label="Copy item title to clipboard"
              >
                📋
              </button>
              <button
                type="button"
                className="stock-data-close-button stock-data-close-button-desktop"
                onClick={(e) => {
                  e.stopPropagation();
                  requestDismiss();
                }}
                aria-label="Close panel"
              >
                ×
              </button>
            </div>
          </div>
          <div className="stock-data-item">
            <div className="stock-data-label">Buy Price</div>
            <div className="stock-data-value">
              {!Number.isNaN(metrics.purchase) ? formatCurrency(metrics.purchase) : '—'}
            </div>
          </div>
          <div className="stock-data-item">
            <div className="stock-data-label">Sold Price</div>
            <div className="stock-data-value">
              {!Number.isNaN(metrics.sale)
                ? formatCurrency(metrics.sale)
                : row.sale_date === null || row.sale_date === undefined
                  ? formatCurrency(0)
                  : '—'}
            </div>
          </div>
          <div className="stock-data-item">
            <div className="stock-data-label">Profit</div>
            <div
              className={`stock-data-value ${!Number.isNaN(metrics.profit) && metrics.profit < 0 ? 'negative' : 'positive'}`}
            >
              {!Number.isNaN(metrics.profit) ? formatCurrency(metrics.profit) : '—'}
            </div>
          </div>
          <div className="stock-data-item">
            <div className="stock-data-label">Profit Multiple</div>
            <div className="stock-data-value">
              {metrics.profitMultiple ||
                ((row.sale_date === null || row.sale_date === undefined) &&
                !Number.isNaN(metrics.purchase) &&
                metrics.purchase > 0
                  ? '0.00x'
                  : '—')}
            </div>
          </div>
          <div className="stock-data-item">
            <div className="stock-data-label">Days For Sale</div>
            <div className="stock-data-value">
              {metrics.daysForSale !== null
                ? `${metrics.daysForSale} days`
                : row.purchase_date && (row.sale_date === null || row.sale_date === undefined)
                  ? '0 days'
                  : '—'}
            </div>
          </div>
          {row.vinted_id && row.vinted_id.trim() && (
            <div className="stock-data-item">
              <div className="stock-data-label">Vinted Listing</div>
              <div className="stock-data-value">
                <a
                  href={`https://www.vinted.co.uk/items/${row.vinted_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    color: 'var(--neon-primary-strong)',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  View on Vinted
                </a>
              </div>
            </div>
          )}
          {row.ebay_id && row.ebay_id.trim() && (
            <div className="stock-data-item">
              <div className="stock-data-label">eBay Listing</div>
              <div className="stock-data-value">
                <a
                  href={`https://www.ebay.co.uk/itm/${row.ebay_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    color: 'var(--neon-primary-strong)',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  View on eBay
                </a>
              </div>
            </div>
          )}
          {row.depop_id && row.depop_id.trim() && (
            <div className="stock-data-item">
              <div className="stock-data-label">Depop Listing</div>
              <div className="stock-data-value">
                <a
                  href={`https://www.depop.com/products/${row.depop_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    color: 'var(--neon-primary-strong)',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  View on Depop
                </a>
              </div>
            </div>
          )}
          <div className="stock-data-prediction-section" onClick={(e) => e.stopPropagation()}>
            <div className="stock-data-prediction-input-group">
              <label className="stock-data-label" htmlFor="stock-info-offer">
                Offer
              </label>
              <input
                id="stock-info-offer"
                type="number"
                value={offerPrice}
                onChange={(e) => setOfferPrice(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="stock-data-prediction-input"
              />
            </div>
            <div className="stock-data-prediction-input-group">
              <label className="stock-data-label" htmlFor="stock-info-fee">
                Fee (%)
              </label>
              <input
                id="stock-info-fee"
                type="number"
                value={promotedFee}
                onChange={(e) => setPromotedFee(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.stopPropagation()}
                placeholder="10"
                step="0.1"
                min="0"
                max="100"
                className="stock-data-prediction-input"
              />
            </div>
            <div className="stock-data-prediction-result">
              <span className="stock-data-label">Predicted Profit</span>
              <div className="stock-data-prediction-profit-text">
                {(() => {
                  const purchase = metrics.purchase;
                  const offer = parseFloat(offerPrice) || 0;
                  const feePercent = parseFloat(promotedFee) || 0;

                  if (Number.isNaN(purchase) || purchase <= 0 || offer <= 0) {
                    return '—';
                  }

                  const finalValueFeePercent = 10;
                  const totalFeePercent = finalValueFeePercent + feePercent;
                  const totalFees = purchase * (totalFeePercent / 100);
                  const predictedProfit = offer - purchase - totalFees;

                  return (
                    <span
                      className={`stock-data-prediction-profit-value ${predictedProfit >= 0 ? 'positive' : 'negative'}`}
                    >
                      {formatCurrency(predictedProfit)}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>
          <div className="stock-data-edit-button-container">
            <button
              type="button"
              className="stock-data-edit-button"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
                navigate(`/stock?editId=${row.id}`);
              }}
            >
              Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
