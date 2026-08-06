// Assertion tests for tagging a call to an opportunity — or to nothing.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/callOppTag.test.mjs
//
// src/utils/callOppTag.js is import-free so it can be exercised here. It
// holds one rule worth pinning above all others: a call is tagged, or
// deliberately N/A, or waiting — and never two of those at once. Getting
// that wrong doesn't crash anything, it just quietly corrupts the only
// number on the page that says how much triage is left.
import {
  oppTagStateOf, oppTagLabelOf, isOppTagged,
  tagOppPatch, markOppNaPatch, clearOppTagPatch,
  oppTagCounts, filterByOppTag,
} from '../src/utils/callOppTag.js';
import { historyRowFromRecord, historyTotals, filterHistoryRows } from '../src/utils/callHistory.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const OPP = { _id: 'opp_1', Account: 'Prologis', Scope: 'Bill payment' };

// ---- the three states -------------------------------------------------------

eq(oppTagStateOf(null), 'none', 'nothing is undecided');
eq(oppTagStateOf({}), 'none', 'a bare record is undecided');
eq(oppTagStateOf({ oppId: 'opp_1' }), 'tagged', 'an opp id means tagged');
eq(oppTagStateOf({ oppNa: true }), 'na', 'the N/A flag means N/A');
eq(oppTagStateOf({ oppId: '   ' }), 'none', 'whitespace is not an opp id');

// Both set can only come from a hand-written patch. A call with a real
// opp on it is tagged, whatever a stale flag says — the alternative is
// hiding a tagged call from the tagged list.
eq(oppTagStateOf({ oppId: 'opp_1', oppNa: true }), 'tagged', 'a real opp wins over a stale N/A flag');

eq(oppTagLabelOf({ oppId: 'opp_1', oppLabel: 'Prologis — Bill payment' }), 'Prologis — Bill payment', 'a tagged call reads as its opp');
eq(oppTagLabelOf({ oppId: 'opp_1' }), 'Opportunity', 'a tagged call with no label still reads as something');
eq(oppTagLabelOf({ oppNa: true }), 'N/A', 'an N/A call reads as N/A');
eq(oppTagLabelOf({}), '', 'an undecided call reads as nothing at all');

eq(isOppTagged({ oppNa: true }), true, 'N/A counts as triaged: it is a decision');
eq(isOppTagged({}), false, 'undecided does not count as triaged');

// ---- the patches ------------------------------------------------------------
//
// Each patch has to CLEAR the other decision, not just set its own.
// Leaving the loser behind is how a call ends up in two piles, or how an
// N/A springs back the moment an opp tag is removed.

const tagged = tagOppPatch(OPP, { label: 'Prologis — Bill payment' });
eq(tagged.oppId, 'opp_1', 'tagging stores the opp id');
eq(tagged.oppLabel, 'Prologis — Bill payment', 'tagging stores the label');
eq(tagged.oppNa, false, 'tagging clears the N/A flag');
eq(tagged.oppNaAt, '', 'tagging clears the N/A timestamp');
eq(tagged.company, 'Prologis', 'a call with no company adopts the opp’s account');
eq(
  tagOppPatch(OPP, { label: 'x', company: 'Prologis Europe' }).company,
  undefined,
  'a company the user already set is never overwritten',
);
eq(tagOppPatch({ _id: 'opp_2' }, { label: 'x' }).company, undefined, 'an opp with no account invents no company');

const na = markOppNaPatch(new Date('2026-08-06T12:00:00.000Z'));
eq(na.oppNa, true, 'N/A sets the flag');
eq(na.oppNaAt, '2026-08-06T12:00:00.000Z', 'N/A is stamped, so a deliberate one is tellable from a stray field');
eq(na.oppId, '', 'N/A drops any opp tag');
eq(na.oppLabel, '', 'N/A drops the opp label with it');

const cleared = clearOppTagPatch();
eq(oppTagStateOf({ ...{ oppId: 'opp_1', oppLabel: 'x' }, ...cleared }), 'none', 'clearing a tagged call returns it to the queue');
eq(oppTagStateOf({ ...na, ...cleared }), 'none', 'clearing an N/A call returns it to the queue too');

