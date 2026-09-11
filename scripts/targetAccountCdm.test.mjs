// Assertion tests for the company popup's "another CDM covers this account"
// warning. Plain Node — no test framework (the project has none). Run:
//   node scripts/targetAccountCdm.test.mjs
//
// This warning reads the Target Accounts workbook and contradicts what the
// user has typed in the popup, so the ways it can go wrong all cost trust:
//
//   * Fire on the SAME person spelled differently ("Baldauf, Dan" vs "Dan
//     Baldauf") and every account with a CDM shows a warning.
//   * Fire on a company that merely looks like the target row
//     ("Blackstone" vs "Blackstone GP Stakes") and the warning is noise.
//   * Stay silent when the targets list really does have the account under
//     another rep and the feature does nothing at all.
//   * Ignore the explicit My Accounts mapping and it points at the wrong
//     target row — including when the user deliberately cleared it.

import {
  parseTargetAccountCdms, rowTargetCdms, buildTargetCdmResolver,
  targetCdmConflictLabel, describeTargetCdmConflict,
} from '../src/utils/targetAccountCdm.js';

let failures = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
}
function eq(label, actual, expected) {
  check(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const HEADERS = ['Account Name', 'CDM', 'New Sales rep', 'Tier'];
function sheet(records) {
  return { sheets: { Targets: { headers: HEADERS, records } }, sheetNames: ['Targets'] };
}
const SETTINGS = { targetCdmColumn: 'CDM' };

// --- reading a row's rep values ------------------------------------------

eq('the mapped CDM column is what a row reports',
  rowTargetCdms({ 'Account Name': 'Apollo', CDM: 'Jane Smith', Owner: 'Someone Else' }, { cdmColumn: 'CDM' }),
  ['Jane Smith']);
eq('a mapped New Sales rep column is reported alongside it — either name covering the account is a clash',
  rowTargetCdms({ CDM: 'Jane Smith', 'New Sales rep': 'Ravi Patel' }, { cdmColumn: 'CDM', repColumn: 'New Sales rep' }),
  ['Jane Smith', 'Ravi Patel']);
eq('the same name in both columns is reported once',
  rowTargetCdms({ CDM: 'Jane Smith', 'New Sales rep': 'jane smith' }, { cdmColumn: 'CDM', repColumn: 'New Sales rep' }),
  ['Jane Smith']);
eq('a sheet without the mapped column falls back to the keyword scan, so unmapped workbooks still resolve a rep',
  rowTargetCdms({ 'Account Name': 'Apollo', Salesperson: 'Jane Smith' }, { cdmColumn: 'CDM' }),
  ['Jane Smith']);
eq('a blank rep cell reports nothing rather than an empty name',
  rowTargetCdms({ 'Account Name': 'Apollo', CDM: '   ' }, { cdmColumn: 'CDM' }), []);

// --- parsing the workbook -------------------------------------------------

eq('accounts listed twice under two reps merge into one entry carrying both',
  parseTargetAccountCdms({
    sheets: {
      A: { headers: HEADERS, records: [{ 'Account Name': 'Apollo Global Management', CDM: 'Jane Smith' }] },
      B: { headers: HEADERS, records: [{ 'Account Name': 'apollo global management', CDM: 'Ravi Patel' }] },
    },
    sheetNames: ['A', 'B'],
  }, { cdmColumn: 'CDM' }),
  [{ company: 'Apollo Global Management', cdms: ['Jane Smith', 'Ravi Patel'] }]);
eq('rows with no account name are dropped', parseTargetAccountCdms(sheet([{ CDM: 'Jane Smith' }]), { cdmColumn: 'CDM' }), []);
eq('no workbook loaded parses to nothing', parseTargetAccountCdms(null, {}), []);

// --- the resolver ---------------------------------------------------------

const data = sheet([
  { 'Account Name': 'Apollo Global Management', CDM: 'Jane Smith', Tier: 'Tier 1' },
  { 'Account Name': 'Brookfield Asset Management', CDM: 'Baldauf, Dan', Tier: 'Tier 2' },
  { 'Account Name': 'Blackstone GP Stakes', CDM: 'Ravi Patel', Tier: 'Tier 3' },
  { 'Account Name': 'KKR', CDM: '', Tier: 'Tier 3' },
]);
const resolve = buildTargetCdmResolver({ targetAccountsData: data, settings: SETTINGS });

const apollo = resolve({ id: 'p1', company: 'Apollo Global Management' }, 'Dan Baldauf');
eq('the targets list naming another rep is a conflict', apollo?.cdms, ['Jane Smith']);
eq('and it names the target row it came from', apollo?.accounts, [{ company: 'Apollo Global Management', cdms: ['Jane Smith'] }]);
eq('found by name, the conflict says so', apollo?.source, 'fuzzy');

check('the same rep spelled the other way round is not another CDM',
  resolve({ id: 'p2', company: 'Brookfield Asset Management' }, 'Dan Baldauf') === null);
check('an account with no rep on the list raises nothing',
  resolve({ id: 'p3', company: 'KKR' }, 'Dan Baldauf') === null);
check('a company that is not on the targets list at all raises nothing',
  resolve({ id: 'p4', company: 'Vista Equity Partners' }, 'Dan Baldauf') === null);
check('a lookalike name does not warn — "Blackstone" is not "Blackstone GP Stakes"',
  resolve({ id: 'p5', company: 'Blackstone' }, 'Dan Baldauf') === null);
eq('a corporate-suffix difference still matches the row',
  resolve({ id: 'p6', company: 'Apollo Global Management, Inc.' }, 'Dan Baldauf')?.cdms, ['Jane Smith']);

// A blank CDM on the record is still worth flagging: the targets list knows
// who covers the account even though the popup does not.
eq('a blank CDM here reports who the list has it under',
  resolve({ id: 'p7', company: 'Apollo Global Management' }, '')?.cdms, ['Jane Smith']);
eq('with no cdm argument the record\'s saved CDM is what gets compared',
  resolve({ id: 'p8', company: 'Brookfield Asset Management', cdm: 'Dan Baldauf' }), null);

// --- the explicit My Accounts mapping ------------------------------------

const mapped = buildTargetCdmResolver({
  targetAccountsData: data,
  settings: { ...SETTINGS, targetMap: { p1: ['Blackstone GP Stakes'] } },
});
eq('an explicit mapping decides which target row is read',
  mapped({ id: 'p1', company: 'Apollo Global Management' }, 'Dan Baldauf')?.cdms, ['Ravi Patel']);
eq('and the conflict reports that it was mapped, not guessed',
  mapped({ id: 'p1', company: 'Apollo Global Management' }, 'Dan Baldauf')?.source, 'mapped');

const cleared = buildTargetCdmResolver({
  targetAccountsData: data,
  settings: { ...SETTINGS, targetMap: { p1: [] } },
});
check('a mapping the user cleared stops the name fallback rather than re-guessing',
  cleared({ id: 'p1', company: 'Apollo Global Management' }, 'Dan Baldauf') === null);

const multi = buildTargetCdmResolver({
  targetAccountsData: sheet([
    { 'Account Name': 'Apollo Global Management', CDM: 'Jane Smith' },
    { 'Account Name': 'Apollo Asset Management', CDM: 'Ravi Patel' },
  ]),
  settings: { ...SETTINGS, targetMap: { p1: ['Apollo Global Management', 'Apollo Asset Management'] } },
});
eq('two mapped target rows report both reps',
  multi({ id: 'p1', company: 'Apollo' }, 'Dan Baldauf')?.cdms, ['Jane Smith', 'Ravi Patel']);

check('no workbook loaded means no warning anywhere',
  buildTargetCdmResolver({ targetAccountsData: null, settings: SETTINGS })({ id: 'p1', company: 'Apollo Global Management' }, 'Dan Baldauf') === null);
check('a new unsaved record does not crash the resolver',
  resolve(null, 'Dan Baldauf') === null);

// --- what the popup shows -------------------------------------------------

eq('one other CDM is named in the badge', targetCdmConflictLabel({ cdms: ['Jane Smith'] }), 'Jane Smith');
eq('several are counted instead', targetCdmConflictLabel({ cdms: ['Jane Smith', 'Ravi Patel'] }), '2 other CDMs');
eq('no conflict, no badge', targetCdmConflictLabel(null), '');

eq('the tooltip names the account, the rep, and the CDM on this record',
  describeTargetCdmConflict(apollo, 'Dan Baldauf'),
  '"Apollo Global Management" on the Target Accounts tab is assigned to Jane Smith. The CDM here is Dan Baldauf — check who covers this account. Matched by company name; map the target account on My Accounts to pin it.');
eq('a blank CDM here is spelled out rather than left as an empty phrase',
  describeTargetCdmConflict({ cdms: ['Jane Smith'], accounts: [{ company: 'Apollo', cdms: ['Jane Smith'] }], source: 'mapped' }, ''),
  '"Apollo" on the Target Accounts tab is assigned to Jane Smith. No CDM is set here — check who covers this account.');
eq('two reps read as a list',
  describeTargetCdmConflict({ cdms: ['Jane Smith', 'Ravi Patel'], accounts: [{ company: 'Apollo', cdms: ['Jane Smith', 'Ravi Patel'] }], source: 'mapped' }, 'Dan Baldauf'),
  '"Apollo" on the Target Accounts tab is assigned to Jane Smith and Ravi Patel. The CDM here is Dan Baldauf — check who covers this account.');
eq('no conflict, no tooltip', describeTargetCdmConflict(null, 'Dan Baldauf'), '');

console.log(failures === 0 ? '\nAll target-account CDM warning tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
