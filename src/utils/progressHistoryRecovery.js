// Getting lost Weekly Progress weeks back out of the daily cloud backups.
//
// progressHistory/{uid} is one document holding every saved week, so a
// single bad write (a save made while the page thought the history was
// empty) leaves the charts with only this week's point. The daily backup
// job (api/daily-backup.js) copies that document into the backup bucket
// every night and keeps 30 days of it, so the weeks are still there.
//
// Recovery only ever ADDS weeks: a week the live document already holds
// keeps its live numbers (it may have been typed over since), and nothing
// the live document holds is removed. That makes it safe to run twice.

// The `weeks` array out of a backup's progressHistory part, whatever shape
// it came back in (the part itself, or a whole backup object).
export function weeksFromBackupValue(value) {
  const v = value?.collections ? value.collections.progressHistory : value;
  const weeks = v?.weeks;
  return Array.isArray(weeks) ? weeks.filter(w => w && typeof w.week === 'string' && w.week) : [];
}

/**
 * The weeks found in the backups that the live history is missing.
 *
 * `backups` is newest first; when several backups hold the same week the
 * newest copy wins, since a later backup carries any edit made to it.
 * Returns them sorted oldest first, ready to merge.
 */
export function missingWeeksFromBackups(liveWeeks, backups) {
  const have = new Set((Array.isArray(liveWeeks) ? liveWeeks : []).map(w => w?.week));
  const found = new Map();
  for (const weeks of Array.isArray(backups) ? backups : []) {
    for (const w of Array.isArray(weeks) ? weeks : []) {
      if (!w?.week || have.has(w.week) || found.has(w.week)) continue;
      found.set(w.week, w);
    }
  }
  return [...found.values()].sort((a, b) => a.week.localeCompare(b.week));
}

// Live weeks plus the recovered ones, oldest first. Live wins on a clash.
export function mergeRecoveredWeeks(liveWeeks, recovered) {
  const out = [...(Array.isArray(liveWeeks) ? liveWeeks : [])];
  const have = new Set(out.map(w => w?.week));
  for (const w of Array.isArray(recovered) ? recovered : []) {
    if (w?.week && !have.has(w.week)) { out.push(w); have.add(w.week); }
  }
  return out.sort((a, b) => String(a.week).localeCompare(String(b.week)));
}
