// Assertion tests for a campaign's target companies (placeholders for
// "someone from this company should be added").
// Run: node scripts/campaignTargetCompanies.test.mjs
import {
  addTargetCompany, removeTargetCompany, targetCompanyStatus, campaignHasTargetCompany, campaignTargetCompanies,
} from '../src/utils/campaignTargetCompanies.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const NOW = '2026-10-14T12:00:00.000Z';
const camp = {
  subject: 'Q4 event',
  contacts: [
    { email: 'ann@acme.com', name: 'Ann', company: 'Acme Corp' },
    { email: 'bob@other.com', name: 'Bob', company: '' },
  ],
};

// Adding a company leaves the roster alone.
{
  const { status, campaign } = addTargetCompany(camp, '  Globex ', NOW);
  check('added', status, 'added');
  check('roster untouched', campaign.contacts, camp.contacts);
  check('stored trimmed', campaign.targetCompanies, [{ company: 'Globex', addedAt: NOW }]);
  check('original not mutated', camp.targetCompanies, undefined);
}

// Not twice, under a looser spelling either.
{
  const once = addTargetCompany(camp, 'Globex Inc', NOW).campaign;
  check('already exact', addTargetCompany(once, 'globex inc', NOW).status, 'already');
  check('already fuzzy', addTargetCompany(once, 'Globex', NOW).status, 'already');
  check('has', campaignHasTargetCompany(once, 'GLOBEX'), true);
}

check('blank', addTargetCompany(camp, '   ', NOW).status, 'blank');

// Open until somebody at the company is on the roster.
{
  let c = addTargetCompany(camp, 'Acme', NOW).campaign;
  c = addTargetCompany(c, 'Globex', NOW).campaign;
  const st = targetCompanyStatus(c);
  check('acme filled by Acme Corp row', st.map(t => [t.company, t.open, t.contacts.map(x => x.email)]), [
    ['Acme', false, ['ann@acme.com']],
    ['Globex', true, []],
  ]);
  // A companyOf from the page can name a row's employer the row doesn't store.
  const st2 = targetCompanyStatus(c, (row) => row.company || (row.email.endsWith('@other.com') ? 'Globex' : ''));
  check('companyOf fills globex', st2.map(t => t.open), [false, false]);
  // Taking the contact off opens it again.
  const without = { ...c, contacts: c.contacts.filter(x => x.email !== 'ann@acme.com') };
  check('reopens', targetCompanyStatus(without).map(t => t.open), [true, true]);
}

// Remove.
{
  let c = addTargetCompany(camp, 'Acme', NOW).campaign;
  c = addTargetCompany(c, 'Globex', NOW).campaign;
  check('remove', campaignTargetCompanies(removeTargetCompany(c, 'acme')).map(t => t.company), ['Globex']);
  check('remove missing is a no-op', campaignTargetCompanies(removeTargetCompany(c, 'Nope')).length, 2);
}

check('no targets', targetCompanyStatus(camp), []);
check('junk entries dropped', campaignTargetCompanies({ targetCompanies: [{ company: '' }, null, { company: 'X' }] }).map(t => t.company), ['X']);

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
