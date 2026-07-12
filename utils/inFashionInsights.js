const googleTrends = require('google-trends-api');

const IN_FASHION_TRENDS_GEO = 'GB';
const IN_FASHION_PEXELS_PER_PAGE = 15;
const DISCOVER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const QUERY_DETAIL_CACHE_TTL_MS = 3 * 60 * 60 * 1000;

/** Broad seeds per business department — users never type these; discovery expands them. */
const DEPARTMENT_TREND_SEEDS = {
  menswear: [
    'mens fashion',
    'mens jacket',
    'vintage trainers',
    'ralph lauren',
    'menswear',
    'denim jacket',
    'football shirt',
  ],
  womenswear: [
    'womens fashion',
    'vintage dress',
    'womens jacket',
    'designer handbag',
    'womenswear',
  ],
  electronics: [
    'headphones',
    'vintage camera',
    'gaming console',
    'bluetooth speaker',
    'laptop',
    'smart watch',
  ],
  media: ['vinyl records', 'dvd box set', 'cd album', 'blu ray', 'cassette tape'],
  toys: ['lego', 'action figure', 'board game', 'hot wheels', 'barbie'],
  'bric-a-brac': ['antique', 'vintage china', 'brass ornament', 'collectable', 'retro kitchen'],
};

/**
 * Narrower category seeds under each department.
 * `all` unions every category’s seeds so each subcategory is covered.
 */
const DEPARTMENT_TREND_CATEGORIES = {
  menswear: [
    { key: 'all', label: 'All' },
    {
      key: 'jackets',
      label: 'Jackets',
      seeds: ['mens jacket', 'denim jacket', 'bomber jacket', 'parkas men', 'leather jacket men'],
      hints: ['jacket', 'bomber', 'parka', 'coat', 'blazer'],
    },
    {
      key: 'trainers',
      label: 'Trainers',
      seeds: ['mens trainers', 'vintage trainers', 'nike air max', 'adidas samba', 'new balance 550'],
      hints: ['trainer', 'sneaker', 'air max', 'samba', 'jordan'],
    },
    {
      key: 'knitwear',
      label: 'Knitwear',
      seeds: ['mens jumper', 'cable knit', 'ralph lauren knit', 'cardigan men', 'vintage knitwear'],
      hints: ['jumper', 'knit', 'cardigan', 'sweater', 'wool'],
    },
    {
      key: 'shirts',
      label: 'Shirts',
      seeds: ['mens shirt', 'oxford shirt', 'flannel shirt', 'football shirt', 'hawaiian shirt'],
      hints: ['shirt', 'oxford', 'flannel', 'football'],
    },
    {
      key: 'trousers',
      label: 'Trousers',
      seeds: ['mens trousers', 'cargo pants', 'chinos men', 'vintage jeans', 'wide leg trousers men'],
      hints: ['trouser', 'jeans', 'chino', 'cargo', 'pants'],
    },
  ],
  womenswear: [
    { key: 'all', label: 'All' },
    {
      key: 'dresses',
      label: 'Dresses',
      seeds: ['womens dress', 'vintage dress', 'maxi dress', 'party dress', 'summer dress'],
      hints: ['dress', 'maxi', 'midi', 'gown'],
    },
    {
      key: 'bags',
      label: 'Bags',
      seeds: ['designer handbag', 'crossbody bag', 'tote bag', 'vintage handbag', 'clutch bag'],
      hints: ['bag', 'handbag', 'tote', 'clutch', 'purse'],
    },
    {
      key: 'jackets',
      label: 'Jackets',
      seeds: ['womens jacket', 'trench coat', 'leather jacket women', 'blazer women', 'puffer coat'],
      hints: ['jacket', 'coat', 'blazer', 'trench', 'puffer'],
    },
    {
      key: 'shoes',
      label: 'Shoes',
      seeds: ['womens heels', 'ballet flats', 'womens boots', 'designer shoes', 'womens trainers'],
      hints: ['heel', 'boot', 'shoe', 'flat', 'sandal'],
    },
  ],
  electronics: [
    { key: 'all', label: 'All' },
    {
      key: 'audio',
      label: 'Audio',
      seeds: ['headphones', 'wireless earbuds', 'bluetooth speaker', 'turntable', 'hifi'],
      hints: ['headphone', 'earbud', 'speaker', 'audio', 'hifi'],
    },
    {
      key: 'gaming',
      label: 'Gaming',
      seeds: ['gaming console', 'playstation 5', 'nintendo switch', 'xbox series', 'steam deck'],
      hints: ['console', 'playstation', 'xbox', 'nintendo', 'gaming'],
    },
    {
      key: 'cameras',
      label: 'Cameras',
      seeds: ['vintage camera', 'mirrorless camera', 'polaroid', 'dslr', 'film camera'],
      hints: ['camera', 'lens', 'polaroid', 'dslr', 'mirrorless'],
    },
    {
      key: 'phones-watches',
      label: 'Phones & watches',
      seeds: ['smart watch', 'iphone', 'android phone', 'fitness tracker', 'vintage watch'],
      hints: ['phone', 'iphone', 'watch', 'tracker'],
    },
  ],
  media: [
    { key: 'all', label: 'All' },
    {
      key: 'vinyl',
      label: 'Vinyl',
      seeds: ['vinyl records', 'lp vinyl', 'vinyl collecting', 'rare vinyl', 'vinyl album'],
      hints: ['vinyl', 'lp', 'record'],
    },
    {
      key: 'discs',
      label: 'DVD / Blu-ray',
      seeds: ['dvd box set', 'blu ray', '4k blu ray', 'dvd collection', 'film box set'],
      hints: ['dvd', 'blu', 'ray', 'box set'],
    },
    {
      key: 'cds-cassettes',
      label: 'CDs & cassettes',
      seeds: ['cd album', 'cassette tape', 'cd collection', 'mixtape cassette', 'rare cd'],
      hints: ['cd', 'cassette', 'tape', 'album'],
    },
  ],
  toys: [
    { key: 'all', label: 'All' },
    {
      key: 'lego',
      label: 'LEGO',
      seeds: ['lego', 'lego set', 'lego technic', 'lego star wars', 'lego vintage'],
      hints: ['lego'],
    },
    {
      key: 'figures',
      label: 'Figures',
      seeds: ['action figure', 'barbie', 'hot wheels', 'transformers toy', 'funko pop'],
      hints: ['figure', 'barbie', 'wheels', 'funko', 'transformer'],
    },
    {
      key: 'games',
      label: 'Games',
      seeds: ['board game', 'card game', 'puzzle game', 'warhammer', 'dnd miniatures'],
      hints: ['board game', 'card game', 'puzzle', 'warhammer', 'dnd'],
    },
  ],
  'bric-a-brac': [
    { key: 'all', label: 'All' },
    {
      key: 'china-glass',
      label: 'China & glass',
      seeds: ['vintage china', 'crystal glassware', 'porcelain figurine', 'tea set vintage', 'glass vase'],
      hints: ['china', 'porcelain', 'crystal', 'glass', 'vase'],
    },
    {
      key: 'metal-brass',
      label: 'Brass & metal',
      seeds: ['brass ornament', 'copper kettle', 'bronze statue', 'silver plate', 'cast iron'],
      hints: ['brass', 'copper', 'bronze', 'silver', 'iron'],
    },
    {
      key: 'kitchen-retro',
      label: 'Retro kitchen',
      seeds: ['retro kitchen', 'vintage kitchenware', 'pyrex', 'enamelware', 'kitchen collectable'],
      hints: ['kitchen', 'pyrex', 'enamel', 'retro'],
    },
  ],
};

