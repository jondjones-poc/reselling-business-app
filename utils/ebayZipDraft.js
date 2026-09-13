const { createHash } = require('crypto');
const { isDeepStrictEqual } = require('util');
const { marketplaceId } = require('./ebayInventoryDrafts');
const INVENTORY = 'https://api.ebay.com/sell/inventory/v1';
// Keep Media on the same production API host as Inventory. The alternate
// gateway intermittently returns "Core Inventory Service internal error" for
// otherwise valid multipart image uploads.
const MEDIA = 'https://api.ebay.com/commerce/media/v1_beta';
function failure(message, status = 400) { return Object.assign(new Error(message), { httpStatus: status }); }
const clean = value => typeof value === 'string' ? value.trim() : '';
function validateListing(raw, files) {
  const listing = { sku: clean(raw?.sku), title: clean(raw?.title), description: clean(raw?.description), price: clean(raw?.price) };
  if (!listing.sku || listing.sku.length > 50 || /[\x00-\x1f]/.test(listing.sku)) throw failure('Enter a SKU of up to 50 characters.');
  if (!listing.title || listing.title.length > 80) throw failure('Enter a title of up to 80 characters.');
  if (!listing.description || listing.description.length > 4000) throw failure('Enter a description of up to 4,000 characters.');
  if (!/^\d+(\.\d{1,2})?$/.test(listing.price) || Number(listing.price) <= 0 || Number(listing.price) > 1000000) throw failure('Enter a valid GBP price greater than zero.');
  listing.price = Number(listing.price).toFixed(2);
  const aspects = Object.create(null);
  if (raw.specifics != null && (!Array.isArray(raw.specifics) || raw.specifics.length > 50)) throw failure('Too many item details.');
  for (const entry of raw.specifics || []) {
    const name = clean(entry?.name), value = clean(entry?.value);
    if (!name || !value) continue;
    if (name.length > 40 || value.length > 50) continue;
    if (['uploaded', 'views', 'interested'].includes(name.toLowerCase())) continue;
    aspects[name] = [value];
  }
  listing.aspects = aspects;
  if (!Array.isArray(files) || files.length < 1 || files.length > 24) throw failure('Include between 1 and 24 photos.');
  let total = 0;
  for (const file of files) {
    const b = file.buffer;
    if (!Buffer.isBuffer(b) || !b.length || b.length > 12 * 1024 * 1024) throw failure('Each photo must be under 12 MB.');
    total += b.length;
    const jpeg = b[0] === 255 && b[1] === 216 && b[2] === 255;
    const png = b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const gif = /^GIF8[79]a/.test(b.subarray(0, 6).toString());
    const webp = b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
    if (!jpeg && !png && !gif && !webp) throw failure('Only JPEG, PNG, GIF or WebP photos are supported.');
    file.mimetype = jpeg ? 'image/jpeg' : png ? 'image/png' : gif ? 'image/gif' : 'image/webp';
  }
  if (total > 60 * 1024 * 1024) throw failure('The photos must total less than 60 MB.');
  return listing;
}
const escapeHtml = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function ebayErrorMessage(data, text, status, operation) {
  const providerMessage = data?.errors
    ?.map(error => error.longMessage || error.message || error.errorId)
    .filter(Boolean)
    .join('; ');
  const detail = providerMessage || String(text || '').trim() || `HTTP ${status}`;
  return `${operation} failed in eBay: ${detail}`;
}

function createEbayClient(token, fetchImpl) {
  const fetch = fetchImpl || ((...args) => import('node-fetch').then(m => m.default(...args)));
  async function request(url, method = 'GET', body, allow404 = false, operation = 'Request') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const multipart = body && typeof body.append === 'function';
      const res = await fetch(url, { method, signal: controller.signal, headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        ...(!multipart ? { 'Content-Type': 'application/json', 'Content-Language': 'en-GB' } : {}),
      }, ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}) });
      if (allow404 && res.status === 404) return null;
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { /* eBay sometimes returns plain-text 5xx errors. */ }
      if (!res.ok) {
        throw failure(ebayErrorMessage(data, text, res.status, operation), [401, 403].includes(res.status) ? 403 : 502);
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw failure('eBay took too long to respond. Retry the same import to resume.', 502);
      throw e;
    } finally { clearTimeout(timer); }
  }
  return {
    getItem: sku => request(`${INVENTORY}/inventory_item/${encodeURIComponent(sku)}`, 'GET', undefined, true, 'Checking the SKU'),
    getOffers: async sku => {
      const data = await request(`${INVENTORY}/offer?sku=${encodeURIComponent(sku)}&limit=200`, 'GET', undefined, true, 'Checking existing eBay drafts');
      return data?.offers || [];
    },
    putItem: (sku, item) => request(`${INVENTORY}/inventory_item/${encodeURIComponent(sku)}`, 'PUT', item, false, 'Saving the eBay inventory item'),
    createOffer: offer => request(`${INVENTORY}/offer`, 'POST', offer, false, 'Creating the eBay draft'),
    upload: async (file, index) => {
      const { FormData, File } = await import('node-fetch');
      // eBay reports occasional internal 5xx failures from Media. Retrying an
      // upload only adds an unused EPS image if the first response was lost;
      // it cannot create or publish a listing.
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const form = new FormData();
        form.append('image', new File([file.buffer], `photo-${index + 1}.${file.mimetype.split('/')[1]}`, { type: file.mimetype }));
        try {
          const image = await request(`${MEDIA}/image/create_image_from_file`, 'POST', form, false, `Uploading photo ${index + 1}`);
          if (!image.imageUrl || !/^https:\/\//.test(image.imageUrl)) throw failure('eBay did not return a photo URL. Retry the import.', 502);
          return image.imageUrl;
        } catch (error) {
          lastError = error;
          if (error.httpStatus !== 502 || attempt === 1) throw error;
        }
      }
      throw lastError;
    },
  };
}

