import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../utils/apiBase';
import './Planner.css';

const API_BASE = getApiBase();

/** Same default as Pricing / stock prediction — eBay UK final value fee only (no promoted listing). */
const DEFAULT_EBAY_FEE_PERCENT = 10;
const DEFAULT_EBAY_STORE_FEE_MONTHLY = 27;

const STORAGE_KEY = 'planner.inputs.v5';

const DEFAULT_LISTINGS_PER_DAY = 10;
const DEFAULT_LISTING_DAYS_PER_WEEK = 5;
const DEFAULT_TARGET_INCOME = 100000;
const DEFAULT_BOOT_SALE_VISITS_PER_WEEK = 3;
/** Apr–Oct boot sale season (~7 months). */
const BOOT_SALE_SEASON_WEEKS = 30;

type PlannerInputs = {
  targetIncome: string;
  ebayFeePercent: string;
  ebayStoreFeeMonthly: string;
  bootSaleVisitsPerWeek: string;
  listingsPerDay: string;
  listingDaysPerWeek: string;
};

type SourcedColumn = {
  sourceKey: string;
  displayLabel: string;
  profitMultiple: number | null;
  soldCount: number;
};

type ReportingSnapshot = {
  allTimeAverageProfitMultiple: number | null;
  averageSellingPrice: number | null;
  averageProfitPerItem: number | null;
  soldCount: number;
  sellThroughPercent: number | null;
};

type ResultsTab = 'sourcing' | 'monthly';

type TrailingMonth = {
  year: number;
  month: number;
  label: string;
  itemsSold: number;
  totalSales: number;
  totalPurchases: number;
  grossProfit: number;
};

type Trailing12m = {
  periodFrom: string;
  periodTo: string;
  itemsSold: number;
  totalSales: number;
  totalPurchases: number;
  grossProfit: number;
  profitMultiple: number | null;
  months: TrailingMonth[];
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const formatCurrencyPrecise = (value: number) =>
  new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

function normalizeStoredIncome(value: string | undefined): string {
  if (value != null && value.trim() !== '') return value;
  return String(DEFAULT_TARGET_INCOME);
}

/** Keep only digits and clamp to min/max — used for text inputs that must hold whole numbers. */
function clampIntInput(raw: string, min: number, max: number): string {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return '';
  const n = Math.min(max, Math.max(min, parseInt(digits, 10)));
  return String(n);
}

function parseMonthlyStoreFee(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function migrateBootSaleVisitsPerWeek(
  parsed: Partial<PlannerInputs & { bootSaleVisits?: string }>
): string {
  if (parsed.bootSaleVisitsPerWeek != null && parsed.bootSaleVisitsPerWeek.trim() !== '') {
    return parsed.bootSaleVisitsPerWeek;
  }
  const legacyAnnual = parseInt(parsed.bootSaleVisits ?? '', 10);
  if (Number.isFinite(legacyAnnual) && legacyAnnual > 0) {
    return String(Math.max(1, Math.round(legacyAnnual / BOOT_SALE_SEASON_WEEKS)));
  }
  return String(DEFAULT_BOOT_SALE_VISITS_PER_WEEK);
}

function normalizeStoredStoreFee(value: string | undefined): string {
  if (value != null && value.trim() !== '') return value;
  return String(DEFAULT_EBAY_STORE_FEE_MONTHLY);
}

function loadStoredInputs(): PlannerInputs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        targetIncome: String(DEFAULT_TARGET_INCOME),
        ebayFeePercent: String(DEFAULT_EBAY_FEE_PERCENT),
        ebayStoreFeeMonthly: String(DEFAULT_EBAY_STORE_FEE_MONTHLY),
        bootSaleVisitsPerWeek: String(DEFAULT_BOOT_SALE_VISITS_PER_WEEK),
        listingsPerDay: String(DEFAULT_LISTINGS_PER_DAY),
        listingDaysPerWeek: String(DEFAULT_LISTING_DAYS_PER_WEEK),
      };
    }
    const parsed = JSON.parse(raw) as Partial<PlannerInputs>;
    return {
      targetIncome: normalizeStoredIncome(parsed.targetIncome),
      ebayFeePercent: parsed.ebayFeePercent ?? String(DEFAULT_EBAY_FEE_PERCENT),
      ebayStoreFeeMonthly: normalizeStoredStoreFee(parsed.ebayStoreFeeMonthly),
      bootSaleVisitsPerWeek: migrateBootSaleVisitsPerWeek(parsed),
      listingsPerDay: parsed.listingsPerDay ?? String(DEFAULT_LISTINGS_PER_DAY),
      listingDaysPerWeek: parsed.listingDaysPerWeek ?? String(DEFAULT_LISTING_DAYS_PER_WEEK),
    };
  } catch {
    return {
      targetIncome: String(DEFAULT_TARGET_INCOME),
      ebayFeePercent: String(DEFAULT_EBAY_FEE_PERCENT),
      ebayStoreFeeMonthly: String(DEFAULT_EBAY_STORE_FEE_MONTHLY),
      bootSaleVisitsPerWeek: String(DEFAULT_BOOT_SALE_VISITS_PER_WEEK),
      listingsPerDay: String(DEFAULT_LISTINGS_PER_DAY),
      listingDaysPerWeek: String(DEFAULT_LISTING_DAYS_PER_WEEK),
    };
  }
}

/**
 * Net profit on one sold line after eBay fees, from average buy price and the
 * sale÷cost multiple on sold lines (same definition as Reporting).
 */
function netProfitPerItem(avgPurchase: number, profitMultiple: number, ebayFeePercent: number): number {
  const avgSale = avgPurchase * profitMultiple;
  const ebayFees = avgSale * (ebayFeePercent / 100);
  return avgSale - avgPurchase - ebayFees;
}

function netAfterEbayFees(grossProfit: number, totalSales: number, ebayFeePercent: number): number {
  return grossProfit - totalSales * (ebayFeePercent / 100);
}

/** Net take-home after eBay FVF and fixed monthly store subscription. */
function netAfterAllFees(
  grossProfit: number,
  totalSales: number,
  ebayFeePercent: number,
  annualStoreFee: number
): number {
  return netAfterEbayFees(grossProfit, totalSales, ebayFeePercent) - annualStoreFee;
}

const formatPeriodDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso + 'T12:00:00')
  );

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

type TheoryTrailing = {
  itemsSold: number;
  itemsNeeded: number;
  onTrack: boolean;
  yearsLabel: string | null;
};

type ComparisonSnapshot = {
  ebayFee: number;
  actualNet: number;
  actualNetPerItem: number | null;
  incomeDelta: number;
  itemsDelta: number;
  incomeAhead: boolean;
  itemsAhead: boolean;
  incomeShort: number;
  itemsShort: number;
  incomeSurplus: number;
  itemsSurplus: number;
};

function line(label: string, value: string): string {
  return `- ${label}: ${value}`;
}

