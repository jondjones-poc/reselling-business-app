import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { clearAuthSession } from '../utils/authSession';
import { sameOriginApiFetch, authFlowApiUrl } from '../utils/apiBase';
import { ThemeProvider } from '../context/ThemeContext';
import './AuthGate.css';

interface AuthContextValue {
  logout: () => void;
  userEmail: string | null;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthGate');
  }
  return value;
}

interface AuthGateProps {
  children: React.ReactNode;
}

function parseAuthHash(): {
  access_token?: string;
  refresh_token?: string;
  expires_in?: string;
} {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return {};
  const params = new URLSearchParams(hash);
  return {
    access_token: params.get('access_token') || undefined,
    refresh_token: params.get('refresh_token') || undefined,
    expires_in: params.get('expires_in') || undefined,
  };
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`HTTP ${response.status}`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(trimmed || `HTTP ${response.status}`);
  }
}

const SESSION_RETRY_ATTEMPTS = 5;
const SESSION_RETRY_BASE_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Post-OAuth landing URL — always app root so hash tokens are read by the SPA. */
function getOAuthReturnTo(): string {
  return `${window.location.origin}/`;
}

const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < SESSION_RETRY_ATTEMPTS; attempt++) {
      const response = await sameOriginApiFetch('/api/auth/session');

      if (response.status === 503) {
        let transient = false;
        try {
          const data = await readJsonResponse<{ transient?: boolean }>(response);
          transient = Boolean(data.transient);
        } catch {
          transient = true;
        }
        if (transient && attempt < SESSION_RETRY_ATTEMPTS - 1) {
          await sleep(SESSION_RETRY_BASE_MS * (attempt + 1));
          continue;
        }
        setError('Session check temporarily unavailable. Please try again in a moment.');
        return false;
      }

      if (response.status === 401) {
        setUserEmail(null);
        setIsAdmin(false);
        return false;
      }

      const data = await readJsonResponse<{
        authenticated?: boolean;
        email?: string | null;
        error?: string;
        isAdmin?: boolean;
      }>(response);

      if (!response.ok || !data.authenticated) {
        setUserEmail(null);
        setIsAdmin(false);
        if (data.error) setError(data.error);
        return false;
      }

      setUserEmail(data.email ?? null);
      setIsAdmin(Boolean(data.isAdmin));
      setError(null);
      return true;
    }

    setError('Session check temporarily unavailable. Please try again in a moment.');
    return false;
  }, []);

  useEffect(() => {
    const { pathname, hash, origin } = window.location;
    if (pathname.startsWith('/api/')) {
      window.location.replace(`${origin}${hash || '/'}`);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const hashTokens = parseAuthHash();
        if (hashTokens.access_token && hashTokens.refresh_token) {
          const establishResponse = await sameOriginApiFetch('/api/auth/establish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              access_token: hashTokens.access_token,
              refresh_token: hashTokens.refresh_token,
              expires_in: hashTokens.expires_in,
            }),
          });

          const establishData = await readJsonResponse<{ authenticated?: boolean; email?: string | null; error?: string; isAdmin?: boolean }>(
            establishResponse
          );

          if (!establishResponse.ok || !establishData.authenticated) {
            if (!cancelled) {
              setError(establishData.error || 'Sign-in failed.');
              setUserEmail(null);
              setIsAdmin(false);
            }
            return;
          }

          window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);

          if (!cancelled) {
            setUserEmail(establishData.email ?? null);
            setIsAdmin(Boolean(establishData.isAdmin));
            setError(null);
          }
          return;
        }

        await loadSession();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to check sign-in status.');
          setUserEmail(null);
          setIsAdmin(false);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  const logout = useCallback(async () => {
    clearAuthSession();
    setUserEmail(null);
    setIsAdmin(false);
    setError(null);
    try {
      await sameOriginApiFetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Logout request failed:', err);
    }
  }, []);

  const authContextValue = useMemo(() => ({ logout, userEmail, isAdmin }), [logout, userEmail, isAdmin]);

  const handleGoogleSignIn = () => {
    setSigningIn(true);
    setError(null);
    const returnTo = getOAuthReturnTo();
    window.location.href = authFlowApiUrl(
      `/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`
    );
  };

  if (!authReady) {
    return (
      <div className="auth-gate auth-gate--loading">
        <div className="auth-loading" role="status" aria-live="polite">
          <span className="auth-loading__spinner" aria-hidden />
          Loading…
        </div>
      </div>
    );
  }

  if (!userEmail) {
    return (
      <div className="auth-gate">
        <div className="auth-gate__glow auth-gate__glow--left" aria-hidden />
        <div className="auth-gate__glow auth-gate__glow--right" aria-hidden />

        <div className="auth-shell">
          <section className="auth-brand" aria-label="Gents Rail">
            <p className="auth-brand__eyebrow">Reseller workspace</p>
            <h1 className="auth-brand__name">Gents Rail</h1>
            <p className="auth-brand__tagline">
              Source smarter, manage stock, and track performance across your resale business.
            </p>
            <ul className="auth-brand__features">
              <li>Scouting &amp; image lookup</li>
              <li>Stock, orders &amp; accounting</li>
              <li>Reporting &amp; analytics</li>
            </ul>
          </section>

          <main className="auth-card">
            <h2 className="auth-title">Welcome back</h2>
            <p className="auth-subtitle">Sign in with your Google account to continue.</p>

            <div className="auth-form">
              <button
                type="button"
                className="auth-button auth-button--google"
                onClick={handleGoogleSignIn}
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
                {signingIn ? 'Redirecting to Google…' : 'Continue with Google'}
              </button>
              {error && <div className="auth-error">{error}</div>}
            </div>

            <footer className="auth-footer">
              <span className="auth-footer__badge">Private workspace</span>
            </footer>
          </main>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={authContextValue}>
      <ThemeProvider syncWithServer>{children}</ThemeProvider>
    </AuthContext.Provider>
  );
};

export default AuthGate;
