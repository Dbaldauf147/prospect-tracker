// Assertion tests for the Prospecting History "firms with activity in the
// last 120 days" chart: the count (activeFirmsByBucket) and the day-by-day
// record behind it (utils/activeFirmsHistory.js). Plain Node. Run:
//   node scripts/activeFirmsHistory.test.mjs
import { activeFirmsByBucket, myAccounts, firmBucket } from '../src/utils/tieredAccountActivity.js';
import {
  activeFirmsChartRows, parseActiveFirmsHistory, readingFromBuckets, withActiveFirmsReading,
} from '../src/utils/activeFirmsHistory.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

const DAY = 86400000;
const now = Date.UTC(2026, 9, 13, 12);
const ago = (d) => new Date(now - d * DAY).toISOString();

const prospects = [
  { id: 'a', company: 'Acme Corp', tier: 'Tier 1', cdm: 'Dan' },
  { id: 'b', company: 'Beta Holdings', tier: 'Tier 1', cdm: 'Dan' },
  { id: 'c', company: 'Cobalt Inc', tier: 'Tier 2', cdm: 'Dan' },
  { id: 'd', company: 'Delta Partners', tier: '', cdm: 'Dan' },
  { id: 'e', company: 'Echo Group', tier: 'Tier 4', cdm: 'Dan' },
  { id: 'f', company: 'Foxtrot', tier: 'Tier 1', cdm: 'Someone Else' },
];
const contacts = [
  { id: 1, company: 'Acme Corp', email: 'a@acme.com', notes_last_contacted: ago(10) },
  { id: 2, company: 'Beta Holdings', email: 'b@beta.com', notes_last_contacted: ago(200) },
  { id: 3, company: 'Cobalt', email: 'c@cobalt.com' },
  { id: 4, company: 'Delta Partners', email: 'd@delta.com', notes_last_contacted: ago(119) },
  { id: 5, company: 'Echo Group', email: 'e@echo.com', notes_last_contacted: ago(5), dans_tags: 'Hide' },
  { id: 6, company: 'Foxtrot', email: 'f@fox.com', notes_last_contacted: ago(1) },
];
const outreachIndex = { emails: { 'c@cobalt.com': { tsMs: now - 30 * DAY } }, phones: {} };

const firms = myAccounts(prospects, 'Dan');
eq(firms.map(p => p.id), ['a', 'b', 'c', 'd', 'e'], 'every account on the CDM, tiered or not');
eq([firmBucket(prospects[3]), firmBucket(prospects[4])], ['Not tiered', 'Not tiered'], 'blank and unknown tiers are Not tiered');

const buckets = activeFirmsByBucket({ accounts: firms, contacts, outreachIndex, nowMs: now });
eq(buckets, {
  'Tier 1': { active: 1, total: 2 },
  'Tier 2': { active: 1, total: 1 },
  'Tier 3': { active: 0, total: 0 },
  'Not tiered': { active: 1, total: 2 },
}, 'counted per bucket in a 120 day window, hidden contacts and stale activity left out');

const reading = readingFromBuckets(buckets, 120);
eq(readingFromBuckets({ 'Tier 1': { active: 1, total: 2 } }, 120), null, 'a missing bucket is no reading');
const h1 = withActiveFirmsReading({}, '2026-10-13', reading, 1);
eq(withActiveFirmsReading(h1, '2026-10-13', reading, 2) === h1, true, 'same reading again is not a write');
const rows = activeFirmsChartRows(h1, ['2026-10-12', '2026-10-13']);
eq([rows[0].recorded, rows[0]['Tier 1'], rows[0].active], [false, null, null], 'unrecorded day draws no bar');
eq([rows[1]['Tier 1'], rows[1]['Not tiered'], rows[1]['Not tiered total'], rows[1].active], [1, 1, 2, 3], 'recorded day carries counts, totals and the sum');
eq(parseActiveFirmsHistory('nope'), {}, 'corrupt value reads as empty');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
