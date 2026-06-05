export const AUTH_STORAGE_KEY = 'reseller-auth-token';
export const AUTH_TOKEN_VALUE = 'granted';

export function readAuthSession(): boolean {
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY) === AUTH_TOKEN_VALUE;
  } catch {
    return false;
  }
}

export function saveAuthSession(): void {
  try {
    window.localStorage.setItem(AUTH_STORAGE_KEY, AUTH_TOKEN_VALUE);
  } catch (storageError) {
    console.warn('Unable to persist authentication state:', storageError);
  }
}

export function clearAuthSession(): void {
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (storageError) {
    console.warn('Unable to clear authentication state:', storageError);
  }

  try {
    document.cookie.split(';').forEach((raw) => {
      const name = raw.split('=')[0]?.trim();
      if (!name) return;
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
  } catch (cookieError) {
    console.warn('Unable to clear cookies:', cookieError);
  }
}
