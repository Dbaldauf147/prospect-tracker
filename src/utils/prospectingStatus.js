// "Caught up?" for each step of the Prospecting ladder.
//
// Two kinds of step live on that page. Some have a real number behind
// them — the opps whose Call In has gone negative, the client renewals
// the Issues tab already tracks, the Top PCs not yet at Qualifying (see
// topPcOutreach.js) — and those categorize themselves: zero outstanding
// items means caught up, anything else is work owed. The rest (market
// updates, targeted services, cold outreach) have no count anywhere in
// the app, so the user marks those caught up by hand.
//
// A manual mark is stamped with the day it was made and only counts on
// that day. Prospecting is daily work, and a tick that stayed on from
// last Tuesday would read as "done" forever — the honest default when a
// new day starts is that the step hasn't been worked yet.

// Imported with the extension so this module also loads under plain Node
// (scripts/prospectingStatus.test.mjs), not just through the bundler.
import { userLsGet, userLsSet } from './userLs.js';

export const PROSPECTING_CAUGHT_UP_KEY = 'prospecting-caught-up';
export const PROSPECTING_CAUGHT_UP_EVENT = 'prospecting-caught-up-changed';

// Step 3 counts exactly the rows the Clients tab tints red: the client's
// soonest contract expires inside the renewal window AND the Status column
// is still blank. That's the work the step sends the user at, so the step
// is caught up when none of them is left.
//
// Two issue types (utils/clientIssues.js) make up that set, and only one
// of them is already status-gated:
//
//   'Renewal: no status'  expires in 0..270 days with a blank Status —
//                         the whole definition of the row, so it always
//                         counts.
//   'Contract expired'    already past its End Date. Inside the window by
//                         definition (a negative number is under 270), but
//                         the detector raises it whatever the Status says,
//                         because an expired contract is worth flagging
//                         even when someone is on it. Only the ones still
//                         blank are renewal work — hence the `noStatus`
//                         flag that detector carries.
//
// Counting every expired contract here was the bug: a client whose renewal
// had a Status set and was being actively worked still held the step open.
export const RENEWAL_ISSUE_TYPES = ['Contract expired', 'Renewal: no status'];

// Does one issue row count as renewal work? Exported for the tests — the
// rule is easier to get wrong than to state.
export function isRenewalWork(row) {
  if (!row) return false;
  if (row.type === 'Renewal: no status') return true;
  if (row.type === 'Contract expired') return row.noStatus === true;
  return false;
}

// Local calendar date (YYYY-MM-DD). Deliberately local rather than UTC:
// the day a mark belongs to is the user's day, not Greenwich's.
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// { [stepKey]: 'YYYY-MM-DD' } — the day each step was last marked caught
// up. A corrupt / non-object payload reads as "nothing marked" rather
// than throwing on a page that is otherwise pure display.
export function parseCaughtUpMap(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch { return {}; }
}

export function loadCaughtUpMap() {
  return parseCaughtUpMap(userLsGet(PROSPECTING_CAUGHT_UP_KEY));
}

// Toggle one step's mark and persist. Un-marking deletes the entry rather
// than storing a falsy stamp, so the map stays a plain "these were done
// today" set. The event is what refreshes the page (and any other tab
// listening), so it fires only after the write actually landed.
export function setStepCaughtUp(stepKey, on, today = todayISO()) {
  const next = { ...loadCaughtUpMap() };
  if (on) next[stepKey] = today;
  else delete next[stepKey];
  try {
    userLsSet(PROSPECTING_CAUGHT_UP_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PROSPECTING_CAUGHT_UP_EVENT));
  } catch { /* quota / private mode: nothing was stored, so nothing changed */ }
  return next;
}

