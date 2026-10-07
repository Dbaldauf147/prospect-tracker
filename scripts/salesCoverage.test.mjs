// Assertion tests for Opps > Coverage's saved list: which copy shows, and
// how an edit is tidied before it is saved.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/salesCoverage.test.mjs
import { SALES_COVERAGE } from '../src/data/salesCoverage.js';
import { cleanCoverage, coverageFromSettings, splitSalespeople, salespeopleForVertical } from '../src/utils/salesCoverage.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; } else { failed += 1; console.error(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ── which list shows ─────────────────────────────────────────────────────
eq(coverageFromSettings(undefined), SALES_COVERAGE, 'no settings yet shows the default');
eq(coverageFromSettings({}), SALES_COVERAGE, 'nothing saved shows the default');
const saved = [{ team: 'A', rows: [{ vertical: 'Grocery', salespeople: ['Bo'] }] }];
eq(coverageFromSettings({ salesCoverage: saved }), saved, 'a saved list wins');
eq(coverageFromSettings({ salesCoverage: [] }), [], 'a list cleared on purpose stays cleared');

// ── splitting names ──────────────────────────────────────────────────────
eq(splitSalespeople(' Sara Rahme ,Candace Becker, '), ['Sara Rahme', 'Candace Becker'], 'comma list splits and trims');
eq(splitSalespeople(''), [], 'blank is nobody');

// ── who covers a vertical ────────────────────────────────────────────────
const cov = [
  { team: 'Mark', rows: [{ vertical: 'Grocery', salespeople: ['Jackie Cobb'] }] },
  { team: 'Robbie', rows: [{ vertical: 'Grocery', salespeople: ['Sara Rahme', 'Jackie Cobb'] }, { vertical: 'Hotels', salespeople: ['Doug'] }] },
];
eq(salespeopleForVertical(cov, '  grocery '), [
  { name: 'Jackie Cobb', teams: ['Mark', 'Robbie'] },
  { name: 'Sara Rahme', teams: ['Robbie'] },
], 'a vertical under two teams names each person once, with both teams');
eq(salespeopleForVertical(cov, 'Hotels').map(p => p.name), ['Doug'], 'one owner');
eq(salespeopleForVertical(cov, 'Mining'), [], 'an uncovered vertical is nobody');
eq(salespeopleForVertical(cov, ''), [], 'no vertical is nobody');
eq(salespeopleForVertical(SALES_COVERAGE, 'Real Estate').map(p => p.name), ['Dan Baldauf'], 'reads the shipped list');

// ── tidying an edit ──────────────────────────────────────────────────────
eq(cleanCoverage([
  { team: ' Keith McHugh ', rows: [
    { vertical: ' Real Estate ', salespeople: ' Dan Baldauf, ' },
    { vertical: '', salespeople: '' },
    { vertical: 'Hotels', salespeople: [] },
  ] },
  { team: '', rows: [] },
  { team: 'New Team', rows: [] },
]), [
  { team: 'Keith McHugh', rows: [
    { vertical: 'Real Estate', salespeople: ['Dan Baldauf'] },
    { vertical: 'Hotels', salespeople: [] },
  ] },
  { team: 'New Team', rows: [] },
], 'trims, drops blank rows and blank teams, keeps a vertical with nobody on it yet');
eq(cleanCoverage(SALES_COVERAGE), SALES_COVERAGE, 'the default list survives a save unchanged');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
