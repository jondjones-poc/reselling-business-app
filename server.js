const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const { Pool } = require('pg');
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

const getBrowseSearch = async ({ query, accessToken, limit = '5', sort = '-price', soldOnly = false, lastMonthOnly = false }) => {
  const params = new URLSearchParams({
    q: query,
    limit,
    sort,
    marketplaceId: 'EBAY_GB'
  });

  // Build filter string
  let filterParts = [];
  
  // Add delivery country filter (UK only) - applies to both active and sold
  filterParts.push('deliveryCountry:GB');
  
  // Add condition filter for Used items - applies to both active and sold
  filterParts.push('conditionIds:{3000}'); // 3000 = Used condition
  
  // Add date filter for last month if requested
  if (lastMonthOnly) {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    // Format dates as ISO 8601 (YYYY-MM-DDTHH:MM:SSZ) in UTC
    const endDate = today.toISOString();
    const startDate = thirtyDaysAgo.toISOString();
    
    if (soldOnly) {
      // For sold items: use soldDate filter (this automatically filters to sold items)
      filterParts.push(`soldDate:[${startDate}..${endDate}]`);
    } else {
      // For active items: filter by itemStartDate (when item was listed)
      filterParts.push(`itemStartDate:[${startDate}..${endDate}]`);
    }
  } else if (soldOnly) {
    // If soldOnly but no date filter, we still need to indicate sold items
    // Note: soldDate without a range might not work, so we'll use conditions:SOLD as fallback
    filterParts.push('conditions:SOLD');
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
      const data = await getBrowseSearch({ query: q, accessToken, limit, sort });
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
    // Get active listings from last month
    // For research, always filter to last 30 days
    const browseData = await getBrowseSearch({ 
      query: q, 
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
    console.log(`[${new Date().toISOString()}] eBay Research API called for query: "${q}"`);
    try {
      console.log(`[${new Date().toISOString()}] Calling Browse API for sold items (last 30 days)...`);
      // For research, always filter to last 30 days
      const soldBrowseData = await getBrowseSearch({ 
        query: q, 
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
      query: q,
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

app.get('/api/stock', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const result = await pool.query(
      'SELECT id, item_name, category, purchase_price, purchase_date, sale_date, sale_price, sold_platform, net_profit, vinted, ebay FROM stock ORDER BY purchase_date DESC NULLS LAST, item_name ASC'
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
      category,
      purchase_price,
      purchase_date,
      sale_date,
      sale_price,
      sold_platform,
      net_profit,
      vinted,
      ebay
    } = req.body ?? {};

    const normalizedItemName = normalizeTextInput(item_name) ?? null;
    const normalizedCategory = normalizeTextInput(category) ?? null;
    const normalizedSoldPlatform = normalizeTextInput(sold_platform) ?? null;
    const normalizedPurchasePrice = normalizeDecimalInput(purchase_price, 'purchase_price');
    const normalizedSalePrice = normalizeDecimalInput(sale_price, 'sale_price');
    const normalizedPurchaseDate = normalizeDateInputValue(purchase_date, 'purchase_date');
    const normalizedSaleDate = normalizeDateInputValue(sale_date, 'sale_date');
    const computedNetProfit =
      normalizedSalePrice !== null && normalizedPurchasePrice !== null
        ? normalizedSalePrice - normalizedPurchasePrice
        : null;
    
    // Normalize vinted and ebay: convert to boolean or null
    const normalizedVinted = vinted === null || vinted === undefined ? null : Boolean(vinted);
    const normalizedEbay = ebay === null || ebay === undefined ? null : Boolean(ebay);

    const insertQuery = `
      INSERT INTO stock (
        item_name,
        category,
        purchase_price,
        purchase_date,
        sale_date,
        sale_price,
        sold_platform,
        net_profit,
        vinted,
        ebay
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, item_name, category, purchase_price, purchase_date, sale_date, sale_price, sold_platform, net_profit, vinted, ebay
    `;

    const result = await pool.query(insertQuery, [
      normalizedItemName,
      normalizedCategory,
      normalizedPurchasePrice,
      normalizedPurchaseDate,
      normalizedSaleDate,
      normalizedSalePrice,
      normalizedSoldPlatform,
      computedNetProfit,
      normalizedVinted,
      normalizedEbay
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

    const existingResult = await pool.query(
      'SELECT id, item_name, category, purchase_price, purchase_date, sale_date, sale_price, sold_platform, vinted, ebay FROM stock WHERE id = $1',
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

    const finalCategory = hasProp('category')
      ? normalizeTextInput(req.body.category) ?? null
      : existing.category ?? null;

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

    const existingVinted = existing.vinted === null || existing.vinted === undefined ? null : Boolean(existing.vinted);
    const existingEbay = existing.ebay === null || existing.ebay === undefined ? null : Boolean(existing.ebay);

    const finalVinted = hasProp('vinted')
      ? (req.body.vinted === null || req.body.vinted === undefined ? null : Boolean(req.body.vinted))
      : existingVinted;

    const finalEbay = hasProp('ebay')
      ? (req.body.ebay === null || req.body.ebay === undefined ? null : Boolean(req.body.ebay))
      : existingEbay;

    const computedNetProfit =
      finalSalePrice !== null && finalPurchasePrice !== null
        ? finalSalePrice - finalPurchasePrice
        : null;

    const updateResult = await pool.query(
      `
        UPDATE stock
        SET
          item_name = $1,
          category = $2,
          purchase_price = $3,
          purchase_date = $4,
          sale_date = $5,
          sale_price = $6,
          sold_platform = $7,
          net_profit = $8,
          vinted = $9,
          ebay = $10
        WHERE id = $11
        RETURNING id, item_name, category, purchase_price, purchase_date, sale_date, sale_price, sold_platform, net_profit, vinted, ebay
      `,
      [
        finalItemName,
        finalCategory,
        finalPurchasePrice,
        finalPurchaseDate,
        finalSaleDate,
        finalSalePrice,
        finalSoldPlatform,
        computedNetProfit,
        finalVinted,
        finalEbay,
        stockId
      ]
    );

    res.json({ row: updateResult.rows[0] });
  } catch (error) {
    console.error('Stock update failed:', error);
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

app.get('/api/analytics/reporting', async (req, res) => {
  try {
    const pool = getDatabasePool();

    if (!pool) {
      return res.status(500).json({ error: 'Database connection not configured' });
    }

    const now = new Date();
    const requestedYearRaw = req.query.year;
    const requestedYear = requestedYearRaw ? Number(requestedYearRaw) : now.getFullYear();
    const targetYear = Number.isNaN(requestedYear) ? now.getFullYear() : requestedYear;

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
    const effectiveYear = availableYears.length > 0
      ? (availableYears.includes(targetYear) ? targetYear : availableYears[0])
      : targetYear;

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

    const profitByMonthResult = await pool.query(
      `
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
      `,
      [effectiveYear]
    );

    const expensesByMonthResult = await pool.query(
      `
        SELECT
          EXTRACT(MONTH FROM purchase_date)::int AS month,
          SUM(COALESCE(purchase_price, 0))::numeric AS expense
        FROM stock
        WHERE purchase_date IS NOT NULL
          AND EXTRACT(YEAR FROM purchase_date)::int = $1
        GROUP BY month
        ORDER BY month ASC
      `,
      [effectiveYear]
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

    const salesByCategoryResult = await pool.query(
      `
        SELECT
          COALESCE(category, 'Uncategorized') AS category,
          SUM(COALESCE(sale_price, 0))::numeric AS total_sales
        FROM stock
        WHERE sale_date IS NOT NULL
          AND EXTRACT(YEAR FROM sale_date)::int = $1
        GROUP BY COALESCE(category, 'Uncategorized')
        HAVING SUM(COALESCE(sale_price, 0)) > 0
        ORDER BY total_sales DESC
      `,
      [effectiveYear]
    );

    const salesByCategory = salesByCategoryResult.rows.map((row) => ({
      category: row.category || 'Uncategorized',
      totalSales: Number(row.total_sales)
    }));

    const unsoldStockByCategoryResult = await pool.query(
      `
        SELECT
          COALESCE(category, 'Uncategorized') AS category,
          SUM(COALESCE(purchase_price, 0))::numeric AS total_value,
          COUNT(*)::int AS item_count
        FROM stock
        WHERE purchase_date IS NOT NULL
          AND sale_date IS NULL
          AND EXTRACT(YEAR FROM purchase_date)::int = $1
        GROUP BY COALESCE(category, 'Uncategorized')
        HAVING SUM(COALESCE(purchase_price, 0)) > 0
        ORDER BY total_value DESC
      `,
      [effectiveYear]
    );

    const unsoldStockByCategory = unsoldStockByCategoryResult.rows.map((row) => ({
      category: row.category || 'Uncategorized',
      totalValue: Number(row.total_value),
      itemCount: Number(row.item_count)
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
    const roiResult = await pool.query(
      `
        SELECT
          SUM(COALESCE(sale_price, 0))::numeric AS total_sales,
          SUM(COALESCE(purchase_price, 0))::numeric AS total_spend
        FROM stock
        WHERE (
          (purchase_date IS NOT NULL AND EXTRACT(YEAR FROM purchase_date)::int = $1)
          OR
          (sale_date IS NOT NULL AND EXTRACT(YEAR FROM sale_date)::int = $1)
        )
      `,
      [effectiveYear]
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

    const unsoldInventoryValueResult = await pool.query(`
      SELECT SUM(COALESCE(purchase_price, 0))::numeric AS total_value
      FROM stock
      WHERE purchase_date IS NOT NULL AND sale_date IS NULL
    `);

    const unsoldInventoryValue = Number(unsoldInventoryValueResult.rows[0]?.total_value || 0);

    const monthlyAverageSellingPriceResult = await pool.query(
      `
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
      `,
      [effectiveYear]
    );

    const monthlyAverageSellingPrice = monthlyAverageSellingPriceResult.rows.map((row) => ({
      month: Number(row.month),
      average: Number(row.average_price),
      itemCount: Number(row.item_count)
    }));

    const monthlyAverageProfitPerItemResult = await pool.query(
      `
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
      `,
      [effectiveYear]
    );

    const monthlyAverageProfitPerItem = monthlyAverageProfitPerItemResult.rows.map((row) => ({
      month: Number(row.month),
      average: Number(row.average_profit),
      itemCount: Number(row.item_count)
    }));

    const monthlyAverageProfitMultipleResult = await pool.query(
      `
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
      `,
      [effectiveYear]
    );

    const monthlyAverageProfitMultiple = monthlyAverageProfitMultipleResult.rows.map((row) => ({
      month: Number(row.month),
      average: row.average_multiple ? Number(row.average_multiple) : 0,
      itemCount: Number(row.item_count)
    }));

    // Calculate year-specific totals to match Stock page calculation
    const yearSpecificTotalsResult = await pool.query(
      `
        SELECT
          SUM(COALESCE(purchase_price, 0))::numeric AS total_purchase,
          SUM(COALESCE(sale_price, 0))::numeric AS total_sales
        FROM stock
        WHERE (
          (purchase_date IS NOT NULL AND EXTRACT(YEAR FROM purchase_date)::int = $1)
          OR
          (sale_date IS NOT NULL AND EXTRACT(YEAR FROM sale_date)::int = $1)
        )
      `,
      [effectiveYear]
    );

    const yearTotalPurchase = Number(yearSpecificTotalsResult.rows[0]?.total_purchase || 0);
    const yearTotalSales = Number(yearSpecificTotalsResult.rows[0]?.total_sales || 0);
    const yearTotalProfit = yearTotalSales - yearTotalPurchase;

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
    const yearItemsResult = await pool.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE purchase_date IS NOT NULL AND EXTRACT(YEAR FROM purchase_date)::int = $1) AS items_listed,
          COUNT(*) FILTER (WHERE sale_date IS NOT NULL AND EXTRACT(YEAR FROM sale_date)::int = $1) AS items_sold
        FROM stock
      `,
      [effectiveYear]
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
      selectedYear: effectiveYear,
      profitTimeline,
      monthlyProfit,
      monthlyExpenses,
      salesByCategory,
      unsoldStockByCategory,
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
        profit: yearTotalProfit
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
          vinted,
          ebay,
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
        console.log(`  - ${r.item_name}: sold_platform="${r.sold_platform}" (type: ${typeof r.sold_platform}), vinted=${r.vinted}, ebay=${r.ebay}, sale_price=£${r.sale_price}`);
      });
      console.log('[Monthly Platform] Unique sold_platform values:', [...new Set(debugResult.rows.map(r => r.sold_platform))]);
    }

    // Vinted: Calculate total purchases, sales, and profit for items sold on Vinted in this month
    // Include items where sold_platform = 'Vinted' OR vinted = true
    // Exclude items explicitly marked as eBay (sold_platform = 'eBay' AND ebay = true)
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
            OR vinted = true
          )
          AND NOT (sold_platform = 'eBay' AND ebay = true AND vinted = false)
      `,
      [requestedYear, requestedMonth]
    );
    console.log(`[Monthly Platform] Vinted result:`, vintedResult.rows[0]);

    const vintedPurchases = Number(vintedResult.rows[0]?.total_purchases || 0);
    const vintedSales = Number(vintedResult.rows[0]?.total_sales || 0);
    const vintedProfit = Number(vintedResult.rows[0]?.total_profit || 0);

    // eBay: Calculate total purchases, sales, and profit for items sold on eBay in this month
    // Check sold_platform first, then fall back to ebay boolean column
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
          AND (
            sold_platform = 'eBay'
            OR ebay = true
          )
          AND NOT (sold_platform = 'Vinted' AND vinted = true AND ebay = false)
      `,
      [requestedYear, requestedMonth]
    );

    const ebayPurchases = Number(ebayResult.rows[0]?.total_purchases || 0);
    const ebaySales = Number(ebayResult.rows[0]?.total_sales || 0);
    const ebayProfit = Number(ebayResult.rows[0]?.total_profit || 0);
    console.log(`[Monthly Platform] eBay result:`, ebayResult.rows[0]);

    // Items not tagged correctly: sold in this month but sold_platform is null/empty or not 'Vinted'/'eBay'
    const untaggedItemsResult = await pool.query(
      `
        SELECT
          id,
          item_name,
          category,
          purchase_price,
          purchase_date,
          sale_date,
          sale_price,
          sold_platform,
          vinted,
          ebay
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
      category: row.category,
      purchase_price: row.purchase_price ? Number(row.purchase_price) : null,
      purchase_date: row.purchase_date,
      sale_date: row.sale_date,
      sale_price: row.sale_price ? Number(row.sale_price) : null,
      sold_platform: row.sold_platform,
      vinted: row.vinted,
      ebay: row.ebay
    }));

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
      untaggedItems
    });
  } catch (error) {
    console.error('Monthly platform analytics error:', error);
    res.status(500).json({ error: 'Failed to load monthly platform data' });
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
    // Let API routes fall through to their handlers
    if (req.path.startsWith('/api')) {
      return next();
    }

    return res.sendFile(path.join(buildDirectory, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Settings endpoint: http://localhost:${PORT}/api/settings`);
  console.log(`eBay API proxy available at: http://localhost:${PORT}/api/ebay/search`);
});



