// Assertion tests for the Issues tab's "New opp missing Vertical / Vertical
// CDM" check. Run:
//   node scripts/newOppMissingVertical.test.mjs
//
// Pinned: only opps that qualify for Opps > New Opps are checked, an opp
// with a vertical and a CDM is fine, a vertical from the company card
// counts, a vertical nobody covers is a "missing Vertical CDM" row, no
// vertical anywhere is a "missing Vertical" row.
import { newOppsMissingVertical } from '../src/utils/newOppsFilter.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const today = new Date().toISOString().slice(0, 10);
const opp = (id, extra) => ({ _id: id, Stage: 'Lead', 'BFO Link': 'Opp-' + id, 'Start Date': today, _stageEnteredAt: today, ...extra });
const coverageSettings = { salesCoverage: [{ team: 'A', rows: [{ vertical: 'Healthcare', salespeople: ['Jen Debias'] }] }] };
const prospects = [{ id: 'p1', company: 'Acme Hospitals', vertical: 'Healthcare' }, { id: 'p2', company: 'Blank Co', vertical: '' }];
const records = [
  opp(1, { Account: 'Fine Co', Vertical: 'Healthcare' }),
  opp(2, { Account: 'Acme Hospitals' }),
  opp(3, { Account: 'Space Co', Vertical: 'Space' }),
  opp(4, { Account: 'Blank Co' }),
  opp(5, { Account: 'Old Blank', Stage: 'Sold' }),
  opp(6, { Account: 'No BFO', 'BFO Link': '-' }),
];
const run = (p) => newOppsMissingVertical(records, { settings: coverageSettings, prospects: p });

const rows = run(prospects);
check('only the two gaps', rows.map(r => [r.record.Account, r.vertical]), [
  ['Space Co', 'Space'],
  ['Blank Co', ''],
]);
check('company card vertical counts', rows.some(r => r.record.Account === 'Acme Hospitals'), false);
check('without the card, Acme is flagged', run([]).map(r => r.record.Account), ['Acme Hospitals', 'Space Co', 'Blank Co']);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