/** store is durable; caller holds a per-seller/SKU lock throughout this operation. */
async function createZipDraft({ listing, files, store, ebay, marketplace = marketplaceId() }) {
  const hash = createHash('sha256').update(JSON.stringify({ listing, marketplace }));
  files.forEach(file => hash.update(createHash('sha256').update(file.buffer).digest()));
  const fingerprint = hash.digest('hex');
  let state = await store.load();
  if (state && state.fingerprint !== fingerprint) throw failure('This SKU already has an import with different data. Use the original ZIP and details to resume, or manage its existing draft.', 409);
  const item = await ebay.getItem(listing.sku);
  const offers = item ? await ebay.getOffers(listing.sku) : [];
  const matchingOffers = offers.filter(o => o.marketplaceId === marketplace && o.format === 'FIXED_PRICE');
  if (offers.some(o => o.status === 'PUBLISHED')) throw failure('This SKU already has a published eBay offer. It has not been changed.', 409);
  if (matchingOffers.length) {
    if (!state?.offerPending && !state?.offerId) throw failure('This SKU already has an eBay draft. Open the existing drafts to manage it.', 409);
    const offer = matchingOffers[0];
    if (offer.status !== 'UNPUBLISHED') throw failure('The existing offer is not an unpublished draft.', 409);
    state.offerId = String(offer.offerId);
    await store.save(state);
    return { sku: listing.sku, offerId: state.offerId, existing: true };
  }
  if (state?.offerId) throw failure('The previously created draft is no longer available. Check eBay before importing again.', 409);
  if (item && !state?.inventoryPending) throw failure('This SKU already exists in eBay inventory. It has not been changed.', 409);
  state = state || { fingerprint, imageUrls: [] };
  await store.save(state);
  // Reuse photos already uploaded before an interrupted request.
  for (let i = state.imageUrls.length; i < files.length; i++) {
    state.imageUrls.push(await ebay.upload(files[i], i));
    await store.save(state);
  }
  const description = escapeHtml(listing.description).replace(/\r?\n/g, '<br>');
  const inventory = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    product: { title: listing.title, description, imageUrls: state.imageUrls, aspects: listing.aspects },
  };
  if (item) {
    // Never PUT over an existing inventory item, even on a retry.
    if (item.product?.title !== inventory.product.title || item.product?.description !== description ||
      !isDeepStrictEqual(item.product?.imageUrls, state.imageUrls)) throw failure('The eBay inventory item has changed since this import. Check its draft before continuing.', 409);
  } else {
    state.inventoryPending = true;
    await store.save(state); // Written before PUT so uncertain responses can be recovered.
    await ebay.putItem(listing.sku, inventory);
  }
  state.offerPending = true;
  await store.save(state);
  const result = await ebay.createOffer({
    sku: listing.sku, marketplaceId: marketplace, format: 'FIXED_PRICE', availableQuantity: 1,
    listingDescription: description, pricingSummary: { price: { value: listing.price, currency: 'GBP' } },
  });
  if (!result.offerId) throw failure('eBay did not confirm the draft reference. Retry the same import to check it.', 502);
  state.offerId = String(result.offerId);
  await store.save(state);
  return { sku: listing.sku, offerId: state.offerId, existing: false };
}

async function withImportStore(pool, sellerKey, sku, callback) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ebay_zip_import (
    seller_key TEXT NOT NULL, sku TEXT NOT NULL, state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (seller_key, sku)
  )`);
  const client = await pool.connect();
  const lockKey = `ebay-zip:${sellerKey}:${sku}`;
  let locked = false;
  try {
    const result = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [lockKey]);
    locked = result.rows[0].locked;
    if (!locked) throw failure('This SKU is already being imported. Wait for it to finish, then retry.', 409);
    return await callback({
      load: async () => (await client.query('SELECT state FROM ebay_zip_import WHERE seller_key = $1 AND sku = $2', [sellerKey, sku])).rows[0]?.state,
      save: async state => { await client.query(`INSERT INTO ebay_zip_import (seller_key, sku, state) VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (seller_key, sku) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`, [sellerKey, sku, JSON.stringify(state)]); },
    });
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]); }
    finally { client.release(true); }
  }
}
module.exports = { validateListing, createEbayClient, createZipDraft, withImportStore };
