/**
 * Cron worker:
 * - Daily: Seller Solds cache refresh + due scheduled eBay draft publishes
 * - Weekly (Monday): Brand Trends cache refresh (Google Trends → Postgres)
 *
 * @param {{
 *   REFRESH_URL?: string;
 *   BRAND_TRENDS_REFRESH_URL?: string;
 *   SCHEDULED_LISTINGS_RUN_URL?: string;
 *   DB_KEEPALIVE_SECRET?: string;
 * }} env
 */
async function postWithSecret(url, env, label) {
  const target = (url || '').trim();
  if (!target) {
    console.error(`${label}: URL is not set`);
    return { ok: false, error: 'URL missing' };
  }
  /** @type {Record<string, string>} */
  const headers = {
    'user-agent': 'cloudflare-worker-research-seller-cache/3',
    'content-type': 'application/json',
  };
  const secret = (env.DB_KEEPALIVE_SECRET || '').trim();
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  }
  const res = await fetch(target, { method: 'POST', headers });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${label}: upstream`, res.status, text.slice(0, 300));
    return { ok: false, status: res.status, body: text.slice(0, 300) };
  }
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { ok: true, status: res.status, body };
}

async function triggerSellerCacheRefresh(env) {
  return postWithSecret(env.REFRESH_URL, env, 'research-seller-cache');
}

async function triggerBrandTrendsRefresh(env) {
  return postWithSecret(
    env.BRAND_TRENDS_REFRESH_URL,
    env,
    'research-brand-trends'
  );
}

async function triggerScheduledListingsRun(env) {
  return postWithSecret(
    env.SCHEDULED_LISTINGS_RUN_URL,
    env,
    'ebay-scheduled-listings'
  );
}

/** Weekly brand-trends cron expression (must match wrangler.toml). */
const BRAND_TRENDS_CRON = '0 5 * * 1';

export default {
  /**
   * @param {ScheduledEvent} event
   * @param {{
   *   REFRESH_URL?: string;
   *   BRAND_TRENDS_REFRESH_URL?: string;
   *   SCHEDULED_LISTINGS_RUN_URL?: string;
   *   DB_KEEPALIVE_SECRET?: string;
   * }} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(event, env, ctx) {
    const cron = String(event?.cron || '');
    if (cron === BRAND_TRENDS_CRON) {
      ctx.waitUntil(
        triggerBrandTrendsRefresh(env).then((r) => {
          if (!r.ok) console.error('brand-trends scheduled run failed', r);
          else console.log('brand-trends scheduled run ok', r.body);
        })
      );
      return;
    }

    // Daily cron: seller solds cache + any due scheduled draft publishes
    ctx.waitUntil(
      Promise.all([
        triggerSellerCacheRefresh(env).then((r) => {
          if (!r.ok) console.error('research-seller-cache scheduled run failed', r);
          else console.log('research-seller-cache scheduled run ok', r.body);
        }),
        triggerScheduledListingsRun(env).then((r) => {
          if (!r.ok) console.error('ebay-scheduled-listings scheduled run failed', r);
          else console.log('ebay-scheduled-listings scheduled run ok', r.body);
        }),
      ])
    );
  },

  /** Health only — cron does the work. Test via Cloudflare dashboard → Triggers → Run now. */
  async fetch() {
    return new Response(
      'research-seller-cache worker — cron only (daily seller cache + scheduled listings, weekly brand trends). See README.',
      {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }
    );
  },
};
