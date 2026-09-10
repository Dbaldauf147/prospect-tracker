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
//   6. The catalog — the COA items list kept on the Dropdowns page. Every
//      item on it is a row on every opp, so the merge is what has to hold:
//      an opp's recorded dates land under their own item rather than beside
//      it, an item the list doesn't name is never dropped from the opp that
//      typed it, and a list that grows still stores nothing on an opp
//      nobody has answered.

import {
  DEFAULT_COA_ITEMS, emptyCoaItem, normalizeCoaItems, coaItemsForOpp,
  coaItemsToStore, coaItemStatus, coaDaysWaiting, coaItemsSummary,
  unsettledCoaItems, outstandingCoaItems, coaCatalogNames, withCoaCatalog,
  applyCoaCatalogChange,
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
eq("an opp's own item shows after the catalog's",
  coaItemsForOpp({ _coaItems: [row('Non-standard terms', '2026-09-01')] }),
  [row('3% esc'), row('Non-standard terms', '2026-09-01')]);
eq('what the opp recorded lands under the catalog item, not beside it',
  coaItemsForOpp({ _coaItems: [row('3% esc', '2026-09-01')] }, ['3% esc', 'Payment terms']),
  [row('3% esc', '2026-09-01'), row('Payment terms')]);
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

// --- what is still to be chased -------------------------------------------
//
// Feeds the "COA approvals needed" flag on an opp at Agreement Sent.

eq('an approved row is settled',
  unsettledCoaItems([row('3% esc', '2026-09-01', '2026-09-05')]), []);
eq('an N/A row is settled', unsettledCoaItems([naRow('3% esc')]), []);
eq('a requested row is not settled',
  unsettledCoaItems([row('3% esc', '2026-09-01')]), [row('3% esc', '2026-09-01')]);
eq('nor is one nobody has asked for', unsettledCoaItems([row('3% esc')]), [row('3% esc')]);
eq('the blank form row does not', unsettledCoaItems([emptyCoaItem()]), []);
eq('only the unsettled ones come back',
  unsettledCoaItems([
    row('3% esc', '2026-09-01', '2026-09-05'),
    naRow('Payment terms'),
    row('Non-standard terms', '2026-09-02'),
  ]),
  [row('Non-standard terms', '2026-09-02')]);

// Per opp, the seeded question counts as unanswered until the record carries
// a row for it — a row named only "3% esc" is never stored, so its absence IS
// "nobody has dealt with the escalator", whatever else the opp has stored.
eq('an opp with nothing stored still owes the default',
  outstandingCoaItems({}), [row('3% esc')]);
eq('so does one that stored other items and never answered it',
  outstandingCoaItems({ _coaItems: [naRow('Payment terms')] }), [row('3% esc')]);
eq('an approved default settles it',
  outstandingCoaItems({ _coaItems: [row('3% esc', '2026-09-01', '2026-09-05')] }), []);
eq('so does marking it N/A',
  outstandingCoaItems({ _coaItems: [naRow('3% esc')] }), []);
eq('a request that has not come back is still outstanding',
  outstandingCoaItems({ _coaItems: [row('3% esc', '2026-09-01')] }),
  [row('3% esc', '2026-09-01')]);
eq('the catalog item comes first, the opp\'s own after',
  outstandingCoaItems({ _coaItems: [row('Non-standard terms', '2026-09-02')] }),
  [row('3% esc'), row('Non-standard terms', '2026-09-02')]);
eq('everything settled is nothing outstanding',
  outstandingCoaItems({ _coaItems: [naRow('3% esc'), row('Payment terms', '2026-09-01', '2026-09-04')] }), []);

// --- the catalog: the COA items list every opp is asked about --------------
//
// Kept on the Dropdowns page (utils/coaItemOptions.js) and passed in. Every
// item on it is a row on every opp, which is what makes it a checklist rather
// than a record of what somebody once typed.

const CATALOG = ['3% esc', 'Payment terms', 'Non-standard terms'];

eq('a hand-typed list is trimmed, de-duped and blanks dropped',
  coaCatalogNames([' 3% esc ', '3% ESC', '', null, 'Payment terms']),
  ['3% esc', 'Payment terms']);
eq('a missing list is no names', coaCatalogNames(undefined), []);

eq('every catalog item is a row on an opp that has answered none of them',
  coaItemsForOpp({}, CATALOG),
  [row('3% esc'), row('Payment terms'), row('Non-standard terms')]);
eq('the rows keep catalog order however the opp stored them',
  coaItemsForOpp({ _coaItems: [row('Non-standard terms', '2026-09-02'), row('3% esc', '2026-09-01')] }, CATALOG),
  [row('3% esc', '2026-09-01'), row('Payment terms'), row('Non-standard terms', '2026-09-02')]);
// The item cell is free text, so a deal can carry an exception nobody put on
// the list — and removing an item from the list must not delete the dates
// recorded under it.
eq('an item the catalog does not name is kept, at the end',
  coaItemsForOpp({ _coaItems: [row('One-off waiver', '2026-09-03')] }, ['3% esc']),
  [row('3% esc'), row('One-off waiver', '2026-09-03')]);
eq('a stored row matches its catalog item whatever its casing',
  coaItemsForOpp({ _coaItems: [row('3% ESC', '2026-09-01')] }, ['3% esc']),
  [row('3% ESC', '2026-09-01')]);
eq('an emptied catalog still leaves a row to type into',
  coaItemsForOpp({}, []), [emptyCoaItem()]);
eq('the blank form row survives a catalog change',
  withCoaCatalog([row('3% esc', '2026-09-01'), emptyCoaItem()], CATALOG),
  [row('3% esc', '2026-09-01'), row('Payment terms'), row('Non-standard terms'), emptyCoaItem()]);

// A longer list must not put COA data on opps nobody has answered — the rows
// are a question, and only an answer is a record.
eq('a longer catalog still stores nothing on an untouched opp',
  coaItemsToStore(coaItemsForOpp({}, CATALOG), CATALOG), []);
eq('answer one and only that one is stored',
  coaItemsToStore([row('3% esc'), row('Payment terms', '2026-09-01'), naRow('Non-standard terms')], CATALOG),
  [row('Payment terms', '2026-09-01'), naRow('Non-standard terms')]);
// An item dropped from the catalog is no longer a question, so a row naming
// it is the opp's own — and is stored, dates or not.
eq('a name off the catalog is the opp\'s own item',
  coaItemsToStore([row('3% esc'), row('One-off waiver')], CATALOG),
  [row('One-off waiver')]);

eq('every unanswered catalog item is outstanding',
  outstandingCoaItems({ _coaItems: [row('3% esc', '2026-09-01', '2026-09-05')] }, CATALOG),
  [row('Payment terms'), row('Non-standard terms')]);
eq('answering all of them clears the flag',
  outstandingCoaItems({
    _coaItems: [row('3% esc', '2026-09-01', '2026-09-05'), naRow('Payment terms'), row('Non-standard terms', '2026-09-02', '2026-09-06')],
  }, CATALOG), []);
eq('the header counts the answers, not the questions',
  coaItemsSummary(coaItemsForOpp({ _coaItems: [row('Payment terms', '2026-09-01')] }, CATALOG), NOW, CATALOG),
  { total: 1, approved: 0, waiting: 1, oldestWaitingDays: 8, na: 0 });

// --- the list changing under an open editor -------------------------------
//
// The Dropdowns tab and an opp can be open at once, so a rename or a removal
// has to reach the table already on screen. The trap is the row the OLD list
// put there: left alone it reads as an item of this opp's own, and being the
// opp's own item is exactly what makes a row worth storing — so an empty
// leftover would be written onto the record by the next edit anywhere in the
// table.

eq('a renamed item takes its row with it',
  applyCoaCatalogChange(
    [row('3% esc'), row('Non-standard terms')],
    ['3% esc', 'Non-standard terms'], ['3% esc', 'Non-standard T&Cs']),
  [row('3% esc'), row('Non-standard T&Cs')]);
eq('a removed item takes its empty row with it',
  applyCoaCatalogChange([row('3% esc'), row('Payment terms')], CATALOG, ['3% esc']),
  [row('3% esc')]);
// Anything recorded stays, wherever it came from: removing an item from the
// list must never delete a date somebody entered under it.
eq('a removed item keeps a row that carries dates',
  applyCoaCatalogChange(
    [row('3% esc'), row('Payment terms', '2026-09-01')], CATALOG, ['3% esc']),
  [row('3% esc'), row('Payment terms', '2026-09-01')]);
eq('or one somebody marked N/A',
  applyCoaCatalogChange([naRow('Payment terms')], CATALOG, ['3% esc']),
  [row('3% esc'), naRow('Payment terms')]);
eq('an added item appears without disturbing the rest',
  applyCoaCatalogChange(
    [row('3% esc', '2026-09-01'), emptyCoaItem()], ['3% esc'], ['3% esc', 'Payment terms']),
  [row('3% esc', '2026-09-01'), row('Payment terms'), emptyCoaItem()]);
// A name typed into the table but not yet committed to the list is not the
// old list's row, so a change arriving from another browser tab leaves it be.
eq("a name the old list never had is left alone",
  applyCoaCatalogChange(
    [row('3% esc'), row('Half-typed na')], ['3% esc'], ['3% esc', 'Payment terms']),
  [row('3% esc'), row('Payment terms'), row('Half-typed na')]);

console.log(failures === 0 ? '\nAll COA item tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
