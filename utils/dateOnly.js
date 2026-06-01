/** Calendar date helpers — avoid UTC shifts on date-only values. */

const DATE_ONLY_PLAIN = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarPartsFromDate(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function partsFromPlainDateString(value) {
  const match = DATE_ONLY_PLAIN.exec(String(value).trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function parseDateOnlyParts(value) {
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

function formatDateOnlyParts(parts) {
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

function normalizeDateOnlyString(value) {
  const parts = parseDateOnlyParts(value);
  if (!parts) return null;
  return formatDateOnlyParts(parts);
}

function serializeStockDateFields(row) {
  if (!row) return row;
  return {
    ...row,
    purchase_date: normalizeDateOnlyString(row.purchase_date),
    sale_date: normalizeDateOnlyString(row.sale_date),
  };
}

module.exports = {
  parseDateOnlyParts,
  formatDateOnlyParts,
  normalizeDateOnlyString,
  serializeStockDateFields,
};
