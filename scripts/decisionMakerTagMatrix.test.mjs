// Assertion tests for the My Accounts "DM Tags" subtab
// (src/utils/decisionMakerTagMatrix.js). Plain Node, no framework. Run:
//   node scripts/decisionMakerTagMatrix.test.mjs
//
// The claims:
//   1. A cell lists a contact only when they carry Decision Maker AND the
//      column's tag, whatever spelling the tag is in.
//   2. The columns are the contact tags, never the gate tags themselves.
//   3. Each column's tier percentage is the share of that tier's accounts
//      with at least one such contact, and never rounds up to 100.
import {
  tagMatrixColumns,
  tagColumnKey,
  decisionMakersTagged,
  tagMatrixRows,
  tagMatrixCoverage,
} from '../src/utils/decisionMakerTagMatrix.js';
import { makeDecisionMakerLookup } from '../src/utils/decisionMakerCoverage.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const contact = (id, company, tags) => ({ id, company, firstname: id, dans_tags: tags });

// --- columns ------------------------------------------------------------
{
  const cols = tagMatrixColumns([contact('a', 'Acme', 'Decision Maker;Board Liaison')], ['ESG', 'Decision Maker', 'Hide', 'Left', 'Test']);
  check('vocabulary plus tags only contacts carry, gate tags left out', cols, ['Board Liaison', 'ESG']);
  check('one column per tag whatever the spelling',
    tagMatrixColumns([contact('a', 'Acme', 'esg')], ['ESG']), ['ESG']);
  check('column key ignores case and spacing',
    tagColumnKey('Efficiency / Renewables'), tagColumnKey('efficiency/renewables'));
}

// --- cells --------------------------------------------------------------
{
  const dms = [
    contact('a', 'Acme', 'Decision Maker;ESG'),
    contact('b', 'Acme', 'Decision Maker;Efficiency/Renewables'),
    contact('c', 'Acme', 'Decision Maker;ESG Lead'),
  ];
  check('the column tag is required', decisionMakersTagged(dms, 'ESG').map(c => c.id), ['a']);
  check('spelling of the tag does not matter',
    decisionMakersTagged(dms, 'Efficiency / Renewables').map(c => c.id), ['b']);
  check('nobody tagged lists no one', decisionMakersTagged(dms, 'Procurement'), []);
}

// --- rows and tier coverage ---------------------------------------------
{
  const contacts = [
    contact('a', 'Acme', 'Decision Maker;ESG'),
    contact('b', 'Acme', 'ESG'),                         // ESG, not a DM
    contact('c', 'Beta', 'ESG'),                         // ESG, not a DM
    contact('d', 'Gamma', 'Decision Maker;ESG;Hide'),    // hidden
    contact('e', 'Delta', 'Decision Maker;Procurement'),
  ];
  const accounts = [
    { id: '1', company: 'Acme', myTier: 'Tier 1' },
    { id: '2', company: 'Beta', myTier: 'Tier 1' },
    { id: '3', company: 'Gamma', myTier: 'Tier 1' },
    { id: '4', company: 'Delta', myTier: 'Tier 2' },
  ];
  const tags = ['ESG', 'Procurement'];
  const rows = tagMatrixRows(accounts, makeDecisionMakerLookup(contacts), tags);
  const esg = tagColumnKey('ESG');
  check('a tagged non-DM is not listed', rows.map(r => r.byTag[esg].map(c => c.id)), [['a'], [], [], []]);
  const cov = tagMatrixCoverage(rows, tags);
  check('Tier 1 ESG: one of three mapped', cov[esg]['Tier 1'], { total: 3, mapped: 1, pct: 33 });
  check('a tier with no accounts has no percentage', cov[esg]['Tier 3'], { total: 0, mapped: 0, pct: null });
  check('Tier 2 Procurement fully mapped', cov[tagColumnKey('Procurement')]['Tier 2'].pct, 100);
  const nearly = Array.from({ length: 300 }, (_, i) => ({ myTier: 'Tier 1', byTag: { [esg]: i ? [{}] : [] } }));
  check('299 of 300 never reads 100%', tagMatrixCoverage(nearly, ['ESG'])[esg]['Tier 1'].pct, 99);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
