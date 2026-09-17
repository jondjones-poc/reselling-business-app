const FEED_API = 'https://api.ebay.com/sell/feed/v1';

function failure(message, httpStatus = 400) {
  return Object.assign(new Error(message), { httpStatus });
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanSpecifics(rawSpecifics) {
  if (!Array.isArray(rawSpecifics)) return [];
  const seen = new Set();
  const out = [];
  for (const s of rawSpecifics) {
    const name = clean(s?.name);
    const value = clean(s?.value);
    if (!name || !value || name.length > 65 || value.length > 500) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // File Exchange rejects duplicate C: columns
    seen.add(key);
    out.push({ name, value });
  }
  return out;
}

function validateListing(raw, opts = {}) {
  // The API path (buildDraftCsv/createSellerHubDraft) goes through eBay's
  // strict VerifyAddItem validation and needs Location + a Shipping policy.
  // The manual-export path (buildManualDraftCsv) mimics eBay's own minimal
  // template, which the Seller Hub bulk-upload UI accepts with neither —
  // it just parks a placeholder draft you finish by hand. Callers pass
  // requireLocation/requireShipping: false for that path.
  const { requireLocation = true, requireShipping = true } = opts;
  const listing = {
    sku: clean(raw?.sku),
    categoryId: clean(raw?.categoryId),
    title: clean(raw?.title),
    description: clean(raw?.description),
    price: clean(raw?.price),
    conditionId: clean(raw?.conditionId),
    location: clean(raw?.location),
    paymentPolicyName: clean(raw?.paymentPolicyName),
    shippingPolicyName: clean(raw?.shippingPolicyName),
    returnPolicyName: clean(raw?.returnPolicyName),
    specifics: cleanSpecifics(raw?.specifics),
  };
  if (!listing.sku || listing.sku.length > 50 || /[\x00-\x1f]/.test(listing.sku)) throw failure('Enter a SKU of up to 50 characters.');
  if (!/^\d+$/.test(listing.categoryId)) throw failure('Enter the eBay category ID.');
  if (!listing.title || listing.title.length > 80) throw failure('Enter a title of up to 80 characters.');
  if (!listing.description || listing.description.length > 4000) throw failure('Enter a description of up to 4,000 characters.');
  if (!/^\d+(\.\d{1,2})?$/.test(listing.price) || Number(listing.price) <= 0 || Number(listing.price) > 1000000) throw failure('Enter a valid GBP price greater than zero.');
  if (listing.conditionId && !/^[A-Za-z0-9_-]+$/.test(listing.conditionId)) throw failure('Enter a valid eBay condition ID.');
  if (requireLocation && !listing.location) throw failure('Enter the item location (town/city or postcode).');
  // Payment and Return policy names are optional: eBay's VerifyAddItem draft
  // step accepted drafts without them. Shipping is different — eBay rejected
  // both a missing shipping method AND a classic per-listing ShippingType/
  // ShippingService fallback ("Item.ShippingDetails is invalid or missing"),
  // so a named Shipping Business Policy is the only option confirmed to work.
  if (requireShipping && !listing.shippingPolicyName) throw failure('Enter your eBay Shipping policy name — a shipping method is required and eBay rejected the per-listing fallback.');
  listing.price = Number(listing.price).toFixed(2);
  return listing;
}

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function descriptionHtml(description) {
  return description.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
    .replace(/\r?\n/g, '<br>');
}

function photoUrlValue(listing) {
  // eBay's VerifyAddItem/bulk-upload both reject a listing with zero photos.
  // The ZIP's own photos are hosted publicly (server.js uploads them to
  // Supabase before calling either CSV builder) so real photos are used —
  // File Exchange's basic template supports up to 12 photos in this one
  // field, pipe-separated. Only fall back to eBay's own placeholder logo
  // (used in its official template's example row) if no photo made it
  // through hosting for some reason.
  return Array.isArray(listing.photoUrls) && listing.photoUrls.length > 0
    ? listing.photoUrls.slice(0, 12).join('|')
    : 'https://ir.ebaystatic.com/cr/v/c1/rsc/ebay_logo_512.png';
}

// File Exchange's convention for category item specifics (Brand, Size,
// Colour, etc.) is a "C:<Name>" column per specific. Real data carried
// over from the original Vinted listing (see cleanSpecifics above) is
// used first; any of the commonly-required ones still missing get a
// rough, generic default so the draft isn't blocked — these are quick
// placeholders to correct in Seller Hub, not meant to be accurate.
const DEFAULT_SPECIFICS = { Brand: 'Unbranded', Size: 'One Size', Colour: 'Multicolour', Department: 'Unisex Adult', Style: 'Casual' };

function specificsColumns(listing) {
  const haveNames = new Set((listing.specifics || []).map((s) => s.name.toLowerCase()));
  const allSpecifics = [...(listing.specifics || [])];
  for (const [name, value] of Object.entries(DEFAULT_SPECIFICS)) {
    if (!haveNames.has(name.toLowerCase())) allSpecifics.push({ name, value });
  }
  return allSpecifics.map(({ name, value }) => [`C:${name}`, value]);
}

function csvFile(columns) {
  const lines = [
    '#INFO,Version=0.0.2,Template= eBay-draft-listings-template_GB,,,,,,,,',
    '#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,',
    '"#INFO After you\'ve successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.co.uk/sh/lst/drafts",,,,,,,,,,',
    '#INFO,,,,,,,,,,',
    columns.map(([header]) => header).join(','),
    columns.map(([, value]) => csvValue(value)).join(','),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Mirrors eBay's own downloadable draft template exactly: Action=Draft and
 * only the columns that template has (no Location, no Shipping/Payment/
 * Return policy, no Duration). This is for manual upload through Seller
 * Hub's own Reports > Upload Listings tool, which accepts eBay's template
 * with none of those fields and just parks a placeholder draft — unlike the
 * REST Feed API path (buildDraftCsv), which rejected the literal "Draft"
 * action and enforces stricter validation. Real photo URLs and item
 * specifics are still included since the manual upload path happily
 * accepts extra columns and they save the seller re-entering that data by
 * hand in Seller Hub.
 */
function buildManualDraftCsv(listing) {
  const columns = [
    ['Action(SiteID=UK|Country=GB|Currency=GBP|Version=1193|CC=UTF-8)', 'Draft'],
    ['Custom label (SKU)', listing.sku],
    ['Category ID', listing.categoryId],
    ['Title', listing.title],
    ['UPC', ''],
    ['Price', listing.price],
    ['Quantity', '1'],
    ['Item photo URL', photoUrlValue(listing)],
    ['Condition ID', listing.conditionId],
    ['Description', descriptionHtml(listing.description)],
    ['Format', 'FixedPrice'],
    ...specificsColumns(listing),
  ];
  return csvFile(columns);
}

function buildDraftCsv(listing) {
  // eBay's docs say the "Create new drafts" template maps to the Trading
  // API's VerifyAddItem call — a verify-only action that never creates an
  // ItemID or publishes anything. The literal word "Draft" (which the
  // browser's own Seller Hub upload UI accepts) produced
  // "BAF.Error.5: Unable to find Task Action Id for task Draft" when
  // submitted through the REST createTask/uploadFile path, even with eBay's
  // own official template — so the REST backend's Task Action lookup table
  // seems to expect the underlying Trading API action name here instead.
  //
  // ListingDuration and Location are required for VerifyAddItem/AddItem
  // even though eBay's own draft template omits these columns entirely.
  // "GTC" (Good Til Cancelled) is the standard duration for fixed-price
  // listings.
  //
  // The three Business Policy columns are only included when actually
  // provided: eBay confirmed policies are required to PUBLISH a listing,
  // but "Draft"/VerifyAddItem is a validation step, not a publish, and
  // whether it enforces the same requirement hasn't been confirmed —
  // sending them only when present lets a seller who hasn't set up
  // Business Policies yet still get a draft down and finish it by hand in
  // Seller Hub, and lets eBay's own response settle the question directly
  // rather than assuming.
  const columns = [
    ['Action(SiteID=UK|Country=GB|Currency=GBP|Version=1193|CC=UTF-8)', 'VerifyAdd'],
    ['Custom label (SKU)', listing.sku],
    ['Category ID', listing.categoryId],
    ['Title', listing.title],
    ['UPC', ''],
    ['Price', listing.price],
    ['Quantity', '1'],
    ['Item photo URL', photoUrlValue(listing)],
    ['Condition ID', listing.conditionId],
    ['Description', descriptionHtml(listing.description)],
    ['Format', 'FixedPrice'],
    ['Duration', 'GTC'],
    ['Location', listing.location],
  ];
  if (listing.paymentPolicyName) columns.push(['PaymentProfileName', listing.paymentPolicyName]);
  // Classic per-listing shipping fields (ShippingType/ShippingService-1:Option/
  // ShippingService-1:Cost) were tried as a fallback when no Shipping Business
  // Policy is set, but eBay rejected them outright ("Item.ShippingDetails is
  // invalid or missing") regardless of the service code used — this account's
  // VerifyAddItem path doesn't accept the classic shipping model at all. A
  // named Shipping Policy is the only reliable option now, so it's required.
  if (listing.shippingPolicyName) columns.push(['ShippingProfileName', listing.shippingPolicyName]);
  if (listing.returnPolicyName) columns.push(['ReturnProfileName', listing.returnPolicyName]);
  columns.push(...specificsColumns(listing));
  return csvFile(columns);
}

function ebayError(res, text, action) {
  let details = '';
  try { details = JSON.parse(text)?.errors?.map(error => error.longMessage || error.message).filter(Boolean).join('; ') || ''; } catch { /* plain response */ }
  return failure(`${action} failed in eBay: ${details || text || `HTTP ${res.status}`}`, res.status === 401 || res.status === 403 ? 403 : 502);
}

async function createSellerHubDraft({ listing, token, fetchImpl }) {
  const fetch = fetchImpl || ((...args) => import('node-fetch').then(({ default: request }) => request(...args)));
  const createResponse = await fetch(`${FEED_API}/task`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Content-Language': 'en-GB', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' },
    body: JSON.stringify({ feedType: 'FX_LISTING', marketplaceId: 'EBAY_GB', schemaVersion: '1.0' }),
  });
  const createText = await createResponse.text();
  if (!createResponse.ok) throw ebayError(createResponse, createText, 'Creating the Seller Hub draft upload');

  // eBay's Feed API returns 201 Created with an EMPTY body on success — the
  // new task's id comes back in the Location header (…/task/{taskId}), not
  // the response JSON. Try that first; fall back to a JSON body in case
  // eBay's actual behaviour ever differs from its documented one.
  let taskId = null;
  const locationHeader = createResponse.headers?.get?.('location');
  if (locationHeader) {
    const match = String(locationHeader).match(/\/task\/([^/?#]+)/i);
    if (match) taskId = decodeURIComponent(match[1]);
  }
  if (!taskId && createText) {
    try {
      const task = JSON.parse(createText);
      if (task?.taskId) taskId = String(task.taskId);
    } catch {
      /* not JSON — already tried the Location header above */
    }
  }
  if (!taskId) {
    throw failure(
      `eBay did not return an upload task (HTTP ${createResponse.status}, no Location header` +
        `${createText ? `, body: ${createText.slice(0, 300)}` : ', empty body'}).`,
      502
    );
  }

  const { FormData, File } = await import('node-fetch');
  const form = new FormData();
  form.append('file', new File([buildDraftCsv(listing)], `ebay-draft-${listing.sku}.csv`, { type: 'text/csv' }));
  const uploadResponse = await fetch(`${FEED_API}/task/${encodeURIComponent(taskId)}/upload_file`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' }, body: form,
  });
  const uploadText = await uploadResponse.text();
  if (!uploadResponse.ok) throw ebayError(uploadResponse, uploadText, 'Uploading the Seller Hub draft');
  return { taskId, sku: listing.sku };
}

module.exports = { validateListing, buildDraftCsv, buildManualDraftCsv, createSellerHubDraft };
