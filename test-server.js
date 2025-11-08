const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const fs = require('fs');
const path = require('path');
require('dotenv').config(); // Ensure dotenv is loaded

const app = express();
const PORT = 5003; // Changed from 5001

app.use(cors());
app.use(express.json());

const settingsPath = path.join(__dirname, 'settings.json');
let appSettings = { categories: [], material: [], colors: [], patterns: [], brands: [] };

const loadSettings = () => {
  try {
    if (fs.existsSync(settingsPath)) {
      const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(settingsContent);
      console.log('Loaded settings snapshot:', parsed);
      appSettings = {
        categories: parsed.categories ?? [],
        material: parsed.material ?? [],
        colors: parsed.colors ?? [],
        patterns: parsed.patterns ?? [],
        brands: parsed.brands ?? []
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

// Load once at startup
loadSettings();

app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date().toISOString() });
});

app.get('/api/settings', (req, res) => {
  res.json(loadSettings());
});

const getAccessToken = async (appId, certId) => {
  const oauthUrl = 'https://api.ebay.com/identity/v1/oauth2/token';
  const clientCredentials = Buffer.from(`${appId}:${certId}`).toString('base64');

  const oauthResponse = await fetch(oauthUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${clientCredentials}`
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

const getBrowseSearch = async ({ query, accessToken, limit = '5', sort = '-price' }) => {
  const params = new URLSearchParams({
    q: query,
    limit,
    sort,
    filter: 'conditionIds:{3000},deliveryCountry:GB',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY-GB'
  });

  const ebayUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;
  console.log('Fetching Browse API:', ebayUrl);

  const response = await fetch(ebayUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY-GB'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('eBay API Error:', response.status, errorText);
    throw new Error(`eBay API error: ${response.status}`);
  }

  return response.json();
};

const getCompletedItems = async (query, appId) => {
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-VERSION': '1.13.0',
    'SECURITY-APPNAME': appId,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'REST-PAYLOAD': '',
    keywords: query,
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true'
  });

  const url = `https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`;
  console.log('Fetching Completed Items:', url);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-EBAY-SOA-SECURITY-APPNAME': appId,
      'Accept': 'application/json'
    }
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
    
    console.log('Received request:', { q, limit, sort });
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const appId = process.env.REACT_APP_EBAY_APP_ID || process.env.EBAY_APP;
    console.log('eBay App ID loaded:', appId ? 'YES' : 'NO');
    console.log('App ID value:', appId ? appId.substring(0, 10) + '...' : 'undefined');
    
    if (!appId) {
      console.log('No eBay App ID found');
      return res.status(500).json({ 
        error: 'eBay App ID not configured',
        details: 'Please check your .env file contains REACT_APP_EBAY_APP_ID'
      });
    }

    try {
      const accessToken = await getAccessToken(appId, process.env.REACT_APP_EBAY_CERT_ID);
      const data = await getBrowseSearch({ query: q, accessToken, limit, sort });
      res.json(data);
    } catch (err) {
      console.error('Browse API error:', err);
      return res.status(500).json({ error: 'Internal server error', details: err.message });
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
    const browseData = await getBrowseSearch({ query: q, accessToken, limit: '50' });
    const activeCount = typeof browseData.total === 'number'
      ? browseData.total
      : Array.isArray(browseData.itemSummaries)
        ? browseData.itemSummaries.length
        : 0;

    let soldCount = 0;
    let soldEntries = null;
    let completedError = null;

    try {
      const completedData = await getCompletedItems(q, appId);
      const completedResponse = completedData?.findCompletedItemsResponse?.[0];
      const paginationOutput = completedResponse?.paginationOutput?.[0];
      const rawTotalEntries = paginationOutput?.totalEntries?.[0] ?? '0';
      soldEntries = parseInt(rawTotalEntries, 10);

      const searchResultItems = completedResponse?.searchResult?.[0]?.item ?? [];
      const soldItemsCount = Array.isArray(searchResultItems)
        ? searchResultItems.filter((item) => {
            const sellingState = item?.sellingStatus?.[0]?.sellingState?.[0];
            return sellingState === 'EndedWithSales';
          }).length
        : 0;

      soldCount = soldItemsCount || soldEntries || 0;
    } catch (completedErr) {
      completedError = completedErr instanceof Error ? completedErr.message : String(completedErr);
      console.warn('Completed items query failed:', completedError);
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

app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
  console.log(`Test endpoint: http://localhost:${PORT}/api/test`);
  console.log(`eBay proxy: http://localhost:${PORT}/api/ebay/search`);
});
