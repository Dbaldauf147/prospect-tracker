// Assertion tests for what a full CSV import does to the roster. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/prospectMerge.test.mjs
//
// The import used to delete every document and write the uploaded rows
// back as new ones. Every record got a NEW document id, and
// settings.targetMap / divisionsMap / hqRegionMap are all keyed by
// document id — so one upload orphaned every Target Account mapping,
// division and HQ region on the roster at once, silently, and nothing
// could repair it afterwards: orphaned mappings are not duplicates, so
// the duplicate collapse had nothing to merge.
//
// Keeping a matched company's id is therefore the whole point, and these
// pin it.
import { planProspectReconcile, prospectScore } from '../src/utils/prospectMerge.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── Keeping ids ────────────────────────────────────────────────────────
{
  const existing = [{ id: 'doc1', company: 'Prologis', tier: 'Tier 1' }];
  const plan = planProspectReconcile([{ company: 'Prologis', status: 'Client' }], existing);
  eq(plan.updates, [{ id: 'doc1', record: { company: 'Prologis', status: 'Client' } }],
    'a company in both keeps its document — and so does everything keyed to it');
  eq(plan.creates, [], 'it is not also created');
  eq(plan.deletes, [], 'and not deleted');
}

{
  // The reason this matters more than exact-name matching: the file and
  // the roster rarely agree on spelling.
  const existing = [{ id: 'doc1', company: 'HIG Capital, LLC' }];
  const plan = planProspectReconcile([{ company: 'H.I.G. Capital' }], existing);
  eq(plan.counts.updated, 1, 'a spelling variant matches the record it belongs to');
  eq(plan.updates[0].id, 'doc1', 'and keeps that record');
  eq(plan.counts.created, 0, 'rather than arriving as a second account');
}

// ── Adding and removing ────────────────────────────────────────────────
{
  const existing = [{ id: 'doc1', company: 'Prologis' }, { id: 'doc2', company: 'Ventas' }];
  const plan = planProspectReconcile([{ company: 'Prologis' }, { company: 'Blackstone' }], existing);
  eq(plan.counts, { updated: 1, created: 1, deleted: 1, collapsed: 0, mappingsMoved: 0, skipped: 0 },
    'in both updates, only in the file is added, only on the roster is removed');
  eq(plan.deletes, ['doc2'], 'the removed one is the company the file does not have');
}

// ── The file against itself ────────────────────────────────────────────
{
  const plan = planProspectReconcile(
    [{ company: 'HIG Capital' }, { company: 'H.I.G. Capital' }, { company: 'Ventas' }], []);
  eq(plan.counts.created, 2, 'two spellings of one company in one file are one account');
  eq(plan.counts.collapsed, 1, 'and the collapse is counted so it can be reported');
  eq(plan.creates[0].company, 'HIG Capital', 'the first occurrence wins the slot');
}

// ── Duplicates already on the roster ───────────────────────────────────
{
  // Two records for one company, one richer. The richer survives — same
  // rule the duplicate collapse uses — and the other's id-keyed settings
  // are handed back so they move rather than orphan.
  const existing = [
    { id: 'thin', company: 'Prologis' },
    { id: 'rich', company: 'Prologis Inc.', tier: 'Tier 1', notes: 'n', status: 'Client' },
  ];
  const plan = planProspectReconcile([{ company: 'Prologis' }], existing);
  eq(plan.updates[0].id, 'rich', 'the richest existing record is the one kept');
  eq(plan.deletes, ['thin'], 'the thinner copy goes');
  eq(plan.remaps, [{ from: 'thin', to: 'rich' }], 'and its mappings are moved, not orphaned');
  eq(plan.counts.mappingsMoved, 1, 'reported so the user is told');
}

{
  // Equal richness falls back to oldest, so an import is not a coin toss.
  const existing = [
    { id: 'newer', company: 'Ventas', createdAt: '2026-05-01T00:00:00Z' },
    { id: 'older', company: 'Ventas', createdAt: '2024-01-01T00:00:00Z' },
  ];
  const plan = planProspectReconcile([{ company: 'Ventas' }], existing);
  eq(plan.updates[0].id, 'older', 'a tie on richness keeps the older record');
}

// ── Rows that cannot be matched ────────────────────────────────────────
{
  const plan = planProspectReconcile([{ company: '' }, { company: 'Ventas' }, {}], []);
  eq(plan.counts.created, 1, 'rows with no company name are not imported');
  eq(plan.counts.skipped, 2, 'and are counted as skipped');
}

{
  const existing = [{ id: 'blank', company: '' }, { id: 'doc1', company: 'Ventas' }];
  const plan = planProspectReconcile([{ company: 'Ventas' }], existing);
  eq(plan.deletes, ['blank'], 'an existing record with no company cannot be matched and is removed');
  eq(plan.updates[0].id, 'doc1', 'the named one is still matched');
}

// ── Degenerate input ───────────────────────────────────────────────────
{
  eq(planProspectReconcile([], []).counts, { updated: 0, created: 0, deleted: 0, collapsed: 0, mappingsMoved: 0, skipped: 0 },
    'nothing in, nothing out');
  eq(planProspectReconcile(null, null).counts.created, 0, 'and nulls do not throw');
  const wipe = planProspectReconcile([], [{ id: 'a', company: 'Ventas' }]);
  eq(wipe.counts.deleted, 1, 'an empty file empties the roster — which is why it is confirmed first');
}

// ── The ranking itself ─────────────────────────────────────────────────
{
  eq(prospectScore({ tier: 'Tier 1' }) > prospectScore({ status: 'Client' }), true, 'tier outweighs status');
  eq(prospectScore({ tier: '-' }), 0, 'a dash is not a tier');
  eq(prospectScore({}), 0, 'an empty record scores nothing');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
