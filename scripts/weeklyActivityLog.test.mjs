// Assertion tests for the weekly activity log — the per-week totals the
// Activity tab banks so the Weekly Report still has a number for a week
// whose raw HubSpot feed is gone. Plain Node — no test framework (the
// project has none). Run:
//   node scripts/weeklyActivityLog.test.mjs
//
// The thing worth pinning is that the recorded number and the live
// number are the same number. If the bucketing here ever drifts from
// computeActivity's filters — an internal-only send counted in one and
// not the other — the tile would jump the moment it switched sources,
// and nobody would be able to say which figure was the real one.
import {
  weekKeyFor, bucketWeeklyActivity, mergeWeeklyLog, weeklyActivityEntry, liveCacheCovers,
} from '../src/utils/weeklyActivityLog.js';
import { computeActivity, weekBounds } from '../src/utils/weeklyReport.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const ME = 'dan@se.com';
const at = (iso) => new Date(iso).getTime();
const email = (isoTs, to, from = ME, subject = 'Hello') => ({
  hs_timestamp: isoTs, hs_email_from_email: from, hs_email_to_email: to, hs_email_subject: subject,
});

// --- week keys -----------------------------------------------------------
// Weeks are Monday-start and local, matching weekBounds.
check('Monday keys itself', weekKeyFor(at('2026-08-31T09:00:00')), '2026-08-31');
check('Sunday keys back to Monday', weekKeyFor(at('2026-09-06T23:30:00')), '2026-08-31');
check('next Monday rolls over', weekKeyFor(at('2026-09-07T00:05:00')), '2026-09-07');
check('a key matches its own weekBounds', weekKeyFor(weekBounds('2026-09-03').start), '2026-08-31');
check('no timestamp, no key', weekKeyFor(NaN), null);

// --- bucketing -----------------------------------------------------------
const cache = {
  fetchedAt: '2026-09-10T12:00:00',
  emails: [
    email('2026-09-01T09:00:00', 'jane@acme.com'),                 // week of Aug 31
    email('2026-09-02T10:00:00', 'bob@se.com, jane@acme.com'),     // mixed to-line: counts
    email('2026-09-03T11:00:00', 'colleague@se.com'),              // internal only: drops
    email('2026-09-04T11:00:00', 'jane@acme.com', 'someoneelse@se.com'), // not my send
    email('2026-09-05T11:00:00', 'jane@acme.com', ME, 'Quote (sample email)'), // sample
    email('2026-09-08T09:00:00', 'pat@acme.com'),                  // week of Sep 7
  ],
  calls: [
    { hs_timestamp: '2026-09-01T13:00:00', hs_call_direction: 'OUTBOUND' },
    { hs_timestamp: '2026-09-01T14:00:00', hs_call_direction: 'INBOUND' },
  ],
  meetings: [{ hs_meeting_start_time: '2026-09-02T15:00:00' }],
};

const now = at('2026-09-10T12:00:00'); // week of Sep 7
const weeks = bucketWeeklyActivity(cache, ME, now);
check('external sends counted for the week', weeks['2026-08-31'].emails, 2);
check('calls drop the inbound one', weeks['2026-08-31'].calls, 1);
check('meetings counted', weeks['2026-08-31'].meetings, 1);
check('the following week is its own bucket', weeks['2026-09-07'].emails, 1);

// The recorded number must equal what the report would count live.
const b = weekBounds('2026-09-03');
check(
  'recorded matches the live count for the same week',
  weeks['2026-08-31'].emails,
  computeActivity(cache, ME, b.start, b.end).emails.length,
);

// A quiet current week records a real zero rather than a gap, so the
// report can tell "nothing sent" from "never recorded".
const quiet = bucketWeeklyActivity({ emails: [], calls: [], meetings: [] }, ME, now);
check('a quiet current week records 0', quiet['2026-09-07'].emails, 0);
check('an untouched past week is left out', quiet['2026-08-31'], undefined);

// With no work email set, sends from anyone with an external recipient
// count — same as the report's own behaviour in that state.
const noMe = bucketWeeklyActivity(cache, '', now);
check('no work email widens the count', noMe['2026-08-31'].emails, 3);

// --- merging -------------------------------------------------------------
const existing = {
  '2026-08-24': { emails: 40, calls: 0, meetings: 0, at: 1 },
  '2026-08-31': { emails: 99, calls: 0, meetings: 0, at: 1 },
};
const merged = mergeWeeklyLog(existing, weeks, 12345);
check('a week the feed did not reach is kept', merged['2026-08-24'].emails, 40);
check('a re-counted week is overwritten', merged['2026-08-31'].emails, 2);
check('the recording is stamped', merged['2026-08-31'].at, 12345);
check('lookup by any ms inside the week', weeklyActivityEntry(merged, at('2026-09-03T08:00:00')).emails, 2);
check('a week never recorded reads null', weeklyActivityEntry(merged, at('2026-07-01T08:00:00')), null);

// A log is capped, and the cap drops the oldest weeks first.
const many = {};
for (let i = 0; i < 200; i += 1) {
  const d = new Date(2020, 0, 6 + i * 7); // Mondays from 2020-01-06
  many[weekKeyFor(d.getTime())] = { emails: i, calls: 0, meetings: 0 };
}
const capped = mergeWeeklyLog({}, many, 1);
const keys = Object.keys(capped).sort();
check('log is capped at 156 weeks', keys.length, 156);
check('the cap keeps the newest week', capped[keys[keys.length - 1]].emails, 199);

// --- which source answers ------------------------------------------------
// The whole point: a dropped feed must not read as a week with no work.
check('a full feed fetched after the week covers it', liveCacheCovers(cache, b.start), true);
check('no feed at all covers nothing', liveCacheCovers(null, b.start), false);
check(
  'a feed fetched before the week started covers nothing',
  liveCacheCovers({ ...cache, fetchedAt: '2026-08-20T12:00:00' }, b.start),
  false,
);
check(
  'a feed with no emails at all cannot answer',
  liveCacheCovers({ fetchedAt: '2026-09-10T12:00:00' }, b.start),
  false,
);
// A full fetch that found nothing is a real zero, not a missing answer —
// the fetch pages the whole history, so an empty week is an empty week.
check(
  'an empty but complete feed still answers',
  liveCacheCovers({ fetchedAt: '2026-09-10T12:00:00', emails: [], calls: [], meetings: [] }, b.start),
  true,
);

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
