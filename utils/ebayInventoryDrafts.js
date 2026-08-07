/**
 * eBay Sell Inventory — list unpublished offers (Seller Hub drafts) and publish them.
 * Requires OAuth scope sell.inventory (seller must reconnect after scope is added).
 */

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const INVENTORY_BASE = 'https://api.ebay.com/sell/inventory/v1';
const DEFAULT_MARKETPLACE = 'EBAY_GB';
const PAGE_LIMIT = 100;
const MAX_PAGES = 40;

function marketplaceId() {
  return (process.env.EBAY_MARKETPLACE_ID || DEFAULT_MARKETPLACE).trim() || DEFAULT_MARKETPLACE;
}

function inventoryHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Content-Language': 'en-GB',
    'X-EBAY-C-MARKETPLACE-ID': marketplaceId(),
  };
}

function parseEbayErrorBody(text) {
  try {
    const j = JSON.parse(text);
    const errs = Array.isArray(j.errors) ? j.errors : [];
    if (errs.length) {
      return errs
        .map((e) => e.message || e.longMessage || e.errorId)
        .filter(Boolean)
        .join('; ');
    }
    if (j.message) return String(j.message);
  } catch {
    /* ignore */
  }
  return String(text || '').slice(0, 400);
}

function mapOffer(raw) {
  const offerId = raw?.offerId != null ? String(raw.offerId) : '';
  const pricing = raw?.pricingSummary?.price || {};
  const status = String(raw?.status || '').toUpperCase();
  return {
    offerId,
    sku: raw?.sku != null ? String(raw.sku) : null,
    title: null,
    listingTitle: null,
    marketplaceId: raw?.marketplaceId || marketplaceId(),
    format: raw?.format || null,
    status,
    availableQuantity: raw?.availableQuantity != null ? Number(raw.availableQuantity) : null,
    categoryId: raw?.categoryId != null ? String(raw.categoryId) : null,
    price:
      pricing.value != null
        ? { value: Number(pricing.value), currency: pricing.currency || 'GBP' }
        : null,
    listingId: raw?.listing?.listingId != null ? String(raw.listing.listingId) : null,
  };
}

/**
 * Prefer listing policies title from inventory item when offer has no clean title.
 */
async function fetchInventoryItemTitle(accessToken, sku) {
  if (!sku) return null;
  const url = `${INVENTORY_BASE}/inventory_item/${encodeURIComponent(sku)}`;
  const res = await fetch(url, { method: 'GET', headers: inventoryHeaders(accessToken) });
  if (!res.ok) return null;
  try {
    const data = await res.json();
    const title = data?.product?.title;
    return title ? String(title).trim() : null;
  } catch {
    return null;
  }
}

async function listOffersPage(accessToken, { offset = 0, limit = PAGE_LIMIT, sku = null } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(Math.min(200, Math.max(1, limit))));
  params.set('offset', String(Math.max(0, offset)));
  if (sku) params.set('sku', String(sku));

  const url = `${INVENTORY_BASE}/offer?${params}`;
  const res = await fetch(url, { method: 'GET', headers: inventoryHeaders(accessToken) });
  const text = await res.text();
  if (!res.ok) {
    let errorId = null;
    try {
      const j = JSON.parse(text);
      errorId = j?.errors?.[0]?.errorId ?? null;
    } catch {
      /* ignore */
    }
    // Some seller accounts error on unfiltered getOffers; caller can fall back to inventory_item.
    if (errorId === 25707 && !sku) {
      const err = new Error(parseEbayErrorBody(text) || 'getOffers requires sku');
      err.httpStatus = res.status;
      err.code = 'EBAY_GET_OFFERS_NEEDS_SKU';
      throw err;
    }
    const err = new Error(parseEbayErrorBody(text) || `eBay Inventory getOffers HTTP ${res.status}`);
    err.httpStatus = res.status;
    err.code = res.status === 403 || res.status === 401 ? 'EBAY_INVENTORY_SCOPE' : 'EBAY_GET_OFFERS_FAILED';
    throw err;
  }
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  const offers = Array.isArray(data.offers) ? data.offers : [];
  return {
    offers,
    total: data.total != null ? Number(data.total) : offers.length,
    size: data.size != null ? Number(data.size) : offers.length,
    next: data.next || null,
    href: data.href || null,
  };
}

async function listInventoryItemSkus(accessToken) {
  const skus = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      offset: String(offset),
    });
    const url = `${INVENTORY_BASE}/inventory_item?${params}`;
    const res = await fetch(url, { method: 'GET', headers: inventoryHeaders(accessToken) });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(parseEbayErrorBody(text) || `inventory_item HTTP ${res.status}`);
      err.httpStatus = res.status;
      err.code = res.status === 403 || res.status === 401 ? 'EBAY_INVENTORY_SCOPE' : 'EBAY_GET_INVENTORY_FAILED';
      throw err;
    }
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    const items = Array.isArray(data.inventoryItems) ? data.inventoryItems : [];
    for (const item of items) {
      if (item?.sku) skus.push(String(item.sku));
    }
    if (!items.length || items.length < PAGE_LIMIT) break;
    offset += items.length;
    if (data.total != null && offset >= Number(data.total)) break;
  }
  return skus;
}

