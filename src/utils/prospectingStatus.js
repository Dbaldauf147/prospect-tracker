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
//
// A hand-marked step can still say something on its own once the ladder
// reaches it: when every step above is clear, the next one down is the
// work owed right now, and it says so in red until it is marked. See
// ladderStates at the foot of this file.

// Imported with the extension so this module also loads under plain Node
// (scripts/prospectingStatus.test.mjs), not just through the bundler.
import { userLsGet, userLsSet } from './userLs.js';
import { registerMirroredKey, queueMirrorPush } from './localMirrorSync.js';

export const PROSPECTING_CAUGHT_UP_KEY = 'prospecting-caught-up';
export const PROSPECTING_CAUGHT_UP_EVENT = 'prospecting-caught-up-changed';

// Mirrored: which ladder steps you have cleared today is a record of work
// done, and it decided what the ladder asked of you next.
registerMirroredKey(PROSPECTING_CAUGHT_UP_KEY, PROSPECTING_CAUGHT_UP_EVENT);

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
    queueMirrorPush(PROSPECTING_CAUGHT_UP_KEY);
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
// plus one the ladder as a whole decides (see ladderStates):
//   'due'        — an untracked step the ladder has reached: everything
//                  above it is clear, so it is the work owed right now
// `count` is a number for tracked steps, null while one is still
// loading, and undefined for steps with nothing to count.
export function categorizeStep({ count, marked = false } = {}) {
  if (count === null) return 'unknown';
  if (typeof count === 'number' && Number.isFinite(count)) return count > 0 ? 'work' : 'caught-up';
  return marked ? 'caught-up' : 'open';
}

// --- the ladder as a whole ---------------------------------------------------
//
// The Status column, step by step, in ladder order. This walks the list
// rather than categorizing each row on its own because one step's state
// can depend on the ones above it.
//
// A step flagged `dueWhenReached` (see prospectingPlaybook.js) is the next
// thing owed once everything above it is clear: it turns red on its own
// instead of sitting in the same grey "Mark caught up" it wears while
// there is still warmer work in front of it. Marking it caught up is what
// clears it — that's the point of the flag, since a step with no count
// behind it has nothing else that can say it was worked.
//
// A step above whose count hasn't landed yet ('unknown') does not count as
// clear: the ladder stays quiet until it knows, rather than calling a step
// outstanding on the strength of data that hasn't arrived.
export function ladderStates({ steps, counts = null, caughtUpMap = null, today = todayISO() } = {}) {
  const out = [];
  let aboveAllClear = true;
  for (const step of (Array.isArray(steps) ? steps : [])) {
    if (!step) continue;
    const tracked = typeof step.workLabel === 'function';
    // `?? null`, not `undefined`: a tracked step whose count hasn't been
    // handed to us reads as still loading, which shows nothing, rather
    // than as an uncounted step the user is expected to tick.
    const count = tracked ? (counts?.[step.key] ?? null) : undefined;
    const marked = isMarkedCaughtUp(caughtUpMap, step.key, today);
    let state = categorizeStep({ count, marked });
    if (state === 'open' && step.dueWhenReached && aboveAllClear) state = 'due';
    out.push({ key: step.key, state, count, tracked });
    if (state !== 'caught-up') aboveAllClear = false;
  }
  return out;
}

// The same rows keyed by step, for a caller rendering its own loop.
export function statesByKey(states) {
  const m = {};
  for (const s of (Array.isArray(states) ? states : [])) if (s?.key) m[s.key] = s;
  return m;
}

// How many steps the ladder has reached and the user hasn't marked — the
// number behind the sidebar's Prospecting dot. Only `dueWhenReached` steps
// can be in this state, so it is 0 or 1 with the shipped playbook.
export function countDueSteps(states) {
  let n = 0;
  for (const s of (Array.isArray(states) ? states : [])) if (s?.state === 'due') n += 1;
  return n;
}
