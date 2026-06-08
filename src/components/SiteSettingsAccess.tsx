import React, { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../utils/apiBase';
import './SiteSettingsAccess.css';

type AuthUserRole = 'admin' | 'user';

type AllowedEmailRow = {
  id: number;
  email: string;
  role: AuthUserRole;
  created_at?: string;
  updated_at?: string;
};

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`HTTP ${response.status}`);
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(trimmed || `HTTP ${response.status}`);
  }
}

function roleLabel(role: AuthUserRole): string {
  return role === 'admin' ? 'Admin' : 'User';
}

export const SiteSettingsAccess: React.FC = () => {
  const [rows, setRows] = useState<AllowedEmailRow[]>([]);
  const [envAdmins, setEnvAdmins] = useState<string[]>([]);
  const [envAllowed, setEnvAllowed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<number | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [roleDraft, setRoleDraft] = useState<AuthUserRole>('user');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl('/api/auth/admin/allowed-emails'), {
        credentials: 'include',
      });
      const data = await readJsonResponse<{
        rows?: AllowedEmailRow[];
        envAdmins?: string[];
        envAllowed?: string[];
        error?: string;
      }>(response);
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setEnvAdmins(Array.isArray(data.envAdmins) ? data.envAdmins : []);
      setEnvAllowed(Array.isArray(data.envAllowed) ? data.envAllowed : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load access settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const email = emailDraft.trim();
    if (!email) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(apiUrl('/api/auth/admin/allowed-emails'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: roleDraft }),
      });
      const data = await readJsonResponse<{ row?: AllowedEmailRow; error?: string }>(response);
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setEmailDraft('');
      setRoleDraft('user');
      setMessage(`Added ${data.row?.email ?? email} as ${roleLabel(data.row?.role ?? roleDraft)}.`);
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add email.');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (id: number, role: AuthUserRole) => {
    setUpdatingRoleId(id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(apiUrl(`/api/auth/admin/allowed-emails/${id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const data = await readJsonResponse<{ row?: AllowedEmailRow; error?: string }>(response);
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setMessage(`Updated ${data.row?.email ?? 'user'} to ${roleLabel(role)}.`);
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update role.');
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(apiUrl(`/api/auth/admin/allowed-emails/${id}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setMessage('Removed allowed email.');
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove email.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="site-settings-access">
      <div className="site-settings-access-intro">
        <h3 className="site-settings-access-title">Access control</h3>
        <p className="site-settings-access-hint">
          Only Google accounts on this allowlist can sign in. <strong>Admin</strong> users can manage this
          list; <strong>User</strong> accounts can use the app but cannot see these settings.
        </p>
      </div>

      {error ? (
        <div className="site-settings-access-error" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="site-settings-access-success" role="status">
          {message}
        </div>
      ) : null}

      {(envAdmins.length > 0 || envAllowed.length > 0) && (
        <section className="site-settings-access-env" aria-label="Environment access rules">
          {envAdmins.length > 0 ? (
            <div className="site-settings-access-env-block">
              <h4 className="site-settings-access-subtitle">Server admins (env)</h4>
              <ul className="site-settings-access-env-list">
                {envAdmins.map((email) => (
                  <li key={`admin-${email}`}>
                    {email} <span className="site-settings-access-role-badge">Admin</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {envAllowed.length > 0 ? (
            <div className="site-settings-access-env-block">
              <h4 className="site-settings-access-subtitle">Env allowlist</h4>
              <ul className="site-settings-access-env-list">
                {envAllowed.map((email) => (
                  <li key={`env-${email}`}>{email}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      )}

      <form className="site-settings-access-add" onSubmit={handleAdd}>
        <label className="site-settings-access-field">
          <span>Add allowed email</span>
          <input
            type="email"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            placeholder="user@gmail.com"
            autoComplete="off"
            disabled={saving}
          />
        </label>
        <label className="site-settings-access-field site-settings-access-field--role">
          <span>Role</span>
          <select
            value={roleDraft}
            onChange={(e) => setRoleDraft(e.target.value as AuthUserRole)}
            disabled={saving}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" className="site-settings-access-add-btn" disabled={saving || !emailDraft.trim()}>
          {saving ? 'Adding…' : 'Add user'}
        </button>
      </form>

      <section className="site-settings-access-list-wrap" aria-label="Allowed sign-in emails">
        <h4 className="site-settings-access-subtitle">Allowed users</h4>
        {loading ? (
          <p className="site-settings-access-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="site-settings-access-muted">
            No users in the database allowlist yet. Add one above, or set <code>ALLOWED_AUTH_EMAILS</code> in
            server env.
          </p>
        ) : (
          <ul className="site-settings-access-list">
            {rows.map((row) => (
              <li key={row.id} className="site-settings-access-row">
                <div className="site-settings-access-row-main">
                  <span className="site-settings-access-row-email">{row.email}</span>
                  <label className="site-settings-access-role-field">
                    <span className="site-settings-access-role-field-label">Role</span>
                    <select
                      value={row.role || 'user'}
                      onChange={(e) => void handleRoleChange(row.id, e.target.value as AuthUserRole)}
                      disabled={updatingRoleId === row.id || deletingId === row.id}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  className="site-settings-access-remove-btn"
                  onClick={() => void handleDelete(row.id)}
                  disabled={deletingId === row.id || updatingRoleId === row.id}
                >
                  {deletingId === row.id ? 'Removing…' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
