/**
 * eBay user (3-legged) OAuth: Authorization Code + refresh token.
 * Used for Sell Fulfillment API (seller orders). Client-credentials tokens cannot call these APIs.
 */
const crypto = require('crypto');

const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const DEFAULT_INTEGRATION_KEY = 'default';
const DEFAULT_SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const AUTHORIZE_BASE = 'https://auth.ebay.com/oauth2/authorize';

const oauthStateStore = new Map();

/** In-memory access token cache (avoid hammering refresh on every Fulfillment page). */
const accessTokenCache = {
  token: null,
  expiresAtMs: 0
};

const CACHE_SKEW_MS = 90_000;

function getEbayClientCreds() {
  const clientId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const clientSecret = process.env.REACT_APP_EBAY_CERT_ID;
  if (!clientId || !clientSecret) return null;
  return { clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() };
}

function getScopeString() {
  return (process.env.EBAY_OAUTH_SCOPES && String(process.env.EBAY_OAUTH_SCOPES).trim()) || DEFAULT_SCOPES;
}

/**
 * eBay requires the OAuth `redirect_uri` query/body value to be the RuName string from the
 * Developer Portal (User Tokens), NOT the HTTP callback URL. Wrong value → invalid_request / no login.
 * @see https://developer.ebay.com/api-docs/static/oauth-redirect-uri.html
 */
function getEbayOAuthRuName() {
  const explicit = process.env.EBAY_OAUTH_RU_NAME?.trim();
  if (explicit) return explicit;

  const legacy = process.env.EBAY_OAUTH_REDIRECT_URI?.trim();
  if (legacy) {
    if (/^https?:\/\//i.test(legacy)) {
      const port = process.env.PORT || 5003;
      const example = `http://localhost:${port}/api/ebay/oauth/callback`;
      throw new Error(
        'eBay expects redirect_uri to be your RuName (eBay Redirect URL name), not a full URL. ' +
          `Set EBAY_OAUTH_RU_NAME in .env to the RuName from Application Keys → User Tokens. ` +
          `In that RuName’s settings, set Auth Accepted URL to your API callback (e.g. ${example}). ` +
          'Remove or clear EBAY_OAUTH_REDIRECT_URI if it only contained that URL.'
      );
    }
    return legacy;
  }

  const port = process.env.PORT || 5003;
  throw new Error(
    'Missing EBAY_OAUTH_RU_NAME. eBay Developer → Application Keys → User Tokens: copy the RuName. ' +
      `Set its Auth Accepted URL to http://localhost:${port}/api/ebay/oauth/callback (or your deployed /api/ebay/oauth/callback).`
  );
}

function pruneOAuthStates() {
  const now = Date.now();
  for (const [k, exp] of oauthStateStore) {
    if (exp < now) oauthStateStore.delete(k);
  }
}

function createOAuthState() {
  pruneOAuthStates();
  const state = crypto.randomBytes(24).toString('hex');
  oauthStateStore.set(state, Date.now() + 10 * 60 * 1000);
  return state;
}

function consumeOAuthState(state) {
  if (!state || typeof state !== 'string') return false;
  pruneOAuthStates();
  const exp = oauthStateStore.get(state);
  if (!exp || Date.now() > exp) return false;
  oauthStateStore.delete(state);
  return true;
}

function invalidateAccessTokenCache() {
  accessTokenCache.token = null;
  accessTokenCache.expiresAtMs = 0;
}

function buildAuthorizeUrl(state) {
  const creds = getEbayClientCreds();
  if (!creds) {
    throw new Error('eBay Client ID and Client Secret are required (EBAY_APP / REACT_APP_EBAY_APP_ID and REACT_APP_EBAY_CERT_ID).');
  }
  const redirectUri = getEbayOAuthRuName();
  const params = new URLSearchParams({
    client_id: creds.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: getScopeString(),
    state
  });
  return `${AUTHORIZE_BASE}?${params.toString()}`;
}

async function exchangeAuthorizationCode(code) {
  const creds = getEbayClientCreds();
  if (!creds) throw new Error('eBay client credentials missing');
  const redirectUri = getEbayOAuthRuName();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code).trim(),
    redirect_uri: redirectUri
  });
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`eBay token exchange failed (${res.status}): ${text.slice(0, 800)}`);
  }
  return JSON.parse(text);
}

