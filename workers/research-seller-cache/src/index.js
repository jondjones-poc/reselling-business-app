/**
 * Daily cron: POST to Render /api/research-seller/cache-refresh (eBay → Postgres).
 * @param {Request} request
 * @param {{ REFRESH_URL?: string; DB_KEEPALIVE_SECRET?: string }} env
 * @param {ExecutionContext} ctx
 */
async function triggerCacheRefresh(env) {
  const url = (env.REFRESH_URL || '').trim();
  if (!url) {
    console.error('research-seller-cache: REFRESH_URL is not set');
    return { ok: false, error: 'REFRESH_URL missing' };
  }
  /** @type {Record<string, string>} */
  const headers = {
    'user-agent': 'cloudflare-worker-research-seller-cache/1',
    'content-type': 'application/json'
  };
  const secret = (env.DB_KEEPALIVE_SECRET || '').trim();
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  }
  const res = await fetch(url, { method: 'POST', headers });
  const text = await res.text();
  if (!res.ok) {
    console.error('research-seller-cache: upstream', res.status, text.slice(0, 300));
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

export default {
  /**
   * Cron: 16:00 UTC daily (= 4pm GMT; 5pm BST in summer).
   * @param {ScheduledEvent} _event
   * @param {{ REFRESH_URL?: string; DB_KEEPALIVE_SECRET?: string }} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      triggerCacheRefresh(env).then((r) => {
        if (!r.ok) console.error('research-seller-cache scheduled run failed', r);
        else console.log('research-seller-cache scheduled run ok', r.body);
      })
    );
  },

  /** Health only — cron does the work. Test via Cloudflare dashboard → Triggers → Run now. */
  async fetch() {
    return new Response('research-seller-cache worker — cron only. See README.', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
};
