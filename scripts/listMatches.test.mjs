// Assertion tests for the list-row matcher shared by "Search lists..." and
// the company modal's SBT / CA SB warnings. Run: node scripts/listMatches.test.mjs
import { buildItems, namesFromRows } from '../src/utils/listMatches.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const names = namesFromRows([
  { 'Company Name': 'Acme Corp', Target: '1.5C' },
  { 'Company Name': 'Acme Holdings International', Target: 'WB2C' },
  { 'Company Name': 'Zeta Ltd', Target: '1.5C' },
  { 'Company Name': 'Beta Industries', Target: '1.5C' },
  { 'Company Name': 'Acme Corp', Target: 'dup' },
]);
check('names off the name column', names, ['Acme Corp', 'Acme Holdings International', 'Zeta Ltd', 'Beta Industries', 'Acme Corp']);

const sum = (items) => items.map(i => [i.rawName, i.state, Math.round(i.score * 100)]);
const listMappings = (mapping = {}, dismissed = {}) => ({ listMappings: { 'sbt-list-override': { mapping, dismissed } } });

check('exact match first, deduped, then a name it sits inside', sum(buildItems('sbt-list-override', names, 'Acme', listMappings())),
  [['Acme Corp', 'suggested', 100], ['Acme Holdings International', 'suggested', 75]]);
check('nothing for an unrelated company', buildItems('sbt-list-override', names, 'Omega', listMappings()), []);

const zetaKey = 'name::zeta';
check('mapped row shows as mapped even without a name match',
  sum(buildItems('sbt-list-override', names, 'Zed Group', listMappings({ [zetaKey]: 'Zed Group' }))), [['Zeta Ltd', 'mapped', 100]]);
check('row mapped to another company is left alone',
  buildItems('sbt-list-override', names, 'Zeta', listMappings({ [zetaKey]: 'Someone Else' })), []);
check('dismissed row is left alone',
  buildItems('sbt-list-override', names, 'Zeta', listMappings({}, { [zetaKey]: true })), []);

// Close but not exact: suggested, and never scored as exact.
const close = ['Marriott International Inc', 'Kohls Corp', 'Wal-Mart Stores', 'Brookfeild Asset Mgmt', 'Acne Industries', 'Hilton Grand Vacations'];
const top = (company) => sum(buildItems('casb-list-override', close, company, {})).slice(0, 1);
check('one typo in a word', top('Marriot International'), [['Marriott International Inc', 'suggested', 95]]);
check('apostrophe splitting a word', top("Kohl's"), [['Kohls Corp', 'suggested', 95]]);
check('hyphen splitting a word', top('Walmart'), [['Wal-Mart Stores', 'suggested', 54]]);
check('typo in a long word', top('Brookfield Asset Management'), [['Brookfeild Asset Mgmt', 'suggested', 50]]);
check('short words must match exactly', top('Acme'), []);
check('a shared first word alone is not enough', top('Hilton Worldwide'), []);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
