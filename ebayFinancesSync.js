/**
 * eBay Finances + Fulfillment lookups for the Accounting > Stock Expenses sync.
 *
 * Fulfillment (sell.fulfillment.readonly — already granted) gives us the
 * postage the BUYER was charged (Order.pricingSummary.deliveryCost — an
 * order-level field, not per line item, so a multi-item order splits it
 * evenly across its lines).
 *
 * Finances (sell.finances — newly added; the seller must re-authorize via
 * Connect eBay for this to work, since refresh tokens can't silently gain a
 * scope the user never consented to) gives us selling fees and shipping
 * label charges (what WE paid for postage).
 *
 * Field names follow eBay's published Finances API v1 transaction schema.
 * This has not been verified against a live response from this seller's
 * account (that requires the sell.finances re-auth to happen first), so
 * treat the fee/shipping-label extraction as a best-effort first pass —
 * re-check field names against a real response and adjust if eBay's exact
 * nesting differs.
 */

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const { getActiveSigningKey, signRequestHeaders } = require('./ebayDigitalSignature');

const FULFILLMENT_BASE = 'https://api.ebay.com/sell/fulfillment/v1/order';
// Finances API is served from a different host (apiz, not api) — this is an eBay quirk, not a typo.
const FINANCES_BASE = 'https://apiz.ebay.com/sell/finances/v1/transaction';

function toIsoDate(d) {
  return d.toISOString();
}

/**
 * Paginates Fulfillment getOrders over a date window, returning a map keyed
 * by legacyItemId -> { orderId, lineItemId, deliveryCostValue, deliveryCostCurrency }.
 */
async function fetchEbayFulfillmentDeliveryCosts(pool, userAccessToken, { startDate, endDate }) {
  const filter = `creationdate:[${toIsoDate(startDate)}..${toIsoDate(endDate)}]`;
  const byLegacyItemId = new Map();
  let offset = 0;
  const limit = 50;
  const delayMs = Math.min(500, Math.max(80, Number(process.env.EBAY_FULFILLMENT_PAGE_DELAY_MS) || 130));
  const signingKey = await getActiveSigningKey(pool);

  for (;;) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), filter });
    const requestUrl = `${FULFILLMENT_BASE}?${params.toString()}`;
    const headers = {
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    };
    if (signingKey) {
      Object.assign(headers, signRequestHeaders({ method: 'GET', url: requestUrl, signingKey }));
    }
    const res = await fetch(requestUrl, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Fulfillment getOrders ${res.status}: ${text.slice(0, 700)}`);
      err.httpStatus = res.status;
      throw err;
    }
    const data = await res.json();
    const orders = Array.isArray(data.orders) ? data.orders : [];
    for (const order of orders) {
      const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
      const deliveryCost = order.pricingSummary?.deliveryCost || null;
      const deliveryCostValue = deliveryCost?.value != null ? Number(deliveryCost.value) : null;
      const deliveryCostCurrency = deliveryCost?.currency || null;
      // Order-level delivery cost split evenly across this order's line items (usually just one).
      const perItemDeliveryCost =
        deliveryCostValue != null && lineItems.length > 0 ? deliveryCostValue / lineItems.length : null;

      for (const li of lineItems) {
        const legacyItemId = li.legacyItemId != null ? String(li.legacyItemId).trim() : '';
        if (!legacyItemId) continue;
        byLegacyItemId.set(legacyItemId, {
          orderId: order.orderId,
          lineItemId: li.lineItemId || null,
          deliveryCostValue: perItemDeliveryCost,
          deliveryCostCurrency,
        });
      }
    }
    if (orders.length < limit) break;
    offset += limit;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return byLegacyItemId;
}

/**
 * Paginates Finances transactions over a date window, returning a map keyed
 * by orderId -> { feesTotal, feesCurrency, shippingLabelTotal, shippingLabelCurrency }.
 */
async function fetchEbayFinanceTransactionsByOrder(pool, userAccessToken, { startDate, endDate }) {
  const filter = `transactionDate:[${toIsoDate(startDate)}..${toIsoDate(endDate)}]`;
  const byOrderId = new Map();
  let offset = 0;
  const limit = 200;
  const delayMs = Math.min(500, Math.max(80, Number(process.env.EBAY_FINANCES_PAGE_DELAY_MS) || 130));
  const signingKey = await getActiveSigningKey(pool);

  for (;;) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset), filter });
    const requestUrl = `${FINANCES_BASE}?${params.toString()}`;
    const headers = {
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    };
    if (signingKey) {
      Object.assign(headers, signRequestHeaders({ method: 'GET', url: requestUrl, signingKey }));
    }
    const res = await fetch(requestUrl, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Finances transaction ${res.status}: ${text.slice(0, 700)}`);
      err.httpStatus = res.status;
      throw err;
    }
    const data = await res.json();
    const transactions = Array.isArray(data.transactions) ? data.transactions : [];
    for (const txn of transactions) {
      const orderId =
        txn.orderId ||
        (Array.isArray(txn.references)
          ? txn.references.find((r) => r.referenceType === 'ORDER_ID')?.referenceId
          : null);
      if (!orderId) continue;

      const existing = byOrderId.get(orderId) || {
        feesTotal: 0,
        feesCurrency: null,
        shippingLabelTotal: 0,
        shippingLabelCurrency: null,
      };

      if (txn.transactionType === 'SALE' && Array.isArray(txn.orderLineItems)) {
        for (const li of txn.orderLineItems) {
          for (const fee of li.marketplaceFees || []) {
            const value = Number(fee.amount?.value);
            if (Number.isFinite(value)) {
              existing.feesTotal += Math.abs(value);
              existing.feesCurrency = existing.feesCurrency || fee.amount?.currency || null;
            }
          }
        }
      } else if (txn.transactionType === 'NON_SALE_CHARGE' || txn.transactionType === 'NON_SALE_CREDIT') {
        const value = Number(txn.amount?.value);
        if (Number.isFinite(value)) {
          existing.feesTotal += Math.abs(value);
          existing.feesCurrency = existing.feesCurrency || txn.amount?.currency || null;
        }
      } else if (txn.transactionType === 'SHIPPING_LABEL') {
        const value = Number(txn.amount?.value);
        if (Number.isFinite(value)) {
          existing.shippingLabelTotal += Math.abs(value);
          existing.shippingLabelCurrency = existing.shippingLabelCurrency || txn.amount?.currency || null;
        }
      }

      byOrderId.set(orderId, existing);
    }
    if (transactions.length < limit) break;
    offset += limit;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return byOrderId;
}

module.exports = {
  fetchEbayFulfillmentDeliveryCosts,
  fetchEbayFinanceTransactionsByOrder,
};
