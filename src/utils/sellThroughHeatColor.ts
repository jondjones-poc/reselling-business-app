/** Map sold-vs-inventory balance to a stock-card heat color.
 * Green when sold > still for sale; red when inventory > sold.
 * `balancePct` = (sold − inventory) / bought × 100 (clamped to ±50 for full intensity).
 */
export function sellThroughBalanceToColor(
  sold: number,
  inventory: number,
  bought: number
): string {
  if (!Number.isFinite(bought) || bought <= 0) return '#9ca3af';
  const balancePct = ((sold - inventory) / bought) * 100;
  return balancePctToHeatColor(balancePct);
}

export function sellThroughBalanceToTextColor(
  sold: number,
  inventory: number,
  bought: number
): string {
  if (!Number.isFinite(bought) || bought <= 0) return '#111827';
  const balancePct = ((sold - inventory) / bought) * 100;
  return balancePctToHeatTextColor(balancePct);
}

/** Heat from profit/loss vs spend: green when net > 0, red when loss. Intensity = |net| / spend × 100. */
export function profitMarginToColor(net: number, spend: number): string {
  if (!Number.isFinite(net)) return '#9ca3af';
  if (!Number.isFinite(spend) || spend <= 0) {
    if (net > 0) return balancePctToHeatColor(50);
    if (net < 0) return balancePctToHeatColor(-50);
    return '#9ca3af';
  }
  return balancePctToHeatColor((net / spend) * 100);
}

export function profitMarginToTextColor(net: number, spend: number): string {
  if (!Number.isFinite(net)) return '#111827';
  if (!Number.isFinite(spend) || spend <= 0) {
    return net !== 0 ? '#ffffff' : '#111827';
  }
  return balancePctToHeatTextColor((net / spend) * 100);
}

export function balancePctToHeatColor(pct: number): string {
  const v = Number(pct);
  if (!Number.isFinite(v)) return '#9ca3af';

  // Full green/red by ±50 (sold−inventory as % of bought)
  const clamped = Math.max(-50, Math.min(50, v));

  if (clamped >= 50) return '#15803d';
  if (clamped <= -50) return '#b91c1c';
  if (clamped >= 0) return lerpColor('#eab308', '#22c55e', clamped / 50);
  return lerpColor('#ef4444', '#eab308', (clamped + 50) / 50);
}

export function balancePctToHeatTextColor(pct: number): string {
  const v = Number(pct);
  if (!Number.isFinite(v)) return '#111827';
  return Math.abs(v) >= 12.5 ? '#ffffff' : '#111827';
}

/**
 * Buy signal = net profit + sell-through rate + volume.
 *
 * 1. Sell-through rate (sold ÷ bought), centered at 50% → ±50 score,
 *    then shrunk when the sample is small (bought ÷ bought+25).
 * 2. Net profit (£) vs the largest |net| in the set → ±50.
 * 3. Volume (bought count vs largest) scales the mix (0.35–1×)
 *    so tiny samples cannot dominate; high volume of losses stays red.
 *
 * Uses net profit (not sales revenue) so high spend without margin does not win.
 * Green → buy more; red → avoid.
 */
export type BuySignalBreakdown = {
  score: number;
  /** Sold ÷ bought × 100 (0–100). */
  sellThroughRate: number;
  /** Rate centered at 50%, then sample-shrunk (−50…+50). */
  sellThroughScore: number;
  /** 0–1: how much sell-through is trusted given sample size. */
  sampleWeight: number;
  /** Net profit vs peers (−50…+50). */
  profitScore: number;
  /** 0–1: relative volume vs largest set (log scale). */
  volumeNorm: number;
  /** Multiplier applied to the mixed score (0.35–1). */
  volumeWeight: number;
  bought: number;
  sold: number;
};

export function buySignalBreakdown(args: {
  sold: number;
  inventory: number;
  bought: number;
  netProfit: number;
  maxAbsProfit: number;
  /** Largest bought count in the comparison set (for volume scaling). */
  maxBought?: number;
  /** Pseudo-count for sell-through shrinkage. Default 25. */
  samplePrior?: number;
}): BuySignalBreakdown {
  const bought = Math.max(0, Number(args.bought) || 0);
  const sold = Math.max(0, Number(args.sold) || 0);
  const prior =
    Number.isFinite(args.samplePrior) && (args.samplePrior as number) > 0
      ? (args.samplePrior as number)
      : 25;

  const sellThroughRate = bought > 0 ? (sold / bought) * 100 : 0;
  // 0% ST → −50, 50% → 0, 100% → +50
  const stCentered = Math.max(-50, Math.min(50, sellThroughRate - 50));
  const sampleWeight = bought > 0 ? bought / (bought + prior) : 0;
  const sellThroughScore = stCentered * sampleWeight;

  const maxAbs = Number(args.maxAbsProfit);
  const profitRaw =
    Number.isFinite(maxAbs) && maxAbs > 0
      ? (Number(args.netProfit) / maxAbs) * 50
      : 0;
  const profitScore = Math.max(-50, Math.min(50, Number.isFinite(profitRaw) ? profitRaw : 0));

  const maxBought = Math.max(1, Number(args.maxBought) || bought || 1);
  const volumeNorm = bought > 0 ? Math.log1p(bought) / Math.log1p(maxBought) : 0;
  const volumeWeight = 0.35 + 0.65 * Math.max(0, Math.min(1, volumeNorm));

  // Profit slightly ahead of sell-through; volume scales confidence.
  const mixed = sellThroughScore * 0.4 + profitScore * 0.6;
  return {
    score: mixed * volumeWeight,
    sellThroughRate,
    sellThroughScore,
    sampleWeight,
    profitScore,
    volumeNorm: Math.max(0, Math.min(1, volumeNorm)),
    volumeWeight,
    bought,
    sold,
  };
}

export function buySignalHeatPct(args: Parameters<typeof buySignalBreakdown>[0]): number {
  return buySignalBreakdown(args).score;
}

/**
 * Buy-signal scores are compressed by sample/volume weights, so they rarely hit ±50.
 * Map ±20 → full red/green so a clear loser like −10 reads orange-red, not amber.
 */
const BUY_SIGNAL_VISUAL_FULL = 20;

function buySignalVisualPct(score: number): number {
  const s = Number(score);
  if (!Number.isFinite(s)) return 0;
  return Math.max(-50, Math.min(50, (s / BUY_SIGNAL_VISUAL_FULL) * 50));
}

export function buySignalToColor(args: Parameters<typeof buySignalBreakdown>[0]): string {
  return balancePctToHeatColor(buySignalVisualPct(buySignalHeatPct(args)));
}

export function buySignalToTextColor(args: Parameters<typeof buySignalBreakdown>[0]): string {
  return balancePctToHeatTextColor(buySignalVisualPct(buySignalHeatPct(args)));
}

function lerpColor(from: string, to: string, t: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(a.r + (b.r - a.r) * u);
  const g = Math.round(a.g + (b.g - a.g) * u);
  const bl = Math.round(a.b + (b.b - a.b) * u);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
