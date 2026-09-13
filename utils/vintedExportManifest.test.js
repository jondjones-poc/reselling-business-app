const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVintedExportManifest } = require('./vintedExportManifest');

test('portable JSON preserves SKU separately from Vinted ID and references exported images', () => {
  const manifest = JSON.parse(JSON.stringify(buildVintedExportManifest({
    stockId: '00123', vintedId: '987654', sourceUrl: 'https://www.vinted.co.uk/items/987654',
    title: 'Shirt', description: 'Blue shirt', priceLabel: '£12',
    specifics: [{ name: 'Brand', value: 'Example' }],
    imageEntries: [{ name: 'images/01.jpg', buffer: Buffer.from('photo') }],
  })));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.sku, '00123');
  assert.equal(manifest.source.listing_id, '987654');
  assert.deepEqual(manifest.images, ['images/01.jpg']);
  assert.equal(manifest.description, 'Blue shirt');
});

test('missing stock SKU is explicit and never replaced with a Vinted ID', () => {
  const manifest = buildVintedExportManifest({ vintedId: '987654', imageEntries: [] });
  assert.equal(manifest.sku, null);
});
