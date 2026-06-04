# Supabase DB keepalive (Cloudflare Worker)

Supabase free projects **pause after ~1 week without database traffic**. Your app already exposes **`GET /api/db-ping`**, which runs `SELECT 1` against Postgres.

This worker **calls that URL on a schedule** so something hits the DB even when nobody uses the app.

**Your stack (typical):** React on **Netlify** → API on **Render** (`server.js`) → **Supabase** Postgres. The worker calls your **Render** service URL; secrets live on **Render** + **Cloudflare**, not Netlify.

## Do I need new env vars on Netlify?

**Usually no.** Netlify is typically only hosting the **React static build**. The keepalive flow is:

1. **Render** (your Node Web Service) — set **`DB_KEEPALIVE_SECRET`** in the Render dashboard → *Environment* for that service, then redeploy if required.
2. **Cloudflare Worker** — set **`KEEPALIVE_URL`** (your Render URL + `/api/db-keepalive`) and **`DB_KEEPALIVE_SECRET`** via `wrangler secret put` (Worker env, not Netlify).

`KEEPALIVE_URL` should look like: `https://your-service-name.onrender.com/api/db-keepalive` (use your real Render hostname from the service *Settings*). **`GET /api/db-ping`** stays public for the browser; only **`/api/db-keepalive`** requires the secret.

Only add vars to **Netlify** if you actually **call** `/api/db-ping` from a Netlify Function (unusual). Do **not** put `DB_KEEPALIVE_SECRET` in `REACT_APP_*` — that would expose it in the browser bundle.

**Render free tier:** the worker’s scheduled `fetch` also wakes a sleeping Render instance before `SELECT 1` runs; the first cron hit after idle may take a bit longer (cold start).

## Why Cloudflare Worker (vs Netlify scheduled function)?

| | Cloudflare Worker | Netlify scheduled function |
|---|-------------------|---------------------------|
| **Needs** | Cloudflare account (free tier) | Site hosted on Netlify |
| **API host** | Your **Render** service URL (or any public API URL) | Any URL (but config lives in Netlify repo/site) |
| **Cron** | `[triggers].crons` in `wrangler.toml` | `[[plugins]]` + `schedule` in `netlify.toml` |

**Recommendation:** Use this worker if your API is **not** on Netlify, or you want keepalive **decoupled** from frontend deploys. Use **Netlify scheduled functions** only if you already use Netlify and prefer everything in one repo pipeline.

**Even simpler (no Worker):** [GitHub Actions `on: schedule`](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule) with `curl` to `/api/db-keepalive` — zero extra vendor, but you must store the secret in GitHub Actions secrets.

## Server setup (Render + `server.js`)

1. In the **Render** dashboard: open your **Web Service** → **Environment** → add **`DB_KEEPALIVE_SECRET`** (long random string). Save; trigger a redeploy if Render does not pick up env changes automatically.
2. Confirm the URL works: `curl -H "Authorization: Bearer YOUR_SECRET" https://<your-service>.onrender.com/api/db-keepalive`.
3. When **`DB_KEEPALIVE_SECRET`** is set, **`/api/db-keepalive`** requires **`Authorization: Bearer <same secret>`** (query `?secret=` is also accepted but avoid logging). **`/api/db-ping`** does not require auth.

## Deploy this worker

**From your machine** (Wrangler needs a logged-in session or an API token — Cursor’s automated shell cannot complete `wrangler login` for you). Open a **second terminal tab** in the project and run:

```bash
cd workers/db-keepalive
npx wrangler@3 login
npx wrangler@3 deploy
```

**CI / non-interactive:** create a Cloudflare API token (Workers Edit) and deploy with:

```bash
export CLOUDFLARE_API_TOKEN=...   # from Cloudflare dashboard → API Tokens
cd workers/db-keepalive
npx wrangler@3 deploy
```

(Optional: set `CLOUDFLARE_ACCOUNT_ID` if Wrangler asks for it.)

Set secrets (values hidden in Cloudflare dashboard):

```bash
npx wrangler@3 secret put KEEPALIVE_URL
# paste: https://<your-service>.onrender.com/api/db-keepalive

npx wrangler@3 secret put DB_KEEPALIVE_SECRET
# paste: same string as DB_KEEPALIVE_SECRET on your API server
```

Alternatively, put only **`KEEPALIVE_URL`** in `wrangler.toml` under `[vars]` if you are fine with the URL being in git (still use `secret put` for the bearer token).

### Test once

In the **Cloudflare dashboard**: Workers & Pages → your worker → **Triggers** → Cron Triggers → use the test / “run now” control if available, or temporarily add a dev-only route.

From the CLI you can also run a one-off fetch after deploy:

```bash
curl -sS -H "Authorization: Bearer YOUR_DB_KEEPALIVE_SECRET" "https://<your-service>.onrender.com/api/db-keepalive"
```

That hits your **API** directly (same as the worker).

### Cron schedule

Default: **Monday and Thursday 08:00 UTC** (`wrangler.toml` `[triggers].crons`). Adjust if you want daily pings.

## Netlify alternative (outline)

1. Add `netlify/functions/scheduled-db-ping.mts` that `fetch()`es your API with the Bearer header.
2. In `netlify.toml`, enable `@netlify/plugin-scheduled-functions` (or built-in schedule) with e.g. `schedule = "@weekly"`.
3. Set `DB_KEEPALIVE_SECRET` and `KEEPALIVE_URL` in Netlify environment variables.

See Netlify docs: **Scheduled Functions**.
