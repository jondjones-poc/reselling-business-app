const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { Pool } = require('pg');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const ebaySellerOAuth = require('./ebaySellerOAuth');

const app = express();
const PORT = process.env.PORT || 5003;

app.use(cors());
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

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw buildBadRequest(`Invalid date for ${fieldName}. Please use the YYYY-MM-DD format.`);
  }

  return date.toISOString().slice(0, 10);
};

const ensureIsoDateString = (value) => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
};

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

const getDatabasePool = () => {
  if (dbPool) {
    return dbPool;
  }

  let connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    const supabasePassword = process.env.SUPABASE_DB_PASSWORD;
    if (!supabasePassword) {
      console.warn('Supabase password not configured. Set SUPABASE_DB_PASSWORD.');
      return null;
    }

    connectionString = `postgresql://postgres:${encodeURIComponent(
      supabasePassword
    )}@db.kahnqiidabxomhvmfmgp.supabase.co:5432/postgres`;
  }

  if (!connectionString) {
    console.warn('Supabase connection string not configured. Set SUPABASE_DB_URL.');
    return null;
  }

  let originalHostname = null;
  let resolvedHostAddress = null;

  try {
    const dbUrl = new URL(connectionString);
    originalHostname = dbUrl.hostname;

    if (typeof dns.lookupSync === 'function') {
      const lookupResult = dns.lookupSync(originalHostname, { family: 4 });
      resolvedHostAddress =
        typeof lookupResult === 'string' ? lookupResult : lookupResult.address;
    }
  } catch (error) {
    console.warn('Unable to pre-resolve IPv4 address for database host:', error.message);
  }

  const poolConfig = {
    connectionString,
    ssl: {
      rejectUnauthorized: false,
      ...(originalHostname ? { servername: originalHostname } : {})
    },
    lookup: (hostname, options, callback) => {
      const lookupOptions = {
        family: 4,
        hints: dns.ADDRCONFIG
      };

      if (options) {
        Object.assign(lookupOptions, options);
        lookupOptions.hints = (options.hints ?? 0) | dns.ADDRCONFIG;
        lookupOptions.family = 4;
      }

      return dns.lookup(hostname, lookupOptions, callback);
    }
  };

  if (resolvedHostAddress) {
    poolConfig.host = resolvedHostAddress;
  }

  dbPool = new Pool(poolConfig);

  dbPool.on('error', (poolError) => {
    console.error('Unexpected Postgres client error:', poolError);
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

/** Minimal DB round-trip to wake free-tier Supabase when idle. */
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

/** Redirect browser to eBay to sign in and grant sell.fulfillment (Authorization Code). */
app.get('/api/ebay/oauth/start', (req, res) => {
  try {
    const state = ebaySellerOAuth.createOAuthState();
    const url = ebaySellerOAuth.buildAuthorizeUrl(state);
    res.redirect(302, url);
  } catch (error) {
    console.error('eBay OAuth start error:', error);
    res.status(500).type('text/plain').send(error instanceof Error ? error.message : String(error));
  }
});

/**
 * eBay redirects here after consent. Exchanges `code` for refresh token and stores it in `ebay_oauth_token`.
 * RuName’s Auth Accepted URL must hit this route. OAuth requests use EBAY_OAUTH_RU_NAME (RuName string), not a raw URL.
 */
app.get('/api/ebay/oauth/callback', async (req, res) => {
  const frontendSuccess =
    process.env.EBAY_OAUTH_SUCCESS_REDIRECT_URL?.trim() ||
    'http://localhost:3000/orders?tab=sales&ebay_oauth=success';
  const frontendErrorBase =
    process.env.EBAY_OAUTH_ERROR_REDIRECT_URL?.trim() ||
    'http://localhost:3000/orders?tab=sales&ebay_oauth=error';

  const code = req.query.code != null ? String(req.query.code) : '';
  const state = req.query.state != null ? String(req.query.state) : '';
  const oauthErr = req.query.error != null ? String(req.query.error) : '';

  if (oauthErr) {
    const desc =
      req.query.error_description != null ? String(req.query.error_description) : oauthErr;
    return res.redirect(302, `${frontendErrorBase}&ebay_oauth_msg=${encodeURIComponent(desc)}`);
  }

  if (!code || !state || !ebaySellerOAuth.consumeOAuthState(state)) {
    return res.redirect(
      302,
      `${frontendErrorBase}&ebay_oauth_msg=${encodeURIComponent('invalid_or_expired_state')}`
    );
  }

  try {
    const tokens = await ebaySellerOAuth.exchangeAuthorizationCode(code);
    const refresh = tokens.refresh_token;
    if (!refresh) {
      throw new Error(
        'eBay did not return refresh_token. Confirm OAuth scopes include sell.fulfillment and try again.'
      );
    }
    const scope = ebaySellerOAuth.getScopeString();
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

    const pool = getDatabasePool();
    if (!pool) {
      throw new Error('Database not configured');
    }

    const integrationKey = (
      process.env.EBAY_OAUTH_INTEGRATION_KEY || ebaySellerOAuth.DEFAULT_INTEGRATION_KEY
    ).trim();
    await ebaySellerOAuth.upsertRefreshToken(pool, {
      userName,
      refreshToken: String(refresh),
      scope,
      ebayUserId
    });
    ebaySellerOAuth.invalidateAccessTokenCache();
    console.log(`[eBay OAuth] refresh token stored (integration_key=${integrationKey})`);
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
      `SELECT user_name, ebay_user_id, updated_at, integration_key FROM ebay_oauth_token WHERE integration_key = $1`,
      [key]
    );
    const row = r.rows?.[0];
    if (!row) {
      return res.json({ connected: false, reason: 'no_row', integration_key: key });
    }
    return res.json({
      connected: true,
      user_name: row.user_name,
      ebay_user_id: row.ebay_user_id,
      updated_at: row.updated_at,
      integration_key: key
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
 */
const getBrowseSearch = async ({
  query,
  accessToken,
  limit = '5',
  sort = '-price',
  soldOnly = false,
  lastMonthOnly = false,
  soldDateRangeDays = null,
  requireUsedCondition = true,
  categoryIds = EBAY_GB_MENS_CLOTHING_CATEGORY_ID
}) => {
  const params = new URLSearchParams({
    q: query,
    limit,
    sort,
    marketplaceId: 'EBAY_GB'
  });

  if (categoryIds != null && String(categoryIds).trim() !== '') {
    params.set('category_ids', String(categoryIds).trim());
  }

  const filterParts = [];

  filterParts.push('deliveryCountry:GB');

  if (requireUsedCondition !== false) {
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
    throw new Error(`Browse API error: ${response.status}`);
  }

  return response.json();
};

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
      const data = await getBrowseSearch({ query: qAugmented, accessToken, limit, sort });
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
    // Get active listings from last month
    // For research, always filter to last 30 days
    const browseData = await getBrowseSearch({ 
      query: qAugmented, 
      accessToken, 
      limit: '50',
      lastMonthOnly: true // Always filter to last 30 days for research
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
        lastMonthOnly: true // Always filter to last 30 days for research
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
      'SELECT id, item_name, purchase_price, purchase_date, sale_date, sale_price, sold_platform, net_profit, vinted_id, ebay_id, depop_id, brand_id, category_id, brand_tag_image_id, projected_sale_price, category_size_id, sourced_location FROM stock ORDER BY purchase_date DESC NULLS LAST, item_name ASC'
    );

    res.json({
      rows: result.rows ?? [],
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
      `SELECT id, item_name, purchase_price, purchase_date, sale_date, sale_price, sold_platform, net_profit, vinted_id, ebay_id, depop_id, brand_id, category_id, brand_tag_image_id, projected_sale_price, category_size_id, sourced_location
       FROM stock
       WHERE sale_date IS NOT NULL
       ORDER BY sale_date DESC NULLS LAST, id DESC`
    );

    res.json({
      rows: result.rows ?? [],
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
 * (same order as columns left → right). Top clothing types and brands from sold lines.
 */
app.get('/api/stock/seasonal-insights', async (req, res) => {
  try {
    const pool = getDatabasePool();
    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

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
         FROM stock
         WHERE sale_date IS NOT NULL
           AND sale_date::date >= $1::date
           AND sale_date::date <= $2::date`,
        [start, end]
      );
      const saleCount = saleCountRes.rows[0]?.c ?? 0;

      const catRes = await pool.query(
        `SELECT COALESCE(cat.category_name, 'Uncategorized') AS name, COUNT(*)::int AS cnt
         FROM stock s
         LEFT JOIN category cat ON cat.id = s.category_id
         WHERE s.sale_date IS NOT NULL
           AND s.sale_date::date >= $1::date
           AND s.sale_date::date <= $2::date
         GROUP BY COALESCE(cat.category_name, 'Uncategorized')
         ORDER BY cnt DESC NULLS LAST, name ASC
         LIMIT 5`,
        [start, end]
      );

      const catWorstRes = await pool.query(
        `SELECT COALESCE(cat.category_name, 'Uncategorized') AS name, COUNT(*)::int AS cnt
         FROM stock s
         LEFT JOIN category cat ON cat.id = s.category_id
         WHERE s.sale_date IS NOT NULL
           AND s.sale_date::date >= $1::date
           AND s.sale_date::date <= $2::date
         GROUP BY COALESCE(cat.category_name, 'Uncategorized')
         ORDER BY cnt ASC NULLS LAST, name ASC
         LIMIT 5`,
        [start, end]
      );

      const brandRes = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM(b.brand_name), ''), 'Unknown brand') AS name, COUNT(*)::int AS cnt
         FROM stock s
         LEFT JOIN brand b ON b.id = s.brand_id
         WHERE s.sale_date IS NOT NULL
           AND s.sale_date::date >= $1::date
           AND s.sale_date::date <= $2::date
           AND LOWER(TRIM(COALESCE(b.brand_name, ''))) <> 'misc'
         GROUP BY COALESCE(NULLIF(TRIM(b.brand_name), ''), 'Unknown brand')
         ORDER BY cnt DESC NULLS LAST, name ASC
         LIMIT 5`,
        [start, end]
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
      `SELECT COUNT(*)::int AS c FROM stock WHERE sale_date IS NOT NULL`
    );
    const totalSoldLines = totalSoldRes.rows[0]?.c ?? 0;
    const seasonsWithSalesCount = columns.filter((c) => c.hasSalesData).length;

    let emptyMessage = null;
    if (totalSoldLines === 0) {
      emptyMessage =
        'No sold items with sale dates yet — seasonal breakdown will appear once you record sales.';
    } else if (seasonsWithSalesCount === 0) {
      emptyMessage =
        'None of your sales fall in these four meteorological seasons — keep logging sale dates to build this view.';
    }

    res.json({
      columns,
      totalSoldLines,
      seasonsWithSalesCount,
      emptyMessage,
    });
  } catch (error) {
    console.error('seasonal-insights failed:', error);
    res.status(500).json({ error: 'Failed to load seasonal insights', details: error.message });
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
  return Boolean(item.price);
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
      sourced_location
    } = req.body ?? {};

    const normalizedItemName = normalizeTextInput(item_name) ?? null;
    const normalizedCategoryId = category_id === null || category_id === undefined || category_id === '' ? null : Number(category_id);
    const normalizedSoldPlatform = normalizeTextInput(sold_platform) ?? null;
    const normalizedPurchasePrice = normalizeDecimalInput(purchase_price, 'purchase_price');
    const normalizedSalePrice = normalizeDecimalInput(sale_price, 'sale_price');
    const normalizedPurchaseDate = normalizeDateInputValue(purchase_date, 'purchase_date');
    const normalizedSaleDate = normalizeDateInputValue(sale_date, 'sale_date');
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
        sourced_location
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, item_name, purchase_price, purchase_date, sale_date, sale_price, sold_platform, net_profit, vinted_id, ebay_id, depop_id, brand_id, category_id, brand_tag_image_id, projected_sale_price, category_size_id, sourced_location
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
      normalizedSourcedLocation
    ]);

    res.status(201).json({ row: result.rows[0] });
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
      'SELECT id, item_name, purchase_price, purchase_date, sale_date, sale_price, sold_platform, vinted_id, ebay_id, depop_id, brand_id, category_id, brand_tag_image_id, projected_sale_price, category_size_id, sourced_location FROM stock WHERE id = $1',
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
          purchase_date = $4,
          sale_date = $5,
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
          sourced_location = $16
        WHERE id = $17
        RETURNING id, item_name, purchase_price, purchase_date, sale_date, sale_price, sold_platform, net_profit, vinted_id, ebay_id, depop_id, brand_id, category_id, brand_tag_image_id, projected_sale_price, category_size_id, sourced_location
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
        stockId
      ]
    );

    console.log('PUT /api/stock/:id - Update successful, returned row:', updateResult.rows[0]);
    res.json({ row: updateResult.rows[0] });
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
              b.description, b.menswear_category_id, b.department_id, d.department_name
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
  const { brand_name, menswear_category_id: bodyMenswearCatId, department_id: bodyBrandDeptId } =
    req.body ?? {};
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

    // Same name allowed in different departments; block duplicates within one department (case-insensitive)
    const existingResult = await pool.query(
      `SELECT id FROM brand
       WHERE LOWER(TRIM(BOTH FROM brand_name)) = LOWER(TRIM($1::text))
         AND department_id = $2`,
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

    const insertQuery = `
      INSERT INTO brand (brand_name, menswear_category_id, department_id)
      VALUES ($1, $2, $3)
      RETURNING id, brand_name, menswear_category_id, department_id
    `;

    const result = await pool.query(insertQuery, [
      normalizedBrandName,
      menswearCategoryId,
      brandDepartmentId,
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
      return res.status(400).json({
        error: 'A brand with this name already exists in this department',
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
      'SELECT department_id FROM public.brand WHERE id = $1',
      [id]
    );
    if (!currentBrand.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    let effectiveDepartmentIdForNameCheck = Number(currentBrand.rows[0].department_id);
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

    if (Object.prototype.hasOwnProperty.call(body, 'brand_name')) {
      const raw = body.brand_name;
      if (typeof raw !== 'string' || !raw.trim()) {
        return res.status(400).json({ error: 'brand_name cannot be empty' });
      }
      const normalizedName = raw.trim().slice(0, 500);
      const dup = await pool.query(
        `SELECT id FROM brand
         WHERE LOWER(TRIM(BOTH FROM brand_name)) = LOWER(TRIM($1::text))
           AND department_id = $2
           AND id <> $3`,
        [normalizedName, effectiveDepartmentIdForNameCheck, id]
      );
      if (dup.rowCount > 0) {
        return res.status(400).json({
          error: 'A brand with this name already exists in this department',
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
 */
async function ensureMenswearCategoryDepartmentSchema(pool) {
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
      ON public.brand (department_id, (LOWER(TRIM(BOTH FROM brand_name))));
    `);
  } catch (e) {
    console.warn(
      'ensureBrandUniquePerDepartmentSchema (composite index):',
      e.message,
      '— fix duplicate brand names within the same department if needed'
    );
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
         WHERE b.menswear_category_id IS NOT NULL
           ${dateFilterSql}
         GROUP BY b.menswear_category_id
       )
       SELECT
         c.id AS category_id,
         c.name AS category_name,
         COALESCE(s.total_sales, 0)::numeric AS total_sales,
         COALESCE(s.sold_count, 0)::int AS sold_count
       FROM menswear_category c
       LEFT JOIN sales s ON s.category_id = c.id
       WHERE COALESCE(s.total_sales, 0) > 0 OR COALESCE(s.sold_count, 0) > 0
       ORDER BY total_sales DESC NULLS LAST, category_name ASC`
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

    const result = await pool.query(
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
         WHERE s.sale_date IS NOT NULL
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
       WHERE COALESCE(s.total_sales, 0) > 0 OR COALESCE(s.sold_count, 0) > 0
       ORDER BY s.total_sales DESC NULLS LAST, category_name ASC`
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

    const result = await pool.query(
      `WITH per_cat AS (
         SELECT
           c.id AS category_id,
           c.category_name AS category_name,
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
         FROM category c
         LEFT JOIN stock s ON s.category_id = c.id
         GROUP BY c.id, c.category_name
       ),
       uncat AS (
         SELECT
           NULL::integer AS category_id,
           'Uncategorized'::text AS category_name,
           COUNT(*) FILTER (WHERE sale_date IS NOT NULL)::int AS sold_count,
           COUNT(*) FILTER (WHERE sale_date IS NULL)::int AS unsold_count,
           COALESCE(SUM(
             CASE
               WHEN sale_date IS NOT NULL
                AND net_profit IS NOT NULL
                AND TRIM(net_profit::text) <> ''
               THEN net_profit::numeric
               ELSE 0::numeric
             END
           ), 0::numeric) AS total_net_profit,
           COALESCE(SUM(
             CASE
               WHEN sale_date IS NULL
                AND purchase_price IS NOT NULL
                AND TRIM(purchase_price::text) <> ''
               THEN purchase_price::numeric
               ELSE 0::numeric
             END
           ), 0::numeric) AS unsold_inventory_total
         FROM stock
         WHERE category_id IS NULL
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
         category_name ASC`
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

    const whereSql = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const params = parsed.uncategorized ? [] : [parsed.categoryId];

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

    const whereSql = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const params = parsed.uncategorized ? [limit] : [parsed.categoryId, limit];

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
       LIMIT $${parsed.uncategorized ? '1' : '2'}`,
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

    const whereSql = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const params = parsed.uncategorized ? [limit] : [parsed.categoryId, limit];

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
       LIMIT $${parsed.uncategorized ? '1' : '2'}`,
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

    const typeWhere = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const qParams = parsed.uncategorized ? [] : [parsed.categoryId];

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
       LEFT JOIN category_size sz ON sz.id = s.category_size_id
       WHERE ${typeWhere}
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

    const typeWhere = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $2';
    const stockCheckSql = parsed.uncategorized
      ? 'SELECT 1 FROM stock WHERE brand_id = $1 AND category_id IS NULL LIMIT 1'
      : 'SELECT 1 FROM stock WHERE brand_id = $1 AND category_id = $2 LIMIT 1';
    const stockParams = parsed.uncategorized ? [brandId] : [brandId, parsed.categoryId];
    const hasStock = await pool.query(stockCheckSql, stockParams);
    if (!hasStock.rowCount) {
      return res.status(404).json({ error: 'No stock for this brand in this clothing type' });
    }

    const brandName = String(brandCheck.rows[0].brand_name ?? '');
    const qParams = parsed.uncategorized ? [brandId] : [brandId, parsed.categoryId];

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
         AND ${typeWhere}
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

    const typeWhere = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const qParams = parsed.uncategorized ? [] : [parsed.categoryId];

    const lifetimeCountResult = await pool.query(
      `SELECT COUNT(*)::int AS c FROM stock s WHERE ${typeWhere}`,
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
       WHERE ${typeWhere}`,
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
       WHERE ${typeWhere}`,
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
       WHERE ${typeWhere}`,
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
         s.ebay_id,
         s.vinted_id
       FROM stock s
       INNER JOIN brand b ON b.id = s.brand_id
       WHERE ${typeWhere}
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

    const typeSql = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const params = parsed.uncategorized ? [brandId] : [parsed.categoryId, brandId];
    const brandSlot = parsed.uncategorized ? '$1' : '$2';

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
         AND b.id = ${brandSlot}
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

    const typeSql = parsed.uncategorized ? 's.category_id IS NULL' : 's.category_id = $1';
    const params = parsed.uncategorized ? [brandId] : [parsed.categoryId, brandId];
    const brandSlot = parsed.uncategorized ? '$1' : '$2';

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
         AND b.id = ${brandSlot}
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

    const result = await pool.query(`
      SELECT c.id, c.category_name, c.department_id, d.department_name,
             COUNT(s.id)::int AS stock_count
      FROM category c
      LEFT JOIN department d ON d.id = c.department_id
      LEFT JOIN stock s ON s.category_id = c.id
      GROUP BY c.id, c.category_name, c.department_id, d.department_name
      ORDER BY d.department_name ASC NULLS LAST, c.category_name ASC
    `);

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
      return res.status(500).json({ error: 'Database connection not configured' });
    }

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

    // Check if category already exists (case-insensitive)
    const existingResult = await pool.query(
      'SELECT id FROM category WHERE LOWER(TRIM(category_name)) = LOWER($1)',
      [normalizedCategoryName]
    );

    if (existingResult.rowCount > 0) {
      return res.status(400).json({ error: 'Category already exists' });
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
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Category already exists' });
    }
    res.status(500).json({ error: 'Failed to create category', details: error.message });
  }
});

app.patch('/api/categories/:id', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid category id' });
    }

    const { category_name, department_id: bodyDepartmentId } = req.body ?? {};

    if (!category_name || typeof category_name !== 'string' || !category_name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const normalizedCategoryName = category_name.trim();

    const existingResult = await pool.query(
      'SELECT id FROM category WHERE LOWER(TRIM(category_name)) = LOWER($1) AND id <> $2',
      [normalizedCategoryName, id]
    );

    if (existingResult.rowCount > 0) {
      return res.status(400).json({ error: 'Category already exists' });
    }

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
      departmentIdSql = ', department_id = $2';
      params.push(did);
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
      return res.status(400).json({ error: 'Category already exists' });
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
          s.category_id
        FROM orders o
        INNER JOIN stock s ON o.stock_id = s.id
        ORDER BY o.created_at DESC`
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
          WHERE purchase_date IS NOT NULL
          GROUP BY month_start
        ),
        sale_totals AS (
          SELECT
            DATE_TRUNC('month', sale_date) AS month_start,
            SUM(COALESCE(sale_price, 0))::numeric AS total_sales
          FROM stock
          WHERE sale_date IS NOT NULL
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
          WHERE purchase_date IS NOT NULL
          GROUP BY month
        ),
        sale_totals AS (
          SELECT
            EXTRACT(MONTH FROM sale_date)::int AS month,
            SUM(COALESCE(sale_price, 0))::numeric AS total_sales
          FROM stock
          WHERE sale_date IS NOT NULL
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
          WHERE purchase_date IS NOT NULL
            AND EXTRACT(YEAR FROM purchase_date)::int = $1
          GROUP BY month
        ),
        sale_totals AS (
          SELECT
            EXTRACT(MONTH FROM sale_date)::int AS month,
            SUM(COALESCE(sale_price, 0))::numeric AS total_sales
          FROM stock
          WHERE sale_date IS NOT NULL
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
        WHERE purchase_date IS NOT NULL
        GROUP BY month
        ORDER BY month ASC
      ` : `
        SELECT
          EXTRACT(MONTH FROM purchase_date)::int AS month,
          SUM(COALESCE(purchase_price, 0))::numeric AS expense
        FROM stock
        WHERE purchase_date IS NOT NULL
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
        WHERE s.sale_date IS NOT NULL
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
        HAVING SUM(COALESCE(s.sale_price, 0)) > 0
        ORDER BY total_sales DESC
      ` : `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          SUM(COALESCE(s.sale_price, 0))::numeric AS total_sales
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE s.sale_date IS NOT NULL
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
        WHERE s.sale_date IS NOT NULL
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
        HAVING COUNT(*) > 0
        ORDER BY sold_count DESC
      ` : `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          COUNT(*)::int AS sold_count
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE s.sale_date IS NOT NULL
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
        WHERE s.sale_date IS NOT NULL
        GROUP BY COALESCE(c.category_name, 'Uncategorized')
      ` : `
        SELECT
          COALESCE(c.category_name, 'Uncategorized') AS category,
          SUM(
            COALESCE(s.sale_price, 0)::numeric - COALESCE(s.purchase_price, 0)::numeric
          )::numeric AS net_profit
        FROM stock s
        LEFT JOIN category c ON s.category_id = c.id
        WHERE s.sale_date IS NOT NULL
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
        WHERE s.purchase_date IS NOT NULL
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
        WHERE s.purchase_date IS NOT NULL
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
        WHERE s.sale_date IS NOT NULL
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
        WHERE s.sale_date IS NOT NULL
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
          WHERE s.sale_date IS NOT NULL
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
          WHERE s.sale_date IS NOT NULL
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
        WHERE s.sale_date IS NULL
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
        WHERE s.brand_id IS NOT NULL
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
        WHERE s.brand_id IS NOT NULL
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
        WHERE s.brand_id IS NOT NULL
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
        WHERE s.brand_id IS NOT NULL
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
    `);

    const totalListed = Number(sellThroughRateResult.rows[0]?.total_listed || 0);
    const totalSold = Number(sellThroughRateResult.rows[0]?.total_sold || 0);
    const sellThroughRate = totalListed > 0 ? (totalSold / totalListed) * 100 : 0;

    const averageSellingPriceResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE sale_date IS NOT NULL AND sale_price IS NOT NULL) AS sold_count,
        SUM(COALESCE(sale_price, 0))::numeric AS total_sales
      FROM stock
      WHERE sale_date IS NOT NULL
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
      WHERE sale_date IS NOT NULL
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
      ` : `
        SELECT
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND EXTRACT(YEAR FROM sale_date)::int = $1 THEN sale_price ELSE 0 END), 0)::numeric AS total_sales,
          COALESCE(SUM(CASE WHEN purchase_date IS NOT NULL AND EXTRACT(YEAR FROM purchase_date)::int = $1 THEN purchase_price ELSE 0 END), 0)::numeric AS total_spend
        FROM stock
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
      WHERE purchase_date IS NOT NULL AND sale_date IS NOT NULL
    `);

    const averageDaysToSell = averageDaysToSellResult.rows[0]?.average_days 
      ? Number(averageDaysToSellResult.rows[0].average_days) 
      : 0;

    const activeListingsResult = await pool.query(`
      SELECT COUNT(*) AS active_count
      FROM stock
      WHERE purchase_date IS NOT NULL AND sale_date IS NULL
    `);

    const activeListingsCount = Number(activeListingsResult.rows[0]?.active_count || 0);

    // Calculate unsold inventory value - filter by year if not "all"
    const unsoldInventoryQuery = effectiveYear === null ? `
      SELECT SUM(COALESCE(purchase_price, 0))::numeric AS total_value
      FROM stock
      WHERE purchase_date IS NOT NULL AND sale_date IS NULL
    ` : `
      SELECT SUM(COALESCE(purchase_price, 0))::numeric AS total_value
      FROM stock
      WHERE purchase_date IS NOT NULL 
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
        WHERE sale_date IS NOT NULL
          AND sale_price IS NOT NULL
        GROUP BY month
        ORDER BY month ASC
      ` : `
        SELECT
          EXTRACT(MONTH FROM sale_date)::int AS month,
          AVG(COALESCE(sale_price, 0))::numeric AS average_price,
          COUNT(*) AS item_count
        FROM stock
        WHERE sale_date IS NOT NULL
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
        WHERE sale_date IS NOT NULL
          AND sale_price IS NOT NULL
        GROUP BY month
        ORDER BY month ASC
      ` : `
        SELECT
          EXTRACT(MONTH FROM sale_date)::int AS month,
          AVG((COALESCE(sale_price, 0) - COALESCE(purchase_price, 0)))::numeric AS average_profit,
          COUNT(*) AS item_count
        FROM stock
        WHERE sale_date IS NOT NULL
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
        WHERE sale_date IS NOT NULL
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
        WHERE sale_date IS NOT NULL
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
      ` : `
        SELECT
          COALESCE(SUM(CASE WHEN purchase_date IS NOT NULL AND purchase_price IS NOT NULL AND EXTRACT(YEAR FROM purchase_date)::int = $1 THEN purchase_price ELSE 0 END), 0)::numeric AS total_purchase,
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND sale_price IS NOT NULL AND EXTRACT(YEAR FROM sale_date)::int = $1 THEN sale_price ELSE 0 END), 0)::numeric AS total_sales
        FROM stock
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
      ` : `
        SELECT
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND sale_price IS NOT NULL AND sold_platform = 'Vinted' AND EXTRACT(YEAR FROM sale_date)::int = $1 THEN sale_price ELSE 0 END), 0)::numeric AS vinted_sales,
          COALESCE(SUM(CASE WHEN sale_date IS NOT NULL AND sale_price IS NOT NULL AND sold_platform = 'eBay' AND EXTRACT(YEAR FROM sale_date)::int = $1 THEN sale_price ELSE 0 END), 0)::numeric AS ebay_sales
        FROM stock
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
      WHERE sale_date IS NOT NULL
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
      ` : `
        SELECT
          COUNT(*) FILTER (WHERE purchase_date IS NOT NULL AND EXTRACT(YEAR FROM purchase_date)::int = $1) AS items_listed,
          COUNT(*) FILTER (WHERE sale_date IS NOT NULL AND EXTRACT(YEAR FROM sale_date)::int = $1) AS items_sold
        FROM stock
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
        SELECT SUM(COALESCE(sale_price, 0))::numeric AS total_sales
        FROM stock
        WHERE sale_date IS NOT NULL
          AND sale_date >= $1
          AND sale_date <= $2
      `,
      [currentMonthStart, now]
    );
    const currentMonthSales = Number(currentMonthSalesResult.rows[0]?.total_sales || 0);

    // Calculate current week sales (from start of current week - Monday - to now)
    const currentWeekStart = new Date(now);
    const dayOfWeek = currentWeekStart.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // If Sunday, go back 6 days, otherwise go back (dayOfWeek - 1) days
    currentWeekStart.setDate(currentWeekStart.getDate() - daysToMonday);
    currentWeekStart.setHours(0, 0, 0, 0);
    
    const currentWeekSalesResult = await pool.query(
      `
        SELECT SUM(COALESCE(sale_price, 0))::numeric AS total_sales
        FROM stock
        WHERE sale_date IS NOT NULL
          AND sale_date >= $1
          AND sale_date <= $2
      `,
      [currentWeekStart, now]
    );
    const currentWeekSales = Number(currentWeekSalesResult.rows[0]?.total_sales || 0);

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
      currentWeekSales: currentWeekSales
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

app.post('/api/gemini/research', async (req, res) => {
  try {
    // Debug: Log the raw request body first
    console.log('=== GEMINI RESEARCH REQUEST ===');
    console.log('Raw req.body keys:', Object.keys(req.body));
    console.log('req.body.text:', req.body.text ? `present (${req.body.text.length} chars)` : 'missing');
    console.log('req.body.images:', Array.isArray(req.body.images) ? `array[${req.body.images.length}]` : req.body.images);
    console.log('req.body.image:', req.body.image ? 'present' : 'missing');
    
    const { text, images, image } = req.body; // Support both 'images' (array) and 'image' (single) for backward compatibility
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    // Normalize: convert single 'image' to 'images' array if needed
    let imageArray = [];
    if (Array.isArray(images)) {
      imageArray = images;
      console.log('Using images array, length:', imageArray.length);
    } else if (image) {
      imageArray = [image];
      console.log('Using single image, converted to array');
    } else {
      console.log('No images found in request');
    }

    // Debug logging (remove in production if needed)
    console.log('Normalized values:', {
      hasText: !!text,
      textLength: text ? text.length : 0,
      imagesCount: imageArray.length,
      imagesType: Array.isArray(images) ? 'array' : typeof images,
      hasImage: !!image
    });
    console.log('==============================');

    if (!text && imageArray.length === 0) {
      return res.status(400).json({ error: 'Either text or at least one image is required' });
    }

    const instruction = `You are a professional UK Vinted reseller whose mission is to evaluate whether a given item is worth buying for resale, based on data, condition, and profit potential, without ever guessing. You must analyse all available photos and text carefully to identify brand, design, materials, tags, and condition details. You are responsible for checking authenticity by reviewing stitching, logos, fonts, care labels, and hardware. If key photos or information are missing, you must return "Needs Info" and clearly list what is required to make an accurate judgement. For each item, identify and record the brand, pattern, material, size, edition type (standard, limited, or special), and production country. Estimate when the item was made if possible, and state uncertainty when unsure. Research the brand to determine if it is high-end, mid-range, high-street, or budget, and note whether it has collector or niche appeal. Assess the build quality based on material and construction, and classify it as cheap, mid, or premium. You must research at least three to ten comparable sold listings within the last one hundred and eighty days for items of similar size and condition. Report the median sold price and the overall sell-through rate for that category. Estimate the original retail price range if possible, as well as the expected resale price range and the likely time to sell. Include all costs in your calculations, such as buying price, platform and payment fees, postage, packaging, cleaning, repairs, and refund risk. Calculate both the expected net profit and the net profit margin. Only recommend an item for purchase if the expected net profit margin is at least fifty percent, the net profit is at least ten pounds, authenticity confidence is at least eighty percent, and either the sell-through rate is above thirty percent or the median days on market is below ninety days. You must grade item condition using a standard six-point scale: New, Like New, Excellent, Good, Fair, or For Parts. Apply the correct category-specific checks and measurements, such as clothing measurements, shoe sizes, or functionality tests for electronics. Flag any compliance or safety concerns, such as fakes, missing labels, or restricted products. When you output results, include the item title, a concise buyer overview summarizing your research, and a detailed resale matrix. The matrix must show the recommended buy price ceiling, expected resale range, estimated original retail price, expected profit range, profit margin percentage, sell-through rate, median and P90 days to sell, authenticity confidence, seasonality indicator (positive, neutral, or negative), item tier (high-end, mid, high-street, or low), and a final decision of Yes, No, or Needs Info. Include a dedicated authenticity review explaining your confidence level and listing the reasons, such as tag style, label format, stitching, hardware, or logo placement. Add detailed notes on item condition, including any wear, defects, or cleaning needs. If important information or photos are missing, include a list of what must be provided to make a full decision. Always state uncertainty clearly and never make assumptions. Every recommendation must be supported by verifiable data and clear reasoning. Focus on realistic resale speed, genuine authenticity, and true net profit after costs. Reject any item that cannot meet the minimum profit and confidence thresholds or that carries a high risk of being fake or slow to sell.`;

    const parts = [];
    
    if (text) {
      parts.push({
        text: `${instruction}\n\nItem description or query: ${text}`
      });
    }

    // Handle multiple images
    for (const image of imageArray) {
      // Detect MIME type from base64 data URL if present, default to jpeg
      let mimeType = 'image/jpeg';
      let base64Image = image;
      
      if (image.startsWith('data:image/')) {
        const mimeMatch = image.match(/data:image\/([a-z]+);base64,/);
        if (mimeMatch) {
          mimeType = `image/${mimeMatch[1]}`;
        }
        base64Image = image.replace(/^data:image\/[a-z]+;base64,/, '');
      }
      
      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: base64Image
        }
      });
    }

    const requestBody = {
      contents: [{
        parts: parts
      }]
    };

    // Use gemini-2.5-flash which supports both text and images (free tier: 15 RPM, 1,500 RPD)
    const modelName = 'gemini-2.5-flash';
    const apiVersion = 'v1beta';
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      return res.status(response.status).json({ 
        error: 'Failed to get response from Gemini API', 
        details: errorText 
      });
    }

    const data = await response.json();
    
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      return res.status(500).json({ error: 'Invalid response from Gemini API' });
    }

    const result = data.candidates[0].content.parts[0].text;

    res.json({ result });
  } catch (error) {
    console.error('Gemini research error:', error);
    res.status(500).json({ error: 'Failed to process research request', details: error.message });
  }
});

const buildDirectory = path.join(__dirname, 'build');

if (fs.existsSync(buildDirectory)) {
  app.use(express.static(buildDirectory));

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

    return res.sendFile(path.join(buildDirectory, 'index.html'));
  });
}

async function startServer() {
  await ensureDatabaseSchema();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Settings endpoint: http://localhost:${PORT}/api/settings`);
    console.log(`eBay API: http://localhost:${PORT}/api/ebay/search | sold-recent: /api/ebay/sold-recent?q=...`);
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});



