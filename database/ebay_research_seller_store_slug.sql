-- Store URL slug for tracked sellers (often differs from Browse API username, e.g. jamsebazaar vs jams.ebazaar).
ALTER TABLE ebay_research_seller
  ADD COLUMN IF NOT EXISTS store_slug VARCHAR(64);

-- Back-fill: dotted usernames → store slug without dots (common eBay Store pattern).
UPDATE ebay_research_seller
SET store_slug = regexp_replace(trim(username), '\.', '', 'g')
WHERE store_slug IS NULL
  AND trim(username) ~ '\.';
