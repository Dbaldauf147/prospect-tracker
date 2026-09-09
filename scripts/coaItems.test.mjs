// Assertion tests for the COA approval items on an opportunity. Plain Node —
// no test framework (the project has none). Run:
//   node scripts/coaItems.test.mjs
//
// The table is three cells a row, which makes it look like there is nothing
// to get wrong. Four things are:
//
//   1. What gets STORED. The table always shows a row so there is something
//      to type into — seeded with "3% esc" on an opp that has none. That row
//      must not be written to the record, or every opp in the book silently
//      grows COA data nobody entered.
//   2. What a row's status is. An approval that came back without anyone
//      recording the request is approved; reading it as "not requested"
//      because the first date is blank is a status that argues with the date
//      printed beside it.
//   3. The waiting count. It is the number that decides whether to chase, so
//      it is counted from the requested date and never goes negative.
//   4. The header summary. It counts recorded rows only — a seeded row nobody
//      filled in is not an outstanding approval.
//   5. The N/A mark. "Doesn't apply to this deal" is a decision, so it is
//      stored even on the seeded row that is otherwise dropped, it settles a
//      row whatever dates it carries, and it is counted apart from the
//      approvals so a cleared deal doesn't read as "1 of 2 approved" forever.

import {
  DEFAULT_COA_ITEMS, emptyCoaItem, normalizeCoaItems, coaItemsForOpp,
  coaItemsToStore, coaItemStatus, coaDaysWaiting, coaItemsSummary,
} from '../src/utils/coaItems.js';

let failures = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
}
function eq(label, actual, expected) {
  check(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const NOW = Date.parse('2026-09-09T12:00:00');
const row = (item, requested = '', approved = '') => ({ item, requested, approved });
const naRow = (item, requested = '', approved = '') => ({ ...row(item, requested, approved), na: true });

// --- what the table shows -------------------------------------------------

eq('the first item is 3% esc', DEFAULT_COA_ITEMS, ['3% esc']);
eq('an opp with nothing stored gets the seeded row',
  coaItemsForOpp({}), [row('3% esc')]);
eq('an opp with rows shows its own',
  coaItemsForOpp({ _coaItems: [row('Non-standard terms', '2026-09-01')] }),
  [row('Non-standard terms', '2026-09-01')]);
eq('a blank row is three empty cells', emptyCoaItem(), row(''));

// Long-lived, hand-editable records: a row from an older version comes back
// usable rather than taking the opp's whole list with it.
eq('junk rows are dropped and the rest survive',
  normalizeCoaItems([null, 'nope', { item: ' 3% esc ', requested: ' 2026-09-01 ' }]),
  [row('3% esc', '2026-09-01')]);
eq('nothing stored is no rows', normalizeCoaItems(undefined), []);
eq('a missing field reads as blank', normalizeCoaItems([{ item: 'x' }]), [row('x')]);
// The mark is only written when it is set, so an ordinary row round-trips
// exactly as it did before there was one.
eq('an unmarked row carries no na key', normalizeCoaItems([row('x')]), [row('x')]);
eq('the na mark survives normalizing', normalizeCoaItems([naRow('3% esc')]), [naRow('3% esc')]);
eq('na:false is not a mark', normalizeCoaItems([{ ...row('x'), na: false }]), [row('x')]);

// --- what gets written to the record --------------------------------------

eq('the seeded row alone is not stored', coaItemsToStore([row('3% esc')]), []);
eq('nor is the empty form row', coaItemsToStore([emptyCoaItem()]), []);
eq('a date on the seeded row makes it real',
  coaItemsToStore([row('3% esc', '2026-09-01')]), [row('3% esc', '2026-09-01')]);
eq('an approval with no recorded request is real too',
  coaItemsToStore([row('3% esc', '', '2026-09-05')]), [row('3% esc', '', '2026-09-05')]);
eq('a named item is stored even before it has a date',
  coaItemsToStore([row('Non-standard terms')]), [row('Non-standard terms')]);
eq('the seed name is matched however it is cased',
  coaItemsToStore([row('3% ESC')]), []);
eq('a real row survives beside a blank one',
  coaItemsToStore([row('3% esc', '2026-09-01'), emptyCoaItem()]),
  [row('3% esc', '2026-09-01')]);
// "The 3% escalator doesn't apply to this deal" is an answer about the deal.
// Dropping it as an untouched seed row would put the question back every time
// the opp is opened.
eq('N/A on the seeded row is worth storing',
  coaItemsToStore([naRow('3% esc')]), [naRow('3% esc')]);
eq('but N/A on a row with no item still is not',
  coaItemsToStore([{ ...emptyCoaItem(), na: true }]), []);

// --- where a row stands ---------------------------------------------------

eq('nothing asked for yet', coaItemStatus(row('3% esc')), 'open');
eq('asked for, still out', coaItemStatus(row('3% esc', '2026-09-01')), 'requested');
eq('come back approved', coaItemStatus(row('3% esc', '2026-09-01', '2026-09-05')), 'approved');
// The approval is the answer, whether or not the request was ever logged.
eq('approved with no logged request is still approved',
  coaItemStatus(row('3% esc', '', '2026-09-05')), 'approved');
eq('marked N/A', coaItemStatus(naRow('3% esc')), 'na');
// A request that went out before anyone realised the exception didn't apply
// is not still out.
eq('N/A settles a row that was already requested',
  coaItemStatus(naRow('3% esc', '2026-09-01')), 'na');

// --- how long a request has been out --------------------------------------

eq('waiting since the 1st', coaDaysWaiting(row('3% esc', '2026-09-01'), NOW), 8);
eq('requested today is zero days', coaDaysWaiting(row('3% esc', '2026-09-09'), NOW), 0);
// A request dated in the future is a typo, not a negative wait.
eq('a future request does not count backwards',
  coaDaysWaiting(row('3% esc', '2026-09-20'), NOW), 0);
eq('an approved row is not waiting',
  coaDaysWaiting(row('3% esc', '2026-09-01', '2026-09-05'), NOW), null);
eq('an unrequested row is not waiting', coaDaysWaiting(row('3% esc'), NOW), null);
eq('an N/A row is not waiting either',
  coaDaysWaiting(naRow('3% esc', '2026-09-01'), NOW), null);
eq('an unparseable date is not a wait', coaDaysWaiting(row('3% esc', 'soon'), NOW), null);

// --- the header line ------------------------------------------------------

eq('an untouched opp has nothing to summarize',
  coaItemsSummary([row('3% esc')], NOW),
  { total: 0, approved: 0, waiting: 0, oldestWaitingDays: null, na: 0 });
eq('one approved, two waiting, oldest leads',
  coaItemsSummary([
    row('3% esc', '2026-09-01', '2026-09-05'),
    row('Non-standard terms', '2026-09-02'),
    row('Payment terms', '2026-08-30'),
  ], NOW),
  { total: 3, approved: 1, waiting: 2, oldestWaitingDays: 10, na: 0 });
// N/A rows are counted on their own: an opp whose one live exception came
// back reads "1 of 1 approved", not "1 of 2".
eq('N/A rows sit outside the approval count',
  coaItemsSummary([
    row('3% esc', '2026-09-01', '2026-09-05'),
    naRow('Non-standard terms'),
  ], NOW),
  { total: 1, approved: 1, waiting: 0, oldestWaitingDays: null, na: 1 });
eq('an opp with nothing but N/A has no approvals to report',
  coaItemsSummary([naRow('3% esc')], NOW),
  { total: 0, approved: 0, waiting: 0, oldestWaitingDays: null, na: 1 });

console.log(failures === 0 ? '\nAll COA item tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
