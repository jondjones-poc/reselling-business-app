export const COLOR_SCHEME_IDS = ['neon', 'vinted', 'minimal'] as const;

export type ColorSchemeId = (typeof COLOR_SCHEME_IDS)[number];

export function isColorSchemeId(value: string | null | undefined): value is ColorSchemeId {
  return value === 'neon' || value === 'vinted' || value === 'minimal';
}
