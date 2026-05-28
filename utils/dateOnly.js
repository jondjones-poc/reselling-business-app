/** Calendar date helpers — avoid UTC shifts on YYYY-MM-DD values. */

const DATE_ONLY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

function parseDateOnlyParts(value) {
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

function formatDateOnlyParts(parts) {
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

function normalizeDateOnlyString(value) {
  const parts = parseDateOnlyParts(value);
  if (parts) return formatDateOnlyParts(parts);
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateOnlyParts({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

module.exports = {
  parseDateOnlyParts,
  formatDateOnlyParts,
  normalizeDateOnlyString,
};
