import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar, Pie } from 'react-chartjs-2';
import ReactMarkdown from 'react-markdown';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { getApiBase } from '../utils/apiBase';
import './BrandResearch.css';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

function formatResearchCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value);
}

function formatAveragedSaleBand(min: number, max: number): string {
  const same = Math.abs(max - min) < 0.005;
  return same
    ? formatResearchCurrency(min)
    : `${formatResearchCurrency(min)}–${formatResearchCurrency(max)}`;
}

function formatSoldMultipleDisplay(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const rounded = Math.round(n * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
    return `${Math.round(rounded)}×`;
  }
  return `${rounded.toFixed(1)}×`;
}

async function copyResearchTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
}

type MenswearAskAiBrandLine = { brand_name: string; total_sales?: string | number | null };

function buildMenswearCategoryAskAiPrompt(args: {
  categoryName: string;
  categoryDescription: string | null;
  categoryNotes: string | null;
  brands: MenswearAskAiBrandLine[];
}): string {
  const { categoryName, categoryDescription, categoryNotes, brands } = args;

  const brandLines = brands.map((b, i) => {
    const name = (b.brand_name || '—').trim() || '—';
    const raw = b.total_sales;
    const salesNum = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
    const salesOk = Number.isFinite(salesNum) && salesNum > 0;
    const salesBit = salesOk
      ? ` — recorded sold revenue in my stock system for this brand: ${formatResearchCurrency(salesNum)}`
      : '';
    return `${i + 1}. **${name}**${salesBit}`;
  });

  const header: string[] = [
    `I'm a UK menswear reseller (second-hand / resale). I group inventory with an internal **menswear category** label.`,
    ``,
    `## Category`,
    `**${categoryName}**`,
  ];
  if (categoryDescription?.trim()) header.push(categoryDescription.trim());
  if (categoryNotes?.trim()) header.push(`My notes for this bucket: ${categoryNotes.trim()}`);
  header.push(``);

  if (brandLines.length > 0) {
    header.push(
      `## Brands that are performing well for me here`,
      `These are brands I’ve linked to this category in my system — they’re good sellers / core to how I trade this niche:`,
      ``,
      ...brandLines,
      ``
    );
  } else {
    header.push(
      `## Brands in this category (in my system)`,
      `I don’t have any brands mapped to this category yet. Still use the category definition above when answering.`,
      ``
    );
  }

  header.push(
    `## What I need from you`,
    `1. **Suggest other brands** that fit this same category and resale profile (UK sourcing). Do not repeat my list. Prioritise realistic second-hand flip potential.`,
    `2. **Validate against recent fashion / market news** — for each brand ${brandLines.length ? 'in my list above' : 'that fits this category'}, summarise what recent coverage, drops, or sentiment suggest (momentum, fatigue, quality perception, controversies). **Cite or describe sources where you can; if you don’t know, say you don’t know** — don’t invent headlines.`,
    `3. **Buying recommendations** — for each brand ${brandLines.length ? 'I listed' : 'you discussed'}, what **models, product lines, eras, fabrics, or silhouettes** should I prioritise vs avoid when sourcing? Be specific enough that I can search listings (e.g. diffusion vs mainline, outerwear vs basics, vintage periods).`,
    ``,
    `Tone: direct, resale-first, UK-relevant where it matters.`,
    `Today’s date context for your news scan: ${new Date().toISOString().slice(0, 10)}.`
  );

  return header.join('\n');
}

/** Prompt for the global menswear category list (no single category selected). */
function buildMenswearAllCategoriesAskAiPrompt(
  categories: { name: string; description: string | null; notes: string | null }[]
): string {
  const lines: string[] = [
    `I'm a UK menswear reseller (second-hand / resale). I organise stock using internal **menswear category** labels in my app.`,
    ``,
    `Below is my **full current list** of categories (name, description, and my notes where I have them).`,
    ``,
  ];

  if (categories.length === 0) {
    lines.push(`*(I don’t have any categories defined in the system yet.)*`, ``);
  } else {
    lines.push(`## My categories (${categories.length})`, ``);
    categories.forEach((c, i) => {
      lines.push(`### ${i + 1}. ${c.name}`);
      if (c.description?.trim()) lines.push(c.description.trim());
      if (c.notes?.trim()) lines.push(`**My notes:** ${c.notes.trim()}`);
      lines.push(``);
    });
  }

  lines.push(
    `## What I need from you`,
    `1. **Taxonomy review** — Am I missing important menswear buckets a UK reseller would typically split out? Any overlaps where two of my categories should merge?`,
    `2. **Naming** — Are any names ambiguous or easy to confuse? Suggest clearer labels if needed.`,
    `3. **Gaps** — For resale sourcing (Vinted, eBay, charity shops), what adjacent categories or sub-themes might I want to track separately?`,
    `4. **Optional** — If useful, suggest a short **priority order** for which gaps to fix first.`,
    ``,
    `Tone: direct, practical. Work from the list above; don’t invent categories I already listed under different wording.`,
    `Today’s date context: ${new Date().toISOString().slice(0, 10)}.`
  );

  return lines.join('\n');
}

function menswearSalesPeriodLabel(period: 'last_12_months' | '2026' | '2025'): string {
  if (period === 'last_12_months') return 'Last 12 months (by sale date)';
  if (period === '2026') return 'Calendar year 2026 (by sale date)';
  if (period === '2025') return 'Calendar year 2025 (by sale date)';
  return period;
}

/** Ask RI: compare sold revenue vs unsold counts by clothing category (Clothing Category tab, list view). */
function buildMenswearSalesVsInventoryAskAiPrompt(args: {
  periodLabel: string;
  salesByCategory: { category_name: string; total_sales: number }[];
  unsoldByCategory: { category_name: string; unsold_count: number }[];
}): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  const longDate = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const lines: string[] = [
    `I'm a UK clothing reseller (second-hand / resale). I use internal **clothing categories** in my app; each stock item's brand is mapped to one category.`,
    ``,
    `Below is a snapshot from my system:`,
    `- **Sold revenue by category** for: **${args.periodLabel}** (GBP totals from my records).`,
    `- **Unsold inventory by category**: number of items still unsold (no sale date), grouped by clothing category.`,
    ``,
    `**Time context:** Today is ${longDate} (${dateStr}). Use UK season and calendar when reasoning.`,
    ``,
    `## Sold revenue by category — ${args.periodLabel}`,
    ``,
  ];

  if (args.salesByCategory.length === 0) {
    lines.push(
      `*(No sold revenue in this period for categories that appear in my sales export — pie may be empty.)*`,
      ``
    );
  } else {
    args.salesByCategory.forEach((r) => {
      lines.push(`- **${r.category_name}**: ${formatResearchCurrency(r.total_sales)}`);
    });
    lines.push(``);
  }

  lines.push(`## Unsold item counts by clothing category`, ``);

  if (args.unsoldByCategory.length === 0) {
    lines.push(`*(No category/inventory rows available.)*`, ``);
  } else {
    args.unsoldByCategory.forEach((r) => {
      lines.push(`- **${r.category_name}**: ${r.unsold_count} unsold`);
    });
    lines.push(``);
  }

  lines.push(
    `## What I need from you`,
    `1. **Analyse** how sold revenue mix compares to where my **unsold stock** is sitting.`,
    `2. Tell me what I likely have **too much** of (inventory risk / capital tied up) vs what still looks **healthy**, using both tables.`,
    `3. What should I try to **buy more** of soon — categories or themes that fit my data **and** the current moment?`,
    `4. Incorporate **time of year** (UK), **current trends**, and what's selling in the **real world** using **news and market signals** where you can — **cite or describe sources**; **say you don't know** rather than inventing headlines or stats.`,
    `5. Call out sharp **mismatches** (e.g. many unsold items but weak sales in that category, or strong sales but thin stock).`,
    ``,
    `Be direct and practical. Date stamp: ${dateStr}.`
  );

  return lines.join('\n');
}

function formatResearchShortDate(isoOrDate: string | null): string {
  if (!isoOrDate) return '—';
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole days from purchase date to today (inventory age). */
function daysSincePurchase(isoOrDate: string | null): number | null {
  if (!isoOrDate) return null;
  const start = new Date(isoOrDate);
  if (Number.isNaN(start.getTime())) return null;
  const diff = Date.now() - start.getTime();
  if (diff < 0) return 0;
  return Math.floor(diff / 86400000);
}

type EbaySoldItemRow = {
  itemId: string;
  title: string;
  priceValue: string | null;
  priceCurrency: string;
  imageUrl: string | null;
  itemWebUrl: string | null;
  /** e.g. New, Used — from Browse `condition` / `conditionId`. */
  conditionLabel: string | null;
};

function parseEbaySoldRecentItems(data: unknown): EbaySoldItemRow[] {
  if (!data || typeof data !== 'object') return [];
  const raw = (data as { items?: unknown }).items;
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      itemId: r.itemId != null ? String(r.itemId) : '',
      title: r.title != null ? String(r.title) : '',
      priceValue: r.priceValue != null ? String(r.priceValue) : null,
      priceCurrency: typeof r.priceCurrency === 'string' ? r.priceCurrency : 'GBP',
      imageUrl: r.imageUrl != null ? String(r.imageUrl) : null,
      itemWebUrl: r.itemWebUrl != null ? String(r.itemWebUrl) : null,
      conditionLabel:
        r.conditionLabel != null && String(r.conditionLabel).trim()
          ? String(r.conditionLabel).trim()
          : null,
    };
  });
}

function parseEbaySoldCachePayload(data: unknown): {
  cached: boolean;
  message?: string;
  items: EbaySoldItemRow[];
} {
  if (!data || typeof data !== 'object') {
    return { cached: false, items: [] };
  }
  const o = data as Record<string, unknown>;
  return {
    cached: o.cached === true,
    message: typeof o.message === 'string' ? o.message : undefined,
    items: parseEbaySoldRecentItems(data),
  };
}

function formatEbayDisplayPrice(currency: string, value: string | null): string {
  if (value == null || value === '') return '—';
  const n = parseFloat(value);
  if (Number.isNaN(n)) return value;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(n);
  } catch {
    return `${currency} ${value}`;
  }
}

/** Sold price as a number when currency is GBP (UK listings); otherwise null — used for £30 floor filter. */
function ebaySoldPriceGbpNumber(item: EbaySoldItemRow): number | null {
  if (item.priceValue == null || item.priceValue === '') return null;
  const n = parseFloat(item.priceValue);
  if (Number.isNaN(n)) return null;
  const cur = (item.priceCurrency || 'GBP').toUpperCase();
  if (cur !== 'GBP') return null;
  return n;
}

const EBAY_SOLD_DISPLAY_MIN_GBP = 30;

const apiUrl = (path: string) => {
  const base = getApiBase();
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

type BrandRow = {
  id: number;
  brand_name: string;
  brand_website: string | null;
  things_to_buy: string | null;
  things_to_avoid: string | null;
  /** From GET /api/brands when column exists. */
  menswear_category_id: number | null;
};

type BrandRefLinkRow = {
  id: number;
  brand_id: number;
  url: string;
  link_text: string | null;
  created_at: string;
};

type BrandExamplePricingRow = {
  id: number;
  brand_id: number;
  item_name: string;
  price_gbp: number;
  created_at: string;
};

type BrandStockTopItem = {
  id: number | null;
  item_name: string;
  category_name: string | null;
  purchase_price: number | null;
  sale_price: number | null;
  sale_date: string | null;
  profit: number | null;
  profit_multiple: number | null;
};

type BrandStockLongestUnsoldItem = {
  id: number | null;
  item_name: string;
  category_name: string | null;
  purchase_price: number | null;
  purchase_date: string | null;
};

type BrandCategorySoldUnsoldRow = {
  category_id: number;
  category_name: string;
  sold_count: number;
  unsold_count: number;
};

type BrandStockSummaryPeriod = 'all' | 'last_12_months' | '2026' | '2025';

function brandStockPeriodMenuLabel(period: BrandStockSummaryPeriod): string {
  switch (period) {
    case 'last_12_months':
      return 'Last 12 months';
    case '2026':
      return '2026';
    case '2025':
      return '2025';
    default:
      return 'All time';
  }
}

type BrandStockSummaryPayload = {
  brandId: number;
  period: BrandStockSummaryPeriod;
  /** Stock rows for this brand ignoring period filter (empty-state messaging). */
  stockRowCountLifetime: number;
  totalItems: number;
  soldCount: number;
  unsoldCount: number;
  /** Sum of purchase_price for all rows with a purchase price recorded. */
  totalPurchaseSpend: number;
  /** Sum of sale_price for sold rows (sale_price > 0). */
  totalSoldRevenue: number;
  /** totalSoldRevenue − totalPurchaseSpend (sales vs all buy-in for the brand). */
  brandNetPosition: number;
  /** Min sale_price among sold rows (> 0), when any. */
  minSoldSalePrice: number | null;
  /** Max sale_price among sold rows (> 0), when any. */
  maxSoldSalePrice: number | null;
  /** Mean sale_price ÷ purchase_price for sold rows with both prices > 0, when any. */
  avgSoldProfitMultiple: number | null;
  topSoldItems: BrandStockTopItem[];
  longestUnsoldItems: BrandStockLongestUnsoldItem[];
  /** Per inventory category: sold vs not-sold counts for this brand. */
  categorySoldUnsold: BrandCategorySoldUnsoldRow[];
};

function parseBrandStockSummaryPayload(data: unknown): BrandStockSummaryPayload {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid brand stock summary payload');
  }
  const d = data as Record<string, unknown>;
  const topRaw = d.topSoldItems;
  const topSoldItems: BrandStockTopItem[] = Array.isArray(topRaw)
    ? topRaw.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: r.id != null ? Number(r.id) : null,
          item_name: r.item_name != null ? String(r.item_name) : '',
          category_name: r.category_name != null ? String(r.category_name) : null,
          purchase_price: r.purchase_price != null ? Number(r.purchase_price) : null,
          sale_price: r.sale_price != null ? Number(r.sale_price) : null,
          sale_date: r.sale_date != null ? String(r.sale_date) : null,
          profit: r.profit != null ? Number(r.profit) : null,
          profit_multiple: r.profit_multiple != null ? Number(r.profit_multiple) : null,
        };
      })
    : [];
  const unsoldRaw = d.longestUnsoldItems;
  const longestUnsoldItems: BrandStockLongestUnsoldItem[] = Array.isArray(unsoldRaw)
    ? unsoldRaw.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: r.id != null ? Number(r.id) : null,
          item_name: r.item_name != null ? String(r.item_name) : '',
          category_name: r.category_name != null ? String(r.category_name) : null,
          purchase_price: r.purchase_price != null ? Number(r.purchase_price) : null,
          purchase_date: r.purchase_date != null ? String(r.purchase_date) : null,
        };
      })
    : [];
  const periodRaw = d.period;
  const period: BrandStockSummaryPeriod =
    periodRaw === 'last_12_months' || periodRaw === '2026' || periodRaw === '2025'
      ? periodRaw
      : 'all';
  const stockRowCountLifetime =
    d.stockRowCountLifetime != null ? Number(d.stockRowCountLifetime) : 0;
  const suRaw = d.categorySoldUnsold;
  const categorySoldUnsold: BrandCategorySoldUnsoldRow[] = Array.isArray(suRaw)
    ? suRaw.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          category_id: r.category_id != null ? Number(r.category_id) : 0,
          category_name: r.category_name != null ? String(r.category_name) : 'Uncategorized',
          sold_count: r.sold_count != null ? Number(r.sold_count) : 0,
          unsold_count: r.unsold_count != null ? Number(r.unsold_count) : 0,
        };
      })
    : [];
  const minSp = d.minSoldSalePrice;
  const maxSp = d.maxSoldSalePrice;
  const minSoldSalePrice =
    minSp != null && Number.isFinite(Number(minSp)) ? Number(minSp) : null;
  const maxSoldSalePrice =
    maxSp != null && Number.isFinite(Number(maxSp)) ? Number(maxSp) : null;
  const avgMult = d.avgSoldProfitMultiple;
  const avgSoldProfitMultiple =
    avgMult != null && Number.isFinite(Number(avgMult)) ? Number(avgMult) : null;

  return {
    brandId: Number(d.brandId) || 0,
    period,
    stockRowCountLifetime: Number.isFinite(stockRowCountLifetime) ? stockRowCountLifetime : 0,
    totalItems: Number(d.totalItems) || 0,
    soldCount: Number(d.soldCount) || 0,
    unsoldCount: Number(d.unsoldCount) || 0,
    totalPurchaseSpend: Number(d.totalPurchaseSpend) || 0,
    totalSoldRevenue: Number(d.totalSoldRevenue) || 0,
    brandNetPosition: Number(d.brandNetPosition) || 0,
    minSoldSalePrice,
    maxSoldSalePrice,
    avgSoldProfitMultiple,
    topSoldItems,
    longestUnsoldItems,
    categorySoldUnsold,
  };
}

/** Clipboard prompt for ChatGPT: stuck inventory vs sold winners, blunt data-led analysis. */
function buildLongestUnsoldAskAiPrompt(brandName: string, summary: BrandStockSummaryPayload): string {
  const st =
    summary.soldCount + summary.unsoldCount > 0
      ? ((summary.soldCount / (summary.soldCount + summary.unsoldCount)) * 100).toFixed(1)
      : 'n/a';

  const lines: string[] = [
    'I run a UK resale business. Below is **real data exported from my stock system** for one brand. Do not flatter me or hedge with generic encouragement. Ground every claim in the numbers or item facts given; say when you are inferring vs when something is factual.',
    '',
    `## Brand`,
    `- Name: ${brandName}`,
    `- Brand id (internal): ${summary.brandId}`,
    '',
    '## Portfolio snapshot (this brand in my inventory)',
    `- Total line items: ${summary.totalItems}`,
    `- Sold (with positive sale recorded): ${summary.soldCount}`,
    `- Still unsold / not sold through: ${summary.unsoldCount}`,
    `- Approx. sell-through of recorded items: ${st}%`,
    `- Total purchase spend (rows with a buy price): ${formatResearchCurrency(summary.totalPurchaseSpend)}`,
    `- Total sold revenue: ${formatResearchCurrency(summary.totalSoldRevenue)}`,
    `- Net (sold revenue − all buy-in for brand): ${formatResearchCurrency(summary.brandNetPosition)}`,
    '',
    '## Longest-unsold lines (oldest purchase first — from DB query; these are still not sold)',
    'Each row: item title, category, buy price, purchase date, days since purchase (age in stock).',
    '',
  ];

  summary.longestUnsoldItems.forEach((row, i) => {
    const days = daysSincePurchase(row.purchase_date);
    const price =
      row.purchase_price != null && Number.isFinite(row.purchase_price)
        ? formatResearchCurrency(row.purchase_price)
        : '—';
    lines.push(
      `${i + 1}. **${(row.item_name || '—').trim() || '—'}**`,
      `   - Category: ${row.category_name ?? '—'}`,
      `   - Purchase price: ${price}`,
      `   - Purchase date: ${formatResearchShortDate(row.purchase_date)}`,
      `   - Days in stock (from purchase date): ${days != null ? `${days}d` : '—'}`
    );
  });

  if (summary.topSoldItems.length > 0) {
    lines.push(
      '',
      '## Contrast — top sold performers in this brand (by profit multiple, from same system)',
      'Use this only to compare what *did* move vs what is stuck (category, price point, multiple).',
      ''
    );
    summary.topSoldItems.slice(0, 5).forEach((row, i) => {
      const mult =
        row.profit_multiple != null && Number.isFinite(row.profit_multiple)
          ? `${row.profit_multiple.toFixed(2)}×`
          : '—';
      lines.push(
        `${i + 1}. ${(row.item_name || '—').trim() || '—'} | cat: ${row.category_name ?? '—'} | buy ${row.purchase_price != null ? formatResearchCurrency(row.purchase_price) : '—'} → sold ${row.sale_price != null ? formatResearchCurrency(row.sale_price) : '—'} | profit ${row.profit != null ? formatResearchCurrency(row.profit) : '—'} | mult ${mult}`
      );
    });
  }

  lines.push(
    '',
    '## What I want from you',
    '1. **Why might these specific unsold lines still be sitting?** Tie hypotheses to the data (purchase price vs typical band, category mix, age, anything obvious from names).',
    '2. **What mistakes might I have made** buying or pricing these (be direct)?',
    '3. **Should I buy this brand again?** Under what strict rules (categories, max buy price, avoid list), or should I pause the brand?',
    '4. **Concrete next steps** (e.g. reprice band, bundle, move platform, donate/write-off) where justified.',
    '',
    'Tone: concise, blunt, unsentimental. If the data is thin, say so and still answer from what exists. No “great job” or empty reassurance.'
  );

  return lines.join('\n');
}

