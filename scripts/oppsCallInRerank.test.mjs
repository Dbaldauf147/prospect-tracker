// Assertion tests for the Opps 2 "stuck on the top row" fix. Plain Node —
// no test framework (the project has none). Run:
//   node scripts/oppsCallInRerank.test.mjs
//
// The Opps table's Call In order is a snapshot, not a live sort: it's
// applied once at load, and the Call In column is `freezeSortOrder` so a
// header click pins the order it found. That's deliberate — a live re-sort
// would yank rows out from under the cursor mid-edit. The cost is that a
// row whose Call In moved keeps the place it had, and since triage runs
// top-down, the row that refuses to move is the one on top.
//
// The fix re-ranks from every route that can change a Call In, which only
// works if two rules hold:
//
//   - resolveSortSignal must apply the re-rank when the table is showing
//     that ordering already, and refuse when the user has sorted by
//     something else. Firing from many more places makes the refusal the
//     load-bearing half: without it, a sync from another device would
//     yank a user out of an Account sort.
//   - remoteChangesCallInOrder must spot a Call In that actually moved,
//     and only that. Too eager and every remote keystroke re-ranks the
//     table under the user; too shy and the row stays stuck.
import { resolveSortSignal } from '../src/utils/tableSortSignal.js';
import { remoteChangesCallInOrder } from '../src/utils/oppsCallIn.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${a}, want ${e})`}`);
}

// ISO date `offset` days from today, local time — the same clock
// resolveCallIn reads, so these don't drift with the runner's timezone.
function isoOffset(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const signal = { key: 'Call In', direction: 'asc', nonce: 1 };

// --- resolveSortSignal: when the re-rank applies --------------------------
check(
  'unsorted table takes the signal',
  resolveSortSignal({ key: null, direction: 'asc' }, signal),
  { key: 'Call In', direction: 'asc' },
);
check(
  'missing sort state takes the signal',
  resolveSortSignal(undefined, signal),
  { key: 'Call In', direction: 'asc' },
);
check(
  'already sorted on the same key takes the signal',
  resolveSortSignal({ key: 'Call In', direction: 'asc' }, signal),
  { key: 'Call In', direction: 'asc' },
);

// The whole point of the guard: a user who picked another column keeps it.
check(
  'sorted by another column ignores the signal',
  resolveSortSignal({ key: 'Account', direction: 'asc' }, signal),
  null,
);
check(
  'a signal with no key does nothing',
  resolveSortSignal({ key: null, direction: 'asc' }, { direction: 'asc', nonce: 2 }),
  null,
);
check('no signal at all does nothing', resolveSortSignal({ key: null }, null), null);

// Re-ranking corrects an order; it must not redefine it. A user reading
// Call In descending (furthest-out first) stays descending.
check(
  'descending on the same key keeps the direction',
  resolveSortSignal({ key: 'Call In', direction: 'desc' }, signal),
  { key: 'Call In', direction: 'desc' },
);
check(
  'a desc signal onto an unsorted table applies desc',
  resolveSortSignal({ key: null }, { key: 'Call In', direction: 'desc', nonce: 3 }),
  { key: 'Call In', direction: 'desc' },
);
check(
  'an unrecognized direction falls back to asc',
  resolveSortSignal({ key: null }, { key: 'Call In', direction: 'sideways', nonce: 4 }),
  { key: 'Call In', direction: 'asc' },
);

// --- remoteChangesCallInOrder: when a sync should re-rank ------------------
const row = (id, followUp, extra) => ({ _id: id, 'Follow Up': followUp, ...(extra || {}) });
const local = [row(1, isoOffset(-3)), row(2, isoOffset(0)), row(3, isoOffset(5))];

check('an identical remote copy changes nothing', remoteChangesCallInOrder(local, local), false);
check(
  'a re-dated Follow Up moves the row',
  remoteChangesCallInOrder(local, [row(2, isoOffset(21))]),
  true,
);
check(
  'a row this browser has never seen needs a place',
  remoteChangesCallInOrder(local, [row(99, isoOffset(1))]),
  true,
);
check(
  'a Call In cleared elsewhere moves the row',
  remoteChangesCallInOrder(local, [row(1, isoOffset(-3), { 'Call In': '-' })]),
  true,
);
check(
  'a Call In restored elsewhere moves the row',
  remoteChangesCallInOrder(
    [row(1, isoOffset(-3), { 'Call In': '-' })],
    [row(1, isoOffset(-3))],
  ),
  true,
);

// Only a moved Call In counts. A remote edit to any other field — or a
// reformat of the same date — must not re-rank the table under the user.
check(
  'a remote edit to another field is not a move',
  remoteChangesCallInOrder(local, [row(1, isoOffset(-3), { Status: 'Waiting on client' })]),
  false,
);
check(
  'the same date reformatted is not a move',
  remoteChangesCallInOrder(
    [row(1, '2026-09-09')],
    [row(1, '9/9/2026')],
  ),
  false,
);
check('an empty remote set changes nothing', remoteChangesCallInOrder(local, []), false);
check('a missing remote set changes nothing', remoteChangesCallInOrder(local, null), false);
check(
  'rows without an _id are skipped, not treated as new',
  remoteChangesCallInOrder(local, [{ 'Follow Up': isoOffset(9) }]),
  false,
);
// String vs number ids come from different write paths (sheet import vs
// hand-created); matching them loosely keeps a synced row from reading as
// brand new on every snapshot.
check(
  'ids match across string and number forms',
  remoteChangesCallInOrder([row(7, isoOffset(2))], [row('7', isoOffset(2))]),
  false,
);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