function buildPlannerAskAiPrompt(args: {
  inputs: PlannerInputs;
  plan: Record<string, unknown>;
  reporting: ReportingSnapshot | null;
  trailing12m: Trailing12m | null;
  comparison: ComparisonSnapshot | null;
  theoryTrailing: TheoryTrailing | null;
  sourced: SourcedColumn[];
}): string {
  const { inputs, plan, reporting, trailing12m, comparison, theoryTrailing, sourced } = args;
  const p = plan as {
    unprofitable?: boolean;
    target: number;
    ebayFee: number;
    monthlyStoreFee: number;
    annualStoreFee: number;
    grossProfitTarget: number;
    visits: number | null;
    bootSaleVisitsPerWeek: number | null;
    bootSaleSeasonWeeks: number;
    planningMultiple: number;
    multipleSource: string;
    avgPurchase: number;
    avgSale: number;
    netPerItem: number;
    itemsNeeded: number | null;
    itemsPerVisit: number | null;
    purchaseSpend: number | null;
    grossSales: number | null;
    listingsPerDay: number;
    listingDaysPerWeek: number;
    listingsPerWeek: number;
    listingsPerYear: number;
    sellThroughDecimal: number;
    itemsToListForTarget: number;
    maxSalesAtPace: number;
    incomeAtCurrentPace: number;
    incomeGapAtPace: number;
    targetAchievableAtPace: boolean;
    requiredNetPerItemAtPace: number | null;
    requiredAvgSaleAtPace: number | null;
    requiredMultipleAtPace: number | null;
    purchaseSpendPerWeek: number;
    itemsToListPerWeekNeeded: number;
    listingPaceShortfall: number;
    altSellThroughPercent: number;
    itemsToListAtAltStr: number;
    listingsSavedAtAltStr: number;
    sellThroughScenarioActive: boolean;
    sourcePerBootSale: number | null;
  };

  const sections: string[] = [
    `I'm a UK eBay clothing reseller. Boot sales Apr–Oct, charity shops Nov–Mar.`,
    ``,
    `I'm trying to hit an annual net income target but I'm not on track. I don't think I can source enough inventory if I continue doing the same thing.`,
    ``,
    `Please review my planner data below and give practical, specific advice on what I should change — sourcing channels, what to buy, pricing, listing pace, sell-through, or whether the target needs adjusting.`,
    ``,
    `## My targets & listing plan`,
    line('Target net income (after eBay fees & store)', formatCurrency(p.target)),
    line('eBay final value fee assumption', `${p.ebayFee}%`),
    line(
      'eBay store fee',
      `${formatCurrencyPrecise(p.monthlyStoreFee)}/month (${formatCurrency(p.annualStoreFee)}/yr)`
    ),
    line('Trading profit needed (target + store fee)', formatCurrency(p.grossProfitTarget)),
    line(
      'Boot sale visits per week (Apr–Oct)',
      p.bootSaleVisitsPerWeek != null
        ? `${p.bootSaleVisitsPerWeek}/week ≈ ${p.visits} visits in season (${p.bootSaleSeasonWeeks} weeks)`
        : inputs.bootSaleVisitsPerWeek.trim() || 'not set'
    ),
    line(
      'Listing pace',
      `${p.listingsPerDay} items/day × ${p.listingDaysPerWeek} days/week = ${p.listingsPerWeek}/week (${p.listingsPerYear.toLocaleString()}/yr)`
    ),
    ``,
    `## Historical averages (${p.multipleSource} multiple)`,
    line('Profit multiple used for planning', `${p.planningMultiple.toFixed(2)}×`),
    line('Average sale price', formatCurrencyPrecise(p.avgSale)),
    line('Average buy price', formatCurrencyPrecise(p.avgPurchase)),
    line('Net profit per item (after eBay fees)', formatCurrencyPrecise(p.netPerItem)),
  ];

  if (reporting) {
    sections.push(
      line('All-time sold count', reporting.soldCount.toLocaleString()),
      line(
        'All-time average profit multiple',
        reporting.allTimeAverageProfitMultiple != null
          ? `${reporting.allTimeAverageProfitMultiple.toFixed(2)}×`
          : 'n/a'
      ),
      line(
        'Sell-through rate',
        reporting.sellThroughPercent != null ? `${reporting.sellThroughPercent.toFixed(1)}%` : 'n/a'
      )
    );
  }

  if (trailing12m) {
    sections.push(
      ``,
      `## Last 12 months actual (${formatPeriodDate(trailing12m.periodFrom)} – ${formatPeriodDate(trailing12m.periodTo)})`,
      line('Items sold', trailing12m.itemsSold.toLocaleString()),
      line('Gross sales', formatCurrency(trailing12m.totalSales)),
      line('Purchase spend', formatCurrency(trailing12m.totalPurchases)),
      line('Gross profit', formatCurrency(trailing12m.grossProfit)),
      comparison
        ? line(
            'Net after eBay fees & store',
            formatCurrency(comparison.actualNet)
          )
        : ''
    );

    if (trailing12m.months.length > 0) {
      sections.push('', '### Month by month');
      for (const m of trailing12m.months) {
        sections.push(
          `- ${m.label}: ${m.itemsSold} sold, ${formatCurrencyPrecise(m.totalSales)} sales, ${formatCurrencyPrecise(m.totalPurchases)} spend, ${formatCurrencyPrecise(m.grossProfit)} profit`
        );
      }
    }
  }

  if (comparison && p.itemsNeeded != null) {
    sections.push(
      ``,
      `## Gap vs annual target (trailing 12 months)`,
      line(
        'Net income',
        `${formatCurrency(comparison.actualNet)} / ${formatCurrency(p.target)} (${comparison.incomeAhead ? `ahead by ${formatCurrency(comparison.incomeSurplus)}` : `short by ${formatCurrency(comparison.incomeShort)}`})`
      ),
      line(
        'Items sold',
        `${trailing12m!.itemsSold.toLocaleString()} / ${p.itemsNeeded.toLocaleString()} needed (${comparison.itemsAhead ? `ahead by ${comparison.itemsSurplus.toLocaleString()}` : `short by ${comparison.itemsShort.toLocaleString()} items`})`
      )
    );
  }

  if (!p.unprofitable && p.itemsNeeded != null) {
    sections.push(
      ``,
      `## What I need to sell (top-level plan)`,
      line('Items to sell this year', p.itemsNeeded.toLocaleString()),
      line('Purchase spend needed', formatCurrency(p.purchaseSpend!)),
      line('Gross sales needed', formatCurrency(p.grossSales!)),
      line('Monthly pace', `${Math.ceil(p.itemsNeeded / 12).toLocaleString()} items (~${formatCurrency(p.target / 12)}/month net)`),
      ``,
      `## Current years projected profit (my actual listing pace)`,
      line('Max sales at my pace', `${p.maxSalesAtPace.toLocaleString()}/yr`),
      line(
        'Sell-through assumption',
        `${(p.sellThroughDecimal * 100).toFixed(0)}% (${p.listingsPerYear.toLocaleString()} listed/yr)`
      ),
      line('Income at today\'s margin', formatCurrency(p.incomeAtCurrentPace)),
      p.annualStoreFee > 0
        ? line('eBay store fee deducted', formatCurrency(p.annualStoreFee))
        : '',
      line(
        'Gap to target',
        p.targetAchievableAtPace
          ? 'On track at today\'s margin'
          : `${formatCurrency(p.incomeGapAtPace)} short of ${formatCurrency(p.target)}`
      ),
      line('Source spend per week', formatCurrency(p.purchaseSpendPerWeek)),
      line('Annual source spend (theoretical full target)', formatCurrency(p.purchaseSpend!))
    );

    if (p.requiredNetPerItemAtPace != null) {
      sections.push(
        line('Net profit needed per item (at my pace)', formatCurrencyPrecise(p.requiredNetPerItemAtPace)),
        p.requiredAvgSaleAtPace != null
          ? line('Avg sale price needed', formatCurrencyPrecise(p.requiredAvgSaleAtPace))
          : '',
        p.requiredMultipleAtPace != null
          ? line('Profit multiple needed', `${p.requiredMultipleAtPace.toFixed(2)}× (today ${p.planningMultiple.toFixed(2)}×)`)
          : ''
      );
    }

    if (theoryTrailing) {
      sections.push(
        line(
          'Trailing pace vs target',
          `${theoryTrailing.itemsSold.toLocaleString()} vs ${theoryTrailing.itemsNeeded.toLocaleString()} sold/yr needed${theoryTrailing.onTrack ? ' (on track)' : ` — ${theoryTrailing.yearsLabel}`}`
        )
      );
    }

    sections.push(
      ``,
      `## In theory plan (unlimited listing, same margin)`,
      line('Items to list incl. unsold', `${p.itemsToListForTarget.toLocaleString()}/yr`),
      line('Items to sell', p.itemsNeeded.toLocaleString()),
      p.sourcePerBootSale != null && p.visits != null
        ? line('Items per boot sale', `${p.sourcePerBootSale.toLocaleString()} across ${p.visits} visits`)
        : '',
      ``,
      `## How to close the gap (levers)`,
      line(
        'Listing pace gap',
        `${p.itemsToListPerWeekNeeded}/week needed vs ${p.listingsPerWeek}/week cap (${p.listingPaceShortfall > 0 ? `${p.listingPaceShortfall} above cap` : 'pace covers volume'})`
      )
    );

    if (p.requiredAvgSaleAtPace != null && p.requiredMultipleAtPace != null) {
      sections.push(
        line(
          'Sale price & multiple',
          `${formatCurrencyPrecise(p.avgSale)} → ${formatCurrencyPrecise(p.requiredAvgSaleAtPace)} · ${p.planningMultiple.toFixed(2)}× → ${p.requiredMultipleAtPace.toFixed(2)}× · ${formatCurrencyPrecise(p.netPerItem)} → ${formatCurrencyPrecise(p.requiredNetPerItemAtPace!)} net/item`
        )
      );
    }

    if (p.sellThroughScenarioActive) {
      sections.push(
        line(
          `If sell-through hit ${p.altSellThroughPercent}%`,
          `${p.itemsToListAtAltStr.toLocaleString()} listings/yr (${p.listingsSavedAtAltStr.toLocaleString()} fewer than at ${(p.sellThroughDecimal * 100).toFixed(0)}%)`
        )
      );
    }
  } else if (p.unprofitable) {
    sections.push(
      ``,
      `## Warning`,
      `At ${p.planningMultiple.toFixed(2)}× with ${p.ebayFee}% eBay fees, each item loses money on average at current assumptions.`
    );
  }

  if (sourced.length > 0) {
    sections.push('', '## Sourcing stats by channel');
    for (const col of sourced) {
      if (col.soldCount <= 0) continue;
      sections.push(
        line(
          col.displayLabel,
          col.profitMultiple != null
            ? `${col.profitMultiple.toFixed(2)}× · ${col.soldCount} sold`
            : `${col.soldCount} sold`
        )
      );
    }
  }

  sections.push(
    ``,
    `## What I need from you`,
    `1. Be honest: is £${p.target.toLocaleString()} net realistic with my listing pace and sourcing constraints?`,
    `2. What are the 3–5 highest-leverage changes I should make?`,
    `3. I feel I cannot source enough stock doing what I do now — suggest specific sourcing strategies, channels, or item types for UK boot sales and charity shops.`,
    `4. Should I prioritise higher multiples/margins, more volume, better sell-through, or different inventory?`,
    `5. If the target is still achievable, give me a practical 90-day action plan.`
  );

  return sections.filter((s) => s !== '').join('\n');
}

