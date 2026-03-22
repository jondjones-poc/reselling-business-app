const ALREADY_HAS_MENS = /\bmen'?s\b|\bmens\b/i;

export type EbayQueryAugmentOptions = {
  /** Double-quote full query (brand research / sold comps on server only). Homepage: false. */
  phraseWrap?: boolean;
  /** Append `mens` when not already in the string. */
  appendMens?: boolean;
};

/**
 * Homepage eBay search: use `{ phraseWrap: false, appendMens }`.
 * Phrase wrapping is for Research brand solds on the server only.
 */
export function augmentEbaySearchQuery(raw: string, options: EbayQueryAugmentOptions = {}): string {
  const phraseWrap = options.phraseWrap === true;
  const appendMens = options.appendMens !== false;

  let q = raw.trim();
  if (!q) return q;
  if (q.length >= 2 && q.startsWith('"') && q.endsWith('"')) {
    q = q.slice(1, -1).trim();
  }
  q = q.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q) return '';
  if (appendMens && !ALREADY_HAS_MENS.test(q)) {
    q = `${q} mens`;
  }
  if (phraseWrap) {
    return `"${q}"`;
  }
  return q;
}
