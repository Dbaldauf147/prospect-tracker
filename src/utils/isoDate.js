// Shared date normalization for the click-to-pick date cells.
//
// Values arrive from spreadsheets, pasted text and the app's own writes in
// whatever shape they were typed, so anything that needs to render or store
// a date funnels through here: toISODate to persist (YYYY-MM-DD, the shape
// `<input type="date">` round-trips), formatDateDisplay to show (M/D/YYYY),
// and parseTypedDate to read back what a user typed into the calendar
// popup's date box.

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

// What someone typed into a date box, as ISO.
//
// Deliberately stricter than toISODate about numeric input: that one leans on
// Date.parse, which reads "3/5" and "45000" as dates of a sort — the kind of
// half-typed value a person leaves in the box mid-keystroke, which must read
// as "not a date yet" rather than silently becoming one.
//
// Returns the ISO string when it parses, '' when the box is empty (a request
// to clear the cell), and null when the text isn't a date. The three are
// different answers and the caller acts on each differently, so they stay
// distinguishable.
const TYPED_NUMERIC = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{1,4}))?$/;
const TYPED_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
// Digits and the separators that go between them, and nothing else: the shape
// a numeric date is typed in, whether or not it is finished.
const NUMERIC_SHAPED = /^[\d/.-]+$/;

export function parseTypedDate(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';

  const m = TYPED_NUMERIC.exec(s);
  if (m) {
    // A year left off means this year — the common case is typing a date in
    // the current contract year, and re-typing the year every time is the
    // sort of friction the box exists to remove.
    const digits = m[3];
    const year = digits === undefined ? new Date().getFullYear() : expandYear(digits);
    return buildIso(year, +m[1], +m[2]);
  }

  // ISO, which is what the cell stores and so what a value copied from
  // another one looks like. Rebuilt rather than passed through: toISODate
  // hands back anything ISO-shaped verbatim, 2026-02-30 included.
  const iso = TYPED_ISO.exec(s);
  if (iso) return buildIso(+iso[1], +iso[2], +iso[3]);

  // Numeric-shaped but matching neither: a date mid-keystroke. Date.parse
  // reads '3/' as March 2001 and '45000' as the year 45000, so a box the user
  // is still typing into would go on offering a committable date the whole
  // way. Nothing here is a date until it is finished.
  if (NUMERIC_SHAPED.test(s)) return null;

  // Everything else — 'Mar 5 2026', a written-out date, a pasted display
  // value — goes through the shared normalizer, so the box accepts anything
  // the rest of the app can already read.
  return toISODate(s) || null;
}

// Two digits are read the way a spreadsheet reads them, since that is where
// most of these dates come from: 00-69 is this century, 70-99 the last.
function expandYear(digits) {
  const n = parseInt(digits, 10);
  if (digits.length > 2) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

// Build an ISO date, rejecting anything the calendar couldn't show: month 13,
// or 2/30, which `new Date(2026, 1, 30)` would quietly roll into March.
function buildIso(y, m, d) {
  if (!(y >= 1000 && y <= 9999) || !(m >= 1 && m <= 12) || d < 1) return null;
  if (d > new Date(y, m, 0).getDate()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
