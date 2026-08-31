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
// The Prospecting ladder's "Follow up on current opps" step shows THIS
// number too — not one of its own. It used to keep a stricter "overdue"
// count (date strictly past, stage still open), which let the step read
// "All caught up" beside a red Opps badge and freed the step below it to
// raise the Prospecting dot over unworked calls. The last block pins the
// cases where the two rules diverged, so a step-specific count can't come
// back without a failure saying so.
import { countCallInDue, nfatUnmarked, resolveCallIn } from '../src/utils/oppsCallIn.js';

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

// --- the cases where the ladder used to disagree with the badge -----------
//
// Each of these counted 0 under the old "overdue" rule and non-zero here.
// That gap is the whole bug: 0 meant step 1 was clear, which let the market
// -updates step below it go 'due' and dot the Prospecting nav while these
// very rows sat red on the Opps badge.

// Same rows, plus a Stage — the old count looked at it, this one doesn't.
const staged = (followUp, stage = 'Qualifying', nfat) => ({ Stage: stage, ...opp(followUp, nfat) });

check('an opp due TODAY counts (the reported case: badge 1, step said clear)',
  countCallInDue([staged(isoOffset(0))]), 1);
check('a closed opp past its date still counts',
  countCallInDue([staged(isoOffset(-3), 'Sold')]), 1);
check('an error-stage row past its date still counts',
  countCallInDue([staged(isoOffset(-3), '#N/A')]), 1);
check('a row with no Stage at all counts',
  countCallInDue([opp(isoOffset(-3))]), 1);
check('…and "No Further Action Today" still wins over all of it',
  countCallInDue([staged(isoOffset(0), 'Qualifying', 'Yes'), staged(isoOffset(-3), 'Sold', 'Yes')]), 0);

// The mixed set the old count scored 2 on: every row bar the handled one
// is owed work by the badge's rule, so the ladder now sees 4.
check('mixed set: the badge rule counts what the old step rule dropped', countCallInDue([
  staged(isoOffset(-10)),                     // overdue           → counts
  staged(isoOffset(-1), 'Qualifying', 'Yes'), // overdue, handled  → no
  staged(isoOffset(0)),                       // due today         → counts (was not)
  staged(isoOffset(-6), 'Not Sold'),          // closed            → counts (was not)
  staged(isoOffset(-2)),                      // overdue           → counts
]), 4);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
