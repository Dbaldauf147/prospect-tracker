// Assertion tests for where a record's tier came from and who outranks
// whom. Plain Node — no test framework (the project has none). Run:
//   node scripts/tierSource.test.mjs
//
// My Accounts prefers a record's own tier over the Target Accounts list
// so an explicitly-chosen tier sticks — setting an account to Tier 3
// must not be silently re-upgraded by a lookup. That is right, but
// nothing distinguished a tier the user picked from a tier that arrived
// in a spreadsheet column: an import wrote the sheet's Tier onto the
// record, the record then outranked the Targets list, and the
// disagreement surfaced as a mismatch warning on a company nobody had
// ever tiered by hand.
import {
  IMPORTED_TIER, markImportedTier, tierPreferringTargetsList, clearImportedTierOnEdit,
} from '../src/utils/tierSource.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── Who wins ───────────────────────────────────────────────────────────
{
  // The case that produced the bogus warnings.
  eq(tierPreferringTargetsList({ tier: 'Tier 2', targetTier: 'Tier 3', tierSource: IMPORTED_TIER }), 'Tier 3',
    'an imported tier defers to the Targets list');

  // The behaviour that must NOT regress: a tier someone chose still wins,
  // and the mismatch warning is how the difference gets surfaced.
  eq(tierPreferringTargetsList({ tier: 'Tier 3', targetTier: 'Tier 2', tierSource: '' }), 'Tier 3',
    'a tier the user set still outranks the Targets list');
  eq(tierPreferringTargetsList({ tier: 'Tier 3', targetTier: 'Tier 2', tierSource: undefined }), 'Tier 3',
    'and so does one on a record that predates the marker');
}

{
  eq(tierPreferringTargetsList({ tier: 'Tier 1', targetTier: '', tierSource: IMPORTED_TIER }), 'Tier 1',
    'with no Targets tier there is nothing to defer to');
  eq(tierPreferringTargetsList({ tier: 'Tier 2', targetTier: 'Tier 2', tierSource: IMPORTED_TIER }), 'Tier 2',
    'and agreeing sources change nothing');
  eq(tierPreferringTargetsList({ tier: '', targetTier: 'Tier 1', tierSource: IMPORTED_TIER }), 'Tier 1',
    'an untiered imported record takes the Targets tier');
}

// ── Marking an import ──────────────────────────────────────────────────
{
  eq(markImportedTier({ company: 'Ventas', tier: 'Tier 2' }), { company: 'Ventas', tier: 'Tier 2', tierSource: IMPORTED_TIER },
    'a row carrying a tier is marked');
  eq(markImportedTier({ company: 'Ventas' }), { company: 'Ventas' },
    'a row with no tier has nothing to mark — and gains no stray field');
  eq(markImportedTier({ company: 'Ventas', tier: '' }), { company: 'Ventas', tier: '' },
    'nor does a blank one');
  eq(markImportedTier(null), null, 'and nothing at all does not throw');
}

// ── Editing clears it ──────────────────────────────────────────────────
{
  eq(clearImportedTierOnEdit({ tier: 'Tier 1' }), { tier: 'Tier 1', tierSource: '' },
    'setting a tier in the app makes it the user’s');
  eq(clearImportedTierOnEdit({ status: 'Client' }), { status: 'Client' },
    'an edit that does not touch the tier leaves the marker alone');
  eq(clearImportedTierOnEdit({ tier: 'Tier 1', tierSource: IMPORTED_TIER }), { tier: 'Tier 1', tierSource: IMPORTED_TIER },
    'a caller that IS an import keeps its own marker');
  eq(clearImportedTierOnEdit(null), null, 'and a missing patch does not throw');
}

// ── End to end ─────────────────────────────────────────────────────────
{
  // Pull a company from the sheet, then tier it by hand, and the hand
  // choice is what sticks.
  const imported = markImportedTier({ company: 'Ventas', tier: 'Tier 2' });
  eq(tierPreferringTargetsList({ tier: imported.tier, targetTier: 'Tier 3', tierSource: imported.tierSource }), 'Tier 3',
    'freshly imported: the Targets list wins');
  const edited = { ...imported, ...clearImportedTierOnEdit({ tier: 'Tier 1' }) };
  eq(tierPreferringTargetsList({ tier: edited.tier, targetTier: 'Tier 3', tierSource: edited.tierSource }), 'Tier 1',
    'after the user sets it: their choice wins, and the mismatch warning does the telling');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
