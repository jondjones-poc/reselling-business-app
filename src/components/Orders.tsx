import React, { useEffect, useState, useMemo } from 'react';
import './Orders.css';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

type Nullable<T> = T | null | undefined;

interface StockRow {
  id: number;
  item_name: Nullable<string>;
  category: Nullable<string>;
  purchase_price: Nullable<string | number>;
  purchase_date: Nullable<string>;
  sale_date: Nullable<string>;
  sale_price: Nullable<string | number>;
  sold_platform: Nullable<string>;
  net_profit: Nullable<string | number>;
  vinted: Nullable<boolean>;
  ebay: Nullable<boolean>;
  vinted_id: Nullable<string>;
  ebay_id: Nullable<string>;
  depop_id: Nullable<string>;
}

interface StockApiResponse {
  rows: StockRow[];
  count: number;
}

interface OrderItem {
  id: number;
  item_name: Nullable<string>;
  purchase_price: Nullable<string | number>;
  vinted: Nullable<boolean>;
  ebay: Nullable<boolean>;
  vinted_id: Nullable<string>;
  ebay_id: Nullable<string>;
  depop_id: Nullable<string>;
  sold_platform: Nullable<string>;
}

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

interface OrdersApiResponse {
  rows: Array<{
    order_id: number;
    stock_id: number;
    created_at: string;
    updated_at: string;
    id: number;
    item_name: Nullable<string>;
    category: Nullable<string>;
    purchase_price: Nullable<string | number>;
    purchase_date: Nullable<string>;
    sale_date: Nullable<string>;
    sale_price: Nullable<string | number>;
    sold_platform: Nullable<string>;
    net_profit: Nullable<string | number>;
    vinted: Nullable<boolean>;
    ebay: Nullable<boolean>;
    vinted_id: Nullable<string>;
    ebay_id: Nullable<string>;
    depop_id: Nullable<string>;
  }>;
  count: number;
}

