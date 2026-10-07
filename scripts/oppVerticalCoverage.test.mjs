// Assertion tests for the New Opps Vertical and Salesperson columns. Run:
//   node scripts/oppVerticalCoverage.test.mjs
//
// Pinned: the opp's own Vertical wins, the company card fills a blank one,
// the salesperson comes from the Coverage tab (saved copy over the default),
// matching ignores case and punctuation, a vertical under two teams lists
// everyone, and the rows passed in are left untouched.
import {
  withVerticalCoverage, oppVerticalCoverage, coverageIndex, companyVerticalIndex,
  OPP_VERTICAL_KEY, OPP_SALESPERSON_KEY,
} from '../src/utils/oppVerticalCoverage.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const settings = { salesCoverage: [
  { team: 'A', rows: [{ vertical: 'Healthcare', salespeople: ['Jen Debias'] }, { vertical: 'Oil & Gas', salespeople: ['Jon Robinson'] }] },
  { team: 'B', rows: [{ vertical: 'healthcare', salespeople: ['Sara Rahme', 'Jen Debias'] }] },
] };
const prospects = [
  { company: 'Acme Hospitals, Inc.', vertical: 'Healthcare' },
  { company: 'Petro Co', vertical: 'Oil and Gas' },
  { company: 'Blank Co', vertical: '' },
];
const ctx = { coverage: coverageIndex(settings), companies: companyVerticalIndex(prospects) };

check('own vertical wins over the card', oppVerticalCoverage({ Account: 'Acme Hospitals', Vertical: 'Oil & Gas' }, ctx),
  { vertical: 'Oil & Gas', salesperson: 'Jon Robinson', fromCompany: false });
check('blank vertical filled from the company card, suffix ignored', oppVerticalCoverage({ Account: 'Acme Hospitals' }, ctx),
  { vertical: 'Healthcare', salesperson: 'Jen Debias, Sara Rahme', fromCompany: true });
check('"-" counts as blank', oppVerticalCoverage({ Account: 'Petro Co', Vertical: '-' }, ctx).vertical, 'Oil and Gas');
check('"and" matches "&" in Coverage', oppVerticalCoverage({ Account: 'Petro Co' }, ctx).salesperson, 'Jon Robinson');
check('no vertical anywhere', oppVerticalCoverage({ Account: 'Blank Co' }, ctx), { vertical: '', salesperson: '', fromCompany: false });
check('vertical nobody covers', oppVerticalCoverage({ Account: 'X', Vertical: 'Space' }, ctx), { vertical: 'Space', salesperson: '', fromCompany: false });
check('default coverage used when none saved', coverageIndex({}).get('healthcare')?.includes('Jen Debias'), true);

const rows = [{ Account: 'Acme Hospitals', Stage: 'Lead' }];
const out = withVerticalCoverage(rows, { settings, prospects });
check('enriched copy', [out[0][OPP_VERTICAL_KEY], out[0][OPP_SALESPERSON_KEY], out[0].Stage], ['Healthcare', 'Jen Debias, Sara Rahme', 'Lead']);
check('input row untouched', rows[0][OPP_VERTICAL_KEY], undefined);
check('no records', withVerticalCoverage(null), []);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