/**
 * All UNPUBLISHED offers (drafts) across pages. Optionally enrich titles from inventory items.
 */
async function listUnpublishedOffers(accessToken, options = {}) {
  const enrichTitles = options.enrichTitles !== false;
  const drafts = [];
  const seen = new Set();

  const addUnpublished = (raw) => {
    const mapped = mapOffer(raw);
    if (mapped.status === 'UNPUBLISHED' && mapped.offerId && !seen.has(mapped.offerId)) {
      seen.add(mapped.offerId);
      drafts.push(mapped);
    }
  };

  let listedViaOffers = false;
  try {
    let offset = 0;
    let totalHint = null;
    for (let pages = 0; pages < MAX_PAGES; pages += 1) {
      const page = await listOffersPage(accessToken, { offset, limit: PAGE_LIMIT });
      listedViaOffers = true;
      if (totalHint == null && Number.isFinite(page.total)) totalHint = page.total;
      for (const raw of page.offers) addUnpublished(raw);
      if (!page.offers.length || page.offers.length < PAGE_LIMIT) break;
      offset += page.offers.length;
      if (totalHint != null && offset >= totalHint) break;
    }
  } catch (err) {
    if (err.code !== 'EBAY_GET_OFFERS_NEEDS_SKU') throw err;
  }

  if (!listedViaOffers) {
    const skus = await listInventoryItemSkus(accessToken);
    for (const sku of skus.slice(0, 200)) {
      try {
        const page = await listOffersPage(accessToken, { sku, limit: 25, offset: 0 });
        for (const raw of page.offers) addUnpublished(raw);
      } catch {
        /* skip bad sku */
      }
    }
  }

  if (enrichTitles) {
    const missing = drafts.filter((d) => !d.title && d.sku).slice(0, 80);
    const concurrency = 5;
    for (let i = 0; i < missing.length; i += concurrency) {
      const batch = missing.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (d) => {
          const title = await fetchInventoryItemTitle(accessToken, d.sku);
          if (title) {
            d.title = title;
            d.listingTitle = title;
          }
        })
      );
    }
  }

  drafts.sort((a, b) => String(a.title || a.sku || a.offerId).localeCompare(String(b.title || b.sku || b.offerId)));
  return drafts;
}

