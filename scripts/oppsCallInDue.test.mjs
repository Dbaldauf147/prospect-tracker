// Assertion tests for the sidebar's "opps due to be called" count. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/oppsCallInDue.test.mjs
//
// The badge answers one question: how many opps am I supposed to be calling
// right now? Two rules define it, and both have quiet failure modes:
//
//   - "zero or less" has to include zero. Today's calls are the ones most
//     likely to be missed, and an off-by-one that only counts negatives
//     would hide them until tomorrow.
//   - a row marked "No Further Action Today" is done for the day. If a mark
//     didn't drop the count, the badge would never reach zero and the user
//     would learn to ignore it.
//
// Follow Up dates are built off the local calendar (same clock resolveCallIn
// reads) so the tests don't drift with the runner's timezone.
// The Prospecting tab's "Follow up on current opps" count shares this module
// and the same "No Further Action Today" rule, with two differences of its
// own: it only counts opps already *past* their date, and it skips closed /
// error-stage rows. Both are covered at the bottom.
import { countCallInDue, countOverdueCallIns, nfatUnmarked, resolveCallIn } from '../src/utils/oppsCallIn.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${actual}, want ${expected})`}`);
}

// ISO date `offset` days from today, local time.
function isoOffset(offset) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const opp = (followUp, nfat) => ({
  'Follow Up': followUp,
  ...(nfat === undefined ? {} : { 'No Further Action Today': nfat }),
});

// --- the Call In boundary --------------------------------------------------
check('due today resolves to 0', resolveCallIn(opp(isoOffset(0))), 0);
check('overdue resolves negative', resolveCallIn(opp(isoOffset(-3))), -3);
check('future resolves positive', resolveCallIn(opp(isoOffset(5))), 5);

check('counts an opp due today', countCallInDue([opp(isoOffset(0))]), 1);
check('counts an overdue opp', countCallInDue([opp(isoOffset(-9))]), 1);
check('skips an opp due tomorrow', countCallInDue([opp(isoOffset(1))]), 0);

// --- the "No Further Action Today" gate -----------------------------------
check('blank mark counts', countCallInDue([opp(isoOffset(-1), '')]), 1);
check('whitespace-only mark counts', countCallInDue([opp(isoOffset(-1), '   ')]), 1);
check('checked (yes) is excluded', countCallInDue([opp(isoOffset(-1), 'Yes')]), 0);
check('x-ed (no) is excluded', countCallInDue([opp(isoOffset(-1), 'No')]), 0);
check('nfatUnmarked reads a missing column as unmarked', nfatUnmarked({}), true);
check('nfatUnmarked reads a mark as marked', nfatUnmarked({ 'No Further Action Today': 'Yes' }), false);

// --- rows that aren't on a callback schedule ------------------------------
check('no Follow Up date is skipped', countCallInDue([opp('')]), 0);
check('cleared Call In sentinel is skipped', countCallInDue([{ 'Follow Up': isoOffset(-4), 'Call In': '-' }]), 0);
check('stored Call In backs an undated row', countCallInDue([{ 'Call In': -2 }]), 1);
check('stored positive Call In is skipped', countCallInDue([{ 'Call In': 6 }]), 0);

// --- the whole set --------------------------------------------------------
check('mixed set totals correctly', countCallInDue([
  opp(isoOffset(-10)),          // overdue          → counts
  opp(isoOffset(0)),            // due today        → counts
  opp(isoOffset(0), 'Yes'),     // due but handled  → no
  opp(isoOffset(2)),            // future           → no
  opp(''),                      // not scheduled    → no
  opp(isoOffset(-1), ''),       // overdue, blank   → counts
]), 3);
check('non-array input is 0', countCallInDue(null), 0);
check('empty set is 0', countCallInDue([]), 0);

// --- the Prospecting step's overdue count ---------------------------------

// Same rows, plus a Stage (that count only looks at opps still in flight).
const active = (followUp, nfat) => ({ Stage: 'Qualifying', ...opp(followUp, nfat) });

check('counts an overdue active opp', countOverdueCallIns([active(isoOffset(-3))]), 1);
check('due today is not yet overdue', countOverdueCallIns([active(isoOffset(0))]), 0);
check('future is skipped', countOverdueCallIns([active(isoOffset(4))]), 0);

// The change: an overdue opp the user already settled today drops out, so
// the step can reach "clear" instead of counting work that's been handled.
check('overdue but marked is excluded', countOverdueCallIns([active(isoOffset(-3), 'Yes')]), 0);
check('an x-ed mark is excluded too', countOverdueCallIns([active(isoOffset(-3), 'No')]), 0);
check('a blank mark still counts', countOverdueCallIns([active(isoOffset(-3), '')]), 1);
check('whitespace-only still counts', countOverdueCallIns([active(isoOffset(-3), '  ')]), 1);

// Closed and error-stage rows stay out, mark or no mark.
check('a closed opp is skipped', countOverdueCallIns([{ ...active(isoOffset(-3)), Stage: 'Sold' }]), 0);
check('an error stage is skipped', countOverdueCallIns([{ ...active(isoOffset(-3)), Stage: '#N/A' }]), 0);

check('mixed set totals correctly', countOverdueCallIns([
  active(isoOffset(-10)),                          // overdue           → counts
  active(isoOffset(-1), 'Yes'),                    // overdue, handled  → no
  active(isoOffset(0)),                            // due today         → no
  { ...active(isoOffset(-6)), Stage: 'Not Sold' }, // closed            → no
  active(isoOffset(-2)),                           // overdue           → counts
]), 2);
check('non-array input is 0', countOverdueCallIns(null), 0);
check('empty set is 0', countOverdueCallIns([]), 0);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
