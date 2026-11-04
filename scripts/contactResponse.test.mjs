// Contact response log on an opp. Plain Node. Run:
//   node scripts/contactResponse.test.mjs
import assert from 'node:assert/strict';
import { primaryContactOf, nextHeardFromLog, withHeardFromLog, contactResponseSummary, HEARD_FROM_LOG } from '../src/utils/contactResponse.js';

const F = 'Last Client Heard From Us';
const base = { Contact: 'Jane Doe, Bob Ray', Stage: 'Qualifying', 'Start Date': '2026-01-01', [F]: '2026-03-01' };

assert.equal(primaryContactOf(base), 'Jane Doe', 'starred = first contact');
assert.equal(primaryContactOf({ Contact: '' }), '');

// First change keeps the date that was there as the opening entry.
const day1 = new Date('2026-03-10T15:00:00Z');
const r1 = withHeardFromLog(base, { ...base, [F]: '2026-03-10' }, { now: day1 });
const log1 = r1[HEARD_FROM_LOG];
assert.deepEqual(log1.map(e => [e.date, e.gapDays, e.contact, e.source || '']), [
  ['2026-03-01', null, 'Jane Doe', 'existing'],
  ['2026-03-10', 9, 'Jane Doe', ''],
]);
assert.equal(log1[1].stage, 'Qualifying');
assert.equal(log1[1].oppAgeDays, 68);

// Same-day correction replaces the entry it just made.
const r1b = withHeardFromLog(r1, { ...r1, [F]: '2026-03-09' }, { now: new Date('2026-03-10T18:00:00Z') });
assert.deepEqual(r1b[HEARD_FROM_LOG].map(e => [e.date, e.gapDays]), [['2026-03-01', null], ['2026-03-09', 8]]);

// A later day adds, under whoever is starred then, at the stage then.
const moved = { ...r1, Contact: 'Bob Ray, Jane Doe', Stage: 'Quoted' };
const r2 = withHeardFromLog(r1, { ...moved, [F]: '2026-04-02' }, { now: new Date('2026-04-02T12:00:00Z') });
assert.deepEqual(r2[HEARD_FROM_LOG].map(e => [e.date, e.gapDays, e.contact, e.stage]), [
  ['2026-03-01', null, 'Jane Doe', 'Qualifying'],
  ['2026-03-10', 9, 'Jane Doe', 'Qualifying'],
  ['2026-04-02', 23, 'Bob Ray', 'Quoted'],
]);

// No change, a cleared date, or another field: nothing logged.
assert.equal(nextHeardFromLog(r2, { ...r2 }), null);
assert.equal(nextHeardFromLog(r2, { ...r2, [F]: '' }), null);
assert.equal(nextHeardFromLog(r2, { ...r2, Stage: 'Sold' }), null);
// A blank opp's first heard-from starts the log with no gap.
const fresh = withHeardFromLog({ Contact: 'Al' }, { Contact: 'Al', [F]: '2026-05-01' }, { now: new Date('2026-05-01T10:00:00Z') });
assert.deepEqual(fresh[HEARD_FROM_LOG].map(e => [e.date, e.gapDays]), [['2026-05-01', null]]);
// A back-dated entry slots in by date and the gaps are redone.
const back = withHeardFromLog(r2, { ...r2, [F]: '2026-03-20' }, { now: new Date('2026-04-05T10:00:00Z') });
assert.deepEqual(back[HEARD_FROM_LOG].map(e => [e.date, e.gapDays]), [['2026-03-01', null], ['2026-03-10', 9], ['2026-03-20', 10], ['2026-04-02', 13]]);

// Summary: newest first, days since, median gap.
const s = contactResponseSummary(r2, { nowMs: Date.parse('2026-04-12T09:00:00Z') });
assert.equal(s.contact, 'Bob Ray');
assert.equal(s.lastHeard, '2026-04-02');
assert.equal(s.daysSince, 10);
assert.deepEqual(s.entries.map(e => e.date), ['2026-04-02', '2026-03-10', '2026-03-01']);
assert.equal(s.medianGap, 16);
assert.equal(s.lastGap, 23);
// No log yet: the opp's date stands in.
const s0 = contactResponseSummary(base, { nowMs: Date.parse('2026-03-05T09:00:00Z') });
assert.deepEqual([s0.entries.length, s0.daysSince, s0.medianGap], [1, 4, null]);
assert.equal(contactResponseSummary({ Contact: 'X' }).daysSince, null);
console.log('PASS contactResponse');
