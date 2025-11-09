import React, { useEffect, useState } from 'react';
import './AuthGate.css';

const AUTH_STORAGE_KEY = 'reseller-auth-token';
const AUTH_TOKEN_VALUE = 'granted';
const AUTH_PASSWORD = 'jondjones';

interface AuthGateProps {
  children: React.ReactNode;
}

const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkedStorage, setCheckedStorage] = useState(false);

  useEffect(() => {
    try {
      const storedToken = window.localStorage.getItem(AUTH_STORAGE_KEY);
      if (storedToken === AUTH_TOKEN_VALUE) {
        setIsAuthenticated(true);
      }
    } catch (storageError) {
      console.warn('Unable to read authentication state:', storageError);
    } finally {
      setCheckedStorage(true);
    }
  }, []);

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

    try {
      window.localStorage.setItem(AUTH_STORAGE_KEY, AUTH_TOKEN_VALUE);
    } catch (storageError) {
      console.warn('Unable to persist authentication state:', storageError);
    }

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

  return <>{children}</>;
};

export default AuthGate;
