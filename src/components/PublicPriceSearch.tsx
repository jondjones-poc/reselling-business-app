import React, { useEffect, useState } from 'react';
import { augmentEbaySearchQuery } from '../utils/augmentEbaySearchQuery';
import { buildEbayUkSearchUrl } from '../utils/ebayUkSearchUrl';
import { useAuth } from './AuthGate';
import './EbaySearch.css';
import './AuthGate.css';
import './PublicPriceSearch.css';

const SEARCH_TERM_STORAGE_KEY = 'searchTerm';

/**
 * No-login price lookup: just the search box + Search Solds / Search Actives /
 * copy-to-clipboard actions from EbaySearch, for quick use before signing in
 * (e.g. while the backend is cold-starting).
 */
const PublicPriceSearch: React.FC = () => {
  const { signingIn, signInWithGoogle } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SEARCH_TERM_STORAGE_KEY);
      if (saved) setSearchTerm(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const hasSearchableInput = searchTerm.trim().length > 0;

  const persistSearchTerm = () => {
    try {
      window.localStorage.setItem(SEARCH_TERM_STORAGE_KEY, searchTerm);
    } catch {
      /* ignore */
    }
  };

  const openEbaySearch = (sold: boolean) => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    persistSearchTerm();
    const combined = augmentEbaySearchQuery(trimmed, { phraseWrap: false, appendMens: true });
    const encodedSearch = encodeURIComponent(combined);
    const url = buildEbayUkSearchUrl(encodedSearch, { sold, includeMens: true });
    window.open(url, '_blank');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    openEbaySearch(true);
  };

  const handleSearchActives = () => {
    openEbaySearch(false);
  };

  const handleCopyToClipboard = async () => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return;
    const combined = augmentEbaySearchQuery(trimmed, { phraseWrap: false, appendMens: true });
    try {
      await navigator.clipboard.writeText(combined);
    } catch (err) {
      console.warn('Clipboard write failed:', err);
    }
  };

  return (
    <div className="public-price-search">
      <div className="ebay-search-container">
        <form onSubmit={handleSubmit} className="ebay-search-form">
          <div className="ebay-search-query-block">
            <div className="search-bar-group">
              <div className="search-input-wrapper">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Enter search term..."
                  className="ebay-search-input"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="reset-icon-button"
                  disabled={!hasSearchableInput}
                  title="Reset"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="primary-action-row">
              <button type="submit" className="ebay-search-button" disabled={!hasSearchableInput}>
                Search Solds
              </button>
              <button
                type="button"
                onClick={handleSearchActives}
                className="ebay-search-button"
                disabled={!hasSearchableInput}
              >
                Search Actives
              </button>
              <div className="primary-action-row__duo">
                <button
                  type="button"
                  onClick={handleCopyToClipboard}
                  className="copy-button copy-button--icon-only"
                  disabled={!hasSearchableInput}
                  title="Copy eBay search query"
                  aria-label="Copy eBay search query to clipboard"
                >
                  <span aria-hidden>📋</span>
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>

      <div className="public-price-search-login">
        <p className="public-price-search-login__hint">Sign in for full stock, orders &amp; analytics tools.</p>
        <button
          type="button"
          className="auth-button auth-button--google"
          onClick={signInWithGoogle}
          disabled={signingIn}
        >
          <span className="auth-button__icon" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                fill="#EA4335"
              />
            </svg>
          </span>
          {signingIn ? 'Redirecting to Google…' : 'Log in'}
        </button>
      </div>
    </div>
  );
};

export default PublicPriceSearch;
