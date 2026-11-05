// The quarterly Close Rates email: which quarter, which filters, the
// figures, the raw-data table and the send / skip rules.
import assert from 'node:assert/strict';
import { lastCompletedQuarter, emailFilters, buildCloseRatesQuarterly } from '../src/utils/closeRatesQuarterly.js';
import {
  renderCloseRatesQuarterlyHtml, closeRatesQuarterlySubject, closeRatesQuarterlyWorkbook, RAW_COLUMNS,
} from '../api/_lib/closeRatesQuarterlyEmail.js';
import { runQuarterly } from '../api/close-rates-quarterly.js';

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); }
  catch (err) { failed += 1; console.log(`FAIL  ${name}\n      ${err.stack || err}`); }
}

const JAN_1_2027 = Date.UTC(2027, 0, 1, 13);
const OCT_1_2026 = Date.UTC(2026, 9, 1, 13);

await check('the quarter is the one that just ended', () => {
  assert.deepEqual(lastCompletedQuarter(JAN_1_2027), { key: '2026-Q4', label: 'Q4 2026', start: '2026-10-01', end: '2026-12-31', nextStart: '2027-01-01' });
  assert.equal(lastCompletedQuarter(OCT_1_2026).key, '2026-Q3');
  assert.equal(lastCompletedQuarter(OCT_1_2026).end, '2026-09-30');
  assert.equal(lastCompletedQuarter(Date.UTC(2026, 4, 20)).key, '2026-Q1');
});

await check('default filters: the tab opening state, ending with the quarter', () => {
  const f = emailFilters({}, lastCompletedQuarter(JAN_1_2027));
  assert.equal(f.period, 'quarter');
  assert.equal(f.from, '2025-01-01');
  assert.equal(f.to, '2026-12-31');
  assert.equal(f.leadOrHigher, true);
  assert.equal(f.noPullThroughs, true);
  assert.equal(f.savedName, '');
});

await check('the starred saved filter is followed', () => {
  const settings = { closeRateSavedFilters: { defaultId: 7, list: [{ id: 7, name: 'Mine', period: 'month', preset: '1y', leadOrHigher: false, noPullThroughs: true }] } };
  const f = emailFilters(settings, lastCompletedQuarter(JAN_1_2027));
  assert.equal(f.period, 'month');
  assert.equal(f.from, '2026-01-01', 'a rolling window is read from the new quarter');
  assert.equal(f.to, '2026-12-31');
  assert.equal(f.leadOrHigher, false);
  assert.equal(f.savedName, 'Mine');
});

const opp = (o) => ({ Account: 'Acme', Scope: 'Audits', Source: 'Referral', 'Start Date': '2026-01-01', 'Quoted On': '2026-02-01', ...o });
const records = [
  opp({ Stage: 'Sold', 'Close Date': '2026-11-10', 'Quoted Amount': '12000' }),
  opp({ Stage: 'Not Sold', 'Close Date': '2026-12-01', Source: 'Event' }),
  opp({ Stage: 'Sold', 'Close Date': '2026-08-15' }),
  opp({ Stage: 'Sold', 'Close Date': '2025-11-15' }),
  opp({ Stage: 'Not Sold', 'Close Date': '2025-10-20' }),
  // after the quarter: not in this email
  opp({ Stage: 'Sold', 'Close Date': '2027-01-01' }),
  // still open: never in a close rate
  opp({ Stage: 'Stage 4', 'Close Date': '2026-11-01' }),
  // pull-through: left out by default
  opp({ Stage: 'Sold', 'Close Date': '2026-11-11', Scope: 'Pull through renewal' }),
];

const report = buildCloseRatesQuarterly(records, {}, { nowMs: JAN_1_2027 });

await check('headline: the quarter against the one before and a year back', () => {
  assert.equal(report.quarter.key, '2026-Q4');
  assert.deepEqual(report.headline.quarter, { rate: 50, wins: 1, decided: 2 });
  assert.deepEqual(report.headline.prior, { rate: 100, wins: 1, decided: 1 });
  assert.equal(report.headline.priorKey, '2026-Q3');
  assert.deepEqual(report.headline.yearAgo, { rate: 50, wins: 1, decided: 2 });
  assert.equal(report.headline.yearAgoKey, '2025-Q4');
});

await check('raw data: every closed opp in the window, newest first, nothing after the quarter', () => {
  assert.equal(report.opps.length, 5);
  assert.equal(report.opps[0]['Close Date'], '2026-12-01');
  assert.ok(report.opps.every(r => r['Close Date'] <= '2026-12-31'));
  assert.ok(!report.opps.some(r => /pull through/i.test(r.Scope)), 'pull-throughs left out');
});

await check('the trends stop at the quarter', () => {
  assert.equal(report.bySource.periods.at(-1), '2026-Q4');
  assert.equal(report.byStage.periods.at(-1), '2026-Q4');
  assert.equal(report.weekly.months.at(-1), 'Dec');
});

await check('the email renders every section, ending with the raw data', () => {
  const html = renderCloseRatesQuarterlyHtml(report);
  const order = ['Close rate, Q4 2026', 'Close rate trend (Weekly email)', 'By source', 'By service', 'By stage', 'Opportunities included'];
  let at = -1;
  for (const s of order) {
    const i = html.indexOf(s);
    assert.ok(i > at, `${s} in order`);
    at = i;
  }
  for (const col of RAW_COLUMNS) assert.ok(html.lastIndexOf(col) > html.indexOf('Opportunities included'), `raw column ${col}`);
  assert.ok(html.includes('$12,000'));
  assert.ok(!html.includes('—'), 'no em dashes');
  assert.equal(closeRatesQuarterlySubject(report), 'Close rates, Q4 2026: 50% (1/2)');
});

await check('the attachment is a workbook', async () => {
  const buf = await closeRatesQuarterlyWorkbook(report);
  assert.ok(buf.length > 1000);
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
});

// A Firestore stand-in holding one log doc.
function fakeDb(initial = null) {
  let doc = initial;
  return {
    get latest() { return doc; },
    collection: () => ({ doc: () => ({ get: async () => ({ exists: !!doc, data: () => doc }), set: async (v) => { doc = v; } }) }),
  };
}

await check('runQuarterly sends once per quarter from the cron, always on demand', async () => {
  const sent = [];
  const opts = { load: async () => ({ records, settings: {} }), send: async (m) => { sent.push(m); }, now: () => JAN_1_2027, env: { CLOSE_RATES_QUARTERLY_TO: 'me@example.com' } };
  const db = fakeDb();
  const first = await runQuarterly({ db, fromCron: true, ...opts });
  assert.equal(first.ok, true);
  assert.equal(first.quarter, '2026-Q4');
  assert.deepEqual(sent[0].to, ['me@example.com']);
  assert.equal(sent[0].attachments[0].filename, 'Close rates Q4 2026.xlsx');
  const again = await runQuarterly({ db, fromCron: true, ...opts });
  assert.equal(again.skipped, 'already sent for this quarter');
  assert.equal(sent.length, 1);
  await runQuarterly({ db, ...opts });
  assert.equal(sent.length, 2, 'Email it now always sends');
});

await check('a failure is logged, not thrown', async () => {
  const db = fakeDb();
  const entry = await runQuarterly({ db, load: async () => { throw new Error('boom'); }, send: async () => {}, now: () => JAN_1_2027, env: {} });
  assert.equal(entry.ok, false);
  assert.equal(db.latest.error, 'boom');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
