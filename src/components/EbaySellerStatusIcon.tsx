import React, { useCallback, useEffect, useState } from 'react';
import { getApiBase, ebayOAuthStartUrl } from '../utils/apiBase';
import './Orders.css';

const API_BASE = getApiBase();

interface EbayOAuthStatus {
  connected: boolean;
  user_name?: string;
  reason?: string;
}

function EbaySellerProfileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={24}
      height={24}
      aria-hidden
      focusable="false"
    >
      <circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="9.25" r="3.1" fill="currentColor" />
      <path
        d="M6.2 18.4c.9-2.8 3.2-4.6 5.8-4.6s4.9 1.8 5.8 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Same connected/disconnected eBay seller icon shown on Orders > Listing Management. */
const EbaySellerStatusIcon: React.FC<{ returnPath: string }> = ({ returnPath }) => {
  const [status, setStatus] = useState<EbayOAuthStatus | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ebay/oauth/status`);
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ connected: false, reason: 'status_fetch_failed' });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const connected = status?.connected === true;

  const reconnect = async () => {
    const confirmed = window.confirm(
      'Clear the stored eBay connection and sign in again?\n\nUse this if you see invalid_grant / refresh token errors.'
    );
    if (!confirmed) return;
    try {
      await fetch(`${API_BASE}/api/ebay/oauth/disconnect`, { method: 'POST' });
    } catch {
      // Still send the user through OAuth; upsert will replace a bad token if disconnect failed.
    }
    window.location.assign(ebayOAuthStartUrl(returnPath));
  };

  return (
    <div className="orders-ebay-seller-status">
      {connected ? (
        <button
          type="button"
          className="orders-ebay-seller-status-icon orders-ebay-seller-status-icon--connected"
          title={
            status?.user_name
              ? `eBay seller linked as ${status.user_name}. Click to clear token and reconnect.`
              : 'eBay seller linked. Click to clear token and reconnect.'
          }
          aria-label={
            status?.user_name
              ? `eBay seller linked as ${status.user_name}. Click to reconnect.`
              : 'eBay seller linked. Click to reconnect.'
          }
          onClick={() => void reconnect()}
        >
          <EbaySellerProfileIcon className="orders-ebay-seller-status-profile" />
        </button>
      ) : (
        <button
          type="button"
          className="orders-ebay-seller-status-icon orders-ebay-seller-status-icon--disconnected"
          title="Connect eBay seller account"
          aria-label="Connect eBay seller account"
          onClick={() => window.location.assign(ebayOAuthStartUrl(returnPath))}
        >
          <EbaySellerProfileIcon className="orders-ebay-seller-status-profile" />
        </button>
      )}
    </div>
  );
};

export default EbaySellerStatusIcon;
