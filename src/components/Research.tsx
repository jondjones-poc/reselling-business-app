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

/** Absolute app path so links work even if `location.pathname` is wrong in dev/proxy setups. */
function clothingTypesDetailHref(
  clothingTypeId: string | number,
  departmentId?: number | null
): string {
  const qs = new URLSearchParams();
  qs.set('tab', 'clothing-types');
  if (departmentId != null && departmentId >= 1) {
    qs.set('departmentId', String(departmentId));
  }
  qs.set('clothingTypeId', String(clothingTypeId));
  return `/research?${qs.toString()}`;
}

function clothingTypesBrandDetailHref(
  clothingTypeId: string | number,
  brandId: number,
  departmentId?: number | null
): string {
  const qs = new URLSearchParams();
  qs.set('tab', 'clothing-types');
  if (departmentId != null && departmentId >= 1) {
    qs.set('departmentId', String(departmentId));
  }
  qs.set('clothingTypeId', String(clothingTypeId));
  qs.set('clothingTypeBrandId', String(brandId));
  return `/research?${qs.toString()}`;
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
    `I'm a UK menswear reseller (second-hand / resale). I use a **brand-first categorization** system: each **brand** is assigned to one **menswear category** (a resale research bucket). Stock lines inherit that category through their brand — I do not tag every SKU with a separate menswear label.`,
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
    `I'm a UK menswear reseller (second-hand / resale). My app uses **menswear categories** as a **brand-first** taxonomy: I map each **brand** to exactly one category for how I research and group resale; individual items inherit that bucket via their brand, not via per-item menswear tags.`,
    ``,
    `Below is my **full current list** of category buckets (name, description, and my notes where I have them). When you review naming and gaps, assume categories are primarily **containers for brands**, not a full parallel garment-level taxonomy on every line.`,
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
    `1. **Taxonomy review (brand-first)** — Am I missing important buckets a UK reseller would use to **group brands**? Any overlaps where two categories should merge, or names that imply garment-level tagging when I only assign **brands**?`,
    `2. **Naming** — Are any names ambiguous or easy to confuse? Suggest clearer labels if needed.`,
    `3. **Gaps** — For resale sourcing (Vinted, eBay, charity shops), what adjacent categories or sub-themes might I want to track separately?`,
    `4. **Optional** — If useful, suggest a short **priority order** for which gaps to fix first.`,
    ``,
    `Tone: direct, practical. Work from the list above; don’t invent categories I already listed under different wording.`,
    `Today’s date context: ${new Date().toISOString().slice(0, 10)}.`
  );

  return lines.join('\n');
}

