// Issues tab "Key Contact company has no targets": a Table company with a
// Dan Key Target contact and nothing on its Targets tab.
// Run: node scripts/keyContactNoTargets.test.mjs
import { keyContactNoTargetsIssues, KEY_CONTACT_NO_TARGETS_ISSUE } from '../src/utils/keyContactNoTargets.js';
import { blankTarget, noTargetRow } from '../src/utils/companyTargets.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const prospects = [
  { id: 'a', company: 'Acme Inc.' },
  { id: 'b', company: 'Beta', climateTargets: [{ ...blankTarget(), type: 'SBTi' }] },
  { id: 'c', company: 'Cyan', climateTargets: [noTargetRow()] },
  { id: 'd', company: 'Delta Partners', goesBy: 'Delta' },
  { id: 'e', company: 'Echo', climateTargets: [blankTarget()] },
];
const key = (id, first, company, extra = {}) => ({ id, firstname: first, lastname: 'X', company, dans_tags: 'Dan Key Target', ...extra });
const contacts = [
  key('1', 'Ann', 'acme'),                  // normalized match, no targets
  key('2', 'Bob', 'Acme Inc.'),             // same company, second name
  key('3', 'Cal', 'Beta'),                  // has targets
  key('4', 'Dee', 'Cyan'),                  // "No Target Set" answers it
  key('5', 'Eve', 'Delta'),                 // Goes By match
  key('6', 'Fay', 'Nowhere Co'),            // not on the Table
  key('7', 'Gus', 'Echo', { dans_tags: 'Dan Key Target; Left' }), // left
  { id: '8', firstname: 'Hal', company: 'Echo', dans_tags: 'Decision Maker' }, // not key
  key('9', 'Ivy', 'Wrong Name'),            // typed-in company override
];
const rows = keyContactNoTargetsIssues(contacts, { prospects, localFields: { 9: { _companyOverride: 'Echo' } } });
check('companies flagged', rows.map(r => r.company), ['Acme Inc.', 'Delta Partners', 'Echo']);
check('row shape', [rows[0].id, rows[0].type, rows[0].prospectId, rows[0].resolve], ['key-contact-no-targets:a', KEY_CONTACT_NO_TARGETS_ISSUE, 'a', { kind: 'noTargets' }]);
check('names every key contact once', /Key Contacts Ann X, Bob X are here/.test(rows[0].detail), true);
check('single contact wording', /Key Contact Eve X is here/.test(rows[1].detail), true);
check('no em dash', rows.some(r => /—/.test(r.detail + r.type)), false);
check('no contacts, no rows', keyContactNoTargetsIssues(null, { prospects }), []);

console.log(`keyContactNoTargets: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
