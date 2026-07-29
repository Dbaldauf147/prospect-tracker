// Call-In helpers for Opps 2 rows, mirrored from OppsView2 so other
// views (e.g. the Pricing "Save to Opp" picker) can order opps the same
// way the Opps 2 page does — by Call In ascending, most urgent first —
// and show the call-in date. Kept as small pure functions here so the
// picker doesn't have to import the 6k-line Opps 2 component.

const BLANK_SENTINELS = new Set(['', '-', '#N/A', '#n/a', 'N/A', 'n/a']);

// Normalize a free-text / ISO / Date-parseable value to YYYY-MM-DD.
// Returns '' when blank or unparseable.
export function toISODate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (isNaN(t)) return '';
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Render an ISO/parseable date as M/D/YYYY in local time (no UTC drift).
// Falls back to the raw string when it can't be parsed.
export function formatDateDisplay(raw) {
  const iso = toISODate(raw);
  if (!iso) return String(raw || '');
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  return `${m}/${d}/${y}`;
}

// Calendar days from today to the given date. Positive = future,
// negative = past. null for blank / unparseable.
export function daysFromToday(rawISO) {
  const iso = toISODate(rawISO);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(n => parseInt(n, 10));
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Call In = calendar days from today to the row's Follow Up date.
// Prefers a live compute from Follow Up; falls back to a stored "Call In"
// number for imported rows that arrived without a date. A blank-sentinel
// stored value reads as null (intentionally cleared). Mirrors
// resolveComputedDays('Call In', 'Follow Up') from OppsView2.
export function resolveCallIn(row) {
  if (row && 'Call In' in row) {
    const raw = row['Call In'];
    const s = raw == null ? '' : String(raw).trim();
    if (BLANK_SENTINELS.has(s)) return null;
  }
  const live = daysFromToday(row?.['Follow Up']);
  if (live != null) return live;
  if (row && 'Call In' in row) {
    const raw = row['Call In'];
    const s = raw == null ? '' : String(raw).trim();
    const n = parseFloat(s.replace(/[,$%]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// The date the call-in number counts down to — i.e. the Follow Up date.
// Returns '' when there's no resolvable date.
export function callInDateISO(row) {
  return toISODate(row?.['Follow Up']);
}

// Order rows by Call In ascending so the most urgent (most overdue) land
// first, matching the Opps 2 page's initial-load sort. Rows without a
// resolvable Call In sink to the bottom; original index breaks ties so
// the order stays deterministic.
export function sortByCallInAsc(records) {
  if (!Array.isArray(records)) return records;
  const tagged = records.map((r, i) => {
    const n = resolveCallIn(r);
    const key = typeof n === 'number' && Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    return { r, i, key };
  });
  tagged.sort((a, b) => (a.key - b.key) || (a.i - b.i));
  return tagged.map(x => x.r);
}