function formatResearchShortDate(isoOrDate: string | null): string {
  if (!isoOrDate) return '—';
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function researchVintedItemUrl(id: string): string {
  return `https://www.vinted.co.uk/items/${encodeURIComponent(id.trim())}`;
}

function researchEbayItemUrl(id: string): string {
  return `https://www.ebay.co.uk/itm/${encodeURIComponent(id.trim())}`;
}

type AvoidStockAskAiSummaryRow = {
  brand_id: number;
  brand_name: string;
  category_name: string;
  category_id: number | null;
  unsold_count: number;
  sold_count: number;
};

type AvoidStockAskAiItem = {
  id: number;
  item_name: string | null;
  purchase_price: string | number | null;
  purchase_date: string | null;
  vinted_id: string | null;
  ebay_id: string | null;
};

/** Sold ÷ (sold + unsold) for this brand×category — i.e. share of units that sold vs total units in the data. */
function avoidStockSellRateDecimal(unsold: number, sold: number): number {
  const u = Math.max(0, unsold);
  const s = Math.max(0, sold);
  const t = u + s;
  if (t <= 0) return 0;
  return s / t;
}

function formatAvoidStockSellRateLabel(unsold: number, sold: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'percent',
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(avoidStockSellRateDecimal(unsold, sold));
}

function pickWorstThreeAvoidStockRows(rows: AvoidStockAskAiSummaryRow[]): AvoidStockAskAiSummaryRow[] {
  if (rows.length === 0) return [];
  const rate = (r: AvoidStockAskAiSummaryRow) =>
    avoidStockSellRateDecimal(r.unsold_count, r.sold_count);
  return [...rows]
    .sort((a, b) => {
      const ra = rate(a);
      const rb = rate(b);
      if (ra !== rb) return ra - rb;
      return b.unsold_count - a.unsold_count;
    })
    .slice(0, 3);
}

function formatAvoidStockAskAiItemLine(it: AvoidStockAskAiItem): string {
  const title = (it.item_name ?? '').trim() || '—';
  const priceNum =
    it.purchase_price != null && it.purchase_price !== ''
      ? typeof it.purchase_price === 'number'
        ? it.purchase_price
        : parseFloat(String(it.purchase_price))
      : NaN;
  const price = Number.isFinite(priceNum) ? formatResearchCurrency(priceNum) : '—';
  const date = formatResearchShortDate(it.purchase_date);
  const v = it.vinted_id?.trim() ? researchVintedItemUrl(it.vinted_id.trim()) : null;
  const e = it.ebay_id?.trim() ? researchEbayItemUrl(it.ebay_id.trim()) : null;
  const linkBits = [v ? `Vinted: ${v}` : null, e ? `eBay: ${e}` : null].filter(Boolean);
  const links = linkBits.length > 0 ? linkBits.join(' | ') : 'no listing links';
  const days = daysSincePurchase(it.purchase_date);
  const daysStr = days === null ? '—' : `${days} days in stock`;
  return `- **${title}** | ${price} | purchased ${date} | ${daysStr} | ${links}`;
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

/** Whole days from purchase date to sale date (for sold lines). */
function daysHeldUntilSale(purchaseIso: string | null, saleIso: string | null): number | null {
  if (!purchaseIso || !saleIso) return null;
  const p = new Date(purchaseIso);
  const s = new Date(saleIso);
  if (Number.isNaN(p.getTime()) || Number.isNaN(s.getTime())) return null;
  return Math.max(0, Math.floor((s.getTime() - p.getTime()) / 86400000));
}

function buildMenswearAvoidStockAskAiPrompt(args: {
  menswearCategoryName: string;
  worstRows: AvoidStockAskAiSummaryRow[];
  itemRowsPerWorst: AvoidStockAskAiItem[][];
}): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `I'm a UK menswear reseller (second-hand / resale). I use **brand-first** **menswear category** buckets: brands are assigned to a category; the tables below are for brands linked to this bucket, then broken down by **stock category** (garment type on the line item).`,
    ``,
    `**Menswear bucket:** **${args.menswearCategoryName}**`,
    ``,
    `Below I focus on the **three worst-performing combinations** in my system: **brand × stock category** (among brands I’ve linked to this menswear bucket), ranked by **lowest sell rate** — **sold ÷ (sold + unsold)** for that pair (share of units that have sold vs all units in my data for that brand × category).`,
    ``,
    `## Summary — worst 3`,
    ``,
  ];

  args.worstRows.forEach((r, i) => {
    const sold = r.sold_count;
    const sellRateLabel = formatAvoidStockSellRateLabel(r.unsold_count, sold);
    lines.push(
      `${i + 1}. **${r.brand_name}** — **${r.category_name}** | No. in stock: ${r.unsold_count} | Sold: ${sold} | Sell rate: ${sellRateLabel}`
    );
  });
  lines.push(``);

  args.worstRows.forEach((r, i) => {
    const items = args.itemRowsPerWorst[i] ?? [];
    lines.push(`## ${i + 1}. ${r.brand_name} — ${r.category_name}`);
    lines.push(
      `*(Unsold ${r.unsold_count} / sold ${r.sold_count} in my system for this pair.)*`,
      ``,
      `**Unsold lines (one row per item still in stock):**`,
      ``
    );
    if (items.length === 0) {
      lines.push(`*(No line items returned — treat summary as above.)*`, ``);
    } else {
      items.forEach((it) => lines.push(formatAvoidStockAskAiItemLine(it)));
      lines.push(``);
    }
  });

  lines.push(
    `## What I need from you`,
    `1. **Why are these not selling** for me (or selling so slowly compared to what I’ve sold in the same brand × category)?`,
    `2. **What am I missing** — pricing, season, fit, sizing, colour, category choice, brand tier, listing quality, platform mix, or something else?`,
    `3. **How could I have found better options** when sourcing this space — what should I look for next time (filters, comps, eras, product lines, condition signals)?`,
    `4. **In general**, should **items like these** typically move in UK resale — or is the problem more likely **my selection**, **timing**, or **execution** than the category being “unsellable”?`,
    ``,
    `Tone: direct, practical. Date: ${dateStr}.`
  );

  return lines.join('\n');
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

/** Month chips for a meteorological season (winter = Dec–Feb). Labels use local calendar. */
function buildMeteorologicalSeasonMonthCells(
  seasonKey: string,
  refYear: number
): { year: number; month: number; label: string }[] {
  const short = new Intl.DateTimeFormat('en-GB', { month: 'short' });
  const add = (year: number, month: number) => ({
    year,
    month,
    label: short.format(new Date(year, month - 1, 1)),
  });
  switch (seasonKey) {
    case 'spring':
      return [add(refYear, 3), add(refYear, 4), add(refYear, 5)];
    case 'summer':
      return [add(refYear, 6), add(refYear, 7), add(refYear, 8)];
    case 'autumn':
      return [add(refYear, 9), add(refYear, 10), add(refYear, 11)];
    case 'winter':
      return [add(refYear, 12), add(refYear + 1, 1), add(refYear + 1, 2)];
    default:
      return [];
  }
}

/** Decorative season glyph above each column title (matches `seasonKey` from API). */
function SeasonalInsightSeasonIcon({ seasonKey }: { seasonKey: string }) {
  const sw = 2;
  const svgProps = {
    className: 'research-seasonal-season-icon-svg',
    viewBox: '0 0 48 48',
    fill: 'none' as const,
    'aria-hidden': true as const,
  };
  switch (seasonKey) {
    case 'spring':
      return (
        <svg {...svgProps}>
          <path
            d="M24 40V26M24 26Q14 20 11 12M24 26Q34 20 37 12M24 22Q24 12 24 8"
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'summer':
      return (
        <svg {...svgProps}>
          <circle cx="24" cy="24" r="9" stroke="currentColor" strokeWidth={sw} />
          <path
            d="M24 5v5M24 38v5M5 24h5M38 24h5M10 10l4 4M34 10l-4 4M10 38l4-4M34 38l-4-4"
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </svg>
      );
    case 'autumn':
      return (
        <svg {...svgProps}>
          <path
            d="M24 8c10 8 14 20 0 32C10 28 14 16 24 8zM24 40v4"
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M24 18c-4 6-4 12 0 14"
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </svg>
      );
    case 'winter':
      return (
        <svg {...svgProps}>
          <g
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
            transform="translate(24 24)"
          >
            <line x1="0" y1="-15" x2="0" y2="15" />
            <line x1="0" y1="-15" x2="0" y2="15" transform="rotate(60)" />
            <line x1="0" y1="-15" x2="0" y2="15" transform="rotate(-60)" />
            <circle cx="0" cy="0" r="3" fill="currentColor" stroke="none" />
          </g>
        </svg>
      );
    default:
      return (
        <svg {...svgProps}>
          <circle cx="24" cy="24" r="14" stroke="currentColor" strokeWidth={sw} />
        </svg>
      );
  }
}

/** Decorative glyph for Research → Sourced tab (`sourceKey` from API). */
function SourcedLocationInsightIcon({ sourceKey }: { sourceKey: string }) {
  const sw = 2;
  const svgProps = {
    className: 'research-sourced-source-icon-svg',
    viewBox: '0 0 48 48',
    fill: 'none' as const,
    'aria-hidden': true as const,
  };
  switch (sourceKey) {
    case 'charity_shop':
      return (
        <svg {...svgProps}>
          <path
            d="M24 38c-8-6-14-12-14-19a7 7 0 0 1 13-3 1 1 0 0 0 2 0 7 7 0 0 1 13 3c0 7-6 13-14 19z"
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'bootsale':
      return (
        <svg {...svgProps}>
          <path
            d="M14 32h22l-2-10H16l-2 10zM18 22l3-12h6l3 12"
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M12 32h26" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
        </svg>
      );
    case 'online_flip':
      return (
        <svg {...svgProps}>
          <path
            d="M14 18h12v-6M26 12l4 4-4 4M34 30H22v6m12-6-4-4 4-4"
            stroke="currentColor"
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="10" y="16" width="28" height="16" rx="3" stroke="currentColor" strokeWidth={sw} />
        </svg>
      );
    default:
      return (
        <svg {...svgProps}>
          <circle cx="24" cy="24" r="14" stroke="currentColor" strokeWidth={sw} />
        </svg>
      );
  }
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
  /** Optional notes shown under website/stock links on Brand research. */
  description: string | null;
  /** From GET /api/brands when column exists. */
  menswear_category_id: number | null;
  /** From GET /api/brands when column exists. */
  department_id?: number | null;
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

/** Per stock category within a brand: sold vs unsold money and aggregate sales multiple (Σ sale ÷ Σ buy on sold lines). */
type BrandStockCategoryMoneyRow = {
  categoryId: number;
  categoryName: string;
  totalSoldValue: number;
  totalUnsoldValue: number;
  totalProfit: number;
  salesMultiple: number | null;
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
  bestSoldByCategory: BrandStockCategoryMoneyRow[];
  heavyUnsoldByCategory: BrandStockCategoryMoneyRow[];
  /** Per inventory category: sold vs not-sold counts for this brand. */
  categorySoldUnsold: BrandCategorySoldUnsoldRow[];
};

function BrandStockSpendSoldNetTotals({
  summary,
  extendedMetrics = false,
}: {
  summary: BrandStockSummaryPayload;
  extendedMetrics?: boolean;
}) {
  const totalListed = summary.soldCount + summary.unsoldCount;
  const sellThroughPct = totalListed > 0 ? (summary.soldCount / totalListed) * 100 : null;
  const showAvgBand =
    summary.soldCount > 0 &&
    summary.minSoldSalePrice != null &&
    summary.maxSoldSalePrice != null;
  const minP = summary.minSoldSalePrice;
  const maxP = summary.maxSoldSalePrice;

  const sellThroughDisplay = (() => {
    const pctStr =
      sellThroughPct != null
        ? `${
            Math.abs(sellThroughPct - Math.round(sellThroughPct)) < 0.05
              ? Math.round(sellThroughPct)
              : sellThroughPct.toFixed(1)
          }%`
        : null;
    const multStr =
      summary.avgSoldProfitMultiple != null
        ? formatSoldMultipleDisplay(summary.avgSoldProfitMultiple)
        : null;
    if (pctStr && multStr) return `${pctStr} / ${multStr}`;
    if (pctStr) return pctStr;
    if (multStr) return multStr;
    return '—';
  })();

  if (extendedMetrics) {
    const sellRatioDisplay =
      totalListed > 0 ? `${summary.soldCount} / ${totalListed}` : '—';

    return (
      <div
        className="brand-research-brand-sales-metrics"
        aria-label="Brand spend, counts, sell ratio, sell-through, and average sale price"
      >
        <div className="brand-research-brand-totals brand-research-brand-totals--sales-metrics-eight">
          <div className="brand-research-brand-totals-col">
            <span className="brand-research-brand-totals-label">Total spent</span>
            <span className="brand-research-brand-totals-value">
              {formatResearchCurrency(summary.totalPurchaseSpend)}
            </span>
            <span className="brand-research-brand-totals-hint">All items with a purchase price</span>
          </div>
          <div className="brand-research-brand-totals-col">
            <span className="brand-research-brand-totals-label">Total sold</span>
            <span className="brand-research-brand-totals-value">
              {formatResearchCurrency(summary.totalSoldRevenue)}
            </span>
            <span className="brand-research-brand-totals-hint">Sale prices for sold items</span>
          </div>
          <div className="brand-research-brand-totals-col">
            <span className="brand-research-brand-totals-label">Net</span>
            <span
              className={
                'brand-research-brand-totals-value brand-research-brand-totals-value--net ' +
                (summary.brandNetPosition > 0
                  ? 'brand-research-brand-totals-value--profit'
                  : summary.brandNetPosition < 0
                    ? 'brand-research-brand-totals-value--loss'
                    : 'brand-research-brand-totals-value--even')
              }
            >
              {summary.brandNetPosition > 0
                ? `Profit ${formatResearchCurrency(summary.brandNetPosition)}`
                : summary.brandNetPosition < 0
                  ? `£-${new Intl.NumberFormat('en-GB', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }).format(Math.abs(summary.brandNetPosition))}`
                  : formatResearchCurrency(0)}
            </span>
            <span className="brand-research-brand-totals-hint">Sold revenue − all spend</span>
          </div>
          <div className="brand-research-brand-totals-col">
            <span className="brand-research-brand-totals-label">Avg sale price</span>
            <span className="brand-research-brand-totals-value brand-research-brand-totals-value--multiline">
              {showAvgBand && minP != null && maxP != null ? formatAveragedSaleBand(minP, maxP) : '—'}
            </span>
            <span className="brand-research-brand-totals-hint">per sale</span>
          </div>
          <hr className="brand-research-brand-metrics-row-divider" aria-hidden="true" />
          <div className="brand-research-brand-totals-col">
            <span className="brand-research-brand-totals-label">In stock</span>
            <span className="brand-research-brand-totals-value">{summary.unsoldCount}</span>
            <span className="brand-research-brand-totals-hint">Items not sold yet</span>
          </div>
          <div className="brand-research-brand-totals-col">
            <span className="brand-research-brand-totals-label">Sold items</span>
            <span className="brand-research-brand-totals-value">{summary.soldCount}</span>
            <span className="brand-research-brand-totals-hint">Items with a sale recorded</span>
          </div>
          <div className="brand-research-brand-totals-col">
            <span className="brand-research-brand-totals-label">Sell ratio</span>
            <span className="brand-research-brand-totals-value brand-research-brand-totals-value--multiline">
              {sellRatioDisplay}
            </span>
            <span className="brand-research-brand-totals-hint">Sales ÷ items listed</span>
          </div>
          <div className="brand-research-brand-totals-col">
            <span className="brand-research-brand-totals-label">Sell-through</span>
            <span className="brand-research-brand-totals-value brand-research-brand-totals-value--multiline">
              {sellThroughDisplay}
            </span>
            <span className="brand-research-brand-totals-hint">
              {summary.avgSoldProfitMultiple != null
                ? 'Listed sell-through · avg sale ÷ buy'
                : 'Listed sell-through · add buy prices for avg ×'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="brand-research-brand-totals" aria-label="Brand spend and sales totals">
      <div className="brand-research-brand-totals-col">
        <span className="brand-research-brand-totals-label">Total spent</span>
        <span className="brand-research-brand-totals-value">
          {formatResearchCurrency(summary.totalPurchaseSpend)}
        </span>
        <span className="brand-research-brand-totals-hint">All items with a purchase price</span>
      </div>
      <div className="brand-research-brand-totals-col">
        <span className="brand-research-brand-totals-label">Total sold</span>
        <span className="brand-research-brand-totals-value">
          {formatResearchCurrency(summary.totalSoldRevenue)}
        </span>
        <span className="brand-research-brand-totals-hint">Sale prices for sold items</span>
      </div>
      <div className="brand-research-brand-totals-col">
        <span className="brand-research-brand-totals-label">Net</span>
        <span
          className={
            'brand-research-brand-totals-value brand-research-brand-totals-value--net ' +
            (summary.brandNetPosition > 0
              ? 'brand-research-brand-totals-value--profit'
              : summary.brandNetPosition < 0
                ? 'brand-research-brand-totals-value--loss'
                : 'brand-research-brand-totals-value--even')
          }
        >
          {summary.brandNetPosition > 0
            ? `Profit ${formatResearchCurrency(summary.brandNetPosition)}`
            : summary.brandNetPosition < 0
              ? `£-${new Intl.NumberFormat('en-GB', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(Math.abs(summary.brandNetPosition))}`
              : formatResearchCurrency(0)}
        </span>
        <span className="brand-research-brand-totals-hint">Sold revenue − all spend</span>
      </div>
    </div>
  );
}

function parseBrandStockSummaryPayload(data: unknown): BrandStockSummaryPayload {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid brand stock summary payload');
  }
  const d = data as Record<string, unknown>;
  const parseCategoryMoneyRow = (row: unknown): BrandStockCategoryMoneyRow | null => {
    if (!row || typeof row !== 'object') return null;
    const r = row as Record<string, unknown>;
    const categoryIdRaw = r.categoryId ?? r.category_id;
    const categoryNameRaw = r.categoryName ?? r.category_name;
    const totalSoldRaw = r.totalSoldValue ?? r.total_sold_value;
    const totalUnsoldRaw = r.totalUnsoldValue ?? r.total_unsold_value;
    const totalProfitRaw = r.totalProfit ?? r.total_profit;
    const multRaw = r.salesMultiple ?? r.sales_multiple;
    const categoryId =
      categoryIdRaw != null && Number.isFinite(Number(categoryIdRaw)) ? Number(categoryIdRaw) : 0;
    const categoryName =
      categoryNameRaw != null && String(categoryNameRaw).trim()
        ? String(categoryNameRaw)
        : 'Uncategorized';
    const totalSoldValue = totalSoldRaw != null && Number.isFinite(Number(totalSoldRaw)) ? Number(totalSoldRaw) : 0;
    const totalUnsoldValue =
      totalUnsoldRaw != null && Number.isFinite(Number(totalUnsoldRaw)) ? Number(totalUnsoldRaw) : 0;
    const totalProfit =
      totalProfitRaw != null && Number.isFinite(Number(totalProfitRaw)) ? Number(totalProfitRaw) : 0;
    const salesMultiple =
      multRaw != null && Number.isFinite(Number(multRaw)) ? Number(multRaw) : null;
    return {
      categoryId,
      categoryName,
      totalSoldValue,
      totalUnsoldValue,
      totalProfit,
      salesMultiple,
    };
  };

  const bestRaw = d.bestSoldByCategory ?? d.best_sold_by_category;
  const bestSoldByCategory: BrandStockCategoryMoneyRow[] = Array.isArray(bestRaw)
    ? bestRaw.map(parseCategoryMoneyRow).filter((x): x is BrandStockCategoryMoneyRow => x != null)
    : [];
  const heavyRaw = d.heavyUnsoldByCategory ?? d.heavy_unsold_by_category;
  const heavyUnsoldByCategory: BrandStockCategoryMoneyRow[] = Array.isArray(heavyRaw)
    ? heavyRaw.map(parseCategoryMoneyRow).filter((x): x is BrandStockCategoryMoneyRow => x != null)
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
    bestSoldByCategory,
    heavyUnsoldByCategory,
    categorySoldUnsold,
  };
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
    const description = parseOptionalBrandText(r.description);
    const mcRaw = r.menswear_category_id;
    let menswear_category_id: number | null = null;
    if (mcRaw !== null && mcRaw !== undefined && mcRaw !== '') {
      const n = typeof mcRaw === 'number' ? mcRaw : parseInt(String(mcRaw).trim(), 10);
      if (Number.isFinite(n) && n >= 1) menswear_category_id = n;
    }
    const depRaw = r.department_id;
    let department_id: number | null = null;
    if (depRaw !== null && depRaw !== undefined && depRaw !== '') {
      const dn = typeof depRaw === 'number' ? depRaw : parseInt(String(depRaw).trim(), 10);
      if (Number.isFinite(dn) && dn >= 1) department_id = dn;
    }
    out.push({
      id: idNum,
      brand_name,
      brand_website,
      things_to_buy,
      things_to_avoid,
      description,
      menswear_category_id,
      department_id,
    });
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

type BrandTagImageKind = 'tag' | 'fake_check' | 'logo';

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
    kindRaw === 'fake_check' || kindRaw === 'fake'
      ? 'fake_check'
      : kindRaw === 'logo'
        ? 'logo'
        : 'tag';
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
    const kindRank = (k: BrandTagImageKind) =>
      k === 'fake_check' ? 1 : k === 'logo' ? 2 : 0;
    const fa = kindRank(a.image_kind);
    const fb = kindRank(b.image_kind);
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

  const researchTab = useMemo<
    | 'brand'
    | 'offline'
    | 'ai'
    | 'menswear-categories'
    | 'clothing-types'
    | 'seasonal'
    | 'sourced'
  >(() => {
    const t = searchParams.get('tab');
    if (
      t === 'offline' ||
      t === 'ai' ||
      t === 'menswear-categories' ||
      t === 'clothing-types' ||
      t === 'seasonal' ||
      t === 'sourced'
    )
      return t;
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

  /** Sales by category + Sales by season: `?departmentId=` scopes data by business department. */
  const researchScopedDepartmentIdFromUrl = useMemo(() => {
    if (researchTab !== 'clothing-types' && researchTab !== 'seasonal') return null;
    const raw = searchParams.get('departmentId')?.trim();
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }, [researchTab, searchParams]);

  /** In Menswear category detail: `?menswearBrandId=` shows in-page inventory for that brand. */
  const menswearBrandIdFromUrl = useMemo(() => {
    if (researchTab !== 'menswear-categories' || menswearCategoryIdFromUrl == null) return null;
    const raw = searchParams.get('menswearBrandId')?.trim();
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }, [researchTab, menswearCategoryIdFromUrl, searchParams]);

  type ClothingTypeSelection = { mode: 'category'; id: number } | { mode: 'uncategorized' };

  const clothingTypeSelection = useMemo((): ClothingTypeSelection | null => {
    if (researchTab !== 'clothing-types') return null;
    const raw = searchParams.get('clothingTypeId')?.trim();
    if (!raw) return null;
    if (raw.toLowerCase() === 'uncategorized') return { mode: 'uncategorized' };
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return { mode: 'category', id: n };
    return null;
  }, [researchTab, searchParams]);

  const clothingTypeApiPathKey = useMemo(() => {
    if (!clothingTypeSelection) return null;
    return clothingTypeSelection.mode === 'uncategorized' ? 'uncategorized' : String(clothingTypeSelection.id);
  }, [clothingTypeSelection]);

  const clothingTypeBrandIdFromUrl = useMemo(() => {
    if (researchTab !== 'clothing-types' || clothingTypeSelection == null) return null;
    const raw = searchParams.get('clothingTypeBrandId')?.trim();
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }, [researchTab, clothingTypeSelection, searchParams]);

  const setResearchTab = useCallback(
    (
      tab:
        | 'brand'
        | 'offline'
        | 'ai'
        | 'menswear-categories'
        | 'clothing-types'
        | 'seasonal'
        | 'sourced'
    ) => {
      if (tab === 'brand') {
        brandTabInputUserEditRef.current = false;
        setBrandTagBrandId('');
        setBrandTabQuery('');
        setBrandTabTypeaheadOpen(false);
        setBrandCreateOpen(false);
        setBrandCreateError(null);
      }
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'brand') {
            next.delete('tab');
            next.delete('brand');
            next.delete('menswearCategoryId');
            next.delete('menswearBrandId');
            next.delete('departmentId');
            next.delete('clothingTypeId');
            next.delete('clothingTypeBrandId');
            next.delete('mcPanel');
          } else {
            next.set('tab', tab);
            if (tab !== 'clothing-types' && tab !== 'seasonal') {
              next.delete('departmentId');
            }
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  /** Menswear tab list: clears category/brand drill-down. */
  const goToMenswearCategoriesTab = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', 'menswear-categories');
        next.delete('menswearCategoryId');
        next.delete('menswearBrandId');
        next.delete('brand');
        return next;
      },
      { replace: false }
    );
  }, [setSearchParams]);

  const goToClothingTypesTab = useCallback(() => {
    window.location.assign('/research?tab=clothing-types');
  }, []);

  const openBrandResearchInUrl = useCallback(
    (brandId: number) => {
      const qs = new URLSearchParams();
      qs.set('brand', String(brandId));
      window.location.assign(`${location.pathname}?${qs.toString()}`);
    },
    [location.pathname]
  );

  const openMenswearBrandInventoryInUrl = useCallback(
    (brandId: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('menswearBrandId', String(brandId));
          return next;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const closeMenswearBrandInventoryInUrl = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('menswearBrandId');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const closeClothingTypeBrandInUrl = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('clothingTypeBrandId');
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);
  
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

  type SeasonalInsightsColumn = {
    seasonKey: string;
    refYear: number;
    displayLabel: string;
    rangeStart: string;
    rangeEnd: string;
    isCurrentSeason: boolean;
    topCategories: { name: string; count: number }[];
    worstCategories: { name: string; count: number }[];
    topBrands: { name: string; count: number }[];
    saleCount: number;
    hasSalesData: boolean;
  };

  type SeasonalInsightsPayload = {
    columns: SeasonalInsightsColumn[];
    totalSoldLines: number;
    seasonsWithSalesCount: number;
    emptyMessage: string | null;
  };

  const [seasonalInsights, setSeasonalInsights] = useState<SeasonalInsightsPayload | null>(null);
  const [seasonalInsightsLoading, setSeasonalInsightsLoading] = useState(false);
  const [seasonalInsightsError, setSeasonalInsightsError] = useState<string | null>(null);

  type SourcedInsightWorstCategory = {
    name: string;
    soldCount: number;
    inventoryCount: number;
    profitMultiple: number | null;
  };

  type SourcedInsightsColumn = {
    sourceKey: string;
    displayLabel: string;
    soldCount: number;
    inventoryCount: number;
    sellThroughRatePct: number;
    profitMultiple: number | null;
    topCategories: { name: string; count: number }[];
    worstCategories: SourcedInsightWorstCategory[];
    hasSalesData: boolean;
  };

  type SourcedInsightsPayload = {
    columns: SourcedInsightsColumn[];
    totalStockLines: number;
    emptyMessage: string | null;
  };

  const [sourcedInsights, setSourcedInsights] = useState<SourcedInsightsPayload | null>(null);
  const [sourcedInsightsLoading, setSourcedInsightsLoading] = useState(false);
  const [sourcedInsightsError, setSourcedInsightsError] = useState<string | null>(null);

  type MenswearCategoryRow = {
    id: number;
    name: string;
    description: string | null;
    notes: string | null;
    department_id?: number | null;
    department_name?: string | null;
  };

  type ResearchDepartmentRow = {
    id: number;
    department_name: string;
    category_count?: number;
  };

  type MenswearCategoryBrandRow = {
    id: number;
    brand_name: string;
    total_sales: string | number;
    /** Period-filtered sold line count from sales-by-brand; optional on /brands rows */
    sold_count?: number;
  };

  /** category_id -1 = API null (brand has no research bucket); real menswear_category ids are ≥ 1. */
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

  function parseMenswearAggCategoryId(raw: unknown): number {
    if (raw === null || raw === undefined) return -1;
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 1 ? n : -1;
  }

  type MenswearBrandInventoryRow = {
    brand_id: number;
    brand_name: string;
    unsold_count: number;
  };

  type MenswearUnsoldBrandCategoryRow = {
    brand_id: number;
    brand_name: string;
    category_name: string;
    category_id: number | null;
    unsold_count: number;
    sold_count: number;
  };

  /** One stock line for in-page brand inventory on Menswear category detail. */
  type MenswearBrandInventoryItemRow = {
    id: number;
    item_name: string | null;
    purchase_price: string | number | null;
    purchase_date: string | null;
    sale_date: string | null;
    category_id: number | null;
    category_name: string;
    category_size_id: number | null;
    size_label: string | null;
    size_sort_order: number | null;
    brand_tag_image_id: number | null;
    tag_caption: string | null;
    tag_public_url: string | null;
  };

  type MenswearStockDrilldownKind = 'avoid' | 'buy-more';

  type MenswearStockDrilldownKey = {
    kind: MenswearStockDrilldownKind;
    brandId: number;
    categoryId: number | null;
    brandName: string;
    categoryName: string;
  };

  type MenswearDrilldownStockItemRow = {
    id: number;
    item_name: string | null;
    purchase_price: string | number | null;
    purchase_date: string | null;
    /** Present for sold-line drill-down (buy more). */
    sale_date: string | null;
    vinted_id: string | null;
    ebay_id: string | null;
  };

  type MenswearSalesPeriod = 'last_12_months' | '2026' | '2025';

  type StockClothingTypeListRow = { id: number; category_name: string };
  type StockClothingTypeSalesRow = {
    category_id: number | null;
    category_name: string;
    total_sales: string | number;
    sold_count: number;
  };
  type StockClothingTypeInventoryRow = {
    category_id: number | null;
    category_name: string;
    sold_count: number;
    unsold_count: number;
    total_count: number;
    unsold_ratio: number;
    /** Sum of net_profit on sold lines in this stock category. */
    total_net_profit?: string | number | null;
    /** Sum of purchase_price on unsold lines (capital tied up). */
    unsold_inventory_total?: string | number | null;
  };

  type ClothingTypeInventorySliceMeta = {
    sold: number;
    unsold: number;
    total: number;
    ratio: number;
    /** Slice area weight: unsold × ratio (stresses many stuck units, not 1×100% one-offs). */
    pieWeight: number;
  };

  type ClothingTypeBrandRow = {
    id: number;
    brand_name: string;
    sold_count: number;
    unsold_count: number;
    total_sales: string | number;
  };

  type ClothingTypeDetailStockRow = {
    id: number;
    item_name: string | null;
    brand_id: number;
    brand_name: string;
    purchase_price: string | number | null;
    purchase_date: string | null;
    sale_date: string | null;
    sale_price: string | number | null;
    ebay_id: string | null;
    vinted_id: string | null;
  };

  type ClothingTypeSizeSoldStockRow = {
    category_size_id: number | null;
    size_label: string;
    sold_count: number;
    in_stock_count: number;
  };

  const [menswearCategories, setMenswearCategories] = useState<MenswearCategoryRow[]>([]);
  const [menswearCategoriesLoading, setMenswearCategoriesLoading] = useState(false);
  const [menswearCategoriesError, setMenswearCategoriesError] = useState<string | null>(null);
  const [researchDepartments, setResearchDepartments] = useState<ResearchDepartmentRow[]>([]);
  const [researchDepartmentsLoading, setResearchDepartmentsLoading] = useState(false);
  const [researchDepartmentsError, setResearchDepartmentsError] = useState<string | null>(null);

  /** Valid department for Sales by category tab: URL if known, else Menswear by name, else first department. */
  const resolvedClothingTypesDepartmentId = useMemo(() => {
    if (researchTab !== 'clothing-types') return null;
    if (researchDepartments.length === 0) return null;
    const urlId = researchScopedDepartmentIdFromUrl;
    if (urlId != null && researchDepartments.some((d) => d.id === urlId)) {
      return urlId;
    }
    const mw = researchDepartments.find(
      (d) => String(d.department_name ?? '').trim().toLowerCase() === 'menswear'
    );
    return mw?.id ?? researchDepartments[0]?.id ?? null;
  }, [researchTab, researchDepartments, researchScopedDepartmentIdFromUrl]);

  /**
   * Sales by category list: department id for `/api/categories` + stock-category aggregate APIs.
   * While /api/departments is loading, use `?departmentId=` from the URL so requests are not skipped.
   */
  const clothingTypesListDepartmentIdForApi = useMemo(() => {
    if (researchTab !== 'clothing-types') return null;
    const urlId = researchScopedDepartmentIdFromUrl;
    if (researchDepartments.length > 0) {
      if (urlId != null && researchDepartments.some((d) => d.id === urlId)) return urlId;
      const mw = researchDepartments.find(
        (d) => String(d.department_name ?? '').trim().toLowerCase() === 'menswear'
      );
      return mw?.id ?? researchDepartments[0]?.id ?? null;
    }
    if (urlId != null && urlId >= 1) return urlId;
    return null;
  }, [researchTab, researchDepartments, researchScopedDepartmentIdFromUrl]);

  /**
   * Sales by season only: `null` = all departments (omit `department_id` on API).
   * When `?departmentId=` is set to a valid id, scope insights to that department.
   */
  const seasonalDepartmentIdForApi = useMemo((): number | null => {
    if (researchTab !== 'seasonal') return null;
    const urlId = researchScopedDepartmentIdFromUrl;
    if (urlId == null) return null;
    if (researchDepartments.length > 0 && !researchDepartments.some((d) => d.id === urlId)) {
      return null;
    }
    return urlId;
  }, [researchTab, researchDepartments, researchScopedDepartmentIdFromUrl]);

  const openMenswearCategoryInUrl = useCallback(
    (categoryId: number) => {
      const qs = new URLSearchParams();
      qs.set('tab', 'menswear-categories');
      qs.set('menswearCategoryId', String(categoryId));
      window.location.assign(`${location.pathname}?${qs.toString()}`);
    },
    [location.pathname]
  );

  const menswearCategoryHref = useCallback(
    (categoryId: number) => {
      const qs = new URLSearchParams();
      qs.set('tab', 'menswear-categories');
      qs.set('menswearCategoryId', String(categoryId));
      return `${location.pathname}?${qs.toString()}`;
    },
    [location.pathname]
  );

  const openClothingTypeInUrl = useCallback(
    (sel: ClothingTypeSelection) => {
      window.location.assign(
        clothingTypesDetailHref(
          sel.mode === 'uncategorized' ? 'uncategorized' : sel.id,
          clothingTypesListDepartmentIdForApi
        )
      );
    },
    [clothingTypesListDepartmentIdForApi]
  );

  /** Pie bucket id: -1 → uncategorized; else stock category id. */
  const openClothingTypeFromPieBucket = useCallback(
    (bucketId: number) => {
      if (bucketId === -1) openClothingTypeInUrl({ mode: 'uncategorized' });
      else if (Number.isFinite(bucketId) && bucketId >= 1)
        openClothingTypeInUrl({ mode: 'category', id: bucketId });
    },
    [openClothingTypeInUrl]
  );

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
  const [menswearCategoryBrandsEditMode, setMenswearCategoryBrandsEditMode] = useState(false);
  const [menswearCategoryBrandRemovalIds, setMenswearCategoryBrandRemovalIds] = useState<Set<number>>(
    () => new Set()
  );
  const [menswearCategoryRemoveBrandsSaving, setMenswearCategoryRemoveBrandsSaving] = useState(false);
  const [menswearCategoryRemoveBrandsError, setMenswearCategoryRemoveBrandsError] = useState<string | null>(
    null
  );
  const [menswearAskAiBusy, setMenswearAskAiBusy] = useState(false);
  const [menswearAskAiHint, setMenswearAskAiHint] = useState<string | null>(null);
  const [menswearStrainTableSort, setMenswearStrainTableSort] = useState<{
    key: 'category' | 'listed' | 'sold' | 'unsold' | 'sellThrough' | 'strain';
    dir: 'asc' | 'desc';
  } | null>(null);
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
  /** Unsold counts per brand in the selected menswear category (overview pie). */
  const [menswearUnsoldByBrandRows, setMenswearUnsoldByBrandRows] = useState<MenswearBrandInventoryRow[]>([]);
  const [menswearUnsoldByBrandLoading, setMenswearUnsoldByBrandLoading] = useState(false);
  const [menswearUnsoldByBrandError, setMenswearUnsoldByBrandError] = useState<string | null>(null);
  const [menswearUnsoldBrandCategory, setMenswearUnsoldBrandCategory] = useState<MenswearUnsoldBrandCategoryRow[]>(
    []
  );
  const [menswearUnsoldBrandCategoryLoading, setMenswearUnsoldBrandCategoryLoading] = useState(false);
  const [menswearUnsoldBrandCategoryError, setMenswearUnsoldBrandCategoryError] = useState<string | null>(null);
  const [menswearBuyMoreBrandCategory, setMenswearBuyMoreBrandCategory] = useState<MenswearUnsoldBrandCategoryRow[]>(
    []
  );
  const [menswearBuyMoreBrandCategoryLoading, setMenswearBuyMoreBrandCategoryLoading] = useState(false);
  const [menswearBuyMoreBrandCategoryError, setMenswearBuyMoreBrandCategoryError] = useState<string | null>(null);
  const [menswearStockDrilldown, setMenswearStockDrilldown] = useState<MenswearStockDrilldownKey | null>(null);
  const [menswearDrilldownItems, setMenswearDrilldownItems] = useState<MenswearDrilldownStockItemRow[]>([]);
  const [menswearDrilldownItemsLoading, setMenswearDrilldownItemsLoading] = useState(false);
  const [menswearDrilldownItemsError, setMenswearDrilldownItemsError] = useState<string | null>(null);

  /** Unsold stock lines for one brand on Menswear category detail (`?menswearBrandId=`). */
  const [menswearBrandStockLines, setMenswearBrandStockLines] = useState<MenswearBrandInventoryItemRow[]>([]);
  const [menswearBrandStockLinesBrandName, setMenswearBrandStockLinesBrandName] = useState<string>('');
  const [menswearBrandStockLinesLoading, setMenswearBrandStockLinesLoading] = useState(false);
  const [menswearBrandStockLinesError, setMenswearBrandStockLinesError] = useState<string | null>(null);
  const [menswearBrandStockLinesCategoryFilter, setMenswearBrandStockLinesCategoryFilter] =
    useState<string>('all');
  /** When set, Inventory and Sold chart shows in-stock vs sold by size within that category. */
  const [menswearBrandStockChartDrillCategoryKey, setMenswearBrandStockChartDrillCategoryKey] =
    useState<string | null>(null);
  /** Scroll target after choosing a category from the brand stock chart (filter row). */
  const menswearBrandStockTableAnchorRef = useRef<HTMLDivElement>(null);
  const [menswearBrandInventoryStockSummary, setMenswearBrandInventoryStockSummary] =
    useState<BrandStockSummaryPayload | null>(null);
  const [menswearBrandInventoryStockSummaryLoading, setMenswearBrandInventoryStockSummaryLoading] =
    useState(false);
  const [menswearBrandInventoryStockSummaryError, setMenswearBrandInventoryStockSummaryError] =
    useState<string | null>(null);

  const [clothingTypesListRows, setClothingTypesListRows] = useState<StockClothingTypeListRow[]>([]);
  const [clothingTypesListLoading, setClothingTypesListLoading] = useState(false);
  const [clothingTypesListError, setClothingTypesListError] = useState<string | null>(null);
  const [clothingTypesPeriod, setClothingTypesPeriod] = useState<MenswearSalesPeriod>('last_12_months');
  const [clothingTypesSalesRows, setClothingTypesSalesRows] = useState<StockClothingTypeSalesRow[]>([]);
  const [clothingTypesSalesLoading, setClothingTypesSalesLoading] = useState(false);
  const [clothingTypesSalesError, setClothingTypesSalesError] = useState<string | null>(null);
  const [clothingTypesInventoryRows, setClothingTypesInventoryRows] = useState<
    StockClothingTypeInventoryRow[]
  >([]);
  const [clothingTypesInventoryLoading, setClothingTypesInventoryLoading] = useState(false);
  const [clothingTypesInventoryError, setClothingTypesInventoryError] = useState<string | null>(null);

  const [clothingTypeBrands, setClothingTypeBrands] = useState<ClothingTypeBrandRow[]>([]);
  const [clothingTypeBrandsLoading, setClothingTypeBrandsLoading] = useState(false);
  const [clothingTypeBrandsError, setClothingTypeBrandsError] = useState<string | null>(null);
  const [clothingTypeBuyMoreBrandCategory, setClothingTypeBuyMoreBrandCategory] = useState<
    MenswearUnsoldBrandCategoryRow[]
  >([]);
  const [clothingTypeBuyMoreBrandCategoryLoading, setClothingTypeBuyMoreBrandCategoryLoading] =
    useState(false);
  const [clothingTypeBuyMoreBrandCategoryError, setClothingTypeBuyMoreBrandCategoryError] = useState<
    string | null
  >(null);
  const [clothingTypeUnsoldBrandCategory, setClothingTypeUnsoldBrandCategory] = useState<
    MenswearUnsoldBrandCategoryRow[]
  >([]);
  const [clothingTypeUnsoldBrandCategoryLoading, setClothingTypeUnsoldBrandCategoryLoading] =
    useState(false);
  const [clothingTypeUnsoldBrandCategoryError, setClothingTypeUnsoldBrandCategoryError] = useState<
    string | null
  >(null);
  const [clothingTypeSizeSoldStock, setClothingTypeSizeSoldStock] = useState<ClothingTypeSizeSoldStockRow[]>(
    []
  );
  const [clothingTypeSizeSoldStockLoading, setClothingTypeSizeSoldStockLoading] = useState(false);
  const [clothingTypeSizeSoldStockError, setClothingTypeSizeSoldStockError] = useState<string | null>(null);
  const [clothingTypeStockDrilldown, setClothingTypeStockDrilldown] =
    useState<MenswearStockDrilldownKey | null>(null);
  const [clothingTypeDrilldownItems, setClothingTypeDrilldownItems] = useState<
    MenswearDrilldownStockItemRow[]
  >([]);
  const [clothingTypeDrilldownItemsLoading, setClothingTypeDrilldownItemsLoading] = useState(false);
  const [clothingTypeDrilldownItemsError, setClothingTypeDrilldownItemsError] = useState<string | null>(
    null
  );
  const [clothingTypeBrandStockLines, setClothingTypeBrandStockLines] = useState<
    MenswearBrandInventoryItemRow[]
  >([]);
  const [clothingTypeBrandStockLinesBrandName, setClothingTypeBrandStockLinesBrandName] = useState('');
  const [clothingTypeBrandStockLinesLoading, setClothingTypeBrandStockLinesLoading] = useState(false);
  const [clothingTypeBrandStockLinesError, setClothingTypeBrandStockLinesError] = useState<string | null>(
    null
  );
  const [clothingTypeBrandStockLinesCategoryFilter, setClothingTypeBrandStockLinesCategoryFilter] =
    useState<string>('all');
  const [clothingTypeBrandInventoryStockSummary, setClothingTypeBrandInventoryStockSummary] =
    useState<BrandStockSummaryPayload | null>(null);
  const [clothingTypeBrandInventoryStockSummaryLoading, setClothingTypeBrandInventoryStockSummaryLoading] =
    useState(false);
  const [clothingTypeBrandInventoryStockSummaryError, setClothingTypeBrandInventoryStockSummaryError] =
    useState<string | null>(null);

  const [clothingTypeDetailLoading, setClothingTypeDetailLoading] = useState(false);
  const [clothingTypeDetailError, setClothingTypeDetailError] = useState<string | null>(null);
  const [clothingTypeDetailSummary, setClothingTypeDetailSummary] =
    useState<BrandStockSummaryPayload | null>(null);
  const [clothingTypeDetailStockRows, setClothingTypeDetailStockRows] = useState<ClothingTypeDetailStockRow[]>(
    []
  );

  const [brandsWithWebsites, setBrandsWithWebsites] = useState<BrandRow[]>([]);

  const [brandTagBrandId, setBrandTagBrandId] = useState<number | ''>('');
  const [brandTabQuery, setBrandTabQuery] = useState('');
  /**
   * Brand research tab: department scope. `null` = default Menswear (until user picks a pill);
   * `'all'` = every brand; number = that department only.
   */
  const [brandResearchDepartmentFilterSelection, setBrandResearchDepartmentFilterSelection] = useState<
    number | 'all' | null
  >(null);
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
  const [brandLogoUploading, setBrandLogoUploading] = useState(false);
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
  /** When add panel is open: tag image upload or brand description / website / notes. */
  const [brandTagAddSubMode, setBrandTagAddSubMode] = useState<'image' | 'info'>('image');
  const [brandWebsiteUrlDraft, setBrandWebsiteUrlDraft] = useState('');
  const [brandBuyingNotesBuyDraft, setBrandBuyingNotesBuyDraft] = useState('');
  const [brandBuyingNotesAvoidDraft, setBrandBuyingNotesAvoidDraft] = useState('');
  const [brandDescriptionDraft, setBrandDescriptionDraft] = useState('');
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
      setMenswearUnsoldByBrandRows([]);
      setMenswearUnsoldByBrandError(null);
      setMenswearUnsoldByBrandLoading(false);
      setMenswearBrandStockLines([]);
      setMenswearBrandStockLinesBrandName('');
      setMenswearBrandStockLinesError(null);
      setMenswearBrandStockLinesLoading(false);
      setMenswearBrandInventoryStockSummary(null);
      setMenswearBrandInventoryStockSummaryError(null);
      setMenswearBrandInventoryStockSummaryLoading(false);
      setMenswearBrandSortMenuOpen(false);
    }
  }, [researchTab]);

  useEffect(() => {
    if (researchTab !== 'clothing-types') {
      setClothingTypesListRows([]);
      setClothingTypesListError(null);
      setClothingTypesListLoading(false);
      setClothingTypesSalesRows([]);
      setClothingTypesSalesError(null);
      setClothingTypesSalesLoading(false);
      setClothingTypesInventoryRows([]);
      setClothingTypesInventoryError(null);
      setClothingTypesInventoryLoading(false);
      setClothingTypeBrands([]);
      setClothingTypeBrandsError(null);
      setClothingTypeBrandsLoading(false);
      setClothingTypeBuyMoreBrandCategory([]);
      setClothingTypeBuyMoreBrandCategoryError(null);
      setClothingTypeBuyMoreBrandCategoryLoading(false);
      setClothingTypeUnsoldBrandCategory([]);
      setClothingTypeUnsoldBrandCategoryError(null);
      setClothingTypeUnsoldBrandCategoryLoading(false);
      setClothingTypeStockDrilldown(null);
      setClothingTypeDrilldownItems([]);
      setClothingTypeDrilldownItemsError(null);
      setClothingTypeDrilldownItemsLoading(false);
      setClothingTypeBrandStockLines([]);
      setClothingTypeBrandStockLinesBrandName('');
      setClothingTypeBrandStockLinesError(null);
      setClothingTypeBrandStockLinesLoading(false);
      setClothingTypeBrandStockLinesCategoryFilter('all');
      setClothingTypeBrandInventoryStockSummary(null);
      setClothingTypeBrandInventoryStockSummaryError(null);
      setClothingTypeBrandInventoryStockSummaryLoading(false);
    }
  }, [researchTab]);

  useEffect(() => {
    if (researchTab !== 'seasonal') {
      setSeasonalInsights(null);
      setSeasonalInsightsError(null);
      setSeasonalInsightsLoading(false);
    }
  }, [researchTab]);

  useEffect(() => {
    if (researchTab !== 'sourced') {
      setSourcedInsights(null);
      setSourcedInsightsError(null);
      setSourcedInsightsLoading(false);
    }
  }, [researchTab]);

  useEffect(() => {
    if (researchTab !== 'seasonal') return;
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setSeasonalInsightsLoading(true);
      setSeasonalInsightsError(null);
      try {
        const scoped = seasonalDepartmentIdForApi;
        const url =
          scoped != null
            ? apiUrl(
                `/api/stock/seasonal-insights?department_id=${encodeURIComponent(String(scoped))}`
              )
            : apiUrl('/api/stock/seasonal-insights');
        const res = await fetch(url, { signal: ac.signal });
        const data = await readJsonResponse<SeasonalInsightsPayload>(res, 'seasonal-insights');
        if (cancelled) return;
        const rawCols = Array.isArray(data.columns) ? data.columns : [];
        setSeasonalInsights({
          columns: rawCols.map((col) => {
            const c = col as SeasonalInsightsColumn;
            return {
              ...c,
              worstCategories: Array.isArray(c.worstCategories) ? c.worstCategories : [],
            };
          }),
          totalSoldLines: Number(data.totalSoldLines) || 0,
          seasonsWithSalesCount: Number(data.seasonsWithSalesCount) || 0,
          emptyMessage:
            data.emptyMessage != null && String(data.emptyMessage).trim() !== ''
              ? String(data.emptyMessage)
              : null,
        });
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setSeasonalInsights(null);
        setSeasonalInsightsError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setSeasonalInsightsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, seasonalDepartmentIdForApi]);

  useEffect(() => {
    if (researchTab !== 'sourced') return;
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setSourcedInsightsLoading(true);
      setSourcedInsightsError(null);
      try {
        const res = await fetch(apiUrl('/api/stock/sourced-insights'), { signal: ac.signal });
        const data = await readJsonResponse<SourcedInsightsPayload>(res, 'sourced-insights');
        if (cancelled) return;
        const rawCols = Array.isArray(data.columns) ? data.columns : [];
        setSourcedInsights({
          columns: rawCols.map((col) => {
            const c = col as SourcedInsightsColumn;
            return {
              ...c,
              topCategories: Array.isArray(c.topCategories) ? c.topCategories : [],
              worstCategories: Array.isArray(c.worstCategories) ? c.worstCategories : [],
            };
          }),
          totalStockLines: Number(data.totalStockLines) || 0,
          emptyMessage:
            data.emptyMessage != null && String(data.emptyMessage).trim() !== ''
              ? String(data.emptyMessage)
              : null,
        });
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setSourcedInsights(null);
        setSourcedInsightsError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setSourcedInsightsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab]);

  useEffect(() => {
    if (menswearCategoryIdFromUrl === null) {
      setMenswearAddBrandOpen(false);
      setMenswearAddBrandSearch('');
      setMenswearAddBrandError(null);
      setMenswearBrandSortMenuOpen(false);
    }
    setMenswearCategoryBrandsEditMode(false);
    setMenswearCategoryBrandRemovalIds(new Set());
    setMenswearCategoryRemoveBrandsError(null);
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
    if (researchTab !== 'clothing-types' && researchTab !== 'seasonal' && researchTab !== 'brand') {
      setResearchDepartments([]);
      setResearchDepartmentsError(null);
      setResearchDepartmentsLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setResearchDepartmentsLoading(true);
      setResearchDepartmentsError(null);
      try {
        const res = await fetch(apiUrl('/api/departments'), { signal: ac.signal });
        const data = await readJsonResponse<{ rows?: ResearchDepartmentRow[] }>(res, 'departments');
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        const mapped = raw.map((r) => ({
          id: Number(r.id),
          department_name: String(r.department_name ?? ''),
          category_count:
            r.category_count != null ? Math.max(0, Math.floor(Number(r.category_count) || 0)) : undefined,
        }));
        mapped.sort((a, b) => {
          const aMw = a.department_name.trim().toLowerCase() === 'menswear';
          const bMw = b.department_name.trim().toLowerCase() === 'menswear';
          if (aMw !== bMw) return aMw ? -1 : 1;
          return a.department_name.localeCompare(b.department_name, undefined, { sensitivity: 'base' });
        });
        setResearchDepartments(mapped);
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setResearchDepartments([]);
        setResearchDepartmentsError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setResearchDepartmentsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab]);

  useEffect(() => {
    if (researchTab !== 'clothing-types' && researchTab !== 'seasonal') return;
    if (researchDepartmentsLoading) return;
    if (researchDepartments.length === 0) return;
    const raw = searchParams.get('departmentId')?.trim();
    const n = raw ? parseInt(raw, 10) : NaN;
    const valid =
      Number.isFinite(n) && n >= 1 && researchDepartments.some((d) => d.id === n);

    if (researchTab === 'seasonal') {
      if (raw === undefined || raw === null || String(raw).trim() === '') return;
      if (valid) return;
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('departmentId');
        return next;
      }, { replace: true });
      return;
    }

    if (valid) return;
    const resolved = resolvedClothingTypesDepartmentId;
    if (resolved == null) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('departmentId', String(resolved));
      return next;
    }, { replace: true });
  }, [
    researchTab,
    researchDepartments,
    researchDepartmentsLoading,
    searchParams,
    setSearchParams,
    resolvedClothingTypesDepartmentId,
  ]);

  useEffect(() => {
    const brandForCategoryLabel =
      researchTab === 'brand' && brandTagBrandId !== ''
        ? brandsWithWebsites.find((b) => b.id === brandTagBrandId)
        : undefined;
    const needCategoriesOnBrandTab =
      brandForCategoryLabel != null && brandForCategoryLabel.menswear_category_id != null;

    if (researchTab !== 'menswear-categories' && !needCategoriesOnBrandTab) return;
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearCategoriesLoading(true);
      setMenswearCategoriesError(null);
      try {
        let requestUrl = apiUrl('/api/menswear-categories');
        if (researchTab === 'menswear-categories') {
          const listOnly = menswearCategoryIdFromUrl == null;
          if (listOnly) {
            requestUrl = apiUrl('/api/menswear-categories');
          }
        }
        const res = await fetch(requestUrl, { signal: ac.signal });
        const data = await readJsonResponse<{ rows?: MenswearCategoryRow[] }>(res, 'menswear-categories');
        if (cancelled) return;
        const rows = Array.isArray(data.rows) ? data.rows : [];
        setMenswearCategories(
          rows.map((r) => ({
            id: Number(r.id),
            name: String(r.name ?? ''),
            description: r.description != null ? String(r.description) : null,
            notes: r.notes != null ? String(r.notes) : null,
            department_id:
              r.department_id != null && String(r.department_id).trim() !== ''
                ? Number(r.department_id)
                : null,
            department_name:
              r.department_name != null && String(r.department_name).trim() !== ''
                ? String(r.department_name)
                : null,
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
  }, [
    researchTab,
    brandTagBrandId,
    brandsWithWebsites,
    menswearCategoryIdFromUrl,
  ]);

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
              category_id: parseMenswearAggCategoryId(r.category_id),
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
            category_id: parseMenswearAggCategoryId(r.category_id),
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
    if (researchTab !== 'clothing-types') return;
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypesListLoading(true);
      setClothingTypesListError(null);
      try {
        if (clothingTypesListDepartmentIdForApi == null) {
          if (cancelled) return;
          setClothingTypesListRows([]);
          return;
        }
        const res = await fetch(
          apiUrl(
            `/api/categories?department_id=${encodeURIComponent(String(clothingTypesListDepartmentIdForApi))}`
          ),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{ rows?: { id?: unknown; category_name?: unknown }[] }>(
          res,
          'clothing-types-categories'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setClothingTypesListRows(
          raw
            .map((r) => {
              const idNum = Number(r.id);
              const id = Number.isFinite(idNum) ? Math.floor(idNum) : -1;
              return {
                id,
                category_name: String(r.category_name ?? '—').trim() || '—',
              };
            })
            .filter((r) => r.id >= 1)
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypesListRows([]);
        setClothingTypesListError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypesListLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, clothingTypesListDepartmentIdForApi]);

  useEffect(() => {
    if (researchTab !== 'clothing-types') return;
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypesSalesLoading(true);
      setClothingTypesSalesError(null);
      try {
        if (clothingTypesListDepartmentIdForApi == null) {
          if (cancelled) return;
          setClothingTypesSalesRows([]);
          return;
        }
        const params = new URLSearchParams({ period: clothingTypesPeriod });
        params.set('department_id', String(clothingTypesListDepartmentIdForApi));
        const res = await fetch(apiUrl(`/api/stock-categories/sales-by-category?${params}`), {
          signal: ac.signal,
        });
        const data = await readJsonResponse<{ rows?: StockClothingTypeSalesRow[] }>(
          res,
          'clothing-types-sales'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setClothingTypesSalesRows(
          raw.map((r) => ({
            category_id:
              r.category_id === null || r.category_id === undefined ? null : Number(r.category_id),
            category_name: String(r.category_name ?? '—'),
            total_sales: r.total_sales,
            sold_count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypesSalesRows([]);
        setClothingTypesSalesError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypesSalesLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, clothingTypesPeriod, clothingTypesListDepartmentIdForApi]);

  useEffect(() => {
    if (researchTab !== 'clothing-types') return;
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypesInventoryLoading(true);
      setClothingTypesInventoryError(null);
      try {
        if (clothingTypesListDepartmentIdForApi == null) {
          if (cancelled) return;
          setClothingTypesInventoryRows([]);
          return;
        }
        const invQs = new URLSearchParams({
          department_id: String(clothingTypesListDepartmentIdForApi),
        });
        const res = await fetch(
          apiUrl(`/api/stock-categories/inventory-by-category?${invQs}`),
          {
            signal: ac.signal,
          }
        );
        const data = await readJsonResponse<{ rows?: StockClothingTypeInventoryRow[] }>(
          res,
          'clothing-types-inventory'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setClothingTypesInventoryRows(
          raw.map((r) => {
            const sold = Math.max(0, Math.floor(Number((r as { sold_count?: unknown }).sold_count) || 0));
            const unsold = Math.max(0, Math.floor(Number(r.unsold_count) || 0));
            const totalFromApi = Math.floor(Number((r as { total_count?: unknown }).total_count) || 0);
            const total = totalFromApi > 0 ? totalFromApi : sold + unsold;
            const ratioRaw = Number((r as { unsold_ratio?: unknown }).unsold_ratio);
            const unsold_ratio =
              Number.isFinite(ratioRaw) && total > 0
                ? Math.min(1, Math.max(0, ratioRaw))
                : total > 0
                  ? unsold / total
                  : 0;
            return {
              category_id:
                r.category_id === null || r.category_id === undefined ? null : Number(r.category_id),
              category_name: String(r.category_name ?? '—'),
              sold_count: sold,
              unsold_count: unsold,
              total_count: total,
              unsold_ratio,
            };
          })
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypesInventoryRows([]);
        setClothingTypesInventoryError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypesInventoryLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, clothingTypesListDepartmentIdForApi]);

  useEffect(() => {
    if (researchTab !== 'clothing-types' || clothingTypeApiPathKey == null) {
      setClothingTypeBrands([]);
      setClothingTypeBrandsError(null);
      setClothingTypeBrandsLoading(false);
      return;
    }
    if (clothingTypesListDepartmentIdForApi == null) {
      setClothingTypeBrands([]);
      setClothingTypeBrandsError(null);
      setClothingTypeBrandsLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypeBrandsLoading(true);
      setClothingTypeBrandsError(null);
      try {
        const dq = encodeURIComponent(String(clothingTypesListDepartmentIdForApi));
        const res = await fetch(
          apiUrl(
            `/api/stock-categories/type/${encodeURIComponent(clothingTypeApiPathKey)}/brands?department_id=${dq}`
          ),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{ rows?: ClothingTypeBrandRow[] }>(
          res,
          'clothing-type-brands'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setClothingTypeBrands(
          raw
            .map((r) => ({
              id: Math.floor(Number(r.id) || 0),
              brand_name: String(r.brand_name ?? '—'),
              sold_count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
              unsold_count: Math.max(0, Math.floor(Number(r.unsold_count) || 0)),
              total_sales: r.total_sales,
            }))
            .filter((r) => r.id >= 1)
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypeBrands([]);
        setClothingTypeBrandsError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypeBrandsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, clothingTypeApiPathKey, clothingTypesListDepartmentIdForApi]);

  useEffect(() => {
    if (researchTab !== 'clothing-types' || clothingTypeApiPathKey == null) {
      setClothingTypeBuyMoreBrandCategory([]);
      setClothingTypeBuyMoreBrandCategoryError(null);
      setClothingTypeBuyMoreBrandCategoryLoading(false);
      return;
    }
    if (clothingTypesListDepartmentIdForApi == null) {
      setClothingTypeBuyMoreBrandCategory([]);
      setClothingTypeBuyMoreBrandCategoryError(null);
      setClothingTypeBuyMoreBrandCategoryLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypeBuyMoreBrandCategoryLoading(true);
      setClothingTypeBuyMoreBrandCategoryError(null);
      try {
        const params = new URLSearchParams({ limit: '50' });
        params.set('department_id', String(clothingTypesListDepartmentIdForApi));
        const res = await fetch(
          apiUrl(
            `/api/stock-categories/type/${encodeURIComponent(clothingTypeApiPathKey)}/buy-more-by-brand-category?${params}`
          ),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{ rows?: MenswearUnsoldBrandCategoryRow[] }>(
          res,
          'clothing-type-buy-more'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setClothingTypeBuyMoreBrandCategory(
          raw.map((r) => ({
            brand_id: Math.floor(Number(r.brand_id) || 0),
            brand_name: String(r.brand_name ?? '—'),
            category_name: String(r.category_name ?? '—'),
            category_id:
              r.category_id === null || r.category_id === undefined ? null : Number(r.category_id),
            unsold_count: Math.max(0, Math.floor(Number(r.unsold_count) || 0)),
            sold_count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypeBuyMoreBrandCategory([]);
        setClothingTypeBuyMoreBrandCategoryError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypeBuyMoreBrandCategoryLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, clothingTypeApiPathKey, clothingTypesListDepartmentIdForApi]);

  useEffect(() => {
    if (researchTab !== 'clothing-types' || clothingTypeApiPathKey == null) {
      setClothingTypeUnsoldBrandCategory([]);
      setClothingTypeUnsoldBrandCategoryError(null);
      setClothingTypeUnsoldBrandCategoryLoading(false);
      return;
    }
    if (clothingTypesListDepartmentIdForApi == null) {
      setClothingTypeUnsoldBrandCategory([]);
      setClothingTypeUnsoldBrandCategoryError(null);
      setClothingTypeUnsoldBrandCategoryLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypeUnsoldBrandCategoryLoading(true);
      setClothingTypeUnsoldBrandCategoryError(null);
      try {
        const params = new URLSearchParams({ limit: '50' });
        params.set('department_id', String(clothingTypesListDepartmentIdForApi));
        const res = await fetch(
          apiUrl(
            `/api/stock-categories/type/${encodeURIComponent(clothingTypeApiPathKey)}/unsold-inventory-by-brand-category?${params}`
          ),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{ rows?: MenswearUnsoldBrandCategoryRow[] }>(
          res,
          'clothing-type-unsold-brand-cat'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setClothingTypeUnsoldBrandCategory(
          raw.map((r) => ({
            brand_id: Math.floor(Number(r.brand_id) || 0),
            brand_name: String(r.brand_name ?? '—'),
            category_name: String(r.category_name ?? '—'),
            category_id:
              r.category_id === null || r.category_id === undefined ? null : Number(r.category_id),
            unsold_count: Math.max(0, Math.floor(Number(r.unsold_count) || 0)),
            sold_count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypeUnsoldBrandCategory([]);
        setClothingTypeUnsoldBrandCategoryError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypeUnsoldBrandCategoryLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, clothingTypeApiPathKey, clothingTypesListDepartmentIdForApi]);

  useEffect(() => {
    if (researchTab !== 'clothing-types' || clothingTypeApiPathKey == null) {
      setClothingTypeSizeSoldStock([]);
      setClothingTypeSizeSoldStockError(null);
      setClothingTypeSizeSoldStockLoading(false);
      return;
    }
    if (clothingTypesListDepartmentIdForApi == null) {
      setClothingTypeSizeSoldStock([]);
      setClothingTypeSizeSoldStockError(null);
      setClothingTypeSizeSoldStockLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypeSizeSoldStockLoading(true);
      setClothingTypeSizeSoldStockError(null);
      try {
        const dq = encodeURIComponent(String(clothingTypesListDepartmentIdForApi));
        const res = await fetch(
          apiUrl(
            `/api/stock-categories/type/${encodeURIComponent(clothingTypeApiPathKey)}/sold-and-stock-by-size?department_id=${dq}`
          ),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{ rows?: ClothingTypeSizeSoldStockRow[] }>(
          res,
          'clothing-type-size-sold-stock'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setClothingTypeSizeSoldStock(
          raw.map((r) => ({
            category_size_id:
              r.category_size_id === null || r.category_size_id === undefined
                ? null
                : Math.floor(Number(r.category_size_id) || 0) || null,
            size_label: String(r.size_label ?? '—'),
            sold_count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
            in_stock_count: Math.max(0, Math.floor(Number(r.in_stock_count) || 0)),
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypeSizeSoldStock([]);
        setClothingTypeSizeSoldStockError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypeSizeSoldStockLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, clothingTypeApiPathKey, clothingTypesListDepartmentIdForApi]);

  useEffect(() => {
    if (
      researchTab !== 'clothing-types' ||
      clothingTypeApiPathKey == null ||
      !clothingTypeStockDrilldown
    ) {
      setClothingTypeDrilldownItems([]);
      setClothingTypeDrilldownItemsError(null);
      setClothingTypeDrilldownItemsLoading(false);
      return;
    }
    if (clothingTypesListDepartmentIdForApi == null) {
      setClothingTypeDrilldownItems([]);
      setClothingTypeDrilldownItemsError(null);
      setClothingTypeDrilldownItemsLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypeDrilldownItemsLoading(true);
      setClothingTypeDrilldownItemsError(null);
      try {
        const params = new URLSearchParams({
          brand_id: String(clothingTypeStockDrilldown.brandId),
        });
        params.set('department_id', String(clothingTypesListDepartmentIdForApi));
        const segment =
          clothingTypeStockDrilldown.kind === 'avoid' ? 'unsold-stock-items' : 'sold-stock-items';
        const res = await fetch(
          apiUrl(
            `/api/stock-categories/type/${encodeURIComponent(clothingTypeApiPathKey)}/${segment}?${params}`
          ),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{ rows?: MenswearDrilldownStockItemRow[] }>(
          res,
          'clothing-type-drilldown'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setClothingTypeDrilldownItems(
          raw.map((r) => ({
            id: Math.floor(Number(r.id) || 0),
            item_name: r.item_name != null ? String(r.item_name) : null,
            purchase_price: r.purchase_price ?? null,
            purchase_date: r.purchase_date != null ? String(r.purchase_date) : null,
            sale_date:
              r.sale_date != null && String(r.sale_date).trim() !== '' ? String(r.sale_date) : null,
            vinted_id:
              r.vinted_id != null && String(r.vinted_id).trim() !== ''
                ? String(r.vinted_id).trim()
                : null,
            ebay_id: r.ebay_id != null && String(r.ebay_id).trim() !== '' ? String(r.ebay_id).trim() : null,
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypeDrilldownItems([]);
        setClothingTypeDrilldownItemsError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypeDrilldownItemsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    researchTab,
    clothingTypeApiPathKey,
    clothingTypeStockDrilldown,
    clothingTypesListDepartmentIdForApi,
  ]);

  useEffect(() => {
    if (
      researchTab !== 'clothing-types' ||
      clothingTypeApiPathKey == null ||
      clothingTypeBrandIdFromUrl == null
    ) {
      setClothingTypeBrandStockLines([]);
      setClothingTypeBrandStockLinesBrandName('');
      setClothingTypeBrandStockLinesError(null);
      setClothingTypeBrandStockLinesLoading(false);
      return;
    }
    if (clothingTypesListDepartmentIdForApi == null) {
      setClothingTypeBrandStockLines([]);
      setClothingTypeBrandStockLinesBrandName('');
      setClothingTypeBrandStockLinesError(null);
      setClothingTypeBrandStockLinesLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypeBrandStockLinesLoading(true);
      setClothingTypeBrandStockLinesError(null);
      try {
        const params = new URLSearchParams({ brand_id: String(clothingTypeBrandIdFromUrl) });
        params.set('department_id', String(clothingTypesListDepartmentIdForApi));
        const res = await fetch(
          apiUrl(
            `/api/stock-categories/type/${encodeURIComponent(clothingTypeApiPathKey)}/brand-inventory-items?${params}`
          ),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{
          rows?: MenswearBrandInventoryItemRow[];
          brand_name?: string;
        }>(res, 'clothing-type-brand-inventory');
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setClothingTypeBrandStockLines(
          raw.map((r) => ({
            id: Math.floor(Number(r.id) || 0),
            item_name: r.item_name != null ? String(r.item_name) : null,
            purchase_price: r.purchase_price ?? null,
            purchase_date: r.purchase_date != null ? String(r.purchase_date) : null,
            sale_date:
              r.sale_date != null && String(r.sale_date).trim() !== '' ? String(r.sale_date) : null,
            category_id:
              r.category_id === null || r.category_id === undefined ? null : Number(r.category_id),
            category_name: String(r.category_name ?? '—'),
            category_size_id: null,
            size_label: null,
            size_sort_order: null,
            brand_tag_image_id: null,
            tag_caption: null,
            tag_public_url: null,
          }))
        );
        setClothingTypeBrandStockLinesBrandName(
          data.brand_name != null ? String(data.brand_name) : ''
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypeBrandStockLines([]);
        setClothingTypeBrandStockLinesBrandName('');
        setClothingTypeBrandStockLinesError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypeBrandStockLinesLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    researchTab,
    clothingTypeApiPathKey,
    clothingTypeBrandIdFromUrl,
    clothingTypesListDepartmentIdForApi,
  ]);

  useEffect(() => {
    if (
      researchTab !== 'clothing-types' ||
      clothingTypeApiPathKey == null ||
      clothingTypeBrandIdFromUrl != null
    ) {
      setClothingTypeDetailSummary(null);
      setClothingTypeDetailStockRows([]);
      setClothingTypeDetailError(null);
      setClothingTypeDetailLoading(false);
      return;
    }
    if (clothingTypesListDepartmentIdForApi == null) {
      setClothingTypeDetailSummary(null);
      setClothingTypeDetailStockRows([]);
      setClothingTypeDetailError(null);
      setClothingTypeDetailLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypeDetailLoading(true);
      setClothingTypeDetailError(null);
      try {
        const dq = encodeURIComponent(String(clothingTypesListDepartmentIdForApi));
        const res = await fetch(
          apiUrl(
            `/api/stock-categories/type/${encodeURIComponent(clothingTypeApiPathKey)}/detail?department_id=${dq}`
          ),
          { signal: ac.signal }
        );
        const raw = await readJsonResponse<unknown>(res, 'clothing-type-detail');
        if (cancelled) return;
        const dataObj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const rowArr = dataObj.rows;
        const parsedRows: ClothingTypeDetailStockRow[] = Array.isArray(rowArr)
          ? rowArr
              .map((row) => {
                if (!row || typeof row !== 'object') return null;
                const r = row as Record<string, unknown>;
                const id = Number(r.id);
                if (!Number.isFinite(id)) return null;
                return {
                  id,
                  item_name: r.item_name != null ? String(r.item_name) : null,
                  brand_id: Number(r.brand_id) || 0,
                  brand_name: String(r.brand_name ?? '—'),
                  purchase_price: (r.purchase_price ?? null) as string | number | null,
                  purchase_date: r.purchase_date != null ? String(r.purchase_date) : null,
                  sale_date: r.sale_date != null ? String(r.sale_date) : null,
                  sale_price: (r.sale_price ?? null) as string | number | null,
                  ebay_id: r.ebay_id != null ? String(r.ebay_id) : null,
                  vinted_id: r.vinted_id != null ? String(r.vinted_id) : null,
                };
              })
              .filter((x): x is ClothingTypeDetailStockRow => x != null)
          : [];
        setClothingTypeDetailStockRows(parsedRows);
        setClothingTypeDetailSummary(parseBrandStockSummaryPayload(raw));
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypeDetailSummary(null);
        setClothingTypeDetailStockRows([]);
        setClothingTypeDetailError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypeDetailLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    researchTab,
    clothingTypeApiPathKey,
    clothingTypeBrandIdFromUrl,
    clothingTypesListDepartmentIdForApi,
  ]);

  useEffect(() => {
    if (
      researchTab !== 'clothing-types' ||
      clothingTypeSelection == null ||
      clothingTypeBrandIdFromUrl == null
    ) {
      setClothingTypeBrandInventoryStockSummary(null);
      setClothingTypeBrandInventoryStockSummaryError(null);
      setClothingTypeBrandInventoryStockSummaryLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setClothingTypeBrandInventoryStockSummaryLoading(true);
      setClothingTypeBrandInventoryStockSummaryError(null);
      try {
        const res = await fetch(
          apiUrl(`/api/brands/${clothingTypeBrandIdFromUrl}/stock-summary`),
          { signal: ac.signal }
        );
        const raw = await readJsonResponse<unknown>(res, 'clothing-type brand stock summary');
        if (cancelled) return;
        setClothingTypeBrandInventoryStockSummary(parseBrandStockSummaryPayload(raw));
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setClothingTypeBrandInventoryStockSummary(null);
        setClothingTypeBrandInventoryStockSummaryError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setClothingTypeBrandInventoryStockSummaryLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, clothingTypeSelection, clothingTypeBrandIdFromUrl]);

  useEffect(() => {
    if (clothingTypeBrandIdFromUrl == null) {
      setClothingTypeBrandStockLinesCategoryFilter('all');
    }
  }, [clothingTypeBrandIdFromUrl]);

  useEffect(() => {
    if (researchTab !== 'menswear-categories' || menswearCategoryIdFromUrl == null) {
      setMenswearUnsoldByBrandRows([]);
      setMenswearUnsoldByBrandError(null);
      setMenswearUnsoldByBrandLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearUnsoldByBrandLoading(true);
      setMenswearUnsoldByBrandError(null);
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
        setMenswearUnsoldByBrandRows(
          raw.map((r) => ({
            brand_id: Number(r.brand_id),
            brand_name: String(r.brand_name ?? '—'),
            unsold_count: Math.max(0, Math.floor(Number(r.unsold_count) || 0)),
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearUnsoldByBrandRows([]);
        setMenswearUnsoldByBrandError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearUnsoldByBrandLoading(false);
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
      setMenswearUnsoldBrandCategory([]);
      setMenswearUnsoldBrandCategoryError(null);
      setMenswearUnsoldBrandCategoryLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearUnsoldBrandCategoryLoading(true);
      setMenswearUnsoldBrandCategoryError(null);
      try {
        const params = new URLSearchParams();
        params.set('limit', '10');
        const res = await fetch(
          apiUrl(
            `/api/menswear-categories/${menswearCategoryIdFromUrl}/unsold-inventory-by-brand-category?${params}`
          ),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{ rows?: MenswearUnsoldBrandCategoryRow[] }>(
          res,
          'menswear-unsold-inventory-by-brand-category'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setMenswearUnsoldBrandCategory(
          raw.map((r) => ({
            brand_id: (() => {
              const n = Math.floor(Number(r.brand_id));
              return Number.isFinite(n) && n > 0 ? n : 0;
            })(),
            brand_name: String(r.brand_name ?? '—'),
            category_name: String(r.category_name ?? 'Uncategorized'),
            category_id: (() => {
              if (r.category_id === null || r.category_id === undefined) return null;
              const n = Math.floor(Number(r.category_id));
              return Number.isFinite(n) ? n : null;
            })(),
            unsold_count: Math.max(0, Math.floor(Number(r.unsold_count) || 0)),
            sold_count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearUnsoldBrandCategory([]);
        setMenswearUnsoldBrandCategoryError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearUnsoldBrandCategoryLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, menswearCategoryIdFromUrl, menswearCategoryBrandsRefreshTick]);

  useEffect(() => {
    setMenswearStockDrilldown(null);
  }, [menswearCategoryIdFromUrl]);

  useEffect(() => {
    if (researchTab !== 'menswear-categories') {
      setMenswearStockDrilldown(null);
    }
  }, [researchTab]);

  useEffect(() => {
    if (researchTab !== 'menswear-categories' || menswearCategoryIdFromUrl == null) {
      setMenswearBuyMoreBrandCategory([]);
      setMenswearBuyMoreBrandCategoryError(null);
      setMenswearBuyMoreBrandCategoryLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearBuyMoreBrandCategoryLoading(true);
      setMenswearBuyMoreBrandCategoryError(null);
      try {
        const params = new URLSearchParams();
        params.set('limit', '10');
        const res = await fetch(
          apiUrl(
            `/api/menswear-categories/${menswearCategoryIdFromUrl}/buy-more-by-brand-category?${params}`
          ),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{ rows?: MenswearUnsoldBrandCategoryRow[] }>(
          res,
          'menswear-buy-more-by-brand-category'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setMenswearBuyMoreBrandCategory(
          raw.map((r) => ({
            brand_id: (() => {
              const n = Math.floor(Number(r.brand_id));
              return Number.isFinite(n) && n > 0 ? n : 0;
            })(),
            brand_name: String(r.brand_name ?? '—'),
            category_name: String(r.category_name ?? 'Uncategorized'),
            category_id: (() => {
              if (r.category_id === null || r.category_id === undefined) return null;
              const n = Math.floor(Number(r.category_id));
              return Number.isFinite(n) ? n : null;
            })(),
            unsold_count: Math.max(0, Math.floor(Number(r.unsold_count) || 0)),
            sold_count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearBuyMoreBrandCategory([]);
        setMenswearBuyMoreBrandCategoryError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearBuyMoreBrandCategoryLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, menswearCategoryIdFromUrl, menswearCategoryBrandsRefreshTick]);

  useEffect(() => {
    setMenswearBrandStockLinesCategoryFilter('all');
    setMenswearBrandStockChartDrillCategoryKey(null);
  }, [menswearBrandIdFromUrl]);

  useEffect(() => {
    if (
      researchTab !== 'menswear-categories' ||
      menswearCategoryIdFromUrl == null ||
      menswearBrandIdFromUrl == null
    ) {
      setMenswearBrandStockLines([]);
      setMenswearBrandStockLinesBrandName('');
      setMenswearBrandStockLinesError(null);
      setMenswearBrandStockLinesLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearBrandStockLinesLoading(true);
      setMenswearBrandStockLinesError(null);
      try {
        const params = new URLSearchParams();
        params.set('brand_id', String(menswearBrandIdFromUrl));
        const res = await fetch(
          apiUrl(
            `/api/menswear-categories/${menswearCategoryIdFromUrl}/brand-inventory-items?${params.toString()}`
          ),
          { signal: ac.signal }
        );
        const data = await readJsonResponse<{
          rows?: unknown[];
          brand_name?: string;
        }>(res, 'menswear-brand-inventory-items');
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setMenswearBrandStockLinesBrandName(
          typeof data.brand_name === 'string' ? data.brand_name : ''
        );
        setMenswearBrandStockLines(
          raw.map((row) => {
            const r = row as Record<string, unknown>;
            const rawPrice = r.purchase_price;
            const purchase_price: string | number | null =
              rawPrice === null || rawPrice === undefined
                ? null
                : typeof rawPrice === 'number' || typeof rawPrice === 'string'
                  ? rawPrice
                  : null;
            const rawTagId = r.brand_tag_image_id;
            const tagNum =
              rawTagId === null || rawTagId === undefined
                ? NaN
                : Math.floor(Number(rawTagId));
            const brand_tag_image_id =
              Number.isFinite(tagNum) && tagNum >= 1 ? tagNum : null;
            const rawSzId = r.category_size_id;
            const szNum =
              rawSzId === null || rawSzId === undefined ? NaN : Math.floor(Number(rawSzId));
            const category_size_id = Number.isFinite(szNum) && szNum >= 1 ? szNum : null;
            const rawSo = r.size_sort_order;
            const size_sort_order =
              rawSo === null || rawSo === undefined
                ? null
                : (() => {
                    const n = Number(rawSo);
                    return Number.isFinite(n) ? n : null;
                  })();
            return {
              id: Math.floor(Number(r.id) || 0),
              item_name: r.item_name != null ? String(r.item_name) : null,
              purchase_price,
              purchase_date: r.purchase_date != null ? String(r.purchase_date) : null,
              sale_date: r.sale_date != null && r.sale_date !== undefined ? String(r.sale_date) : null,
              category_id:
                r.category_id === null || r.category_id === undefined
                  ? null
                  : (() => {
                      const n = Math.floor(Number(r.category_id));
                      return Number.isFinite(n) ? n : null;
                    })(),
              category_name: String(r.category_name ?? 'Uncategorized'),
              category_size_id,
              size_label:
                category_size_id != null && r.size_label != null && String(r.size_label).trim() !== ''
                  ? String(r.size_label).trim()
                  : null,
              size_sort_order,
              brand_tag_image_id,
              tag_caption: r.tag_caption != null ? String(r.tag_caption) : null,
              tag_public_url:
                typeof r.tag_public_url === 'string' && r.tag_public_url.trim() !== ''
                  ? r.tag_public_url.trim()
                  : null,
            };
          })
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearBrandStockLines([]);
        setMenswearBrandStockLinesBrandName('');
        setMenswearBrandStockLinesError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearBrandStockLinesLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    researchTab,
    menswearCategoryIdFromUrl,
    menswearBrandIdFromUrl,
    menswearCategoryBrandsRefreshTick,
  ]);

  useEffect(() => {
    if (
      researchTab !== 'menswear-categories' ||
      menswearCategoryIdFromUrl == null ||
      menswearBrandIdFromUrl == null
    ) {
      setMenswearBrandInventoryStockSummary(null);
      setMenswearBrandInventoryStockSummaryError(null);
      setMenswearBrandInventoryStockSummaryLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearBrandInventoryStockSummaryLoading(true);
      setMenswearBrandInventoryStockSummaryError(null);
      try {
        const res = await fetch(
          apiUrl(`/api/brands/${menswearBrandIdFromUrl}/stock-summary`),
          { signal: ac.signal }
        );
        const raw = await readJsonResponse<unknown>(res, 'brand stock summary');
        if (cancelled) return;
        setMenswearBrandInventoryStockSummary(parseBrandStockSummaryPayload(raw));
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearBrandInventoryStockSummary(null);
        setMenswearBrandInventoryStockSummaryError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearBrandInventoryStockSummaryLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [researchTab, menswearCategoryIdFromUrl, menswearBrandIdFromUrl]);

  useEffect(() => {
    if (researchTab !== 'menswear-categories' || menswearCategoryIdFromUrl == null || !menswearStockDrilldown) {
      setMenswearDrilldownItems([]);
      setMenswearDrilldownItemsError(null);
      setMenswearDrilldownItemsLoading(false);
      return;
    }
    const ac = new AbortController();
    let cancelled = false;
    const load = async () => {
      setMenswearDrilldownItemsLoading(true);
      setMenswearDrilldownItemsError(null);
      try {
        const params = new URLSearchParams();
        params.set('brand_id', String(menswearStockDrilldown.brandId));
        if (menswearStockDrilldown.categoryId == null) {
          params.set('uncategorized', '1');
        } else {
          params.set('category_id', String(menswearStockDrilldown.categoryId));
        }
        const path =
          menswearStockDrilldown.kind === 'avoid'
            ? `/api/menswear-categories/${menswearCategoryIdFromUrl}/unsold-stock-items?${params.toString()}`
            : `/api/menswear-categories/${menswearCategoryIdFromUrl}/sold-stock-items?${params.toString()}`;
        const res = await fetch(apiUrl(path), { signal: ac.signal });
        const data = await readJsonResponse<{ rows?: MenswearDrilldownStockItemRow[] }>(
          res,
          'menswear-drilldown-stock-items'
        );
        if (cancelled) return;
        const raw = Array.isArray(data.rows) ? data.rows : [];
        setMenswearDrilldownItems(
          raw.map((r) => ({
            id: Math.floor(Number(r.id) || 0),
            item_name: r.item_name != null ? String(r.item_name) : null,
            purchase_price: r.purchase_price ?? null,
            purchase_date: r.purchase_date != null ? String(r.purchase_date) : null,
            sale_date:
              r.sale_date != null && String(r.sale_date).trim() !== '' ? String(r.sale_date) : null,
            vinted_id:
              r.vinted_id != null && String(r.vinted_id).trim() !== '' ? String(r.vinted_id).trim() : null,
            ebay_id: r.ebay_id != null && String(r.ebay_id).trim() !== '' ? String(r.ebay_id).trim() : null,
          }))
        );
      } catch (e) {
        if (cancelled || isAbortError(e)) return;
        setMenswearDrilldownItems([]);
        setMenswearDrilldownItemsError(friendlyApiUnreachableMessage(e));
      } finally {
        if (!cancelled) setMenswearDrilldownItemsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    researchTab,
    menswearCategoryIdFromUrl,
    menswearCategoryBrandsRefreshTick,
    menswearStockDrilldown,
  ]);

  /** Avoid: longest in stock now; buy-more: longest hold (purchase→sale) first. */
  const menswearDrilldownItemsSorted = useMemo(() => {
    const kind = menswearStockDrilldown?.kind;
    if (kind === 'avoid') {
      return [...menswearDrilldownItems].sort((a, b) => {
        const da = daysSincePurchase(a.purchase_date);
        const db = daysSincePurchase(b.purchase_date);
        const sa = da !== null ? da : -1;
        const sb = db !== null ? db : -1;
        if (sb !== sa) return sb - sa;
        return b.id - a.id;
      });
    }
    if (kind === 'buy-more') {
      return [...menswearDrilldownItems].sort((a, b) => {
        const da = daysHeldUntilSale(a.purchase_date, a.sale_date);
        const db = daysHeldUntilSale(b.purchase_date, b.sale_date);
        const sa = da !== null ? da : -1;
        const sb = db !== null ? db : -1;
        if (sb !== sa) return sb - sa;
        return b.id - a.id;
      });
    }
    return menswearDrilldownItems;
  }, [menswearDrilldownItems, menswearStockDrilldown?.kind]);

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
      if (rows.length === 0) {
        return {
          data: null as null,
          sliceCategoryIds: null as number[] | null,
          sliceBrandIds: null as number[] | null,
        };
      }
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
        sliceBrandIds: null as number[] | null,
      };
    }

    const sliceRows = menswearBrandSalesRows.map((b) => {
      const n =
        typeof b.total_sales === 'number' ? b.total_sales : parseFloat(String(b.total_sales));
      const idNum = Number(b.id);
      return {
        brandId: Number.isFinite(idNum) && idNum >= 1 ? idNum : 0,
        label: String(b.brand_name ?? '—'),
        totalSales: Number.isFinite(n) && n > 0 ? n : 0,
      };
    });
    const rows = sliceRows.filter((r) => r.totalSales > 0);
    if (rows.length === 0) {
      return {
        data: null as null,
        sliceCategoryIds: null as number[] | null,
        sliceBrandIds: null as number[] | null,
      };
    }
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
      sliceBrandIds: rows.map((r) => r.brandId),
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

  const clothingTypesSalesPieModel = useMemo(() => {
    const sliceRows = clothingTypesSalesRows.map((r) => {
      const n =
        typeof r.total_sales === 'number' ? r.total_sales : parseFloat(String(r.total_sales));
      const bucketId = r.category_id == null ? -1 : Number(r.category_id);
      return {
        bucketId: Number.isFinite(bucketId) ? bucketId : -1,
        label: String(r.category_name ?? '—'),
        totalSales: Number.isFinite(n) && n > 0 ? n : 0,
      };
    });
    const rows = sliceRows.filter((r) => r.totalSales > 0);
    if (rows.length === 0) {
      return { data: null as null, sliceBucketIds: null as number[] | null };
    }
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
      sliceBucketIds: rows.map((r) => r.bucketId),
    };
  }, [clothingTypesSalesRows]);

  const clothingTypesItemsSoldPieModel = useMemo(() => {
    const rows = clothingTypesSalesRows
      .map((r) => {
        const bucketId = r.category_id == null ? -1 : Number(r.category_id);
        return {
          bucketId: Number.isFinite(bucketId) ? bucketId : -1,
          label: String(r.category_name ?? '—'),
          count: Math.max(0, Math.floor(Number(r.sold_count) || 0)),
        };
      })
      .filter((r) => r.count > 0)
      .sort(
        (a, b) => b.count - a.count || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
      );
    if (rows.length === 0) {
      return { data: null as null, sliceBucketIds: null as number[] | null };
    }
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
      sliceBucketIds: rows.map((r) => r.bucketId),
    };
  }, [clothingTypesSalesRows]);

  const clothingTypesInventoryPieModel = useMemo(() => {
    /** Omit types with almost no purchase history so one-off lines don’t dominate the “avoid” chart. */
    const minTotalListingsForPie = 3;

    const rows = clothingTypesInventoryRows
      .map((r) => {
        const bucketId = r.category_id == null ? -1 : Number(r.category_id);
        const sold = Math.max(0, Math.floor(Number(r.sold_count) || 0));
        const unsold = Math.max(0, Math.floor(Number(r.unsold_count) || 0));
        const total =
          r.total_count > 0 ? Math.floor(Number(r.total_count) || 0) : sold + unsold;
        const ratio =
          Number.isFinite(r.unsold_ratio) && total > 0
            ? Math.min(1, Math.max(0, r.unsold_ratio))
            : total > 0
              ? unsold / total
              : 0;
        const pieWeight = unsold * ratio;
        return {
          bucketId: Number.isFinite(bucketId) ? bucketId : -1,
          label: String(r.category_name ?? '—'),
          sold,
          unsold,
          total,
          ratio,
          pieWeight,
        };
      })
      .filter(
        (r) =>
          r.unsold > 0 &&
          r.total >= minTotalListingsForPie &&
          r.ratio > 0 &&
          r.pieWeight > 0
      );

    rows.sort(
      (a, b) =>
        b.pieWeight - a.pieWeight ||
        b.unsold - a.unsold ||
        b.ratio - a.ratio ||
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    );

    if (rows.length === 0) {
      return {
        data: null as null,
        sliceBucketIds: null as number[] | null,
        inventorySliceMeta: null as ClothingTypeInventorySliceMeta[] | null,
      };
    }
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
    const inventorySliceMeta: ClothingTypeInventorySliceMeta[] = rows.map((r) => ({
      sold: r.sold,
      unsold: r.unsold,
      total: r.total,
      ratio: r.ratio,
      pieWeight: r.pieWeight,
    }));
    return {
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            /* Slice size = unsold × unsold_ratio: highlights types with many stuck units, not 1×100% flukes. */
            data: rows.map((r) => r.pieWeight),
            backgroundColor: rows.map((_, i) => palette[i % palette.length]),
            borderColor: 'rgba(14, 18, 26, 0.9)',
            borderWidth: 1.5,
          },
        ],
      },
      sliceBucketIds: rows.map((r) => r.bucketId),
      inventorySliceMeta,
    };
  }, [clothingTypesInventoryRows]);

  /**
   * Buying / inventory risk: sold vs unsold counts per type, ordered by worst sell-through first (then unsold, strain).
   * Strain (unsold × share unsold) can rank a big middling bucket above a small terrible one; sell-through matches
   * “worst categories to invest in” (e.g. few sold vs many listed).
   */
  const clothingTypesInvestRiskModel = useMemo(() => {
    const minTotalListed = 2;
    const chartTopN = 14;
    const rows = clothingTypesInventoryRows
      .map((r) => {
        const bucketId = r.category_id == null ? -1 : Number(r.category_id);
        const sold = Math.max(0, Math.floor(Number(r.sold_count) || 0));
        const unsold = Math.max(0, Math.floor(Number(r.unsold_count) || 0));
        const total =
          r.total_count > 0 ? Math.floor(Number(r.total_count) || 0) : sold + unsold;
        const ratio =
          Number.isFinite(r.unsold_ratio) && total > 0
            ? Math.min(1, Math.max(0, r.unsold_ratio))
            : total > 0
              ? unsold / total
              : 0;
        const strain = unsold * ratio;
        const sellThroughPct = total > 0 ? (sold / total) * 100 : 0;
        const profitRaw = r.total_net_profit;
        const unsoldInvRaw = r.unsold_inventory_total;
        const totalNetProfit =
          profitRaw == null || profitRaw === ''
            ? 0
            : typeof profitRaw === 'number'
              ? profitRaw
              : parseFloat(String(profitRaw));
        const unsoldInventoryTotal =
          unsoldInvRaw == null || unsoldInvRaw === ''
            ? 0
            : typeof unsoldInvRaw === 'number'
              ? unsoldInvRaw
              : parseFloat(String(unsoldInvRaw));
        return {
          bucketId: Number.isFinite(bucketId) ? bucketId : -1,
          label: String(r.category_name ?? '—'),
          sold,
          unsold,
          total,
          ratio,
          strain,
          sellThroughPct,
          totalNetProfit: Number.isFinite(totalNetProfit) ? totalNetProfit : 0,
          unsoldInventoryTotal: Number.isFinite(unsoldInventoryTotal) ? unsoldInventoryTotal : 0,
        };
      })
      .filter((r) => r.unsold > 0 && r.total >= minTotalListed)
      .sort(
        (a, b) =>
          a.sellThroughPct - b.sellThroughPct ||
          b.unsold - a.unsold ||
          b.strain - a.strain ||
          a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
      );

    if (rows.length === 0) {
      return {
        tableRows: [] as typeof rows,
        chartRowsInChartOrder: [] as typeof rows,
        chartData: null as null,
        chartBucketIds: null as number[] | null,
        buyTop5: [] as typeof rows,
        avoidTop5: [] as typeof rows,
      };
    }

    const buySorted = [...rows].sort(
      (a, b) =>
        b.sellThroughPct - a.sellThroughPct ||
        b.sold - a.sold ||
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    );
    const buyTop5 = buySorted.slice(0, 5);
    const avoidTop5 = rows.slice(0, 5);

    /** Worst sell-through first — same order for table and chart. */
    const chartOrderRows = rows.slice(0, chartTopN);
    /**
     * Chart.js 4 + indexAxis 'y': category index 0 maps to the *top* of the y-axis (see CategoryScale + getPixelForDecimal).
     * Do not reverse the slice; reversing put the worst type last → bottom of the chart.
     */
    const labelMax = 36;
    const labels = chartOrderRows.map((x) => {
      let L = x.label;
      if (L.length > labelMax) L = `${L.slice(0, labelMax - 1)}…`;
      return L;
    });

    const chartData = {
      labels,
      datasets: [
        {
          label: 'Sold lines',
          data: chartOrderRows.map((x) => x.sold),
          backgroundColor: 'rgba(130, 210, 155, 0.82)',
          borderColor: 'rgba(255, 214, 91, 0.38)',
          borderWidth: 1,
          stack: 'inv',
        },
        {
          label: 'Unsold lines',
          data: chartOrderRows.map((x) => x.unsold),
          backgroundColor: 'rgba(248, 113, 113, 0.78)',
          borderColor: 'rgba(255, 214, 91, 0.38)',
          borderWidth: 1,
          stack: 'inv',
        },
      ],
    };

    return {
      tableRows: rows,
      chartRowsInChartOrder: chartOrderRows,
      chartData,
      chartBucketIds: chartOrderRows.map((x) => x.bucketId),
      buyTop5,
      avoidTop5,
    };
  }, [clothingTypesInventoryRows]);

  const clothingTypesInvestRiskBarOptions = useMemo((): ChartOptions<'bar'> => {
    const ids = clothingTypesInvestRiskModel.chartBucketIds;
    const chartRows = clothingTypesInvestRiskModel.chartRowsInChartOrder;
    return {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      /* Without axis: 'y', horizontal stacked bars resolve the wrong category from the x (value) position. */
      interaction: { mode: 'index', intersect: false, axis: 'y' },
      onClick: (_evt, elements) => {
        if (!ids?.length || !elements?.length) return;
        const idx = elements[0]?.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= ids.length) return;
        openClothingTypeFromPieBucket(ids[idx]);
      },
      onHover: (evt, elements) => {
        const t = evt.native?.target;
        if (t instanceof HTMLElement) {
          t.style.cursor = ids && elements.length > 0 ? 'pointer' : 'default';
        }
      },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          ticks: { color: 'rgba(255, 248, 226, 0.62)', precision: 0 },
          grid: { color: 'rgba(255, 214, 91, 0.1)' },
        },
        y: {
          stacked: true,
          ticks: { color: 'rgba(255, 248, 226, 0.88)' },
          grid: { display: false },
        },
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: 'rgba(255, 248, 226, 0.88)', boxWidth: 12, boxHeight: 12 },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          axis: 'y',
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const chart = items[0].chart;
              const i = items[0].dataIndex;
              const labs = chart.data.labels;
              const raw = labs != null && i >= 0 && i < labs.length ? labs[i] : '';
              return typeof raw === 'string' ? raw : String(raw ?? '');
            },
            afterBody: (items) => {
              const i = items[0]?.dataIndex;
              if (typeof i !== 'number' || i < 0 || i >= chartRows.length) return [];
              const r = chartRows[i];
              const st = (Math.round(r.sellThroughPct * 10) / 10).toFixed(1);
              return [`Listed ${r.total} · Sell-through ${st}%`, 'Click bar to open type'];
            },
          },
        },
      },
    };
  }, [clothingTypesInvestRiskModel, openClothingTypeFromPieBucket]);

  const menswearBrandInventoryPieModel = useMemo(() => {
    if (menswearCategoryIdFromUrl == null) {
      return { data: null as null, sliceBrandIds: null as number[] | null };
    }
    const rows = menswearUnsoldByBrandRows
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
  }, [menswearCategoryIdFromUrl, menswearUnsoldByBrandRows]);

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
    const categorySliceIds = menswearSalesPieModel.sliceCategoryIds;
    const brandSliceIds = menswearSalesPieModel.sliceBrandIds;
    const clickable =
      (categorySliceIds?.length ?? 0) > 0 || (brandSliceIds?.length ?? 0) > 0;
    const goFromIndex = (idx: number) => {
      if (brandSliceIds?.length) {
        if (idx < 0 || idx >= brandSliceIds.length) return;
        const id = brandSliceIds[idx];
        if (id != null && Number.isFinite(id) && id >= 1) openBrandResearchInUrl(id);
        return;
      }
      if (categorySliceIds?.length) {
        if (idx < 0 || idx >= categorySliceIds.length) return;
        const id = categorySliceIds[idx];
        if (id != null && Number.isFinite(id) && id >= 1) openMenswearCategoryInUrl(id);
      }
    };
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!clickable || !elements?.length) return;
        const idx = elements[0]?.index;
        if (typeof idx !== 'number') return;
        goFromIndex(idx);
      },
      onHover: (evt, elements) => {
        const t = evt.native?.target;
        if (t instanceof HTMLElement) {
          t.style.cursor = clickable && elements.length > 0 ? 'pointer' : 'default';
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: 'rgba(255, 248, 226, 0.85)', boxWidth: 12, boxHeight: 12 },
          onClick: (_e, legendItem) => {
            if (!clickable) return;
            const idx = legendItem.index;
            if (typeof idx !== 'number') return;
            goFromIndex(idx);
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
  }, [
    menswearSalesPieModel.sliceBrandIds,
    menswearSalesPieModel.sliceCategoryIds,
    openBrandResearchInUrl,
    openMenswearCategoryInUrl,
  ]);

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

  const clothingTypesSalesPieChartOptions = useMemo((): ChartOptions<'pie'> => {
    const sliceIds = clothingTypesSalesPieModel.sliceBucketIds;
    const clickable = (sliceIds?.length ?? 0) > 0;
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!clickable || !sliceIds?.length || !elements?.length) return;
        const idx = elements[0]?.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
        openClothingTypeFromPieBucket(sliceIds[idx]);
      },
      onHover: (evt, elements) => {
        const t = evt.native?.target;
        if (t instanceof HTMLElement) {
          t.style.cursor = clickable && elements.length > 0 ? 'pointer' : 'default';
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
            openClothingTypeFromPieBucket(sliceIds[idx]);
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
  }, [clothingTypesSalesPieModel.sliceBucketIds, openClothingTypeFromPieBucket]);

  const clothingTypesItemsSoldPieChartOptions = useMemo((): ChartOptions<'pie'> => {
    const sliceIds = clothingTypesItemsSoldPieModel.sliceBucketIds;
    const clickable = (sliceIds?.length ?? 0) > 0;
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!clickable || !sliceIds?.length || !elements?.length) return;
        const idx = elements[0]?.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
        openClothingTypeFromPieBucket(sliceIds[idx]);
      },
      onHover: (evt, elements) => {
        const t = evt.native?.target;
        if (t instanceof HTMLElement) {
          t.style.cursor = clickable && elements.length > 0 ? 'pointer' : 'default';
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
            openClothingTypeFromPieBucket(sliceIds[idx]);
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
  }, [clothingTypesItemsSoldPieModel.sliceBucketIds, openClothingTypeFromPieBucket]);

  const clothingTypesInventoryPieChartOptions = useMemo((): ChartOptions<'pie'> => {
    const sliceIds = clothingTypesInventoryPieModel.sliceBucketIds;
    const meta = clothingTypesInventoryPieModel.inventorySliceMeta;
    const clickable = (sliceIds?.length ?? 0) > 0;
    return {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!clickable || !sliceIds?.length || !elements?.length) return;
        const idx = elements[0]?.index;
        if (typeof idx !== 'number' || idx < 0 || idx >= sliceIds.length) return;
        openClothingTypeFromPieBucket(sliceIds[idx]);
      },
      onHover: (evt, elements) => {
        const t = evt.native?.target;
        if (t instanceof HTMLElement) {
          t.style.cursor = clickable && elements.length > 0 ? 'pointer' : 'default';
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
            openClothingTypeFromPieBucket(sliceIds[idx]);
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const idx = typeof ctx.dataIndex === 'number' ? ctx.dataIndex : -1;
              const m = meta && idx >= 0 ? meta[idx] : undefined;
              if (!m) {
                const n = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
                return `${ctx.label}: ${Number.isFinite(n) ? n.toFixed(2) : '—'} (chart weight)`;
              }
              const ratioPct = (Math.round(m.ratio * 1000) / 10).toFixed(1);
              const sumW = (meta ?? []).reduce((s, x) => s + x.pieWeight, 0);
              const chartPct =
                sumW > 0 ? ((100 * m.pieWeight) / sumW).toFixed(1) : '0';
              return [
                `Unsold ${m.unsold} · Sold ${m.sold} · Total ${m.total}`,
                `${ratioPct}% of lines in this category are unsold`,
                `${chartPct}% of this chart (unsold × strain)`,
              ];
            },
          },
        },
      },
    };
  }, [clothingTypesInventoryPieModel, openClothingTypeFromPieBucket]);

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

  const toggleMenswearCategoryBrandRemoval = useCallback((brandId: number) => {
    setMenswearCategoryBrandRemovalIds((prev) => {
      const next = new Set(prev);
      if (next.has(brandId)) next.delete(brandId);
      else next.add(brandId);
      return next;
    });
  }, []);

  const removeSelectedBrandsFromMenswearCategory = useCallback(async () => {
    if (menswearCategoryIdFromUrl == null) return;
    const ids = Array.from(menswearCategoryBrandRemovalIds);
    if (ids.length === 0) return;
    setMenswearCategoryRemoveBrandsSaving(true);
    setMenswearCategoryRemoveBrandsError(null);
    try {
      for (const brandId of ids) {
        const res = await fetch(apiUrl(`/api/brands/${brandId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ menswear_category_id: null }),
        });
        await readJsonResponse<{ row?: BrandRow }>(res, 'remove brand from menswear category');
      }
      setBrandsWithWebsites((prev) =>
        prev.map((b) => (ids.includes(b.id) ? { ...b, menswear_category_id: null } : b))
      );
      if (menswearBrandIdFromUrl != null && ids.includes(menswearBrandIdFromUrl)) {
        closeMenswearBrandInventoryInUrl();
      }
      setMenswearCategoryBrandRemovalIds(new Set());
      setMenswearCategoryBrandsEditMode(false);
      setMenswearCategoryBrandsRefreshTick((n) => n + 1);
    } catch (e) {
      setMenswearCategoryRemoveBrandsError(friendlyApiUnreachableMessage(e));
    } finally {
      setMenswearCategoryRemoveBrandsSaving(false);
    }
  }, [
    menswearCategoryIdFromUrl,
    menswearCategoryBrandRemovalIds,
    menswearBrandIdFromUrl,
    closeMenswearBrandInventoryInUrl,
  ]);

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

  /** On Brand tab: chosen department, or Menswear (then first dept) from the API list until the user changes the dropdown. */
  const brandResearchDepartmentFilterEffective = useMemo(() => {
    if (researchTab !== 'brand') return null;
    if (researchDepartments.length === 0) return null;
    if (brandResearchDepartmentFilterSelection === 'all') return null;
    if (typeof brandResearchDepartmentFilterSelection === 'number') return brandResearchDepartmentFilterSelection;
    const mw = researchDepartments.find(
      (d) => String(d.department_name ?? '').trim().toLowerCase() === 'menswear'
    );
    return mw?.id ?? researchDepartments[0]?.id ?? null;
  }, [researchTab, brandResearchDepartmentFilterSelection, researchDepartments]);

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

    const brandMatchesResearchDept = (b: BrandRow) => {
      if (researchTab !== 'brand' || brandResearchDepartmentFilterEffective == null) return true;
      return b.department_id != null && b.department_id === brandResearchDepartmentFilterEffective;
    };

    let id: number | null = null;
    if (looksNumericId && brandsWithWebsites.some((b) => b.id === asNum)) {
      const hit = brandsWithWebsites.find((b) => b.id === asNum);
      if (hit && brandMatchesResearchDept(hit)) id = asNum;
    } else {
      const found = brandsWithWebsites.find(
        (b) => b.brand_name.toLowerCase().trim() === trimmed.toLowerCase()
      );
      if (found && brandMatchesResearchDept(found)) id = found.id;
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
  }, [
    brandsLoaded,
    brandsWithWebsites,
    brandQueryParam,
    researchTab,
    brandResearchDepartmentFilterEffective,
    setSearchParams,
  ]);

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

  const brandsForBrandResearchTypeahead = useMemo(() => {
    if (brandResearchDepartmentFilterEffective == null) return brandsWithWebsites;
    return brandsWithWebsites.filter(
      (b) => b.department_id != null && b.department_id === brandResearchDepartmentFilterEffective
    );
  }, [brandsWithWebsites, brandResearchDepartmentFilterEffective]);

  const brandTabTypeaheadList = useMemo(() => {
    const list = brandsForBrandResearchTypeahead;
    const q = brandTabQuery.trim().toLowerCase();
    const filtered = !q ? list : list.filter((br) => br.brand_name.toLowerCase().includes(q));
    return [...filtered].sort((a, b) =>
      a.brand_name.localeCompare(b.brand_name, undefined, { sensitivity: 'base' })
    );
  }, [brandsForBrandResearchTypeahead, brandTabQuery]);

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

  useEffect(() => {
    if (researchTab !== 'brand') return;
    if (brandResearchDepartmentFilterEffective == null) return;
    if (brandTagBrandId === '') return;
    const b = brandsWithWebsites.find((x) => x.id === brandTagBrandId);
    if (
      !b ||
      b.department_id == null ||
      b.department_id !== brandResearchDepartmentFilterEffective
    ) {
      clearBrandTabSelection();
    }
  }, [
    researchTab,
    brandResearchDepartmentFilterEffective,
    brandTagBrandId,
    brandsWithWebsites,
    clearBrandTabSelection,
  ]);

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
        body: JSON.stringify({
          brand_name: name,
          ...(brandResearchDepartmentFilterEffective != null
            ? { department_id: brandResearchDepartmentFilterEffective }
            : {}),
        }),
      });
      const data = await readJsonResponse<{
        row?: { id: number; brand_name: string; department_id?: number | null };
      }>(response, 'create brand');
      const row = data.row;
      if (!row || typeof row.id !== 'number') {
        throw new Error('Invalid response from server');
      }
      const newDeptId =
        row.department_id != null ? Number(row.department_id) : brandResearchDepartmentFilterEffective;
      const newRow: BrandRow = {
        id: row.id,
        brand_name: row.brand_name.trim(),
        brand_website: null,
        things_to_buy: null,
        things_to_avoid: null,
        description: null,
        menswear_category_id: null,
        department_id:
          newDeptId != null && Number.isFinite(newDeptId) && newDeptId >= 1 ? newDeptId : null,
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
  }, [brandCreateName, brandResearchDepartmentFilterEffective, searchParams, setSearchParams]);

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
    setBrandTagAddSubMode('image');
    setBrandWebsiteUrlDraft('');
    setBrandBuyingNotesBuyDraft('');
    setBrandBuyingNotesAvoidDraft('');
    setBrandDescriptionDraft('');
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

  const sortedBrandTagImages = useMemo(
    () => sortBrandTagImages(brandTagImages, brandTagQualitySort),
    [brandTagImages, brandTagQualitySort]
  );

  const brandLogoRow = useMemo(
    () => brandTagImages.find((i) => i.image_kind === 'logo'),
    [brandTagImages]
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

  /** Top 4 categories by sold revenue (API: highest first), then ascending by sold value for tag order. */
  const brandStockItemsToBuyTags = useMemo(() => {
    const rows = brandStockSummary?.bestSoldByCategory;
    if (!rows?.length) return [];
    const top4 = rows.slice(0, 4);
    return [...top4].sort((a, b) => {
      if (a.totalSoldValue !== b.totalSoldValue) return a.totalSoldValue - b.totalSoldValue;
      return a.categoryName.localeCompare(b.categoryName, undefined, { sensitivity: 'base' });
    });
  }, [brandStockSummary?.bestSoldByCategory]);

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
    const desc = brandDescriptionDraft.trim();
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
          description: desc ? desc.slice(0, 8000) : null,
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
        setBrandDescriptionDraft(
          row.description != null && String(row.description).trim()
            ? String(row.description).trim()
            : ''
        );
      }
      setBrandTagCaption('');
      setBrandTagNewImageKind('tag');
      setBrandTagAddPanelOpen(false);
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

  const handleBrandLogoFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !brandTagBrandId) {
      return;
    }

    setBrandLogoUploading(true);
    setBrandTagError(null);
    try {
      const formData = new FormData();
      formData.append('brandId', String(brandTagBrandId));
      formData.append('image', file);
      formData.append('imageKind', 'logo');

      const response = await fetch(apiUrl('/api/brandTagImages'), {
        method: 'POST',
        body: formData,
      });
      const data = await readJsonResponse<BrandTagImageRow & { error?: string }>(
        response,
        'brandTagImages upload logo'
      );
      const normalized = normalizeBrandTagImageRow(data);
      setBrandTagImages((prev) => [...prev.filter((r) => r.image_kind !== 'logo'), normalized]);
    } catch (err: unknown) {
      setBrandTagError(friendlyApiUnreachableMessage(err));
    } finally {
      setBrandLogoUploading(false);
    }
  };

  const closeBrandTagAddPanel = useCallback(() => {
    setBrandWebsiteUrlDraft('');
    setBrandBuyingNotesBuyDraft('');
    setBrandBuyingNotesAvoidDraft('');
    setBrandDescriptionDraft('');
    setBrandTagCaption('');
    setBrandTagNewImageKind('tag');
    setBrandTagAddPanelOpen(false);
  }, []);

  const handleToggleBrandTagImagePanel = useCallback(() => {
    if (brandTagAddPanelOpen && brandTagAddSubMode === 'image') {
      closeBrandTagAddPanel();
      return;
    }
    setBrandTagCaption('');
    setBrandTagNewImageKind('tag');
    setBrandTagAddSubMode('image');
    setBrandTagAddPanelOpen(true);
  }, [brandTagAddPanelOpen, brandTagAddSubMode, closeBrandTagAddPanel]);

  const handleToggleEditBrandDescriptionPanel = useCallback(() => {
    if (brandTagAddPanelOpen && brandTagAddSubMode === 'info') {
      closeBrandTagAddPanel();
      return;
    }
    const b = brandsWithWebsites.find((x) => x.id === brandTagBrandId);
    if (b) {
      setBrandWebsiteUrlDraft(b.brand_website?.trim() ?? '');
      setBrandBuyingNotesBuyDraft(b.things_to_buy?.trim() ?? '');
      setBrandBuyingNotesAvoidDraft(b.things_to_avoid?.trim() ?? '');
      setBrandDescriptionDraft(b.description?.trim() ?? '');
    }
    setBrandTagAddSubMode('info');
    setBrandTagAddPanelOpen(true);
  }, [
    brandTagAddPanelOpen,
    brandTagAddSubMode,
    brandTagBrandId,
    brandsWithWebsites,
    closeBrandTagAddPanel,
  ]);

  const handleDeleteBrandTagImage = async (
    imageId: number,
    confirmMessage = 'Remove this example tag image?'
  ) => {
    if (!window.confirm(confirmMessage)) {
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

  const menswearBrandStockLinesCategoryFilterOptions = useMemo(() => {
    const m = new Map<number, string>();
    let hasUncat = false;
    for (const r of menswearBrandStockLines) {
      if (r.category_id == null) hasUncat = true;
      else if (!m.has(r.category_id)) m.set(r.category_id, r.category_name);
    }
    const opts: { value: string; label: string }[] = [{ value: 'all', label: 'All categories' }];
    if (hasUncat) opts.push({ value: 'uncategorized', label: 'Uncategorized' });
    Array.from(m.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .forEach(([id, name]) => opts.push({ value: String(id), label: name }));
    return opts;
  }, [menswearBrandStockLines]);

  const menswearBrandStockLinesFilteredRows = useMemo(() => {
    const f = menswearBrandStockLinesCategoryFilter;
    if (f === 'all' || !f) return menswearBrandStockLines;
    if (f === 'uncategorized') {
      return menswearBrandStockLines.filter((r) => r.category_id == null);
    }
    const id = parseInt(f, 10);
    if (!Number.isFinite(id)) return menswearBrandStockLines;
    return menswearBrandStockLines.filter((r) => r.category_id === id);
  }, [menswearBrandStockLines, menswearBrandStockLinesCategoryFilter]);

  /** Stacked horizontal bars: one bar per category (inventory + sold). Sort descending by in-stock; Chart.js draws the first label at the top for indexAxis 'y'. Full brand lines, not table filter. */
  const menswearBrandStockCategoryStackChart = useMemo(() => {
    const rows = menswearBrandStockLines;
    if (rows.length === 0) return null;
    type Agg = { displayName: string; filterValue: string; inStock: number; sold: number };
    const byKey = new Map<string, Agg>();
    const rowKey = (r: MenswearBrandInventoryItemRow): string => {
      if (r.category_id != null && Number.isFinite(Number(r.category_id))) {
        return `id:${r.category_id}`;
      }
      return 'uncategorized';
    };
    for (const r of rows) {
      const k = rowKey(r);
      let g = byKey.get(k);
      if (!g) {
        const displayName =
          k === 'uncategorized'
            ? 'Uncategorized'
            : (r.category_name ?? '').trim() || 'Uncategorized';
        g = {
          displayName,
          filterValue: k === 'uncategorized' ? 'uncategorized' : String(r.category_id),
          inStock: 0,
          sold: 0,
        };
        byKey.set(k, g);
      }
      const inStock = r.sale_date == null || String(r.sale_date).trim() === '';
      if (inStock) g.inStock += 1;
      else g.sold += 1;
    }
    const sorted = Array.from(byKey.values()).sort((a, b) => {
      if (b.inStock !== a.inStock) return b.inStock - a.inStock;
      if (b.sold !== a.sold) return b.sold - a.sold;
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    });
    const labelMax = 34;
    const labels = sorted.map((x) => {
      let label = x.displayName;
      if (label.length > labelMax) label = `${label.slice(0, labelMax - 1)}…`;
      return label;
    });
    const data = {
      labels,
      datasets: [
        {
          label: 'In stock',
          data: sorted.map((x) => x.inStock),
          backgroundColor: 'rgba(255, 165, 120, 0.72)',
          borderColor: 'rgba(255, 214, 91, 0.45)',
          borderWidth: 1,
          stack: 'cat',
        },
        {
          label: 'Sold',
          data: sorted.map((x) => x.sold),
          backgroundColor: 'rgba(130, 210, 155, 0.78)',
          borderColor: 'rgba(255, 214, 91, 0.45)',
          borderWidth: 1,
          stack: 'cat',
        },
      ],
    };
    return {
      data,
      categoryFilterValues: sorted.map((x) => x.filterValue),
      categoryFullDisplayNames: sorted.map((x) => x.displayName),
    };
  }, [menswearBrandStockLines]);

  /** Stacked horizontal bars by size within the drilled menswear brand category (in stock + sold). */
  const menswearBrandStockSizeStackChart = useMemo(() => {
    const drill = menswearBrandStockChartDrillCategoryKey;
    if (drill == null) return null;
    const rows = menswearBrandStockLines;
    const filtered = rows.filter((r) => {
      if (drill === 'uncategorized') return r.category_id == null;
      const id = parseInt(drill, 10);
      if (!Number.isFinite(id)) return false;
      return r.category_id === id;
    });
    if (filtered.length === 0) return null;
    type Agg = { displayName: string; sortOrder: number; inStock: number; sold: number };
    const byKey = new Map<string, Agg>();
    const unsizedOrder = 1_000_000;
    for (const r of filtered) {
      const k =
        r.category_size_id != null && Number.isFinite(Number(r.category_size_id))
          ? `id:${r.category_size_id}`
          : 'unsized';
      let g = byKey.get(k);
      if (!g) {
        const label =
          k === 'unsized'
            ? 'Unsized'
            : (r.size_label ?? '').trim() || `Size #${r.category_size_id}`;
        const so = r.size_sort_order;
        const sortOrder =
          k !== 'unsized' && so != null && Number.isFinite(so) ? so : unsizedOrder;
        g = { displayName: label, sortOrder, inStock: 0, sold: 0 };
        byKey.set(k, g);
      }
      const inStock = r.sale_date == null || String(r.sale_date).trim() === '';
      if (inStock) g.inStock += 1;
      else g.sold += 1;
    }
    const sorted = Array.from(byKey.values()).sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    });
    const labelMax = 34;
    const labels = sorted.map((x) => {
      let label = x.displayName;
      if (label.length > labelMax) label = `${label.slice(0, labelMax - 1)}…`;
      return label;
    });
    return {
      data: {
        labels,
        datasets: [
          {
            label: 'In stock',
            data: sorted.map((x) => x.inStock),
            backgroundColor: 'rgba(255, 165, 120, 0.72)',
            borderColor: 'rgba(255, 214, 91, 0.45)',
            borderWidth: 1,
            stack: 'size',
          },
          {
            label: 'Sold',
            data: sorted.map((x) => x.sold),
            backgroundColor: 'rgba(130, 210, 155, 0.78)',
            borderColor: 'rgba(255, 214, 91, 0.45)',
            borderWidth: 1,
            stack: 'size',
          },
        ],
      },
    };
  }, [menswearBrandStockLines, menswearBrandStockChartDrillCategoryKey]);

  const menswearBrandStockChartDrillCategoryTitle = useMemo(() => {
    const drill = menswearBrandStockChartDrillCategoryKey;
    const chart = menswearBrandStockCategoryStackChart;
    if (drill == null || !chart) return '';
    const idx = chart.categoryFilterValues.indexOf(drill);
    if (idx < 0) return '';
    return chart.categoryFullDisplayNames[idx] ?? '';
  }, [menswearBrandStockChartDrillCategoryKey, menswearBrandStockCategoryStackChart]);

  /** Tag thumbnails + sold/unsold counts (full brand lines). Hidden when no rows use a tag. */
  const menswearBrandTagInventoryCharts = useMemo(() => {
    const rows = menswearBrandStockLines;
    type Agg = {
      id: number;
      caption: string;
      publicUrl: string | null;
      sold: number;
      unsold: number;
    };
    const byId = new Map<number, Agg>();
    for (const r of rows) {
      if (r.brand_tag_image_id == null) continue;
      const id = r.brand_tag_image_id;
      let g = byId.get(id);
      if (!g) {
        const cap = (r.tag_caption ?? '').trim();
        g = {
          id,
          caption: cap || `Tag #${id}`,
          publicUrl: r.tag_public_url,
          sold: 0,
          unsold: 0,
        };
        byId.set(id, g);
      }
      const inStock = r.sale_date == null || String(r.sale_date).trim() === '';
      if (inStock) g.unsold += 1;
      else g.sold += 1;
      if (r.tag_public_url && !g.publicUrl) g.publicUrl = r.tag_public_url;
    }
    if (byId.size === 0) return null;
    const tags = Array.from(byId.values()).sort(
      (a, b) => b.sold + b.unsold - (a.sold + a.unsold)
    );
    const maxSold = Math.max(1, ...tags.map((t) => t.sold));
    const maxUnsold = Math.max(1, ...tags.map((t) => t.unsold));
    return { tags, maxSold, maxUnsold };
  }, [menswearBrandStockLines]);

  const menswearBrandStockCategoryStackBarOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
        axis: 'y',
      },
      onHover: (_event, elements, chart) => {
        const canvas = chart?.canvas;
        if (canvas) canvas.style.cursor = elements.length > 0 ? 'pointer' : 'default';
      },
      onClick: (_event, elements) => {
        if (!elements?.length) return;
        const idx = elements[0].index;
        const values = menswearBrandStockCategoryStackChart?.categoryFilterValues;
        if (!values || idx < 0 || idx >= values.length) return;
        const key = values[idx];
        setMenswearBrandStockChartDrillCategoryKey(key);
        setMenswearBrandStockLinesCategoryFilter(key);
      },
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
          mode: 'index',
          intersect: false,
          axis: 'y',
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const chart = items[0].chart;
              const i = items[0].dataIndex;
              const labels = chart.data.labels;
              const raw = labels != null && i >= 0 && i < labels.length ? labels[i] : '';
              return typeof raw === 'string' ? raw : String(raw ?? '');
            },
            label: (ctx) => {
              const n = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
              const label = ctx.dataset.label ?? '';
              return `${label}: ${n} item${n === 1 ? '' : 's'}`;
            },
            footer: (items) => {
              if (!items.length) return '';
              const chart = items[0].chart;
              const i = items[0].dataIndex;
              const sum = chart.data.datasets.reduce(
                (acc, d) => acc + Number(Array.isArray(d.data) ? d.data[i] : 0),
                0
              );
              return `Total in category: ${sum}`;
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
          stacked: true,
          ticks: {
            color: 'rgba(255, 248, 226, 0.88)',
            font: { size: 12 },
          },
          grid: { display: false },
        },
      },
    }),
    [menswearBrandStockCategoryStackChart]
  );

  const menswearBrandStockSizeStackBarOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
        axis: 'y',
      },
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
          mode: 'index',
          intersect: false,
          axis: 'y',
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const chart = items[0].chart;
              const i = items[0].dataIndex;
              const labels = chart.data.labels;
              const raw = labels != null && i >= 0 && i < labels.length ? labels[i] : '';
              return typeof raw === 'string' ? raw : String(raw ?? '');
            },
            label: (ctx) => {
              const n = typeof ctx.raw === 'number' ? ctx.raw : Number(ctx.raw);
              const label = ctx.dataset.label ?? '';
              return `${label}: ${n} item${n === 1 ? '' : 's'}`;
            },
            footer: (items) => {
              if (!items.length) return '';
              const chart = items[0].chart;
              const i = items[0].dataIndex;
              const sum = chart.data.datasets.reduce(
                (acc, d) => acc + Number(Array.isArray(d.data) ? d.data[i] : 0),
                0
              );
              return `Total for size: ${sum}`;
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
          stacked: true,
          ticks: {
            color: 'rgba(255, 248, 226, 0.88)',
            font: { size: 12 },
          },
          grid: { display: false },
        },
      },
    }),
    []
  );

  const runMenswearAvoidStockAskAi = useCallback(async () => {
    if (menswearCategoryIdFromUrl == null || !selectedMenswearCategory) return;
    const rows = menswearUnsoldBrandCategory.filter((r) => r.brand_id >= 1);
    if (rows.length === 0) {
      setMenswearAskAiHint('Load “Stock To Avoid Buying” data first (need at least one row).');
      window.setTimeout(() => setMenswearAskAiHint(null), 4500);
      return;
    }
    const worst = pickWorstThreeAvoidStockRows(rows);
    setMenswearAskAiBusy(true);
    setMenswearAskAiHint(null);
    try {
      const itemRowsPerWorst: AvoidStockAskAiItem[][] = await Promise.all(
        worst.map(async (r) => {
          const params = new URLSearchParams();
          params.set('brand_id', String(r.brand_id));
          if (r.category_id == null) {
            params.set('uncategorized', '1');
          } else {
            params.set('category_id', String(r.category_id));
          }
          const res = await fetch(
            apiUrl(
              `/api/menswear-categories/${menswearCategoryIdFromUrl}/unsold-stock-items?${params.toString()}`
            )
          );
          const data = await readJsonResponse<{ rows?: MenswearDrilldownStockItemRow[] }>(
            res,
            'menswear-avoid-stock-ask-ai-items'
          );
          const raw = Array.isArray(data.rows) ? data.rows : [];
          return raw.map((row) => ({
            id: Math.floor(Number(row.id) || 0),
            item_name: row.item_name != null ? String(row.item_name) : null,
            purchase_price: row.purchase_price ?? null,
            purchase_date: row.purchase_date != null ? String(row.purchase_date) : null,
            sale_date: null,
            vinted_id:
              row.vinted_id != null && String(row.vinted_id).trim() !== ''
                ? String(row.vinted_id).trim()
                : null,
            ebay_id:
              row.ebay_id != null && String(row.ebay_id).trim() !== ''
                ? String(row.ebay_id).trim()
                : null,
          }));
        })
      );
      const text = buildMenswearAvoidStockAskAiPrompt({
        menswearCategoryName: selectedMenswearCategory.name,
        worstRows: worst,
        itemRowsPerWorst,
      });
      await copyResearchTextToClipboard(text);
      setMenswearAskAiHint('Copied to clipboard — paste into ChatGPT.');
    } catch (e) {
      setMenswearAskAiHint(friendlyApiUnreachableMessage(e));
    } finally {
      setMenswearAskAiBusy(false);
      window.setTimeout(() => setMenswearAskAiHint(null), 5000);
    }
  }, [menswearCategoryIdFromUrl, selectedMenswearCategory, menswearUnsoldBrandCategory]);

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

  const clothingTypesResearchDepartmentLabel = useMemo(() => {
    if (clothingTypesListDepartmentIdForApi == null) return 'this department';
    const row = researchDepartments.find((d) => d.id === clothingTypesListDepartmentIdForApi);
    const n = row?.department_name?.trim();
    return n || `department #${clothingTypesListDepartmentIdForApi}`;
  }, [researchDepartments, clothingTypesListDepartmentIdForApi]);

  const showClothingTypesSplit =
    !clothingTypesListLoading && !clothingTypesListError && clothingTypeSelection === null;

  const selectedClothingTypeLabel = useMemo(() => {
    if (!clothingTypeSelection) return '';
    if (clothingTypeSelection.mode === 'uncategorized') return 'Uncategorized';
    const row = clothingTypesListRows.find((r) => r.id === clothingTypeSelection.id);
    return row?.category_name ?? `Category #${clothingTypeSelection.id}`;
  }, [clothingTypeSelection, clothingTypesListRows]);

  const clothingTypeBrandUrlKey = useMemo((): string | number => {
    if (clothingTypeSelection?.mode === 'uncategorized') return 'uncategorized';
    if (clothingTypeSelection?.mode === 'category') return clothingTypeSelection.id;
    return 0;
  }, [clothingTypeSelection]);

  const clothingTypeDetailBestRows = useMemo(
    () => clothingTypeBuyMoreBrandCategory.slice(0, 5),
    [clothingTypeBuyMoreBrandCategory]
  );

  const clothingTypeDetailWorstRows = useMemo(
    () => clothingTypeUnsoldBrandCategory.slice(0, 5),
    [clothingTypeUnsoldBrandCategory]
  );

  const clothingTypeDrilldownItemsSorted = useMemo(() => {
    const kind = clothingTypeStockDrilldown?.kind;
    if (kind === 'avoid') {
      return [...clothingTypeDrilldownItems].sort((a, b) => {
        const da = daysSincePurchase(a.purchase_date);
        const db = daysSincePurchase(b.purchase_date);
        const sa = da !== null ? da : -1;
        const sb = db !== null ? db : -1;
        if (sb !== sa) return sb - sa;
        return b.id - a.id;
      });
    }
    if (kind === 'buy-more') {
      return [...clothingTypeDrilldownItems].sort((a, b) => {
        const da = daysHeldUntilSale(a.purchase_date, a.sale_date);
        const db = daysHeldUntilSale(b.purchase_date, b.sale_date);
        const sa = da !== null ? da : -1;
        const sb = db !== null ? db : -1;
        if (sb !== sa) return sb - sa;
        return b.id - a.id;
      });
    }
    return clothingTypeDrilldownItems;
  }, [clothingTypeDrilldownItems, clothingTypeStockDrilldown?.kind]);

  const clothingTypeBrandStockLinesCategoryFilterOptions = useMemo(() => {
    const m = new Map<number, string>();
    let hasUncat = false;
    for (const r of clothingTypeBrandStockLines) {
      if (r.category_id == null) hasUncat = true;
      else if (Number.isFinite(Number(r.category_id))) {
        m.set(Number(r.category_id), String(r.category_name ?? '').trim() || '—');
      }
    }
    const opts: { value: string; label: string }[] = [{ value: 'all', label: 'All categories' }];
    if (hasUncat) opts.push({ value: 'uncategorized', label: 'Uncategorized' });
    Array.from(m.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .forEach(([id, name]) => opts.push({ value: String(id), label: name }));
    return opts;
  }, [clothingTypeBrandStockLines]);

  const clothingTypeBrandStockLinesFilteredRows = useMemo(() => {
    const f = clothingTypeBrandStockLinesCategoryFilter;
    if (f === 'all' || !f) return clothingTypeBrandStockLines;
    if (f === 'uncategorized') {
      return clothingTypeBrandStockLines.filter((r) => r.category_id == null);
    }
    const id = parseInt(f, 10);
    if (!Number.isFinite(id)) return clothingTypeBrandStockLines;
    return clothingTypeBrandStockLines.filter((r) => r.category_id === id);
  }, [clothingTypeBrandStockLines, clothingTypeBrandStockLinesCategoryFilter]);

  const clothingTypesHasUncategorized = useMemo(
    () =>
      clothingTypesSalesRows.some((r) => r.category_id == null) ||
      clothingTypesInventoryRows.some((r) => r.category_id == null),
    [clothingTypesSalesRows, clothingTypesInventoryRows]
  );

  /** Menswear Categories tab: `mcPanel` selects subpanel. List view defaults to chart; detail defaults to overview. */
  const menswearClothingSubpanel = useMemo<'overview' | 'sales'>(() => {
    const p = searchParams.get('mcPanel')?.trim().toLowerCase();
    if (p === 'overview') return 'overview';
    if (p === 'sales' || p === 'chart') return 'sales';
    return menswearCategoryIdFromUrl === null ? 'sales' : 'overview';
  }, [searchParams, menswearCategoryIdFromUrl]);

  const setMenswearClothingSubpanel = useCallback(
    (panel: 'overview' | 'sales') => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const rawCat = next.get('menswearCategoryId')?.trim();
          const catNum = rawCat ? parseInt(rawCat, 10) : NaN;
          const onListView = !Number.isFinite(catNum) || catNum < 1;
          if (panel === 'overview') {
            if (onListView) {
              next.set('mcPanel', 'overview');
            } else {
              next.delete('mcPanel');
            }
          } else if (onListView) {
            next.delete('mcPanel');
          } else {
            next.set('mcPanel', 'sales');
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const menswearDetailBestBrandCategoryRows = useMemo(
    () => menswearBuyMoreBrandCategory.slice(0, 5),
    [menswearBuyMoreBrandCategory]
  );

  const menswearDetailWorstBrandCategoryRows = useMemo(() => {
    if (menswearUnsoldBrandCategory.length === 0) return [];
    const rate = (r: MenswearUnsoldBrandCategoryRow) =>
      avoidStockSellRateDecimal(r.unsold_count, r.sold_count);
    return [...menswearUnsoldBrandCategory]
      .filter((r) => r.brand_id >= 1)
      .sort((a, b) => {
        const ra = rate(a);
        const rb = rate(b);
        if (ra !== rb) return ra - rb;
        return b.unsold_count - a.unsold_count;
      })
      .slice(0, 5);
  }, [menswearUnsoldBrandCategory]);

  /** Config buckets for the department plus any research category ids that appear in sales/inventory (e.g. Electronics brands still mapped to Menswear-department buckets). */
  const menswearListViewCategoryUnion = useMemo(() => {
    const nameById = new Map<number, string>();
    for (const cat of menswearCategories) {
      nameById.set(cat.id, cat.name);
    }
    for (const r of menswearCategorySalesRows) {
      const id = r.category_id;
      if (!nameById.has(id)) nameById.set(id, String(r.category_name ?? '—'));
    }
    for (const r of menswearCategoryInventoryRows) {
      const id = r.category_id;
      if (!nameById.has(id)) nameById.set(id, String(r.category_name ?? '—'));
    }
    const ids = Array.from(nameById.keys()).sort((a, b) =>
      (nameById.get(a) ?? '').localeCompare(nameById.get(b) ?? '', undefined, { sensitivity: 'base' })
    );
    return ids.map((id) => ({ id, name: nameById.get(id) ?? `Category #${id}` }));
  }, [menswearCategories, menswearCategorySalesRows, menswearCategoryInventoryRows]);

  const menswearBucketOverviewRows = useMemo(() => {
    const salesById = new Map<number, MenswearCategorySalesRow>();
    for (const r of menswearCategorySalesRows) {
      salesById.set(r.category_id, r);
    }
    const invById = new Map<number, MenswearCategoryInventoryRow>();
    for (const r of menswearCategoryInventoryRows) {
      invById.set(r.category_id, r);
    }
    return menswearListViewCategoryUnion.map((cat) => {
      const s = salesById.get(cat.id);
      const inv = invById.get(cat.id);
      const tsRaw =
        typeof s?.total_sales === 'number' ? s.total_sales : parseFloat(String(s?.total_sales ?? '0'));
      const totalSales = Number.isFinite(tsRaw) && tsRaw > 0 ? tsRaw : 0;
      const sold = Math.max(0, Math.floor(Number(s?.sold_count) || 0));
      const unsold = Math.max(0, inv?.unsold_count ?? 0);
      const lines = sold + unsold;
      const sellRateDecimal = avoidStockSellRateDecimal(unsold, sold);
      return {
        id: cat.id,
        name: cat.name,
        totalSales,
        sold,
        unsold,
        lines,
        sellRateDecimal,
        sellRateLabel: formatAvoidStockSellRateLabel(unsold, sold),
      };
    });
  }, [menswearListViewCategoryUnion, menswearCategorySalesRows, menswearCategoryInventoryRows]);

  const menswearOverviewBestRows = useMemo(() => {
    return [...menswearBucketOverviewRows]
      .filter((r) => r.totalSales > 0)
      .sort(
        (a, b) =>
          b.totalSales - a.totalSales ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      )
      .slice(0, 5);
  }, [menswearBucketOverviewRows]);

  const menswearOverviewWorstRows = useMemo(() => {
    return [...menswearBucketOverviewRows]
      .filter((r) => r.lines >= 1)
      .sort((a, b) => {
        if (a.sellRateDecimal !== b.sellRateDecimal) return a.sellRateDecimal - b.sellRateDecimal;
        if (b.unsold !== a.unsold) return b.unsold - a.unsold;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      })
      .slice(0, 5);
  }, [menswearBucketOverviewRows]);

  /** List view: strain (unsold × share unsold) and sell-through per category; buy/avoid strip matches clothing-types rules (unsold & ≥2 listed). */
  const menswearCategoryStrainModel = useMemo(() => {
    const minTotalListed = 2;
    const salesById = new Map<number, MenswearCategorySalesRow>();
    for (const r of menswearCategorySalesRows) {
      salesById.set(r.category_id, r);
    }
    const invById = new Map<number, MenswearCategoryInventoryRow>();
    for (const r of menswearCategoryInventoryRows) {
      invById.set(r.category_id, r);
    }
    const baseRows = menswearListViewCategoryUnion.map((cat) => {
      const s = salesById.get(cat.id);
      const inv = invById.get(cat.id);
      const sold = Math.max(0, Math.floor(Number(s?.sold_count) || 0));
      const unsold = Math.max(0, inv?.unsold_count ?? 0);
      const total = sold + unsold;
      const ratio = total > 0 ? unsold / total : 0;
      const strain = unsold * ratio;
      const sellThroughPct = total > 0 ? (sold / total) * 100 : null;
      return {
        id: cat.id,
        name: cat.name,
        sold,
        unsold,
        total,
        strain,
        sellThroughPct,
      };
    });

    const stripPool = baseRows
      .filter((r) => r.unsold > 0 && r.total >= minTotalListed)
      .sort(
        (a, b) =>
          (a.sellThroughPct ?? 0) - (b.sellThroughPct ?? 0) ||
          b.unsold - a.unsold ||
          b.strain - a.strain ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
    const buySorted = [...stripPool].sort(
      (a, b) =>
        (b.sellThroughPct ?? 0) - (a.sellThroughPct ?? 0) ||
        b.sold - a.sold ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    const tableRows = [...baseRows].sort((a, b) => {
      if (a.total === 0 && b.total === 0) {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
      if (a.total === 0) return 1;
      if (b.total === 0) return -1;
      return (
        (a.sellThroughPct ?? 0) - (b.sellThroughPct ?? 0) ||
        b.unsold - a.unsold ||
        b.strain - a.strain ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
    });

    return {
      tableRows,
      buyTop5: buySorted.slice(0, 5),
      avoidTop5: stripPool.slice(0, 5),
    };
  }, [menswearListViewCategoryUnion, menswearCategorySalesRows, menswearCategoryInventoryRows]);

  const toggleMenswearStrainTableSort = useCallback(
    (key: 'category' | 'listed' | 'sold' | 'unsold' | 'sellThrough' | 'strain') => {
      setMenswearStrainTableSort((prev) => {
        if (prev?.key === key) {
          return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
        }
        return { key, dir: 'asc' };
      });
    },
    []
  );

  const menswearStrainTableSortedRows = useMemo(() => {
    const rows = [...menswearCategoryStrainModel.tableRows];
    const sort = menswearStrainTableSort;
    if (!sort) return rows;

    const tieName = (a: (typeof rows)[0], b: (typeof rows)[0]) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

    rows.sort((a, b) => {
      const d = sort.dir === 'asc' ? 1 : -1;
      let cmp = 0;
      switch (sort.key) {
        case 'category':
          cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
          return d * cmp;
        case 'listed':
          cmp = a.total - b.total;
          break;
        case 'sold':
          cmp = a.sold - b.sold;
          break;
        case 'unsold':
          cmp = a.unsold - b.unsold;
          break;
        case 'sellThrough': {
          const an = a.sellThroughPct;
          const bn = b.sellThroughPct;
          if (an == null && bn == null) cmp = 0;
          else if (an == null) return 1;
          else if (bn == null) return -1;
          else cmp = an - bn;
          break;
        }
        case 'strain':
          cmp = a.strain - b.strain;
          break;
        default:
          return 0;
      }
      if (cmp !== 0) return d * cmp;
      return tieName(a, b);
    });
    return rows;
  }, [menswearCategoryStrainModel.tableRows, menswearStrainTableSort]);

  const menswearOverviewPeriodLabel =
    menswearSalesPeriod === 'last_12_months'
      ? 'last 12 months'
      : menswearSalesPeriod === '2026'
        ? '2026'
        : '2025';

  const renderMenswearPeriodFilter = (extraClassName?: string) => (
    <div
      className={['menswear-categories-sales-pie-filter', extraClassName].filter(Boolean).join(' ')}
      role="group"
      aria-label="Sales period filter"
    >
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
  );

  const renderMenswearSalesPie = () => (
    <section
      className="menswear-categories-sales-pie"
      aria-label={
        menswearCategoryIdFromUrl == null
          ? 'Menswear Categories sales pie chart'
          : 'Menswear Categories brand sales pie chart'
      }
    >
      <div className="menswear-categories-sales-pie-header">
        <h3 className="menswear-categories-sales-pie-title">
          {menswearCategoryIdFromUrl == null ? 'Sales by Category' : 'Sales by Brand'}
        </h3>
        {renderMenswearPeriodFilter()}
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
              ? 'No sold revenue for research categories in this period.'
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
          {menswearUnsoldByBrandError ? (
            <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
              {menswearUnsoldByBrandError}
            </div>
          ) : null}
          {menswearUnsoldByBrandLoading && !menswearUnsoldByBrandError ? (
            <div className="menswear-categories-muted menswear-categories-inventory-loading">
              Loading brand inventory…
            </div>
          ) : null}
          {!menswearUnsoldByBrandLoading &&
            !menswearUnsoldByBrandError &&
            (menswearUnsoldByBrandRows.length === 0 ? (
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
                No items sold in research categories in this period.
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
              <div className="menswear-categories-muted">
                No research categories match the current view yet — add them under Config if needed.
              </div>
            ) : menswearInventoryPieModel.data ? (
              <div className="menswear-categories-inventory-chart-wrap">
                <Pie data={menswearInventoryPieModel.data} options={menswearInventoryPieChartOptions} />
              </div>
            ) : (
              <div className="menswear-categories-muted">
                No unsold items in research categories for this view.
              </div>
            ))}
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
          Menswear Categories
        </button>
        <button
          type="button"
          role="tab"
          id="research-tab-clothing-types"
          aria-selected={researchTab === 'clothing-types'}
          aria-controls="research-panel-clothing-types"
          className={`research-tab${researchTab === 'clothing-types' ? ' active' : ''}`}
          onClick={goToClothingTypesTab}
        >
          Sales by category
        </button>
        <button
          type="button"
          role="tab"
          id="research-tab-seasonal"
          aria-selected={researchTab === 'seasonal'}
          aria-controls="research-panel-seasonal"
          className={`research-tab${researchTab === 'seasonal' ? ' active' : ''}`}
          onClick={() => setResearchTab('seasonal')}
        >
          Sales by season
        </button>
        <button
          type="button"
          role="tab"
          id="research-tab-sourced"
          aria-selected={researchTab === 'sourced'}
          aria-controls="research-panel-sourced"
          className={`research-tab${researchTab === 'sourced' ? ' active' : ''}`}
          onClick={() => setResearchTab('sourced')}
        >
          Sourced
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
      {(researchTab === 'clothing-types' ||
        researchTab === 'seasonal' ||
        researchTab === 'brand') &&
        researchDepartmentsError && (
        <div className="research-menswear-departments-error" role="alert">
          {researchDepartmentsError}
        </div>
      )}
      {(researchTab === 'clothing-types' ||
        researchTab === 'seasonal' ||
        researchTab === 'brand') &&
        researchDepartmentsLoading && (
        <div
          className={
            'research-menswear-departments research-menswear-departments--loading' +
            (researchTab === 'seasonal' ||
            researchTab === 'clothing-types' ||
            researchTab === 'brand'
              ? ' research-menswear-departments--centered'
              : '')
          }
        >
          Loading departments…
        </div>
      )}
      {(researchTab === 'clothing-types' ||
        researchTab === 'seasonal' ||
        researchTab === 'brand') &&
        !researchDepartmentsLoading &&
        !researchDepartmentsError &&
        researchDepartments.length > 0 && (
          <nav
            className={
              'research-menswear-departments' +
              (researchTab === 'seasonal' ||
              researchTab === 'clothing-types' ||
              researchTab === 'brand'
                ? ' research-menswear-departments--centered'
                : '')
            }
            role="navigation"
            aria-label={
              researchTab === 'brand'
                ? 'Filter brands by department'
                : 'Filter research by business department'
            }
          >
            <ul className="research-menswear-departments-list">
              {researchTab === 'seasonal' ? (
                <li key="seasonal-department-all" className="research-menswear-departments-item">
                  <button
                    type="button"
                    className={
                      'research-menswear-department-box' +
                      (researchScopedDepartmentIdFromUrl == null
                        ? ' research-menswear-department-box--active'
                        : '')
                    }
                    aria-pressed={researchScopedDepartmentIdFromUrl == null}
                    onClick={() => {
                      setSearchParams((prev) => {
                        const next = new URLSearchParams(prev);
                        next.set('tab', 'seasonal');
                        next.delete('departmentId');
                        return next;
                      }, { replace: true });
                    }}
                  >
                    <span className="research-menswear-department-box-name">All</span>
                  </button>
                </li>
              ) : null}
              {researchTab === 'brand' ? (
                <li key="brand-department-all" className="research-menswear-departments-item">
                  <button
                    type="button"
                    className={
                      'research-menswear-department-box' +
                      (brandResearchDepartmentFilterSelection === 'all'
                        ? ' research-menswear-department-box--active'
                        : '')
                    }
                    aria-pressed={brandResearchDepartmentFilterSelection === 'all'}
                    onClick={() => setBrandResearchDepartmentFilterSelection('all')}
                  >
                    <span className="research-menswear-department-box-name">All</span>
                  </button>
                </li>
              ) : null}
              {researchDepartments.map((d) => {
                const activeDeptId =
                  researchTab === 'clothing-types'
                    ? clothingTypesListDepartmentIdForApi
                    : researchTab === 'seasonal'
                      ? seasonalDepartmentIdForApi
                      : null;
                const active =
                  researchTab === 'brand'
                    ? brandResearchDepartmentFilterSelection === 'all'
                      ? false
                      : typeof brandResearchDepartmentFilterSelection === 'number'
                        ? brandResearchDepartmentFilterSelection === d.id
                        : brandResearchDepartmentFilterEffective === d.id
                    : activeDeptId === d.id;
                return (
                  <li key={d.id} className="research-menswear-departments-item">
                    <button
                      type="button"
                      className={
                        'research-menswear-department-box' +
                        (active ? ' research-menswear-department-box--active' : '')
                      }
                      aria-pressed={active}
                      onClick={() => {
                        if (researchTab === 'brand') {
                          setBrandResearchDepartmentFilterSelection(d.id);
                          return;
                        }
                        setSearchParams((prev) => {
                          const next = new URLSearchParams(prev);
                          next.set('tab', researchTab);
                          next.set('departmentId', String(d.id));
                          if (researchTab === 'clothing-types') {
                            next.delete('clothingTypeId');
                            next.delete('clothingTypeBrandId');
                          }
                          return next;
                        }, { replace: true });
                      }}
                    >
                      <span className="research-menswear-department-box-name">{d.department_name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
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
                      disabled={!brandsLoaded || researchDepartmentsLoading}
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
                        ) : brandsForBrandResearchTypeahead.length === 0 ? (
                          <li className="brand-research-typeahead-empty" role="presentation">
                            No brands in this department
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
                      className="brand-research-new-brand-icon-btn"
                      aria-label="Add new tag image"
                      title="Add tag image"
                      aria-expanded={brandTagAddPanelOpen && brandTagAddSubMode === 'image'}
                      aria-controls="brand-tag-add-panel"
                      onClick={handleToggleBrandTagImagePanel}
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
                          d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="brand-research-new-brand-icon-btn"
                      aria-label="Edit brand description"
                      title="Edit description"
                      aria-expanded={brandTagAddPanelOpen && brandTagAddSubMode === 'info'}
                      aria-controls="brand-tag-edit-description-panel"
                      onClick={handleToggleEditBrandDescriptionPanel}
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
                          d="M4 7h8M4 11h7M4 15h6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
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
            {brandTagBrandId !== '' && (() => {
              const selBrand = brandsWithWebsites.find((x) => x.id === brandTagBrandId);
              if (!selBrand) return null;
              const title = (selBrand.brand_name ?? '').trim() || 'Brand';
              return (
                <div className="brand-research-selected-brand-heading-row">
                  {brandLogoRow?.public_url ? (
                    <img
                      src={brandLogoRow.public_url}
                      alt=""
                      className="brand-research-selected-brand-logo-thumb"
                    />
                  ) : null}
                  <h1 className="brand-research-selected-brand-title">{title}</h1>
                </div>
              );
            })()}
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
                const brandDescriptionSaved = br.description?.trim() ?? '';
                const clothingCatId = br.menswear_category_id;
                const hasSavedBrandSummary =
                  !!(rawSite || buy || avoid || clothingCatId != null || brandDescriptionSaved);
                const showDescriptionEditor =
                  brandTagAddPanelOpen && brandTagAddSubMode === 'info';
                if (!hasSavedBrandSummary && !showDescriptionEditor) return null;
                const savedBrandLabel = (br.brand_name ?? '').trim();
                const savedVisitWebsiteLabel = savedBrandLabel
                  ? `Visit ${savedBrandLabel} Website`
                  : 'Visit Website';
                const clothingCategoryStockTo = (() => {
                  if (clothingCatId == null) return '';
                  const q = new URLSearchParams();
                  q.set('tab', 'menswear-categories');
                  q.set('menswearCategoryId', String(clothingCatId));
                  q.set('menswearBrandId', String(br.id));
                  return `/research?${q.toString()}`;
                })();
                const currentBrandInStockLabel = savedBrandLabel
                  ? `Current ${savedBrandLabel} in stock`
                  : 'Current brand in stock';
                const resetInfoDraftsFromBrand = () => {
                  setBrandWebsiteUrlDraft(br.brand_website?.trim() ?? '');
                  setBrandBuyingNotesBuyDraft(br.things_to_buy?.trim() ?? '');
                  setBrandBuyingNotesAvoidDraft(br.things_to_avoid?.trim() ?? '');
                  setBrandDescriptionDraft(br.description?.trim() ?? '');
                };

                return (
                  <div className="brand-tag-examples-saved-brand-info">
                    <div className="brand-tag-examples-brand-links-edit-stack">
                    {rawSite && fullUrlBrowse && clothingCatId != null ? (
                      <div className="brand-tag-examples-website-category-split">
                        <div className="brand-tag-examples-website-category-split-col brand-tag-examples-website-category-split-col--website">
                          <div className="brand-visit-website-framed brand-visit-website-framed--compact-half">
                            <hr className="brand-visit-website-rule" aria-hidden="true" />
                            <a
                              href={fullUrlBrowse}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="brand-website-link brand-tag-examples-website-browse-link brand-tag-examples-website-browse-link--compact-half"
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
                        <div className="brand-tag-examples-website-category-split-col brand-tag-examples-website-category-split-col--category">
                          <div className="brand-visit-website-framed brand-visit-website-framed--compact-half">
                            <hr className="brand-visit-website-rule" aria-hidden="true" />
                            <Link
                              to={clothingCategoryStockTo}
                              className="brand-website-link brand-tag-examples-website-browse-link brand-tag-examples-website-browse-link--compact-half"
                              aria-label={`${currentBrandInStockLabel} — open Menswear category stock list`}
                            >
                              {currentBrandInStockLabel}
                            </Link>
                            <hr className="brand-visit-website-rule" aria-hidden="true" />
                          </div>
                        </div>
                      </div>
                    ) : rawSite && fullUrlBrowse ? (
                      <div className="brand-tag-examples-website-category-split">
                        <div className="brand-tag-examples-website-category-split-col brand-tag-examples-website-category-split-col--website">
                          <div className="brand-visit-website-framed brand-visit-website-framed--compact-half">
                            <hr className="brand-visit-website-rule" aria-hidden="true" />
                            <a
                              href={fullUrlBrowse}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="brand-website-link brand-tag-examples-website-browse-link brand-tag-examples-website-browse-link--compact-half"
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
                        <div
                          className="brand-tag-examples-website-category-split-col brand-tag-examples-website-category-split-col--category"
                          aria-hidden="true"
                        />
                      </div>
                    ) : clothingCatId != null ? (
                      <div className="brand-tag-examples-website-category-split">
                        <div
                          className="brand-tag-examples-website-category-split-col brand-tag-examples-website-category-split-col--website"
                          aria-hidden="true"
                        />
                        <div className="brand-tag-examples-website-category-split-col brand-tag-examples-website-category-split-col--category">
                          <div className="brand-visit-website-framed brand-visit-website-framed--compact-half">
                            <hr className="brand-visit-website-rule" aria-hidden="true" />
                            <Link
                              to={clothingCategoryStockTo}
                              className="brand-website-link brand-tag-examples-website-browse-link brand-tag-examples-website-browse-link--compact-half"
                              aria-label={`${currentBrandInStockLabel} — open Menswear category stock list`}
                            >
                              {currentBrandInStockLabel}
                            </Link>
                            <hr className="brand-visit-website-rule" aria-hidden="true" />
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {!showDescriptionEditor && brandDescriptionSaved ? (
                      <div
                        className="brand-tag-examples-brand-summary-description"
                        role="region"
                        aria-label="Brand description"
                      >
                        <p className="brand-tag-examples-brand-summary-description-text">
                          {brandDescriptionSaved}
                        </p>
                      </div>
                    ) : null}
                    {showDescriptionEditor && (
                      <div
                        className="brand-tag-examples-brand-website-below brand-tag-examples-saved-brand-info-edit-panel"
                        id="brand-tag-edit-description-panel"
                        role="region"
                        aria-label="Edit brand description"
                      >
                        <div className="brand-tag-examples-add-panel brand-tag-examples-add-panel--nested brand-tag-examples-add-panel--info">
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
                          <label className="brand-tag-examples-label" htmlFor="brand-research-brand-logo-file">
                            Brand logo
                          </label>
                          {brandLogoRow?.public_url ? (
                            <div className="brand-tag-examples-brand-logo-preview-row">
                              <img
                                src={brandLogoRow.public_url}
                                alt=""
                                className="brand-tag-examples-brand-logo-preview-img"
                              />
                              <button
                                type="button"
                                className="brand-tag-examples-cancel"
                                onClick={() =>
                                  void handleDeleteBrandTagImage(
                                    brandLogoRow.id,
                                    'Remove the brand logo?'
                                  )
                                }
                                disabled={brandLogoUploading || brandBrandInfoSaving}
                              >
                                Remove logo
                              </button>
                            </div>
                          ) : null}
                          <div className="brand-tag-examples-upload-row">
                            <label
                              htmlFor="brand-research-brand-logo-file"
                              className="brand-tag-examples-upload-button"
                            >
                              {brandLogoUploading ? 'Uploading…' : 'Upload logo'}
                            </label>
                            <input
                              id="brand-research-brand-logo-file"
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/gif"
                              className="brand-tag-examples-file-input"
                              disabled={brandLogoUploading || brandBrandInfoSaving}
                              onChange={handleBrandLogoFileChange}
                            />
                          </div>
                          <label className="brand-tag-examples-label" htmlFor="brand-research-brand-description">
                            Description
                          </label>
                          <textarea
                            id="brand-research-brand-description"
                            className="brand-tag-examples-edit-textarea"
                            value={brandDescriptionDraft}
                            onChange={(e) => setBrandDescriptionDraft(e.target.value)}
                            placeholder="Notes about this brand…"
                            maxLength={8000}
                            rows={4}
                            disabled={brandBrandInfoSaving}
                          />
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
                                setBrandTagCaption('');
                                setBrandTagNewImageKind('tag');
                                setBrandTagAddPanelOpen(false);
                              }}
                              disabled={brandBrandInfoSaving}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    </div>
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
              brandTagAddSubMode === 'image' &&
              (() => {
                const b = brandsWithWebsites.find((x) => x.id === brandTagBrandId);
                if (!b) return null;
                return (
                  <div
                    className="brand-tag-examples-brand-website-below"
                    id="brand-tag-add-panel"
                    role="region"
                    aria-label="Add brand tag image"
                  >
                    <div className="brand-tag-examples-add-panel brand-tag-examples-add-panel--nested">
                      <button
                        type="button"
                        className="brand-tag-examples-add-panel-close-btn"
                        onClick={closeBrandTagAddPanel}
                        disabled={brandTagUploading}
                        aria-label="Close"
                        title="Close"
                      >
                        <svg
                          className="brand-tag-examples-add-panel-close-icon"
                          xmlns="http://www.w3.org/2000/svg"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                      <div className="brand-tag-examples-add-image-kind-row">
                        <select
                          id="brand-tag-new-kind"
                          className="brand-tag-examples-select brand-tag-examples-kind-select brand-tag-examples-add-image-kind-select"
                          aria-label="Image type"
                          value={brandTagNewImageKind}
                          onChange={(e) => setBrandTagNewImageKind(e.target.value as BrandTagImageKind)}
                          disabled={brandTagUploading}
                        >
                          <option value="tag">Tag</option>
                          <option value="fake_check">Fake Check</option>
                        </select>
                      </div>
                      <textarea
                        id="brand-tag-caption"
                        className="brand-tag-examples-edit-textarea"
                        aria-label="Caption (optional)"
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
              const tagRows = sortedBrandTagImages.filter(
                (i) => i.image_kind !== 'fake_check' && i.image_kind !== 'logo'
              );
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
                {brandStockItemsToBuyTags.length > 0 ? (
                  <div className="brand-research-sales-table-block brand-research-sales-table-block--to-buy">
                    <h4 className="brand-research-sales-subheading" id="brand-research-items-to-buy">
                      Items to buy
                    </h4>
                    <ul
                      className="brand-research-items-to-buy-tags"
                      aria-labelledby="brand-research-items-to-buy"
                    >
                      {brandStockItemsToBuyTags.map((row, idx) => (
                        <li
                          key={
                            row.categoryId > 0
                              ? `buy-cat-${row.categoryId}`
                              : `buy-cat-${idx}-${row.categoryName}`
                          }
                          className="brand-research-items-to-buy-tag"
                        >
                          {row.categoryName}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {brandStockSummary.heavyUnsoldByCategory.length > 0 ? (
                  <div className="brand-research-sales-table-block brand-research-sales-table-block--unsold">
                    <h4 className="brand-research-sales-subheading" id="brand-research-items-to-avoid-buying">
                      Items To Avoid Buying
                    </h4>
                    <ul
                      className="brand-research-avoid-buying-tags"
                      aria-labelledby="brand-research-items-to-avoid-buying"
                    >
                      {brandStockSummary.heavyUnsoldByCategory.map((row, idx) => (
                        <li
                          key={
                            row.categoryId > 0
                              ? `avoid-buy-cat-${row.categoryId}`
                              : `avoid-buy-cat-${idx}-${row.categoryName}`
                          }
                          className="brand-research-avoid-buying-tag"
                        >
                          {row.categoryName}
                        </li>
                      ))}
                    </ul>
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
              <>
                <nav
                  className="clothing-types-browse menswear-categories-browse-top"
                  aria-label="Menswear categories — open category details"
                >
                  <ul className="clothing-types-browse-list">
                    {menswearCategories.length === 0 ? (
                      <li className="menswear-categories-empty">No categories found.</li>
                    ) : (
                      menswearCategories.map((cat) => (
                        <li key={cat.id} className="clothing-types-browse-item">
                          <a
                            className="clothing-types-browse-link"
                            href={menswearCategoryHref(cat.id)}
                            title={cat.description?.trim() ? cat.description.trim() : undefined}
                          >
                            {cat.name}
                          </a>
                        </li>
                      ))
                    )}
                  </ul>
                </nav>
                <div className="clothing-types-charts-below menswear-categories-list-charts-wrap">
                  {renderMenswearPeriodFilter('clothing-types-charts-period-bar')}
                  <div className="clothing-types-three-pies-row">
                    <section
                      className="menswear-categories-sales-pie clothing-types-pie-column"
                      aria-label="Menswear Categories sales by revenue"
                    >
                      <div className="menswear-categories-sales-pie-header clothing-types-pie-column-header">
                        <h3 className="menswear-categories-sales-pie-title">Sales by Category (£)</h3>
                      </div>
                      {menswearCategorySalesError && (
                        <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                          {menswearCategorySalesError}
                        </div>
                      )}
                      {menswearCategorySalesLoading && !menswearCategorySalesError && (
                        <div className="menswear-categories-muted">Loading category sales…</div>
                      )}
                      {!menswearCategorySalesLoading &&
                        !menswearCategorySalesError &&
                        (menswearSalesPieModel.data ? (
                          <div className="menswear-categories-sales-pie-chart-wrap">
                            <Pie data={menswearSalesPieModel.data} options={menswearSalesPieChartOptions} />
                          </div>
                        ) : (
                          <div className="menswear-categories-muted">
                            No sold revenue for research categories in this period.
                          </div>
                        ))}
                    </section>
                    <div
                      className="menswear-categories-inventory-block menswear-categories-category-items-sold-block clothing-types-pie-column"
                      role="region"
                      aria-label="Items sold by category"
                    >
                      <h4 className="menswear-categories-inventory-title clothing-types-pie-column-header">
                        Items sold by category
                      </h4>
                      {menswearCategorySalesError ? (
                        <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                          {menswearCategorySalesError}
                        </div>
                      ) : null}
                      {menswearCategorySalesLoading && !menswearCategorySalesError ? (
                        <div className="menswear-categories-muted menswear-categories-inventory-loading">
                          Loading…
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
                            No items sold in research categories in this period.
                          </div>
                        ))}
                    </div>
                    <div
                      className="menswear-categories-inventory-block clothing-types-pie-column"
                      role="region"
                      aria-label="Unsold inventory by category"
                    >
                      <h4 className="menswear-categories-inventory-title clothing-types-pie-column-header">
                        Unsold inventory by category
                      </h4>
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
                          <div className="menswear-categories-muted">
                            No research categories match the current view yet — add them under Config if
                            needed.
                          </div>
                        ) : menswearInventoryPieModel.data ? (
                          <div className="menswear-categories-inventory-chart-wrap">
                            <Pie data={menswearInventoryPieModel.data} options={menswearInventoryPieChartOptions} />
                          </div>
                        ) : (
                          <div className="menswear-categories-muted">
                            No unsold items in research categories for this view.
                          </div>
                        ))}
                    </div>
                  </div>
                  {menswearCategories.length > 0 &&
                  !menswearCategorySalesLoading &&
                  !menswearCategoryInventoryLoading &&
                  !menswearCategorySalesError &&
                  !menswearCategoryInventoryError ? (
                    <div
                      className="clothing-types-buy-avoid-strip menswear-categories-list-buy-avoid menswear-categories-list-buy-avoid--under-charts"
                      role="region"
                      aria-label="Top Menswear categories to buy vs avoid, from sell-through among categories with unsold stock"
                    >
                      <div className="clothing-types-buy-avoid-col clothing-types-buy-avoid-col--buy">
                        <span className="clothing-types-buy-avoid-label">Top 5 to buy</span>
                        <div className="clothing-types-buy-avoid-names-block">
                          <span
                            className="clothing-types-buy-avoid-names"
                            title={
                              menswearCategoryStrainModel.buyTop5.length > 0
                                ? menswearCategoryStrainModel.buyTop5.map((x) => x.name).join(' · ')
                                : undefined
                            }
                          >
                            {menswearCategoryStrainModel.buyTop5.length > 0
                              ? menswearCategoryStrainModel.buyTop5.map((x) => x.name).join(' · ')
                              : '—'}
                          </span>
                        </div>
                      </div>
                      <div className="clothing-types-buy-avoid-col clothing-types-buy-avoid-col--avoid">
                        <span className="clothing-types-buy-avoid-label">Avoid buying</span>
                        <div className="clothing-types-buy-avoid-names-block">
                          <span
                            className="clothing-types-buy-avoid-names"
                            title={
                              menswearCategoryStrainModel.avoidTop5.length > 0
                                ? menswearCategoryStrainModel.avoidTop5.map((x) => x.name).join(' · ')
                                : undefined
                            }
                          >
                            {menswearCategoryStrainModel.avoidTop5.length > 0
                              ? menswearCategoryStrainModel.avoidTop5.map((x) => x.name).join(' · ')
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="menswear-categories-overview-below menswear-categories-overview-wrap">
                    {menswearCategorySalesLoading || menswearCategoryInventoryLoading ? (
                      <p className="menswear-categories-muted">Loading overview…</p>
                    ) : menswearCategorySalesError || menswearCategoryInventoryError ? (
                      <p className="menswear-categories-error" role="alert">
                        {menswearCategorySalesError ?? menswearCategoryInventoryError}
                      </p>
                    ) : (
                      <>
                        <div className="menswear-categories-overview-block">
                          <h4 className="menswear-categories-overview-heading">
                            Best Menswear categories (sold revenue)
                          </h4>
                          {menswearOverviewBestRows.length === 0 ? (
                            <p className="menswear-categories-muted">
                              No sold revenue in this period for research categories.
                            </p>
                          ) : (
                            <div className="menswear-categories-overview-table-wrap">
                              <table className="menswear-categories-overview-table menswear-categories-overview-table--list-pair">
                                <thead>
                                  <tr>
                                    <th scope="col" className="menswear-categories-overview-category-col">
                                      Category
                                    </th>
                                    <th
                                      scope="col"
                                      className="menswear-categories-overview-num menswear-categories-overview-sold-revenue"
                                    >
                                      Sold revenue
                                    </th>
                                    <th scope="col" className="menswear-categories-overview-metric">
                                      Number of Sold Items
                                    </th>
                                    <th scope="col" className="menswear-categories-overview-metric">
                                      No. in stock
                                    </th>
                                    <th scope="col" className="menswear-categories-overview-metric">
                                      Sell rate
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {menswearOverviewBestRows.map((row) => {
                                    const navigable = row.id >= 1;
                                    return (
                                    <tr
                                      key={`best-${row.id}`}
                                      className={
                                        navigable ? 'menswear-categories-buy-more-stock-row-link' : undefined
                                      }
                                      role={navigable ? 'button' : undefined}
                                      tabIndex={navigable ? 0 : undefined}
                                      onClick={
                                        navigable ? () => openMenswearCategoryInUrl(row.id) : undefined
                                      }
                                      onKeyDown={(e) => {
                                        if (!navigable) return;
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          openMenswearCategoryInUrl(row.id);
                                        }
                                      }}
                                      aria-label={
                                        navigable
                                          ? `Open Menswear category ${row.name}`
                                          : undefined
                                      }
                                    >
                                      <td className="menswear-categories-overview-category-col">{row.name}</td>
                                      <td className="menswear-categories-overview-num menswear-categories-overview-sold-revenue">
                                        {formatResearchCurrency(row.totalSales)}
                                      </td>
                                      <td className="menswear-categories-overview-metric">{row.sold}</td>
                                      <td className="menswear-categories-overview-metric">{row.unsold}</td>
                                      <td className="menswear-categories-overview-metric">
                                        {row.sellRateLabel}
                                      </td>
                                    </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                        <div className="menswear-categories-overview-block">
                          <h4 className="menswear-categories-overview-heading">
                            Weakest sell-through (buy carefully)
                          </h4>
                          {menswearOverviewWorstRows.length === 0 ? (
                            <p className="menswear-categories-muted">No stock lines to rank yet.</p>
                          ) : (
                            <div className="menswear-categories-overview-table-wrap">
                              <table className="menswear-categories-overview-table menswear-categories-overview-table--list-pair">
                                <thead>
                                  <tr>
                                    <th scope="col" className="menswear-categories-overview-category-col">
                                      Category
                                    </th>
                                    <th
                                      scope="col"
                                      className="menswear-categories-overview-num menswear-categories-overview-sold-revenue"
                                    >
                                      Sold revenue
                                    </th>
                                    <th scope="col" className="menswear-categories-overview-metric">
                                      Number of Sold Items
                                    </th>
                                    <th scope="col" className="menswear-categories-overview-metric">
                                      No. in stock
                                    </th>
                                    <th scope="col" className="menswear-categories-overview-metric">
                                      Sell rate
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {menswearOverviewWorstRows.map((row) => {
                                    const navigable = row.id >= 1;
                                    return (
                                    <tr
                                      key={`worst-${row.id}`}
                                      className={
                                        navigable ? 'menswear-categories-buy-more-stock-row-link' : undefined
                                      }
                                      role={navigable ? 'button' : undefined}
                                      tabIndex={navigable ? 0 : undefined}
                                      onClick={
                                        navigable ? () => openMenswearCategoryInUrl(row.id) : undefined
                                      }
                                      onKeyDown={(e) => {
                                        if (!navigable) return;
                                        if (e.key === 'Enter' || e.key === ' ') {
                                          e.preventDefault();
                                          openMenswearCategoryInUrl(row.id);
                                        }
                                      }}
                                      aria-label={
                                        navigable
                                          ? `Open Menswear category ${row.name}`
                                          : undefined
                                      }
                                    >
                                      <td className="menswear-categories-overview-category-col">{row.name}</td>
                                      <td className="menswear-categories-overview-num menswear-categories-overview-sold-revenue">
                                        {row.totalSales > 0 ? formatResearchCurrency(row.totalSales) : '—'}
                                      </td>
                                      <td className="menswear-categories-overview-metric">{row.sold}</td>
                                      <td className="menswear-categories-overview-metric">{row.unsold}</td>
                                      <td className="menswear-categories-overview-metric">
                                        {row.sellRateLabel}
                                      </td>
                                    </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {menswearCategories.length > 0 ? (
                  menswearCategorySalesLoading || menswearCategoryInventoryLoading ? (
                    <p className="menswear-categories-muted menswear-categories-list-strain-loading">
                      Loading strain and sell-through…
                    </p>
                  ) : menswearCategorySalesError || menswearCategoryInventoryError ? null : (
                    <>
                      <section
                        className="menswear-categories-list-strain-section"
                        aria-label="Sell-through and inventory strain by Menswear category"
                      >
                        <div className="menswear-categories-list-strain-heading-row">
                          <h3 className="clothing-types-invest-risk-title menswear-categories-list-strain-heading">
                            Strain and sell-through by category
                          </h3>
                          <span className="menswear-strain-info-wrap">
                            <button
                              type="button"
                              className="menswear-strain-info-btn"
                              aria-label="What is strain?"
                              aria-describedby="menswear-strain-info-tooltip"
                            >
                              <svg
                                className="menswear-strain-info-icon"
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden={true}
                              >
                                <circle cx="12" cy="12" r="10" />
                                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                              </svg>
                            </button>
                            <span
                              id="menswear-strain-info-tooltip"
                              className="menswear-strain-info-tooltip"
                              role="tooltip"
                            >
                              <strong>Strain</strong> is{' '}
                              <strong>unsold lines × (unsold ÷ listed)</strong>. It goes up when you hold more
                              unsold stock and unsold pieces are a large share of that category’s listings—so it
                              highlights tied-up inventory more than a single unsold item would. Sell-through is{' '}
                              <strong>sold ÷ listed</strong> as a percentage.
                            </span>
                          </span>
                        </div>
                        <div className="menswear-categories-list-strain-table-wrap">
                          <table className="menswear-categories-overview-table menswear-categories-list-strain-table">
                            <thead>
                              <tr>
                                <th
                                  scope="col"
                                  aria-sort={
                                    menswearStrainTableSort?.key === 'category'
                                      ? menswearStrainTableSort.dir === 'asc'
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className={`menswear-strain-th-sort${menswearStrainTableSort?.key === 'category' ? ' menswear-strain-th-sort--active' : ''}`}
                                    onClick={() => toggleMenswearStrainTableSort('category')}
                                  >
                                    <span>Category</span>
                                    <span className="menswear-strain-th-sort-icon" aria-hidden>
                                      {menswearStrainTableSort?.key === 'category'
                                        ? menswearStrainTableSort.dir === 'asc'
                                          ? '▲'
                                          : '▼'
                                        : ''}
                                    </span>
                                  </button>
                                </th>
                                <th
                                  scope="col"
                                  className="menswear-categories-overview-num"
                                  aria-sort={
                                    menswearStrainTableSort?.key === 'listed'
                                      ? menswearStrainTableSort.dir === 'asc'
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className={`menswear-strain-th-sort menswear-strain-th-sort--num${menswearStrainTableSort?.key === 'listed' ? ' menswear-strain-th-sort--active' : ''}`}
                                    onClick={() => toggleMenswearStrainTableSort('listed')}
                                  >
                                    <span>Listed</span>
                                    <span className="menswear-strain-th-sort-icon" aria-hidden>
                                      {menswearStrainTableSort?.key === 'listed'
                                        ? menswearStrainTableSort.dir === 'asc'
                                          ? '▲'
                                          : '▼'
                                        : ''}
                                    </span>
                                  </button>
                                </th>
                                <th
                                  scope="col"
                                  className="menswear-categories-overview-num"
                                  aria-sort={
                                    menswearStrainTableSort?.key === 'sold'
                                      ? menswearStrainTableSort.dir === 'asc'
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className={`menswear-strain-th-sort menswear-strain-th-sort--num${menswearStrainTableSort?.key === 'sold' ? ' menswear-strain-th-sort--active' : ''}`}
                                    onClick={() => toggleMenswearStrainTableSort('sold')}
                                  >
                                    <span>Sold</span>
                                    <span className="menswear-strain-th-sort-icon" aria-hidden>
                                      {menswearStrainTableSort?.key === 'sold'
                                        ? menswearStrainTableSort.dir === 'asc'
                                          ? '▲'
                                          : '▼'
                                        : ''}
                                    </span>
                                  </button>
                                </th>
                                <th
                                  scope="col"
                                  className="menswear-categories-overview-num"
                                  aria-sort={
                                    menswearStrainTableSort?.key === 'unsold'
                                      ? menswearStrainTableSort.dir === 'asc'
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className={`menswear-strain-th-sort menswear-strain-th-sort--num${menswearStrainTableSort?.key === 'unsold' ? ' menswear-strain-th-sort--active' : ''}`}
                                    onClick={() => toggleMenswearStrainTableSort('unsold')}
                                  >
                                    <span>Unsold</span>
                                    <span className="menswear-strain-th-sort-icon" aria-hidden>
                                      {menswearStrainTableSort?.key === 'unsold'
                                        ? menswearStrainTableSort.dir === 'asc'
                                          ? '▲'
                                          : '▼'
                                        : ''}
                                    </span>
                                  </button>
                                </th>
                                <th
                                  scope="col"
                                  className="menswear-categories-overview-num"
                                  aria-sort={
                                    menswearStrainTableSort?.key === 'sellThrough'
                                      ? menswearStrainTableSort.dir === 'asc'
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className={`menswear-strain-th-sort menswear-strain-th-sort--num${menswearStrainTableSort?.key === 'sellThrough' ? ' menswear-strain-th-sort--active' : ''}`}
                                    onClick={() => toggleMenswearStrainTableSort('sellThrough')}
                                  >
                                    <span>Sell-through</span>
                                    <span className="menswear-strain-th-sort-icon" aria-hidden>
                                      {menswearStrainTableSort?.key === 'sellThrough'
                                        ? menswearStrainTableSort.dir === 'asc'
                                          ? '▲'
                                          : '▼'
                                        : ''}
                                    </span>
                                  </button>
                                </th>
                                <th
                                  scope="col"
                                  className="menswear-categories-overview-num"
                                  title="Unsold lines × (unsold ÷ listed)"
                                  aria-sort={
                                    menswearStrainTableSort?.key === 'strain'
                                      ? menswearStrainTableSort.dir === 'asc'
                                        ? 'ascending'
                                        : 'descending'
                                      : 'none'
                                  }
                                >
                                  <button
                                    type="button"
                                    className={`menswear-strain-th-sort menswear-strain-th-sort--num${menswearStrainTableSort?.key === 'strain' ? ' menswear-strain-th-sort--active' : ''}`}
                                    onClick={() => toggleMenswearStrainTableSort('strain')}
                                  >
                                    <span>Strain</span>
                                    <span className="menswear-strain-th-sort-icon" aria-hidden>
                                      {menswearStrainTableSort?.key === 'strain'
                                        ? menswearStrainTableSort.dir === 'asc'
                                          ? '▲'
                                          : '▼'
                                        : ''}
                                    </span>
                                  </button>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {menswearStrainTableSortedRows.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="menswear-categories-muted menswear-strain-table-empty">
                                    No categories to show.
                                  </td>
                                </tr>
                              ) : (
                                menswearStrainTableSortedRows.map((r) => (
                                  <tr key={r.id}>
                                    <td>
                                      <a
                                        className="clothing-types-invest-risk-type-link"
                                        href={menswearCategoryHref(r.id)}
                                      >
                                        {r.name}
                                      </a>
                                    </td>
                                    <td className="menswear-categories-overview-num">{r.total}</td>
                                    <td className="menswear-categories-overview-num">{r.sold}</td>
                                    <td className="menswear-categories-overview-num">{r.unsold}</td>
                                    <td className="menswear-categories-overview-num">
                                      {r.sellThroughPct != null
                                        ? `${(Math.round(r.sellThroughPct * 10) / 10).toFixed(1)}%`
                                        : '—'}
                                    </td>
                                    <td className="menswear-categories-overview-num">
                                      {r.total > 0
                                        ? (Math.round(r.strain * 100) / 100).toFixed(2)
                                        : '—'}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </section>
                      <div className="menswear-categories-list-ask-all-wrap">
                        <button
                          type="button"
                          className="menswear-categories-ask-ai-btn"
                          disabled={menswearAskAiBusy}
                          onClick={() => void runMenswearAllCategoriesAskAi()}
                          aria-label="Copy Ask RI prompt to review Menswear category taxonomy"
                        >
                          Ask RI - Review This Selection
                        </button>
                      </div>
                    </>
                  )
                ) : null}
              </>
            )}

            {!menswearCategoriesLoading && menswearCategoryIdFromUrl !== null && selectedMenswearCategory && (
              <div className="menswear-categories-detail-category">
                {menswearBrandIdFromUrl == null ? (
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
                ) : null}
                {menswearBrandIdFromUrl == null ? (
                <div className="menswear-categories-detail-split">
                  <div className="menswear-categories-detail-split-brands">
                    <div className="menswear-categories-detail">
                      <div className="menswear-categories-sort-bar menswear-categories-sort-bar--icons">
                        <div className="menswear-categories-sort-icons-row">
                        <div className="menswear-categories-sort-menu-wrap" ref={menswearBrandSortMenuRef}>
                          <button
                            type="button"
                            className={`menswear-categories-icon-circle-btn menswear-categories-filter-sort-btn${menswearBrandSortMenuOpen ? ' menswear-categories-icon-circle-btn--active' : ''}`}
                            aria-expanded={menswearBrandSortMenuOpen}
                            aria-haspopup="listbox"
                            aria-label="Sort brands: by total sales or alphabetical"
                            onClick={() => setMenswearBrandSortMenuOpen((o) => !o)}
                            disabled={menswearCategoryBrandsEditMode}
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
                          disabled={menswearCategoryBrandsEditMode || menswearAddBrandSaving}
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
                        <button
                          type="button"
                          className={`menswear-categories-brands-edit-toggle${menswearCategoryBrandsEditMode ? ' menswear-categories-brands-edit-toggle--active' : ''}`}
                          onClick={() => {
                            setMenswearBrandSortMenuOpen(false);
                            setMenswearAddBrandOpen(false);
                            setMenswearAddBrandSearch('');
                            setMenswearCategoryRemoveBrandsError(null);
                            setMenswearCategoryBrandsEditMode((v) => {
                              if (v) setMenswearCategoryBrandRemovalIds(new Set());
                              return !v;
                            });
                          }}
                          aria-pressed={menswearCategoryBrandsEditMode}
                        >
                          {menswearCategoryBrandsEditMode ? 'Done' : 'Edit'}
                        </button>
                        </div>
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
                                <li
                                  key={b.id}
                                  className={`menswear-categories-brand-row${menswearCategoryBrandsEditMode ? ' menswear-categories-brand-row--edit' : ''}`}
                                >
                                  {menswearCategoryBrandsEditMode ? (
                                    <label className="menswear-categories-brand-edit-label">
                                      <input
                                        type="checkbox"
                                        className="menswear-categories-brand-edit-checkbox"
                                        checked={menswearCategoryBrandRemovalIds.has(b.id)}
                                        onChange={() => toggleMenswearCategoryBrandRemoval(b.id)}
                                        aria-label={`Select ${b.brand_name || 'brand'} to remove from this menswear category`}
                                      />
                                      <span className="menswear-categories-brand-edit-name">
                                        {b.brand_name || '—'}
                                      </span>
                                    </label>
                                  ) : (
                                    <button
                                      type="button"
                                      className={`menswear-categories-brand-link${
                                        menswearBrandIdFromUrl === b.id
                                          ? ' menswear-categories-brand-link--active'
                                          : ''
                                      }`}
                                      onClick={() => openMenswearBrandInventoryInUrl(b.id)}
                                    >
                                      {b.brand_name || '—'}
                                    </button>
                                  )}
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

                      <section
                        className="menswear-categories-avoid-stock"
                        aria-labelledby="menswear-avoid-stock-heading"
                      >
                        <h4 id="menswear-avoid-stock-heading" className="menswear-categories-avoid-stock-title">
                          Stock To Avoid Buying
                        </h4>
                        {menswearUnsoldBrandCategoryError && (
                          <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                            {menswearUnsoldBrandCategoryError}
                          </div>
                        )}
                        {menswearUnsoldBrandCategoryLoading && (
                          <div className="menswear-categories-muted">Loading unsold inventory…</div>
                        )}
                        {!menswearUnsoldBrandCategoryLoading && !menswearUnsoldBrandCategoryError && (
                          <div className="menswear-categories-avoid-stock-table-wrap">
                            {menswearUnsoldBrandCategory.length === 0 ? (
                              <p className="menswear-categories-muted">
                                No unsold items for brands in this menswear category.
                              </p>
                            ) : (
                              <table className="menswear-categories-avoid-stock-table">
                                <thead>
                                  <tr>
                                    <th scope="col">Brand</th>
                                    <th scope="col">Category</th>
                                    <th scope="col" className="menswear-categories-avoid-stock-num">
                                      No. in stock
                                    </th>
                                    <th scope="col" className="menswear-categories-avoid-stock-num">
                                      Sold
                                    </th>
                                    <th
                                      scope="col"
                                      className="menswear-categories-avoid-stock-num"
                                      title="Sold ÷ (sold + no. in stock) — share of units that sold"
                                    >
                                      Sell rate
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {menswearUnsoldBrandCategory.map((row, idx) => {
                                    const sold = row.sold_count;
                                    const sellRateLabel = formatAvoidStockSellRateLabel(
                                      row.unsold_count,
                                      sold
                                    );
                                    const openDrilldown = () => {
                                      if (row.brand_id < 1) return;
                                      setMenswearStockDrilldown({
                                        kind: 'avoid',
                                        brandId: row.brand_id,
                                        categoryId: row.category_id,
                                        brandName: row.brand_name,
                                        categoryName: row.category_name,
                                      });
                                    };
                                    const onKeyOpen = (e: React.KeyboardEvent) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        openDrilldown();
                                      }
                                    };
                                    return (
                                      <tr
                                        key={`${row.brand_id}-${row.category_id ?? 'u'}-${idx}`}
                                        className="menswear-categories-avoid-stock-row-link"
                                        role="button"
                                        tabIndex={0}
                                        onClick={openDrilldown}
                                        onKeyDown={onKeyOpen}
                                        aria-label={`View ${row.unsold_count} items in stock: ${row.brand_name}, ${row.category_name}`}
                                      >
                                        <td>{row.brand_name}</td>
                                        <td>{row.category_name}</td>
                                        <td className="menswear-categories-avoid-stock-num">{row.unsold_count}</td>
                                        <td className="menswear-categories-avoid-stock-num">{sold}</td>
                                        <td className="menswear-categories-avoid-stock-num">{sellRateLabel}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                        <div className="menswear-categories-avoid-stock-footer">
                          <button
                            type="button"
                            className="menswear-categories-ask-ai-btn"
                            disabled={
                              menswearAskAiBusy ||
                              menswearUnsoldBrandCategoryLoading ||
                              Boolean(menswearUnsoldBrandCategoryError) ||
                              menswearUnsoldBrandCategory.length === 0
                            }
                            onClick={() => void runMenswearAvoidStockAskAi()}
                            aria-label="Copy Ask AI prompt for worst stock categories to clipboard"
                          >
                            Ask AI — Review worst stock
                          </button>
                        </div>
                      </section>

                      <section
                        className="menswear-categories-buy-more-stock"
                        aria-labelledby="menswear-buy-more-stock-heading"
                      >
                        <h4 id="menswear-buy-more-stock-heading" className="menswear-categories-buy-more-stock-title">
                          Stock To Buy More Of
                        </h4>
                        {menswearBuyMoreBrandCategoryError && (
                          <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                            {menswearBuyMoreBrandCategoryError}
                          </div>
                        )}
                        {menswearBuyMoreBrandCategoryLoading && (
                          <div className="menswear-categories-muted">Loading sell-through data…</div>
                        )}
                        {!menswearBuyMoreBrandCategoryLoading && !menswearBuyMoreBrandCategoryError && (
                          <div className="menswear-categories-buy-more-stock-table-wrap">
                            {menswearBuyMoreBrandCategory.length === 0 ? (
                              <p className="menswear-categories-muted">
                                No brand × category with at least one sale yet for this menswear category.
                              </p>
                            ) : (
                              <table className="menswear-categories-buy-more-stock-table">
                                <thead>
                                  <tr>
                                    <th scope="col">Brand</th>
                                    <th scope="col">Category</th>
                                    <th scope="col" className="menswear-categories-avoid-stock-num">
                                      No. in stock
                                    </th>
                                    <th scope="col" className="menswear-categories-avoid-stock-num">
                                      Sold
                                    </th>
                                    <th
                                      scope="col"
                                      className="menswear-categories-avoid-stock-num"
                                      title="Sold ÷ (sold + no. in stock) — share of units that sold"
                                    >
                                      Sell rate
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {menswearBuyMoreBrandCategory.map((row, idx) => {
                                    const sold = row.sold_count;
                                    const sellRateLabel = formatAvoidStockSellRateLabel(
                                      row.unsold_count,
                                      sold
                                    );
                                    const openBuyMoreDrilldown = () => {
                                      if (row.brand_id < 1) return;
                                      setMenswearStockDrilldown({
                                        kind: 'buy-more',
                                        brandId: row.brand_id,
                                        categoryId: row.category_id,
                                        brandName: row.brand_name,
                                        categoryName: row.category_name,
                                      });
                                    };
                                    const onKeyBuyMore = (e: React.KeyboardEvent) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        openBuyMoreDrilldown();
                                      }
                                    };
                                    return (
                                      <tr
                                        key={`buy-more-${row.brand_id}-${row.category_id ?? 'u'}-${idx}`}
                                        className="menswear-categories-buy-more-stock-row-link"
                                        role="button"
                                        tabIndex={0}
                                        onClick={openBuyMoreDrilldown}
                                        onKeyDown={onKeyBuyMore}
                                        aria-label={`View sold lines: ${row.brand_name}, ${row.category_name}`}
                                      >
                                        <td>{row.brand_name}</td>
                                        <td>{row.category_name}</td>
                                        <td className="menswear-categories-avoid-stock-num">{row.unsold_count}</td>
                                        <td className="menswear-categories-avoid-stock-num">{sold}</td>
                                        <td className="menswear-categories-avoid-stock-num">{sellRateLabel}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                  <div
                    className={`menswear-categories-detail-split-chart${
                      menswearStockDrilldown ? ' menswear-categories-detail-split-chart--avoid-drilldown' : ''
                    }`}
                  >
                    {menswearStockDrilldown ? (
                      <div className="menswear-categories-avoid-drilldown" role="region" aria-label="Stock lines">
                        <div className="menswear-categories-avoid-drilldown-header">
                          <button
                            type="button"
                            className="menswear-categories-avoid-drilldown-back"
                            onClick={() => setMenswearStockDrilldown(null)}
                          >
                            ← Back
                          </button>
                          <h4 className="menswear-categories-avoid-drilldown-title">
                            <span className="menswear-categories-avoid-drilldown-kind">
                              {menswearStockDrilldown.kind === 'avoid' ? 'Unsold' : 'Sold lines'}
                            </span>
                            <span className="menswear-categories-avoid-drilldown-sep"> · </span>
                            {menswearStockDrilldown.brandName}
                            <span className="menswear-categories-avoid-drilldown-sep"> · </span>
                            {menswearStockDrilldown.categoryName}
                          </h4>
                        </div>
                        {menswearDrilldownItemsError && (
                          <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                            {menswearDrilldownItemsError}
                          </div>
                        )}
                        {menswearDrilldownItemsLoading && (
                          <div className="menswear-categories-muted">Loading items…</div>
                        )}
                        {!menswearDrilldownItemsLoading && !menswearDrilldownItemsError && (
                          <div className="menswear-categories-avoid-drilldown-table-wrap">
                            {menswearDrilldownItemsSorted.length === 0 ? (
                              <p className="menswear-categories-muted">
                                {menswearStockDrilldown.kind === 'avoid'
                                  ? 'No matching unsold lines.'
                                  : 'No sold lines for this pair.'}
                              </p>
                            ) : (
                              <table className="menswear-categories-avoid-drilldown-table">
                                <thead>
                                  <tr>
                                    <th scope="col">Item</th>
                                    <th scope="col">Price</th>
                                    <th scope="col">Purchased</th>
                                    <th
                                      scope="col"
                                      title={
                                        menswearStockDrilldown.kind === 'avoid'
                                          ? 'Days since purchase (still in stock)'
                                          : 'Days from purchase to sale'
                                      }
                                    >
                                      Days in stock
                                    </th>
                                    <th scope="col">Listings</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {menswearDrilldownItemsSorted.map((item) => {
                                    const priceNum =
                                      item.purchase_price != null && item.purchase_price !== ''
                                        ? typeof item.purchase_price === 'number'
                                          ? item.purchase_price
                                          : parseFloat(String(item.purchase_price))
                                        : NaN;
                                    const title =
                                      item.item_name && item.item_name.trim().length > 0
                                        ? item.item_name.trim()
                                        : '—';
                                    const hasVinted = Boolean(item.vinted_id);
                                    const hasEbay = Boolean(item.ebay_id);
                                    const daysCol =
                                      menswearStockDrilldown.kind === 'avoid'
                                        ? daysSincePurchase(item.purchase_date)
                                        : daysHeldUntilSale(item.purchase_date, item.sale_date);
                                    return (
                                      <tr key={item.id}>
                                        <td className="menswear-categories-avoid-drilldown-item">
                                          <Link
                                            to={`/stock?editId=${encodeURIComponent(String(item.id))}`}
                                            className="menswear-categories-avoid-drilldown-item-link"
                                          >
                                            {title}
                                          </Link>
                                        </td>
                                        <td className="menswear-categories-avoid-drilldown-num">
                                          {Number.isFinite(priceNum) ? formatResearchCurrency(priceNum) : '—'}
                                        </td>
                                        <td className="menswear-categories-avoid-drilldown-date">
                                          {formatResearchShortDate(item.purchase_date)}
                                        </td>
                                        <td className="menswear-categories-avoid-drilldown-num">
                                          {daysCol === null ? '—' : daysCol}
                                        </td>
                                        <td className="menswear-categories-avoid-drilldown-links">
                                          {hasVinted ? (
                                            <a
                                              href={researchVintedItemUrl(item.vinted_id!)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="menswear-categories-avoid-drilldown-platform-link"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              Vinted
                                            </a>
                                          ) : null}
                                          {hasVinted && hasEbay ? (
                                            <span className="menswear-categories-avoid-drilldown-link-sep" aria-hidden>
                                              {' '}
                                            </span>
                                          ) : null}
                                          {hasEbay ? (
                                            <a
                                              href={researchEbayItemUrl(item.ebay_id!)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="menswear-categories-avoid-drilldown-platform-link"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              eBay
                                            </a>
                                          ) : null}
                                          {!hasVinted && !hasEbay ? (
                                            <span className="menswear-categories-muted">—</span>
                                          ) : null}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <nav
                          className="menswear-categories-subpanel-tabs"
                          role="tablist"
                          aria-label="Menswear Categories detail views"
                        >
                          <button
                            type="button"
                            role="tab"
                            id="menswear-detail-subpanel-overview"
                            aria-selected={menswearClothingSubpanel === 'overview'}
                            aria-controls="menswear-detail-subpanel-overview-panel"
                            className={`menswear-categories-subpanel-tab${menswearClothingSubpanel === 'overview' ? ' menswear-categories-subpanel-tab--active' : ''}`}
                            onClick={() => setMenswearClothingSubpanel('overview')}
                          >
                            Overview
                          </button>
                          <button
                            type="button"
                            role="tab"
                            id="menswear-detail-subpanel-sales"
                            aria-selected={menswearClothingSubpanel === 'sales'}
                            aria-controls="menswear-detail-subpanel-sales-panel"
                            className={`menswear-categories-subpanel-tab${menswearClothingSubpanel === 'sales' ? ' menswear-categories-subpanel-tab--active' : ''}`}
                            onClick={() => setMenswearClothingSubpanel('sales')}
                          >
                            Sales chart
                          </button>
                        </nav>
                        {menswearClothingSubpanel === 'sales' ? (
                          <div
                            id="menswear-detail-subpanel-sales-panel"
                            role="tabpanel"
                            aria-labelledby="menswear-detail-subpanel-sales"
                          >
                            {renderMenswearSalesPie()}
                          </div>
                        ) : (
                          <div
                            id="menswear-detail-subpanel-overview-panel"
                            role="tabpanel"
                            aria-labelledby="menswear-detail-subpanel-overview"
                            className="menswear-categories-overview-wrap"
                          >
                            {menswearBuyMoreBrandCategoryLoading ||
                            menswearUnsoldBrandCategoryLoading ? (
                              <p className="menswear-categories-muted">Loading overview…</p>
                            ) : menswearBuyMoreBrandCategoryError || menswearUnsoldBrandCategoryError ? (
                              <p className="menswear-categories-error" role="alert">
                                {menswearBuyMoreBrandCategoryError ?? menswearUnsoldBrandCategoryError}
                              </p>
                            ) : (
                              <>
                                <div className="menswear-categories-overview-block">
                                  <h4 className="menswear-categories-overview-heading">
                                    Best to buy (brand × stock category)
                                  </h4>
                                  {menswearDetailBestBrandCategoryRows.length === 0 ? (
                                    <p className="menswear-categories-muted">
                                      No brand × category with a sale in this Menswear category bucket for the sales
                                      chart period yet.
                                    </p>
                                  ) : (
                                    <div className="menswear-categories-overview-table-wrap">
                                      <table className="menswear-categories-overview-table">
                                        <thead>
                                          <tr>
                                            <th scope="col">Brand</th>
                                            <th scope="col">Category</th>
                                            <th scope="col" className="menswear-categories-overview-metric">
                                              No. in stock
                                            </th>
                                            <th scope="col" className="menswear-categories-overview-metric">
                                              Sold
                                            </th>
                                            <th
                                              scope="col"
                                              className="menswear-categories-overview-metric"
                                              title="Sold ÷ (sold + no. in stock)"
                                            >
                                              Sell rate
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {menswearDetailBestBrandCategoryRows.map((row, idx) => {
                                            const sold = row.sold_count;
                                            const sellRateLabel = formatAvoidStockSellRateLabel(
                                              row.unsold_count,
                                              sold
                                            );
                                            const openBuyMoreDrilldown = () => {
                                              if (row.brand_id < 1) return;
                                              setMenswearStockDrilldown({
                                                kind: 'buy-more',
                                                brandId: row.brand_id,
                                                categoryId: row.category_id,
                                                brandName: row.brand_name,
                                                categoryName: row.category_name,
                                              });
                                            };
                                            const onKey = (e: React.KeyboardEvent) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                openBuyMoreDrilldown();
                                              }
                                            };
                                            return (
                                              <tr
                                                key={`detail-best-${row.brand_id}-${row.category_id ?? 'u'}-${idx}`}
                                                className="menswear-categories-buy-more-stock-row-link"
                                                role="button"
                                                tabIndex={0}
                                                onClick={openBuyMoreDrilldown}
                                                onKeyDown={onKey}
                                                aria-label={`View sold lines: ${row.brand_name}, ${row.category_name}`}
                                              >
                                                <td>{row.brand_name}</td>
                                                <td>{row.category_name}</td>
                                                <td className="menswear-categories-overview-metric">
                                                  {row.unsold_count}
                                                </td>
                                                <td className="menswear-categories-overview-metric">{sold}</td>
                                                <td className="menswear-categories-overview-metric">
                                                  {sellRateLabel}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                                <div className="menswear-categories-overview-block">
                                  <h4 className="menswear-categories-overview-heading">
                                    Worst to buy (brand × stock category)
                                  </h4>
                                  {menswearDetailWorstBrandCategoryRows.length === 0 ? (
                                    <p className="menswear-categories-muted">
                                      No stock lines to rank for avoid/worst yet.
                                    </p>
                                  ) : (
                                    <div className="menswear-categories-overview-table-wrap">
                                      <table className="menswear-categories-overview-table">
                                        <thead>
                                          <tr>
                                            <th scope="col">Brand</th>
                                            <th scope="col">Category</th>
                                            <th scope="col" className="menswear-categories-overview-metric">
                                              No. in stock
                                            </th>
                                            <th scope="col" className="menswear-categories-overview-metric">
                                              Sold
                                            </th>
                                            <th
                                              scope="col"
                                              className="menswear-categories-overview-metric"
                                              title="Sold ÷ (sold + no. in stock)"
                                            >
                                              Sell rate
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {menswearDetailWorstBrandCategoryRows.map((row, idx) => {
                                            const sold = row.sold_count;
                                            const sellRateLabel = formatAvoidStockSellRateLabel(
                                              row.unsold_count,
                                              sold
                                            );
                                            const openAvoidDrilldown = () => {
                                              if (row.brand_id < 1) return;
                                              setMenswearStockDrilldown({
                                                kind: 'avoid',
                                                brandId: row.brand_id,
                                                categoryId: row.category_id,
                                                brandName: row.brand_name,
                                                categoryName: row.category_name,
                                              });
                                            };
                                            const onKey = (e: React.KeyboardEvent) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                openAvoidDrilldown();
                                              }
                                            };
                                            return (
                                              <tr
                                                key={`detail-worst-${row.brand_id}-${row.category_id ?? 'u'}-${idx}`}
                                                className="menswear-categories-buy-more-stock-row-link"
                                                role="button"
                                                tabIndex={0}
                                                onClick={openAvoidDrilldown}
                                                onKeyDown={onKey}
                                                aria-label={`View items in stock: ${row.brand_name}, ${row.category_name}`}
                                              >
                                                <td>{row.brand_name}</td>
                                                <td>{row.category_name}</td>
                                                <td className="menswear-categories-overview-metric">
                                                  {row.unsold_count}
                                                </td>
                                                <td className="menswear-categories-overview-metric">{sold}</td>
                                                <td className="menswear-categories-overview-metric">
                                                  {sellRateLabel}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                                <p className="menswear-categories-overview-note">
                                  Best to buy: top 5 brand × stock category pairs by sold count (same ordering as
                                  Stock To Buy More Of). Worst to buy: lowest sell rate (same idea as Stock To
                                  Avoid Buying). Sold counts follow the sales-chart period ({menswearOverviewPeriodLabel}
                                  ); no. in stock is current unsold lines.
                                </p>
                              </>
                            )}
                          </div>
                        )}
                        {menswearCategoryBrandsEditMode && !menswearStockDrilldown ? (
                          <div
                            className="menswear-categories-remove-brands-footer"
                            role="region"
                            aria-label="Remove brands from this menswear category"
                          >
                            {menswearCategoryRemoveBrandsError ? (
                              <p
                                className="menswear-categories-error menswear-categories-error--inline"
                                role="alert"
                              >
                                {menswearCategoryRemoveBrandsError}
                              </p>
                            ) : null}
                            <button
                              type="button"
                              className="menswear-categories-remove-from-category-btn"
                              disabled={
                                menswearCategoryRemoveBrandsSaving ||
                                menswearCategoryBrandRemovalIds.size === 0
                              }
                              onClick={() => void removeSelectedBrandsFromMenswearCategory()}
                            >
                              {menswearCategoryRemoveBrandsSaving
                                ? 'Removing…'
                                : 'Remove from category'}
                            </button>
                            <p className="menswear-categories-muted menswear-categories-remove-brands-hint">
                              Unlinks brands from this menswear category only — brands are not deleted.
                            </p>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
                ) : (
                <div
                  className="menswear-categories-brand-stock-lines"
                  role="region"
                  aria-label="Stock lines for selected brand"
                >
                  <div
                    className="menswear-categories-brand-stock-lines-heading-row"
                    ref={menswearBrandStockTableAnchorRef}
                  >
                    <div className="menswear-categories-brand-stock-lines-heading-row-start">
                      <button
                        type="button"
                        className="menswear-categories-avoid-drilldown-back"
                        onClick={closeMenswearBrandInventoryInUrl}
                      >
                        ← Back to brands
                      </button>
                    </div>
                    <h2 className="menswear-categories-brand-stock-lines-title">
                      {menswearBrandStockLinesBrandName ||
                        menswearCategoryBrands.find((b) => b.id === menswearBrandIdFromUrl)?.brand_name ||
                        'In stock'}
                    </h2>
                  </div>
                  <div
                    className="menswear-categories-brand-stock-lines-sales-panel"
                    aria-label="Sales data for this brand"
                  >
                    {menswearBrandInventoryStockSummaryLoading && (
                      <p className="menswear-categories-muted">Loading sales data…</p>
                    )}
                    {menswearBrandInventoryStockSummaryError && (
                      <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                        {menswearBrandInventoryStockSummaryError}
                      </div>
                    )}
                    {!menswearBrandInventoryStockSummaryLoading &&
                      !menswearBrandInventoryStockSummaryError &&
                      menswearBrandInventoryStockSummary && (
                        <BrandStockSpendSoldNetTotals
                          summary={menswearBrandInventoryStockSummary}
                          extendedMetrics
                        />
                      )}
                  </div>
                  {menswearBrandStockLinesLoading ? (
                    <p className="menswear-categories-muted">Loading items…</p>
                  ) : menswearBrandStockLinesError ? (
                    <p className="menswear-categories-muted" role="alert">
                      {menswearBrandStockLinesError}
                    </p>
                  ) : menswearBrandStockLines.length === 0 ? (
                    <p className="menswear-categories-muted">No stock lines for this brand.</p>
                  ) : (
                    <>
                      {menswearBrandStockCategoryStackChart ? (
                        <div
                          className="menswear-categories-brand-stock-category-chart-block"
                          role="region"
                          aria-label={
                            menswearBrandStockChartDrillCategoryKey
                              ? 'In stock and sold counts by size within the selected category'
                              : 'Stacked in stock and sold counts by category; click a category to see a size breakdown'
                          }
                        >
                          <h3 className="menswear-categories-brand-stock-category-chart-heading">
                            Inventory and Sold
                          </h3>
                          {menswearBrandStockChartDrillCategoryKey != null ? (
                            <>
                              <div className="menswear-categories-brand-stock-chart-drill-header">
                                <button
                                  type="button"
                                  className="menswear-categories-avoid-drilldown-back"
                                  onClick={() => {
                                    setMenswearBrandStockChartDrillCategoryKey(null);
                                    setMenswearBrandStockLinesCategoryFilter('all');
                                  }}
                                >
                                  ← Back to categories
                                </button>
                                {menswearBrandStockChartDrillCategoryTitle ? (
                                  <p
                                    className="menswear-categories-brand-stock-chart-drill-title"
                                    aria-live="polite"
                                  >
                                    {menswearBrandStockChartDrillCategoryTitle}
                                    <span className="menswear-categories-brand-stock-chart-drill-sub">
                                      {' '}
                                      · by size
                                    </span>
                                  </p>
                                ) : null}
                              </div>
                              {menswearBrandStockSizeStackChart ? (
                                <div
                                  className="menswear-categories-brand-stock-category-chart-inner"
                                  style={{
                                    height: `${Math.max(
                                      200,
                                      (menswearBrandStockSizeStackChart.data.labels?.length ?? 0) * 44 +
                                        120
                                    )}px`,
                                  }}
                                >
                                  <Bar
                                    data={menswearBrandStockSizeStackChart.data}
                                    options={menswearBrandStockSizeStackBarOptions}
                                  />
                                </div>
                              ) : (
                                <p className="menswear-categories-muted" role="status">
                                  No items in this category.
                                </p>
                              )}
                            </>
                          ) : (
                            <div
                              className="menswear-categories-brand-stock-category-chart-inner"
                              style={{
                                height: `${Math.max(
                                  200,
                                  (menswearBrandStockCategoryStackChart.data.labels?.length ?? 0) * 44 +
                                    120
                                )}px`,
                              }}
                            >
                              <Bar
                                data={menswearBrandStockCategoryStackChart.data}
                                options={menswearBrandStockCategoryStackBarOptions}
                              />
                            </div>
                          )}
                        </div>
                      ) : null}
                      {menswearBrandTagInventoryCharts ? (
                        <div
                          className="menswear-categories-brand-tag-charts"
                          role="region"
                          aria-label="Sold and unsold item counts by brand tag image"
                        >
                          <h3 className="menswear-categories-brand-tag-charts-heading">
                            Tags — sold vs unsold
                          </h3>
                          <div className="menswear-categories-brand-tag-charts-row">
                            <div className="menswear-categories-brand-tag-chart-panel">
                              <h4 className="menswear-categories-brand-tag-chart-panel-title">Sold</h4>
                              {menswearBrandTagInventoryCharts.tags.map((t) => {
                                const pct =
                                  (t.sold / menswearBrandTagInventoryCharts.maxSold) * 100;
                                return (
                                  <div
                                    key={`tag-sold-${t.id}`}
                                    className="menswear-categories-brand-tag-bar-block"
                                  >
                                    <div className="menswear-categories-brand-tag-bar-row">
                                      <span className="menswear-categories-brand-tag-bar-count">
                                        {t.sold}
                                      </span>
                                      <div className="menswear-categories-brand-tag-bar-track">
                                        <div
                                          className="menswear-categories-brand-tag-bar-fill menswear-categories-brand-tag-bar-fill--sold"
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </div>
                                    <div className="menswear-categories-brand-tag-bar-foot">
                                      {t.publicUrl ? (
                                        <img
                                          src={t.publicUrl}
                                          alt=""
                                          className="menswear-categories-brand-tag-bar-thumb"
                                        />
                                      ) : (
                                        <div
                                          className="menswear-categories-brand-tag-bar-thumb menswear-categories-brand-tag-bar-thumb--placeholder"
                                          aria-hidden
                                        />
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="menswear-categories-brand-tag-chart-panel">
                              <h4 className="menswear-categories-brand-tag-chart-panel-title">Unsold</h4>
                              {menswearBrandTagInventoryCharts.tags.map((t) => {
                                const pct =
                                  (t.unsold / menswearBrandTagInventoryCharts.maxUnsold) * 100;
                                return (
                                  <div
                                    key={`tag-unsold-${t.id}`}
                                    className="menswear-categories-brand-tag-bar-block"
                                  >
                                    <div className="menswear-categories-brand-tag-bar-row">
                                      <span className="menswear-categories-brand-tag-bar-count">
                                        {t.unsold}
                                      </span>
                                      <div className="menswear-categories-brand-tag-bar-track">
                                        <div
                                          className="menswear-categories-brand-tag-bar-fill menswear-categories-brand-tag-bar-fill--unsold"
                                          style={{ width: `${pct}%` }}
                                        />
                                      </div>
                                    </div>
                                    <div className="menswear-categories-brand-tag-bar-foot">
                                      {t.publicUrl ? (
                                        <img
                                          src={t.publicUrl}
                                          alt=""
                                          className="menswear-categories-brand-tag-bar-thumb"
                                        />
                                      ) : (
                                        <div
                                          className="menswear-categories-brand-tag-bar-thumb menswear-categories-brand-tag-bar-thumb--placeholder"
                                          aria-hidden
                                        />
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div className="menswear-categories-brand-inventory-table-header">
                        <h3 className="menswear-categories-brand-inventory-table-heading">
                          {(() => {
                            const nm = (
                              menswearBrandStockLinesBrandName ||
                              menswearCategoryBrands.find((b) => b.id === menswearBrandIdFromUrl)
                                ?.brand_name ||
                              ''
                            ).trim();
                            return nm ? `${nm} Inventory` : 'Inventory';
                          })()}
                        </h3>
                        <div className="menswear-categories-brand-inventory-table-header-filter">
              <select
                            id="menswear-brand-stock-lines-category-filter"
                            className="menswear-categories-brand-stock-lines-filter-select"
                            value={menswearBrandStockLinesCategoryFilter}
                            onChange={(e) => setMenswearBrandStockLinesCategoryFilter(e.target.value)}
                            aria-label="Filter table rows by category"
                          >
                            {menswearBrandStockLinesCategoryFilterOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                  </option>
                ))}
              </select>
            </div>
                      </div>
                      {menswearBrandStockLinesFilteredRows.length === 0 ? (
                        <p className="menswear-categories-muted" role="status">
                          No rows match this category filter.
                        </p>
                      ) : (
                        <div className="menswear-categories-brand-stock-lines-table-wrap">
                          <table className="menswear-categories-avoid-drilldown-table">
                            <thead>
                              <tr>
                                <th scope="col">Item</th>
                                <th scope="col">Category</th>
                                <th scope="col" className="menswear-categories-avoid-drilldown-num">
                                  Price paid
                                </th>
                                <th scope="col" className="menswear-categories-avoid-drilldown-date">
                                  Purchased
                                </th>
                                <th scope="col" className="menswear-categories-brand-stock-lines-status-col">
                                  Status
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {menswearBrandStockLinesFilteredRows.map((row) => {
                                const title =
                                  row.item_name && String(row.item_name).trim() !== ''
                                    ? String(row.item_name).trim()
                                    : '—';
                                const priceNum =
                                  row.purchase_price !== null && row.purchase_price !== undefined
                                    ? Number(row.purchase_price)
                                    : NaN;
                                const inStock =
                                  row.sale_date == null ||
                                  String(row.sale_date).trim() === '';
                  return (
                                  <tr key={row.id}>
                                    <td className="menswear-categories-avoid-drilldown-item">
                                      <Link
                                        to={`/stock?editId=${encodeURIComponent(String(row.id))}`}
                                        className="menswear-categories-avoid-drilldown-item-link"
                                      >
                                        {title}
                                      </Link>
                                    </td>
                                    <td>{row.category_name ?? '—'}</td>
                                    <td className="menswear-categories-avoid-drilldown-num">
                                      {Number.isFinite(priceNum) ? formatResearchCurrency(priceNum) : '—'}
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-date">
                                      {formatResearchShortDate(row.purchase_date)}
                                    </td>
                                    <td
                                      className={
                                        'menswear-categories-brand-stock-lines-status-col' +
                                        (inStock
                                          ? ' menswear-categories-brand-stock-lines-status-col--instock'
                                          : ' menswear-categories-brand-stock-lines-status-col--sold')
                                      }
                                    >
                                      {inStock ? 'In stock' : 'Sold'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                  {menswearBrandIdFromUrl != null ? (
                    <div className="menswear-categories-brand-stock-lines-research-below">
                      {(() => {
                        const researchBrandDisplayName = (
                          menswearBrandStockLinesBrandName ||
                          menswearCategoryBrands.find((b) => b.id === menswearBrandIdFromUrl)?.brand_name ||
                          ''
                        ).trim();
                        const researchBrandLabel = researchBrandDisplayName || 'brand';
                        return (
                          <Link
                            to={`/research?brand=${encodeURIComponent(String(menswearBrandIdFromUrl))}`}
                            className="menswear-categories-brand-stock-lines-research-link-below"
                            aria-label={`Research: ${researchBrandLabel}`}
                          >
                            Research {researchBrandLabel}
                          </Link>
                        );
                      })()}
                    </div>
                  ) : null}
                </div>
                )}
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

            {selectedMenswearCategory && menswearBrandIdFromUrl == null && (
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

      {researchTab === 'clothing-types' && (
        <div
          id="research-panel-clothing-types"
          role="tabpanel"
          aria-labelledby="research-tab-clothing-types"
          className="research-tab-panel"
        >
          <div
            className={
              'menswear-categories-page' +
              (clothingTypeSelection ? ' menswear-categories-page--detail-split' : '') +
              (showClothingTypesSplit ? ' menswear-categories-page--split' : '')
            }
          >
            {clothingTypesListError && (
              <div className="menswear-categories-error" role="alert">
                {clothingTypesListError}
              </div>
            )}
            {clothingTypesListLoading && !clothingTypeSelection && (
              <div className="menswear-categories-muted">Loading categories…</div>
            )}
            {showClothingTypesSplit && (
              <>
                <nav
                  className="clothing-types-browse"
                  aria-label="Sales by category — open category details"
                >
                  <ul className="clothing-types-browse-list">
                    {clothingTypesListRows.length === 0 && !clothingTypesHasUncategorized ? (
                      <li className="menswear-categories-empty">
                        No categories defined for {clothingTypesResearchDepartmentLabel} yet.
                      </li>
                    ) : null}
                    {clothingTypesListRows.map((cat) => (
                      <li key={cat.id} className="clothing-types-browse-item">
                        <a
                          className="clothing-types-browse-link"
                          id={`clothing-type-list-${cat.id}`}
                          href={clothingTypesDetailHref(cat.id, clothingTypesListDepartmentIdForApi)}
                        >
                          {cat.category_name}
                        </a>
                      </li>
                    ))}
                    {clothingTypesHasUncategorized ? (
                      <li className="clothing-types-browse-item">
                        <a
                          className="clothing-types-browse-link clothing-types-browse-link--uncat"
                          id="clothing-type-list-uncategorized"
                          href={clothingTypesDetailHref(
                            'uncategorized',
                            clothingTypesListDepartmentIdForApi
                          )}
                        >
                          Uncategorized
                          <span className="clothing-types-browse-link-sub">
                            No category on stock line
                          </span>
                        </a>
                      </li>
                    ) : null}
                  </ul>
                </nav>
                <div className="clothing-types-charts-below menswear-categories-split-right">
                  {!clothingTypesInventoryLoading && !clothingTypesInventoryError ? (
                    <div
                      className="clothing-types-buy-avoid-strip"
                      role="region"
                      aria-label="Top categories to buy vs avoid, from sell-through in the table below"
                    >
                      <div className="clothing-types-buy-avoid-col clothing-types-buy-avoid-col--buy">
                        <span className="clothing-types-buy-avoid-label">Top 5 to buy</span>
                        <div className="clothing-types-buy-avoid-names-block">
                          <span
                            className="clothing-types-buy-avoid-names"
                            title={
                              clothingTypesInvestRiskModel.buyTop5.length > 0
                                ? clothingTypesInvestRiskModel.buyTop5.map((r) => r.label).join(' · ')
                                : undefined
                            }
                          >
                            {clothingTypesInvestRiskModel.buyTop5.length > 0
                              ? clothingTypesInvestRiskModel.buyTop5.map((r) => r.label).join(' · ')
                              : '—'}
                          </span>
                        </div>
                      </div>
                      <div className="clothing-types-buy-avoid-col clothing-types-buy-avoid-col--avoid">
                        <span className="clothing-types-buy-avoid-label">Avoid buying</span>
                        <div className="clothing-types-buy-avoid-names-block">
                          <span
                            className="clothing-types-buy-avoid-names"
                            title={
                              clothingTypesInvestRiskModel.avoidTop5.length > 0
                                ? clothingTypesInvestRiskModel.avoidTop5.map((r) => r.label).join(' · ')
                                : undefined
                            }
                          >
                            {clothingTypesInvestRiskModel.avoidTop5.length > 0
                              ? clothingTypesInvestRiskModel.avoidTop5.map((r) => r.label).join(' · ')
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div
                    className="clothing-types-charts-period-bar menswear-categories-sales-pie-filter"
                    role="group"
                    aria-label="Sales period filter"
                  >
                    <button
                      type="button"
                      className={`menswear-categories-sales-pie-filter-btn${clothingTypesPeriod === 'last_12_months' ? ' menswear-categories-sales-pie-filter-btn--active' : ''}`}
                      onClick={() => setClothingTypesPeriod('last_12_months')}
                    >
                      Last 12 Months
                    </button>
                    <button
                      type="button"
                      className={`menswear-categories-sales-pie-filter-btn${clothingTypesPeriod === '2026' ? ' menswear-categories-sales-pie-filter-btn--active' : ''}`}
                      onClick={() => setClothingTypesPeriod('2026')}
                    >
                      2026
                    </button>
                    <button
                      type="button"
                      className={`menswear-categories-sales-pie-filter-btn${clothingTypesPeriod === '2025' ? ' menswear-categories-sales-pie-filter-btn--active' : ''}`}
                      onClick={() => setClothingTypesPeriod('2025')}
                    >
                      2025
                    </button>
                  </div>
                  <div className="clothing-types-three-pies-row">
                  <section
                    className="menswear-categories-sales-pie clothing-types-pie-column"
                    aria-label="Sales by category — revenue"
                  >
                    <div className="menswear-categories-sales-pie-header clothing-types-pie-column-header">
                      <h3 className="menswear-categories-sales-pie-title">Sales by category (£)</h3>
                    </div>
                    {clothingTypesSalesError && (
                      <div className="menswear-categories-error" role="alert">
                        {clothingTypesSalesError}
                      </div>
                    )}
                    {clothingTypesSalesLoading && !clothingTypesSalesError && (
                      <div className="menswear-categories-muted">Loading sales…</div>
                    )}
                    {!clothingTypesSalesLoading &&
                      !clothingTypesSalesError &&
                      (clothingTypesSalesPieModel.data ? (
                        <div className="menswear-categories-sales-pie-chart-wrap">
                          <Pie
                            data={clothingTypesSalesPieModel.data}
                            options={clothingTypesSalesPieChartOptions}
                          />
                        </div>
                      ) : (
                        <div className="menswear-categories-muted">
                          No sold revenue in this period by category.
                        </div>
                      ))}
                  </section>

                  <div
                    className="menswear-categories-inventory-block menswear-categories-category-items-sold-block clothing-types-pie-column"
                    role="region"
                    aria-label="Items sold by category"
                  >
                    <h4 className="menswear-categories-inventory-title clothing-types-pie-column-header">
                      Items sold by category
                    </h4>
                    {clothingTypesSalesError ? (
                      <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                        {clothingTypesSalesError}
                      </div>
                    ) : null}
                    {clothingTypesSalesLoading && !clothingTypesSalesError ? (
                      <div className="menswear-categories-muted menswear-categories-inventory-loading">
                        Loading…
                      </div>
                    ) : null}
                    {!clothingTypesSalesLoading &&
                      !clothingTypesSalesError &&
                      (clothingTypesItemsSoldPieModel.data ? (
                        <div className="menswear-categories-inventory-chart-wrap">
                          <Pie
                            data={clothingTypesItemsSoldPieModel.data}
                            options={clothingTypesItemsSoldPieChartOptions}
                          />
                        </div>
                      ) : (
                        <div className="menswear-categories-muted">
                          No items sold in mapped categories in this period.
                        </div>
                      ))}
                  </div>

                  <div
                    className="menswear-categories-inventory-block clothing-types-pie-column"
                    role="region"
                    aria-label="Unsold inventory by category"
                  >
                    <h4 className="menswear-categories-inventory-title clothing-types-pie-column-header">
                      Unsold inventory by category
                    </h4>
                    {clothingTypesInventoryError ? (
                      <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                        {clothingTypesInventoryError}
                      </div>
                    ) : null}
                    {clothingTypesInventoryLoading && !clothingTypesInventoryError ? (
                      <div className="menswear-categories-muted menswear-categories-inventory-loading">
                        Loading inventory…
                      </div>
                    ) : null}
                    {!clothingTypesInventoryLoading &&
                      !clothingTypesInventoryError &&
                      (clothingTypesInventoryPieModel.data ? (
                        <div className="menswear-categories-inventory-chart-wrap">
                          <Pie
                            data={clothingTypesInventoryPieModel.data}
                            options={clothingTypesInventoryPieChartOptions}
                          />
                        </div>
                      ) : (
                        <div className="menswear-categories-muted">
                          No categories with unsold stock and at least three listings in{' '}
                          {clothingTypesResearchDepartmentLabel}. One- and two-line types are left off so the chart
                          highlights heavier inventory risk.
                        </div>
                      ))}
                  </div>
                  </div>

                  <section
                    className="clothing-types-invest-risk"
                    aria-label="Sold versus unsold line counts by category, worst sell-through first"
                  >
                    <h3 className="clothing-types-invest-risk-title">Inventory strain by category</h3>
                    {clothingTypesInventoryError ? (
                      <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                        {clothingTypesInventoryError}
                      </div>
                    ) : null}
                    {clothingTypesInventoryLoading && !clothingTypesInventoryError ? (
                      <div className="menswear-categories-muted">Loading inventory chart…</div>
                    ) : null}
                    {!clothingTypesInventoryLoading &&
                      !clothingTypesInventoryError &&
                      (clothingTypesInvestRiskModel.chartData ? (
                        <>
                          <div className="clothing-types-invest-risk-chart-wrap">
                            <Bar
                              data={clothingTypesInvestRiskModel.chartData}
                              options={clothingTypesInvestRiskBarOptions}
                            />
                          </div>
                          <div className="clothing-types-invest-risk-table-wrap">
                            <table className="menswear-categories-avoid-drilldown-table clothing-types-invest-risk-table">
                              <thead>
                                <tr>
                                  <th scope="col">Category</th>
                                  <th scope="col" className="menswear-categories-avoid-drilldown-num">
                                    Listed
                                  </th>
                                  <th scope="col" className="menswear-categories-avoid-drilldown-num">
                                    Sold
                                  </th>
                                  <th scope="col" className="menswear-categories-avoid-drilldown-num">
                                    Unsold
                                  </th>
                                  <th scope="col" className="menswear-categories-avoid-drilldown-num">
                                    Sell-through
                                  </th>
                                  <th
                                    scope="col"
                                    className="menswear-categories-avoid-drilldown-num"
                                    title="Sum of net profit on sold lines in this category"
                                  >
                                    Total profit
                                  </th>
                                  <th
                                    scope="col"
                                    className="menswear-categories-avoid-drilldown-num"
                                    title="Sum of purchase price on unsold lines (stock tied up)"
                                  >
                                    Unsold stock (£)
                                  </th>
                                  <th scope="col" className="menswear-categories-avoid-drilldown-num">
                                    Strain
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {clothingTypesInvestRiskModel.tableRows.map((r) => (
                                  <tr key={`${r.bucketId}-${r.label}`}>
                                    <td>
                                      <a
                                        className="clothing-types-invest-risk-type-link"
                                        href={clothingTypesDetailHref(
                                          r.bucketId === -1 ? 'uncategorized' : r.bucketId,
                                          clothingTypesListDepartmentIdForApi
                                        )}
                                      >
                                        {r.label}
                                      </a>
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-num">{r.total}</td>
                                    <td className="menswear-categories-avoid-drilldown-num">{r.sold}</td>
                                    <td className="menswear-categories-avoid-drilldown-num">{r.unsold}</td>
                                    <td className="menswear-categories-avoid-drilldown-num">
                                      {(Math.round(r.sellThroughPct * 10) / 10).toFixed(1)}%
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-num">
                                      {formatResearchCurrency(r.totalNetProfit)}
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-num">
                                      {formatResearchCurrency(r.unsoldInventoryTotal)}
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-num">
                                      {(Math.round(r.strain * 100) / 100).toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : (
                        <div className="menswear-categories-muted">
                          No categories with unsold stock and at least two listings match this view for{' '}
                          {clothingTypesResearchDepartmentLabel}.
                        </div>
                      ))}
                  </section>
                </div>
              </>
            )}

            {clothingTypeSelection &&
              !clothingTypesListLoading &&
              !clothingTypesListError &&
              clothingTypeSelection.mode === 'category' &&
              !clothingTypesListRows.some((r) => r.id === clothingTypeSelection.id) && (
                <div className="menswear-categories-detail">
                  <p className="menswear-categories-muted">
                    That category is not in the list anymore. Go back or refresh.
                  </p>
                  <button type="button" className="menswear-categories-read-aloud-btn" onClick={goToClothingTypesTab}>
                    Back to sales by category
                  </button>
                </div>
              )}

            {clothingTypeSelection &&
              !clothingTypesListLoading &&
              !clothingTypesListError &&
              (clothingTypeSelection.mode === 'uncategorized' ||
                clothingTypesListRows.some((r) => r.id === clothingTypeSelection.id)) &&
              clothingTypeBrandIdFromUrl == null && (
                <>
                  <header className="menswear-categories-detail-header clothing-type-detail-type-header">
                    <button
                      type="button"
                      className="menswear-categories-avoid-drilldown-back clothing-type-detail-type-header-back"
                      onClick={goToClothingTypesTab}
                    >
                      ← Back to categories
                    </button>
                    <h2 className="menswear-categories-detail-title clothing-type-detail-type-header-title">
                      {selectedClothingTypeLabel}
                    </h2>
                  </header>
                  {clothingTypeDetailError && (
                    <div className="menswear-categories-error clothing-type-detail-error" role="alert">
                      {clothingTypeDetailError}
                    </div>
                  )}
                  {clothingTypeDetailLoading && (
                    <div className="menswear-categories-muted clothing-type-detail-loading">
                      Loading category totals and items…
                    </div>
                  )}
                  {!clothingTypeDetailLoading && clothingTypeDetailSummary ? (
                    <>
                      <div
                        className="clothing-type-detail-metrics"
                        aria-label="Spend and sell-through for this category"
                      >
                        <BrandStockSpendSoldNetTotals
                          summary={clothingTypeDetailSummary}
                          extendedMetrics
                        />
                      </div>
                    </>
                  ) : null}
                  <h3 className="clothing-type-detail-signals-heading">Brands &amp; Signals</h3>
                  <hr className="clothing-type-detail-heading-rule" aria-hidden />
                  <div className="menswear-categories-detail-split">
                    <div className="menswear-categories-detail-split-brands">
                      <h3 className="menswear-categories-overview-heading">Brands</h3>
                      {clothingTypeBrandsError && (
                        <div className="menswear-categories-error" role="alert">
                          {clothingTypeBrandsError}
                        </div>
                      )}
                      {clothingTypeBrandsLoading && (
                        <div className="menswear-categories-muted">Loading brands…</div>
                      )}
                      {!clothingTypeBrandsLoading && !clothingTypeBrandsError && (
                        <ul className="menswear-categories-brands">
                          {clothingTypeBrands.length === 0 ? (
                            <li className="menswear-categories-empty">No brands with stock in this category yet.</li>
                          ) : (
                            clothingTypeBrands.map((b) => {
                              const salesNum =
                                typeof b.total_sales === 'number'
                                  ? b.total_sales
                                  : parseFloat(String(b.total_sales)) || 0;
                              return (
                                <li key={b.id} className="menswear-categories-brand-row">
                                  <a
                                    className="menswear-categories-brand-link"
                                    href={clothingTypesBrandDetailHref(
                                      clothingTypeBrandUrlKey,
                                      b.id,
                                      clothingTypesListDepartmentIdForApi
                                    )}
                                  >
                                    {b.brand_name || '—'}
                                  </a>
                                  <span className="menswear-categories-brand-sales">
                                    {b.sold_count} sold · {formatResearchCurrency(salesNum)}
                                  </span>
                                </li>
                              );
                            })
                          )}
                        </ul>
                      )}
                    </div>
                    <div
                      className={`menswear-categories-detail-split-chart${clothingTypeStockDrilldown ? ' menswear-categories-detail-split-chart--avoid-drilldown' : ''}`}
                    >
                      {clothingTypeStockDrilldown ? (
                        <div className="menswear-categories-avoid-drilldown" role="region" aria-label="Stock lines">
                          <div className="menswear-categories-avoid-drilldown-header">
                            <button
                              type="button"
                              className="menswear-categories-avoid-drilldown-back"
                              onClick={() => setClothingTypeStockDrilldown(null)}
                            >
                              ← Back
                            </button>
                            <h4 className="menswear-categories-avoid-drilldown-title">
                              <span className="menswear-categories-avoid-drilldown-kind">
                                {clothingTypeStockDrilldown.kind === 'avoid' ? 'Unsold' : 'Sold lines'}
                              </span>
                              <span className="menswear-categories-avoid-drilldown-sep"> · </span>
                              {clothingTypeStockDrilldown.brandName}
                              <span className="menswear-categories-avoid-drilldown-sep"> · </span>
                              {clothingTypeStockDrilldown.categoryName}
                            </h4>
                          </div>
                          {clothingTypeDrilldownItemsError && (
                            <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                              {clothingTypeDrilldownItemsError}
                            </div>
                          )}
                          {clothingTypeDrilldownItemsLoading && (
                            <div className="menswear-categories-muted">Loading items…</div>
                          )}
                          {!clothingTypeDrilldownItemsLoading && !clothingTypeDrilldownItemsError && (
                            <div className="menswear-categories-avoid-drilldown-table-wrap">
                              {clothingTypeDrilldownItemsSorted.length === 0 ? (
                                <p className="menswear-categories-muted">No matching lines.</p>
                              ) : (
                                <table className="menswear-categories-avoid-drilldown-table">
                                  <thead>
                                    <tr>
                                      <th scope="col">Item</th>
                                      <th scope="col" className="menswear-categories-avoid-drilldown-num">
                                        Price
                                      </th>
                                      <th scope="col" className="menswear-categories-avoid-drilldown-date">
                                        Purchased
                                      </th>
                                      <th scope="col">Listings</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {clothingTypeDrilldownItemsSorted.map((item) => {
                                      const priceNum =
                                        item.purchase_price != null && item.purchase_price !== ''
                                          ? typeof item.purchase_price === 'number'
                                            ? item.purchase_price
                                            : parseFloat(String(item.purchase_price))
                                          : NaN;
                                      const title =
                                        item.item_name && item.item_name.trim().length > 0
                                          ? item.item_name.trim()
                                          : '—';
                                      const hasVinted = Boolean(item.vinted_id);
                                      const hasEbay = Boolean(item.ebay_id);
                                      return (
                                        <tr key={item.id}>
                                          <td className="menswear-categories-avoid-drilldown-item">
                                            <Link
                                              to={`/stock?editId=${encodeURIComponent(String(item.id))}`}
                                              className="menswear-categories-avoid-drilldown-item-link"
                                            >
                                              {title}
                                            </Link>
                                          </td>
                                          <td className="menswear-categories-avoid-drilldown-num">
                                            {Number.isFinite(priceNum) ? formatResearchCurrency(priceNum) : '—'}
                                          </td>
                                          <td className="menswear-categories-avoid-drilldown-date">
                                            {formatResearchShortDate(item.purchase_date)}
                                          </td>
                                          <td className="menswear-categories-avoid-drilldown-links">
                                            {hasVinted ? (
                                              <a
                                                href={researchVintedItemUrl(item.vinted_id!)}
                        target="_blank"
                        rel="noopener noreferrer"
                                                className="menswear-categories-avoid-drilldown-platform-link"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                Vinted
                                              </a>
                                            ) : null}
                                            {hasVinted && hasEbay ? (
                                              <span
                                                className="menswear-categories-avoid-drilldown-link-sep"
                                                aria-hidden
                                              >
                                                {' '}
                                              </span>
                                            ) : null}
                                            {hasEbay ? (
                                              <a
                                                href={researchEbayItemUrl(item.ebay_id!)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="menswear-categories-avoid-drilldown-platform-link"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                eBay
                                              </a>
                                            ) : null}
                                            {!hasVinted && !hasEbay ? (
                                              <span className="menswear-categories-muted">—</span>
                                            ) : null}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}
                    </div>
                          )}
                        </div>
                      ) : (
                        <div className="menswear-categories-overview-wrap">
                          <div className="menswear-categories-overview-block">
                            <h4 className="menswear-categories-overview-heading">
                              Best to buy (brand × stock category)
                            </h4>
                            {clothingTypeBuyMoreBrandCategoryError && (
                              <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                                {clothingTypeBuyMoreBrandCategoryError}
                              </div>
                            )}
                            {clothingTypeBuyMoreBrandCategoryLoading && (
                              <p className="menswear-categories-muted">Loading…</p>
                            )}
                            {!clothingTypeBuyMoreBrandCategoryLoading &&
                              !clothingTypeBuyMoreBrandCategoryError &&
                              (clothingTypeDetailBestRows.length === 0 ? (
                                <p className="menswear-categories-muted">
                                  No brand × category with a sale in this stock category yet.
                                </p>
                              ) : (
                                <div className="menswear-categories-overview-table-wrap">
                                  <table className="menswear-categories-overview-table">
                                    <thead>
                                      <tr>
                                        <th scope="col">Brand</th>
                                        <th scope="col">Category</th>
                                        <th scope="col" className="menswear-categories-overview-metric">
                                          No. in stock
                                        </th>
                                        <th scope="col" className="menswear-categories-overview-metric">
                                          Sold
                                        </th>
                                        <th
                                          scope="col"
                                          className="menswear-categories-overview-metric"
                                          title="Sold ÷ (sold + no. in stock)"
                                        >
                                          Sell rate
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {clothingTypeDetailBestRows.map((row, idx) => {
                                        const sold = row.sold_count;
                                        const sellRateLabel = formatAvoidStockSellRateLabel(
                                          row.unsold_count,
                                          sold
                                        );
                                        return (
                                          <tr
                                            key={`ct-best-${row.brand_id}-${row.category_id ?? 'u'}-${idx}`}
                                            className="menswear-categories-buy-more-stock-row-link"
                                            role="button"
                                            tabIndex={0}
                                            onClick={() =>
                                              setClothingTypeStockDrilldown({
                                                kind: 'buy-more',
                                                brandId: row.brand_id,
                                                categoryId: row.category_id,
                                                brandName: row.brand_name,
                                                categoryName: row.category_name,
                                              })
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setClothingTypeStockDrilldown({
                                                  kind: 'buy-more',
                                                  brandId: row.brand_id,
                                                  categoryId: row.category_id,
                                                  brandName: row.brand_name,
                                                  categoryName: row.category_name,
                                                });
                                              }
                                            }}
                                            aria-label={`View sold lines: ${row.brand_name}, ${row.category_name}`}
                                          >
                                            <td>{row.brand_name}</td>
                                            <td>{row.category_name}</td>
                                            <td className="menswear-categories-overview-metric">
                                              {row.unsold_count}
                                            </td>
                                            <td className="menswear-categories-overview-metric">{sold}</td>
                                            <td className="menswear-categories-overview-metric">
                                              {sellRateLabel}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
          </div>
                              ))}
        </div>
                          <div className="menswear-categories-overview-block">
                            <h4 className="menswear-categories-overview-heading">
                              Worst to buy (brand × stock category)
                            </h4>
                            {clothingTypeUnsoldBrandCategoryError && (
                              <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                                {clothingTypeUnsoldBrandCategoryError}
      </div>
                            )}
                            {clothingTypeUnsoldBrandCategoryLoading && (
                              <p className="menswear-categories-muted">Loading…</p>
                            )}
                            {!clothingTypeUnsoldBrandCategoryLoading &&
                              !clothingTypeUnsoldBrandCategoryError &&
                              (clothingTypeDetailWorstRows.length === 0 ? (
                                <p className="menswear-categories-muted">
                                  No unsold inventory to rank for this category yet.
                                </p>
                              ) : (
                                <div className="menswear-categories-overview-table-wrap">
                                  <table className="menswear-categories-overview-table">
                                    <thead>
                                      <tr>
                                        <th scope="col">Brand</th>
                                        <th scope="col">Category</th>
                                        <th scope="col" className="menswear-categories-overview-metric">
                                          No. in stock
                                        </th>
                                        <th scope="col" className="menswear-categories-overview-metric">
                                          Sold
                                        </th>
                                        <th
                                          scope="col"
                                          className="menswear-categories-overview-metric"
                                          title="Sold ÷ (sold + no. in stock)"
                                        >
                                          Sell rate
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {clothingTypeDetailWorstRows.map((row, idx) => {
                                        const sold = row.sold_count;
                                        const sellRateLabel = formatAvoidStockSellRateLabel(
                                          row.unsold_count,
                                          sold
                                        );
                                        return (
                                          <tr
                                            key={`ct-worst-${row.brand_id}-${row.category_id ?? 'u'}-${idx}`}
                                            className="menswear-categories-buy-more-stock-row-link"
                                            role="button"
                                            tabIndex={0}
                                            onClick={() =>
                                              setClothingTypeStockDrilldown({
                                                kind: 'avoid',
                                                brandId: row.brand_id,
                                                categoryId: row.category_id,
                                                brandName: row.brand_name,
                                                categoryName: row.category_name,
                                              })
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                setClothingTypeStockDrilldown({
                                                  kind: 'avoid',
                                                  brandId: row.brand_id,
                                                  categoryId: row.category_id,
                                                  brandName: row.brand_name,
                                                  categoryName: row.category_name,
                                                });
                                              }
                                            }}
                                            aria-label={`View unsold: ${row.brand_name}, ${row.category_name}`}
                                          >
                                            <td>{row.brand_name}</td>
                                            <td>{row.category_name}</td>
                                            <td className="menswear-categories-overview-metric">
                                              {row.unsold_count}
                                            </td>
                                            <td className="menswear-categories-overview-metric">{sold}</td>
                                            <td className="menswear-categories-overview-metric">
                                              {sellRateLabel}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                          </div>
                          <div className="menswear-categories-overview-block">
                            <h4 className="menswear-categories-overview-heading">
                              Sold and in stock by size
                            </h4>
                            {clothingTypeSizeSoldStockError && (
                              <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                                {clothingTypeSizeSoldStockError}
                              </div>
                            )}
                            {clothingTypeSizeSoldStockLoading && (
                              <p className="menswear-categories-muted">Loading…</p>
                            )}
                            {!clothingTypeSizeSoldStockLoading &&
                              !clothingTypeSizeSoldStockError &&
                              (clothingTypeSizeSoldStock.length === 0 ? (
                                <p className="menswear-categories-muted">
                                  No stock lines in this category yet.
                                </p>
                              ) : (
                                <div className="menswear-categories-overview-table-wrap">
                                  <table className="menswear-categories-overview-table">
                                    <thead>
                                      <tr>
                                        <th scope="col">Size</th>
                                        <th scope="col" className="menswear-categories-overview-metric">
                                          Sold
                                        </th>
                                        <th scope="col" className="menswear-categories-overview-metric">
                                          In stock
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {clothingTypeSizeSoldStock.map((row) => (
                                        <tr key={row.category_size_id ?? `no-size-${row.size_label}`}>
                                          <td>{row.size_label}</td>
                                          <td className="menswear-categories-overview-metric">
                                            {row.sold_count}
                                          </td>
                                          <td className="menswear-categories-overview-metric">
                                            {row.in_stock_count}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {!clothingTypeDetailLoading && clothingTypeDetailSummary ? (
                    <section
                      className="clothing-type-detail-items-section"
                      aria-label={`${selectedClothingTypeLabel} in stock`}
                    >
                      <h3 className="clothing-type-detail-items-heading">
                        {selectedClothingTypeLabel} in stock
                      </h3>
                      <hr className="clothing-type-detail-heading-rule" aria-hidden />
                      {clothingTypeDetailStockRows.length === 0 ? (
                        <p className="menswear-categories-muted">No items in this category yet.</p>
                      ) : (
                        <div className="clothing-type-detail-items-table-wrap">
                          <table className="menswear-categories-avoid-drilldown-table clothing-type-detail-items-table">
                            <thead>
                              <tr>
                                <th scope="col">Item</th>
                                <th scope="col">Brand</th>
                                <th scope="col" className="menswear-categories-avoid-drilldown-num">
                                  Purchase
                                </th>
                                <th scope="col" className="menswear-categories-avoid-drilldown-date">
                                  Purchased
                                </th>
                                <th scope="col" className="menswear-categories-avoid-drilldown-num">
                                  Sale
                                </th>
                                <th scope="col" className="menswear-categories-avoid-drilldown-date">
                                  Sold
                                </th>
                                <th scope="col">Listings</th>
                              </tr>
                            </thead>
                            <tbody>
                              {clothingTypeDetailStockRows.map((item) => {
                                const purchaseNum =
                                  item.purchase_price != null && item.purchase_price !== ''
                                    ? typeof item.purchase_price === 'number'
                                      ? item.purchase_price
                                      : parseFloat(String(item.purchase_price))
                                    : NaN;
                                const saleNum =
                                  item.sale_price != null && item.sale_price !== ''
                                    ? typeof item.sale_price === 'number'
                                      ? item.sale_price
                                      : parseFloat(String(item.sale_price))
                                    : NaN;
                                const title =
                                  item.item_name && item.item_name.trim().length > 0
                                    ? item.item_name.trim()
                                    : '—';
                                const hasVinted = Boolean(item.vinted_id);
                                const hasEbay = Boolean(item.ebay_id);
                                return (
                                  <tr key={item.id}>
                                    <td className="menswear-categories-avoid-drilldown-item">
                                      <Link
                                        to={`/stock?editId=${encodeURIComponent(String(item.id))}`}
                                        className="menswear-categories-avoid-drilldown-item-link"
                                      >
                                        {title}
                                      </Link>
                                    </td>
                                    <td>
                                      <a
                                        className="clothing-type-detail-brand-filter-link"
                                        href={clothingTypesBrandDetailHref(
                                          clothingTypeBrandUrlKey,
                                          item.brand_id,
                                          clothingTypesListDepartmentIdForApi
                                        )}
                                      >
                                        {item.brand_name || '—'}
                                      </a>
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-num">
                                      {Number.isFinite(purchaseNum)
                                        ? formatResearchCurrency(purchaseNum)
                                        : '—'}
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-date">
                                      {formatResearchShortDate(item.purchase_date)}
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-num">
                                      {Number.isFinite(saleNum) ? formatResearchCurrency(saleNum) : '—'}
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-date">
                                      {formatResearchShortDate(item.sale_date)}
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-links">
                                      {hasVinted ? (
                                        <a
                                          href={researchVintedItemUrl(item.vinted_id!)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="menswear-categories-avoid-drilldown-platform-link"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          Vinted
                                        </a>
                                      ) : null}
                                      {hasVinted && hasEbay ? (
                                        <span
                                          className="menswear-categories-avoid-drilldown-link-sep"
                                          aria-hidden
                                        >
                                          {' '}
                                        </span>
                                      ) : null}
                                      {hasEbay ? (
                                        <a
                                          href={researchEbayItemUrl(item.ebay_id!)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="menswear-categories-avoid-drilldown-platform-link"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          eBay
                                        </a>
                                      ) : null}
                                      {!hasVinted && !hasEbay ? (
                                        <span className="menswear-categories-muted">—</span>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  ) : null}
                </>
              )}

            {clothingTypeSelection &&
              !clothingTypesListLoading &&
              !clothingTypesListError &&
              (clothingTypeSelection.mode === 'uncategorized' ||
                clothingTypesListRows.some((r) => r.id === clothingTypeSelection.id)) &&
              clothingTypeBrandIdFromUrl != null && (
                <div
                  className="menswear-categories-brand-stock-lines"
                  role="region"
                  aria-label="Stock lines for selected brand"
                >
                  <div className="menswear-categories-brand-stock-lines-heading-row">
                    <div className="menswear-categories-brand-stock-lines-heading-row-start">
                      <button
                        type="button"
                        className="menswear-categories-avoid-drilldown-back"
                        onClick={closeClothingTypeBrandInUrl}
                      >
                        ← Back to brands
                      </button>
                    </div>
                    <h2 className="menswear-categories-brand-stock-lines-title">
                      {clothingTypeBrandStockLinesBrandName ||
                        clothingTypeBrands.find((b) => b.id === clothingTypeBrandIdFromUrl)?.brand_name ||
                        'Brand'}
                    </h2>
                    <div className="menswear-categories-brand-stock-lines-heading-row-end">
                      <div className="menswear-categories-brand-stock-lines-filter">
                        <select
                          id="clothing-type-brand-stock-lines-category-filter"
                          className="menswear-categories-brand-stock-lines-filter-select"
                          value={clothingTypeBrandStockLinesCategoryFilter}
                          onChange={(e) => setClothingTypeBrandStockLinesCategoryFilter(e.target.value)}
                          aria-label="Filter table rows by category"
                        >
                          {clothingTypeBrandStockLinesCategoryFilterOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                  <div
                    className="menswear-categories-brand-stock-lines-sales-panel"
                    aria-label="Sales data for this brand"
                  >
                    {clothingTypeBrandInventoryStockSummaryLoading && (
                      <p className="menswear-categories-muted">Loading sales data…</p>
                    )}
                    {clothingTypeBrandInventoryStockSummaryError && (
                      <div className="menswear-categories-error menswear-categories-error--inline" role="alert">
                        {clothingTypeBrandInventoryStockSummaryError}
                      </div>
                    )}
                    {!clothingTypeBrandInventoryStockSummaryLoading &&
                      !clothingTypeBrandInventoryStockSummaryError &&
                      clothingTypeBrandInventoryStockSummary && (
                        <BrandStockSpendSoldNetTotals
                          summary={clothingTypeBrandInventoryStockSummary}
                          extendedMetrics
                        />
                      )}
                  </div>
                  {clothingTypeBrandStockLinesLoading ? (
                    <p className="menswear-categories-muted">Loading items…</p>
                  ) : clothingTypeBrandStockLinesError ? (
                    <p className="menswear-categories-muted" role="alert">
                      {clothingTypeBrandStockLinesError}
                    </p>
                  ) : clothingTypeBrandStockLines.length === 0 ? (
                    <p className="menswear-categories-muted">No stock lines for this brand in this category.</p>
                  ) : (
                    <>
                      {clothingTypeBrandStockLinesFilteredRows.length === 0 ? (
                        <p className="menswear-categories-muted" role="status">
                          No rows match this category filter.
                        </p>
                      ) : (
                        <div className="menswear-categories-brand-stock-lines-table-wrap">
                          <table className="menswear-categories-avoid-drilldown-table">
                            <thead>
                              <tr>
                                <th scope="col">Item</th>
                                <th scope="col">Category</th>
                                <th scope="col" className="menswear-categories-avoid-drilldown-num">
                                  Price paid
                                </th>
                                <th scope="col" className="menswear-categories-avoid-drilldown-date">
                                  Purchased
                                </th>
                                <th scope="col" className="menswear-categories-brand-stock-lines-status-col">
                                  Status
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {clothingTypeBrandStockLinesFilteredRows.map((row) => {
                                const title =
                                  row.item_name && String(row.item_name).trim() !== ''
                                    ? String(row.item_name).trim()
                                    : '—';
                                const priceNum =
                                  row.purchase_price !== null && row.purchase_price !== undefined
                                    ? Number(row.purchase_price)
                                    : NaN;
                                const inStock =
                                  row.sale_date == null || String(row.sale_date).trim() === '';
                                return (
                                  <tr key={row.id}>
                                    <td className="menswear-categories-avoid-drilldown-item">
                                      <Link
                                        to={`/stock?editId=${encodeURIComponent(String(row.id))}`}
                                        className="menswear-categories-avoid-drilldown-item-link"
                                      >
                                        {title}
                                      </Link>
                                    </td>
                                    <td>{row.category_name ?? '—'}</td>
                                    <td className="menswear-categories-avoid-drilldown-num">
                                      {Number.isFinite(priceNum) ? formatResearchCurrency(priceNum) : '—'}
                                    </td>
                                    <td className="menswear-categories-avoid-drilldown-date">
                                      {formatResearchShortDate(row.purchase_date)}
                                    </td>
                                    <td
                                      className={
                                        'menswear-categories-brand-stock-lines-status-col' +
                                        (inStock
                                          ? ' menswear-categories-brand-stock-lines-status-col--instock'
                                          : ' menswear-categories-brand-stock-lines-status-col--sold')
                                      }
                                    >
                                      {inStock ? 'In stock' : 'Sold'}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                  <div className="menswear-categories-brand-stock-lines-research-below">
                    <Link
                      to={`/research?brand=${encodeURIComponent(String(clothingTypeBrandIdFromUrl))}`}
                      className="menswear-categories-brand-stock-lines-research-link-below"
                      aria-label="Open full brand research"
                    >
                      Research{' '}
                      {(
                        clothingTypeBrandStockLinesBrandName ||
                        clothingTypeBrands.find((b) => b.id === clothingTypeBrandIdFromUrl)?.brand_name ||
                        'brand'
                      ).trim() || 'brand'}
                    </Link>
                  </div>
                </div>
              )}
          </div>
        </div>
      )}

      {researchTab === 'sourced' && (
        <div
          id="research-panel-sourced"
          role="tabpanel"
          aria-labelledby="research-tab-sourced"
          className="research-tab-panel"
        >
          <div className="research-sourced-page">
            {sourcedInsightsLoading && (
              <p className="menswear-categories-muted">Loading sourced data…</p>
            )}
            {sourcedInsightsError && (
              <div className="menswear-categories-error" role="alert">
                {sourcedInsightsError}
              </div>
            )}
            {!sourcedInsightsLoading && !sourcedInsightsError && sourcedInsights && (
              <>
                {sourcedInsights.emptyMessage ? (
                  <div className="research-seasonal-banner" role="status">
                    {sourcedInsights.emptyMessage}
                  </div>
                ) : null}
                <div className="research-sourced-grid">
                  {sourcedInsights.columns.map((col) => (
                    <section
                      key={col.sourceKey}
                      className="research-sourced-col"
                      aria-label={col.displayLabel}
                    >
                      <div className="research-sourced-col-head">
                        <div
                          className={`research-sourced-icon-wrap research-sourced-icon-wrap--${col.sourceKey}`}
                        >
                          <SourcedLocationInsightIcon sourceKey={col.sourceKey} />
                        </div>
                        <h3 className="research-seasonal-col-title">{col.displayLabel}</h3>
                        <dl className="research-sourced-metrics">
                          <div className="research-sourced-metric">
                            <dt>Items sold</dt>
                            <dd>{col.soldCount}</dd>
                          </div>
                          <div className="research-sourced-metric">
                            <dt>In inventory</dt>
                            <dd>{col.inventoryCount}</dd>
                          </div>
                          <div className="research-sourced-metric">
                            <dt>Sell-through</dt>
                            <dd>
                              {formatAvoidStockSellRateLabel(col.inventoryCount, col.soldCount)}
                            </dd>
                          </div>
                          <div className="research-sourced-metric">
                            <dt>Profit multiple</dt>
                            <dd title="Σ sale price ÷ Σ purchase price on sold lines with purchase price > 0">
                              {col.profitMultiple != null && Number.isFinite(col.profitMultiple)
                                ? formatSoldMultipleDisplay(col.profitMultiple)
                                : '—'}
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <div className="research-seasonal-block research-sourced-block--top-categories">
                        <h4 className="research-seasonal-block-title">Top 5 categories (sales)</h4>
                        {col.hasSalesData && col.topCategories.length > 0 ? (
                          <ol className="research-seasonal-list">
                            {col.topCategories.map((row) => (
                              <li key={row.name} className="research-seasonal-list-item">
                                <span className="research-seasonal-list-name">{row.name}</span>
                                <span className="research-seasonal-list-count">{row.count}</span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="research-seasonal-empty" role="status">
                            No sales for this source yet.
                          </p>
                        )}
                      </div>
                      <div className="research-seasonal-block research-sourced-block--worst-categories">
                        <h4 className="research-seasonal-block-title">5 worst categories</h4>
                        <p className="research-sourced-worst-hint">
                          By category: lowest aggregate sale ÷ cost on sold lines (only lines with
                          purchase recorded), then highest total purchase value still in stock.
                        </p>
                        {col.worstCategories.length > 0 ? (
                          <ol className="research-sourced-worst-list">
                            {col.worstCategories.map((wc, i) => (
                              <li
                                key={`${col.sourceKey}-worst-cat-${i}-${wc.name}`}
                                className="research-sourced-worst-item"
                              >
                                <span className="research-sourced-worst-name">{wc.name}</span>
                                <span className="research-sourced-worst-meta">
                                  {wc.soldCount} sold · {wc.inventoryCount} in stock · sell-through{' '}
                                  {formatAvoidStockSellRateLabel(wc.inventoryCount, wc.soldCount)}
                                  {wc.profitMultiple != null && Number.isFinite(wc.profitMultiple)
                                    ? ` · ${formatSoldMultipleDisplay(wc.profitMultiple)} (sold)`
                                    : wc.soldCount > 0
                                      ? ' · multiple — (sold)'
                                      : ''}
                                </span>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="research-seasonal-empty" role="status">
                            No categories for this source.
                          </p>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {researchTab === 'seasonal' && (
        <div
          id="research-panel-seasonal"
          role="tabpanel"
          aria-labelledby="research-tab-seasonal"
          className="research-tab-panel"
        >
          <div className="research-seasonal-page">
            {seasonalInsightsLoading && (
              <p className="menswear-categories-muted">Loading sales by season…</p>
            )}
            {seasonalInsightsError && (
              <div className="menswear-categories-error" role="alert">
                {seasonalInsightsError}
              </div>
            )}
            {!seasonalInsightsLoading && !seasonalInsightsError && seasonalInsights && (
              <>
                {seasonalInsights.emptyMessage ? (
                  <div className="research-seasonal-banner" role="status">
                    {seasonalInsights.emptyMessage}
                  </div>
                ) : null}
                {(() => {
                  const t = new Date();
                  const cy = t.getFullYear();
                  const cm = t.getMonth() + 1;
                  return (
                    <div className="research-seasonal-grid">
                      {seasonalInsights.columns.map((col) => {
                        const monthCells = buildMeteorologicalSeasonMonthCells(
                          col.seasonKey,
                          col.refYear
                        );
                        return (
                          <section
                            key={`${col.seasonKey}-${col.refYear}`}
                            className={
                              'research-seasonal-col' +
                              (col.isCurrentSeason ? ' research-seasonal-col--current' : '')
                            }
                            aria-label={`${col.displayLabel}${col.isCurrentSeason ? ', current season' : ''}`}
                          >
                            <div className="research-seasonal-col-head">
                              <div
                                className="research-seasonal-badge-slot"
                                aria-hidden={!col.isCurrentSeason}
                              >
                                {col.isCurrentSeason ? (
                                  <span className="research-seasonal-badge">Current season</span>
                                ) : null}
                              </div>
                              <div
                                className={`research-seasonal-season-icon-wrap research-seasonal-season-icon-wrap--${col.seasonKey}`}
                              >
                                <SeasonalInsightSeasonIcon seasonKey={col.seasonKey} />
                              </div>
                              <h3 className="research-seasonal-col-title">{col.displayLabel}</h3>
                              <p className="research-seasonal-col-range">
                                {formatResearchShortDate(col.rangeStart)} —{' '}
                                {formatResearchShortDate(col.rangeEnd)}
                              </p>
                              <div className="research-seasonal-months" aria-label="Months in this season">
                                {monthCells.map((cell) => {
                                  const isCurrentMonth = cy === cell.year && cm === cell.month;
                                  return (
                                    <span
                                      key={`${cell.year}-${cell.month}`}
                                      className={
                                        'research-seasonal-month-pill' +
                                        (isCurrentMonth ? ' research-seasonal-month-pill--current' : '')
                                      }
                                    >
                                      {cell.label}
                                      {cell.year !== cy ? ` ’${String(cell.year).slice(-2)}` : ''}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                            <div className="research-seasonal-block">
                              <h4 className="research-seasonal-block-title">Top categories</h4>
                              {col.hasSalesData && col.topCategories.length > 0 ? (
                                <ol className="research-seasonal-list">
                                  {col.topCategories.map((row) => (
                                    <li key={row.name} className="research-seasonal-list-item">
                                      <span className="research-seasonal-list-name">{row.name}</span>
                                      <span className="research-seasonal-list-count">{row.count}</span>
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <p className="research-seasonal-empty" role="status">
                                  No sales in this season in your data yet.
                                </p>
                              )}
                            </div>
                            <div className="research-seasonal-block">
                              <h4 className="research-seasonal-block-title">Worst categories</h4>
                              {col.hasSalesData && col.worstCategories.length > 0 ? (
                                <ol className="research-seasonal-list">
                                  {col.worstCategories.map((row) => (
                                    <li key={`worst-${row.name}`} className="research-seasonal-list-item">
                                      <span className="research-seasonal-list-name">{row.name}</span>
                                      <span className="research-seasonal-list-count research-seasonal-list-count--worst">
                                        {row.count}
                                      </span>
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <p className="research-seasonal-empty" role="status">
                                  No sales in this season in your data yet.
                                </p>
                              )}
                            </div>
                            <div className="research-seasonal-block">
                              <h4 className="research-seasonal-block-title">Top brands</h4>
                              {col.hasSalesData && col.topBrands.length > 0 ? (
                                <ol className="research-seasonal-list">
                                  {col.topBrands.map((row) => (
                                    <li key={row.name} className="research-seasonal-list-item">
                                      <span className="research-seasonal-list-name">{row.name}</span>
                                      <span className="research-seasonal-list-count">{row.count}</span>
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <p className="research-seasonal-empty" role="status">
                                  No sales in this season in your data yet.
                                </p>
                              )}
                            </div>
                            {col.hasSalesData ? (
                              <p className="research-seasonal-foot">
                                {col.saleCount} sold line{col.saleCount === 1 ? '' : 's'} in window
                              </p>
                            ) : null}
                          </section>
                        );
                      })}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Research;