// --- the marks as an external store -----------------------------------------
//
// The page subscribes with useSyncExternalStore rather than mirroring the
// marks into state: the source of truth is localStorage, which two tabs
// (and the clock) can move without React knowing.
//
// The snapshot is a single string — today's date, then the stored JSON —
// so React can compare it by value. Folding the date in is what makes a
// page left open past midnight drop yesterday's marks on the next focus,
// and keeps a re-read that changed nothing from re-rendering.
const CAUGHT_UP_EVENTS = [PROSPECTING_CAUGHT_UP_EVENT, 'focus', 'storage'];

export function subscribeCaughtUp(onChange) {
  CAUGHT_UP_EVENTS.forEach(e => window.addEventListener(e, onChange));
  return () => CAUGHT_UP_EVENTS.forEach(e => window.removeEventListener(e, onChange));
}

export function caughtUpSnapshot() {
  return `${todayISO()}|${userLsGet(PROSPECTING_CAUGHT_UP_KEY) || ''}`;
}

export function readCaughtUpSnapshot(snapshot) {
  const s = String(snapshot || '');
  const at = s.indexOf('|');
  return at < 0
    ? { today: s, map: {} }
    : { today: s.slice(0, at), map: parseCaughtUpMap(s.slice(at + 1)) };
}

// A mark counts only on the day it was made — see the file header.
export function isMarkedCaughtUp(map, stepKey, today = todayISO()) {
  return String(map?.[stepKey] || '') === today;
}

// How many client renewals still need working, from the issue rows the
// Issues tab already computes. Snoozed issues don't count: the user has
// said "not now" about those, and the sidebar badge ignores them too.
// `null` when the issues aren't known yet, so the step can show nothing
// rather than an unearned "all caught up".
export function countRenewalWork(issues) {
  if (!Array.isArray(issues)) return null;
  let n = 0;
  for (const r of issues) {
    if (r?.snoozed) continue;
    if (isRenewalWork(r)) n += 1;
  }
  return n;
}

// How many tracked services still have clients who haven't explored them,
// from the coverage rows the Pipeline page's Service Exploration Coverage
// table is built on. One per service under 100%, matching that table's
// rows — so the step counts services to work, not clients to call.
// `null` when they haven't loaded, for the same reason as above.
export function countServiceGaps(gaps) {
  return Array.isArray(gaps) ? gaps.length : null;
}

// The categorization the Status column renders:
//   'unknown'    — tracked step whose count hasn't arrived yet (show nothing)
//   'caught-up'  — nothing outstanding, or marked done today
//   'work'       — a tracked count above zero
//   'open'       — an untracked step not yet marked today
// `count` is a number for tracked steps, null while one is still
// loading, and undefined for steps with nothing to count.
export function categorizeStep({ count, marked = false } = {}) {
  if (count === null) return 'unknown';
  if (typeof count === 'number' && Number.isFinite(count)) return count > 0 ? 'work' : 'caught-up';
  return marked ? 'caught-up' : 'open';
}

// The ladder's first step. Named because two places gate on it: the tag-debt
// count under the market-updates step, and the sidebar badge that mirrors it.
export const OPPS_STEP_KEY = 'opps';

// Is step 1 clear right now?
//
// Anything the ladder puts below step 1 waits for it, so anything that
// surfaces work from further down has to ask this — and has to get the same
// answer the step's own row shows, which is why the rule lives here rather
// than being written out at each call site.
//
// `overdue` is the overdue Call In count (null while the Opps store is still
// answering, which reads as not-clear: an unknown count is not a clear one).
// `steps` is the user's ladder when the caller has it; a ladder they've
// deleted the opps step from has nothing to wait for, so it reads clear.
export function isOppsStepClear({ steps = null, overdue = null, caughtUpMap = {}, today = todayISO() } = {}) {
  if (Array.isArray(steps) && !steps.some(s => s?.key === OPPS_STEP_KEY)) return true;
  return categorizeStep({
    count: overdue,
    marked: isMarkedCaughtUp(caughtUpMap, OPPS_STEP_KEY, today),
  }) === 'caught-up';
}
