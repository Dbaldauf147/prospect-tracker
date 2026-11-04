// Assertion tests for the Quoted Projections month-end capture that runs on
// the server (api/_lib/quotedMonthEnd.js) and the live figures it shares with
// the YOY page (src/utils/quotedLiveSnapshot.js). Plain Node. Run:
//   node scripts/quotedLiveSnapshot.test.mjs
//
// The point of the server capture: a month whose last day passed with nobody
// on the YOY page used to be rebuilt from the next month's opps, which shows
// as "rebuild = today's live figures". The capture it writes has to be one
// the page treats as a genuine month-end reading, and it must never overwrite
// a figure typed in through "Edit values".

import assert from 'node:assert/strict';
import {
  QUOTED_FIELDS as SNAP_FIELDS, liveQuotedFigures, roundQuotedFigures, sumBfoPipe,
  withMonthEndCapture, isLastDayOfMonthUTC, utcMonthKey,
} from '../src/utils/quotedLiveSnapshot.js';
import { QUOTED_FIELDS } from '../src/utils/quotedProjectionsStore.js';
import { rebuildOwnsMonth, capturedAtMonthEnd } from '../src/utils/quotedMonthRebuild.js';
import { captureQuotedMonthEnd, QUOTED_MIRROR_ID } from '../api/_lib/quotedMonthEnd.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; } catch (err) { console.error(`FAIL ${name}`); throw err; }
};

await test('field list matches the store', () => {
  assert.deepEqual(SNAP_FIELDS, QUOTED_FIELDS);
});

const opps = [
  { Stage: 'Quoted', 'Quoted Amount': '$100,000', 'Chance?': 'Weak' },
  { Stage: 'Quoted', 'Quoted Amount': '50000', 'Chance?': 'OK' },
  { Stage: 'Agreement Sent', 'Quoted Amount': 'USD 25,400.00', 'Chance?': 'Expected' },
  { Stage: 'Sold', 'Quoted Amount': '$999,000', 'Chance?': 'Expected' },
  { Stage: 'Lead', 'Quoted Amount': '', 'Chance?': 'Weak' },
];
const bfo = { headers: ['Name', 'Amount'], rows: [{ Amount: '$1,000,000' }, { Amount: '250000' }] };

await test('live figures bucket open quoted $ and skip closed opps', () => {
  const f = liveQuotedFigures(opps, bfo);
  assert.deepEqual(f, { weak: 100, ok: 50, expected: 25.4, agreements: 25.4, bfoPipe: 1250 });
  assert.equal(liveQuotedFigures([], bfo), null);
  assert.equal(sumBfoPipe(null), null);
  assert.deepEqual(roundQuotedFigures(f), { weak: 100, ok: 50, expected: 25, agreements: 25, bfoPipe: 1250 });
});

await test('last day of month, in UTC', () => {
  assert.equal(isLastDayOfMonthUTC(Date.UTC(2026, 9, 31, 23, 40)), true);
  assert.equal(isLastDayOfMonthUTC(Date.UTC(2026, 9, 30, 23, 40)), false);
  assert.equal(isLastDayOfMonthUTC(Date.UTC(2026, 1, 28, 23, 40)), true); // Feb 2026
  assert.equal(isLastDayOfMonthUTC(Date.UTC(2028, 1, 28, 23, 40)), false); // leap year
  assert.equal(utcMonthKey(Date.UTC(2026, 9, 31, 23, 40)), '2026-10');
});

await test('capture is a month-end reading the rebuild leaves alone', () => {
  const at = new Date(Date.UTC(2026, 9, 31, 23, 40)).toISOString();
  const next = withMonthEndCapture({ '2026-09': { weak: 1 } }, '2026-10', { weak: 5 }, at);
  assert.deepEqual(next['2026-10'], { weak: 5, _auto: true, _capturedAt: at });
  assert.deepEqual(next['2026-09'], { weak: 1 });
  assert.equal(capturedAtMonthEnd(next['2026-10'], '2026-10'), true);
  assert.equal(rebuildOwnsMonth(next['2026-10'], '2026-10'), false);
});