type PlannerPromptArgs = {
  inputs: PlannerInputs;
  plan: Record<string, unknown>;
  reporting: ReportingSnapshot | null;
  trailing12m: Trailing12m | null;
  comparison: ComparisonSnapshot | null;
  theoryTrailing: TheoryTrailing | null;
  sourced: SourcedColumn[];
};

type PlanSnapshot = {
  unprofitable?: boolean;
  target: number;
  ebayFee: number;
  monthlyStoreFee: number;
  annualStoreFee: number;
  grossProfitTarget: number;
  visits: number | null;
  bootSaleVisitsPerWeek: number | null;
  bootSaleSeasonWeeks: number;
  planningMultiple: number;
  multipleSource: string;
  avgPurchase: number;
  avgSale: number;
  netPerItem: number;
  itemsNeeded: number | null;
  itemsPerVisit: number | null;
  purchaseSpend: number | null;
  listingsPerDay: number;
  listingDaysPerWeek: number;
  listingsPerWeek: number;
  listingsPerYear: number;
  sellThroughDecimal: number;
  sellThroughPercent: number | null;
  itemsToListForTarget: number;
  maxSalesAtPace: number;
  incomeAtCurrentPace: number;
  incomeGapAtPace: number;
  targetAchievableAtPace: boolean;
  requiredNetPerItemAtPace: number | null;
  requiredAvgSaleAtPace: number | null;
  requiredMultipleAtPace: number | null;
  itemsToListPerWeekNeeded: number;
  listingPaceShortfall: number;
  sourcePerBootSale: number | null;
};

function asPlanSnapshot(plan: Record<string, unknown>): PlanSnapshot {
  return plan as PlanSnapshot;
}

function buildPlannerSourcingAskAiPrompt(args: PlannerPromptArgs): string {
  const { inputs, plan, reporting, trailing12m, comparison, theoryTrailing, sourced } = args;
  const p = asPlanSnapshot(plan);

  const sections: string[] = [
    `IMPORTANT — read this first:`,
    `- Treat this as a brand-new request. Do NOT use memory, prior chats, or anything you think you already know about what I sell, brands I like, or categories I have asked about before.`,
    `- Do NOT default to my historical inventory mix. I am actively looking to pivot.`,
    `- Do NOT limit recommendations to clothing, fashion, or garments. I sell (or want to sell) across ANY eBay UK category — electronics, homeware, collectibles, media, tools, toys, sports, etc.`,
    `- Base your recommendations on current eBay UK market trends, what is selling well now, and fresh sourcing ideas — not on continuing what I sell today.`,
    `- Where this prompt includes my past sales stats, use them ONLY for the maths (required ASP, multiple, volume). They are constraints, not a shopping list.`,
    ``,
    `I'm a UK eBay reseller (open to any category). I want to hit ${formatCurrency(p.target)} net income in a year.`,
    `I source from boot sales (Apr–Oct), charity shops (Nov–Mar), and other channels. I don't think I can get there with my current inventory mix.`,
    ``,
    `Research which eBay UK categories and item types I should investigate now — based on current trending demand across the whole marketplace — to have a realistic path to this target.`,
    ``,
    `## Target requirements (${formatCurrency(p.target)} net/yr)`,
    line('Trading profit needed (incl. store fee)', formatCurrency(p.grossProfitTarget)),
    line('Items to sell this year', p.itemsNeeded != null ? p.itemsNeeded.toLocaleString() : 'n/a'),
    line(
      'Items to list (incl. unsold at sell-through)',
      p.itemsToListForTarget.toLocaleString()
    ),
    line('Monthly item pace needed', `${Math.ceil((p.itemsNeeded ?? 0) / 12).toLocaleString()} sold/month`),
  ];

  if (!p.unprofitable && p.itemsNeeded != null) {
    sections.push(
      ``,
      `## Gap at my current listing pace (part-time reality)`,
      line('Listing pace', `${p.listingsPerDay}/day × ${p.listingDaysPerWeek} days = ${p.listingsPerWeek}/week`),
      line('Max sales at my pace', `${p.maxSalesAtPace.toLocaleString()}/yr`),
      line(
        'Sell-through',
        p.sellThroughPercent != null
          ? `${p.sellThroughPercent.toFixed(1)}%`
          : `${(p.sellThroughDecimal * 100).toFixed(0)}% (assumed)`
      ),
      line('Income at today\'s margin (after store fee)', formatCurrency(p.incomeAtCurrentPace)),
      line(
        'Shortfall vs target',
        p.targetAchievableAtPace
          ? 'On track at today\'s margin'
          : formatCurrency(p.incomeGapAtPace)
      )
    );

    if (p.requiredNetPerItemAtPace != null) {
      sections.push(
        line('Net profit needed per sold item', formatCurrencyPrecise(p.requiredNetPerItemAtPace)),
        line('My net profit per item today', formatCurrencyPrecise(p.netPerItem)),
        p.requiredAvgSaleAtPace != null
          ? line('Avg sale price needed', formatCurrencyPrecise(p.requiredAvgSaleAtPace))
          : '',
        line('My avg sale price today', formatCurrencyPrecise(p.avgSale)),
        p.requiredMultipleAtPace != null
          ? line('Profit multiple needed', `${p.requiredMultipleAtPace.toFixed(2)}×`)
          : '',
        line('My profit multiple today', `${p.planningMultiple.toFixed(2)}× (${p.multipleSource})`),
        line('My avg buy price today', formatCurrencyPrecise(p.avgPurchase))
      );
    }

    if (theoryTrailing) {
      sections.push(
        line(
          'Trailing 12m items sold vs needed',
          `${theoryTrailing.itemsSold.toLocaleString()} vs ${theoryTrailing.itemsNeeded.toLocaleString()}/yr${theoryTrailing.onTrack ? '' : ` (${theoryTrailing.yearsLabel})`}`
        )
      );
    }
  }

  sections.push(
    ``,
    `## My sourcing setup`,
    line(
      'Boot sale visits',
      p.bootSaleVisitsPerWeek != null
        ? `${p.bootSaleVisitsPerWeek}/week ≈ ${p.visits} visits Apr–Oct`
        : inputs.bootSaleVisitsPerWeek || 'not set'
    ),
    p.itemsPerVisit != null
      ? line('Items needed per boot sale visit (at today\'s margin)', p.itemsPerVisit.toLocaleString())
      : '',
    p.sourcePerBootSale != null
      ? line('Items to source per boot sale (theory plan)', p.sourcePerBootSale.toLocaleString())
      : '',
    line('Listing pace gap', `${p.itemsToListPerWeekNeeded}/week needed vs ${p.listingsPerWeek}/week cap`)
  );

  if (reporting) {
    sections.push(
      ``,
      `## Historical baseline (maths only — do NOT recommend more of the same)`,
      line('Sold count', reporting.soldCount.toLocaleString()),
      line('Average sale price', formatCurrencyPrecise(p.avgSale)),
      line('Average buy price', formatCurrencyPrecise(p.avgPurchase)),
      line('Net per item (after eBay fees)', formatCurrencyPrecise(p.netPerItem)),
      line(
        'Sell-through rate',
        reporting.sellThroughPercent != null ? `${reporting.sellThroughPercent.toFixed(1)}%` : 'n/a'
      )
    );
  }

  if (sourced.length > 0) {
    sections.push(
      '',
      '## Past sourcing channels (context only — do NOT treat as categories to continue)'
    );
    for (const col of sourced) {
      if (col.soldCount <= 0) continue;
      sections.push(
        line(
          col.displayLabel,
          col.profitMultiple != null
            ? `${col.profitMultiple.toFixed(2)}× avg · ${col.soldCount} sold`
            : `${col.soldCount} sold`
        )
      );
    }
  }

  if (trailing12m && comparison) {
    sections.push(
      ``,
      `## Last 12 months actual`,
      line('Items sold', trailing12m.itemsSold.toLocaleString()),
      line('Net after fees & store', formatCurrency(comparison.actualNet)),
      line('Target', formatCurrency(p.target)),
      line(
        'Gap',
        comparison.incomeAhead
          ? `ahead by ${formatCurrency(comparison.incomeSurplus)}`
          : `short by ${formatCurrency(comparison.incomeShort)}`
      )
    );
  }

  sections.push(
    ``,
    `## What I need you to research (fresh — trending — no memory)`,
    `Paste this into a new chat. Ignore any prior context about my store. Recommend NEW eBay UK categories and item types (any department) based on what is working right now:`,
    ``,
    `1. **What's trending on eBay UK now** — any category with strong sold volume and prices in ${new Date().getFullYear()}, that a part-time sourcer can find at boot sales, charity shops, car boots, auctions, or wholesale.`,
    `2. **eBay UK top-level categories & subcategories to research first** — ranked by fit for my required avg sale price (~${p.requiredAvgSaleAtPace != null ? formatCurrencyPrecise(p.requiredAvgSaleAtPace) : 'higher ASP'}), profit multiple, and sell-through at my listing volume. Include non-clothing categories explicitly.`,
    `3. **Specific items to hunt for** — product types, brands, models, editions, or variants — with example sold-price ranges from recent eBay UK sold comps (not legacy assumptions).`,
    `4. **Max buy price rules** — what to pay when sourcing given my target margin (buy price × multiple − fees = net).`,
    `5. **Where to source each niche** — boot sale vs charity shop vs auction vs wholesale vs other; whether my current channels can feed ${p.itemsNeeded?.toLocaleString() ?? 'enough'} sales/yr.`,
    `6. **Top 10 niches for sold-comps research this week** — each with: eBay category, typical ASP, typical multiple, competition level, trend direction (up/flat/down), and why it fits a part-time UK seller.`,
    `7. **Categories to avoid right now** — low ASP, slow STR, high returns, oversaturated, or impractical to source part-time.`,
    `8. **A sourcing pivot ladder** — realistic steps toward niches that can hit my required ${p.requiredAvgSaleAtPace != null ? formatCurrencyPrecise(p.requiredAvgSaleAtPace) : 'sale price'} and ${p.requiredMultipleAtPace != null ? `${p.requiredMultipleAtPace.toFixed(2)}×` : 'multiple'}.`,
    ``,
    `Be specific to the UK and eBay. Use current/trending market knowledge across all categories. Use the maths above for constraints only — do NOT assume I sell clothing or tell me to buy more of what I already sell.`
  );

  return sections.filter((s) => s !== '').join('\n');
}

