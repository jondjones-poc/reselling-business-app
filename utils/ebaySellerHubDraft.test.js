const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDraftCsv, validateListing } = require('./ebaySellerHubDraft');

test('builds the supplied UK Seller Hub draft CSV shape', () => {
  const listing = validateListing({ sku: 'SKU-001', categoryId: '47140', title: 'Blue, shirt', description: 'Line one\nLine two', price: '12', conditionId: '' });
  const lines = buildDraftCsv(listing).trim().split(/\r?\n/);
  assert.equal(lines[0], '#INFO,Version=0.0.2,Template= eBay-draft-listings-template_GB,,,,,,,,');
  assert.match(lines[4], /^Action\(SiteID=UK\|Country=GB\|Currency=GBP\|Version=1193\|CC=UTF-8\)/);
  assert.match(lines[5], /^Draft,SKU-001,47140,"Blue, shirt",,12\.00,1,,,Line one<br>Line two,FixedPrice$/);
});

test('requires the category ID required by the eBay template', () => {
  assert.throws(() => validateListing({ sku: 'SKU-001', title: 'Shirt', description: 'Description', price: '12' }), /category ID/);
});
