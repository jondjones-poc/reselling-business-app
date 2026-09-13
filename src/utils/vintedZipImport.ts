import JSZip from 'jszip';

export type ImportedListing = {
  sku: string; title: string; description: string; price: string;
  specifics: { name: string; value: string }[];
  images: File[];
};
const MAX_TOTAL = 60 * 1024 * 1024;

// Bound decompression as it happens, including archives with misleading size metadata.
function readEntry(entry: JSZip.JSZipObject, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    // JSZip exposes this streaming API at runtime but omits it from JSZipObject's types.
    type EntryStream = {
      on(event: 'data', callback: (chunk: Uint8Array) => void): void;
      on(event: 'error', callback: (error: Error) => void): void;
      on(event: 'end', callback: () => void): void;
      pause(): void; resume(): void;
    };
    const stream = (entry as JSZip.JSZipObject & { internalStream(type: 'uint8array'): EntryStream }).internalStream('uint8array');
    stream.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        stream.pause();
        reject(new Error('The ZIP contents are too large. Use up to 60 MB of photos, with each photo under 12 MB.'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      const result = new Uint8Array(size);
      let offset = 0;
      chunks.forEach(chunk => { result.set(chunk, offset); offset += chunk.length; });
      resolve(result);
    });
    stream.resume();
  });
}
const textValue = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const section = (text: string, name: string) => text.match(new RegExp(`^${name}:\\s*\\n([\\s\\S]*?)(?=\\n(?:TITLE|PRICE|DESCRIPTION|ITEM DETAILS[^\\n]*|SOURCE|IMAGES):|(?![\\s\\S]))`, 'm'))?.[1]?.trim() || '';

export async function importVintedZip(data: ArrayBuffer): Promise<ImportedListing> {
  if (data.byteLength > MAX_TOTAL) throw new Error('Choose a ZIP smaller than 60 MB.');
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error('This file is not a valid ZIP.'); }
  if (Object.keys(zip.files).length > 100) throw new Error('This ZIP contains too many files. Choose a single listing export.');
  const decoder = new TextDecoder();
  let listing: Omit<ImportedListing, 'images'>;
  let names: string[];
  if (zip.file('listing.json')) {
    let manifest;
    try { manifest = JSON.parse(decoder.decode(await readEntry(zip.file('listing.json')!, 256 * 1024))); }
    catch { throw new Error('listing.json is invalid or too large. Export the listing again.'); }
    if (manifest?.schema_version !== 1 || manifest?.source?.platform !== 'vinted') {
      throw new Error('Choose a supported Vinted listing ZIP (version 1).');
    }
    const priceLabel = textValue(manifest.price_label);
    listing = {
      sku: typeof manifest.sku === 'number' ? String(manifest.sku) : textValue(manifest.sku),
      title: textValue(manifest.title), description: textValue(manifest.description),
      price: parseGbpPrice(priceLabel),
      specifics: Array.isArray(manifest.item_specifics) ? manifest.item_specifics.map((s: { name?: unknown; value?: unknown }) => ({ name: textValue(s?.name), value: textValue(s?.value) })).filter((s: { name: string; value: string }) => s.name && s.value) : [],
    };
    if (!Array.isArray(manifest.images) || !manifest.images.every((name: unknown) => typeof name === 'string')) throw new Error('The ZIP image list is invalid.');
    names = manifest.images;
  } else {
    const entry = zip.file('listing.txt');
    if (!entry) throw new Error('The ZIP needs listing.json or listing.txt from a Vinted export.');
    const text = decoder.decode(await readEntry(entry, 256 * 1024)).replace(/\r\n/g, '\n');
    if (!/^Vinted item ID:/m.test(text)) throw new Error('Choose a Vinted listing export.');
    listing = {
      sku: text.match(/^Stock SKU:\s*(.+)$/m)?.[1]?.trim() || '',
      title: section(text, 'TITLE'), description: section(text, 'DESCRIPTION'),
      price: parseGbpPrice(section(text, 'PRICE')),
      specifics: (text.match(/^ITEM DETAILS[^\n]*:\s*\n([\s\S]*?)(?=\nSOURCE:)/m)?.[1] || '')
        .split('\n').map(line => {
          const split = line.indexOf(':');
          return { name: split > 0 ? line.slice(0, split).trim() : '', value: split > 0 ? line.slice(split + 1).trim() : '' };
        }).filter(s => s.name && s.value),
    };
    names = Object.keys(zip.files).filter(name => name.startsWith('images/') && !zip.files[name].dir).sort();
  }
  if (names.length < 1 || names.length > 24 || new Set(names).size !== names.length) throw new Error('Include between 1 and 24 different photos in the ZIP.');
  let total = 0;
  const images: File[] = [];
  for (const name of names) {
    if (!/^images\/[^/\\]+\.(jpe?g|png|webp|gif)$/i.test(name) || !zip.file(name)) throw new Error(`Missing or unsupported photo: ${name}`);
    const bytes = await readEntry(zip.file(name)!, Math.min(12 * 1024 * 1024, MAX_TOTAL - total));
    total += bytes.length;
    const ext = name.split('.').pop()!.toLowerCase();
    const type = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    images.push(new File([bytes], name.slice(7), { type }));
  }
  return { ...listing, images };
}

export function parseGbpPrice(label: string): string {
  // Never silently turn EUR/USD values into GBP.
  const match = label.match(/^(?:£\s*|GBP\s*)(\d+(?:,\d{3})*(?:\.\d{1,2})?)$/i)
    || label.match(/^(\d+(?:\.\d{1,2})?)\s*GBP$/i);
  return match ? Number(match[1].replace(/,/g, '')).toFixed(2) : '';
}
