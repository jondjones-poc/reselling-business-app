import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getApiBase } from '../utils/apiBase';
import '../themes/neon.css';
import '../themes/vinted.css';
import '../themes/minimal.css';
import '../themes/theme-overrides.css';
import { isColorSchemeId, type ColorSchemeId } from '../themes/colorSchemes';

export type { ColorSchemeId };

export const COLOR_SCHEME_OPTIONS: Array<{
  id: ColorSchemeId;
  label: string;
  description: string;
}> = [
  {
    id: 'neon',
    label: 'Neon',
    description: 'Dark background with gold accents — the original app look.',
  },
  {
    id: 'vinted',
    label: 'Vinted',
    description: 'Light white layout with Vinted teal accents.',
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'Facebook-style dark mode — flat grey surfaces, blue accents, system UI fonts.',
  },
];

const STORAGE_KEY = 'app-color-scheme';
const API_BASE = getApiBase();

function readStoredScheme(): ColorSchemeId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isColorSchemeId(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 'neon';
}

function applyDocumentTheme(scheme: ColorSchemeId) {
  document.documentElement.setAttribute('data-theme', scheme);
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    /* ignore */
  }
}

interface ThemeContextValue {
  colorScheme: ColorSchemeId;
  setColorScheme: (scheme: ColorSchemeId) => Promise<void>;
  themeLoading: boolean;
  themeSaving: boolean;
  themeError: string | null;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colorScheme, setColorSchemeState] = useState<ColorSchemeId>(readStoredScheme);
  const [themeLoading, setThemeLoading] = useState(true);
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  useEffect(() => {
    applyDocumentTheme(colorScheme);
  }, [colorScheme]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/settings/site`);
        if (!response.ok) return;
        const data = (await response.json()) as { colorScheme?: string };
        if (cancelled) return;
        if (isColorSchemeId(data.colorScheme)) {
          setColorSchemeState(data.colorScheme);
        }
      } catch {
        /* keep local / default */
      } finally {
        if (!cancelled) setThemeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setColorScheme = useCallback(async (scheme: ColorSchemeId) => {
    setThemeError(null);
    setThemeSaving(true);
    const previous = colorScheme;
    setColorSchemeState(scheme);
    applyDocumentTheme(scheme);
    try {
      const response = await fetch(`${API_BASE}/api/settings/site`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colorScheme: scheme }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Failed to save color scheme');
      }
    } catch (err) {
      setColorSchemeState(previous);
      applyDocumentTheme(previous);
      setThemeError(err instanceof Error ? err.message : 'Failed to save color scheme');
      throw err;
    } finally {
      setThemeSaving(false);
    }
  }, [colorScheme]);

  const value = useMemo(
    () => ({
      colorScheme,
      setColorScheme,
      themeLoading,
      themeSaving,
      themeError,
    }),
    [colorScheme, setColorScheme, themeLoading, themeSaving, themeError]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
