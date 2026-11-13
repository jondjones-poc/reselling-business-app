import { calculateEbayFees, calculateProfit } from './ebayFeeCalculator';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Sold Price of £14.60, Business seller, Top Rated, 0% promoted fees, 20%
// VAT reproduces the exact worked-example figures given for this calculator:
//   eBay Fee: £2.51 / Final Fee: £1.74 / Transaction fee: £0.30 /
//   Regulatory Operating fee: £0.05 / 20% VAT: £0.42
test('business seller, Top Rated, matches the worked fee-breakdown example', () => {
  const result = calculateEbayFees({
    soldPrice: 14.6,
    sellerType: 'business',
    sellerLevel: 'top_rated',
    promotedFeesPercent: 0,
    vatPercent: 20,
  });

  expect(round2(result.finalFee)).toBe(1.74);
  expect(round2(result.transactionFee)).toBe(0.3);
  expect(round2(result.regulatoryFee)).toBe(0.05);
  expect(round2(result.vat)).toBe(0.42);
  expect(round2(result.totalEbayFee)).toBe(2.51);
});

// With item cost entered equal to the sold price (a break-even purchase),
// Total Profit matches the example's "£-2.51" exactly. Its accompanying
// "-16.73%" margin figure doesn't reconcile with this same input (it implies
// a sold price of ~£15.00, not £14.60), so the two pasted numbers aren't
// from one consistent worked example — this test checks the profit figure
// that *does* match, and documents the margin our formula actually produces.
test('total profit matches the example when item cost equals sold price', () => {
  const fees = calculateEbayFees({
    soldPrice: 14.6,
    sellerType: 'business',
    sellerLevel: 'top_rated',
    promotedFeesPercent: 0,
    vatPercent: 20,
  });
  const { totalProfit, profitMarginPercent } = calculateProfit(14.6, 14.6, fees.totalEbayFee);

  expect(round2(totalProfit)).toBe(-2.51);
  expect(profitMarginPercent).not.toBeNull();
  expect(Number(profitMarginPercent?.toFixed(2))).toBeCloseTo(-17.17, 1);
});

test('below standard seller level adds a 6 percentage point final value fee penalty', () => {
  const topRated = calculateEbayFees({
    soldPrice: 100,
    sellerType: 'business',
    sellerLevel: 'top_rated',
    promotedFeesPercent: 0,
    vatPercent: 20,
  });
  const belowStandard = calculateEbayFees({
    soldPrice: 100,
    sellerType: 'business',
    sellerLevel: 'below_standard',
    promotedFeesPercent: 0,
    vatPercent: 20,
  });

  expect(round2(belowStandard.finalFee - topRated.finalFee)).toBe(6);
});

test('promoted fees are included in the amount VAT is charged on', () => {
  const withoutPromotion = calculateEbayFees({
    soldPrice: 50,
    sellerType: 'business',
    sellerLevel: 'top_rated',
    promotedFeesPercent: 0,
    vatPercent: 20,
  });
  const withPromotion = calculateEbayFees({
    soldPrice: 50,
    sellerType: 'business',
    sellerLevel: 'top_rated',
    promotedFeesPercent: 10,
    vatPercent: 20,
  });

  expect(round2(withPromotion.promotedFee)).toBe(5);
  // VAT should rise by 20% of the £5 promoted fee (£1), not stay flat.
  expect(round2(withPromotion.vat - withoutPromotion.vat)).toBe(1);
});

test('a zero sold price produces zero fees rather than a flat per-order charge', () => {
  const result = calculateEbayFees({
    soldPrice: 0,
    sellerType: 'business',
    sellerLevel: 'top_rated',
    promotedFeesPercent: 0,
    vatPercent: 20,
  });

  expect(result.totalEbayFee).toBe(0);
});
