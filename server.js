const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5003;

app.use(cors());
app.use(express.json());

const settingsPath = path.join(__dirname, 'settings.json');
let appSettings = { categories: [], material: [], colors: [], brands: [] };

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

// Load settings at startup
loadSettings();

app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date().toISOString() });
});

app.get('/api/settings', (req, res) => {
  const currentSettings = loadSettings();
  console.log('Sending settings payload:', currentSettings);
  res.json(currentSettings);
});

app.get('/api/ebay/search', async (req, res) => {
  try {
    const { q, limit = '5', sort = '-price' } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const appId = process.env.REACT_APP_EBAY_APP_ID;
    const certId = process.env.REACT_APP_EBAY_CERT_ID;

    if (!appId || !certId) {
      return res.status(500).json({
        error: 'eBay credentials not configured',
        details: 'Please ensure REACT_APP_EBAY_APP_ID and REACT_APP_EBAY_CERT_ID are set in your environment.'
      });
    }

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
      return res.status(oauthResponse.status).json({
        error: `OAuth error: ${oauthResponse.status}`,
        details: oauthError
      });
    }

    const oauthData = await oauthResponse.json();
    const accessToken = oauthData.access_token;

    const params = new URLSearchParams({
      'q': q,
      'limit': limit,
      'sort': sort,
      'filter': 'conditionIds:{3000},deliveryCountry:GB',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY-GB'
    });

    const ebayUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;

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
      return res.status(response.status).json({
        error: `eBay API error: ${response.status}`,
        details: errorText,
        ebayUrl
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Settings endpoint: http://localhost:${PORT}/api/settings`);
  console.log(`eBay API proxy available at: http://localhost:${PORT}/api/ebay/search`);
});