function parseOptionalBrandText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  return String(v);
}

/** Normalize GET /api/brands payloads (handles string ids from pg, alternate keys, top-level array). */
function parseBrandsApiPayload(data: unknown): BrandRow[] {
  let raw: unknown[] = [];
  if (Array.isArray(data)) {
    raw = data;
  } else if (data && typeof data === 'object' && Array.isArray((data as { rows?: unknown }).rows)) {
    raw = (data as { rows: unknown[] }).rows;
  }
  const out: BrandRow[] = [];
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
    const things_to_buy = parseOptionalBrandText(r.things_to_buy);
    const things_to_avoid = parseOptionalBrandText(r.things_to_avoid);
    const mcRaw = r.menswear_category_id;
    let menswear_category_id: number | null = null;
    if (mcRaw !== null && mcRaw !== undefined && mcRaw !== '') {
      const n = typeof mcRaw === 'number' ? mcRaw : parseInt(String(mcRaw).trim(), 10);
      if (Number.isFinite(n) && n >= 1) menswear_category_id = n;
    }
    out.push({ id: idNum, brand_name, brand_website, things_to_buy, things_to_avoid, menswear_category_id });
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

type BrandTagQualityTier = 'good' | 'average' | 'poor';

type BrandTagQualitySortOrder = 'best_first' | 'bad_first';

function parseBrandTagQualityTier(raw: unknown): BrandTagQualityTier {
  if (raw === 'good' || raw === 'average' || raw === 'poor') return raw;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'good' || s === 'average' || s === 'poor') return s;
  }
  return 'average';
}

/** Display only (Best / Average / Poor). DB values stay good | average | poor. */
function brandTagQualityStars(tier: BrandTagQualityTier): string {
  switch (tier) {
    case 'good':
      return '⭐⭐⭐⭐⭐';
    case 'poor':
      return '⭐';
    default:
      return '⭐⭐⭐';
  }
}

function brandTagQualityAriaLabel(tier: BrandTagQualityTier): string {
  switch (tier) {
    case 'good':
      return 'Best quality, 5 stars';
    case 'poor':
      return 'Poor quality, 1 star';
    default:
      return 'Average quality, 3 stars';
  }
}

function qualityTierSortRank(tier: BrandTagQualityTier, badFirst: boolean): number {
  const base = tier === 'good' ? 0 : tier === 'average' ? 1 : 2;
  return badFirst ? 2 - base : base;
}

interface BrandTagImageRow {
  id: number;
  brand_id: number;
  storage_path: string;
  caption: string | null;
  sort_order: number;
  content_type: string | null;
  image_kind: BrandTagImageKind;
  quality_tier: BrandTagQualityTier;
  created_at: string;
  updated_at: string;
  public_url: string | null;
}

function normalizeBrandTagImageRow(raw: unknown): BrandTagImageRow {
  const r = raw as Record<string, unknown>;
  const kindRaw = r.image_kind;
  const image_kind: BrandTagImageKind =
    kindRaw === 'fake_check' || kindRaw === 'fake' ? 'fake_check' : 'tag';
  const base = r as unknown as BrandTagImageRow;
  const qtRaw = r.quality_tier ?? r.qualityTier;
  return {
    ...base,
    image_kind,
    quality_tier: parseBrandTagQualityTier(qtRaw),
  };
}

function sortBrandTagImages(
  rows: BrandTagImageRow[],
  qualityOrder: BrandTagQualitySortOrder
): BrandTagImageRow[] {
  const badFirst = qualityOrder === 'bad_first';
  return [...rows].sort((a, b) => {
    const fa = a.image_kind === 'fake_check' ? 1 : 0;
    const fb = b.image_kind === 'fake_check' ? 1 : 0;
    if (fa !== fb) return fa - fb;
    const qa = qualityTierSortRank(a.quality_tier, badFirst);
    const qb = qualityTierSortRank(b.quality_tier, badFirst);
    if (qa !== qb) return qa - qb;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });
}

