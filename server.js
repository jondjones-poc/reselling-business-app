const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// eBay API proxy endpoint
app.get('/api/ebay/search', async (req, res) => {
  try {
    const { q, limit = '5', sort = '-price' } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const appId = process.env.REACT_APP_EBAY_APP_ID;
    if (!appId) {
      return res.status(500).json({ error: 'eBay App ID not configured' });
    }

    const params = new URLSearchParams({
      'q': q,
      'limit': limit,
      'sort': sort,
      'filter': 'conditionIds:{3000}',
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY-GB'
    });

    const ebayUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;
    
    console.log('Making request to eBay API:', ebayUrl);

    const response = await fetch(ebayUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${appId}`,
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
        details: errorText 
      });
    }

    const data = await response.json();
    console.log('eBay API Response received, items found:', data.itemSummaries?.length || 0);
    
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`eBay API proxy available at: http://localhost:${PORT}/api/ebay/search`);
});



