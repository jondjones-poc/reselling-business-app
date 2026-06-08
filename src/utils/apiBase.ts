/** API origin: env, dev default, or same-origin in production. */
export const getApiBase = (): string => {
  const fromEnv = (process.env.REACT_APP_API_BASE || '').trim().replace(/\/$/, '');
  if (process.env.NODE_ENV === 'development') {
    // Optional: hit a remote API from local UI (requires credentials on fetch).
    if (process.env.REACT_APP_FORCE_REMOTE_API === '1' && fromEnv) {
      return fromEnv;
    }
    // Same-origin /api/* — CRA proxy (localhost:3000) or API dev UI (localhost:5003).
    return '';
  }
  if (fromEnv) return fromEnv;
  return '';
};

export const apiUrl = (path: string): string => {
  const base = getApiBase();
  return base ? `${base}${path}` : path;
};

/** Auth routes always use the page origin so session cookies stay same-site (Netlify /api proxy). */
export const sameOriginApiUrl = (path: string): string => {
  if (typeof window !== 'undefined') {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${window.location.origin}${normalized}`;
  }
  return apiUrl(path);
};

export const sameOriginApiFetch = (path: string, init?: RequestInit): Promise<Response> => {
  return fetch(sameOriginApiUrl(path), {
    ...init,
    credentials: 'include',
  });
};

/** Authenticated API requests — always sends session cookies (required when API host differs from UI). */
export const apiFetch = (path: string, init?: RequestInit): Promise<Response> => {
  return fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
  });
};

/** eBay OAuth start — pass return path so postback returns here (needed when RuName callback hits production). */
export const ebayOAuthStartUrl = (returnPath = '/orders?tab=sales'): string => {
  const base = `${getApiBase()}/api/ebay/oauth/start`;
  if (typeof window === 'undefined') return base;
  const returnTo = `${window.location.origin}${returnPath.startsWith('/') ? returnPath : `/${returnPath}`}`;
  return `${base}?return_to=${encodeURIComponent(returnTo)}`;
};
