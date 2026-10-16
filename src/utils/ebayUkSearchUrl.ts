/** eBay UK Men's Clothing — matches server EBAY_BROWSE_CATEGORY_IDS default. */
export const EBAY_UK_MENS_CLOTHING_CATEGORY = '260012';

export function buildEbayUkSearchUrl(
  encodedSearch: string,
  opts: { sold: boolean; includeMens: boolean }
): string {
  const categoryPath = opts.includeMens ? `/sch/${EBAY_UK_MENS_CLOTHING_CATEGORY}` : '/sch';
  const fromCategory = opts.includeMens ? '&_from=R40' : '';
  const soldParams = opts.sold ? '&LH_Sold=1&LH_Complete=1' : '';
  return `https://www.ebay.co.uk${categoryPath}/i.html?_nkw=${encodedSearch}${fromCategory}&rt=nc${soldParams}&LH_PrefLoc=1`;
}
