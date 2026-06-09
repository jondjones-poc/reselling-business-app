/** API origin for building URLs. Production always uses same-origin /api/* (Netlify proxy). */
export const getApiBase = (): string => {
  if (process.env.NODE_ENV === 'development') {
    const fromEnv = (process.env.REACT_APP_API_BASE || '').trim().replace(/\/$/, '');
    // Optional: hit a remote API from local UI (requires credentials on every fetch).
    if (process.env.REACT_APP_FORCE_REMOTE_API === '1' && fromEnv) {
      return fromEnv;
    }
    // Same-origin /api/* — CRA proxy (localhost:3000) or API dev UI (localhost:5003).
    return '';
  }
  // Production: always same-origin. See public/_redirects — do not set REACT_APP_API_BASE on Netlify.
  return '';
};

export const apiUrl = (path: string): string => {
  const base = getApiBase();
  return base ? `${base}${path}` : path;
};

/** Direct API origin for full-page navigations (OAuth redirects). CRA dev server serves index.html for browser GET /api/* instead of proxying. */
export const getAuthFlowApiOrigin = (): string => {
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    const fromEnv = (process.env.REACT_APP_API_BASE || '').trim().replace(/\/$/, '');
    if (fromEnv) return fromEnv;
    return `http://localhost:${process.env.REACT_APP_API_PORT || '5003'}`;
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
};

/** OAuth / full-page API URLs — use API host in dev, same-origin in production. */
export const authFlowApiUrl = (path: string): string => {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    return `${getAuthFlowApiOrigin()}${normalized}`;
  }
  return sameOriginApiUrl(normalized);
};

/** Browser requests to /api/* on the current site (Netlify proxy → Render). Sends session cookies. */
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

/** Authenticated API requests — same-origin in the browser so session cookies are always sent. */
export const apiFetch = (path: string, init?: RequestInit): Promise<Response> => {
  if (typeof window !== 'undefined') {
    return sameOriginApiFetch(path, init);
  }
  return fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
  });
};

/** eBay OAuth start — pass return path so postback returns here (needed when RuName callback hits production). */
export const ebayOAuthStartUrl = (returnPath = '/orders?tab=sales'): string => {
  if (typeof window === 'undefined') return '/api/ebay/oauth/start';
  const returnTo = `${window.location.origin}${returnPath.startsWith('/') ? returnPath : `/${returnPath}`}`;
  return authFlowApiUrl(`/api/ebay/oauth/start?return_to=${encodeURIComponent(returnTo)}`);
};
