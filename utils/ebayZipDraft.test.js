const test = require('node:test');
const assert = require('node:assert/strict');
const { validateListing, createZipDraft, createEbayClient } = require('./ebayZipDraft');
const files = () => [{ buffer: Buffer.from([255,216,255,1]), mimetype: 'image/jpeg' }];
const raw = { sku: '00123', title: 'Blue shirt', description: '<script>bad</script>\nGood shirt', price: '12.50', specifics: [{ name: 'Brand', value: 'Example' }] };
function harness() {
  let state, item = null, offers = [];
  const calls = [];
  const store = { load: async () => structuredClone(state), save: async s => { state = structuredClone(s); } };
  const ebay = {
    getItem: async () => item, getOffers: async () => offers,
    upload: async () => { calls.push('upload'); return 'https://i.ebayimg.com/photo.jpg'; },
    putItem: async (sku, body) => { calls.push('put'); item = structuredClone(body); },
    createOffer: async body => { calls.push('offer'); offers = [{ ...body, status: 'UNPUBLISHED', offerId: '987' }]; return { offerId: '987' }; },
  };
  return { store, ebay, calls, get item() { return item; }, set item(value) { item = value; }, get offers() { return offers; } };
}
const run = h => createZipDraft({ store: h.store, ebay: h.ebay, files: files(), listing: validateListing(raw, files()), marketplace: 'EBAY_GB' });

test('uploads photos and creates an unpublished offer with exact SKU and escaped text', async () => {
  const h = harness(); const result = await run(h);
  assert.equal(result.sku, '00123'); assert.equal(result.offerId, '987');
  assert.deepEqual(h.calls, ['upload', 'put', 'offer']);
  assert.equal(h.item.product.description, '&lt;script&gt;bad&lt;/script&gt;<br>Good shirt');
  assert.equal(h.offers[0].sku, '00123');
  assert.equal(h.offers[0].pricingSummary.price.currency, 'GBP');
  assert.equal(h.offers[0].status, 'UNPUBLISHED');
});
test('repeating a completed import returns its draft without any writes', async () => {
  const h = harness(); await run(h); h.calls.length = 0;
  assert.equal((await run(h)).existing, true); assert.deepEqual(h.calls, []);
});
test('a lost createOffer response is recovered without duplication', async () => {
  const h = harness(); const original = h.ebay.createOffer;
  h.ebay.createOffer = async body => { await original(body); throw new Error('lost response'); };
  await assert.rejects(run(h), /lost response/); h.calls.length = 0;
  assert.equal((await run(h)).offerId, '987'); assert.deepEqual(h.calls, []);
});
test('failed offer creation resumes with uploaded photos and existing inventory', async () => {
  const h = harness(); const original = h.ebay.createOffer;
  h.ebay.createOffer = async () => { throw new Error('temporary failure'); };
  await assert.rejects(run(h), /temporary/); h.calls.length = 0; h.ebay.createOffer = original;
  await run(h); assert.deepEqual(h.calls, ['offer']);
});
test('existing inventory and published offers are never overwritten', async () => {
  const h = harness(); h.item = { product: { title: 'Other item' } };
  await assert.rejects(run(h), /already exists/); assert.deepEqual(h.calls, []);
  h.item = null; await run(h); h.offers[0].status = 'PUBLISHED'; h.calls.length = 0;
  await assert.rejects(run(h), /published/); assert.deepEqual(h.calls, []);
});
test('changed import data for an existing SKU is rejected', async () => {
  const h = harness(); await run(h);
  await assert.rejects(createZipDraft({ ...h, files: files(), listing: validateListing({ ...raw, title: 'Different' }, files()), marketplace: 'EBAY_GB' }), /different data/);
});
test('invalid details and fake images are rejected before eBay requests', () => {
  assert.throws(() => validateListing({ ...raw, sku: '' }, files()), /SKU/);
  assert.throws(() => validateListing({ ...raw, price: 'NaN' }, files()), /price/);
  assert.throws(() => validateListing(raw, [{ buffer: Buffer.from('not a photo') }]), /photos/);
});
test('HTTP adapter uses Media multipart image upload and Inventory createOffer only', async () => {
  const calls = [];
  const client = createEbayClient('test-token', async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 201, text: async () => JSON.stringify(url.includes('media') ? { imageUrl: 'https://i.ebayimg.com/photo.jpg' } : { offerId: '123' }) };
  });
  await client.upload(files()[0], 0);
  await client.createOffer({ sku: '00123' });
  assert.equal(calls[0].opts.body.get('image').type, 'image/jpeg');
  assert.ok(calls[0].url.endsWith('/image/create_image_from_file'));
  assert.equal(calls[1].opts.method, 'POST');
  assert.ok(calls[1].url.endsWith('/offer'));
  assert.ok(calls.every(call => !call.url.includes('publish')));
});
test('an eBay media service error is retried once and identifies the failed photo', async () => {
  let attempts = 0;
  const client = createEbayClient('test-token', async () => {
    attempts += 1;
    if (attempts === 1) {
      return { ok: false, status: 500, text: async () => JSON.stringify({ errors: [{ message: 'Core Inventory Service internal error' }] }) };
    }
    return { ok: true, status: 201, text: async () => JSON.stringify({ imageUrl: 'https://i.ebayimg.com/photo.jpg' }) };
  });
  assert.equal(await client.upload(files()[0], 0), 'https://i.ebayimg.com/photo.jpg');
  assert.equal(attempts, 2);
});
test('an eBay error identifies the failed draft step', async () => {
  const client = createEbayClient('test-token', async () => ({
    ok: false, status: 500, text: async () => 'Core Inventory Service internal error',
  }));
  await assert.rejects(client.createOffer({ sku: '00123' }), /Creating the eBay draft failed in eBay: Core Inventory/);
});