async function exchangeRefreshToken(refreshToken, scope) {
  const creds = getEbayClientCreds();
  if (!creds) throw new Error('eBay client credentials missing');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(refreshToken).trim(),
    scope: scope || getScopeString()
  });
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`eBay refresh token failed (${res.status}): ${text.slice(0, 800)}`);
  }
  return JSON.parse(text);
}

/** Best-effort: eBay Commerce Identity user (username + user id). */
async function fetchEbayIdentityUser(accessToken) {
  const url = 'https://apiz.ebay.com/commerce/identity/v1/user/';
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'
    }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Identity user failed ${res.status}: ${t.slice(0, 400)}`);
  }
  return res.json();
}

async function upsertRefreshToken(pool, { userName, refreshToken, scope, ebayUserId }) {
  const key = (process.env.EBAY_OAUTH_INTEGRATION_KEY || DEFAULT_INTEGRATION_KEY).trim() || DEFAULT_INTEGRATION_KEY;
  await pool.query(
    `INSERT INTO ebay_oauth_token (integration_key, user_name, refresh_token, scope, ebay_user_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (integration_key) DO UPDATE SET
       user_name = EXCLUDED.user_name,
       refresh_token = EXCLUDED.refresh_token,
       scope = EXCLUDED.scope,
       ebay_user_id = EXCLUDED.ebay_user_id,
       updated_at = NOW()`,
    [key, userName, refreshToken, scope ?? null, ebayUserId ?? null]
  );
}

async function updateRefreshTokenIfRotated(pool, newRefreshToken) {
  if (!newRefreshToken) return;
  const key = (process.env.EBAY_OAUTH_INTEGRATION_KEY || DEFAULT_INTEGRATION_KEY).trim() || DEFAULT_INTEGRATION_KEY;
  await pool.query(
    `UPDATE ebay_oauth_token SET refresh_token = $2, updated_at = NOW() WHERE integration_key = $1`,
    [key, newRefreshToken]
  );
}

/**
 * Returns a valid user access token for Fulfillment, using DB refresh token + short-lived memory cache.
 */
async function getFulfillmentUserAccessToken(pool) {
  const envOverride = (
    process.env.EBAY_USER_ACCESS_TOKEN || process.env.EBAY_OAUTH_USER_ACCESS_TOKEN || ''
  ).trim();
  if (envOverride) {
    return envOverride;
  }

  if (!pool) throw new Error('Database pool not available');

  const now = Date.now();
  if (accessTokenCache.token && now < accessTokenCache.expiresAtMs - CACHE_SKEW_MS) {
    return accessTokenCache.token;
  }

  const key = (process.env.EBAY_OAUTH_INTEGRATION_KEY || DEFAULT_INTEGRATION_KEY).trim() || DEFAULT_INTEGRATION_KEY;
  const rowResult = await pool.query(
    `SELECT refresh_token, scope FROM ebay_oauth_token WHERE integration_key = $1`,
    [key]
  );
  const row = rowResult.rows?.[0];
  if (!row?.refresh_token) {
    const err = new Error(
      'No eBay seller OAuth token in database. Visit GET /api/ebay/oauth/start (Connect eBay on Orders) or set EBAY_USER_ACCESS_TOKEN for testing.'
    );
    err.code = 'EBAY_USER_TOKEN_MISSING';
    throw err;
  }

  const tok = await exchangeRefreshToken(row.refresh_token, row.scope);
  const access = tok.access_token;
  const expiresIn = Number(tok.expires_in) || 7200;
  if (!access) {
    throw new Error('eBay refresh response missing access_token');
  }

  accessTokenCache.token = access;
  accessTokenCache.expiresAtMs = now + expiresIn * 1000;

  if (tok.refresh_token && String(tok.refresh_token).trim() !== String(row.refresh_token).trim()) {
    await updateRefreshTokenIfRotated(pool, tok.refresh_token);
  }

  return access;
}

module.exports = {
  DEFAULT_INTEGRATION_KEY,
  getEbayClientCreds,
  getEbayOAuthRuName,
  getScopeString,
  createOAuthState,
  consumeOAuthState,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  fetchEbayIdentityUser,
  upsertRefreshToken,
  invalidateAccessTokenCache,
  getFulfillmentUserAccessToken
};
