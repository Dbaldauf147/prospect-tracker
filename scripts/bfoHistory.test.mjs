// Assertion tests for the BFO History paste parser and the Agents task's
// company list. Plain Node, no framework. Run:
//   node scripts/bfoHistory.test.mjs
import { parseBfoHistory, bfoHistoryIsFresh, bfoHistoryTargets, bfoHistoryMissingNameIssues, BFO_HISTORY_HEADER, bfoHistoryRowKey, setBfoHistoryIgnored, setBfoHistoryOk, bfoHistoryMarks, bfoHistoryIsNone, markBfoHistoryNone, bfoHistoryReviewState } from '../src/utils/bfoHistory.js';

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
  amount: '$2,500,000.00', closeDate: 'May 31, 2027', lastModified: 'Nov 12, 2026', reporting: 'Yes', probability: '30', account: '',
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

// Ignored rows.
check('row key: name + close date, normalized', bfoHistoryRowKey({ name: '  Renewal  Deal', closeDate: 'May 31, 2027' }), 'renewal deal|may 31, 2027');
check('row key: same name, different year differs',
  bfoHistoryRowKey({ name: 'Renewal', closeDate: 'Jan 1, 2025' }) === bfoHistoryRowKey({ name: 'Renewal', closeDate: 'Jan 1, 2026' }), false);
const h0 = { rows: [{ name: 'A' }], pastedAt: 'x' };
const h1 = setBfoHistoryIgnored(h0, ['b|', 'a|'], true);
check('ignore: adds keys sorted, keeps rows', [h1.ignored, h1.rows, h1.pastedAt], [['a|', 'b|'], [{ name: 'A' }], 'x']);
check('ignore: original untouched', h0.ignored, undefined);
check('restore: removes a key', setBfoHistoryIgnored(h1, ['a|'], false).ignored, ['b|']);
check('ignore: on no history', setBfoHistoryIgnored(null, ['a|'], true), { ignored: ['a|'] });

{
  const r = parseBfoHistory('Status\tOpportunity Name\tBFO Account\nOpen\tDeal\tB Corp').rows[0];
  check('parse: BFO Account column', r.account, 'B Corp');
}

// OK marks: set, cleared, independent of ignored, carried over by a paste.
{
  const h0 = { rows: [{ name: 'A', closeDate: 'Jan 1, 2026' }], ignored: ['x|'] };
  const h1 = setBfoHistoryOk(h0, ['a|jan 1, 2026'], true);
  check('ok: mark adds the key', h1.ok, ['a|jan 1, 2026']);
  check('ok: ignored untouched', h1.ignored, ['x|']);
  check('ok: unmark removes it', setBfoHistoryOk(h1, ['a|jan 1, 2026'], false).ok, []);
  check('marks: paste keeps ignored and ok', bfoHistoryMarks(h1), { ignored: ['x|'], ok: ['a|jan 1, 2026'] });
  check('marks: nothing to keep', bfoHistoryMarks({ rows: [] }), {});
}

{
  const none = markBfoHistoryNone({ rows: [{ name: 'A' }], ok: ['a|'] }, '2026-11-10T00:00:00Z');
  check('none: empty rows, flagged, marks kept', none, { rows: [], pastedAt: '2026-11-10T00:00:00Z', noHistory: true, ok: ['a|'] });
  check('none: detected', [bfoHistoryIsNone(none), bfoHistoryIsNone({ rows: [] }), bfoHistoryIsNone(null)], [true, false, false]);
  check('none: counts as fresh', bfoHistoryIsFresh(none, now), true);
  const p = { id: 'n', company: 'NoOpps', bfoCompanyName: 'NoOpps Inc', bfoHistory: none };
  const [t] = bfoHistoryTargets([{ contact: {} }], () => p, now);
  check('none: target fresh and flagged', [t.fresh, t.noHistory], [true, true]);
}

{
  const rows = [{ name: 'Renewal', closeDate: 'Jan 1, 2026' }, { name: 'New', closeDate: 'Feb 1, 2026' }];
  const at = '2026-11-10T00:00:00Z';
  const [k1, k2] = rows.map(bfoHistoryRowKey);
  check('review: never pasted / null is none', [bfoHistoryReviewState(null), bfoHistoryReviewState({ rows })], ['none', 'none']);
  check('review: marked no history is none', bfoHistoryReviewState(markBfoHistoryNone(null, at)), 'none');
  check('review: empty paste is none', bfoHistoryReviewState({ rows: [], pastedAt: at }), 'none');
  check('review: unmarked rows are open', bfoHistoryReviewState({ rows, pastedAt: at }), 'open');
  check('review: one marked is open', bfoHistoryReviewState({ rows, pastedAt: at, ok: [k1] }), 'open');
  check('review: ignored + OK covers all', bfoHistoryReviewState({ rows, pastedAt: at, ok: [k1], ignored: [k2] }), 'reviewed');
  check('review: all OK', bfoHistoryReviewState({ rows, pastedAt: at, ok: [k1, k2] }), 'reviewed');
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll passed');
