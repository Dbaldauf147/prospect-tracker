// Shared date normalization for the click-to-pick date cells.
//
// Values arrive from spreadsheets, pasted text and the app's own writes in
// whatever shape they were typed, so anything that needs to render or store
// a date funnels through here: toISODate to persist (YYYY-MM-DD, the shape
// `<input type="date">` round-trips), formatDateDisplay to show (M/D/YYYY).

// Excel stores dates as days since 1899-12-30; xlsx hands those through as
// plain numbers. Date.parse would read 45000 as the year 45000, so numbers
// are converted off the serial epoch instead — the same rule asDate uses in
// dealsFormat, so a pasted workbook reads the same everywhere.
const EXCEL_EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86400 * 1000;

export function toISODate(raw) {
  if (!raw) return '';
  let t;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    t = (raw - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY;
  } else {
    const s = String(raw).trim();
    // Already ISO?
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    t = Date.parse(s);
  }
  if (isNaN(t)) return '';
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateDisplay(raw) {
  const iso = toISODate(raw);
  if (!iso) return String(raw || '');
  // Render as M/D/YYYY without time-zone offset surprises (parse the
  // ISO string in local time, not UTC).
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  return `${m}/${d}/${y}`;
}
