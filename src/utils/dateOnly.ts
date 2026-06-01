/** Calendar date parts (no timezone). */
export type DateOnlyParts = { year: number; month: number; day: number };

const DATE_ONLY_PLAIN = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarPartsFromDate(date: Date): DateOnlyParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function partsFromPlainDateString(value: string): DateOnlyParts | null {
  const match = DATE_ONLY_PLAIN.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Parse API/DB values to calendar parts without UTC day shifts. */
export function parseDateOnlyParts(value: string | Date | null | undefined): DateOnlyParts | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return calendarPartsFromDate(value);
  }

  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const plain = partsFromPlainDateString(trimmed);
  if (plain) return plain;

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return calendarPartsFromDate(date);
}

export function formatDateOnlyParts(parts: DateOnlyParts): string {
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

/** Normalize any date-like value to YYYY-MM-DD for form state / API payloads. */
export function normalizeDateOnlyString(value: string | Date | null | undefined): string {
  const parts = parseDateOnlyParts(value);
  return parts ? formatDateOnlyParts(parts) : '';
}

/** Local Date at midnight for react-datepicker `selected`. */
export function dateOnlyStringToLocalDate(value: string | null | undefined): Date | null {
  const parts = parseDateOnlyParts(value);
  if (!parts) return null;
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** From picker selection to YYYY-MM-DD (local calendar, not UTC). */
export function localDateToDateOnlyString(value: Date | null | undefined): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  return formatDateOnlyParts(calendarPartsFromDate(value));
}

export function dateOnlyToLocalDate(value: string | Date | null | undefined): Date | null {
  const parts = parseDateOnlyParts(value);
  if (!parts) return null;
  return new Date(parts.year, parts.month - 1, parts.day);
}

export function dateOnlyToTime(value: string | Date | null | undefined): number {
  const date = dateOnlyToLocalDate(value);
  return date ? date.getTime() : Number.NEGATIVE_INFINITY;
}

export function formatDateOnlyForDisplay(
  value: string | Date | null | undefined,
  locale = 'en-GB'
): string {
  const parts = parseDateOnlyParts(value);
  if (!parts) {
    if (value == null || value === '') return '—';
    return String(value);
  }
  const date = new Date(parts.year, parts.month - 1, parts.day);
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}
