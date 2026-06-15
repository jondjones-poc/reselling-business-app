# Seller Solds daily cache (Cloudflare Worker)

Fetches all tracked sellers’ sold listings from eBay once per day and stores them in Postgres. The Seller Solds page reads that cache only — no slow eBay calls when you open the app.

**Schedule:** 16:00 UTC daily (= **4pm GMT**; 5pm UK local during British Summer Time).

**Stack:** Cloudflare Worker (cron) → **Render** `POST /api/research-seller/cache-refresh` → eBay Browse API → **Supabase** Postgres (`ebay_research_seller_item_cache`).

## What gets refreshed

Default cron run refreshes these filter combinations:

- **Sold within:** 14 days (primary), plus 7 and 30 days
- **Min price:** £25

Each seller gets **every sold listing eBay returns in that window** — no fixed item cap (typically a few dozen to a few hundred per active seller in 2 weeks).

## Deploy

```bash
cd workers/research-seller-cache
npx wrangler@3 login
npx wrangler@3 deploy
npx wrangler@3 secret put DB_KEEPALIVE_SECRET
```

Use the **same** `DB_KEEPALIVE_SECRET` as on Render and the db-keepalive worker.

Optional: override `REFRESH_URL` in `wrangler.toml` if your Render URL differs.

## Test without waiting for cron

Cloudflare dashboard → Workers & Pages → **reselling-research-seller-cache** → **Triggers** → **Run now**.

Or from your machine (replace secret):

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_DB_KEEPALIVE_SECRET" \
  "https://reselling-business-app.onrender.com/api/research-seller/cache-refresh"
```

Returns `202` immediately; the job runs in the background on Render (may take several minutes for many sellers).

## Render requirements

- `DB_KEEPALIVE_SECRET` — auth for this endpoint
- `REACT_APP_EBAY_APP_ID` / `REACT_APP_EBAY_CERT_ID` — Browse API
- Postgres tables from `database/ebay_research_seller_item_cache.sql`
