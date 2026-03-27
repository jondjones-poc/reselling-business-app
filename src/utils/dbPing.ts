import { getApiBase } from './apiBase';

/** Fire-and-forget request to wake Supabase / keep the DB pool warm. */
export function pingDatabase(): void {
  const API_BASE = getApiBase();
  void fetch(`${API_BASE}/api/db-ping`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }).catch(() => {});
}
