// Assertion tests for the YOY Quoted Projections month-end rebuild. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/quotedMonthRebuild.test.mjs
//
// The chart plots one Agreements Sent figure per month. Months the app was
// open for get captured live; the rest are reconstructed from today's Opps
// data, and the reconstruction used to read each opp's CURRENT Stage. That
// made the figure the same for every past month — an opp sitting in
// "Agreement Sent" today was counted into months it hadn't reached yet, and
// one sold since dropped out of the months it had genuinely been out on
// agreement for. Three months in a row reported an identical $297K.
//
// Two things have to hold for that to stay fixed:
//
//   * stageAsOf reads the stage an opp was in AT the month end, off the
//     `_stageHistory` / `_stageEnteredAt` trail Opps 2 keeps.
//   * rebuildOwnsMonth lets the rebuild re-derive its own past work (so a fix
//     reaches months already stored) without ever touching a figure the user
//     typed.

import {
  stageAsOf, monthEndMs, sameQuotedValues, capturedAtMonthEnd, rebuildOwnsMonth,
} from '../src/utils/quotedMonthRebuild.js';

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`PASS  ${name}`); return; }
  failures++;
  console.log(`FAIL  ${name}`);
}
function eq(name, actual, expected) {
  check(`${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const JUN = monthEndMs('2026-06');
const JUL = monthEndMs('2026-07');
const AUG = monthEndMs('2026-08');

eq('June ends on the 30th', new Date(JUN).toISOString().slice(0, 10), '2026-06-30');
eq('a malformed month key has no end', monthEndMs('nonsense'), null);

// EOS: out on agreement through June and July, sold in August. The old
// rebuild read "Sold" and left it out of both months.
const eos = {
  Account: 'EOS',
  Stage: 'Sold',
  _stageEnteredAt: '2026-08-12',
  _stageHistory: [
    { stage: 'Quoted', enteredAt: '2026-04-02', exitedAt: '2026-06-05', days: 64 },
    { stage: 'Agreement Sent', enteredAt: '2026-06-05', exitedAt: '2026-08-12', days: 68 },
  ],
};
eq('EOS was out on agreement at June end', stageAsOf(eos, JUN), { stage: 'Agreement Sent', tracked: true });
eq('EOS was still out on agreement at July end', stageAsOf(eos, JUL), { stage: 'Agreement Sent', tracked: true });
eq('EOS is sold by August end', stageAsOf(eos, AUG), { stage: 'Sold', tracked: true });

// URW: only reached Agreement Sent in August. The old rebuild counted it
// into June and July, which is the other half of the identical figure.
const urw = {
  Account: 'URW',
  Stage: 'Agreement Sent',
  _stageEnteredAt: '2026-08-14',
  _stageHistory: [
    { stage: 'Quoting', enteredAt: '2026-03-01', exitedAt: '2026-05-20', days: 80 },
    { stage: 'Quoted', enteredAt: '2026-05-20', exitedAt: '2026-08-14', days: 86 },
  ],
};
eq('URW was only Quoted at June end', stageAsOf(urw, JUN), { stage: 'Quoted', tracked: true });
eq('URW was still only Quoted at July end', stageAsOf(urw, JUL), { stage: 'Quoted', tracked: true });
eq('URW is out on agreement by August end', stageAsOf(urw, AUG), { stage: 'Agreement Sent', tracked: true });

// A move recorded on the last day of the month counts as having happened
// during that day, so the month end sees the stage it moved INTO.
const sameDay = {
  Stage: 'Agreement Sent',
  _stageEnteredAt: '2026-06-30',
  _stageHistory: [{ stage: 'Quoted', enteredAt: '2026-05-01', exitedAt: '2026-06-30', days: 60 }],
};
eq('a move on the 30th lands inside June', stageAsOf(sameDay, JUN), { stage: 'Agreement Sent', tracked: true });

// An opp that has sat still since before the month end reports today's
// stage, and says so: the history places it.
const settled = {
  Stage: 'Quoted',
  _stageEnteredAt: '2026-02-10',
  _stageHistory: [{ stage: 'Quoting', enteredAt: '2026-01-05', exitedAt: '2026-02-10', days: 36 }],
};
eq('an untouched opp keeps its stage', stageAsOf(settled, JUN), { stage: 'Quoted', tracked: true });

// Rows with no history at all fall back to today's stage — the old
// behaviour — but are flagged so the export can say the rebuild is guessing.
eq('a row with no history is untracked',
  stageAsOf({ Stage: 'Agreement Sent' }, JUN), { stage: 'Agreement Sent', tracked: false });
eq('a row whose only move postdates the month end is untracked',
  stageAsOf({ Stage: 'Sold', _stageEnteredAt: '2026-08-01' }, JUN), { stage: 'Sold', tracked: false });
eq('an undated history entry does not place the opp',
  stageAsOf({ Stage: 'Sold', _stageHistory: [{ stage: 'Quoted', exitedAt: '' }] }, JUN),
  { stage: 'Sold', tracked: false });
eq('a missing record is handled', stageAsOf(null, JUN), { stage: '', tracked: false });

// --- which months the rebuild may re-derive -------------------------------

check('an empty month is the rebuild\'s', rebuildOwnsMonth(null, '2026-06') === true);
check('a previous rebuild is re-derived', rebuildOwnsMonth({ agreements: 297, _rebuilt: true }, '2026-06') === true);
check('a hand-typed month is left alone', rebuildOwnsMonth({ agreements: 311 }, '2026-05') === false);
check('a seeded historical month is left alone',
  rebuildOwnsMonth({ weak: 402, ok: 402, expected: 329, agreements: 311, bfoPipe: 3186 }, '2026-05') === false);
check('a mid-month auto-capture is re-derived',
  rebuildOwnsMonth({ agreements: 297, _auto: true, _capturedAt: '2026-06-12T14:00:00.000Z' }, '2026-06') === true);
check('a month-end auto-capture stands',
  rebuildOwnsMonth({ agreements: 297, _auto: true, _capturedAt: '2026-06-30T21:00:00.000Z' }, '2026-06') === false);
check('an auto-capture from before the stamp existed is re-derived',
  rebuildOwnsMonth({ agreements: 297, _auto: true }, '2026-06') === true);
check('a capture stamped after the month rolled over still counts as the month end',
  capturedAtMonthEnd({ _capturedAt: '2026-07-01T02:00:00.000Z' }, '2026-06') === true);
check('an unparseable capture stamp counts for nothing',
  capturedAtMonthEnd({ _capturedAt: 'whenever' }, '2026-06') === false);

// --- the no-op guard on a re-derive ---------------------------------------

const stored = { weak: 636, ok: 577, expected: 253, agreements: 253, bfoPipe: 2928, _rebuilt: true };
check('an identical re-derive is recognised',
  sameQuotedValues(stored, { weak: 636, ok: 577, expected: 253, agreements: 253, bfoPipe: 2928, _rebuilt: true }));
check('a changed figure is not',
  sameQuotedValues(stored, { ...stored, agreements: 190 }) === false);
check('a figure that has gone missing is not',
  sameQuotedValues(stored, { ...stored, bfoPipe: undefined }) === false);
check('nothing stored never matches', sameQuotedValues(null, stored) === false);

console.log(failures === 0 ? '\nAll quoted month rebuild tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
