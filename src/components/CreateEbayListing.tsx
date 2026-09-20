import React, { useEffect, useRef, useState } from 'react';
import { apiFetch, ebayOAuthStartUrl } from '../utils/apiBase';
import { importVintedZip, ImportedListing } from '../utils/vintedZipImport';
import './CreateEbayListing.css';

/**
 * Location and the three Business Policy names are account-level constants
 * (the same for basically every draft this seller creates), unlike title/
 * price/category which change per item — so they're remembered in
 * localStorage rather than retyped every time, the same pattern
 * ImageRemover.tsx already uses for its logo. Poole is this seller's actual
 * dispatch town, used as the starting default before anything is saved.
 */
const STORAGE_KEY = 'createEbayListing.sellerDefaults';

// eBay's condition IDs are a fixed global enum (not account/category-specific
// like Business Policies or the category tree), so this is hardcoded rather
// than fetched. "Used" (3000) is the default since this app is for resale of
// secondhand clothing — nearly every item is used.
const EBAY_CONDITIONS = [
  { id: '1000', name: 'New' },
  { id: '1500', name: 'New other' },
  { id: '3000', name: 'Used' },
  { id: '7000', name: 'For parts or not working' },
];

type SellerDefaults = { location: string; paymentPolicyName: string; shippingPolicyName: string; returnPolicyName: string };

