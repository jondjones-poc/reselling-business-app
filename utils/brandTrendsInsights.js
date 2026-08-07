const googleTrends = require('google-trends-api');

const BRAND_TRENDS_GEO = 'GB';
/** Delay between Google Trends calls during weekly refresh (unofficial API rate-limits hard). */
const BRAND_TRENDS_FETCH_GAP_MS = 2500;
/** Fetch one long series; derive all window scores from it. */
const BRAND_TRENDS_LOOKBACK_YEARS = 5;

const WINDOWS = [
  { key: '6m', ms: 182 * 24 * 60 * 60 * 1000 },
  { key: '1y', ms: 365 * 24 * 60 * 60 * 1000 },
  { key: '2y', ms: 2 * 365 * 24 * 60 * 60 * 1000 },
  { key: '5y', ms: 5 * 365 * 24 * 60 * 60 * 1000 },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function looksLikeHtml(raw) {
  const s = String(raw || '').trim().slice(0, 80).toLowerCase();
  return s.startsWith('<!doctype') || s.startsWith('<html') || s.startsWith('<head');
}

function isTrendsBlockError(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('google trends blocked') ||
    m.includes('rate-limited') ||
    m.includes('rate limited') ||
    m.includes("unexpected token '<'") ||
    m.includes('unexpected token "<"') ||
    m.includes('got html')
  );
}

function parseInterestSeries(rawJson) {
  if (typeof rawJson === 'string' && looksLikeHtml(rawJson)) {
    throw new Error(
      'Google Trends blocked or rate-limited (got HTML instead of JSON). Try again later.'
    );
  }
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
            : '';
      const values = Array.isArray(row?.value) ? row.value : [];
      const n = Number(values[0]);
      const timeRaw = row?.time != null ? Number(row.time) : NaN;
      return {
        time: Number.isFinite(timeRaw) ? timeRaw : null,
        label,
        value: Number.isFinite(n) ? n : 0,
      };
    })
    .filter((p) => p.time != null || p.label);
}

/**
 * Compare average of later half of the window vs earlier half.
 * Positive = rising search interest.
 */
function scoreSeriesForWindow(points, windowMs, nowMs = Date.now()) {
  const cutoff = nowMs / 1000 - windowMs / 1000;
  const inWindow = points.filter((p) => p.time != null && p.time >= cutoff);
  if (inWindow.length < 4) {
    return { score: null, direction: 'flat' };
  }
  const mid = Math.floor(inWindow.length / 2);
  const earlier = inWindow.slice(0, mid);
  const later = inWindow.slice(mid);
  const avg = (rows) =>
    rows.reduce((s, r) => s + (Number(r.value) || 0), 0) / Math.max(rows.length, 1);
  const earlierAvg = avg(earlier);
  const laterAvg = avg(later);
  const denom = Math.max(earlierAvg, 1);
  const changePct = ((laterAvg - earlierAvg) / denom) * 100;
  let direction = 'flat';
  if (changePct >= 10) direction = 'rising';
  else if (changePct <= -10) direction = 'fading';
  return {
    score: Math.round(changePct * 10) / 10,
    direction,
  };
}

function scoreAllWindows(points, nowMs = Date.now()) {
  const out = {};
  for (const w of WINDOWS) {
    const scored = scoreSeriesForWindow(points, w.ms, nowMs);
    out[`score_${w.key}`] = scored.score;
    out[`direction_${w.key}`] = scored.direction;
  }
  return out;
}

