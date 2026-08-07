# Seller Solds daily cache + scheduled eBay drafts + Brand Trends weekly cache

Fetches tracked sellers’ sold listings from eBay once per day, publishes any due
scheduled Seller Hub drafts, and refreshes Google Trends interest for brands weekly.

## Schedules

| Job | Cron (UTC) | UK time |
|---|---|---|
| Seller Solds cache + scheduled listing publishes | `0 16 * * *` | 4pm GMT / 5pm BST |
| Brand Trends cache | `0 5 * * 1` (Mondays) | 5am GMT / 6am BST |

**Stack:** Cloudflare Worker → **Render** authenticated `POST` → eBay / Google Trends → **Supabase** Postgres.

## What gets refreshed

### Seller Solds (daily)

- **Sold within:** 14 days (primary), plus 7 and 30 days
- **Min price:** £25

### Scheduled listings (same daily cron)

- Rows in `ebay_scheduled_listing` with `scheduled_for <= today` (Europe/London) and status `pending`/`failed`
- Each due offer is published via Inventory `publishOffer`
- SQL: `database/ebay_scheduled_listing.sql`

### Brand Trends (weekly)

- Every brand in `brand` (name → Google Trends `interestOverTime`, geo GB, ~5 years)
- Scores for **6m / 1y / 2y / 5y** stored in `research_brand_trends_cache`
- Run SQL: `database/research_brand_trends_cache.sql`

## Deploy

```bash
cd workers/research-seller-cache
npx wrangler@3 login
npx wrangler@3 deploy
npx wrangler@3 secret put DB_KEEPALIVE_SECRET
```

Use the **same** `DB_KEEPALIVE_SECRET` as on Render and the db-keepalive worker.

Optional: override `REFRESH_URL` / `BRAND_TRENDS_REFRESH_URL` / `SCHEDULED_LISTINGS_RUN_URL` in `wrangler.toml` if your Render URL differs.

## Test without waiting for cron

Cloudflare dashboard → Workers & Pages → **reselling-research-seller-cache** → **Triggers** → **Run now**
(pick the cron you want to test).

Or from your machine:

```bash
# Seller solds
curl -X POST \
  -H "Authorization: Bearer YOUR_DB_KEEPALIVE_SECRET" \
  "https://reselling-business-app.onrender.com/api/research-seller/cache-refresh"

# Due scheduled draft publishes
curl -X POST \
  -H "Authorization: Bearer YOUR_DB_KEEPALIVE_SECRET" \
  "https://reselling-business-app.onrender.com/api/ebay/scheduled-listings/run"

# Brand trends
curl -X POST \
  -H "Authorization: Bearer YOUR_DB_KEEPALIVE_SECRET" \
  "https://reselling-business-app.onrender.com/api/research/in-fashion/brand-trends/refresh"
```

Jobs return `202` immediately; work runs in the background on Render.

## Render requirements

- `DB_KEEPALIVE_SECRET` — auth for cron endpoints
- `REACT_APP_EBAY_APP_ID` / `REACT_APP_EBAY_CERT_ID` — Browse API (seller cache)
- Connected eBay seller OAuth with **`sell.inventory`** scope (reconnect via Orders → Schedule Listing if needed)
- Postgres tables from `database/ebay_research_seller_item_cache.sql`,
  `database/research_brand_trends_cache.sql`, and `database/ebay_scheduled_listing.sql`
