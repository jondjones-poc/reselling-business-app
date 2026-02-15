import React, { useEffect, useState, useMemo } from 'react';
import './Orders.css';

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
  category_id: Nullable<number>;
}

interface StockApiResponse {
  rows: StockRow[];
  count: number;
}

interface OrderItem {
  id: number;
  item_name: Nullable<string>;
  purchase_price: Nullable<string | number>;
  vinted_id: Nullable<string>;
  ebay_id: Nullable<string>;
  depop_id: Nullable<string>;
  sold_platform: Nullable<string>;
  brand_id: Nullable<number>;
  category_id: Nullable<number>;
}

interface Brand {
  id: number;
  brand_name: string;
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
    category_id: Nullable<number>;
    purchase_price: Nullable<string | number>;
    purchase_date: Nullable<string>;
    sale_date: Nullable<string>;
    sale_price: Nullable<string | number>;
    sold_platform: Nullable<string>;
    net_profit: Nullable<string | number>;
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
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string>('');
  const [updating, setUpdating] = useState(false);

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
  const getListingPlatform = (vinted_id: Nullable<string>, ebay_id: Nullable<string>): string => {
    const platforms: string[] = [];
    if (vinted_id && vinted_id.trim()) platforms.push('Vinted');
    if (ebay_id && ebay_id.trim()) platforms.push('eBay');
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
        vinted_id: row.vinted_id,
        ebay_id: row.ebay_id,
        depop_id: row.depop_id,
        sold_platform: row.sold_platform,
        brand_id: (row as any).brand_id ?? null,
        category_id: (row as any).category_id ?? null
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

  // Load brands
  const loadBrands = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/brands`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        setBrands(Array.isArray(data.rows) ? data.rows : []);
      }
    } catch (err) {
      console.error('Failed to load brands:', err);
    }
  };

  // Load stock and orders on mount
  useEffect(() => {
    loadStock();
    loadOrders();
    loadBrands();
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

  const handleEditItem = (item: OrderItem) => {
    setEditingItemId(item.id);
    setSelectedBrandId(item.brand_id ? String(item.brand_id) : '');
  };

  const handleCancelEdit = () => {
    setEditingItemId(null);
    setSelectedBrandId('');
  };

  const handleUpdateBrand = async () => {
    if (!editingItemId) return;

    try {
      setUpdating(true);
      setError(null);

      const brandIdValue = selectedBrandId === '' ? null : Number(selectedBrandId);
      
      const response = await fetch(`${API_BASE}/api/stock/${editingItemId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand_id: brandIdValue
        }),
      });

      if (!response.ok) {
        let message = 'Failed to update brand';
        try {
          const errorBody = await response.json();
          message = errorBody?.error || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      // Reload orders to get updated data
      await loadOrders();
      setEditingItemId(null);
      setSelectedBrandId('');
    } catch (err: any) {
      console.error('Update brand error:', err);
      setError(err.message || 'Unable to update brand');
    } finally {
      setUpdating(false);
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

          {/* Edit Form */}
          {editingItemId && (() => {
            const editingItem = orderItems.find(item => item.id === editingItemId);
            if (!editingItem) return null;
            
            return (
              <div className="orders-edit-form" style={{
                backgroundColor: 'rgba(20, 20, 20, 0.95)',
                border: '1px solid var(--neon-primary-strong)',
                borderRadius: '8px',
                padding: '20px',
                marginBottom: '20px'
              }}>
                <h3 style={{ marginTop: 0, color: 'var(--neon-primary-strong)' }}>
                  Edit Brand - {editingItem.item_name || 'Item'}
                </h3>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '200px', flex: '1' }}>
                    <span style={{ color: 'rgba(255, 248, 226, 0.85)' }}>Brand</span>
                    <select
                      value={selectedBrandId}
                      onChange={(e) => setSelectedBrandId(e.target.value)}
                      disabled={updating}
                      style={{
                        padding: '8px 12px',
                        backgroundColor: 'rgba(255, 248, 226, 0.1)',
                        border: '1px solid rgba(255, 248, 226, 0.3)',
                        borderRadius: '4px',
                        color: 'var(--neon-primary-strong)',
                        fontSize: '1rem'
                      }}
                    >
                      <option value="">-- No Brand --</option>
                      {brands.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.brand_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={handleUpdateBrand}
                      disabled={updating}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: 'var(--neon-primary-strong)',
                        color: '#000',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        opacity: updating ? 0.6 : 1
                      }}
                    >
                      {updating ? 'Updating...' : 'Update'}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      disabled={updating}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: 'transparent',
                        color: 'rgba(255, 248, 226, 0.85)',
                        border: '1px solid rgba(255, 248, 226, 0.3)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        opacity: updating ? 0.6 : 1
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Desktop Table View */}
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
                      <td>{getListingPlatform(item.vinted_id, item.ebay_id)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="orders-remove-button"
                            onClick={() => handleEditItem(item)}
                            disabled={ordersLoading || updating}
                            style={{ marginRight: '8px' }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="orders-remove-button"
                            onClick={() => handleRemoveItem(item.id)}
                            disabled={ordersLoading || updating}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="orders-cards-wrapper">
            {orderItems.map((item) => {
              const isEbaySold = item.sold_platform === 'eBay' && item.ebay_id;
              const isVintedSold = item.sold_platform === 'Vinted' && item.vinted_id;
              const itemName = item.item_name || '—';
              
              return (
                <div key={item.id} className="orders-card">
                  <div className="orders-card-header">
                    <span className="orders-card-sku">SKU: {item.id}</span>
                    <button
                      type="button"
                      className="orders-remove-button"
                      onClick={() => handleRemoveItem(item.id)}
                      disabled={ordersLoading}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="orders-card-body">
                    <div className="orders-card-field">
                      <span className="orders-card-label">Item Name:</span>
                      <span className="orders-card-value">
                        {isEbaySold ? (
                          <a
                            href={`https://www.ebay.co.uk/itm/${item.ebay_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="orders-card-link"
                          >
                            {itemName}
                          </a>
                        ) : isVintedSold ? (
                          <a
                            href={`https://www.vinted.co.uk/items/${item.vinted_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="orders-card-link"
                          >
                            {itemName}
                          </a>
                        ) : (
                          itemName
                        )}
                      </span>
                    </div>
                    <div className="orders-card-field">
                      <span className="orders-card-label">Price:</span>
                      <span className="orders-card-value">{formatCurrency(item.purchase_price)}</span>
                    </div>
                    <div className="orders-card-field">
                      <span className="orders-card-label">Platform:</span>
                      <span className="orders-card-value">{getListingPlatform(item.vinted_id, item.ebay_id)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button
                      type="button"
                      className="orders-remove-button"
                      onClick={() => handleEditItem(item)}
                      disabled={ordersLoading || updating}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
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

