// Which of an opp's timeline-driven services still has no timeline logged.
//
// Every service in Scope marked "Timeline Driven = Yes" (Dropdowns ›
// Services) gets a row in the Follow Up Notes popup's Timelines table. The
// Flags column warns about each one that is still blank, so the warning
// covers every such service rather than Budgets alone.
//
// A row counts as answered once it has Details or a Kickoff Deadline. A
// hidden row counts as answered too: hiding is how somebody says this deal
// doesn't need that timeline, and a warning that can't be dismissed teaches
// people to ignore the column. Pure, so scripts/serviceTimelines.test.mjs
// can pin it.

const key = (v) => String(v ?? '').trim().toLowerCase();

/** True when a timeline row has something logged on it. */
export function timelineRowAnswered(row) {
  return !!(String(row?.value ?? '').trim() || String(row?.kickoff ?? '').trim());
}

/**
 * The services (as given, in order) with no answered or hidden timeline
 * row whose type names them.
 */
export function missingServiceTimelines(list, services) {
  const rows = Array.isArray(list) ? list : [];
  return (Array.isArray(services) ? services : []).filter(name => {
    const k = key(name);
    if (!k) return false;
    const mine = rows.filter(r => key(r?.type) === k);
    if (mine.some(r => r?.hidden === true)) return false;
    return !mine.some(timelineRowAnswered);
  });
}

/** True when a row's type names one of the services, case-insensitively. */
export function isServiceTimelineRow(row, services) {
  const k = key(row?.type);
  return !!k && (Array.isArray(services) ? services : []).some(s => key(s) === k);
}
