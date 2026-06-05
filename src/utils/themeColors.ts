import type { ColorSchemeId } from '../themes/colorSchemes';

function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** RGB triplet from --theme-accent-rgb, for Chart.js and inline styles. */
export function themeAccentRgb(_scheme?: ColorSchemeId): string {
  return readCssVar('--theme-accent-rgb', '255, 214, 91');
}

export function themeAccentRgba(alpha: number, _scheme?: ColorSchemeId): string {
  return `rgba(${themeAccentRgb(_scheme)}, ${alpha})`;
}

export function themePositiveRgba(alpha: number): string {
  const rgb = readCssVar('--color-positive-rgb', '140, 255, 195');
  return `rgba(${rgb}, ${alpha})`;
}

export function themeNegativeRgba(alpha: number): string {
  const rgb = readCssVar('--color-negative-rgb', '255, 154, 154');
  return `rgba(${rgb}, ${alpha})`;
}

export function themeTextRgba(alpha: number): string {
  const rgb = readCssVar('--theme-text-rgb', '255, 248, 226');
  return `rgba(${rgb}, ${alpha})`;
}
