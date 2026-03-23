/** API origin: env, dev default, or same-origin in production. */
export const getApiBase = (): string => {
  const fromEnv = (process.env.REACT_APP_API_BASE || '').trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'development') return 'http://localhost:5003';
  return '';
};

export const apiUrl = (path: string): string => {
  const base = getApiBase();
  return base ? `${base}${path}` : path;
};
