// Assertion tests for the PE Monthly email.
//   node scripts/peMonthlyEmail.test.mjs
import {
  peMonthlyRows, PE_MONTHLY_COLUMNS, resolvePeMonthlyDraftTemplate, PE_MONTHLY_DRAFT_DEFAULTS,
  buildPeMonthlyEmailHtml, buildPeMonthlyTableHtml,
} from '../src/utils/peMonthlyEmail.js';
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
