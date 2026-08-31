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

// True when the row's "No Further Action Today" cell is empty. That column
// is a tristate (✓ / ✗ / blank), and any mark on it means the user has
// already dealt with the row today — so only a blank counts as outstanding.
export function nfatUnmarked(row) {
  return String(row?.['No Further Action Today'] ?? '').trim() === '';
}

// How many opps are due to be called: the Call In number has reached zero
// or gone negative (the Follow Up date is today or already past) and the
// row hasn't been marked "No Further Action Today". The mark means the
// user has already been through the row today and settled it, so counting
// it would send them back to an opp they just closed out; the column
// clears on its own schedule (Settings → No Further Action Today), which
// puts a still-due row back in the count.
//
// Rows with no resolvable Call In (no Follow Up date, or the value was
// manually cleared) aren't on a callback schedule, so they never count.
//
// THE one count of owed calls, deliberately: the sidebar's Opps badge and
// the Prospecting ladder's "Follow up on current opps" step both read it.
// They used to run separate rules — this one, and a stricter "overdue"
// that wanted the date strictly past and the stage still open — so an opp
// due TODAY badged Opps red while the ladder called that step clear and
// let the step below it raise the Prospecting dot. Two rules for one
// question is what made that possible, so there is now one.
export function countCallInDue(records) {
  if (!Array.isArray(records)) return 0;
  let n = 0;
  for (const row of records) {
    if (!nfatUnmarked(row)) continue;
    const days = resolveCallIn(row);
    if (typeof days === 'number' && Number.isFinite(days) && days <= 0) n += 1;
  }
  return n;
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
