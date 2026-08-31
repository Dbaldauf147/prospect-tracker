// Assertion tests for merging an Excel / Sheets paste into the Commissions
// roster. Plain Node — no test framework (the project has none). Run:
//   node scripts/commissionsPasteMerge.test.mjs
//
// This merge assembles a fiscal year out of successive snapshot pastes, so
// the failures worth guarding are the ones that lose figures: a second-half
// paste wiping the first half's months, the hand-added Account Name / BFO
// Name / Scope (which no paste carries) being dropped, or a project the paste
// never mentions being touched at all.
import {
  planCommissionsPaste, describeCommissionsPaste, normProjectName, PERIOD_KEYS,
} from '../src/utils/commissionsPasteMerge.js';

let pass = 0, fail = 0;
const ok = (c, n) => (c ? (pass += 1, console.log('PASS ', n)) : (fail += 1, console.log('FAIL ', n)));
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)})`);

// --- the dedup key ----------------------------------------------------------
eq(normProjectName('  Acme   — Phase 1 '), 'acme — phase 1', 'the key trims, collapses whitespace and case-folds');
ok(PERIOD_KEYS.has('July Revenue') && PERIOD_KEYS.has('July') && PERIOD_KEYS.has('FY Revenue'), 'months, monthly revenue and the FY total are period cells');
ok(!PERIOD_KEYS.has('Account Name') && !PERIOD_KEYS.has('%'), 'identity and lookup columns are not period cells');

// --- fiscal-year assembly (the reason this merges cell by cell) -------------
{
  const onFile = [{
    'Project Name': 'Griffis', 'Account Name': 'Griffis Residential', 'BFO Name': 'GR-1',
    'July Revenue': '1000', 'August Revenue': '1000',
  }];
  const secondHalf = [{ 'Project Name': 'Griffis', 'January Revenue': '900', 'February Revenue': '900' }];
  const { next, summary } = planCommissionsPaste(onFile, secondHalf);
  eq(next.length, 1, 'the second-half paste lands on the same row');
  eq(next[0], {
    'Project Name': 'Griffis', 'Account Name': 'Griffis Residential', 'BFO Name': 'GR-1',
    'July Revenue': '1000', 'August Revenue': '1000', 'January Revenue': '900', 'February Revenue': '900',
  }, 'both halves of the fiscal year survive, and so do the hand-added lookups');
  eq([summary.added, summary.merged, summary.filledCells], [0, 1, 2], 'two blank months filled');
}

// --- new values fill in, duplicate values are ignored -----------------------
{
  const onFile = [{ 'Project Name': 'Acme', 'July Revenue': '1000', '%': '10' }];
  const { next, results, summary } = planCommissionsPaste(onFile,
    [{ 'Project Name': 'Acme', 'July Revenue': '1000', 'August Revenue': '500', 'Comm Start Date': '7/1/2025' }]);
  eq(next[0], { 'Project Name': 'Acme', 'July Revenue': '1000', '%': '10', 'August Revenue': '500', 'Comm Start Date': '7/1/2025' },
    'blank cells fill in, the repeated July figure changes nothing');
  eq([summary.filledCells, summary.duplicateCells, summary.conflictCells], [2, 1, 0], 'the repeat is counted as an ignored duplicate');
  eq(results[0].status, 'merged', 'the row reports as merged');
}

// A value that only differs in spacing or case is a duplicate, not a clash.
{
  const { summary } = planCommissionsPaste([{ 'Project Name': 'Acme', 'Account Name': 'Acme  Corp' }],
    [{ 'Project Name': 'acme', 'Account Name': 'ACME CORP' }]);
  eq([summary.duplicateCells, summary.conflictCells], [1, 0], 'spacing/case differences are duplicates');
  eq(summary.duplicateCells, 1, 'the Project Name that did the matching is not counted as a duplicate');
}

// --- a cell that says something DIFFERENT -----------------------------------
{
  const onFile = [{ 'Project Name': 'Acme', 'July Revenue': '1000' }];
  const paste = [{ 'Project Name': 'Acme', 'July Revenue': '2000' }];

  const fill = planCommissionsPaste(onFile, paste);
  eq(fill.next[0]['July Revenue'], '1000', 'by default the figure already on file wins');
  eq([fill.summary.conflictCells, fill.summary.keptCells, fill.summary.overwrittenCells], [1, 1, 0], 'the clash is counted, not applied');
  eq(fill.results[0].conflicts, [{ field: 'July Revenue', existing: '1000', pasted: '2000' }], 'and reported cell by cell');

  const update = planCommissionsPaste(onFile, paste, { dupeMode: 'update' });
  eq(update.next[0]['July Revenue'], '2000', 'update mode lets a corrected figure land');
  eq([update.summary.overwrittenCells, update.summary.keptCells], [1, 0], 'and says so');

  eq(onFile[0]['July Revenue'], '1000', 'no plan mutates the roster it was handed');
}

// --- replace months ---------------------------------------------------------
{
  const onFile = [{
    'Project Name': 'Acme', 'Account Name': 'Acme Corp', '%': '10',
    'July Revenue': '1000', 'August Revenue': '1000', 'FY Revenue': '2000',
  }];
  const { next, summary } = planCommissionsPaste(onFile,
    [{ 'Project Name': 'Acme', 'July Revenue': '1500' }], { dupeMode: 'replace' });
  eq(next[0], { 'Project Name': 'Acme', 'Account Name': 'Acme Corp', '%': '10', 'July Revenue': '1500' },
    'the old months go, only this paste’s months remain, and the lookups stay');
  eq(summary.clearedCells, 3, 'the cleared month cells are counted');
}

// --- projects the paste never mentions --------------------------------------
{
  const onFile = [
    { 'Project Name': 'Acme', 'July Revenue': '1000' },
    { 'Project Name': 'Untouched', 'July Revenue': '7', 'Account Name': 'Someone' },
  ];
  const { next } = planCommissionsPaste(onFile, [{ 'Project Name': 'Acme', 'August Revenue': '1' }]);
  eq(next.length, 2, 'the roster keeps its other projects');
  eq(next[1], onFile[1], 'a project the paste never mentions is untouched');
}

// --- the same project twice within one paste --------------------------------
// Two distinct deals can share a name, so a genuine repeat is kept as its own
// flagged row rather than unioned away.
{
  const { next, results, summary } = planCommissionsPaste([], [
    { 'Project Name': 'Acme', 'July Revenue': '1' },
    { 'Project Name': 'Acme', 'July Revenue': '2' },
  ]);
  eq([next.length, summary.added, summary.pasteDuplicates], [2, 1, 1], 'the repeat is imported as a second row');
  eq(results[1].status, 'pasteDuplicate', 'and is flagged as a within-paste duplicate');
  eq(next[1]['July Revenue'], '2', 'keeping its own figures');
}

// --- rows there is nothing to do with ---------------------------------------
{
  const { next, results, summary } = planCommissionsPaste([{ 'Project Name': 'Acme' }], [
    { 'Project Name': '', 'July Revenue': '' },
    { 'July Revenue': '5' },
  ]);
  eq([next.length, summary.skipped], [1, 2], 'blank rows and rows with no Project Name are skipped');
  eq(results.map(r => r.reason), ['Blank row (no mapped cell had a value)', 'Missing Project Name'], 'each says why');
  eq(results.map(r => r.rowNumber), [2, 3], 'row numbers count the header as row 1');
}

// A row already on file with no Project Name has no key to group by, so it
// rides along untouched instead of colliding with anything.
{
  const { next } = planCommissionsPaste([{ 'July Revenue': '3' }], [{ 'Project Name': 'Acme' }]);
  eq(next.length, 2, 'an unkeyed row on file passes through');
  eq(next[0], { 'July Revenue': '3' }, 'unchanged');
}

// --- blank cells never overwrite --------------------------------------------
{
  const { next } = planCommissionsPaste([{ 'Project Name': 'Acme', 'July Revenue': '1000' }],
    [{ 'Project Name': 'Acme', 'July Revenue': '', 'August Revenue': '   ' }]);
  eq(next[0], { 'Project Name': 'Acme', 'July Revenue': '1000' }, 'an empty pasted cell never clears a filled one');
}

// --- which rows the paste touched (the caller stamps these) -----------------
{
  const { touched } = planCommissionsPaste([
    { 'Project Name': 'Acme', 'July Revenue': '1' },
    { 'Project Name': 'Quiet', 'July Revenue': '2' },
  ], [{ 'Project Name': 'Acme', 'August Revenue': '3' }, { 'Project Name': 'Fresh' }]);
  eq(touched, [0, 2], 'only the rows added or merged are reported as touched');
}

// --- nothing at all ---------------------------------------------------------
{
  const { next, summary } = planCommissionsPaste(undefined, undefined);
  eq([next, summary.added, summary.merged, summary.skipped], [[], 0, 0, 0], 'no data at all: nothing happens');
}

// --- the sentence the page reports ------------------------------------------
{
  const { summary } = planCommissionsPaste([{ 'Project Name': 'Acme', 'July Revenue': '1000' }], [
    { 'Project Name': 'Acme', 'July Revenue': '1000', 'August Revenue': '5' },
    { 'Project Name': 'Beta', 'July Revenue': '9' },
  ]);
  eq(describeCommissionsPaste(summary),
    'Paste imported: 1 new row added · 1 project already on file matched (1 blank cell filled) · 1 duplicate value ignored.',
    'the notice reads as a sentence');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
