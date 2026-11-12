// Assertion tests for the BFO History paste parser and the Agents task's
// company list. Plain Node, no framework. Run:
//   node scripts/bfoHistory.test.mjs
import { parseBfoHistory, bfoHistoryIsFresh, bfoHistoryTargets, bfoHistoryMissingNameIssues, BFO_HISTORY_HEADER } from '../src/utils/bfoHistory.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const tsv = [
  BFO_HISTORY_HEADER,
  'Open\tBank of America - SAO - 3PH\tCory Manley\t5 - Prepare & Bid\t$2,500,000.00\tMay 31, 2027\tNov 12, 2026\t✓\t30',
  'closed\tOld deal\tJohn S\t7 - Closed\t$5,000.00\tJan 1, 2025\tJan 2, 2025\t\t0',
].join('\n');
const a = parseBfoHistory(tsv);
check('tsv: two rows, no error', [a.rows.length, a.error], [2, '']);
check('tsv: first row fields', a.rows[0], {
  status: 'Open', name: 'Bank of America - SAO - 3PH', leader: 'Cory Manley', stage: '5 - Prepare & Bid',
  amount: '$2,500,000.00', closeDate: 'May 31, 2027', lastModified: 'Nov 12, 2026', reporting: 'Yes', probability: '30',
});
check('tsv: status normalised, blank reporting kept blank', [a.rows[1].status, a.rows[1].reporting], ['Closed', '']);

const md = [
  '| Status | Opportunity Name | Amount |',
  '| --- | --- | --- |',
  '| Open | Deal A | $1 |',
].join('\n');
const b = parseBfoHistory(md);
check('markdown: rule skipped, header mapped', b.rows, [{ status: 'Open', name: 'Deal A', amount: '$1' }]);

const c = parseBfoHistory('Open\tDeal B\tLeader B\t2 - Define\t$3\tMay 1, 2027\tNov 1, 2026\tYes\t10');
check('headerless: read in column order', [c.rows[0].name, c.rows[0].probability], ['Deal B', '10']);

check('empty paste errors', parseBfoHistory('  \n').error !== '', true);
check('header without name errors', parseBfoHistory('Stage\tAmount\n1\t2').error !== '', true);

const now = Date.parse('2026-11-12T12:00:00Z');
check('fresh within 30 days', bfoHistoryIsFresh({ pastedAt: '2026-11-01T00:00:00Z' }, now), true);
check('stale after 30 days', bfoHistoryIsFresh({ pastedAt: '2026-09-01T00:00:00Z' }, now), false);
check('no history is not fresh', bfoHistoryIsFresh(undefined, now), false);

const pA = { id: 'a', company: 'Acme', bfoCompanyName: 'ACME Corp' };
const pB = { id: 'b', company: 'Beta', bfoCompanyName: '', bfoHistory: { pastedAt: '2026-11-10T00:00:00Z' } };
const acct = { c1: pA, c2: pA, c3: pB, c4: null };
const targets = bfoHistoryTargets(
  ['c1', 'c2', 'c3', 'c4'].map(id => ({ contact: { id } })),
  (contact) => acct[contact.id],
  now,
);
check('targets: one per company, dm counts, freshness', targets.map(t => [t.company, t.bfoCompanyName, t.dmCount, t.fresh]), [
  ['Acme', 'ACME Corp', 2, false],
  ['Beta', '', 1, true],
]);

// Issues tab rows: only the companies with no BFO Company Name.
{
  const targets = [
    { prospect: { id: 'a' }, company: 'Anderson Capital', bfoCompanyName: '', dmCount: 1 },
    { prospect: { id: 'b' }, company: 'CBRE', bfoCompanyName: 'CBRE INVESTMENT', dmCount: 2 },
    { prospect: { id: 'c' }, company: 'CIBC', bfoCompanyName: '', dmCount: 4 },
  ];
  const rows = bfoHistoryMissingNameIssues(targets);
  check('missing-name issues: one per nameless company', rows.map(r => r.id), ['bfo-history-no-name:a', 'bfo-history-no-name:c']);
  check('missing-name issue carries the fix kind and company', [rows[1].type, rows[1].company, rows[1].prospectId, rows[1].resolve.kind], ['BFO Company Name missing', 'CIBC', 'c', 'bfoCompanyName']);
  check('missing-name issue pluralises DMs', rows[1].detail.includes('4 DMs without activity'), true);
  check('missing-name issues: empty input', bfoHistoryMissingNameIssues(null), []);
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll passed');