function BrandTagQualityFilterIcon(): React.ReactElement {
  return (
    <svg
      className="brand-tag-quality-filter-svg"
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

const Research: React.FC = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const brandQueryParam = searchParams.get('brand');

  const researchTab = useMemo<'brand' | 'offline' | 'ai' | 'menswear-categories'>(() => {
    const t = searchParams.get('tab');
    if (t === 'offline' || t === 'ai' || t === 'menswear-categories') return t;
    return 'brand';
  }, [searchParams]);

  /** When on menswear tab, category detail comes from `?menswearCategoryId=` (full reload on list pick). */
  const menswearCategoryIdFromUrl = useMemo(() => {
    if (researchTab !== 'menswear-categories') return null;
    const raw = searchParams.get('menswearCategoryId')?.trim();
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }, [researchTab, searchParams]);

  const setResearchTab = useCallback(
    (tab: 'brand' | 'offline' | 'ai' | 'menswear-categories') => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'brand') {
            next.delete('tab');
          } else {
            next.set('tab', tab);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  /** Full navigation: drops `brand`, `menswearCategoryId`, etc. — menswear category list only. */
  const goToMenswearCategoriesTab = useCallback(() => {
    const qs = new URLSearchParams();
    qs.set('tab', 'menswear-categories');
    window.location.assign(`${location.pathname}?${qs.toString()}`);
  }, [location.pathname]);

  const openMenswearCategoryInUrl = useCallback(
    (categoryId: number) => {
      const qs = new URLSearchParams();
      qs.set('tab', 'menswear-categories');
      qs.set('menswearCategoryId', String(categoryId));
      window.location.assign(`${location.pathname}?${qs.toString()}`);
    },
    [location.pathname]
  );

  const openBrandResearchInUrl = useCallback(
    (brandId: number) => {
      const qs = new URLSearchParams();
      qs.set('brand', String(brandId));
      window.location.assign(`${location.pathname}?${qs.toString()}`);
    },
    [location.pathname]
  );

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

  type MenswearCategoryRow = {
    id: number;
    name: string;
    description: string | null;
    notes: string | null;
  };

  type MenswearCategoryBrandRow = {
    id: number;
    brand_name: string;
    total_sales: string | number;
    /** Period-filtered sold line count from sales-by-brand; optional on /brands rows */
    sold_count?: number;
  };

  type MenswearCategorySalesRow = {
    category_id: number;
    category_name: string;
    total_sales: string | number;
    /** Period-filtered sold line count from sales-by-category */
    sold_count?: number;
  };

  type MenswearCategoryInventoryRow = {
    category_id: number;
    category_name: string;
    unsold_count: number;
  };

  type MenswearBrandInventoryRow = {
    brand_id: number;
    brand_name: string;
    unsold_count: number;
  };

  type MenswearSalesPeriod = 'last_12_months' | '2026' | '2025';

  const [menswearCategories, setMenswearCategories] = useState<MenswearCategoryRow[]>([]);
  const [menswearCategoriesLoading, setMenswearCategoriesLoading] = useState(false);
  const [menswearCategoriesError, setMenswearCategoriesError] = useState<string | null>(null);
  const [menswearCategoryBrands, setMenswearCategoryBrands] = useState<MenswearCategoryBrandRow[]>([]);
  const [menswearCategoryBrandsLoading, setMenswearCategoryBrandsLoading] = useState(false);
  const [menswearCategoryBrandsError, setMenswearCategoryBrandsError] = useState<string | null>(null);
  const [menswearBrandSort, setMenswearBrandSort] = useState<'name' | 'total_sales'>('total_sales');
  const [menswearBrandSortMenuOpen, setMenswearBrandSortMenuOpen] = useState(false);
  const menswearBrandSortMenuRef = useRef<HTMLDivElement>(null);
  const [menswearCategoryBrandsRefreshTick, setMenswearCategoryBrandsRefreshTick] = useState(0);
  const [menswearAddBrandOpen, setMenswearAddBrandOpen] = useState(false);
  const [menswearAddBrandSearch, setMenswearAddBrandSearch] = useState('');
  const [menswearAddBrandSaving, setMenswearAddBrandSaving] = useState(false);
  const [menswearAddBrandError, setMenswearAddBrandError] = useState<string | null>(null);
  const [menswearAskAiBusy, setMenswearAskAiBusy] = useState(false);
  const [menswearAskAiHint, setMenswearAskAiHint] = useState<string | null>(null);
  const [menswearSalesPeriod, setMenswearSalesPeriod] = useState<MenswearSalesPeriod>('last_12_months');
  const [menswearCategorySalesRows, setMenswearCategorySalesRows] = useState<MenswearCategorySalesRow[]>(
    []
  );
  /** Period-filtered sold revenue by brand when a menswear category is selected (pie chart). */
  const [menswearBrandSalesRows, setMenswearBrandSalesRows] = useState<MenswearCategoryBrandRow[]>([]);
  const [menswearCategorySalesLoading, setMenswearCategorySalesLoading] = useState(false);
  const [menswearCategorySalesError, setMenswearCategorySalesError] = useState<string | null>(null);
  const [menswearCategoryInventoryRows, setMenswearCategoryInventoryRows] = useState<
    MenswearCategoryInventoryRow[]
  >([]);
  const [menswearCategoryInventoryLoading, setMenswearCategoryInventoryLoading] = useState(false);
  const [menswearCategoryInventoryError, setMenswearCategoryInventoryError] = useState<string | null>(
    null
  );
  const [menswearBrandInventoryRows, setMenswearBrandInventoryRows] = useState<MenswearBrandInventoryRow[]>(
    []
  );
  const [menswearBrandInventoryLoading, setMenswearBrandInventoryLoading] = useState(false);
  const [menswearBrandInventoryError, setMenswearBrandInventoryError] = useState<string | null>(null);

  const [brandsWithWebsites, setBrandsWithWebsites] = useState<BrandRow[]>([]);

  const [brandTagBrandId, setBrandTagBrandId] = useState<number | ''>('');
  const [brandTabQuery, setBrandTabQuery] = useState('');
  const [brandTabTypeaheadOpen, setBrandTabTypeaheadOpen] = useState(false);
  const [brandCreateOpen, setBrandCreateOpen] = useState(false);
  const [brandCreateName, setBrandCreateName] = useState('');
  const [brandCreateBusy, setBrandCreateBusy] = useState(false);
  const [brandCreateError, setBrandCreateError] = useState<string | null>(null);
  const [brandTagImages, setBrandTagImages] = useState<BrandTagImageRow[]>([]);
  const [brandTagLoading, setBrandTagLoading] = useState(false);
  const [brandTagError, setBrandTagError] = useState<string | null>(null);
  /** Set when API reports storageConfigured: false (usually missing Supabase env on production API). */
  const [brandTagStorageWarning, setBrandTagStorageWarning] = useState<string | null>(null);
  const [brandTagUploading, setBrandTagUploading] = useState(false);
  const [brandTagCaption, setBrandTagCaption] = useState('');
  const [brandTagNewImageKind, setBrandTagNewImageKind] = useState<BrandTagImageKind>('tag');
  const [brandTagEditingId, setBrandTagEditingId] = useState<number | null>(null);
  const [brandTagEditCaption, setBrandTagEditCaption] = useState('');
  const [brandTagEditKind, setBrandTagEditKind] = useState<BrandTagImageKind>('tag');
  const [brandTagEditQuality, setBrandTagEditQuality] = useState<BrandTagQualityTier>('average');
  const [brandTagSaving, setBrandTagSaving] = useState(false);
  const [brandTagQualitySort, setBrandTagQualitySort] = useState<BrandTagQualitySortOrder>('best_first');
  const [brandTagQualityMenuOpen, setBrandTagQualityMenuOpen] = useState(false);
  const brandTagQualityMenuRef = useRef<HTMLDivElement>(null);
  const [brandTagAddPanelOpen, setBrandTagAddPanelOpen] = useState(false);
  /** When Add info panel is open: choose sub-flow, then image upload or brand info form. */
  const [brandTagAddSubMode, setBrandTagAddSubMode] = useState<'pick' | 'image' | 'info'>('pick');
  const [brandWebsiteUrlDraft, setBrandWebsiteUrlDraft] = useState('');
  const [brandBuyingNotesBuyDraft, setBrandBuyingNotesBuyDraft] = useState('');
  const [brandBuyingNotesAvoidDraft, setBrandBuyingNotesAvoidDraft] = useState('');
  const [brandBrandInfoSaving, setBrandBrandInfoSaving] = useState(false);
  const [brandRefLinks, setBrandRefLinks] = useState<BrandRefLinkRow[]>([]);
  const [brandRefLinksLoading, setBrandRefLinksLoading] = useState(false);
  const [brandRefLinksError, setBrandRefLinksError] = useState<string | null>(null);
  const [brandRefLinksAddOpen, setBrandRefLinksAddOpen] = useState(false);
  const [brandRefLinkUrlDraft, setBrandRefLinkUrlDraft] = useState('');
  const [brandRefLinkTextDraft, setBrandRefLinkTextDraft] = useState('');
  const [brandRefLinksSaving, setBrandRefLinksSaving] = useState(false);
  const [brandsApiError, setBrandsApiError] = useState<string | null>(null);
  const [brandsLoaded, setBrandsLoaded] = useState(false);
  /** Shown at top when fetch fails (e.g. ERR_CONNECTION_REFUSED — backend not on :5003). */
  const [researchApiOfflineMessage, setResearchApiOfflineMessage] = useState<string | null>(null);

  const [brandStockSummary, setBrandStockSummary] = useState<BrandStockSummaryPayload | null>(null);
  const [brandStockSummaryLoading, setBrandStockSummaryLoading] = useState(false);
  const [brandStockSummaryError, setBrandStockSummaryError] = useState<string | null>(null);
  const [brandStockSummaryPeriod, setBrandStockSummaryPeriod] =
    useState<BrandStockSummaryPeriod>('all');
  const [brandStockPeriodMenuOpen, setBrandStockPeriodMenuOpen] = useState(false);
  const brandStockPeriodMenuRef = useRef<HTMLDivElement>(null);

  const [ebaySoldItems, setEbaySoldItems] = useState<EbaySoldItemRow[]>([]);
  const [ebaySoldLoading, setEbaySoldLoading] = useState(false);
  const [ebaySoldError, setEbaySoldError] = useState<string | null>(null);
  /** Shown when cache is missing/stale until a live sync completes. */
  const [ebaySoldNoCacheNotice, setEbaySoldNoCacheNotice] = useState<string | null>(null);
  const [ebaySoldRefreshing, setEbaySoldRefreshing] = useState(false);

  const [brandExamplePricing, setBrandExamplePricing] = useState<BrandExamplePricingRow[]>([]);
  const [brandExamplePricingLoading, setBrandExamplePricingLoading] = useState(false);
  const [brandExamplePricingError, setBrandExamplePricingError] = useState<string | null>(null);
  const [brandExamplePricingAddOpen, setBrandExamplePricingAddOpen] = useState(false);
  const [brandExamplePricingItemDraft, setBrandExamplePricingItemDraft] = useState('');
  const [brandExamplePricingPriceDraft, setBrandExamplePricingPriceDraft] = useState('');
  const [brandExamplePricingSaving, setBrandExamplePricingSaving] = useState(false);
  const [brandExamplePricingDeletingId, setBrandExamplePricingDeletingId] = useState<number | null>(null);

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

  useEffect(() => {
    if (researchTab !== 'menswear-categories') {
      setMenswearBrandSort('total_sales');
      setMenswearAddBrandOpen(false);
      setMenswearAddBrandSearch('');
      setMenswearAddBrandError(null);
      setMenswearAskAiHint(null);
      setMenswearAskAiBusy(false);
      setMenswearCategoryInventoryRows([]);
      setMenswearCategoryInventoryError(null);
      setMenswearCategoryInventoryLoading(false);
      setMenswearBrandInventoryRows([]);
      setMenswearBrandInventoryError(null);
      setMenswearBrandInventoryLoading(false);
      setMenswearBrandSortMenuOpen(false);
    }
  }, [researchTab]);

  useEffect(() => {
    if (menswearCategoryIdFromUrl === null) {
      setMenswearAddBrandOpen(false);
      setMenswearAddBrandSearch('');
      setMenswearAddBrandError(null);
      setMenswearBrandSortMenuOpen(false);
    }
  }, [menswearCategoryIdFromUrl]);

  useEffect(() => {
    if (!menswearBrandSortMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const el = menswearBrandSortMenuRef.current;
      if (el && !el.contains(e.target as Node)) {
        setMenswearBrandSortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [menswearBrandSortMenuOpen]);

  useEffect(() => {
    if (researchTab !== 'menswear-categories') return;
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearCategoriesLoading(true);
      setMenswearCategoriesError(null);
      try {
        const res = await fetch(apiUrl('/api/menswear-categories'), { signal: ac.signal });
        const data = await readJsonResponse<{ rows?: MenswearCategoryRow[] }>(res, 'menswear-categories');
        if (cancelled) return;
        const rows = Array.isArray(data.rows) ? data.rows : [];
        setMenswearCategories(
          rows.map((r) => ({
            id: Number(r.id),
            name: String(r.name ?? ''),
            description: r.description != null ? String(r.description) : null,
            notes: r.notes != null ? String(r.notes) : null,
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearCategories([]);
        setMenswearCategoriesError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearCategoriesLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab]);

  useEffect(() => {
    if (researchTab !== 'menswear-categories' || menswearCategoryIdFromUrl == null) {
      setMenswearCategoryBrands([]);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearCategoryBrandsLoading(true);
      setMenswearCategoryBrandsError(null);
      try {
        const params = new URLSearchParams({ sort: menswearBrandSort });
        const res = await fetch(
          apiUrl(`/api/menswear-categories/${menswearCategoryIdFromUrl}/brands?${params}`),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{ rows?: MenswearCategoryBrandRow[] }>(
          res,
          'menswear-category-brands'
        );
        if (cancelled) return;
        setMenswearCategoryBrands(Array.isArray(data.rows) ? data.rows : []);
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearCategoryBrands([]);
        setMenswearCategoryBrandsError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearCategoryBrandsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, menswearCategoryIdFromUrl, menswearBrandSort, menswearCategoryBrandsRefreshTick]);

  useEffect(() => {
    if (researchTab !== 'menswear-categories') {
      setMenswearCategorySalesRows([]);
      setMenswearBrandSalesRows([]);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearCategorySalesLoading(true);
      setMenswearCategorySalesError(null);
      try {
        const params = new URLSearchParams({ period: menswearSalesPeriod });
        if (menswearCategoryIdFromUrl == null) {
          setMenswearBrandSalesRows([]);
          const res = await fetch(apiUrl(`/api/menswear-categories/sales-by-category?${params}`), {
            signal: ac.signal,
          });
          const data = await readJsonResponse<{ rows?: MenswearCategorySalesRow[] }>(
            res,
            'menswear-category-sales'
          );
          if (cancelled) return;
          const raw = Array.isArray(data.rows) ? data.rows : [];
          setMenswearCategorySalesRows(
            raw.map((r) => ({
              category_id: Number(r.category_id),
              category_name: String(r.category_name ?? '—'),
              total_sales: r.total_sales,
              sold_count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
            }))
          );
        } else {
          setMenswearCategorySalesRows([]);
          const res = await fetch(
            apiUrl(`/api/menswear-categories/${menswearCategoryIdFromUrl}/sales-by-brand?${params}`),
            { signal: ac.signal }
          );
          const data = await readJsonResponse<{ rows?: MenswearCategoryBrandRow[] }>(
            res,
            'menswear-category-brand-sales'
          );
          if (cancelled) return;
          const raw = Array.isArray(data.rows) ? data.rows : [];
          setMenswearBrandSalesRows(
            raw.map((r) => ({
              id: Number(r.id),
              brand_name: String(r.brand_name ?? '—'),
              total_sales: r.total_sales,
              sold_count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
            }))
          );
        }
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearCategorySalesRows([]);
        setMenswearBrandSalesRows([]);
        setMenswearCategorySalesError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearCategorySalesLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    researchTab,
    menswearSalesPeriod,
    menswearCategoryIdFromUrl,
    menswearCategoryBrandsRefreshTick,
  ]);

  useEffect(() => {
    if (researchTab !== 'menswear-categories' || menswearCategoryIdFromUrl !== null) {
      setMenswearCategoryInventoryRows([]);
      setMenswearCategoryInventoryError(null);
      setMenswearCategoryInventoryLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearCategoryInventoryLoading(true);
      setMenswearCategoryInventoryError(null);
      try {
        const res = await fetch(apiUrl('/api/menswear-categories/inventory-by-category'), {
          signal: ac.signal,
        });
        const data = await readJsonResponse<{ rows?: MenswearCategoryInventoryRow[] }>(
          res,
          'menswear-inventory-by-category'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setMenswearCategoryInventoryRows(
          raw.map((r) => ({
            category_id: Number(r.category_id),
            category_name: String(r.category_name ?? '—'),
            unsold_count: Math.max(0, Math.floor(Number(r.unsold_count) || 0)),
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearCategoryInventoryRows([]);
        setMenswearCategoryInventoryError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearCategoryInventoryLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, menswearCategoryIdFromUrl, menswearCategoryBrandsRefreshTick]);

  useEffect(() => {
    if (researchTab !== 'menswear-categories' || menswearCategoryIdFromUrl == null) {
      setMenswearBrandInventoryRows([]);
      setMenswearBrandInventoryError(null);
      setMenswearBrandInventoryLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearBrandInventoryLoading(true);
      setMenswearBrandInventoryError(null);
      try {
        const res = await fetch(
          apiUrl(`/api/menswear-categories/${menswearCategoryIdFromUrl}/inventory-by-brand`),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{ rows?: MenswearBrandInventoryRow[] }>(
          res,
          'menswear-inventory-by-brand'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setMenswearBrandInventoryRows(
          raw.map((r) => ({
            brand_id: Number(r.brand_id),
            brand_name: String(r.brand_name ?? '—'),
            unsold_count: Math.max(0, Math.floor(Number(r.unsold_count) || 0)),
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearBrandInventoryRows([]);
        setMenswearBrandInventoryError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearBrandInventoryLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, menswearCategoryIdFromUrl, menswearCategoryBrandsRefreshTick]);

  const menswearSalesPieModel = useMemo(() => {
    if (menswearCategoryIdFromUrl == null) {
      const sliceRows = menswearCategorySalesRows.map((r) => {
        const n =
          typeof r.total_sales === 'number' ? r.total_sales : parseFloat(String(r.total_sales));
        return {
          categoryId: Number(r.category_id),
          label: String(r.category_name ?? '—'),
          totalSales: Number.isFinite(n) && n > 0 ? n : 0,
        };
      });
      const rows = sliceRows.filter((r) => r.totalSales > 0);
      if (rows.length === 0) return { data: null as null, sliceCategoryIds: null as number[] | null };
      const palette = [
        'rgba(59, 130, 246, 0.86)',
        'rgba(16, 185, 129, 0.86)',
        'rgba(245, 158, 11, 0.86)',
        'rgba(236, 72, 153, 0.86)',
        'rgba(139, 92, 246, 0.86)',
        'rgba(239, 68, 68, 0.86)',
        'rgba(14, 165, 233, 0.86)',
        'rgba(34, 197, 94, 0.86)',
        'rgba(250, 204, 21, 0.86)',
        'rgba(244, 114, 182, 0.86)',
      ];
      return {
        data: {
          labels: rows.map((r) => r.label),
          datasets: [
            {
              data: rows.map((r) => r.totalSales),
              backgroundColor: rows.map((_, i) => palette[i % palette.length]),
              borderColor: 'rgba(14, 18, 26, 0.9)',
              borderWidth: 1.5,
            },
          ],
        },
        sliceCategoryIds: rows.map((r) => r.categoryId),
      };
    }

    const sliceRows = menswearBrandSalesRows.map((b) => {
      const n =
        typeof b.total_sales === 'number' ? b.total_sales : parseFloat(String(b.total_sales));
      return {
        label: String(b.brand_name ?? '—'),
        totalSales: Number.isFinite(n) && n > 0 ? n : 0,
      };
    });
    const rows = sliceRows.filter((r) => r.totalSales > 0);
    if (rows.length === 0) return { data: null as null, sliceCategoryIds: null as number[] | null };
    const palette = [
      'rgba(59, 130, 246, 0.86)',
      'rgba(16, 185, 129, 0.86)',
      'rgba(245, 158, 11, 0.86)',
      'rgba(236, 72, 153, 0.86)',
      'rgba(139, 92, 246, 0.86)',
      'rgba(239, 68, 68, 0.86)',
      'rgba(14, 165, 233, 0.86)',
      'rgba(34, 197, 94, 0.86)',
      'rgba(250, 204, 21, 0.86)',
      'rgba(244, 114, 182, 0.86)',
    ];
    return {
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            data: rows.map((r) => r.totalSales),
            backgroundColor: rows.map((_, i) => palette[i % palette.length]),
            borderColor: 'rgba(14, 18, 26, 0.9)',
            borderWidth: 1.5,
          },
        ],
      },
      sliceCategoryIds: null as number[] | null,
    };
  }, [menswearCategoryIdFromUrl, menswearCategorySalesRows, menswearBrandSalesRows]);

  const menswearInventoryPieModel = useMemo(() => {
    if (menswearCategoryIdFromUrl != null) {
      return { data: null as null, sliceCategoryIds: null as number[] | null };
    }
    const rows = menswearCategoryInventoryRows
      .map((r) => ({
        categoryId: Number(r.category_id),
        label: String(r.category_name ?? '—'),
        count: Math.max(0, r.unsold_count),
      }))
      .filter((r) => r.count > 0);
    if (rows.length === 0) return { data: null as null, sliceCategoryIds: null as number[] | null };
    const palette = [
      'rgba(245, 158, 11, 0.88)',
      'rgba(59, 130, 246, 0.88)',
      'rgba(16, 185, 129, 0.88)',
      'rgba(236, 72, 153, 0.88)',
      'rgba(139, 92, 246, 0.88)',
      'rgba(239, 68, 68, 0.88)',
      'rgba(14, 165, 233, 0.88)',
      'rgba(34, 197, 94, 0.88)',
      'rgba(250, 204, 21, 0.88)',
      'rgba(244, 114, 182, 0.88)',
    ];
    return {
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            data: rows.map((r) => r.count),
            backgroundColor: rows.map((_, i) => palette[i % palette.length]),
            borderColor: 'rgba(14, 18, 26, 0.9)',
            borderWidth: 1.5,
          },
        ],
      },
      sliceCategoryIds: rows.map((r) => r.categoryId),
    };
  }, [menswearCategoryIdFromUrl, menswearCategoryInventoryRows]);

  const menswearCategoryItemsSoldPieModel = useMemo(() => {
    if (menswearCategoryIdFromUrl != null) {
      return { data: null as null, sliceCategoryIds: null as number[] | null };
    }
    const rows = menswearCategorySalesRows
      .map((r) => ({
        categoryId: Number(r.category_id),
        label: String(r.category_name ?? '—'),
        count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
      }))
      .filter((r) => r.count > 0)
      .sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
      );
    if (rows.length === 0) return { data: null as null, sliceCategoryIds: null as number[] | null };
    const palette = [
      'rgba(34, 197, 94, 0.88)',
      'rgba(251, 191, 36, 0.88)',
      'rgba(56, 189, 248, 0.88)',
      'rgba(167, 139, 250, 0.88)',
      'rgba(251, 113, 133, 0.88)',
      'rgba(52, 211, 153, 0.88)',
      'rgba(250, 204, 21, 0.88)',
      'rgba(94, 234, 212, 0.88)',
      'rgba(196, 181, 253, 0.88)',
      'rgba(253, 186, 116, 0.88)',
    ];
    return {
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            data: rows.map((r) => r.count),
            backgroundColor: rows.map((_, i) => palette[i % palette.length]),
            borderColor: 'rgba(14, 18, 26, 0.9)',
            borderWidth: 1.5,
          },
        ],
      },
      sliceCategoryIds: rows.map((r) => r.categoryId),
    };
  }, [menswearCategoryIdFromUrl, menswearCategorySalesRows]);

  const menswearBrandInventoryPieModel = useMemo(() => {
    if (menswearCategoryIdFromUrl == null) {
      return { data: null as null, sliceBrandIds: null as number[] | null };
    }
    const rows = menswearBrandInventoryRows
      .map((r) => ({
        brandId: Number(r.brand_id),
        label: String(r.brand_name ?? '—'),
        count: Math.max(0, r.unsold_count),
      }))
      .filter((r) => r.count > 0);
    if (rows.length === 0) return { data: null as null, sliceBrandIds: null as number[] | null };
    const palette = [
      'rgba(168, 85, 247, 0.88)',
      'rgba(34, 211, 238, 0.88)',
      'rgba(251, 146, 60, 0.88)',
      'rgba(52, 211, 153, 0.88)',
      'rgba(244, 114, 182, 0.88)',
      'rgba(96, 165, 250, 0.88)',
      'rgba(250, 204, 21, 0.88)',
      'rgba(248, 113, 113, 0.88)',
      'rgba(129, 140, 248, 0.88)',
      'rgba(45, 212, 191, 0.88)',
    ];
    return {
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            data: rows.map((r) => r.count),
            backgroundColor: rows.map((_, i) => palette[i % palette.length]),
            borderColor: 'rgba(14, 18, 26, 0.9)',
            borderWidth: 1.5,
          },
        ],
      },
      sliceBrandIds: rows.map((r) => r.brandId),
    };
  }, [menswearCategoryIdFromUrl, menswearBrandInventoryRows]);

  const menswearBrandItemsSoldPieModel = useMemo(() => {
    if (menswearCategoryIdFromUrl == null) {
      return { data: null as null, sliceBrandIds: null as number[] | null };
    }
    const rows = menswearBrandSalesRows
      .map((r) => ({
        brandId: Number(r.id),
        label: String(r.brand_name ?? '—'),
        count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
      }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    if (rows.length === 0) return { data: null as null, sliceBrandIds: null as number[] | null };
    const palette = [
      'rgba(34, 197, 94, 0.88)',
      'rgba(251, 191, 36, 0.88)',
      'rgba(56, 189, 248, 0.88)',
      'rgba(167, 139, 250, 0.88)',
      'rgba(251, 113, 133, 0.88)',
      'rgba(52, 211, 153, 0.88)',
      'rgba(250, 204, 21, 0.88)',
      'rgba(94, 234, 212, 0.88)',
      'rgba(196, 181, 253, 0.88)',
      'rgba(253, 186, 116, 0.88)',
    ];
    return {
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            data: rows.map((r) => r.count),
            backgroundColor: rows.map((_, i) => palette[i % palette.length]),
            borderColor: 'rgba(14, 18, 26, 0.9)',
            borderWidth: 1.5,
          },
        ],
      },
      sliceBrandIds: rows.map((r) => r.brandId),
    };
  }, [menswearCategoryIdFromUrl, menswearBrandSalesRows]);

  const menswearSalesPieChartOptions = useMemo((): ChartOptions<'pie'> => {
    const sliceIds = menswearSalesPieModel.sliceCategoryIds;
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!sliceIds?.length || !elements?.length) return;
        const idx = elements[0]?.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
        const id = sliceIds[idx];
        if (id != null && Number.isFinite(id) && id >= 1) openMenswearCategoryInUrl(id);
      },
      onHover: (evt, elements) => {
        const t = evt.native?.target;
        if (t instanceof HTMLElement) {
          t.style.cursor = sliceIds && elements.length > 0 ? 'pointer' : 'default';
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: 'rgba(255, 248, 226, 0.85)', boxWidth: 12, boxHeight: 12 },
          onClick: (_e, legendItem) => {
            if (!sliceIds?.length) return;
            const idx = legendItem.index;
            if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
            const id = sliceIds[idx];
            if (id != null && Number.isFinite(id) && id >= 1) openMenswearCategoryInUrl(id);
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.label}: ${formatResearchCurrency(
                typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw)
              )}`,
          },
        },
      },
    };
  }, [menswearSalesPieModel.sliceCategoryIds, openMenswearCategoryInUrl]);

  const menswearInventoryPieChartOptions = useMemo((): ChartOptions<'pie'> => {
    const sliceIds = menswearInventoryPieModel.sliceCategoryIds;
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!sliceIds?.length || !elements?.length) return;
        const idx = elements[0]?.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
        const id = sliceIds[idx];
        if (id != null && Number.isFinite(id) && id >= 1) openMenswearCategoryInUrl(id);
      },
      onHover: (evt, elements) => {
        const t = evt.native?.target;
        if (t instanceof HTMLElement) {
          t.style.cursor = sliceIds && elements.length > 0 ? 'pointer' : 'default';
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: 'rgba(255, 248, 226, 0.85)', boxWidth: 12, boxHeight: 12 },
          onClick: (_e, legendItem) => {
            if (!sliceIds?.length) return;
            const idx = legendItem.index;
            if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
            const id = sliceIds[idx];
            if (id != null && Number.isFinite(id) && id >= 1) openMenswearCategoryInUrl(id);
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const n = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
              const u = Number.isFinite(n) ? n : 0;
              return `${ctx.label}: ${u} unsold`;
            },
          },
        },
      },
    };
  }, [menswearInventoryPieModel.sliceCategoryIds, openMenswearCategoryInUrl]);

  const menswearCategoryItemsSoldPieChartOptions = useMemo((): ChartOptions<'pie'> => {
    const sliceIds = menswearCategoryItemsSoldPieModel.sliceCategoryIds;
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!sliceIds?.length || !elements?.length) return;
        const idx = elements[0]?.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
        const id = sliceIds[idx];
        if (id != null && Number.isFinite(id) && id >= 1) openMenswearCategoryInUrl(id);
      },
      onHover: (evt, elements) => {
        const t = evt.native?.target;
        if (t instanceof HTMLElement) {
          t.style.cursor = sliceIds && elements.length > 0 ? 'pointer' : 'default';
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: 'rgba(255, 248, 226, 0.85)', boxWidth: 12, boxHeight: 12 },
          onClick: (_e, legendItem) => {
            if (!sliceIds?.length) return;
            const idx = legendItem.index;
            if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
            const id = sliceIds[idx];
            if (id != null && Number.isFinite(id) && id >= 1) openMenswearCategoryInUrl(id);
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const n = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
              const u = Number.isFinite(n) ? n : 0;
              return `${ctx.label}: ${u} sold`;
            },
          },
        },
      },
    };
  }, [menswearCategoryItemsSoldPieModel.sliceCategoryIds, openMenswearCategoryInUrl]);

  const menswearBrandInventoryPieChartOptions = useMemo((): ChartOptions<'pie'> => {
    const sliceIds = menswearBrandInventoryPieModel.sliceBrandIds;
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!sliceIds?.length || !elements?.length) return;
        const idx = elements[0]?.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
        const id = sliceIds[idx];
        if (id != null && Number.isFinite(id) && id >= 1) openBrandResearchInUrl(id);
      },
      onHover: (evt, elements) => {
        const t = evt.native?.target;
        if (t instanceof HTMLElement) {
          t.style.cursor = sliceIds && elements.length > 0 ? 'pointer' : 'default';
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: 'rgba(255, 248, 226, 0.85)', boxWidth: 12, boxHeight: 12 },
          onClick: (_e, legendItem) => {
            if (!sliceIds?.length) return;
            const idx = legendItem.index;
            if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
            const id = sliceIds[idx];
            if (id != null && Number.isFinite(id) && id >= 1) openBrandResearchInUrl(id);
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const n = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
              const u = Number.isFinite(n) ? n : 0;
              return `${ctx.label}: ${u} unsold`;
            },
          },
        },
      },
    };
  }, [menswearBrandInventoryPieModel.sliceBrandIds, openBrandResearchInUrl]);

  const menswearBrandItemsSoldPieChartOptions = useMemo((): ChartOptions<'pie'> => {
    const sliceIds = menswearBrandItemsSoldPieModel.sliceBrandIds;
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!sliceIds?.length || !elements?.length) return;
        const idx = elements[0]?.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
        const id = sliceIds[idx];
        if (id != null && Number.isFinite(id) && id >= 1) openBrandResearchInUrl(id);
      },
      onHover: (evt, elements) => {
        const t = evt.native?.target;
        if (t instanceof HTMLElement) {
          t.style.cursor = sliceIds && elements.length > 0 ? 'pointer' : 'default';
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: 'rgba(255, 248, 226, 0.85)', boxWidth: 12, boxHeight: 12 },
          onClick: (_e, legendItem) => {
            if (!sliceIds?.length) return;
            const idx = legendItem.index;
            if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
            const id = sliceIds[idx];
            if (id != null && Number.isFinite(id) && id >= 1) openBrandResearchInUrl(id);
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const n = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
              const u = Number.isFinite(n) ? n : 0;
              return `${ctx.label}: ${u} sold`;
            },
          },
        },
      },
    };
  }, [menswearBrandItemsSoldPieModel.sliceBrandIds, openBrandResearchInUrl]);

  const menswearAddBrandCandidates = useMemo(() => {
    const q = menswearAddBrandSearch.trim().toLowerCase();
    const rows = [...brandsWithWebsites];
    rows.sort((a, b) => a.brand_name.localeCompare(b.brand_name, undefined, { sensitivity: 'base' }));
    if (!q) return rows;
    return rows.filter((b) => b.brand_name.toLowerCase().includes(q));
  }, [brandsWithWebsites, menswearAddBrandSearch]);

  const assignBrandToMenswearCategory = useCallback(
    async (brandId: number) => {
      if (menswearCategoryIdFromUrl == null) return;
      setMenswearAddBrandSaving(true);
      setMenswearAddBrandError(null);
      try {
        const res = await fetch(apiUrl(`/api/brands/${brandId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ menswear_category_id: menswearCategoryIdFromUrl }),
        });
        await readJsonResponse<{ row?: BrandRow }>(res, 'brand menswear category');
        setBrandsWithWebsites((prev) =>
          prev.map((b) =>
            b.id === brandId ? { ...b, menswear_category_id: menswearCategoryIdFromUrl } : b
          )
        );
        setMenswearCategoryBrandsRefreshTick((n) => n + 1);
        setMenswearAddBrandOpen(false);
        setMenswearAddBrandSearch('');
      } catch (e) {
        setMenswearAddBrandError(friendlyApiUnreachableMessage(e));
      } finally {
        setMenswearAddBrandSaving(false);
      }
    },
    [menswearCategoryIdFromUrl]
  );

  const runMenswearAskAi = useCallback(
    async (opts: { cat: MenswearCategoryRow; brands?: MenswearCategoryBrandRow[] }) => {
      setMenswearAskAiBusy(true);
      setMenswearAskAiHint(null);
      try {
        let brands = opts.brands;
        if (!brands) {
          const params = new URLSearchParams({ sort: 'total_sales' });
          const res = await fetch(
            apiUrl(`/api/menswear-categories/${opts.cat.id}/brands?${params}`)
          );
          const data = await readJsonResponse<{ rows?: MenswearCategoryBrandRow[] }>(
            res,
            'menswear-ask-ai-brands'
          );
          brands = Array.isArray(data.rows) ? data.rows : [];
        }
        const text = buildMenswearCategoryAskAiPrompt({
          categoryName: opts.cat.name,
          categoryDescription: opts.cat.description,
          categoryNotes: opts.cat.notes,
          brands,
        });
        await copyResearchTextToClipboard(text);
        setMenswearAskAiHint('Copied to clipboard — paste into ChatGPT.');
      } catch (e) {
        setMenswearAskAiHint(friendlyApiUnreachableMessage(e));
      } finally {
        setMenswearAskAiBusy(false);
        window.setTimeout(() => setMenswearAskAiHint(null), 5000);
      }
    },
    []
  );

  const runMenswearAllCategoriesAskAi = useCallback(async () => {
    setMenswearAskAiBusy(true);
    setMenswearAskAiHint(null);
    try {
      const sorted = [...menswearCategories].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
      const text = buildMenswearAllCategoriesAskAiPrompt(sorted);
      await copyResearchTextToClipboard(text);
      setMenswearAskAiHint('Copied to clipboard — paste into ChatGPT.');
    } catch (e) {
      setMenswearAskAiHint(friendlyApiUnreachableMessage(e));
    } finally {
      setMenswearAskAiBusy(false);
      window.setTimeout(() => setMenswearAskAiHint(null), 5000);
    }
  }, [menswearCategories]);

  const runMenswearSalesInventoryAskAi = useCallback(async () => {
    if (menswearCategoryIdFromUrl != null) return;
    setMenswearAskAiBusy(true);
    setMenswearAskAiHint(null);
    try {
      const periodLabel = menswearSalesPeriodLabel(menswearSalesPeriod);
      const salesByCategory = menswearCategorySalesRows
        .map((r) => {
          const n =
            typeof r.total_sales === 'number' ? r.total_sales : parseFloat(String(r.total_sales));
          return {
            category_name: String(r.category_name ?? '—'),
            total_sales: Number.isFinite(n) ? n : 0,
          };
        })
        .filter((r) => r.total_sales > 0);
      const unsoldByCategory = [...menswearCategoryInventoryRows].map((r) => ({
        category_name: String(r.category_name ?? '—'),
        unsold_count: Math.max(0, Math.floor(Number(r.unsold_count) || 0)),
      }));
      const text = buildMenswearSalesVsInventoryAskAiPrompt({
        periodLabel,
        salesByCategory,
        unsoldByCategory,
      });
      await copyResearchTextToClipboard(text);
      setMenswearAskAiHint('Copied to clipboard — paste into ChatGPT.');
    } catch (e) {
      setMenswearAskAiHint(friendlyApiUnreachableMessage(e));
    } finally {
      setMenswearAskAiBusy(false);
      window.setTimeout(() => setMenswearAskAiHint(null), 5000);
    }
  }, [
    menswearCategoryIdFromUrl,
    menswearSalesPeriod,
    menswearCategorySalesRows,
    menswearCategoryInventoryRows,
  ]);

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

  const prevBrandTagBrandIdRef = useRef<number | ''>(brandTagBrandId);
  const brandTabInputUserEditRef = useRef(false);
  useEffect(() => {
    if (!brandsLoaded) return;
    if (prevBrandTagBrandIdRef.current === brandTagBrandId) return;
    const prev = prevBrandTagBrandIdRef.current;
    prevBrandTagBrandIdRef.current = brandTagBrandId;
    if (brandTagBrandId === '') {
      if (prev !== '' && !brandTabInputUserEditRef.current) {
        setBrandTabQuery('');
      }
      brandTabInputUserEditRef.current = false;
      return;
    }
    const b = brandsWithWebsites.find((x) => x.id === brandTagBrandId);
    if (b) setBrandTabQuery(b.brand_name);
  }, [brandsLoaded, brandTagBrandId, brandsWithWebsites]);

  useEffect(() => {
    if (brandTagBrandId !== '') {
      setBrandCreateOpen(false);
      setBrandCreateError(null);
    }
  }, [brandTagBrandId]);

  const brandTabTypeaheadList = useMemo(() => {
    const list = brandsWithWebsites;
    const q = brandTabQuery.trim().toLowerCase();
    const filtered = !q ? list : list.filter((br) => br.brand_name.toLowerCase().includes(q));
    return [...filtered].sort((a, b) =>
      a.brand_name.localeCompare(b.brand_name, undefined, { sensitivity: 'base' })
    );
  }, [brandsWithWebsites, brandTabQuery]);

  const selectBrandFromBrandTabTypeahead = useCallback(
    (b: BrandRow) => {
      brandTabInputUserEditRef.current = false;
      setBrandTabQuery(b.brand_name);
      setBrandTagBrandId(b.id);
      setBrandTabTypeaheadOpen(false);
      const next = new URLSearchParams(searchParams);
      next.set('brand', String(b.id));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const clearBrandTabSelection = useCallback(() => {
    brandTabInputUserEditRef.current = false;
    setBrandTagBrandId('');
    setBrandTabQuery('');
    setBrandTabTypeaheadOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete('brand');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleCreateBrandSubmit = useCallback(async () => {
    const name = brandCreateName.trim();
    if (!name) {
      setBrandCreateError('Enter a brand name');
      return;
    }
    setBrandCreateBusy(true);
    setBrandCreateError(null);
    try {
      const response = await fetch(apiUrl('/api/brands'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_name: name }),
      });
      const data = await readJsonResponse<{ row?: { id: number; brand_name: string } }>(
        response,
        'create brand'
      );
      const row = data.row;
      if (!row || typeof row.id !== 'number') {
        throw new Error('Invalid response from server');
      }
      const newRow: BrandRow = {
        id: row.id,
        brand_name: row.brand_name.trim(),
        brand_website: null,
        things_to_buy: null,
        things_to_avoid: null,
        menswear_category_id: null,
      };
      setBrandsWithWebsites((prev) =>
        [...prev, newRow].sort((a, b) =>
          a.brand_name.localeCompare(b.brand_name, undefined, { sensitivity: 'base' })
        )
      );
      brandTabInputUserEditRef.current = false;
      setBrandTagBrandId(newRow.id);
      setBrandTabQuery(newRow.brand_name);
      const next = new URLSearchParams(searchParams);
      next.set('brand', String(newRow.id));
      setSearchParams(next, { replace: true });
      setBrandCreateOpen(false);
      setBrandCreateName('');
      setBrandTabTypeaheadOpen(false);
    } catch (err: unknown) {
      setBrandCreateError(err instanceof Error ? err.message : 'Could not create brand');
    } finally {
      setBrandCreateBusy(false);
    }
  }, [brandCreateName, searchParams, setSearchParams]);

  useEffect(() => {
    if (researchTab !== 'brand') {
      setBrandTabTypeaheadOpen(false);
      setBrandCreateOpen(false);
    }
  }, [researchTab]);

  useEffect(() => {
    if (researchTab !== 'brand' || !brandTabTypeaheadOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBrandTabTypeaheadOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [researchTab, brandTabTypeaheadOpen]);

  useEffect(() => {
    setBrandTagEditingId(null);
    setBrandTagEditCaption('');
    setBrandTagEditKind('tag');
    setBrandTagNewImageKind('tag');
    setBrandTagAddPanelOpen(false);
    setBrandTagAddSubMode('pick');
    setBrandWebsiteUrlDraft('');
    setBrandBuyingNotesBuyDraft('');
    setBrandBuyingNotesAvoidDraft('');
    setBrandRefLinksAddOpen(false);
    setBrandRefLinkUrlDraft('');
    setBrandRefLinkTextDraft('');
    setBrandExamplePricingAddOpen(false);
    setBrandExamplePricingItemDraft('');
    setBrandExamplePricingPriceDraft('');
  }, [brandTagBrandId]);

  useEffect(() => {
    if (researchTab !== 'brand' || brandTagBrandId === '') {
      setBrandRefLinks([]);
      setBrandRefLinksError(null);
      setBrandRefLinksLoading(false);
      return;
    }

    let cancelled = false;
    const id = Number(brandTagBrandId);

    (async () => {
      setBrandRefLinksLoading(true);
      setBrandRefLinksError(null);
      try {
        const res = await fetch(apiUrl(`/api/brands/${id}/links`));
        const data = await readJsonResponse<{ rows?: BrandRefLinkRow[] }>(res, 'brand links');
        if (!cancelled) {
          const raw = Array.isArray(data.rows) ? data.rows : [];
          setBrandRefLinks(
            raw.map((r) => ({
              id: Number(r.id),
              brand_id: Number(r.brand_id),
              url: String(r.url ?? ''),
              link_text: r.link_text != null ? String(r.link_text) : null,
              created_at: String(r.created_at ?? ''),
            }))
          );
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setBrandRefLinks([]);
          setBrandRefLinksError(friendlyApiUnreachableMessage(err));
        }
      } finally {
        if (!cancelled) {
          setBrandRefLinksLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [researchTab, brandTagBrandId]);

  useEffect(() => {
    if (researchTab !== 'brand' || brandTagBrandId === '') {
      setBrandExamplePricing([]);
      setBrandExamplePricingError(null);
      setBrandExamplePricingLoading(false);
      return;
    }

    let cancelled = false;
    const id = Number(brandTagBrandId);

    (async () => {
      setBrandExamplePricingLoading(true);
      setBrandExamplePricingError(null);
      try {
        const res = await fetch(apiUrl(`/api/brands/${id}/example-pricing`));
        const data = await readJsonResponse<{ rows?: unknown[] }>(res, 'brand example pricing');
        if (!cancelled) {
          const raw = Array.isArray(data.rows) ? data.rows : [];
          setBrandExamplePricing(
            raw.map((r) => {
              const row = r as Record<string, unknown>;
              const p = row.price_gbp;
              const priceNum =
                typeof p === 'number' && Number.isFinite(p)
                  ? p
                  : parseFloat(String(p ?? ''));
              return {
                id: Number(row.id),
                brand_id: Number(row.brand_id),
                item_name: String(row.item_name ?? ''),
                price_gbp: Number.isFinite(priceNum) ? priceNum : 0,
                created_at: String(row.created_at ?? ''),
              };
            })
          );
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setBrandExamplePricing([]);
          setBrandExamplePricingError(friendlyApiUnreachableMessage(err));
        }
      } finally {
        if (!cancelled) {
          setBrandExamplePricingLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [researchTab, brandTagBrandId]);

  useEffect(() => {
    if (!brandTagBrandId) {
      setBrandTagImages([]);
      setBrandTagError(null);
      setBrandTagStorageWarning(null);
      return;
    }

    let cancelled = false;
    (async () => {
      setBrandTagLoading(true);
      setBrandTagError(null);
      setBrandTagStorageWarning(null);
      try {
        const response = await fetch(
          apiUrl(`/api/brandTagImages?brandId=${encodeURIComponent(String(brandTagBrandId))}`)
        );
        const data = await readJsonResponse<{
          rows?: unknown[];
          storageConfigured?: boolean;
        }>(response, 'brandTagImages');
        if (!cancelled) {
          if (data.storageConfigured === false) {
            setBrandTagStorageWarning(
              'Brand tag images need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on your API server (where Node runs in production), not only in the frontend build.'
            );
          }
          const rows = Array.isArray(data.rows) ? data.rows.map(normalizeBrandTagImageRow) : [];
          setBrandTagImages(rows);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setBrandTagImages([]);
          setBrandTagStorageWarning(null);
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

  useEffect(() => {
    setBrandTagQualityMenuOpen(false);
  }, [brandTagBrandId]);

  useEffect(() => {
    if (!brandTagQualityMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = brandTagQualityMenuRef.current;
      if (el && !el.contains(e.target as Node)) {
        setBrandTagQualityMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBrandTagQualityMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [brandTagQualityMenuOpen]);

  useEffect(() => {
    if (!brandStockPeriodMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = brandStockPeriodMenuRef.current;
      if (el && !el.contains(e.target as Node)) {
        setBrandStockPeriodMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBrandStockPeriodMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [brandStockPeriodMenuOpen]);

  const prevBrandStockSummaryBrandRef = useRef<number | ''>('');

  useEffect(() => {
    if (brandTagBrandId === '') {
      prevBrandStockSummaryBrandRef.current = '';
      setBrandStockSummary(null);
      setBrandStockSummaryError(null);
      setBrandStockSummaryLoading(false);
      setBrandStockSummaryPeriod('all');
      setBrandStockPeriodMenuOpen(false);
      return;
    }

    const brandSwitched = prevBrandStockSummaryBrandRef.current !== brandTagBrandId;
    if (brandSwitched) {
      prevBrandStockSummaryBrandRef.current = brandTagBrandId;
      setBrandStockPeriodMenuOpen(false);
      if (brandStockSummaryPeriod !== 'all') {
        setBrandStockSummaryPeriod('all');
        return;
      }
    }

    let cancelled = false;
    const id = brandTagBrandId;

    (async () => {
      setBrandStockSummaryLoading(true);
      setBrandStockSummaryError(null);
      try {
        const params = new URLSearchParams();
        if (brandStockSummaryPeriod !== 'all') {
          params.set('period', brandStockSummaryPeriod);
        }
        const qs = params.toString();
        const path =
          qs.length > 0
            ? `/api/brands/${id}/stock-summary?${qs}`
            : `/api/brands/${id}/stock-summary`;
        const response = await fetch(apiUrl(path));
        const raw = await readJsonResponse<unknown>(response, 'brand stock summary');
        if (!cancelled) {
          setBrandStockSummary(parseBrandStockSummaryPayload(raw));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setBrandStockSummary(null);
          setBrandStockSummaryError(friendlyApiUnreachableMessage(err));
        }
      } finally {
        if (!cancelled) {
          setBrandStockSummaryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [brandTagBrandId, brandStockSummaryPeriod]);

  useEffect(() => {
    if (researchTab !== 'brand' || brandTagBrandId === '') {
      setEbaySoldItems([]);
      setEbaySoldError(null);
      setEbaySoldNoCacheNotice(null);
      setEbaySoldLoading(false);
      return;
    }

    const br = brandsWithWebsites.find((b) => b.id === brandTagBrandId);
    const brandName = br?.brand_name?.trim() ?? '';
    if (!brandName) {
      setEbaySoldItems([]);
      setEbaySoldError(null);
      setEbaySoldNoCacheNotice(null);
      setEbaySoldLoading(false);
      return;
    }

    const brandId = Number(brandTagBrandId);
    if (!Number.isFinite(brandId)) {
      setEbaySoldItems([]);
      setEbaySoldError(null);
      setEbaySoldNoCacheNotice(null);
      setEbaySoldLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setEbaySoldLoading(true);
      setEbaySoldError(null);
      setEbaySoldNoCacheNotice(null);
      try {
        const cacheParams = new URLSearchParams({ limit: '20', days: '120' });
        const cacheRes = await fetch(
          apiUrl(`/api/brands/${brandId}/ebay-sold-cache?${cacheParams.toString()}`)
        );
        const cacheRaw = await readJsonResponse<unknown>(cacheRes, 'eBay sold cache');
        if (cancelled) return;

        const cacheParsed = parseEbaySoldCachePayload(cacheRaw);
        if (cacheParsed.cached) {
          setEbaySoldItems(cacheParsed.items);
          return;
        }

        setEbaySoldNoCacheNotice(cacheParsed.message ?? 'No Cached data');

        const syncRes = await fetch(apiUrl(`/api/brands/${brandId}/ebay-sold-cache/sync`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 20, days: 120 }),
        });
        const syncRaw = await readJsonResponse<unknown>(syncRes, 'eBay sold sync');
        if (cancelled) return;
        setEbaySoldItems(parseEbaySoldRecentItems(syncRaw));
        setEbaySoldNoCacheNotice(null);
      } catch (err: unknown) {
        if (!cancelled) {
          setEbaySoldItems([]);
          setEbaySoldNoCacheNotice(null);
          setEbaySoldError(friendlyApiUnreachableMessage(err));
        }
      } finally {
        if (!cancelled) {
          setEbaySoldLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [researchTab, brandTagBrandId, brandsWithWebsites]);

  const handleRefreshEbaySolds = async () => {
    if (brandTagBrandId === '') return;
    const brandId = Number(brandTagBrandId);
    if (!Number.isFinite(brandId)) return;

    setEbaySoldRefreshing(true);
    setEbaySoldError(null);
    setEbaySoldNoCacheNotice(null);
    try {
      const syncRes = await fetch(apiUrl(`/api/brands/${brandId}/ebay-sold-cache/sync`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20, days: 120 }),
      });
      const syncRaw = await readJsonResponse<unknown>(syncRes, 'eBay sold sync');
      setEbaySoldItems(parseEbaySoldRecentItems(syncRaw));
    } catch (err: unknown) {
      setEbaySoldError(friendlyApiUnreachableMessage(err));
    } finally {
      setEbaySoldRefreshing(false);
    }
  };

  const ebaySoldItemsDisplay = useMemo(
    () =>
      ebaySoldItems.filter((item) => {
        const n = ebaySoldPriceGbpNumber(item);
        return n != null && n > EBAY_SOLD_DISPLAY_MIN_GBP;
      }),
    [ebaySoldItems]
  );

  const handleSaveBrandRefLink = async () => {
    if (brandTagBrandId === '') return;
    const id = Number(brandTagBrandId);
    const url = brandRefLinkUrlDraft.trim();
    if (!url) {
      setBrandRefLinksError('Enter a URL.');
      return;
    }
    setBrandRefLinksSaving(true);
    setBrandRefLinksError(null);
    try {
      const res = await fetch(apiUrl(`/api/brands/${id}/links`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          linkText: brandRefLinkTextDraft.trim() || undefined,
        }),
      });
      const data = await readJsonResponse<{ row?: BrandRefLinkRow }>(res, 'brand link save');
      const row = data.row;
      if (row) {
        const normalized: BrandRefLinkRow = {
          id: Number(row.id),
          brand_id: Number(row.brand_id),
          url: String(row.url ?? ''),
          link_text: row.link_text != null ? String(row.link_text) : null,
          created_at: String(row.created_at ?? ''),
        };
        setBrandRefLinks((prev) => [normalized, ...prev]);
      }
      setBrandRefLinkUrlDraft('');
      setBrandRefLinkTextDraft('');
      setBrandRefLinksAddOpen(false);
    } catch (err: unknown) {
      setBrandRefLinksError(friendlyApiUnreachableMessage(err));
    } finally {
      setBrandRefLinksSaving(false);
    }
  };

  const handleSaveBrandExamplePricing = async () => {
    if (brandTagBrandId === '') return;
    const id = Number(brandTagBrandId);
    const itemName = brandExamplePricingItemDraft.trim();
    if (!itemName) {
      setBrandExamplePricingError('Enter an item name (e.g. Jeans).');
      return;
    }
    const priceParsed = parseFloat(brandExamplePricingPriceDraft.trim().replace(/,/g, ''));
    if (!Number.isFinite(priceParsed) || priceParsed < 0) {
      setBrandExamplePricingError('Enter a valid price (GBP).');
      return;
    }
    setBrandExamplePricingSaving(true);
    setBrandExamplePricingError(null);
    try {
      const res = await fetch(apiUrl(`/api/brands/${id}/example-pricing`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_name: itemName,
          price_gbp: priceParsed,
        }),
      });
      const data = await readJsonResponse<{ row?: Record<string, unknown> }>(
        res,
        'brand example pricing save'
      );
      const row = data.row;
      if (row) {
        const p = row.price_gbp;
        const priceNum =
          typeof p === 'number' && Number.isFinite(p) ? p : parseFloat(String(p ?? ''));
        const normalized: BrandExamplePricingRow = {
          id: Number(row.id),
          brand_id: Number(row.brand_id),
          item_name: String(row.item_name ?? ''),
          price_gbp: Number.isFinite(priceNum) ? priceNum : 0,
          created_at: String(row.created_at ?? ''),
        };
        setBrandExamplePricing((prev) => [...prev, normalized]);
      }
      setBrandExamplePricingItemDraft('');
      setBrandExamplePricingPriceDraft('');
      setBrandExamplePricingAddOpen(false);
    } catch (err: unknown) {
      setBrandExamplePricingError(friendlyApiUnreachableMessage(err));
    } finally {
      setBrandExamplePricingSaving(false);
    }
  };

  const handleDeleteBrandExamplePricing = async (rowId: number) => {
    if (brandTagBrandId === '') return;
    const brandId = Number(brandTagBrandId);
    setBrandExamplePricingDeletingId(rowId);
    setBrandExamplePricingError(null);
    try {
      const res = await fetch(apiUrl(`/api/brands/${brandId}/example-pricing/${rowId}`), {
        method: 'DELETE',
      });
      await readJsonResponse<unknown>(res, 'brand example pricing delete');
      setBrandExamplePricing((prev) => prev.filter((r) => r.id !== rowId));
    } catch (err: unknown) {
      setBrandExamplePricingError(friendlyApiUnreachableMessage(err));
    } finally {
      setBrandExamplePricingDeletingId(null);
    }
  };

  const handleCopyLongestUnsoldAskAi = async () => {
    if (!brandStockSummary || brandStockSummary.longestUnsoldItems.length === 0) return;
    const br = brandsWithWebsites.find((b) => b.id === brandTagBrandId);
    const brandName =
      br?.brand_name?.trim() || `Brand id ${brandStockSummary.brandId}`;
    const text = buildLongestUnsoldAskAiPrompt(brandName, brandStockSummary);
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.warn('Ask RI clipboard write failed:', err);
    }
  };

  const sortedBrandTagImages = useMemo(
    () => sortBrandTagImages(brandTagImages, brandTagQualitySort),
    [brandTagImages, brandTagQualitySort]
  );

  const brandStockBarChartData = useMemo(() => {
    const s = brandStockSummary;
    if (!s) return null;
    const total = s.soldCount + s.unsoldCount;
    if (total === 0) return null;
    return {
      labels: ['Sold', 'Unsold'],
      datasets: [
        {
          label: 'Items',
          data: [s.soldCount, s.unsoldCount],
          backgroundColor: ['rgba(130, 210, 155, 0.78)', 'rgba(255, 165, 120, 0.72)'],
          borderColor: ['rgba(255, 214, 91, 0.5)', 'rgba(255, 214, 91, 0.5)'],
          borderWidth: 1,
          barPercentage: 0.65,
          categoryPercentage: 0.85,
        },
      ],
    };
  }, [brandStockSummary]);

  const brandStockSellThroughPercent = useMemo(() => {
    const s = brandStockSummary;
    if (!s) return null;
    const total = s.soldCount + s.unsoldCount;
    if (total === 0) return null;
    return (s.soldCount / total) * 100;
  }, [brandStockSummary]);

  const brandStockBarOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const n = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
              return `${n} item${n === 1 ? '' : 's'}`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Number of items',
            color: 'rgba(255, 248, 226, 0.65)',
            font: { size: 12 },
          },
          ticks: {
            color: 'rgba(255, 248, 226, 0.8)',
            precision: 0,
          },
          grid: { color: 'rgba(255, 214, 91, 0.1)' },
        },
        y: {
          ticks: {
            color: 'rgba(255, 248, 226, 0.88)',
            font: { size: 13 },
          },
          grid: { display: false },
        },
      },
    }),
    []
  );

  const categorySoldUnsoldStackData = useMemo(() => {
    const rows = brandStockSummary?.categorySoldUnsold;
    if (!rows?.length) return null;
    const labelMax = 34;
    const labels = rows.map((r) => {
      let label = r.category_name || 'Uncategorized';
      if (label.length > labelMax) label = `${label.slice(0, labelMax - 1)}…`;
      return label;
    });
    return {
      labels,
      datasets: [
        {
          label: 'Sold',
          data: rows.map((r) => r.sold_count),
          backgroundColor: 'rgba(130, 210, 155, 0.78)',
          borderColor: 'rgba(255, 214, 91, 0.45)',
          borderWidth: 1,
          stack: 'cat',
        },
        {
          label: 'Unsold',
          data: rows.map((r) => r.unsold_count),
          backgroundColor: 'rgba(255, 165, 120, 0.72)',
          borderColor: 'rgba(255, 214, 91, 0.45)',
          borderWidth: 1,
          stack: 'cat',
        },
      ],
    };
  }, [brandStockSummary?.categorySoldUnsold]);

  const categorySoldUnsoldStackOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            color: 'rgba(255, 248, 226, 0.85)',
            boxWidth: 12,
            boxHeight: 12,
            padding: 16,
          },
        },
        tooltip: {
          callbacks: {
            footer: (items) => {
              if (!items.length) return '';
              const i = items[0].dataIndex;
              const rows = brandStockSummary?.categorySoldUnsold ?? [];
              const row = rows[i];
              if (!row) return '';
              const t = row.sold_count + row.unsold_count;
              return `Total in category: ${t}`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          title: {
            display: true,
            text: 'Items (count)',
            color: 'rgba(255, 248, 226, 0.65)',
            font: { size: 12 },
          },
          ticks: {
            color: 'rgba(255, 248, 226, 0.8)',
            precision: 0,
          },
          grid: { color: 'rgba(255, 214, 91, 0.1)' },
        },
        y: {
          stacked: true,
          ticks: {
            color: 'rgba(255, 248, 226, 0.88)',
            font: { size: 12 },
          },
          grid: { display: false },
        },
      },
    }),
    [brandStockSummary?.categorySoldUnsold]
  );

  const handleSaveBrandInfo = async () => {
    if (brandTagBrandId === '') return;
    const id = brandTagBrandId;
    const trimmed = brandWebsiteUrlDraft.trim();
    const buy = brandBuyingNotesBuyDraft.trim();
    const avoid = brandBuyingNotesAvoidDraft.trim();
    setBrandBrandInfoSaving(true);
    setBrandTagError(null);
    try {
      const response = await fetch(apiUrl(`/api/brands/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_website: trimmed ? trimmed.slice(0, 2048) : null,
          things_to_buy: buy ? buy.slice(0, 8000) : null,
          things_to_avoid: avoid ? avoid.slice(0, 8000) : null,
        }),
      });
      const data = await readJsonResponse<{ row?: BrandRow }>(response, 'brand info update');
      const row = data.row;
      if (row) {
        setBrandsWithWebsites((prev) =>
          prev.map((br) => (br.id === row.id ? { ...br, ...row, id: br.id } : br))
        );
        setBrandWebsiteUrlDraft(row.brand_website?.trim() ?? '');
        setBrandBuyingNotesBuyDraft(row.things_to_buy?.trim() ?? '');
        setBrandBuyingNotesAvoidDraft(row.things_to_avoid?.trim() ?? '');
      }
    } catch (err: unknown) {
      setBrandTagError(friendlyApiUnreachableMessage(err));
    } finally {
      setBrandBrandInfoSaving(false);
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
      setBrandTagImages((prev) => [...prev, normalizeBrandTagImageRow(data)]);
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
    setBrandTagEditQuality(img.quality_tier);
  };

  const cancelEditBrandTagImage = () => {
    setBrandTagEditingId(null);
    setBrandTagEditCaption('');
    setBrandTagEditKind('tag');
    setBrandTagEditQuality('average');
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
          imageKind: brandTagEditKind ?? 'tag',
          // Always send a string so JSON never omits the key (undefined is stripped by JSON.stringify).
          qualityTier: brandTagEditQuality ?? 'average',
        }),
      });
      const data = await readJsonResponse<BrandTagImageRow>(response, 'brandTagImages patch');
      const normalized = normalizeBrandTagImageRow(data);
      setBrandTagImages((prev) =>
        prev.map((row) => (row.id === id ? { ...row, ...normalized } : row))
      );
      setBrandTagEditingId(null);
      setBrandTagEditCaption('');
      setBrandTagEditKind('tag');
      setBrandTagEditQuality('average');
    } catch (err: unknown) {
      setBrandTagError(friendlyApiUnreachableMessage(err));
    } finally {
      setBrandTagSaving(false);
    }
  };

  const renderBrandTagImageCard = (img: BrandTagImageRow) => {
    const isEditing = brandTagEditingId === img.id;
    const isFake = img.image_kind === 'fake_check';
    const tierChrome = isEditing ? brandTagEditQuality : img.quality_tier;
    const cardMod = isFake
      ? ' brand-tag-examples-card--fake'
      : ` brand-tag-examples-card--quality-${tierChrome}`;
    return (
      <li
        key={img.id}
        className={'brand-tag-examples-card' + cardMod}
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
              <div className="brand-tag-examples-thumb-fallback" title={img.storage_path ?? undefined}>
                No image URL — API needs Supabase env (see warning above) or check bucket
                SUPABASE_STORAGE_BRAND_TAGS_BUCKET.
              </div>
            )}
          </div>
          {isEditing ? (
            <div className="brand-tag-examples-edit-panel brand-tag-examples-card-edit-span">
              <div className="brand-tag-examples-edit-kind-quality-row">
                <div className="brand-tag-examples-edit-field brand-tag-examples-edit-field--half">
                  <select
                    id={`brand-tag-kind-${img.id}`}
                    className="brand-tag-examples-select brand-tag-examples-kind-select brand-tag-examples-edit-inline-select"
                    aria-label="Image type"
                    value={brandTagEditKind}
                    onChange={(e) => setBrandTagEditKind(e.target.value as BrandTagImageKind)}
                    disabled={brandTagSaving}
                  >
                    <option value="tag">Tag</option>
                    <option value="fake_check">Fake Check</option>
                  </select>
                </div>
                <div className="brand-tag-examples-edit-field brand-tag-examples-edit-field--half">
                  <select
                    id={`brand-tag-quality-${img.id}`}
                    className="brand-tag-examples-select brand-tag-examples-kind-select brand-tag-examples-edit-inline-select"
                    aria-label="Quality rating"
                    value={brandTagEditQuality}
                    onChange={(e) => setBrandTagEditQuality(e.target.value as BrandTagQualityTier)}
                    disabled={brandTagSaving}
                  >
                    <option value="good">{brandTagQualityStars('good')}</option>
                    <option value="average">{brandTagQualityStars('average')}</option>
                    <option value="poor">{brandTagQualityStars('poor')}</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="brand-tag-examples-remove brand-tag-examples-remove--round-inline"
                  aria-label="Delete image"
                  onClick={() => void handleDeleteBrandTagImage(img.id)}
                  disabled={brandTagSaving}
                >
                  X
                </button>
              </div>
              <textarea
                id={`brand-tag-edit-${img.id}`}
                className="brand-tag-examples-edit-textarea brand-tag-examples-edit-textarea--tag-image-caption"
                aria-label="Description"
                value={brandTagEditCaption}
                onChange={(e) => setBrandTagEditCaption(e.target.value)}
                placeholder="e.g. SS19 neck label"
                maxLength={500}
                rows={5}
                disabled={brandTagSaving}
              />
              <div className="brand-tag-examples-edit-actions brand-tag-examples-edit-actions--tag-card">
                <div className="brand-tag-examples-edit-actions-cluster">
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
                    Close
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="brand-tag-examples-caption-block">
                <span
                  className="brand-tag-examples-quality-stars"
                  title={brandTagQualityAriaLabel(img.quality_tier)}
                  aria-label={brandTagQualityAriaLabel(img.quality_tier)}
                >
                  {brandTagQualityStars(img.quality_tier)}
                </span>
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

  const selectedMenswearCategory = useMemo(
    () => menswearCategories.find((c) => c.id === menswearCategoryIdFromUrl) ?? null,
    [menswearCategories, menswearCategoryIdFromUrl]
  );

  const speakMenswearCategoryAloud = useCallback((cat: MenswearCategoryRow) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const parts = [cat.name.trim()];
    if (cat.description?.trim()) parts.push(cat.description.trim());
    if (cat.notes?.trim()) parts.push(cat.notes.trim());
    const u = new SpeechSynthesisUtterance(parts.join('. '));
    u.rate = 0.92;
    window.speechSynthesis.speak(u);
  }, []);

  const showMenswearCategoriesSplit =
    !menswearCategoriesLoading && !menswearCategoriesError && menswearCategoryIdFromUrl === null;

  const renderMenswearSalesPie = () => (
    <section
      className="menswear-categories-sales-pie"
      aria-label={
        menswearCategoryIdFromUrl == null
          ? 'Clothing category sales pie chart'
          : 'Clothing category brand sales pie chart'
      }
    >
      <div className="menswear-categories-sales-pie-header">
        <h3 className="menswear-categories-sales-pie-title">
          {menswearCategoryIdFromUrl == null ? 'Sales by Category' : 'Sales by Brand'}
        </h3>
        <div className="menswear-categories-sales-pie-filter" role="group" aria-label="Sales period filter">
          <button
            type="button"
            className={`menswear-categories-sales-pie-filter-btn${menswearSalesPeriod === 'last_12_months' ? ' menswear-categories-sales-pie-filter-btn--active' : ''}`}
            onClick={() => setMenswearSalesPeriod('last_12_months')}
          >
            Last 12 Months
          </button>
          <button
            type="button"
            className={`menswear-categories-sales-pie-filter-btn${menswearSalesPeriod === '2026' ? ' menswear-categories-sales-pie-filter-btn--active' : ''}`}
            onClick={() => setMenswearSalesPeriod('2026')}
          >
            2026
          </button>
          <button
            type="button"
            className={`menswear-categories-sales-pie-filter-btn${menswearSalesPeriod === '2025' ? ' menswear-categories-sales-pie-filter-btn--active' : ''}`}
            onClick={() => setMenswearSalesPeriod('2025')}
          >
            2025
          </button>
        </div>
      </div>
      {menswearCategorySalesError && (
        <div className="menswear-categories-error" role="alert">
          {menswearCategorySalesError}
        </div>
      )}
      {menswearCategorySalesLoading && !menswearCategorySalesError && (
        <div className="menswear-categories-muted">
          {menswearCategoryIdFromUrl == null ? 'Loading category sales…' : 'Loading brand sales…'}
        </div>
      )}
      {!menswearCategorySalesLoading &&
        !menswearCategorySalesError &&
        (menswearSalesPieModel.data ? (
          <div className="menswear-categories-sales-pie-chart-wrap">
            <Pie data={menswearSalesPieModel.data} options={menswearSalesPieChartOptions} />
          </div>
        ) : (
          <div className="menswear-categories-muted">
            {menswearCategoryIdFromUrl == null
              ? 'No sold revenue found for this period across mapped clothing categories.'
              : 'No sold revenue found for this period for brands in this category.'}
          </div>
        ))}
      {menswearCategoryIdFromUrl != null && (
        <div
          className="menswear-categories-inventory-block menswear-categories-brand-items-sold-block"
          role="region"
          aria-label="Items sold by brand"
        >
          <h4 className="menswear-categories-inventory-title">Items Sold by brand</h4>
          {menswearCategorySalesError ? (
            <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
              {menswearCategorySalesError}
            </div>
          ) : null}
          {menswearCategorySalesLoading && !menswearCategorySalesError ? (
            <div className="menswear-categories-muted menswear-categories-inventory-loading">
              Loading items sold…
            </div>
          ) : null}
          {!menswearCategorySalesLoading &&
            !menswearCategorySalesError &&
            (menswearBrandItemsSoldPieModel.data ? (
              <div className="menswear-categories-inventory-chart-wrap">
                <Pie
                  data={menswearBrandItemsSoldPieModel.data}
                  options={menswearBrandItemsSoldPieChartOptions}
                />
              </div>
            ) : (
              <div className="menswear-categories-muted">
                No items sold for brands in this category in this period.
              </div>
            ))}
        </div>
      )}
      {menswearCategoryIdFromUrl != null && (
        <div
          className="menswear-categories-inventory-block menswear-categories-brand-inventory-block"
          role="region"
          aria-label="Unsold inventory by brand"
        >
          <h4 className="menswear-categories-inventory-title">Unsold Inventory by brand</h4>
          {menswearBrandInventoryError ? (
            <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
              {menswearBrandInventoryError}
            </div>
          ) : null}
          {menswearBrandInventoryLoading && !menswearBrandInventoryError ? (
            <div className="menswear-categories-muted menswear-categories-inventory-loading">
              Loading brand inventory…
            </div>
          ) : null}
          {!menswearBrandInventoryLoading &&
            !menswearBrandInventoryError &&
            (menswearBrandInventoryRows.length === 0 ? (
              <div className="menswear-categories-muted">No brands linked to this category yet.</div>
            ) : menswearBrandInventoryPieModel.data ? (
              <div className="menswear-categories-inventory-chart-wrap">
                <Pie
                  data={menswearBrandInventoryPieModel.data}
                  options={menswearBrandInventoryPieChartOptions}
                />
              </div>
            ) : (
              <div className="menswear-categories-muted">No unsold items for brands in this category.</div>
            ))}
        </div>
      )}
      {menswearCategoryIdFromUrl == null && (
        <div
          className="menswear-categories-inventory-block menswear-categories-category-items-sold-block"
          role="region"
          aria-label="Items sold by category"
        >
          <h4 className="menswear-categories-inventory-title">Items Sold by category</h4>
          {menswearCategorySalesError ? (
            <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
              {menswearCategorySalesError}
            </div>
          ) : null}
          {menswearCategorySalesLoading && !menswearCategorySalesError ? (
            <div className="menswear-categories-muted menswear-categories-inventory-loading">
              Loading items sold…
            </div>
          ) : null}
          {!menswearCategorySalesLoading &&
            !menswearCategorySalesError &&
            (menswearCategoryItemsSoldPieModel.data ? (
              <div className="menswear-categories-inventory-chart-wrap">
                <Pie
                  data={menswearCategoryItemsSoldPieModel.data}
                  options={menswearCategoryItemsSoldPieChartOptions}
                />
              </div>
            ) : (
              <div className="menswear-categories-muted">
                No items sold in mapped clothing categories in this period.
              </div>
            ))}
        </div>
      )}
      {menswearCategoryIdFromUrl == null && (
        <div
          className="menswear-categories-inventory-block"
          role="region"
          aria-label="Unsold inventory by category"
        >
          <h4 className="menswear-categories-inventory-title">Unsold inventory by category</h4>
          {menswearCategoryInventoryError ? (
            <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
              {menswearCategoryInventoryError}
            </div>
          ) : null}
          {menswearCategoryInventoryLoading && !menswearCategoryInventoryError ? (
            <div className="menswear-categories-muted menswear-categories-inventory-loading">
              Loading inventory…
            </div>
          ) : null}
          {!menswearCategoryInventoryLoading &&
            !menswearCategoryInventoryError &&
            (menswearCategoryInventoryRows.length === 0 ? (
              <div className="menswear-categories-muted">No clothing categories defined yet.</div>
            ) : menswearInventoryPieModel.data ? (
              <div className="menswear-categories-inventory-chart-wrap">
                <Pie data={menswearInventoryPieModel.data} options={menswearInventoryPieChartOptions} />
              </div>
            ) : (
              <div className="menswear-categories-muted">No unsold items in mapped categories.</div>
            ))}
          {!menswearCategoryInventoryError ? (
            <>
              <hr className="menswear-categories-inventory-ask-ai-rule" />
              <div className="menswear-categories-inventory-ask-ai-wrap">
                <button
                  type="button"
                  className="menswear-categories-ask-ai-btn"
                  disabled={
                    menswearAskAiBusy ||
                    menswearCategorySalesLoading ||
                    menswearCategoryInventoryLoading
                  }
                  onClick={() => void runMenswearSalesInventoryAskAi()}
                  aria-label="Copy Ask RI prompt comparing sales by category vs unsold stock"
                >
                  Ask RI - Review This Selection
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </section>
  );

  return (
    <div className="research-page-container">
      {researchApiOfflineMessage && (
        <div className="research-api-offline-banner" role="alert">
          {researchApiOfflineMessage}
        </div>
      )}
      <nav className="research-tabs" role="tablist" aria-label="Research sections">
        <button
          type="button"
          role="tab"
          id="research-tab-brand"
          aria-selected={researchTab === 'brand'}
          aria-controls="research-panel-brand"
          className={`research-tab${researchTab === 'brand' ? ' active' : ''}`}
          onClick={() => setResearchTab('brand')}
        >
          Brand research
        </button>
        <button
          type="button"
          role="tab"
          id="research-tab-menswear-categories"
          aria-selected={researchTab === 'menswear-categories'}
          aria-controls="research-panel-menswear-categories"
          className={`research-tab${researchTab === 'menswear-categories' ? ' active' : ''}`}
          onClick={goToMenswearCategoriesTab}
        >
          Clothing Category
        </button>
        <button
          type="button"
          role="tab"
          id="research-tab-offline"
          aria-selected={researchTab === 'offline'}
          aria-controls="research-panel-offline"
          className={`research-tab${researchTab === 'offline' ? ' active' : ''}`}
          onClick={() => setResearchTab('offline')}
        >
          Brand offline research
        </button>
        <button
          type="button"
          role="tab"
          id="research-tab-ai"
          aria-selected={researchTab === 'ai'}
          aria-controls="research-panel-ai"
          className={`research-tab${researchTab === 'ai' ? ' active' : ''}`}
          onClick={() => setResearchTab('ai')}
        >
          AI research
        </button>
      </nav>
      {researchTab === 'brand' && (
        <div
          id="research-panel-brand"
          role="tabpanel"
          aria-labelledby="research-tab-brand"
          className="research-tab-panel"
        >
      <div className="brand-tag-examples-container">
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
            <div className="brand-tag-examples-brand-toolbar brand-tag-examples-brand-toolbar--split">
              <div className="brand-research-brand-toolbar-row">
                <div className="brand-tag-examples-brand-select-wrap brand-research-brand-typeahead-wrap">
                  <div className="brand-research-brand-typeahead-inner">
                    <input
                      id="brand-tag-brand-select"
                      type="text"
                      role="combobox"
                      aria-expanded={brandTabTypeaheadOpen}
                      aria-controls="brand-research-brand-typeahead-listbox"
                      aria-autocomplete="list"
                      autoComplete="off"
                      aria-label="Search or select brand"
                      className="brand-tag-examples-select brand-research-brand-typeahead-input"
                      placeholder="Search or select a brand…"
                      value={brandTabQuery}
                      disabled={!brandsLoaded}
                      onChange={(e) => {
                        const v = e.target.value;
                        setBrandTabQuery(v);
                        setBrandTabTypeaheadOpen(true);
                        if (v.trim() === '') {
                          clearBrandTabSelection();
                          return;
                        }
                        const selected = brandsWithWebsites.find((br) => br.id === brandTagBrandId);
                        if (brandTagBrandId !== '' && selected && v !== selected.brand_name) {
                          brandTabInputUserEditRef.current = true;
                          setBrandTagBrandId('');
                          const next = new URLSearchParams(searchParams);
                          next.delete('brand');
                          setSearchParams(next, { replace: true });
                        }
                      }}
                      onFocus={() => setBrandTabTypeaheadOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => setBrandTabTypeaheadOpen(false), 120);
                      }}
                    />
                    {brandTabTypeaheadOpen && brandsLoaded && (
                      <ul
                        id="brand-research-brand-typeahead-listbox"
                        role="listbox"
                        className="brand-research-typeahead-dropdown"
                      >
                        {brandsWithWebsites.length === 0 ? (
                          <li className="brand-research-typeahead-empty" role="presentation">
                            No brands yet — use + to add one
                          </li>
                        ) : brandTabTypeaheadList.length === 0 ? (
                          <li className="brand-research-typeahead-empty" role="presentation">
                            No matching brands
                          </li>
                        ) : (
                          brandTabTypeaheadList.map((b) => (
                            <li
                              key={b.id}
                              role="option"
                              aria-selected={brandTagBrandId === b.id}
                              className="brand-research-typeahead-option"
                              onMouseDown={(ev) => {
                                ev.preventDefault();
                                selectBrandFromBrandTabTypeahead(b);
                              }}
                            >
                              {b.brand_name}
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                </div>
                {brandTagBrandId === '' && (
                  <button
                    type="button"
                    className="brand-research-new-brand-icon-btn"
                    aria-label="Create new brand"
                    title="New brand"
                    disabled={!brandsLoaded}
                    onClick={() => {
                      setBrandCreateOpen((o) => !o);
                      setBrandCreateError(null);
                    }}
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden
                    >
                      <path
                        d="M12 5v14M5 12h14"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                )}
                {brandTagBrandId !== '' && (
                  <div className="brand-tag-examples-brand-toolbar-actions">
                    <button
                      type="button"
                      className="brand-tag-examples-add-info-btn brand-tag-examples-toolbar-btn"
                      onClick={() => {
                        setBrandTagAddPanelOpen((open) => {
                          if (open) {
                            setBrandTagAddSubMode('pick');
                            setBrandWebsiteUrlDraft('');
                            setBrandBuyingNotesBuyDraft('');
                            setBrandBuyingNotesAvoidDraft('');
                            setBrandTagCaption('');
                            setBrandTagNewImageKind('tag');
                          }
                          return !open;
                        });
                      }}
                      aria-expanded={brandTagAddPanelOpen}
                      aria-controls="brand-tag-add-panel"
                    >
                      {brandTagAddPanelOpen ? 'Close' : 'Add info'}
                    </button>
                  </div>
                )}
              </div>
              {brandCreateOpen && brandTagBrandId === '' && (
                <div className="brand-research-create-brand-panel">
                  <label className="brand-tag-examples-label" htmlFor="brand-research-new-brand-name">
                    New brand name
                  </label>
                  <input
                    id="brand-research-new-brand-name"
                    type="text"
                    className="brand-tag-examples-caption-input"
                    value={brandCreateName}
                    onChange={(e) => setBrandCreateName(e.target.value)}
                    placeholder="e.g. Acme Co"
                    maxLength={200}
                    disabled={brandCreateBusy}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCreateBrandSubmit();
                      }
                    }}
                  />
                  <div className="brand-research-create-brand-actions">
                    <button
                      type="button"
                      className="brand-tag-examples-save"
                      onClick={() => void handleCreateBrandSubmit()}
                      disabled={brandCreateBusy}
                    >
                      {brandCreateBusy ? 'Creating…' : 'Create'}
                    </button>
                    <button
                      type="button"
                      className="brand-tag-examples-cancel"
                      onClick={() => {
                        setBrandCreateOpen(false);
                        setBrandCreateName('');
                        setBrandCreateError(null);
                      }}
                      disabled={brandCreateBusy}
                    >
                      Cancel
                    </button>
                  </div>
                  {brandCreateError && (
                    <p className="brand-tag-examples-error brand-research-create-brand-error" role="alert">
                      {brandCreateError}
                    </p>
                  )}
                </div>
              )}
            </div>
            {brandTagBrandId !== '' &&
              (() => {
                const br = brandsWithWebsites.find((x) => x.id === brandTagBrandId);
                if (!br) return null;
                const rawSite = br.brand_website?.trim() ?? '';
                const fullUrlBrowse =
                  rawSite &&
                  (rawSite.startsWith('http://') || rawSite.startsWith('https://')
                    ? rawSite
                    : `https://${rawSite}`);
                const buy = br.things_to_buy?.trim() ?? '';
                const avoid = br.things_to_avoid?.trim() ?? '';
                if (!rawSite && !buy && !avoid) return null;
                const savedBrandLabel = (br.brand_name ?? '').trim();
                const savedVisitWebsiteLabel = savedBrandLabel
                  ? `Visit ${savedBrandLabel} Website`
                  : 'Visit Website';
                return (
                  <div className="brand-tag-examples-saved-brand-info">
                    {rawSite && fullUrlBrowse ? (
                      <div className="brand-tag-examples-saved-brand-info-website">
                        <div className="brand-visit-website-framed">
                          <hr className="brand-visit-website-rule" aria-hidden="true" />
                          <a
                            href={fullUrlBrowse}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="brand-website-link brand-tag-examples-website-browse-link"
                            title={rawSite}
                            aria-label={
                              savedBrandLabel
                                ? `Visit ${savedBrandLabel} website`
                                : 'Visit website'
                            }
                          >
                            {savedVisitWebsiteLabel}
                          </a>
                          <hr className="brand-visit-website-rule" aria-hidden="true" />
                        </div>
                      </div>
                    ) : null}
                    {buy ? (
                      <section
                        className="brand-tag-examples-buying-block brand-tag-examples-saved-brand-info-block"
                        aria-labelledby={`brand-saved-buy-${br.id}`}
                      >
                        <h3
                          id={`brand-saved-buy-${br.id}`}
                          className="brand-tag-examples-buying-to-buy-heading"
                        >
                          Things To Buy
                        </h3>
                        <div className="brand-tag-examples-buying-text">{buy}</div>
                      </section>
                    ) : null}
                    {avoid ? (
                      <section
                        className="brand-tag-examples-buying-block brand-tag-examples-saved-brand-info-block"
                        aria-labelledby={`brand-saved-avoid-${br.id}`}
                      >
                        <h3
                          id={`brand-saved-avoid-${br.id}`}
                          className="brand-tag-examples-buying-to-avoid-heading"
                        >
                          Things To Avoid
                        </h3>
                        <div className="brand-tag-examples-buying-text">{avoid}</div>
                      </section>
                    ) : null}
                  </div>
                );
              })()}
            {brandTagBrandId !== '' &&
              brandTagAddPanelOpen &&
              (() => {
                const b = brandsWithWebsites.find((x) => x.id === brandTagBrandId);
                if (!b) return null;

                const rawBrowseDraft = brandWebsiteUrlDraft.trim();
                const fullUrlBrowseDraft =
                  rawBrowseDraft &&
                  (rawBrowseDraft.startsWith('http://') || rawBrowseDraft.startsWith('https://')
                    ? rawBrowseDraft
                    : `https://${rawBrowseDraft}`);

                const resetInfoDraftsFromBrand = () => {
                  setBrandWebsiteUrlDraft(b.brand_website?.trim() ?? '');
                  setBrandBuyingNotesBuyDraft(b.things_to_buy?.trim() ?? '');
                  setBrandBuyingNotesAvoidDraft(b.things_to_avoid?.trim() ?? '');
                };

                return (
                  <div
                    className="brand-tag-examples-brand-website-below"
                    id="brand-tag-add-panel"
                    role="region"
                    aria-label="Add brand content"
                  >
                    {brandTagAddSubMode === 'pick' && (
                      <div className="brand-tag-examples-add-pick">
                        <p className="brand-tag-examples-add-pick-label">What would you like to add?</p>
                        <div className="brand-tag-examples-add-pick-row">
                          <button
                            type="button"
                            className="brand-tag-examples-add-pick-choice"
                            onClick={() => setBrandTagAddSubMode('image')}
                          >
                            Add image
                          </button>
                          <button
                            type="button"
                            className="brand-tag-examples-add-pick-choice"
                            onClick={() => {
                              resetInfoDraftsFromBrand();
                              setBrandTagAddSubMode('info');
                            }}
                          >
                            Add brand info
                          </button>
                        </div>
                      </div>
                    )}
                    {brandTagAddSubMode === 'image' && (
                      <div className="brand-tag-examples-add-panel brand-tag-examples-add-panel--nested">
                        <button
                          type="button"
                          className="brand-tag-examples-add-panel-back"
                          onClick={() => {
                            setBrandTagAddSubMode('pick');
                            setBrandTagCaption('');
                            setBrandTagNewImageKind('tag');
                          }}
                        >
                          Back
                        </button>
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
                        <textarea
                          id="brand-tag-caption"
                          className="brand-tag-examples-edit-textarea"
                          value={brandTagCaption}
                          onChange={(e) => setBrandTagCaption(e.target.value)}
                          placeholder="e.g. SS19 neck label"
                          maxLength={500}
                          rows={4}
                          disabled={brandTagUploading}
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
                      </div>
                    )}
                    {brandTagAddSubMode === 'info' && (
                      <div className="brand-tag-examples-add-panel brand-tag-examples-add-panel--nested brand-tag-examples-add-panel--info">
                        <button
                          type="button"
                          className="brand-tag-examples-add-panel-back"
                          onClick={() => {
                            resetInfoDraftsFromBrand();
                            setBrandTagAddSubMode('pick');
                          }}
                          disabled={brandBrandInfoSaving}
                        >
                          Back
                        </button>
                        <p className="brand-tag-examples-add-info-intro">
                          Website and buying notes (things to buy / things to avoid).
                        </p>
                        <label className="brand-tag-examples-label" htmlFor="brand-research-website-url">
                          Website URL
                        </label>
                        <input
                          id="brand-research-website-url"
                          type="text"
                          className="brand-tag-examples-caption-input brand-tag-examples-website-url-input"
                          value={brandWebsiteUrlDraft}
                          onChange={(e) => setBrandWebsiteUrlDraft(e.target.value)}
                          placeholder="https://…"
                          maxLength={2048}
                          disabled={brandBrandInfoSaving}
                          autoComplete="url"
                        />
                        {fullUrlBrowseDraft ? (
                          <div className="brand-tag-examples-add-info-visit-wrap">
                            <a
                              href={fullUrlBrowseDraft}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="brand-website-link brand-tag-examples-website-browse-link"
                            >
                              Open URL in new tab
                            </a>
                          </div>
                        ) : null}
                        <label className="brand-tag-examples-label" htmlFor="brand-buy-notes-buy">
                          Things to buy
                        </label>
                        <textarea
                          id="brand-buy-notes-buy"
                          className="brand-tag-examples-edit-textarea"
                          value={brandBuyingNotesBuyDraft}
                          onChange={(e) => setBrandBuyingNotesBuyDraft(e.target.value)}
                          placeholder="e.g. Denim jackets, knitwear…"
                          maxLength={8000}
                          rows={5}
                          disabled={brandBrandInfoSaving}
                        />
                        <label className="brand-tag-examples-label" htmlFor="brand-buy-notes-avoid">
                          Things to avoid
                        </label>
                        <textarea
                          id="brand-buy-notes-avoid"
                          className="brand-tag-examples-edit-textarea"
                          value={brandBuyingNotesAvoidDraft}
                          onChange={(e) => setBrandBuyingNotesAvoidDraft(e.target.value)}
                          placeholder="e.g. Logo tees, damaged items…"
                          maxLength={8000}
                          rows={5}
                          disabled={brandBrandInfoSaving}
                        />
                        <div className="brand-tag-examples-edit-actions">
                          <button
                            type="button"
                            className="brand-tag-examples-save"
                            onClick={() => void handleSaveBrandInfo()}
                            disabled={brandBrandInfoSaving}
                          >
                            {brandBrandInfoSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            className="brand-tag-examples-cancel"
                            onClick={() => {
                              resetInfoDraftsFromBrand();
                              setBrandTagAddSubMode('pick');
                            }}
                            disabled={brandBrandInfoSaving}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
          </div>
        </div>
        {brandTagStorageWarning && (
          <div className="brand-tag-examples-error" role="alert">
            {brandTagStorageWarning}
          </div>
        )}
        {brandTagError && <div className="brand-tag-examples-error">{brandTagError}</div>}
        {brandTagBrandId !== '' && brandTagLoading && (
          <div className="brand-tag-examples-muted">Loading…</div>
        )}
        {brandTagImages.length > 0 && (
          <>
            <div className="brand-tag-key-tags-wrap">
              <div className="brand-tag-quality-filter-row">
                <h3 className="brand-tag-key-tags-title">Key Tags</h3>
                <div className="brand-tag-quality-filter" ref={brandTagQualityMenuRef}>
                  <button
                    type="button"
                    className="brand-tag-quality-filter-btn"
                    aria-expanded={brandTagQualityMenuOpen}
                    aria-haspopup="listbox"
                    aria-label="Filter tag quality order"
                    onClick={() => setBrandTagQualityMenuOpen((open) => !open)}
                  >
                    <BrandTagQualityFilterIcon />
                  </button>
                  {brandTagQualityMenuOpen ? (
                    <ul
                      className="brand-tag-quality-filter-menu"
                      role="listbox"
                      aria-label="Quality order"
                    >
                      <li role="presentation">
                        <button
                          type="button"
                          role="option"
                          className={
                            'brand-tag-quality-filter-option' +
                            (brandTagQualitySort === 'best_first'
                              ? ' brand-tag-quality-filter-option--active'
                              : '')
                          }
                          aria-selected={brandTagQualitySort === 'best_first'}
                          aria-label="Order: best first, then average, then poor"
                          onClick={() => {
                            setBrandTagQualitySort('best_first');
                            setBrandTagQualityMenuOpen(false);
                          }}
                        >
                          {`${brandTagQualityStars('good')} → ${brandTagQualityStars('average')} → ${brandTagQualityStars('poor')}`}
                        </button>
                      </li>
                      <li role="presentation">
                        <button
                          type="button"
                          role="option"
                          className={
                            'brand-tag-quality-filter-option' +
                            (brandTagQualitySort === 'bad_first'
                              ? ' brand-tag-quality-filter-option--active'
                              : '')
                          }
                          aria-selected={brandTagQualitySort === 'bad_first'}
                          aria-label="Order: poor first, then average, then best"
                          onClick={() => {
                            setBrandTagQualitySort('bad_first');
                            setBrandTagQualityMenuOpen(false);
                          }}
                        >
                          {`${brandTagQualityStars('poor')} → ${brandTagQualityStars('average')} → ${brandTagQualityStars('good')}`}
                        </button>
                      </li>
                    </ul>
                  ) : null}
                </div>
              </div>
            </div>
            {(() => {
              const tagRows = sortedBrandTagImages.filter((i) => i.image_kind !== 'fake_check');
              const fakeRows = sortedBrandTagImages.filter((i) => i.image_kind === 'fake_check');
              return (
                <>
                  {tagRows.length > 0 && (
                    <div className="brand-tag-examples-image-section">
                      <ul className="brand-tag-examples-grid">{tagRows.map(renderBrandTagImageCard)}</ul>
                    </div>
                  )}
                  {fakeRows.length > 0 && (
                    <div className="brand-tag-examples-image-section brand-tag-examples-image-section--fake">
                      <h3 className="brand-tag-examples-fake-heading">Fake Tags</h3>
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
        {brandTagBrandId !== '' && (
          <section className="brand-research-sales-section" aria-labelledby="brand-research-sales-title">
            <div className="brand-research-sales-header">
              <h3 id="brand-research-sales-title" className="brand-research-sales-heading">
                Sales Data
              </h3>
              <div
                className="brand-research-sales-period-wrap"
                ref={brandStockPeriodMenuRef}
              >
                <button
                  type="button"
                  className={`brand-research-sales-period-trigger${brandStockPeriodMenuOpen ? ' brand-research-sales-period-trigger--open' : ''}`}
                  aria-expanded={brandStockPeriodMenuOpen}
                  aria-haspopup="listbox"
                  aria-label={`Sales period: ${brandStockPeriodMenuLabel(brandStockSummaryPeriod)}. Change period`}
                  onClick={() => setBrandStockPeriodMenuOpen((open) => !open)}
                >
                  <svg
                    className="brand-research-sales-period-trigger-icon"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden
                  >
                    <path
                      d="M5 5h14l-5 7.5V18l-4 2v-7.5L5 5z"
                      stroke="currentColor"
                      strokeWidth="1.85"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                {brandStockPeriodMenuOpen ? (
                  <ul
                    className="brand-research-sales-period-menu"
                    role="listbox"
                    aria-label="Sales period"
                  >
                    {(
                      [
                        { value: 'all' as const, label: 'All time' },
                        { value: 'last_12_months' as const, label: 'Last 12 months' },
                        { value: '2026' as const, label: '2026' },
                        { value: '2025' as const, label: '2025' },
                      ] as const
                    ).map((opt) => (
                      <li key={opt.value} role="presentation">
                        <button
                          type="button"
                          role="option"
                          className={
                            'brand-research-sales-period-option' +
                            (brandStockSummaryPeriod === opt.value
                              ? ' brand-research-sales-period-option--active'
                              : '')
                          }
                          aria-selected={brandStockSummaryPeriod === opt.value}
                          onClick={() => {
                            setBrandStockSummaryPeriod(opt.value);
                            setBrandStockPeriodMenuOpen(false);
                          }}
                        >
                          {opt.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
            {brandStockSummaryLoading && (
              <div className="brand-tag-examples-muted brand-research-sales-loading">Loading sales data…</div>
            )}
            {brandStockSummaryError && (
              <div className="brand-tag-examples-error brand-research-sales-error" role="alert">
                {brandStockSummaryError}
              </div>
            )}
            {!brandStockSummaryLoading && brandStockSummary && (
              <>
                {!brandStockBarChartData ? (
                  <p className="brand-research-sales-empty">
                    {brandStockSummary.stockRowCountLifetime === 0
                      ? 'No stock rows are linked to this brand yet. Assign a brand on the Stock page to see charts here.'
                      : brandStockSummaryPeriod !== 'all'
                        ? 'No items match this period for this brand (sold lines need a sale date in range; unsold lines need a purchase date in range).'
                        : 'No stock rows are linked to this brand yet. Assign a brand on the Stock page to see charts here.'}
                  </p>
                ) : (
                  <div className="brand-research-sales-chart-block">
                    {brandStockSellThroughPercent != null && (
                      <p className="brand-research-sales-sell-through">
                        Sell-through rate:{' '}
                        <strong>{brandStockSellThroughPercent.toFixed(1)}%</strong>
                        <span className="brand-research-sales-sell-through-detail">
                          {' '}
                          ({brandStockSummary.soldCount} sold of{' '}
                          {brandStockSummary.soldCount + brandStockSummary.unsoldCount} items)
                        </span>
                      </p>
                    )}
                    <div className="brand-research-sales-chart-inner brand-research-sales-chart-inner--bar">
                      <Bar data={brandStockBarChartData} options={brandStockBarOptions} />
                    </div>
                    {categorySoldUnsoldStackData && (
                      <div className="brand-research-category-stack-block">
                        <h4 className="brand-research-category-stack-heading">
                          Sold vs unsold by category
                        </h4>
                        <div
                          className="brand-research-category-stack-chart-inner"
                          style={{
                            height: `${Math.max(
                              200,
                              (brandStockSummary.categorySoldUnsold?.length ?? 0) * 40 + 120
                            )}px`,
                          }}
                        >
                          <Bar
                            data={categorySoldUnsoldStackData}
                            options={categorySoldUnsoldStackOptions}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="brand-research-brand-totals" aria-label="Brand spend and sales totals">
                  <div className="brand-research-brand-totals-col">
                    <span className="brand-research-brand-totals-label">Total spent</span>
                    <span className="brand-research-brand-totals-value">
                      {formatResearchCurrency(brandStockSummary.totalPurchaseSpend)}
                    </span>
                    <span className="brand-research-brand-totals-hint">All items with a purchase price</span>
                  </div>
                  <div className="brand-research-brand-totals-col">
                    <span className="brand-research-brand-totals-label">Total sold</span>
                    <span className="brand-research-brand-totals-value">
                      {formatResearchCurrency(brandStockSummary.totalSoldRevenue)}
                    </span>
                    <span className="brand-research-brand-totals-hint">Sale prices for sold items</span>
                  </div>
                  <div className="brand-research-brand-totals-col">
                    <span className="brand-research-brand-totals-label">Net</span>
                    <span
                      className={
                        'brand-research-brand-totals-value brand-research-brand-totals-value--net ' +
                        (brandStockSummary.brandNetPosition > 0
                          ? 'brand-research-brand-totals-value--profit'
                          : brandStockSummary.brandNetPosition < 0
                            ? 'brand-research-brand-totals-value--loss'
                            : 'brand-research-brand-totals-value--even')
                      }
                    >
                      {brandStockSummary.brandNetPosition > 0
                        ? `Profit ${formatResearchCurrency(brandStockSummary.brandNetPosition)}`
                        : brandStockSummary.brandNetPosition < 0
                          ? `£-${new Intl.NumberFormat('en-GB', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }).format(Math.abs(brandStockSummary.brandNetPosition))}`
                          : formatResearchCurrency(0)}
                    </span>
                    <span className="brand-research-brand-totals-hint">Sold revenue − all spend</span>
                  </div>
                </div>
                {brandStockSummary.soldCount > 0 &&
                  brandStockSummary.minSoldSalePrice != null &&
                  brandStockSummary.maxSoldSalePrice != null && (
                    <div
                      className="brand-research-brand-totals brand-research-brand-totals--secondary"
                      aria-label="Average sale price band and sell-through"
                    >
                      <div className="brand-research-brand-totals-col">
                        <span className="brand-research-brand-totals-label">Avg sale price</span>
                        <span className="brand-research-brand-totals-value brand-research-brand-totals-value--multiline">
                          Averaged{' '}
                          {formatAveragedSaleBand(
                            brandStockSummary.minSoldSalePrice,
                            brandStockSummary.maxSoldSalePrice
                          )}
                        </span>
                        <span className="brand-research-brand-totals-hint">per sale</span>
                      </div>
                      <div className="brand-research-brand-totals-col">
                        <span className="brand-research-brand-totals-label">Sell-through</span>
                        <span className="brand-research-brand-totals-value brand-research-brand-totals-value--multiline">
                          {(() => {
                            const pctStr =
                              brandStockSellThroughPercent != null
                                ? `${
                                    Math.abs(
                                      brandStockSellThroughPercent -
                                        Math.round(brandStockSellThroughPercent)
                                    ) < 0.05
                                      ? Math.round(brandStockSellThroughPercent)
                                      : brandStockSellThroughPercent.toFixed(1)
                                  }%`
                                : null;
                            const multStr =
                              brandStockSummary.avgSoldProfitMultiple != null
                                ? formatSoldMultipleDisplay(
                                    brandStockSummary.avgSoldProfitMultiple
                                  )
                                : null;
                            if (pctStr && multStr) return `${pctStr} / ${multStr}`;
                            if (pctStr) return pctStr;
                            if (multStr) return multStr;
                            return '—';
                          })()}
                        </span>
                        <span className="brand-research-brand-totals-hint">
                          {brandStockSummary.avgSoldProfitMultiple != null
                            ? 'Listed sell-through · avg sale ÷ buy'
                            : 'Listed sell-through · add buy prices for avg ×'}
                        </span>
                      </div>
                    </div>
                  )}
                {brandStockSummary.topSoldItems.length > 0 ? (
                  <div className="brand-research-sales-table-block">
                    <h4 className="brand-research-sales-subheading">Best sold items</h4>
                    <div className="brand-research-sales-table-scroll">
                      <table className="brand-research-sales-table">
                        <thead>
                          <tr>
                            <th scope="col">Item</th>
                            <th scope="col">Category</th>
                            <th scope="col">Purchase</th>
                            <th scope="col">Sale</th>
                            <th scope="col">Profit</th>
                            <th scope="col">Multiple</th>
                          </tr>
                        </thead>
                        <tbody>
                          {brandStockSummary.topSoldItems.map((row, idx) => (
                            <tr key={row.id != null ? row.id : `sold-top-${idx}`}>
                              <td className="brand-research-sales-cell-name">{row.item_name || '—'}</td>
                              <td>{row.category_name ?? '—'}</td>
                              <td>
                                {row.purchase_price != null ? formatResearchCurrency(row.purchase_price) : '—'}
                              </td>
                              <td>{row.sale_price != null ? formatResearchCurrency(row.sale_price) : '—'}</td>
                              <td>{row.profit != null ? formatResearchCurrency(row.profit) : '—'}</td>
                              <td className="brand-research-sales-cell-multiple">
                                {row.profit_multiple != null && Number.isFinite(row.profit_multiple)
                                  ? `${row.profit_multiple.toFixed(2)}×`
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : brandStockSummary.soldCount > 0 && brandStockSummary.topSoldItems.length === 0 ? (
                  <p className="brand-research-sales-empty brand-research-sales-empty--subtle">
                    Sold items need both purchase price and sale price to rank by profit multiple.
                  </p>
                ) : null}
                {brandStockSummary.longestUnsoldItems.length > 0 ? (
                  <div className="brand-research-sales-table-block brand-research-sales-table-block--unsold">
                    <h4 className="brand-research-sales-subheading">Longest Unsold Items</h4>
                    <div className="brand-research-sales-table-scroll">
                      <table className="brand-research-sales-table">
                        <thead>
                          <tr>
                            <th scope="col">Item</th>
                            <th scope="col">Category</th>
                            <th scope="col">Purchase</th>
                            <th scope="col">Purchased</th>
                            <th scope="col">Days in stock</th>
                          </tr>
                        </thead>
                        <tbody>
                          {brandStockSummary.longestUnsoldItems.map((row, idx) => {
                            const days = daysSincePurchase(row.purchase_date);
                            return (
                              <tr key={row.id != null ? row.id : `unsold-${idx}`}>
                                <td className="brand-research-sales-cell-name">{row.item_name || '—'}</td>
                                <td>{row.category_name ?? '—'}</td>
                                <td>
                                  {row.purchase_price != null ? formatResearchCurrency(row.purchase_price) : '—'}
                                </td>
                                <td>{formatResearchShortDate(row.purchase_date)}</td>
                                <td className="brand-research-sales-cell-multiple">
                                  {days != null ? `${days}d` : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="brand-research-unsold-ask-ai-wrap">
                      <button
                        type="button"
                        className="brand-research-unsold-ask-ai-button"
                        onClick={() => void handleCopyLongestUnsoldAskAi()}
                        title="Copy a blunt, data-based prompt for ChatGPT about these stuck lines"
                        aria-label="Copy Ask RI prompt for longest unsold items to clipboard"
                      >
                        Ask RI - Review This Selection
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </section>
        )}
        {brandTagBrandId !== '' && (
          <section className="brand-research-ebay-sold-section" aria-labelledby="brand-research-ebay-title">
            <h3 id="brand-research-ebay-title" className="brand-research-sales-heading">
              eBay Solds
            </h3>
            <p className="brand-research-ebay-sold-filter-note brand-tag-examples-muted">
              Showing sold listings over £{EBAY_SOLD_DISPLAY_MIN_GBP} only (GBP).
            </p>
            {ebaySoldNoCacheNotice && (
              <p className="brand-research-ebay-sold-no-cache brand-tag-examples-muted">{ebaySoldNoCacheNotice}</p>
            )}
            {ebaySoldLoading && (
              <div className="brand-tag-examples-muted brand-research-ebay-sold-loading">Loading eBay results…</div>
            )}
            {ebaySoldError && (
              <div className="brand-tag-examples-error brand-research-ebay-sold-error" role="alert">
                {ebaySoldError}
              </div>
            )}
            {!ebaySoldLoading && !ebaySoldError && ebaySoldItems.length === 0 && (
              <p className="brand-research-sales-empty">
                No sold listings matched this brand in the last ~120 days (eBay may return fewer than 20).
              </p>
            )}
            {!ebaySoldLoading &&
              !ebaySoldError &&
              ebaySoldItems.length > 0 &&
              ebaySoldItemsDisplay.length === 0 && (
                <p className="brand-research-sales-empty">
                  No sold listings in this set over £{EBAY_SOLD_DISPLAY_MIN_GBP}. eBay returned{' '}
                  {ebaySoldItems.length} result{ebaySoldItems.length === 1 ? '' : 's'} — try refreshing or
                  browse on eBay for lower-priced comps.
                </p>
              )}
            {!ebaySoldLoading && ebaySoldItemsDisplay.length > 0 && (
              <ul className="brand-research-ebay-sold-grid">
                {ebaySoldItemsDisplay.map((item, idx) => (
                  <li key={item.itemId || `ebay-${idx}`} className="brand-research-ebay-sold-card">
                    {item.itemWebUrl ? (
                      <a
                        href={item.itemWebUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="brand-research-ebay-sold-card-link"
                      >
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="brand-research-ebay-sold-card-img"
                            loading="lazy"
                          />
                        ) : (
                          <div className="brand-research-ebay-sold-card-img-fallback" aria-hidden="true" />
                        )}
                        <span className="brand-research-ebay-sold-card-title">{item.title || 'Listing'}</span>
                        {item.conditionLabel && (
                          <span className="brand-research-ebay-sold-card-condition">{item.conditionLabel}</span>
                        )}
                        <span className="brand-research-ebay-sold-card-price">
                          {formatEbayDisplayPrice(item.priceCurrency, item.priceValue)}
                        </span>
                      </a>
                    ) : (
                      <div className="brand-research-ebay-sold-card-static">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt=""
                            className="brand-research-ebay-sold-card-img"
                            loading="lazy"
                          />
                        ) : null}
                        <span className="brand-research-ebay-sold-card-title">{item.title || 'Listing'}</span>
                        {item.conditionLabel && (
                          <span className="brand-research-ebay-sold-card-condition">{item.conditionLabel}</span>
                        )}
                        <span className="brand-research-ebay-sold-card-price">
                          {formatEbayDisplayPrice(item.priceCurrency, item.priceValue)}
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!ebaySoldLoading && (
              <div className="brand-research-ebay-sold-actions">
                <button
                  type="button"
                  className="brand-research-ebay-sold-refresh"
                  onClick={() => void handleRefreshEbaySolds()}
                  disabled={ebaySoldRefreshing}
                >
                  {ebaySoldRefreshing ? 'Refreshing…' : 'Refresh from eBay'}
                </button>
              </div>
            )}
          </section>
        )}
        {brandTagBrandId !== '' && (
          <section
            className="brand-research-example-pricing"
            aria-labelledby="brand-research-brand-new-prices-title"
          >
            <div className="brand-research-reference-links-header">
              <h3 id="brand-research-brand-new-prices-title" className="brand-research-sales-heading">
                Brand New Prices
              </h3>
              {(brandExamplePricing.length > 0 || brandExamplePricingAddOpen) && (
                <button
                  type="button"
                  className="brand-research-reference-links-add-btn"
                  onClick={() => {
                    setBrandExamplePricingError(null);
                    setBrandExamplePricingAddOpen((o) => !o);
                  }}
                  aria-expanded={brandExamplePricingAddOpen}
                >
                  {brandExamplePricingAddOpen ? 'Cancel' : 'Add'}
                </button>
              )}
            </div>
            {brandExamplePricingError && (
              <div className="brand-tag-examples-error brand-research-reference-links-error" role="alert">
                {brandExamplePricingError}
              </div>
            )}
            {brandExamplePricingAddOpen && (
              <div className="brand-research-reference-links-form brand-research-example-pricing-form">
                <label className="brand-research-reference-links-field">
                  <span>Item</span>
                  <input
                    type="text"
                    value={brandExamplePricingItemDraft}
                    onChange={(e) => setBrandExamplePricingItemDraft(e.target.value)}
                    placeholder="e.g. Jeans, Polo shirt"
                    maxLength={500}
                    autoComplete="off"
                    disabled={brandExamplePricingSaving}
                  />
                </label>
                <label className="brand-research-reference-links-field">
                  <span>Price (£)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={brandExamplePricingPriceDraft}
                    onChange={(e) => setBrandExamplePricingPriceDraft(e.target.value)}
                    placeholder="e.g. 100 or 29.99"
                    autoComplete="off"
                    disabled={brandExamplePricingSaving}
                  />
                </label>
                <button
                  type="button"
                  className="brand-research-reference-links-save"
                  onClick={() => void handleSaveBrandExamplePricing()}
                  disabled={
                    brandExamplePricingSaving ||
                    !brandExamplePricingItemDraft.trim() ||
                    !brandExamplePricingPriceDraft.trim()
                  }
                >
                  {brandExamplePricingSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}
            {brandExamplePricingLoading && (
              <p className="brand-tag-examples-muted">Loading Brand New Prices…</p>
            )}
            {!brandExamplePricingLoading &&
              brandExamplePricing.length === 0 &&
              !brandExamplePricingAddOpen && (
                <button
                  type="button"
                  className="brand-research-example-pricing-empty-cta"
                  onClick={() => {
                    setBrandExamplePricingError(null);
                    setBrandExamplePricingAddOpen(true);
                  }}
                >
                  Add brand new price
                </button>
              )}
            {!brandExamplePricingLoading && brandExamplePricing.length > 0 && (
              <div className="brand-research-sales-table-scroll brand-research-example-pricing-table-wrap">
                <table className="brand-research-sales-table">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Price</th>
                      <th className="brand-research-example-pricing-th-actions" scope="col">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandExamplePricing.map((row) => (
                      <tr key={row.id}>
                        <td className="brand-research-sales-cell-name">{row.item_name}</td>
                        <td>{formatResearchCurrency(row.price_gbp)}</td>
                        <td className="brand-research-example-pricing-td-actions">
                          <button
                            type="button"
                            className="brand-research-example-pricing-remove"
                            onClick={() => void handleDeleteBrandExamplePricing(row.id)}
                            disabled={brandExamplePricingDeletingId === row.id}
                            aria-label={`Remove ${row.item_name}`}
                          >
                            {brandExamplePricingDeletingId === row.id ? '…' : 'Remove'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {brandTagBrandId !== '' && (
          <section
            className="brand-research-reference-links"
            aria-labelledby="brand-research-useful-links-title"
          >
            <div className="brand-research-reference-links-header">
              <h3 id="brand-research-useful-links-title" className="brand-research-sales-heading">
                Useful Links
              </h3>
              <button
                type="button"
                className="brand-research-reference-links-add-btn"
                onClick={() => {
                  setBrandRefLinksError(null);
                  setBrandRefLinksAddOpen((o) => !o);
                }}
                aria-expanded={brandRefLinksAddOpen}
              >
                {brandRefLinksAddOpen ? 'Cancel' : 'Add link'}
              </button>
            </div>
            {brandRefLinksError && (
              <div className="brand-tag-examples-error brand-research-reference-links-error" role="alert">
                {brandRefLinksError}
              </div>
            )}
            {brandRefLinksAddOpen && (
              <div className="brand-research-reference-links-form">
                <label className="brand-research-reference-links-field">
                  <span>URL</span>
                  <input
                    type="text"
                    inputMode="url"
                    value={brandRefLinkUrlDraft}
                    onChange={(e) => setBrandRefLinkUrlDraft(e.target.value)}
                    placeholder="https://…"
                    autoComplete="off"
                    disabled={brandRefLinksSaving}
                  />
                </label>
                <label className="brand-research-reference-links-field">
                  <span>Link text</span>
                  <input
                    type="text"
                    value={brandRefLinkTextDraft}
                    onChange={(e) => setBrandRefLinkTextDraft(e.target.value)}
                    placeholder="Optional label (shown instead of URL)"
                    maxLength={500}
                    autoComplete="off"
                    disabled={brandRefLinksSaving}
                  />
                </label>
                <button
                  type="button"
                  className="brand-research-reference-links-save"
                  onClick={() => void handleSaveBrandRefLink()}
                  disabled={brandRefLinksSaving || !brandRefLinkUrlDraft.trim()}
                >
                  {brandRefLinksSaving ? 'Saving…' : 'Save link'}
                </button>
              </div>
            )}
            {brandRefLinksLoading && (
              <p className="brand-tag-examples-muted">Loading links…</p>
            )}
            {!brandRefLinksLoading && brandRefLinks.length === 0 && !brandRefLinksAddOpen && (
              <p className="brand-research-sales-empty">No saved links yet.</p>
            )}
            {!brandRefLinksLoading && brandRefLinks.length > 0 && (
              <ul className="brand-research-reference-links-list">
                {brandRefLinks.map((link) => (
                  <li key={link.id} className="brand-research-reference-links-item">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="brand-research-reference-links-anchor"
                    >
                      {link.link_text?.trim() ? link.link_text.trim() : link.url}
                    </a>
                    <span className="brand-research-reference-links-date">
                      {formatResearchShortDate(link.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
        </div>
      )}

      {/* Brand Offline Research (offline reference + lookup) */}
      {researchTab === 'offline' && (
        <div
          id="research-panel-offline"
          role="tabpanel"
          aria-labelledby="research-tab-offline"
          className="research-tab-panel"
        >
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
                    const brandLabel = (selectedBrand.brand_name ?? '').trim();
                    const visitLabel = brandLabel
                      ? `Visit ${brandLabel} Website`
                      : 'Visit Website';
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
                            aria-label={
                              brandLabel ? `Visit ${brandLabel} website` : 'Visit website'
                            }
                          >
                            {visitLabel}
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
        </div>
      )}

      {/* AI Research Section */}
      {researchTab === 'ai' && (
        <div
          id="research-panel-ai"
          role="tabpanel"
          aria-labelledby="research-tab-ai"
          className="research-tab-panel"
        >
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
      )}

      {researchTab === 'menswear-categories' && (
        <div
          id="research-panel-menswear-categories"
          role="tabpanel"
          aria-labelledby="research-tab-menswear-categories"
          className="research-tab-panel"
        >
          <div
            className={
              'menswear-categories-page' +
              (selectedMenswearCategory ? ' menswear-categories-page--category-dock' : '') +
              (showMenswearCategoriesSplit ? ' menswear-categories-page--split' : '') +
              (selectedMenswearCategory && !showMenswearCategoriesSplit
                ? ' menswear-categories-page--detail-split'
                : '')
            }
          >
            {menswearAskAiHint ? (
              <p
                className={`menswear-categories-ask-ai-hint${menswearAskAiHint.startsWith('Copied') ? '' : ' menswear-categories-ask-ai-hint--error'}`}
                role="status"
              >
                {menswearAskAiHint}
              </p>
            ) : null}

            {menswearCategoriesError && (
              <div className="menswear-categories-error" role="alert">
                {menswearCategoriesError}
              </div>
            )}

            {menswearCategoriesLoading && (
              <div className="menswear-categories-muted">Loading categories…</div>
            )}

            {showMenswearCategoriesSplit && (
              <div className="menswear-categories-split">
                <div className="menswear-categories-split-left">
                  <ul className="menswear-categories-list">
                    {menswearCategories.length === 0 ? (
                      <li className="menswear-categories-empty">No categories found.</li>
                    ) : (
                      menswearCategories.map((cat) => (
                        <li key={cat.id} className="menswear-categories-list-item">
                          <button
                            type="button"
                            className="menswear-categories-card"
                            onClick={() => openMenswearCategoryInUrl(cat.id)}
                          >
                            <span className="menswear-categories-card-name">{cat.name}</span>
                            {cat.description ? (
                              <span className="menswear-categories-card-desc">{cat.description}</span>
                            ) : null}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                  <div className="menswear-categories-split-ask-ai-wrap">
                    <button
                      type="button"
                      className="menswear-categories-ask-ai-btn"
                      disabled={menswearAskAiBusy}
                      onClick={() => void runMenswearAllCategoriesAskAi()}
                      aria-label="Copy Ask RI prompt to review clothing category sales focus"
                    >
                      Ask RI - Review This Selection
                    </button>
                  </div>
                </div>
                <div className="menswear-categories-split-right">{renderMenswearSalesPie()}</div>
              </div>
            )}

            {!menswearCategoriesLoading && menswearCategoryIdFromUrl !== null && selectedMenswearCategory && (
              <div className="menswear-categories-detail-category">
                <header className="menswear-categories-detail-header">
                  <h3 className="menswear-categories-detail-title">{selectedMenswearCategory.name}</h3>
                  {selectedMenswearCategory.description ? (
                    <p className="menswear-categories-detail-desc">{selectedMenswearCategory.description}</p>
                  ) : null}
                  {selectedMenswearCategory.notes ? (
                    <p className="menswear-categories-detail-notes">
                      <strong>Notes:</strong> {selectedMenswearCategory.notes}
                    </p>
                  ) : null}
                </header>
                <div className="menswear-categories-detail-split">
                  <div className="menswear-categories-detail-split-brands">
                    <div className="menswear-categories-detail">
                      <div className="menswear-categories-sort-bar menswear-categories-sort-bar--icons">
                        <div className="menswear-categories-sort-menu-wrap" ref={menswearBrandSortMenuRef}>
                          <button
                            type="button"
                            className={`menswear-categories-icon-circle-btn menswear-categories-filter-sort-btn${menswearBrandSortMenuOpen ? ' menswear-categories-icon-circle-btn--active' : ''}`}
                            aria-expanded={menswearBrandSortMenuOpen}
                            aria-haspopup="listbox"
                            aria-label="Sort brands: by total sales or alphabetical"
                            onClick={() => setMenswearBrandSortMenuOpen((o) => !o)}
                          >
                            <svg
                              className="menswear-categories-icon-circle-svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden={true}
                            >
                              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                            </svg>
                          </button>
                          {menswearBrandSortMenuOpen ? (
                            <ul
                              className="menswear-categories-sort-menu"
                              role="listbox"
                              aria-label="Sort brands"
                            >
                              <li role="presentation">
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={menswearBrandSort === 'total_sales'}
                                  className={`menswear-categories-sort-menu-option${menswearBrandSort === 'total_sales' ? ' menswear-categories-sort-menu-option--active' : ''}`}
                                  onClick={() => {
                                    setMenswearBrandSort('total_sales');
                                    setMenswearBrandSortMenuOpen(false);
                                  }}
                                >
                                  By total sales
                                </button>
                              </li>
                              <li role="presentation">
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={menswearBrandSort === 'name'}
                                  className={`menswear-categories-sort-menu-option${menswearBrandSort === 'name' ? ' menswear-categories-sort-menu-option--active' : ''}`}
                                  onClick={() => {
                                    setMenswearBrandSort('name');
                                    setMenswearBrandSortMenuOpen(false);
                                  }}
                                >
                                  Alphabetical
                                </button>
                              </li>
                            </ul>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="menswear-categories-icon-circle-btn menswear-categories-add-brand-circle-btn"
                          onClick={() => {
                            setMenswearAddBrandError(null);
                            setMenswearBrandSortMenuOpen(false);
                            setMenswearAddBrandOpen((o) => !o);
                          }}
                          aria-expanded={menswearAddBrandOpen}
                          aria-label={
                            menswearAddBrandOpen
                              ? `Close add brand to ${selectedMenswearCategory.name}`
                              : `Add brand to ${selectedMenswearCategory.name}`
                          }
                        >
                          <svg
                            className="menswear-categories-icon-circle-svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.25"
                            strokeLinecap="round"
                            aria-hidden={true}
                          >
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                        </button>
                      </div>

                      {menswearAddBrandOpen && (
                        <div className="menswear-categories-add-panel">
                          <input
                            id="menswear-add-brand-search"
                            type="search"
                            className="menswear-categories-add-search"
                            aria-label="Search brands"
                            placeholder="Search brands…"
                            value={menswearAddBrandSearch}
                            onChange={(e) => setMenswearAddBrandSearch(e.target.value)}
                            autoComplete="off"
                            disabled={menswearAddBrandSaving}
                          />
                          {!brandsLoaded && (
                            <p className="menswear-categories-muted">Loading brands…</p>
                          )}
                          {brandsLoaded && brandsApiError && (
                            <p className="menswear-categories-error menswear-categories-error--inline" role="alert">
                              {brandsApiError}
                            </p>
                          )}
                          {menswearAddBrandError && (
                            <p className="menswear-categories-error menswear-categories-error--inline" role="alert">
                              {menswearAddBrandError}
                            </p>
                          )}
                          {brandsLoaded && !brandsApiError && (
                            <ul className="menswear-categories-add-list" role="listbox" aria-label="Brands">
                              {menswearAddBrandCandidates.length === 0 ? (
                                <li className="menswear-categories-empty">No matching brands.</li>
                              ) : (
                                menswearAddBrandCandidates.map((b) => {
                                  const inCategory =
                                    b.menswear_category_id != null &&
                                    b.menswear_category_id === menswearCategoryIdFromUrl;
                                  return (
                                    <li key={b.id}>
                                      <button
                                        type="button"
                                        role="option"
                                        aria-selected={false}
                                        className={`menswear-categories-add-row${inCategory ? ' menswear-categories-add-row--current' : ''}`}
                                        disabled={menswearAddBrandSaving || inCategory}
                                        onClick={() => void assignBrandToMenswearCategory(b.id)}
                                      >
                                        <span>{b.brand_name}</span>
                                        {inCategory ? (
                                          <span className="menswear-categories-add-row-hint">In this category</span>
                                        ) : null}
                                      </button>
                                    </li>
                                  );
                                })
                              )}
                            </ul>
                          )}
                          <button
                            type="button"
                            className="menswear-categories-add-cancel"
                            onClick={() => {
                              setMenswearAddBrandOpen(false);
                              setMenswearAddBrandSearch('');
                              setMenswearAddBrandError(null);
                            }}
                            disabled={menswearAddBrandSaving}
                          >
                            Close
                          </button>
                        </div>
                      )}

                      {menswearCategoryBrandsError && (
                        <div className="menswear-categories-error" role="alert">
                          {menswearCategoryBrandsError}
                        </div>
                      )}
                      {menswearCategoryBrandsLoading && (
                        <div className="menswear-categories-muted">Loading brands…</div>
                      )}

                      {!menswearCategoryBrandsLoading && !menswearCategoryBrandsError && (
                        <ul className="menswear-categories-brands">
                          {menswearCategoryBrands.length === 0 ? (
                            <li className="menswear-categories-empty">No brands in this category yet.</li>
                          ) : (
                            menswearCategoryBrands.map((b) => {
                              const salesNum =
                                typeof b.total_sales === 'number'
                                  ? b.total_sales
                                  : parseFloat(String(b.total_sales)) || 0;
                              return (
                                <li key={b.id} className="menswear-categories-brand-row">
                                  <Link
                                    className="menswear-categories-brand-link"
                                    to={`/research?brand=${encodeURIComponent(String(b.id))}`}
                                  >
                                    {b.brand_name || '—'}
                                  </Link>
                                  {menswearBrandSort === 'total_sales' && (
                                    <span className="menswear-categories-brand-sales">
                                      {formatResearchCurrency(salesNum)}
                                    </span>
                                  )}
                                </li>
                              );
                            })
                          )}
                        </ul>
                      )}

                      <div className="menswear-categories-brands-footer">
                        <button
                          type="button"
                          className="menswear-categories-ask-ai-btn"
                          disabled={menswearAskAiBusy}
                          onClick={() =>
                            selectedMenswearCategory &&
                            void runMenswearAskAi({
                              cat: selectedMenswearCategory,
                              brands:
                                !menswearCategoryBrandsLoading && !menswearCategoryBrandsError
                                  ? menswearCategoryBrands
                                  : undefined,
                            })
                          }
                          aria-label="Copy Ask RI prompt for this category and its brands"
                        >
                          Ask RI - Review This Selection
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="menswear-categories-detail-split-chart">{renderMenswearSalesPie()}</div>
                </div>
              </div>
            )}

            {!menswearCategoriesLoading &&
              menswearCategoryIdFromUrl !== null &&
              !selectedMenswearCategory && (
                <div className="menswear-categories-detail">
                  <p className="menswear-categories-muted">
                    That category is no longer in the list. Choose another or refresh.
                  </p>
                </div>
              )}

            {selectedMenswearCategory && (
              <div className="menswear-categories-category-dock" role="region" aria-label="Current category">
                <div className="menswear-categories-category-dock-inner">
                  <p className="menswear-categories-category-dock-current">
                    <span className="menswear-categories-category-dock-label">Current category</span>
                    <span className="menswear-categories-category-dock-name">{selectedMenswearCategory.name}</span>
                  </p>
                  <button
                    type="button"
                    className="menswear-categories-read-aloud-btn"
                    onClick={() => speakMenswearCategoryAloud(selectedMenswearCategory)}
                  >
                    Read aloud
                  </button>
                </div>
              </div>
            )}

            {!showMenswearCategoriesSplit &&
            !(menswearCategoryIdFromUrl !== null && selectedMenswearCategory) ? (
              renderMenswearSalesPie()
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

export default Research;


