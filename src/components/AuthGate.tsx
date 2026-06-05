import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  clearAuthSession,
  readAuthSession,
  saveAuthSession,
} from '../utils/authSession';
import './AuthGate.css';

const AUTH_PASSWORD = 'jondjones';

interface AuthContextValue {
  logout: () => void;
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

const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkedStorage, setCheckedStorage] = useState(false);

  useEffect(() => {
    setIsAuthenticated(readAuthSession());
    setCheckedStorage(true);
  }, []);

  const logout = useCallback(() => {
    clearAuthSession();
    setIsAuthenticated(false);
    setPassword('');
    setError(null);
  }, []);

  const authContextValue = useMemo(() => ({ logout }), [logout]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedPassword = password.trim();

    if (trimmedPassword.length === 0) {
      setError('Password is required.');
      return;
    }

    if (trimmedPassword !== AUTH_PASSWORD) {
      setError('Password not recognised.');
      return;
    }

    saveAuthSession();
    setIsAuthenticated(true);
    setPassword('');
    setError(null);
  };

  if (!checkedStorage) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <h2 className="auth-title">Reseller Access</h2>
          <p className="auth-subtitle">Enter the access password to continue.</p>
          <form onSubmit={handleSubmit} className="auth-form">
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder="Password"
              className="auth-input"
              autoComplete="current-password"
              autoFocus
            />
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" className="auth-button">Unlock</button>
          </form>
          <p className="auth-hint">Protected area. Contact Jon if you need access.</p>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={authContextValue}>{children}</AuthContext.Provider>;
};

export default AuthGate;
