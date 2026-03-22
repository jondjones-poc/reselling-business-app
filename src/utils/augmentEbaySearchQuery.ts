const ALREADY_HAS_MENS = /\bmen'?s\b|\bmens\b/i;

/**
 * Phrase-wraps the query for eBay (Browse + site search): multi-word brands match as one phrase
 * with mens appended when needed, reducing unrelated hits (e.g. "All" in other titles).
 */
export function augmentEbaySearchQuery(raw: string): string {
  let q = raw.trim();
  if (!q) return q;
  if (q.length >= 2 && q.startsWith('"') && q.endsWith('"')) {
    q = q.slice(1, -1).trim();
  }
  q = q.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return '';
  if (!ALREADY_HAS_MENS.test(q)) {
    q = `${q} mens`;
  }
  return `"${q}"`;
}