// Round trip: tag → N/A → tag. The state has to be exactly right at each
// step, with nothing left over from the one before.
let record = {};
record = { ...record, ...tagOppPatch(OPP, { label: 'Prologis — Bill payment' }) };
eq(oppTagStateOf(record), 'tagged', 'round trip: tagged');
record = { ...record, ...markOppNaPatch() };
eq(oppTagStateOf(record), 'na', 'round trip: N/A replaces the tag outright');
eq(oppTagLabelOf(record), 'N/A', 'round trip: and the label follows');
record = { ...record, ...tagOppPatch(OPP, { label: 'Prologis — Bill payment', company: 'Prologis' }) };
eq(oppTagStateOf(record), 'tagged', 'round trip: tagging again beats the N/A');

// ---- counting and filtering the piles ---------------------------------------

const pile = [
  { oppId: 'opp_1' },
  { oppId: 'opp_2' },
  { oppNa: true },
  {},
  {},
  {},
];
eq(oppTagCounts(pile), { tagged: 2, na: 1, untagged: 3, total: 6 }, 'the three piles add up to the whole list');
eq(oppTagCounts(null), { tagged: 0, na: 0, untagged: 0, total: 0 }, 'no calls is not a crash');
eq(filterByOppTag(pile, 'untagged').length, 3, 'the queue is the untagged calls');
eq(filterByOppTag(pile, 'na').length, 1, 'N/A is its own pile');
eq(filterByOppTag(pile, 'all').length, 6, 'all means all');
eq(filterByOppTag(pile, '').length, 6, 'no filter means all');

// ---- through the history row ------------------------------------------------
//
// The table reads rows, not records, so the state has to survive the
// mapping — and "N/A" must not end up in the field that holds an opp's
// NAME, where a search for it would match a deal somebody called N/A.

const rowOf = (rec) => historyRowFromRecord({ id: 'granola:1', name: 'A call', ...rec });
eq(rowOf({ oppId: 'opp_1', oppLabel: 'Prologis — Bill payment' }).oppTag, 'tagged', 'a tagged record makes a tagged row');
eq(rowOf({ oppNa: true }).oppTag, 'na', 'an N/A record makes an N/A row');
eq(rowOf({}).oppTag, 'none', 'an untriaged record makes a queued row');
eq(rowOf({ oppNa: true }).oppLabel, '', 'N/A never leaks into the opportunity NAME field');
eq(rowOf({ oppNa: true }).oppTagLabel, 'N/A', 'it lives in its own display field instead');
eq(
  rowOf({ oppNa: true, oppNaAt: '2026-08-06T12:00:00.000Z' }).oppNaAt,
  '2026-08-06T12:00:00.000Z',
  'when it was marked travels with the row, so the cell can say',
);

const rows = [
  rowOf({ oppId: 'opp_1', oppLabel: 'Prologis — Bill payment' }),
  rowOf({ oppNa: true }),
  rowOf({}),
  rowOf({}),
];
eq(historyTotals(rows).needsOppTag, 2, 'the totals line counts only the queue');
eq(historyTotals([rowOf({ oppNa: true })]).needsOppTag, 0, 'an N/A call is not work still to do');

// Searching for "N/A" finds the calls marked N/A, and doesn't rely on
// the opp-name field to do it.
eq(filterHistoryRows(rows, 'N/A').length, 1, 'the free-text search can find the N/A pile');

// The counts and the filters run over ROWS in the History table, not
// over records — and a row carries `oppTag` rather than the fields it
// was derived from. Reading only the raw fields reported every row as
// undecided: the N/A filter came back empty and the queue was overstated
// by exactly the calls already dealt with.
eq(
  oppTagCounts(rows),
  { tagged: 1, na: 1, untagged: 2, total: 4 },
  'the piles are counted correctly over history rows, not just records',
);
eq(filterByOppTag(rows, 'na').length, 1, 'the N/A filter finds an N/A row');
eq(filterByOppTag(rows, 'untagged').length, 2, 'the queue filter finds only undecided rows');
eq(filterByOppTag(rows, 'tagged')[0].oppLabel, 'Prologis — Bill payment', 'the tagged filter finds the tagged row');

// A row whose oppTag says one thing and whose raw fields say another
// trusts the precomputed value: it is what the table rendered from.
eq(oppTagStateOf({ oppTag: 'na', oppId: '' }), 'na', 'a row is read by its own tag field');
eq(oppTagStateOf({ oppTag: 'nonsense', oppId: 'opp_1' }), 'tagged', 'an unrecognised tag falls back to the raw fields');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