const DEPARTMENT_EBAY_CATEGORY = {
  menswear: '11450',
  womenswear: '11450',
  electronics: '293',
  media: '267',
  toys: '220',
  'bric-a-brac': '1',
};

const discoverCache = new Map();
const queryDetailCache = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDepartmentKey(raw) {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  if (DEPARTMENT_TREND_SEEDS[key]) return key;
  const aliases = {
    mens: 'menswear',
    men: 'menswear',
    womens: 'womenswear',
    women: 'womenswear',
    bricabrac: 'bric-a-brac',
    'bric a brac': 'bric-a-brac',
  };
  return aliases[key] || null;
}

function listCategoriesForDepartment(departmentKey) {
  const key = normalizeDepartmentKey(departmentKey);
  if (!key) return [];
  const rows = DEPARTMENT_TREND_CATEGORIES[key] || [{ key: 'all', label: 'All' }];
  return rows.map((c) => {
    if (c.key === 'all') {
      const resolved = resolveSeedsForDiscover(key, 'all');
      return { key: c.key, label: c.label, seedCount: resolved.seeds.length };
    }
    return {
      key: c.key,
      label: c.label,
      seedCount: Array.isArray(c.seeds) ? c.seeds.length : 0,
    };
  });
}

function listDepartments() {
  return Object.keys(DEPARTMENT_TREND_SEEDS).map((key) => ({
    key,
    label: key
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' '),
    seedCount: DEPARTMENT_TREND_SEEDS[key].length,
    ebayCategoryId: DEPARTMENT_EBAY_CATEGORY[key] || null,
    categories: listCategoriesForDepartment(key),
  }));
}

function slugifyCategoryKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCategoryKey(departmentKey, categoryRaw) {
  const dept = normalizeDepartmentKey(departmentKey);
  if (!dept) return null;
  const raw = slugifyCategoryKey(categoryRaw || 'all');
  if (!raw || raw === 'all') return 'all';
  const cats = DEPARTMENT_TREND_CATEGORIES[dept] || [];
  const hit = cats.find((c) => c.key === raw);
  if (hit) return hit.key;
  // Freeform keys from DB taxonomy (menswear_category / stock category names)
  if (raw.length >= 2) return raw;
  return null;
}

function seedsFromCategoryLabel(departmentKey, label) {
  const name = String(label || '').trim().replace(/\s+/g, ' ');
  if (!name) return { seeds: [], hints: [] };
  const lower = name.toLowerCase();
  const prefix =
    departmentKey === 'menswear'
      ? 'mens'
      : departmentKey === 'womenswear'
        ? 'womens'
        : '';
  const seen = new Set();
  const seeds = [];
  const push = (s) => {
    const t = String(s || '').trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    seeds.push(t);
  };
  push(name);
  if (prefix && !lower.startsWith(prefix)) push(`${prefix} ${name}`);
  push(`vintage ${name}`);
  const hints = lower
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
    .slice(0, 8);
  return { seeds, hints };
}

function resolveSeedsForDiscover(departmentKey, categoryKey, categoryLabel) {
  const dept = normalizeDepartmentKey(departmentKey);
  if (!dept) return { seeds: [], category: null, hints: [], label: null };
  const catKey = normalizeCategoryKey(dept, categoryKey) || 'all';
  const cats = DEPARTMENT_TREND_CATEGORIES[dept] || [];

  if (catKey === 'all') {
    return {
      seeds: DEPARTMENT_TREND_SEEDS[dept] || [],
      category: 'all',
      hints: [],
      label: 'All',
    };
  }

  const cat = cats.find((c) => c.key === catKey);
  if (cat && Array.isArray(cat.seeds) && cat.seeds.length > 0) {
    return {
      seeds: cat.seeds,
      category: catKey,
      hints: Array.isArray(cat.hints) ? cat.hints : [],
      label: cat.label || categoryLabel || catKey,
    };
  }

  const label =
    String(categoryLabel || '').trim() ||
    catKey.replace(/-/g, ' ').replace(/\band\b/gi, '&');
  const built = seedsFromCategoryLabel(dept, label);
  return {
    seeds: built.seeds.length > 0 ? built.seeds : DEPARTMENT_TREND_SEEDS[dept] || [],
    category: catKey,
    hints: built.hints,
    label,
  };
}

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

