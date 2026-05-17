/**
 * @param {Request} request
 * @param {{ KEEPALIVE_URL?: string; DB_KEEPALIVE_SECRET?: string }} env
 * @param {ExecutionContext} ctx
 */
async function runPing(env) {
  const url = (env.KEEPALIVE_URL || '').trim();
  if (!url) {
    console.error('db-keepalive: KEEPALIVE_URL is not set');
    return { ok: false, error: 'KEEPALIVE_URL missing' };
  }
  /** @type {Record<string, string>} */
  const headers = { 'user-agent': 'cloudflare-worker-db-keepalive/1' };
  const secret = (env.DB_KEEPALIVE_SECRET || '').trim();
  if (secret) {
    headers.authorization = `Bearer ${secret}`;
  }
  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();
  if (!res.ok) {
    console.error('db-keepalive: upstream', res.status, text.slice(0, 200));
    return { ok: false, status: res.status, body: text.slice(0, 200) };
  }
  return { ok: true, status: res.status };
}

export default {
  /**
   * Cron: configured in wrangler.toml [triggers].crons
   * @param {ScheduledEvent} _event
   * @param {{ KEEPALIVE_URL?: string; DB_KEEPALIVE_SECRET?: string }} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      runPing(env).then((r) => {
        if (!r.ok) console.error('db-keepalive scheduled run failed', r);
      })
    );
  },

  /** HTTP only for health; pings run on cron. Test from Cloudflare dashboard → Worker → Triggers → "Run now". */
  async fetch() {
    return new Response('db-keepalive worker — cron only. See README.', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
