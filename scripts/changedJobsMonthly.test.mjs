// Tests for the monthly Changed Jobs email: who goes in, how it reads, and
// that the cron sends once a month. Run: node scripts/changedJobsMonthly.test.mjs
import assert from 'node:assert/strict';
import { buildChangedJobsMonthly, monthOf } from '../src/utils/changedJobsMonthly.js';
import { changedJobsMonthlySubject, renderChangedJobsMonthlyHtml } from '../api/_lib/changedJobsMonthlyEmail.js';
import { runMonthly, recipientsFromEnv } from '../api/changed-jobs-monthly.js';

let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`ok - ${label}`); } catch (err) { failed += 1; console.error(`FAIL - ${label}\n  ${err.message}`); }
}

const DEC_1_2026 = Date.UTC(2026, 11, 1, 13, 20);
const contacts = [
  { id: '1', firstname: 'Zed', lastname: 'Outside', email: 'zed@acme.com', company: 'Acme', dans_tags: 'Left', jobtitle: 'VP Energy', hs_linkedin_url: 'https://linkedin.com/in/zed' },
  { id: '2', firstname: 'Amy', lastname: 'Outside', email: 'amy@beta.com', company: 'Changed Jobs', companyText: 'Beta Corp' },
  { id: '3', firstname: 'Cat', lastname: 'Coworker', email: 'cat@se.com', company: 'Schneider Electric', dans_tags: 'Left' },
  { id: '4', firstname: 'Dan', lastname: 'Stillhere', email: 'dan@se.com', company: 'Schneider Electric' },
  { id: '5', firstname: 'Hid', lastname: 'Den', email: 'hid@gamma.com', company: 'Gamma', dans_tags: 'Left' },
  { id: '6', firstname: 'Ovi', lastname: 'Override', email: 'ovi@delta.com', company: 'Delta' },
  { id: '7', firstname: 'Sno', lastname: 'Ozed', email: 'sno@eps.com', company: 'Eps', dans_tags: 'Left' },
  { id: '8', firstname: 'Was', lastname: 'Snoozed', email: 'was@zeta.com', company: 'Zeta', dans_tags: 'Left' },
];
const settings = {
  contactLocalFields: {
    1: { _reachedOut: true, _reachedOutAt: '2026-11-03T15:00:00.000Z', _newCompany: 'Omega' },
    5: { _changedJobsHidden: true },
    6: { _companyOverride: 'Changed Jobs' },
    7: { _changedJobsSnoozeUntil: '2027-03-01T00:00:00.000Z' },
    8: { _changedJobsSnoozeUntil: '2026-10-01T00:00:00.000Z' },
  },
};
const report = buildChangedJobsMonthly(contacts, settings, { nowMs: DEC_1_2026 });

await check('month is named from the run date', async () => {
  assert.deepEqual(monthOf(DEC_1_2026), { key: '2026-12', label: 'December 2026' });
});

await check('only outside contacts, minus the page-hidden, not-yet-reached first', async () => {
  assert.deepEqual(report.rows.map(r => r.name), ['Amy Outside', 'Ovi Override', 'Was Snoozed', 'Zed Outside']);
  assert.deepEqual(report.totals, { total: 4, reachedOut: 1, notReachedOut: 3, hidden: 1, snoozed: 1 });
});

await check('previous company skips the Changed Jobs marker; local fields carry over', async () => {
  const by = Object.fromEntries(report.rows.map(r => [r.id, r]));
  assert.equal(by[2].previousCompany, 'Beta Corp');
  assert.equal(by[6].previousCompany, 'Delta');
  assert.equal(by[1].newCompany, 'Omega');
  assert.equal(by[1].reachedOut, true);
  assert.equal(by[1].linkedin, 'https://linkedin.com/in/zed');
});

await check('subject and html read right, with no em dash', async () => {
  const subject = changedJobsMonthlySubject(report);
  assert.equal(subject, 'Changed Jobs, December 2026: 4 contacts, 3 not reached out');
  assert.ok(renderChangedJobsMonthlyHtml(report).includes('1 snoozed contact is left out'));
  const html = renderChangedJobsMonthlyHtml(report);
  assert.ok(html.includes('Amy Outside') && html.includes('Beta Corp') && html.includes('Omega'));
  assert.ok(!html.includes('Cat Coworker') && !html.includes('Hid Den') && !html.includes('Sno Ozed'));
  assert.ok(!html.includes('—') && !subject.includes('—'));
  const empty = renderChangedJobsMonthlyHtml(buildChangedJobsMonthly([], {}, { nowMs: DEC_1_2026 }));
  assert.ok(empty.includes('Nobody outside Schneider Electric'));
});

await check('names are escaped', async () => {
  const r = buildChangedJobsMonthly([{ id: '9', firstname: '<b>x</b>', email: 'x@y.com', company: 'Changed Jobs' }], {}, { nowMs: DEC_1_2026 });
  assert.ok(!renderChangedJobsMonthlyHtml(r).includes('<b>x</b>'));
});

await check('it goes to the work inbox unless the env says otherwise', async () => {
  assert.deepEqual(recipientsFromEnv({}), ['daniel.baldauf@se.com']);
  assert.deepEqual(recipientsFromEnv({ CHANGED_JOBS_MONTHLY_TO: 'a@x.com; b@x.com' }), ['a@x.com', 'b@x.com']);
});

function fakeDb(initial = null) {
  let doc = initial;
  return {
    get latest() { return doc; },
    collection: () => ({ doc: () => ({ get: async () => ({ exists: !!doc, data: () => doc }), set: async (v) => { doc = v; } }) }),
  };
}

await check('runMonthly sends once a month from the cron, always on demand', async () => {
  const sent = [];
  const opts = { load: async () => ({ contacts, settings }), send: async (m) => { sent.push(m); }, now: () => DEC_1_2026, env: { CHANGED_JOBS_MONTHLY_TO: 'me@example.com' } };
  const db = fakeDb();
  const first = await runMonthly({ db, fromCron: true, ...opts });
  assert.equal(first.ok, true);
  assert.equal(first.month, '2026-12');
  assert.equal(first.total, 4);
  assert.deepEqual(sent[0].to, ['me@example.com']);
  const again = await runMonthly({ db, fromCron: true, ...opts });
  assert.equal(again.skipped, 'already sent for this month');
  assert.equal(sent.length, 1);
  await runMonthly({ db, ...opts });
  assert.equal(sent.length, 2, 'Email me this now always sends');
});

await check('a failure is logged, not thrown', async () => {
  const db = fakeDb();
  const entry = await runMonthly({ db, load: async () => { throw new Error('boom'); }, send: async () => {}, now: () => DEC_1_2026, env: {} });
  assert.equal(entry.ok, false);
  assert.equal(db.latest.error, 'boom');
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
