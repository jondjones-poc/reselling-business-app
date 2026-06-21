const googleTrends = require('google-trends-api');

const IN_FASHION_TRENDS_GEO = 'GB';
const IN_FASHION_PEXELS_PER_PAGE = 15;

function normalizeTrendQueryRows(rawList, limit = 12) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const row of rawList) {
    const query = row?.query != null ? String(row.query).trim() : '';
    if (!query) continue;
    const value = row?.value != null ? String(row.value) : '';
    out.push({ query, value });
    if (out.length >= limit) break;
  }
  return out;
}

function parseGoogleTrendsPayload(rawJson) {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const ranked = parsed?.default?.rankedList;
  if (!Array.isArray(ranked) || ranked.length === 0) {
    return { relatedQueries: [], risingQueries: [] };
  }
  const top = ranked[0]?.rankedKeyword ?? [];
  const rising = ranked[1]?.rankedKeyword ?? ranked[0]?.rankedKeyword ?? [];
  return {
    relatedQueries: normalizeTrendQueryRows(top),
    risingQueries: normalizeTrendQueryRows(rising),
  };
}

async function fetchGoogleTrendsForTerm(term) {
  const keyword = String(term || '').trim();
  if (!keyword) {
    return { relatedQueries: [], risingQueries: [], error: 'Empty search term' };
  }
  try {
    const startTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const raw = await googleTrends.relatedQueries({
      keyword,
      geo: IN_FASHION_TRENDS_GEO,
      startTime,
    });
    const { relatedQueries, risingQueries } = parseGoogleTrendsPayload(raw);
    return { relatedQueries, risingQueries, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      relatedQueries: [],
      risingQueries: [],
      error: message.slice(0, 240) || 'Google Trends request failed',
    };
  }
}

function mapPexelsPhoto(photo) {
  if (!photo || typeof photo !== 'object') return null;
  const id = photo.id;
  const url = photo.url != null ? String(photo.url) : '';
  const photographer = photo.photographer != null ? String(photo.photographer) : '';
  const photographerUrl = photo.photographer_url != null ? String(photo.photographer_url) : '';
  const width = Number(photo.width);
  const height = Number(photo.height);
  const src = photo.src && typeof photo.src === 'object' ? photo.src : {};
  const medium = src.medium != null ? String(src.medium) : '';
  const large = src.large != null ? String(src.large) : '';
  const imageUrl = large || medium || '';
  if (!id || !imageUrl) return null;
  return {
    id,
    url,
    photographer,
    photographerUrl,
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
    imageUrl,
  };
}

async function fetchPexelsPhotosForTerm(term, fetchImpl, apiKey) {
  const query = String(term || '').trim();
  if (!query) {
    return { photos: [], error: 'Empty search term' };
  }
  if (!apiKey) {
    return {
      photos: [],
      error: 'PEXELS_API_KEY is not configured on the server',
    };
  }
  try {
    const params = new URLSearchParams({
      query,
      per_page: String(IN_FASHION_PEXELS_PER_PAGE),
      orientation: 'portrait',
    });
    const res = await fetchImpl(`https://api.pexels.com/v1/search?${params.toString()}`, {
      headers: { Authorization: apiKey },
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(text.slice(0, 200) || res.statusText || 'Invalid Pexels response');
    }
    if (!res.ok) {
      const msg = data?.error || data?.message || res.statusText || 'Pexels request failed';
      throw new Error(String(msg));
    }
    const photos = (Array.isArray(data.photos) ? data.photos : [])
      .map(mapPexelsPhoto)
      .filter(Boolean);
    return { photos, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      photos: [],
      error: message.slice(0, 240) || 'Pexels request failed',
    };
  }
}

async function fetchInFashionInsightsForTerm(term, fetchImpl, pexelsApiKey) {
  const [trends, pexels] = await Promise.all([
    fetchGoogleTrendsForTerm(term),
    fetchPexelsPhotosForTerm(term, fetchImpl, pexelsApiKey),
  ]);
  return {
    relatedQueries: trends.relatedQueries,
    risingQueries: trends.risingQueries,
    photos: pexels.photos,
    trendsError: trends.error,
    pexelsError: pexels.error,
  };
}

module.exports = {
  IN_FASHION_PEXELS_PER_PAGE,
  fetchInFashionInsightsForTerm,
  fetchGoogleTrendsForTerm,
  fetchPexelsPhotosForTerm,
};
