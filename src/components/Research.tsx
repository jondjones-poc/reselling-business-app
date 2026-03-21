import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLocation, useSearchParams } from 'react-router-dom';
import './BrandResearch.css';

/**
 * API base for Research fetches (matches Stock, EbaySearch, etc.).
 * - REACT_APP_API_BASE when set (build-time; production API or custom dev URL)
 * - Development default: http://localhost:5003 (direct; avoids CRA proxy returning index.html for /api when backend is down)
 * - Production build with no env: same-origin '' so `/api/...` goes to the host serving the SPA
 */
const getResearchApiBase = (): string => {
  const fromEnv = (process.env.REACT_APP_API_BASE || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'development') return 'http://localhost:5003';
  return '';
};

const apiUrl = (path: string) => {
  const base = getResearchApiBase();
  return base ? `${base}${path}` : path;
};

const friendlyApiUnreachableMessage = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg === 'Failed to fetch' ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed') ||
    msg.includes('ECONNREFUSED')
  ) {
    return (
      'Cannot reach the API (connection refused or network error). ' +
      'Start the backend: npm run server (listens on port 5003) or npm run dev (frontend + API). ' +
      'If the API is elsewhere, set REACT_APP_API_BASE in .env (no trailing slash).'
    );
  }
  return msg;
};

function isUnreachableFetchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg === 'Failed to fetch' ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed') ||
    msg.includes('ECONNREFUSED')
  );
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

type BrandWebsiteRow = { id: number; brand_name: string; brand_website: string | null };

/** Normalize GET /api/brands payloads (handles string ids from pg, alternate keys, top-level array). */
function parseBrandsApiPayload(data: unknown): BrandWebsiteRow[] {
  let raw: unknown[] = [];
  if (Array.isArray(data)) {
    raw = data;
  } else if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)) {
    raw = (data as { rows: unknown[] }).rows;
  }
  const out: BrandWebsiteRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const idRaw = r.id;
    const idNum =
      typeof idRaw === 'number' && Number.isFinite(idRaw)
        ? Math.trunc(idRaw)
        : parseInt(String(idRaw ?? '').trim(), 10);
    if (!Number.isFinite(idNum) || idNum < 1) continue;
    const nameRaw = r.brand_name ?? r.name;
    const brand_name = (typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '')).trim();
    if (!brand_name) continue;
    const bw = r.brand_website;
    const brand_website = bw === null || bw === undefined ? null : String(bw);
    out.push({ id: idNum, brand_name, brand_website });
  }
  return out;
}