await test('capture replaces an auto or rebuilt entry, never a typed one', () => {
  const at = '2026-10-31T23:40:00.000Z';
  assert.ok(withMonthEndCapture({ '2026-10': { weak: 1, _auto: true, _capturedAt: '2026-10-12T00:00:00Z' } }, '2026-10', { weak: 5 }, at));
  assert.ok(withMonthEndCapture({ '2026-10': { weak: 1, _rebuilt: true } }, '2026-10', { weak: 5 }, at));
  assert.equal(withMonthEndCapture({ '2026-10': { weak: 1 } }, '2026-10', { weak: 5 }, at), null);
  assert.equal(withMonthEndCapture({}, '2026-10', null, at), null);
});

// ---- the server job, against an in-memory Firestore ---------------------
function fakeDb(docs) {
  const writes = [];
  const docRef = (path) => ({
    id: path.split('/').pop(),
    async get() { return { exists: path in docs, data: () => docs[path] }; },
    async set(v, opts) { writes.push(path); docs[path] = opts?.merge ? { ...(docs[path] || {}), ...v } : v; },
    collection: (name) => colRef(`${path}/${name}`),
  });
  const colRef = (path) => ({
    doc: (id) => docRef(`${path}/${id}`),
    async get() {
      const list = Object.keys(docs).filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'));
      return { docs: list.map(k => ({ id: k.split('/').pop(), data: () => docs[k] })), forEach(fn) { this.docs.forEach(fn); } };
    },
  });
  return { collection: (name) => colRef(name), writes, docs };
}

const UID = 'u1';
const tablePath = `userSettings/${UID}/localMirrors/${QUOTED_MIRROR_ID}`;
const seed = (table) => ({
  [`opps2Data/${UID}`]: { json: JSON.stringify({ headers: [], records: opps }) },
  [`userSettings/${UID}/localMirrors/idb__bfo-activity__current`]: { json: JSON.stringify(bfo), updatedAt: 1 },
  ...(table ? { [tablePath]: { json: JSON.stringify(table), updatedAt: 5 } } : {}),
});
const NOW = Date.UTC(2026, 9, 31, 23, 40);

await test('server capture writes the month end and bumps the stamp', async () => {
  const db = fakeDb(seed({ '2026-09': { weak: 9 }, '2026-10': { weak: 1, _auto: true, _capturedAt: '2026-10-12T00:00:00Z' } }));
  const r = await captureQuotedMonthEnd(db, UID, { now: NOW });
  assert.equal(r.status, 'captured');
  const doc = db.docs[tablePath];
  assert.ok(doc.updatedAt > 5);
  const table = JSON.parse(doc.json);
  assert.deepEqual(table['2026-09'], { weak: 9 });
  assert.deepEqual(table['2026-10'], { weak: 100, ok: 50, expected: 25, agreements: 25, bfoPipe: 1250, _auto: true, _capturedAt: new Date(NOW).toISOString() });
});

await test('server capture leaves a typed month, a dry run, and a user without the chart alone', async () => {
  const typed = fakeDb(seed({ '2026-10': { weak: 1 } }));
  assert.equal((await captureQuotedMonthEnd(typed, UID, { now: NOW })).status, 'manual');
  assert.equal(typed.writes.length, 0);

  const dry = fakeDb(seed({}));
  assert.equal((await captureQuotedMonthEnd(dry, UID, { now: NOW, dryRun: true })).status, 'dry-run');
  assert.equal(dry.writes.length, 0);

  const none = fakeDb(seed(null));
  assert.equal((await captureQuotedMonthEnd(none, UID, { now: NOW })).status, 'no-table');
  assert.equal(none.writes.length, 0);
});

console.log(`quotedLiveSnapshot: ${passed} passed`);