function parseTrendScore(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return 0;
  if (/^breakout$/i.test(value)) return 1_000_000;
  const pct = value.match(/^\+?([\d,.]+)\s*%$/);
  if (pct) {
    const n = Number(pct[1].replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
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

function parseInterestOverTime(rawJson) {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const timeline = parsed?.default?.timelineData;
  if (!Array.isArray(timeline)) return [];
  return timeline
    .map((row) => {
      const label =
        row?.formattedAxisTime != null
          ? String(row.formattedAxisTime)
          : row?.formattedTime != null
            ? String(row.formattedTime)
            : row?.time != null
              ? String(row.time)
              : '';
      const values = Array.isArray(row?.value) ? row.value : [];
      const n = Number(values[0]);
      return {
        label,
        value: Number.isFinite(n) ? n : 0,
      };
    })
    .filter((p) => p.label);
}

function parseRelatedTopics(rawJson) {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const ranked = parsed?.default?.rankedList;
  if (!Array.isArray(ranked)) return { topTopics: [], risingTopics: [] };

  const mapList = (list, limit = 12) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const row of list) {
      const title =
        row?.topic?.title != null
          ? String(row.topic.title).trim()
          : row?.query != null
            ? String(row.query).trim()
            : '';
      if (!title) continue;
      const type = row?.topic?.type != null ? String(row.topic.type).trim() : '';
      const value = row?.value != null ? String(row.value) : '';
      out.push({ title, type, value });
      if (out.length >= limit) break;
    }
    return out;
  };

  return {
    topTopics: mapList(ranked[0]?.rankedKeyword),
    risingTopics: mapList(ranked[1]?.rankedKeyword ?? ranked[0]?.rankedKeyword),
  };
}

function parseDailyTrends(rawJson) {
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const days = parsed?.default?.trendingSearchesDays;
  if (!Array.isArray(days)) return [];
  const out = [];
  for (const day of days) {
    const searches = day?.trendingSearches;
    if (!Array.isArray(searches)) continue;
    for (const item of searches) {
      const title = item?.title?.query != null ? String(item.title.query).trim() : '';
      if (!title) continue;
      const traffic = item?.formattedTraffic != null ? String(item.formattedTraffic) : '';
      out.push({ query: title, value: traffic || 'Daily' });
      if (out.length >= 40) return out;
    }
  }
  return out;
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

async function fetchInterestOverTimeForTerm(term) {
  const keyword = String(term || '').trim();
  if (!keyword) return { points: [], error: 'Empty search term' };
  try {
    const startTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const raw = await googleTrends.interestOverTime({
      keyword,
      geo: IN_FASHION_TRENDS_GEO,
      startTime,
    });
    return { points: parseInterestOverTime(raw), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { points: [], error: message.slice(0, 240) || 'Interest over time failed' };
  }
}

async function fetchRelatedTopicsForTerm(term) {
  const keyword = String(term || '').trim();
  if (!keyword) return { topTopics: [], risingTopics: [], error: 'Empty search term' };
  try {
    const startTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const raw = await googleTrends.relatedTopics({
      keyword,
      geo: IN_FASHION_TRENDS_GEO,
      startTime,
    });
    const parsed = parseRelatedTopics(raw);
    return { ...parsed, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      topTopics: [],
      risingTopics: [],
      error: message.slice(0, 240) || 'Related topics failed',
    };
  }
}

async function fetchDailyTrendsGb() {
  try {
    const raw = await googleTrends.dailyTrends({ geo: IN_FASHION_TRENDS_GEO });
    return { queries: parseDailyTrends(raw), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { queries: [], error: message.slice(0, 240) || 'Daily trends failed' };
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

function dailyMatchesScope(query, departmentKey, categoryKey, categoryHints = []) {
  const q = String(query || '').toLowerCase();
  const resolved = resolveSeedsForDiscover(departmentKey, categoryKey);
  const seeds = resolved.seeds;
  const tokens = new Set();
  for (const seed of seeds) {
    for (const part of String(seed).toLowerCase().split(/\s+/)) {
      if (part.length >= 3) tokens.add(part);
    }
  }
  // Extra department hint words (when browsing All)
  const deptHints = {
    menswear: ['men', 'mens', 'jacket', 'shirt', 'trainer', 'sneaker', 'denim'],
    womenswear: ['women', 'womens', 'dress', 'handbag', 'heels'],
    electronics: ['phone', 'laptop', 'console', 'camera', 'headphone', 'speaker', 'watch'],
    media: ['vinyl', 'dvd', 'blu', 'cassette', 'album', 'cd'],
    toys: ['lego', 'toy', 'figure', 'game', 'barbie', 'wheels'],
    'bric-a-brac': ['antique', 'vintage', 'brass', 'china', 'collect'],
  };
  const catKey = resolved.category || 'all';
  const extra =
    catKey === 'all'
      ? [...(deptHints[departmentKey] || []), ...(resolved.hints || []), ...categoryHints]
      : categoryHints.length > 0
        ? categoryHints
        : resolved.hints;
  for (const h of extra) tokens.add(String(h).toLowerCase());
  for (const t of tokens) {
    if (q.includes(t)) return true;
  }
  return false;
}

/** @deprecated Prefer dailyMatchesScope — kept for any older callers. */
function dailyMatchesDepartment(query, departmentKey) {
  return dailyMatchesScope(query, departmentKey, 'all');
}

/**
 * Discover rising research ideas for a department (optionally narrowed by category).
 */
async function discoverDepartmentTrends(departmentKey, options = {}) {
  const key = normalizeDepartmentKey(departmentKey);
  if (!key) {
    return {
      error: 'Unknown department',
      department: null,
      category: null,
      rising: [],
      seeds: [],
      warnings: [],
    };
  }

  const resolved = resolveSeedsForDiscover(key, options.category, options.categoryLabel);
  const category = resolved.category || 'all';

  const refresh = Boolean(options.refresh);
  const cacheKey = `discover:${key}:${category}:${String(resolved.label || '').toLowerCase()}`;
  if (!refresh) {
    const hit = discoverCache.get(cacheKey);
    if (hit && Date.now() - hit.at < DISCOVER_CACHE_TTL_MS) {
      return hit.payload;
    }
  }

  const seeds = resolved.seeds;
  const byQuery = new Map();
  const warnings = [];
  const seedResults = [];

  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i];
    if (i > 0) await sleep(350);
    const trends = await fetchGoogleTrendsForTerm(seed);
    seedResults.push({
      seed,
      risingCount: trends.risingQueries.length,
      relatedCount: trends.relatedQueries.length,
      error: trends.error,
    });
    if (trends.error) warnings.push(`${seed}: ${trends.error}`);
    for (const row of [...trends.risingQueries, ...trends.relatedQueries]) {
      const qKey = row.query.trim().toLowerCase();
      if (!qKey) continue;
      const score = parseTrendScore(row.value);
      const existing = byQuery.get(qKey);
      const isRising = trends.risingQueries.some(
        (r) => r.query.trim().toLowerCase() === qKey
      );
      if (
        !existing ||
        score > existing.score ||
        (score === existing.score && isRising && !existing.isRising)
      ) {
        byQuery.set(qKey, {
          query: row.query.trim(),
          value: row.value,
          score,
          seed,
          isRising,
        });
      }
    }
  }

  // Optional GB daily trends, filtered to department / category terms
  const daily = await fetchDailyTrendsGb();
  if (daily.error) warnings.push(`daily trends: ${daily.error}`);
  for (const row of daily.queries) {
    if (!dailyMatchesScope(row.query, key, category, resolved.hints)) continue;
    const qKey = row.query.trim().toLowerCase();
    if (!qKey) continue;
    const score = Math.max(parseTrendScore(row.value), 50_000);
    const existing = byQuery.get(qKey);
    if (!existing || score > existing.score) {
      byQuery.set(qKey, {
        query: row.query.trim(),
        value: row.value || 'Daily',
        score,
        seed: 'daily-trends',
        isRising: true,
      });
    }
  }

  const rising = Array.from(byQuery.values())
    .sort((a, b) => b.score - a.score || a.query.localeCompare(b.query))
    .slice(0, 40)
    .map(({ query, value, seed, isRising }) => ({
      query,
      value,
      seed,
      isRising,
    }));

  const categoryMeta = listCategoriesForDepartment(key).find((c) => c.key === category);
  const payload = {
    department: key,
    category,
    categoryLabel: resolved.label || categoryMeta?.label || category,
    label: listDepartments().find((d) => d.key === key)?.label || key,
    categories: listCategoriesForDepartment(key),
    seeds,
    seedResults,
    rising,
    warnings,
    fetchedAt: new Date().toISOString(),
    error: null,
  };
  discoverCache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}

async function fetchQueryDetail(term, options = {}) {
  const keyword = String(term || '').trim();
  if (!keyword) {
    return { error: 'Query is required', query: '' };
  }
  const departmentKey = normalizeDepartmentKey(options.department) || null;
  const refresh = Boolean(options.refresh);
  const cacheKey = `detail:${departmentKey || 'all'}:${keyword.toLowerCase()}`;
  if (!refresh) {
    const hit = queryDetailCache.get(cacheKey);
    if (hit && Date.now() - hit.at < QUERY_DETAIL_CACHE_TTL_MS) {
      return hit.payload;
    }
  }

  const [interest, related, topics] = await Promise.all([
    fetchInterestOverTimeForTerm(keyword),
    fetchGoogleTrendsForTerm(keyword),
    fetchRelatedTopicsForTerm(keyword),
  ]);

  const payload = {
    query: keyword,
    department: departmentKey,
    interestOverTime: interest.points,
    interestError: interest.error,
    relatedQueries: related.relatedQueries,
    risingQueries: related.risingQueries,
    relatedError: related.error,
    topTopics: topics.topTopics,
    risingTopics: topics.risingTopics,
    topicsError: topics.error,
    ebayCategoryId: departmentKey ? DEPARTMENT_EBAY_CATEGORY[departmentKey] || null : null,
    fetchedAt: new Date().toISOString(),
    error: null,
  };
  queryDetailCache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}

module.exports = {
  IN_FASHION_PEXELS_PER_PAGE,
  DEPARTMENT_TREND_SEEDS,
  DEPARTMENT_TREND_CATEGORIES,
  DEPARTMENT_EBAY_CATEGORY,
  listDepartments,
  listCategoriesForDepartment,
  normalizeDepartmentKey,
  normalizeCategoryKey,
  fetchInFashionInsightsForTerm,
  fetchGoogleTrendsForTerm,
  fetchPexelsPhotosForTerm,
  fetchInterestOverTimeForTerm,
  fetchRelatedTopicsForTerm,
  discoverDepartmentTrends,
  fetchQueryDetail,
  parseTrendScore,
};
