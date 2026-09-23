// Assertion tests for the "PE overlap deals" list on the Keith agenda.
//   node scripts/keithPeDeals.test.mjs
import { buildPeOverlapDeals, isPeOpp, oppStageNumber } from '../src/utils/keithPeDeals.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('Private Equity type is PE', isPeOpp({ Type: 'Private Equity' }), true);
check('Portfolio Company type is PE', isPeOpp({ Type: ' portfolio company ' }), true);
check('a PE Owner makes it a portfolio company deal', isPeOpp({ Type: 'Owner Operator', 'PE Owner': 'Blackstone' }), true);
check('anything else is not', isPeOpp({ Type: 'Owner Operator', 'PE Owner': '' }), false);

check('Lead is Stage 3', oppStageNumber({ Stage: 'Lead' }), 3);
check('Quoting is Stage 4', oppStageNumber({ Stage: 'Quoting' }), 4);
check('Contracting is Stage 5', oppStageNumber({ Stage: 'Contracting' }), 5);
check('Agreement Sent is Stage 6', oppStageNumber({ Stage: 'Agreement Sent' }), 6);
check('Not Started is before Stage 3', oppStageNumber({ Stage: 'Not Started' }), null);
check('Sold is closed', oppStageNumber({ Stage: 'Sold' }), null);

const records = [
  { _id: 1, Account: 'Alpha', Type: 'Private Equity', Stage: 'Lead', 'Quoted Amount': 10 },
  { _id: 2, Account: 'Beta', Type: 'Portfolio Company', Stage: 'Quoted', 'Quoted Amount': 5 },
  { _id: 3, Account: 'Gamma', Type: 'Portfolio Company', Stage: 'Quoted', 'Quoted Amount': 50 },
  { _id: 4, Account: 'Delta', Type: 'Private Equity', Stage: 'Not Started' },
  { _id: 5, Account: 'Eps', Type: 'Private Equity', Stage: 'Sold' },
  { _id: 6, Account: 'Zeta', Type: 'Owner Operator', Stage: 'Agreement Sent' },
  { _id: 7, Account: 'Eta', Type: '', 'PE Owner': 'KKR', Stage: 'Agreement Sent' },
];
const deals = buildPeOverlapDeals(records, { parseAmount: v => (v == null ? null : Number(v)), fmtAmount: n => `$${n}` });
check('only PE at Stage 3+, furthest first, then biggest', deals.map(d => d.name), ['Eta', 'Gamma', 'Beta', 'Alpha']);
check('stage label', deals[1].stageLabel, 'Stage 5 · Quoted');
check('amount label', [deals[0].amountLabel, deals[1].amountLabel], ['', '$50']);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
