/** Portable listing data. SKU is a string for reuse as an eBay inventory SKU/custom label. */
function buildVintedExportManifest({ stockId, vintedId, sourceUrl, title, description, priceLabel, specifics, imageEntries }) {
  return {
    schema_version: 1,
    sku: stockId == null ? null : String(stockId),
    source: { platform: 'vinted', listing_id: String(vintedId), url: sourceUrl },
    title: title ?? null,
    description: description ?? null,
    // Keep the original label; a future importer must confirm price and currency.
    price_label: priceLabel ?? null,
    item_specifics: specifics ?? [],
    images: imageEntries.map(image => image.name),
  };
}

module.exports = { buildVintedExportManifest };
