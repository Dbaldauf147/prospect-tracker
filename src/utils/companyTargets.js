// A company's sustainability targets, logged by hand on the company popup's
// Targets tab. Stored on the company record as `climateTargets`: an array of
//   { id, type, yearSet, baseYear, targetYear1, targetYear2, scope1, scope2, scope3 }
// `yearSet` is the year the company set (or last refreshed) the target; the
// refresh it is due for is REFRESH_CYCLE_YEARS after that, worked out here
// rather than stored so changing the year set moves it too.
// Years are kept as the 4-digit strings typed (or '' when blank) so a
// half-typed year in the box is never coerced; the scope flags are booleans.

export const TARGET_SCOPES = ['scope1', 'scope2', 'scope3'];
export const TARGET_YEAR_KEYS = ['yearSet', 'baseYear', 'targetYear1', 'targetYear2'];

// Targets are refreshed every five years (SBTi's revalidation cycle).
export const REFRESH_CYCLE_YEARS = 5;

function newId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function blankTarget() {
  return { id: newId(), type: '', yearSet: '', baseYear: '', targetYear1: '', targetYear2: '', scope1: false, scope2: false, scope3: false };
}

// Digits only, at most four: the year boxes accept nothing else.
export function cleanYear(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 4);
}

// Whatever is on the record, as a clean list. Anything that isn't an object
// is dropped, and missing fields get their blank value, so the tab never
// has to guard against a partly-written row.
export function normalizeTargets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      id: String(r.id || newId()),
      type: String(r.type || ''),
      yearSet: cleanYear(r.yearSet),
      baseYear: cleanYear(r.baseYear),
      targetYear1: cleanYear(r.targetYear1),
      targetYear2: cleanYear(r.targetYear2),
      scope1: !!r.scope1,
      scope2: !!r.scope2,
      scope3: !!r.scope3,
    }));
}

// The list with one row's field changed. Year fields are cleaned on the way in.
export function updateTarget(list, id, key, value) {
  const v = TARGET_YEAR_KEYS.includes(key) ? cleanYear(value)
    : TARGET_SCOPES.includes(key) ? !!value
      : String(value ?? '');
  return normalizeTargets(list).map(r => (r.id === id ? { ...r, [key]: v } : r));
}

export function removeTarget(list, id) {
  return normalizeTargets(list).filter(r => r.id !== id);
}

// "1, 2" / "1, 2, 3" / "" - the scopes a target covers, for export and filters.
export function scopesLabel(row) {
  return TARGET_SCOPES.filter(k => row?.[k]).map(k => k.slice(-1)).join(', ');
}

// When the target is due its refresh: year set + 5. Deliberately not rolled
// forward to the next cycle once that year passes - a refresh nobody logged
// should read as overdue, and logging it is changing the year set.
//   { year: 2029, status: 'upcoming' | 'due' | 'overdue', label }
// or null when no year set is logged.
export function refreshDue(row, thisYear = new Date().getFullYear()) {
  const set = Number(row?.yearSet);
  if (!row?.yearSet || String(row.yearSet).length !== 4 || !Number.isFinite(set)) return null;
  const year = set + REFRESH_CYCLE_YEARS;
  const status = year < thisYear ? 'overdue' : year === thisYear ? 'due' : 'upcoming';
  const label = status === 'overdue' ? 'Overdue' : status === 'due' ? 'Due this year' : 'Upcoming';
  return { year, status, label };
}
