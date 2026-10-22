import React, { useCallback, useEffect, useState } from 'react';
import { getApiBase } from '../utils/apiBase';
import './EbaySigningKeySettings.css';

const API_BASE = getApiBase();

interface SigningKeyInfo {
  signing_key_id: string;
  signing_key_cipher: string;
  expiration_time: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateKeyResult {
  message: string;
  signingKeyId: string;
  signingKeyCipher: string;
  expirationTime: string | null;
}

const formatDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit' }).format(d);
};

/** One-off eBay "Digital Signatures for APIs" setup — see Accounting > Sync eBay Fees. */
export const EbaySigningKeySettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [existingKey, setExistingKey] = useState<SigningKeyInfo | null>(null);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createResult, setCreateResult] = useState<CreateKeyResult | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setStatusError(null);
    try {
      const res = await fetch(`${API_BASE}/api/accounting/ebay-signing-key`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.details ? `${data?.error} — ${data.details}` : data?.error || 'Failed to load status');
      setExistingKey(data.key || null);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const createSigningKey = async () => {
    const confirmMessage = existingKey
      ? 'This replaces the existing eBay signing key with a new one. The old key stops working for signing immediately. Continue?'
      : 'This creates a new eBay signing keypair for the Finances API. Continue?';
    if (!window.confirm(confirmMessage)) return;
    setCreating(true);
    setCreateError(null);
    setCreateResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/accounting/ebay-signing-key`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.details ? `${data?.error} — ${data.details}` : data?.error || 'Failed to create signing key');
      }
      setCreateResult(data);
      await loadStatus();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create signing key');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="ebay-signing-key-settings">
      <h2>eBay Digital Signature</h2>
      <p className="ebay-signing-key-muted">
        eBay requires signed requests for the Finances API (needed by Accounting &gt; Sync eBay Fees). This is a
        one-off setup: create a signing key here and it's used automatically for every future sync — no further
        action needed unless the key expires or you need to rotate it.
      </p>

      {loading ? (
        <p className="ebay-signing-key-muted">Loading status…</p>
      ) : statusError ? (
        <div className="stock-error">{statusError}</div>
      ) : existingKey ? (
        <dl className="ebay-signing-key-summary">
          <div>
            <dt>Status</dt>
            <dd>Configured</dd>
          </div>
          <div>
            <dt>Key ID</dt>
            <dd>{existingKey.signing_key_id}</dd>
          </div>
          <div>
            <dt>Cipher</dt>
            <dd>{existingKey.signing_key_cipher}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDate(existingKey.created_at)}</dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{formatDate(existingKey.expiration_time)}</dd>
          </div>
        </dl>
      ) : (
        <div className="ebay-signing-key-summary">
          <p>No signing key has been created yet.</p>
        </div>
      )}

      <div className="ebay-signing-key-button-row">
        <button type="button" className="new-entry-button" onClick={createSigningKey} disabled={creating}>
          {creating ? 'Creating…' : existingKey ? 'Rotate Signing Key' : 'Create Signing Key'}
        </button>
      </div>
      {createError && <div className="stock-error">{createError}</div>}
      {createResult && <div className="stock-success">{createResult.message}</div>}
    </div>
  );
};

export default EbaySigningKeySettings;
