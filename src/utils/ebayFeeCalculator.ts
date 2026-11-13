export type EbaySellerType = 'business' | 'private';
export type EbaySellerLevel = 'top_rated' | 'above_standard' | 'below_standard';

export interface EbayFeeCalculatorInput {
  soldPrice: number;
  sellerType: EbaySellerType;
  sellerLevel: EbaySellerLevel;
  promotedFeesPercent: number;
  vatPercent: number;
}

export interface EbayFeeCalculatorResult {
  finalFee: number;
  transactionFee: number;
  regulatoryFee: number;
  promotedFee: number;
  vat: number;
  totalEbayFee: number;
}

/**
 * UK eBay fees for Clothes, Shoes & Accessories (category #11450), per eBay's
 * published seller-fee pages (checked against developer.ebay.com/ebay.co.uk
 * help pages, 2026):
 *  - Business: 11.9% final value fee, 0.35% regulatory operating fee. eBay
 *    states these fees are quoted exclusive of VAT, so 20% VAT is added on
 *    top of the fee subtotal.
 *  - Private: 12.8% final value fee, 0.42% regulatory operating fee. Note:
 *    eBay currently waives most fees for UK-resident private sellers
 *    entirely — these rates come from eBay's private-seller fee page (which
 *    states they're VAT-inclusive already) and are kept here only as a
 *    rough non-UK/legacy comparison, not a guarantee of current UK private
 *    pricing.
 *  - Below Standard seller level adds +6 percentage points to the final
 *    value fee the following month, per eBay's published seller performance
 *    policy. No numeric discount is documented for Top Rated vs Above
 *    Standard on standard (non Premium Service) Clothing listings, so both
 *    use the base rate.
 *  - The £0.30 per-order fee is flat and applies to both seller types.
 */
const FINAL_VALUE_FEE_RATE: Record<EbaySellerType, number> = {
  business: 0.119,
  private: 0.128,
};
const REGULATORY_OPERATING_FEE_RATE: Record<EbaySellerType, number> = {
  business: 0.0035,
  private: 0.0042,
};
const BELOW_STANDARD_FVF_PENALTY = 0.06;
const PER_ORDER_FEE = 0.3;

export function calculateEbayFees(input: EbayFeeCalculatorInput): EbayFeeCalculatorResult {
  const price = Number.isFinite(input.soldPrice) && input.soldPrice > 0 ? input.soldPrice : 0;

  const baseFvfRate = FINAL_VALUE_FEE_RATE[input.sellerType];
  const fvfRate =
    input.sellerLevel === 'below_standard' ? baseFvfRate + BELOW_STANDARD_FVF_PENALTY : baseFvfRate;

  const finalFee = price * fvfRate;
  const transactionFee = price > 0 ? PER_ORDER_FEE : 0;
  const regulatoryFee = price * REGULATORY_OPERATING_FEE_RATE[input.sellerType];
  const promotedFee = price * (Math.max(0, input.promotedFeesPercent) / 100);

  const feesBeforeVat = finalFee + transactionFee + regulatoryFee + promotedFee;
  const vat = feesBeforeVat * (Math.max(0, input.vatPercent) / 100);
  const totalEbayFee = feesBeforeVat + vat;

  return { finalFee, transactionFee, regulatoryFee, promotedFee, vat, totalEbayFee };
}

export function calculateProfit(
  soldPrice: number,
  itemCost: number,
  totalEbayFee: number
): { totalProfit: number; profitMarginPercent: number | null } {
  const price = Number.isFinite(soldPrice) ? soldPrice : 0;
  const cost = Number.isFinite(itemCost) ? itemCost : 0;
  const totalProfit = price - cost - totalEbayFee;
  const profitMarginPercent = price > 0 ? (totalProfit / price) * 100 : null;
  return { totalProfit, profitMarginPercent };
}