async function getOffer(accessToken, offerId) {
  const id = String(offerId || '').trim();
  if (!id) {
    const err = new Error('offerId required');
    err.code = 'INVALID_OFFER_ID';
    throw err;
  }
  const url = `${INVENTORY_BASE}/offer/${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: 'GET', headers: inventoryHeaders(accessToken) });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(parseEbayErrorBody(text) || `getOffer HTTP ${res.status}`);
    err.httpStatus = res.status;
    err.code = 'EBAY_GET_OFFER_FAILED';
    throw err;
  }
  return mapOffer(JSON.parse(text));
}

/**
 * Publish an unpublished offer → live listing. Returns listingId when present.
 */
async function publishOffer(accessToken, offerId) {
  const id = String(offerId || '').trim();
  if (!id) {
    const err = new Error('offerId required');
    err.code = 'INVALID_OFFER_ID';
    throw err;
  }
  const url = `${INVENTORY_BASE}/offer/${encodeURIComponent(id)}/publish`;
  const res = await fetch(url, { method: 'POST', headers: inventoryHeaders(accessToken), body: '' });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(parseEbayErrorBody(text) || `publishOffer HTTP ${res.status}`);
    err.httpStatus = res.status;
    err.code = res.status === 403 || res.status === 401 ? 'EBAY_INVENTORY_SCOPE' : 'EBAY_PUBLISH_OFFER_FAILED';
    throw err;
  }
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return {
    offerId: id,
    listingId: data.listingId != null ? String(data.listingId) : null,
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
}

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS public.ebay_scheduled_listing (
  id BIGSERIAL PRIMARY KEY,
  offer_id TEXT NOT NULL,
  sku TEXT,
  title TEXT,
  marketplace_id TEXT NOT NULL DEFAULT 'EBAY_GB',
  price_value NUMERIC,
  price_currency TEXT,
  scheduled_for DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'cancelled')),
  listing_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ebay_scheduled_listing_pending_offer_uidx
  ON public.ebay_scheduled_listing (offer_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ebay_scheduled_listing_due_idx
  ON public.ebay_scheduled_listing (scheduled_for, status)
  WHERE status IN ('pending', 'failed');
`;

async function ensureScheduledListingTable(pool) {
  await pool.query(ENSURE_TABLE_SQL);
}

/** Today's calendar date in Europe/London as YYYY-MM-DD. */
function londonTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseYmd(raw) {
  const s = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

async function upsertSchedule(pool, row) {
  await ensureScheduledListingTable(pool);
  // Cancel any prior pending for this offer, then insert fresh pending row.
  await pool.query(
    `UPDATE ebay_scheduled_listing
     SET status = 'cancelled', updated_at = NOW()
     WHERE offer_id = $1 AND status = 'pending'`,
    [row.offerId]
  );
  const result = await pool.query(
    `INSERT INTO ebay_scheduled_listing (
       offer_id, sku, title, marketplace_id, price_value, price_currency, scheduled_for, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, 'pending')
     RETURNING *`,
    [
      row.offerId,
      row.sku || null,
      row.title || null,
      row.marketplaceId || marketplaceId(),
      row.priceValue != null ? row.priceValue : null,
      row.priceCurrency || null,
      row.scheduledFor,
    ]
  );
  return result.rows[0];
}

async function cancelSchedule(pool, offerId) {
  await ensureScheduledListingTable(pool);
  const result = await pool.query(
    `UPDATE ebay_scheduled_listing
     SET status = 'cancelled', updated_at = NOW()
     WHERE offer_id = $1 AND status = 'pending'
     RETURNING *`,
    [String(offerId)]
  );
  return result.rows[0] || null;
}

async function listPendingSchedules(pool) {
  await ensureScheduledListingTable(pool);
  const result = await pool.query(
    `SELECT * FROM ebay_scheduled_listing
     WHERE status = 'pending'
     ORDER BY scheduled_for ASC, id ASC`
  );
  return result.rows || [];
}

async function listDueSchedules(pool, asOfYmd) {
  await ensureScheduledListingTable(pool);
  const day = asOfYmd || londonTodayYmd();
  const result = await pool.query(
    `SELECT * FROM ebay_scheduled_listing
     WHERE status IN ('pending', 'failed')
       AND scheduled_for <= $1::date
     ORDER BY scheduled_for ASC, id ASC
     LIMIT 100`,
    [day]
  );
  return result.rows || [];
}

async function markPublishing(pool, id) {
  await pool.query(
    `UPDATE ebay_scheduled_listing
     SET status = 'publishing', updated_at = NOW(), last_error = NULL
     WHERE id = $1`,
    [id]
  );
}

async function markPublished(pool, id, listingId) {
  await pool.query(
    `UPDATE ebay_scheduled_listing
     SET status = 'published', listing_id = $2, published_at = NOW(), updated_at = NOW(), last_error = NULL
     WHERE id = $1`,
    [id, listingId || null]
  );
}

async function markFailed(pool, id, message) {
  await pool.query(
    `UPDATE ebay_scheduled_listing
     SET status = 'failed', last_error = $2, updated_at = NOW()
     WHERE id = $1`,
    [id, String(message || '').slice(0, 1000)]
  );
}

/**
 * Publish all due scheduled drafts. Returns a summary for cron/logs.
 */
async function runDueScheduledPublishes(pool, getAccessToken) {
  await ensureScheduledListingTable(pool);
  const due = await listDueSchedules(pool);
  const summary = {
    asOf: londonTodayYmd(),
    total: due.length,
    published: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };
  if (!due.length) return summary;

  const accessToken = await getAccessToken();

  for (const row of due) {
    try {
      await markPublishing(pool, row.id);
      const published = await publishOffer(accessToken, row.offer_id);
      await markPublished(pool, row.id, published.listingId);
      summary.published += 1;
      summary.results.push({
        id: Number(row.id),
        offerId: row.offer_id,
        listingId: published.listingId,
        ok: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailed(pool, row.id, message);
      summary.failed += 1;
      summary.results.push({
        id: Number(row.id),
        offerId: row.offer_id,
        ok: false,
        error: message,
      });
    }
  }
  return summary;
}

function serializeScheduleRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    offerId: row.offer_id,
    sku: row.sku || null,
    title: row.title || null,
    marketplaceId: row.marketplace_id || marketplaceId(),
    price:
      row.price_value != null
        ? { value: Number(row.price_value), currency: row.price_currency || 'GBP' }
        : null,
    scheduledFor: row.scheduled_for
      ? String(row.scheduled_for).slice(0, 10)
      : null,
    status: row.status,
    listingId: row.listing_id || null,
    lastError: row.last_error || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
  };
}

module.exports = {
  marketplaceId,
  listUnpublishedOffers,
  getOffer,
  publishOffer,
  ensureScheduledListingTable,
  londonTodayYmd,
  parseYmd,
  upsertSchedule,
  cancelSchedule,
  listPendingSchedules,
  listDueSchedules,
  runDueScheduledPublishes,
  serializeScheduleRow,
};