// Strips characters Windows/macOS forbid in filenames, and collapses the
// whitespace left behind, so the eBay title can be used directly as the
// downloaded file's name.
function safeFilenameFromTitle(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function loadSellerDefaults(): SellerDefaults {
  const fallback: SellerDefaults = { location: 'Poole', paymentPolicyName: '', shippingPolicyName: '', returnPolicyName: '' };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {
    // Private browsing can block storage; the fields just start at the fallback.
  }
  return fallback;
}

export default function CreateEbayListing() {
  const [listing, setListing] = useState<ImportedListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ taskId: string; sku: string; photoCount?: number } | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [categoriesError, setCategoriesError] = useState('');
  // "3000" = Used/Pre-owned — eBay confirmed condition is required for most
  // clothing categories, and this is a resale-clothing app where nearly
  // every item is secondhand, so it's a sensible default rather than
  // leaving this blank and hitting the same error on every submission.
  const [conditionId, setConditionId] = useState('3000');
  const [needsConnection, setNeedsConnection] = useState(false);
  const [sellerDefaults, setSellerDefaults] = useState(loadSellerDefaults);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policiesError, setPoliciesError] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState('');
  const submitting = useRef(false);

  function updateSellerDefault(field: keyof SellerDefaults, value: string) {
    setSellerDefaults(prev => {
      const next = { ...prev, [field]: value };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Nothing to do; the in-memory value is still updated for this session.
      }
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPoliciesLoading(true); setPoliciesError('');
      try {
        const response = await apiFetch('/api/ebay/business-policies');
        const text = await response.text();
        let data: {
          paymentPolicies?: { name: string }[];
          shippingPolicies?: { name: string }[];
          returnPolicies?: { name: string }[];
          error?: string;
          needsAccountScope?: boolean;
          notEligibleForBusinessPolicyApi?: boolean;
        } = {};
        try { data = JSON.parse(text); } catch { /* ignore unparseable body */ }
        if (cancelled) return;
        if (!response.ok) {
          if (data.needsAccountScope) setNeedsConnection(true);
          setPoliciesError(data.error || 'Could not fetch your eBay Business Policies — fill them in below yourself.');
          return;
        }
        if (data.notEligibleForBusinessPolicyApi) {
          setPoliciesError(
            "eBay says this account isn't set up for automatic Business Policy lookup — copy the names from Seller Hub → Account → Business Policies into the fields below."
          );
          return;
        }
        // Only fill in fields the seller hasn't already set/saved themselves.
        setSellerDefaults(prev => {
          const next = { ...prev };
          if (!next.paymentPolicyName && data.paymentPolicies?.[0]?.name) next.paymentPolicyName = data.paymentPolicies[0].name;
          if (!next.shippingPolicyName && data.shippingPolicies?.[0]?.name) next.shippingPolicyName = data.shippingPolicies[0].name;
          if (!next.returnPolicyName && data.returnPolicies?.[0]?.name) next.returnPolicyName = data.returnPolicies[0].name;
          try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      } catch {
        if (!cancelled) setPoliciesError('Could not reach eBay for your Business Policies — fill them in below yourself.');
      } finally {
        if (!cancelled) setPoliciesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch('/api/ebay/categories/top-level');
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || 'Could not fetch eBay categories.');
        setCategories(Array.isArray(data.categories) ? data.categories : []);
      } catch (e) {
        if (!cancelled) setCategoriesError(e instanceof Error ? e.message : 'Could not fetch eBay categories.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function fileToBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
    }
    return btoa(binary);
  }

  async function choose(file?: File) {
    if (!file) return;
    setListing(null); setResult(null); setError(''); setReading(true);
    try {
      if (file.size > 60 * 1024 * 1024) throw new Error('Choose a ZIP smaller than 60 MB.');
      setListing(await importVintedZip(await file.arrayBuffer()));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read this ZIP.'); }
    finally { setReading(false); }
  }
  async function listingPayload() {
    if (!listing) return null;
    // listing.images are File objects — JSON.stringify would silently
    // drop them (they serialize to `{}`), so they're base64-encoded here
    // and sent under a separate `images` key the server actually reads.
    const images = await Promise.all(
      listing.images.map(async file => ({ name: file.name, type: file.type, dataBase64: await fileToBase64(file) }))
    );
    const { images: _zipImages, ...listingFields } = listing;
    return { ...listingFields, categoryId, conditionId, ...sellerDefaults, images };
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!listing || submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNeedsConnection(false);
    try {
      const response = await apiFetch('/api/ebay/listing-drafts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(await listingPayload()),
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('eBay did not confirm the draft upload.'); }
      if (!response.ok) {
        setNeedsConnection(response.status === 401 || response.status === 403 || data.code === 'EBAY_USER_TOKEN_MISSING');
        throw new Error(data.error || 'Could not create the eBay draft.');
      }
      setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create the draft.'); }
    finally { submitting.current = false; setBusy(false); }
  }

  async function downloadManualCsv() {
    if (!listing || manualBusy) return;
    setManualBusy(true); setManualError('');
    try {
      const response = await apiFetch('/api/ebay/listing-drafts/export-csv', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(await listingPayload()),
      });
      if (!response.ok) {
        let message = 'Could not build the draft CSV.';
        try { message = (await response.json()).error || message; } catch { /* non-JSON error body */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeFilenameFromTitle(listing.title) || listing.sku} Import File.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) { setManualError(e instanceof Error ? e.message : 'Could not build the draft CSV.'); }
    finally { setManualBusy(false); }
  }
  const update = (field: 'sku' | 'title' | 'description' | 'price', value: string) => setListing(prev => prev ? { ...prev, [field]: value } : prev);

  function clearForm() {
    setListing(null); setResult(null); setError(''); setNeedsConnection(false);
    setCategoryId(''); setConditionId('3000'); setManualError('');
  }
  return <section className="create-ebay-listing" aria-label="Create eBay Listing">
    <label className="create-ebay-file" aria-label="Vinted listing ZIP">
      <span className="create-ebay-file-icon" aria-hidden="true">📦</span>
      <span className="create-ebay-file-text">Choose a ZIP file</span>
      <input type="file" accept=".zip,application/zip" disabled={busy || reading} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
    </label>
    {reading && <p role="status">Reading listing and photos…</p>}
    {error && <div className="stock-error" role="alert">{error}</div>}
    {needsConnection && <a href={ebayOAuthStartUrl('/tools?tab=create-ebay-listing')}>Connect or reconnect eBay</a>}
    {result ? <div className="stock-success" role="status">
      Draft upload submitted for SKU {result.sku} with {result.photoCount ?? 0} photo{result.photoCount === 1 ? '' : 's'} from your ZIP. eBay normally processes it within 15 minutes. It has not been published.
      <p><a href="https://www.ebay.co.uk/sh/lst/drafts" target="_blank" rel="noreferrer">Open eBay Seller Hub Drafts</a></p>
    </div> : listing && <form onSubmit={create}>
      <fieldset disabled={busy}>
        <div className="create-ebay-fields">
          <label>SKU<input required maxLength={50} value={listing.sku} onChange={e => update('sku', e.target.value)} /></label>
          <label>Price (£)<input required type="number" min="0.01" step="0.01" value={listing.price} onChange={e => update('price', e.target.value)} /></label>
          <label>eBay category
            {categoriesError ? (
              <input required inputMode="numeric" placeholder="Category ID" value={categoryId} onChange={e => setCategoryId(e.target.value)} />
            ) : (
              <select required value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="" disabled>{categories.length > 0 ? 'Choose a category…' : 'Loading categories…'}</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </label>
          <label>Condition
            <select required value={conditionId} onChange={e => setConditionId(e.target.value)}>
              {EBAY_CONDITIONS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="create-ebay-wide">
            Title
            {listing.title && (
              <span className={`create-ebay-char-count ${listing.title.length > 80 ? 'create-ebay-char-count--over' : 'create-ebay-char-count--ok'}`}>
                ({listing.title.length}/80)
              </span>
            )}
            <input required maxLength={80} value={listing.title} onChange={e => update('title', e.target.value)} />
          </label>
          <label className="create-ebay-wide">Description<textarea required rows={7} maxLength={4000} value={listing.description} onChange={e => update('description', e.target.value)} /></label>
        </div>
        <p>{listing.images.length} ZIP photo{listing.images.length === 1 ? '' : 's'} will be uploaded and used on the draft directly.</p>
        <div className="create-ebay-defaults">
          {policiesLoading && <p role="status">Fetching your eBay account defaults…</p>}
          <div className="create-ebay-defaults-body">
            {policiesError && <p className="create-ebay-defaults-warning">{policiesError}</p>}
            <div className="create-ebay-fields">
              <label>Item location (town/city or postcode)<input required value={sellerDefaults.location} onChange={e => updateSellerDefault('location', e.target.value)} /></label>
              <label>Payment policy name (optional)<input value={sellerDefaults.paymentPolicyName} onChange={e => updateSellerDefault('paymentPolicyName', e.target.value)} /></label>
              <label>Shipping policy name (required)<input required value={sellerDefaults.shippingPolicyName} onChange={e => updateSellerDefault('shippingPolicyName', e.target.value)} /></label>
              <label>Return policy name (optional)<input value={sellerDefaults.returnPolicyName} onChange={e => updateSellerDefault('returnPolicyName', e.target.value)} /></label>
            </div>
          </div>
        </div>
      </fieldset>
      <div className="create-ebay-actions">
        <button type="button" className="new-entry-button" disabled={manualBusy} onClick={() => void downloadManualCsv()}>
          {manualBusy ? 'Building CSV…' : 'Generate Import File'}
        </button>
        <button className="new-entry-button" type="submit" disabled={busy}>{busy ? 'Submitting eBay draft…' : 'Generate Via API'}</button>
      </div>
      {busy && <p role="status">Submitting the draft to eBay…</p>}
      {manualError && <div className="stock-error" role="alert">{manualError}</div>}
      <div className="create-ebay-actions">
        <button type="button" className="create-ebay-clear-button" onClick={clearForm}>Clear</button>
      </div>
    </form>}
  </section>;
}
