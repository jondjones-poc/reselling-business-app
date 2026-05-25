import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBase } from '../utils/apiBase';
import './ScoutingItemsToSource.css';

const API_BASE = getApiBase();

export type ScoutingSourceItem = {
  id: number;
  title: string;
  notes: string | null;
  is_completed: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

const ScoutingItemsToSource: React.FC = () => {
  const [rows, setRows] = useState<ScoutingSourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/scouting/source-items`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.details || 'Failed to load items');
      }
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load items');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (showAddForm) {
      titleInputRef.current?.focus();
    }
  }, [showAddForm]);

  const closeAddForm = () => {
    setShowAddForm(false);
    setNewTitle('');
    setNewNotes('');
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/scouting/source-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, notes: newNotes.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.details || 'Failed to add item');
      }
      closeAddForm();
      await loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add item');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/scouting/source-items/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.details || 'Failed to delete item');
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  return (
    <div className="scouting-source-page">
      <div className="scouting-source-add-area">
        {!showAddForm ? (
          <button
            type="button"
            className="scouting-source-add-circle"
            onClick={() => setShowAddForm(true)}
            aria-label="Add side quest"
            title="Add side quest"
          >
            +
          </button>
        ) : (
          <form className="scouting-source-add-form" onSubmit={handleAdd}>
            <label className="scouting-source-field">
              <span>What to look for</span>
              <input
                ref={titleInputRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Barbour wax jacket, size M"
                disabled={saving}
                maxLength={200}
              />
            </label>
            <label className="scouting-source-field">
              <span>Notes (optional)</span>
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Max £25, navy only, etc."
                disabled={saving}
                maxLength={500}
              />
            </label>
            <div className="scouting-source-add-actions">
              <button
                type="button"
                className="scouting-source-cancel-btn"
                onClick={closeAddForm}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="scouting-source-save-btn" disabled={saving || !newTitle.trim()}>
                {saving ? 'Adding…' : 'Add quest'}
              </button>
            </div>
          </form>
        )}
      </div>

      {error && (
        <div className="scouting-source-error" role="alert">
          {error}
          {error.toLowerCase().includes('relation') || error.toLowerCase().includes('does not exist') ? (
            <p className="scouting-source-error-hint">
              Run <code>database/scouting_source_item.sql</code> in your database first.
            </p>
          ) : null}
        </div>
      )}

      {loading ? (
        <p className="scouting-source-muted">Loading…</p>
      ) : rows.length > 0 ? (
        <section className="scouting-source-section" aria-label="Side quests">
          <ul className="scouting-source-list">
            {rows.map((row) => (
              <li key={row.id} className="scouting-source-row">
                <div className="scouting-source-row-body">
                  <span className="scouting-source-row-title">{row.title}</span>
                  {row.notes?.trim() ? (
                    <span className="scouting-source-row-notes">{row.notes}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="scouting-source-row-delete"
                  onClick={() => void handleDelete(row.id)}
                  aria-label={`Delete ${row.title}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};

export default ScoutingItemsToSource;