const Planner: React.FC = () => {
  const [inputs, setInputs] = useState<PlannerInputs>(loadStoredInputs);
  const [reporting, setReporting] = useState<ReportingSnapshot | null>(null);
  const [trailing12m, setTrailing12m] = useState<Trailing12m | null>(null);
  const [sourced, setSourced] = useState<SourcedColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resultsTab, setResultsTab] = useState<ResultsTab>('sourcing');
  const [askAiBusy, setAskAiBusy] = useState(false);
  const [askAiHint, setAskAiHint] = useState<string | null>(null);
  const [askAiSourcingBusy, setAskAiSourcingBusy] = useState(false);
  const [askAiSourcingHint, setAskAiSourcingHint] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    } catch {
      // Private browsing — inputs just won't persist.
    }
  }, [inputs]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [reportRes, sourcedRes, trailingRes] = await Promise.all([
          fetch(`${API_BASE}/api/analytics/reporting?year=all`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/stock/sourced-insights`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/planner/trailing-12m`, { credentials: 'include' }),
        ]);
        if (!reportRes.ok) throw new Error('Could not load sales averages.');
        if (!sourcedRes.ok) throw new Error('Could not load sourcing stats.');
        if (!trailingRes.ok) throw new Error('Could not load trailing 12-month sales.');

        const reportData = await reportRes.json();
        const sourcedData = await sourcedRes.json();
        const trailingData = await trailingRes.json();
        if (cancelled) return;

        setReporting({
          allTimeAverageProfitMultiple: reportData.allTimeAverageProfitMultiple ?? null,
          averageSellingPrice: reportData.averageSellingPrice?.average ?? null,
          averageProfitPerItem: reportData.averageProfitPerItem?.average ?? null,
          soldCount: reportData.averageProfitPerItem?.soldCount ?? 0,
          sellThroughPercent: reportData.sellThroughRate?.percentage ?? null,
        });
        setSourced(Array.isArray(sourcedData.columns) ? sourcedData.columns : []);
        setTrailing12m(trailingData as Trailing12m);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load planner data.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const bootSaleStats = useMemo(
    () => sourced.find((c) => c.sourceKey === 'bootsale') ?? null,
    [sourced]
  );

  const plan = useMemo(() => {
    const target = parseFloat(inputs.targetIncome);
    const ebayFee = parseFloat(inputs.ebayFeePercent);
    const monthlyStoreFee = parseMonthlyStoreFee(inputs.ebayStoreFeeMonthly);
    const annualStoreFee = monthlyStoreFee * 12;
    const grossProfitTarget = target + annualStoreFee;
    const visitsPerWeek = parseInt(inputs.bootSaleVisitsPerWeek, 10);
    const visits =
      Number.isFinite(visitsPerWeek) && visitsPerWeek > 0
        ? visitsPerWeek * BOOT_SALE_SEASON_WEEKS
        : NaN;
    const bootSaleVisitsPerWeek =
      Number.isFinite(visitsPerWeek) && visitsPerWeek > 0 ? visitsPerWeek : null;
    const listingsPerDay = parseFloat(inputs.listingsPerDay);
    const listingDaysPerWeek = parseInt(inputs.listingDaysPerWeek, 10);

    const overallMultiple = reporting?.allTimeAverageProfitMultiple ?? null;
    const avgSale = reporting?.averageSellingPrice ?? null;

    // Prefer boot-sale multiple when planning boot-sale visits; fall back to all-time.
    const planningMultiple =
      bootSaleStats?.profitMultiple != null && bootSaleStats.soldCount >= 3
        ? bootSaleStats.profitMultiple
        : overallMultiple;

    const multipleSource =
      bootSaleStats?.profitMultiple != null && bootSaleStats.soldCount >= 3
        ? 'boot sale'
        : 'all sold items';

    if (
      !Number.isFinite(target) ||
      target <= 0 ||
      !Number.isFinite(ebayFee) ||
      ebayFee < 0 ||
      planningMultiple == null ||
      planningMultiple <= 0 ||
      avgSale == null ||
      avgSale <= 0
    ) {
      return null;
    }

    const avgPurchase = avgSale / planningMultiple;
    const netPerItem = netProfitPerItem(avgPurchase, planningMultiple, ebayFee);

    if (netPerItem <= 0) {
      return {
        target,
        ebayFee,
        monthlyStoreFee,
        annualStoreFee,
        grossProfitTarget,
        visits: Number.isFinite(visits) && visits > 0 ? visits : null,
        bootSaleVisitsPerWeek,
        bootSaleSeasonWeeks: BOOT_SALE_SEASON_WEEKS,
        planningMultiple,
        multipleSource,
        avgPurchase,
        avgSale: avgPurchase * planningMultiple,
        netPerItem,
        itemsNeeded: null as number | null,
        itemsPerVisit: null as number | null,
        purchaseSpend: null as number | null,
        grossSales: null as number | null,
        listingsPerDay: 0,
        listingDaysPerWeek: 0,
        listingsPerWeek: 0,
        listingsPerYear: 0,
        weeksToListAll: null as number | null,
        listingCapacityOk: false,
        sellThroughPercent: null,
        sellThroughDecimal: 0,
        itemsToListForTarget: 0,
        suggestedSourcePerWeek: 0,
        expectedSalesAtCapacity: 0,
        sourcingFeasible: false,
        sourcePerYear: 0,
        sourcePerBootSale: null as number | null,
        purchaseSpendPerWeek: 0,
        maxSalesAtPace: 0,
        incomeAtCurrentPace: 0,
        incomeGapAtPace: 0,
        targetAchievableAtPace: false,
        requiredNetPerItemAtPace: null as number | null,
        requiredAvgSaleAtPace: null as number | null,
        requiredMultipleAtPace: null as number | null,
        itemsToListPerWeekNeeded: 0,
        listingPaceShortfall: 0,
        altSellThroughPercent: 0,
        itemsToListAtAltStr: 0,
        listingsSavedAtAltStr: 0,
        sellThroughScenarioActive: false,
        unprofitable: true,
      };
    }

    const itemsNeeded = Math.ceil(grossProfitTarget / netPerItem);
    const itemsPerVisit =
      Number.isFinite(visits) && visits > 0 ? Math.ceil(itemsNeeded / visits) : null;
    const purchaseSpend = itemsNeeded * avgPurchase;
    const grossSales = itemsNeeded * avgPurchase * planningMultiple;

    const perDay =
      Number.isFinite(listingsPerDay) && listingsPerDay > 0
        ? listingsPerDay
        : DEFAULT_LISTINGS_PER_DAY;
    const daysPerWeek =
      Number.isFinite(listingDaysPerWeek) && listingDaysPerWeek > 0
        ? listingDaysPerWeek
        : DEFAULT_LISTING_DAYS_PER_WEEK;
    const listingsPerWeek = perDay * daysPerWeek;
    const listingsPerYear = Math.round(listingsPerWeek * 52);
    const weeksToListAll =
      listingsPerWeek > 0 ? Math.ceil(itemsNeeded / listingsPerWeek) : null;

    // How many lines must be listed (then sold at your sell-through) to hit the target.
    const sellThroughPercent = reporting?.sellThroughPercent ?? null;
    const sellThroughDecimal =
      sellThroughPercent != null && sellThroughPercent > 0 ? sellThroughPercent / 100 : 0.65;
    const itemsToListForTarget = Math.ceil(itemsNeeded / sellThroughDecimal);
    const suggestedSourcePerWeek =
      listingsPerWeek > 0
        ? Math.min(listingsPerWeek, Math.ceil(itemsToListForTarget / 52))
        : Math.ceil(itemsToListForTarget / 52);
    const expectedSalesAtCapacity = Math.floor(listingsPerWeek * 52 * sellThroughDecimal);
    const sourcingFeasible = expectedSalesAtCapacity >= itemsNeeded;
    const sourcePerYear = suggestedSourcePerWeek * 52;
    const sourcePerBootSale =
      Number.isFinite(visits) && visits > 0 ? Math.ceil(sourcePerYear / visits) : null;
    const purchaseSpendPerWeek = suggestedSourcePerWeek * avgPurchase;

    // Part-time reality: fixed listing pace, work backwards to required profit per item.
    const maxSalesAtPace = expectedSalesAtCapacity;
    const incomeAtCurrentPace = maxSalesAtPace * netPerItem - annualStoreFee;
    const incomeGapAtPace = target - incomeAtCurrentPace;
    const targetAchievableAtPace = incomeGapAtPace <= 0;
    const requiredNetPerItemAtPace =
      maxSalesAtPace > 0 ? grossProfitTarget / maxSalesAtPace : null;
    const requiredAvgSaleAtPace =
      requiredNetPerItemAtPace != null
        ? (requiredNetPerItemAtPace + avgPurchase) / (1 - ebayFee / 100)
        : null;
    const requiredMultipleAtPace =
      requiredNetPerItemAtPace != null && avgPurchase > 0
        ? (requiredNetPerItemAtPace / avgPurchase + 1) / (1 - ebayFee / 100)
        : null;
    const itemsToListPerWeekNeeded =
      itemsToListForTarget > 0 ? Math.ceil(itemsToListForTarget / 52) : 0;
    const listingPaceShortfall = itemsToListPerWeekNeeded - listingsPerWeek;

    const altSellThroughDecimal =
      sellThroughDecimal < 0.95
        ? Math.min(0.95, Math.round((sellThroughDecimal + 0.1) * 100) / 100)
        : sellThroughDecimal;
    const altSellThroughPercent = Math.round(altSellThroughDecimal * 100);
    const itemsToListAtAltStr =
      altSellThroughDecimal > 0 ? Math.ceil(itemsNeeded / altSellThroughDecimal) : 0;
    const listingsSavedAtAltStr = Math.max(0, itemsToListForTarget - itemsToListAtAltStr);
    const sellThroughScenarioActive = altSellThroughDecimal > sellThroughDecimal;

    return {
      target,
      ebayFee,
      monthlyStoreFee,
      annualStoreFee,
      grossProfitTarget,
      visits: Number.isFinite(visits) && visits > 0 ? visits : null,
      bootSaleVisitsPerWeek,
      bootSaleSeasonWeeks: BOOT_SALE_SEASON_WEEKS,
      planningMultiple,
      multipleSource,
      avgPurchase,
      avgSale: avgPurchase * planningMultiple,
      netPerItem,
      itemsNeeded,
      itemsPerVisit,
      purchaseSpend,
      grossSales,
      listingsPerDay: perDay,
      listingDaysPerWeek: daysPerWeek,
      listingsPerWeek,
      listingsPerYear,
      weeksToListAll,
      listingCapacityOk: listingsPerYear >= itemsNeeded,
      sellThroughPercent,
      sellThroughDecimal,
      itemsToListForTarget,
      suggestedSourcePerWeek,
      expectedSalesAtCapacity,
      sourcingFeasible,
      sourcePerYear,
      sourcePerBootSale,
      purchaseSpendPerWeek,
      maxSalesAtPace,
      incomeAtCurrentPace,
      incomeGapAtPace,
      targetAchievableAtPace,
      requiredNetPerItemAtPace,
      requiredAvgSaleAtPace,
      requiredMultipleAtPace,
      itemsToListPerWeekNeeded,
      listingPaceShortfall,
      altSellThroughPercent,
      itemsToListAtAltStr,
      listingsSavedAtAltStr,
      sellThroughScenarioActive,
      unprofitable: false,
    };
  }, [inputs, reporting, bootSaleStats]);

  const comparison = useMemo(() => {
    if (!trailing12m || !plan || plan.unprofitable) return null;

    const ebayFee = plan.ebayFee;
    const actualNet = netAfterAllFees(
      trailing12m.grossProfit,
      trailing12m.totalSales,
      ebayFee,
      plan.annualStoreFee
    );
    const incomeDelta = actualNet - plan.target;
    const itemsDelta = trailing12m.itemsSold - plan.itemsNeeded!;
    const incomeAhead = incomeDelta >= 0;
    const itemsAhead = itemsDelta >= 0;

    const actualNetPerItem =
      trailing12m.itemsSold > 0 ? actualNet / trailing12m.itemsSold : null;

    return {
      ebayFee,
      actualNet,
      actualNetPerItem,
      incomeDelta,
      itemsDelta,
      incomeAhead,
      itemsAhead,
      incomeShort: incomeAhead ? 0 : Math.abs(incomeDelta),
      itemsShort: itemsAhead ? 0 : Math.abs(itemsDelta),
      incomeSurplus: incomeAhead ? incomeDelta : 0,
      itemsSurplus: itemsAhead ? itemsDelta : 0,
    };
  }, [trailing12m, plan]);

  const theoryTrailing = useMemo(() => {
    if (!plan || plan.unprofitable || !trailing12m || trailing12m.itemsSold <= 0) return null;

    const itemsSold = trailing12m.itemsSold;
    const itemsNeeded = plan.itemsNeeded!;
    const onTrack = itemsSold >= itemsNeeded;

    let yearsLabel: string | null = null;
    if (!onTrack) {
      const years = itemsNeeded / itemsSold;
      if (years >= 10) yearsLabel = `~${Math.round(years)} years at current pace`;
      else if (years >= 1) yearsLabel = `~${years.toFixed(1)} years at current pace`;
      else yearsLabel = `~${Math.max(1, Math.round(years * 12))} months at current pace`;
    }

    return { itemsSold, itemsNeeded, onTrack, yearsLabel };
  }, [plan, trailing12m]);

  const setField = (key: keyof PlannerInputs, value: string) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleAskAi = useCallback(async () => {
    if (!plan) {
      setAskAiHint('Enter a target income and wait for data to load.');
      window.setTimeout(() => setAskAiHint(null), 4500);
      return;
    }
    setAskAiBusy(true);
    setAskAiHint(null);
    try {
      const text = buildPlannerAskAiPrompt({
        inputs,
        plan: plan as unknown as Record<string, unknown>,
        reporting,
        trailing12m,
        comparison,
        theoryTrailing,
        sourced,
      });
      await copyTextToClipboard(text);
      setAskAiHint('Copied to clipboard — paste into ChatGPT.');
    } catch {
      setAskAiHint('Could not copy to clipboard.');
    } finally {
      setAskAiBusy(false);
      window.setTimeout(() => setAskAiHint(null), 5000);
    }
  }, [plan, inputs, reporting, trailing12m, comparison, theoryTrailing, sourced]);

  const handleAskAiSourcing = useCallback(async () => {
    if (!plan) {
      setAskAiSourcingHint('Enter a target income and wait for data to load.');
      window.setTimeout(() => setAskAiSourcingHint(null), 4500);
      return;
    }
    setAskAiSourcingBusy(true);
    setAskAiSourcingHint(null);
    try {
      const text = buildPlannerSourcingAskAiPrompt({
        inputs,
        plan: plan as unknown as Record<string, unknown>,
        reporting,
        trailing12m,
        comparison,
        theoryTrailing,
        sourced,
      });
      await copyTextToClipboard(text);
      setAskAiSourcingHint('Copied — paste into a new ChatGPT chat (no memory).');
    } catch {
      setAskAiSourcingHint('Could not copy to clipboard.');
    } finally {
      setAskAiSourcingBusy(false);
      window.setTimeout(() => setAskAiSourcingHint(null), 5000);
    }
  }, [plan, inputs, reporting, trailing12m, comparison, theoryTrailing, sourced]);

  return (
    <section className="planner" aria-label="Income planner">
      {error && <div className="planner-error">{error}</div>}

      <div className="planner-layout">
        <div className="planner-panel planner-panel--inputs">
          <h3 className="planner-panel-title">Your targets</h3>

          <label className="planner-field">
            <span className="planner-label">Desired income after expenses</span>
            <div className="planner-input-wrap">
              <span className="planner-input-prefix">£</span>
              <input
                type="number"
                className="planner-input"
                min={0}
                step={100}
                value={inputs.targetIncome}
                onChange={(e) => setField('targetIncome', e.target.value)}
                placeholder="e.g. 100000"
              />
            </div>
            <span className="planner-hint">Net profit from reselling for the year.</span>
          </label>

          <label className="planner-field">
            <span className="planner-label">eBay fee (% of sale)</span>
            <div className="planner-input-wrap">
              <input
                type="number"
                className="planner-input"
                min={0}
                max={100}
                step={0.1}
                value={inputs.ebayFeePercent}
                onChange={(e) => setField('ebayFeePercent', e.target.value)}
              />
              <span className="planner-input-suffix">%</span>
            </div>
          </label>

          <label className="planner-field">
            <span className="planner-label">eBay store fee (per month)</span>
            <div className="planner-input-wrap">
              <span className="planner-input-prefix">£</span>
              <input
                type="number"
                className="planner-input"
                min={0}
                step={0.01}
                value={inputs.ebayStoreFeeMonthly}
                onChange={(e) => setField('ebayStoreFeeMonthly', e.target.value)}
                onBlur={() => {
                  if (inputs.ebayStoreFeeMonthly.trim() === '') {
                    setField('ebayStoreFeeMonthly', String(DEFAULT_EBAY_STORE_FEE_MONTHLY));
                  }
                }}
                placeholder="e.g. 27"
              />
            </div>
            <span className="planner-hint">
              Default £{DEFAULT_EBAY_STORE_FEE_MONTHLY}/month — deducted from net alongside eBay
              selling fees.
            </span>
          </label>

          <label className="planner-field">
            <span className="planner-label">Boot sale visits per week</span>
            <input
              type="text"
              inputMode="numeric"
              className="planner-input planner-input--plain"
              value={inputs.bootSaleVisitsPerWeek}
              onChange={(e) =>
                setField('bootSaleVisitsPerWeek', clampIntInput(e.target.value, 1, 7))
              }
              placeholder="e.g. 3"
            />
            <span className="planner-hint">
              {(() => {
                const n = parseInt(inputs.bootSaleVisitsPerWeek, 10);
                if (!Number.isFinite(n) || n <= 0) {
                  return `Apr–Oct only (${BOOT_SALE_SEASON_WEEKS} weeks). Charity shop Nov–Mar.`;
                }
                return `${n}/week ≈ ${(n * BOOT_SALE_SEASON_WEEKS).toLocaleString()} visits in season. Charity shop Nov–Mar.`;
              })()}
            </span>
          </label>

          <label className="planner-field">
            <span className="planner-label">Items to list per day</span>
            <input
              type="text"
              inputMode="numeric"
              className="planner-input planner-input--plain"
              value={inputs.listingsPerDay}
              onChange={(e) =>
                setField('listingsPerDay', clampIntInput(e.target.value, 1, 100))
              }
              onBlur={() => {
                if (inputs.listingsPerDay === '') {
                  setField('listingsPerDay', String(DEFAULT_LISTINGS_PER_DAY));
                }
              }}
            />
            <span className="planner-hint">Default {DEFAULT_LISTINGS_PER_DAY}.</span>
          </label>

          <label className="planner-field">
            <span className="planner-label">Days listing per week</span>
            <input
              type="text"
              inputMode="numeric"
              className="planner-input planner-input--plain"
              value={inputs.listingDaysPerWeek}
              onChange={(e) =>
                setField('listingDaysPerWeek', clampIntInput(e.target.value, 1, 7))
              }
              onBlur={() => {
                if (inputs.listingDaysPerWeek === '') {
                  setField('listingDaysPerWeek', String(DEFAULT_LISTING_DAYS_PER_WEEK));
                }
              }}
            />
            <span className="planner-hint">Default {DEFAULT_LISTING_DAYS_PER_WEEK}.</span>
          </label>
        </div>

        <div className="planner-panel planner-panel--results">
          <h3 className="planner-panel-title">What you need to sell</h3>

          {loading ? (
            <p className="planner-muted">Loading your sales history…</p>
          ) : reporting?.soldCount === 0 ? (
            <p className="planner-muted">
              No sold items yet — add sales in Stock so the planner can use your average profit
              multiple.
            </p>
          ) : !plan ? (
            <p className="planner-muted">Enter a target income to see how many items you need.</p>
          ) : plan.unprofitable ? (
            <p className="planner-muted">
              At {plan.planningMultiple.toFixed(2)}× with {plan.ebayFee}% eBay fees, each item
              loses money on average. Raise your multiple or lower fees in the assumption.
            </p>
          ) : (
            <>
              <div className="planner-stat-grid">
                <article className="planner-stat planner-stat--hero">
                  <span className="planner-stat-label">Items to sell this year</span>
                  <span className="planner-stat-value">{plan.itemsNeeded!.toLocaleString()}</span>
                  <span className="planner-stat-detail">
                    To earn {formatCurrency(plan.target)} after eBay fees
                    {plan.annualStoreFee > 0 && (
                      <> &amp; {formatCurrency(plan.annualStoreFee)} store/yr</>
                    )}
                  </span>
                </article>

                {plan.annualStoreFee > 0 && (
                  <article className="planner-stat">
                    <span className="planner-stat-label">eBay store subscription</span>
                    <span className="planner-stat-value">
                      {formatCurrency(plan.annualStoreFee)}/yr
                    </span>
                    <span className="planner-stat-detail">
                      {formatCurrencyPrecise(plan.monthlyStoreFee)}/month · included in all net
                      figures
                    </span>
                  </article>
                )}

                {plan.itemsPerVisit != null && (
                  <article className="planner-stat">
                    <span className="planner-stat-label">Items per boot sale visit</span>
                    <span className="planner-stat-value">{plan.itemsPerVisit.toLocaleString()}</span>
                    <span className="planner-stat-detail">
                      {plan.bootSaleVisitsPerWeek}/week · {plan.visits!.toLocaleString()} visits
                      Apr–Oct
                    </span>
                  </article>
                )}

                <article className="planner-stat">
                  <span className="planner-stat-label">Net profit per item</span>
                  <span className="planner-stat-value">{formatCurrencyPrecise(plan.netPerItem)}</span>
                  <span className="planner-stat-detail">
                    After {plan.ebayFee}% eBay fee on {formatCurrencyPrecise(plan.avgSale)} sale
                  </span>
                </article>

                <article className="planner-stat">
                  <span className="planner-stat-label">Purchase spend needed</span>
                  <span className="planner-stat-value">{formatCurrency(plan.purchaseSpend!)}</span>
                  <span className="planner-stat-detail">
                    At {formatCurrencyPrecise(plan.avgPurchase)} average buy price
                  </span>
                </article>

                <article className="planner-stat">
                  <span className="planner-stat-label">Gross sales needed</span>
                  <span className="planner-stat-value">{formatCurrency(plan.grossSales!)}</span>
                  <span className="planner-stat-detail">Before fees and purchase cost</span>
                </article>

                <article className="planner-stat">
                  <span className="planner-stat-label">Listing capacity</span>
                  <span className="planner-stat-value">
                    {plan.listingsPerYear.toLocaleString()}/yr
                  </span>
                  <span className="planner-stat-detail">
                    {plan.listingsPerDay} per day × {plan.listingDaysPerWeek} days ={' '}
                    {plan.listingsPerWeek}/week
                    {plan.weeksToListAll != null && (
                      <> · {plan.weeksToListAll} weeks to list all needed</>
                    )}
                    {plan.listingCapacityOk ? (
                      <> · covers annual target</>
                    ) : (
                      <> · {plan.itemsNeeded! - plan.listingsPerYear} listings short</>
                    )}
                  </span>
                </article>

                <article className="planner-stat">
                  <span className="planner-stat-label">Monthly pace</span>
                  <span className="planner-stat-value">
                    {Math.ceil(plan.itemsNeeded! / 12).toLocaleString()} items
                  </span>
                  <span className="planner-stat-detail">
                    ~{formatCurrency(plan.target / 12)} net / month
                  </span>
                </article>
              </div>

              <nav className="planner-results-tabs" role="tablist" aria-label="Planner results">
                <button
                  type="button"
                  role="tab"
                  id="planner-tab-sourcing"
                  aria-selected={resultsTab === 'sourcing'}
                  aria-controls="planner-panel-sourcing"
                  className={`planner-results-tab${
                    resultsTab === 'sourcing' ? ' planner-results-tab--active' : ''
                  }`}
                  onClick={() => setResultsTab('sourcing')}
                >
                  Sourcing
                </button>
                <button
                  type="button"
                  role="tab"
                  id="planner-tab-monthly"
                  aria-selected={resultsTab === 'monthly'}
                  aria-controls="planner-panel-monthly"
                  className={`planner-results-tab${
                    resultsTab === 'monthly' ? ' planner-results-tab--active' : ''
                  }`}
                  onClick={() => setResultsTab('monthly')}
                >
                  Month by month
                </button>
              </nav>

              {resultsTab === 'sourcing' ? (
                <div
                  id="planner-panel-sourcing"
                  role="tabpanel"
                  aria-labelledby="planner-tab-sourcing"
                  className="planner-results-section"
                >
                  <h3 className="planner-section-title">Current Years Projected Profit</h3>

                    <div
                      className={
                        'planner-feasibility' +
                        (plan.targetAchievableAtPace
                          ? ' planner-feasibility--ok'
                          : ' planner-feasibility--warn')
                      }
                    >
                      {plan.targetAchievableAtPace ? (
                        <>
                          At {formatCurrencyPrecise(plan.netPerItem)} net/item you&apos;d earn{' '}
                          {formatCurrency(plan.incomeAtCurrentPace)}
                          {plan.annualStoreFee > 0 && (
                            <> after {formatCurrency(plan.annualStoreFee)} store/yr</>
                          )}{' '}
                          — enough for {formatCurrency(plan.target)}.
                        </>
                      ) : (
                        <>
                          At today&apos;s {formatCurrencyPrecise(plan.netPerItem)} net/item you&apos;d
                          earn {formatCurrency(plan.incomeAtCurrentPace)}
                          {plan.annualStoreFee > 0 && (
                            <> after {formatCurrency(plan.annualStoreFee)} store/yr</>
                          )}{' '}
                          — {formatCurrency(plan.incomeGapAtPace)} short of{' '}
                          {formatCurrency(plan.target)}. You can&apos;t list enough at the same margin;
                          each sold item needs to earn more.
                        </>
                      )}
                    </div>

                    <div className="planner-stat-grid planner-stat-grid--flush">
                      <article className="planner-stat">
                        <span className="planner-stat-label">Max sales at your pace</span>
                        <span className="planner-stat-value">
                          {plan.maxSalesAtPace.toLocaleString()}/yr
                        </span>
                        <span className="planner-stat-detail">
                          {plan.listingsPerYear.toLocaleString()} listed ×{' '}
                          {(plan.sellThroughDecimal * 100).toFixed(0)}% STR
                        </span>
                      </article>
                      <article className="planner-stat">
                        <span className="planner-stat-label">Income at today&apos;s margin</span>
                        <span className="planner-stat-value">
                          {formatCurrency(plan.incomeAtCurrentPace)}
                        </span>
                        <span className="planner-stat-detail">
                          {formatCurrencyPrecise(plan.netPerItem)} × {plan.maxSalesAtPace.toLocaleString()}{' '}
                          sales
                          {plan.annualStoreFee > 0 && (
                            <> − {formatCurrency(plan.annualStoreFee)} store</>
                          )}
                        </span>
                      </article>
                      <article className="planner-stat">
                        <span className="planner-stat-label">Source spend per week</span>
                        <span className="planner-stat-value">
                          {formatCurrency(plan.purchaseSpendPerWeek)}
                        </span>
                        <span className="planner-stat-detail">
                          At {formatCurrencyPrecise(plan.avgPurchase)} average buy
                        </span>
                      </article>
                      <article className="planner-stat">
                        <span className="planner-stat-label">Annual source spend</span>
                        <span className="planner-stat-value">{formatCurrency(plan.purchaseSpend!)}</span>
                      </article>
                      {plan.requiredAvgSaleAtPace != null && (
                        <article className="planner-stat">
                          <span className="planner-stat-label">Avg sale price needed</span>
                          <span className="planner-stat-value">
                            {formatCurrencyPrecise(plan.requiredAvgSaleAtPace)}
                          </span>
                          <span className="planner-stat-detail">
                            Keeping {formatCurrencyPrecise(plan.avgPurchase)} average buy · after{' '}
                            {plan.ebayFee}% fee
                          </span>
                        </article>
                      )}
                      {plan.requiredMultipleAtPace != null && (
                        <article className="planner-stat">
                          <span className="planner-stat-label">Profit multiple needed</span>
                          <span className="planner-stat-value">
                            {plan.requiredMultipleAtPace.toFixed(2)}×
                          </span>
                          <span className="planner-stat-detail">
                            vs {plan.planningMultiple.toFixed(2)}× today (
                            {formatCurrencyPrecise(plan.avgSale)} sale)
                          </span>
                        </article>
                      )}
                      {theoryTrailing && (
                        <article className="planner-stat">
                          <span className="planner-stat-label">Trailing pace vs target</span>
                          <span className="planner-stat-value">
                            {theoryTrailing.itemsSold.toLocaleString()} vs{' '}
                            {theoryTrailing.itemsNeeded.toLocaleString()} sold
                          </span>
                          <span className="planner-stat-detail">
                            {theoryTrailing.onTrack
                              ? 'Last 12 months already at or above the pace needed'
                              : theoryTrailing.yearsLabel}
                          </span>
                        </article>
                      )}
                    </div>

                    {trailing12m && (
                      <div className="planner-trailing-section">
                        {comparison && (
                          <>
                            <div className="planner-compare planner-compare--flush">
                              <div className="planner-compare-grid">
                                <div
                                  className={
                                    'planner-compare-card' +
                                    (comparison.incomeAhead
                                      ? ' planner-compare-card--ahead'
                                      : ' planner-compare-card--behind')
                                  }
                                >
                                  <span className="planner-compare-label">Net income</span>
                                  <span className="planner-compare-values">
                                    {formatCurrency(comparison.actualNet)}
                                    <span className="planner-compare-sep"> / </span>
                                    {formatCurrency(plan.target)}
                                  </span>
                                  {comparison.incomeAhead ? (
                                    <span className="planner-compare-verdict planner-compare-verdict--ahead">
                                      Ahead by {formatCurrency(comparison.incomeSurplus)}
                                    </span>
                                  ) : (
                                    <span className="planner-compare-verdict planner-compare-verdict--behind">
                                      Short by {formatCurrency(comparison.incomeShort)}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className={
                                    'planner-compare-card' +
                                    (comparison.itemsAhead
                                      ? ' planner-compare-card--ahead'
                                      : ' planner-compare-card--behind')
                                  }
                                >
                                  <span className="planner-compare-label">Items sold</span>
                                  <span className="planner-compare-values">
                                    {trailing12m.itemsSold.toLocaleString()}
                                    <span className="planner-compare-sep"> / </span>
                                    {plan.itemsNeeded!.toLocaleString()} needed
                                  </span>
                                  {comparison.itemsAhead ? (
                                    <span className="planner-compare-verdict planner-compare-verdict--ahead">
                                      Ahead by {comparison.itemsSurplus.toLocaleString()} items
                                    </span>
                                  ) : (
                                    <span className="planner-compare-verdict planner-compare-verdict--behind">
                                      Short by {comparison.itemsShort.toLocaleString()} items
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <hr className="planner-divider" />
                          </>
                        )}
                        <h4 className="planner-compare-title">
                          Current sales data ({formatPeriodDate(trailing12m.periodFrom)} –{' '}
                          {formatPeriodDate(trailing12m.periodTo)})
                        </h4>

                        <div className="planner-stat-grid planner-stat-grid--flush">
                          <article className="planner-stat">
                            <span className="planner-stat-label">Items sold</span>
                            <span className="planner-stat-value">
                              {trailing12m.itemsSold.toLocaleString()}
                            </span>
                          </article>
                          <article className="planner-stat">
                            <span className="planner-stat-label">Gross sales</span>
                            <span className="planner-stat-value">
                              {formatCurrency(trailing12m.totalSales)}
                            </span>
                          </article>
                          <article className="planner-stat">
                            <span className="planner-stat-label">Purchase spend</span>
                            <span className="planner-stat-value">
                              {formatCurrency(trailing12m.totalPurchases)}
                            </span>
                          </article>
                          <article className="planner-stat">
                            <span className="planner-stat-label">Gross profit</span>
                            <span className="planner-stat-value">
                              {formatCurrency(trailing12m.grossProfit)}
                            </span>
                          </article>
                          {comparison && (
                            <article className="planner-stat">
                              <span className="planner-stat-label">
                                Net after eBay fees
                                {plan.annualStoreFee > 0 && ' & store'}
                              </span>
                              <span className="planner-stat-value">
                                {formatCurrency(comparison.actualNet)}
                              </span>
                            </article>
                          )}
                        </div>
                      </div>
                    )}

                  <div className="planner-realistic">
                    <h3 className="planner-section-title">In Theory Plan</h3>

                  <div className="planner-stat-grid planner-stat-grid--flush">
                    {plan.requiredNetPerItemAtPace != null && (
                      <article className="planner-stat planner-stat--hero">
                        <span className="planner-stat-label">Net profit needed per item</span>
                        <span className="planner-stat-value">
                          {formatCurrencyPrecise(plan.requiredNetPerItemAtPace)}
                        </span>
                        <span className="planner-stat-detail">
                          To hit {formatCurrency(plan.target)} with only{' '}
                          {plan.maxSalesAtPace.toLocaleString()} sales/yr
                        </span>
                      </article>
                    )}
                    <article className="planner-stat">
                      <span className="planner-stat-label">Items to list (incl. unsold)</span>
                      <span className="planner-stat-value">
                        {plan.itemsToListForTarget.toLocaleString()}/yr
                      </span>
                      <span className="planner-stat-detail">
                        {plan.itemsNeeded!.toLocaleString()} sales at sell-through
                      </span>
                    </article>
                    {plan.sourcePerBootSale != null && (
                      <article className="planner-stat">
                        <span className="planner-stat-label">Items per boot sale</span>
                        <span className="planner-stat-value">
                          {plan.sourcePerBootSale.toLocaleString()}
                        </span>
                        <span className="planner-stat-detail">
                          {plan.bootSaleVisitsPerWeek}/week · {plan.visits} visits Apr–Oct
                        </span>
                      </article>
                    )}

                    <article className="planner-stat">
                      <span className="planner-stat-label">Listing pace gap</span>
                      <span className="planner-stat-value">
                        {plan.itemsToListPerWeekNeeded.toLocaleString()} vs{' '}
                        {plan.listingsPerWeek}/week
                      </span>
                      <span className="planner-stat-detail">
                        {plan.listingPaceShortfall > 0
                          ? `${plan.listingPaceShortfall.toLocaleString()} above your listing cap`
                          : 'Your listing pace covers the volume needed'}
                      </span>
                    </article>

                    {plan.requiredAvgSaleAtPace != null && plan.requiredMultipleAtPace != null && (
                      <article className="planner-stat">
                        <span className="planner-stat-label">Sale price &amp; multiple</span>
                        <span className="planner-stat-value">
                          {formatCurrencyPrecise(plan.avgSale)} →{' '}
                          {formatCurrencyPrecise(plan.requiredAvgSaleAtPace)}
                        </span>
                        <span className="planner-stat-detail">
                          {plan.planningMultiple.toFixed(2)}× today →{' '}
                          {plan.requiredMultipleAtPace.toFixed(2)}× needed ·{' '}
                          {formatCurrencyPrecise(plan.netPerItem)} →{' '}
                          {formatCurrencyPrecise(plan.requiredNetPerItemAtPace!)} net/item
                        </span>
                      </article>
                    )}

                    {plan.sellThroughScenarioActive && (
                      <article className="planner-stat">
                        <span className="planner-stat-label">
                          If sell-through hit {plan.altSellThroughPercent}%
                        </span>
                        <span className="planner-stat-value">
                          {plan.itemsToListAtAltStr.toLocaleString()} listings/yr
                        </span>
                        <span className="planner-stat-detail">
                          {plan.listingsSavedAtAltStr.toLocaleString()} fewer than at{' '}
                          {(plan.sellThroughDecimal * 100).toFixed(0)}% STR (
                          {plan.itemsToListForTarget.toLocaleString()} today)
                        </span>
                      </article>
                    )}

                  </div>

                  <div className="planner-ask-ai-wrap">
                    <div className="planner-ask-ai-actions">
                      <button
                        type="button"
                        className="planner-ask-ai-btn"
                        disabled={askAiBusy || askAiSourcingBusy || !plan}
                        onClick={() => void handleAskAi()}
                        aria-label="Ask AI"
                      >
                        {askAiBusy ? '…' : 'Ask AI'}
                      </button>
                      <button
                        type="button"
                        className="planner-ask-ai-btn planner-ask-ai-btn--secondary"
                        disabled={askAiBusy || askAiSourcingBusy || !plan}
                        onClick={() => void handleAskAiSourcing()}
                        aria-label="Ask AI for sourcing trends — fresh research, no memory"
                      >
                        {askAiSourcingBusy ? '…' : 'Ask AI — sourcing trends'}
                      </button>
                    </div>
                    {askAiHint && (
                      <p
                        className={
                          'planner-ask-ai-hint' +
                          (askAiHint.includes('Could not') ? ' planner-ask-ai-hint--error' : '')
                        }
                      >
                        {askAiHint}
                      </p>
                    )}
                    {askAiSourcingHint && (
                      <p
                        className={
                          'planner-ask-ai-hint' +
                          (askAiSourcingHint.includes('Could not')
                            ? ' planner-ask-ai-hint--error'
                            : '')
                        }
                      >
                        {askAiSourcingHint}
                      </p>
                    )}
                  </div>
                  </div>
                </div>
              ) : (
                trailing12m &&
                trailing12m.months.length > 0 && (
                  <div
                    id="planner-panel-monthly"
                    role="tabpanel"
                    aria-labelledby="planner-tab-monthly"
                    className="planner-results-section"
                  >
                    <div className="planner-monthly-table-wrap">
                      <table className="planner-monthly-table">
                        <thead>
                          <tr>
                            <th scope="col">Month</th>
                            <th scope="col">Items</th>
                            <th scope="col">Sales</th>
                            <th scope="col">Spend</th>
                            <th scope="col">Profit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trailing12m.months.map((m) => (
                            <tr key={`${m.year}-${m.month}`}>
                              <td>{m.label}</td>
                              <td>{m.itemsSold.toLocaleString()}</td>
                              <td>{formatCurrencyPrecise(m.totalSales)}</td>
                              <td>{formatCurrencyPrecise(m.totalPurchases)}</td>
                              <td
                                className={
                                  m.grossProfit >= 0
                                    ? 'planner-monthly-profit--pos'
                                    : 'planner-monthly-profit--neg'
                                }
                              >
                                {formatCurrencyPrecise(m.grossProfit)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <th scope="row">Total</th>
                            <td>{trailing12m.itemsSold.toLocaleString()}</td>
                            <td>{formatCurrencyPrecise(trailing12m.totalSales)}</td>
                            <td>{formatCurrencyPrecise(trailing12m.totalPurchases)}</td>
                            <td>{formatCurrencyPrecise(trailing12m.grossProfit)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
};

export default Planner;
