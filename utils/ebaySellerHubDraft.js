const FEED_API = 'https://api.ebay.com/sell/feed/v1';

function failure(message, httpStatus = 400) {
  return Object.assign(new Error(message), { httpStatus });
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateListing(raw) {
  const listing = {
    sku: clean(raw?.sku),
    categoryId: clean(raw?.categoryId),
    title: clean(raw?.title),
    description: clean(raw?.description),
    price: clean(raw?.price),
    conditionId: clean(raw?.conditionId),
  };
  if (!listing.sku || listing.sku.length > 50 || /[\x00-\x1f]/.test(listing.sku)) throw failure('Enter a SKU of up to 50 characters.');
  if (!/^\d+$/.test(listing.categoryId)) throw failure('Enter the eBay category ID.');
  if (!listing.title || listing.title.length > 80) throw failure('Enter a title of up to 80 characters.');
  if (!listing.description || listing.description.length > 4000) throw failure('Enter a description of up to 4,000 characters.');
  if (!/^\d+(\.\d{1,2})?$/.test(listing.price) || Number(listing.price) <= 0 || Number(listing.price) > 1000000) throw failure('Enter a valid GBP price greater than zero.');
  if (listing.conditionId && !/^[A-Za-z0-9_-]+$/.test(listing.conditionId)) throw failure('Enter a valid eBay condition ID.');
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

function buildDraftCsv(listing) {
  const lines = [
    '#INFO,Version=0.0.2,Template= eBay-draft-listings-template_GB,,,,,,,,',
    '#INFO Action and Category ID are required fields. 1) Set Action to Draft 2) Please find the category ID for your listings here: https://pages.ebay.com/sellerinformation/news/categorychanges.html,,,,,,,,,,',
    '"#INFO After you\'ve successfully uploaded your draft from the Seller Hub Reports tab, complete your drafts to active listings here: https://www.ebay.co.uk/sh/lst/drafts",,,,,,,,,,',
    '#INFO,,,,,,,,,,',
    'Action(SiteID=UK|Country=GB|Currency=GBP|Version=1193|CC=UTF-8),Custom label (SKU),Category ID,Title,UPC,Price,Quantity,Item photo URL,Condition ID,Description,Format',
    ['Draft', listing.sku, listing.categoryId, listing.title, '', listing.price, '1', '', listing.conditionId, descriptionHtml(listing.description), 'FixedPrice'].map(csvValue).join(','),
  ];
  return `${lines.join('\r\n')}\r\n`;
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
  let task;
  try { task = JSON.parse(createText); } catch { throw failure('eBay did not return an upload task.', 502); }
  if (!task?.taskId) throw failure('eBay did not return an upload task.', 502);

  const { FormData, File } = await import('node-fetch');
  const form = new FormData();
  form.append('file', new File([buildDraftCsv(listing)], `ebay-draft-${listing.sku}.csv`, { type: 'text/csv' }));
  const uploadResponse = await fetch(`${FEED_API}/task/${encodeURIComponent(task.taskId)}/upload_file`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' }, body: form,
  });
  const uploadText = await uploadResponse.text();
  if (!uploadResponse.ok) throw ebayError(uploadResponse, uploadText, 'Uploading the Seller Hub draft');
  return { taskId: String(task.taskId), sku: listing.sku };
}

module.exports = { validateListing, buildDraftCsv, createSellerHubDraft };
