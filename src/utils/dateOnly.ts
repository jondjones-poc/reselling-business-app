/** Calendar date parts (no timezone). */
export type DateOnlyParts = { year: number; month: number; day: number };

const DATE_ONLY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/** Parse leading YYYY-MM-DD from API/DB values without timezone shifts. */
export function parseDateOnlyParts(value: string | null | undefined): DateOnlyParts | null {
  if (value == null || value === '') return null;
  const match = DATE_ONLY_PREFIX.exec(String(value).trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function formatDateOnlyParts(parts: DateOnlyParts): string {
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

/** Normalize any date-like string to YYYY-MM-DD for form state / API payloads. */
export function normalizeDateOnlyString(value: string | null | undefined): string {
  const parts = parseDateOnlyParts(value);
  if (parts) return formatDateOnlyParts(parts);
  if (value == null || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return formatDateOnlyParts({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

/** Local Date at midnight for react-datepicker `selected`. */
export function dateOnlyStringToLocalDate(value: string | null | undefined): Date | null {
  const parts = parseDateOnlyParts(value);
  if (!parts) {
    if (value == null || value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** From picker selection to YYYY-MM-DD (local calendar, not UTC). */
export function localDateToDateOnlyString(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  return formatDateOnlyParts({
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate(),
  });
}

export function formatDateOnlyForDisplay(
  value: string | null | undefined,
  locale = 'en-GB'
): string {
  const parts = parseDateOnlyParts(value);
  if (!parts) {
    if (value == null || value === '') return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(date);
  }
  const date = new Date(parts.year, parts.month - 1, parts.day);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}
