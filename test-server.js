const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = 5001;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!', timestamp: new Date().toISOString() });
});

// eBay API proxy endpoint
app.get('/api/ebay/search', async (req, res) => {
  try {
    const { q, limit = '5', sort = '-price' } = req.query;
    
    console.log('Received request:', { q, limit, sort });
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const appId = process.env.REACT_APP_EBAY_APP_ID;
    console.log('eBay App ID loaded:', appId ? 'YES' : 'NO');
    console.log('App ID value:', appId ? appId.substring(0, 10) + '...' : 'undefined');
    
    if (!appId) {
      console.log('No eBay App ID found');
      return res.status(500).json({ 
        error: 'eBay App ID not configured',
        details: 'Please check your .env file contains REACT_APP_EBAY_APP_ID'
      });
    }

    // Try eBay Browse API with OAuth 2.0 Client Credentials
    console.log('Attempting eBay OAuth authentication...');
    
    // First, get OAuth token using Client Credentials
    const oauthUrl = 'https://api.ebay.com/identity/v1/oauth2/token';
    const clientCredentials = Buffer.from(`${appId}:${process.env.REACT_APP_EBAY_CERT_ID}`).toString('base64');
    
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
    console.log('OAuth token obtained successfully');

    // Now make the Browse API call with the token - UK only
    const params = new URLSearchParams({
      'q': q,
      'limit': limit,
      'sort': sort,
      'filter': 'conditionIds:{3000},deliveryCountry:GB',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY-GB'
    });

    const ebayUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;
    console.log('eBay Browse API URL:', ebayUrl);

    const response = await fetch(ebayUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY-GB'
      }
    });

    console.log('eBay API Response Status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('eBay API Error:', response.status, errorText);
      
      return res.status(response.status).json({ 
        error: `eBay API error: ${response.status}`,
        details: errorText,
        ebayUrl: ebayUrl
      });
    }

    const data = await response.json();
    console.log('eBay Browse API Response received');
    
    // Browse API already returns the correct format
    if (data.itemSummaries && data.itemSummaries.length > 0) {
      console.log('Real eBay data found, items:', data.itemSummaries.length);
      res.json(data);
    } else {
      console.log('No items found in response');
      res.json({ itemSummaries: [] });
    }
    
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
  console.log(`Test endpoint: http://localhost:${PORT}/api/test`);
  console.log(`eBay proxy: http://localhost:${PORT}/api/ebay/search`);
});
