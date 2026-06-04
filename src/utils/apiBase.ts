/** API origin: env, dev default, or same-origin in production. */
export const getApiBase = (): string => {
  const fromEnv = (process.env.REACT_APP_API_BASE || '').trim().replace(/\/$/, '');
  if (process.env.NODE_ENV === 'development') {
    // npm run dev always talks to the local API unless you opt into remote explicitly.
    if (process.env.REACT_APP_FORCE_REMOTE_API === '1' && fromEnv) {
      return fromEnv;
    }
    return 'http://localhost:5003';
  }
  if (fromEnv) return fromEnv;
  return '';
};

export const apiUrl = (path: string): string => {
  const base = getApiBase();
  return base ? `${base}${path}` : path;
};

/** eBay OAuth start — pass return path so postback returns here (needed when RuName callback hits production). */
export const ebayOAuthStartUrl = (returnPath = '/orders?tab=sales'): string => {
  const base = `${getApiBase()}/api/ebay/oauth/start`;
  if (typeof window === 'undefined') return base;
  const returnTo = `${window.location.origin}${returnPath.startsWith('/') ? returnPath : `/${returnPath}`}`;
  return `${base}?return_to=${encodeURIComponent(returnTo)}`;
};