/** When the dev server returns index.html (200) instead of proxying /api, response.json() throws on `<`. */
async function readJsonResponse<T>(response: Response, context: string): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();

  if (!response.ok) {
    if (trimmed.startsWith('<')) {
      throw new Error(
        `${context}: HTTP ${response.status} — got HTML (API probably not reachable; start npm run server or check proxy).`
      );
    }
    try {
      const errObj = JSON.parse(trimmed) as { error?: string; details?: string };
      const parts = [errObj.error, errObj.details].filter(Boolean);
      throw new Error(parts.length ? parts.join(' — ') : `${context}: HTTP ${response.status}`);
    } catch (e: unknown) {
      if (e instanceof SyntaxError) {
        throw new Error(`${context}: HTTP ${response.status} ${trimmed.slice(0, 120)}`);
      }
      throw e;
    }
  }

  if (trimmed.startsWith('<')) {
    throw new Error(
      `${context}: received HTML instead of JSON (often CRA index.html when /api is not proxied to the backend). ` +
        'Run npm run server on port 5003 alongside npm start, or set REACT_APP_API_BASE to your API URL.'
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${context}: invalid JSON`);
  }
}

// Embedded default list; server `/api/mens-resale-reference` replaces when non-empty.
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

type MensResaleReferenceRow = {
  brand: string;
  status: string;
  note: string;
  categories: Array<{ item: string; resaleRange: string }>;
};

let mensResaleReference: MensResaleReferenceRow[] = mensResaleReferenceFallback.map((row) => ({ ...row }));

function normalizeMensResaleApiPayload(data: unknown): MensResaleReferenceRow[] {
  if (!Array.isArray(data)) return [];
  const out: MensResaleReferenceRow[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const brand = typeof r.brand === 'string' ? r.brand.trim() : '';
    if (!brand) continue;
    const status = typeof r.status === 'string' ? r.status : '';
    const note = typeof r.note === 'string' ? r.note : '';
    const rawCats = r.categories;
    const categories: Array<{ item: string; resaleRange: string }> = [];
    if (Array.isArray(rawCats)) {
      for (const c of rawCats) {
        if (!c || typeof c !== 'object') continue;
        const o = c as Record<string, unknown>;
        const item = typeof o.item === 'string' ? o.item : '';
        const resaleRange = typeof o.resaleRange === 'string' ? o.resaleRange : '';
        if (item || resaleRange) {
          categories.push({ item, resaleRange });
        }
      }
    }
    out.push({ brand, status, note, categories });
  }
  return out;
}

// Convert status emoji to status type
const getStatusFromEmoji = (status: string): 'good' | 'bad' | 'warning' => {
  if (status === "✅") return 'good';
  if (status === "❌") return 'bad';
  if (status === "⚠️") return 'warning';
  return 'bad';
};

interface CategoryItem {
  item: string;
  resaleRange: string;
}

interface TypeaheadResult {
  name: string;
  status: 'good' | 'bad' | 'warning';
  note?: string;
  categories?: CategoryItem[];
}

type BrandTagImageKind = 'tag' | 'fake_check';

interface BrandTagImageRow {
  id: number;
  brand_id: number;
  storage_path: string;
  caption: string | null;
  sort_order: number;
  content_type: string | null;
  image_kind: BrandTagImageKind;
  created_at: string;
  updated_at: string;
  public_url: string | null;
}

function normalizeBrandTagImageRow(raw: unknown): BrandTagImageRow {
  const r = raw as Record<string, unknown>;
  const kindRaw = r.image_kind;
  const image_kind: BrandTagImageKind =
    kindRaw === 'fake_check' || kindRaw === 'fake' ? 'fake_check' : 'tag';
  return {
    ...(r as unknown as BrandTagImageRow),
    image_kind,
  };
}

function sortBrandTagImages(rows: BrandTagImageRow[]): BrandTagImageRow[] {
  return [...rows].sort((a, b) => {
    const fa = a.image_kind === 'fake_check' ? 1 : 0;
    const fb = b.image_kind === 'fake_check' ? 1 : 0;
    if (fa !== fb) return fa - fb;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });
}

const Research: React.FC = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const brandQueryParam = searchParams.get('brand');

  // Offline/Brand search state
  const [searchText, setSearchText] = useState('');
  const [typeaheadResults, setTypeaheadResults] = useState<TypeaheadResult[]>([]);
  const [showTypeahead, setShowTypeahead] = useState(false);
  /** Bumps when offline reference data is replaced so typeahead recomputes from `mensResaleReference`. */
  const [offlineReferenceTick, setOfflineReferenceTick] = useState(0);
  const [selectedLookupBrand, setSelectedLookupBrand] = useState('');

  // AI Research state
  const [researchText, setResearchText] = useState('');
  const [researchImages, setResearchImages] = useState<string[]>([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchResult, setResearchResult] = useState<string | null>(null);

  const [brandsWithWebsites, setBrandsWithWebsites] = useState<Array<{ id: number; brand_name: string; brand_website: string | null }>>([]);

  const [brandTagBrandId, setBrandTagBrandId] = useState<number | ''>('');
  const [brandTagImages, setBrandTagImages] = useState<BrandTagImageRow[]>([]);
  const [brandTagLoading, setBrandTagLoading] = useState(false);
  const [brandTagError, setBrandTagError] = useState<string | null>(null);
  const [brandTagUploading, setBrandTagUploading] = useState(false);
  const [brandTagCaption, setBrandTagCaption] = useState('');
  const [brandTagNewImageKind, setBrandTagNewImageKind] = useState<BrandTagImageKind>('tag');
  const [brandTagEditingId, setBrandTagEditingId] = useState<number | null>(null);
  const [brandTagEditCaption, setBrandTagEditCaption] = useState('');
  const [brandTagEditKind, setBrandTagEditKind] = useState<BrandTagImageKind>('tag');
  const [brandTagSaving, setBrandTagSaving] = useState(false);
  const [brandTagAddPanelOpen, setBrandTagAddPanelOpen] = useState(false);
  const [brandWebsiteUrlEditing, setBrandWebsiteUrlEditing] = useState(false);
  const [brandWebsiteUrlDraft, setBrandWebsiteUrlDraft] = useState('');
  const [brandWebsiteUrlSaving, setBrandWebsiteUrlSaving] = useState(false);
  const [brandsApiError, setBrandsApiError] = useState<string | null>(null);
  const [brandsLoaded, setBrandsLoaded] = useState(false);
  /** Shown at top when fetch fails (e.g. ERR_CONNECTION_REFUSED — backend not on :5003). */
  const [researchApiOfflineMessage, setResearchApiOfflineMessage] = useState<string | null>(null);

  const compressImage = (file: File, maxWidth: number = 1920, maxHeight: number = 1920, quality: number = 0.8): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Calculate new dimensions
          if (width > height) {
            if (width > maxWidth) {
              height = (height * maxWidth) / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = (width * maxHeight) / height;
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert to base64 with compression
          const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedDataUrl);
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    const remainingSlots = 4 - researchImages.length;
    if (remainingSlots <= 0) {
      setResearchError('Maximum 4 images allowed');
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    
    // Validate all files
    for (const file of filesToProcess) {
      if (!file.type.startsWith('image/')) {
        setResearchError('Please upload only image files');
        return;
      }
    }

    setResearchError(null);
    setResearchLoading(true);

    try {
      const compressedImages: string[] = [];
      
      for (const file of filesToProcess) {
        // Check file size (warn if over 10MB before compression)
        if (file.size > 10 * 1024 * 1024) {
          console.warn('Image is very large, compressing...', file.name);
        }
        
        const compressedImage = await compressImage(file);
        compressedImages.push(compressedImage);
      }

      setResearchImages((prev) => [...prev, ...compressedImages]);
      setResearchError(null);
    } catch (err: any) {
      setResearchError(err.message || 'Failed to process image file');
    } finally {
      setResearchLoading(false);
      // Reset the input so the same file can be selected again
      event.target.value = '';
    }
  };

  const removeImage = (index: number) => {
    setResearchImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCameraCapture = async () => {
    if (researchImages.length >= 4) {
      setResearchError('Maximum 4 images allowed');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } // Prefer back camera on mobile
      });
      
      // Create a video element to show the camera feed
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      
      // Create a modal/overlay for camera preview
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.9);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 20px;
      `;
      
      const videoContainer = document.createElement('div');
      videoContainer.style.cssText = `
        width: 90%;
        max-width: 640px;
        position: relative;
      `;
      
      video.style.cssText = `
        width: 100%;
        height: auto;
        border-radius: 12px;
      `;
      
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = `
        display: flex;
        gap: 12px;
        justify-content: center;
      `;
      
      const captureButton = document.createElement('button');
      captureButton.textContent = '📷 Capture';
      captureButton.style.cssText = `
        padding: 16px 32px;
        font-size: 18px;
        border-radius: 999px;
        border: 2px solid #8cffc3;
        background: rgba(140, 255, 195, 0.2);
        color: #8cffc3;
        cursor: pointer;
        font-weight: 600;
      `;
      
      const cancelButton = document.createElement('button');
      cancelButton.textContent = 'Cancel';
      cancelButton.style.cssText = `
        padding: 16px 32px;
        font-size: 18px;
        border-radius: 999px;
        border: 2px solid rgba(255, 120, 120, 0.5);
        background: rgba(255, 120, 120, 0.2);
        color: #ff9a9a;
        cursor: pointer;
        font-weight: 600;
      `;
      
      const capturePhoto = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          canvas.toBlob(async (blob) => {
            if (blob) {
              const file = new File([blob], 'camera-photo.jpg', { type: 'image/jpeg' });
              try {
                const compressedImage = await compressImage(file);
                setResearchImages((prev) => [...prev, compressedImage]);
                setResearchError(null);
              } catch (err: any) {
                setResearchError(err.message || 'Failed to process photo');
              }
            }
            // Cleanup
            stream.getTracks().forEach(track => track.stop());
            document.body.removeChild(modal);
          }, 'image/jpeg', 0.9);
        }
      };
      
      const cancelCapture = () => {
        stream.getTracks().forEach(track => track.stop());
        document.body.removeChild(modal);
      };
      
      captureButton.onclick = capturePhoto;
      cancelButton.onclick = cancelCapture;
      
      videoContainer.appendChild(video);
      buttonContainer.appendChild(captureButton);
      buttonContainer.appendChild(cancelButton);
      modal.appendChild(videoContainer);
      modal.appendChild(buttonContainer);
      document.body.appendChild(modal);
      
      // Wait for video to be ready
      video.onloadedmetadata = () => {
        video.play();
      };
      
    } catch (err: any) {
      console.error('Camera access error:', err);
      setResearchError('Unable to access camera. Please check permissions or use file upload instead.');
    }
  };

  const handleResearchSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!researchText.trim() && researchImages.length === 0) {
      setResearchError('Please enter text or upload at least one image');
      return;
    }

    setResearchLoading(true);
    setResearchError(null);
    setResearchResult(null);

    try {
      const requestBody = {
        text: researchText.trim() || undefined,
        images: researchImages.length > 0 ? researchImages : []
      };
      
      console.log('Sending research request:', {
        hasText: !!requestBody.text,
        textLength: requestBody.text?.length || 0,
        imagesCount: requestBody.images.length,
        imagesAreArray: Array.isArray(requestBody.images)
      });

      const response = await fetch(apiUrl('/api/gemini/research'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await readJsonResponse<{ result?: string }>(response, 'gemini/research');
      setResearchResult(data.result ?? '');
    } catch (err: any) {
      console.error('Gemini research error:', err);
      setResearchError(friendlyApiUnreachableMessage(err));
    } finally {
      setResearchLoading(false);
    }
  };

  const clearResearch = () => {
    setResearchText('');
    setResearchImages([]);
    setResearchResult(null);
    setResearchError(null);
  };

  // Offline/Brand search functionality
  useEffect(() => {
    if (!searchText.trim()) {
      setTypeaheadResults([]);
      setShowTypeahead(false);
      return;
    }

    const searchTerm = searchText.toLowerCase().trim();
    const results: TypeaheadResult[] = [];

    // Search mensResaleReference (comprehensive source)
    mensResaleReference.forEach((item) => {
      if (item.brand.toLowerCase().includes(searchTerm)) {
        results.push({
          name: item.brand,
          status: getStatusFromEmoji(item.status),
          note: item.note,
          categories: item.categories
        });
      }
    });

    setTypeaheadResults(results.slice(0, 10));
    setShowTypeahead(results.length > 0);
  }, [searchText, offlineReferenceTick]);

  // Handle Escape key to close typeahead and clear text
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showTypeahead) {
          setShowTypeahead(false);
        }
        setSearchText('');
        setSelectedLookupBrand('');
        setTypeaheadResults([]);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [showTypeahead]);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    const loadMensResaleReference = async () => {
      const applyRows = (rows: MensResaleReferenceRow[]) => {
        mensResaleReference.length = 0;
        mensResaleReference.push(...rows.map((r) => ({ ...r })));
        setOfflineReferenceTick((t) => t + 1);
      };

      try {
        const response = await fetch(apiUrl('/api/mens-resale-reference'), { signal: ac.signal });
        const data = await readJsonResponse<unknown>(response, 'mens-resale-reference');
        if (cancelled) return;
        const normalized = normalizeMensResaleApiPayload(data);
        const rows =
          normalized.length > 0 ? normalized : mensResaleReferenceFallback.map((r) => ({ ...r }));
        applyRows(rows);
        console.log(`Loaded ${mensResaleReference.length} brands for offline research (API rows: ${normalized.length})`);
      } catch (error) {
        if (cancelled || isAbortError(error)) return;
        console.warn('Failed to load mensResaleReference from API, using embedded fallback:', error);
        if (isUnreachableFetchError(error)) {
          setResearchApiOfflineMessage(friendlyApiUnreachableMessage(error));
        }
        applyRows(mensResaleReferenceFallback.map((r) => ({ ...r })));
      }
    };

    loadMensResaleReference();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  // Clear text box when navigating away or menu is clicked
  useEffect(() => {
    const clearOnNavigation = () => {
      setSearchText('');
      setSelectedLookupBrand('');
      setTypeaheadResults([]);
      setShowTypeahead(false);
    };

    // Clear when location changes (navigation)
    clearOnNavigation();
  }, [location.pathname]);

  // Load brands from DB (Brand Research: website + tag images)
  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    const loadBrandsWithWebsites = async () => {
      setBrandsApiError(null);
      setBrandsLoaded(false);
      try {
        const response = await fetch(apiUrl('/api/brands'), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: ac.signal,
        });

        const data = await readJsonResponse<unknown>(response, '/api/brands');
        if (cancelled) return;

        const rawForCount = Array.isArray(data)
          ? data
          : data && typeof data === 'object' && Array.isArray((data as { rows?: unknown[] }).rows)
            ? (data as { rows: unknown[] }).rows
            : [];
        const valid = parseBrandsApiPayload(data);
        setBrandsWithWebsites(valid);
        if (valid.length === 0 && rawForCount.length > 0) {
          setBrandsApiError('Brands response had no valid rows (check id / brand_name).');
        }
      } catch (err) {
        if (cancelled || isAbortError(err)) return;
        console.error('Failed to load brands with websites:', err);
        setBrandsWithWebsites([]);
        const friendly = friendlyApiUnreachableMessage(err);
        if (isUnreachableFetchError(err)) {
          setResearchApiOfflineMessage(friendly);
          setBrandsApiError(null);
        } else {
          setBrandsApiError(friendly);
        }
      } finally {
        if (!cancelled) {
          setBrandsLoaded(true);
        }
      }
    };

    loadBrandsWithWebsites();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, []);

  // Brand Research: ?brand=<id> or ?brand=<encoded brand_name>
  useEffect(() => {
    if (!brandsLoaded) return;

    const raw = brandQueryParam?.trim();
    if (!raw) {
      setBrandTagBrandId((prev) => (prev !== '' ? '' : prev));
      return;
    }

    if (brandsWithWebsites.length === 0) return;

    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }

    const trimmed = decoded.trim();
    const asNum = parseInt(trimmed, 10);
    const looksNumericId = !Number.isNaN(asNum) && /^\d+$/.test(trimmed);

    let id: number | null = null;
    if (looksNumericId && brandsWithWebsites.some((b) => b.id === asNum)) {
      id = asNum;
    } else {
      const found = brandsWithWebsites.find(
        (b) => b.brand_name.toLowerCase().trim() === trimmed.toLowerCase()
      );
      if (found) id = found.id;
    }

    if (id !== null) {
      const selectedId = id;
      setBrandTagBrandId((prev) => (prev !== selectedId ? selectedId : prev));
    } else {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('brand');
          return next;
        },
        { replace: true }
      );
      setBrandTagBrandId((prev) => (prev !== '' ? '' : prev));
    }
  }, [brandsLoaded, brandsWithWebsites, brandQueryParam, setSearchParams]);

  useEffect(() => {
    setBrandTagEditingId(null);
    setBrandTagEditCaption('');
    setBrandTagEditKind('tag');
    setBrandTagNewImageKind('tag');
    setBrandTagAddPanelOpen(false);
    setBrandWebsiteUrlEditing(false);
    setBrandWebsiteUrlDraft('');
  }, [brandTagBrandId]);

  useEffect(() => {
    if (!brandTagBrandId) {
      setBrandTagImages([]);
      setBrandTagError(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setBrandTagLoading(true);
      setBrandTagError(null);
      try {
        const response = await fetch(
          apiUrl(`/api/brandTagImages?brandId=${encodeURIComponent(String(brandTagBrandId))}`)
        );
        const data = await readJsonResponse<{ rows?: unknown[] }>(response, 'brandTagImages');
        if (!cancelled) {
          const rows = Array.isArray(data.rows) ? data.rows.map(normalizeBrandTagImageRow) : [];
          setBrandTagImages(sortBrandTagImages(rows));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setBrandTagImages([]);
          setBrandTagError(friendlyApiUnreachableMessage(err));
        }
      } finally {
        if (!cancelled) {
          setBrandTagLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [brandTagBrandId]);

  const handleSaveBrandWebsite = async () => {
    if (brandTagBrandId === '') return;
    const id = brandTagBrandId;
    const trimmed = brandWebsiteUrlDraft.trim();
    setBrandWebsiteUrlSaving(true);
    setBrandTagError(null);
    try {
      const response = await fetch(apiUrl(`/api/brands/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_website: trimmed ? trimmed.slice(0, 2048) : null }),
      });
      const data = await readJsonResponse<{
        row?: { id: number; brand_name: string; brand_website: string | null };
      }>(response, 'brand website update');
      const row = data.row;
      if (row) {
        setBrandsWithWebsites((prev) =>
          prev.map((br) => (br.id === row.id ? { ...br, brand_website: row.brand_website } : br))
        );
      }
      setBrandWebsiteUrlEditing(false);
      setBrandWebsiteUrlDraft('');
    } catch (err: unknown) {
      setBrandTagError(friendlyApiUnreachableMessage(err));
    } finally {
      setBrandWebsiteUrlSaving(false);
    }
  };

  const handleBrandTagFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !brandTagBrandId) {
      return;
    }

    setBrandTagUploading(true);
    setBrandTagError(null);
    try {
      const formData = new FormData();
      formData.append('brandId', String(brandTagBrandId));
      formData.append('image', file);
      const cap = brandTagCaption.trim();
      if (cap) {
        formData.append('caption', cap);
      }
      formData.append('imageKind', brandTagNewImageKind);

      const response = await fetch(apiUrl('/api/brandTagImages'), {
        method: 'POST',
        body: formData,
      });
      const data = await readJsonResponse<BrandTagImageRow & { error?: string }>(
        response,
        'brandTagImages upload'
      );
      setBrandTagImages((prev) =>
        sortBrandTagImages([...prev, normalizeBrandTagImageRow(data)])
      );
      setBrandTagCaption('');
      setBrandTagNewImageKind('tag');
      setBrandTagAddPanelOpen(false);
    } catch (err: unknown) {
      setBrandTagError(friendlyApiUnreachableMessage(err));
    } finally {
      setBrandTagUploading(false);
    }
  };

  const handleDeleteBrandTagImage = async (imageId: number) => {
    if (!window.confirm('Remove this example tag image?')) {
      return;
    }
    setBrandTagError(null);
    try {
      const response = await fetch(apiUrl(`/api/brandTagImages/${imageId}`), {
        method: 'DELETE',
      });
      await readJsonResponse<{ ok?: boolean }>(response, 'brandTagImages delete');
      setBrandTagImages((prev) => prev.filter((row) => row.id !== imageId));
      setBrandTagEditingId((cur) => (cur === imageId ? null : cur));
    } catch (err: unknown) {
      setBrandTagError(friendlyApiUnreachableMessage(err));
    }
  };

  const startEditBrandTagImage = (img: BrandTagImageRow) => {
    setBrandTagEditingId(img.id);
    setBrandTagEditCaption(img.caption ?? '');
    setBrandTagEditKind(img.image_kind);
  };

  const cancelEditBrandTagImage = () => {
    setBrandTagEditingId(null);
    setBrandTagEditCaption('');
    setBrandTagEditKind('tag');
  };

  const handleSaveBrandTagCaption = async () => {
    if (brandTagEditingId === null) return;
    const id = brandTagEditingId;
    const trimmed = brandTagEditCaption.trim();
    setBrandTagSaving(true);
    setBrandTagError(null);
    try {
      const response = await fetch(apiUrl(`/api/brandTagImages/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: trimmed ? trimmed.slice(0, 500) : null,
          imageKind: brandTagEditKind,
        }),
      });
      const data = await readJsonResponse<BrandTagImageRow>(response, 'brandTagImages patch');
      const normalized = normalizeBrandTagImageRow(data);
      setBrandTagImages((prev) =>
        sortBrandTagImages(prev.map((row) => (row.id === id ? { ...row, ...normalized } : row)))
      );
      setBrandTagEditingId(null);
      setBrandTagEditCaption('');
      setBrandTagEditKind('tag');
    } catch (err: unknown) {
      setBrandTagError(friendlyApiUnreachableMessage(err));
    } finally {
      setBrandTagSaving(false);
    }
  };

  const renderBrandTagImageCard = (img: BrandTagImageRow) => {
    const isEditing = brandTagEditingId === img.id;
    const isFake = img.image_kind === 'fake_check';
    return (
      <li
        key={img.id}
        className={
          'brand-tag-examples-card' + (isFake ? ' brand-tag-examples-card--fake' : '')
        }
      >
        <div className="brand-tag-examples-card-row">
          <div className="brand-tag-examples-card-media">
            {img.public_url ? (
              <a
                href={img.public_url}
                target="_blank"
                rel="noopener noreferrer"
                className="brand-tag-examples-thumb-link"
              >
                <img
                  src={img.public_url}
                  alt={img.caption || (isFake ? 'Fake check reference' : 'Brand tag')}
                  className="brand-tag-examples-thumb"
                />
              </a>
            ) : (
              <div className="brand-tag-examples-thumb-fallback" title={img.storage_path}>
                No public URL (check Storage bucket / env)
              </div>
            )}
          </div>
          {isEditing ? (
            <div className="brand-tag-examples-edit-panel brand-tag-examples-card-edit-span">
              <label className="brand-tag-examples-edit-label" htmlFor={`brand-tag-kind-${img.id}`}>
                Image type
              </label>
              <select
                id={`brand-tag-kind-${img.id}`}
                className="brand-tag-examples-select brand-tag-examples-kind-select"
                value={brandTagEditKind}
                onChange={(e) => setBrandTagEditKind(e.target.value as BrandTagImageKind)}
                disabled={brandTagSaving}
              >
                <option value="tag">Tag</option>
                <option value="fake_check">Fake Check</option>
              </select>
              <label className="brand-tag-examples-edit-label" htmlFor={`brand-tag-edit-${img.id}`}>
                Description
              </label>
              <textarea
                id={`brand-tag-edit-${img.id}`}
                className="brand-tag-examples-edit-textarea"
                value={brandTagEditCaption}
                onChange={(e) => setBrandTagEditCaption(e.target.value)}
                placeholder="e.g. SS19 neck label"
                maxLength={500}
                rows={4}
                disabled={brandTagSaving}
              />
              <div className="brand-tag-examples-edit-actions">
                <button
                  type="button"
                  className="brand-tag-examples-save"
                  onClick={() => void handleSaveBrandTagCaption()}
                  disabled={brandTagSaving}
                >
                  {brandTagSaving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="brand-tag-examples-cancel"
                  onClick={cancelEditBrandTagImage}
                  disabled={brandTagSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="brand-tag-examples-remove"
                  onClick={() => void handleDeleteBrandTagImage(img.id)}
                  disabled={brandTagSaving}
                >
                  Delete image
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="brand-tag-examples-caption-block">
                {img.caption ? (
                  <p className="brand-tag-examples-caption">{img.caption}</p>
                ) : (
                  <p className="brand-tag-examples-caption-placeholder">No description yet</p>
                )}
              </div>
              <div className="brand-tag-examples-card-edit-col">
                <button
                  type="button"
                  className="brand-tag-examples-edit-btn"
                  onClick={() => startEditBrandTagImage(img)}
                >
                  Edit
                </button>
              </div>
            </>
          )}
        </div>
      </li>
    );
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchText(event.target.value);
    setSelectedLookupBrand('');
  };

  const handleTypeaheadClick = (brandName: string) => {
    setSearchText(brandName);
    setShowTypeahead(false);
    setSelectedLookupBrand(brandName);
  };

  const handleCopyToClipboard = async (brandName: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const textToCopy = String(brandName).trim();
    
    try {
      await navigator.clipboard.writeText(textToCopy);
      
      const button = e.currentTarget;
      const originalText = button.innerHTML;
      button.innerHTML = '✓';
      button.style.color = '#60ff9f';
      setTimeout(() => {
        button.innerHTML = originalText;
        button.style.color = '';
      }, 1000);
    } catch (err) {
      console.error('Failed to copy:', err);
      try {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        const button = e.currentTarget;
        const originalText = button.innerHTML;
        button.innerHTML = '✓';
        button.style.color = '#60ff9f';
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.color = '';
        }, 1000);
      } catch (fallbackErr) {
        console.error('Fallback copy also failed:', fallbackErr);
      }
    }
  };

  // AI Research functionality
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const stored = window.localStorage.getItem('saerch term');
      const trimmed = stored ? stored.trim() : '';

      if (!trimmed) {
        return;
      }

      setResearchText((current) => (current.trim().length > 0 ? current : trimmed));
    } catch (storageError) {
      console.warn('Unable to read stored search term for research:', storageError);
    }
  }, []);


  return (
    <div className="research-page-container">
      {researchApiOfflineMessage && (
        <div className="research-api-offline-banner" role="alert">
          {researchApiOfflineMessage}
        </div>
      )}
      <div className="brand-tag-examples-container">
        <h2 className="brand-tag-examples-heading">Brand research</h2>
        <div
          className={
            'brand-tag-examples-form' +
            (brandTagBrandId === '' ? ' brand-tag-examples-form--no-brand-selected' : '')
          }
        >
          {!brandsLoaded && (
            <div className="brand-tag-examples-muted" style={{ marginBottom: 8 }}>
              Loading brands…
            </div>
          )}
          {brandsApiError && (
            <div className="brand-tag-examples-error" style={{ marginBottom: 12 }}>
              {brandsApiError}
            </div>
          )}
          {brandsLoaded &&
            researchApiOfflineMessage &&
            !brandsApiError &&
            brandsWithWebsites.length === 0 && (
              <div className="brand-tag-examples-muted" style={{ marginBottom: 12 }}>
                Brand Research needs the API — see the notice at the top of this page.
              </div>
            )}
          {brandsLoaded &&
            !brandsApiError &&
            !researchApiOfflineMessage &&
            brandsWithWebsites.length === 0 && (
            <div className="brand-tag-examples-muted" style={{ marginBottom: 12 }}>
              No brands returned from the API. Add rows to the <code className="brand-tag-examples-code">brand</code>{' '}
              table or check the server / database connection.
            </div>
          )}
          <div className="brand-tag-examples-brand-stack">
            <div
              className={
                'brand-tag-examples-brand-toolbar' +
                (brandTagBrandId !== '' ? ' brand-tag-examples-brand-toolbar--split' : '')
              }
            >
              <div className="brand-tag-examples-brand-select-wrap">
                <select
                  id="brand-tag-brand-select"
                  className="brand-tag-examples-select"
                  aria-label="Select brand"
                  value={brandTagBrandId === '' ? '' : String(brandTagBrandId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    const id = v ? Number(v) : '';
                    setBrandTagBrandId(id);
                    const next = new URLSearchParams(searchParams);
                    if (id === '') {
                      next.delete('brand');
                    } else {
                      next.set('brand', String(id));
                    }
                    setSearchParams(next, { replace: true });
                  }}
                  disabled={!brandsLoaded || brandsWithWebsites.length === 0}
                >
                  <option value="">Select a brand…</option>
                  {brandsWithWebsites.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.brand_name}
                    </option>
                  ))}
                </select>
              </div>
              {brandTagBrandId !== '' && (
                <div className="brand-tag-examples-brand-toolbar-actions">
                  <button
                    type="button"
                    className="brand-tag-examples-add-info-btn brand-tag-examples-toolbar-btn"
                    onClick={() => setBrandTagAddPanelOpen((o) => !o)}
                    aria-expanded={brandTagAddPanelOpen}
                  >
                    {brandTagAddPanelOpen ? 'Hide add image' : 'Add info'}
                  </button>
                  {!brandWebsiteUrlEditing && (
                    <button
                      type="button"
                      className="brand-tag-examples-edit-btn brand-tag-examples-toolbar-btn"
                      onClick={() => {
                        const br = brandsWithWebsites.find((x) => x.id === brandTagBrandId);
                        if (br) {
                          setBrandWebsiteUrlDraft(br.brand_website?.trim() ?? '');
                          setBrandWebsiteUrlEditing(true);
                        }
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>
              )}
            </div>
            {brandTagBrandId !== '' &&
              (() => {
                const b = brandsWithWebsites.find((x) => x.id === brandTagBrandId);
                if (!b) return null;

                const rawBrowse = b.brand_website?.trim() ?? '';
                const fullUrlBrowse =
                  rawBrowse &&
                  (rawBrowse.startsWith('http://') || rawBrowse.startsWith('https://')
                    ? rawBrowse
                    : `https://${rawBrowse}`);

                const addImagePanel = brandTagAddPanelOpen ? (
                  <div className="brand-tag-examples-add-panel" id="brand-tag-add-panel">
                    <label className="brand-tag-examples-label" htmlFor="brand-tag-new-kind">
                      Image type
                    </label>
                    <select
                      id="brand-tag-new-kind"
                      className="brand-tag-examples-select brand-tag-examples-kind-select"
                      value={brandTagNewImageKind}
                      onChange={(e) => setBrandTagNewImageKind(e.target.value as BrandTagImageKind)}
                      disabled={brandTagUploading}
                    >
                      <option value="tag">Tag</option>
                      <option value="fake_check">Fake Check</option>
                    </select>
                    <label className="brand-tag-examples-label" htmlFor="brand-tag-caption">
                      Caption (optional)
                    </label>
                    <input
                      id="brand-tag-caption"
                      type="text"
                      className="brand-tag-examples-caption-input"
                      value={brandTagCaption}
                      onChange={(e) => setBrandTagCaption(e.target.value)}
                      placeholder="e.g. SS19 neck label"
                      maxLength={500}
                    />
                    <div className="brand-tag-examples-upload-row">
                      <label htmlFor="brand-tag-file" className="brand-tag-examples-upload-button">
                        {brandTagUploading ? 'Uploading…' : 'Upload image'}
                      </label>
                      <input
                        id="brand-tag-file"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="brand-tag-examples-file-input"
                        disabled={brandTagUploading}
                        onChange={handleBrandTagFileChange}
                      />
                    </div>
                    <button
                      type="button"
                      className="brand-tag-examples-add-panel-close"
                      onClick={() => {
                        setBrandTagAddPanelOpen(false);
                        setBrandTagCaption('');
                        setBrandTagNewImageKind('tag');
                      }}
                    >
                      Close
                    </button>
                  </div>
                ) : null;

                return (
                  <div className="brand-tag-examples-brand-website-below">
                    {brandWebsiteUrlEditing ? (
                      <div className="brand-tag-examples-website-edit brand-tag-examples-website-under-dropdown">
                        <label className="brand-tag-examples-label" htmlFor="brand-research-website-url">
                          Website URL
                        </label>
                        <div className="brand-tag-examples-website-edit-input-row">
                          <input
                            id="brand-research-website-url"
                            type="text"
                            className="brand-tag-examples-caption-input brand-tag-examples-website-url-input"
                            value={brandWebsiteUrlDraft}
                            onChange={(e) => setBrandWebsiteUrlDraft(e.target.value)}
                            placeholder="https://…"
                            maxLength={2048}
                            disabled={brandWebsiteUrlSaving}
                            autoComplete="url"
                          />
                          <button
                            type="button"
                            className="brand-tag-examples-save"
                            onClick={() => void handleSaveBrandWebsite()}
                            disabled={brandWebsiteUrlSaving}
                          >
                            {brandWebsiteUrlSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="brand-tag-examples-cancel"
                            onClick={() => {
                              setBrandWebsiteUrlEditing(false);
                              setBrandWebsiteUrlDraft('');
                            }}
                            disabled={brandWebsiteUrlSaving}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="brand-tag-examples-website-browse-below">
                        {fullUrlBrowse ? (
                          <div className="brand-visit-website-framed">
                            <hr className="brand-visit-website-rule" aria-hidden="true" />
                            <a
                              href={fullUrlBrowse}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="brand-website-link brand-tag-examples-website-browse-link"
                              title={rawBrowse}
                            >
                              Visit Website
                            </a>
                            <hr className="brand-visit-website-rule" aria-hidden="true" />
                          </div>
                        ) : (
                          <span className="brand-tag-examples-muted brand-tag-examples-website-browse-empty">
                            No website URL
                          </span>
                        )}
                      </div>
                    )}
                    {addImagePanel}
                  </div>
                );
              })()}
          </div>
        </div>
        {brandTagError && <div className="brand-tag-examples-error">{brandTagError}</div>}
        {brandTagBrandId !== '' && brandTagLoading && (
          <div className="brand-tag-examples-muted">Loading…</div>
        )}
        {brandTagImages.length > 0 && (
          <>
            {(() => {
              const tagRows = brandTagImages.filter((i) => i.image_kind !== 'fake_check');
              const fakeRows = brandTagImages.filter((i) => i.image_kind === 'fake_check');
              return (
                <>
                  {tagRows.length > 0 && (
                    <div className="brand-tag-examples-image-section">
                      <ul className="brand-tag-examples-grid">{tagRows.map(renderBrandTagImageCard)}</ul>
                    </div>
                  )}
                  {fakeRows.length > 0 && (
                    <div className="brand-tag-examples-image-section brand-tag-examples-image-section--fake">
                      <h3 className="brand-tag-examples-fake-heading">Fake Warning Signals</h3>
                      <ul className="brand-tag-examples-grid brand-tag-examples-grid--fake">
                        {fakeRows.map(renderBrandTagImageCard)}
                      </ul>
                    </div>
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* Brand Offline Research (offline reference + lookup) */}
      <div className="brand-lookup-container">
        <h2 className="brand-lookup-heading">Brand Offline Research</h2>
        <div className="brand-lookup-form">
          <div className="search-input-container brand-lookup-quick-search" style={{ position: 'relative' }}>
            <input
              id="brand-offline-search"
              type="text"
              value={searchText}
              onChange={handleSearchChange}
              onFocus={() => {
                if (typeaheadResults.length > 0) {
                  setShowTypeahead(true);
                }
              }}
              onBlur={() => {
                setTimeout(() => setShowTypeahead(false), 200);
              }}
              placeholder="Search brands…"
              className="brand-search-input"
              autoComplete="off"
              aria-label="Search brands"
            />
            {showTypeahead && typeaheadResults.length > 0 && (
              <div className="brand-results-dropdown" onClick={() => setShowTypeahead(false)}>
                <div
                  className="brand-results-dropdown-content"
                  onClick={(e) => {
                    if (window.innerWidth <= 768) {
                      setShowTypeahead(false);
                    } else {
                      e.stopPropagation();
                    }
                  }}
                >
                  {typeaheadResults.map((result, index) => {
                    const brandName = result.name;
                    return (
                      <div
                        key={`${result.name}-${index}`}
                        className={`brand-result-item ${result.status}`}
                        onMouseDown={(e) => {
                          if ((e.target as HTMLElement).closest('.copy-brand-button')) {
                            return;
                          }
                          e.preventDefault();
                          handleTypeaheadClick(brandName);
                        }}
                        onTouchStart={(e) => {
                          if ((e.target as HTMLElement).closest('.copy-brand-button')) {
                            return;
                          }
                          e.preventDefault();
                          handleTypeaheadClick(brandName);
                        }}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('.copy-brand-button')) {
                            return;
                          }
                          if (window.innerWidth <= 768) {
                            handleTypeaheadClick(brandName);
                          }
                        }}
                      >
                        <div className="result-brand-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                            <span className="result-brand">{brandName}</span>
                            <button
                              type="button"
                              onClick={(e) => handleCopyToClipboard(brandName, e)}
                              onMouseDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              className="copy-brand-button"
                              title="Copy brand name to clipboard"
                              aria-label={`Copy ${brandName} to clipboard`}
                            >
                              📋
                            </button>
                          </div>
                          <span
                            className={`result-status-tag ${result.status === 'good' ? 'good-tag' : result.status === 'warning' ? 'warning-tag' : 'avoid-tag'}`}
                          >
                            {result.status === 'good'
                              ? 'Good'
                              : result.status === 'warning'
                                ? 'Warning'
                                : 'Avoid'}
                          </span>
                        </div>
                        {result.note && <div className="result-note">{result.note}</div>}
                        {result.categories && result.categories.length > 0 && (
                          <div className="result-categories-list">
                            {result.categories.map((cat, catIndex) => (
                              <div key={catIndex} className="result-category-row">
                                <span className="category-item">{cat.item}</span>
                                <span className="category-range">{cat.resaleRange}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {selectedLookupBrand && (() => {
            // Find brand in mensResaleReference for status, note, and categories
            const brandData = mensResaleReference.find(item => 
              item.brand.toLowerCase().trim() === selectedLookupBrand.toLowerCase().trim()
            );
            
            // Find brand in brandsWithWebsites for website URL
            const selectedBrand = brandsWithWebsites.find(b => 
              b.brand_name.toLowerCase().trim() === selectedLookupBrand.toLowerCase().trim()
            );
            
            if (!brandData) {
              return null;
            }
            
            const status = getStatusFromEmoji(brandData.status);
            
            return (
              <div className="brand-lookup-result">
                <div className={`brand-result-item ${status}`}>
                  <div className="result-brand-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                      <span className="result-brand">{selectedLookupBrand}</span>
                      <button
                        type="button"
                        onClick={(e) => handleCopyToClipboard(selectedLookupBrand, e)}
                        className="copy-brand-button"
                        title="Copy brand name to clipboard"
                        aria-label={`Copy ${selectedLookupBrand} to clipboard`}
                      >
                        📋
                      </button>
                    </div>
                    <span className={`result-status-tag ${status === 'good' ? 'good-tag' : status === 'warning' ? 'warning-tag' : 'avoid-tag'}`}>
                      {status === 'good' ? 'Good' : status === 'warning' ? 'Warning' : 'Avoid'}
                    </span>
                  </div>
                  {brandData.note && (
                    <div className="result-note">{brandData.note}</div>
                  )}
                  {brandData.categories && brandData.categories.length > 0 && (
                    <div className="result-categories-list">
                      {brandData.categories.map((cat, catIndex) => (
                        <div key={catIndex} className="result-category-row">
                          <span className="category-item">{cat.item}</span>
                          <span className="category-range">{cat.resaleRange}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedBrand && selectedBrand.brand_website && (() => {
                    const rawSite = selectedBrand.brand_website.trim();
                    const hrefSite =
                      rawSite.startsWith('http://') || rawSite.startsWith('https://')
                        ? rawSite
                        : `https://${rawSite}`;
                    return (
                      <div className="brand-visit-website-framed">
                        <hr className="brand-visit-website-rule" aria-hidden="true" />
                        <div className="brand-website-link-container">
                          <a
                            href={hrefSite}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="brand-website-link"
                            title={rawSite}
                          >
                            Visit Website
                          </a>
                        </div>
                        <hr className="brand-visit-website-rule" aria-hidden="true" />
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* AI Research Section */}
      <div className="research-tool-container">
        <h2 className="research-section-heading">AI Research</h2>
        <form onSubmit={handleResearchSubmit} className="research-tool-form">
          <div className="research-input-group">
            <textarea
              value={researchText}
              onChange={(e) => setResearchText(e.target.value)}
              placeholder="Enter item description or search query..."
              className="research-text-input"
              rows={1}
            />
            <div className="research-image-upload">
              <div className="image-upload-buttons">
                <button
                  type="button"
                  onClick={handleCameraCapture}
                  className="image-upload-label camera-label"
                  disabled={researchImages.length >= 4}
                >
                  📷 Take Photo
                </button>
                <label htmlFor="research-image-file" className="image-upload-label file-label">
                  📁 Choose Files
                </label>
                <input
                  id="research-image-file"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="image-upload-input"
                  disabled={researchImages.length >= 4}
                />
              </div>
              {researchImages.length > 0 && (
                <div className="images-count-indicator">
                  {researchImages.length}/4 images selected
                </div>
              )}
              {researchImages.length > 0 && (
                <div className="images-preview-container">
                  {researchImages.map((image, index) => (
                    <div key={index} className="image-preview">
                      <img src={image} alt={`Preview ${index + 1}`} />
                      <button
                        type="button"
                        onClick={() => removeImage(index)}
                        className="remove-image-button"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="research-actions">
            <button
              type="submit"
              className="research-submit-button"
              disabled={researchLoading || (!researchText.trim() && researchImages.length === 0)}
            >
              {researchLoading ? 'Researching...' : 'Research Item'}
            </button>
            {(researchText || researchImages.length > 0 || researchResult) && (
              <button
                type="button"
                onClick={clearResearch}
                className="research-clear-button"
              >
                Clear
              </button>
            )}
          </div>

          {researchError && (
            <div className="research-error">{researchError}</div>
          )}

          {researchResult && (
            <div className="research-result">
              <div className="research-result-header">
                <div className="research-result-avatar">AI</div>
                <h3>Research Analysis</h3>
              </div>
              <div className="research-result-content">
                <ReactMarkdown>{researchResult}</ReactMarkdown>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default Research;