async function fetchBrandInterestSeries(brandName) {
  const keyword = String(brandName || '').trim();
  if (!keyword) {
    return { points: [], error: 'Empty brand name', blocked: false };
  }
  try {
    const startTime = new Date(
      Date.now() - BRAND_TRENDS_LOOKBACK_YEARS * 365 * 24 * 60 * 60 * 1000
    );
    const raw = await googleTrends.interestOverTime({
      keyword,
      geo: BRAND_TRENDS_GEO,
      startTime,
    });
    if (typeof raw === 'string' && looksLikeHtml(raw)) {
      return {
        points: [],
        error:
          'Google Trends blocked or rate-limited (got HTML instead of JSON). Try again later.',
        blocked: true,
      };
    }
    return { points: parseInterestSeries(raw), error: null, blocked: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const friendly = isTrendsBlockError(message)
      ? 'Google Trends blocked or rate-limited (got HTML instead of JSON). Try again later.'
      : message.slice(0, 240) || 'Google Trends interestOverTime failed';
    return {
      points: [],
      error: friendly,
      blocked: isTrendsBlockError(message),
    };
  }
}

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS public.research_brand_trends_cache (
  brand_id INTEGER PRIMARY KEY REFERENCES public.brand(id) ON DELETE CASCADE,
  brand_name TEXT NOT NULL,
  department_id INTEGER REFERENCES public.department(id) ON DELETE SET NULL,
  geo TEXT NOT NULL DEFAULT 'GB',
  interest_series JSONB NOT NULL DEFAULT '[]'::jsonb,
  score_6m NUMERIC,
  score_1y NUMERIC,
  score_2y NUMERIC,
  score_5y NUMERIC,
  direction_6m TEXT,
  direction_1y TEXT,
  direction_2y TEXT,
  direction_5y TEXT,
  trends_error TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_research_brand_trends_department
  ON public.research_brand_trends_cache (department_id);
CREATE INDEX IF NOT EXISTS idx_research_brand_trends_fetched_at
  ON public.research_brand_trends_cache (fetched_at DESC);
`;

async function ensureBrandTrendsTable(pool) {
  await pool.query(ENSURE_TABLE_SQL);
}

async function upsertBrandTrendRow(pool, row) {
  await pool.query(
    `INSERT INTO research_brand_trends_cache (
       brand_id, brand_name, department_id, geo, interest_series,
       score_6m, score_1y, score_2y, score_5y,
       direction_6m, direction_1y, direction_2y, direction_5y,
       trends_error, fetched_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb,
       $6, $7, $8, $9,
       $10, $11, $12, $13,
       $14, NOW()
     )
     ON CONFLICT (brand_id) DO UPDATE SET
       brand_name = EXCLUDED.brand_name,
       department_id = EXCLUDED.department_id,
       geo = EXCLUDED.geo,
       interest_series = EXCLUDED.interest_series,
       score_6m = EXCLUDED.score_6m,
       score_1y = EXCLUDED.score_1y,
       score_2y = EXCLUDED.score_2y,
       score_5y = EXCLUDED.score_5y,
       direction_6m = EXCLUDED.direction_6m,
       direction_1y = EXCLUDED.direction_1y,
       direction_2y = EXCLUDED.direction_2y,
       direction_5y = EXCLUDED.direction_5y,
       trends_error = EXCLUDED.trends_error,
       fetched_at = NOW()`,
    [
      row.brand_id,
      row.brand_name,
      row.department_id,
      row.geo,
      JSON.stringify(row.interest_series ?? []),
      row.score_6m,
      row.score_1y,
      row.score_2y,
      row.score_5y,
      row.direction_6m,
      row.direction_1y,
      row.direction_2y,
      row.direction_5y,
      row.trends_error,
    ]
  );
}

/**
 * Drop rows that hold no usable series (left behind by blocked/failed fetches)
 * so the UI never renders a brand card built from an error.
 */
async function purgeUnusableBrandTrendRows(pool) {
  const result = await pool.query(
    `DELETE FROM research_brand_trends_cache
     WHERE jsonb_array_length(COALESCE(interest_series, '[]'::jsonb)) = 0`
  );
  return result.rowCount || 0;
}

/**
 * Walk all brands (optional department filter), fetch Trends, upsert cache.
 * Intended for weekly cron / manual refresh — not per page load.
 */
async function runBrandTrendsRefreshJob(pool, options = {}) {
  await ensureBrandTrendsTable(pool);
  const departmentId =
    options.departmentId != null && Number.isFinite(Number(options.departmentId))
      ? Number(options.departmentId)
      : null;
  const gapMs =
    options.gapMs != null && Number.isFinite(Number(options.gapMs))
      ? Math.max(400, Number(options.gapMs))
      : BRAND_TRENDS_FETCH_GAP_MS;
  const limit =
    options.limit != null && Number.isFinite(Number(options.limit))
      ? Math.max(1, Math.floor(Number(options.limit)))
      : null;

  const brandRes = await pool.query(
    `SELECT b.id, b.brand_name, b.department_id
     FROM brand b
     WHERE TRIM(COALESCE(b.brand_name, '')) <> ''
       AND ($1::int IS NULL OR b.department_id = $1::int)
     ORDER BY b.brand_name ASC, b.id ASC
     ${limit != null ? `LIMIT ${limit}` : ''}`,
    [departmentId]
  );
  const brands = brandRes.rows || [];
  let purged = 0;
  try {
    purged = await purgeUnusableBrandTrendRows(pool);
  } catch (purgeErr) {
    console.warn('brand-trends purge:', purgeErr.message);
  }
  const summary = {
    total: brands.length,
    ok: 0,
    failed: 0,
    skipped: 0,
    purged,
    departmentId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    stoppedEarly: false,
    stopReason: null,
    errors: [],
  };

  for (let i = 0; i < brands.length; i += 1) {
    const brand = brands[i];
    const name = String(brand.brand_name || '').trim();
    if (!name) {
      summary.skipped += 1;
      continue;
    }
    if (i > 0) await sleep(gapMs);

    const fetched = await fetchBrandInterestSeries(name);

    // HTML / block from Google — stop immediately and keep any valid rows already saved.
    if (fetched.blocked) {
      summary.failed += 1;
      summary.stoppedEarly = true;
      summary.stopReason =
        'Google Trends returned HTML (blocked/rate-limited). Stopped to keep existing valid data. Try again later.';
      summary.skipped += brands.length - (i + 1);
      if (summary.errors.length < 20) {
        summary.errors.push({
          brandId: Number(brand.id),
          brandName: name,
          error: fetched.error,
        });
      }
      break;
    }

    const scores = scoreAllWindows(fetched.points);
    const row = {
      brand_id: Number(brand.id),
      brand_name: name,
      department_id:
        brand.department_id != null && Number.isFinite(Number(brand.department_id))
          ? Number(brand.department_id)
          : null,
      geo: BRAND_TRENDS_GEO,
      interest_series: fetched.points,
      score_6m: scores.score_6m,
      score_1y: scores.score_1y,
      score_2y: scores.score_2y,
      score_5y: scores.score_5y,
      direction_6m: scores.direction_6m,
      direction_1y: scores.direction_1y,
      direction_2y: scores.direction_2y,
      direction_5y: scores.direction_5y,
      trends_error: fetched.error,
    };

    try {
      // Only persist successful (or non-block) responses — never wipe good cache with HTML errors.
      if (!fetched.error) {
        await upsertBrandTrendRow(pool, row);
        summary.ok += 1;
      } else {
        summary.failed += 1;
        if (summary.errors.length < 20) {
          summary.errors.push({ brandId: row.brand_id, brandName: name, error: fetched.error });
        }
      }
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (summary.errors.length < 20) {
        summary.errors.push({ brandId: row.brand_id, brandName: name, error: message });
      }
    }
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
}

function normalizeWindowKey(raw) {
  const key = String(raw || '1y').trim().toLowerCase();
  if (key === '6m' || key === '6mo' || key === '6months') return '6m';
  if (key === '1y' || key === '12m' || key === '1year') return '1y';
  if (key === '2y' || key === '24m' || key === '2years') return '2y';
  if (key === '5y' || key === '60m' || key === '5years') return '5y';
  return '1y';
}

function sparklineFromSeries(points, maxPoints = 24) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (points.length <= maxPoints) {
    return points.map((p) => ({
      label: p.label || '',
      value: Number(p.value) || 0,
    }));
  }
  const step = (points.length - 1) / (maxPoints - 1);
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const idx = Math.round(i * step);
    const p = points[idx];
    out.push({ label: p?.label || '', value: Number(p?.value) || 0 });
  }
  return out;
}

module.exports = {
  BRAND_TRENDS_GEO,
  BRAND_TRENDS_FETCH_GAP_MS,
  WINDOWS,
  ensureBrandTrendsTable,
  purgeUnusableBrandTrendRows,
  fetchBrandInterestSeries,
  scoreAllWindows,
  runBrandTrendsRefreshJob,
  normalizeWindowKey,
  sparklineFromSeries,
};
