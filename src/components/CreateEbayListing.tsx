import React, { useRef, useState } from 'react';
import { apiFetch, ebayOAuthStartUrl } from '../utils/apiBase';
import { importVintedZip, ImportedListing } from '../utils/vintedZipImport';
import './CreateEbayListing.css';

export default function CreateEbayListing() {
  const [listing, setListing] = useState<ImportedListing | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ taskId: string; sku: string } | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [conditionId, setConditionId] = useState('');
  const [needsConnection, setNeedsConnection] = useState(false);
  const submitting = useRef(false);
  async function choose(file?: File) {
    if (!file) return;
    setListing(null); setResult(null); setError(''); setReading(true);
    try {
      if (file.size > 60 * 1024 * 1024) throw new Error('Choose a ZIP smaller than 60 MB.');
      setListing(await importVintedZip(await file.arrayBuffer()));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read this ZIP.'); }
    finally { setReading(false); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!listing || submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNeedsConnection(false);
    try {
      const response = await apiFetch('/api/ebay/listing-drafts/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...listing, categoryId, conditionId }),
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
  const update = (field: 'sku' | 'title' | 'description' | 'price', value: string) => setListing(prev => prev ? { ...prev, [field]: value } : prev);
  return <section className="create-ebay-listing" aria-label="Create eBay Listing">
    <h2>Create eBay Listing</h2>
    <p>Choose a Vinted ZIP and send its details to an eBay Seller Hub draft. Your stock SKU becomes the eBay custom label.</p>
    <label className="create-ebay-file">Vinted listing ZIP
      <input type="file" accept=".zip,application/zip" disabled={busy || reading} onChange={event => { void choose(event.target.files?.[0]); event.target.value = ''; }} />
    </label>
    {reading && <p role="status">Reading listing and photos…</p>}
    {error && <div className="stock-error" role="alert">{error}</div>}
    {needsConnection && <a href={ebayOAuthStartUrl('/tools?tab=create-ebay-listing')}>Connect or reconnect eBay</a>}
    {result ? <div className="stock-success" role="status">
      Draft upload submitted for SKU {result.sku}. eBay normally processes it within 15 minutes. It has not been published.
      <p><a href="https://www.ebay.co.uk/sh/lst/drafts" target="_blank" rel="noreferrer">Open eBay Seller Hub Drafts</a></p>
    </div> : listing && <form onSubmit={create}>
      <fieldset disabled={busy}>
        <div className="create-ebay-fields">
          <label>SKU<input required maxLength={50} value={listing.sku} onChange={e => update('sku', e.target.value)} /></label>
          <label>Price (£)<input required type="number" min="0.01" step="0.01" value={listing.price} onChange={e => update('price', e.target.value)} /></label>
          <label>eBay category ID<input required inputMode="numeric" value={categoryId} onChange={e => setCategoryId(e.target.value)} /></label>
          <label>Condition ID (optional)<input value={conditionId} onChange={e => setConditionId(e.target.value)} /></label>
          <label className="create-ebay-wide">Title<input required maxLength={80} value={listing.title} onChange={e => update('title', e.target.value)} /></label>
          <label className="create-ebay-wide">Description<textarea required rows={7} maxLength={4000} value={listing.description} onChange={e => update('description', e.target.value)} /></label>
        </div>
        {listing.specifics.length > 0 && <details><summary>Imported item details</summary><ul>{listing.specifics.map((s, i) => <li key={i}>{s.name}: {s.value}</li>)}</ul></details>}
        <p>{listing.images.length} ZIP photos are kept on your computer. Add them after opening the eBay draft.</p>
        <p>eBay requires the category ID. You can complete images, condition, postage, returns and eBay AI suggestions in Seller Hub before publishing.</p>
        <button className="new-entry-button" type="submit">{busy ? 'Submitting eBay draft…' : 'Create eBay draft'}</button>
      </fieldset>
      {busy && <p role="status">Submitting the draft to eBay…</p>}
    </form>}
  </section>;
}
