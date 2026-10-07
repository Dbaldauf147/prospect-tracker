// Assertion tests for the PE Monthly email.
//   node scripts/peMonthlyEmail.test.mjs
import {
  peMonthlyRows, PE_MONTHLY_COLUMNS, resolvePeMonthlyDraftTemplate, PE_MONTHLY_DRAFT_DEFAULTS,
  buildPeMonthlyEmailHtml, buildPeMonthlyTableHtml, buildPeMonthlyRows, sanitizePeMonthlyRows,
} from '../src/utils/peMonthlyEmail.js';
import { buildPeOverlapDeals } from '../src/utils/keithPeDeals.js';
import { buildTargetTierResolver, buildTargetCdmResolver } from '../src/utils/targetTier.js';
import { coverageFromSettings, salespeopleForVertical } from '../src/utils/salesCoverage.js';
import { parseMoney } from '../src/utils/oppsMetrics.js';
import { fmtMoneyWhole } from '../src/utils/pricingOptionCalc.js';
import { loadPeMonthlyRows } from '../api/_lib/peMonthly.js';
import { buildNewOppsDigestEmailHtml, buildNewOppsDigestTableHtml } from '../src/utils/newOppsDigestEmail.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const deals = [
  { id: '7', name: 'Kensing Solutions', peOwner: 'KKR', vertical: 'Chemicals', tier: 'Tier 1', targetCdm: 'Dan', stageLabel: 'Stage 4 · Quoting', amountLabel: '$120,000' },
  { id: '9', name: 'Acme', peOwner: '', vertical: '', tier: '', targetCdm: '', stageLabel: 'Stage 3 · Lead', amountLabel: '' },
];
const records = [
  { _id: 7, Scope: 'Bill pay', 'Next Steps': 'Call Tue Send quote', 'BFO Address': 'https://bfo.example/7' },
  { _id: 9 },
];
const coverage = (v) => (v === 'Chemicals' ? [{ name: 'Pat' }, { name: 'Lee' }] : []);
const rows = peMonthlyRows(deals, records, coverage);

check('one row per deal, in the deals\' order', rows.map(r => r.Account), ['Kensing Solutions', 'Acme']);
check('row carries every column', Object.keys(rows[0]).filter(k => k !== 'id'), PE_MONTHLY_COLUMNS.map(c => c.key));
check('opp fields joined by id', [rows[0].Scope, rows[0]['BFO Address']], ['Bill pay', 'https://bfo.example/7']);
check('salespeople off Coverage for the vertical', rows[0].Salesperson, 'Pat, Lee');
check('no vertical, no salesperson', rows[1].Salesperson, '');
check('blanks stay blank', [rows[1].Tier, rows[1]['Deal Size'], rows[1].Scope], ['', '', '']);

const table = buildPeMonthlyTableHtml(rows);
check('BFO link rendered as "BFO Link"', /<a href="https:\/\/bfo\.example\/7"[^>]*>BFO Link<\/a>/.test(table), true);
check('next steps keep their line breaks', table.includes('Call Tue<br>Send quote'), true);
check('empty list says so', buildPeMonthlyTableHtml([]).includes('No PE or portfolio company deals'), true);

