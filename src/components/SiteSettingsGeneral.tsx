import React, { useEffect, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import '../react-datepicker-dark.css';
import {
  COLOR_SCHEME_OPTIONS,
  type ColorSchemeId,
  useTheme,
} from '../context/ThemeContext';
import { useAuth } from './AuthGate';
import { getApiBase } from '../utils/apiBase';
import './SiteSettingsGeneral.css';

const API_BASE = getApiBase();

interface AccountingSettings {
  companyName: string;
  companyNumber: string;
  accountingPeriodStart: string;
  accountingPeriodEnd: string;
  vatTreatment: string;
  vatEffectiveDate: string;
}

function toIsoDateOnly(date: Date | null): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDateOnly(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export const SiteSettingsGeneral: React.FC = () => {
  const { logout } = useAuth();
  const { colorScheme, setColorScheme, themeLoading, themeSaving, themeError } = useTheme();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [accountingSettings, setAccountingSettings] = useState<AccountingSettings>({
    companyName: '',
    companyNumber: '',
    accountingPeriodStart: '',
    accountingPeriodEnd: '',
    vatTreatment: 'not-registered',
    vatEffectiveDate: '',
  });
  const [accountingLoading, setAccountingLoading] = useState(true);
  const [accountingSaving, setAccountingSaving] = useState(false);
  const [accountingError, setAccountingError] = useState<string | null>(null);
  const [accountingSavedMessage, setAccountingSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/settings/accounting`);
        if (!res.ok) throw new Error('Failed to load accounting settings');
        const data = await res.json();
        if (!cancelled) setAccountingSettings((prev) => ({ ...prev, ...data }));
      } catch (err) {
        if (!cancelled) setAccountingError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        if (!cancelled) setAccountingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateAccountingSetting = <K extends keyof AccountingSettings>(key: K, value: AccountingSettings[K]) => {
    setAccountingSettings((prev) => ({ ...prev, [key]: value }));
  };

  const saveAccountingSettings = async () => {
    setAccountingSaving(true);
    setAccountingError(null);
    setAccountingSavedMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/settings/accounting`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountingSettings),
      });
      if (!res.ok) throw new Error('Failed to save accounting settings');
      const data = await res.json();
      setAccountingSettings((prev) => ({ ...prev, ...data }));
      setAccountingSavedMessage('Settings saved.');
      window.setTimeout(() => setAccountingSavedMessage(null), 3000);
    } catch (err) {
      setAccountingError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setAccountingSaving(false);
    }
  };

  const periodStartDate = parseIsoDateOnly(accountingSettings.accountingPeriodStart);
  const periodEndDate = parseIsoDateOnly(accountingSettings.accountingPeriodEnd);

  const handleSelect = async (scheme: ColorSchemeId) => {
    if (scheme === colorScheme || themeSaving) return;
    setSaveMessage(null);
    try {
      await setColorScheme(scheme);
      setSaveMessage(`Saved ${COLOR_SCHEME_OPTIONS.find((o) => o.id === scheme)?.label ?? scheme} theme.`);
    } catch {
      /* themeError set in context */
    }
  };

  return (
    <div className="site-settings-general">
      <div className="site-settings-general-intro">
        <h3 className="site-settings-general-title">Colour scheme</h3>
        <p className="site-settings-general-hint">
          Choose how the app looks across all pages. Neon is the original dark gold theme; Vinted uses a
          light layout with teal accents; Minimal is a Facebook-style dark mode with blue accents. Your
          choice is saved to the database.
        </p>
      </div>

      {themeError ? (
        <div className="site-settings-general-error" role="alert">
          {themeError}
        </div>
      ) : null}
      {saveMessage ? (
        <div className="site-settings-general-success" role="status">
          {saveMessage}
        </div>
      ) : null}

      <div className="site-settings-scheme-list" role="listbox" aria-label="Colour schemes">
        {COLOR_SCHEME_OPTIONS.map((option) => {
          const selected = colorScheme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={themeLoading || themeSaving}
              className={`site-settings-scheme-card${selected ? ' site-settings-scheme-card--active' : ''}`}
              onClick={() => void handleSelect(option.id)}
            >
              <div
                className={`site-settings-scheme-preview site-settings-scheme-preview--${option.id}`}
                aria-hidden
              >
                <span className="site-settings-scheme-preview-bar" />
                <span className="site-settings-scheme-preview-dot" />
              </div>
              <div className="site-settings-scheme-copy">
                <span className="site-settings-scheme-label">{option.label}</span>
                <span className="site-settings-scheme-description">{option.description}</span>
              </div>
              {selected ? <span className="site-settings-scheme-badge">Active</span> : null}
            </button>
          );
        })}
      </div>

      {themeSaving ? <p className="site-settings-general-status">Saving…</p> : null}
      {themeLoading ? <p className="site-settings-general-status">Loading saved theme…</p> : null}

      <div className="site-settings-general-session">
        <h3 className="site-settings-general-title">Company Accounts</h3>
        <p className="site-settings-general-hint">
          Company details and accounting period used on the Company Accounts export.
        </p>
        {accountingError ? (
          <div className="site-settings-general-error" role="alert">
            {accountingError}
          </div>
        ) : null}
        {accountingSavedMessage ? (
          <div className="site-settings-general-success" role="status">
            {accountingSavedMessage}
          </div>
        ) : null}
        {accountingLoading ? (
          <p className="site-settings-general-status">Loading…</p>
        ) : (
          <>
            <div className="new-entry-grid">
              <label className="new-entry-field">
                <span>Company name</span>
                <input
                  type="text"
                  value={accountingSettings.companyName}
                  onChange={(e) => updateAccountingSetting('companyName', e.target.value)}
                  placeholder="e.g. Gents Rail Ltd"
                />
              </label>
              <label className="new-entry-field">
                <span>Company number</span>
                <input
                  type="text"
                  value={accountingSettings.companyNumber}
                  onChange={(e) => updateAccountingSetting('companyNumber', e.target.value)}
                  placeholder="Companies House number"
                />
              </label>
              <label className="new-entry-field">
                <span>Accounting period start</span>
                <DatePicker
                  selected={periodStartDate}
                  onChange={(date) => updateAccountingSetting('accountingPeriodStart', toIsoDateOnly(date))}
                  selectsStart
                  startDate={periodStartDate}
                  endDate={periodEndDate}
                  maxDate={periodEndDate ?? undefined}
                  dateFormat="yyyy-MM-dd"
                  placeholderText="Period start"
                  className="date-picker-input"
                  calendarClassName="date-picker-calendar"
                  wrapperClassName="date-picker-wrapper"
                />
              </label>
              <label className="new-entry-field">
                <span>Accounting period end</span>
                <DatePicker
                  selected={periodEndDate}
                  onChange={(date) => updateAccountingSetting('accountingPeriodEnd', toIsoDateOnly(date))}
                  selectsEnd
                  startDate={periodStartDate}
                  endDate={periodEndDate}
                  minDate={periodStartDate ?? undefined}
                  dateFormat="yyyy-MM-dd"
                  placeholderText="Period end"
                  className="date-picker-input"
                  calendarClassName="date-picker-calendar"
                  wrapperClassName="date-picker-wrapper"
                />
              </label>
            </div>
            <button
              type="button"
              className="new-entry-button"
              onClick={saveAccountingSettings}
              disabled={accountingSaving}
            >
              {accountingSaving ? 'Saving…' : 'Save settings'}
            </button>
          </>
        )}
      </div>

      <div className="site-settings-general-session">
        <h3 className="site-settings-general-title">Session</h3>
        <p className="site-settings-general-hint">
          Sign out of the app on this device. You will need to sign in with Google again.
        </p>
        <button type="button" className="site-settings-logout-button" onClick={logout}>
          Log out
        </button>
      </div>
    </div>
  );
};
