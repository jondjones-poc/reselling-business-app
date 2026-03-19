const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5003';

/** Fire-and-forget request to wake Supabase / keep the DB pool warm. */
export function pingDatabase(): void {
  void fetch(`${API_BASE}/api/db-ping`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }).catch(() => {});
}
