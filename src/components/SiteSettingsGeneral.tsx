import React, { useState } from 'react';
import {
  COLOR_SCHEME_OPTIONS,
  type ColorSchemeId,
  useTheme,
} from '../context/ThemeContext';
import './SiteSettingsGeneral.css';

export const SiteSettingsGeneral: React.FC = () => {
  const { colorScheme, setColorScheme, themeLoading, themeSaving, themeError } = useTheme();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

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
    </div>
  );
};
