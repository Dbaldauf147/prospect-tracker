// The two history series the Weekly Report email carries in place of the
// "Emails sent" and "New opps" tiles.
//
// The thing worth guarding: a month the live HubSpot feed can no longer
// reach must read off the Activity tab's banked weekly recordings, not off
// the feed. Counting the feed alone would slope the series down to zero and
// show a collapse in outbound that never happened — which is the same bug
// that made a single tile read "Emails sent 0", now with more months to get
// wrong.
import {
  monthBounds, recentWeeks, recentMonths, emailsByMonth, newOppsByMonth, coverageByWeek,
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

// ---- Emails by month -----------------------------------------------------
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
// Weekly recordings, keyed by each week's Monday. Aug 31 is a Monday, so
// the week it starts belongs to August even though most of it is September.
const log = {
  [isoKey(at(2026, 8, 3, 0))]: { emails: 10, at: at(2026, 8, 3, 0) },
  [isoKey(at(2026, 8, 10, 0))]: { emails: 20, at: at(2026, 8, 10, 0) },
  [isoKey(at(2026, 8, 31, 0))]: { emails: 40, at: at(2026, 8, 31, 0) },
  [isoKey(at(2026, 9, 7, 0))]: { emails: 30, at: at(2026, 9, 7, 0) },
};

{
  // A feed fetched now answers for every month in the series, and a month
  // is counted as the calendar month, not as a run of weeks.
  const cache = feed(REF, [at(2026, 9, 8), at(2026, 9, 1), at(2026, 5, 5)]);
  const series = emailsByMonth({ cache, log, senderEmail: 'me@se.com', refMs: REF, months: 5 });
  eq(series.length, 5, 'emails: one point per month');
  eq(series.map(p => p.key), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'], 'emails: keyed by month');
  eq(series[4].label, 'Sep', 'emails: labelled with the month name');
  eq(series.map(p => p.value), [1, 0, 0, 0, 2], 'emails: each month counts the live feed');
  eq(series.map(p => p.recorded), [false, false, false, false, false],
    'emails: a feed that covers the whole series beats every recording');
}

{
  // The mixed case. A feed fetched in August answers for August and the
  // months before it; September began after it was taken, so September
  // falls back to its weeks' recordings.
  const cache = feed(at(2026, 8, 20), [at(2026, 8, 4), at(2026, 7, 9)]);
  const series = emailsByMonth({ cache, log, senderEmail: 'me@se.com', refMs: REF, months: 5 });
  eq(series.map(p => p.recorded), [false, false, false, false, true],
    'emails: the month the feed cannot reach falls back to the recordings');
  eq(series.map(p => p.value), [0, 0, 1, 1, 30],
    'emails: each month takes the source that can actually answer for it');
}

{
  // The real case: the feed was dropped by the storage quota, so every month
  // is the sum of its weeks' banked recordings.
  const series = emailsByMonth({ cache: null, log, senderEmail: 'me@se.com', refMs: REF, months: 5 });
  eq(series.map(p => p.value), [null, null, null, 70, 30],
    'emails: with no feed, a month adds up the weeks that start in it');
  eq(series.map(p => p.recorded), [false, false, false, true, true],
    'emails: a month built from recordings says so');
}

{
  // No recording and no feed is not the same fact as a month with no sends,
  // and drawing it as an empty bar asserts a quiet month nobody measured.
  const series = emailsByMonth({ cache: null, log: {}, senderEmail: 'me@se.com', refMs: REF, months: 5 });
  eq(series.map(p => p.value), [null, null, null, null, null], 'emails: an unmeasured month is null, not 0');

  // A feed that covers the window and legitimately found nothing IS a zero.
  const covered = emailsByMonth({
    cache: feed(REF, []), log: {}, senderEmail: 'me@se.com', refMs: REF, months: 1,
  });
  eq(covered[0].value, 0, 'emails: a covered month with no sends is a real zero');
}

{
  // A feed fetched before a month started cannot know what happened in it.
  const stale = feed(at(2026, 4, 20), []);
  const series = emailsByMonth({ cache: stale, log: {}, senderEmail: 'me@se.com', refMs: REF, months: 5 });
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

// ---- Account coverage ----------------------------------------------------
// The Progress tab's two charts, as the email carries them. The thing worth
// guarding is the same one the emails series has: a week the Progress tab
// was never opened has no snapshot, and reading that as 0% would draw a
// collapse in coverage that no account ever went through.
{
  // The five weeks ending with the one containing REF (Sep 9 2026). Keyed
  // off local date parts, the way the Progress tab keys its snapshots -
  // toISOString() is UTC, and west of Greenwich a local midnight formats as
  // the day before.
  const wk = (n) => {
    const d = new Date(weekStarts[n]);
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const weeks = [
    { week: wk(0), t1ContactPct: 88, t2ContactPct: 53, t1DMPct: 50, t2DMPct: 7 },
    { week: wk(1), t1ContactPct: 88, t2ContactPct: 55, t1DMPct: 49, t2DMPct: 8 },
    // wk(2) never recorded.
    { week: wk(3), t1ContactPct: 100, t2ContactPct: 79, t1DMPct: 67, t2DMPct: 33 },
    { week: wk(4), t1ContactPct: 100, t2ContactPct: 79, t1DMPct: 80, t2DMPct: 42 },
    // A week beyond the window, which must not be drawn.
    { week: '2026-09-14', t1ContactPct: 12, t2ContactPct: 12, t1DMPct: 12, t2DMPct: 12 },
  ];

  const cov = coverageByWeek({ progressWeeks: weeks, refMs: REF, weeks: 5 });
  eq(cov.weeks, 5, 'coverage: five weekly points');
  eq(cov.charts.map(c => c.id), ['contactPct', 'dmPct'], 'coverage: the two Progress charts, in tab order');
  eq(cov.charts[0].title, '% of Accounts with HubSpot Contacts', 'coverage: the chart keeps its own title');

  const contacts = cov.charts[0];
  eq(contacts.points.map(p => p.t1), [88, 88, null, 100, 100], 'coverage: an unrecorded week is null, not 0');
  eq(contacts.points.map(p => p.t2), [53, 55, null, 79, 79], 'coverage: both tiers read from the same snapshot');
  eq(contacts.points.map(p => p.label), ['Aug 10', 'Aug 17', 'Aug 24', 'Aug 31', 'Sep 7'],
    'coverage: every window is labelled, recorded or not');
  eq(contacts.points[4].key, '2026-09-07', 'coverage: keyed by the Monday the Progress tab keys on');
  eq(cov.charts[1].points.map(p => p.t1), [50, 49, null, 67, 80], 'coverage: the DM chart reads its own fields');

  // The one line under the card: where each tier stands and how far it moved.
  eq(contacts.note, 'Tier 1 +12 pts to 100%, Tier 2 +26 pts to 79% since Aug 10.',
    'coverage: the note reads from the oldest recorded week');
  eq(coverageByWeek({ progressWeeks: [weeks[3]], refMs: REF, weeks: 5 }).charts[0].note, '',
    'coverage: one recorded week is a level, not a change');

  // A tier that did not move says so rather than dropping out of the note.
  const flat = coverageByWeek({
    progressWeeks: [
      { week: wk(0), t1ContactPct: 100, t2ContactPct: 70 },
      { week: wk(4), t1ContactPct: 100, t2ContactPct: 64 },
    ],
    refMs: REF,
    weeks: 5,
  });
  eq(flat.charts[0].note, 'Tier 1 flat at 100%, Tier 2 -6 pts to 64% since Aug 10.',
    'coverage: a flat tier and a falling one read plainly');

  // A single point of movement is a pt, not "1 pts" - the coverage lines
  // move a point at a time more often than not, so this is the common case
  // rather than the edge one.
  const one = coverageByWeek({
    progressWeeks: [
      { week: wk(0), t1ContactPct: 80, t2ContactPct: 80 },
      { week: wk(4), t1ContactPct: 81, t2ContactPct: 79 },
    ],
    refMs: REF,
    weeks: 5,
  });
  eq(one.charts[0].note, 'Tier 1 +1 pt to 81%, Tier 2 -1 pt to 79% since Aug 10.',
    'coverage: one point of movement is a pt, either way');
  eq(flat.charts.length, 1, 'coverage: a chart with nothing recorded is left out rather than drawn empty');

  eq(coverageByWeek({ progressWeeks: [], refMs: REF }), null, 'coverage: no history at all is null');
  eq(coverageByWeek({ progressWeeks: [{ week: '2025-01-06', t1ContactPct: 50 }], refMs: REF }), null,
    'coverage: history that misses the window entirely is null, not five blanks');

  // Straight off a snapshot, so a stored value out of range is clamped
  // rather than drawn running off the end of its 100% track.
  const odd = coverageByWeek({
    progressWeeks: [{ week: wk(4), t1ContactPct: 140, t2ContactPct: -5 }], refMs: REF, weeks: 1,
  });
  eq([odd.charts[0].points[0].t1, odd.charts[0].points[0].t2], [100, 0], 'coverage: percentages are clamped to the track');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
