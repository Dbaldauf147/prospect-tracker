// The two history series the Weekly Report email carries in place of the
// "Emails sent" and "New opps" tiles.
//
// The thing worth guarding: a week the live HubSpot feed can no longer
// reach must read off the Activity tab's banked recording, not off the
// feed. Counting the feed alone would slope every series down to zero at
// the left-hand end and show a collapse in outbound that never happened —
// which is the same bug that made a single tile read "Emails sent 0", now
// with four more weeks to get wrong.
import {
  monthBounds, recentWeeks, recentMonths, emailsByWeek, newOppsByMonth,
} from '../src/utils/weeklyReportTrends.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const ok = (c, name) => eq(!!c, true, name);

// Local midnight, the way every window in these series is built.
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const DAY = 24 * 60 * 60 * 1000;

// ---- Windows -------------------------------------------------------------
{
  // Sep 9 2026 is a Wednesday; its week starts Monday Sep 7.
  const weeks = recentWeeks(at(2026, 9, 9), 5);
  eq(weeks.length, 5, 'weeks: five windows');
  eq(new Date(weeks[4].start).getDay(), 1, 'weeks: each window starts on a Monday');
  eq(weeks[4].start, at(2026, 9, 7, 0), 'weeks: the last window is the one containing the ref date');
  eq(weeks[0].start, at(2026, 9, 7, 0) - 28 * DAY, 'weeks: the first is four weeks earlier');
  ok(weeks.every((w, i) => i === 0 || w.start > weeks[i - 1].start), 'weeks: oldest first');
  eq(weeks[0].end - weeks[0].start, 7 * DAY, 'weeks: a window is seven days');

  // The window must be built from local date parts. Late on a Monday west
  // of Greenwich the UTC date is already Tuesday, and going via an ISO
  // string would slide every window a day off the activity log's own keys.
  eq(recentWeeks(at(2026, 9, 7, 23), 1)[0].start, at(2026, 9, 7, 0),
    'weeks: a late-Monday timestamp still lands on that Monday');
}

{
  const months = recentMonths(at(2026, 9, 9), 5);
  eq(months.length, 5, 'months: five windows');
  eq(months.map(m => new Date(m.start).getMonth() + 1), [5, 6, 7, 8, 9], 'months: May through September');
  eq(months[4].start, at(2026, 9, 1, 0), 'months: the last window is the ref date’s month');
  eq(months[4].end, at(2026, 10, 1, 0), 'months: a window ends at the next month’s first');

  // Crossing a year boundary is the case a naive month-1 gets wrong.
  eq(recentMonths(at(2026, 2, 14), 5).map(m => new Date(m.start).getFullYear()),
    [2025, 2025, 2025, 2026, 2026], 'months: the window walks back across a year boundary');
  eq(recentMonths(at(2026, 2, 14), 5).map(m => new Date(m.start).getMonth() + 1),
    [10, 11, 12, 1, 2], 'months: October through February');

  const b = monthBounds(at(2026, 2, 14));
  eq([new Date(b.start).getDate(), new Date(b.end).getMonth() + 1], [1, 3],
    'monthBounds: the whole of February');
}

