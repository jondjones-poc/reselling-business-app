import JSZip from 'jszip';
import { TextDecoder } from 'util';
import { importVintedZip, parseGbpPrice } from './vintedZipImport';
Object.assign(global, { TextDecoder });
async function archive(manifest?: object, text?: string) {
  const zip = new JSZip();
  if (manifest) zip.file('listing.json', JSON.stringify(manifest));
  if (text) zip.file('listing.txt', text);
  zip.file('images/01.jpg', new Uint8Array([255,216,255]));
  return zip.generateAsync({ type: 'arraybuffer' });
}
const manifest = { schema_version: 1, sku: '00123', source: { platform: 'vinted' }, title: 'Shirt', description: 'Blue shirt', price_label: '£12.50', images: ['images/01.jpg'] };
test('new exports preserve SKU and ordered photos', async () => {
  const listing = await importVintedZip(await archive(manifest));
  expect(listing.sku).toBe('00123'); expect(listing.price).toBe('12.50');
  expect(listing.images[0].name).toBe('01.jpg');
});
test('legacy listing text keeps multiline description and SKU', async () => {
  const listing = await importVintedZip(await archive(undefined, 'TITLE:\nShirt\n\nPRICE:\n£12\n\nDESCRIPTION:\nBlue shirt\nSecond line\n\nSOURCE:\nVinted item ID: 999\nStock SKU: 00123\n\nIMAGES:\nSee images'));
  expect(listing.description).toBe('Blue shirt\nSecond line'); expect(listing.sku).toBe('00123');
});
test('foreign prices require manual entry and missing images fail', async () => {
  expect(parseGbpPrice('€12.50')).toBe('');
  await expect(importVintedZip(await archive({ ...manifest, images: ['images/missing.jpg'] }))).rejects.toThrow('Missing');
});
test('malformed archives and unsupported versions are rejected', async () => {
  await expect(importVintedZip(new ArrayBuffer(5))).rejects.toThrow('valid ZIP');
  await expect(importVintedZip(await archive({ ...manifest, schema_version: 2 }))).rejects.toThrow('version 1');
});