const Orders: React.FC = () => {
  const [allStock, setAllStock] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [clearConfirmCount, setClearConfirmCount] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // Load all stock data
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
      setAllStock(Array.isArray(data.rows) ? data.rows : []);
    } catch (err: any) {
      console.error('Stock load error:', err);
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        setError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
      } else {
        setError(err.message || 'Unable to load stock data');
      }
      setAllStock([]);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to get listing platform display
  const getListingPlatform = (vinted: Nullable<boolean>, ebay: Nullable<boolean>): string => {
    const platforms: string[] = [];
    if (vinted === true) platforms.push('Vinted');
    if (ebay === true) platforms.push('eBay');
    if (platforms.length === 0) return 'Not Listed';
    return platforms.join(', ');
  };

  // Load order items from API
  const loadOrders = async () => {
    try {
      setOrdersLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/orders`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to load orders data');
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(text || 'Unexpected response format');
      }

      const data: OrdersApiResponse = await response.json();
      // Transform API response to OrderItem format
      const transformed = (data.rows ?? []).map((row) => ({
        id: row.id,
        item_name: row.item_name,
        purchase_price: row.purchase_price,
        vinted: row.vinted,
        ebay: row.ebay,
        vinted_id: row.vinted_id,
        ebay_id: row.ebay_id,
        depop_id: row.depop_id,
        sold_platform: row.sold_platform
      }));
      setOrderItems(transformed);
    } catch (err: any) {
      console.error('Orders load error:', err);
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        setError('Unable to connect to server. Please ensure the backend server is running on port 5003.');
      } else {
        setError(err.message || 'Unable to load orders data');
      }
      setOrderItems([]);
    } finally {
      setOrdersLoading(false);
    }
  };

  // Load stock and orders on mount
  useEffect(() => {
    loadStock();
    loadOrders();
  }, []);

  // Search results - search all items
  // Uses AND logic: all words must match (order doesn't matter)
  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) {
      return [];
    }

    const searchLower = searchTerm.toLowerCase().trim();
    const searchWords = searchLower.split(/\s+/).filter(word => word.length > 0);
    
    return allStock
      .filter((row) => {
        const itemName = row.item_name ? String(row.item_name).toLowerCase() : '';
        const vintedId = row.vinted_id ? String(row.vinted_id).toLowerCase() : '';
        const ebayId = row.ebay_id ? String(row.ebay_id).toLowerCase() : '';
        const skuId = String(row.id).toLowerCase();
        
        // For item name: match if ALL words are present (AND logic, order doesn't matter)
        const itemNameMatches = searchWords.length > 0 && searchWords.every(word => itemName.includes(word));
        
        // For IDs: exact match (for precise ID searches)
        const idMatches = vintedId.includes(searchLower) || ebayId.includes(searchLower) || skuId.includes(searchLower);
        
        return itemNameMatches || idMatches;
      })
      .slice(0, 10); // Limit to 10 results
  }, [searchTerm, allStock]);

  const handleAddItem = async (item: StockRow) => {
    // Check if item is already in the order (client-side check)
    if (orderItems.some((orderItem) => orderItem.id === item.id)) {
      return;
    }

    try {
      setOrdersLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stock_id: item.id }),
      });

      if (!response.ok) {
        let message = 'Failed to add item to orders';
        try {
          const errorBody = await response.json();
          message = errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      // Reload orders to get the updated list
      await loadOrders();
      setSearchTerm(''); // Clear search after adding
    } catch (err: any) {
      console.error('Add to orders error:', err);
      setError(err.message || 'Unable to add item to orders');
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleRemoveItem = async (id: number) => {
    try {
      setOrdersLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/api/orders/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        let message = 'Failed to remove item from orders';
        try {
          const errorBody = await response.json();
          message = errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      // Reload orders to get the updated list
      await loadOrders();
    } catch (err: any) {
      console.error('Remove from orders error:', err);
      setError(err.message || 'Unable to remove item from orders');
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleClearList = async () => {
    if (clearConfirmCount === 0) {
      setClearConfirmCount(1);
      // Reset confirmation count after 2 seconds
      setTimeout(() => {
        setClearConfirmCount(0);
      }, 2000);
    } else {
      // Confirmed - clear the list
      try {
        setOrdersLoading(true);
        setError(null);

        const response = await fetch(`${API_BASE}/api/orders`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          let message = 'Failed to clear orders';
          try {
            const errorBody = await response.json();
            message = errorBody?.error || message;
          } catch {
            const text = await response.text();
            message = text || message;
          }
          throw new Error(message);
        }

        // Reload orders to get the updated list (should be empty)
        await loadOrders();
        setClearConfirmCount(0);
      } catch (err: any) {
        console.error('Clear orders error:', err);
        setError(err.message || 'Unable to clear orders');
      } finally {
        setOrdersLoading(false);
      }
    }
  };

  return (
    <div className="orders-container">
      {error && <div className="orders-error">{error}</div>}

      <div className="orders-search-section">
        <div className="orders-search-wrapper">
          <input
            type="text"
            className="orders-search-input"
            placeholder="Search all items by name or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={loading}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="orders-search-clear"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {searchResults.length > 0 && (
          <div className="orders-search-results">
            {searchResults.map((item) => {
              const isEbaySold = item.sold_platform === 'eBay' && item.ebay_id;
              const isVintedSold = item.sold_platform === 'Vinted' && item.vinted_id;
              const itemName = item.item_name || '—';
              
              return (
                <div key={item.id} className="orders-search-result-item">
                  <span className="orders-result-sku">{item.id}</span>
                  <span className="orders-result-name">
                    {isEbaySold ? (
                      <a
                        href={`https://www.ebay.co.uk/itm/${item.ebay_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: 'var(--neon-primary-strong)',
                          cursor: 'pointer'
                        }}
                      >
                        {itemName}
                      </a>
                    ) : isVintedSold ? (
                      <a
                        href={`https://www.vinted.co.uk/items/${item.vinted_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          color: 'var(--neon-primary-strong)',
                          cursor: 'pointer'
                        }}
                      >
                        {itemName}
                      </a>
                    ) : (
                      itemName
                    )}
                  </span>
                  <span className="orders-result-price">
                    {formatCurrency(item.purchase_price)}
                  </span>
                  <button
                    type="button"
                    className="orders-add-button"
                    onClick={() => handleAddItem(item)}
                    disabled={orderItems.some((orderItem) => orderItem.id === item.id) || ordersLoading}
                  >
                    {orderItems.some((orderItem) => orderItem.id === item.id) ? 'Added' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {searchTerm && searchResults.length === 0 && !loading && (
          <div className="orders-no-results">
            No items found matching "{searchTerm}"
          </div>
        )}
      </div>

      {orderItems.length > 0 && (
        <div className="orders-list-section">
          <div className="orders-list-header">
            <h2>Items to Pick Up ({orderItems.length})</h2>
          </div>

          <div className="table-wrapper">
            <table className="orders-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Item Name</th>
                  <th>Price</th>
                  <th>Platform</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orderItems.map((item) => {
                  const isEbaySold = item.sold_platform === 'eBay' && item.ebay_id;
                  const isVintedSold = item.sold_platform === 'Vinted' && item.vinted_id;
                  const itemName = item.item_name || '—';
                  
                  return (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>
                        {isEbaySold ? (
                          <a
                            href={`https://www.ebay.co.uk/itm/${item.ebay_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: 'var(--neon-primary-strong)',
                              cursor: 'pointer'
                            }}
                          >
                            {itemName}
                          </a>
                        ) : isVintedSold ? (
                          <a
                            href={`https://www.vinted.co.uk/items/${item.vinted_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: 'var(--neon-primary-strong)',
                              cursor: 'pointer'
                            }}
                          >
                            {itemName}
                          </a>
                        ) : (
                          itemName
                        )}
                      </td>
                      <td>{formatCurrency(item.purchase_price)}</td>
                      <td>{getListingPlatform(item.vinted, item.ebay)}</td>
                      <td>
                        <button
                          type="button"
                          className="orders-remove-button"
                          onClick={() => handleRemoveItem(item.id)}
                          disabled={ordersLoading}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="orders-clear-list-section">
            <button
              type="button"
              className={`orders-clear-list-button ${clearConfirmCount > 0 ? 'confirm' : ''}`}
              onClick={handleClearList}
              disabled={ordersLoading}
            >
              {clearConfirmCount > 0 ? 'Click Again to Confirm Clear List' : 'Clear List'}
            </button>
          </div>
        </div>
      )}

      {orderItems.length === 0 && !loading && (
        <div className="orders-empty-state">
          <p>No items in your order list.</p>
          <p>Search for unsold items above to add them to your pickup list.</p>
        </div>
      )}
    </div>
  );
};

export default Orders;