// ---- Emails by week ------------------------------------------------------
const REF = at(2026, 9, 9);
const weekStarts = recentWeeks(REF, 5).map(w => w.start);
const isoKey = (ms) => {
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// A feed the Activity tab wrote: emails sent by the user to somebody
// outside @se.com, plus the fetch stamp that says how far back it can
// answer for.
const email = (ms) => ({
  hs_timestamp: new Date(ms).toISOString(),
  hs_email_direction: 'EMAIL',
  hs_email_status: 'SENT',
  hs_email_from_email: 'me@se.com',
  hs_email_to_email: 'buyer@acme.com',
});
const feed = (fetchedAt, sends) => ({ fetchedAt: new Date(fetchedAt).toISOString(), emails: sends.map(email) });
const log = Object.fromEntries(weekStarts.map((s, i) => [isoKey(s), { emails: (i + 1) * 10, at: s }]));

{
  // Both writers of this cache page the whole HubSpot history, so a feed
  // fetched after a week ended is complete for it by construction — a fresh
  // feed answers for every week in the series.
  const cache = feed(REF, [weekStarts[4] + DAY, weekStarts[4] + 2 * DAY, weekStarts[0] + DAY]);
  const series = emailsByWeek({ cache, log, senderEmail: 'me@se.com', refMs: REF, weeks: 5 });
  eq(series.length, 5, 'emails: one point per week');
  eq(series.map(p => p.label).length, 5, 'emails: every point is labelled');
  eq(series[4].value, 2, 'emails: the current week counts the live feed');
  eq(series[4].recorded, false, 'emails: a live-counted week is not marked recorded');
  eq(series.map(p => p.recorded), [false, false, false, false, false],
    'emails: a feed that covers the whole series beats every recording');
}

{
  // The mixed case. A feed pages the whole history, so it answers for every
  // week that began before it was fetched — the week it CANNOT answer for
  // is the one still running when it was taken. Here the feed is from the
  // late in the week before, so the four behind it count live and the
  // current week falls back to the recording, which knows more.
  const cache = feed(weekStarts[4] - DAY, [
    weekStarts[0] + DAY, weekStarts[1] + DAY, weekStarts[1] + 2 * DAY, weekStarts[3] + DAY,
  ]);
  const series = emailsByWeek({ cache, log, senderEmail: 'me@se.com', refMs: REF, weeks: 5 });
  eq(series.map(p => p.recorded), [false, false, false, false, true],
    'emails: the week the feed was taken during falls back to the recording');
  eq(series.map(p => p.value), [1, 2, 0, 1, 50],
    'emails: each week takes the source that can actually answer for it');
}

{
  // The real case: the feed was dropped by the storage quota, so every week
  // is answered by the banked recording. Without that fallback the whole
  // series reads zero and looks like outbound stopped.
  const series = emailsByWeek({ cache: null, log, senderEmail: 'me@se.com', refMs: REF, weeks: 5 });
  eq(series.map(p => p.value), [10, 20, 30, 40, 50], 'emails: with no feed at all, the recordings carry the series');
  ok(series.every(p => p.recorded), 'emails: every point says it came from a recording');
}

{
  // No recording and no feed is not the same fact as a week with no sends,
  // and drawing it as an empty bar asserts a quiet week nobody measured.
  const series = emailsByWeek({ cache: null, log: {}, senderEmail: 'me@se.com', refMs: REF, weeks: 5 });
  eq(series.map(p => p.value), [null, null, null, null, null], 'emails: an unmeasured week is null, not 0');

  // A feed that covers the window and legitimately found nothing IS a zero.
  const covered = emailsByWeek({
    cache: feed(REF, []), log: {}, senderEmail: 'me@se.com', refMs: REF, weeks: 1,
  });
  eq(covered[0].value, 0, 'emails: a covered week with no sends is a real zero');
}

{
  // A feed fetched before a week started cannot know what happened in it.
  const stale = feed(weekStarts[0] - DAY, []);
  const series = emailsByWeek({ cache: stale, log: {}, senderEmail: 'me@se.com', refMs: REF, weeks: 5 });
  eq(series[4].value, null, 'emails: a feed older than the window answers for nothing');
}

// ---- New opps by month ---------------------------------------------------
const opp = (id, ms) => ({ id, account: `Acct ${id}`, Stage: 'Discovery', _rowUpdatedAt: ms });

{
  const records = [
    opp(1, at(2026, 5, 4)), opp(2, at(2026, 5, 20)),
    opp(3, at(2026, 7, 8)),
    opp(4, at(2026, 9, 2)), opp(5, at(2026, 9, 3)), opp(6, at(2026, 9, 4)),
    // Outside the five-month window entirely.
    opp(7, at(2025, 12, 1)),
  ];
  const series = newOppsByMonth({ records, refMs: REF, months: 5 });
  eq(series.map(p => p.value), [2, 0, 1, 0, 3], 'opps: counted into the month each first appeared');
  eq(series.map(p => p.key), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'], 'opps: keyed by month');
  eq(series[4].label, 'Sep', 'opps: labelled with the month name');
  ok(series.every(p => p.recorded === false), 'opps: nothing here comes off a recording');

  eq(newOppsByMonth({ records: [], refMs: REF, months: 5 }).map(p => p.value), [0, 0, 0, 0, 0],
    'opps: an empty cache is five real zeroes, not five blanks');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
