// Assertion tests for merging a Google-Sheets paste into the Deals roster.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/dealsPasteMerge.test.mjs
//
// The failures worth guarding here are the destructive ones. This import
// used to replace the whole roster, so the rules that must not regress are:
// deals the paste never mentions survive untouched, a matched deal only ever
// gains values in cells that were blank, and a client with several
// agreements never has one paste row silently land on the wrong deal.
import { planDealPaste, describeDealPaste, dealIdentity } from '../src/utils/dealsPasteMerge.js';

let pass = 0, fail = 0;
const ok = (c, n) => (c ? (pass += 1, console.log('PASS ', n)) : (fail += 1, console.log('FAIL ', n)));
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)})`);

// --- identity ---------------------------------------------------------------
eq(dealIdentity({ 'Client Name': '  Acme   Corp ', 'Agreement Name': 'MSA' }),
  { client: 'acme corp', agreement: 'msa' },
  'identity trims, collapses whitespace and case-folds');

// --- brand-new deals --------------------------------------------------------
{
  const { next, summary } = planDealPaste([], [
    { 'Client Name': 'Acme', 'Setup': '20000' },
    { 'Client Name': 'Beta', 'Setup': '5000' },
  ]);
  eq(next.length, 2, 'an empty roster takes every pasted row');
  eq([summary.added, summary.merged, summary.filledCells], [2, 0, 0], 'both rows count as added');
}

// --- new values fill in, duplicates are ignored ------------------------------
{
  const existing = [{ 'Client Name': 'Acme', 'Agreement Name': 'MSA', 'Setup': '20000' }];
  const { next, results, summary } = planDealPaste(existing, [
    { 'Client Name': 'Acme', 'Agreement Name': 'MSA', 'Setup': '20000', 'GM': 'Dan', 'Ticket': 'T-1' },
  ]);
  eq(next.length, 1, 'a deal already on file does not land a second time');
  eq(next[0], { 'Client Name': 'Acme', 'Agreement Name': 'MSA', 'Setup': '20000', 'GM': 'Dan', 'Ticket': 'T-1' },
    'the blank columns fill in and the filled one keeps its value');
  eq([summary.filledCells, summary.duplicateCells, summary.conflictCells], [2, 1, 0],
    'two cells filled, the repeated Setup ignored, nothing in conflict');
  eq(results[0].status, 'merged', 'the row reports as merged');
  // The columns that did the matching are duplicates by definition — they
  // must not pad the count the user reads.
  eq(summary.duplicateCells, 1, 'Client Name / Agreement Name are not counted as ignored duplicates');
}

// --- a cell that says something DIFFERENT ------------------------------------
{
  const existing = [{ 'Client Name': 'Acme', 'Setup': '20000' }];
  const { next, results, summary } = planDealPaste(existing, [{ 'Client Name': 'Acme', 'Setup': '99999' }]);
  eq(next[0].Setup, '20000', 'by default the value already on the deal wins');
  eq([summary.conflictCells, summary.overwrittenCells, summary.keptCells], [1, 0, 1], 'the clash is counted, not applied');
  eq(results[0].conflicts, [{ field: 'Setup', existing: '20000', pasted: '99999' }], 'the clash is reported cell by cell');

  const forced = planDealPaste(existing, [{ 'Client Name': 'Acme', 'Setup': '99999' }], { overwriteConflicts: true });
  eq(forced.next[0].Setup, '99999', 'overwriteConflicts hands the pasted value the win');
  eq([forced.summary.overwrittenCells, forced.summary.keptCells], [1, 0], 'and says so in the summary');
  eq(existing[0].Setup, '20000', 'neither plan mutates the roster it was handed');
}

// A value that only differs in spacing or case is a duplicate, not a clash.
{
  const { summary } = planDealPaste([{ 'Client Name': 'Acme', 'GM': 'Dan  Baldauf' }],
    [{ 'Client Name': 'acme', 'GM': 'dan baldauf' }]);
  eq([summary.duplicateCells, summary.conflictCells], [1, 0], 'spacing/case differences are duplicates');
}

// --- deals the paste never mentions -----------------------------------------
{
  const existing = [
    { 'Client Name': 'Acme', 'Setup': '20000' },
    { 'Client Name': 'Untouched', 'Setup': '1', 'Ticket': 'T-9' },
  ];
  const { next } = planDealPaste(existing, [{ 'Client Name': 'Acme', 'GM': 'Dan' }]);
  eq(next.length, 2, 'the roster keeps its other deals');
  eq(next[1], existing[1], 'a deal the paste never mentions is untouched');
}

// --- matching when only one side named the agreement ------------------------
{
  const { next, summary } = planDealPaste([{ 'Client Name': 'Acme', 'Setup': '20000' }],
    [{ 'Client Name': 'Acme', 'Agreement Name': 'MSA', 'GM': 'Dan' }]);
  eq([summary.added, summary.merged], [0, 1], 'the client’s only deal takes the paste');
  eq(next[0]['Agreement Name'], 'MSA', 'and the agreement name it was missing fills in');
}
{
  const { next, summary } = planDealPaste([{ 'Client Name': 'Acme', 'Agreement Name': 'MSA', 'Setup': '20000' }],
    [{ 'Client Name': 'Acme', 'GM': 'Dan' }]);
  eq([summary.added, summary.merged, next.length], [0, 1, 1], 'a paste row with no agreement name matches the one deal on file');
}

// A client with SEVERAL deals stays strict: without a matching agreement
// name there is no way to tell which deal was meant, so it opens a new row
// rather than writing onto the wrong contract.
{
  const existing = [
    { 'Client Name': 'Acme', 'Agreement Name': 'MSA', 'Setup': '20000' },
    { 'Client Name': 'Acme', 'Agreement Name': 'Renewal', 'Setup': '30000' },
  ];
  const ambiguous = planDealPaste(existing, [{ 'Client Name': 'Acme', 'GM': 'Dan' }]);
  eq([ambiguous.summary.added, ambiguous.next.length], [1, 3], 'an unnamed agreement never guesses between two deals');
  const named = planDealPaste(existing, [{ 'Client Name': 'Acme', 'Agreement Name': 'Renewal', 'GM': 'Dan' }]);
  eq([named.summary.added, named.summary.merged], [0, 1], 'a named agreement lands on its own deal');
  eq(named.next[1].GM, 'Dan', 'and on the right one');
}

// --- the same deal twice within one paste -----------------------------------
{
  const { next, summary } = planDealPaste([], [
    { 'Client Name': 'Acme', 'Setup': '20000' },
    { 'Client Name': 'Acme', 'GM': 'Dan' },
  ]);
  eq([next.length, summary.added, summary.merged], [1, 1, 1], 'a repeat within the paste merges into the row its first copy made');
  eq(next[0], { 'Client Name': 'Acme', 'Setup': '20000', 'GM': 'Dan' }, 'and contributes only its new values');
}

// --- rows there is nothing to do with ---------------------------------------
{
  const { next, results, summary } = planDealPaste([{ 'Client Name': 'Acme' }], [
    { 'Client Name': '', 'Setup': '' },
    { 'Setup': '5000' },
    { 'Client Name': '   ', 'GM': 'Dan' },
  ]);
  eq([next.length, summary.skipped], [1, 3], 'blank rows and rows with no Client Name are skipped');
  eq(results.map(r => r.status), ['skipped', 'skipped', 'skipped'], 'each says so');
  eq(results.map(r => r.rowNumber), [2, 3, 4], 'row numbers count the header as row 1');
}

// --- blank cells never overwrite --------------------------------------------
{
  const { next } = planDealPaste([{ 'Client Name': 'Acme', 'Setup': '20000', 'GM': 'Dan' }],
    [{ 'Client Name': 'Acme', 'Setup': '', 'GM': '   ' }]);
  eq(next[0], { 'Client Name': 'Acme', 'Setup': '20000', 'GM': 'Dan' }, 'an empty pasted cell never clears a filled one');
}

// --- nothing at all ---------------------------------------------------------
{
  const { next, summary } = planDealPaste(undefined, undefined);
  eq([next, summary.added, summary.merged, summary.skipped], [[], 0, 0, 0], 'no data at all: nothing happens');
}

// --- the sentence the page reports ------------------------------------------
{
  const { summary } = planDealPaste([{ 'Client Name': 'Acme', 'Setup': '20000' }], [
    { 'Client Name': 'Acme', 'Setup': '20000', 'GM': 'Dan' },
    { 'Client Name': 'Beta', 'Setup': '5000' },
  ]);
  eq(describeDealPaste(summary),
    'Paste imported: 1 new deal added · 1 existing deal matched (1 blank cell filled) · 1 duplicate value ignored.',
    'the notice reads as a sentence');
}

// A single kept clash reads as one thing, not several.
{
  const { summary } = planDealPaste([{ 'Client Name': 'Acme', 'Setup': '20000' }], [{ 'Client Name': 'Acme', 'Setup': '99999' }]);
  eq(describeDealPaste(summary),
    'Paste imported: 0 new deals added · 1 existing deal matched (0 blank cells filled) · 1 differing value left as it was.',
    'a single kept clash is reported in the singular');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
