// Which one-time prospect backfills (utils/peOwnerBackfill) have already run,
// kept in the account rather than the browser.
//
// A pass stamps fixed values onto a list of companies (PE Owner = Blue Owl,
// Type = PE Firm, ...). It used to remember that it had run only in this
// browser's localStorage, so clearing site data, or signing in somewhere
// new, ran it again: the values went back onto companies the user had
// changed since, and the report popped up as if for the first time. The
// record lives in settings[BACKFILLS_DONE_KEY] now, { [flag]: ISO time }.
//
// A pass this browser ran before the record moved still counts as run: its
// local stamp is copied up, so the next browser doesn't run it either.
//
// No imports, so the rule can be tested under plain Node.

export const BACKFILLS_DONE_KEY = 'backfillPassesDone';

/**
 * What to do about the passes, given the account's settings (loaded) and a
 * reader for this browser's old per-pass flags.
 *
 * Returns { pending, record }: the passes to run now, and the settings-path
 * patch that marks every pass done in the account (the pending ones as of
 * `now`, ones this browser had already run with their local stamp). Write
 * the patch BEFORE running anything, so a second load can't start the same
 * pass while the first is still going.
 */
export function planBackfillPasses(passes, settings, readLocalFlag, now = new Date().toISOString()) {
  const done = settings?.[BACKFILLS_DONE_KEY] || {};
  const pending = [];
  const record = {};
  for (const pass of passes || []) {
    if (!pass?.flag || done[pass.flag]) continue;
    let local = null;
    try { local = readLocalFlag(pass.flag); } catch { /* storage blocked: treat as not run here */ }
    if (local) {
      record[`${BACKFILLS_DONE_KEY}.${pass.flag}`] = local;
    } else {
      pending.push(pass);
      record[`${BACKFILLS_DONE_KEY}.${pass.flag}`] = now;
    }
  }
  return { pending, record };
}