// Same look as the New Opps email: identical cell styling and body wrapper.
const style = (html) => (html.match(/<th style="[^"]*"/) || [''])[0];
const nRow = [{ Account: 'X', 'Quoted Amount': '$1' }];
check('table header styled like New Opps', style(table).replace(/text-align:\w+/, ''), style(buildNewOppsDigestTableHtml(nRow)).replace(/text-align:\w+/, ''));
const wrap = (html) => html.slice(0, html.indexOf('>') + 1);
check('body wrapper like New Opps', wrap(buildPeMonthlyEmailHtml(rows, { greeting: 'Hey Keith,' })), wrap(buildNewOppsDigestEmailHtml(nRow, { greeting: 'Hey Keith,' })));
const body = buildPeMonthlyEmailHtml(rows, { greeting: 'Hey Keith,', message: 'Intro', signature: '<b>Dan</b>' });
check('greeting, intro, table, signature in order',
  [body.indexOf('Hey Keith,') < body.indexOf('Intro'), body.indexOf('Intro') < body.indexOf('<table'), body.indexOf('</table>') < body.indexOf('<b>Dan</b>')],
  [true, true, true]);

check('defaults when nothing saved', resolvePeMonthlyDraftTemplate(null), PE_MONTHLY_DRAFT_DEFAULTS);
check('saved wording wins, blank stays blank', resolvePeMonthlyDraftTemplate({ subject: 'PE', message: '', junk: 1 }),
  { ...PE_MONTHLY_DRAFT_DEFAULTS, subject: 'PE', message: '' });

// --- The scheduled email builds the same rows as the tab -----------------
const oppRecords = [
  { _id: 1, Account: 'Kensing Solutions', Type: 'Portfolio Company', Stage: 'Quoting', 'Quoted Amount': '$120,000', Scope: 'Bill pay', 'Next Steps': 'Call', 'BFO Address': 'https://bfo/1' },
  { _id: 2, Account: 'Thoma Bravo', Type: 'Private Equity', Stage: 'Lead' },
  { _id: 3, Account: 'Owner Co', Type: 'Owner Operator', Stage: 'Quoting' },
];
const companies = [
  { company: 'KKR', type: 'Private Equity', portfolioCompanies: [{ companyName: 'Kensing Solutions', sector: 'Chemicals' }] },
  { company: 'Thoma Bravo', type: 'Private Equity', vertical: 'Software' },
];
const userSettings = { salesCoverage: [{ team: 'Industrial', rows: [{ vertical: 'Chemicals', salespeople: ['Pat Smith'] }] }] };
const targets = { sheetNames: ['S'], sheets: { S: { records: [
  { Account: 'Kensing Solutions', Tier: 'Tier 2', CDM: 'Dan Baldauf' },
  { Account: 'Thoma Bravo', Tier: 'Tier 1', CDM: 'Jo Rep' },
] } } };

// What the Opps page does, step by step.
const pageRows = peMonthlyRows(
  buildPeOverlapDeals(oppRecords, {
    parseAmount: parseMoney, fmtAmount: fmtMoneyWhole, prospects: companies,
    targetTierFor: buildTargetTierResolver({ targetAccountsData: targets, cdmName: 'Dan Baldauf', settings: userSettings, includeAllReps: true }),
    targetCdmFor: buildTargetCdmResolver({ targetAccountsData: targets, settings: userSettings }),
  }),
  oppRecords,
  v => salespeopleForVertical(coverageFromSettings(userSettings), v),
);
const built = buildPeMonthlyRows({ records: oppRecords, prospects: companies, settings: userSettings, targetAccountsData: targets, cdmName: 'Dan Baldauf' });
check('buildPeMonthlyRows matches the page', built, pageRows);
check('and the rows are the PE ones with their details',
  built.map(r => [r.Account, r.Tier, r.CDM, r['PE Owner'], r.Vertical, r.Salesperson, r['Deal Size']]),
  [['Kensing Solutions', 'Tier 2', 'Dan Baldauf', 'KKR', 'Chemicals', 'Pat Smith', '$120,000'],
   ['Thoma Bravo', 'Tier 1', 'Jo Rep', 'Thoma Bravo', 'Software', '', '']]);

// Posted rows are cut to the email's columns, as strings.
const clean = sanitizePeMonthlyRows([{ Account: 'A', Tier: 3, evil: '<x>', 'Next Steps': null }, null, 'x']);
check('posted rows: only email columns, as strings', [clean.length, Object.keys(clean[0]).length, clean[0].Tier, clean[0]['Next Steps'], 'evil' in clean[0]],
  [1, PE_MONTHLY_COLUMNS.length, '3', '', false]);

// The server loader reads the same four things from Firestore.
function fakeDb(docs, collections) {
  const docRef = (path) => ({
    get: async () => ({ exists: path in docs, data: () => docs[path] }),
    collection: (name) => collectionRef(`${path}/${name}`),
  });
  const collectionRef = (path) => ({
    doc: (id) => docRef(`${path}/${id}`),
    select: () => ({ get: async () => ({ docs: (collections[path] || []).map(d => ({ data: () => d })) }) }),
    get: async () => ({ docs: [], forEach: () => {} }),
  });
  return { collection: collectionRef };
}
const db = fakeDb({
  'opps2Data/u1': { json: JSON.stringify({ records: oppRecords }) },
  'userSettings/u1': { ...userSettings, cdmName: 'Dan Baldauf' },
  'targetAccounts/u1': { json: JSON.stringify(targets) },
}, { 'users/u1/prospects': companies });
check('server loader builds the same rows as the page', await loadPeMonthlyRows(db, 'u1', 'someone@se.com'), pageRows);
const bare = fakeDb({ 'opps2Data/u1': { json: JSON.stringify({ records: oppRecords }) } }, {});
check('missing settings / companies / targets still sends the deals',
  (await loadPeMonthlyRows(bare, 'u1', 'someone@se.com')).map(r => r.Account), ['Kensing Solutions', 'Thoma Bravo']);
check('no opps doc, no rows', await loadPeMonthlyRows(fakeDb({}, {}), 'u1', 'x@y.com'), []);

// The scheduled body is the New Opps scheduled body: intro + table, no greeting.
const sched = buildPeMonthlyEmailHtml(built, { message: 'Monthly' });
check('scheduled body: intro then table, nothing else', [sched.includes('Monthly'), sched.includes('<table'), sched.includes('Hey Keith')], [true, true, false]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
