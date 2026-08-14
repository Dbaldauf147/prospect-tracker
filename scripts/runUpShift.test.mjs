// Assertion tests for the pre-signature run-up shift. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/runUpShift.test.mjs
//
// An authored timeline numbers its months from kickoff, so a "Before
// signature" step needs columns the axis doesn't have. The shift makes room:
// the pre-signature steps take the first columns and everything after the
// signature is pushed right by however many they occupy. Because those steps
// start at month 1 there, their END month IS the length of the run-up.
//
// That equivalence breaks the moment a plan places its steps somewhere other
// than month 1 — which the deal rollout does, since it schedules every band
// from the signature date and can shift the whole plan right to start the
// window before kickoff. The end month is then an absolute position, not a
// length, and using it as one shoved every step after the signature months
// into the future. It presented as "why is everything starting on 1 January",
// and the tell was that the gap GREW the earlier the window started.
import { applyRunUpShift } from '../src/utils/timelineDates.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}

// A run-up of one month, then the work — the authored-timeline shape.
const authored = (lead = 0) => [
  { stage: { name: 'Client collects invoices', preKickoff: true }, month: 1 + lead, span: 1 },
  { stage: { name: 'Client meet', preKickoff: true }, month: 1 + lead, span: 1 },
  { stage: { name: 'Project Kickoff' }, month: 1 + lead, span: 1 },
  { stage: { name: 'ERP System Setup' }, month: 2 + lead, span: 3 },
];
const months = (placed) => placed.map(p => [p.stage.name, p.month, p.month + p.span - 1]);

// --- an authored timeline, months relative to kickoff ----------------------

const shifted = applyRunUpShift(authored(), 0);
check('the run-up is one month long', shifted.preSpan, 1);
same('so the work moves one month right, and the run-up does not',
  months(shifted.placed),
  [['Client collects invoices', 1, 1], ['Client meet', 1, 1],
   ['Project Kickoff', 2, 2], ['ERP System Setup', 3, 5]]);

// Nothing before the signature: nothing to make room for, nothing moves.
const none = applyRunUpShift([
  { stage: { name: 'A' }, month: 1, span: 1 },
  { stage: { name: 'B' }, month: 2, span: 2 },
], 0);
check('a timeline with no run-up has no shift', none.preSpan, 0);
same('and every step keeps its month', months(none.placed), [['A', 1, 1], ['B', 2, 3]]);

// A longer run-up makes proportionally more room.
const long = applyRunUpShift([
  { stage: { name: 'Long run-up', preKickoff: true }, month: 1, span: 3 },
  { stage: { name: 'Work' }, month: 1, span: 1 },
], 0);
check('a three-month run-up shifts by three', long.preSpan, 3);
same('putting the work after it', months(long.placed), [['Long run-up', 1, 3], ['Work', 4, 4]]);

// --- a plan that states its own signature month ---------------------------
// The deal rollout. Every step is already on the month it means, so there is
// nothing to make room for.

const stated = applyRunUpShift(authored(), 1);
check('a stated signature month means no shift', stated.preSpan, 0);
same('and every step keeps exactly the month it was scheduled for',
  months(stated.placed), months(authored()));

// The regression, stated as the thing that gave it away: with the shift, the
// gap grew with the run-in; without it, the plan is identical whatever the
// window does. A two-month run-in is "today is August, we sign in October".
for (const lead of [0, 1, 2, 3]) {
  const out = applyRunUpShift(authored(lead), 1 + lead);
  const kickoff = out.placed.find(p => p.stage.name === 'Project Kickoff');
  // Project Kickoff is scheduled for the signature month itself; it must land
  // there whatever the run-in, rather than `lead` months past it.
  check(`a run-in of ${lead} leaves Project Kickoff on the signature month`, kickoff.month, 1 + lead);
}

// Junk in doesn't throw.
same('an empty list shifts to nothing', applyRunUpShift([], 0), { preSpan: 0, placed: [] });
same('a non-array is tolerated', applyRunUpShift(null, 0), { preSpan: 0, placed: [] });
check('a zero signature month is treated as unstated', applyRunUpShift(authored(), 0).preSpan, 1);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
