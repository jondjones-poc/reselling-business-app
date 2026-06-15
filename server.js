const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');
const http = require('http');
const dns = require('dns');
const { Pool } = require('pg');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Keep all server-side Date handling on UK timezone (GMT/BST).
process.env.TZ = 'Europe/London';

const ebaySellerOAuth = require('./ebaySellerOAuth');
const { normalizeDateOnlyString, serializeStockDateFields } = require('./utils/dateOnly');

const app = express();
const PORT = process.env.PORT || 5003;

const authAllowedOrigins = new Set(
  [
    ...(process.env.AUTH_ALLOWED_ORIGINS || '').split(','),
    process.env.FRONTEND_DEV_ORIGIN,
    process.env.FRONTEND_DEV_ORIGIN_ALT,
    ...(process.env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5003']),
  ]
    .map((value) => String(value || '').trim().replace(/\/$/, ''))
    .filter(Boolean)
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = origin.replace(/\/$/, '');
      if (authAllowedOrigins.has(normalized)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const settingsPath = path.join(__dirname, 'settings.json');
const mensResaleReferencePath = path.join(__dirname, 'mensResaleReference.json');

let mensResaleReference = [];
try {
  if (fs.existsSync(mensResaleReferencePath)) {
    const mensResaleContent = fs.readFileSync(mensResaleReferencePath, 'utf-8');
    mensResaleReference = JSON.parse(mensResaleContent);
    console.log(`Loaded ${mensResaleReference.length} brands from mensResaleReference.json`);
  } else {
    console.warn('mensResaleReference.json not found. Using empty array.');
  }
} catch (error) {
  console.error('Failed to load mensResaleReference.json:', error);
  mensResaleReference = [];
}


// Extract brands marked as avoid (❌) for settings
// (Only used if JSON file fails to load)
const avoidBrandsList = mensResaleReference
  .filter(item => item.status === "❌")
  .map(item => item.brand);

let appSettings = { categories: [], stockCategories: [], material: [], colors: [], brands: [], patterns: [], gender: [], avoidBrands: avoidBrandsList };
let dbPool = null;

try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (dnsError) {
  console.warn('Unable to set default DNS result order:', dnsError.message);
}

const buildBadRequest = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const normalizeTextInput = (value) => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const normalizeDecimalInput = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    throw buildBadRequest(`Invalid number for ${fieldName}. Please provide a numeric value.`);
  }
  return numeric;
};

const normalizeDateInputValue = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = normalizeDateOnlyString(value);
  if (!normalized) {
    throw buildBadRequest(`Invalid date for ${fieldName}. Please use the YYYY-MM-DD format.`);
  }

  return normalized;
};

const ensureIsoDateString = (value) => normalizeDateOnlyString(value);

const STOCK_DATE_SELECT_SQL = `to_char(purchase_date, 'YYYY-MM-DD') AS purchase_date, to_char(sale_date, 'YYYY-MM-DD') AS sale_date`;

const STOCK_ROW_SELECT_COLUMNS = `id, item_name, purchase_price, ${STOCK_DATE_SELECT_SQL}, sale_price, sold_platform, net_profit, vinted_id, ebay_id, depop_id, brand_id, category_id, brand_tag_image_id, projected_sale_price, category_size_id, sourced_location, is_inventory_write_off, is_bulky_item, is_ebay_draft`;

const STOCK_ROW_RETURNING_COLUMNS = `id, item_name, purchase_price, ${STOCK_DATE_SELECT_SQL}, sale_price, sold_platform, net_profit, vinted_id, ebay_id, depop_id, brand_id, category_id, brand_tag_image_id, projected_sale_price, category_size_id, sourced_location, is_inventory_write_off, is_bulky_item, is_ebay_draft`;

const loadSettings = () => {
  try {
    if (fs.existsSync(settingsPath)) {
      const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(settingsContent);
      console.log('Loaded settings snapshot:', parsed);
      appSettings = {
        categories: parsed.categories ?? [],
        stockCategories: parsed.stockCategories ?? [],
        material: parsed.material ?? [],
        colors: parsed.colors ?? [],
        brands: parsed.brands ?? [],
        patterns: parsed.patterns ?? [],
        gender: parsed.gender ?? [], // Load gender
        avoidBrands: parsed.avoidBrands ?? avoidBrandsList
      };
      return appSettings;
    }
    console.warn('settings.json not found at project root. Using empty settings.');
    return appSettings;
  } catch (settingsError) {
    console.error('Failed to load settings.json:', settingsError);
    return appSettings;
  }
};

function supabaseProjectRefFromUrl(supabaseUrl) {
  if (!supabaseUrl || typeof supabaseUrl !== 'string') return null;
  try {
    const hostname = new URL(supabaseUrl.trim()).hostname;
    const ref = hostname.split('.')[0];
    return ref || null;
  } catch {
    return null;
  }
}

function buildSupabaseConnectionStringFromEnv() {
  const supabasePassword = process.env.SUPABASE_DB_PASSWORD;
  if (!supabasePassword) return null;

  const explicitHost = process.env.SUPABASE_DB_HOST?.trim();
  const projectRef = supabaseProjectRefFromUrl(process.env.SUPABASE_URL);
  const dbHost = explicitHost || (projectRef ? `db.${projectRef}.supabase.co` : null);
  if (!dbHost) return null;

  return `postgresql://postgres:${encodeURIComponent(supabasePassword)}@${dbHost}:5432/postgres`;
}

const getDatabasePool = () => {
  if (dbPool) {
    return dbPool;
  }

  let connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    connectionString = buildSupabaseConnectionStringFromEnv();
    if (!connectionString) {
      console.warn(
        'Supabase DB not configured. Set SUPABASE_DB_URL, DATABASE_URL, or SUPABASE_DB_PASSWORD + SUPABASE_URL.'
      );
      return null;
    }
  }

  let originalHostname = null;
  try {
    originalHostname = new URL(connectionString).hostname;
  } catch {
    /* ignore invalid connection string here; pg will error on connect */
  }

  const forceIpv4 = process.env.SUPABASE_DB_FORCE_IPV4 === '1';
  const poolConfig = {
    connectionString,
    ssl: {
      rejectUnauthorized: false,
      ...(originalHostname ? { servername: originalHostname } : {})
    }
  };

  if (forceIpv4) {
    poolConfig.lookup = (hostname, options, callback) => {
      const lookupOptions = {
        ...(options || {}),
        family: 4,
        hints: ((options && options.hints) || 0) | dns.ADDRCONFIG
      };
      return dns.lookup(hostname, lookupOptions, callback);
    };
  }

  dbPool = new Pool(poolConfig);

  dbPool.on('error', (poolError) => {
    console.error('Unexpected Postgres client error:', poolError);
  });

  dbPool.on('connect', (client) => {
    client
      .query("SET TIME ZONE 'Europe/London'")
      .catch((timezoneError) => console.error('Failed to set Postgres session timezone:', timezoneError));
  });

  return dbPool;
};

const BRAND_TAG_IMAGE_BUCKET = process.env.SUPABASE_STORAGE_BRAND_TAGS_BUCKET || 'brand-tag-images';

let supabaseAdmin = null;
const getSupabaseAdmin = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(url, key, { auth: { persistSession: false } });
  }
  return supabaseAdmin;
};

function getAllowedAuthEmailsFromEnv() {
  const raw = process.env.ALLOWED_AUTH_EMAILS || process.env.REACT_APP_ALLOWED_AUTH_EMAILS || '';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function getAuthAdminEmails() {
  const raw = process.env.AUTH_ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

const AUTH_USER_ROLES = ['admin', 'user'];

function normalizeAuthRole(raw) {
  const role = String(raw || 'user').trim().toLowerCase();
  return AUTH_USER_ROLES.includes(role) ? role : 'user';
}

function isEnvAuthAdminEmail(email) {
  if (!email) return false;
  return getAuthAdminEmails().includes(String(email).trim().toLowerCase());
}

function normalizeAuthEmailInput(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

async function ensureAuthAllowedEmailTable(pool) {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_allowed_email (
      id SERIAL PRIMARY KEY,
      email VARCHAR(320) NOT NULL,
      role VARCHAR(16) NOT NULL DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT auth_allowed_email_email_unique UNIQUE (email),
      CONSTRAINT auth_allowed_email_role_check CHECK (role IN ('admin', 'user'))
    )
  `);
  await pool.query(`
    ALTER TABLE auth_allowed_email ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user'
  `);
  await pool.query(`
    ALTER TABLE auth_allowed_email ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_auth_allowed_email_email ON auth_allowed_email (LOWER(email))
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_auth_allowed_email_role ON auth_allowed_email (role)
  `);
}

async function loadAuthUserRoleFromDb(pool, email) {
  if (!pool || !email) return null;
  try {
    await ensureAuthAllowedEmailTable(pool);
    const result = await pool.query(
      `SELECT role FROM auth_allowed_email WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    const role = result.rows[0]?.role;
    return role ? normalizeAuthRole(role) : null;
  } catch (err) {
    console.warn('loadAuthUserRoleFromDb failed:', err?.message || err);
    return null;
  }
}

async function isAuthAdminUser(email) {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  if (isEnvAuthAdminEmail(normalized)) return true;

  const pool = getDatabasePool();
  const role = await loadAuthUserRoleFromDb(pool, normalized);
  return role === 'admin';
}

async function loadAllowedSignInEmailsFromDb(pool) {
  if (!pool) return [];
  try {
    await ensureAuthAllowedEmailTable(pool);
    const result = await pool.query(
      `SELECT email FROM auth_allowed_email ORDER BY LOWER(email) ASC`
    );
    return result.rows
      .map((row) => String(row.email || '').trim().toLowerCase())
      .filter(Boolean);
  } catch (err) {
    console.warn('loadAllowedSignInEmailsFromDb failed:', err?.message || err);
    return [];
  }
}

async function isAllowedAuthEmail(email) {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();

  if (isEnvAuthAdminEmail(normalized)) return true;

  const envAllowed = getAllowedAuthEmailsFromEnv();
  if (envAllowed.includes(normalized)) return true;

  const pool = getDatabasePool();
  const dbAllowed = await loadAllowedSignInEmailsFromDb(pool);
  if (dbAllowed.includes(normalized)) return true;

  return false;
}

async function requireAuthAdmin(req, res) {
  const resolved = await resolveAuthUserFromRequest(req, res);
  if (resolved.kind === 'transient') {
    respondAuthTransientUnavailable(res);
    return null;
  }
  const user = getAuthUserFromResolve(resolved);
  if (!user?.email) {
    res.status(401).json({ error: 'Sign in required.' });
    return null;
  }
  if (!(await isAuthAdminUser(user.email))) {
    res.status(403).json({ error: 'Admin access required.' });
    return null;
  }
  return user;
}

async function requireAuthUser(req, res) {
  const resolved = await resolveAuthUserFromRequest(req, res);
  if (resolved.kind === 'transient') {
    respondAuthTransientUnavailable(res);
    return null;
  }
  const user = getAuthUserFromResolve(resolved);
  if (!user?.email) {
    res.status(401).json({ error: 'Sign in required.' });
    return null;
  }
  if (!(await isAllowedAuthEmail(user.email))) {
    clearAuthCookies(res);
    res.status(403).json({ error: 'Not allowed to access this application.' });
    return null;
  }
  return user;
}

const PUBLIC_API_ROUTES = new Set([
  'GET /db-ping',
  'GET /db-keepalive',
  'POST /research-seller/cache-refresh',
  'GET /ebay/oauth/callback',
]);

function isPublicApiRoute(req) {
  if (req.method === 'OPTIONS') return true;
  if (req.path.startsWith('/auth/')) return true;
  return PUBLIC_API_ROUTES.has(`${req.method} ${req.path}`);
}

async function apiAuthMiddleware(req, res, next) {
  try {
    if (isPublicApiRoute(req)) {
      return next();
    }
    const user = await requireAuthUser(req, res);
    if (!user) return;
    req.authUser = user;
    req.authUserEmail = user.email ? String(user.email).trim().toLowerCase() : null;
    next();
  } catch (err) {
    console.error('API auth middleware error:', err);
    res.status(500).json({ error: 'Authentication check failed.' });
  }
}

function parseCookieHeader(header) {
  const cookies = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const trimmed = part.trim();
      if (!trimmed) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      cookies[key] = decodeURIComponent(value);
    });
  return cookies;
}

function authCookieBaseOptions() {
  const secure = process.env.NODE_ENV === 'production' || process.env.AUTH_COOKIE_SECURE === '1';
  // SameSite=None + Secure in production so cookies work when UI and API hosts differ.
  const sameSite =
    process.env.AUTH_COOKIE_SAMESITE === 'lax'
      ? 'Lax'
      : process.env.AUTH_COOKIE_SAMESITE === 'strict'
        ? 'Strict'
        : secure
          ? 'None'
          : 'Lax';
  return `Path=/; HttpOnly; SameSite=${sameSite}${secure ? '; Secure' : ''}`;
}

function getAuthSessionMaxAgeSeconds() {
  const daysRaw = process.env.AUTH_SESSION_MAX_AGE_DAYS;
  const days = daysRaw != null && String(daysRaw).trim() !== '' ? Number(daysRaw) : 365;
  const effectiveDays = Number.isFinite(days) && days >= 1 ? days : 365;
  // At least 30 days so users stay signed in across typical usage.
  return Math.floor(Math.max(30, effectiveDays) * 24 * 60 * 60);
}

function readAuthTokensFromCookies(req) {
  const cookies = parseCookieHeader(req.headers.cookie);
  const bundled = cookies.rbauth || '';
  if (bundled) {
    try {
      const parsed = JSON.parse(decodeURIComponent(bundled));
      return {
        accessToken: parsed.a ? String(parsed.a) : '',
        refreshToken: parsed.r ? String(parsed.r) : '',
      };
    } catch {
      /* fall through to legacy cookies */
    }
  }
  return {
    accessToken: cookies.rbauth_access ? String(cookies.rbauth_access) : '',
    refreshToken: cookies.rbauth_refresh ? String(cookies.rbauth_refresh) : '',
  };
}

function setAuthCookies(res, session) {
  const accessToken = session?.access_token ? String(session.access_token) : '';
  const refreshToken = session?.refresh_token ? String(session.refresh_token) : '';
  if (!accessToken || !refreshToken) {
    throw new Error('Missing auth tokens');
  }
  const maxAgeSeconds = getAuthSessionMaxAgeSeconds();
  const base = authCookieBaseOptions();
  const payload = encodeURIComponent(JSON.stringify({ a: accessToken, r: refreshToken }));
  // Single Set-Cookie — some proxies (Netlify → Render) drop additional Set-Cookie headers.
  res.setHeader('Set-Cookie', `rbauth=${payload}; Max-Age=${maxAgeSeconds}; ${base}`);
  res.setHeader('Cache-Control', 'no-store');
}

function clearAuthCookies(res) {
  const base = authCookieBaseOptions();
  res.setHeader('Set-Cookie', [
    `rbauth=; Max-Age=0; ${base}`,
    `rbauth_access=; Max-Age=0; ${base}`,
    `rbauth_refresh=; Max-Age=0; ${base}`,
  ]);
}

function isTransientAuthError(err) {
  if (!err) return false;
  const causeCode = err?.cause?.code || err?.code;
  if (
    causeCode === 'ECONNRESET' ||
    causeCode === 'ETIMEDOUT' ||
    causeCode === 'ENOTFOUND' ||
    causeCode === 'EAI_AGAIN' ||
    causeCode === 'ECONNREFUSED'
  ) {
    return true;
  }
  const msg = String(err?.message || err).toLowerCase();
  if (/fetch failed|network|timeout|socket hang up|aborted|econnreset|etimedout/.test(msg)) {
    return true;
  }
  const status = Number(err?.status ?? err?.statusCode);
  return Number.isFinite(status) && status >= 500;
}

function isDefinitiveAuthTokenError(err) {
  if (!err) return false;
  const msg = String(err?.message || err).toLowerCase();
  const code = String(err?.code ?? err?.error_code ?? '').toLowerCase();
  if (code === 'invalid_grant' || code === 'refresh_token_not_found' || code === 'session_not_found') {
    return true;
  }
  return /invalid refresh token|refresh token not found|invalid grant|token has been revoked|user not found/.test(
    msg
  );
}

async function resolveAuthUserFromRequest(req, res) {
  const sb = getSupabaseAdmin();
  if (!sb) return { kind: 'none' };

  const { accessToken, refreshToken } = readAuthTokensFromCookies(req);
  if (!accessToken && !refreshToken) return { kind: 'none' };

  if (accessToken) {
    try {
      const { data, error } = await sb.auth.getUser(accessToken);
      if (!error && data.user) {
        return { kind: 'ok', user: data.user, session: null };
      }
      if (error) {
        if (isTransientAuthError(error)) return { kind: 'transient' };
        if (!refreshToken) {
          clearAuthCookies(res);
          return { kind: 'none' };
        }
      }
    } catch (err) {
      if (isTransientAuthError(err)) return { kind: 'transient' };
      if (!refreshToken) {
        clearAuthCookies(res);
        return { kind: 'none' };
      }
    }
  }

  if (refreshToken) {
    try {
      const { data, error } = await sb.auth.refreshSession({ refresh_token: refreshToken });
      if (!error && data.session?.user) {
        setAuthCookies(res, data.session);
        return { kind: 'ok', user: data.session.user, session: data.session };
      }
      if (error) {
        if (isDefinitiveAuthTokenError(error)) {
          clearAuthCookies(res);
          return { kind: 'none' };
        }
        if (isTransientAuthError(error)) return { kind: 'transient' };
        console.warn('[auth] refresh failed (keeping session cookie):', error.message);
        return { kind: 'transient' };
      }
    } catch (err) {
      if (isDefinitiveAuthTokenError(err)) {
        clearAuthCookies(res);
        return { kind: 'none' };
      }
      console.warn('[auth] refresh error (keeping session cookie):', err?.message || err);
      return { kind: 'transient' };
    }
  }

  clearAuthCookies(res);
  return { kind: 'none' };
}

function getAuthUserFromResolve(resolved) {
  return resolved?.kind === 'ok' ? resolved.user : null;
}

function respondAuthTransientUnavailable(res) {
  res.status(503).json({
    error: 'Auth service temporarily unavailable. Retry shortly.',
    retry: true,
    transient: true,
  });
}

function getDefaultFrontendOrigin() {
  const prodOrigins = (process.env.AUTH_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => String(value || '').trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (prodOrigins.length) return prodOrigins[0];
  return (process.env.FRONTEND_DEV_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
}

function getFrontendOriginFromRequest(req) {
  const candidates = [req.get('origin'), req.get('referer')].filter(Boolean);
  for (const raw of candidates) {
    try {
      const url = new URL(raw);
      const origin = url.origin.replace(/\/$/, '');
      if (authAllowedOrigins.has(origin)) return origin;
    } catch {
      /* ignore invalid origin/referer */
    }
  }
  return null;
}

function sanitizeAuthReturnTo(raw) {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const origin = url.origin.replace(/\/$/, '');
    if (!authAllowedOrigins.has(origin)) return null;
    // OAuth must land on the SPA (hash tokens), never an API route — otherwise google/start loops.
    if (url.pathname.startsWith('/api/')) return null;
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

app.get('/api/auth/google/start', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    if (!sb) {
      return res.status(503).type('text/plain').send('Supabase auth is not configured on the server.');
    }

    const returnTo =
      sanitizeAuthReturnTo(req.query.return_to) ||
      getFrontendOriginFromRequest(req) ||
      getDefaultFrontendOrigin();

    if (!sanitizeAuthReturnTo(req.query.return_to) && req.query.return_to) {
      console.warn(
        '[auth] return_to rejected:',
        String(req.query.return_to).slice(0, 120),
        'using',
        returnTo
      );
    }

    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: returnTo,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data?.url) {
      return res
        .status(500)
        .type('text/plain')
        .send(error?.message || 'Unable to start Google sign-in.');
    }

    res.redirect(302, data.url);
  } catch (err) {
    console.error('Google auth start error:', err);
    res.status(500).type('text/plain').send(err instanceof Error ? err.message : 'Auth start failed.');
  }
});

app.post('/api/auth/establish', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const sb = getSupabaseAdmin();
    if (!sb) {
      return res.status(503).json({ error: 'Supabase auth is not configured on the server.' });
    }

    const accessToken = req.body?.access_token != null ? String(req.body.access_token).trim() : '';
    const refreshToken = req.body?.refresh_token != null ? String(req.body.refresh_token).trim() : '';
    const expiresIn = req.body?.expires_in != null ? Number(req.body.expires_in) : 3600;

    if (!accessToken || !refreshToken) {
      return res.status(400).json({ error: 'Missing auth tokens.' });
    }

    const { data, error } = await sb.auth.getUser(accessToken);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid sign-in session.' });
    }

    if (!(await isAllowedAuthEmail(data.user.email))) {
      clearAuthCookies(res);
      return res.status(403).json({
        error: data.user.email
          ? `${data.user.email} is not allowed to sign in.`
          : 'This Google account is not allowed to sign in.',
      });
    }

    setAuthCookies(res, {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
    });

    res.json({
      authenticated: true,
      email: data.user.email ?? null,
      isAdmin: await isAuthAdminUser(data.user.email),
    });
  } catch (err) {
    console.error('Auth establish error:', err);
    res.status(500).json({ error: 'Unable to establish session.' });
  }
});

app.get('/api/auth/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const resolved = await resolveAuthUserFromRequest(req, res);
    if (resolved.kind === 'transient') {
      return res.status(503).json({
        authenticated: false,
        transient: true,
        error: 'Auth service temporarily unavailable. Retry shortly.',
      });
    }
    if (resolved.kind !== 'ok' || !resolved.user) {
      return res.status(401).json({ authenticated: false });
    }
    if (!(await isAllowedAuthEmail(resolved.user.email))) {
      clearAuthCookies(res);
      return res.status(403).json({ authenticated: false, error: 'Not allowed.' });
    }
    const { accessToken, refreshToken } = readAuthTokensFromCookies(req);
    if (accessToken && refreshToken) {
      setAuthCookies(res, { access_token: accessToken, refresh_token: refreshToken });
    }
    res.json({
      authenticated: true,
      email: resolved.user.email ?? null,
      isAdmin: await isAuthAdminUser(resolved.user.email),
    });
  } catch (err) {
    console.error('Auth session error:', err);
    res.status(500).json({ error: 'Unable to read session.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookies(res);
  res.json({ ok: true });
});

app.get('/api/auth/admin/status', async (req, res) => {
  try {
    const resolved = await resolveAuthUserFromRequest(req, res);
    if (resolved.kind === 'transient') {
      return res.status(503).json({
        authenticated: false,
        isAdmin: false,
        transient: true,
        error: 'Auth service temporarily unavailable. Retry shortly.',
      });
    }
    if (resolved.kind !== 'ok' || !resolved.user?.email) {
      return res.json({ isAdmin: false, authenticated: false });
    }
    if (!(await isAllowedAuthEmail(resolved.user.email))) {
      clearAuthCookies(res);
      return res.json({ isAdmin: false, authenticated: false });
    }
    res.json({
      authenticated: true,
      email: resolved.user.email,
      isAdmin: await isAuthAdminUser(resolved.user.email),
    });
  } catch (err) {
    console.error('Auth admin status error:', err);
    res.status(500).json({ error: 'Unable to read admin status.' });
  }
});

app.get('/api/auth/admin/allowed-emails', async (req, res) => {
  try {
    const admin = await requireAuthAdmin(req, res);
    if (!admin) return;

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    await ensureAuthAllowedEmailTable(pool);
    const result = await pool.query(
      `SELECT id, email, role, created_at, updated_at FROM auth_allowed_email ORDER BY LOWER(email) ASC`
    );
    res.json({
      rows: result.rows,
      envAdmins: getAuthAdminEmails(),
      envAllowed: getAllowedAuthEmailsFromEnv(),
    });
  } catch (err) {
    console.error('List allowed emails error:', err);
    res.status(500).json({ error: 'Failed to load allowed emails.' });
  }
});

app.post('/api/auth/admin/allowed-emails', async (req, res) => {
  try {
    const admin = await requireAuthAdmin(req, res);
    if (!admin) return;

    const email = normalizeAuthEmailInput(req.body?.email);
    if (!email) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const role = normalizeAuthRole(req.body?.role);

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    await ensureAuthAllowedEmailTable(pool);
    const result = await pool.query(
      `INSERT INTO auth_allowed_email (email, role, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (email) DO UPDATE
       SET role = EXCLUDED.role, updated_at = CURRENT_TIMESTAMP
       RETURNING id, email, role, created_at, updated_at`,
      [email, role]
    );

    res.status(201).json({ row: result.rows[0] });
  } catch (err) {
    console.error('Add allowed email error:', err);
    res.status(500).json({ error: 'Failed to add allowed email.' });
  }
});

app.delete('/api/auth/admin/allowed-emails/:id', async (req, res) => {
  try {
    const admin = await requireAuthAdmin(req, res);
    if (!admin) return;

    const id = Math.floor(Number(req.params.id));
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id.' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    await ensureAuthAllowedEmailTable(pool);
    const result = await pool.query(`DELETE FROM auth_allowed_email WHERE id = $1 RETURNING id`, [id]);
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Email not found.' });
    }

    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('Delete allowed email error:', err);
    res.status(500).json({ error: 'Failed to remove allowed email.' });
  }
});

app.patch('/api/auth/admin/allowed-emails/:id', async (req, res) => {
  try {
    const admin = await requireAuthAdmin(req, res);
    if (!admin) return;

    const id = Math.floor(Number(req.params.id));
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid id.' });
    }

    const role = normalizeAuthRole(req.body?.role);
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    await ensureAuthAllowedEmailTable(pool);
    const result = await pool.query(
      `UPDATE auth_allowed_email
       SET role = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, email, role, created_at, updated_at`,
      [id, role]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Email not found.' });
    }

    res.json({ row: result.rows[0] });
  } catch (err) {
    console.error('Update allowed email role error:', err);
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

// Require signed-in allowlisted user for all /api routes below (except PUBLIC_API_ROUTES).
app.use('/api', apiAuthMiddleware);

const brandTagImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only JPEG, PNG, WebP, or GIF images are allowed'));
  },
});

/**
 * URL for browser <img src> / links. Prefer signed URLs so private buckets work; fall back to public URL.
 * Returns null only if Supabase admin is not configured, path is empty, or both signed + public fail.
 */
async function resolveBrandTagImageUrl(storagePath) {
  const sb = getSupabaseAdmin();
  const path = storagePath != null ? String(storagePath).trim() : '';
  if (!sb || !path) return null;

  const bucket = sb.storage.from(BRAND_TAG_IMAGE_BUCKET);
  const { data: signed, error: signErr } = await bucket.createSignedUrl(path, 60 * 60 * 24 * 30); // 30 days
  if (!signErr && signed?.signedUrl) {
    return signed.signedUrl;
  }
  if (signErr) {
    console.warn('Brand tag createSignedUrl failed (falling back to public URL):', path, signErr.message);
  }
  const { data: pub } = bucket.getPublicUrl(path);
  return pub?.publicUrl ?? null;
}

// Load settings at startup
loadSettings();

/** Run before app.listen so OAuth callback never hits a DB before ebay_oauth_token exists. */
async function ensureDatabaseSchema() {
  const pool = getDatabasePool();
  if (!pool) {
    console.warn('No database pool; skipping schema init');
    return;
  }
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ebay_oauth_token (
        integration_key VARCHAR(64) PRIMARY KEY,
        user_name VARCHAR(255) NOT NULL,
        refresh_token TEXT NOT NULL,
        scope TEXT,
        ebay_user_id VARCHAR(128),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('Database schema ready: app_settings, ebay_oauth_token');
  } catch (error) {
    console.error('Could not initialize database tables:', error.message);
  }
}

app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date().toISOString() });
});

/**
 * Minimal DB round-trip to wake free-tier Supabase when idle (browser-safe, no secret).
 */
app.get('/api/db-ping', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'Database not configured' });
    }
    await pool.query('SELECT 1');
    res.json({ ok: true, t: new Date().toISOString() });
  } catch (error) {
    console.error('db-ping failed:', error);
    res.status(500).json({ ok: false, error: error?.message || 'ping failed' });
  }
});

/**
 * Authenticated keepalive for cron (Cloudflare Worker). Requires DB_KEEPALIVE_SECRET.
 */
app.get('/api/db-keepalive', async (req, res) => {
  if (!verifyDbKeepaliveSecret(req, res)) return;
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: 'Database not configured' });
    }
    await pool.query('SELECT 1');
    res.json({ ok: true, t: new Date().toISOString() });
  } catch (error) {
    console.error('db-keepalive failed:', error);
    res.status(500).json({ ok: false, error: error?.message || 'keepalive failed' });
  }
});

/** Redirect browser to eBay to sign in and grant sell.fulfillment (Authorization Code). */
app.get('/api/ebay/oauth/start', (req, res) => {
  try {
    const returnTo =
      req.query.return_to != null ? String(req.query.return_to) : '';
    const state = ebaySellerOAuth.createOAuthState({ returnTo });
    const url = ebaySellerOAuth.buildAuthorizeUrl(state);
    console.log(
      `[eBay OAuth] start return_to=${returnTo ? ebaySellerOAuth.sanitizeOAuthReturnTo(returnTo) || returnTo.slice(0, 80) : '(default)'}`
    );
    res.redirect(302, url);
  } catch (error) {
    console.error('eBay OAuth start error:', error);
    res.status(500).type('text/plain').send(error instanceof Error ? error.message : String(error));
  }
});

function getDefaultOAuthFrontendRedirects() {
  const frontendDevOrigin = (process.env.FRONTEND_DEV_ORIGIN || 'http://localhost:3000').replace(
    /\/$/,
    ''
  );
  return {
    success:
      process.env.EBAY_OAUTH_SUCCESS_REDIRECT_URL?.trim() ||
      `${frontendDevOrigin}/orders?tab=sales&ebay_oauth=success`,
    errorBase:
      process.env.EBAY_OAUTH_ERROR_REDIRECT_URL?.trim() ||
      `${frontendDevOrigin}/orders?tab=sales&ebay_oauth=error`
  };
}

function resolveOAuthFrontendRedirects(stateValue) {
  const stateData = ebaySellerOAuth.consumeOAuthState(stateValue);
  if (stateData?.returnTo) {
    const fromState = ebaySellerOAuth.buildOAuthReturnUrls(stateData.returnTo);
    if (fromState) return { redirects: fromState, stateData };
  }
  return { redirects: getDefaultOAuthFrontendRedirects(), stateData };
}

/**
 * eBay redirects here after consent. Exchanges `code` for refresh token and stores it in `ebay_oauth_token`.
 * RuName’s Auth Accepted URL must hit this route. OAuth requests use EBAY_OAUTH_RU_NAME (RuName string), not a raw URL.
 */
app.get('/api/ebay/oauth/callback', async (req, res) => {
  const code = req.query.code != null ? String(req.query.code) : '';
  const state = req.query.state != null ? String(req.query.state) : '';
  const oauthErr = req.query.error != null ? String(req.query.error) : '';
  const { redirects, stateData } = resolveOAuthFrontendRedirects(state);
  const frontendSuccess = redirects.success;
  const frontendErrorBase = redirects.errorBase;
  console.log(
    `[eBay OAuth] callback state_ok=${Boolean(stateData)} success_redirect=${frontendSuccess.slice(0, 120)}`
  );

  if (oauthErr) {
    const desc =
      req.query.error_description != null ? String(req.query.error_description) : oauthErr;
    return res.redirect(302, `${frontendErrorBase}&ebay_oauth_msg=${encodeURIComponent(desc)}`);
  }

  if (!code || !state || !stateData) {
    return res.redirect(
      302,
      `${frontendErrorBase}&ebay_oauth_msg=${encodeURIComponent('invalid_or_expired_state')}`
    );
  }

  try {
    const pool = getDatabasePool();
    if (!pool) {
      throw new Error('Database not configured');
    }

    const integrationKey = (
      process.env.EBAY_OAUTH_INTEGRATION_KEY || ebaySellerOAuth.DEFAULT_INTEGRATION_KEY
    ).trim();

    const tokens = await ebaySellerOAuth.exchangeAuthorizationCode(code);
    let refresh = tokens.refresh_token != null ? String(tokens.refresh_token).trim() : '';
    if (!refresh) {
      const existing = await pool.query(
        `SELECT refresh_token FROM ebay_oauth_token WHERE integration_key = $1`,
        [integrationKey]
      );
      refresh = existing.rows?.[0]?.refresh_token
        ? String(existing.rows[0].refresh_token).trim()
        : '';
    }
    if (!refresh) {
      throw new Error(
        'eBay did not return refresh_token. Try Connect eBay seller again, or clear the old link in eBay account settings and reconnect.'
      );
    }

    const scopeGranted =
      (tokens.scope && String(tokens.scope).trim()) || ebaySellerOAuth.getScopeString();

    let userName = 'seller';
    let ebayUserId = null;
    try {
      if (tokens.access_token) {
        const idUser = await ebaySellerOAuth.fetchEbayIdentityUser(tokens.access_token);
        if (idUser?.username) userName = String(idUser.username);
        if (idUser?.userId) ebayUserId = String(idUser.userId);
      }
    } catch (idErr) {
      console.warn('eBay Identity user fetch skipped:', idErr?.message || idErr);
    }

    await ebaySellerOAuth.upsertRefreshToken(pool, {
      userName,
      refreshToken: refresh,
      scope: scopeGranted,
      ebayUserId
    });

    const verify = await pool.query(
      `SELECT refresh_token FROM ebay_oauth_token WHERE integration_key = $1`,
      [integrationKey]
    );
    if (!verify.rows?.[0]?.refresh_token) {
      throw new Error('Token save verification failed — check database connection and try again.');
    }

    ebaySellerOAuth.invalidateAccessTokenCache();
    console.log(
      `[eBay OAuth] refresh token stored (integration_key=${integrationKey}, scope=${scopeGranted})`
    );
    res.redirect(302, frontendSuccess);
  } catch (err) {
    console.error('eBay OAuth callback error:', err);
    const msg = encodeURIComponent(err instanceof Error ? err.message : String(err));
    res.redirect(302, `${frontendErrorBase}&ebay_oauth_msg=${msg}`);
  }
});

app.get('/api/ebay/oauth/status', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.json({ connected: false, reason: 'no_database' });
    }
    const key = (process.env.EBAY_OAUTH_INTEGRATION_KEY || ebaySellerOAuth.DEFAULT_INTEGRATION_KEY).trim();
    const r = await pool.query(
      `SELECT user_name, ebay_user_id, updated_at, integration_key, scope FROM ebay_oauth_token WHERE integration_key = $1`,
      [key]
    );
    const row = r.rows?.[0];
    if (!row) {
      return res.json({ connected: false, reason: 'no_row', integration_key: key });
    }
    const scope = row.scope != null ? String(row.scope) : '';
    return res.json({
      connected: true,
      user_name: row.user_name,
      ebay_user_id: row.ebay_user_id,
      updated_at: row.updated_at,
      integration_key: key,
      scope,
      has_analytics_scope: ebaySellerOAuth.scopeIncludesAnalytics(scope)
    });
  } catch (e) {
    console.error('/api/ebay/oauth/status failed:', e);
    return res.status(500).json({
      connected: false,
      reason: 'query_error',
      error: e instanceof Error ? e.message : String(e)
    });
  }
});

function formatEbayAnalyticsDateYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Sell Analytics traffic_report — listing views for legacy item ids (batch ≤100 per call).
 */
async function fetchEbayListingViewsBatch(accessToken, legacyIds, startYmd, endYmd) {
  if (!Array.isArray(legacyIds) || legacyIds.length === 0) {
    return new Map();
  }
  const params = new URLSearchParams();
  params.set('dimension', 'LISTING');
  params.set('metric', 'LISTING_VIEWS_TOTAL');
  params.append('filter', 'marketplace_ids:{EBAY_GB}');
  params.append('filter', `date_range:[${startYmd}..${endYmd}]`);
  params.append('filter', `listing_ids:{${legacyIds.join('|')}}`);

  const url = `https://api.ebay.com/sell/analytics/v1/traffic_report?${params.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
  });

  const text = await response.text();
  if (!response.ok) {
    const err = new Error(`eBay Analytics ${response.status}: ${text.slice(0, 600)}`);
    err.httpStatus = response.status;
    throw err;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('eBay Analytics returned invalid JSON');
  }

  const viewsByListingId = new Map();
  const records = Array.isArray(data.records) ? data.records : [];
  for (const record of records) {
    const listingId = record?.dimensionValues?.[0]?.value;
    const rawViews = record?.metricValues?.[0]?.value;
    if (listingId == null || listingId === '') continue;
    const views = typeof rawViews === 'number' ? rawViews : Number(rawViews);
    viewsByListingId.set(String(listingId), Number.isFinite(views) ? views : 0);
  }
  return viewsByListingId;
}

async function fetchEbayListingViewsForLegacyIds(accessToken, legacyIds, startYmd, endYmd) {
  const merged = new Map();
  const batchSize = 100;
  for (let i = 0; i < legacyIds.length; i += batchSize) {
    const batch = legacyIds.slice(i, i + batchSize);
    const batchMap = await fetchEbayListingViewsBatch(accessToken, batch, startYmd, endYmd);
    for (const [id, views] of batchMap.entries()) {
      merged.set(id, views);
    }
    if (i + batchSize < legacyIds.length) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  return merged;
}

function extractBrowseItemImageUrl(item) {
  if (!item || typeof item !== 'object') return null;
  if (item.image && typeof item.image.imageUrl === 'string' && item.image.imageUrl.trim()) {
    return item.image.imageUrl.trim().replace(/^http:\/\//i, 'https://');
  }
  if (Array.isArray(item.additionalImages)) {
    for (const img of item.additionalImages) {
      if (img && typeof img.imageUrl === 'string' && img.imageUrl.trim()) {
        return img.imageUrl.trim().replace(/^http:\/\//i, 'https://');
      }
    }
  }
  if (Array.isArray(item.thumbnailImages)) {
    for (const img of item.thumbnailImages) {
      if (img && typeof img.imageUrl === 'string' && img.imageUrl.trim()) {
        return img.imageUrl.trim().replace(/^http:\/\//i, 'https://');
      }
    }
  }
  return null;
}

function browseApiRequestHeaders(browseToken) {
  return {
    Authorization: `Bearer ${browseToken}`,
    Accept: 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'
  };
}

/** Primary listing details from Buy Browse — COMPACT omits images; use legacy id lookup or full item. */
async function fetchBrowseListingItem(browseToken, ebayIdRaw) {
  const legacy = extractEbayLegacyItemId(ebayIdRaw);
  if (!legacy) return null;

  const legacyUrl = `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?${new URLSearchParams({
    legacy_item_id: legacy
  }).toString()}`;
  let response = await fetch(legacyUrl, {
    method: 'GET',
    headers: browseApiRequestHeaders(browseToken)
  });
  if (response.ok) {
    return response.json();
  }

  const restId = `v1|${legacy}|0`;
  const itemUrl = `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(restId)}`;
  response = await fetch(itemUrl, {
    method: 'GET',
    headers: browseApiRequestHeaders(browseToken)
  });
  if (!response.ok) return null;
  return response.json();
}

function formatBrowseListingPrice(item, projectedSalePrice) {
  if (item?.price && item.price.value != null && String(item.price.value).trim()) {
    const cur = (item.price.currency && String(item.price.currency)) || 'GBP';
    const value = Number(item.price.value);
    if (cur === 'GBP' && Number.isFinite(value)) {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
    }
    return `${item.price.value} ${cur}`;
  }
  if (projectedSalePrice != null && String(projectedSalePrice).trim() !== '') {
    const value = Number(projectedSalePrice);
    if (Number.isFinite(value)) {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
    }
  }
  return null;
}

function formatBrowseListingDate(item) {
  const raw = item?.itemCreationDate;
  if (raw == null || String(raw).trim() === '') return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function mapBrowseListingDetails(item, stockRow) {
  const listingTitle =
    (item && typeof item.title === 'string' && item.title.trim()) ||
    stockRow.itemName?.trim() ||
    null;
  return {
    imageUrl: item ? extractBrowseItemImageUrl(item) : null,
    listingTitle,
    priceLabel: formatBrowseListingPrice(item, stockRow.projectedSalePrice),
    listingDate: item ? formatBrowseListingDate(item) : null,
    categoryName: stockRow.categoryName?.trim() || 'Uncategorized'
  };
}

async function enrichListingRowsWithBrowseDetails(_pool, rows) {
  if (!rows.length) return rows;

  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!appId || !certId) {
    return rows.map((r) => ({
      ...r,
      imageUrl: null,
      listingTitle: r.itemName?.trim() || null,
      priceLabel: formatBrowseListingPrice(null, r.projectedSalePrice),
      listingDate: null
    }));
  }

  let browseToken;
  try {
    browseToken = await getAccessToken(appId, certId);
  } catch (e) {
    console.warn('listing-views eBay browse token failed:', e?.message || e);
    return rows.map((r) => ({
      ...r,
      imageUrl: null,
      listingTitle: r.itemName?.trim() || null,
      priceLabel: formatBrowseListingPrice(null, r.projectedSalePrice),
      listingDate: null
    }));
  }

  const enriched = await Promise.all(
    rows.map(async (row) => {
      try {
        const item = await fetchBrowseListingItem(browseToken, row.ebayId);
        return { ...row, ...mapBrowseListingDetails(item, row) };
      } catch (e) {
        console.warn(`listing-views browse details failed stockId=${row.stockId}:`, e?.message || e);
        return { ...row, ...mapBrowseListingDetails(null, row) };
      }
    })
  );

  return enriched;
}

/**
 * Active eBay listings in stock → best / worst views in the last N days (Sell Analytics API).
 * GET /api/ebay/listing-views?days=30&limit=20
 */
app.get('/api/ebay/listing-views', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const rawDays = req.query.days != null ? Number(req.query.days) : 30;
    const periodDays = Number.isFinite(rawDays) && rawDays >= 1 && rawDays <= 90 ? Math.floor(rawDays) : 30;
    const rawLimit = req.query.limit != null ? Number(req.query.limit) : 20;
    const rowLimit = Number.isFinite(rawLimit) && rawLimit >= 1 && rawLimit <= 100 ? Math.floor(rawLimit) : 20;

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - periodDays);
    const startYmd = formatEbayAnalyticsDateYmd(startDate);
    const endYmd = formatEbayAnalyticsDateYmd(endDate);

    let accessToken;
    try {
      accessToken = await ebaySellerOAuth.getFulfillmentUserAccessToken(pool);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = e && typeof e === 'object' && 'code' in e ? e.code : null;
      return res.status(503).json({
        error: 'eBay seller not connected',
        details: msg,
        code,
        reconnectUrl: '/orders?tab=sales'
      });
    }

    const oauthKey = (
      process.env.EBAY_OAUTH_INTEGRATION_KEY || ebaySellerOAuth.DEFAULT_INTEGRATION_KEY
    ).trim();
    const scopeRow = await pool.query(
      `SELECT scope FROM ebay_oauth_token WHERE integration_key = $1`,
      [oauthKey]
    );
    const storedScope = scopeRow.rows?.[0]?.scope != null ? String(scopeRow.rows[0].scope) : '';
    if (!ebaySellerOAuth.scopeIncludesAnalytics(storedScope)) {
      return res.status(403).json({
        error: 'eBay token missing Analytics access',
        details:
          'Set EBAY_OAUTH_INCLUDE_ANALYTICS=1 on the API server, enable Sell Analytics in the eBay Developer Portal, restart the API, then reconnect eBay seller.',
        reconnectUrl: '/orders?tab=sales'
      });
    }

    const rawCategoryLimit = req.query.categoryLimit != null ? Number(req.query.categoryLimit) : 8;
    const categorySliceLimit =
      Number.isFinite(rawCategoryLimit) && rawCategoryLimit >= 3 && rawCategoryLimit <= 16
        ? Math.floor(rawCategoryLimit)
        : 8;

    const stockResult = await pool.query(
      `
        SELECT
          s.id,
          s.item_name,
          s.ebay_id,
          s.projected_sale_price,
          b.brand_name,
          COALESCE(cat.category_name, 'Uncategorized') AS category_name
        FROM stock s
        LEFT JOIN brand b ON b.id = s.brand_id
        LEFT JOIN category cat ON cat.id = s.category_id
        WHERE s.sale_date IS NULL
          AND s.ebay_id IS NOT NULL
          AND TRIM(COALESCE(s.ebay_id::text, '')) <> ''
          AND COALESCE(s.is_ebay_draft, false) = false
          AND COALESCE(s.is_inventory_write_off, false) = false
        ORDER BY s.id ASC
      `
    );

    const stockRows = [];
    const legacyIds = [];
    const seenLegacy = new Set();
    for (const row of stockResult.rows || []) {
      const legacy = extractEbayLegacyItemId(row.ebay_id);
      if (!legacy || seenLegacy.has(legacy)) continue;
      seenLegacy.add(legacy);
      legacyIds.push(legacy);
      stockRows.push({
        stockId: row.id,
        itemName: row.item_name != null ? String(row.item_name) : '',
        ebayId: legacy,
        ebayUrl: `https://www.ebay.co.uk/itm/${legacy}`,
        brandName: row.brand_name != null ? String(row.brand_name) : null,
        categoryName: row.category_name != null ? String(row.category_name) : 'Uncategorized',
        projectedSalePrice: row.projected_sale_price
      });
    }

    const buildCategoryViewSlices = (rows, sliceLimit) => {
      const byCategory = new Map();
      for (const row of rows) {
        const name = row.categoryName?.trim() || 'Uncategorized';
        const prev = byCategory.get(name) || { categoryName: name, views: 0, listingCount: 0 };
        prev.views += row.views;
        prev.listingCount += 1;
        byCategory.set(name, prev);
      }
      const all = [...byCategory.values()];
      const sortedDesc = [...all].sort(
        (a, b) => b.views - a.views || b.listingCount - a.listingCount || a.categoryName.localeCompare(b.categoryName)
      );
      const sortedAsc = [...all].sort(
        (a, b) => a.views - b.views || a.listingCount - b.listingCount || a.categoryName.localeCompare(b.categoryName)
      );
      return {
        bestCategories: sortedDesc.slice(0, sliceLimit),
        worstCategories: sortedAsc.slice(0, sliceLimit)
      };
    };

    if (legacyIds.length === 0) {
      return res.json({
        periodDays,
        periodStart: startDate.toISOString().slice(0, 10),
        periodEnd: endDate.toISOString().slice(0, 10),
        totalListings: 0,
        listingsWithViewData: 0,
        best: [],
        worst: [],
        bestCategories: [],
        worstCategories: [],
        emptyMessage: 'No active eBay listings in stock (need a published eBay ID, not a draft).'
      });
    }

    let viewsByListingId;
    try {
      viewsByListingId = await fetchEbayListingViewsForLegacyIds(
        accessToken,
        legacyIds,
        startYmd,
        endYmd
      );
    } catch (e) {
      const httpStatus = e && typeof e === 'object' && 'httpStatus' in e ? e.httpStatus : null;
      const details = e instanceof Error ? e.message : String(e);
      const needsAnalyticsScope =
        httpStatus === 403 &&
        /scope|access|analytics|permission/i.test(details);
      return res.status(httpStatus === 403 ? 403 : 502).json({
        error: needsAnalyticsScope
          ? 'eBay token missing Analytics access — reconnect seller on Orders'
          : 'Failed to load listing views from eBay',
        details,
        reconnectUrl: '/orders?tab=ebay'
      });
    }

    const withViews = stockRows.map((row) => ({
      ...row,
      views: viewsByListingId.get(row.ebayId) ?? 0
    }));

    const sortedDesc = [...withViews].sort((a, b) => b.views - a.views || a.stockId - b.stockId);
    const sortedAsc = [...withViews].sort((a, b) => a.views - b.views || a.stockId - b.stockId);

    const listingsWithViewData = withViews.filter((r) => r.views > 0).length;
    const { bestCategories, worstCategories } = buildCategoryViewSlices(withViews, categorySliceLimit);
    const bestSlice = sortedDesc.slice(0, rowLimit);
    const worstSlice = sortedAsc.slice(0, rowLimit);
    const [best, worst] = await Promise.all([
      enrichListingRowsWithBrowseDetails(pool, bestSlice),
      enrichListingRowsWithBrowseDetails(pool, worstSlice)
    ]);

    res.json({
      periodDays,
      periodStart: startDate.toISOString().slice(0, 10),
      periodEnd: endDate.toISOString().slice(0, 10),
      totalListings: withViews.length,
      listingsWithViewData,
      best,
      worst,
      bestCategories,
      worstCategories
    });
  } catch (error) {
    console.error('listing-views failed:', error);
    res.status(500).json({
      error: 'Failed to load listing views',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

const runBrandTagPostMulter = (req, res, next) => {
  brandTagImageUpload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
};

/** Safe filename segment from brand_name for Storage paths: `{brandId}/{slug}-{rowId}.ext`. */
function slugForBrandTagStorage(brandName) {
  let s = String(brandName ?? '').trim();
  if (!s) return 'brand';
  s = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 72);
  return s || 'brand';
}

const handleBrandTagImagesGet = async (req, res) => {
  try {
    const brandId = parseInt(String(req.query.brandId ?? ''), 10);
    if (Number.isNaN(brandId)) {
      return res.status(400).json({ error: 'Query parameter brandId is required (number)' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const result = await pool.query(
      `SELECT id, brand_id, storage_path, caption, sort_order, content_type, image_kind, quality_tier, created_at, updated_at
       FROM brand_tag_image
       WHERE brand_id = $1
       ORDER BY
         CASE image_kind
           WHEN 'tag' THEN 0
           WHEN 'fake_check' THEN 1
           WHEN 'logo' THEN 2
           ELSE 3
         END,
         CASE quality_tier
           WHEN 'good' THEN 0
           WHEN 'average' THEN 1
           ELSE 2
         END,
         sort_order ASC,
         id ASC`,
      [brandId]
    );

    const rows = await Promise.all(
      (result.rows ?? []).map(async (row) => ({
        ...row,
        public_url: await resolveBrandTagImageUrl(row.storage_path),
      }))
    );

    res.json({
      rows,
      storageConfigured: !!getSupabaseAdmin(),
      bucket: BRAND_TAG_IMAGE_BUCKET,
    });
  } catch (error) {
    console.error('Brand tag images list failed:', error);
    res.status(500).json({ error: 'Failed to load brand tag images', details: error.message });
  }
};

const handleBrandTagImagesPost = async (req, res) => {
  try {
    const brandId = parseInt(String(req.body.brandId ?? ''), 10);
    if (Number.isNaN(brandId)) {
      return res.status(400).json({
        error: 'Form field brandId is required',
        hint: 'Send multipart field brandId (number) with file field image',
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Missing image file (form field name: image)' });
    }

    const sb = getSupabaseAdmin();
    if (!sb) {
      return res.status(503).json({
        error: 'Supabase Storage not configured',
        hint: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server',
      });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const brandCheck = await pool.query('SELECT id, brand_name FROM brand WHERE id = $1', [brandId]);
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const brandNameForFile = brandCheck.rows[0].brand_name;

    const seqResult = await pool.query(
      "SELECT nextval(pg_get_serial_sequence('public.brand_tag_image', 'id'))::int AS id"
    );
    const imageRowId = seqResult.rows[0]?.id;
    if (imageRowId == null || Number.isNaN(imageRowId)) {
      return res.status(500).json({
        error: 'Could not reserve brand_tag_image id',
        hint: 'Ensure table public.brand_tag_image exists (run database/brand_tag_image.sql)',
      });
    }

    const caption =
      typeof req.body.caption === 'string' ? req.body.caption.trim().slice(0, 500) : null;

    const kindRaw = req.body?.imageKind ?? req.body?.image_kind;
    let imageKind = 'tag';
    if (typeof kindRaw === 'string') {
      const k = kindRaw.trim();
      if (k === 'fake_check' || k === 'fake') imageKind = 'fake_check';
      else if (k === 'logo') imageKind = 'logo';
    }

    const qualityTierRaw = req.body?.qualityTier ?? req.body?.quality_tier;
    let qualityTier = 'average';
    if (typeof qualityTierRaw === 'string') {
      const q = qualityTierRaw.trim().toLowerCase();
      if (q === 'good' || q === 'average' || q === 'poor') {
        qualityTier = q;
      }
    }

    const ext =
      req.file.mimetype === 'image/png'
        ? 'png'
        : req.file.mimetype === 'image/webp'
          ? 'webp'
          : req.file.mimetype === 'image/gif'
            ? 'gif'
            : 'jpg';
    const slug = slugForBrandTagStorage(brandNameForFile);
    const storagePath = `${brandId}/${slug}-${imageRowId}.${ext}`;

    if (imageKind === 'logo') {
      const existingLogo = await pool.query(
        `SELECT id, storage_path FROM brand_tag_image WHERE brand_id = $1 AND image_kind = 'logo'`,
        [brandId]
      );
      for (const oldRow of existingLogo.rows ?? []) {
        const sp = oldRow.storage_path;
        if (sp) {
          try {
            await sb.storage.from(BRAND_TAG_IMAGE_BUCKET).remove([String(sp)]);
          } catch (e) {
            console.warn('Brand logo storage remove failed (continuing):', e?.message || e);
          }
        }
        await pool.query('DELETE FROM brand_tag_image WHERE id = $1', [oldRow.id]);
      }
    }

    const { error: uploadError } = await sb.storage
      .from(BRAND_TAG_IMAGE_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      console.error('Brand tag storage upload failed:', uploadError);
      return res.status(500).json({
        error: 'Storage upload failed',
        details: uploadError.message,
      });
    }

    try {
      const insertResult = await pool.query(
        `INSERT INTO brand_tag_image (id, brand_id, storage_path, caption, content_type, image_kind, quality_tier)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, brand_id, storage_path, caption, sort_order, content_type, image_kind, quality_tier, created_at, updated_at`,
        [imageRowId, brandId, storagePath, caption, req.file.mimetype, imageKind, qualityTier]
      );

      const row = insertResult.rows[0];
      res.status(201).json({
        ...row,
        public_url: await resolveBrandTagImageUrl(row.storage_path),
      });
    } catch (dbError) {
      await sb.storage.from(BRAND_TAG_IMAGE_BUCKET).remove([storagePath]);
      console.error('Brand tag DB insert failed:', dbError);
      if (dbError.code === '42P01') {
        return res.status(503).json({
          error: 'Table brand_tag_image missing',
          hint: 'Run database/brand_tag_image.sql in Supabase',
        });
      }
      throw dbError;
    }
  } catch (error) {
    console.error('Brand tag image upload failed:', error);
    res.status(500).json({ error: 'Failed to save brand tag image', details: error.message });
  }
};

const handleBrandTagImagesPatch = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const hasCaptionKey = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'caption');
    const captionRaw = req.body?.caption;
    let caption = null;
    let captionProvided = false;
    if (hasCaptionKey) {
      captionProvided = true;
      if (captionRaw === null || captionRaw === undefined) {
        caption = null;
      } else if (typeof captionRaw === 'string') {
        const t = captionRaw.trim();
        caption = t ? t.slice(0, 500) : null;
      } else {
        return res.status(400).json({ error: 'caption must be a string or null' });
      }
    }

    const hasKindKey =
      Object.prototype.hasOwnProperty.call(req.body ?? {}, 'imageKind') ||
      Object.prototype.hasOwnProperty.call(req.body ?? {}, 'image_kind');
    const kindRaw = req.body?.imageKind ?? req.body?.image_kind;
    let imageKind = null;
    if (hasKindKey) {
      if (kindRaw === null || kindRaw === undefined) {
        return res.status(400).json({ error: 'imageKind cannot be null' });
      }
      const k = String(kindRaw).trim();
      if (k !== 'tag' && k !== 'fake_check' && k !== 'logo') {
        return res.status(400).json({ error: 'imageKind must be "tag", "fake_check", or "logo"' });
      }
      imageKind = k;
    }

    const sets = [];
    const params = [];
    let n = 1;
    if (captionProvided) {
      sets.push(`caption = $${n++}`);
      params.push(caption);
    }
    if (imageKind !== null) {
      sets.push(`image_kind = $${n++}`);
      params.push(imageKind);
    }

    const qualityBody = req.body && typeof req.body === 'object' ? req.body : {};
    const hasQualityKey =
      Object.prototype.hasOwnProperty.call(qualityBody, 'qualityTier') ||
      Object.prototype.hasOwnProperty.call(qualityBody, 'quality_tier');
    const qualityRaw = qualityBody.qualityTier ?? qualityBody.quality_tier;
    let qualityTier = null;
    if (hasQualityKey) {
      if (qualityRaw === null || qualityRaw === undefined) {
        return res.status(400).json({ error: 'qualityTier cannot be null' });
      }
      const q = String(qualityRaw).trim().toLowerCase();
      if (q !== 'good' && q !== 'average' && q !== 'poor') {
        return res.status(400).json({ error: 'qualityTier must be "good", "average", or "poor"' });
      }
      qualityTier = q;
    } else if (qualityRaw !== undefined && qualityRaw !== null) {
      // Defensive: body may expose tier without own-property (unusual proxies); still persist.
      const q = String(qualityRaw).trim().toLowerCase();
      if (q === 'good' || q === 'average' || q === 'poor') {
        qualityTier = q;
      }
    }

    if (!captionProvided && imageKind === null && qualityTier === null) {
      return res.status(400).json({ error: 'Provide caption, imageKind, and/or qualityTier' });
    }

    if (imageKind === 'logo') {
      const sb = getSupabaseAdmin();
      const cur = await pool.query('SELECT brand_id FROM brand_tag_image WHERE id = $1', [id]);
      if (!cur.rowCount) {
        return res.status(404).json({ error: 'Not found' });
      }
      const brandIdForRow = cur.rows[0].brand_id;
      const others = await pool.query(
        `SELECT id, storage_path FROM brand_tag_image WHERE brand_id = $1 AND image_kind = 'logo' AND id <> $2`,
        [brandIdForRow, id]
      );
      for (const oldRow of others.rows ?? []) {
        if (sb && oldRow.storage_path) {
          try {
            await sb.storage.from(BRAND_TAG_IMAGE_BUCKET).remove([String(oldRow.storage_path)]);
          } catch (e) {
            console.warn('Brand logo patch: storage remove failed:', e?.message || e);
          }
        }
        await pool.query('DELETE FROM brand_tag_image WHERE id = $1', [oldRow.id]);
      }
    }

    if (qualityTier !== null) {
      sets.push(`quality_tier = $${n++}`);
      params.push(qualityTier);
    }
    sets.push('updated_at = NOW()');
    params.push(id);

    const result = await pool.query(
      `UPDATE brand_tag_image
       SET ${sets.join(', ')}
       WHERE id = $${n}
       RETURNING id, brand_id, storage_path, caption, sort_order, content_type, image_kind, quality_tier, created_at, updated_at`,
      params
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Not found' });
    }

    const row = result.rows[0];
    res.json({
      ...row,
      public_url: await resolveBrandTagImageUrl(row.storage_path),
    });
  } catch (error) {
    console.error('Brand tag image patch failed:', error);
    if (error && error.code === '42703') {
      return res.status(503).json({
        error: 'Database column missing (quality_tier)',
        details: error.message,
        hint: 'Run database/brand_tag_image_add_quality_tier.sql on this database, then retry.',
      });
    }
    res.status(500).json({ error: 'Failed to update brand tag image', details: error.message });
  }
};

const handleBrandTagImagesDelete = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const found = await pool.query(
      'SELECT id, storage_path FROM brand_tag_image WHERE id = $1',
      [id]
    );
    if (!found.rowCount) {
      return res.status(404).json({ error: 'Not found' });
    }

    const storagePath = found.rows[0].storage_path;
    const sb = getSupabaseAdmin();
    if (sb) {
      const { error: removeError } = await sb.storage.from(BRAND_TAG_IMAGE_BUCKET).remove([storagePath]);
      if (removeError) {
        console.warn('Storage remove warning:', removeError.message);
      }
    }

    await pool.query('DELETE FROM brand_tag_image WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Brand tag image delete failed:', error);
    res.status(500).json({ error: 'Failed to delete brand tag image', details: error.message });
  }
};

['/api/brand-tag-images', '/api/brandTagImages'].forEach((tagPath) => {
  app.get(tagPath, handleBrandTagImagesGet);
  app.post(tagPath, runBrandTagPostMulter, handleBrandTagImagesPost);
});
app.patch('/api/brand-tag-images/:id', handleBrandTagImagesPatch);
app.patch('/api/brandTagImages/:id', handleBrandTagImagesPatch);
app.delete('/api/brand-tag-images/:id', handleBrandTagImagesDelete);
app.delete('/api/brandTagImages/:id', handleBrandTagImagesDelete);
console.log(
  '[api] Brand tag routes registered: GET|POST /api/brand-tag-images and /api/brandTagImages; PATCH|DELETE …/:id'
);

app.get('/api/settings', async (req, res) => {
  try {
    const pool = getDatabasePool();
    const currentSettings = loadSettings(); // Load file-based settings as fallback
    
    if (pool) {
      // Try to get categories from database
      try {
        const result = await pool.query(
          `SELECT value FROM app_settings WHERE key = 'stockCategories'`
        );
        
        if (result.rows.length > 0) {
          currentSettings.stockCategories = JSON.parse(result.rows[0].value);
        } else {
          // Initialize with empty array if not in DB (will be populated when user adds categories)
          currentSettings.stockCategories = [];
        }
      } catch (dbError) {
        console.warn('Database settings table may not exist, using file-based settings:', dbError.message);
        // Fall back to file-based if table doesn't exist
      }
    }
    
    console.log('Sending settings payload:', currentSettings);
    res.json(currentSettings);
  } catch (error) {
    console.error('Error loading settings:', error);
    const fallbackSettings = loadSettings();
    res.json(fallbackSettings);
  }
});

const VALID_COLOR_SCHEMES = new Set(['neon', 'vinted', 'minimal']);
const SITE_SETTINGS_KEY = 'siteSettings';

async function loadSiteSettingsFromDb(pool) {
  const fallback = { colorScheme: 'neon' };
  if (!pool) return fallback;
  try {
    const result = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [SITE_SETTINGS_KEY]);
    if (!result.rows.length) return fallback;
    const parsed = JSON.parse(result.rows[0].value);
    if (parsed && VALID_COLOR_SCHEMES.has(parsed.colorScheme)) {
      return { colorScheme: parsed.colorScheme };
    }
  } catch (err) {
    console.warn('loadSiteSettingsFromDb failed:', err?.message || err);
  }
  return fallback;
}

app.get('/api/settings/site', async (req, res) => {
  try {
    const pool = getDatabasePool();
    const settings = await loadSiteSettingsFromDb(pool);
    res.json(settings);
  } catch (error) {
    console.error('Error loading site settings:', error);
    res.json({ colorScheme: 'neon' });
  }
});

app.put('/api/settings/site', async (req, res) => {
  try {
    const { colorScheme } = req.body ?? {};
    if (!VALID_COLOR_SCHEMES.has(colorScheme)) {
      return res.status(400).json({
        error: 'Invalid colorScheme',
        hint: 'Use neon, vinted, or minimal',
      });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    await pool.query(
      `CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    const payload = JSON.stringify({ colorScheme });
    await pool.query(
      `INSERT INTO app_settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key)
       DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [SITE_SETTINGS_KEY, payload]
    );

    res.json({ colorScheme });
  } catch (error) {
    console.error('Error saving site settings:', error);
    res.status(500).json({ error: 'Failed to save site settings', details: error.message });
  }
});

app.put('/api/settings/categories', async (req, res) => {
  try {
    const { categories } = req.body;
    
    if (!Array.isArray(categories)) {
      return res.status(400).json({ error: 'Categories must be an array' });
    }

    const pool = getDatabasePool();
    
    if (pool) {
      // Save to database (primary storage)
      try {
        await pool.query(
          `CREATE TABLE IF NOT EXISTS app_settings (
            key VARCHAR(255) PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )`
        );
        
        await pool.query(
          `INSERT INTO app_settings (key, value) 
           VALUES ('stockCategories', $1) 
           ON CONFLICT (key) 
           DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
          [JSON.stringify(categories)]
        );
        
        console.log('Categories saved to database');
      } catch (dbError) {
        console.error('Database error saving categories:', dbError);
        // Fall through to file-based save
      }
    }

    // Also save to file as backup (works in dev, may not work in production)
    try {
      let existingSettings = {};
      if (fs.existsSync(settingsPath)) {
        const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
        existingSettings = JSON.parse(settingsContent);
      }
      existingSettings.stockCategories = categories;
      fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2), 'utf-8');
      loadSettings();
    } catch (fileError) {
      console.warn('Could not save to file (may be read-only in production):', fileError.message);
      // This is OK - database is primary storage
    }
    
    res.json({ success: true, categories });
  } catch (error) {
    console.error('Error updating categories:', error);
    res.status(500).json({ error: 'Failed to update categories' });
  }
});

app.get('/api/mens-resale-reference', (req, res) => {
  try {
    res.json(mensResaleReference);
  } catch (error) {
    console.error('Error serving mensResaleReference:', error);
    res.status(500).json({ error: 'Failed to load mens resale reference' });
  }
});

const getAccessToken = async (appId, certId) => {
  const oauthUrl = 'https://api.ebay.com/identity/v1/oauth2/token';
  const clientCredentials = Buffer.from(`${appId}:${certId}`).toString('base64');

  const oauthResponse = await fetch(oauthUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${clientCredentials}`
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
  });

  if (!oauthResponse.ok) {
    const oauthError = await oauthResponse.text();
    console.error('OAuth Error:', oauthResponse.status, oauthError);
    throw new Error(`OAuth error: ${oauthResponse.status}`);
  }

  const oauthData = await oauthResponse.json();
  return oauthData.access_token;
};

/**
 * @param {object} [opts]
 * @param {boolean} [opts.phraseWrap] — wrap full query in quotes (brand research / sold comps only).
 * @param {boolean} [opts.appendMens] — append `mens` when not already present (default true).
 */
function augmentEbaySearchQuery(raw, opts = {}) {
  const phraseWrap = opts.phraseWrap === true;
  const appendMens = opts.appendMens !== false;

  let q = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
  if (!q) return q;
  if (q.length >= 2 && q.startsWith('"') && q.endsWith('"')) {
    q = q.slice(1, -1).trim();
  }
  q = q.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return '';
  if (appendMens && !/\bmen'?s\b|\bmens\b/i.test(q)) {
    q = `${q} mens`;
  }
  if (phraseWrap) {
    return `"${q}"`;
  }
  return q;
}

function parseEbayQueryBool(val, defaultValue) {
  if (val === undefined || val === null || val === '') return defaultValue;
  const s = String(val).toLowerCase();
  if (s === '0' || s === 'false' || s === 'no') return false;
  if (s === '1' || s === 'true' || s === 'yes') return true;
  return defaultValue;
}

/** eBay UK Men's Clothing — same as ebay.co.uk/sch/260012. Override with EBAY_BROWSE_CATEGORY_IDS (single id). */
const EBAY_GB_MENS_CLOTHING_CATEGORY_ID = (process.env.EBAY_BROWSE_CATEGORY_IDS || '260012').trim();
/** Seller inspiration feed — discover categories once (all sellers), then fetch per category (all sellers). */
const RESEARCH_SELLER_PAGE_SIZE = 24;
/** Standard eBay fetch window: all solds per seller in the last 2 weeks (no fixed item cap). */
const RESEARCH_SELLER_FETCH_SOLD_DAYS = 14;
/** Safety ceiling only — normal stop is when Browse returns no more pages in the window. */
const RESEARCH_SELLER_ABSOLUTE_MAX_PER_SELLER = 10000;
const RESEARCH_SELLER_BROWSE_PAGE_SIZE = 50;
/** @deprecated Display no longer capped — kept for legacy round-robin merge during transition */
const RESEARCH_SELLER_FETCH_LIMIT = 200;
const SELLER_SOLD_FEED_CACHE_MS = 26 * 60 * 60 * 1000;
const SELLER_SOLD_FEED_CACHE_HOURS = 26;
/** Sold-day windows refreshed by the daily Cloudflare cron (min £25). Primary: 14 days. */
const RESEARCH_SELLER_CRON_SOLD_DAYS = [14, 7, 30];
const RESEARCH_SELLER_CRON_MIN_PRICE_GBP = 25;
const RESEARCH_SELLER_PROBE_LIMIT = 2;
const RESEARCH_SELLER_PER_CATEGORY_FETCH_LIMIT = 50;
const RESEARCH_SELLER_DISCOVERY_CONCURRENCY = 2;
const RESEARCH_SELLER_BROWSE_DELAY_MS = 200;
const RESEARCH_SELLER_MIN_PER_SELLER = 25;
/** Bump when feed logic changes so existing 12h rows are refetched from eBay. */
const RESEARCH_SELLER_CACHE_GENERATION = 13;
/** Category sold scan: Browse soldDate works without sellers filter; cap pages per category. */
const RESEARCH_SELLER_SOLD_SCAN_MAX_PAGES_PER_CATEGORY = 30;
const RESEARCH_SELLER_SOLD_EMPTY_PAGE_STREAK = 8;

function normalizeResearchSellerListingMode(raw) {
  const v = String(raw ?? 'listings').trim().toLowerCase();
  return v === 'solds' ? 'solds' : 'listings';
}

function isMissingResearchSellerListingModeColumn(err) {
  const msg = err?.message != null ? String(err.message) : String(err);
  return /listing_mode/i.test(msg) && /column|does not exist/i.test(msg);
}

function browseListingAvailabilityBuyable(item) {
  if (!item || typeof item !== 'object') return false;
  const now = new Date();
  if (item.itemEndDate) {
    const end = new Date(item.itemEndDate);
    if (!Number.isNaN(end.getTime()) && end <= now) return false;
  }
  const avs = item.estimatedAvailabilities;
  if (Array.isArray(avs) && avs.length > 0) {
    return avs.some(
      (a) =>
        a.estimatedAvailabilityStatus === 'IN_STOCK' ||
        a.estimatedAvailabilityStatus === 'LIMITED_STOCK'
    );
  }
  if (item.itemEndDate) {
    const end = new Date(item.itemEndDate);
    if (!Number.isNaN(end.getTime()) && end > now) return true;
  }
  const opts = item.buyingOptions;
  if (Array.isArray(opts) && opts.length > 0) return true;
  return false;
}

function isBrowseSummaryStillBuyable(summary) {
  return browseListingAvailabilityBuyable(summary);
}

function browseSummaryHasFutureEndDate(summary) {
  const end = summary?.itemEndDate;
  if (end == null || String(end).trim() === '') return false;
  const t = Date.parse(String(end));
  return Number.isFinite(t) && t > Date.now();
}

function browseSummaryHasPastEndDate(summary) {
  const end = summary?.itemEndDate;
  if (end == null || String(end).trim() === '') return false;
  const t = Date.parse(String(end));
  return Number.isFinite(t) && t <= Date.now();
}

function researchSellerSummaryMatchesListingMode(summary, listingMode) {
  const mode = normalizeResearchSellerListingMode(listingMode);
  if (mode === 'solds') {
    // Category soldDate search (no sellers filter) — drop anything that still looks buyable.
    if (isBrowseSummaryStillBuyable(summary)) return false;
    if (browseSummaryHasFutureEndDate(summary)) return false;
    return true;
  }
  return isBrowseSummaryStillBuyable(summary);
}

/** Sold-days passed to eBay Browse — capped at 2 weeks; per-seller volume is whatever sold in that window. */
function researchSellerEbayFetchSoldDays(soldDays) {
  const d = Math.min(365, Math.max(7, parseInt(String(soldDays ?? RESEARCH_SELLER_FETCH_SOLD_DAYS), 10) || RESEARCH_SELLER_FETCH_SOLD_DAYS));
  return Math.min(d, RESEARCH_SELLER_FETCH_SOLD_DAYS);
}

function researchSellerItemCountsBySellerId(items) {
  const counts = new Map();
  for (const item of items ?? []) {
    const sid = Number(item.sellerId);
    if (!Number.isFinite(sid)) continue;
    counts.set(sid, (counts.get(sid) ?? 0) + 1);
  }
  return counts;
}

function researchSellerDiagnosticsFromCache(items, sellerRows, soldDays, minPriceGbp, extra = {}) {
  const countsBySellerId = researchSellerItemCountsBySellerId(items);
  const sellerItemCounts = {};
  for (const row of sellerRows) {
    const username = String(row.username ?? '').trim();
    if (username) sellerItemCounts[username] = countsBySellerId.get(row.id) ?? 0;
  }
  return {
    cached: true,
    cacheSource: 'database',
    categoryCount: null,
    categories: [],
    sellerCount: sellerRows.length,
    sellersFetchedFromEbay: 0,
    sellerItemCounts,
    soldDays,
    minPriceGbp,
    cacheUpdatedAt: extra.cacheUpdatedAt ?? null,
    scheduledCache: extra.scheduledCache ?? false,
    errors: []
  };
}

async function readResearchSellerCacheUpdatedAt(pool, sellerIds, soldDays, minPriceGbp, listingMode = 'solds') {
  if (!pool || !Array.isArray(sellerIds) || sellerIds.length === 0) return null;
  const mode = normalizeResearchSellerListingMode(listingMode);
  const res = await pool.query(
    `SELECT MAX(fetched_at) AS latest
     FROM ebay_research_seller_feed_fetched
     WHERE seller_id = ANY($1::int[])
       AND sold_days = $2
       AND min_price_gbp = $3
       AND listing_mode = $4`,
    [sellerIds, soldDays, minPriceGbp, mode]
  );
  const latest = res.rows?.[0]?.latest;
  return latest instanceof Date ? latest.toISOString() : latest != null ? String(latest) : null;
}

function verifyDbKeepaliveSecret(req, res) {
  const keepSecret = process.env.DB_KEEPALIVE_SECRET;
  if (!keepSecret) {
    res.status(503).json({ ok: false, error: 'DB_KEEPALIVE_SECRET not configured' });
    return false;
  }
  const auth = String(req.get('authorization') || '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const bearer = m ? m[1].trim() : '';
  const qSecret = String(req.query.secret ?? '').trim();
  if (bearer !== keepSecret && qSecret !== keepSecret) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

let researchSellerCronRefreshInFlight = false;

/** In-memory progress for per-seller ↻ refresh (polled by the UI while eBay fetch runs). */
const researchSellerRefreshProgress = new Map();

function researchSellerRefreshProgressKey(sellerId, soldDays, minPriceGbp, listingMode) {
  return `${sellerId}:${soldDays}:${minPriceGbp}:${normalizeResearchSellerListingMode(listingMode)}`;
}

function patchResearchSellerRefreshProgress(key, patch) {
  if (!key) return;
  const prev = researchSellerRefreshProgress.get(key) ?? {};
  researchSellerRefreshProgress.set(key, {
    ...prev,
    ...patch,
    updatedAt: Date.now()
  });
}

function getResearchSellerRefreshProgress(key) {
  return researchSellerRefreshProgress.get(key) ?? null;
}

function researchSellerRefreshProgressPayload(key) {
  const p = getResearchSellerRefreshProgress(key);
  if (!p) return { running: false, phase: 'idle' };
  const startedAt = Number(p.startedAt) || Number(p.updatedAt) || Date.now();
  return {
    ...p,
    elapsedMs: Math.max(0, Date.now() - startedAt)
  };
}

async function runResearchSellerSellerRefreshJob(
  sellerRow,
  allSellerRows,
  soldDays,
  minPriceGbp,
  progressKey,
  listingMode = 'solds'
) {
  const mode = normalizeResearchSellerListingMode(listingMode);
  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  try {
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database not configured');
    if (!appId || !certId) throw new Error('eBay credentials not configured');

    patchResearchSellerRefreshProgress(progressKey, {
      running: true,
      phase: 'starting',
      itemsFound: 0,
      itemsCached: 0,
      apiPages: 0,
      categoriesDone: 0,
      categoriesTotal: 0,
      currentCategory: null
    });

    invalidateSellerSoldFeedCache();
    await clearResearchSellerSellerCache(pool, sellerRow.id, soldDays, minPriceGbp, mode);

    const accessToken = await getAccessToken(appId, certId);
    const { sellerItems, errorLog } = await refreshSingleResearchSellerFromEbay(
      accessToken,
      sellerRow,
      allSellerRows,
      soldDays,
      minPriceGbp,
      pool,
      { progressKey, incrementalCache: true, listingMode: mode }
    );

    patchResearchSellerRefreshProgress(progressKey, {
      running: false,
      phase: 'done',
      itemsFound: sellerItems.length,
      itemsCached: sellerItems.length,
      refreshedItemCount: sellerItems.length,
      categoriesDone: getResearchSellerRefreshProgress(progressKey)?.categoriesTotal ?? 0,
      completedAt: Date.now(),
      errors: Array.isArray(errorLog) ? errorLog.map(String) : []
    });
  } catch (error) {
    const msg = error?.message != null ? String(error.message) : String(error);
    console.error('research-seller seller refresh job failed:', error);
    patchResearchSellerRefreshProgress(progressKey, {
      running: false,
      phase: 'error',
      error: msg
    });
  }
}

async function runResearchSellerCacheRefreshJob(soldDaysList, minPriceGbp) {
  const pool = getDatabasePool();
  if (!pool) {
    throw new Error('Database not configured');
  }
  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!appId || !certId) {
    throw new Error('eBay credentials not configured');
  }

  const all = await queryResearchSellerRows(pool);
  const sellerRows = all.rows ?? [];
  if (sellerRows.length === 0) {
    console.log('research-seller cron: no tracked sellers — skipped');
    return { sellerCount: 0, combos: [] };
  }

  const accessToken = await getAccessToken(appId, certId);
  invalidateSellerSoldFeedCache();
  const combos = [];
  for (const soldDays of soldDaysList) {
    const started = Date.now();
    const { items, diagnostics } = await fetchMergedResearchSellerFeed(
      accessToken,
      sellerRows,
      { soldDays, minPriceGbp, skipCache: true, listingMode: 'listings' },
      pool
    );
    combos.push({
      soldDays,
      minPriceGbp,
      itemCount: items.length,
      sellerItemCounts: diagnostics?.sellerItemCounts ?? {},
      errors: diagnostics?.errors?.length ?? 0,
      ms: Date.now() - started
    });
    console.log(
      `research-seller cron: ${soldDays}d min £${minPriceGbp} → ${items.length} items` +
        (diagnostics?.errors?.length ? ` (${diagnostics.errors.length} API error(s))` : '')
    );
  }
  return { sellerCount: sellerRows.length, combos };
}

function researchSellerIdsWithCachedItems(items) {
  const ids = new Set();
  for (const item of items ?? []) {
    const sid = Number(item.sellerId);
    if (Number.isFinite(sid)) ids.add(sid);
  }
  return ids;
}

function researchSellerCacheIsImbalanced(cachedItems, sellerRows) {
  if (sellerRows.length <= 1) return false;
  const withItems = researchSellerIdsWithCachedItems(cachedItems);
  if (withItems.size === 0) return false;
  return sellerRows.some((row) => !withItems.has(row.id));
}

function planResearchSellerEbayFetch(freshness, sellerRows, cachedItems) {
  const withItems = researchSellerIdsWithCachedItems(cachedItems);
  const sellersToFetch = sellerRows.filter((row) => {
    if (!freshness.freshSellerIds.has(row.id)) return true;
    if (sellerRows.length > 1 && withItems.size > 0 && !withItems.has(row.id)) return true;
    return false;
  });
  return { dbCachedItems: cachedItems, sellersToFetch };
}

function researchSellerPerSellerItemCap(sellerCount) {
  const n = Math.max(1, Number(sellerCount) || 1);
  return Math.min(
    RESEARCH_SELLER_PER_CATEGORY_FETCH_LIMIT,
    Math.max(RESEARCH_SELLER_MIN_PER_SELLER, Math.ceil(RESEARCH_SELLER_FETCH_LIMIT / n))
  );
}

function isMissingResearchSellerCacheGenerationColumn(err) {
  const msg = err?.message != null ? String(err.message) : String(err);
  return /cache_generation/i.test(msg) && /column|does not exist/i.test(msg);
}

async function queryResearchSellerFeedFetchedRows(pool, sellerIds, soldDays, minPriceGbp, listingMode = 'solds') {
  const mode = normalizeResearchSellerListingMode(listingMode);
  try {
    return await pool.query(
      `SELECT seller_id, item_count, fetched_at,
              COALESCE(cache_generation, 1) AS cache_generation
       FROM ebay_research_seller_feed_fetched
       WHERE seller_id = ANY($1::int[])
         AND sold_days = $2
         AND min_price_gbp = $3
         AND listing_mode = $4
         AND fetched_at >= NOW() - INTERVAL '1 hour' * $5`,
      [sellerIds, soldDays, minPriceGbp, mode, SELLER_SOLD_FEED_CACHE_HOURS]
    );
  } catch (err) {
    if (!isMissingResearchSellerCacheGenerationColumn(err)) throw err;
    const res = await pool.query(
      `SELECT seller_id, item_count, fetched_at
       FROM ebay_research_seller_feed_fetched
       WHERE seller_id = ANY($1::int[])
         AND sold_days = $2
         AND min_price_gbp = $3
         AND listing_mode = $4
         AND fetched_at >= NOW() - INTERVAL '1 hour' * $5`,
      [sellerIds, soldDays, minPriceGbp, mode, SELLER_SOLD_FEED_CACHE_HOURS]
    );
    return {
      rows: (res.rows ?? []).map((row) => ({ ...row, cache_generation: 1 }))
    };
  }
}

async function upsertResearchSellerFeedFetchedRow(
  client,
  sellerId,
  soldDays,
  minPriceGbp,
  itemCount,
  opts = {}
) {
  const inTransaction = opts.inTransaction === true;
  const listingMode = normalizeResearchSellerListingMode(opts.listingMode);

  const insertWithGeneration = () =>
    client.query(
      `INSERT INTO ebay_research_seller_feed_fetched (
         seller_id, sold_days, min_price_gbp, listing_mode, item_count, fetched_at, cache_generation
       ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       ON CONFLICT (seller_id, sold_days, min_price_gbp, listing_mode)
       DO UPDATE SET
         item_count = EXCLUDED.item_count,
         fetched_at = NOW(),
         cache_generation = EXCLUDED.cache_generation`,
      [
        sellerId,
        soldDays,
        minPriceGbp,
        listingMode,
        itemCount,
        RESEARCH_SELLER_CACHE_GENERATION
      ]
    );

  const insertWithoutGeneration = () =>
    client.query(
      `INSERT INTO ebay_research_seller_feed_fetched (
         seller_id, sold_days, min_price_gbp, listing_mode, item_count, fetched_at
       ) VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (seller_id, sold_days, min_price_gbp, listing_mode)
       DO UPDATE SET item_count = EXCLUDED.item_count, fetched_at = NOW()`,
      [sellerId, soldDays, minPriceGbp, listingMode, itemCount]
    );

  if (inTransaction) {
    await client.query('SAVEPOINT research_seller_feed_fetched');
    try {
      await insertWithGeneration();
    } catch (err) {
      if (!isMissingResearchSellerCacheGenerationColumn(err)) throw err;
      await client.query('ROLLBACK TO SAVEPOINT research_seller_feed_fetched');
      await insertWithoutGeneration();
    }
    return;
  }

  try {
    await insertWithGeneration();
  } catch (err) {
    if (!isMissingResearchSellerCacheGenerationColumn(err)) throw err;
    await insertWithoutGeneration();
  }
}
/** Categories probed per seller to discover where they sell (not full taxonomy — avoids rate limits). */
const RESEARCH_SELLER_PROBE_CATEGORIES = [
  { id: '11450', name: 'Clothes, Shoes & Accessories' },
  { id: EBAY_GB_MENS_CLOTHING_CATEGORY_ID, name: 'Men' },
  { id: '260010', name: 'Women' },
  { id: '888', name: 'Sporting Goods' },
  { id: '281', name: 'Jewellery & Watches' },
  { id: '11700', name: 'Home, Furniture & DIY' },
  { id: '1', name: 'Collectables' },
  { id: '11232', name: 'Films & TV' },
  { id: '220', name: 'Toys & Games' },
  { id: '267', name: 'Books, Comics & Magazines' }
];

function ebayBrowseCategoryIdsForAppendMens(appendMens) {
  return appendMens ? EBAY_GB_MENS_CLOTHING_CATEGORY_ID : null;
}

/**
 * @param {object} opts
 * @param {string} opts.query
 * @param {string} opts.accessToken
 * @param {string} [opts.limit='5']
 * @param {string} [opts.sort='-price']
 * @param {boolean} [opts.soldOnly=false]
 * @param {boolean} [opts.lastMonthOnly=false]
 * @param {number|null} [opts.soldDateRangeDays] — if set with soldOnly, soldDate window in days (overrides lastMonthOnly for sold)
 * @param {boolean} [opts.requireUsedCondition=true] — if false, omit Used-only filter (more sold comps)
 * @param {string|null} [opts.categoryIds] — Browse `category_ids` (single ID). Default men's clothing UK; `null` to omit.
 * @param {string|null} [opts.offset] — Browse API `offset` (pagination).
 * @param {number|null} [opts.minPriceGbp] — Minimum sold price in GBP (adds price + priceCurrency filters).
 * @param {number|null} [opts.maxPriceGbp] — Maximum sold price in GBP (upper bound of price range filter).
 * @param {boolean} [opts.ukItemsOnly=false] — When true, add itemLocationCountry:GB (UK-sited listings).
 * @param {string[]|null} [opts.sellerUsernames=null] — Restrict to these eBay seller usernames (max 250).
 * @param {number|null} [opts.listedWithinDays] — active listings listed within N days (when soldOnly is false)
 */
const getBrowseSearch = async ({
  query,
  accessToken,
  limit = '5',
  sort = '-price',
  offset = null,
  soldOnly = false,
  lastMonthOnly = false,
  soldDateRangeDays = null,
  requireUsedCondition = true,
  categoryIds = EBAY_GB_MENS_CLOTHING_CATEGORY_ID,
  minPriceGbp = null,
  maxPriceGbp = null,
  ukItemsOnly = false,
  sellerUsernames = null,
  buyingOptions = null,
  listedWithinDays = null
}) => {
  const params = new URLSearchParams({
    limit,
    sort,
    marketplaceId: 'EBAY_GB'
  });

  const q = typeof query === 'string' ? query : String(query ?? '');
  if (q.trim() !== '') {
    params.set('q', q);
  }

  if (offset != null && String(offset).trim() !== '') {
    const o = Math.trunc(Number(offset));
    if (Number.isFinite(o) && o >= 0) {
      params.set('offset', String(Math.min(10000, o)));
    }
  }

  if (categoryIds != null && String(categoryIds).trim() !== '') {
    params.set('category_ids', String(categoryIds).trim());
  }

  const filterParts = [];

  filterParts.push('deliveryCountry:GB');

  if (ukItemsOnly) {
    filterParts.push('itemLocationCountry:GB');
  }

  if (minPriceGbp != null && Number.isFinite(Number(minPriceGbp)) && Number(minPriceGbp) > 0) {
    const lo = Math.trunc(Number(minPriceGbp));
    let hi = 10000000;
    if (maxPriceGbp != null && Number.isFinite(Number(maxPriceGbp)) && Number(maxPriceGbp) > lo) {
      hi = Math.trunc(Number(maxPriceGbp));
    }
    filterParts.push(`price:[${lo}..${hi}]`);
    filterParts.push('priceCurrency:GBP');
  }

  if (Array.isArray(sellerUsernames) && sellerUsernames.length > 0) {
    const names = sellerUsernames
      .map((n) => (typeof n === 'string' ? n.trim() : String(n ?? '').trim()))
      .filter(Boolean)
      .slice(0, 250);
    if (names.length > 0) {
      filterParts.push(`sellers:{${names.join('|')}}`);
    }
  }

  if (typeof buyingOptions === 'string' && buyingOptions.trim() && !soldOnly) {
    filterParts.push(`buyingOptions:{${buyingOptions.trim()}}`);
  }

  if (requireUsedCondition !== false && !soldOnly) {
    filterParts.push('conditionIds:{3000}');
  }

  if (soldOnly) {
    let rangeDays = null;
    if (soldDateRangeDays != null && Number.isFinite(Number(soldDateRangeDays))) {
      rangeDays = Math.min(365, Math.max(7, Math.trunc(Number(soldDateRangeDays))));
    } else if (lastMonthOnly) {
      rangeDays = 30;
    }
    if (rangeDays != null) {
      const today = new Date();
      const start = new Date();
      start.setDate(today.getDate() - rangeDays);
      filterParts.push(`soldDate:[${start.toISOString()}..${today.toISOString()}]`);
    } else {
      filterParts.push('conditions:SOLD');
    }
  } else if (lastMonthOnly) {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    filterParts.push(`itemStartDate:[${thirtyDaysAgo.toISOString()}..${today.toISOString()}]`);
  } else if (listedWithinDays != null && Number.isFinite(Number(listedWithinDays))) {
    const rangeDays = Math.min(365, Math.max(7, Math.trunc(Number(listedWithinDays))));
    const today = new Date();
    const start = new Date();
    start.setDate(today.getDate() - rangeDays);
    filterParts.push(`itemStartDate:[${start.toISOString()}..${today.toISOString()}]`);
  }
  
  // Join all filter parts with commas
  const filterString = filterParts.join(',');
  params.set('filter', filterString);
  
  // Log the filter for debugging
  console.log(`[${new Date().toISOString()}] Browse API filter: ${filterString}`);
  console.log(`[${new Date().toISOString()}] Full URL: ${params.toString()}`);

  const ebayUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;

  const response = await fetch(ebayUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'  // UK marketplace (underscore format)
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Browse API error:', response.status, errorText);
    throw new Error(formatBrowseApiError(response.status, errorText));
  }

  return response.json();
};

function formatBrowseApiError(status, errorText) {
  const statusNum = Number(status);
  if (errorText) {
    try {
      const parsed = JSON.parse(errorText);
      const ebayErr = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
      const msg =
        (ebayErr && (ebayErr.longMessage || ebayErr.message)) ||
        (typeof parsed?.error === 'string' ? parsed.error : null) ||
        (typeof parsed?.message === 'string' ? parsed.message : null);
      if (msg) return `Browse API ${statusNum}: ${msg}`;
    } catch {
      /* use fallback below */
    }
    const trimmed = String(errorText).replace(/\s+/g, ' ').trim().slice(0, 240);
    if (trimmed) return `Browse API ${statusNum}: ${trimmed}`;
  }
  return `Browse API error: ${statusNum}`;
}

function sanitizeEbayFeedSearchTerm(raw) {
  let s = typeof raw === 'string' ? raw : String(raw ?? '');
  s = s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 120) {
    s = s.slice(0, 120).trim();
  }
  return s;
}

function ebaySummaryListedAtMs(s) {
  const raw = s?.itemCreationDate;
  if (raw == null || String(raw).trim() === '') return 0;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

function ebaySummarySoldAtMs(s) {
  const end = s?.itemEndDate;
  if (end != null && String(end).trim() !== '') {
    const t = Date.parse(String(end));
    if (Number.isFinite(t)) return t;
  }
  return ebaySummaryListedAtMs(s);
}

function sanitizeEbaySellerUsername(raw) {
  let s = typeof raw === 'string' ? raw : String(raw ?? '');
  s = s.replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/^@+/, '');
  if (s.length > 64) {
    s = s.slice(0, 64).trim();
  }
  if (!s || !/^[A-Za-z0-9_.\-]+$/.test(s)) {
    return '';
  }
  return s;
}

function ebaySummarySellerUsername(summary) {
  const seller = summary?.seller;
  if (!seller || typeof seller !== 'object') return null;
  if (typeof seller.username === 'string' && seller.username.trim()) {
    return seller.username.trim();
  }
  return null;
}

function itemSummarySellerMatches(summary, expectedUsername) {
  const expected = typeof expectedUsername === 'string' ? expectedUsername.trim() : '';
  if (!expected) return false;
  const actual = ebaySummarySellerUsername(summary);
  if (!actual) return false;
  return actual.toLowerCase() === expected.toLowerCase();
}

function mapEbayItemSummaryToSellerSoldCard(s, sellerId, sellerUsername, listingMode = 'solds') {
  const mode = normalizeResearchSellerListingMode(listingMode);
  const canonicalUsername = String(sellerUsername ?? '').trim();
  const base = mapEbayItemSummaryToFeedCard(s, sellerId, canonicalUsername);
  const atMs =
    mode === 'listings' ? ebaySummaryListedAtMs(s) : ebaySummarySoldAtMs(s);
  return {
    ...base,
    sellerId,
    sellerUsername: canonicalUsername,
    soldAtMs: atMs > 0 ? atMs : undefined
  };
}

function mapEbayItemSummaryToNicheCategorySoldCard(s, categoryId, categoryName) {
  const sellerUsername = ebaySummarySellerUsername(s) || '';
  const base = mapEbayItemSummaryToFeedCard(s, categoryId, categoryName);
  return {
    ...base,
    categoryId: String(categoryId),
    categoryName,
    sellerUsername,
    soldAtMs: ebaySummarySoldAtMs(s)
  };
}

const ebayNicheCategoryInsightCache = new Map();
const NICHE_CATEGORY_INSIGHT_CACHE_MS = 24 * 60 * 60 * 1000;
const NICHE_CATEGORY_INSIGHT_TOP_SELLERS = 5;
const NICHE_CATEGORY_INSIGHT_ITEM_LIMIT = 24;
const NICHE_CATEGORY_INSIGHT_SAMPLE_LIMIT = 200;

async function fetchNicheCategorySellerInsight(accessToken, categoryId, categoryName, days) {
  const cacheKey = `${categoryId}:${days}:v1`;
  const cached = ebayNicheCategoryInsightCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < NICHE_CATEGORY_INSIGHT_CACHE_MS) {
    return cached.data;
  }

  const data = await getBrowseSearch({
    query: nicheBrowseQueryForCategory(categoryName),
    accessToken,
    limit: String(NICHE_CATEGORY_INSIGHT_SAMPLE_LIMIT),
    sort: 'newlyListed',
    soldOnly: true,
    soldDateRangeDays: days,
    lastMonthOnly: false,
    requireUsedCondition: false,
    categoryIds: String(categoryId),
    minPriceGbp: null,
    maxPriceGbp: null,
    ukItemsOnly: true,
    buyingOptions: 'AUCTION|FIXED_PRICE'
  });

  const raw = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
  const uk = raw.filter(isUkItemSummary);
  const sellerCounts = new Map();

  for (const summary of uk) {
    const username = ebaySummarySellerUsername(summary);
    if (!username) continue;
    const key = username.toLowerCase();
    const prev = sellerCounts.get(key);
    if (prev) {
      prev.soldListingCount += 1;
    } else {
      sellerCounts.set(key, { username, soldListingCount: 1 });
    }
  }

  const topSellers = [...sellerCounts.values()]
    .sort(
      (a, b) =>
        b.soldListingCount - a.soldListingCount ||
        a.username.localeCompare(b.username, undefined, { sensitivity: 'base' })
    )
    .slice(0, NICHE_CATEGORY_INSIGHT_TOP_SELLERS);

  const topSellerKeys = new Set(topSellers.map((s) => s.username.toLowerCase()));
  const items = uk
    .filter((s) => {
      const u = ebaySummarySellerUsername(s);
      return u && topSellerKeys.has(u.toLowerCase());
    })
    .map((s) => mapEbayItemSummaryToNicheCategorySoldCard(s, categoryId, categoryName))
    .sort((a, b) => (b.soldAtMs ?? 0) - (a.soldAtMs ?? 0))
    .slice(0, NICHE_CATEGORY_INSIGHT_ITEM_LIMIT);

  const payload = {
    categoryId: String(categoryId),
    categoryName,
    days,
    sampleSize: uk.length,
    topSellers,
    items,
    fetchedAt: new Date().toISOString()
  };
  ebayNicheCategoryInsightCache.set(cacheKey, { fetchedAt: Date.now(), data: payload });
  return payload;
}

const sellerMergedFeedCache = new Map();
const sellerActiveCategoriesCache = new Map();

function researchSellerCacheKey(usernames, soldDays, minPriceGbp) {
  const names = usernames
    .map((u) => String(u).trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('|');
  return `${names}:${soldDays}:${minPriceGbp}`;
}

function researchSellerMergedFeedCacheKey(sellerRows, soldDays, minPriceGbp) {
  const usernames = sellerRows.map((r) => String(r.username ?? '').trim()).filter(Boolean);
  return researchSellerCacheKey(usernames, soldDays, minPriceGbp);
}

function invalidateSellerSoldFeedCache() {
  sellerMergedFeedCache.clear();
  sellerActiveCategoriesCache.clear();
}

function normalizeEbayCacheItemId(itemId) {
  const raw = itemId != null ? String(itemId).trim() : '';
  if (!raw) return '';
  const parts = raw.split('|');
  if (parts.length >= 2) {
    const legacy = parts[1].replace(/\D/g, '');
    if (legacy) return legacy;
  }
  const digits = raw.replace(/\D/g, '');
  return digits || raw;
}

function mapResearchSellerItemCacheRowToCard(row) {
  return {
    itemId: row.ebay_item_id != null ? String(row.ebay_item_id) : null,
    title: typeof row.title === 'string' ? row.title : '',
    imageUrl: row.image_url != null ? String(row.image_url) : null,
    priceLabel: typeof row.price_label === 'string' ? row.price_label : '—',
    itemWebUrl: row.item_web_url != null ? String(row.item_web_url) : null,
    sellerId: Number(row.seller_id),
    sellerUsername: typeof row.seller_username === 'string' ? row.seller_username : '',
    soldAtMs:
      row.sold_at_ms != null && Number.isFinite(Number(row.sold_at_ms))
        ? Number(row.sold_at_ms)
        : undefined
  };
}

function researchSellerItemCacheTableHint(error) {
  if (error && error.code === '42P01') {
    return {
      status: 503,
      body: {
        error: 'ebay_research_seller_item_cache tables missing',
        details: 'Run database/ebay_research_seller_item_cache.sql in your database.'
      }
    };
  }
  return null;
}

async function readResearchSellerFeedFreshness(pool, sellerRows, soldDays, minPriceGbp, listingMode = 'solds') {
  const sellerIds = sellerRows.map((r) => r.id);
  if (sellerIds.length === 0) {
    return { allFresh: true, freshSellerIds: new Set(), freshItems: [], cacheGenerationBySellerId: new Map() };
  }

  const fetched = await queryResearchSellerFeedFetchedRows(pool, sellerIds, soldDays, minPriceGbp, listingMode);

  const freshSellerIds = new Set();
  const cacheGenerationBySellerId = new Map();
  for (const row of fetched.rows ?? []) {
    const sellerId = Number(row.seller_id);
    const generation = Number(row.cache_generation);
    if (!Number.isFinite(sellerId)) continue;
    cacheGenerationBySellerId.set(sellerId, generation);
    if (generation === RESEARCH_SELLER_CACHE_GENERATION) {
      freshSellerIds.add(sellerId);
    }
  }
  const allFresh = sellerIds.every((id) => freshSellerIds.has(id));

  let freshItems = [];
  if (freshSellerIds.size > 0) {
    const freshRows = sellerRows.filter((r) => freshSellerIds.has(r.id));
    const counts = await researchSellerItemCountsFromDb(pool, freshRows, soldDays, minPriceGbp, {
      allowStale: false,
      listingMode
    });
    for (const row of freshRows) {
      if ((counts.get(row.id) ?? 0) > 0) {
        freshItems.push({ sellerId: row.id, itemId: `fresh-${row.id}` });
      }
    }
  }

  return { allFresh, freshSellerIds, freshItems, cacheGenerationBySellerId };
}

async function countResearchSellerCachedItems(pool, sellerIds, soldDays, minPriceGbp, opts = {}) {
  if (!pool || !Array.isArray(sellerIds) || sellerIds.length === 0) return 0;
  const { allowStale = false, listingMode = 'solds' } = opts;
  const mode = normalizeResearchSellerListingMode(listingMode);
  const res = allowStale
    ? await pool.query(
        `SELECT COUNT(*)::int AS n
         FROM ebay_research_seller_item_cache
         WHERE seller_id = ANY($1::int[])
           AND sold_days = $2
           AND min_price_gbp = $3
           AND listing_mode = $4`,
        [sellerIds, soldDays, minPriceGbp, mode]
      )
    : await pool.query(
        `SELECT COUNT(*)::int AS n
         FROM ebay_research_seller_item_cache
         WHERE seller_id = ANY($1::int[])
           AND sold_days = $2
           AND min_price_gbp = $3
           AND listing_mode = $4
           AND fetched_at >= NOW() - INTERVAL '1 hour' * $5`,
        [sellerIds, soldDays, minPriceGbp, mode, SELLER_SOLD_FEED_CACHE_HOURS]
      );
  return Number(res.rows?.[0]?.n) || 0;
}

async function researchSellerItemCountsFromDb(pool, sellerRows, soldDays, minPriceGbp, opts = {}) {
  const sellerIds = sellerRows.map((r) => r.id);
  if (!pool || sellerIds.length === 0) return new Map();
  const { allowStale = false, listingMode = 'solds' } = opts;
  const mode = normalizeResearchSellerListingMode(listingMode);
  const res = allowStale
    ? await pool.query(
        `SELECT seller_id, COUNT(*)::int AS n
         FROM ebay_research_seller_item_cache
         WHERE seller_id = ANY($1::int[])
           AND sold_days = $2
           AND min_price_gbp = $3
           AND listing_mode = $4
         GROUP BY seller_id`,
        [sellerIds, soldDays, minPriceGbp, mode]
      )
    : await pool.query(
        `SELECT seller_id, COUNT(*)::int AS n
         FROM ebay_research_seller_item_cache
         WHERE seller_id = ANY($1::int[])
           AND sold_days = $2
           AND min_price_gbp = $3
           AND listing_mode = $4
           AND fetched_at >= NOW() - INTERVAL '1 hour' * $5
         GROUP BY seller_id`,
        [sellerIds, soldDays, minPriceGbp, mode, SELLER_SOLD_FEED_CACHE_HOURS]
      );
  const counts = new Map();
  for (const row of res.rows ?? []) {
    counts.set(Number(row.seller_id), Number(row.n) || 0);
  }
  return counts;
}

async function buildResearchSellerCacheDiagnostics(
  pool,
  sellerRows,
  soldDays,
  minPriceGbp,
  extra = {}
) {
  const countsBySellerId = pool
    ? await researchSellerItemCountsFromDb(pool, sellerRows, soldDays, minPriceGbp, {
        allowStale: extra.allowStale ?? false,
        listingMode: extra.listingMode ?? 'solds'
      })
    : new Map();
  const sellerItemCounts = {};
  for (const row of sellerRows) {
    const username = String(row.username ?? '').trim();
    if (username) sellerItemCounts[username] = countsBySellerId.get(row.id) ?? 0;
  }
  const cacheUpdatedAt =
    extra.cacheUpdatedAt ??
    (pool
      ? await readResearchSellerCacheUpdatedAt(
          pool,
          sellerRows.map((r) => r.id),
          soldDays,
          minPriceGbp,
          extra.listingMode ?? 'solds'
        )
      : null);
  return {
    cached: true,
    cacheSource: 'database',
    categoryCount: null,
    categories: [],
    sellerCount: sellerRows.length,
    sellersFetchedFromEbay: 0,
    sellerItemCounts,
    soldDays,
    minPriceGbp,
    listingMode: normalizeResearchSellerListingMode(extra.listingMode),
    cacheUpdatedAt,
    scheduledCache: extra.scheduledCache ?? false,
    staleCache: extra.staleCache ?? false,
    errors: extra.errors ?? []
  };
}

async function readResearchSellerFeedPage(
  pool,
  sellerRows,
  soldDays,
  minPriceGbp,
  page,
  pageSize,
  opts = {}
) {
  if (!pool || sellerRows.length === 0) return [];
  const sellerIds = sellerRows.map((r) => r.id);
  const usernameById = new Map(
    sellerRows.map((r) => [Number(r.id), String(r.username ?? '').trim()])
  );
  const offset = Math.max(0, Number(page) || 0) * pageSize;
  const { allowStale = false, listingMode = 'solds' } = opts;
  const mode = normalizeResearchSellerListingMode(listingMode);
  const res = allowStale
    ? await pool.query(
        `SELECT seller_id, ebay_item_id, seller_username, title, image_url, price_label,
                item_web_url, sold_at_ms
         FROM ebay_research_seller_item_cache
         WHERE seller_id = ANY($1::int[])
           AND sold_days = $2
           AND min_price_gbp = $3
           AND listing_mode = $4
         ORDER BY sold_at_ms DESC NULLS LAST, ebay_item_id ASC
         OFFSET $5 LIMIT $6`,
        [sellerIds, soldDays, minPriceGbp, mode, offset, pageSize]
      )
    : await pool.query(
        `SELECT seller_id, ebay_item_id, seller_username, title, image_url, price_label,
                item_web_url, sold_at_ms
         FROM ebay_research_seller_item_cache
         WHERE seller_id = ANY($1::int[])
           AND sold_days = $2
           AND min_price_gbp = $3
           AND listing_mode = $4
           AND fetched_at >= NOW() - INTERVAL '1 hour' * $5
         ORDER BY sold_at_ms DESC NULLS LAST, ebay_item_id ASC
         OFFSET $6 LIMIT $7`,
        [sellerIds, soldDays, minPriceGbp, mode, SELLER_SOLD_FEED_CACHE_HOURS, offset, pageSize]
      );
  return (res.rows ?? [])
    .map(mapResearchSellerItemCacheRowToCard)
    .filter((item) =>
      ebayUsernamesMatch(item.sellerUsername, usernameById.get(Number(item.sellerId)) ?? '')
    );
}

async function readResearchSellerItemsFromDb(pool, sellerRows, soldDays, minPriceGbp, opts = {}) {
  const { allowStale = false, limit = null } = opts;
  if (sellerRows.length === 0) return [];

  const sellerIds = sellerRows.map((r) => r.id);
  const usernameById = new Map(
    sellerRows.map((r) => [Number(r.id), String(r.username ?? '').trim()])
  );
  const res = allowStale
    ? await pool.query(
        `SELECT seller_id, ebay_item_id, seller_username, title, image_url, price_label,
                item_web_url, sold_at_ms
         FROM ebay_research_seller_item_cache
         WHERE seller_id = ANY($1::int[])
           AND sold_days = $2
           AND min_price_gbp = $3
         ORDER BY sold_at_ms DESC NULLS LAST, ebay_item_id ASC
         ${limit != null ? 'LIMIT $4' : ''}`,
        limit != null
          ? [sellerIds, soldDays, minPriceGbp, limit]
          : [sellerIds, soldDays, minPriceGbp]
      )
    : await pool.query(
        `SELECT seller_id, ebay_item_id, seller_username, title, image_url, price_label,
                item_web_url, sold_at_ms
         FROM ebay_research_seller_item_cache
         WHERE seller_id = ANY($1::int[])
           AND sold_days = $2
           AND min_price_gbp = $3
           AND fetched_at >= NOW() - INTERVAL '1 hour' * $4
         ORDER BY sold_at_ms DESC NULLS LAST, ebay_item_id ASC
         ${limit != null ? 'LIMIT $5' : ''}`,
        limit != null
          ? [sellerIds, soldDays, minPriceGbp, SELLER_SOLD_FEED_CACHE_HOURS, limit]
          : [sellerIds, soldDays, minPriceGbp, SELLER_SOLD_FEED_CACHE_HOURS]
      );
  return (res.rows ?? [])
    .map(mapResearchSellerItemCacheRowToCard)
    .filter((item) =>
      ebayUsernamesMatch(item.sellerUsername, usernameById.get(Number(item.sellerId)) ?? '')
    );
}

async function readResearchSellerItemsFromDbMerged(pool, sellerRows, soldDays, minPriceGbp, opts = {}) {
  return readResearchSellerItemsFromDb(pool, sellerRows, soldDays, minPriceGbp, opts);
}

async function invalidateResearchSellerDbFeed(pool, sellerIds, soldDays, minPriceGbp, listingMode = 'solds') {
  if (!pool || !Array.isArray(sellerIds) || sellerIds.length === 0) return;
  const mode = normalizeResearchSellerListingMode(listingMode);
  await pool.query(
    `DELETE FROM ebay_research_seller_item_cache
     WHERE seller_id = ANY($1::int[]) AND sold_days = $2 AND min_price_gbp = $3 AND listing_mode = $4`,
    [sellerIds, soldDays, minPriceGbp, mode]
  );
  await pool.query(
    `DELETE FROM ebay_research_seller_feed_fetched
     WHERE seller_id = ANY($1::int[]) AND sold_days = $2 AND min_price_gbp = $3 AND listing_mode = $4`,
    [sellerIds, soldDays, minPriceGbp, mode]
  );
}

async function upsertResearchSellerItemCacheRows(
  db,
  sellerId,
  soldDays,
  minPriceGbp,
  items,
  listingMode = 'solds'
) {
  const mode = normalizeResearchSellerListingMode(listingMode);
  const sellerItems = items.filter((it) => Number(it.sellerId) === Number(sellerId));
  const seenIds = new Set();
  let written = 0;
  for (const item of sellerItems) {
    const ebayItemId = normalizeEbayCacheItemId(item.itemId);
    if (!ebayItemId || seenIds.has(ebayItemId)) continue;
    seenIds.add(ebayItemId);
    await db.query(
      `INSERT INTO ebay_research_seller_item_cache (
         seller_id, ebay_item_id, sold_days, min_price_gbp, listing_mode, seller_username,
         title, image_url, price_label, item_web_url, sold_at_ms, fetched_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (seller_id, ebay_item_id, sold_days, min_price_gbp, listing_mode)
       DO UPDATE SET
         seller_username = EXCLUDED.seller_username,
         title = EXCLUDED.title,
         image_url = EXCLUDED.image_url,
         price_label = EXCLUDED.price_label,
         item_web_url = EXCLUDED.item_web_url,
         sold_at_ms = EXCLUDED.sold_at_ms,
         fetched_at = NOW()`,
      [
        sellerId,
        ebayItemId,
        soldDays,
        minPriceGbp,
        mode,
        String(item.sellerUsername ?? '').trim(),
        String(item.title ?? '').slice(0, 500),
        item.imageUrl != null ? String(item.imageUrl).slice(0, 2000) : null,
        String(item.priceLabel ?? '—').slice(0, 64),
        item.itemWebUrl != null ? String(item.itemWebUrl).slice(0, 2000) : null,
        item.soldAtMs != null && Number.isFinite(Number(item.soldAtMs)) ? Number(item.soldAtMs) : null
      ]
    );
    written += 1;
  }
  return written;
}

async function clearResearchSellerSellerCache(pool, sellerId, soldDays, minPriceGbp, listingMode = 'solds') {
  if (!pool) return;
  const mode = normalizeResearchSellerListingMode(listingMode);
  await pool.query(
    `DELETE FROM ebay_research_seller_item_cache
     WHERE seller_id = $1 AND sold_days = $2 AND min_price_gbp = $3 AND listing_mode = $4`,
    [sellerId, soldDays, minPriceGbp, mode]
  );
  await pool.query(
    `DELETE FROM ebay_research_seller_feed_fetched
     WHERE seller_id = $1 AND sold_days = $2 AND min_price_gbp = $3 AND listing_mode = $4`,
    [sellerId, soldDays, minPriceGbp, mode]
  );
}

async function appendResearchSellerItemsInDb(
  pool,
  sellerId,
  soldDays,
  minPriceGbp,
  items,
  listingMode = 'solds'
) {
  if (!pool || !Array.isArray(items) || items.length === 0) return 0;
  return upsertResearchSellerItemCacheRows(pool, sellerId, soldDays, minPriceGbp, items, listingMode);
}

async function finalizeResearchSellerFeedFetched(
  pool,
  sellerId,
  soldDays,
  minPriceGbp,
  itemCount,
  listingMode = 'solds'
) {
  const client = await pool.connect();
  try {
    await upsertResearchSellerFeedFetchedRow(
      client,
      sellerId,
      soldDays,
      minPriceGbp,
      itemCount,
      { listingMode }
    );
  } finally {
    client.release();
  }
}

async function replaceResearchSellerItemsInDb(
  pool,
  sellerId,
  soldDays,
  minPriceGbp,
  items,
  listingMode = 'solds'
) {
  const mode = normalizeResearchSellerListingMode(listingMode);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM ebay_research_seller_item_cache
       WHERE seller_id = $1 AND sold_days = $2 AND min_price_gbp = $3 AND listing_mode = $4`,
      [sellerId, soldDays, minPriceGbp, mode]
    );

    await upsertResearchSellerItemCacheRows(client, sellerId, soldDays, minPriceGbp, items, mode);

    const sellerItems = items.filter((it) => Number(it.sellerId) === Number(sellerId));
    const seenIds = new Set();
    for (const item of sellerItems) {
      const ebayItemId = normalizeEbayCacheItemId(item.itemId);
      if (ebayItemId) seenIds.add(ebayItemId);
    }

    await upsertResearchSellerFeedFetchedRow(
      client,
      sellerId,
      soldDays,
      minPriceGbp,
      seenIds.size,
      { inTransaction: true, listingMode: mode }
    );

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* connection may already be closed */
    }
    const msg = error?.message != null ? String(error.message) : String(error);
    console.error(
      `research-seller DB replace failed seller_id=${sellerId} soldDays=${soldDays} minPrice=${minPriceGbp}:`,
      msg
    );
    throw error;
  } finally {
    client.release();
  }
}

function mergeResearchSellerSoldCards(existing, incoming, limit) {
  const seen = new Set();
  const merged = [];
  for (const item of [...existing, ...incoming]) {
    const id = normalizeEbayCacheItemId(item?.itemId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
    if (merged.length >= limit) break;
  }
  merged.sort((a, b) => (b.soldAtMs ?? 0) - (a.soldAtMs ?? 0));
  return merged.slice(0, limit);
}

/** Dedupe, cap fairly per seller, then sort newest-first for the merged feed. */
function finalizeResearchSellerFeedItems(flatItems, sellerRows, limit) {
  if (!Array.isArray(sellerRows) || sellerRows.length === 0) {
    return mergeResearchSellerSoldCards([], flatItems ?? [], limit);
  }

  const seen = new Set();
  const bySeller = new Map();
  for (const row of sellerRows) bySeller.set(row.id, []);
  for (const item of flatItems ?? []) {
    const id = normalizeEbayCacheItemId(item?.itemId);
    const sid = Number(item.sellerId);
    if (!id || seen.has(id) || !bySeller.has(sid)) continue;
    seen.add(id);
    bySeller.get(sid).push(item);
  }

  const perCap = researchSellerPerSellerItemCap(sellerRows.length);
  for (const list of bySeller.values()) {
    list.sort((a, b) => (b.soldAtMs ?? 0) - (a.soldAtMs ?? 0));
  }

  const merged = [];
  const indexBySeller = new Map();
  while (merged.length < limit) {
    let pickedAny = false;
    for (const row of sellerRows) {
      const pool = bySeller.get(row.id) ?? [];
      const idx = indexBySeller.get(row.id) ?? 0;
      if (idx >= pool.length || idx >= perCap) continue;
      merged.push(pool[idx]);
      indexBySeller.set(row.id, idx + 1);
      pickedAny = true;
      if (merged.length >= limit) break;
    }
    if (!pickedAny) break;
  }

  merged.sort((a, b) => (b.soldAtMs ?? 0) - (a.soldAtMs ?? 0));
  return merged.slice(0, limit);
}

function researchSellerBrowseDelay() {
  return new Promise((resolve) => setTimeout(resolve, RESEARCH_SELLER_BROWSE_DELAY_MS));
}

function nicheBrowseQueryForCategoryEarly(categoryName) {
  const name = typeof categoryName === 'string' ? categoryName.trim() : '';
  if (name) return name;
  return 'item';
}

function ebayUsernamesMatch(a, b) {
  const left = normalizeEbayUsernameKey(a);
  const right = normalizeEbayUsernameKey(b);
  if (!left || !right) return false;
  return left === right;
}

function ebayListingMatchesSellerUsername(summary, expectedUsername) {
  const expected = String(expectedUsername ?? '').trim();
  if (!expected) return false;
  const actual = ebaySummarySellerUsername(summary);
  if (!actual) return false;
  return ebayUsernamesMatch(actual, expected);
}

/** True when Browse accepted sellers:{username} (empty results still counts as recognised). */
function browseSellerUsernameRecognized(data, username) {
  const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
  const total = typeof data?.total === 'number' ? data.total : 0;
  if (items.some((summary) => ebayUsernamesMatch(ebaySummarySellerUsername(summary), username))) {
    return true;
  }
  return items.length === 0 && total === 0;
}

/** Browse returned listings, but none from the requested seller (filter ignored or unsupported). */
function browseSellerFilterIgnored(data, username) {
  if (browseSellerUsernameRecognized(data, username)) return false;
  const items = Array.isArray(data?.itemSummaries) ? data.itemSummaries : [];
  return items.length > 0;
}

function ebayUkSellerProfileUrl(username) {
  return `https://www.ebay.co.uk/usr/${encodeURIComponent(String(username ?? '').trim())}`;
}

/** eBay Store URL uses the /str/ slug, which may differ from the Browse API username (e.g. jamsebazaar vs jams.ebazaar). */
function ebayUkSellerStoreUrl(username, storeSlug) {
  const slug = String(storeSlug ?? '').trim() || researchSellerStoreSlugFromUsername(username);
  return `https://www.ebay.co.uk/str/${encodeURIComponent(slug)}`;
}

function researchSellerStoreSlugFromUsername(username) {
  const u = String(username ?? '').trim();
  if (!u) return '';
  if (u.includes('.')) return u.replace(/\./g, '');
  return u;
}

function researchSellerStoreSlugForRow(row) {
  const fromDb = row?.store_slug != null ? String(row.store_slug).trim() : '';
  if (fromDb) return fromDb;
  return researchSellerStoreSlugFromUsername(row?.username);
}

function researchSellerStoreUrlForRow(row) {
  return ebayUkSellerStoreUrl(row?.username, researchSellerStoreSlugForRow(row));
}

function isMissingResearchSellerStoreSlugColumn(err) {
  const msg = err?.message != null ? String(err.message) : String(err);
  return /store_slug/i.test(msg) && /column|does not exist/i.test(msg);
}

async function queryResearchSellerRows(pool) {
  try {
    return await pool.query(
      `SELECT id, username, store_slug, created_at
       FROM ebay_research_seller
       ORDER BY created_at ASC, id ASC`
    );
  } catch (err) {
    if (!isMissingResearchSellerStoreSlugColumn(err)) throw err;
    const res = await pool.query(
      `SELECT id, username, created_at FROM ebay_research_seller ORDER BY created_at ASC, id ASC`
    );
    return {
      rows: (res.rows ?? []).map((row) => ({ ...row, store_slug: null }))
    };
  }
}

async function findResearchSellerDuplicate(pool, username, storeSlug) {
  const all = await queryResearchSellerRows(pool);
  const userKey = normalizeEbayUsernameKey(username);
  const slugKey = storeSlug ? normalizeEbayUsernameKey(storeSlug) : '';
  for (const row of all.rows ?? []) {
    const rowUserKey = normalizeEbayUsernameKey(row.username);
    const rowSlug = researchSellerStoreSlugForRow(row);
    const rowSlugKey = normalizeEbayUsernameKey(rowSlug);
    if (userKey && rowUserKey === userKey) return row;
    if (slugKey && rowSlugKey === slugKey) return row;
    if (slugKey && rowUserKey === slugKey) return row;
    if (userKey && rowSlugKey === userKey) return row;
  }
  return null;
}

async function upsertResearchSellerRow(pool, username, storeSlug) {
  const dup = await findResearchSellerDuplicate(pool, username, storeSlug);
  const slugToSave = storeSlug ? String(storeSlug).trim() : null;

  if (dup) {
    try {
      const updated = await pool.query(
        `UPDATE ebay_research_seller
         SET username = $1,
             store_slug = COALESCE($2, store_slug)
         WHERE id = $3
         RETURNING id, username, store_slug, created_at`,
        [username, slugToSave, dup.id]
      );
      return { row: updated.rows[0], created: false };
    } catch (err) {
      if (!isMissingResearchSellerStoreSlugColumn(err)) throw err;
      const updated = await pool.query(
        `UPDATE ebay_research_seller SET username = $1 WHERE id = $2 RETURNING id, username, created_at`,
        [username, dup.id]
      );
      return {
        row: { ...updated.rows[0], store_slug: slugToSave ?? researchSellerStoreSlugForRow(updated.rows[0]) },
        created: false
      };
    }
  }

  try {
    const ins = await pool.query(
      `INSERT INTO ebay_research_seller (username, store_slug) VALUES ($1, $2)
       RETURNING id, username, store_slug, created_at`,
      [username, slugToSave]
    );
    return { row: ins.rows[0], created: true };
  } catch (err) {
    if (!isMissingResearchSellerStoreSlugColumn(err)) throw err;
    const ins = await pool.query(
      `INSERT INTO ebay_research_seller (username) VALUES ($1) RETURNING id, username, created_at`,
      [username]
    );
    return {
      row: { ...ins.rows[0], store_slug: slugToSave ?? researchSellerStoreSlugFromUsername(username) },
      created: true
    };
  }
}

/** Parse username, eBay store/profile URL, or listing URL from the add-seller textbox. */
function parseEbaySellerInput(raw) {
  let s = typeof raw === 'string' ? raw : String(raw ?? '');
  s = s.replace(/[\u0000-\u001F\u007F]/g, '').trim().replace(/^@+/, '');
  if (!s) return { kind: 'empty' };

  const tryPath = (pathname) => {
    const itm = pathname.match(/\/itm(?:\/[^/]+)?\/(\d{9,14})/i);
    if (itm) return { kind: 'listing', listingId: itm[1] };
    const shop = pathname.match(/\/(?:str|usr)\/([A-Za-z0-9_.\-]+)/i);
    if (shop) return { kind: 'shop', username: shop[1] };
    return null;
  };

  if (/^https?:\/\//i.test(s) || s.startsWith('www.') || s.includes('ebay.')) {
    try {
      const url = new URL(s.startsWith('http') ? s : `https://${s}`);
      const parsed = tryPath(url.pathname);
      if (parsed) return parsed;
    } catch (_) {
      /* fall through */
    }
  }

  if (s.includes('ebay.co.uk/') || s.includes('ebay.com/')) {
    try {
      const url = new URL(s.startsWith('http') ? s : `https://${s}`);
      const parsed = tryPath(url.pathname);
      if (parsed) return parsed;
    } catch (_) {
      const pathMatch = s.match(/ebay\.(?:co\.uk|com)(\/[^?#]+)/i);
      if (pathMatch) {
        const parsed = tryPath(pathMatch[1]);
        if (parsed) return parsed;
      }
    }
  }

  if (s.startsWith('/')) {
    const parsed = tryPath(s);
    if (parsed) return parsed;
  }

  const plain = sanitizeEbaySellerUsername(s);
  if (plain) return { kind: 'username', username: plain };
  return { kind: 'invalid' };
}

async function resolveSellerUsernameForAdd(accessToken, rawInput) {
  const entered = String(rawInput ?? '').trim();
  const parsed = parseEbaySellerInput(entered);

  if (parsed.kind === 'empty' || parsed.kind === 'invalid') {
    return {
      ok: false,
      error: 'Enter an eBay username, store URL (/str/…), or a sold listing URL (/itm/…)'
    };
  }

  if (parsed.kind === 'listing') {
    await researchSellerBrowseDelay();
    const item = await fetchBrowseListingItem(accessToken, parsed.listingId);
    const fromListing =
      item?.seller && typeof item.seller.username === 'string' ? item.seller.username.trim() : '';
    const username = sanitizeEbaySellerUsername(fromListing);
    if (!username) {
      return {
        ok: false,
        error: 'Could not read seller from listing',
        details: `eBay returned no seller for item ${parsed.listingId}. Check the listing URL is a valid eBay UK item.`
      };
    }
    return {
      ok: true,
      username,
      storeSlug:
        username.includes('.') && username.replace(/\./g, '') !== username
          ? username.replace(/\./g, '')
          : null,
      entered,
      resolvedFrom: 'listing',
      note:
        entered.toLowerCase() !== username.toLowerCase()
          ? `Saved as "${username}" (seller username from listing — store link uses slug without dots when needed).`
          : `Saved as "${username}" (from listing).`
    };
  }

  const slug = sanitizeEbaySellerUsername(parsed.username);
  if (!slug) {
    return { ok: false, error: 'Could not read a seller name from that URL' };
  }

  const storeSlugFromUrl = parsed.kind === 'shop' ? slug : null;
  let verified = await verifyEbaySellerUsernameExists(accessToken, slug, storeSlugFromUrl);
  if (!verified.ok && parsed.kind === 'shop') {
    verified = await probeBrowseUsernamesForStoreSlug(accessToken, slug);
  }
  if (!verified.ok) {
    if (parsed.kind === 'shop') {
      const storeUrl = ebayUkSellerStoreUrl(slug, slug);
      return {
        ok: true,
        username: slug,
        storeSlug: slug,
        entered,
        resolvedFrom: 'store_url',
        unverified: true,
        warning:
          `Store "${slug}" saved. eBay could not verify sold listings for the store slug alone — ` +
          `paste a sold listing URL from this store if the feed stays empty (API username may differ, e.g. with a dot).`,
        storeUrl,
        profileUrl: ebayUkSellerProfileUrl(slug)
      };
    }
    return {
      ok: false,
      error: verified.error || 'eBay seller not found',
      details: verified.details,
      profileUrl: verified.profileUrl,
      storeUrl: verified.storeUrl
    };
  }

  const browseUsername = verified.browseUsername || slug;
  return {
    ok: true,
    username: browseUsername,
    storeSlug: storeSlugFromUrl || verified.storeSlug || null,
    entered,
    resolvedFrom: parsed.kind === 'shop' ? 'store_url' : 'username',
    unverified: Boolean(verified.unverified),
    warning: verified.warning,
    storeUrl: verified.storeUrl || ebayUkSellerStoreUrl(browseUsername, storeSlugFromUrl || slug),
    profileUrl: verified.profileUrl || ebayUkSellerProfileUrl(browseUsername)
  };
}

async function verifyEbaySellerUsernameExists(accessToken, username, storeSlugHint) {
  const probes = [
    { soldOnly: false },
    { soldOnly: true, soldDateRangeDays: 365 }
  ];
  let filterIgnored = false;
  for (const probe of probes) {
    await researchSellerBrowseDelay();
    try {
      const data = await getBrowseSearch({
        query: 'item',
        accessToken,
        limit: '5',
        sort: 'newlyListed',
        soldOnly: probe.soldOnly,
        soldDateRangeDays: probe.soldDateRangeDays,
        requireUsedCondition: false,
        categoryIds: '11450',
        sellerUsernames: [username]
      });
      if (browseSellerUsernameRecognized(data, username)) {
        return {
          ok: true,
          browseUsername: username,
          storeSlug: storeSlugHint || null
        };
      }
      if (browseSellerFilterIgnored(data, username)) {
        filterIgnored = true;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: 'Could not verify seller on eBay', details: msg };
    }
  }

  const storeUrl = ebayUkSellerStoreUrl(username, storeSlugHint || username);
  const profileUrl = ebayUkSellerProfileUrl(username);

  if (filterIgnored) {
    return {
      ok: true,
      unverified: true,
      browseUsername: username,
      storeSlug: storeSlugHint || username,
      storeUrl,
      profileUrl,
      warning:
        `eBay search could not filter sold listings by "${username}" (common for eBay Stores). ` +
        `Seller saved — store opens at ${storeUrl}. Paste a sold listing URL if the feed stays empty.`
    };
  }

  return {
    ok: false,
    error: 'eBay seller not found',
    details: `eBay did not recognise "${username}" when searching their listings. Check the store (${storeUrl}) or profile (${profileUrl}) and use the exact name from the URL.`,
    storeUrl,
    profileUrl
  };
}

/** When /str/jamsebazaar fails Browse verify, try dotted API usernames like jams.ebazaar. */
async function probeBrowseUsernamesForStoreSlug(accessToken, storeSlug) {
  const slug = String(storeSlug ?? '').trim();
  if (!slug || slug.includes('.')) {
    return { ok: false, error: 'eBay seller not found' };
  }

  const dottedCandidates = [];
  for (let i = 1; i < slug.length; i++) {
    const candidate = sanitizeEbaySellerUsername(`${slug.slice(0, i)}.${slug.slice(i)}`);
    if (candidate && candidate !== slug) dottedCandidates.push(candidate);
  }

  for (const candidate of dottedCandidates) {
    await researchSellerBrowseDelay();
    const verified = await verifyEbaySellerUsernameExists(accessToken, candidate, slug);
    if (verified.ok && !verified.unverified) {
      return {
        ...verified,
        browseUsername: candidate,
        storeSlug: slug,
        storeUrl: ebayUkSellerStoreUrl(candidate, slug),
        profileUrl: ebayUkSellerProfileUrl(candidate),
        warning:
          `Store slug "${slug}" maps to API username "${candidate}" for sold listings. Store link uses /str/${slug}.`
      };
    }
  }

  return { ok: false, error: 'eBay seller not found' };
}

/** Quick check: does Browse `sellers:{username}` return that seller's solds (not random listings)? */
async function quickBrowseSellerFilterCheck(accessToken, username) {
  await researchSellerBrowseDelay();
  const data = await getBrowseSearch({
    query: 'item',
    accessToken,
    limit: '5',
    sort: 'newlyListed',
    soldOnly: true,
    soldDateRangeDays: 7,
    requireUsedCondition: false,
    categoryIds: '11450',
    minPriceGbp: 20,
    ukItemsOnly: true,
    buyingOptions: 'AUCTION|FIXED_PRICE',
    sellerUsernames: [username]
  });
  const raw = (Array.isArray(data.itemSummaries) ? data.itemSummaries : []).filter(isUkItemSummary);
  const hasMatching = raw.some((s) => ebayListingMatchesSellerUsername(s, username));
  const filterIgnored = browseSellerFilterIgnored(data, username);
  const total = typeof data.total === 'number' ? data.total : 0;
  return {
    filterIgnored,
    hasMatching,
    empty: raw.length === 0 && total === 0
  };
}

/**
 * eBay Browse filters solds by seller username, not /str/ store slug.
 * When the stored name is a store slug (e.g. jamsebazaar), resolve the API username (jams.ebazaar).
 */
async function ensureResearchSellerBrowseUsername(accessToken, sellerRow, pool) {
  const stored = String(sellerRow.username ?? '').trim();
  const storeSlug = researchSellerStoreSlugForRow(sellerRow);
  if (!stored) return stored;

  const check = await quickBrowseSellerFilterCheck(accessToken, stored);
  if (check.hasMatching || (check.empty && !check.filterIgnored)) {
    return stored;
  }

  const slugToProbe =
    storeSlug && normalizeEbayUsernameKey(storeSlug) !== normalizeEbayUsernameKey(stored)
      ? storeSlug
      : !stored.includes('.')
        ? stored
        : storeSlug || null;

  if (slugToProbe && !String(slugToProbe).includes('.')) {
    const probed = await probeBrowseUsernamesForStoreSlug(accessToken, slugToProbe);
    if (probed.ok && probed.browseUsername) {
      const browseUser = String(probed.browseUsername).trim();
      if (
        pool &&
        browseUser &&
        normalizeEbayUsernameKey(browseUser) !== normalizeEbayUsernameKey(stored)
      ) {
        try {
          await pool.query(
            `UPDATE ebay_research_seller
             SET username = $1, store_slug = COALESCE(store_slug, $2)
             WHERE id = $3`,
            [browseUser, slugToProbe, sellerRow.id]
          );
        } catch (err) {
          if (!isMissingResearchSellerStoreSlugColumn(err)) throw err;
          await pool.query(`UPDATE ebay_research_seller SET username = $1 WHERE id = $2`, [
            browseUser,
            sellerRow.id
          ]);
        }
        console.log(
          `research-seller: store slug "${slugToProbe}" → Browse username "${browseUser}"`
        );
        sellerRow.username = browseUser;
        if (!sellerRow.store_slug) sellerRow.store_slug = slugToProbe;
      }
      return browseUser;
    }
  }

  return stored;
}

function normalizeEbayUsernameKey(username) {
  return String(username ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function buildTrackedSellerLookup(sellerRows) {
  const sellerIdByKey = new Map();
  const canonicalByKey = new Map();
  const normalizedKeyToCanonical = new Map();
  for (const row of sellerRows) {
    const canonical = String(row.username ?? '').trim();
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    sellerIdByKey.set(key, row.id);
    canonicalByKey.set(key, canonical);
    normalizedKeyToCanonical.set(normalizeEbayUsernameKey(canonical), canonical);
  }
  return {
    sellerIdByKey,
    canonicalByKey,
    normalizedKeyToCanonical,
    trackedKeys: new Set(sellerIdByKey.keys())
  };
}

function resolveTrackedSellerUsername(summary, lookup, singleSellerHint) {
  const hint = singleSellerHint ? String(singleSellerHint).trim() : '';
  const ebayUser = ebaySummarySellerUsername(summary);

  const resolveKey = (username) => {
    const key = String(username).trim().toLowerCase();
    if (lookup.trackedKeys.has(key)) {
      return lookup.canonicalByKey.get(key) ?? String(username).trim();
    }
    const norm = normalizeEbayUsernameKey(username);
    if (norm && lookup.normalizedKeyToCanonical.has(norm)) {
      return lookup.normalizedKeyToCanonical.get(norm);
    }
    return null;
  };

  if (ebayUser) {
    const fromEbay = resolveKey(ebayUser);
    if (!fromEbay) return null;
    if (hint && !ebayUsernamesMatch(ebayUser, hint)) return null;
    return fromEbay;
  }

  if (hint) return resolveKey(hint);

  return null;
}

function researchSellerBrowseBaseOpts(cat, soldDays, minPriceGbp, limit, listingMode = 'solds') {
  const mode = normalizeResearchSellerListingMode(listingMode);
  const base = {
    query: nicheBrowseQueryForCategoryEarly(cat.name),
    limit: String(limit),
    sort: 'newlyListed',
    lastMonthOnly: false,
    requireUsedCondition: false,
    categoryIds: cat.id,
    minPriceGbp,
    maxPriceGbp: null,
    ukItemsOnly: true
  };
  if (mode === 'listings') {
    return {
      ...base,
      soldOnly: false,
      soldDateRangeDays: null,
      listedWithinDays: soldDays,
      buyingOptions: 'AUCTION|FIXED_PRICE'
    };
  }
  return {
    ...base,
    sort: '-itemEndDate',
    soldOnly: true,
    soldDateRangeDays: soldDays,
    listedWithinDays: null,
    buyingOptions: null
  };
}

function researchSellerLogError(errorLog, entry) {
  if (!Array.isArray(errorLog)) return;
  const msg = typeof entry === 'string' ? entry : entry?.error;
  if (!msg) return;
  const line =
    typeof entry === 'string'
      ? entry
      : [entry.seller, entry.category, entry.error].filter(Boolean).join(' — ');
  if (!errorLog.includes(line)) errorLog.push(line);
}

/** Paginate Browse API until no more solds in window (or safety max). */
async function browseAllSoldSummariesForSeller(
  accessToken,
  username,
  cat,
  soldDays,
  minPriceGbp,
  errorLog,
  opts = {}
) {
  const {
    maxItems = RESEARCH_SELLER_ABSOLUTE_MAX_PER_SELLER,
    onPage,
    listingMode = 'solds'
  } = opts;
  const mode = normalizeResearchSellerListingMode(listingMode);
  const fetchSoldDays = researchSellerEbayFetchSoldDays(soldDays);
  const out = [];
  const seen = new Set();
  let offset = 0;
  let apiPages = 0;
  let emptyPageStreak = 0;
  // Browse soldDate + sellers:{username} returns active listings — scan category solds instead.
  const useSellerFilter = mode !== 'solds';

  while (out.length < maxItems && apiPages < RESEARCH_SELLER_SOLD_SCAN_MAX_PAGES_PER_CATEGORY) {
    const batchSize = Math.min(RESEARCH_SELLER_BROWSE_PAGE_SIZE, maxItems - out.length);
    await researchSellerBrowseDelay();
    try {
      const data = await getBrowseSearch({
        ...researchSellerBrowseBaseOpts(cat, fetchSoldDays, minPriceGbp, batchSize, mode),
        accessToken,
        offset: String(offset),
        sellerUsernames: useSellerFilter ? [username] : null
      });
      apiPages += 1;
      const rawAll = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
      const raw = rawAll
        .filter(isUkItemSummary)
        .filter((s) => ebayListingMatchesSellerUsername(s, username))
        .filter((s) => researchSellerSummaryMatchesListingMode(s, mode));
      let addedThisPage = 0;
      for (const s of raw) {
        const id = s?.itemId != null ? String(s.itemId) : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ summary: s, singleSellerHint: username });
        addedThisPage += 1;
      }
      if (mode === 'solds') {
        if (addedThisPage === 0) emptyPageStreak += 1;
        else emptyPageStreak = 0;
        if (emptyPageStreak >= RESEARCH_SELLER_SOLD_EMPTY_PAGE_STREAK) break;
      }
      if (typeof onPage === 'function') {
        onPage({ categoryItems: out.length, apiPages });
      }
      if (rawAll.length < batchSize) break;
      offset += batchSize;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      researchSellerLogError(errorLog, { seller: username, category: cat.name, error: msg });
      console.warn(`research-seller seller "${username}" category "${cat.name}" failed:`, msg);
      break;
    }
  }
  return out;
}

async function fetchResearchSellerSoldsFromEbay(
  accessToken,
  sellerRow,
  soldDays,
  minPriceGbp,
  errorLog,
  pool,
  opts = {}
) {
  const { progressKey, incrementalCache = false, listingMode = 'solds' } = opts;
  const mode = normalizeResearchSellerListingMode(listingMode);
  const reportProgress = (patch) => {
    if (!progressKey) return;
    patchResearchSellerRefreshProgress(progressKey, patch);
  };

  reportProgress({ phase: 'discovering', currentCategory: null });
  const browseUsername = pool
    ? await ensureResearchSellerBrowseUsername(accessToken, sellerRow, pool)
    : String(sellerRow.username ?? '').trim();
  if (!browseUsername) {
    return { sellerItems: [], activeCats: [], browseUsername: '' };
  }

  const sellerLookup = buildTrackedSellerLookup([sellerRow]);
  const fetchSoldDays = researchSellerEbayFetchSoldDays(soldDays);
  // Discover categories from active listings — soldDate + sellers filter is unreliable on Browse.
  const activeCats = await discoverTrackedSellerCategories(
    accessToken,
    [browseUsername],
    soldDays,
    minPriceGbp,
    true,
    errorLog,
    'listings'
  );

  reportProgress({
    phase: 'fetching',
    categoriesTotal: activeCats.length,
    categoriesDone: 0,
    currentCategory: null,
    username: browseUsername
  });

  const seen = new Set();
  const sellerItems = [];
  let totalApiPages = 0;

  for (let ci = 0; ci < activeCats.length; ci++) {
    const cat = activeCats[ci];
    if (sellerItems.length >= RESEARCH_SELLER_ABSOLUTE_MAX_PER_SELLER) break;

    reportProgress({
      currentCategory: cat.name,
      categoriesDone: ci,
      categoriesTotal: activeCats.length
    });

    const hits = await browseAllSoldSummariesForSeller(
      accessToken,
      browseUsername,
      cat,
      soldDays,
      minPriceGbp,
      errorLog,
      {
        maxItems: RESEARCH_SELLER_ABSOLUTE_MAX_PER_SELLER - sellerItems.length,
        listingMode: mode,
        onPage: ({ categoryItems }) => {
          totalApiPages += 1;
          reportProgress({
            itemsFound: sellerItems.length + categoryItems,
            apiPages: totalApiPages,
            currentCategory: cat.name,
            categoriesDone: ci,
            categoriesTotal: activeCats.length
          });
        }
      }
    );

    const newCards = [];
    for (const { summary: s, singleSellerHint } of hits) {
      const u = resolveTrackedSellerUsername(s, sellerLookup, singleSellerHint);
      if (!u) continue;
      const id = s?.itemId != null ? String(s.itemId) : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const card = mapEbayItemSummaryToSellerSoldCard(s, sellerRow.id, u, mode);
      sellerItems.push(card);
      newCards.push(card);
      if (sellerItems.length >= RESEARCH_SELLER_ABSOLUTE_MAX_PER_SELLER) break;
    }

    if (incrementalCache && pool && newCards.length > 0) {
      await appendResearchSellerItemsInDb(pool, sellerRow.id, soldDays, minPriceGbp, newCards, mode);
      reportProgress({
        itemsFound: sellerItems.length,
        itemsCached: sellerItems.length,
        categoriesDone: ci + 1,
        categoriesTotal: activeCats.length,
        currentCategory: cat.name
      });
    } else {
      reportProgress({
        itemsFound: sellerItems.length,
        categoriesDone: ci + 1,
        categoriesTotal: activeCats.length,
        currentCategory: cat.name
      });
    }
  }

  return { sellerItems, activeCats, browseUsername, fetchSoldDays };
}

async function browseSoldSummariesForSellers(
  accessToken,
  usernames,
  cat,
  soldDays,
  minPriceGbp,
  limit,
  errorLog,
  totalSellerCount = usernames.length
) {
  const perSellerLimit = Math.min(
    limit,
    researchSellerPerSellerItemCap(Math.max(totalSellerCount, usernames.length))
  );
  const base = researchSellerBrowseBaseOpts(cat, soldDays, minPriceGbp, perSellerLimit);
  const out = [];

  for (const username of usernames) {
    await researchSellerBrowseDelay();
    try {
      const data = await getBrowseSearch({
        ...base,
        accessToken,
        sellerUsernames: [username]
      });
      const raw = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
      for (const s of raw.filter(isUkItemSummary)) {
        if (!ebayListingMatchesSellerUsername(s, username)) continue;
        out.push({ summary: s, singleSellerHint: username });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      researchSellerLogError(errorLog, { seller: username, category: cat.name, error: msg });
      console.warn(`research-seller seller "${username}" category "${cat.name}" failed:`, msg);
    }
  }
  return out;
}

async function probeSingleSellerInCategory(
  accessToken,
  username,
  cat,
  soldDays,
  minPriceGbp,
  errorLog,
  listingMode = 'solds'
) {
  const mode = normalizeResearchSellerListingMode(listingMode);
  try {
    const data = await getBrowseSearch({
      ...researchSellerBrowseBaseOpts(cat, soldDays, minPriceGbp, RESEARCH_SELLER_PROBE_LIMIT, mode),
      accessToken,
      sellerUsernames: [username]
    });
    const raw = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
    return raw
      .filter(isUkItemSummary)
      .filter((s) => ebayListingMatchesSellerUsername(s, username))
      .filter((s) => researchSellerSummaryMatchesListingMode(s, mode)).length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    researchSellerLogError(errorLog, { seller: username, category: `${cat.name} (probe)`, error: msg });
    return 0;
  }
}

async function discoverTrackedSellerCategories(
  accessToken,
  usernames,
  soldDays,
  minPriceGbp,
  skipCache,
  errorLog,
  listingMode = 'solds'
) {
  const mode = normalizeResearchSellerListingMode(listingMode);
  const cacheKey = `${researchSellerCacheKey(usernames, soldDays, minPriceGbp)}:cats:${mode}`;
  if (!skipCache) {
    const cached = sellerActiveCategoriesCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SELLER_SOLD_FEED_CACHE_MS) {
      return cached.categories;
    }
  }

  const activeMap = new Map();
  for (const username of usernames) {
    await mapWithConcurrency(RESEARCH_SELLER_PROBE_CATEGORIES, RESEARCH_SELLER_DISCOVERY_CONCURRENCY, async (cat) => {
      await researchSellerBrowseDelay();
      const hitCount = await probeSingleSellerInCategory(
        accessToken,
        username,
        cat,
        soldDays,
        minPriceGbp,
        errorLog,
        mode
      );
      if (hitCount > 0) activeMap.set(cat.id, cat);
    });
  }

  let categories = [...activeMap.values()];
  if (categories.length === 0) {
    categories = [
      { id: EBAY_GB_MENS_CLOTHING_CATEGORY_ID, name: 'Men' },
      { id: '11450', name: 'Clothes, Shoes & Accessories' }
    ];
  }

  sellerActiveCategoriesCache.set(cacheKey, { at: Date.now(), categories });
  console.log(
    `research-seller: ${usernames.length} seller(s) active in ${categories.length} categories (${soldDays}d, min £${minPriceGbp})`
  );
  return categories;
}

/** Fetch eBay solds for one tracked seller and update only their Postgres cache rows. */
async function refreshSingleResearchSellerFromEbay(
  accessToken,
  sellerRow,
  allSellerRows,
  soldDays,
  minPriceGbp,
  pool,
  opts = {}
) {
  const { progressKey, incrementalCache = false, listingMode = 'solds' } = opts;
  const mode = normalizeResearchSellerListingMode(listingMode);
  const reportProgress = (patch) => {
    if (!progressKey) return;
    patchResearchSellerRefreshProgress(progressKey, patch);
  };

  const errorLog = [];
  const { sellerItems, activeCats, browseUsername, fetchSoldDays } = await fetchResearchSellerSoldsFromEbay(
    accessToken,
    sellerRow,
    soldDays,
    minPriceGbp,
    errorLog,
    pool,
    { progressKey, incrementalCache, listingMode: mode }
  );
  if (!browseUsername) {
    throw new Error('Seller username missing');
  }

  if (pool && (errorLog.length === 0 || sellerItems.length > 0)) {
    if (incrementalCache) {
      reportProgress({ phase: 'saving', itemsFound: sellerItems.length, itemsCached: sellerItems.length });
      await finalizeResearchSellerFeedFetched(
        pool,
        sellerRow.id,
        soldDays,
        minPriceGbp,
        sellerItems.length,
        mode
      );
    } else {
      reportProgress({ phase: 'saving', itemsFound: sellerItems.length });
      await replaceResearchSellerItemsInDb(pool, sellerRow.id, soldDays, minPriceGbp, sellerItems, mode);
    }
  }

  const cacheUpdatedAt = pool
    ? await readResearchSellerCacheUpdatedAt(
        pool,
        allSellerRows.map((r) => r.id),
        soldDays,
        minPriceGbp,
        mode
      )
    : null;
  const diagnostics = await buildResearchSellerCacheDiagnostics(
    pool,
    allSellerRows,
    soldDays,
    minPriceGbp,
    { cacheUpdatedAt, scheduledCache: false, errors: errorLog, listingMode: mode }
  );
  diagnostics.cacheSource = 'ebay';
  diagnostics.categoryCount = activeCats.length;
  diagnostics.categories = activeCats.map((c) => c.name);
  diagnostics.sellersFetchedFromEbay = 1;
  diagnostics.refreshedSeller = browseUsername;
  diagnostics.refreshedItemCount = sellerItems.length;

  console.log(
    `research-seller: refreshed "${browseUsername}" → ${sellerItems.length} sold item(s) (${fetchSoldDays}d window)` +
      (errorLog.length ? ` (${errorLog.length} API error(s))` : '')
  );

  return {
    sellerItems,
    diagnostics,
    errorLog,
    activeCats
  };
}

async function fetchMergedResearchSellerFeed(accessToken, sellerRows, opts, pool) {
  const { soldDays, minPriceGbp, skipCache = false, cacheOnly = false, listingMode = 'solds' } = opts;
  const mode = normalizeResearchSellerListingMode(listingMode);
  const errorLog = [];

  const usernames = sellerRows.map((r) => String(r.username ?? '').trim()).filter(Boolean);
  if (usernames.length === 0) {
    return { items: [], diagnostics: { categoryCount: 0, categories: [], errors: [] } };
  }

  if (cacheOnly && pool) {
    try {
      const diagnostics = await buildResearchSellerCacheDiagnostics(
        pool,
        sellerRows,
        soldDays,
        minPriceGbp,
        { allowStale: true, scheduledCache: true, staleCache: true, listingMode: mode }
      );
      return { items: [], diagnostics };
    } catch (dbErr) {
      const hint = researchSellerItemCacheTableHint(dbErr);
      if (hint) throw dbErr;
      console.warn('research-seller DB cache-only read failed:', dbErr.message || dbErr);
      return {
        items: [],
        diagnostics: {
          cached: true,
          cacheSource: 'database',
          categoryCount: null,
          categories: [],
          sellerCount: sellerRows.length,
          sellersFetchedFromEbay: 0,
          sellerItemCounts: {},
          soldDays,
          minPriceGbp,
          staleCache: true,
          errors: []
        }
      };
    }
  }

  let sellersToFetch = sellerRows;

  if (pool) {
    try {
      if (skipCache) {
        await invalidateResearchSellerDbFeed(
          pool,
          sellerRows.map((r) => r.id),
          soldDays,
          minPriceGbp,
          mode
        );
      } else {
        const freshness = await readResearchSellerFeedFreshness(pool, sellerRows, soldDays, minPriceGbp, mode);
        if (freshness.allFresh) {
          const counts = await researchSellerItemCountsFromDb(pool, sellerRows, soldDays, minPriceGbp, {
            listingMode: mode
          });
          const probeItems = [];
          for (const row of sellerRows) {
            if ((counts.get(row.id) ?? 0) > 0) {
              probeItems.push({ sellerId: row.id, itemId: `fresh-${row.id}` });
            }
          }
          if (probeItems.length > 0 && !researchSellerCacheIsImbalanced(probeItems, sellerRows)) {
            const diagnostics = await buildResearchSellerCacheDiagnostics(
              pool,
              sellerRows,
              soldDays,
              minPriceGbp,
              { listingMode: mode }
            );
            return { items: [], diagnostics };
          }
          if (probeItems.length > 0) {
            const plan = planResearchSellerEbayFetch(freshness, sellerRows, probeItems);
            sellersToFetch = plan.sellersToFetch;
          } else {
            await invalidateResearchSellerDbFeed(
              pool,
              sellerRows.map((r) => r.id),
              soldDays,
              minPriceGbp,
              mode
            );
            sellersToFetch = sellerRows;
          }
        } else {
          const plan = planResearchSellerEbayFetch(freshness, sellerRows, freshness.freshItems);
          sellersToFetch = plan.sellersToFetch;
        }
      }
    } catch (dbErr) {
      const hint = researchSellerItemCacheTableHint(dbErr);
      if (hint) throw dbErr;
      console.warn('research-seller DB cache read failed:', dbErr.message || dbErr);
    }
  }

  if (sellersToFetch.length === 0) {
    const diagnostics = pool
      ? await buildResearchSellerCacheDiagnostics(pool, sellerRows, soldDays, minPriceGbp, {
          listingMode: mode
        })
      : { categoryCount: 0, categories: [], errors: [] };
    return { items: [], diagnostics };
  }

  let categoriesSearched = [];
  for (const row of sellersToFetch) {
    const { sellerItems, activeCats } = await fetchResearchSellerSoldsFromEbay(
      accessToken,
      row,
      soldDays,
      minPriceGbp,
      errorLog,
      pool,
      { listingMode: mode }
    );
    if (activeCats.length > 0) {
      categoriesSearched = activeCats.map((c) => c.name);
    }
    if (pool && (errorLog.length === 0 || sellerItems.length > 0)) {
      try {
        await replaceResearchSellerItemsInDb(pool, row.id, soldDays, minPriceGbp, sellerItems, mode);
      } catch (dbErr) {
        const hint = researchSellerItemCacheTableHint(dbErr);
        if (hint) throw dbErr;
        console.warn('research-seller DB cache write failed:', dbErr.message || dbErr);
      }
    }
  }

  const diagnostics = pool
    ? await buildResearchSellerCacheDiagnostics(pool, sellerRows, soldDays, minPriceGbp, {
        errors: errorLog,
        listingMode: mode
      })
    : {
        categoryCount: categoriesSearched.length,
        categories: categoriesSearched,
        sellerCount: sellerRows.length,
        sellersFetchedFromEbay: sellersToFetch.length,
        sellerItemCounts: {},
        soldDays,
        minPriceGbp,
        errors: errorLog
      };
  if (pool) {
    diagnostics.cacheSource = 'ebay';
    diagnostics.categoryCount = categoriesSearched.length;
    diagnostics.categories = categoriesSearched;
    diagnostics.sellersFetchedFromEbay = sellersToFetch.length;
  }

  const counts = diagnostics.sellerItemCounts ?? {};
  console.log(
    `research-seller: ${sellerRows.length} seller(s) fetched ${sellersToFetch.length} from eBay` +
      ` · per seller: ${Object.entries(counts)
        .map(([name, count]) => `${name}=${count}`)
        .join(', ')}` +
      (errorLog.length ? ` (${errorLog.length} API error(s))` : '')
  );
  return { items: [], diagnostics };
}

/** Post-filter when API location metadata is present (Browse itemLocationCountry:GB is primary). */
function isUkItemSummary(s) {
  const loc = s?.itemLocation;
  const country =
    loc && typeof loc.country === 'string' ? loc.country.trim().toUpperCase() : '';
  if (country === 'GB' || country === 'UK') return true;
  const url = typeof s?.itemWebUrl === 'string' ? s.itemWebUrl : '';
  if (/ebay\.co\.uk/i.test(url)) return true;
  if (!country && !url) return true;
  return false;
}

function mapEbayItemSummaryToFeedCard(s, tagId, tagTerm) {
  const imageUrl =
    (s && s.image && typeof s.image.imageUrl === 'string' && s.image.imageUrl) ||
    (Array.isArray(s?.thumbnailImages) &&
      s.thumbnailImages[0] &&
      typeof s.thumbnailImages[0].imageUrl === 'string' &&
      s.thumbnailImages[0].imageUrl) ||
    null;
  let priceLabel = '—';
  if (s?.price && s.price.value != null && String(s.price.value).trim()) {
    const cur = (s.price.currency && String(s.price.currency)) || 'GBP';
    priceLabel = `${s.price.value} ${cur}`;
  }
  const listedAtMs = ebaySummaryListedAtMs(s);
  return {
    itemId: s?.itemId != null ? String(s.itemId) : null,
    title: typeof s?.title === 'string' ? s.title : '',
    imageUrl,
    priceLabel,
    itemWebUrl: typeof s?.itemWebUrl === 'string' ? s.itemWebUrl : null,
    tagId,
    tagTerm,
    listedAtMs
  };
}

app.get('/api/ebay/search', async (req, res) => {
  try {
    const { q, limit = '5', sort = '-price' } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
    const certId = process.env.REACT_APP_EBAY_CERT_ID;

    if (!appId || !certId) {
      return res.status(500).json({
        error: 'eBay credentials not configured',
        details: 'Please ensure REACT_APP_EBAY_APP_ID and REACT_APP_EBAY_CERT_ID are set in your environment.'
      });
    }

    try {
      const accessToken = await getAccessToken(appId, certId);
      const phraseWrap = parseEbayQueryBool(req.query.phraseWrap, false);
      const appendMens = parseEbayQueryBool(req.query.appendMens, true);
      const qAugmented = augmentEbaySearchQuery(q, { phraseWrap, appendMens });
      const data = await getBrowseSearch({
        query: qAugmented,
        accessToken,
        limit,
        sort,
        categoryIds: ebayBrowseCategoryIdsForAppendMens(appendMens),
      });
      res.json(data);
    } catch (error) {
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.get('/api/ebay/research', async (req, res) => {
  const { q } = req.query;

  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;

  if (!appId || !certId) {
    return res.status(500).json({
      error: 'eBay credentials not configured',
      details: 'Please ensure REACT_APP_EBAY_APP_ID, EBAY_APP, and REACT_APP_EBAY_CERT_ID are set.'
    });
  }

  try {
    const accessToken = await getAccessToken(appId, certId);
    const phraseWrap = parseEbayQueryBool(req.query.phraseWrap, false);
    const appendMens = parseEbayQueryBool(req.query.appendMens, true);
    const qAugmented = augmentEbaySearchQuery(q, { phraseWrap, appendMens });
    const browseCategoryIds = ebayBrowseCategoryIdsForAppendMens(appendMens);
    // Get active listings from last month
    // For research, always filter to last 30 days
    const browseData = await getBrowseSearch({ 
      query: qAugmented, 
      accessToken, 
      limit: '50',
      lastMonthOnly: true, // Always filter to last 30 days for research
      categoryIds: browseCategoryIds,
    });
    const activeCount = typeof browseData.total === 'number'
      ? browseData.total
      : Array.isArray(browseData.itemSummaries)
        ? browseData.itemSummaries.length
        : 0;

    let soldCount = 0;
    let soldEntries = null;
    let completedError = null;

    // Attempt to fetch sold listings using Browse API - if it fails, we'll still return browse data
    console.log(`[${new Date().toISOString()}] eBay Research API called for query: "${qAugmented}"`);
    try {
      console.log(`[${new Date().toISOString()}] Calling Browse API for sold items (last 30 days)...`);
      // For research, always filter to last 30 days
      const soldBrowseData = await getBrowseSearch({ 
        query: qAugmented, 
        accessToken, 
        limit: '50',
        sort: '-price',
        soldOnly: true,
        lastMonthOnly: true, // Always filter to last 30 days for research
        categoryIds: browseCategoryIds,
      });
      
      // Extract sold count from Browse API response
      soldEntries = soldBrowseData.total ?? 0;
      soldCount = soldEntries;
      
      console.log(`[${new Date().toISOString()}] Found ${soldCount} sold items via Browse API`);
      console.log(`[${new Date().toISOString()}] Response sample:`, JSON.stringify(soldBrowseData).substring(0, 500));
      
      // Check if date filter is actually working - if count is too high, filter might be ignored
      if (soldCount > 500) {
        console.warn(`[${new Date().toISOString()}] WARNING: Sold count (${soldCount}) seems high. Date filter may not be working correctly.`);
      }
    } catch (completedErr) {
      // If sold listings API fails, we still return browse data with an error message
      completedError = completedErr instanceof Error ? completedErr.message : String(completedErr);
      console.warn('Sold items query failed (browse data still available):', completedError);
      // Keep soldCount at 0, but don't fail the entire request
    }

    const sellThroughRatio = activeCount > 0 ? soldCount / activeCount : null;

    res.json({
      query: qAugmented,
      activeCount,
      soldCount,
      sellThroughRatio,
      diagnostics: {
        browseTotal: browseData.total ?? null,
        completedTotalEntries: soldEntries,
        completedError
      }
    });
  } catch (error) {
    console.error('Research endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch research data', details: error.message });
  }
});

/** eBay UK niche explorer — taxonomy cache + Browse sold/active scores per category. */
const EBAY_NICHE_SCORE_CACHE_MS = 24 * 60 * 60 * 1000;
const EBAY_TAXONOMY_DISK_CACHE_PATH = path.join(__dirname, 'cache', 'ebay-uk-top-categories-v3.json');
const ebayNicheScoreCache = new Map();

/** Business department name (lowercase) → eBay UK category id to highlight in niche grid. */
const DEPARTMENT_EBAY_HIGHLIGHT_CATEGORY = {
  menswear: '11450',
  womenswear: '11450',
  electronics: '293',
  media: '267',
  toys: '220',
  'bric-a-brac': '1',
};

async function fetchEbayTaxonomyJson(url, accessToken) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`eBay Taxonomy ${response.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

async function getEbayUkCategoryTreeId(accessToken) {
  const data = await fetchEbayTaxonomyJson(
    'https://api.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_GB',
    accessToken
  );
  const treeId = data?.categoryTreeId != null ? String(data.categoryTreeId) : '';
  if (!treeId) throw new Error('eBay taxonomy: missing categoryTreeId for EBAY_GB');
  return treeId;
}

function parseTaxonomyTopLevelCards(treePayload) {
  const root = treePayload?.rootCategoryNode;
  const children = Array.isArray(root?.childCategoryTreeNodes) ? root.childCategoryTreeNodes : [];
  return children
    .map((node) => {
      const cat = node?.category;
      const id = cat?.categoryId != null ? String(cat.categoryId) : '';
      const name = cat?.categoryName != null ? String(cat.categoryName).trim() : '';
      if (!id || !name) return null;
      const subNodes = Array.isArray(node.childCategoryTreeNodes) ? node.childCategoryTreeNodes : [];
      const subcategories = subNodes
        .map((sub) => {
          const sc = sub?.category;
          const sid = sc?.categoryId != null ? String(sc.categoryId) : '';
          const sname = sc?.categoryName != null ? String(sc.categoryName).trim() : '';
          return sid && sname ? { id: sid, name: sname } : null;
        })
        .filter(Boolean);
      return { id, name, subcategories };
    })
    .filter(Boolean);
}

async function loadEbayUkTopCategories(accessToken) {
  try {
    const raw = await fs.promises.readFile(EBAY_TAXONOMY_DISK_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.cards?.length && parsed.fetchedAt && Date.now() - parsed.fetchedAt < 7 * 24 * 60 * 60 * 1000) {
      return parsed;
    }
  } catch {
    /* refresh */
  }

  const treeId = await getEbayUkCategoryTreeId(accessToken);
  const treePayload = await fetchEbayTaxonomyJson(
    `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}`,
    accessToken
  );
  const cards = parseTaxonomyTopLevelCards(treePayload);
  const payload = {
    treeId,
    version: treePayload?.categoryTreeVersion ?? null,
    fetchedAt: Date.now(),
    cards,
  };
  try {
    await fs.promises.mkdir(path.dirname(EBAY_TAXONOMY_DISK_CACHE_PATH), { recursive: true });
    await fs.promises.writeFile(EBAY_TAXONOMY_DISK_CACHE_PATH, JSON.stringify(payload), 'utf8');
  } catch (err) {
    console.warn('[ebay-niches] taxonomy disk cache write failed:', err?.message || err);
  }
  return payload;
}

function soldCountToStars(soldCount, peerSoldCounts) {
  if (soldCount == null || !Number.isFinite(soldCount) || soldCount <= 0) return 0;
  const peers = peerSoldCounts.filter((n) => Number.isFinite(n) && n > 0);
  const max = peers.length > 0 ? Math.max(...peers) : soldCount;
  const ratio = soldCount / Math.max(max, 1);
  if (ratio >= 0.75) return 5;
  if (ratio >= 0.5) return 4;
  if (ratio >= 0.3) return 3;
  if (ratio >= 0.12) return 2;
  return 1;
}

async function loadEbayCategoryNameLookup() {
  const lookup = new Map();
  try {
    const raw = await fs.promises.readFile(EBAY_TAXONOMY_DISK_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    for (const card of parsed.cards || []) {
      if (card?.id && card?.name) lookup.set(String(card.id), String(card.name).trim());
      for (const sub of card.subcategories || []) {
        if (sub?.id && sub?.name) lookup.set(String(sub.id), String(sub.name).trim());
      }
    }
  } catch {
    /* taxonomy cache optional */
  }
  return lookup;
}

function nicheBrowseQueryForCategory(categoryName) {
  const name = typeof categoryName === 'string' ? categoryName.trim() : '';
  if (name) return name;
  return 'item';
}

async function fetchEbayCategoryNicheScore(accessToken, categoryId, days, categoryName) {
  const cacheKey = `${categoryId}:${days}:v2`;
  const cached = ebayNicheScoreCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < EBAY_NICHE_SCORE_CACHE_MS) {
    return cached.data;
  }

  const searchBase = {
    query: nicheBrowseQueryForCategory(categoryName),
    accessToken,
    limit: '1',
    categoryIds: String(categoryId),
    requireUsedCondition: false,
    ukItemsOnly: true,
  };

  const [activeData, soldData] = await Promise.all([
    getBrowseSearch({ ...searchBase, soldOnly: false, lastMonthOnly: true }),
    getBrowseSearch({
      ...searchBase,
      soldOnly: true,
      soldDateRangeDays: days,
      sort: 'newlyListed',
    }),
  ]);

  const activeCount = browseSearchTotal(activeData, `niche-active:${categoryId}`);
  const soldCount = browseSearchTotal(soldData, `niche-sold:${categoryId}`);
  const sellThroughRatio =
    activeCount != null && soldCount != null && activeCount > 0 ? soldCount / activeCount : null;

  const data = {
    categoryId: String(categoryId),
    activeCount,
    soldCount,
    sellThroughRatio,
    fetchedAt: new Date().toISOString(),
  };
  ebayNicheScoreCache.set(cacheKey, { fetchedAt: Date.now(), data });
  return data;
}

async function mapWithConcurrency(items, concurrency, mapper, shouldContinue) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      if (shouldContinue && !shouldContinue()) return;
      const i = index++;
      if (i >= items.length) break;
      results[i] = await mapper(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

app.get('/api/ebay/niches/taxonomy', async (req, res) => {
  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!appId || !certId) {
    return res.status(500).json({ error: 'eBay credentials not configured' });
  }
  try {
    const accessToken = await getAccessToken(appId, certId);
    const taxonomy = await loadEbayUkTopCategories(accessToken);
    res.json({
      treeId: taxonomy.treeId,
      version: taxonomy.version,
      fetchedAt: taxonomy.fetchedAt,
      cards: taxonomy.cards,
      departmentHighlights: DEPARTMENT_EBAY_HIGHLIGHT_CATEGORY,
    });
  } catch (err) {
    console.error('[ebay-niches] taxonomy error:', err);
    res.status(500).json({ error: 'Failed to load eBay categories', details: err.message });
  }
});

app.get('/api/ebay/niches/scores', async (req, res) => {
  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!appId || !certId) {
    return res.status(500).json({ error: 'eBay credentials not configured' });
  }

  const rawIds = req.query.categoryIds ?? req.query.category_ids;
  const idList = String(rawIds || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
  if (idList.length === 0) {
    return res.status(400).json({ error: 'categoryIds query param required (comma-separated eBay category ids)' });
  }
  if (idList.length > 40) {
    return res.status(400).json({ error: 'At most 40 category ids per request' });
  }

  const daysRaw = req.query.days != null ? Number(req.query.days) : 30;
  const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(7, Math.trunc(daysRaw))) : 30;

  try {
    const accessToken = await getAccessToken(appId, certId);
    const nameLookup = await loadEbayCategoryNameLookup();
    const scores = await mapWithConcurrency(idList, 3, async (categoryId) => {
      try {
        return await fetchEbayCategoryNicheScore(
          accessToken,
          categoryId,
          days,
          nameLookup.get(categoryId)
        );
      } catch (err) {
        return {
          categoryId,
          activeCount: null,
          soldCount: null,
          sellThroughRatio: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const soldPeers = scores.map((s) => s.soldCount).filter((n) => n != null);
    const withStars = scores.map((s) => ({
      ...s,
      stars: soldCountToStars(s.soldCount, soldPeers),
    }));

    res.json({ days, rows: withStars });
  } catch (err) {
    console.error('[ebay-niches] scores error:', err);
    res.status(500).json({ error: 'Failed to load niche scores', details: err.message });
  }
});

/**
 * Top sellers + recent sold feed for one eBay sub-category (Browse sample in that category_id).
 * GET /api/ebay/niches/category-insight?categoryId=123&name=Coats&days=30
 */
app.get('/api/ebay/niches/category-insight', async (req, res) => {
  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!appId || !certId) {
    return res.status(500).json({ error: 'eBay credentials not configured' });
  }

  const categoryId = String(req.query.categoryId ?? req.query.category_id ?? '').trim();
  if (!/^\d+$/.test(categoryId)) {
    return res.status(400).json({ error: 'categoryId query param required (eBay category id)' });
  }

  let categoryName = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  if (!categoryName) {
    const lookup = await loadEbayCategoryNameLookup();
    categoryName = lookup.get(categoryId) || '';
  }
  if (!categoryName) {
    return res.status(400).json({ error: 'name query param required when category is not in taxonomy cache' });
  }

  const daysRaw = req.query.days != null ? Number(req.query.days) : 30;
  const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(7, Math.trunc(daysRaw))) : 30;

  try {
    const accessToken = await getAccessToken(appId, certId);
    const insight = await fetchNicheCategorySellerInsight(
      accessToken,
      categoryId,
      categoryName,
      days
    );
    res.json(insight);
  } catch (err) {
    console.error('[ebay-niches] category-insight error:', err);
    res.status(500).json({ error: 'Failed to load category seller insight', details: err.message });
  }
});

/** Scouting bootsale todo — table: database/scouting_source_item.sql */
function sanitizeScoutingSourceTitle(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, 200);
}

function sanitizeScoutingSourceNotes(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  return t.slice(0, 500);
}

app.get('/api/scouting/source-items', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const result = await pool.query(
      `SELECT id, title, notes, is_completed, sort_order, created_at, updated_at
       FROM scouting_source_item
       ORDER BY is_completed ASC, sort_order ASC, created_at DESC, id DESC`
    );
    res.json({ rows: result.rows ?? [] });
  } catch (error) {
    console.error('scouting source-items list failed:', error);
    res.status(500).json({
      error: 'Failed to load scouting source items',
      details: error.message,
      hint: 'Run database/scouting_source_item.sql in your database.',
    });
  }
});

app.post('/api/scouting/source-items', async (req, res) => {
  const title = sanitizeScoutingSourceTitle(req.body?.title);
  if (!title) {
    return res.status(400).json({ error: 'title is required (non-empty, max 200 characters)' });
  }
  const notes = sanitizeScoutingSourceNotes(req.body?.notes);
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const maxSort = await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM scouting_source_item WHERE is_completed = FALSE`
    );
    const sortOrder = (maxSort.rows[0]?.max_sort ?? -1) + 1;
    const ins = await pool.query(
      `INSERT INTO scouting_source_item (title, notes, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, title, notes, is_completed, sort_order, created_at, updated_at`,
      [title, notes, sortOrder]
    );
    res.status(201).json({ row: ins.rows[0] });
  } catch (error) {
    console.error('scouting source-item insert failed:', error);
    res.status(500).json({
      error: 'Failed to add scouting source item',
      details: error.message,
      hint: 'Run database/scouting_source_item.sql in your database.',
    });
  }
});

app.patch('/api/scouting/source-items/:id', async (req, res) => {
  const id = parseInt(String(req.params.id ?? ''), 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const sets = [];
  const vals = [];
  let i = 1;

  if (body.title !== undefined) {
    const title = sanitizeScoutingSourceTitle(body.title);
    if (!title) {
      return res.status(400).json({ error: 'title cannot be empty' });
    }
    sets.push(`title = $${i++}`);
    vals.push(title);
  }
  if (body.notes !== undefined) {
    sets.push(`notes = $${i++}`);
    vals.push(sanitizeScoutingSourceNotes(body.notes));
  }
  if (body.is_completed !== undefined) {
    sets.push(`is_completed = $${i++}`);
    vals.push(Boolean(body.is_completed));
  }
  if (body.sort_order !== undefined) {
    const sortOrder = parseInt(String(body.sort_order), 10);
    if (!Number.isFinite(sortOrder)) {
      return res.status(400).json({ error: 'sort_order must be an integer' });
    }
    sets.push(`sort_order = $${i++}`);
    vals.push(sortOrder);
  }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  sets.push(`updated_at = NOW()`);
  vals.push(id);

  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const upd = await pool.query(
      `UPDATE scouting_source_item SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, title, notes, is_completed, sort_order, created_at, updated_at`,
      vals
    );
    if (!upd.rowCount) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ row: upd.rows[0] });
  } catch (error) {
    console.error('scouting source-item patch failed:', error);
    res.status(500).json({
      error: 'Failed to update scouting source item',
      details: error.message,
    });
  }
});

app.delete('/api/scouting/source-items/:id', async (req, res) => {
  const id = parseInt(String(req.params.id ?? ''), 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid item id' });
  }
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const del = await pool.query(`DELETE FROM scouting_source_item WHERE id = $1 RETURNING id`, [id]);
    if (!del.rowCount) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json({ ok: true, id: del.rows[0].id });
  } catch (error) {
    console.error('scouting source-item delete failed:', error);
    res.status(500).json({
      error: 'Failed to delete scouting source item',
      details: error.message,
    });
  }
});

/** Saved eBay feed tags — table created by scripts/add-ebay-research-feed-tag.sql (run once). */
app.get('/api/research-feed/tags', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const result = await pool.query(
      `SELECT id, term, created_at FROM ebay_research_feed_tag ORDER BY created_at ASC, id ASC`
    );
    res.json({ rows: result.rows ?? [] });
  } catch (error) {
    console.error('research-feed tags list failed:', error);
    res.status(500).json({ error: 'Failed to load feed tags', details: error.message });
  }
});

app.post('/api/research-feed/tags', async (req, res) => {
  const raw = req.body && typeof req.body.term === 'string' ? req.body.term : '';
  const term = sanitizeEbayFeedSearchTerm(raw);
  if (!term) {
    return res.status(400).json({ error: 'term is required (non-empty string, max 120 characters)' });
  }
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const dup = await pool.query(
      `SELECT id, term, created_at FROM ebay_research_feed_tag WHERE lower(trim(term)) = lower(trim($1)) LIMIT 1`,
      [term]
    );
    if (dup.rowCount) {
      return res.json({ row: dup.rows[0], created: false });
    }
    const ins = await pool.query(
      `INSERT INTO ebay_research_feed_tag (term) VALUES ($1) RETURNING id, term, created_at`,
      [term]
    );
    res.status(201).json({ row: ins.rows[0], created: true });
  } catch (error) {
    console.error('research-feed tag insert failed:', error);
    res.status(500).json({ error: 'Failed to save tag', details: error.message });
  }
});

app.delete('/api/research-feed/tags/:id', async (req, res) => {
  const id = parseInt(String(req.params.id ?? ''), 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid tag id' });
  }
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const del = await pool.query(`DELETE FROM ebay_research_feed_tag WHERE id = $1 RETURNING id`, [id]);
    if (!del.rowCount) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    res.json({ ok: true, id: del.rows[0].id });
  } catch (error) {
    console.error('research-feed tag delete failed:', error);
    res.status(500).json({ error: 'Failed to delete tag', details: error.message });
  }
});

const RESEARCH_FEED_SOLD_DAYS_DEFAULT = 180;
const RESEARCH_FEED_TAG_STATS_TTL_HOURS = 24;

function normalizeResearchFeedPriceBand(rawMin, rawMax) {
  const rawMinP = parseInt(String(rawMin ?? '50'), 10);
  const rawMaxP = parseInt(String(rawMax ?? '200'), 10);
  const minSel = Math.min(200, Math.max(20, Number.isFinite(rawMinP) ? rawMinP : 50));
  const maxSel = Math.min(200, Math.max(20, Number.isFinite(rawMaxP) ? rawMaxP : 200));
  let priceLo = Math.min(minSel, maxSel);
  let priceHi = Math.max(minSel, maxSel);
  if (priceHi <= priceLo) {
    priceHi = Math.min(priceLo + 5, 200);
  }
  if (priceHi <= priceLo) {
    priceLo = Math.max(priceHi - 5, 20);
  }
  return { priceLo, priceHi };
}

function normalizeResearchSellerMinPriceGbp(raw) {
  const rawP = parseInt(String(raw ?? '25'), 10);
  return Math.min(200, Math.max(20, Number.isFinite(rawP) ? rawP : 25));
}

function parseResearchFeedSoldDays(raw) {
  let days = parseInt(String(raw ?? String(RESEARCH_FEED_SOLD_DAYS_DEFAULT)), 10);
  if (Number.isNaN(days)) days = RESEARCH_FEED_SOLD_DAYS_DEFAULT;
  return Math.min(365, Math.max(7, days));
}

function browseSearchTotal(data, logLabel = 'search') {
  const raw = data?.total;
  const n = raw !== null && raw !== undefined && raw !== '' ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 0) {
    return Math.trunc(n);
  }
  // Never use itemSummaries.length here — stats calls use limit=1, so length is always 1 → fake 100% STR.
  console.warn(`[browseSearchTotal] missing or invalid total (${logLabel})`, {
    total: raw,
    limit: data?.limit,
    returned: Array.isArray(data?.itemSummaries) ? data.itemSummaries.length : 0
  });
  return null;
}

function mapResearchFeedTagStatsRow(row) {
  const ratio =
    row.sell_through_ratio != null && row.sell_through_ratio !== ''
      ? Number(row.sell_through_ratio)
      : null;
  return {
    tagId: row.tag_id,
    minPriceGbp: row.min_price_gbp,
    maxPriceGbp: row.max_price_gbp,
    soldDays: row.sold_days,
    activeCount: row.active_count != null ? Number(row.active_count) : null,
    soldCount: row.sold_count != null ? Number(row.sold_count) : null,
    sellThroughRatio: Number.isFinite(ratio) ? ratio : null,
    queryUsed: row.query_used != null ? String(row.query_used) : null,
    fetchError: row.fetch_error != null ? String(row.fetch_error) : null,
    fetchedAt: row.fetched_at ? new Date(row.fetched_at).toISOString() : null
  };
}

async function fetchResearchFeedTagStatsFromEbay(term, accessToken, priceLo, priceHi, soldDays) {
  const q = sanitizeEbayFeedSearchTerm(term);
  if (!q) {
    const err = new Error('Tag search term is empty');
    err.code = 'EMPTY_TERM';
    throw err;
  }
  const searchBase = {
    query: q,
    accessToken,
    limit: '50',
    requireUsedCondition: false,
    categoryIds: null,
    minPriceGbp: priceLo,
    maxPriceGbp: priceHi,
    ukItemsOnly: true
  };
  const [activeData, soldData] = await Promise.all([
    getBrowseSearch({ ...searchBase, soldOnly: false }),
    getBrowseSearch({
      ...searchBase,
      soldOnly: true,
      soldDateRangeDays: soldDays,
      sort: 'newlyListed'
    })
  ]);
  const activeCount = browseSearchTotal(activeData, `active:${q}`);
  const soldCount = browseSearchTotal(soldData, `sold:${q}`);
  if (activeCount == null || soldCount == null) {
    const err = new Error(
      'eBay did not return listing totals for this tag. Try again or narrow the search term.'
    );
    err.code = 'EBAY_TOTAL_MISSING';
    throw err;
  }
  const sellThroughRatio = activeCount > 0 ? soldCount / activeCount : null;
  return { queryUsed: q, activeCount, soldCount, sellThroughRatio };
}

async function upsertResearchFeedTagStatsCache(pool, tagId, priceLo, priceHi, soldDays, stats) {
  await pool.query(
    `INSERT INTO ebay_research_feed_tag_stats_cache (
       tag_id, min_price_gbp, max_price_gbp, sold_days,
       active_count, sold_count, sell_through_ratio, query_used, fetch_error, fetched_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (tag_id, min_price_gbp, max_price_gbp, sold_days)
     DO UPDATE SET
       active_count = EXCLUDED.active_count,
       sold_count = EXCLUDED.sold_count,
       sell_through_ratio = EXCLUDED.sell_through_ratio,
       query_used = EXCLUDED.query_used,
       fetch_error = EXCLUDED.fetch_error,
       fetched_at = NOW()`,
    [
      tagId,
      priceLo,
      priceHi,
      soldDays,
      stats.activeCount,
      stats.soldCount,
      stats.sellThroughRatio,
      stats.queryUsed,
      stats.fetchError ?? null
    ]
  );
}

function researchFeedTagStatsTableHint(error) {
  if (error.code === '42P01') {
    return {
      status: 503,
      body: {
        error: 'ebay_research_feed_tag_stats_cache table missing',
        details: 'Run database/ebay_research_feed_tag_stats_cache.sql in your database.'
      }
    };
  }
  return null;
}

async function readCachedResearchFeedTagStats(pool, tagId, priceLo, priceHi, soldDays) {
  const cached = await pool.query(
    `SELECT tag_id, min_price_gbp, max_price_gbp, sold_days,
            active_count, sold_count, sell_through_ratio, query_used, fetch_error, fetched_at
     FROM ebay_research_feed_tag_stats_cache
     WHERE tag_id = $1 AND min_price_gbp = $2 AND max_price_gbp = $3 AND sold_days = $4
       AND fetched_at >= NOW() - INTERVAL '1 hour' * $5
     LIMIT 1`,
    [tagId, priceLo, priceHi, soldDays, RESEARCH_FEED_TAG_STATS_TTL_HOURS]
  );
  if (!cached.rowCount) return null;
  return mapResearchFeedTagStatsRow(cached.rows[0]);
}

async function resolveResearchFeedTagStatsForTag(
  pool,
  tag,
  priceLo,
  priceHi,
  soldDays,
  accessToken,
  forceRefresh
) {
  const tagId = tag.id;
  const term = typeof tag.term === 'string' ? tag.term : '';

  if (!forceRefresh) {
    const cached = await readCachedResearchFeedTagStats(pool, tagId, priceLo, priceHi, soldDays);
    if (cached) {
      return {
        ...cached,
        term,
        cached: true,
        error: cached.fetchError ?? null
      };
    }
  }

  try {
    const stats = await fetchResearchFeedTagStatsFromEbay(term, accessToken, priceLo, priceHi, soldDays);
    await upsertResearchFeedTagStatsCache(pool, tagId, priceLo, priceHi, soldDays, {
      ...stats,
      fetchError: null
    });
    return {
      tagId,
      term,
      minPriceGbp: priceLo,
      maxPriceGbp: priceHi,
      soldDays,
      activeCount: stats.activeCount,
      soldCount: stats.soldCount,
      sellThroughRatio: stats.sellThroughRatio,
      queryUsed: stats.queryUsed,
      fetchError: null,
      fetchedAt: new Date().toISOString(),
      cached: false,
      error: null
    };
  } catch (ebayErr) {
    const msg = ebayErr instanceof Error ? ebayErr.message : String(ebayErr);
    await upsertResearchFeedTagStatsCache(pool, tagId, priceLo, priceHi, soldDays, {
      queryUsed: sanitizeEbayFeedSearchTerm(term),
      activeCount: null,
      soldCount: null,
      sellThroughRatio: null,
      fetchError: msg
    });
    return {
      tagId,
      term,
      minPriceGbp: priceLo,
      maxPriceGbp: priceHi,
      soldDays,
      activeCount: null,
      soldCount: null,
      sellThroughRatio: null,
      queryUsed: sanitizeEbayFeedSearchTerm(term),
      fetchError: msg,
      fetchedAt: new Date().toISOString(),
      cached: false,
      error: msg
    };
  }
}

/**
 * Clear all cached tag stats (e.g. when user refreshes the feed).
 * DELETE /api/research-feed/tag-stats/cache
 */
app.delete('/api/research-feed/tag-stats/cache', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const del = await pool.query('DELETE FROM ebay_research_feed_tag_stats_cache');
    res.json({ ok: true, deleted: del.rowCount ?? 0 });
  } catch (error) {
    const hint = researchFeedTagStatsTableHint(error);
    if (hint) return res.status(hint.status).json(hint.body);
    console.error('research-feed tag stats cache clear failed:', error);
    res.status(500).json({ error: 'Failed to clear tag stats cache', details: error.message });
  }
});

/**
 * Sell-through stats for all feed tags (24h DB cache per tag).
 * GET /api/research-feed/tag-stats?minPriceGbp=50&maxPriceGbp=200&soldDays=180&refresh=0
 */
app.get('/api/research-feed/tag-stats', async (req, res) => {
  const { priceLo, priceHi } = normalizeResearchFeedPriceBand(
    req.query.minPriceGbp,
    req.query.maxPriceGbp
  );
  const soldDays = parseResearchFeedSoldDays(req.query.soldDays);
  const forceRefresh = parseEbayQueryBool(req.query.refresh, false);

  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!appId || !certId) {
    return res.status(500).json({
      error: 'eBay credentials not configured',
      details: 'Set REACT_APP_EBAY_APP_ID and REACT_APP_EBAY_CERT_ID.'
    });
  }

  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured', rows: [] });
    }

    const tagsResult = await pool.query(
      `SELECT id, term FROM ebay_research_feed_tag ORDER BY term ASC, id ASC`
    );
    const tagRows = tagsResult.rows ?? [];
    if (tagRows.length === 0) {
      return res.json({
        rows: [],
        minPriceGbp: priceLo,
        maxPriceGbp: priceHi,
        soldDays,
        ttlHours: RESEARCH_FEED_TAG_STATS_TTL_HOURS
      });
    }

    let accessToken = null;
    const rows = [];
    for (const tag of tagRows) {
      let needsEbay = forceRefresh;
      if (!needsEbay) {
        const cached = await readCachedResearchFeedTagStats(
          pool,
          tag.id,
          priceLo,
          priceHi,
          soldDays
        );
        if (cached) {
          rows.push({
            ...cached,
            term: tag.term,
            cached: true,
            error: cached.fetchError ?? null
          });
          continue;
        }
        needsEbay = true;
      }
      if (needsEbay && !accessToken) {
        accessToken = await getAccessToken(appId, certId);
      }
      const row = await resolveResearchFeedTagStatsForTag(
        pool,
        tag,
        priceLo,
        priceHi,
        soldDays,
        accessToken,
        true
      );
      rows.push(row);
    }

    res.json({
      rows,
      minPriceGbp: priceLo,
      maxPriceGbp: priceHi,
      soldDays,
      ttlHours: RESEARCH_FEED_TAG_STATS_TTL_HOURS
    });
  } catch (error) {
    const hint = researchFeedTagStatsTableHint(error);
    if (hint) return res.status(hint.status).json(hint.body);
    console.error('research-feed tag stats (all) failed:', error);
    res.status(500).json({ error: 'Failed to load tag stats', details: error.message });
  }
});

/**
 * Active vs sold totals and sell-through for one feed tag (24h DB cache).
 * GET /api/research-feed/tags/:id/stats?minPriceGbp=50&maxPriceGbp=200&soldDays=180&refresh=0
 */
app.get('/api/research-feed/tags/:id/stats', async (req, res) => {
  const tagId = parseInt(String(req.params.id ?? ''), 10);
  if (!Number.isFinite(tagId) || tagId < 1) {
    return res.status(400).json({ error: 'Invalid tag id' });
  }

  const { priceLo, priceHi } = normalizeResearchFeedPriceBand(
    req.query.minPriceGbp,
    req.query.maxPriceGbp
  );
  const soldDays = parseResearchFeedSoldDays(req.query.soldDays);
  const forceRefresh = parseEbayQueryBool(req.query.refresh, false);

  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!appId || !certId) {
    return res.status(500).json({
      error: 'eBay credentials not configured',
      details: 'Set REACT_APP_EBAY_APP_ID and REACT_APP_EBAY_CERT_ID.'
    });
  }

  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const tagRow = await pool.query(
      `SELECT id, term FROM ebay_research_feed_tag WHERE id = $1`,
      [tagId]
    );
    if (!tagRow.rowCount) {
      return res.status(404).json({ error: 'Tag not found' });
    }

    if (!forceRefresh) {
      const cached = await readCachedResearchFeedTagStats(pool, tagId, priceLo, priceHi, soldDays);
      if (cached) {
        return res.json({
          cached: true,
          ...cached,
          ttlHours: RESEARCH_FEED_TAG_STATS_TTL_HOURS
        });
      }
    }

    const accessToken = await getAccessToken(appId, certId);
    const row = await resolveResearchFeedTagStatsForTag(
      pool,
      tagRow.rows[0],
      priceLo,
      priceHi,
      soldDays,
      accessToken,
      true
    );
    if (row.error) {
      return res.status(502).json({
        cached: false,
        error: 'eBay stats request failed',
        details: row.error,
        ...row,
        ttlHours: RESEARCH_FEED_TAG_STATS_TTL_HOURS
      });
    }

    res.json({
      cached: row.cached,
      tagId: row.tagId,
      minPriceGbp: row.minPriceGbp,
      maxPriceGbp: row.maxPriceGbp,
      soldDays: row.soldDays,
      activeCount: row.activeCount,
      soldCount: row.soldCount,
      sellThroughRatio: row.sellThroughRatio,
      queryUsed: row.queryUsed,
      fetchError: row.fetchError,
      fetchedAt: row.fetchedAt,
      ttlHours: RESEARCH_FEED_TAG_STATS_TTL_HOURS
    });
  } catch (error) {
    const hint = researchFeedTagStatsTableHint(error);
    if (hint) return res.status(hint.status).json(hint.body);
    console.error('research-feed tag stats failed:', error);
    res.status(500).json({ error: 'Failed to load tag stats', details: error.message });
  }
});

/**
 * Sold comps on eBay UK (GBP price band, UK-sited listings), newest listed first.
 * GET /api/research-feed/items?page=0&pageSize=12&minPriceGbp=50&maxPriceGbp=200
 * min/max clamped to 20–200; defaults min 50, max 200. Range is normalized so max > min.
 */
app.get('/api/research-feed/items', async (req, res) => {
  const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10) || 0);
  const pageSize = Math.min(48, Math.max(6, parseInt(String(req.query.pageSize ?? '12'), 10) || 12));
  const { priceLo, priceHi } = normalizeResearchFeedPriceBand(
    req.query.minPriceGbp,
    req.query.maxPriceGbp
  );

  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!appId || !certId) {
    return res.status(500).json({
      error: 'eBay credentials not configured',
      details: 'Set REACT_APP_EBAY_APP_ID and REACT_APP_EBAY_CERT_ID.'
    });
  }

  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured', items: [], tags: [], hasMore: false });
    }

    const tagsResult = await pool.query(
      `SELECT id, term, created_at FROM ebay_research_feed_tag ORDER BY created_at ASC, id ASC`
    );
    const tagRows = tagsResult.rows ?? [];
    if (tagRows.length === 0) {
      return res.json({ items: [], tags: [], hasMore: false, page: 0, pageSize });
    }

    const accessToken = await getAccessToken(appId, certId);
    const nTags = tagRows.length;
    const perTag = Math.min(50, Math.max(1, Math.ceil(pageSize / nTags)));
    const offsetNum = page * perTag;

    const perTagResults = await Promise.all(
      tagRows.map(async (row) => {
        const q = sanitizeEbayFeedSearchTerm(row.term);
        if (!q) {
          return { tagId: row.id, tagTerm: row.term, items: [], full: false };
        }
        try {
          const data = await getBrowseSearch({
            query: q,
            accessToken,
            limit: String(perTag),
            offset: String(offsetNum),
            sort: 'newlyListed',
            soldOnly: true,
            soldDateRangeDays: 180,
            lastMonthOnly: false,
            requireUsedCondition: false,
            categoryIds: null,
            minPriceGbp: priceLo,
            maxPriceGbp: priceHi,
            ukItemsOnly: true
          });
          const arr = (Array.isArray(data.itemSummaries) ? data.itemSummaries : []).filter(
            isUkItemSummary
          );
          const items = arr.map((s) => mapEbayItemSummaryToFeedCard(s, row.id, row.term));
          return { tagId: row.id, tagTerm: row.term, items, full: arr.length >= perTag };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`research-feed eBay fetch failed for tag "${row.term}":`, msg);
          return { tagId: row.id, tagTerm: row.term, items: [], full: false, error: msg };
        }
      })
    );

    const merged = [];
    const seen = new Set();
    for (const block of perTagResults) {
      for (const card of block.items) {
        if (!card || !card.itemId || seen.has(card.itemId)) continue;
        seen.add(card.itemId);
        merged.push(card);
      }
    }
    merged.sort((a, b) => (b.listedAtMs ?? 0) - (a.listedAtMs ?? 0));
    const interleaved = merged.slice(0, pageSize);

    const hasMore = perTagResults.some((r) => r.full) || merged.length > pageSize;

    res.json({
      items: interleaved,
      tags: tagRows.map((r) => ({ id: r.id, term: r.term, created_at: r.created_at })),
      hasMore,
      page,
      pageSize,
      errors: perTagResults.filter((r) => r.error).map((r) => ({ tagTerm: r.tagTerm, error: r.error }))
    });
  } catch (error) {
    console.error('research-feed items failed:', error);
    res.status(500).json({ error: 'Failed to load feed', details: error.message });
  }
});

function mapResearchSellerRowForApi(row) {
  const storeSlug = researchSellerStoreSlugForRow(row);
  return {
    id: row.id,
    username: row.username,
    store_slug: storeSlug,
    storeUrl: researchSellerStoreUrlForRow(row),
    created_at: row.created_at
  };
}

/** Tracked eBay sellers for Seller Solds feed — table: database/ebay_research_seller.sql */
app.get('/api/research-seller/sellers', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const result = await queryResearchSellerRows(pool);
    res.json({ rows: (result.rows ?? []).map(mapResearchSellerRowForApi) });
  } catch (error) {
    console.error('research-seller list failed:', error);
    res.status(500).json({
      error: 'Failed to load sellers',
      details: error.message,
      hint: 'Run database/ebay_research_seller.sql in your database.'
    });
  }
});

app.post('/api/research-seller/sellers', async (req, res) => {
  const rawInput = typeof req.body?.username === 'string' ? req.body.username : String(req.body?.username ?? '');
  if (!rawInput.trim()) {
    return res.status(400).json({
      error: 'Enter an eBay username, store URL (/str/…), or sold listing URL (/itm/…)'
    });
  }
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
    const certId = process.env.REACT_APP_EBAY_CERT_ID;
    let username = sanitizeEbaySellerUsername(rawInput.replace(/^@+/, '').trim());
    let storeSlug = null;
    let verifyWarning = null;
    let resolvedFrom = null;
    let resolvedNote = null;
    let resolvedStoreUrl = null;

    if (appId && certId) {
      const accessToken = await getAccessToken(appId, certId);
      const resolved = await resolveSellerUsernameForAdd(accessToken, rawInput);
      if (!resolved.ok) {
        return res.status(400).json({
          error: resolved.error || 'eBay seller not found',
          details: resolved.details,
          profileUrl: resolved.profileUrl,
          storeUrl: resolved.storeUrl
        });
      }
      username = resolved.username;
      storeSlug = resolved.storeSlug ?? null;
      resolvedFrom = resolved.resolvedFrom ?? null;
      resolvedNote = resolved.note ?? null;
      verifyWarning = resolved.warning ?? null;
      resolvedStoreUrl = resolved.storeUrl ?? null;
    } else {
      const parsed = parseEbaySellerInput(rawInput);
      if (parsed.kind === 'listing') {
        return res.status(503).json({
          error: 'Listing URLs need eBay API credentials to resolve the seller username',
          details: 'Set REACT_APP_EBAY_APP_ID and REACT_APP_EBAY_CERT_ID, or enter the plain seller username.'
        });
      }
      if (parsed.kind !== 'username' && parsed.kind !== 'shop') {
        return res.status(400).json({
          error: 'Enter an eBay username, store URL (/str/…), or sold listing URL (/itm/…)'
        });
      }
      username = sanitizeEbaySellerUsername(parsed.username);
      if (parsed.kind === 'shop') storeSlug = username;
      if (username.includes('.')) storeSlug = storeSlug || username.replace(/\./g, '');
      console.warn('research-seller: skipping username verification — eBay credentials not configured');
    }

    if (!username) {
      return res.status(400).json({
        error: 'Enter an eBay username, store URL (/str/…), or sold listing URL (/itm/…)'
      });
    }

    if (!storeSlug && username.includes('.')) {
      storeSlug = username.replace(/\./g, '');
    }

    const { row, created } = await upsertResearchSellerRow(pool, username, storeSlug);
    invalidateSellerSoldFeedCache();
    const apiRow = mapResearchSellerRowForApi(row);
    res.status(created ? 201 : 200).json({
      row: apiRow,
      created,
      resolvedFrom,
      resolvedNote,
      verifyWarning,
      storeUrl: resolvedStoreUrl || apiRow.storeUrl
    });
  } catch (error) {
    console.error('research-seller insert failed:', error);
    res.status(500).json({
      error: 'Failed to save seller',
      details: error.message,
      hint: 'Run database/ebay_research_seller.sql in your database.'
    });
  }
});

app.delete('/api/research-seller/sellers/:id', async (req, res) => {
  const id = parseInt(String(req.params.id ?? ''), 10);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid seller id' });
  }
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    const del = await pool.query(
      `DELETE FROM ebay_research_seller WHERE id = $1 RETURNING id, username`,
      [id]
    );
    if (!del.rowCount) {
      return res.status(404).json({ error: 'Seller not found' });
    }
    invalidateSellerSoldFeedCache();
    res.json({ ok: true, id: del.rows[0].id });
  } catch (error) {
    console.error('research-seller delete failed:', error);
    res.status(500).json({ error: 'Failed to remove seller', details: error.message });
  }
});

/**
 * Refresh sold listings for one tracked seller from eBay (updates only their cache rows).
 * POST /api/research-seller/sellers/:id/refresh?soldDays=7&minPriceGbp=25
 * Returns 202 immediately; poll GET …/refresh/progress for live counts.
 */
app.post('/api/research-seller/sellers/:id/refresh', async (req, res) => {
  const sellerId = parseInt(String(req.params.id ?? ''), 10);
  if (!Number.isFinite(sellerId) || sellerId <= 0) {
    return res.status(400).json({ error: 'Invalid seller id' });
  }

  const soldDays = Math.min(365, Math.max(7, parseInt(String(req.query.soldDays ?? '7'), 10) || 7));
  const minPriceGbp = normalizeResearchSellerMinPriceGbp(req.query.minPriceGbp);
  const listingMode = normalizeResearchSellerListingMode(req.query.listingMode);

  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!appId || !certId) {
    return res.status(500).json({
      error: 'eBay credentials not configured',
      details: 'Set REACT_APP_EBAY_APP_ID and REACT_APP_EBAY_CERT_ID.'
    });
  }

  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured' });
    }

    const all = await queryResearchSellerRows(pool);
    const sellerRows = all.rows ?? [];
    const sellerRow = sellerRows.find((r) => Number(r.id) === sellerId);
    if (!sellerRow) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    const progressKey = researchSellerRefreshProgressKey(
      sellerId,
      soldDays,
      minPriceGbp,
      listingMode
    );
    const existing = getResearchSellerRefreshProgress(progressKey);
    if (existing?.running) {
      return res.status(202).json({
        ok: true,
        started: false,
        alreadyRunning: true,
        sellerId,
        username: String(sellerRow.username ?? '').trim(),
        progress: researchSellerRefreshProgressPayload(progressKey)
      });
    }

    patchResearchSellerRefreshProgress(progressKey, {
      running: true,
      phase: 'starting',
      sellerId,
      username: String(sellerRow.username ?? '').trim(),
      soldDays,
      minPriceGbp,
      listingMode,
      itemsFound: 0,
      itemsCached: 0,
      apiPages: 0,
      categoriesDone: 0,
      categoriesTotal: 0,
      currentCategory: null,
      startedAt: Date.now()
    });

    res.status(202).json({
      ok: true,
      started: true,
      sellerId,
      username: String(sellerRow.username ?? '').trim(),
      progress: researchSellerRefreshProgressPayload(progressKey)
    });

    void runResearchSellerSellerRefreshJob(
      sellerRow,
      sellerRows,
      soldDays,
      minPriceGbp,
      progressKey,
      listingMode
    );
  } catch (error) {
    console.error('research-seller seller refresh failed:', error);
    const hint = researchSellerItemCacheTableHint(error);
    if (hint) {
      return res.status(hint.status).json(hint.body);
    }
    res.status(500).json({ error: 'Failed to refresh seller', details: error.message });
  }
});

/**
 * Live progress for a per-seller ↻ refresh (poll while POST job runs).
 * GET /api/research-seller/sellers/:id/refresh/progress?soldDays=14&minPriceGbp=25
 */
app.get('/api/research-seller/sellers/:id/refresh/progress', async (req, res) => {
  const sellerId = parseInt(String(req.params.id ?? ''), 10);
  if (!Number.isFinite(sellerId) || sellerId <= 0) {
    return res.status(400).json({ error: 'Invalid seller id' });
  }

  const soldDays = Math.min(365, Math.max(7, parseInt(String(req.query.soldDays ?? '7'), 10) || 7));
  const minPriceGbp = normalizeResearchSellerMinPriceGbp(req.query.minPriceGbp);
  const listingMode = normalizeResearchSellerListingMode(req.query.listingMode);
  const progressKey = researchSellerRefreshProgressKey(
    sellerId,
    soldDays,
    minPriceGbp,
    listingMode
  );
  const progress = researchSellerRefreshProgressPayload(progressKey);

  res.json({
    ok: true,
    sellerId,
    soldDays,
    minPriceGbp,
    ...progress
  });
});

/**
 * Daily cron: refresh Seller Solds Postgres cache from eBay (Cloudflare Worker at 4pm GMT).
 * POST /api/research-seller/cache-refresh
 * Auth: Bearer DB_KEEPALIVE_SECRET (same as db-keepalive).
 * Returns 202 immediately; job runs in the background on Render.
 */
app.post('/api/research-seller/cache-refresh', async (req, res) => {
  if (!verifyDbKeepaliveSecret(req, res)) return;

  if (researchSellerCronRefreshInFlight) {
    return res.status(202).json({ ok: true, started: false, alreadyRunning: true });
  }

  const minPriceGbp = normalizeResearchSellerMinPriceGbp(
    req.query.minPriceGbp ?? RESEARCH_SELLER_CRON_MIN_PRICE_GBP
  );
  const soldDaysRaw = String(req.query.soldDays ?? '').trim();
  const soldDaysList = soldDaysRaw
    ? soldDaysRaw
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 7 && n <= 365)
    : RESEARCH_SELLER_CRON_SOLD_DAYS;

  if (soldDaysList.length === 0) {
    return res.status(400).json({ ok: false, error: 'No valid soldDays values' });
  }

  researchSellerCronRefreshInFlight = true;
  res.status(202).json({
    ok: true,
    started: true,
    soldDays: soldDaysList,
    minPriceGbp
  });

  setImmediate(() => {
    runResearchSellerCacheRefreshJob(soldDaysList, minPriceGbp)
      .then((summary) => {
        console.log('research-seller cron: finished', JSON.stringify(summary));
      })
      .catch((err) => {
        console.error('research-seller cron: failed', err);
      })
      .finally(() => {
        researchSellerCronRefreshInFlight = false;
      });
  });
});

/**
 * Inspiration feed: recent solds from all tracked sellers, merged newest-first.
 * Discover categories where any tracked seller has solds, then fetch each category
 * with all seller usernames in one Browse call. Cached ~26h; refreshed daily by cron.
 * GET /api/research-seller/items?page=0&soldDays=7&minPriceGbp=25&cacheOnly=1
 */
app.get('/api/research-seller/items', async (req, res) => {
  const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10) || 0);
  const soldDays = Math.min(365, Math.max(7, parseInt(String(req.query.soldDays ?? '7'), 10) || 7));
  const minPriceGbp = normalizeResearchSellerMinPriceGbp(req.query.minPriceGbp);
  const listingMode = normalizeResearchSellerListingMode(req.query.listingMode);
  const skipCache =
    req.query.refresh === '1' ||
    req.query.refresh === 'true' ||
    req.query.nocache === '1';
  const cacheOnly =
    parseEbayQueryBool(req.query.cacheOnly, false) ||
    (!skipCache && page === 0 && !parseEbayQueryBool(req.query.live, false));
  /** Pagination must slice the cached feed — never re-run category discovery + eBay per page. */
  const readCacheOnly = cacheOnly || (page > 0 && !skipCache);

  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!readCacheOnly && (!appId || !certId)) {
    return res.status(500).json({
      error: 'eBay credentials not configured',
      details: 'Set REACT_APP_EBAY_APP_ID and REACT_APP_EBAY_CERT_ID.'
    });
  }

  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not configured', items: [], sellers: [], hasMore: false });
    }

    const all = await queryResearchSellerRows(pool);
    const sellerRows = all.rows ?? [];

    if (sellerRows.length === 0) {
      return res.json({ items: [], sellers: [], hasMore: false, page: 0, soldDays, minPriceGbp });
    }

    const feedOpts = { soldDays, minPriceGbp, skipCache, cacheOnly: readCacheOnly, listingMode };
    const accessToken = readCacheOnly ? null : await getAccessToken(appId, certId);
    const { diagnostics: fetchDiagnostics } = await fetchMergedResearchSellerFeed(
      accessToken,
      sellerRows,
      feedOpts,
      pool
    );

    const sellerIds = sellerRows.map((r) => r.id);
    const totalCached = await countResearchSellerCachedItems(pool, sellerIds, soldDays, minPriceGbp, {
      allowStale: true,
      listingMode
    });
    const pageItems = await readResearchSellerFeedPage(
      pool,
      sellerRows,
      soldDays,
      minPriceGbp,
      page,
      RESEARCH_SELLER_PAGE_SIZE,
      { allowStale: true, listingMode }
    );
    const offset = page * RESEARCH_SELLER_PAGE_SIZE;
    const hasMore = offset + pageItems.length < totalCached;
    const diagnostics =
      fetchDiagnostics ??
      (await buildResearchSellerCacheDiagnostics(pool, sellerRows, soldDays, minPriceGbp, {
        allowStale: true,
        scheduledCache: readCacheOnly,
        staleCache: readCacheOnly,
        listingMode
      }));
    const apiErrors = Array.isArray(diagnostics?.errors) ? diagnostics.errors : [];

    res.json({
      items: pageItems,
      sellers: sellerRows.map(mapResearchSellerRowForApi),
      hasMore,
      page,
      pageSize: RESEARCH_SELLER_PAGE_SIZE,
      totalCached,
      soldDays,
      minPriceGbp,
      listingMode,
      diagnostics,
      errors: apiErrors.map((error) => ({ sellerUsername: '', error: String(error) })),
      emptyHint:
        pageItems.length === 0 && apiErrors.length === 0
          ? readCacheOnly
            ? `No cached active listings. Click ↻ on a seller to fetch from eBay.`
            : `No active listings found at current filters. Try lowering min price or widening the listed-days window.`
          : null
    });
  } catch (error) {
    console.error('research-seller items failed:', error);
    const hint = researchSellerItemCacheTableHint(error);
    if (hint) {
      return res.status(hint.status).json(hint.body);
    }
    res.status(500).json({ error: 'Failed to load seller sold feed', details: error.message });
  }
});

function ebayConditionLabelFromSummary(s) {
  if (typeof s.condition === 'string' && s.condition.trim()) {
    return s.condition.trim();
  }
  const id = s.conditionId != null ? String(s.conditionId) : '';
  if (id === '1000') return 'New';
  if (id === '3000') return 'Used';
  if (id === '2000' || id === '2500') return 'Refurbished';
  if (id === '1500' || id === '1750') return 'New other';
  if (id === '4000') return 'Very good';
  if (id === '5000') return 'Good';
  if (id === '6000') return 'Acceptable';
  return null;
}

/** Map Browse API item summary to a small JSON shape for the UI. */
function normalizeEbaySoldItemSummary(s) {
  const rawId = s.itemId != null ? String(s.itemId) : '';
  const parts = rawId.split('|');
  const legacyId =
    parts.length >= 2 ? String(parts[1]).replace(/\D/g, '') : rawId.replace(/\D/g, '');
  let href = typeof s.itemWebUrl === 'string' && s.itemWebUrl.trim() ? s.itemWebUrl.trim() : null;
  if (!href && legacyId) {
    href = `https://www.ebay.co.uk/itm/${legacyId}`;
  }
  const price = s.price && typeof s.price === 'object' ? s.price : {};
  return {
    itemId: legacyId || rawId,
    title: typeof s.title === 'string' ? s.title : '',
    priceValue: price.value != null ? String(price.value) : null,
    priceCurrency: typeof price.currency === 'string' ? price.currency : 'GBP',
    imageUrl: s.image && typeof s.image.imageUrl === 'string' ? s.image.imageUrl : null,
    itemWebUrl: href,
    conditionLabel: ebayConditionLabelFromSummary(s)
  };
}

async function fetchEbaySoldItemsFromBrowse(brandName, limit, days) {
  const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
  const certId = process.env.REACT_APP_EBAY_CERT_ID;
  if (!appId || !certId) {
    const err = new Error(
      'Set REACT_APP_EBAY_APP_ID (or EBAY_APP) and REACT_APP_EBAY_CERT_ID from your eBay Developer app (Client ID + Client Secret).'
    );
    err.code = 'EBAY_CREDS_MISSING';
    throw err;
  }
  const accessToken = await getAccessToken(appId, certId);
  const qAugmented = augmentEbaySearchQuery(String(brandName).trim(), {
    phraseWrap: true,
    appendMens: true
  });
  const data = await getBrowseSearch({
    query: qAugmented,
    accessToken,
    limit: String(limit),
    sort: 'newlyListed',
    soldOnly: true,
    soldDateRangeDays: days,
    requireUsedCondition: false
  });
  const summaries = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
  const items = summaries.map(normalizeEbaySoldItemSummary);
  return {
    items,
    qAugmented,
    total: typeof data.total === 'number' ? data.total : null
  };
}

function mapEbaySoldCacheRow(row) {
  return {
    itemId: row.ebay_item_id != null ? String(row.ebay_item_id) : '',
    title: row.title != null ? String(row.title) : '',
    priceValue: row.price_value != null ? String(row.price_value) : null,
    priceCurrency: row.price_currency != null ? String(row.price_currency) : 'GBP',
    imageUrl: row.image_url != null ? String(row.image_url) : null,
    itemWebUrl: row.item_web_url != null ? String(row.item_web_url) : null,
    conditionLabel:
      row.condition_label != null && String(row.condition_label).trim()
        ? String(row.condition_label).trim()
        : null
  };
}

async function resolveBrandTagImageIdForCache(db, brandId) {
  const r = await db.query(
    `SELECT id FROM brand_tag_image
     WHERE brand_id = $1 AND image_kind = 'tag'
     ORDER BY
       CASE quality_tier
         WHEN 'good' THEN 0
         WHEN 'average' THEN 1
         ELSE 2
       END,
       sort_order ASC NULLS LAST,
       id ASC
     LIMIT 1`,
    [brandId]
  );
  const id = r.rows[0]?.id;
  return id != null ? Number(id) : null;
}

/**
 * Recent sold listings on eBay UK (Browse API — marketplace keyword search, not “your account only”).
 * GET /api/ebay/sold-recent?q=Brand+Name&limit=20&days=120
 * Auth: Application OAuth (Client ID + Client Secret from developer.ebay.com) — same as /api/ebay/search.
 */
app.get('/api/ebay/sold-recent', async (req, res) => {
  const qRaw = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!qRaw) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  let limit = parseInt(String(req.query.limit ?? '20'), 10);
  if (Number.isNaN(limit)) limit = 20;
  limit = Math.min(50, Math.max(1, limit));

  let days = parseInt(String(req.query.days ?? '120'), 10);
  if (Number.isNaN(days)) days = 120;
  days = Math.min(365, Math.max(14, days));

  try {
    const { items, qAugmented, total } = await fetchEbaySoldItemsFromBrowse(qRaw, limit, days);
    res.json({
      query: qAugmented,
      marketplaceId: 'EBAY_GB',
      categoryId: EBAY_GB_MENS_CLOTHING_CATEGORY_ID,
      total,
      days,
      limit,
      items
    });
  } catch (error) {
    if (error && error.code === 'EBAY_CREDS_MISSING') {
      return res.status(503).json({
        error: 'eBay credentials not configured',
        details: error.message
      });
    }
    console.error('eBay sold-recent error:', error);
    res.status(500).json({
      error: 'Failed to fetch sold listings from eBay',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get('/api/stock', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const result = await pool.query(
      `SELECT ${STOCK_ROW_SELECT_COLUMNS} FROM stock ORDER BY purchase_date DESC NULLS LAST, item_name ASC`
    );

    res.json({
      rows: (result.rows ?? []).map(serializeStockDateFields),
      count: result.rowCount ?? 0
    });
  } catch (error) {
    console.error('Stock query failed:', error);
    res.status(500).json({ error: 'Failed to load stock data', details: error.message });
  }
});

/** Sold stock rows only, newest sale first (for Orders → Sales tab). */
app.get('/api/stock/sold', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const result = await pool.query(
      `SELECT ${STOCK_ROW_SELECT_COLUMNS}
       FROM stock
       WHERE sale_date IS NOT NULL
       ORDER BY sale_date DESC NULLS LAST, id DESC`
    );

    res.json({
      rows: (result.rows ?? []).map(serializeStockDateFields),
      count: result.rowCount ?? 0
    });
  } catch (error) {
    console.error('Sold stock query failed:', error);
    res.status(500).json({ error: 'Failed to load sold stock data', details: error.message });
  }
});

/** Avg / min / max sale_price for sold rows matching brand + category (homepage price calculator). */
app.get('/api/stock/sold-price-stats', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const brandId = Number(req.query.brandId);
    const categoryId = Number(req.query.categoryId);
    if (!Number.isFinite(brandId) || brandId < 1 || !Number.isFinite(categoryId) || categoryId < 1) {
      return res.status(400).json({
        error: 'Query parameters brandId and categoryId (positive integers) are required'
      });
    }

    const result = await pool.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE sale_date IS NOT NULL AND sale_price IS NOT NULL
          )::int AS sold_count,
          AVG(sale_price) FILTER (
            WHERE sale_date IS NOT NULL AND sale_price IS NOT NULL
          )::numeric AS avg_price,
          MIN(sale_price) FILTER (
            WHERE sale_date IS NOT NULL AND sale_price IS NOT NULL
          )::numeric AS min_price,
          MAX(sale_price) FILTER (
            WHERE sale_date IS NOT NULL AND sale_price IS NOT NULL
          )::numeric AS max_price,
          COUNT(*) FILTER (WHERE sale_date IS NULL)::int AS unsold_count
        FROM stock
        WHERE brand_id = $1
          AND category_id = $2
      `,
      [brandId, categoryId]
    );

    const row = result.rows[0] || {};
    const soldCount = Number(row.sold_count || 0);
    const unsoldCount = Number(row.unsold_count || 0);
    const avg = row.avg_price != null ? Number(row.avg_price) : null;
    const min = row.min_price != null ? Number(row.min_price) : null;
    const max = row.max_price != null ? Number(row.max_price) : null;

    res.json({
      soldCount,
      unsoldCount,
      avgPrice:
        soldCount > 0 && avg != null && Number.isFinite(avg) ? Math.round(avg * 100) / 100 : null,
      minPrice:
        soldCount > 0 && min != null && Number.isFinite(min) ? Math.round(min * 100) / 100 : null,
      maxPrice:
        soldCount > 0 && max != null && Number.isFinite(max) ? Math.round(max * 100) / 100 : null
    });
  } catch (error) {
    console.error('Sold price stats query failed:', error);
    res.status(500).json({ error: 'Failed to load sold price stats', details: error.message });
  }
});

/** UK-style meteorological seasons; winter is Dec(refYear)–Feb(refYear+1). */
function meteorologicalCurrentSeasonFromDate(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (m >= 3 && m <= 5) return { type: 'spring', refYear: y };
  if (m >= 6 && m <= 8) return { type: 'summer', refYear: y };
  if (m >= 9 && m <= 11) return { type: 'autumn', refYear: y };
  if (m === 12) return { type: 'winter', refYear: y };
  return { type: 'winter', refYear: y - 1 };
}

function meteorologicalSeasonPrev(spec) {
  const forward = ['spring', 'summer', 'autumn', 'winter'];
  const fi = forward.indexOf(spec.type);
  if (fi <= 0) return { type: 'winter', refYear: spec.refYear - 1 };
  return { type: forward[fi - 1], refYear: spec.refYear };
}

function meteorologicalSeasonBounds(spec) {
  const pad = (n) => String(n).padStart(2, '0');
  const febLast = (yy) => new Date(yy, 2, 0).getDate();
  const y = spec.refYear;
  switch (spec.type) {
    case 'spring':
      return { start: `${y}-03-01`, end: `${y}-05-31` };
    case 'summer':
      return { start: `${y}-06-01`, end: `${y}-08-31` };
    case 'autumn':
      return { start: `${y}-09-01`, end: `${y}-11-30` };
    case 'winter':
      return {
        start: `${y}-12-01`,
        end: `${y + 1}-02-${pad(febLast(y + 1))}`,
      };
    default:
      throw new Error(`Unknown season type: ${spec.type}`);
  }
}

function meteorologicalSeasonDisplayLabel(spec) {
  const cap = spec.type.charAt(0).toUpperCase() + spec.type.slice(1);
  if (spec.type === 'winter') {
    const y2 = String(spec.refYear + 1).slice(-2);
    return `${cap} ${spec.refYear}–${y2}`;
  }
  return `${cap} ${spec.refYear}`;
}

/**
 * Four consecutive meteorological seasons: current first, then each prior season
 * (same order as columns left → right). Top categories and brands from sold lines.
 * Optional `department_id` / `departmentId`: restrict to brands in that department;
 * category rows are limited to stock categories assigned to the same department (plus uncategorized).
 */
app.get('/api/stock/seasonal-insights', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);

    const today = new Date();
    let cur = meteorologicalCurrentSeasonFromDate(today);
    const seasons = [];
    seasons.push(cur);
    for (let k = 0; k < 3; k++) {
      cur = meteorologicalSeasonPrev(cur);
      seasons.push(cur);
    }

    const columns = [];
    const currentSpec = meteorologicalCurrentSeasonFromDate(today);

    for (const spec of seasons) {
      const { start, end } = meteorologicalSeasonBounds(spec);

      const saleCountRes = await pool.query(
        `SELECT COUNT(*)::int AS c
         FROM stock s
         INNER JOIN brand b ON b.id = s.brand_id
         WHERE s.sale_date IS NOT NULL
           AND s.sale_date::date >= $1::date
           AND s.sale_date::date <= $2::date
           AND ($3::int IS NULL OR b.department_id = $3::int)`,
        [start, end, filterDeptId]
      );
      const saleCount = saleCountRes.rows[0]?.c ?? 0;

      const catRes = await pool.query(
        `SELECT COALESCE(cat.category_name, 'Uncategorized') AS name, COUNT(*)::int AS cnt
         FROM stock s
         INNER JOIN brand b ON b.id = s.brand_id
         LEFT JOIN category cat ON cat.id = s.category_id
         WHERE s.sale_date IS NOT NULL
           AND s.sale_date::date >= $1::date
           AND s.sale_date::date <= $2::date
           AND ($3::int IS NULL OR b.department_id = $3::int)
           AND ($3::int IS NULL OR s.category_id IS NULL OR cat.department_id = $3::int)
         GROUP BY COALESCE(cat.category_name, 'Uncategorized')
         ORDER BY cnt DESC NULLS LAST, name ASC
         LIMIT 5`,
        [start, end, filterDeptId]
      );

      const catWorstRes = await pool.query(
        `SELECT COALESCE(cat.category_name, 'Uncategorized') AS name, COUNT(*)::int AS cnt
         FROM stock s
         INNER JOIN brand b ON b.id = s.brand_id
         LEFT JOIN category cat ON cat.id = s.category_id
         WHERE s.sale_date IS NOT NULL
           AND s.sale_date::date >= $1::date
           AND s.sale_date::date <= $2::date
           AND ($3::int IS NULL OR b.department_id = $3::int)
           AND ($3::int IS NULL OR s.category_id IS NULL OR cat.department_id = $3::int)
         GROUP BY COALESCE(cat.category_name, 'Uncategorized')
         ORDER BY cnt ASC NULLS LAST, name ASC
         LIMIT 5`,
        [start, end, filterDeptId]
      );

      const brandRes = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(b.brand_name), ''), 'Unknown brand') AS name, COUNT(*)::int AS cnt
         FROM stock s
         INNER JOIN brand b ON b.id = s.brand_id
         WHERE s.sale_date IS NOT NULL
           AND s.sale_date::date >= $1::date
           AND s.sale_date::date <= $2::date
           AND ($3::int IS NULL OR b.department_id = $3::int)
           AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
         GROUP BY COALESCE(NULLIF(TRIM(b.brand_name), ''), 'Unknown brand')
         ORDER BY cnt DESC NULLS LAST, name ASC
         LIMIT 5`,
        [start, end, filterDeptId]
      );

      const isCurrentSeason =
        spec.type === currentSpec.type && spec.refYear === currentSpec.refYear;

      columns.push({
        seasonKey: spec.type,
        refYear: spec.refYear,
        displayLabel: meteorologicalSeasonDisplayLabel(spec),
        rangeStart: start,
        rangeEnd: end,
        isCurrentSeason,
        topCategories: (catRes.rows ?? []).map((r) => ({
          name: String(r.name ?? 'Uncategorized'),
          count: Number(r.cnt) || 0,
        })),
        worstCategories: (catWorstRes.rows ?? []).map((r) => ({
          name: String(r.name ?? 'Uncategorized'),
          count: Number(r.cnt) || 0,
        })),
        topBrands: (brandRes.rows ?? []).map((r) => ({
          name: String(r.name ?? 'Unknown brand'),
          count: Number(r.cnt) || 0,
        })),
        saleCount,
        hasSalesData: saleCount > 0,
      });
    }

    const totalSoldRes = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM stock s
       INNER JOIN brand b ON b.id = s.brand_id
       WHERE s.sale_date IS NOT NULL
         AND ($1::int IS NULL OR b.department_id = $1::int)`,
      [filterDeptId]
    );
    const totalSoldLines = totalSoldRes.rows[0]?.c ?? 0;
    const seasonsWithSalesCount = columns.filter((c) => c.hasSalesData).length;

    let emptyMessage = null;
    if (totalSoldLines === 0) {
      emptyMessage =
        filterDeptId != null
          ? 'No sold items with sale dates for this department yet — Sales by season will populate once you record sales.'
          : 'No sold items with sale dates yet — Sales by season will populate once you record sales.';
    } else if (seasonsWithSalesCount === 0) {
      emptyMessage =
        filterDeptId != null
          ? 'None of this department’s sales fall in these four meteorological seasons — keep logging sale dates to build this view.'
          : 'None of your sales fall in these four meteorological seasons — keep logging sale dates to build this view.';
    }

    res.json({
      columns,
      totalSoldLines,
      seasonsWithSalesCount,
      emptyMessage,
    });
  } catch (error) {
    console.error('seasonal-insights failed:', error);
    res.status(500).json({ error: 'Failed to load Sales by season data', details: error.message });
  }
});

/** Normalized `sourced_location` for reporting (matches app default for unknown values). */
const SOURCED_INSIGHTS_SRC_SQL = `CASE 
  WHEN TRIM(COALESCE(s.sourced_location::text, '')) IN ('charity_shop', 'bootsale', 'online_flip') 
  THEN TRIM(COALESCE(s.sourced_location::text, ''))
  ELSE 'charity_shop' 
END`;

/**
 * Per acquisition source: sold vs inventory, sell-through, aggregate sale÷cost on sold lines,
 * top categories by sales count, and 5 worst categories (lowest aggregate sale÷cost, then unsold cost).
 */
app.get('/api/stock/sourced-insights', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const aggRes = await pool.query(
      `SELECT src,
        COUNT(*) FILTER (WHERE sale_date IS NOT NULL)::int AS sold_count,
        COUNT(*) FILTER (WHERE sale_date IS NULL)::int AS inventory_count,
        COALESCE(SUM(sale_price::numeric) FILTER (WHERE sale_date IS NOT NULL AND COALESCE(purchase_price::numeric, 0) > 0), 0)::numeric AS sum_sale_sold,
        COALESCE(SUM(purchase_price::numeric) FILTER (WHERE sale_date IS NOT NULL AND COALESCE(purchase_price::numeric, 0) > 0), 0)::numeric AS sum_purchase_sold
       FROM (
         SELECT s.*, (${SOURCED_INSIGHTS_SRC_SQL}) AS src FROM stock s
       ) x
       GROUP BY src`
    );

    const aggBySrc = {};
    for (const row of aggRes.rows ?? []) {
      aggBySrc[String(row.src)] = row;
    }

    const sourceSpecs = [
      { key: 'charity_shop', label: 'Charity shop' },
      { key: 'bootsale', label: 'Boot sale' },
      { key: 'online_flip', label: 'Flipped / online' },
    ];

    const columns = [];
    for (const { key, label } of sourceSpecs) {
      const row = aggBySrc[key] ?? {
        sold_count: 0,
        inventory_count: 0,
        sum_sale_sold: 0,
        sum_purchase_sold: 0,
      };
      const soldCount = Number(row.sold_count) || 0;
      const inventoryCount = Number(row.inventory_count) || 0;
      const total = soldCount + inventoryCount;
      const sellThroughRatePct = total > 0 ? (100 * soldCount) / total : 0;
      const sumSale = Number(row.sum_sale_sold) || 0;
      const sumPurch = Number(row.sum_purchase_sold) || 0;
      const profitMultiple = sumPurch > 0 ? sumSale / sumPurch : null;

      const catRes = await pool.query(
        `SELECT COALESCE(cat.category_name, 'Uncategorized') AS name, COUNT(*)::int AS cnt
         FROM stock s
         LEFT JOIN category cat ON cat.id = s.category_id
         WHERE s.sale_date IS NOT NULL
           AND (${SOURCED_INSIGHTS_SRC_SQL}) = $1
         GROUP BY COALESCE(cat.category_name, 'Uncategorized')
         ORDER BY cnt DESC NULLS LAST, name ASC
         LIMIT 5`,
        [key]
      );

      const worstRes = await pool.query(
        `WITH cat_agg AS (
           SELECT COALESCE(cat.category_name, 'Uncategorized') AS name,
             COUNT(*) FILTER (WHERE s.sale_date IS NOT NULL)::int AS sold_count,
             COUNT(*) FILTER (WHERE s.sale_date IS NULL)::int AS inv_count,
             COALESCE(
               SUM(s.sale_price::numeric) FILTER (
                 WHERE s.sale_date IS NOT NULL AND COALESCE(s.purchase_price::numeric, 0) > 0
               ),
               0
             ) AS sum_sale_sold,
             COALESCE(
               SUM(s.purchase_price::numeric) FILTER (
                 WHERE s.sale_date IS NOT NULL AND COALESCE(s.purchase_price::numeric, 0) > 0
               ),
               0
             ) AS sum_purch_sold,
             COALESCE(
               SUM(s.purchase_price::numeric) FILTER (WHERE s.sale_date IS NULL),
               0
             ) AS sum_purch_inv
           FROM stock s
           LEFT JOIN category cat ON cat.id = s.category_id
           WHERE (${SOURCED_INSIGHTS_SRC_SQL}) = $1
           GROUP BY COALESCE(cat.category_name, 'Uncategorized')
         )
         SELECT name,
           sold_count,
           inv_count,
           CASE WHEN sum_purch_sold::numeric > 0 THEN sum_sale_sold::numeric / sum_purch_sold::numeric END AS profit_multiple
         FROM cat_agg
         ORDER BY
           CASE WHEN sum_purch_sold::numeric > 0 THEN sum_sale_sold::numeric / sum_purch_sold::numeric END ASC NULLS LAST,
           sum_purch_inv::numeric DESC NULLS LAST,
           name ASC
         LIMIT 5`,
        [key]
      );

      columns.push({
        sourceKey: key,
        displayLabel: label,
        soldCount,
        inventoryCount,
        sellThroughRatePct: Math.round(sellThroughRatePct * 10) / 10,
        profitMultiple: profitMultiple != null ? Math.round(profitMultiple * 100) / 100 : null,
        topCategories: (catRes.rows ?? []).map((r) => ({
          name: String(r.name ?? 'Uncategorized'),
          count: Number(r.cnt) || 0,
        })),
        worstCategories: (worstRes.rows ?? []).map((r) => {
          const sc = Number(r.sold_count) || 0;
          const ic = Number(r.inv_count) || 0;
          const pm =
            r.profit_multiple != null && r.profit_multiple !== ''
              ? Number(r.profit_multiple)
              : null;
          return {
            name: String(r.name ?? 'Uncategorized'),
            soldCount: sc,
            inventoryCount: ic,
            profitMultiple:
              pm != null && Number.isFinite(pm) ? Math.round(pm * 100) / 100 : null,
          };
        }),
        hasSalesData: soldCount > 0,
      });
    }

    const totalStockRes = await pool.query('SELECT COUNT(*)::int AS c FROM stock');
    const totalStockLines = totalStockRes.rows[0]?.c ?? 0;
    let emptyMessage = null;
    if (totalStockLines === 0) {
      emptyMessage =
        'No stock rows yet — sourced breakdown will appear once you add inventory.';
    }

    res.json({
      columns,
      totalStockLines,
      emptyMessage,
    });
  } catch (error) {
    console.error('sourced-insights failed:', error);
    res.status(500).json({ error: 'Failed to load sourced insights', details: error.message });
  }
});

/** Legacy item id from DB (digits, v1|…|0, or itm URL). */
function extractEbayLegacyItemId(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim();
  if (!s) return null;
  const urlMatch = s.match(/\/itm\/(\d+)/i);
  if (urlMatch) return urlMatch[1];
  if (/^v1\|\d+\|/i.test(s)) {
    const parts = s.split('|');
    return parts[1] || null;
  }
  if (/^\d+$/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function ebayBrowseRestItemIdFromLegacy(legacyId) {
  if (!legacyId) return null;
  return `v1|${legacyId}|0`;
}

/** True if Buy Browse API suggests the listing can still be purchased. */
function isBrowseItemStillBuyable(item) {
  return browseListingAvailabilityBuyable(item);
}

async function fetchBrowseItemStillBuyable(accessToken, ebayIdRaw) {
  const legacy = extractEbayLegacyItemId(ebayIdRaw);
  if (!legacy) {
    return { ok: false, buyable: null, error: 'invalid_ebay_id' };
  }
  const restId = ebayBrowseRestItemIdFromLegacy(legacy);
  const url = `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(restId)}?fieldgroups=COMPACT`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'
    }
  });
  if (response.status === 404) {
    return { ok: true, buyable: false, reason: 'not_found_or_unavailable' };
  }
  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      buyable: null,
      error: `eBay ${response.status}: ${text.slice(0, 400)}`,
      httpStatus: response.status
    };
  }
  const item = await response.json();
  return {
    ok: true,
    buyable: isBrowseItemStillBuyable(item),
    reason: null
  };
}

/**
 * POST — For sold-on-Vinted rows that still have an eBay id, call Browse getItem (COMPACT).
 * Rows where eBay still appears buyable are returned as `violations` (should end duplicate listing).
 */
app.post('/api/stock/vinted-sold-ebay-active-check', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
    const certId = process.env.REACT_APP_EBAY_CERT_ID;

    if (!appId || !certId) {
      return res.status(500).json({
        error: 'eBay credentials not configured',
        details: 'Set REACT_APP_EBAY_APP_ID and REACT_APP_EBAY_CERT_ID (same as Browse search).'
      });
    }

    const result = await pool.query(
      `SELECT id, item_name, ebay_id, vinted_id, sold_platform
       FROM stock
       WHERE sale_date IS NOT NULL
         AND ebay_id IS NOT NULL
         AND TRIM(COALESCE(ebay_id::text, '')) <> ''
         AND LOWER(TRIM(COALESCE(sold_platform::text, ''))) = 'vinted'
       ORDER BY sale_date DESC NULLS LAST, id DESC`
    );

    const rows = result.rows ?? [];
    const accessToken = await getAccessToken(appId, certId);
    const violations = [];
    const apiErrors = [];

    const delayMs = Math.min(600, Math.max(80, Number(process.env.EBAY_STOCK_CHECK_DELAY_MS) || 130));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
      try {
        const outcome = await fetchBrowseItemStillBuyable(accessToken, row.ebay_id);
        if (!outcome.ok) {
          apiErrors.push({
            stock_id: row.id,
            message: outcome.error || 'eBay request failed',
            httpStatus: outcome.httpStatus ?? null
          });
          continue;
        }
        if (outcome.buyable === true) {
          const leg = extractEbayLegacyItemId(row.ebay_id);
          const ebayUrl =
            leg != null
              ? `https://www.ebay.co.uk/itm/${leg}`
              : /^https?:\/\//i.test(String(row.ebay_id))
                ? String(row.ebay_id).trim()
                : `https://www.ebay.co.uk/itm/${String(row.ebay_id).replace(/\D/g, '')}`;
          violations.push({
            id: row.id,
            item_name: row.item_name,
            ebay_id: leg ?? String(row.ebay_id).trim(),
            ebay_url: ebayUrl,
            vinted_id: row.vinted_id ?? null
          });
        }
      } catch (e) {
        apiErrors.push({
          stock_id: row.id,
          message: e instanceof Error ? e.message : String(e)
        });
      }
    }

    res.json({
      checked: rows.length,
      violations,
      apiErrors
    });
  } catch (error) {
    console.error('vinted-sold-ebay-active-check failed:', error);
    res.status(500).json({
      error: 'Check failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Paginate Sell Fulfillment getOrders — seller's eBay orders (needs User access token, not client credentials).
 */
async function fetchEbayFulfillmentLineLegacyItems(userAccessToken, windowDays = 90) {
  const days = Math.min(730, Math.max(7, Number(windowDays) || 90));
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const filter = `creationdate:[${start.toISOString()}..${end.toISOString()}]`;
  const base = 'https://api.ebay.com/sell/fulfillment/v1/order';
  const aggregated = [];
  let offset = 0;
  const limit = 50;
  const delayMs = Math.min(500, Math.max(80, Number(process.env.EBAY_FULFILLMENT_PAGE_DELAY_MS) || 130));

  for (;;) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      filter
    });
    const url = `${base}?${params.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'
      }
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Fulfillment getOrders ${res.status}: ${text.slice(0, 700)}`);
      err.httpStatus = res.status;
      throw err;
    }
    const data = await res.json();
    const orders = Array.isArray(data.orders) ? data.orders : [];
    for (const order of orders) {
      const orderId = order.orderId;
      for (const li of order.lineItems || []) {
        const rawLeg = li.legacyItemId;
        if (rawLeg == null || String(rawLeg).trim() === '') continue;
        aggregated.push({
          orderId,
          legacyItemId: String(rawLeg).trim(),
          title: li.title != null ? String(li.title) : null
        });
      }
    }
    if (orders.length < limit) break;
    offset += limit;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return aggregated;
}

/**
 * POST — Compare eBay Fulfillment line items (sold on your account) to stock.ebay_id.
 * The app `orders` table is only the to-pack queue; matching is against Stock listing IDs.
 */
app.post('/api/stock/ebay-sold-missing-stock-match', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    let userToken;
    try {
      userToken = await ebaySellerOAuth.getFulfillmentUserAccessToken(pool);
    } catch (tokErr) {
      if (tokErr.code === 'EBAY_USER_TOKEN_MISSING') {
        return res.status(503).json({
          error: 'eBay seller not connected',
          code: 'EBAY_USER_TOKEN_MISSING',
          details: tokErr.message
        });
      }
      throw tokErr;
    }

    const days = Math.min(
      730,
      Math.max(7, Number(req.body?.days) || Number(req.query?.days) || 90)
    );

    const lineRows = await fetchEbayFulfillmentLineLegacyItems(userToken, days);

    const stockResult = await pool.query(
      `SELECT ebay_id FROM stock WHERE ebay_id IS NOT NULL AND TRIM(COALESCE(ebay_id::text, '')) <> ''`
    );
    const stockLegacy = new Set();
    for (const row of stockResult.rows || []) {
      const leg = extractEbayLegacyItemId(row.ebay_id);
      if (leg) stockLegacy.add(leg);
    }

    const byLegacy = new Map();
    for (const row of lineRows) {
      if (!byLegacy.has(row.legacyItemId)) {
        byLegacy.set(row.legacyItemId, { title: row.title, orderIds: [] });
      }
      const m = byLegacy.get(row.legacyItemId);
      if (row.orderId && !m.orderIds.includes(row.orderId)) m.orderIds.push(row.orderId);
      if (!m.title && row.title) m.title = row.title;
    }

    const missing = [];
    for (const [legacyItemId, meta] of byLegacy) {
      if (!stockLegacy.has(legacyItemId)) {
        missing.push({
          legacy_item_id: legacyItemId,
          item_title: meta.title,
          order_ids: meta.orderIds,
          ebay_url: `https://www.ebay.co.uk/itm/${legacyItemId}`
        });
      }
    }

    res.json({
      window_days: days,
      ebay_line_items_seen: lineRows.length,
      ebay_distinct_listings: byLegacy.size,
      stock_ebay_ids_count: stockLegacy.size,
      missing
    });
  } catch (error) {
    console.error('ebay-sold-missing-stock-match failed:', error);
    res.status(500).json({
      error: 'eBay fulfillment check failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/** @returns {Promise<number|null>} */
async function normalizeBrandTagImageIdForStock(pool, raw, brandId) {
  if (raw === null || raw === undefined || raw === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    const err = new Error('brand_tag_image_id must be a positive integer');
    err.status = 400;
    throw err;
  }
  if (brandId === null || brandId === undefined || !Number.isFinite(Number(brandId))) {
    const err = new Error('Cannot set tag image without a brand');
    err.status = 400;
    throw err;
  }
  const r = await pool.query(
    'SELECT 1 FROM brand_tag_image WHERE id = $1 AND brand_id = $2',
    [id, Number(brandId)]
  );
  if (!r.rowCount) {
    const err = new Error('Tag image not found for this brand');
    err.status = 400;
    throw err;
  }
  return id;
}

/** @returns {Promise<number|null>} */
async function normalizeCategorySizeIdForStock(pool, raw, categoryId) {
  if (raw === null || raw === undefined || raw === '') return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    const err = new Error('category_size_id must be a positive integer');
    err.status = 400;
    throw err;
  }
  if (categoryId === null || categoryId === undefined || !Number.isFinite(Number(categoryId))) {
    const err = new Error('Cannot set size without a category');
    err.status = 400;
    throw err;
  }
  const r = await pool.query(
    'SELECT 1 FROM category_size WHERE id = $1 AND category_id = $2',
    [id, Number(categoryId)]
  );
  if (!r.rowCount) {
    const err = new Error('Size option not found for this category');
    err.status = 400;
    throw err;
  }
  return id;
}

const SOURCED_LOCATION_VALUES = ['charity_shop', 'bootsale', 'online_flip'];

/** @returns {string} */
function normalizeSourcedLocation(raw) {
  if (raw === null || raw === undefined || raw === '') return 'charity_shop';
  const s = String(raw).trim();
  if (SOURCED_LOCATION_VALUES.includes(s)) return s;
  const err = new Error('sourced_location must be charity_shop, bootsale, or online_flip');
  err.status = 400;
  throw err;
}

const STOCK_COPY_COLUMNS = [
  'item_name',
  'category_id',
  'purchase_price',
  'purchase_date',
  'sale_date',
  'sale_price',
  'sold_platform',
  'net_profit',
  'vinted_id',
  'ebay_id',
  'depop_id',
  'brand_id',
  'brand_tag_image_id',
  'projected_sale_price',
  'category_size_id',
  'sourced_location',
  'is_inventory_write_off',
  'is_bulky_item',
  'is_ebay_draft',
];

async function queryNextStockId(pool) {
  const result = await pool.query(
    'SELECT COALESCE(MAX(id), 0)::int + 1 AS next_id FROM stock'
  );
  return Number(result.rows[0]?.next_id ?? 1);
}

/**
 * Move a stock row to a new primary key (sticker SKU): insert at new_id, re-link orders, delete old row.
 * Runs in a transaction — never overwrites an existing id.
 */
async function migrateStockPrimaryKey(pool, oldId, newId) {
  if (!Number.isInteger(oldId) || oldId < 1 || !Number.isInteger(newId) || newId < 1) {
    const err = new Error('Stock id must be a positive integer');
    err.status = 400;
    throw err;
  }
  if (oldId === newId) {
    const err = new Error('New SKU must be different from the current SKU');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const oldLock = await client.query('SELECT id FROM stock WHERE id = $1 FOR UPDATE', [oldId]);
    if (!oldLock.rowCount) {
      await client.query('ROLLBACK');
      const err = new Error('Stock record not found');
      err.status = 404;
      throw err;
    }

    const targetCheck = await client.query('SELECT id FROM stock WHERE id = $1', [newId]);
    if (targetCheck.rowCount > 0) {
      await client.query('ROLLBACK');
      const err = new Error(`SKU ${newId} is already in use`);
      err.status = 409;
      err.code = 'STOCK_ID_CONFLICT';
      err.old_id = oldId;
      err.new_id = newId;
      throw err;
    }

    const copyCols = STOCK_COPY_COLUMNS.join(', ');
    await client.query(
      `INSERT INTO stock (id, ${copyCols})
       SELECT $1, ${copyCols}
       FROM stock
       WHERE id = $2`,
      [newId, oldId]
    );

    try {
      await client.query('UPDATE orders SET stock_id = $1 WHERE stock_id = $2', [newId, oldId]);
    } catch (ordersErr) {
      if (ordersErr.code !== '42P01') {
        throw ordersErr;
      }
    }

    const del = await client.query('DELETE FROM stock WHERE id = $1 RETURNING id', [oldId]);
    if (!del.rowCount) {
      await client.query('ROLLBACK');
      const err = new Error('Failed to remove old stock row after creating the new SKU');
      err.status = 500;
      throw err;
    }

    await client.query(
      `SELECT setval(
         pg_get_serial_sequence('public.stock', 'id'),
         (SELECT COALESCE(MAX(id), 1) FROM public.stock),
         true
       )`
    );

    const newRow = await client.query(
      `SELECT ${STOCK_ROW_SELECT_COLUMNS} FROM stock WHERE id = $1`,
      [newId]
    );

    await client.query('COMMIT');
    return newRow.rows[0];
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.warn('migrateStockPrimaryKey rollback:', rollbackErr.message);
    }

    const dupCheck = await pool.query('SELECT id FROM stock WHERE id = ANY($1::int[])', [
      [oldId, newId],
    ]);
    if (dupCheck.rowCount >= 2) {
      const err = new Error(
        'Stock SKU change did not complete cleanly — both the old and new SKU IDs still exist. Remove the duplicate row manually or try again.'
      );
      err.status = 409;
      err.code = 'STOCK_ID_DUPLICATE_ROWS';
      err.old_id = oldId;
      err.new_id = newId;
      err.conflicting_ids = dupCheck.rows.map((r) => Number(r.id)).sort((a, b) => a - b);
      throw err;
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Next unused stock primary key (MAX(id) + 1). */
app.get('/api/stock/next-id', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    const nextId = await queryNextStockId(pool);
    res.json({ next_id: nextId });
  } catch (error) {
    console.error('stock next-id failed:', error);
    res.status(500).json({ error: 'Failed to compute next stock id', details: error.message });
  }
});

/**
 * POST /api/stock/:id/change-id — body: { new_id: number }
 * Copies row to new_id, updates orders.stock_id, deletes old row (transaction).
 */
app.post('/api/stock/:id/change-id', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const oldId = Number(req.params.id);
    if (!Number.isInteger(oldId) || oldId < 1) {
      return res.status(400).json({ error: 'Invalid stock id' });
    }

    const rawNew = req.body?.new_id ?? req.body?.newId;
    const newId = Number(rawNew);
    if (!Number.isInteger(newId) || newId < 1) {
      return res.status(400).json({ error: 'new_id must be a positive integer' });
    }

    const row = await migrateStockPrimaryKey(pool, oldId, newId);
    res.json({
      row,
      old_id: oldId,
      new_id: newId,
      message: `Stock SKU changed from ${oldId} to ${newId}`,
    });
  } catch (error) {
    console.error('stock change-id failed:', error);
    const status = error.status && Number.isInteger(error.status) ? error.status : 500;
    const body = {
      error: error.message || 'Failed to change stock SKU',
      details: error.detail || error.details || undefined,
      code: error.code || undefined,
      old_id: error.old_id ?? Number(req.params.id),
      new_id: error.new_id ?? undefined,
      conflicting_ids: error.conflicting_ids ?? undefined,
    };
    if (error.code === 'STOCK_ID_CONFLICT') {
      body.error = `SKU ${body.new_id} is already assigned to another item`;
    }
    res.status(status).json(body);
  }
});

app.post('/api/stock', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const {
      item_name,
      category_id,
      purchase_price,
      purchase_date,
      sale_date,
      sale_price,
      sold_platform,
      vinted_id,
      ebay_id,
      depop_id,
      brand_id,
      brand_tag_image_id,
      projected_sale_price,
      category_size_id,
      sourced_location,
      is_inventory_write_off,
      is_bulky_item,
      is_ebay_draft
    } = req.body ?? {};

    const normalizedItemName = normalizeTextInput(item_name) ?? null;
    const normalizedCategoryId = category_id === null || category_id === undefined || category_id === '' ? null : Number(category_id);
    const normalizedSoldPlatform = normalizeTextInput(sold_platform) ?? null;
    const normalizedPurchasePrice = normalizeDecimalInput(purchase_price, 'purchase_price');
    const normalizedSalePrice = normalizeDecimalInput(sale_price, 'sale_price');
    const normalizedPurchaseDate = normalizeDateInputValue(purchase_date, 'purchase_date');
    const normalizedSaleDate = normalizeDateInputValue(sale_date, 'sale_date');
    if (!normalizedPurchaseDate) {
      return res
        .status(400)
        .json({ error: 'Failed to create stock record', details: 'purchase_date is required' });
    }
    const computedNetProfit =
      normalizedSalePrice !== null && normalizedPurchasePrice !== null
        ? normalizedSalePrice - normalizedPurchasePrice
        : null;
    
    // Normalize ID fields: convert to string or null
    const normalizedVintedId = vinted_id === null || vinted_id === undefined || vinted_id === '' ? null : String(vinted_id).trim();
    const normalizedEbayId = ebay_id === null || ebay_id === undefined || ebay_id === '' ? null : String(ebay_id).trim();
    const normalizedDepopId = depop_id === null || depop_id === undefined || depop_id === '' ? null : String(depop_id).trim();
    const normalizedBrandId = brand_id === null || brand_id === undefined || brand_id === '' ? null : Number(brand_id);
    const normalizedProjectedSalePrice = normalizeDecimalInput(projected_sale_price, 'projected_sale_price');

    let normalizedBrandTagImageId = null;
    try {
      normalizedBrandTagImageId = await normalizeBrandTagImageIdForStock(
        pool,
        brand_tag_image_id,
        normalizedBrandId
      );
    } catch (e) {
      if (e.status === 400) {
        return res.status(400).json({ error: 'Invalid tag image', details: e.message });
      }
      throw e;
    }
    if (normalizedBrandId === null) {
      normalizedBrandTagImageId = null;
    }

    let normalizedCategorySizeId = null;
    if (normalizedCategoryId !== null) {
      try {
        normalizedCategorySizeId = await normalizeCategorySizeIdForStock(
          pool,
          category_size_id,
          normalizedCategoryId
        );
      } catch (e) {
        if (e.status === 400) {
          return res.status(400).json({ error: 'Invalid size', details: e.message });
        }
        throw e;
      }
    }

    let normalizedSourcedLocation = 'charity_shop';
    try {
      normalizedSourcedLocation = normalizeSourcedLocation(sourced_location);
    } catch (e) {
      if (e.status === 400) {
        return res.status(400).json({ error: 'Invalid sourced location', details: e.message });
      }
      throw e;
    }

    const normalizedInventoryWriteOff =
      is_inventory_write_off === true ||
      is_inventory_write_off === 'true' ||
      is_inventory_write_off === 1 ||
      is_inventory_write_off === '1';

    const normalizedBulkyItem =
      is_bulky_item === true ||
      is_bulky_item === 'true' ||
      is_bulky_item === 1 ||
      is_bulky_item === '1';

    const normalizedEbayDraft =
      is_ebay_draft === true ||
      is_ebay_draft === 'true' ||
      is_ebay_draft === 1 ||
      is_ebay_draft === '1';

    const insertQuery = `
      INSERT INTO stock (
        item_name,
        category_id,
        purchase_price,
        purchase_date,
        sale_date,
        sale_price,
        sold_platform,
        net_profit,
        vinted_id,
        ebay_id,
        depop_id,
        brand_id,
        brand_tag_image_id,
        projected_sale_price,
        category_size_id,
        sourced_location,
        is_inventory_write_off,
        is_bulky_item,
        is_ebay_draft
      )
      VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING ${STOCK_ROW_RETURNING_COLUMNS}
    `;

    const result = await pool.query(insertQuery, [
      normalizedItemName,
      normalizedCategoryId,
      normalizedPurchasePrice,
      normalizedPurchaseDate,
      normalizedSaleDate,
      normalizedSalePrice,
      normalizedSoldPlatform,
      computedNetProfit,
      normalizedVintedId,
      normalizedEbayId,
      normalizedDepopId,
      normalizedBrandId,
      normalizedBrandTagImageId,
      normalizedProjectedSalePrice,
      normalizedCategorySizeId,
      normalizedSourcedLocation,
      normalizedInventoryWriteOff,
      normalizedBulkyItem,
      normalizedEbayDraft
    ]);

    res.status(201).json({ row: serializeStockDateFields(result.rows[0]) });
  } catch (error) {
    console.error('Stock insert failed:', error);
    if (error.status === 400) {
      return res.status(400).json({ error: 'Failed to create stock record', details: error.message });
    }
    res.status(500).json({ error: 'Failed to create stock record', details: error.message });
  }
});

app.put('/api/stock/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const stockId = Number(req.params.id);
    if (!Number.isInteger(stockId)) {
      return res.status(400).json({ error: 'Invalid stock id' });
    }

    console.log('PUT /api/stock/:id - Request body:', JSON.stringify(req.body, null, 2));

    const existingResult = await pool.query(
      'SELECT id, item_name, purchase_price, purchase_date, sale_date, sale_price, sold_platform, vinted_id, ebay_id, depop_id, brand_id, category_id, brand_tag_image_id, projected_sale_price, category_size_id, sourced_location, is_inventory_write_off, is_bulky_item, is_ebay_draft FROM stock WHERE id = $1',
      [stockId]
    );

    if (existingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Stock record not found' });
    }

    const existing = existingResult.rows[0];

    const hasProp = (prop) => Object.prototype.hasOwnProperty.call(req.body ?? {}, prop);

    const finalItemName = hasProp('item_name')
      ? normalizeTextInput(req.body.item_name) ?? null
      : existing.item_name ?? null;

    const existingCategoryId = existing.category_id !== null && existing.category_id !== undefined
      ? Number(existing.category_id)
      : null;

    const finalCategoryId = hasProp('category_id')
      ? (req.body.category_id === null || req.body.category_id === undefined || req.body.category_id === '' ? null : Number(req.body.category_id))
      : existingCategoryId;

    const existingPurchasePrice =
      existing.purchase_price !== null && existing.purchase_price !== undefined
        ? Number(existing.purchase_price)
        : null;
    const existingSalePrice =
      existing.sale_price !== null && existing.sale_price !== undefined
        ? Number(existing.sale_price)
        : null;

    const finalPurchasePrice = hasProp('purchase_price')
      ? normalizeDecimalInput(req.body.purchase_price, 'purchase_price')
      : existingPurchasePrice;

    const finalSalePrice = hasProp('sale_price')
      ? normalizeDecimalInput(req.body.sale_price, 'sale_price')
      : existingSalePrice;

    const finalPurchaseDate = hasProp('purchase_date')
      ? normalizeDateInputValue(req.body.purchase_date, 'purchase_date')
      : ensureIsoDateString(existing.purchase_date);
    if (!finalPurchaseDate) {
      return res
        .status(400)
        .json({ error: 'Failed to update stock record', details: 'purchase_date is required' });
    }

    const finalSaleDate = hasProp('sale_date')
      ? normalizeDateInputValue(req.body.sale_date, 'sale_date')
      : ensureIsoDateString(existing.sale_date);

    const finalSoldPlatform = hasProp('sold_platform')
      ? normalizeTextInput(req.body.sold_platform) ?? null
      : existing.sold_platform ?? null;

    const existingVintedId = existing.vinted_id ?? null;
    const existingEbayId = existing.ebay_id ?? null;
    const existingDepopId = existing.depop_id ?? null;

    const finalVintedId = hasProp('vinted_id')
      ? (req.body.vinted_id === null || req.body.vinted_id === undefined || req.body.vinted_id === '' ? null : String(req.body.vinted_id).trim())
      : existingVintedId;

    const finalEbayId = hasProp('ebay_id')
      ? (req.body.ebay_id === null || req.body.ebay_id === undefined || req.body.ebay_id === '' ? null : String(req.body.ebay_id).trim())
      : existingEbayId;

    const finalDepopId = hasProp('depop_id')
      ? (req.body.depop_id === null || req.body.depop_id === undefined || req.body.depop_id === '' ? null : String(req.body.depop_id).trim())
      : existingDepopId;

    const existingBrandId = existing.brand_id !== null && existing.brand_id !== undefined
      ? Number(existing.brand_id)
      : null;

    const finalBrandId = hasProp('brand_id')
      ? (req.body.brand_id === null || req.body.brand_id === undefined || req.body.brand_id === '' ? null : Number(req.body.brand_id))
      : existingBrandId;

    const existingProjectedSalePrice =
      existing.projected_sale_price !== null && existing.projected_sale_price !== undefined
        ? Number(existing.projected_sale_price)
        : null;

    const finalProjectedSalePrice = hasProp('projected_sale_price')
      ? normalizeDecimalInput(req.body.projected_sale_price, 'projected_sale_price')
      : existingProjectedSalePrice;

    const existingBrandTagImageId =
      existing.brand_tag_image_id !== null && existing.brand_tag_image_id !== undefined
        ? Number(existing.brand_tag_image_id)
        : null;

    let finalBrandTagImageId = null;
    if (finalBrandId === null) {
      finalBrandTagImageId = null;
    } else if (hasProp('brand_tag_image_id')) {
      try {
        finalBrandTagImageId = await normalizeBrandTagImageIdForStock(
          pool,
          req.body.brand_tag_image_id,
          finalBrandId
        );
      } catch (e) {
        if (e.status === 400) {
          return res.status(400).json({ error: 'Invalid tag image', details: e.message });
        }
        throw e;
      }
    } else if (
      existingBrandTagImageId !== null &&
      Number.isInteger(existingBrandTagImageId) &&
      existingBrandTagImageId >= 1
    ) {
      const ok = await pool.query(
        'SELECT 1 FROM brand_tag_image WHERE id = $1 AND brand_id = $2',
        [existingBrandTagImageId, finalBrandId]
      );
      finalBrandTagImageId = ok.rowCount ? existingBrandTagImageId : null;
    }

    const existingCategorySizeId =
      existing.category_size_id !== null && existing.category_size_id !== undefined
        ? Number(existing.category_size_id)
        : null;

    let finalCategorySizeId = null;
    if (finalCategoryId === null) {
      finalCategorySizeId = null;
    } else if (hasProp('category_size_id')) {
      try {
        finalCategorySizeId = await normalizeCategorySizeIdForStock(
          pool,
          req.body.category_size_id,
          finalCategoryId
        );
      } catch (e) {
        if (e.status === 400) {
          return res.status(400).json({ error: 'Invalid size', details: e.message });
        }
        throw e;
      }
    } else if (
      existingCategorySizeId !== null &&
      Number.isInteger(existingCategorySizeId) &&
      existingCategorySizeId >= 1
    ) {
      const ok = await pool.query(
        'SELECT 1 FROM category_size WHERE id = $1 AND category_id = $2',
        [existingCategorySizeId, finalCategoryId]
      );
      finalCategorySizeId = ok.rowCount ? existingCategorySizeId : null;
    }

    const existingSourcedLocation =
      existing.sourced_location != null && String(existing.sourced_location).trim() !== ''
        ? String(existing.sourced_location).trim()
        : 'charity_shop';
    let finalSourcedLocation = existingSourcedLocation;
    if (hasProp('sourced_location')) {
      try {
        finalSourcedLocation = normalizeSourcedLocation(req.body.sourced_location);
      } catch (e) {
        if (e.status === 400) {
          return res.status(400).json({ error: 'Invalid sourced location', details: e.message });
        }
        throw e;
      }
    }

    const existingInventoryWriteOff = Boolean(existing.is_inventory_write_off);
    const finalInventoryWriteOff = hasProp('is_inventory_write_off')
      ? Boolean(
          req.body.is_inventory_write_off === true ||
            req.body.is_inventory_write_off === 'true' ||
            req.body.is_inventory_write_off === 1 ||
            req.body.is_inventory_write_off === '1'
        )
      : existingInventoryWriteOff;

    const existingBulkyItem = Boolean(existing.is_bulky_item);
    const finalBulkyItem = hasProp('is_bulky_item')
      ? Boolean(
          req.body.is_bulky_item === true ||
            req.body.is_bulky_item === 'true' ||
            req.body.is_bulky_item === 1 ||
            req.body.is_bulky_item === '1'
        )
      : existingBulkyItem;

    const existingEbayDraft = Boolean(existing.is_ebay_draft);
    const finalEbayDraft = hasProp('is_ebay_draft')
      ? Boolean(
          req.body.is_ebay_draft === true ||
            req.body.is_ebay_draft === 'true' ||
            req.body.is_ebay_draft === 1 ||
            req.body.is_ebay_draft === '1'
        )
      : existingEbayDraft;

    const computedNetProfit =
      finalSalePrice !== null && finalPurchasePrice !== null
        ? finalSalePrice - finalPurchasePrice
        : null;

    console.log('PUT /api/stock/:id - Final values:', {
      vinted_id: finalVintedId,
      ebay_id: finalEbayId,
      depop_id: finalDepopId,
      brand_id: finalBrandId,
      hasProp_brand_id: hasProp('brand_id'),
      req_body_brand_id: req.body.brand_id,
      existing_brand_id: existing.brand_id
    });

    const updateResult = await pool.query(
      `
        UPDATE stock
        SET
          item_name = $1,
          category_id = $2,
          purchase_price = $3,
          purchase_date = $4::date,
          sale_date = $5::date,
          sale_price = $6,
          sold_platform = $7,
          net_profit = $8,
          vinted_id = $9,
          ebay_id = $10,
          depop_id = $11,
          brand_id = $12,
          brand_tag_image_id = $13,
          projected_sale_price = $14,
          category_size_id = $15,
          sourced_location = $16,
          is_inventory_write_off = $17,
          is_bulky_item = $18,
          is_ebay_draft = $19
        WHERE id = $20
        RETURNING ${STOCK_ROW_RETURNING_COLUMNS}
      `,
      [
        finalItemName,
        finalCategoryId,
        finalPurchasePrice,
        finalPurchaseDate,
        finalSaleDate,
        finalSalePrice,
        finalSoldPlatform,
        computedNetProfit,
        finalVintedId,
        finalEbayId,
        finalDepopId,
        finalBrandId,
        finalBrandTagImageId,
        finalProjectedSalePrice,
        finalCategorySizeId,
        finalSourcedLocation,
        finalInventoryWriteOff,
        finalBulkyItem,
        finalEbayDraft,
        stockId
      ]
    );

    console.log('PUT /api/stock/:id - Update successful, returned row:', updateResult.rows[0]);
    res.json({ row: serializeStockDateFields(updateResult.rows[0]) });
  } catch (error) {
    console.error('Stock update failed:', error);
    console.error('Stock update error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint
    });
    if (error.status === 400) {
      return res.status(400).json({ error: 'Failed to update stock record', details: error.message });
    }
    res.status(500).json({ error: 'Failed to update stock record', details: error.message });
  }
});

app.delete('/api/stock/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const stockId = Number(req.params.id);
    if (!Number.isInteger(stockId)) {
      return res.status(400).json({ error: 'Invalid stock id' });
    }

    const existingResult = await pool.query(
      'SELECT id FROM stock WHERE id = $1',
      [stockId]
    );

    if (existingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Stock record not found' });
    }

    await pool.query('DELETE FROM stock WHERE id = $1', [stockId]);

    res.json({ success: true, message: 'Stock record deleted successfully' });
  } catch (error) {
    console.error('Stock delete failed:', error);
    res.status(500).json({ error: 'Failed to delete stock record', details: error.message });
  }
});

// Brand API endpoints
// Debug endpoint - MUST be before /api/brands to avoid route conflict
app.get('/api/brands-debug', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    // Check current user and permissions
    const userCheck = await pool.query('SELECT current_user, current_database(), session_user');
    
    // Get all actual column names
    const columnQuery = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'brand'
      ORDER BY ordinal_position
    `);
    
    const actualColumns = columnQuery.rows.map(r => r.column_name);

    // Check table privileges
    const privileges = await pool.query(`
      SELECT grantee, privilege_type
      FROM information_schema.table_privileges 
      WHERE table_schema = 'public' 
      AND table_name = 'brand'
      AND grantee = current_user
    `);

    // Query with all columns
    const columnList = actualColumns.join(', ');
    const result = await pool.query(
      `SELECT ${columnList} FROM public.brand ORDER BY brand_name ASC LIMIT 1`
    );

    // Test explicit column query
    const explicitResult = await pool.query(
      'SELECT id, brand_name, created_at, updated_at, brand_website FROM public.brand LIMIT 1'
    );

    // Check column privileges
    const columnPrivileges = await pool.query(`
      SELECT column_name, privilege_type
      FROM information_schema.column_privileges 
      WHERE table_schema = 'public' 
      AND table_name = 'brand'
      AND grantee = current_user
    `);

    // Check RLS status
    const rlsCheck = await pool.query(`
      SELECT rowsecurity as rls_enabled
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename = 'brand'
    `);

    // Test if columns have data
    const dataCheck = await pool.query(`
      SELECT 
        COUNT(*) as total_rows,
        COUNT(created_at) as rows_with_created_at,
        COUNT(updated_at) as rows_with_updated_at,
        COUNT(brand_website) as rows_with_website
      FROM public.brand
    `);

    // Get raw row object inspection
    const rawRowInspection = result.rows.length > 0 ? {
      keys: Object.keys(result.rows[0]),
      hasOwnProperty_created_at: result.rows[0].hasOwnProperty('created_at'),
      hasOwnProperty_updated_at: result.rows[0].hasOwnProperty('updated_at'),
      hasOwnProperty_brand_website: result.rows[0].hasOwnProperty('brand_website'),
      hasCreatedAt: 'created_at' in result.rows[0],
      hasUpdatedAt: 'updated_at' in result.rows[0],
      hasBrandWebsite: 'brand_website' in result.rows[0],
      created_at_value: result.rows[0].created_at,
      updated_at_value: result.rows[0].updated_at,
      brand_website_value: result.rows[0].brand_website,
      created_at_type: typeof result.rows[0].created_at,
      updated_at_type: typeof result.rows[0].updated_at,
      brand_website_type: typeof result.rows[0].brand_website,
      fullObject: result.rows[0]
    } : null;

    const diagnostic = {
      currentUser: userCheck.rows[0],
      actualColumns: actualColumns,
      tablePrivileges: privileges.rows,
      columnPrivileges: columnPrivileges.rows,
      rlsEnabled: rlsCheck.rows[0]?.rls_enabled || false,
      dataCheck: dataCheck.rows[0],
      firstRowKeys: result.rows.length > 0 ? Object.keys(result.rows[0]) : [],
      firstRow: result.rows.length > 0 ? result.rows[0] : null,
      rawRowInspection: rawRowInspection,
      explicitQueryKeys: explicitResult.rows.length > 0 ? Object.keys(explicitResult.rows[0]) : [],
      explicitQueryRow: explicitResult.rows.length > 0 ? explicitResult.rows[0] : null
    };

    res.json(diagnostic);
  } catch (error) {
    res.status(500).json({ error: 'Debug query failed', details: error.message });
  }
});

// Main brands endpoint - MUST be before /api/brands/:id route to avoid route conflict
app.get('/api/brands', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    await ensureBrandDepartmentSchema(pool);

    const result = await pool.query(
      `SELECT b.id, b.brand_name, b.created_at, b.updated_at, b.brand_website, b.things_to_buy, b.things_to_avoid,
              b.description, b.menswear_category_id, b.department_id, b.category_id, d.department_name
       FROM public.brand b
       LEFT JOIN public.department d ON d.id = b.department_id
       ORDER BY b.brand_name ASC`
    );

    // Diagnostic: Check what the database actually returned
    const diagnostic = {
      totalRows: result.rows.length,
      firstRowExists: result.rows.length > 0,
      firstRowKeys: result.rows.length > 0 ? Object.keys(result.rows[0]) : [],
      firstRowHasCreatedAt: result.rows.length > 0 ? ('created_at' in result.rows[0]) : false,
      firstRowHasUpdatedAt: result.rows.length > 0 ? ('updated_at' in result.rows[0]) : false,
      firstRowHasBrandWebsite: result.rows.length > 0 ? ('brand_website' in result.rows[0]) : false,
      firstRowCreatedAt: result.rows.length > 0 ? result.rows[0].created_at : null,
      firstRowUpdatedAt: result.rows.length > 0 ? result.rows[0].updated_at : null,
      firstRowBrandWebsite: result.rows.length > 0 ? result.rows[0].brand_website : null,
      firstRowFull: result.rows.length > 0 ? result.rows[0] : null
    };

    // ALWAYS return all 5 columns - check if property exists in row object
    const rows = result.rows.map((row) => {
      const idNum = row.id != null && row.id !== '' ? Number(row.id) : NaN;
      const idOut = Number.isFinite(idNum) ? idNum : row.id;
      return {
        id: idOut,
        brand_name: row.brand_name,
        created_at: ('created_at' in row) ? row.created_at : null,
        updated_at: ('updated_at' in row) ? row.updated_at : null,
        brand_website: ('brand_website' in row) ? row.brand_website : null,
        things_to_buy: ('things_to_buy' in row) ? row.things_to_buy : null,
        things_to_avoid: ('things_to_avoid' in row) ? row.things_to_avoid : null,
        description: ('description' in row) ? row.description : null,
        menswear_category_id:
          row.menswear_category_id != null && row.menswear_category_id !== ''
            ? Number(row.menswear_category_id)
            : null,
        department_id:
          row.department_id != null && row.department_id !== ''
            ? Number(row.department_id)
            : null,
        category_id:
          row.category_id != null && row.category_id !== ''
            ? Number(row.category_id)
            : null,
        department_name:
          row.department_name != null && String(row.department_name).trim() !== ''
            ? String(row.department_name).trim()
            : null,
      };
    });

    const firstRowAfterMapping = rows.length > 0 ? rows[0] : null;
    const showDiagnostic = req.query.debug === '1' || req.query.debug === 'true';

    res.json({
      rows: rows ?? [],
      count: result.rowCount ?? 0,
      ...(showDiagnostic
        ? {
            _diagnostic: {
              ...diagnostic,
              mappedRowKeys: firstRowAfterMapping ? Object.keys(firstRowAfterMapping) : [],
              mappedRow: firstRowAfterMapping,
            },
          }
        : {}),
    });
  } catch (error) {
    console.error('Brands query failed:', error);
    res.status(500).json({ error: 'Failed to load brands data', details: error.message });
  }
});

app.post('/api/brands', async (req, res) => {
  const pool = getDatabasePool();
  const {
    brand_name,
    menswear_category_id: bodyMenswearCatId,
    department_id: bodyBrandDeptId,
    category_id: bodyStockCategoryId,
  } = req.body ?? {};
  const normalizedBrandName =
    typeof brand_name === 'string' && brand_name.trim() ? brand_name.trim() : '';

  try {
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    if (!normalizedBrandName) {
      return res.status(400).json({ error: 'Brand name is required' });
    }

    await ensureBrandDepartmentSchema(pool);
    const depRes = await resolveBrandDepartmentId(pool, bodyBrandDeptId);
    if (depRes.error) {
      return res.status(400).json({ error: depRes.error });
    }
    const { departmentId: brandDepartmentId } = depRes;

    let menswearCategoryId = null;
    if (bodyMenswearCatId !== undefined && bodyMenswearCatId !== null && bodyMenswearCatId !== '') {
      const cid = Number(bodyMenswearCatId);
      if (!Number.isInteger(cid) || cid < 1) {
        return res.status(400).json({ error: 'menswear_category_id must be a positive integer when provided' });
      }
      await ensureMenswearCategoryDepartmentSchema(pool);
      const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [cid]);
      if (!catCheck.rowCount) {
        return res.status(400).json({ error: 'menswear_category_id not found' });
      }
      menswearCategoryId = cid;
    }

    let stockCategoryId = null;
    if (bodyStockCategoryId !== undefined && bodyStockCategoryId !== null && bodyStockCategoryId !== '') {
      stockCategoryId = Number(bodyStockCategoryId);
      if (!Number.isInteger(stockCategoryId) || stockCategoryId < 1) {
        return res.status(400).json({ error: 'category_id must be a positive integer when provided' });
      }
      const catRow = await pool.query(
        'SELECT id, department_id FROM category WHERE id = $1',
        [stockCategoryId]
      );
      if (!catRow.rowCount) {
        return res.status(400).json({ error: 'category_id not found' });
      }
      const catDept = catRow.rows[0].department_id != null ? Number(catRow.rows[0].department_id) : null;
      if (catDept != null && catDept !== brandDepartmentId) {
        return res.status(400).json({
          error: 'category_id does not belong to the selected department',
        });
      }
    }

    if (stockCategoryId != null) {
      const existingResult = await pool.query(
        `SELECT id FROM brand
         WHERE category_id = $1
           AND LOWER(TRIM(BOTH FROM brand_name)) = LOWER(TRIM($2::text))`,
        [stockCategoryId, normalizedBrandName]
      );
      if (existingResult.rowCount > 0) {
        const hit = existingResult.rows[0];
        return res.status(400).json({
          error: 'A brand with this name already exists in this category',
          existing_brand_id: hit.id,
          category_id: stockCategoryId,
        });
      }
    } else {
      const existingResult = await pool.query(
        `SELECT id FROM brand
         WHERE LOWER(TRIM(BOTH FROM brand_name)) = LOWER(TRIM($1::text))
           AND department_id = $2
           AND category_id IS NULL`,
        [normalizedBrandName, brandDepartmentId]
      );
      if (existingResult.rowCount > 0) {
        const hit = existingResult.rows[0];
        return res.status(400).json({
          error: 'A brand with this name already exists in this department',
          existing_brand_id: hit.id,
          department_id: brandDepartmentId,
        });
      }
    }

    const insertQuery = `
      INSERT INTO brand (brand_name, menswear_category_id, department_id, category_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, brand_name, menswear_category_id, department_id, category_id
    `;

    const result = await pool.query(insertQuery, [
      normalizedBrandName,
      menswearCategoryId,
      brandDepartmentId,
      stockCategoryId,
    ]);

    const row = result.rows[0];
    const dn = await pool.query(`SELECT department_name FROM department WHERE id = $1`, [
      brandDepartmentId,
    ]);
    row.department_name = dn.rows[0]?.department_name ?? null;

    res.status(201).json({ row });
  } catch (error) {
    console.error('Brand insert failed:', error);
    if (error.code === '23505') {
      let hint =
        'Database rejected a duplicate. If this name is not in this department in the UI, a legacy unique index on brand_name (all departments) may still exist — restart the API so migrations run, or check pg_indexes on public.brand.';
      try {
        if (pool && normalizedBrandName) {
          const dup = await pool.query(
            `SELECT b.id, b.department_id, b.brand_name, d.department_name
             FROM public.brand b
             LEFT JOIN public.department d ON d.id = b.department_id
             WHERE LOWER(TRIM(BOTH FROM b.brand_name)) = LOWER(TRIM($1::text))
             ORDER BY b.id ASC
             LIMIT 3`,
            [normalizedBrandName]
          );
          if (dup.rowCount > 0) {
            const rows = dup.rows.map(
              (r) =>
                `id ${r.id} (dept ${r.department_id ?? '?'} ${r.department_name ?? ''})`.trim()
            );
            hint = `Existing row(s) with this name: ${rows.join('; ')}. In Config → Brands, set the department filter to "All departments" to find it. If the name only exists in another department but insert still fails, restart the server to apply brand index migration.`;
          }
        }
      } catch (lookupErr) {
        console.warn('Brand insert 23505 lookup:', lookupErr.message);
      }
      const isCategoryScoped = bodyStockCategoryId != null && bodyStockCategoryId !== '';
      return res.status(400).json({
        error: isCategoryScoped
          ? 'A brand with this name already exists in this category'
          : 'A brand with this name already exists in this department',
        code: 'BRAND_DUPLICATE',
        hint,
      });
    }
    res.status(500).json({ error: 'Failed to create brand', details: error.message });
  }
});

app.patch('/api/brands/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    await ensureBrandDepartmentSchema(pool);

    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;

    const currentBrand = await pool.query(
      'SELECT department_id, category_id FROM public.brand WHERE id = $1',
      [id]
    );
    if (!currentBrand.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    let effectiveDepartmentIdForNameCheck = Number(currentBrand.rows[0].department_id);
    let effectiveCategoryIdForNameCheck =
      currentBrand.rows[0].category_id != null && currentBrand.rows[0].category_id !== ''
        ? Number(currentBrand.rows[0].category_id)
        : null;
    if (
      Object.prototype.hasOwnProperty.call(body, 'department_id') &&
      body.department_id !== null &&
      body.department_id !== undefined &&
      body.department_id !== ''
    ) {
      const did = Number(body.department_id);
      if (Number.isInteger(did) && did >= 1) {
        const depOk = await pool.query('SELECT 1 FROM department WHERE id = $1', [did]);
        if (depOk.rowCount) {
          effectiveDepartmentIdForNameCheck = did;
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'category_id')) {
      const raw = body.category_id;
      if (raw === null || raw === undefined || raw === '') {
        effectiveCategoryIdForNameCheck = null;
        sets.push(`category_id = $${n++}`);
        vals.push(null);
      } else {
        const cid = Number(raw);
        if (!Number.isInteger(cid) || cid < 1) {
          return res.status(400).json({ error: 'category_id must be a positive integer or null' });
        }
        const catCheck = await pool.query('SELECT id FROM category WHERE id = $1', [cid]);
        if (!catCheck.rowCount) {
          return res.status(400).json({ error: 'category_id not found' });
        }
        effectiveCategoryIdForNameCheck = cid;
        sets.push(`category_id = $${n++}`);
        vals.push(cid);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'brand_name')) {
      const raw = body.brand_name;
      if (typeof raw !== 'string' || !raw.trim()) {
        return res.status(400).json({ error: 'brand_name cannot be empty' });
      }
      const normalizedName = raw.trim().slice(0, 500);
      let dup;
      if (effectiveCategoryIdForNameCheck != null) {
        dup = await pool.query(
          `SELECT id FROM brand
           WHERE LOWER(TRIM(BOTH FROM brand_name)) = LOWER(TRIM($1::text))
             AND category_id = $2
             AND id <> $3`,
          [normalizedName, effectiveCategoryIdForNameCheck, id]
        );
      } else {
        dup = await pool.query(
          `SELECT id FROM brand
           WHERE LOWER(TRIM(BOTH FROM brand_name)) = LOWER(TRIM($1::text))
             AND department_id = $2
             AND category_id IS NULL
             AND id <> $3`,
          [normalizedName, effectiveDepartmentIdForNameCheck, id]
        );
      }
      if (dup.rowCount > 0) {
        return res.status(400).json({
          error:
            effectiveCategoryIdForNameCheck != null
              ? 'A brand with this name already exists in this category'
              : 'A brand with this name already exists in this department',
        });
      }
      sets.push(`brand_name = $${n++}`);
      vals.push(normalizedName);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'brand_website')) {
      const raw = body.brand_website;
      let value = null;
      if (raw === null || raw === undefined) {
        value = null;
      } else if (typeof raw === 'string') {
        const t = raw.trim();
        value = t ? t.slice(0, 2048) : null;
      } else {
        return res.status(400).json({ error: 'brand_website must be a string or null' });
      }
      sets.push(`brand_website = $${n++}`);
      vals.push(value);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'things_to_buy')) {
      const raw = body.things_to_buy;
      let value = null;
      if (raw === null || raw === undefined) {
        value = null;
      } else if (typeof raw === 'string') {
        const t = raw.trim();
        value = t ? t.slice(0, 8000) : null;
      } else {
        return res.status(400).json({ error: 'things_to_buy must be a string or null' });
      }
      sets.push(`things_to_buy = $${n++}`);
      vals.push(value);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'things_to_avoid')) {
      const raw = body.things_to_avoid;
      let value = null;
      if (raw === null || raw === undefined) {
        value = null;
      } else if (typeof raw === 'string') {
        const t = raw.trim();
        value = t ? t.slice(0, 8000) : null;
      } else {
        return res.status(400).json({ error: 'things_to_avoid must be a string or null' });
      }
      sets.push(`things_to_avoid = $${n++}`);
      vals.push(value);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      const raw = body.description;
      let value = null;
      if (raw === null || raw === undefined) {
        value = null;
      } else if (typeof raw === 'string') {
        const t = raw.trim();
        value = t ? t.slice(0, 8000) : null;
      } else {
        return res.status(400).json({ error: 'description must be a string or null' });
      }
      sets.push(`description = $${n++}`);
      vals.push(value);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'menswear_category_id')) {
      const raw = body.menswear_category_id;
      if (raw === null || raw === undefined || raw === '') {
        sets.push(`menswear_category_id = $${n++}`);
        vals.push(null);
      } else {
        const cid = Number(raw);
        if (!Number.isFinite(cid) || cid < 1) {
          return res.status(400).json({ error: 'menswear_category_id must be a positive integer or null' });
        }
        const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [cid]);
        if (!catCheck.rowCount) {
          return res.status(400).json({ error: 'menswear_category_id not found' });
        }
        sets.push(`menswear_category_id = $${n++}`);
        vals.push(cid);
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'department_id')) {
      const raw = body.department_id;
      if (raw === null || raw === undefined || raw === '') {
        return res.status(400).json({ error: 'department_id cannot be null; omit the field to leave unchanged' });
      }
      const did = Number(raw);
      if (!Number.isInteger(did) || did < 1) {
        return res.status(400).json({ error: 'department_id must be a positive integer' });
      }
      const depOk = await pool.query('SELECT 1 FROM department WHERE id = $1', [did]);
      if (!depOk.rowCount) {
        return res.status(400).json({ error: 'department_id not found' });
      }
      sets.push(`department_id = $${n++}`);
      vals.push(did);
    }

    if (sets.length === 0) {
      return res.status(400).json({
        error:
          'Provide at least one of: brand_name, brand_website, things_to_buy, things_to_avoid, description, menswear_category_id, department_id',
      });
    }

    sets.push('updated_at = NOW()');
    vals.push(id);

    const result = await pool.query(
      `UPDATE brand
       SET ${sets.join(', ')}
       WHERE id = $${n}
       RETURNING id, brand_name, created_at, updated_at, brand_website, things_to_buy, things_to_avoid, description, menswear_category_id, department_id`,
      vals
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const row = result.rows[0];
    const depId = row.department_id != null ? Number(row.department_id) : null;
    if (depId != null && Number.isInteger(depId) && depId >= 1) {
      const dn = await pool.query(`SELECT department_name FROM department WHERE id = $1`, [depId]);
      row.department_name = dn.rows[0]?.department_name ?? null;
    } else {
      row.department_name = null;
    }

    res.json({ row });
  } catch (error) {
    console.error('Brand patch failed:', error);
    if (error.code === '23505') {
      return res.status(400).json({
        error: 'A brand with this name already exists in this department',
      });
    }
    res.status(500).json({ error: 'Failed to update brand', details: error.message });
  }
});

/**
 * Idempotent DDL for Research / Config → clothing (menswear) categories.
 * Safe to call on every list/create so a fresh DB works without manual migration.
 */
async function ensureMenswearCategoryTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.menswear_category (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT menswear_category_name_key UNIQUE (name)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_menswear_category_name_lower
      ON public.menswear_category (LOWER(name));
  `);
}

/**
 * Idempotent: add department_id to menswear_category, backfill Menswear, per-dept name uniqueness.
 * Mirrors scripts/migrations/001_menswear_category_add_department.sql for dev / fresh DBs.
 *
 * Serialized via ensureMenswearCategoryDepartmentSchema: concurrent HTTP handlers (e.g. sales +
 * inventory + list) must not run this DDL in parallel or PostgreSQL can raise
 * duplicate key on pg_class_relname_nsp_index.
 */
async function ensureMenswearCategoryDepartmentSchemaBody(pool) {
  await ensureMenswearCategoryTable(pool);
  await pool.query(`
    ALTER TABLE public.menswear_category
    ADD COLUMN IF NOT EXISTS department_id INTEGER;
  `);
  const fkExists = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'menswear_category_department_id_fkey'`
  );
  if (!fkExists.rowCount) {
    try {
      await pool.query(`
        ALTER TABLE public.menswear_category
        ADD CONSTRAINT menswear_category_department_id_fkey
        FOREIGN KEY (department_id) REFERENCES public.department (id) ON DELETE RESTRICT;
      `);
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
  }
  await pool.query(`
    UPDATE public.menswear_category mc
    SET department_id = d.id
    FROM public.department d
    WHERE mc.department_id IS NULL
      AND lower(trim(both from d.department_name)) = 'menswear';
  `);
  await pool.query(`
    UPDATE public.menswear_category
    SET department_id = (SELECT id FROM public.department ORDER BY id ASC LIMIT 1)
    WHERE department_id IS NULL
      AND EXISTS (SELECT 1 FROM public.department LIMIT 1);
  `);
  await pool.query(
    `ALTER TABLE public.menswear_category DROP CONSTRAINT IF EXISTS menswear_category_name_key;`
  );
  await pool.query(`DROP INDEX IF EXISTS public.idx_menswear_category_name_lower;`);
  try {
    await pool.query(
      `ALTER TABLE public.menswear_category ALTER COLUMN department_id SET NOT NULL;`
    );
  } catch (e) {
    console.warn('menswear_category.department_id SET NOT NULL skipped:', e.message);
  }
  const nullDept = await pool.query(
    `SELECT COUNT(*)::int AS c FROM public.menswear_category WHERE department_id IS NULL`
  );
  const nullCount = nullDept.rows[0]?.c ?? 0;
  if (nullCount === 0) {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_menswear_category_dept_name_lower
      ON public.menswear_category (department_id, lower(trim(both from name)));
    `);
  }
}

let _menswearDeptDdlQueue = Promise.resolve();

async function ensureMenswearCategoryDepartmentSchema(pool) {
  const prev = _menswearDeptDdlQueue;
  let release;
  _menswearDeptDdlQueue = new Promise((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    await ensureMenswearCategoryDepartmentSchemaBody(pool);
  } finally {
    release();
  }
}

async function resolveMenswearCategoryDepartmentId(pool, bodyDepartmentId) {
  let departmentId =
    bodyDepartmentId === null || bodyDepartmentId === undefined || bodyDepartmentId === ''
      ? null
      : Number(bodyDepartmentId);
  if (departmentId !== null && (!Number.isInteger(departmentId) || departmentId < 1)) {
    return { error: 'department_id must be a positive integer when provided' };
  }
  if (departmentId === null) {
    const depRes = await pool.query(
      `SELECT id FROM public.department
       WHERE lower(trim(both from department_name)) = 'menswear'
       LIMIT 1`
    );
    if (!depRes.rowCount) {
      return {
        error: 'department_id is required (no Menswear department found to use as default)',
      };
    }
    departmentId = Number(depRes.rows[0].id);
  } else {
    const depOk = await pool.query('SELECT 1 FROM department WHERE id = $1', [departmentId]);
    if (!depOk.rowCount) {
      return { error: 'department_id not found' };
    }
  }
  return { departmentId };
}

/**
 * Idempotent: add brand.department_id, FK, backfill (prefer department id 1, else Menswear), index, NOT NULL.
 * Mirrors scripts/migrations/002_brand_add_department.sql.
 */
async function ensureBrandDepartmentSchema(pool) {
  await pool.query(`
    ALTER TABLE public.brand
    ADD COLUMN IF NOT EXISTS department_id INTEGER;
  `);
  const fkExists = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'brand_department_id_fkey'`
  );
  if (!fkExists.rowCount) {
    try {
      await pool.query(`
        ALTER TABLE public.brand
        ADD CONSTRAINT brand_department_id_fkey
        FOREIGN KEY (department_id) REFERENCES public.department (id) ON DELETE RESTRICT;
      `);
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
  }
  await pool.query(`
    UPDATE public.brand b
    SET department_id = 1
    WHERE b.department_id IS NULL
      AND EXISTS (SELECT 1 FROM public.department WHERE id = 1);
  `);
  await pool.query(`
    UPDATE public.brand b
    SET department_id = d.id
    FROM public.department d
    WHERE b.department_id IS NULL
      AND lower(trim(both from d.department_name)) = 'menswear';
  `);
  await pool.query(`
    UPDATE public.brand
    SET department_id = (SELECT id FROM public.department ORDER BY id ASC LIMIT 1)
    WHERE department_id IS NULL
      AND EXISTS (SELECT 1 FROM public.department LIMIT 1);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_brand_department_id ON public.brand (department_id);
  `);
  try {
    await pool.query(`ALTER TABLE public.brand ALTER COLUMN department_id SET NOT NULL`);
  } catch (e) {
    console.warn('brand.department_id SET NOT NULL skipped:', e.message);
  }

  await ensureBrandUniquePerDepartmentSchema(pool);
}

/**
 * Allow the same brand_name in different departments. Replace legacy UNIQUE(brand_name)
 * with UNIQUE (department_id, lower(trim(brand_name))).
 */
async function ensureBrandUniquePerDepartmentSchema(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'brand'
        AND c.contype = 'u'
        AND array_length(c.conkey, 1) = 1
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.conrelid
            AND a.attnum = c.conkey[1]
            AND a.attname = 'brand_name'
        )
    `);
    for (const { conname } of rows) {
      if (typeof conname !== 'string' || !/^[a-zA-Z0-9_]+$/.test(conname)) continue;
      await pool.query(`ALTER TABLE public.brand DROP CONSTRAINT IF EXISTS ${conname}`);
    }
  } catch (e) {
    console.warn('ensureBrandUniquePerDepartmentSchema (drop legacy unique):', e.message);
  }
  /* Common constraint names (Postgres often names them {table}_{column}_key). */
  for (const legacyCon of ['brand_brand_name_key', 'brand_name_key', 'brand_brand_name_unique']) {
    try {
      await pool.query(`ALTER TABLE public.brand DROP CONSTRAINT IF EXISTS ${legacyCon}`);
    } catch (e) {
      console.warn(`ensureBrandUniquePerDepartmentSchema DROP CONSTRAINT ${legacyCon}:`, e.message);
    }
  }
  /* UNIQUE CONSTRAINT creates an index; CREATE UNIQUE INDEX alone does not — still blocks cross-department names.
   * Match any UNIQUE index that touches brand_name but not department_id (covers lower(brand_name), btree(brand_name), etc.). */
  try {
    const { rows: allBrandIdx } = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'brand'
        AND indexname IS NOT NULL
        AND indexname <> 'idx_brand_department_name_lower'
    `);
    for (const row of allBrandIdx) {
      const indexname = row.indexname;
      const indexdef = String(row.indexdef ?? '');
      if (typeof indexname !== 'string' || !/^[a-zA-Z0-9_]+$/.test(indexname)) continue;
      if (indexname === 'brand_pkey' || indexname.endsWith('_pkey')) continue;
      const def = indexdef.toLowerCase();
      if (!def.includes('unique')) continue;
      if (!def.includes('brand_name')) continue;
      if (def.includes('department_id')) continue;
      try {
        await pool.query(`DROP INDEX IF EXISTS public.${indexname}`);
        console.log(`[brand schema] dropped legacy unique index: ${indexname}`);
      } catch (dropErr) {
        console.warn(
          `ensureBrandUniquePerDepartmentSchema: could not drop index ${indexname} (may be tied to a constraint):`,
          dropErr.message
        );
      }
    }
  } catch (e) {
    console.warn('ensureBrandUniquePerDepartmentSchema (drop legacy unique index):', e.message);
  }
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_department_name_lower
      ON public.brand (department_id, (LOWER(TRIM(BOTH FROM brand_name))))
      WHERE category_id IS NULL;
    `);
  } catch (e) {
    console.warn(
      'ensureBrandUniquePerDepartmentSchema (composite index):',
      e.message,
      '— fix duplicate brand names within the same department if needed'
    );
  }
  await ensureBrandStockCategorySchema(pool);
}

/**
 * Stock category on brand: same brand_name may exist under different stock categories.
 * database/brand_add_stock_category.sql
 */
async function ensureBrandStockCategorySchema(pool) {
  await pool.query(`
    ALTER TABLE public.brand
    ADD COLUMN IF NOT EXISTS category_id INTEGER;
  `);
  const fkExists = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'brand_category_id_fkey'`
  );
  if (!fkExists.rowCount) {
    try {
      await pool.query(`
        ALTER TABLE public.brand
        ADD CONSTRAINT brand_category_id_fkey
        FOREIGN KEY (category_id) REFERENCES public.category (id) ON DELETE SET NULL;
      `);
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
  }
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_brand_category_id ON public.brand (category_id);
  `);
  try {
    await pool.query(`DROP INDEX IF EXISTS public.idx_brand_department_name_lower`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_department_name_lower
      ON public.brand (department_id, (LOWER(TRIM(BOTH FROM brand_name))))
      WHERE category_id IS NULL;
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_stock_category_name_lower
      ON public.brand (category_id, (LOWER(TRIM(BOTH FROM brand_name))))
      WHERE category_id IS NOT NULL;
    `);
  } catch (e) {
    console.warn('ensureBrandStockCategorySchema (indexes):', e.message);
  }
}

/**
 * Stock category table: name unique per department.
 * database/category_unique_per_department.sql
 */
async function ensureStockCategoryDepartmentSchema(pool) {
  await pool.query(`
    ALTER TABLE public.category
    ADD COLUMN IF NOT EXISTS department_id INTEGER;
  `);
  const fkExists = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'category_department_id_fkey'`
  );
  if (!fkExists.rowCount) {
    try {
      await pool.query(`
        ALTER TABLE public.category
        ADD CONSTRAINT category_department_id_fkey
        FOREIGN KEY (department_id) REFERENCES public.department (id) ON DELETE RESTRICT;
      `);
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
  }
  await ensureCategoryUniquePerDepartmentSchema(pool);
}

async function ensureCategoryUniquePerDepartmentSchema(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'category'
        AND c.contype = 'u'
        AND array_length(c.conkey, 1) = 1
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = c.conrelid
            AND a.attnum = c.conkey[1]
            AND a.attname = 'category_name'
        )
    `);
    for (const { conname } of rows) {
      if (typeof conname !== 'string' || !/^[a-zA-Z0-9_]+$/.test(conname)) continue;
      await pool.query(`ALTER TABLE public.category DROP CONSTRAINT IF EXISTS ${conname}`);
    }
  } catch (e) {
    console.warn('ensureCategoryUniquePerDepartmentSchema (drop legacy unique):', e.message);
  }
  for (const legacyCon of ['category_category_name_key', 'category_name_key']) {
    try {
      await pool.query(`ALTER TABLE public.category DROP CONSTRAINT IF EXISTS ${legacyCon}`);
    } catch (e) {
      console.warn(`ensureCategoryUniquePerDepartmentSchema DROP CONSTRAINT ${legacyCon}:`, e.message);
    }
  }
  try {
    const { rows: allCatIdx } = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'category'
        AND indexname IS NOT NULL
        AND indexname <> 'idx_category_department_name_lower'
    `);
    for (const row of allCatIdx) {
      const indexname = row.indexname;
      const indexdef = String(row.indexdef ?? '').toLowerCase();
      if (typeof indexname !== 'string' || !/^[a-zA-Z0-9_]+$/.test(indexname)) continue;
      if (indexname === 'category_pkey' || indexname.endsWith('_pkey')) continue;
      if (!indexdef.includes('unique')) continue;
      if (!indexdef.includes('category_name')) continue;
      if (indexdef.includes('department_id')) continue;
      await pool.query(`DROP INDEX IF EXISTS public.${indexname}`);
    }
  } catch (e) {
    console.warn('ensureCategoryUniquePerDepartmentSchema (drop legacy index):', e.message);
  }
  try {
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_category_department_name_lower
      ON public.category (department_id, (LOWER(TRIM(BOTH FROM category_name))))
      WHERE department_id IS NOT NULL;
    `);
  } catch (e) {
    console.warn('ensureCategoryUniquePerDepartmentSchema (composite index):', e.message);
  }
}

/**
 * POST /api/brands: department_id must be sent explicitly. Do not default to id 1 —
 * that silently mis-filed brands when clients omitted or failed to send the field.
 */
async function resolveBrandDepartmentId(pool, bodyDepartmentId) {
  if (
    bodyDepartmentId === null ||
    bodyDepartmentId === undefined ||
    bodyDepartmentId === ''
  ) {
    return { error: 'department_id is required' };
  }
  const departmentId = Number(bodyDepartmentId);
  if (!Number.isInteger(departmentId) || departmentId < 1) {
    return { error: 'department_id must be a positive integer' };
  }
  const depOk = await pool.query('SELECT 1 FROM department WHERE id = $1', [departmentId]);
  if (!depOk.rowCount) {
    return { error: 'department_id not found' };
  }
  return { departmentId };
}

/**
 * Menswear category taxonomy (optional brand mapping via brand.menswear_category_id).
 * GET /api/menswear-categories
 */
app.get('/api/menswear-categories', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureMenswearCategoryDepartmentSchema(pool);
    const rawDept = req.query.department_id ?? req.query.departmentId;
    let filterDeptId = null;
    if (rawDept !== undefined && rawDept !== null && String(rawDept).trim() !== '') {
      const n = Number(rawDept);
      if (Number.isInteger(n) && n >= 1) {
        filterDeptId = n;
      }
    }
    const params = [];
    let whereSql = '';
    if (filterDeptId !== null) {
      params.push(filterDeptId);
      whereSql = `WHERE mc.department_id = $${params.length}`;
    }
    const result = await pool.query(
      `SELECT mc.id, mc.name, mc.description, mc.notes, mc.created_at, mc.updated_at,
              mc.department_id, d.department_name
       FROM menswear_category mc
       LEFT JOIN department d ON d.id = mc.department_id
       ${whereSql}
       ORDER BY mc.name ASC`,
      params
    );
    res.json({ rows: result.rows });
  } catch (error) {
    console.error('menswear-categories list failed:', error);
    res.status(500).json({ error: 'Failed to load menswear categories', details: error.message });
  }
});

/**
 * Create a clothing (menswear) category row. Ensures table exists (CREATE IF NOT EXISTS).
 * POST /api/menswear-categories  body: { name, description?, notes? }
 */
app.post('/api/menswear-categories', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureMenswearCategoryDepartmentSchema(pool);

    const body = req.body ?? {};
    const nameRaw = body.name;
    if (typeof nameRaw !== 'string' || !nameRaw.trim()) {
      return res.status(400).json({ error: 'name is required (non-empty string)' });
    }
    const name = nameRaw.trim().slice(0, 500);
    const depRes = await resolveMenswearCategoryDepartmentId(pool, body.department_id);
    if (depRes.error) {
      return res.status(400).json({ error: depRes.error });
    }
    const { departmentId } = depRes;

    const dup = await pool.query(
      `SELECT id FROM menswear_category
       WHERE department_id = $1
         AND lower(trim(both from name)) = lower(trim(both from $2::text))`,
      [departmentId, name]
    );
    if (dup.rowCount) {
      return res.status(409).json({ error: 'A category with this name already exists in this department' });
    }

    let description = null;
    if (body.description != null && body.description !== '') {
      if (typeof body.description !== 'string') {
        return res.status(400).json({ error: 'description must be a string or omitted' });
      }
      const t = body.description.trim();
      description = t ? t.slice(0, 8000) : null;
    }
    let notes = null;
    if (body.notes != null && body.notes !== '') {
      if (typeof body.notes !== 'string') {
        return res.status(400).json({ error: 'notes must be a string or omitted' });
      }
      const t = body.notes.trim();
      notes = t ? t.slice(0, 8000) : null;
    }

    const result = await pool.query(
      `INSERT INTO menswear_category (name, description, notes, department_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, notes, created_at, updated_at, department_id`,
      [name, description, notes, departmentId]
    );
    const row = result.rows[0];
    const dn = await pool.query(`SELECT department_name FROM department WHERE id = $1`, [departmentId]);
    row.department_name = dn.rows[0]?.department_name ?? null;

    res.status(201).json({ row });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A category with this name already exists in this department' });
    }
    console.error('menswear-categories create failed:', error);
    res.status(500).json({ error: 'Failed to create category', details: error.message });
  }
});

/**
 * Update a clothing (menswear) category.
 * PATCH /api/menswear-categories/:id  body: { name, description?, notes? }
 */
app.patch('/api/menswear-categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureMenswearCategoryDepartmentSchema(pool);

    const body = req.body ?? {};
    const cur = await pool.query(
      'SELECT name, description, notes, department_id FROM menswear_category WHERE id = $1',
      [id]
    );
    if (!cur.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const prev = cur.rows[0];

    const nameRaw = body.name;
    if (typeof nameRaw !== 'string' || !nameRaw.trim()) {
      return res.status(400).json({ error: 'name is required (non-empty string)' });
    }
    const name = nameRaw.trim().slice(0, 500);

    let departmentId = prev.department_id != null ? Number(prev.department_id) : null;
    if (Object.prototype.hasOwnProperty.call(body, 'department_id')) {
      const depRes = await resolveMenswearCategoryDepartmentId(pool, body.department_id);
      if (depRes.error) {
        return res.status(400).json({ error: depRes.error });
      }
      departmentId = depRes.departmentId;
    }
    if (departmentId == null || !Number.isInteger(departmentId) || departmentId < 1) {
      return res.status(400).json({ error: 'department_id is required' });
    }

    const dup = await pool.query(
      `SELECT id FROM menswear_category
       WHERE department_id = $1
         AND lower(trim(both from name)) = lower(trim(both from $2::text))
         AND id <> $3`,
      [departmentId, name, id]
    );
    if (dup.rowCount) {
      return res.status(409).json({ error: 'A category with this name already exists in this department' });
    }

    let description = prev.description;
    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      const raw = body.description;
      if (raw === null || raw === '') {
        description = null;
      } else if (typeof raw === 'string') {
        const t = raw.trim();
        description = t ? t.slice(0, 8000) : null;
      } else {
        return res.status(400).json({ error: 'description must be a string, null, or omitted' });
      }
    }

    let notes = prev.notes;
    if (Object.prototype.hasOwnProperty.call(body, 'notes')) {
      const raw = body.notes;
      if (raw === null || raw === '') {
        notes = null;
      } else if (typeof raw === 'string') {
        const t = raw.trim();
        notes = t ? t.slice(0, 8000) : null;
      } else {
        return res.status(400).json({ error: 'notes must be a string, null, or omitted' });
      }
    }

    const result = await pool.query(
      `UPDATE menswear_category
       SET name = $1, description = $2, notes = $3, department_id = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING id, name, description, notes, created_at, updated_at, department_id`,
      [name, description, notes, departmentId, id]
    );
    const row = result.rows[0];
    const dn = await pool.query(`SELECT department_name FROM department WHERE id = $1`, [departmentId]);
    row.department_name = dn.rows[0]?.department_name ?? null;

    res.json({ row });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A category with this name already exists in this department' });
    }
    console.error('menswear-categories patch failed:', error);
    res.status(500).json({ error: 'Failed to update category', details: error.message });
  }
});

/**
 * DELETE /api/menswear-categories/:id
 * Fails with 409 if any brand has menswear_category_id = id.
 */
app.delete('/api/menswear-categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureMenswearCategoryDepartmentSchema(pool);

    const brandCountRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM brand WHERE menswear_category_id = $1`,
      [id]
    );
    const linked = brandCountRes.rows[0]?.c ?? 0;
    if (linked > 0) {
      return res.status(409).json({
        error:
          'Remove the associated brands from this category before deleting it.',
        brandCount: linked,
      });
    }

    const del = await pool.query('DELETE FROM menswear_category WHERE id = $1 RETURNING id', [id]);
    if (!del.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('menswear-categories delete failed:', error);
    res.status(500).json({ error: 'Failed to delete category', details: error.message });
  }
});

/**
 * All mapped clothing buckets: brand × stock category, ≥1 sale — most sold first (for list overview charts).
 * GET /api/menswear-categories/cross-bucket/buy-more-brand-stock-category?limit=10
 */
app.get('/api/menswear-categories/cross-bucket/buy-more-brand-stock-category', async (req, res) => {
  try {
    let limit = parseInt(String(req.query.limit ?? '10'), 10);
    if (Number.isNaN(limit)) limit = 10;
    limit = Math.min(200, Math.max(5, limit));

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureMenswearCategoryDepartmentSchema(pool);

    const result = await pool.query(
      `SELECT
         b.id AS brand_id,
         b.brand_name,
         mc.id AS menswear_category_id,
         mc.name AS menswear_category_name,
         COALESCE(MAX(cat.category_name), 'Uncategorized') AS category_name,
         s.category_id AS category_id,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)::int AS unsold_count,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL)::int AS sold_count
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       INNER JOIN menswear_category mc ON mc.id = b.menswear_category_id
       LEFT JOIN category cat ON s.category_id = cat.id
       GROUP BY b.id, b.brand_name, mc.id, mc.name, s.category_id
       HAVING COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL) >= 1
       ORDER BY
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL)) DESC NULLS LAST,
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)) ASC NULLS LAST,
         brand_name ASC,
         menswear_category_name ASC,
         category_name ASC
       LIMIT $1`,
      [limit]
    );

    res.json({ rows: result.rows ?? [], limit });
  } catch (error) {
    console.error('menswear-categories cross-bucket buy-more failed:', error);
    res.status(500).json({ error: 'Failed to load cross-bucket buy-more rows', details: error.message });
  }
});

/**
 * All mapped clothing buckets: brand × stock category with unsold lines — lowest sell rate first (top avoid).
 * GET /api/menswear-categories/cross-bucket/avoid-brand-stock-category?limit=10
 */
app.get('/api/menswear-categories/cross-bucket/avoid-brand-stock-category', async (req, res) => {
  try {
    let limit = parseInt(String(req.query.limit ?? '10'), 10);
    if (Number.isNaN(limit)) limit = 10;
    limit = Math.min(200, Math.max(5, limit));

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureMenswearCategoryDepartmentSchema(pool);

    const result = await pool.query(
      `SELECT
         b.id AS brand_id,
         b.brand_name,
         mc.id AS menswear_category_id,
         mc.name AS menswear_category_name,
         COALESCE(MAX(cat.category_name), 'Uncategorized') AS category_name,
         s.category_id AS category_id,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)::int AS unsold_count,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL)::int AS sold_count
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       INNER JOIN menswear_category mc ON mc.id = b.menswear_category_id
       LEFT JOIN category cat ON s.category_id = cat.id
       GROUP BY b.id, b.brand_name, mc.id, mc.name, s.category_id
       HAVING COUNT(s.id) FILTER (WHERE s.sale_date IS NULL) >= 1
       ORDER BY
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL))::numeric / NULLIF(COUNT(s.id), 0) ASC NULLS LAST,
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)) DESC NULLS LAST,
         brand_name ASC,
         menswear_category_name ASC,
         category_name ASC
       LIMIT $1`,
      [limit]
    );

    res.json({ rows: result.rows ?? [], limit });
  } catch (error) {
    console.error('menswear-categories cross-bucket avoid failed:', error);
    res.status(500).json({ error: 'Failed to load cross-bucket avoid rows', details: error.message });
  }
});

/**
 * Stock lines for one brand in this clothing (menswear) category — unsold and sold, newest purchase first.
 * GET /api/menswear-categories/:id/brand-inventory-items?brand_id=…
 */
app.get('/api/menswear-categories/:id/brand-inventory-items', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    const brandId = parseInt(String(req.query.brand_id ?? ''), 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'brand_id is required' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    await ensureMenswearCategoryDepartmentSchema(pool);

    const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [categoryId]);
    if (!catCheck.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const brandCheck = await pool.query(
      `SELECT id, brand_name FROM brand WHERE id = $1 AND menswear_category_id = $2`,
      [brandId, categoryId]
    );
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand is not in this Menswear category' });
    }

    const brandName = String(brandCheck.rows[0].brand_name ?? '');

    const result = await pool.query(
      `SELECT
         s.id,
         s.item_name,
         s.purchase_price,
         s.purchase_date,
         s.sale_date,
         s.category_id,
         COALESCE(c.category_name, 'Uncategorized') AS category_name,
         s.category_size_id,
         sz.size_label AS size_label,
         sz.sort_order AS size_sort_order,
         s.brand_tag_image_id,
         bt.storage_path AS tag_storage_path,
         bt.caption AS tag_caption
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       LEFT JOIN category c ON s.category_id = c.id
       LEFT JOIN category_size sz ON sz.id = s.category_size_id
       LEFT JOIN brand_tag_image bt ON bt.id = s.brand_tag_image_id AND bt.brand_id = s.brand_id
       WHERE b.id = $1
         AND b.menswear_category_id = $2
       ORDER BY s.purchase_date DESC NULLS LAST, s.id DESC
       LIMIT 5000`,
      [brandId, categoryId]
    );

    const rawRows = result.rows ?? [];
    const pathByTagId = new Map();
    for (const row of rawRows) {
      const tid = row.brand_tag_image_id;
      const p = row.tag_storage_path;
      if (tid != null && p != null && String(p).trim() !== '') {
        pathByTagId.set(Number(tid), String(p).trim());
      }
    }
    const urlByTagId = new Map();
    for (const [tid, storagePath] of pathByTagId) {
      try {
        const u = await resolveBrandTagImageUrl(storagePath);
        if (u) urlByTagId.set(tid, u);
      } catch (e) {
        console.warn('brand-inventory-items tag URL resolve failed:', tid, e?.message || e);
      }
    }

    const rows = rawRows.map((row) => {
      const tid =
        row.brand_tag_image_id != null && row.brand_tag_image_id !== undefined
          ? Number(row.brand_tag_image_id)
          : null;
      const tagIdOk = tid != null && Number.isFinite(tid) && tid >= 1;
      const rawSzId = row.category_size_id;
      const szNum =
        rawSzId === null || rawSzId === undefined ? NaN : Math.floor(Number(rawSzId));
      const category_size_id = Number.isFinite(szNum) && szNum >= 1 ? szNum : null;
      return {
        id: row.id,
        item_name: row.item_name,
        purchase_price: row.purchase_price,
        purchase_date: row.purchase_date,
        sale_date: row.sale_date,
        category_id: row.category_id,
        category_name: row.category_name,
        category_size_id,
        size_label:
          category_size_id != null && row.size_label != null && String(row.size_label).trim() !== ''
            ? String(row.size_label).trim()
            : null,
        size_sort_order:
          row.size_sort_order != null && row.size_sort_order !== undefined
            ? Number(row.size_sort_order)
            : null,
        brand_tag_image_id: tagIdOk ? tid : null,
        tag_caption: row.tag_caption != null ? String(row.tag_caption) : null,
        tag_public_url: tagIdOk ? urlByTagId.get(tid) ?? null : null,
      };
    });

    res.json({
      rows,
      brand_id: brandId,
      brand_name: brandName,
      menswear_category_id: categoryId,
    });
  } catch (error) {
    console.error('menswear-categories brand-inventory-items failed:', error);
    res.status(500).json({ error: 'Failed to load brand inventory items', details: error.message });
  }
});

/**
 * Brand-level sold revenue within one menswear category (brands linked to that category).
 * GET /api/menswear-categories/:id/sales-by-brand?period=last_12_months|2026|2025
 */
app.get('/api/menswear-categories/:id/sales-by-brand', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [categoryId]);
    if (!catCheck.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const rawPeriod = String(req.query.period ?? 'last_12_months').trim().toLowerCase();
    const period =
      rawPeriod === '2026' || rawPeriod === '2025' || rawPeriod === 'last_12_months'
        ? rawPeriod
        : 'last_12_months';

    let dateFilterSql = '';
    if (period === 'last_12_months') {
      dateFilterSql = 'AND s.sale_date >= (CURRENT_DATE - INTERVAL \'12 months\')';
    } else if (period === '2026') {
      dateFilterSql = "AND s.sale_date >= DATE '2026-01-01' AND s.sale_date < DATE '2027-01-01'";
    } else if (period === '2025') {
      dateFilterSql = "AND s.sale_date >= DATE '2025-01-01' AND s.sale_date < DATE '2026-01-01'";
    }

    const result = await pool.query(
      `SELECT b.id,
              b.brand_name,
              COALESCE(SUM(
                CASE
                  WHEN s.sale_price IS NOT NULL
                   AND TRIM(s.sale_price::text) <> ''
                   AND s.sale_price::numeric > 0
                  THEN s.sale_price::numeric
                  ELSE 0
                END
              ), 0)::numeric AS total_sales,
              COUNT(s.id)::int AS sold_count
       FROM brand b
       INNER JOIN stock s ON s.brand_id = b.id
       WHERE b.menswear_category_id = $1
         ${dateFilterSql}
       GROUP BY b.id, b.brand_name
       HAVING COALESCE(SUM(
         CASE
           WHEN s.sale_price IS NOT NULL
            AND TRIM(s.sale_price::text) <> ''
            AND s.sale_price::numeric > 0
           THEN s.sale_price::numeric
           ELSE 0
         END
       ), 0) > 0 OR COUNT(s.id) > 0
       ORDER BY total_sales DESC NULLS LAST, brand_name ASC`,
      [categoryId]
    );

    res.json({ rows: result.rows, period, category_id: categoryId });
  } catch (error) {
    console.error('menswear-categories sales-by-brand failed:', error);
    res.status(500).json({ error: 'Failed to load brand sales for category', details: error.message });
  }
});

/** Period filter on sale_date (sold lines only), same as sales-by-brand. */
function menswearSaleDateInPeriodSql(period) {
  if (period === 'last_12_months') {
    return `s.sale_date IS NOT NULL AND s.sale_date >= (CURRENT_DATE - INTERVAL '12 months')`;
  }
  if (period === '2026') {
    return `s.sale_date IS NOT NULL AND s.sale_date >= DATE '2026-01-01' AND s.sale_date < DATE '2027-01-01'`;
  }
  if (period === '2025') {
    return `s.sale_date IS NOT NULL AND s.sale_date >= DATE '2025-01-01' AND s.sale_date < DATE '2026-01-01'`;
  }
  return `s.sale_date IS NOT NULL AND s.sale_date >= (CURRENT_DATE - INTERVAL '12 months')`;
}

/**
 * Watchlist: brand × stock category — sold lines in period, revenue, profit ÷ revenue.
 * GET /api/menswear-categories/:id/watchlist-lookout?period=last_12_months|2026|2025&limit=200
 */
app.get('/api/menswear-categories/:id/watchlist-lookout', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    let limit = parseInt(String(req.query.limit ?? '200'), 10);
    if (Number.isNaN(limit)) limit = 200;
    limit = Math.min(500, Math.max(1, limit));

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [categoryId]);
    if (!catCheck.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const rawPeriod = String(req.query.period ?? 'last_12_months').trim().toLowerCase();
    const period =
      rawPeriod === '2026' || rawPeriod === '2025' || rawPeriod === 'last_12_months'
        ? rawPeriod
        : 'last_12_months';

    const dateCond = menswearSaleDateInPeriodSql(period);

    const result = await pool.query(
      `SELECT
         b.id AS brand_id,
         b.brand_name,
         COALESCE(MAX(c.category_name), 'Uncategorized') AS category_name,
         s.category_id AS category_id,
         COUNT(s.id)::int AS sold_count,
         COALESCE(SUM(
           CASE
             WHEN s.sale_price IS NOT NULL
              AND TRIM(s.sale_price::text) <> ''
              AND s.sale_price::numeric > 0
             THEN s.sale_price::numeric
             ELSE 0
           END
         ), 0)::numeric AS total_sales,
         CASE
           WHEN COALESCE(SUM(
             CASE
               WHEN s.sale_price IS NOT NULL
                AND TRIM(s.sale_price::text) <> ''
                AND s.sale_price::numeric > 0
               THEN s.sale_price::numeric
               ELSE 0
             END
           ), 0) > 0
           THEN (
             COALESCE(SUM(
               CASE
                 WHEN s.net_profit IS NOT NULL
                  AND TRIM(s.net_profit::text) <> ''
                 THEN s.net_profit::numeric
                 ELSE 0
               END
             ), 0)::numeric
           ) / NULLIF(
             COALESCE(SUM(
               CASE
                 WHEN s.sale_price IS NOT NULL
                  AND TRIM(s.sale_price::text) <> ''
                  AND s.sale_price::numeric > 0
                 THEN s.sale_price::numeric
                 ELSE 0
               END
             ), 0)::numeric,
             0
           )
           ELSE NULL
         END AS profit_ratio
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       LEFT JOIN category c ON s.category_id = c.id
       WHERE b.menswear_category_id = $1
         AND (${dateCond})
       GROUP BY b.id, b.brand_name, s.category_id
       HAVING COUNT(s.id) >= 1
       ORDER BY total_sales DESC NULLS LAST, sold_count DESC NULLS LAST, brand_name ASC, category_name ASC
       LIMIT $2`,
      [categoryId, limit]
    );

    res.json({ rows: result.rows ?? [], period, category_id: categoryId, limit });
  } catch (error) {
    console.error('menswear-categories watchlist-lookout failed:', error);
    res.status(500).json({ error: 'Failed to load watchlist lookout', details: error.message });
  }
});

/**
 * Watchlist: top N brand × category with most unsold now and fewest sales in period (+ profit ratio on period sales).
 * GET /api/menswear-categories/:id/watchlist-avoid?period=last_12_months|2026|2025&limit=5
 */
app.get('/api/menswear-categories/:id/watchlist-avoid', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    let limit = parseInt(String(req.query.limit ?? '5'), 10);
    if (Number.isNaN(limit)) limit = 5;
    limit = Math.min(50, Math.max(1, limit));

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [categoryId]);
    if (!catCheck.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const rawPeriod = String(req.query.period ?? 'last_12_months').trim().toLowerCase();
    const period =
      rawPeriod === '2026' || rawPeriod === '2025' || rawPeriod === 'last_12_months'
        ? rawPeriod
        : 'last_12_months';

    const dateCond = menswearSaleDateInPeriodSql(period);

    const result = await pool.query(
      `SELECT
         b.id AS brand_id,
         b.brand_name,
         COALESCE(MAX(c.category_name), 'Uncategorized') AS category_name,
         s.category_id AS category_id,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)::int AS unsold_count,
         COUNT(s.id) FILTER (WHERE ${dateCond})::int AS sold_count,
         COALESCE(SUM(
           CASE
             WHEN (${dateCond})
              AND s.sale_price IS NOT NULL
              AND TRIM(s.sale_price::text) <> ''
              AND s.sale_price::numeric > 0
             THEN s.sale_price::numeric
             ELSE 0
           END
         ), 0)::numeric AS total_sales,
         CASE
           WHEN COALESCE(SUM(
             CASE
               WHEN (${dateCond})
                AND s.sale_price IS NOT NULL
                AND TRIM(s.sale_price::text) <> ''
                AND s.sale_price::numeric > 0
               THEN s.sale_price::numeric
               ELSE 0
             END
           ), 0) > 0
           THEN (
             COALESCE(SUM(
               CASE
                 WHEN (${dateCond})
                  AND s.net_profit IS NOT NULL
                  AND TRIM(s.net_profit::text) <> ''
                 THEN s.net_profit::numeric
                 ELSE 0
               END
             ), 0)::numeric
           ) / NULLIF(
             COALESCE(SUM(
               CASE
                 WHEN (${dateCond})
                  AND s.sale_price IS NOT NULL
                  AND TRIM(s.sale_price::text) <> ''
                  AND s.sale_price::numeric > 0
                 THEN s.sale_price::numeric
                 ELSE 0
               END
             ), 0)::numeric,
             0
           )
           ELSE NULL
         END AS profit_ratio
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       LEFT JOIN category c ON s.category_id = c.id
       WHERE b.menswear_category_id = $1
       GROUP BY b.id, b.brand_name, s.category_id
       HAVING COUNT(s.id) FILTER (WHERE s.sale_date IS NULL) >= 1
       ORDER BY
         COUNT(s.id) FILTER (WHERE s.sale_date IS NULL) DESC NULLS LAST,
         COUNT(s.id) FILTER (WHERE ${dateCond}) ASC NULLS LAST,
         brand_name ASC,
         category_name ASC
       LIMIT $2`,
      [categoryId, limit]
    );

    res.json({ rows: result.rows ?? [], period, category_id: categoryId, limit });
  } catch (error) {
    console.error('menswear-categories watchlist-avoid failed:', error);
    res.status(500).json({ error: 'Failed to load watchlist avoid', details: error.message });
  }
});

/**
 * Brands in a menswear category, with total sold revenue (sum of sale_price where sold).
 * GET /api/menswear-categories/:id/brands?sort=name|total_sales
 */
app.get('/api/menswear-categories/:id/brands', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [categoryId]);
    if (!catCheck.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const sort = req.query.sort === 'total_sales' ? 'total_sales' : 'name';
    const orderSql =
      sort === 'total_sales'
        ? 'ORDER BY total_sales DESC NULLS LAST, brand_name ASC'
        : 'ORDER BY brand_name ASC';

    const result = await pool.query(
      `WITH agg AS (
         SELECT b.id,
                b.brand_name,
                COALESCE(SUM(
                  CASE
                    WHEN s.sale_price IS NOT NULL
                     AND TRIM(s.sale_price::text) <> ''
                     AND (s.sale_price::numeric > 0)
                    THEN s.sale_price::numeric
                    ELSE 0
                  END
                ), 0)::numeric AS total_sales
         FROM brand b
         LEFT JOIN stock s ON s.brand_id = b.id
         WHERE b.menswear_category_id = $1
         GROUP BY b.id, b.brand_name
       )
       SELECT id, brand_name, total_sales
       FROM agg
       ${orderSql}`,
      [categoryId]
    );

    res.json({ rows: result.rows, sort });
  } catch (error) {
    console.error('menswear-categories brands failed:', error);
    res.status(500).json({ error: 'Failed to load brands for category', details: error.message });
  }
});

/**
 * Unsold stock count per brand within one clothing (menswear) category.
 * GET /api/menswear-categories/:id/inventory-by-brand
 */
app.get('/api/menswear-categories/:id/inventory-by-brand', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [categoryId]);
    if (!catCheck.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const result = await pool.query(
      `SELECT
         b.id AS brand_id,
         b.brand_name,
         COUNT(s.id)::int AS unsold_count
       FROM brand b
       LEFT JOIN stock s ON s.brand_id = b.id AND s.sale_date IS NULL
       WHERE b.menswear_category_id = $1
       GROUP BY b.id, b.brand_name
       ORDER BY unsold_count DESC, b.brand_name ASC`,
      [categoryId]
    );

    res.json({ rows: result.rows ?? [] });
  } catch (error) {
    console.error('menswear-categories inventory-by-brand failed:', error);
    res.status(500).json({ error: 'Failed to load inventory by brand', details: error.message });
  }
});

/**
 * Unsold stock counts by brand + stock category (brands linked to this menswear category).
 * Rows ordered by lowest sell rate first: sold ÷ (sold + unsold stock lines in group).
 * GET /api/menswear-categories/:id/unsold-inventory-by-brand-category?limit=10
 */
app.get('/api/menswear-categories/:id/unsold-inventory-by-brand-category', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    let limit = parseInt(String(req.query.limit ?? '10'), 10);
    if (Number.isNaN(limit)) limit = 10;
    limit = Math.min(200, Math.max(5, limit));

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [categoryId]);
    if (!catCheck.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const result = await pool.query(
      `SELECT
         b.id AS brand_id,
         b.brand_name,
         COALESCE(MAX(c.category_name), 'Uncategorized') AS category_name,
         s.category_id AS category_id,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)::int AS unsold_count,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL)::int AS sold_count
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       LEFT JOIN category c ON s.category_id = c.id
       WHERE b.menswear_category_id = $1
       GROUP BY b.id, b.brand_name, s.category_id
       HAVING COUNT(s.id) FILTER (WHERE s.sale_date IS NULL) >= 1
       ORDER BY
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL))::numeric / NULLIF(COUNT(s.id), 0) ASC NULLS LAST,
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)) DESC NULLS LAST,
         brand_name ASC,
         category_name ASC
       LIMIT $2`,
      [categoryId, limit]
    );

    res.json({ rows: result.rows ?? [], category_id: categoryId, limit });
  } catch (error) {
    console.error('menswear-categories unsold-inventory-by-brand-category failed:', error);
    res.status(500).json({ error: 'Failed to load unsold inventory by brand and category', details: error.message });
  }
});

/**
 * Unsold stock lines for one brand + stock category within a menswear category (for drill-down).
 * GET /api/menswear-categories/:id/unsold-stock-items?brand_id=…&category_id=… | &uncategorized=1
 */
app.get('/api/menswear-categories/:id/unsold-stock-items', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    const brandId = parseInt(String(req.query.brand_id ?? ''), 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'brand_id is required' });
    }

    const uncategorized = String(req.query.uncategorized ?? '').trim() === '1';
    const rawCategoryId = req.query.category_id;
    let categorySql = '';
    const params = [categoryId, brandId];
    if (uncategorized) {
      categorySql = 'AND s.category_id IS NULL';
    } else if (rawCategoryId !== undefined && rawCategoryId !== null && String(rawCategoryId).trim() !== '') {
      const cid = parseInt(String(rawCategoryId), 10);
      if (Number.isNaN(cid) || cid < 1) {
        return res.status(400).json({ error: 'Invalid category_id' });
      }
      categorySql = 'AND s.category_id = $3';
      params.push(cid);
    } else {
      return res.status(400).json({ error: 'Provide category_id or uncategorized=1' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [categoryId]);
    if (!catCheck.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const brandCheck = await pool.query(
      'SELECT id FROM brand WHERE id = $1 AND menswear_category_id = $2',
      [brandId, categoryId]
    );
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand not in this menswear category' });
    }

    const result = await pool.query(
      `SELECT
         s.id,
         s.item_name,
         s.purchase_price,
         s.purchase_date,
         s.vinted_id,
         s.ebay_id
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       WHERE b.menswear_category_id = $1
         AND b.id = $2
         AND s.sale_date IS NULL
         ${categorySql}
       ORDER BY s.purchase_date DESC NULLS LAST, s.id DESC
       LIMIT 500`,
      params
    );

    res.json({ rows: result.rows ?? [], category_id: categoryId, brand_id: brandId });
  } catch (error) {
    console.error('menswear-categories unsold-stock-items failed:', error);
    res.status(500).json({ error: 'Failed to load unsold stock items', details: error.message });
  }
});

/**
 * Brand × stock category rows with at least one sale, ordered by most units sold first (fewest sold at bottom).
 * GET /api/menswear-categories/:id/buy-more-by-brand-category?limit=10
 */
app.get('/api/menswear-categories/:id/buy-more-by-brand-category', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    let limit = parseInt(String(req.query.limit ?? '10'), 10);
    if (Number.isNaN(limit)) limit = 10;
    limit = Math.min(200, Math.max(5, limit));

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [categoryId]);
    if (!catCheck.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const result = await pool.query(
      `SELECT
         b.id AS brand_id,
         b.brand_name,
         COALESCE(MAX(c.category_name), 'Uncategorized') AS category_name,
         s.category_id AS category_id,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)::int AS unsold_count,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL)::int AS sold_count
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       LEFT JOIN category c ON s.category_id = c.id
       WHERE b.menswear_category_id = $1
       GROUP BY b.id, b.brand_name, s.category_id
       HAVING COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL) >= 1
       ORDER BY
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL)) DESC NULLS LAST,
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)) ASC NULLS LAST,
         brand_name ASC,
         category_name ASC
       LIMIT $2`,
      [categoryId, limit]
    );

    res.json({ rows: result.rows ?? [], category_id: categoryId, limit });
  } catch (error) {
    console.error('menswear-categories buy-more-by-brand-category failed:', error);
    res.status(500).json({ error: 'Failed to load buy-more by brand and category', details: error.message });
  }
});

/**
 * Sold stock lines for one brand + stock category (drill-down for “buy more”).
 * GET /api/menswear-categories/:id/sold-stock-items?brand_id=…&category_id=… | &uncategorized=1
 */
app.get('/api/menswear-categories/:id/sold-stock-items', async (req, res) => {
  try {
    const categoryId = parseInt(req.params.id, 10);
    if (Number.isNaN(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    const brandId = parseInt(String(req.query.brand_id ?? ''), 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'brand_id is required' });
    }

    const uncategorized = String(req.query.uncategorized ?? '').trim() === '1';
    const rawCategoryId = req.query.category_id;
    let categorySql = '';
    const params = [categoryId, brandId];
    if (uncategorized) {
      categorySql = 'AND s.category_id IS NULL';
    } else if (rawCategoryId !== undefined && rawCategoryId !== null && String(rawCategoryId).trim() !== '') {
      const cid = parseInt(String(rawCategoryId), 10);
      if (Number.isNaN(cid) || cid < 1) {
        return res.status(400).json({ error: 'Invalid category_id' });
      }
      categorySql = 'AND s.category_id = $3';
      params.push(cid);
    } else {
      return res.status(400).json({ error: 'Provide category_id or uncategorized=1' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const catCheck = await pool.query('SELECT id FROM menswear_category WHERE id = $1', [categoryId]);
    if (!catCheck.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const brandCheck = await pool.query(
      'SELECT id FROM brand WHERE id = $1 AND menswear_category_id = $2',
      [brandId, categoryId]
    );
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand not in this menswear category' });
    }

    const result = await pool.query(
      `SELECT
         s.id,
         s.item_name,
         s.purchase_price,
         s.purchase_date,
         s.sale_date,
         s.vinted_id,
         s.ebay_id
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       WHERE b.menswear_category_id = $1
         AND b.id = $2
         AND s.sale_date IS NOT NULL
         ${categorySql}
       ORDER BY s.sale_date DESC NULLS LAST, s.id DESC
       LIMIT 500`,
      params
    );

    res.json({ rows: result.rows ?? [], category_id: categoryId, brand_id: brandId });
  } catch (error) {
    console.error('menswear-categories sold-stock-items failed:', error);
    res.status(500).json({ error: 'Failed to load sold stock items', details: error.message });
  }
});

/**
 * Category-level sold revenue for menswear categories, aggregated from linked brands.
 * GET /api/menswear-categories/sales-by-category?period=last_12_months|2026|2025
 */
app.get('/api/menswear-categories/sales-by-category', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureMenswearCategoryDepartmentSchema(pool);

    const rawDept = req.query.department_id ?? req.query.departmentId;
    let filterDeptId = null;
    if (rawDept !== undefined && rawDept !== null && String(rawDept).trim() !== '') {
      const n = Number(rawDept);
      if (Number.isInteger(n) && n >= 1) {
        filterDeptId = n;
      }
    }

    const rawPeriod = String(req.query.period ?? 'last_12_months').trim().toLowerCase();
    const period =
      rawPeriod === '2026' || rawPeriod === '2025' || rawPeriod === 'last_12_months'
        ? rawPeriod
        : 'last_12_months';

    let dateFilterSql = '';
    if (period === 'last_12_months') {
      dateFilterSql = 'AND s.sale_date >= (CURRENT_DATE - INTERVAL \'12 months\')';
    } else if (period === '2026') {
      dateFilterSql = "AND s.sale_date >= DATE '2026-01-01' AND s.sale_date < DATE '2027-01-01'";
    } else if (period === '2025') {
      dateFilterSql = "AND s.sale_date >= DATE '2025-01-01' AND s.sale_date < DATE '2026-01-01'";
    }

    /**
     * When ?department_id= is set, scope by brand.department_id (what you actually sell under that
     * department), not menswear_category.department_id — otherwise Electronics sales vanish when brands
     * still point at research buckets created under another department.
     * With a department filter, also include brands with menswear_category_id NULL (e.g. Roku under a
     * generic brand) — they roll up as category_id null + name "No research bucket".
     */
    const result = await pool.query(
      `WITH sales AS (
         SELECT
           b.menswear_category_id AS category_id,
           COALESCE(SUM(
             CASE
               WHEN s.sale_price IS NOT NULL
                AND TRIM(s.sale_price::text) <> ''
                AND s.sale_price::numeric > 0
               THEN s.sale_price::numeric
               ELSE 0
             END
           ), 0)::numeric AS total_sales,
           COUNT(s.id)::int AS sold_count
         FROM stock s
         JOIN brand b ON b.id = s.brand_id
         WHERE (
             ($1::int IS NULL AND b.menswear_category_id IS NOT NULL)
             OR ($1::int IS NOT NULL AND b.department_id = $1::int)
           )
           ${dateFilterSql}
         GROUP BY b.menswear_category_id
       )
       SELECT
         s.category_id AS category_id,
         COALESCE(c.name, 'No research bucket') AS category_name,
         COALESCE(s.total_sales, 0)::numeric AS total_sales,
         COALESCE(s.sold_count, 0)::int AS sold_count
       FROM sales s
       LEFT JOIN menswear_category c ON c.id = s.category_id
       WHERE COALESCE(s.total_sales, 0) > 0 OR COALESCE(s.sold_count, 0) > 0
       ORDER BY total_sales DESC NULLS LAST, category_name ASC`,
      [filterDeptId]
    );

    res.json({ rows: result.rows, period });
  } catch (error) {
    console.error('menswear-categories sales-by-category failed:', error);
    res.status(500).json({ error: 'Failed to load menswear category sales', details: error.message });
  }
});

/**
 * Unsold stock count per clothing (menswear) category — stock rows with no sale_date,
 * grouped via brand.menswear_category_id. Compare with sales-by-category pie.
 * GET /api/menswear-categories/inventory-by-category
 */
app.get('/api/menswear-categories/inventory-by-category', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureMenswearCategoryDepartmentSchema(pool);

    const rawDept = req.query.department_id ?? req.query.departmentId;
    let filterDeptId = null;
    if (rawDept !== undefined && rawDept !== null && String(rawDept).trim() !== '') {
      const n = Number(rawDept);
      if (Number.isInteger(n) && n >= 1) {
        filterDeptId = n;
      }
    }

    let result;
    if (filterDeptId !== null) {
      result = await pool.query(
        `SELECT
           c.id AS category_id,
           COALESCE(c.name, 'No research bucket') AS category_name,
           COUNT(s.id)::int AS unsold_count
         FROM brand b
         LEFT JOIN menswear_category c ON c.id = b.menswear_category_id
         LEFT JOIN stock s ON s.brand_id = b.id AND s.sale_date IS NULL
         WHERE b.department_id = $1
         GROUP BY c.id, c.name
         ORDER BY unsold_count DESC, c.name ASC`,
        [filterDeptId]
      );
    } else {
      result = await pool.query(
        `SELECT
           c.id AS category_id,
           c.name AS category_name,
           COUNT(s.id)::int AS unsold_count
         FROM menswear_category c
         LEFT JOIN brand b ON b.menswear_category_id = c.id
         LEFT JOIN stock s ON s.brand_id = b.id AND s.sale_date IS NULL
         GROUP BY c.id, c.name
         ORDER BY unsold_count DESC, c.name ASC`
      );
    }

    res.json({ rows: result.rows ?? [] });
  } catch (error) {
    console.error('menswear-categories inventory-by-category failed:', error);
    res.status(500).json({ error: 'Failed to load inventory by category', details: error.message });
  }
});

/**
 * Stock line `category_id` (clothing type) — sold revenue and counts.
 * GET /api/stock-categories/sales-by-category?period=last_12_months|2026|2025
 */
app.get('/api/stock-categories/sales-by-category', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);

    const rawPeriod = String(req.query.period ?? 'last_12_months').trim().toLowerCase();
    const period =
      rawPeriod === '2026' || rawPeriod === '2025' || rawPeriod === 'last_12_months'
        ? rawPeriod
        : 'last_12_months';

    let dateFilterSql = '';
    if (period === 'last_12_months') {
      dateFilterSql = 'AND s.sale_date >= (CURRENT_DATE - INTERVAL \'12 months\')';
    } else if (period === '2026') {
      dateFilterSql = "AND s.sale_date >= DATE '2026-01-01' AND s.sale_date < DATE '2027-01-01'";
    } else if (period === '2025') {
      dateFilterSql = "AND s.sale_date >= DATE '2025-01-01' AND s.sale_date < DATE '2026-01-01'";
    }

    const result = await pool.query(
      `WITH sales AS (
         SELECT
           s.category_id AS category_id,
           COALESCE(SUM(
             CASE
               WHEN s.sale_price IS NOT NULL
                AND TRIM(s.sale_price::text) <> ''
                AND s.sale_price::numeric > 0
               THEN s.sale_price::numeric
               ELSE 0
             END
           ), 0)::numeric AS total_sales,
           COUNT(s.id)::int AS sold_count
         FROM stock s
         INNER JOIN brand b ON b.id = s.brand_id
         WHERE s.sale_date IS NOT NULL
           AND ($1::int IS NULL OR b.department_id = $1::int)
           ${dateFilterSql}
         GROUP BY s.category_id
       )
       SELECT
         s.category_id AS category_id,
         COALESCE(c.category_name, 'Uncategorized') AS category_name,
         s.total_sales,
         s.sold_count
       FROM sales s
       LEFT JOIN category c ON c.id = s.category_id
       WHERE (COALESCE(s.total_sales, 0) > 0 OR COALESCE(s.sold_count, 0) > 0)
         AND ($1::int IS NULL OR s.category_id IS NULL OR c.department_id = $1::int)
       ORDER BY s.total_sales DESC NULLS LAST, category_name ASC`,
      [filterDeptId]
    );

    res.json({ rows: result.rows, period });
  } catch (error) {
    console.error('stock-categories sales-by-category failed:', error);
    res.status(500).json({ error: 'Failed to load clothing type sales', details: error.message });
  }
});

/**
 * Per clothing type: sold vs unsold counts, unsold_ratio, total_net_profit (sold lines),
 * unsold_inventory_total (sum purchase_price on unsold lines).
 * Only rows with unsold_count > 0. Ordered by unsold_ratio DESC (worst sell-through first).
 * GET /api/stock-categories/inventory-by-category
 */
app.get('/api/stock-categories/inventory-by-category', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);

    const result = await pool.query(
      `WITH per_cat AS (
         SELECT
           c.id AS category_id,
           c.category_name AS category_name,
           COUNT(*) FILTER (
             WHERE s.sale_date IS NOT NULL
               AND ($1::int IS NULL OR b.department_id = $1::int)
           )::int AS sold_count,
           COUNT(*) FILTER (
             WHERE s.sale_date IS NULL
               AND ($1::int IS NULL OR b.department_id = $1::int)
           )::int AS unsold_count,
           COALESCE(SUM(
             CASE
               WHEN s.sale_date IS NOT NULL
                AND ($1::int IS NULL OR b.department_id = $1::int)
                AND s.net_profit IS NOT NULL
                AND TRIM(s.net_profit::text) <> ''
               THEN s.net_profit::numeric
               ELSE 0::numeric
             END
           ), 0::numeric) AS total_net_profit,
           COALESCE(SUM(
             CASE
               WHEN s.sale_date IS NULL
                AND ($1::int IS NULL OR b.department_id = $1::int)
                AND s.purchase_price IS NOT NULL
                AND TRIM(s.purchase_price::text) <> ''
               THEN s.purchase_price::numeric
               ELSE 0::numeric
             END
           ), 0::numeric) AS unsold_inventory_total
         FROM category c
         LEFT JOIN stock s ON s.category_id = c.id
         LEFT JOIN brand b ON b.id = s.brand_id
         WHERE ($1::int IS NULL OR c.department_id = $1::int)
         GROUP BY c.id, c.category_name
       ),
       uncat AS (
         SELECT
           NULL::integer AS category_id,
           'Uncategorized'::text AS category_name,
           COUNT(*) FILTER (WHERE s.sale_date IS NOT NULL)::int AS sold_count,
           COUNT(*) FILTER (WHERE s.sale_date IS NULL)::int AS unsold_count,
           COALESCE(SUM(
             CASE
               WHEN s.sale_date IS NOT NULL
                AND s.net_profit IS NOT NULL
                AND TRIM(s.net_profit::text) <> ''
               THEN s.net_profit::numeric
               ELSE 0::numeric
             END
           ), 0::numeric) AS total_net_profit,
           COALESCE(SUM(
             CASE
               WHEN s.sale_date IS NULL
                AND s.purchase_price IS NOT NULL
                AND TRIM(s.purchase_price::text) <> ''
               THEN s.purchase_price::numeric
               ELSE 0::numeric
             END
           ), 0::numeric) AS unsold_inventory_total
         FROM stock s
         INNER JOIN brand b ON b.id = s.brand_id
         WHERE s.category_id IS NULL
           AND ($1::int IS NULL OR b.department_id = $1::int)
       ),
       combined AS (
         SELECT * FROM per_cat WHERE unsold_count > 0
         UNION ALL
         SELECT * FROM uncat WHERE unsold_count > 0
       )
       SELECT
         category_id,
         category_name,
         sold_count,
         unsold_count,
         (sold_count + unsold_count)::int AS total_count,
         CASE
           WHEN (sold_count + unsold_count) > 0
           THEN (unsold_count::double precision / (sold_count + unsold_count))
           ELSE 0::double precision
         END AS unsold_ratio,
         total_net_profit,
         unsold_inventory_total
       FROM combined
       ORDER BY
         CASE
           WHEN (sold_count + unsold_count) > 0
           THEN (unsold_count::double precision / (sold_count + unsold_count))
           ELSE 0::double precision
         END DESC NULLS LAST,
         unsold_count DESC,
         category_name ASC`,
      [filterDeptId]
    );

    res.json({ rows: result.rows ?? [] });
  } catch (error) {
    console.error('stock-categories inventory-by-category failed:', error);
    res.status(500).json({ error: 'Failed to load inventory by clothing type', details: error.message });
  }
});

/**
 * @param {string} typeKey — `uncategorized` or stock `category.id`
 * @returns {{ uncategorized: true, categoryId: null } | { uncategorized: false, categoryId: number } | null}
 */
function parseStockClothingTypeTypeKey(typeKey) {
  const s = String(typeKey ?? '').trim().toLowerCase();
  if (s === 'uncategorized') return { uncategorized: true, categoryId: null };
  const n = parseInt(s, 10);
  if (Number.isNaN(n) || n < 1) return null;
  return { uncategorized: false, categoryId: n };
}

/** Optional `?department_id=` / `?departmentId=` — scope stock rows by `brand.department_id`. */
function parseOptionalBrandDepartmentFilter(req) {
  const raw = req.query.department_id ?? req.query.departmentId;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * Brands with stock in this clothing type (stock.category_id), most sold first.
 * GET /api/stock-categories/type/:typeKey/brands
 */
app.get('/api/stock-categories/type/:typeKey/brands', async (req, res) => {
  try {
    const parsed = parseStockClothingTypeTypeKey(req.params.typeKey);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid clothing type key' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    if (!parsed.uncategorized) {
      const catCheck = await pool.query('SELECT id FROM category WHERE id = $1', [parsed.categoryId]);
      if (!catCheck.rowCount) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);
    const baseWhere = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const params = parsed.uncategorized ? [] : [parsed.categoryId];
    let deptClause = '';
    if (filterDeptId != null) {
      params.push(filterDeptId);
      deptClause = ` AND b.department_id = $${params.length}`;
    }
    const whereSql = `${baseWhere}${deptClause}`;

    const result = await pool.query(
      `SELECT
         b.id,
         b.brand_name,
         COUNT(*) FILTER (WHERE s.sale_date IS NOT NULL)::int AS sold_count,
         COUNT(*) FILTER (WHERE s.sale_date IS NULL)::int AS unsold_count,
         COALESCE(SUM(
           CASE
             WHEN s.sale_price IS NOT NULL
              AND TRIM(s.sale_price::text) <> ''
              AND s.sale_price::numeric > 0
             THEN s.sale_price::numeric
             ELSE 0
           END
         ), 0)::numeric AS total_sales
       FROM stock s
       INNER JOIN brand b ON b.id = s.brand_id
       WHERE ${whereSql}
       GROUP BY b.id, b.brand_name
       HAVING COUNT(*) >= 1
       ORDER BY
         COUNT(*) FILTER (WHERE s.sale_date IS NOT NULL) DESC NULLS LAST,
         COUNT(*) FILTER (WHERE s.sale_date IS NULL) ASC NULLS LAST,
         b.brand_name ASC`,
      params
    );

    res.json({ rows: result.rows ?? [] });
  } catch (error) {
    console.error('stock-categories type brands failed:', error);
    res.status(500).json({ error: 'Failed to load brands for clothing type', details: error.message });
  }
});

/**
 * Brand × stock category — at least one sale; most sold first (same shape as menswear buy-more).
 * GET /api/stock-categories/type/:typeKey/buy-more-by-brand-category?limit=10
 */
app.get('/api/stock-categories/type/:typeKey/buy-more-by-brand-category', async (req, res) => {
  try {
    const parsed = parseStockClothingTypeTypeKey(req.params.typeKey);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid clothing type key' });
    }

    let limit = parseInt(String(req.query.limit ?? '10'), 10);
    if (Number.isNaN(limit)) limit = 10;
    limit = Math.min(200, Math.max(5, limit));

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    if (!parsed.uncategorized) {
      const catCheck = await pool.query('SELECT id FROM category WHERE id = $1', [parsed.categoryId]);
      if (!catCheck.rowCount) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);
    const baseWhere = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const params = [];
    if (!parsed.uncategorized) params.push(parsed.categoryId);
    if (filterDeptId != null) {
      params.push(filterDeptId);
    }
    const deptClause = filterDeptId != null ? ` AND b.department_id = $${params.length}` : '';
    params.push(limit);
    const limitIdx = params.length;
    const whereSql = `${baseWhere}${deptClause}`;

    const result = await pool.query(
      `SELECT
         b.id AS brand_id,
         b.brand_name,
         COALESCE(MAX(c.category_name), 'Uncategorized') AS category_name,
         s.category_id AS category_id,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)::int AS unsold_count,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL)::int AS sold_count
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       LEFT JOIN category c ON s.category_id = c.id
       WHERE ${whereSql}
       GROUP BY b.id, b.brand_name, s.category_id
       HAVING COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL) >= 1
       ORDER BY
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL)) DESC NULLS LAST,
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)) ASC NULLS LAST,
         brand_name ASC,
         category_name ASC
       LIMIT $${limitIdx}`,
      params
    );

    res.json({
      rows: result.rows ?? [],
      type_key: req.params.typeKey,
      limit,
    });
  } catch (error) {
    console.error('stock-categories type buy-more-by-brand-category failed:', error);
    res.status(500).json({ error: 'Failed to load buy-more rows', details: error.message });
  }
});

/**
 * Brand × stock category — unsold present; worst sell rate first (same shape as menswear avoid).
 * GET /api/stock-categories/type/:typeKey/unsold-inventory-by-brand-category?limit=10
 */
app.get('/api/stock-categories/type/:typeKey/unsold-inventory-by-brand-category', async (req, res) => {
  try {
    const parsed = parseStockClothingTypeTypeKey(req.params.typeKey);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid clothing type key' });
    }

    let limit = parseInt(String(req.query.limit ?? '10'), 10);
    if (Number.isNaN(limit)) limit = 10;
    limit = Math.min(200, Math.max(5, limit));

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    if (!parsed.uncategorized) {
      const catCheck = await pool.query('SELECT id FROM category WHERE id = $1', [parsed.categoryId]);
      if (!catCheck.rowCount) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);
    const baseWhere = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const params = [];
    if (!parsed.uncategorized) params.push(parsed.categoryId);
    if (filterDeptId != null) {
      params.push(filterDeptId);
    }
    const deptClause = filterDeptId != null ? ` AND b.department_id = $${params.length}` : '';
    params.push(limit);
    const limitIdx = params.length;
    const whereSql = `${baseWhere}${deptClause}`;

    const result = await pool.query(
      `SELECT
         b.id AS brand_id,
         b.brand_name,
         COALESCE(MAX(c.category_name), 'Uncategorized') AS category_name,
         s.category_id AS category_id,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)::int AS unsold_count,
         COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL)::int AS sold_count
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       LEFT JOIN category c ON s.category_id = c.id
       WHERE ${whereSql}
       GROUP BY b.id, b.brand_name, s.category_id
       HAVING COUNT(s.id) FILTER (WHERE s.sale_date IS NULL) >= 1
       ORDER BY
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NOT NULL))::numeric / NULLIF(COUNT(s.id), 0) ASC NULLS LAST,
         (COUNT(s.id) FILTER (WHERE s.sale_date IS NULL)) DESC NULLS LAST,
         brand_name ASC,
         category_name ASC
       LIMIT $${limitIdx}`,
      params
    );

    res.json({
      rows: result.rows ?? [],
      type_key: req.params.typeKey,
      limit,
    });
  } catch (error) {
    console.error('stock-categories type unsold-inventory-by-brand-category failed:', error);
    res.status(500).json({ error: 'Failed to load unsold by brand and category', details: error.message });
  }
});

/**
 * Sold vs in-stock counts by size (category_size) within this clothing type.
 * GET /api/stock-categories/type/:typeKey/sold-and-stock-by-size
 */
app.get('/api/stock-categories/type/:typeKey/sold-and-stock-by-size', async (req, res) => {
  try {
    const parsed = parseStockClothingTypeTypeKey(req.params.typeKey);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid clothing type key' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    if (!parsed.uncategorized) {
      const catCheck = await pool.query('SELECT id FROM category WHERE id = $1', [parsed.categoryId]);
      if (!catCheck.rowCount) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);
    const typeWhere = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const qParams = parsed.uncategorized ? [] : [parsed.categoryId];
    let deptClause = '';
    if (filterDeptId != null) {
      qParams.push(filterDeptId);
      deptClause = ` AND b.department_id = $${qParams.length}`;
    }

    const result = await pool.query(
      `SELECT
         s.category_size_id,
         COALESCE(
           sz.size_label,
           CASE WHEN s.category_size_id IS NULL THEN '(no size)' ELSE '(unknown size)' END
         ) AS size_label,
         COUNT(*) FILTER (WHERE s.sale_date IS NOT NULL)::int AS sold_count,
         COUNT(*) FILTER (WHERE s.sale_date IS NULL)::int AS in_stock_count
       FROM stock s
       INNER JOIN brand b ON b.id = s.brand_id
       LEFT JOIN category_size sz ON sz.id = s.category_size_id
       WHERE ${typeWhere}${deptClause}
       GROUP BY s.category_size_id, sz.size_label, sz.sort_order
       ORDER BY COALESCE(sz.sort_order, 2147483647) ASC, size_label ASC`,
      qParams
    );

    res.json({ rows: result.rows ?? [], type_key: req.params.typeKey });
  } catch (error) {
    console.error('stock-categories type sold-and-stock-by-size failed:', error);
    res.status(500).json({ error: 'Failed to load size breakdown', details: error.message });
  }
});

/**
 * Stock lines for one brand scoped to this clothing type.
 * GET /api/stock-categories/type/:typeKey/brand-inventory-items?brand_id=…
 */
app.get('/api/stock-categories/type/:typeKey/brand-inventory-items', async (req, res) => {
  try {
    const parsed = parseStockClothingTypeTypeKey(req.params.typeKey);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid clothing type key' });
    }

    const brandId = parseInt(String(req.query.brand_id ?? ''), 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'brand_id is required' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    if (!parsed.uncategorized) {
      const catCheck = await pool.query('SELECT id FROM category WHERE id = $1', [parsed.categoryId]);
      if (!catCheck.rowCount) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }

    const brandCheck = await pool.query('SELECT id, brand_name FROM brand WHERE id = $1', [brandId]);
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);
    const qParams = [brandId];
    let typeClause = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $2';
    if (!parsed.uncategorized) qParams.push(parsed.categoryId);
    if (filterDeptId != null) {
      qParams.push(filterDeptId);
      typeClause += ` AND b.department_id = $${qParams.length}`;
    }

    const hasStock = await pool.query(
      `SELECT 1 FROM stock s INNER JOIN brand b ON b.id = s.brand_id
       WHERE b.id = $1 AND ${typeClause} LIMIT 1`,
      qParams
    );
    if (!hasStock.rowCount) {
      return res.status(404).json({ error: 'No stock for this brand in this clothing type' });
    }

    const brandName = String(brandCheck.rows[0].brand_name ?? '');

    const result = await pool.query(
      `SELECT
         s.id,
         s.item_name,
         s.purchase_price,
         s.purchase_date,
         s.sale_date,
         s.category_id,
         COALESCE(c.category_name, 'Uncategorized') AS category_name
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       LEFT JOIN category c ON s.category_id = c.id
       WHERE b.id = $1
         AND ${typeClause}
       ORDER BY s.purchase_date DESC NULLS LAST, s.id DESC
       LIMIT 5000`,
      qParams
    );

    res.json({
      rows: result.rows ?? [],
      brand_id: brandId,
      brand_name: brandName,
      stock_category_id: parsed.uncategorized ? null : parsed.categoryId,
    });
  } catch (error) {
    console.error('stock-categories type brand-inventory-items failed:', error);
    res.status(500).json({ error: 'Failed to load brand inventory items', details: error.message });
  }
});

/**
 * Clothing type overview: same spend/sell metrics shape as GET /api/brands/:id/stock-summary (period=all),
 * plus every stock line in this type (all brands).
 * GET /api/stock-categories/type/:typeKey/detail
 */
app.get('/api/stock-categories/type/:typeKey/detail', async (req, res) => {
  try {
    const parsed = parseStockClothingTypeTypeKey(req.params.typeKey);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid clothing type key' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    if (!parsed.uncategorized) {
      const catCheck = await pool.query('SELECT id FROM category WHERE id = $1', [parsed.categoryId]);
      if (!catCheck.rowCount) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);
    const qParams = parsed.uncategorized ? [filterDeptId] : [parsed.categoryId, filterDeptId];
    const scopeWhere = parsed.uncategorized
      ? `s.category_id IS NULL AND ($1::int IS NULL OR b.department_id = $1::int)`
      : `s.category_id = $1 AND ($2::int IS NULL OR b.department_id = $2::int)`;

    const lifetimeCountResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM stock s INNER JOIN brand b ON b.id = s.brand_id WHERE ${scopeWhere}`,
      qParams
    );
    const stockRowCountLifetime = Number(lifetimeCountResult.rows[0]?.c) || 0;

    const countsResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total_items,
         COUNT(*) FILTER (
           WHERE s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
         )::int AS sold_count,
         COUNT(*) FILTER (
           WHERE NOT (s.sale_price IS NOT NULL AND s.sale_price::numeric > 0)
         )::int AS unsold_count
       FROM stock s
       INNER JOIN brand b ON b.id = s.brand_id
       WHERE ${scopeWhere}`,
      qParams
    );
    const countsRow = countsResult.rows[0] || {};
    const totalItems = Number(countsRow.total_items) || 0;
    const soldCount = Number(countsRow.sold_count) || 0;
    const unsoldCount = Number(countsRow.unsold_count) || 0;

    const moneyResult = await pool.query(
      `SELECT
         COALESCE(
           SUM(s.purchase_price::numeric) FILTER (WHERE s.purchase_price IS NOT NULL),
           0
         )::numeric AS total_purchase_spend,
         COALESCE(
           SUM(s.sale_price::numeric) FILTER (
             WHERE s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
           ),
           0
         )::numeric AS total_sold_revenue
       FROM stock s
       INNER JOIN brand b ON b.id = s.brand_id
       WHERE ${scopeWhere}`,
      qParams
    );
    const moneyRow = moneyResult.rows[0] || {};
    const totalPurchaseSpend = Number(moneyRow.total_purchase_spend) || 0;
    const totalSoldRevenue = Number(moneyRow.total_sold_revenue) || 0;
    const brandNetPosition = totalSoldRevenue - totalPurchaseSpend;

    const soldPriceStatsResult = await pool.query(
      `SELECT
         MIN(s.sale_price::numeric) FILTER (
           WHERE s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
         ) AS min_sold_sale_price,
         MAX(s.sale_price::numeric) FILTER (
           WHERE s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
         ) AS max_sold_sale_price,
         AVG(s.sale_price::numeric / NULLIF(s.purchase_price::numeric, 0)) FILTER (
           WHERE s.sale_price IS NOT NULL
             AND s.sale_price::numeric > 0
             AND s.purchase_price IS NOT NULL
             AND s.purchase_price::numeric > 0
         ) AS avg_sold_profit_multiple
       FROM stock s
       INNER JOIN brand b ON b.id = s.brand_id
       WHERE ${scopeWhere}`,
      qParams
    );
    const soldPriceStats = soldPriceStatsResult.rows[0] || {};
    const minSoldSalePriceRaw = soldPriceStats.min_sold_sale_price;
    const maxSoldSalePriceRaw = soldPriceStats.max_sold_sale_price;
    const minSoldSalePrice =
      minSoldSalePriceRaw != null && Number.isFinite(Number(minSoldSalePriceRaw))
        ? Number(minSoldSalePriceRaw)
        : null;
    const maxSoldSalePrice =
      maxSoldSalePriceRaw != null && Number.isFinite(Number(maxSoldSalePriceRaw))
        ? Number(maxSoldSalePriceRaw)
        : null;
    const avgSoldProfitMultipleRaw = soldPriceStats.avg_sold_profit_multiple;
    const avgSoldProfitMultiple =
      avgSoldProfitMultipleRaw != null && Number.isFinite(Number(avgSoldProfitMultipleRaw))
        ? Number(avgSoldProfitMultipleRaw)
        : null;

    const itemsResult = await pool.query(
      `SELECT
         s.id,
         s.item_name,
         s.purchase_price,
         s.purchase_date,
         s.sale_date,
         s.sale_price,
         b.id AS brand_id,
         b.brand_name,
         s.category_size_id,
         COALESCE(
           sz.size_label,
           CASE WHEN s.category_size_id IS NULL THEN '(no size)' ELSE '(unknown size)' END
         ) AS size_label,
         s.ebay_id,
         s.vinted_id
       FROM stock s
       INNER JOIN brand b ON b.id = s.brand_id
       LEFT JOIN category_size sz ON sz.id = s.category_size_id
       WHERE ${scopeWhere}
       ORDER BY s.purchase_date DESC NULLS LAST, s.id DESC
       LIMIT 5000`,
      qParams
    );

    res.json({
      brandId: 0,
      typeKey: req.params.typeKey,
      period: 'all',
      stockRowCountLifetime,
      totalItems,
      soldCount,
      unsoldCount,
      totalPurchaseSpend,
      totalSoldRevenue,
      brandNetPosition,
      minSoldSalePrice,
      maxSoldSalePrice,
      avgSoldProfitMultiple,
      bestSoldByCategory: [],
      heavyUnsoldByCategory: [],
      categorySoldUnsold: [],
      rows: itemsResult.rows ?? [],
    });
  } catch (error) {
    console.error('stock-categories type detail failed:', error);
    res.status(500).json({ error: 'Failed to load clothing type detail', details: error.message });
  }
});

/**
 * Unsold lines for one brand within this clothing type (full type scope — no inner category filter).
 * GET /api/stock-categories/type/:typeKey/unsold-stock-items?brand_id=…
 */
app.get('/api/stock-categories/type/:typeKey/unsold-stock-items', async (req, res) => {
  try {
    const parsed = parseStockClothingTypeTypeKey(req.params.typeKey);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid clothing type key' });
    }

    const brandId = parseInt(String(req.query.brand_id ?? ''), 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'brand_id is required' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    if (!parsed.uncategorized) {
      const catCheck = await pool.query('SELECT id FROM category WHERE id = $1', [parsed.categoryId]);
      if (!catCheck.rowCount) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);
    const typeSql = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const params = parsed.uncategorized ? [brandId] : [parsed.categoryId, brandId];
    const brandSlot = parsed.uncategorized ? '$1' : '$2';
    let deptClause = '';
    if (filterDeptId != null) {
      params.push(filterDeptId);
      deptClause = ` AND b.department_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
         s.id,
         s.item_name,
         s.purchase_price,
         s.purchase_date,
         s.vinted_id,
         s.ebay_id
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       WHERE ${typeSql}
         AND b.id = ${brandSlot}${deptClause}
         AND s.sale_date IS NULL
       ORDER BY s.purchase_date DESC NULLS LAST, s.id DESC
       LIMIT 500`,
      params
    );

    res.json({ rows: result.rows ?? [], brand_id: brandId, type_key: req.params.typeKey });
  } catch (error) {
    console.error('stock-categories type unsold-stock-items failed:', error);
    res.status(500).json({ error: 'Failed to load unsold stock items', details: error.message });
  }
});

/**
 * Sold lines for one brand within this clothing type.
 * GET /api/stock-categories/type/:typeKey/sold-stock-items?brand_id=…
 */
app.get('/api/stock-categories/type/:typeKey/sold-stock-items', async (req, res) => {
  try {
    const parsed = parseStockClothingTypeTypeKey(req.params.typeKey);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid clothing type key' });
    }

    const brandId = parseInt(String(req.query.brand_id ?? ''), 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'brand_id is required' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    if (!parsed.uncategorized) {
      const catCheck = await pool.query('SELECT id FROM category WHERE id = $1', [parsed.categoryId]);
      if (!catCheck.rowCount) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }

    const filterDeptId = parseOptionalBrandDepartmentFilter(req);
    const typeSql = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const params = parsed.uncategorized ? [brandId] : [parsed.categoryId, brandId];
    const brandSlot = parsed.uncategorized ? '$1' : '$2';
    let deptClause = '';
    if (filterDeptId != null) {
      params.push(filterDeptId);
      deptClause = ` AND b.department_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
         s.id,
         s.item_name,
         s.purchase_price,
         s.purchase_date,
         s.sale_date,
         s.vinted_id,
         s.ebay_id
       FROM stock s
       INNER JOIN brand b ON s.brand_id = b.id
       WHERE ${typeSql}
         AND b.id = ${brandSlot}${deptClause}
         AND s.sale_date IS NOT NULL
       ORDER BY s.sale_date DESC NULLS LAST, s.id DESC
       LIMIT 500`,
      params
    );

    res.json({ rows: result.rows ?? [], brand_id: brandId, type_key: req.params.typeKey });
  } catch (error) {
    console.error('stock-categories type sold-stock-items failed:', error);
    res.status(500).json({ error: 'Failed to load sold stock items', details: error.message });
  }
});

async function ensureBrandLinksTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.brand_links (
      id SERIAL PRIMARY KEY,
      brand_id INTEGER NOT NULL REFERENCES public.brand (id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      link_text TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_brand_links_brand_id ON public.brand_links (brand_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_brand_links_created_at ON public.brand_links (brand_id, created_at DESC);
  `);
}

async function ensureBrandExamplePricingTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.brand_example_pricing (
      id SERIAL PRIMARY KEY,
      brand_id INTEGER NOT NULL REFERENCES public.brand (id) ON DELETE CASCADE,
      item_name VARCHAR(500) NOT NULL,
      price_gbp NUMERIC(12, 2) NOT NULL CHECK (price_gbp >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_brand_example_pricing_brand_id
      ON public.brand_example_pricing (brand_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_brand_example_pricing_created_at
      ON public.brand_example_pricing (brand_id, created_at DESC, id DESC);
  `);
}

/**
 * Example pricing lines for a brand (Research).
 * GET /api/brands/:brandId/example-pricing
 */
app.get('/api/brands/:brandId/example-pricing', async (req, res) => {
  try {
    const brandId = parseInt(req.params.brandId, 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'Invalid brand id' });
    }
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureBrandExamplePricingTable(pool);
    const brandCheck = await pool.query('SELECT id FROM brand WHERE id = $1', [brandId]);
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    const result = await pool.query(
      `SELECT id, brand_id, item_name, price_gbp, created_at
       FROM brand_example_pricing
       WHERE brand_id = $1
       ORDER BY created_at ASC, id ASC`,
      [brandId]
    );
    res.json({ rows: result.rows });
  } catch (error) {
    console.error('brand example pricing list failed:', error);
    res.status(500).json({ error: 'Failed to load example pricing', details: error.message });
  }
});

/**
 * POST /api/brands/:brandId/example-pricing  body: { item_name, price_gbp }
 */
app.post('/api/brands/:brandId/example-pricing', async (req, res) => {
  try {
    const brandId = parseInt(req.params.brandId, 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'Invalid brand id' });
    }
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureBrandExamplePricingTable(pool);
    const brandCheck = await pool.query('SELECT id FROM brand WHERE id = $1', [brandId]);
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const body = req.body ?? {};
    const nameRaw = body.item_name;
    if (typeof nameRaw !== 'string' || !nameRaw.trim()) {
      return res.status(400).json({ error: 'item_name is required' });
    }
    const item_name = nameRaw.trim().slice(0, 500);

    const priceRaw = body.price_gbp;
    let priceNum;
    if (typeof priceRaw === 'number' && Number.isFinite(priceRaw)) {
      priceNum = priceRaw;
    } else if (typeof priceRaw === 'string' && priceRaw.trim()) {
      priceNum = parseFloat(priceRaw.trim().replace(/,/g, ''));
    } else {
      return res.status(400).json({ error: 'price_gbp is required (number)' });
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({ error: 'price_gbp must be a non-negative number' });
    }
    const price_gbp = Math.round(priceNum * 100) / 100;

    const result = await pool.query(
      `INSERT INTO brand_example_pricing (brand_id, item_name, price_gbp)
       VALUES ($1, $2, $3)
       RETURNING id, brand_id, item_name, price_gbp, created_at`,
      [brandId, item_name, price_gbp]
    );
    res.status(201).json({ row: result.rows[0] });
  } catch (error) {
    console.error('brand example pricing create failed:', error);
    res.status(500).json({ error: 'Failed to save example pricing', details: error.message });
  }
});

/**
 * DELETE /api/brands/:brandId/example-pricing/:rowId
 */
app.delete('/api/brands/:brandId/example-pricing/:rowId', async (req, res) => {
  try {
    const brandId = parseInt(req.params.brandId, 10);
    const rowId = parseInt(req.params.rowId, 10);
    if (Number.isNaN(brandId) || brandId < 1 || Number.isNaN(rowId) || rowId < 1) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureBrandExamplePricingTable(pool);
    const result = await pool.query(
      'DELETE FROM brand_example_pricing WHERE id = $1 AND brand_id = $2 RETURNING id',
      [rowId, brandId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Row not found' });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('brand example pricing delete failed:', error);
    res.status(500).json({ error: 'Failed to delete example pricing', details: error.message });
  }
});

/**
 * Saved reference links for a brand (Research).
 * GET /api/brands/:brandId/links
 */
app.get('/api/brands/:brandId/links', async (req, res) => {
  try {
    const brandId = parseInt(req.params.brandId, 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'Invalid brand id' });
    }
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureBrandLinksTable(pool);
    const brandCheck = await pool.query('SELECT id FROM brand WHERE id = $1', [brandId]);
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    const result = await pool.query(
      `SELECT id, brand_id, url, link_text, created_at
       FROM brand_links
       WHERE brand_id = $1
       ORDER BY created_at DESC, id DESC`,
      [brandId]
    );
    res.json({ rows: result.rows });
  } catch (error) {
    console.error('brand links list failed:', error);
    res.status(500).json({ error: 'Failed to load brand links', details: error.message });
  }
});

/**
 * POST /api/brands/:brandId/links  body: { url, linkText? }  (linkText stored as link_text)
 */
app.post('/api/brands/:brandId/links', async (req, res) => {
  try {
    const brandId = parseInt(req.params.brandId, 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'Invalid brand id' });
    }
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    await ensureBrandLinksTable(pool);
    const brandCheck = await pool.query('SELECT id FROM brand WHERE id = $1', [brandId]);
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const body = req.body ?? {};
    const urlRaw = body.url;
    if (typeof urlRaw !== 'string' || !urlRaw.trim()) {
      return res.status(400).json({ error: 'url is required' });
    }
    let url = urlRaw.trim().slice(0, 2048);
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    let linkText = null;
    if (body.linkText != null && body.linkText !== '') {
      if (typeof body.linkText !== 'string') {
        return res.status(400).json({ error: 'linkText must be a string or omitted' });
      }
      const t = body.linkText.trim();
      linkText = t ? t.slice(0, 500) : null;
    }
    if (body.link_text != null && body.link_text !== '' && linkText == null) {
      if (typeof body.link_text !== 'string') {
        return res.status(400).json({ error: 'link_text must be a string or omitted' });
      }
      const t = body.link_text.trim();
      linkText = t ? t.slice(0, 500) : null;
    }

    const result = await pool.query(
      `INSERT INTO brand_links (brand_id, url, link_text)
       VALUES ($1, $2, $3)
       RETURNING id, brand_id, url, link_text, created_at`,
      [brandId, url, linkText]
    );
    res.status(201).json({ row: result.rows[0] });
  } catch (error) {
    console.error('brand links create failed:', error);
    res.status(500).json({ error: 'Failed to save link', details: error.message });
  }
});

/**
 * Brand research: stock sold vs unsold, category breakdown (best sold vs heavy unsold), stacked category chart.
 * GET /api/brands/:brandId/stock-summary?period=all|last_12_months|2026|2025
 * When period is not all: rows included are sold lines with sale_date in range OR unsold with purchase_date in range.
 */
app.get('/api/brands/:brandId/stock-summary', async (req, res) => {
  try {
    const brandId = parseInt(req.params.brandId, 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'Invalid brand id' });
    }

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const brandCheck = await pool.query('SELECT id FROM brand WHERE id = $1', [brandId]);
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const rawPeriod = String(req.query.period ?? 'all').trim().toLowerCase();
    const period =
      rawPeriod === 'last_12_months' || rawPeriod === '2026' || rawPeriod === '2025'
        ? rawPeriod
        : 'all';

    let periodSql = '';
    if (period === 'last_12_months') {
      periodSql = `
        AND (
          (
            s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
            AND s.sale_date IS NOT NULL
            AND s.sale_date >= (CURRENT_DATE - INTERVAL '12 months')
          )
          OR
          (
            NOT (s.sale_price IS NOT NULL AND s.sale_price::numeric > 0)
            AND s.purchase_date IS NOT NULL
            AND s.purchase_date >= (CURRENT_DATE - INTERVAL '12 months')
          )
        )`;
    } else if (period === '2026') {
      periodSql = `
        AND (
          (
            s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
            AND s.sale_date IS NOT NULL
            AND s.sale_date >= DATE '2026-01-01' AND s.sale_date < DATE '2027-01-01'
          )
          OR
          (
            NOT (s.sale_price IS NOT NULL AND s.sale_price::numeric > 0)
            AND s.purchase_date IS NOT NULL
            AND s.purchase_date >= DATE '2026-01-01' AND s.purchase_date < DATE '2027-01-01'
          )
        )`;
    } else if (period === '2025') {
      periodSql = `
        AND (
          (
            s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
            AND s.sale_date IS NOT NULL
            AND s.sale_date >= DATE '2025-01-01' AND s.sale_date < DATE '2026-01-01'
          )
          OR
          (
            NOT (s.sale_price IS NOT NULL AND s.sale_price::numeric > 0)
            AND s.purchase_date IS NOT NULL
            AND s.purchase_date >= DATE '2025-01-01' AND s.purchase_date < DATE '2026-01-01'
          )
        )`;
    }

    const lifetimeCountResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM stock s WHERE s.brand_id = $1`,
      [brandId]
    );
    const stockRowCountLifetime = Number(lifetimeCountResult.rows[0]?.c) || 0;

    const countsResult = await pool.query(
      `
        SELECT
          COUNT(*)::int AS total_items,
          COUNT(*) FILTER (
            WHERE s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
          )::int AS sold_count,
          COUNT(*) FILTER (
            WHERE NOT (s.sale_price IS NOT NULL AND s.sale_price::numeric > 0)
          )::int AS unsold_count
        FROM stock s
        WHERE s.brand_id = $1
        ${periodSql}
      `,
      [brandId]
    );

    const countsRow = countsResult.rows[0] || {};
    const totalItems = Number(countsRow.total_items) || 0;
    const soldCount = Number(countsRow.sold_count) || 0;
    const unsoldCount = Number(countsRow.unsold_count) || 0;

    const moneyResult = await pool.query(
      `
        SELECT
          COALESCE(
            SUM(s.purchase_price::numeric) FILTER (WHERE s.purchase_price IS NOT NULL),
            0
          )::numeric AS total_purchase_spend,
          COALESCE(
            SUM(s.sale_price::numeric) FILTER (
              WHERE s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
            ),
            0
          )::numeric AS total_sold_revenue
        FROM stock s
        WHERE s.brand_id = $1
        ${periodSql}
      `,
      [brandId]
    );
    const moneyRow = moneyResult.rows[0] || {};
    const totalPurchaseSpend = Number(moneyRow.total_purchase_spend) || 0;
    const totalSoldRevenue = Number(moneyRow.total_sold_revenue) || 0;
    const brandNetPosition = totalSoldRevenue - totalPurchaseSpend;

    const soldPriceStatsResult = await pool.query(
      `
        SELECT
          MIN(s.sale_price::numeric) FILTER (
            WHERE s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
          ) AS min_sold_sale_price,
          MAX(s.sale_price::numeric) FILTER (
            WHERE s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
          ) AS max_sold_sale_price,
          AVG(s.sale_price::numeric / NULLIF(s.purchase_price::numeric, 0)) FILTER (
            WHERE s.sale_price IS NOT NULL
              AND s.sale_price::numeric > 0
              AND s.purchase_price IS NOT NULL
              AND s.purchase_price::numeric > 0
          ) AS avg_sold_profit_multiple
        FROM stock s
        WHERE s.brand_id = $1
        ${periodSql}
      `,
      [brandId]
    );
    const soldPriceStats = soldPriceStatsResult.rows[0] || {};
    const minSoldSalePriceRaw = soldPriceStats.min_sold_sale_price;
    const maxSoldSalePriceRaw = soldPriceStats.max_sold_sale_price;
    const minSoldSalePrice =
      minSoldSalePriceRaw != null && Number.isFinite(Number(minSoldSalePriceRaw))
        ? Number(minSoldSalePriceRaw)
        : null;
    const maxSoldSalePrice =
      maxSoldSalePriceRaw != null && Number.isFinite(Number(maxSoldSalePriceRaw))
        ? Number(maxSoldSalePriceRaw)
        : null;
    const avgSoldProfitMultipleRaw = soldPriceStats.avg_sold_profit_multiple;
    const avgSoldProfitMultiple =
      avgSoldProfitMultipleRaw != null && Number.isFinite(Number(avgSoldProfitMultipleRaw))
        ? Number(avgSoldProfitMultipleRaw)
        : null;

    const categoryAggSql = `
      SELECT
        COALESCE(c.id, 0)::int AS category_id,
        COALESCE(c.category_name, 'Uncategorized') AS category_name,
        COALESCE(SUM(s.sale_price::numeric) FILTER (
          WHERE s.sale_price IS NOT NULL
            AND TRIM(s.sale_price::text) <> ''
            AND s.sale_price::numeric > 0
        ), 0)::numeric AS total_sold_value,
        COALESCE(SUM(s.purchase_price::numeric) FILTER (
          WHERE NOT (
            s.sale_price IS NOT NULL
            AND TRIM(s.sale_price::text) <> ''
            AND s.sale_price::numeric > 0
          )
            AND s.purchase_price IS NOT NULL
            AND TRIM(s.purchase_price::text) <> ''
            AND s.purchase_price::numeric > 0
        ), 0)::numeric AS total_unsold_value,
        COALESCE(SUM(
          CASE
            WHEN s.sale_price IS NOT NULL
             AND TRIM(s.sale_price::text) <> ''
             AND s.sale_price::numeric > 0
             AND s.purchase_price IS NOT NULL
             AND TRIM(s.purchase_price::text) <> ''
             AND s.purchase_price::numeric > 0
            THEN s.sale_price::numeric - s.purchase_price::numeric
            ELSE 0
          END
        ), 0)::numeric AS total_profit,
        CASE
          WHEN COALESCE(SUM(s.purchase_price::numeric) FILTER (
            WHERE s.sale_price IS NOT NULL
              AND TRIM(s.sale_price::text) <> ''
              AND s.sale_price::numeric > 0
              AND s.purchase_price IS NOT NULL
              AND TRIM(s.purchase_price::text) <> ''
              AND s.purchase_price::numeric > 0
          ), 0) > 0
          THEN (
            COALESCE(SUM(s.sale_price::numeric) FILTER (
              WHERE s.sale_price IS NOT NULL
                AND TRIM(s.sale_price::text) <> ''
                AND s.sale_price::numeric > 0
                AND s.purchase_price IS NOT NULL
                AND TRIM(s.purchase_price::text) <> ''
                AND s.purchase_price::numeric > 0
            ), 0)::numeric
          ) / NULLIF(
            COALESCE(SUM(s.purchase_price::numeric) FILTER (
              WHERE s.sale_price IS NOT NULL
                AND TRIM(s.sale_price::text) <> ''
                AND s.sale_price::numeric > 0
                AND s.purchase_price IS NOT NULL
                AND TRIM(s.purchase_price::text) <> ''
                AND s.purchase_price::numeric > 0
            ), 0)::numeric,
            0
          )
          ELSE NULL
        END AS sales_multiple
      FROM stock s
      LEFT JOIN category c ON c.id = s.category_id
      WHERE s.brand_id = $1
        ${periodSql}
      GROUP BY c.id, c.category_name
      HAVING
        COALESCE(SUM(s.sale_price::numeric) FILTER (
          WHERE s.sale_price IS NOT NULL
            AND TRIM(s.sale_price::text) <> ''
            AND s.sale_price::numeric > 0
        ), 0) > 0
        OR COALESCE(SUM(s.purchase_price::numeric) FILTER (
          WHERE NOT (
            s.sale_price IS NOT NULL
            AND TRIM(s.sale_price::text) <> ''
            AND s.sale_price::numeric > 0
          )
            AND s.purchase_price IS NOT NULL
            AND TRIM(s.purchase_price::text) <> ''
            AND s.purchase_price::numeric > 0
        ), 0) > 0
    `;

    const mapCategoryRow = (row) => ({
      categoryId: row.category_id != null ? Number(row.category_id) : 0,
      categoryName: row.category_name != null ? String(row.category_name) : 'Uncategorized',
      totalSoldValue: row.total_sold_value != null ? Number(row.total_sold_value) : 0,
      totalUnsoldValue: row.total_unsold_value != null ? Number(row.total_unsold_value) : 0,
      totalProfit: row.total_profit != null ? Number(row.total_profit) : 0,
      salesMultiple:
        row.sales_multiple != null && Number.isFinite(Number(row.sales_multiple))
          ? Number(row.sales_multiple)
          : null,
    });

    const categoryAggSub = categoryAggSql.trim();
    const bestSoldByCategoryResult = await pool.query(
      `SELECT * FROM (${categoryAggSub}) cat
      WHERE cat.total_sold_value > 0
      ORDER BY cat.total_sold_value DESC NULLS LAST, cat.total_unsold_value ASC NULLS LAST, cat.category_name ASC
      LIMIT 30`,
      [brandId]
    );
    const bestSoldByCategory = bestSoldByCategoryResult.rows.map(mapCategoryRow);

    const heavyUnsoldByCategoryResult = await pool.query(
      `SELECT * FROM (${categoryAggSub}) cat
      WHERE cat.total_unsold_value > 0
      ORDER BY cat.total_unsold_value DESC NULLS LAST, cat.total_sold_value ASC NULLS LAST, cat.category_name ASC
      LIMIT 30`,
      [brandId]
    );
    const heavyUnsoldByCategory = heavyUnsoldByCategoryResult.rows.map(mapCategoryRow);

    const categorySoldUnsoldResult = await pool.query(
      `
        SELECT
          COALESCE(c.id, 0)::int AS category_id,
          COALESCE(c.category_name, 'Uncategorized') AS category_name,
          COUNT(*) FILTER (
            WHERE s.sale_price IS NOT NULL AND s.sale_price::numeric > 0
          )::int AS sold_count,
          COUNT(*) FILTER (
            WHERE NOT (s.sale_price IS NOT NULL AND s.sale_price::numeric > 0)
          )::int AS unsold_count
        FROM stock s
        LEFT JOIN category c ON c.id = s.category_id
        WHERE s.brand_id = $1
        ${periodSql}
        GROUP BY c.id, c.category_name
        ORDER BY COUNT(*) DESC, COALESCE(c.category_name, 'Uncategorized') ASC
      `,
      [brandId]
    );

    const categorySoldUnsold = categorySoldUnsoldResult.rows.map((row) => ({
      category_id: row.category_id != null ? Number(row.category_id) : 0,
      category_name: row.category_name != null ? String(row.category_name) : 'Uncategorized',
      sold_count: Number(row.sold_count) || 0,
      unsold_count: Number(row.unsold_count) || 0,
    }));

    res.json({
      brandId,
      period,
      stockRowCountLifetime,
      totalItems,
      soldCount,
      unsoldCount,
      totalPurchaseSpend,
      totalSoldRevenue,
      brandNetPosition,
      minSoldSalePrice,
      maxSoldSalePrice,
      avgSoldProfitMultiple,
      bestSoldByCategory,
      heavyUnsoldByCategory,
      categorySoldUnsold,
    });
  } catch (error) {
    console.error('Brand stock summary failed:', error);
    res.status(500).json({ error: 'Failed to load brand stock summary', details: error.message });
  }
});

/**
 * eBay sold comps cache (24h validity). Rows for a brand share the same fetched_at from the last sync.
 * GET /api/brands/:brandId/ebay-sold-cache?limit=20&days=120
 */
app.get('/api/brands/:brandId/ebay-sold-cache', async (req, res) => {
  try {
    const brandId = parseInt(req.params.brandId, 10);
    if (Number.isNaN(brandId) || brandId < 1) {
      return res.status(400).json({ error: 'Invalid brand id' });
    }

    let limit = parseInt(String(req.query.limit ?? '20'), 10);
    if (Number.isNaN(limit)) limit = 20;
    limit = Math.min(50, Math.max(1, limit));

    let days = parseInt(String(req.query.days ?? '120'), 10);
    if (Number.isNaN(days)) days = 120;
    days = Math.min(365, Math.max(14, days));

    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const brandCheck = await pool.query('SELECT id FROM brand WHERE id = $1', [brandId]);
    if (!brandCheck.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    const result = await pool.query(
      `SELECT ebay_item_id, title, image_url, item_web_url, price_value, price_currency, condition_label, fetched_at
       FROM ebay_sold_listing_cache
       WHERE brand_id = $1
         AND fetched_at >= NOW() - INTERVAL '24 hours'
       ORDER BY id ASC`,
      [brandId]
    );

    if (result.rowCount === 0) {
      return res.json({
        cached: false,
        message: 'No Cached data',
        items: [],
        fetchedAt: null,
        limit,
        days
      });
    }

    let maxTs = 0;
    for (const row of result.rows) {
      if (row.fetched_at) {
        const t = new Date(row.fetched_at).getTime();
        if (t > maxTs) maxTs = t;
      }
    }

    res.json({
      cached: true,
      items: result.rows.map(mapEbaySoldCacheRow),
      fetchedAt: maxTs ? new Date(maxTs).toISOString() : null,
      limit,
      days
    });
  } catch (error) {
    if (error.code === '42P01') {
      return res.status(503).json({
        error: 'ebay_sold_listing_cache table missing',
        details: 'Run database/ebay_sold_listing_cache.sql in your database.'
      });
    }
    if (error.code === '42703') {
      return res.status(503).json({
        error: 'ebay_sold_listing_cache schema out of date',
        details:
          'Run database/ebay_sold_listing_cache_add_condition_label.sql in your database (adds condition_label). No server reboot required after migrating.'
      });
    }
    console.error('eBay sold cache GET failed:', error);
    return res.status(500).json({ error: 'Failed to read eBay sold cache', details: error.message });
  }
});

/**
 * DELETE this brand's cache rows, fetch from eBay, re-insert.
 * POST /api/brands/:brandId/ebay-sold-cache/sync
 * Body: { limit?: number, days?: number }
 */
app.post('/api/brands/:brandId/ebay-sold-cache/sync', async (req, res) => {
  const brandId = parseInt(req.params.brandId, 10);
  if (Number.isNaN(brandId) || brandId < 1) {
    return res.status(400).json({ error: 'Invalid brand id' });
  }

  let limit = parseInt(String(req.body?.limit ?? '20'), 10);
  if (Number.isNaN(limit)) limit = 20;
  limit = Math.min(50, Math.max(1, limit));

  let days = parseInt(String(req.body?.days ?? '120'), 10);
  if (Number.isNaN(days)) days = 120;
  days = Math.min(365, Math.max(14, days));

  const pool = getDatabasePool();
  if (!pool) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }

  const brandRow = await pool.query('SELECT id, brand_name FROM brand WHERE id = $1', [brandId]);
  if (!brandRow.rowCount) {
    return res.status(404).json({ error: 'Brand not found' });
  }

  const brandName =
    typeof brandRow.rows[0].brand_name === 'string' ? brandRow.rows[0].brand_name.trim() : '';
  if (!brandName) {
    return res.status(400).json({ error: 'Brand has no name' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ebay_sold_listing_cache WHERE brand_id = $1', [brandId]);

    let items;
    let qAugmented;
    let total;
    try {
      const out = await fetchEbaySoldItemsFromBrowse(brandName, limit, days);
      items = out.items;
      qAugmented = out.qAugmented;
      total = out.total;
    } catch (e) {
      await client.query('ROLLBACK');
      if (e && e.code === 'EBAY_CREDS_MISSING') {
        return res.status(503).json({
          error: 'eBay credentials not configured',
          details: e.message
        });
      }
      throw e;
    }

    const tagImageId = await resolveBrandTagImageIdForCache(client, brandId);
    const fetchedAt = new Date();
    for (const item of items) {
      await client.query(
        `INSERT INTO ebay_sold_listing_cache
          (brand_id, brand_tag_image_id, ebay_item_id, title, image_url, item_web_url, price_value, price_currency, condition_label, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          brandId,
          tagImageId,
          item.itemId || '',
          item.title || '',
          item.imageUrl,
          item.itemWebUrl,
          item.priceValue,
          item.priceCurrency || 'GBP',
          item.conditionLabel != null ? String(item.conditionLabel) : null,
          fetchedAt
        ]
      );
    }

    await client.query('COMMIT');
    res.json({
      cached: false,
      query: qAugmented,
      marketplaceId: 'EBAY_GB',
      categoryId: EBAY_GB_MENS_CLOTHING_CATEGORY_ID,
      total,
      days,
      limit,
      items,
      fetchedAt: fetchedAt.toISOString()
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* no transaction */
    }
    if (error.code === '42P01') {
      return res.status(503).json({
        error: 'ebay_sold_listing_cache table missing',
        details: 'Run database/ebay_sold_listing_cache.sql in your database.'
      });
    }
    if (error.code === '42703') {
      return res.status(503).json({
        error: 'ebay_sold_listing_cache schema out of date',
        details:
          'Run database/ebay_sold_listing_cache_add_condition_label.sql in your database (adds condition_label). No server reboot required after migrating.'
      });
    }
    console.error('eBay sold cache sync failed:', error);
    return res.status(500).json({
      error: 'Failed to sync eBay sold cache',
      details: error instanceof Error ? error.message : String(error)
    });
  } finally {
    client.release();
  }
});

// Department API (stock clothing-type taxonomy parent)
app.get('/api/departments', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    const result = await pool.query(
      `SELECT d.id, d.department_name, d.created_at, d.updated_at,
              COUNT(c.id)::int AS category_count
       FROM department d
       LEFT JOIN category c ON c.department_id = d.id
       GROUP BY d.id, d.department_name, d.created_at, d.updated_at
       ORDER BY d.department_name ASC`
    );
    res.json({ rows: result.rows ?? [], count: result.rowCount ?? 0 });
  } catch (error) {
    console.error('Departments query failed:', error);
    res.status(500).json({ error: 'Failed to load departments', details: error.message });
  }
});

app.post('/api/departments', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    const { department_name } = req.body ?? {};
    if (!department_name || typeof department_name !== 'string' || !department_name.trim()) {
      return res.status(400).json({ error: 'department_name is required' });
    }
    const name = department_name.trim();
    const dup = await pool.query(
      `SELECT id FROM department WHERE lower(trim(both from department_name)) = lower($1)`,
      [name]
    );
    if (dup.rowCount > 0) {
      return res.status(400).json({ error: 'A department with this name already exists' });
    }
    const ins = await pool.query(
      `INSERT INTO department (department_name) VALUES ($1)
       RETURNING id, department_name, created_at, updated_at`,
      [name]
    );
    const row = ins.rows[0];
    res.status(201).json({ row: { ...row, category_count: 0 } });
  } catch (error) {
    console.error('Department insert failed:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A department with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to create department', details: error.message });
  }
});

app.patch('/api/departments/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid department id' });
    }
    const { department_name } = req.body ?? {};
    if (!department_name || typeof department_name !== 'string' || !department_name.trim()) {
      return res.status(400).json({ error: 'department_name is required' });
    }
    const name = department_name.trim();
    const dup = await pool.query(
      `SELECT id FROM department WHERE lower(trim(both from department_name)) = lower($1) AND id <> $2`,
      [name, id]
    );
    if (dup.rowCount > 0) {
      return res.status(400).json({ error: 'A department with this name already exists' });
    }
    const upd = await pool.query(
      `UPDATE department SET department_name = $1 WHERE id = $2
       RETURNING id, department_name, created_at, updated_at`,
      [name, id]
    );
    if (!upd.rowCount) {
      return res.status(404).json({ error: 'Department not found' });
    }
    const cnt = await pool.query(
      `SELECT COUNT(*)::int AS c FROM category WHERE department_id = $1`,
      [id]
    );
    const category_count = Number(cnt.rows[0]?.c ?? 0);
    res.json({ row: { ...upd.rows[0], category_count } });
  } catch (error) {
    console.error('Department update failed:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'A department with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to update department', details: error.message });
  }
});

app.delete('/api/departments/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid department id' });
    }
    const ref = await pool.query(
      `SELECT COUNT(*)::int AS c FROM category WHERE department_id = $1`,
      [id]
    );
    const c = Number(ref.rows[0]?.c ?? 0);
    if (c > 0) {
      return res.status(400).json({
        error: `Cannot delete: ${c} categor${c === 1 ? 'y uses' : 'ies use'} this department`,
      });
    }
    const del = await pool.query('DELETE FROM department WHERE id = $1 RETURNING id', [id]);
    if (!del.rowCount) {
      return res.status(404).json({ error: 'Department not found' });
    }
    res.json({ ok: true, id });
  } catch (error) {
    console.error('Department delete failed:', error);
    res.status(500).json({ error: 'Failed to delete department', details: error.message });
  }
});

// Category API endpoints
app.get('/api/categories', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const rawDept = req.query.department_id ?? req.query.departmentId;
    let filterDeptId = null;
    if (rawDept !== undefined && rawDept !== null && String(rawDept).trim() !== '') {
      const n = Number(rawDept);
      if (Number.isInteger(n) && n >= 1) {
        filterDeptId = n;
      }
    }
    const params = [];
    let whereSql = '';
    if (filterDeptId !== null) {
      params.push(filterDeptId);
      whereSql = `WHERE c.department_id = $${params.length}`;
    }

    const result = await pool.query(
      `
      SELECT c.id, c.category_name, c.department_id, d.department_name,
             COUNT(s.id)::int AS stock_count
      FROM category c
      LEFT JOIN department d ON d.id = c.department_id
      LEFT JOIN stock s ON s.category_id = c.id
      ${whereSql}
      GROUP BY c.id, c.category_name, c.department_id, d.department_name
      ORDER BY d.department_name ASC NULLS LAST, c.category_name ASC
    `,
      params
    );

    res.json({
      rows: result.rows ?? [],
      count: result.rowCount ?? 0
    });
  } catch (error) {
    console.error('Categories query failed:', error);
    res.status(500).json({ error: 'Failed to load categories data', details: error.message });
  }
});

app.get('/api/category-sizes', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const raw = req.query.categoryId ?? req.query.category_id;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return res.json({ rows: [], count: 0 });
    }

    const categoryId = Number(raw);
    if (!Number.isInteger(categoryId) || categoryId < 1) {
      return res.status(400).json({ error: 'categoryId must be a positive integer' });
    }

    const result = await pool.query(
      `SELECT cs.id, cs.category_id, cs.size_label, cs.sort_order,
              (SELECT COUNT(*)::int FROM stock s WHERE s.category_size_id = cs.id) AS stock_ref_count
       FROM category_size cs
       WHERE cs.category_id = $1
       ORDER BY cs.sort_order ASC, cs.size_label ASC`,
      [categoryId]
    );

    res.json({
      rows: result.rows ?? [],
      count: result.rowCount ?? 0
    });
  } catch (error) {
    console.error('category-sizes query failed:', error);
    res.status(500).json({ error: 'Failed to load category sizes', details: error.message });
  }
});

app.post('/api/category-sizes', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const { category_id, size_label, sort_order } = req.body ?? {};
    const cid = Number(category_id);
    if (!Number.isInteger(cid) || cid < 1) {
      return res.status(400).json({ error: 'category_id must be a positive integer' });
    }
    const label = normalizeTextInput(size_label);
    if (!label) {
      return res.status(400).json({ error: 'size_label is required' });
    }

    const catOk = await pool.query('SELECT 1 FROM category WHERE id = $1', [cid]);
    if (!catOk.rowCount) {
      return res.status(400).json({ error: 'Category not found' });
    }

    let sortVal;
    if (sort_order === undefined || sort_order === null || sort_order === '') {
      const maxR = await pool.query(
        'SELECT COALESCE(MAX(sort_order), 0)::int AS m FROM category_size WHERE category_id = $1',
        [cid]
      );
      sortVal = Number(maxR.rows[0]?.m ?? 0) + 1;
    } else {
      sortVal = Number(sort_order);
      if (!Number.isInteger(sortVal)) {
        return res.status(400).json({ error: 'sort_order must be an integer' });
      }
    }

    const ins = await pool.query(
      `INSERT INTO category_size (category_id, size_label, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, category_id, size_label, sort_order`,
      [cid, label, sortVal]
    );
    const row = ins.rows[0];
    res.status(201).json({
      row: { ...row, stock_ref_count: 0 },
    });
  } catch (error) {
    console.error('category-sizes insert failed:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Duplicate size', details: 'This label already exists for the category.' });
    }
    res.status(500).json({ error: 'Failed to create size', details: error.message });
  }
});

app.put('/api/category-sizes/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid size id' });
    }

    const { size_label, sort_order } = req.body ?? {};
    const hasLabel = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'size_label');
    const hasSort = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'sort_order');

    if (!hasLabel && !hasSort) {
      return res.status(400).json({ error: 'Provide at least one of: size_label, sort_order' });
    }

    const existingR = await pool.query(
      'SELECT id, category_id, size_label, sort_order FROM category_size WHERE id = $1',
      [id]
    );
    if (!existingR.rowCount) {
      return res.status(404).json({ error: 'Size not found' });
    }
    const ex = existingR.rows[0];

    let nextLabel = ex.size_label;
    if (hasLabel) {
      const label = normalizeTextInput(size_label);
      if (!label) {
        return res.status(400).json({ error: 'size_label cannot be empty' });
      }
      nextLabel = label;
    }

    let nextSort = Number(ex.sort_order);
    if (!Number.isInteger(nextSort)) {
      nextSort = 0;
    }
    if (hasSort) {
      if (sort_order === null || sort_order === '') {
        return res.status(400).json({ error: 'sort_order cannot be empty when provided' });
      }
      const sv = Number(sort_order);
      if (!Number.isInteger(sv)) {
        return res.status(400).json({ error: 'sort_order must be an integer' });
      }
      nextSort = sv;
    }

    const upd = await pool.query(
      `UPDATE category_size SET size_label = $1, sort_order = $2 WHERE id = $3
       RETURNING id, category_id, size_label, sort_order`,
      [nextLabel, nextSort, id]
    );
    const row = upd.rows[0];
    const cntR = await pool.query(
      'SELECT COUNT(*)::int AS c FROM stock WHERE category_size_id = $1',
      [id]
    );
    res.json({
      row: { ...row, stock_ref_count: cntR.rows[0]?.c ?? 0 },
    });
  } catch (error) {
    console.error('category-sizes update failed:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Duplicate size', details: 'This label already exists for the category.' });
    }
    res.status(500).json({ error: 'Failed to update size', details: error.message });
  }
});

app.delete('/api/category-sizes/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid size id' });
    }

    const cntR = await pool.query(
      'SELECT COUNT(*)::int AS c FROM stock WHERE category_size_id = $1',
      [id]
    );
    const refCount = cntR.rows[0]?.c ?? 0;
    if (refCount > 0) {
      return res.status(409).json({
        error: 'Size is in use',
        details: `${refCount} stock item(s) use this size. Remove the size from those items before deleting.`,
        refCount,
      });
    }

    const del = await pool.query('DELETE FROM category_size WHERE id = $1 RETURNING id', [id]);
    if (!del.rowCount) {
      return res.status(404).json({ error: 'Size not found' });
    }
    res.json({ ok: true, id });
  } catch (error) {
    console.error('category-sizes delete failed:', error);
    res.status(500).json({ error: 'Failed to delete size', details: error.message });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    await ensureStockCategoryDepartmentSchema(pool);

    const { category_name, department_id: bodyDepartmentId } = req.body ?? {};

    if (!category_name || typeof category_name !== 'string' || !category_name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const normalizedCategoryName = category_name.trim();

    let departmentId =
      bodyDepartmentId === null || bodyDepartmentId === undefined || bodyDepartmentId === ''
        ? null
        : Number(bodyDepartmentId);
    if (departmentId !== null && (!Number.isInteger(departmentId) || departmentId < 1)) {
      return res.status(400).json({ error: 'department_id must be a positive integer when provided' });
    }
    if (departmentId === null) {
      const depRes = await pool.query(
        `SELECT id FROM department
         WHERE lower(trim(both from department_name)) = 'menswear'
         LIMIT 1`
      );
      if (!depRes.rowCount) {
        return res.status(400).json({
          error: 'department_id is required (no Menswear department found to use as default)',
        });
      }
      departmentId = Number(depRes.rows[0].id);
    } else {
      const depOk = await pool.query('SELECT 1 FROM department WHERE id = $1', [departmentId]);
      if (!depOk.rowCount) {
        return res.status(400).json({ error: 'department_id not found' });
      }
    }

    // Same name allowed in different departments; block duplicates within one department (case-insensitive)
    const existingResult = await pool.query(
      `SELECT id FROM category
       WHERE department_id = $1
         AND LOWER(TRIM(BOTH FROM category_name)) = LOWER(TRIM(BOTH FROM $2::text))`,
      [departmentId, normalizedCategoryName]
    );

    if (existingResult.rowCount > 0) {
      return res.status(400).json({
        error: 'A category with this name already exists in this department',
      });
    }

    const insertQuery = `
      INSERT INTO category (category_name, department_id)
      VALUES ($1, $2)
      RETURNING id, category_name, department_id
    `;

    const result = await pool.query(insertQuery, [normalizedCategoryName, departmentId]);

    res.status(201).json({ row: result.rows[0] });
  } catch (error) {
    console.error('Category insert failed:', error);
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'A category with this name already exists in this department',
        hint: 'Run database/category_unique_per_department.sql if this name is only used in another department.',
      });
    }
    res.status(500).json({ error: 'Failed to create category', details: error.message });
  }
});

app.patch('/api/categories/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    await ensureStockCategoryDepartmentSchema(pool);

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    const { category_name, department_id: bodyDepartmentId } = req.body ?? {};

    if (!category_name || typeof category_name !== 'string' || !category_name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const normalizedCategoryName = category_name.trim();

    const currentRow = await pool.query(
      'SELECT id, department_id FROM category WHERE id = $1',
      [id]
    );
    if (!currentRow.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    let finalDepartmentId =
      currentRow.rows[0].department_id !== null && currentRow.rows[0].department_id !== undefined
        ? Number(currentRow.rows[0].department_id)
        : null;

    let departmentIdSql = '';
    const params = [normalizedCategoryName];
    if (bodyDepartmentId !== undefined && bodyDepartmentId !== null && bodyDepartmentId !== '') {
      const did = Number(bodyDepartmentId);
      if (!Number.isInteger(did) || did < 1) {
        return res.status(400).json({ error: 'department_id must be a positive integer' });
      }
      const depOk = await pool.query('SELECT 1 FROM department WHERE id = $1', [did]);
      if (!depOk.rowCount) {
        return res.status(400).json({ error: 'department_id not found' });
      }
      finalDepartmentId = did;
      departmentIdSql = ', department_id = $2';
      params.push(did);
    }

    const dupResult = await pool.query(
      `SELECT id FROM category
       WHERE id <> $1
         AND LOWER(TRIM(BOTH FROM category_name)) = LOWER(TRIM(BOTH FROM $2::text))
         AND department_id IS NOT DISTINCT FROM $3`,
      [id, normalizedCategoryName, finalDepartmentId]
    );

    if (dupResult.rowCount > 0) {
      return res.status(400).json({
        error: 'A category with this name already exists in this department',
      });
    }

    params.push(id);

    const updateQuery = `
      UPDATE category
      SET category_name = $1${departmentIdSql}
      WHERE id = $${params.length}
      RETURNING id, category_name, department_id
    `;

    const result = await pool.query(updateQuery, params);

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ row: result.rows[0] });
  } catch (error) {
    console.error('Category update failed:', error);
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'A category with this name already exists in this department',
      });
    }
    res.status(500).json({ error: 'Failed to update category', details: error.message });
  }
});

/**
 * DELETE /api/categories/:id
 * Allowed only when no stock row references this category_id.
 */
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    const countRes = await pool.query(
      'SELECT COUNT(*)::int AS c FROM stock WHERE category_id = $1',
      [id]
    );
    const stockCount = countRes.rows[0]?.c ?? 0;
    if (stockCount > 0) {
      return res.status(409).json({
        error:
          'Cannot delete this category while stock items are assigned to it. Reassign or clear those items first.',
        stockCount,
      });
    }

    const del = await pool.query('DELETE FROM category WHERE id = $1 RETURNING id', [id]);
    if (!del.rowCount) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Category delete failed:', error);
    res.status(500).json({ error: 'Failed to delete category', details: error.message });
  }
});

// Expenses API endpoints
app.get('/api/expenses', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const result = await pool.query(
      'SELECT id, item, cost, purchase_date, receipt_name, purchase_location FROM expenses ORDER BY purchase_date DESC NULLS LAST, item ASC'
    );

    res.json({
      rows: result.rows ?? [],
      count: result.rowCount ?? 0
    });
  } catch (error) {
    console.error('Expenses query failed:', error);
    res.status(500).json({ error: 'Failed to load expenses data', details: error.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const {
      item,
      cost,
      purchase_date,
      receipt_name,
      purchase_location
    } = req.body ?? {};

    const normalizedItem = normalizeTextInput(item) ?? null;
    const normalizedCost = normalizeDecimalInput(cost, 'cost');
    const normalizedPurchaseDate = normalizeDateInputValue(purchase_date, 'purchase_date');
    const normalizedReceiptName = normalizeTextInput(receipt_name) ?? null;
    const normalizedPurchaseLocation = normalizeTextInput(purchase_location) ?? null;

    const insertQuery = `
      INSERT INTO expenses (item, cost, purchase_date, receipt_name, purchase_location)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, item, cost, purchase_date, receipt_name, purchase_location
    `;

    const result = await pool.query(insertQuery, [
      normalizedItem,
      normalizedCost,
      normalizedPurchaseDate,
      normalizedReceiptName,
      normalizedPurchaseLocation
    ]);

    res.status(201).json({ row: result.rows[0] });
  } catch (error) {
    console.error('Expenses insert failed:', error);
    if (error.status === 400) {
      return res.status(400).json({ error: 'Failed to create expense record', details: error.message });
    }
    res.status(500).json({ error: 'Failed to create expense record', details: error.message });
  }
});

app.put('/api/expenses/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const expenseId = Number(req.params.id);
    if (!Number.isInteger(expenseId)) {
      return res.status(400).json({ error: 'Invalid expense id' });
    }

    const existingResult = await pool.query(
      'SELECT id, item, cost, purchase_date, receipt_name, purchase_location FROM expenses WHERE id = $1',
      [expenseId]
    );

    if (existingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Expense record not found' });
    }

    const existing = existingResult.rows[0];

    const hasProp = (prop) => Object.prototype.hasOwnProperty.call(req.body ?? {}, prop);

    const finalItem = hasProp('item')
      ? normalizeTextInput(req.body.item) ?? null
      : existing.item ?? null;

    const existingCost =
      existing.cost !== null && existing.cost !== undefined
        ? Number(existing.cost)
        : null;

    const finalCost = hasProp('cost')
      ? normalizeDecimalInput(req.body.cost, 'cost')
      : existingCost;

    const finalPurchaseDate = hasProp('purchase_date')
      ? normalizeDateInputValue(req.body.purchase_date, 'purchase_date')
      : ensureIsoDateString(existing.purchase_date);

    const finalReceiptName = hasProp('receipt_name')
      ? normalizeTextInput(req.body.receipt_name) ?? null
      : existing.receipt_name ?? null;

    const finalPurchaseLocation = hasProp('purchase_location')
      ? normalizeTextInput(req.body.purchase_location) ?? null
      : existing.purchase_location ?? null;

    const updateResult = await pool.query(
      `
        UPDATE expenses
        SET
          item = $1,
          cost = $2,
          purchase_date = $3,
          receipt_name = $4,
          purchase_location = $5
        WHERE id = $6
        RETURNING id, item, cost, purchase_date, receipt_name, purchase_location
      `,
      [
        finalItem,
        finalCost,
        finalPurchaseDate,
        finalReceiptName,
        finalPurchaseLocation,
        expenseId
      ]
    );

    res.json({ row: updateResult.rows[0] });
  } catch (error) {
    console.error('Expenses update failed:', error);
    if (error.status === 400) {
      return res.status(400).json({ error: 'Failed to update expense record', details: error.message });
    }
    res.status(500).json({ error: 'Failed to update expense record', details: error.message });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const expenseId = Number(req.params.id);
    if (!Number.isInteger(expenseId)) {
      return res.status(400).json({ error: 'Invalid expense id' });
    }

    const existingResult = await pool.query(
      'SELECT id FROM expenses WHERE id = $1',
      [expenseId]
    );

    if (existingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Expense record not found' });
    }

    await pool.query('DELETE FROM expenses WHERE id = $1', [expenseId]);

    res.json({ success: true, message: 'Expense record deleted successfully' });
  } catch (error) {
    console.error('Expenses delete failed:', error);
    res.status(500).json({ error: 'Failed to delete expense record', details: error.message });
  }
});

/**
 * Calendar-year view for Expenses → Projections: monthly profit (sold lines), projected sales
 * for remaining months, purchase counts and per-week breakdown vs a listing target (default 10/wk).
 */
app.get('/api/expenses/projections', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const now = new Date();
    const calendarYear = now.getFullYear();
    const yearParam = req.query.year !== undefined ? Number(req.query.year) : calendarYear;
    if (!Number.isFinite(yearParam) || yearParam < 2000 || yearParam > calendarYear + 5) {
      return res.status(400).json({ error: 'Invalid year' });
    }

    const targetYear = Math.floor(yearParam);

    const soldByMonthResult = await pool.query(
      `
        SELECT
          EXTRACT(MONTH FROM sale_date)::int AS month,
          SUM(
            CASE
              WHEN net_profit IS NOT NULL AND TRIM(net_profit::text) <> ''
              THEN net_profit::numeric
              ELSE 0::numeric
            END
          )::numeric AS profit,
          SUM(COALESCE(sale_price, 0))::numeric AS sales
        FROM stock
        WHERE sale_date IS NOT NULL
          AND EXTRACT(YEAR FROM sale_date)::int = $1
        GROUP BY 1
        ORDER BY 1
      `,
      [targetYear]
    );

    const purchaseCountResult = await pool.query(
      `
        SELECT COUNT(*)::int AS cnt
        FROM stock
        WHERE purchase_date IS NOT NULL
          AND EXTRACT(YEAR FROM purchase_date)::int = $1
      `,
      [targetYear]
    );

    const purchasesByWeekResult = await pool.query(
      `
        SELECT
          LEAST(53, GREATEST(1, CEIL(EXTRACT(DOY FROM purchase_date) / 7.0)::int)) AS week_bucket,
          COUNT(*)::int AS cnt
        FROM stock
        WHERE purchase_date IS NOT NULL
          AND EXTRACT(YEAR FROM purchase_date)::int = $1
        GROUP BY week_bucket
        ORDER BY week_bucket
      `,
      [targetYear]
    );

    const purchasesYtdCurrentYearResult = await pool.query(
      `
        SELECT COUNT(*)::int AS cnt
        FROM stock
        WHERE purchase_date IS NOT NULL
          AND EXTRACT(YEAR FROM purchase_date)::int = $1
          AND purchase_date::date <= CURRENT_DATE
      `,
      [calendarYear]
    );

    const profitByMonth = new Map();
    const salesByMonth = new Map();
    for (const row of soldByMonthResult.rows || []) {
      const m = Number(row.month);
      profitByMonth.set(m, Number(row.profit));
      salesByMonth.set(m, Number(row.sales));
    }

    let currentMonth;
    if (targetYear < calendarYear) {
      currentMonth = 12;
    } else if (targetYear > calendarYear) {
      currentMonth = 0;
    } else {
      currentMonth = now.getMonth() + 1;
    }

    let profitSumYtd = 0;
    let salesSumYtd = 0;
    for (let m = 1; m <= currentMonth; m += 1) {
      profitSumYtd += profitByMonth.get(m) ?? 0;
      salesSumYtd += salesByMonth.get(m) ?? 0;
    }

    const divisor = currentMonth > 0 ? currentMonth : 1;
    const avgMonthlyProfit = profitSumYtd / divisor;
    const avgMonthlySales = salesSumYtd / divisor;

    const remainingMonths = Math.max(0, 12 - currentMonth);
    const projectedYearEndProfit =
      currentMonth >= 12 ? profitSumYtd : profitSumYtd + avgMonthlyProfit * remainingMonths;
    const projectedYearEndSales =
      currentMonth >= 12 ? salesSumYtd : salesSumYtd + avgMonthlySales * remainingMonths;

    const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const months = Array.from({ length: 12 }, (_v, i) => {
      const m = i + 1;
      const profitActual =
        targetYear > calendarYear || (targetYear === calendarYear && m > currentMonth)
          ? null
          : profitByMonth.get(m) ?? 0;
      const salesActual =
        targetYear > calendarYear || (targetYear === calendarYear && m > currentMonth)
          ? null
          : salesByMonth.get(m) ?? 0;
      const salesProjected =
        targetYear < calendarYear ||
        m <= currentMonth ||
        currentMonth === 0 ||
        targetYear > calendarYear
          ? null
          : avgMonthlySales;
      return {
        month: m,
        label: monthShort[i],
        profitActual,
        salesActual,
        salesProjected
      };
    });

    const totalPurchases = purchaseCountResult.rows[0]?.cnt ?? 0;

    let weeksUsedForAverage;
    if (targetYear < calendarYear) {
      weeksUsedForAverage = 52;
    } else if (targetYear > calendarYear) {
      weeksUsedForAverage = 1;
    } else {
      const start = new Date(calendarYear, 0, 1);
      const end = now < start ? start : now;
      const days = Math.floor((end - start) / 86400000) + 1;
      weeksUsedForAverage = Math.max(1, Math.ceil(days / 7));
    }

    const purchasesPerWeekAverage = totalPurchases / weeksUsedForAverage;

    const TARGET_PURCHASES_PER_WEEK = 10;
    const purchasesByWeek = (purchasesByWeekResult.rows || []).map((row) => ({
      week: Number(row.week_bucket),
      count: Number(row.cnt)
    }));

    const purchasesYtdTotal = purchasesYtdCurrentYearResult.rows[0]?.cnt ?? 0;
    const ytdYearStart = new Date(calendarYear, 0, 1);
    const ytdYearEnd = now < ytdYearStart ? ytdYearStart : now;
    const ytdDaysElapsed = Math.floor((ytdYearEnd - ytdYearStart) / 86400000) + 1;
    const purchasesYtdWeeksUsed = Math.max(1, Math.ceil(ytdDaysElapsed / 7));
    const purchasesYtdPerWeekAverage = purchasesYtdTotal / purchasesYtdWeeksUsed;

    res.json({
      year: targetYear,
      currentMonth,
      calendarYear,
      months,
      summary: {
        profitYtd: profitSumYtd,
        salesYtd: salesSumYtd,
        avgMonthlyProfit,
        avgMonthlySales,
        projectedYearEndProfit,
        projectedYearEndSales,
        remainingMonths
      },
      purchases: {
        total: totalPurchases,
        weeksUsedForAverage,
        perWeekAverage: purchasesPerWeekAverage,
        byWeek: purchasesByWeek,
        targetPerWeek: TARGET_PURCHASES_PER_WEEK
      },
      purchasesYearToDate: {
        year: calendarYear,
        total: purchasesYtdTotal,
        weeksUsedForAverage: purchasesYtdWeeksUsed,
        perWeekAverage: purchasesYtdPerWeekAverage
      }
    });
  } catch (error) {
    console.error('Expenses projections query failed:', error);
    res.status(500).json({ error: 'Failed to load projections', details: error.message });
  }
});

// Orders API endpoints
app.get('/api/orders', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

      // Join with stock table to get all item details
      const result = await pool.query(
        `SELECT 
          o.id as order_id,
          o.stock_id,
          o.created_at,
          o.updated_at,
          s.id,
          s.item_name,
          s.purchase_price,
          s.purchase_date,
          s.sale_date,
          s.sale_price,
          s.sold_platform,
          s.net_profit,
          s.vinted_id,
          s.ebay_id,
          s.depop_id,
          s.brand_id,
          s.category_id,
          s.is_bulky_item
        FROM orders o
        INNER JOIN stock s ON o.stock_id = s.id
        ORDER BY s.id DESC, o.created_at DESC`
      );

    res.json({
      rows: result.rows ?? [],
      count: result.rowCount ?? 0
    });
  } catch (error) {
    console.error('Orders query failed:', error);
    res.status(500).json({ error: 'Failed to load orders data', details: error.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const { stock_id } = req.body ?? {};

    if (!stock_id || !Number.isInteger(Number(stock_id))) {
      return res.status(400).json({ error: 'Valid stock_id is required' });
    }

    const stockId = Number(stock_id);

    // Check if stock item exists
    const stockCheck = await pool.query('SELECT id FROM stock WHERE id = $1', [stockId]);
    if (stockCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Stock item not found' });
    }

    // Check if already in orders (UNIQUE constraint will also prevent this, but we can provide better error)
    const existingOrder = await pool.query('SELECT id FROM orders WHERE stock_id = $1', [stockId]);
    if (existingOrder.rowCount > 0) {
      return res.status(409).json({ error: 'Item is already in the orders list' });
    }

    // Insert into orders
    const result = await pool.query(
      'INSERT INTO orders (stock_id) VALUES ($1) RETURNING id, stock_id, created_at, updated_at',
      [stockId]
    );

    res.status(201).json({ success: true, order: result.rows[0] });
  } catch (error) {
    console.error('Orders insert failed:', error);
    // Handle unique constraint violation
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Item is already in the orders list' });
    }
    res.status(500).json({ error: 'Failed to add item to orders', details: error.message });
  }
});

app.delete('/api/orders/:stock_id', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const stockId = Number(req.params.stock_id);
    if (!Number.isInteger(stockId)) {
      return res.status(400).json({ error: 'Invalid stock_id' });
    }

    const existingResult = await pool.query(
      'SELECT id FROM orders WHERE stock_id = $1',
      [stockId]
    );

    if (existingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Order item not found' });
    }

    await pool.query('DELETE FROM orders WHERE stock_id = $1', [stockId]);

    res.json({ success: true, message: 'Order item removed successfully' });
  } catch (error) {
    console.error('Orders delete failed:', error);
    res.status(500).json({ error: 'Failed to remove order item', details: error.message });
  }
});

app.delete('/api/orders', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    await pool.query('DELETE FROM orders');

    res.json({ success: true, message: 'All orders cleared successfully' });
  } catch (error) {
    console.error('Orders clear failed:', error);
    res.status(500).json({ error: 'Failed to clear orders', details: error.message });
  }
});

app.get('/api/analytics/reporting', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const now = new Date();
    const requestedYearRaw = req.query.year;
    const isAllTime = requestedYearRaw === 'all';
    const requestedYear = isAllTime ? null : (requestedYearRaw ? Number(requestedYearRaw) : now.getFullYear());
    const targetYear = isAllTime ? null : (Number.isNaN(requestedYear) ? now.getFullYear() : requestedYear);

    const yearsResult = await pool.query(`
      SELECT DISTINCT year FROM (
        SELECT EXTRACT(YEAR FROM purchase_date)::int AS year FROM stock WHERE purchase_date IS NOT NULL
        UNION
        SELECT EXTRACT(YEAR FROM sale_date)::int AS year FROM stock WHERE sale_date IS NOT NULL
      ) AS years
      WHERE year IS NOT NULL
      ORDER BY year DESC
    `);

    const availableYears = yearsResult.rows.map((row) => row.year);
    const effectiveYear = isAllTime ? null : (availableYears.length > 0
      ? (availableYears.includes(targetYear) ? targetYear : availableYears[0])
      : targetYear);

    const profitTimelineResult = await pool.query(
      `
        WITH purchase_totals AS (
          SELECT
            DATE_TRUNC('month', purchase_date) AS month_start,
            SUM(COALESCE(purchase_price, 0))::numeric AS total_purchase
          FROM stock
          WHERE NOT COALESCE(is_inventory_write_off, false)
            AND purchase_date IS NOT NULL
          GROUP BY month_start
        ),
        sale_totals AS (
          SELECT
            DATE_TRUNC('month', sale_date) AS month_start,
            SUM(COALESCE(sale_price, 0))::numeric AS total_sales
          FROM stock
          WHERE NOT COALESCE(is_inventory_write_off, false)
            AND sale_date IS NOT NULL
          GROUP BY month_start
        )
        SELECT
          COALESCE(sale_totals.month_start, purchase_totals.month_start) AS month_start,
          EXTRACT(YEAR FROM COALESCE(sale_totals.month_start, purchase_totals.month_start))::int AS year,
          EXTRACT(MONTH FROM COALESCE(sale_totals.month_start, purchase_totals.month_start))::int AS month,
          COALESCE(sale_totals.total_sales, 0) AS total_sales,
          COALESCE(purchase_totals.total_purchase, 0) AS total_purchase,
          COALESCE(sale_totals.total_sales, 0) - COALESCE(purchase_totals.total_purchase, 0) AS profit
        FROM sale_totals
        FULL OUTER JOIN purchase_totals
          ON sale_totals.month_start = purchase_totals.month_start
        ORDER BY month_start ASC
      `
    );

    const profitByMonthQuery = effectiveYear === null ? `
        WITH purchase_totals AS (
          SELECT
            EXTRACT(MONTH FROM purchase_date)::int AS month,
            SUM(COALESCE(purchase_price, 0))::numeric AS total_purchase
          FROM stock
          WHERE NOT COALESCE(is_inventory_write_off, false)
            AND purchase_date IS NOT NULL
          GROUP BY month
        ),
        sale_totals AS (
          SELECT
            EXTRACT(MONTH FROM sale_date)::int AS month,
            SUM(COALESCE(sale_price, 0))::numeric AS total_sales
          FROM stock
          WHERE NOT COALESCE(is_inventory_write_off, false)
            AND sale_date IS NOT NULL
          GROUP BY month
        )
        SELECT
          COALESCE(sale_totals.month, purchase_totals.month) AS month,
          COALESCE(sale_totals.total_sales, 0) AS total_sales,
          COALESCE(purchase_totals.total_purchase, 0) AS total_purchase,
          COALESCE(sale_totals.total_sales, 0) - COALESCE(purchase_totals.total_purchase, 0) AS profit
        FROM sale_totals
        FULL OUTER JOIN purchase_totals
          ON sale_totals.month = purchase_totals.month
        ORDER BY month ASC
      ` : `
        WITH purchase_totals AS (
          SELECT
            EXTRACT(MONTH FROM purchase_date)::int AS month,
            SUM(COALESCE(purchase_price, 0))::numeric AS total_purchase
          FROM stock
          WHERE NOT COALESCE(is_inventory_write_off, false)
            AND purchase_date IS NOT NULL
            AND EXTRACT(YEAR FROM purchase_date)::int = $1
          GROUP BY month
        ),
        sale_totals AS (
          SELECT
            EXTRACT(MONTH FROM sale_date)::int AS month,
            SUM(COALESCE(sale_price, 0))::numeric AS total_sales
          FROM stock
          WHERE NOT COALESCE(is_inventory_write_off, false)
            AND sale_date IS NOT NULL
            AND EXTRACT(YEAR FROM sale_date)::int = $1
          GROUP BY month
        )
        SELECT
          COALESCE(sale_totals.month, purchase_totals.month) AS month,
          COALESCE(sale_totals.total_sales, 0) AS total_sales,
          COALESCE(purchase_totals.total_purchase, 0) AS total_purchase,
          COALESCE(sale_totals.total_sales, 0) - COALESCE(purchase_totals.total_purchase, 0) AS profit
        FROM sale_totals
        FULL OUTER JOIN purchase_totals
          ON sale_totals.month = purchase_totals.month
        ORDER BY month ASC
      `;
    const profitByMonthResult = await pool.query(
      profitByMonthQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const expensesByMonthQuery = effectiveYear === null ? `
        SELECT
          EXTRACT(MONTH FROM purchase_date)::int AS month,
          SUM(COALESCE(purchase_price, 0))::numeric AS expense
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
          AND purchase_date IS NOT NULL
        GROUP BY month
        ORDER BY month ASC
      ` : `
        SELECT
          EXTRACT(MONTH FROM purchase_date)::int AS month,
          SUM(COALESCE(purchase_price, 0))::numeric AS expense
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
          AND purchase_date IS NOT NULL
          AND EXTRACT(YEAR FROM purchase_date)::int = $1
        GROUP BY month
        ORDER BY month ASC
      `;
    const expensesByMonthResult = await pool.query(
      expensesByMonthQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const profitTimeline = profitTimelineResult.rows.map((row) => ({
      year: row.year,
      month: row.month,
      label: new Date(Date.UTC(row.year, row.month - 1, 1)).toISOString().slice(0, 10),
      totalSales: Number(row.total_sales),
      totalPurchase: Number(row.total_purchase),
      profit: Number(row.profit)
    }));

    const monthlyProfit = Array.from({ length: 12 }, (_value, index) => {
      const found = profitByMonthResult.rows.find((row) => row.month === index + 1);
      return {
        month: index + 1,
        totalSales: found ? Number(found.total_sales) : 0,
        totalPurchase: found ? Number(found.total_purchase) : 0,
        profit: found ? Number(found.profit) : 0
      };
    });

    const monthlyExpenses = Array.from({ length: 12 }, (_value, index) => {
      const found = expensesByMonthResult.rows.find((row) => row.month === index + 1);
      return {
        month: index + 1,
        expense: found ? Number(found.expense) : 0
      };
    });

    const salesByCategoryQuery = effectiveYear === null ? `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          SUM(COALESCE(s.sale_price, 0))::numeric AS total_sales
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.sale_date IS NOT NULL
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
        HAVING SUM(COALESCE(s.sale_price, 0)) > 0
        ORDER BY total_sales DESC
      ` : `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          SUM(COALESCE(s.sale_price, 0))::numeric AS total_sales
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.sale_date IS NOT NULL
          AND EXTRACT(YEAR FROM s.sale_date)::int = $1
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
        HAVING SUM(COALESCE(s.sale_price, 0)) > 0
        ORDER BY total_sales DESC
      `;
    const salesByCategoryResult = await pool.query(
      salesByCategoryQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const salesByCategory = salesByCategoryResult.rows.map((row) => ({
      category: row.category || 'Uncategorized',
      totalSales: Number(row.total_sales)
    }));

    const soldCountByCategoryQuery = effectiveYear === null ? `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          COUNT(*)::int AS sold_count
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.sale_date IS NOT NULL
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
        HAVING COUNT(*) > 0
        ORDER BY sold_count DESC
      ` : `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          COUNT(*)::int AS sold_count
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.sale_date IS NOT NULL
          AND EXTRACT(YEAR FROM s.sale_date)::int = $1
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
        HAVING COUNT(*) > 0
        ORDER BY sold_count DESC
      `;
    const soldCountByCategoryResult = await pool.query(
      soldCountByCategoryQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );
    const soldCountByCategory = soldCountByCategoryResult.rows.map((row) => ({
      category: row.category || 'Uncategorized',
      soldCount: Number(row.sold_count) || 0
    }));

    const soldCategoryNetQuery = effectiveYear === null ? `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          SUM(
            COALESCE(s.sale_price, 0)::numeric - COALESCE(s.purchase_price, 0)::numeric
          )::numeric AS net_profit
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.sale_date IS NOT NULL
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
      ` : `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          SUM(
            COALESCE(s.sale_price, 0)::numeric - COALESCE(s.purchase_price, 0)::numeric
          )::numeric AS net_profit
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.sale_date IS NOT NULL
          AND EXTRACT(YEAR FROM s.sale_date)::int = $1
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
      `;
    const soldCategoryNetResult = await pool.query(
      soldCategoryNetQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );
    const soldCategoryNetProfit = soldCategoryNetResult.rows.map((row) => ({
      category: row.category || 'Uncategorized',
      netProfit: row.net_profit != null ? Number(row.net_profit) : 0
    }));

    const unsoldStockByCategoryQuery = effectiveYear === null ? `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          SUM(COALESCE(s.purchase_price, 0))::numeric AS total_value,
          COUNT(*)::int AS item_count
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.purchase_date IS NOT NULL
          AND s.sale_date IS NULL
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
        HAVING SUM(COALESCE(s.purchase_price, 0)) > 0
        ORDER BY total_value DESC
      ` : `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          SUM(COALESCE(s.purchase_price, 0))::numeric AS total_value,
          COUNT(*)::int AS item_count
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.purchase_date IS NOT NULL
          AND s.sale_date IS NULL
          AND EXTRACT(YEAR FROM s.purchase_date)::int = $1
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
        HAVING SUM(COALESCE(s.purchase_price, 0)) > 0
        ORDER BY total_value DESC
      `;
    const unsoldStockByCategoryResult = await pool.query(
      unsoldStockByCategoryQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const unsoldStockByCategory = unsoldStockByCategoryResult.rows.map((row) => ({
      category: row.category || 'Uncategorized',
      totalValue: Number(row.total_value),
      itemCount: Number(row.item_count)
    }));

    // Sales by Brand query (excludes unbranded items)
    const salesByBrandQuery = effectiveYear === null ? `
        SELECT
          b.brand_name AS brand,
          SUM(COALESCE(s.sale_price, 0))::numeric AS total_sales
        FROM stock s
        INNER JOIN brand b ON s.brand_id = b.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.sale_date IS NOT NULL
          AND s.brand_id IS NOT NULL
          AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
        GROUP BY b.brand_name
        HAVING SUM(COALESCE(s.sale_price, 0)) > 0
        ORDER BY total_sales DESC
        LIMIT 15
      ` : `
        SELECT
          b.brand_name AS brand,
          SUM(COALESCE(s.sale_price, 0))::numeric AS total_sales
        FROM stock s
        INNER JOIN brand b ON s.brand_id = b.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.sale_date IS NOT NULL
          AND s.brand_id IS NOT NULL
          AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
          AND EXTRACT(YEAR FROM s.sale_date)::int = $1
        GROUP BY b.brand_name
        HAVING SUM(COALESCE(s.sale_price, 0)) > 0
        ORDER BY total_sales DESC
        LIMIT 15
      `;
    const salesByBrandResult = await pool.query(
      salesByBrandQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const salesByBrand = salesByBrandResult.rows.map((row) => ({
      brand: row.brand,
      totalSales: Number(row.total_sales)
    }));

    const categoryBrandSalesQuery = effectiveYear === null ? `
        WITH ranked AS (
          SELECT
            s.category_id,
            b.brand_name AS brand,
            SUM(COALESCE(s.sale_price, 0))::numeric AS total_sales,
            ROW_NUMBER() OVER (
              PARTITION BY s.category_id
              ORDER BY SUM(COALESCE(s.sale_price, 0)) DESC
            ) AS rn
          FROM stock s
          INNER JOIN brand b ON s.brand_id = b.id
          WHERE NOT COALESCE(s.is_inventory_write_off, false)
            AND s.sale_date IS NOT NULL
            AND s.brand_id IS NOT NULL
            AND s.category_id IN (11, 25, 29, 5, 27)
          AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
          GROUP BY s.category_id, b.brand_name
        )
        SELECT category_id, brand, total_sales
        FROM ranked
        WHERE rn <= 15
        ORDER BY category_id, total_sales DESC
      ` : `
        WITH ranked AS (
          SELECT
            s.category_id,
            b.brand_name AS brand,
            SUM(COALESCE(s.sale_price, 0))::numeric AS total_sales,
            ROW_NUMBER() OVER (
              PARTITION BY s.category_id
              ORDER BY SUM(COALESCE(s.sale_price, 0)) DESC
            ) AS rn
          FROM stock s
          INNER JOIN brand b ON s.brand_id = b.id
          WHERE NOT COALESCE(s.is_inventory_write_off, false)
            AND s.sale_date IS NOT NULL
            AND s.brand_id IS NOT NULL
            AND s.category_id IN (11, 25, 29, 5, 27)
          AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
            AND EXTRACT(YEAR FROM s.sale_date)::int = $1
          GROUP BY s.category_id, b.brand_name
        )
        SELECT category_id, brand, total_sales
        FROM ranked
        WHERE rn <= 15
        ORDER BY category_id, total_sales DESC
      `;
    const categoryBrandSalesResult = await pool.query(
      categoryBrandSalesQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const bestSellingBrandsByCategory = {
      trousers: [],
      shirt: [],
      top: [],
      coat: [],
      jacket: []
    };

    categoryBrandSalesResult.rows.forEach((row) => {
      const entry = {
        brand: row.brand,
        totalSales: Number(row.total_sales)
      };
      if (Number(row.category_id) === 11) bestSellingBrandsByCategory.trousers.push(entry);
      if (Number(row.category_id) === 25) bestSellingBrandsByCategory.shirt.push(entry);
      if (Number(row.category_id) === 29) bestSellingBrandsByCategory.top.push(entry);
      if (Number(row.category_id) === 5) bestSellingBrandsByCategory.coat.push(entry);
      if (Number(row.category_id) === 27) bestSellingBrandsByCategory.jacket.push(entry);
    });

    // Worst Selling Brands query (unsold items by brand)
    // For unsold items, we show all unsold items regardless of purchase year
    // since they're all currently unsold. Year filter doesn't apply here.
    const worstSellingBrandsQuery = `
        SELECT
          b.brand_name AS brand,
          COUNT(*)::int AS item_count
        FROM stock s
        INNER JOIN brand b ON s.brand_id = b.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.sale_date IS NULL
          AND s.brand_id IS NOT NULL
          AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
        GROUP BY b.brand_name
        ORDER BY item_count DESC
        LIMIT 15
      `;
    const worstSellingBrandsResult = await pool.query(worstSellingBrandsQuery);

    const worstSellingBrands = worstSellingBrandsResult.rows.map((row) => ({
      brand: row.brand,
      itemCount: Number(row.item_count)
    }));

    const bestSellThroughBrandsQuery = effectiveYear === null ? `
        SELECT
          b.brand_name AS brand,
          COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL)::int AS items_listed,
          COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL AND s.sale_date IS NOT NULL)::int AS items_sold,
          CASE
            WHEN COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL) > 0
            THEN (
              COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL AND s.sale_date IS NOT NULL)::numeric
              / COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL)::numeric
            ) * 100
            ELSE 0
          END AS sell_through_rate
        FROM stock s
        INNER JOIN brand b ON s.brand_id = b.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.brand_id IS NOT NULL
          AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
        GROUP BY b.brand_name
        HAVING COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL) > 0
        ORDER BY sell_through_rate DESC, items_listed DESC
        LIMIT 15
      ` : `
        SELECT
          b.brand_name AS brand,
          COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL)::int AS items_listed,
          COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL AND s.sale_date IS NOT NULL)::int AS items_sold,
          CASE
            WHEN COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL) > 0
            THEN (
              COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL AND s.sale_date IS NOT NULL)::numeric
              / COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL)::numeric
            ) * 100
            ELSE 0
          END AS sell_through_rate
        FROM stock s
        INNER JOIN brand b ON s.brand_id = b.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.brand_id IS NOT NULL
          AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
          AND EXTRACT(YEAR FROM s.purchase_date)::int = $1
        GROUP BY b.brand_name
        HAVING COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL) > 0
        ORDER BY sell_through_rate DESC, items_listed DESC
        LIMIT 15
      `;
    const bestSellThroughBrandsResult = await pool.query(
      bestSellThroughBrandsQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const bestSellThroughBrands = bestSellThroughBrandsResult.rows.map((row) => ({
      brand: row.brand,
      itemsListed: Number(row.items_listed),
      itemsSold: Number(row.items_sold),
      sellThroughRate: Number(row.sell_through_rate)
    }));

    const worstSellThroughBrandsQuery = effectiveYear === null ? `
        SELECT
          b.brand_name AS brand,
          COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL)::int AS items_listed,
          COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL AND s.sale_date IS NOT NULL)::int AS items_sold,
          CASE
            WHEN COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL) > 0
            THEN (
              COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL AND s.sale_date IS NOT NULL)::numeric
              / COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL)::numeric
            ) * 100
            ELSE 0
          END AS sell_through_rate
        FROM stock s
        INNER JOIN brand b ON s.brand_id = b.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.brand_id IS NOT NULL
          AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
        GROUP BY b.brand_name
        HAVING COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL) > 0
          AND COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL AND s.sale_date IS NOT NULL) > 0
        ORDER BY sell_through_rate ASC, items_listed DESC
        LIMIT 15
      ` : `
        SELECT
          b.brand_name AS brand,
          COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL)::int AS items_listed,
          COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL AND s.sale_date IS NOT NULL)::int AS items_sold,
          CASE
            WHEN COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL) > 0
            THEN (
              COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL AND s.sale_date IS NOT NULL)::numeric
              / COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL)::numeric
            ) * 100
            ELSE 0
          END AS sell_through_rate
        FROM stock s
        INNER JOIN brand b ON s.brand_id = b.id
        WHERE NOT COALESCE(s.is_inventory_write_off, false)
          AND s.brand_id IS NOT NULL
          AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
          AND EXTRACT(YEAR FROM s.purchase_date)::int = $1
        GROUP BY b.brand_name
        HAVING COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL) > 0
          AND COUNT(*) FILTER (WHERE s.purchase_date IS NOT NULL AND s.sale_date IS NOT NULL) > 0
        ORDER BY sell_through_rate ASC, items_listed DESC
        LIMIT 15
      `;
    const worstSellThroughBrandsResult = await pool.query(
      worstSellThroughBrandsQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const worstSellThroughBrands = worstSellThroughBrandsResult.rows.map((row) => ({
      brand: row.brand,
      itemsListed: Number(row.items_listed),
      itemsSold: Number(row.items_sold),
      sellThroughRate: Number(row.sell_through_rate)
    }));

    const sellThroughRateResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE purchase_date IS NOT NULL) AS total_listed,
        COUNT(*) FILTER (WHERE sale_date IS NOT NULL) AS total_sold
      FROM stock
      WHERE NOT COALESCE(is_inventory_write_off, false)
    `);

    const totalListed = Number(sellThroughRateResult.rows[0]?.total_listed || 0);
    const totalSold = Number(sellThroughRateResult.rows[0]?.total_sold || 0);
    const sellThroughRate = totalListed > 0 ? (totalSold / totalListed) * 100 : 0;

    const averageSellingPriceResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE sale_date IS NOT NULL AND sale_price IS NOT NULL) AS sold_count,
        SUM(COALESCE(sale_price, 0))::numeric AS total_sales
      FROM stock
      WHERE NOT COALESCE(is_inventory_write_off, false)
        AND sale_date IS NOT NULL
    `);

    const soldCount = Number(averageSellingPriceResult.rows[0]?.sold_count || 0);
    const totalSales = Number(averageSellingPriceResult.rows[0]?.total_sales || 0);
    const averageSellingPrice = soldCount > 0 ? totalSales / soldCount : 0;

    const averageProfitResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE sale_date IS NOT NULL) AS sold_count,
        SUM(COALESCE(sale_price, 0))::numeric AS total_sales,
        SUM(COALESCE(purchase_price, 0))::numeric AS total_purchases
      FROM stock
      WHERE NOT COALESCE(is_inventory_write_off, false)
        AND sale_date IS NOT NULL
    `);

    const profitSoldCount = Number(averageProfitResult.rows[0]?.sold_count || 0);
    const profitTotalSales = Number(averageProfitResult.rows[0]?.total_sales || 0);
    const profitTotalPurchases = Number(averageProfitResult.rows[0]?.total_purchases || 0);
    const netProfit = profitTotalSales - profitTotalPurchases;
    const averageProfitPerItem = profitSoldCount > 0 ? netProfit / profitSoldCount : 0;

    // Calculate ROI for the selected year to match year-specific profit
    const roiQuery = effectiveYear === null ? `
        SELECT
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL THEN sale_price ELSE 0 END), 0)::numeric AS total_sales,
          COALESCE(SUM(CASE WHEN purchase_date IS NOT NULL THEN purchase_price ELSE 0 END), 0)::numeric AS total_spend
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
      ` : `
        SELECT
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND EXTRACT(YEAR FROM sale_date)::int = $1 THEN sale_price ELSE 0 END), 0)::numeric AS total_sales,
          COALESCE(SUM(CASE WHEN purchase_date IS NOT NULL AND EXTRACT(YEAR FROM purchase_date)::int = $1 THEN purchase_price ELSE 0 END), 0)::numeric AS total_spend
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
      `;
    const roiResult = await pool.query(
      roiQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const roiTotalSales = Number(roiResult.rows[0]?.total_sales || 0);
    const roiTotalSpend = Number(roiResult.rows[0]?.total_spend || 0);
    const roiProfit = roiTotalSales - roiTotalSpend;
    const roi = roiTotalSpend > 0 ? (roiProfit / roiTotalSpend) * 100 : 0;

    const averageDaysToSellResult = await pool.query(`
      SELECT
        AVG(sale_date - purchase_date) AS average_days
      FROM stock
      WHERE NOT COALESCE(is_inventory_write_off, false)
        AND purchase_date IS NOT NULL AND sale_date IS NOT NULL
    `);

    const averageDaysToSell = averageDaysToSellResult.rows[0]?.average_days 
      ? Number(averageDaysToSellResult.rows[0].average_days) 
      : 0;

    const activeListingsResult = await pool.query(`
      SELECT COUNT(*) AS active_count
      FROM stock
      WHERE NOT COALESCE(is_inventory_write_off, false)
        AND purchase_date IS NOT NULL AND sale_date IS NULL
    `);

    const activeListingsCount = Number(activeListingsResult.rows[0]?.active_count || 0);

    // Calculate unsold inventory value - filter by year if not "all"
    const unsoldInventoryQuery = effectiveYear === null ? `
      SELECT SUM(COALESCE(purchase_price, 0))::numeric AS total_value
      FROM stock
      WHERE NOT COALESCE(is_inventory_write_off, false)
        AND purchase_date IS NOT NULL AND sale_date IS NULL
    ` : `
      SELECT SUM(COALESCE(purchase_price, 0))::numeric AS total_value
      FROM stock
      WHERE NOT COALESCE(is_inventory_write_off, false)
        AND purchase_date IS NOT NULL 
        AND sale_date IS NULL
        AND EXTRACT(YEAR FROM purchase_date)::int = $1
    `;
    const unsoldInventoryValueResult = await pool.query(
      unsoldInventoryQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );
    const unsoldInventoryValue = Number(unsoldInventoryValueResult.rows[0]?.total_value || 0);

    const monthlyAverageSellingPriceQuery = effectiveYear === null ? `
        SELECT
          EXTRACT(MONTH FROM sale_date)::int AS month,
          AVG(COALESCE(sale_price, 0))::numeric AS average_price,
          COUNT(*) AS item_count
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
          AND sale_date IS NOT NULL
          AND sale_price IS NOT NULL
        GROUP BY month
        ORDER BY month ASC
      ` : `
        SELECT
          EXTRACT(MONTH FROM sale_date)::int AS month,
          AVG(COALESCE(sale_price, 0))::numeric AS average_price,
          COUNT(*) AS item_count
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
          AND sale_date IS NOT NULL
          AND sale_price IS NOT NULL
          AND EXTRACT(YEAR FROM sale_date)::int = $1
        GROUP BY month
        ORDER BY month ASC
      `;
    const monthlyAverageSellingPriceResult = await pool.query(
      monthlyAverageSellingPriceQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const monthlyAverageSellingPrice = monthlyAverageSellingPriceResult.rows.map((row) => ({
      month: Number(row.month),
      average: Number(row.average_price),
      itemCount: Number(row.item_count)
    }));

    const monthlyAverageProfitPerItemQuery = effectiveYear === null ? `
        SELECT
          EXTRACT(MONTH FROM sale_date)::int AS month,
          AVG((COALESCE(sale_price, 0) - COALESCE(purchase_price, 0)))::numeric AS average_profit,
          COUNT(*) AS item_count
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
          AND sale_date IS NOT NULL
          AND sale_price IS NOT NULL
        GROUP BY month
        ORDER BY month ASC
      ` : `
        SELECT
          EXTRACT(MONTH FROM sale_date)::int AS month,
          AVG((COALESCE(sale_price, 0) - COALESCE(purchase_price, 0)))::numeric AS average_profit,
          COUNT(*) AS item_count
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
          AND sale_date IS NOT NULL
          AND sale_price IS NOT NULL
          AND EXTRACT(YEAR FROM sale_date)::int = $1
        GROUP BY month
        ORDER BY month ASC
      `;
    const monthlyAverageProfitPerItemResult = await pool.query(
      monthlyAverageProfitPerItemQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const monthlyAverageProfitPerItem = monthlyAverageProfitPerItemResult.rows.map((row) => ({
      month: Number(row.month),
      average: Number(row.average_profit),
      itemCount: Number(row.item_count)
    }));

    const monthlyAverageProfitMultipleQuery = effectiveYear === null ? `
        SELECT
          EXTRACT(MONTH FROM sale_date)::int AS month,
          AVG(
            CASE 
              WHEN COALESCE(purchase_price, 0) > 0 
              THEN COALESCE(sale_price, 0) / COALESCE(purchase_price, 0)
              ELSE NULL
            END
          )::numeric AS average_multiple,
          COUNT(*) AS item_count
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
          AND sale_date IS NOT NULL
          AND sale_price IS NOT NULL
          AND purchase_price IS NOT NULL
          AND COALESCE(purchase_price, 0) > 0
        GROUP BY month
        ORDER BY month ASC
      ` : `
        SELECT
          EXTRACT(MONTH FROM sale_date)::int AS month,
          AVG(
            CASE 
              WHEN COALESCE(purchase_price, 0) > 0 
              THEN COALESCE(sale_price, 0) / COALESCE(purchase_price, 0)
              ELSE NULL
            END
          )::numeric AS average_multiple,
          COUNT(*) AS item_count
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
          AND sale_date IS NOT NULL
          AND sale_price IS NOT NULL
          AND purchase_price IS NOT NULL
          AND COALESCE(purchase_price, 0) > 0
          AND EXTRACT(YEAR FROM sale_date)::int = $1
        GROUP BY month
        ORDER BY month ASC
      `;
    const monthlyAverageProfitMultipleResult = await pool.query(
      monthlyAverageProfitMultipleQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const monthlyAverageProfitMultiple = monthlyAverageProfitMultipleResult.rows.map((row) => ({
      month: Number(row.month),
      average: row.average_multiple ? Number(row.average_multiple) : 0,
      itemCount: Number(row.item_count)
    }));

    // Calculate year-specific totals to match Stock page calculation
    const yearSpecificTotalsQuery = effectiveYear === null ? `
        SELECT
          COALESCE(SUM(CASE WHEN purchase_date IS NOT NULL AND purchase_price IS NOT NULL THEN purchase_price ELSE 0 END), 0)::numeric AS total_purchase,
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND sale_price IS NOT NULL THEN sale_price ELSE 0 END), 0)::numeric AS total_sales
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
      ` : `
        SELECT
          COALESCE(SUM(CASE WHEN purchase_date IS NOT NULL AND purchase_price IS NOT NULL AND EXTRACT(YEAR FROM purchase_date)::int = $1 THEN purchase_price ELSE 0 END), 0)::numeric AS total_purchase,
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND sale_price IS NOT NULL AND EXTRACT(YEAR FROM sale_date)::int = $1 THEN sale_price ELSE 0 END), 0)::numeric AS total_sales
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
      `;
    const yearSpecificTotalsResult = await pool.query(
      yearSpecificTotalsQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const yearTotalPurchase = Number(yearSpecificTotalsResult.rows[0]?.total_purchase || 0);
    const yearTotalSales = Number(yearSpecificTotalsResult.rows[0]?.total_sales || 0);
    const yearTotalProfit = yearTotalSales - yearTotalPurchase;
    
    // Calculate cost of sold items (total purchases - unsold inventory)
    const costOfSoldItems = yearTotalPurchase - unsoldInventoryValue;
    
    // Calculate total profit from sold items (sale price - purchase price for sold items only)
    const totalProfitFromSoldItems = yearTotalSales - costOfSoldItems;
    
    // Calculate Vinted and eBay sales
    const platformSalesQuery = effectiveYear === null ? `
        SELECT
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND sale_price IS NOT NULL AND sold_platform = 'Vinted' THEN sale_price ELSE 0 END), 0)::numeric AS vinted_sales,
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND sale_price IS NOT NULL AND sold_platform = 'eBay' THEN sale_price ELSE 0 END), 0)::numeric AS ebay_sales
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
      ` : `
        SELECT
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND sale_price IS NOT NULL AND sold_platform = 'Vinted' AND EXTRACT(YEAR FROM sale_date)::int = $1 THEN sale_price ELSE 0 END), 0)::numeric AS vinted_sales,
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND sale_price IS NOT NULL AND sold_platform = 'eBay' AND EXTRACT(YEAR FROM sale_date)::int = $1 THEN sale_price ELSE 0 END), 0)::numeric AS ebay_sales
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
      `;
    const platformSalesResult = await pool.query(
      platformSalesQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );
    const vintedSales = Number(platformSalesResult.rows[0]?.vinted_sales || 0);
    const ebaySales = Number(platformSalesResult.rows[0]?.ebay_sales || 0);

    // Calculate average profit multiple for all time
    const allTimeProfitMultipleResult = await pool.query(`
      SELECT
        AVG(
          CASE 
            WHEN COALESCE(purchase_price, 0) > 0 
            THEN COALESCE(sale_price, 0) / COALESCE(purchase_price, 0)
            ELSE NULL
          END
        )::numeric AS average_multiple
      FROM stock
      WHERE NOT COALESCE(is_inventory_write_off, false)
        AND sale_date IS NOT NULL
        AND sale_price IS NOT NULL
        AND purchase_price IS NOT NULL
        AND COALESCE(purchase_price, 0) > 0
    `);

    const allTimeAverageProfitMultiple = allTimeProfitMultipleResult.rows[0]?.average_multiple 
      ? Number(allTimeProfitMultipleResult.rows[0].average_multiple) 
      : 0;

    // Calculate items listed and sold for current year
    const yearItemsQuery = effectiveYear === null ? `
        SELECT
          COUNT(*) FILTER (WHERE purchase_date IS NOT NULL) AS items_listed,
          COUNT(*) FILTER (WHERE sale_date IS NOT NULL) AS items_sold
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
      ` : `
        SELECT
          COUNT(*) FILTER (WHERE purchase_date IS NOT NULL AND EXTRACT(YEAR FROM purchase_date)::int = $1) AS items_listed,
          COUNT(*) FILTER (WHERE sale_date IS NOT NULL AND EXTRACT(YEAR FROM sale_date)::int = $1) AS items_sold
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
      `;
    const yearItemsResult = await pool.query(
      yearItemsQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );

    const yearItemsListed = Number(yearItemsResult.rows[0]?.items_listed || 0);
    const yearItemsSold = Number(yearItemsResult.rows[0]?.items_sold || 0);

    // Calculate current month sales (from start of current month to now)
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthSalesResult = await pool.query(
      `
        SELECT
          SUM(COALESCE(sale_price, 0))::numeric AS total_sales,
          COUNT(*)::int AS sold_count
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
          AND sale_date IS NOT NULL
          AND sale_date >= $1
          AND sale_date <= $2
      `,
      [currentMonthStart, now]
    );
    const currentMonthSales = Number(currentMonthSalesResult.rows[0]?.total_sales || 0);
    const currentMonthSoldCount = Number(currentMonthSalesResult.rows[0]?.sold_count || 0);

    // Calculate current week sales (from start of current week - Monday - to now)
    const currentWeekStart = new Date(now);
    const dayOfWeek = currentWeekStart.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // If Sunday, go back 6 days, otherwise go back (dayOfWeek - 1) days
    currentWeekStart.setDate(currentWeekStart.getDate() - daysToMonday);
    currentWeekStart.setHours(0, 0, 0, 0);
    
    const currentWeekSalesResult = await pool.query(
      `
        SELECT
          SUM(COALESCE(sale_price, 0))::numeric AS total_sales,
          COUNT(*)::int AS sold_count
        FROM stock
        WHERE NOT COALESCE(is_inventory_write_off, false)
          AND sale_date IS NOT NULL
          AND sale_date >= $1
          AND sale_date <= $2
      `,
      [currentWeekStart, now]
    );

    const inventoryWriteOffTotalsQuery = effectiveYear === null ? `
        SELECT
          COUNT(*)::int AS line_count,
          COALESCE(SUM(COALESCE(purchase_price, 0)), 0)::numeric AS purchase_cost
        FROM stock
        WHERE COALESCE(is_inventory_write_off, false)
      ` : `
        SELECT
          COUNT(*)::int AS line_count,
          COALESCE(SUM(COALESCE(purchase_price, 0)), 0)::numeric AS purchase_cost
        FROM stock
        WHERE COALESCE(is_inventory_write_off, false)
          AND purchase_date IS NOT NULL
          AND EXTRACT(YEAR FROM purchase_date)::int = $1
      `;
    const inventoryWriteOffTotalsResult = await pool.query(
      inventoryWriteOffTotalsQuery,
      effectiveYear === null ? [] : [effectiveYear]
    );
    const inventoryWriteOffLineCount = Number(inventoryWriteOffTotalsResult.rows[0]?.line_count || 0);
    const inventoryWriteOffPurchaseCost = Number(inventoryWriteOffTotalsResult.rows[0]?.purchase_cost || 0);
    const currentWeekSales = Number(currentWeekSalesResult.rows[0]?.total_sales || 0);
    const currentWeekSoldCount = Number(currentWeekSalesResult.rows[0]?.sold_count || 0);

    res.json({
      availableYears,
      selectedYear: effectiveYear || 'all',
      profitTimeline,
      monthlyProfit,
      monthlyExpenses,
      salesByCategory,
      soldCountByCategory,
      soldCategoryNetProfit,
      unsoldStockByCategory,
      salesByBrand,
      bestSellingBrandsByCategory,
      worstSellingBrands,
      bestSellThroughBrands,
      worstSellThroughBrands,
      sellThroughRate: {
        totalListed,
        totalSold,
        percentage: Number(sellThroughRate.toFixed(2))
      },
      averageSellingPrice: {
        totalSales,
        soldCount,
        average: Number(averageSellingPrice.toFixed(2))
      },
      averageProfitPerItem: {
        netProfit,
        soldCount: profitSoldCount,
        average: Number(averageProfitPerItem.toFixed(2))
      },
      roi: {
        profit: roiProfit,
        totalSpend: roiTotalSpend,
        percentage: Number(roi.toFixed(2))
      },
      averageDaysToSell: {
        days: Number(averageDaysToSell.toFixed(1))
      },
      activeListingsCount: {
        count: activeListingsCount
      },
      unsoldInventoryValue: {
        value: unsoldInventoryValue
      },
      monthlyAverageSellingPrice,
      monthlyAverageProfitPerItem,
      monthlyAverageProfitMultiple,
      yearSpecificTotals: {
        totalPurchase: yearTotalPurchase,
        totalSales: yearTotalSales,
        profit: yearTotalProfit,
        costOfSoldItems: costOfSoldItems,
        totalProfitFromSoldItems: totalProfitFromSoldItems,
        vintedSales: vintedSales,
        ebaySales: ebaySales
      },
      allTimeAverageProfitMultiple: Number(allTimeAverageProfitMultiple.toFixed(2)),
      yearItemsStats: {
        listed: yearItemsListed,
        sold: yearItemsSold
      },
      currentMonthSales: currentMonthSales,
      currentMonthSoldCount: currentMonthSoldCount,
      currentWeekSales: currentWeekSales,
      currentWeekSoldCount: currentWeekSoldCount,
      inventoryWriteOffTotals: {
        lineCount: inventoryWriteOffLineCount,
        purchaseCost: inventoryWriteOffPurchaseCost
      }
    });
  } catch (error) {
    console.error('Reporting analytics error:', error);
    res.status(500).json({ error: 'Failed to load reporting analytics', details: error.message });
  }
});

// Endpoint for monthly platform-specific analytics
app.get('/api/analytics/monthly-platform', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const requestedYear = req.query.year ? Number(req.query.year) : new Date().getFullYear();
    const requestedMonth = req.query.month ? Number(req.query.month) : new Date().getMonth() + 1;

    if (Number.isNaN(requestedYear) || Number.isNaN(requestedMonth) || requestedMonth < 1 || requestedMonth > 12) {
      return res.status(400).json({ error: 'Invalid year or month parameter' });
    }

    // Platform rows: attribute sales only by sold_platform (case-insensitive). Do not infer from listing IDs,
    // or the same sale can appear under both Vinted and eBay when both IDs exist.
    const vintedResult = await pool.query(
      `
        SELECT
          SUM(COALESCE(purchase_price, 0))::numeric AS total_purchases,
          SUM(COALESCE(sale_price, 0))::numeric AS total_sales,
          SUM(COALESCE(sale_price, 0) - COALESCE(purchase_price, 0))::numeric AS total_profit
        FROM stock
        WHERE sale_date IS NOT NULL
          AND EXTRACT(YEAR FROM sale_date)::int = $1
          AND EXTRACT(MONTH FROM sale_date)::int = $2
          AND LOWER(TRIM(COALESCE(sold_platform, ''))) = 'vinted'
      `,
      [requestedYear, requestedMonth]
    );

    const vintedPurchases = Number(vintedResult.rows[0]?.total_purchases || 0);
    const vintedSales = Number(vintedResult.rows[0]?.total_sales || 0);
    const vintedProfit = Number(vintedResult.rows[0]?.total_profit || 0);

    const ebayResult = await pool.query(
      `
        SELECT
          SUM(COALESCE(purchase_price, 0))::numeric AS total_purchases,
          SUM(COALESCE(sale_price, 0))::numeric AS total_sales,
          SUM(COALESCE(sale_price, 0) - COALESCE(purchase_price, 0))::numeric AS total_profit
        FROM stock
        WHERE sale_date IS NOT NULL
          AND EXTRACT(YEAR FROM sale_date)::int = $1
          AND EXTRACT(MONTH FROM sale_date)::int = $2
          AND LOWER(TRIM(COALESCE(sold_platform, ''))) = 'ebay'
      `,
      [requestedYear, requestedMonth]
    );

    const ebayPurchases = Number(ebayResult.rows[0]?.total_purchases || 0);
    const ebaySales = Number(ebayResult.rows[0]?.total_sales || 0);
    const ebayProfit = Number(ebayResult.rows[0]?.total_profit || 0);

    const depopResult = await pool.query(
      `
        SELECT
          SUM(COALESCE(purchase_price, 0))::numeric AS total_purchases,
          SUM(COALESCE(sale_price, 0))::numeric AS total_sales,
          SUM(COALESCE(sale_price, 0) - COALESCE(purchase_price, 0))::numeric AS total_profit
        FROM stock
        WHERE sale_date IS NOT NULL
          AND EXTRACT(YEAR FROM sale_date)::int = $1
          AND EXTRACT(MONTH FROM sale_date)::int = $2
          AND LOWER(TRIM(COALESCE(sold_platform, ''))) = 'depop'
      `,
      [requestedYear, requestedMonth]
    );

    const depopPurchases = Number(depopResult.rows[0]?.total_purchases || 0);
    const depopSales = Number(depopResult.rows[0]?.total_sales || 0);
    const depopProfit = Number(depopResult.rows[0]?.total_profit || 0);

    const unsoldPurchasesResult = await pool.query(
      `
        SELECT
          SUM(COALESCE(purchase_price, 0))::numeric AS total_purchases
        FROM stock
        WHERE purchase_date IS NOT NULL
          AND sale_date IS NULL
          AND EXTRACT(YEAR FROM purchase_date)::int = $1
          AND EXTRACT(MONTH FROM purchase_date)::int = $2
      `,
      [requestedYear, requestedMonth]
    );
    const unsoldPurchases = Number(unsoldPurchasesResult.rows[0]?.total_purchases || 0);

    const stockPurchasesInPeriodResult = await pool.query(
      `
        SELECT SUM(COALESCE(purchase_price, 0))::numeric AS total_purchases
        FROM stock
        WHERE purchase_date IS NOT NULL
          AND EXTRACT(YEAR FROM purchase_date)::int = $1
          AND EXTRACT(MONTH FROM purchase_date)::int = $2
      `,
      [requestedYear, requestedMonth]
    );
    const stockPurchasesInPeriod = Number(stockPurchasesInPeriodResult.rows[0]?.total_purchases || 0);

    const unsoldInPeriodResult = await pool.query(
      `
        SELECT
          id,
          item_name,
          purchase_price,
          purchase_date
        FROM stock
        WHERE purchase_date IS NOT NULL
          AND sale_date IS NULL
          AND EXTRACT(YEAR FROM purchase_date)::int = $1
          AND EXTRACT(MONTH FROM purchase_date)::int = $2
        ORDER BY purchase_date DESC NULLS LAST, id DESC
      `,
      [requestedYear, requestedMonth]
    );

    const unsoldPurchasedInPeriodItems = unsoldInPeriodResult.rows.map((row) => ({
      id: row.id,
      item_name: row.item_name,
      purchase_price: row.purchase_price != null ? Number(row.purchase_price) : null,
      purchase_date: row.purchase_date
    }));

    // Cash flow profit = (Vinted + eBay + Depop profit) - Unsold purchases (stock cost tied up)
    const vintedProfitPositive = Math.max(0, vintedProfit);
    const ebayProfitPositive = Math.max(0, ebayProfit);
    const depopProfitPositive = Math.max(0, depopProfit);
    const unsoldPurchasesPositive = Math.max(0, unsoldPurchases);
    const finalCashFlowProfit =
      vintedProfitPositive + ebayProfitPositive + depopProfitPositive - unsoldPurchasesPositive;

    // Sold this month but sold_platform missing or not Vinted / eBay / Depop
    const untaggedItemsResult = await pool.query(
      `
        SELECT
          id,
          item_name,
          purchase_price,
          purchase_date,
          sale_date,
          sale_price,
          sold_platform,
          vinted_id,
          category_id
        FROM stock
        WHERE sale_date IS NOT NULL
          AND EXTRACT(YEAR FROM sale_date)::int = $1
          AND EXTRACT(MONTH FROM sale_date)::int = $2
          AND (
            sold_platform IS NULL
            OR TRIM(COALESCE(sold_platform, '')) = ''
            OR LOWER(TRIM(COALESCE(sold_platform, ''))) NOT IN ('vinted', 'ebay', 'depop')
          )
        ORDER BY sale_date DESC, item_name ASC
      `,
      [requestedYear, requestedMonth]
    );

    const untaggedItems = untaggedItemsResult.rows.map((row) => ({
      id: row.id,
      item_name: row.item_name,
      purchase_price: row.purchase_price ? Number(row.purchase_price) : null,
      purchase_date: row.purchase_date,
      sale_date: row.sale_date,
      sale_price: row.sale_price ? Number(row.sale_price) : null,
      sold_platform: row.sold_platform,
      vinted_id: row.vinted_id,
      category_id: row.category_id
    }));

    // Calculate total unsold inventory value (all unsold items, not filtered by month/year)
    const unsoldInventoryResult = await pool.query(
      `
        SELECT SUM(COALESCE(purchase_price, 0))::numeric AS total_value
        FROM stock
        WHERE purchase_date IS NOT NULL AND sale_date IS NULL
      `
    );
    const unsoldInventoryValue = Number(unsoldInventoryResult.rows[0]?.total_value || 0);

    const totalMonthProfit = vintedProfit + ebayProfit + depopProfit;

    res.json({
      year: requestedYear,
      month: requestedMonth,
      vinted: {
        purchases: vintedPurchases,
        sales: vintedSales,
        profit: vintedProfit
      },
      ebay: {
        purchases: ebayPurchases,
        sales: ebaySales,
        profit: ebayProfit
      },
      depop: {
        purchases: depopPurchases,
        sales: depopSales,
        profit: depopProfit
      },
      unsoldPurchases,
      stockPurchasesInPeriod,
      unsoldPurchasedInPeriod: {
        items: unsoldPurchasedInPeriodItems,
        count: unsoldPurchasedInPeriodItems.length,
        totalPurchaseCost: unsoldPurchases
      },
      cashFlowProfit: finalCashFlowProfit,
      untaggedItems,
      unsoldInventoryValue,
      totalMonthProfit
    });
  } catch (error) {
    console.error('Monthly platform analytics error:', error);
    res.status(500).json({ error: 'Failed to load monthly platform data' });
  }
});

// Endpoint for trailing inventory (last 12 months of unsold inventory)
app.get('/api/analytics/trailing-inventory', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1; // 1-12

    // Calculate the last 12 months
    const trailingMonths = [];
    for (let i = 11; i >= 0; i--) {
      let year = currentYear;
      let month = currentMonth - i;
      
      if (month <= 0) {
        month += 12;
        year -= 1;
      }
      
      trailingMonths.push({ year, month });
    }

    // For each month, calculate the cumulative total cost of all items purchased up to and including that month that are still unsold
    const inventoryData = [];
    
    for (const { year, month } of trailingMonths) {
      // Calculate the end date of this month (last day of the month)
      const endDate = new Date(year, month, 0); // Day 0 of next month = last day of current month
      const endDateString = endDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
      
      // Find all items purchased on or before the end of this month that are still unsold
      const result = await pool.query(
        `
          SELECT SUM(COALESCE(purchase_price, 0))::numeric AS total_inventory_cost
          FROM stock
          WHERE purchase_date IS NOT NULL
            AND sale_date IS NULL
            AND purchase_date <= $1
        `,
        [endDateString]
      );
      
      const totalCost = Number(result.rows[0]?.total_inventory_cost || 0);
      inventoryData.push({
        year,
        month,
        label: `${monthLabels[month - 1]} ${year}`,
        inventoryCost: totalCost
      });
    }

    res.json({
      data: inventoryData
    });
  } catch (error) {
    console.error('Trailing inventory analytics error:', error);
    res.status(500).json({ error: 'Failed to load trailing inventory data', details: error.message });
  }
});

app.post('/api/gemini/identify-item', async (req, res) => {
  try {
    const { image } = req.body;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ error: 'An image is required' });
    }

    let mimeType = 'image/jpeg';
    let base64Image = image;

    if (image.startsWith('data:image/')) {
      const mimeMatch = image.match(/data:image\/([a-z]+);base64,/);
      if (mimeMatch) {
        mimeType = `image/${mimeMatch[1]}`;
      }
      base64Image = image.replace(/^data:image\/[a-z]+;base64,/, '');
    }

    const instruction =
      'You identify clothing and accessories from photos for UK resellers. Return ONLY one line of plain text: brand + item type (+ colour or model if obvious). No quotes, no punctuation at the end, no explanation. Suitable for a UK eBay search. If unsure, give your best guess. Examples: Stone Island crew neck jumper, Nike Air Max 90 trainers, Levi\'s 501 jeans';

    const requestBody = {
      contents: [
        {
          parts: [
            { text: instruction },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
    };

    const modelName = 'gemini-2.5-flash';
    const apiVersion = 'v1beta';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini identify-item API error:', errorText);
      return res.status(response.status).json({
        error: 'Failed to get response from Gemini API',
        details: errorText,
      });
    }

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      return res.status(500).json({ error: 'Invalid response from Gemini API' });
    }

    const result = data.candidates[0].content.parts[0].text;

    res.json({ result });
  } catch (error) {
    console.error('Gemini identify-item error:', error);
    res.status(500).json({ error: 'Failed to identify item', details: error.message });
  }
});

const buildDirectory = path.join(__dirname, 'build');

function shouldUseFrontendDevProxy() {
  const v = process.env.FRONTEND_DEV_PROXY;
  return v === '1' || v === 'true';
}

function createFrontendDevProxyMiddleware(targetOrigin) {
  const target = new URL(targetOrigin);
  const port = Number(target.port) || 3000;
  const hostname = target.hostname;

  return (req, res, next) => {
    if (req.path.startsWith('/api')) return next();

    const proxyReq = http.request(
      {
        hostname,
        port,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: target.host,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      console.error('Frontend dev proxy error:', err.message);
      if (!res.headersSent) {
        res
          .status(502)
          .type('text/plain')
          .send(
            `React dev server not reachable at ${target.origin}. Run "npm start" or "npm run dev".`
          );
      }
    });

    req.pipe(proxyReq);
  };
}

function attachFrontendDevProxyUpgrade(server, targetOrigin) {
  const target = new URL(targetOrigin);
  const port = Number(target.port) || 3000;
  const hostname = target.hostname;

  server.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/api')) {
      socket.destroy();
      return;
    }

    const proxyReq = http.request({
      hostname,
      port,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host,
      },
    });

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      const headerLines = Object.entries(proxyRes.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headerLines}\r\n\r\n`);
      if (proxyHead?.length) proxySocket.unshift(proxyHead);
      proxySocket.pipe(socket).pipe(proxySocket);
    });

    proxyReq.on('error', () => socket.destroy());
    proxyReq.end();
  });
}

const frontendDevOrigin = process.env.FRONTEND_DEV_ORIGIN || 'http://localhost:3000';

if (shouldUseFrontendDevProxy()) {
  console.log(`Frontend dev proxy enabled: ${frontendDevOrigin} → port ${PORT} (hot reload)`);
  app.use(createFrontendDevProxyMiddleware(frontendDevOrigin));
} else if (fs.existsSync(buildDirectory)) {
  app.use(
    express.static(buildDirectory, {
      index: false,
      setHeaders(res, filePath) {
        if (path.basename(filePath) === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    })
  );

  // Serve the React app for any non-API route so that client-side routing works.
  // Use a regular expression here to avoid path-to-regexp wildcard issues in Express 5.
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({
        error: 'Unknown API route',
        method: req.method,
        path: req.path,
      });
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.sendFile(path.join(buildDirectory, 'index.html'));
  });
}

async function startServer() {
  await ensureDatabaseSchema();
  const server = http.createServer(app);
  if (shouldUseFrontendDevProxy()) {
    attachFrontendDevProxyUpgrade(server, frontendDevOrigin);
  }
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Settings endpoint: http://localhost:${PORT}/api/settings`);
    console.log(`eBay API: http://localhost:${PORT}/api/ebay/search | sold-recent: /api/ebay/sold-recent?q=...`);
    if (shouldUseFrontendDevProxy()) {
      console.log(`UI (dev proxy): http://localhost:${PORT}`);
    }
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});



