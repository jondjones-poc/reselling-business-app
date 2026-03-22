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

// Fallback array (kept for reference, but should not be used if JSON loads successfully)
const mensResaleReferenceFallback = [
  {
    brand: "AllSaints",
    status: "✅",
    note: "Premium menswear — leather, knits, denim move fast.",
    categories: [
      { item: "Outerwear", resaleRange: "£60–£120" },
      { item: "Knitwear", resaleRange: "£40–£70" },
      { item: "Denim", resaleRange: "£40–£70" }
    ]
  },
  {
    brand: "Aligne",
    status: "❌",
    note: "Womenswear focused; no mens resale market.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "AMI Paris",
    status: "✅",
    note: "Modern French designer with loyal buyers.",
    categories: [
      { item: "Sweatshirts", resaleRange: "£60–£100" },
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Knitwear", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "A.P.C.",
    status: "✅",
    note: "French minimalist; premium selvedge denim holds strong value.",
    categories: [
      { item: "Denim", resaleRange: "£60–£100" },
      { item: "Jackets", resaleRange: "£70–£120" }
    ]
  },
  {
    brand: "Aquascutum",
    status: "✅",
    note: "British heritage tailoring and trench coats.",
    categories: [
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Suits", resaleRange: "£100–£180" }
    ]
  },
  {
    brand: "Arket",
    status: "✅",
    note: "High-quality minimalist menswear from H&M Group's premium line.",
    categories: [
      { item: "Coats", resaleRange: "£60–£100" },
      { item: "Knitwear", resaleRange: "£40–£70" },
      { item: "Shirts", resaleRange: "£30–£50" }
    ]
  },
  {
    brand: "Arc'teryx",
    status: "✅",
    note: "Technical outdoor wear with cult resale base.",
    categories: [{ item: "Outerwear", resaleRange: "£100–£200" }]
  },
  {
    brand: "Atmosphere",
    status: "❌",
    note: "Primark sub-brand; zero resale interest.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Banana Republic",
    status: "⚠️",
    note: "Buy only tailored wool coats or chinos; most slow sellers.",
    categories: [{ item: "Outerwear", resaleRange: "£30–£60" }]
  },
  {
    brand: "Baracuta",
    status: "✅",
    note: "Iconic G9 Harrington jacket; UK classic resale hit.",
    categories: [{ item: "Outerwear", resaleRange: "£70–£120" }]
  },
  {
    brand: "Barbour",
    status: "✅",
    note: "UK heritage label; wax and quilted jackets resell fast.",
    categories: [{ item: "Outerwear", resaleRange: "£80–£150" }]
  },
  {
    brand: "Barbour Beacon",
    status: "⚠️",
    note: "Cheaper Barbour range; slower sales, lower quality.",
    categories: [{ item: "Outerwear", resaleRange: "£25–£50" }]
  },
  {
    brand: "Barbour International",
    status: "✅",
    note: "Popular biker sub-line; solid resale for jackets/gilets.",
    categories: [{ item: "Outerwear", resaleRange: "£60–£100" }]
  },
  {
    brand: "Barbour Gold Standard",
    status: "✅",
    note: "Collector range; high demand and resale prices.",
    categories: [{ item: "Outerwear", resaleRange: "£120–£200" }]
  },
  {
    brand: "Belstaff",
    status: "✅",
    note: "Luxury moto outerwear; jackets flip quickly £100+.",
    categories: [{ item: "Outerwear", resaleRange: "£100–£250" }]
  },
  {
    brand: "Ben Sherman",
    status: "⚠️",
    note: "Retro Mod appeal; vintage shirts worth it only.",
    categories: [{ item: "Shirts", resaleRange: "£20–£35" }]
  },
  {
    brand: "Bershka",
    status: "❌",
    note: "Youth fast fashion; poor quality, low resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Blue Harbour",
    status: "❌",
    note: "M&S sub-line, dated and low demand.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "BoohooMAN",
    status: "❌",
    note: "Ultra-fast fashion; flooded market.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Brakeburn",
    status: "⚠️",
    note: "Casual coastal wear; only if mint condition.",
    categories: [
      { item: "Shirts", resaleRange: "£15–£25" },
      { item: "Knitwear", resaleRange: "£20–£30" }
    ]
  },
  {
    brand: "Burton",
    status: "❌",
    note: "Defunct high street label; weak resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Calvin Klein Jeans",
    status: "⚠️",
    note: "Only premium denim or heavy-logo sweats sell.",
    categories: [
      { item: "Denim", resaleRange: "£25–£40" },
      { item: "Sweatshirts", resaleRange: "£25–£35" }
    ]
  },
  {
    brand: "Carhartt WIP",
    status: "✅",
    note: "Workwear/streetwear crossover; reliable resale base.",
    categories: [
      { item: "Jackets", resaleRange: "£60–£100" },
      { item: "Workwear", resaleRange: "£40–£80" },
      { item: "Cargo", resaleRange: "£35–£60" }
    ]
  },
  {
    brand: "Charles Tyrwhitt",
    status: "⚠️",
    note: "Common businesswear; only limited or luxury cotton shirts move.",
    categories: [{ item: "Shirts", resaleRange: "£25–£40" }]
  },
  {
    brand: "Cheaney",
    status: "✅",
    note: "Heritage Northampton shoemaker; handmade leather boots.",
    categories: [
      { item: "Shoes", resaleRange: "£90–£150" },
      { item: "Boots", resaleRange: "£100–£160" }
    ]
  },
  {
    brand: "Church's",
    status: "✅",
    note: "Top-end English dress shoes with collector appeal.",
    categories: [{ item: "Shoes", resaleRange: "£120–£200" }]
  },
  {
    brand: "CP Company",
    status: "✅",
    note: "Italian technical streetwear; strong resale market.",
    categories: [
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Sweatshirts", resaleRange: "£50–£100" }
    ]
  },
  {
    brand: "Crockett & Jones",
    status: "✅",
    note: "Luxury UK-made footwear; elite resale value.",
    categories: [{ item: "Shoes", resaleRange: "£120–£250" }]
  },
  {
    brand: "Cotton On",
    status: "❌",
    note: "Low-cost fast fashion; poor resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Crew Clothing",
    status: "❌",
    note: "Too common on resale platforms.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Diesel",
    status: "✅",
    note: "Premium Italian denim; made-in-Italy lines resell well.",
    categories: [
      { item: "Denim", resaleRange: "£40–£80" },
      { item: "Jackets", resaleRange: "£50–£100" }
    ]
  },
  {
    brand: "Dr. Martens Made in England",
    status: "✅",
    note: "Strong resale, collector appeal. Avoid Asia-made lines.",
    categories: [{ item: "Boots", resaleRange: "£60–£120" }]
  },
  {
    brand: "Dune Mens",
    status: "✅",
    note: "Real leather shoes £25–£50 resale; skip synthetic pairs.",
    categories: [{ item: "Shoes", resaleRange: "£25–£50" }]
  },
  {
    brand: "Eton Shirts",
    status: "✅",
    note: "Swedish premium shirtmaker; fast resale £40–£80.",
    categories: [{ item: "Shirts", resaleRange: "£40–£80" }]
  },
  {
    brand: "Filson",
    status: "✅",
    note: "US heritage outdoor gear; jackets sell £80–£150.",
    categories: [
      { item: "Outerwear", resaleRange: "£80–£150" },
      { item: "Bags", resaleRange: "£60–£100" }
    ]
  },
  {
    brand: "French Connection",
    status: "❌",
    note: "Overproduced; little resale interest.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "GANT",
    status: "✅",
    note: "Premium preppy; polos and knits have steady resale.",
    categories: [
      { item: "Knitwear", resaleRange: "£30–£60" },
      { item: "Shirts", resaleRange: "£25–£45" }
    ]
  },
  {
    brand: "Grenson",
    status: "✅",
    note: "Premium British shoe brand; good market base.",
    categories: [
      { item: "Shoes", resaleRange: "£80–£150" },
      { item: "Boots", resaleRange: "£90–£160" }
    ]
  },
  {
    brand: "Hackett",
    status: "✅",
    note: "Upper-tier British casualwear, steady resale.",
    categories: [
      { item: "Shirts", resaleRange: "£30–£50" },
      { item: "Jackets", resaleRange: "£60–£100" }
    ]
  },
  {
    brand: "H&M",
    status: "❌",
    note: "Mass-market, oversaturated.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  },
  {
    brand: "Jaeger",
    status: "✅",
    note: "British tailoring, wool coats and suits resell well.",
    categories: [
      { item: "Suits", resaleRange: "£60–£120" },
      { item: "Outerwear", resaleRange: "£70–£130" }
    ]
  },
  {
    brand: "John Smedley",
    status: "✅",
    note: "Luxury knitwear brand; Merino & Sea Island cotton strong.",
    categories: [{ item: "Knitwear", resaleRange: "£50–£90" }]
  },
  {
    brand: "Lacoste",
    status: "✅",
    note: "Polos and knitwear resell quickly.",
    categories: [
      { item: "Polos", resaleRange: "£25–£50" },
      { item: "Knitwear", resaleRange: "£30–£60" }
    ]
  },
  {
    brand: "Levi's",
    status: "✅",
    note: "Heritage denim. Vintage or 501s sell fast.",
    categories: [
      { item: "Denim", resaleRange: "£30–£70" },
      { item: "Jackets", resaleRange: "£50–£80" }
    ]
  },
  {
    brand: "Loake",
    status: "✅",
    note: "Northampton heritage shoemaker; solid resale.",
    categories: [{ item: "Shoes", resaleRange: "£60–£120" }]
  },
  {
    brand: "Patagonia",
    status: "✅",
    note: "Outdoor brand with high resale £50–£100.",
    categories: [
      { item: "Outerwear", resaleRange: "£70–£120" },
      { item: "Fleeces", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Paul Smith",
    status: "✅",
    note: "British designer, shirts & shoes strong resale.",
    categories: [
      { item: "Shirts", resaleRange: "£50–£90" },
      { item: "Shoes", resaleRange: "£70–£130" }
    ]
  },
  {
    brand: "Ralph Lauren (Standard)",
    status: "✅",
    note: "Core polos & knits steady resale.",
    categories: [
      { item: "Polos", resaleRange: "£25–£40" },
      { item: "Knitwear", resaleRange: "£30–£50" }
    ]
  },
  {
    brand: "Reiss",
    status: "✅",
    note: "Premium high-street tailoring.",
    categories: [
      { item: "Suits", resaleRange: "£70–£120" },
      { item: "Shirts", resaleRange: "£30–£60" }
    ]
  },
  {
    brand: "RM Williams",
    status: "✅",
    note: "Australian Chelsea boots; cult following.",
    categories: [{ item: "Shoes", resaleRange: "£100–£180" }]
  },
  {
    brand: "Stone Island",
    status: "✅",
    note: "Cult label, fast resale turnover.",
    categories: [
      { item: "Outerwear", resaleRange: "£100–£200" },
      { item: "Sweatshirts", resaleRange: "£60–£120" }
    ]
  },
  {
    brand: "Ted Baker",
    status: "✅",
    note: "Premium tailoring & footwear resale well.",
    categories: [
      { item: "Suits", resaleRange: "£60–£120" },
      { item: "Shoes", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Timberland",
    status: "✅",
    note: "Boots & jackets move fast £40–£100.",
    categories: [
      { item: "Shoes", resaleRange: "£50–£100" },
      { item: "Outerwear", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Tommy Hilfiger",
    status: "✅",
    note: "Classic brand; polos & jackets £25–£60.",
    categories: [
      { item: "Polos", resaleRange: "£25–£50" },
      { item: "Outerwear", resaleRange: "£50–£90" }
    ]
  },
  {
    brand: "Tricker's",
    status: "✅",
    note: "Heritage British shoemaker; high-end resale.",
    categories: [{ item: "Shoes", resaleRange: "£90–£150" }]
  },
  {
    brand: "Turnbull & Asser",
    status: "✅",
    note: "Savile Row shirtmaker; luxury resale.",
    categories: [{ item: "Shirts", resaleRange: "£80–£150" }]
  },
  {
    brand: "Whistles Mens",
    status: "✅",
    note: "Premium menswear; wool coats & knits resell.",
    categories: [
      { item: "Outerwear", resaleRange: "£60–£100" },
      { item: "Knitwear", resaleRange: "£40–£70" }
    ]
  },
  {
    brand: "Wrangler",
    status: "✅",
    note: "Western/workwear denim, steady demand.",
    categories: [
      { item: "Denim", resaleRange: "£25–£45" },
      { item: "Jackets", resaleRange: "£30–£60" }
    ]
  },
  {
    brand: "Zara",
    status: "❌",
    note: "Fast fashion, oversaturated resale.",
    categories: [{ item: "All", resaleRange: "£0.00" }]
  }
];

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

const coalesceNetProfitExpression = `
  COALESCE(
    net_profit,
    COALESCE(sale_price, 0) - COALESCE(purchase_price, 0)
  )
`;

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

const publicUrlForBrandTag = (storagePath) => {
  const sb = getSupabaseAdmin();
  if (!sb || !storagePath) return null;
  const { data } = sb.storage.from(BRAND_TAG_IMAGE_BUCKET).getPublicUrl(storagePath);
  return data?.publicUrl ?? null;
};

// Load settings at startup
loadSettings();

// Initialize database settings table on startup
(async () => {
  const pool = getDatabasePool();
  if (pool) {
    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS app_settings (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
      );
      console.log('App settings table initialized');
    } catch (error) {
      console.warn('Could not initialize app_settings table:', error.message);
    }
  }
})();

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
      `SELECT id, brand_id, storage_path, caption, sort_order, content_type, image_kind, created_at, updated_at
       FROM brand_tag_image
       WHERE brand_id = $1
       ORDER BY CASE WHEN image_kind = 'fake_check' THEN 1 ELSE 0 END, sort_order ASC, id ASC`,
      [brandId]
    );

    const rows = (result.rows ?? []).map((row) => ({
      ...row,
      public_url: publicUrlForBrandTag(row.storage_path),
    }));

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
    const imageKind =
      typeof kindRaw === 'string' && kindRaw.trim() === 'fake_check' ? 'fake_check' : 'tag';

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
        `INSERT INTO brand_tag_image (id, brand_id, storage_path, caption, content_type, image_kind)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, brand_id, storage_path, caption, sort_order, content_type, image_kind, created_at, updated_at`,
        [imageRowId, brandId, storagePath, caption, req.file.mimetype, imageKind]
      );

      const row = insertResult.rows[0];
      res.status(201).json({
        ...row,
        public_url: publicUrlForBrandTag(row.storage_path),
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
      if (k !== 'tag' && k !== 'fake_check') {
        return res.status(400).json({ error: 'imageKind must be "tag" or "fake_check"' });
      }
      imageKind = k;
    }

    if (!captionProvided && imageKind === null) {
      return res.status(400).json({ error: 'Provide caption and/or imageKind' });
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
    sets.push('updated_at = NOW()');
    params.push(id);

    const result = await pool.query(
      `UPDATE brand_tag_image
       SET ${sets.join(', ')}
       WHERE id = $${n}
       RETURNING id, brand_id, storage_path, caption, sort_order, content_type, image_kind, created_at, updated_at`,
      params
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Not found' });
    }

    const row = result.rows[0];
    res.json({
      ...row,
      public_url: publicUrlForBrandTag(row.storage_path),
    });
  } catch (error) {
    console.error('Brand tag image patch failed:', error);
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
 * Builds Browse `q`: phrase in double quotes so multi-word brands match as a phrase (AND-style),
 * not loose keywords — e.g. "All Saints mens" avoids YSL listings that only share the token "All".
 * Appends mens when missing. Strips stray quotes inside the phrase.
 */
function augmentEbaySearchQuery(raw) {
  let q = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
  if (!q) return q;
  if (q.length >= 2 && q.startsWith('"') && q.endsWith('"')) {
    q = q.slice(1, -1).trim();
  }
  q = q.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return '';
  if (!/\bmen'?s\b|\bmens\b/i.test(q)) {
    q = `${q} mens`;
  }
  return `"${q}"`;
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

const getCompletedItems = async (query, appId, oauthToken) => {
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.13.0',
    'SECURITY-APPNAME': appId,
    'GLOBAL-ID': 'EBAY-GB',
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    keywords: query,
    siteId: '3',
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true'
  });

  const url = `https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`;

  const headers = {
    Accept: 'application/json',
    'X-EBAY-SOA-GLOBAL-ID': 'EBAY-GB'
  };

  if (process.env.EBAY_T) {
    headers['X-EBAY-SOA-SECURITY-TOKEN'] = process.env.EBAY_T;
  } else {
    headers['X-EBAY-SOA-SECURITY-APPNAME'] = appId;
  }

  if (oauthToken) {
    headers['X-EBAY-SOA-SECURITY-OAUTH-TOKEN'] = oauthToken;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('findCompletedItems error:', response.status, errorText);
    throw new Error(`findCompletedItems error: ${response.status} - ${errorText}`);
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
      const qAugmented = augmentEbaySearchQuery(q);
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
    const qAugmented = augmentEbaySearchQuery(q);
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
  const qAugmented = augmentEbaySearchQuery(String(brandName).trim());
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
     WHERE brand_id = $1
     ORDER BY
       CASE WHEN image_kind = 'fake_check' THEN 1 ELSE 0 END,
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
      'SELECT id, item_name, purchase_price, purchase_date, sale_date, sale_price, sold_platform, net_profit, vinted_id, ebay_id, depop_id, brand_id, category_id, projected_sale_price FROM stock ORDER BY purchase_date DESC NULLS LAST, item_name ASC'
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
      net_profit,
      vinted_id,
      ebay_id,
      depop_id,
      brand_id,
      projected_sale_price
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
        projected_sale_price
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, item_name, purchase_price, purchase_date, sale_date, sale_price, sold_platform, net_profit, vinted_id, ebay_id, depop_id, brand_id, category_id, projected_sale_price
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
      normalizedProjectedSalePrice
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
      'SELECT id, item_name, purchase_price, purchase_date, sale_date, sale_price, sold_platform, vinted_id, ebay_id, depop_id, brand_id, category_id, projected_sale_price FROM stock WHERE id = $1',
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
          projected_sale_price = $13
        WHERE id = $14
        RETURNING id, item_name, purchase_price, purchase_date, sale_date, sale_price, sold_platform, net_profit, vinted_id, ebay_id, depop_id, brand_id, category_id, projected_sale_price
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
        finalProjectedSalePrice,
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

    // Query all columns explicitly
    const result = await pool.query(
      'SELECT id, brand_name, created_at, updated_at, brand_website, things_to_buy, things_to_avoid FROM public.brand ORDER BY brand_name ASC'
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
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const { brand_name } = req.body ?? {};

    if (!brand_name || typeof brand_name !== 'string' || !brand_name.trim()) {
      return res.status(400).json({ error: 'Brand name is required' });
    }

    const normalizedBrandName = brand_name.trim();

    // Check if brand already exists (case-insensitive)
    const existingResult = await pool.query(
      'SELECT id FROM brand WHERE LOWER(TRIM(brand_name)) = LOWER($1)',
      [normalizedBrandName]
    );

    if (existingResult.rowCount > 0) {
      return res.status(400).json({ error: 'Brand already exists' });
    }

    const insertQuery = `
      INSERT INTO brand (brand_name)
      VALUES ($1)
      RETURNING id, brand_name
    `;

    const result = await pool.query(insertQuery, [normalizedBrandName]);

    res.status(201).json({ row: result.rows[0] });
  } catch (error) {
    console.error('Brand insert failed:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Brand already exists' });
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

    const body = req.body ?? {};
    const sets = [];
    const vals = [];
    let n = 1;

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

    if (sets.length === 0) {
      return res.status(400).json({
        error: 'Provide at least one of: brand_website, things_to_buy, things_to_avoid',
      });
    }

    sets.push('updated_at = NOW()');
    vals.push(id);

    const result = await pool.query(
      `UPDATE brand
       SET ${sets.join(', ')}
       WHERE id = $${n}
       RETURNING id, brand_name, created_at, updated_at, brand_website, things_to_buy, things_to_avoid`,
      vals
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    res.json({ row: result.rows[0] });
  } catch (error) {
    console.error('Brand patch failed:', error);
    res.status(500).json({ error: 'Failed to update brand', details: error.message });
  }
});

/**
 * Brand research: stock sold vs unsold (by sale_price), top sold lines, longest-unsold by purchase_date.
 * GET /api/brands/:brandId/stock-summary
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
      `,
      [brandId]
    );

    const countsRow = countsResult.rows[0] || {};
    const totalItems = Number(countsRow.total_items) || 0;
    const soldCount = Number(countsRow.sold_count) || 0;
    const unsoldCount = Number(countsRow.unsold_count) || 0;

    const topResult = await pool.query(
      `
        SELECT
          s.id,
          s.item_name,
          s.purchase_price,
          s.sale_price,
          s.sale_date,
          c.category_name,
          (s.sale_price::numeric - s.purchase_price::numeric) AS profit,
          CASE
            WHEN COALESCE(s.purchase_price::numeric, 0) > 0
            THEN (s.sale_price::numeric / s.purchase_price::numeric)
            ELSE NULL
          END AS profit_multiple
        FROM stock s
        LEFT JOIN category c ON c.id = s.category_id
        WHERE s.brand_id = $1
          AND s.sale_price IS NOT NULL
          AND s.sale_price::numeric > 0
          AND s.purchase_price IS NOT NULL
          AND s.purchase_price::numeric > 0
        ORDER BY
          profit_multiple DESC NULLS LAST,
          profit DESC NULLS LAST,
          s.sale_date DESC NULLS LAST,
          s.id DESC
        LIMIT 30
      `,
      [brandId]
    );

    const topSoldItems = topResult.rows.map((row) => ({
      id: row.id != null ? Number(row.id) : null,
      item_name: row.item_name != null ? String(row.item_name) : '',
      category_name: row.category_name != null ? String(row.category_name) : null,
      purchase_price: row.purchase_price != null ? Number(row.purchase_price) : null,
      sale_price: row.sale_price != null ? Number(row.sale_price) : null,
      sale_date: row.sale_date != null ? row.sale_date : null,
      profit: row.profit != null ? Number(row.profit) : null,
      profit_multiple: row.profit_multiple != null ? Number(row.profit_multiple) : null,
    }));

    const longestUnsoldResult = await pool.query(
      `
        SELECT
          s.id,
          s.item_name,
          s.purchase_price,
          s.purchase_date,
          c.category_name
        FROM stock s
        LEFT JOIN category c ON c.id = s.category_id
        WHERE s.brand_id = $1
          AND s.purchase_date IS NOT NULL
          AND NOT (s.sale_price IS NOT NULL AND s.sale_price::numeric > 0)
        ORDER BY s.purchase_date ASC NULLS LAST, s.id ASC
        LIMIT 5
      `,
      [brandId]
    );

    const longestUnsoldItems = longestUnsoldResult.rows.map((row) => ({
      id: row.id != null ? Number(row.id) : null,
      item_name: row.item_name != null ? String(row.item_name) : '',
      category_name: row.category_name != null ? String(row.category_name) : null,
      purchase_price: row.purchase_price != null ? Number(row.purchase_price) : null,
      purchase_date: row.purchase_date != null ? row.purchase_date : null,
    }));

    res.json({
      brandId,
      totalItems,
      soldCount,
      unsoldCount,
      topSoldItems,
      longestUnsoldItems,
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

// Category API endpoints
app.get('/api/categories', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const result = await pool.query(
      'SELECT id, category_name FROM category ORDER BY category_name ASC'
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

app.post('/api/categories', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const { category_name } = req.body ?? {};

    if (!category_name || typeof category_name !== 'string' || !category_name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const normalizedCategoryName = category_name.trim();

    // Check if category already exists (case-insensitive)
    const existingResult = await pool.query(
      'SELECT id FROM category WHERE LOWER(TRIM(category_name)) = LOWER($1)',
      [normalizedCategoryName]
    );

    if (existingResult.rowCount > 0) {
      return res.status(400).json({ error: 'Category already exists' });
    }

    const insertQuery = `
      INSERT INTO category (category_name)
      VALUES ($1)
      RETURNING id, category_name
    `;

    const result = await pool.query(insertQuery, [normalizedCategoryName]);

    res.status(201).json({ row: result.rows[0] });
  } catch (error) {
    console.error('Category insert failed:', error);
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Category already exists' });
    }
    res.status(500).json({ error: 'Failed to create category', details: error.message });
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

    // Debug: Check all sales for this month to see what we're working with
    const debugResult = await pool.query(
      `
        SELECT
          id,
          item_name,
          sale_date,
          sale_price,
          sold_platform,
          vinted_id,
          ebay_id,
          EXTRACT(YEAR FROM sale_date)::int AS sale_year,
          EXTRACT(MONTH FROM sale_date)::int AS sale_month
        FROM stock
        WHERE sale_date IS NOT NULL
          AND EXTRACT(YEAR FROM sale_date)::int = $1
          AND EXTRACT(MONTH FROM sale_date)::int = $2
        ORDER BY sale_date DESC
      `,
      [requestedYear, requestedMonth]
    );
    console.log(`[Monthly Platform] Debug: Found ${debugResult.rows.length} items sold in ${requestedMonth}/${requestedYear}`);
    if (debugResult.rows.length > 0) {
      const totalSales = debugResult.rows.reduce((sum, r) => sum + (Number(r.sale_price) || 0), 0);
      console.log(`[Monthly Platform] Total sales amount: £${totalSales.toFixed(2)}`);
      console.log('[Monthly Platform] All items with sold_platform values:');
      debugResult.rows.forEach(r => {
        console.log(`  - ${r.item_name}: sold_platform="${r.sold_platform}" (type: ${typeof r.sold_platform}), vinted_id=${r.vinted_id || 'null'}, ebay_id=${r.ebay_id || 'null'}, sale_price=£${r.sale_price}`);
      });
      console.log('[Monthly Platform] Unique sold_platform values:', [...new Set(debugResult.rows.map(r => r.sold_platform))]);
    }

    // Vinted: Calculate total purchases, sales, and profit for items sold on Vinted in this month
    // Include items where sold_platform = 'Vinted' OR vinted_id has a value
    // Exclude items explicitly marked as eBay (sold_platform = 'eBay' AND ebay_id has a value AND vinted_id is null/empty)
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
          AND (
            sold_platform = 'Vinted'
            OR (vinted_id IS NOT NULL AND vinted_id != '')
          )
          AND NOT (sold_platform = 'eBay' AND ebay_id IS NOT NULL AND ebay_id != '' AND (vinted_id IS NULL OR vinted_id = ''))
      `,
      [requestedYear, requestedMonth]
    );
    console.log(`[Monthly Platform] Vinted result:`, vintedResult.rows[0]);

    const vintedPurchases = Number(vintedResult.rows[0]?.total_purchases || 0);
    const vintedSales = Number(vintedResult.rows[0]?.total_sales || 0);
    const vintedProfit = Number(vintedResult.rows[0]?.total_profit || 0);

    // eBay: Calculate total purchases, sales, and profit for items sold on eBay in this month
    // Filter by sale_date matching the month AND sold_platform = 'eBay'
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
          AND sold_platform = 'eBay'
      `,
      [requestedYear, requestedMonth]
    );

    const ebayPurchases = Number(ebayResult.rows[0]?.total_purchases || 0);
    const ebaySales = Number(ebayResult.rows[0]?.total_sales || 0);
    const ebayProfit = Number(ebayResult.rows[0]?.total_profit || 0);
    console.log(`[Monthly Platform] eBay result:`, ebayResult.rows[0]);

    // Unsold purchases: Items purchased this month but not sold (no sale_date)
    // Debug: First check what items exist
    const unsoldDebugResult = await pool.query(
      `
        SELECT
          id,
          item_name,
          purchase_date,
          purchase_price,
          sale_date,
          EXTRACT(YEAR FROM purchase_date)::int AS purchase_year,
          EXTRACT(MONTH FROM purchase_date)::int AS purchase_month
        FROM stock
        WHERE purchase_date IS NOT NULL
          AND sale_date IS NULL
        ORDER BY purchase_date DESC
      `
    );
    console.log(`[Monthly Platform] Debug: Found ${unsoldDebugResult.rows.length} total unsold items`);
    const matchingUnsold = unsoldDebugResult.rows.filter(r => 
      Number(r.purchase_year) === requestedYear && Number(r.purchase_month) === requestedMonth
    );
    console.log(`[Monthly Platform] Debug: ${matchingUnsold.length} unsold items match ${requestedMonth}/${requestedYear}`);
    if (matchingUnsold.length > 0) {
      console.log('[Monthly Platform] Debug: Matching unsold items:');
      matchingUnsold.forEach(r => {
        console.log(`  - ${r.item_name}: purchase_price=£${r.purchase_price}, purchase_date=${r.purchase_date}, year=${r.purchase_year}, month=${r.purchase_month}`);
      });
    }

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
    console.log(`[Monthly Platform] Unsold purchases result:`, unsoldPurchasesResult.rows[0]);
    console.log(`[Monthly Platform] Unsold purchases calculated: £${unsoldPurchases}`);

    // Cash flow profit = (Vinted Profit + eBay Profit) - Unsold Purchases
    // Ensure profits are positive (they should be, but handle negative cases)
    const vintedProfitPositive = Math.max(0, vintedProfit);
    const ebayProfitPositive = Math.max(0, ebayProfit);
    const unsoldPurchasesPositive = Math.max(0, unsoldPurchases);
    const totalProfit = vintedProfitPositive + ebayProfitPositive;
    // Cash flow profit = Total profits from sales - Money tied up in unsold inventory
    // Formula: (Vinted Profit + eBay Profit) - Unsold Purchases
    const cashFlowProfit = totalProfit - unsoldPurchasesPositive;
    // Ensure the result matches the expected calculation
    const expectedCashFlow = (vintedProfitPositive + ebayProfitPositive) - unsoldPurchasesPositive;
    console.log(`[Monthly Platform] Cash flow calculation: (${vintedProfitPositive} + ${ebayProfitPositive}) - ${unsoldPurchasesPositive} = ${expectedCashFlow}`);
    console.log(`[Monthly Platform] Actual cashFlowProfit value: ${cashFlowProfit}`);
    
    // Return the correctly calculated value
    const finalCashFlowProfit = expectedCashFlow;
    console.log(`[Monthly Platform] Raw values - vintedProfit: ${vintedProfit}, ebayProfit: ${ebayProfit}, unsoldPurchases: ${unsoldPurchases}`);
    console.log(`[Monthly Platform] Positive values - vintedProfit: ${vintedProfitPositive}, ebayProfit: ${ebayProfitPositive}, unsoldPurchases: ${unsoldPurchasesPositive}`);
    console.log(`[Monthly Platform] Cash flow calculation: (${vintedProfitPositive} + ${ebayProfitPositive}) - ${unsoldPurchasesPositive} = ${cashFlowProfit}`);

    // Items not tagged correctly: sold in this month but sold_platform is null/empty or not 'Vinted'/'eBay'
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
            OR sold_platform = ''
            OR (sold_platform != 'Vinted' AND sold_platform != 'eBay')
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

    // Calculate total profit for the month (sales - purchases)
    const totalMonthProfit = vintedProfit + ebayProfit;

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
      unsoldPurchases,
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Settings endpoint: http://localhost:${PORT}/api/settings`);
  console.log(`eBay API: http://localhost:${PORT}/api/ebay/search | sold-recent: /api/ebay/sold-recent?q=...`);
});



