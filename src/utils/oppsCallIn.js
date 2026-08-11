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

// Stages that mean the opp is finished, and stage values that are
// spreadsheet errors rather than real stages. Mirrors the filter the
// Activity and Contacts pages already apply to these same Opps 2 records.
const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);
const INVALID_STAGES = new Set(['#N/A', '#REF!', '#VALUE!', '#ERROR!', 'N/A', 'n/a', '-', '']);

// An opp still being worked: it has a real stage and hasn't closed.
export function isActiveOpp(row) {
  const stage = String(row?.Stage || '').trim();
  return !!stage && !INVALID_STAGES.has(stage) && !CLOSED_STAGES.has(stage);
}

// True when the row's "No Further Action Today" cell is empty. That column
// is a tristate (✓ / ✗ / blank), and any mark on it means the user has
// already dealt with the row today — so only a blank counts as outstanding.
export function nfatUnmarked(row) {
  return String(row?.['No Further Action Today'] ?? '').trim() === '';
}

// How many active opps have gone negative on Call In — the Follow Up date
// is already behind them. Closed and error-stage rows are skipped, since an
// overdue follow-up on a dead opp isn't work anyone owes.
//
// Rows marked "No Further Action Today" are skipped too, for the same
// reason the sidebar's Opps badge skips them: the mark means the user has
// already been through the row today and settled it, so counting it as
// work still to do sends them back to an opp they just closed out. The
// column clears on its own schedule (Settings → No Further Action Today),
// so a row that stays overdue is back in the count on the next clear.
export function countOverdueCallIns(records) {
  if (!Array.isArray(records)) return 0;
  let n = 0;
  for (const row of records) {
    if (!isActiveOpp(row)) continue;
    if (!nfatUnmarked(row)) continue;
    const days = resolveCallIn(row);
    if (typeof days === 'number' && Number.isFinite(days) && days < 0) n += 1;
  }
  return n;
}

// How many opps are due to be called: the Call In number has reached zero
// or gone negative (the Follow Up date is today or already past) and the
// row hasn't been marked "No Further Action Today". This is the number the
// sidebar's Opps badge shows — the calls still owed right now.
//
// Rows with no resolvable Call In (no Follow Up date, or the value was
// manually cleared) aren't on a callback schedule, so they never count.
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
