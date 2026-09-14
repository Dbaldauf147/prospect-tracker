// The two history series the Weekly Report email carries in place of the
// "Emails sent" and "New opps" tiles.
//
// A tile answered one question — how did this week go against its target —
// and the email is read once a week by someone who wants to know whether
// the line is going the right way. "27 emails, /50" cannot say that; five
// weeks side by side can. So the email trades the two tiles for the two
// series, on the cadence each metric actually moves at: mail is a weekly
// habit, opps arrive in ones and twos and only make a shape over months.
//
// These live here rather than in the tab because they are pure functions of
// data the tab already holds, and because a series that decides what an
// email says is worth testing without a browser.
import { computeActivity, computeOppChanges } from './weeklyReport.js';
import { emailsSentFor } from './weeklyActivityLog.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// How far back each series looks. Five is what fits across an email column
// without the bars becoming stripes, and it is enough to see a direction.
export const TREND_WEEKS = 5;
export const TREND_MONTHS = 5;

// The [start, end) ms window for the calendar month containing `ms`.
export function monthBounds(ms) {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { start, end };
}

// Local midnight on the Monday of the week containing `ms`. Derived from
// local date parts rather than via an ISO string: toISOString() is UTC, and
// west of Greenwich a Monday-evening timestamp formats as Tuesday, which
// would slide every window in the series a day off the log's own keys.
function mondayOf(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - ((d.getDay() + 6) % 7) * DAY_MS;
}

// A YYYY-MM-DD key in local time, for the same reason.
function localKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The `n` week windows ending with the one containing `refMs`, oldest first.
export function recentWeeks(refMs, n) {
  const start = mondayOf(refMs);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = start - i * 7 * DAY_MS;
    out.push({ start: s, end: s + 7 * DAY_MS });
  }
  return out;
}

// The `n` month windows ending with the one containing `refMs`, oldest first.
export function recentMonths(refMs, n) {
  const d = new Date(refMs);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({
      start: s.getTime(),
      end: new Date(s.getFullYear(), s.getMonth() + 1, 1).getTime(),
    });
  }
  return out;
}

const weekLabel = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const monthLabel = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short' });

// Emails sent per week for the last `weeks` weeks.
//
// Each week is answered by the same rule the tile used (emailsSentFor): the
// live HubSpot feed where it covers that week, the Activity tab's recording
// where it doesn't. Both writers of that feed page the whole history, so a
// feed covers every week that began before it was fetched — which means the
// weeks it cannot answer for are the RECENT ones, and the usual gap is the
// feed being absent entirely after the storage quota dropped it.
//
// Either way, a series that counted the feed alone would read zero across
// the weeks it has nothing for and look like a collapse in outbound that
// never happened. That was survivable as one wrong tile; as five bars it
// would be a trend line pointing at the floor.
//
// A week with neither source is `null`, not 0: "we have no record of that
// week" and "that week had no sends" are different facts, and drawing the
// first as an empty bar is the kind of quiet lie this report keeps having
// to be talked out of.
export function emailsByWeek({ cache, log, senderEmail, refMs = Date.now(), weeks = TREND_WEEKS } = {}) {
  return recentWeeks(refMs, weeks).map(({ start, end }) => {
    const live = computeActivity(cache, senderEmail, start, end).emails.length;
    const { count, recorded } = emailsSentFor({ cache, log, start, live, weekly: true });
    // Nothing to go on: no recording for the week, and a feed that cannot
    // speak for it either.
    const known = recorded || live > 0 || hasLiveCoverage(cache, start);
    return {
      key: localKey(start),
      label: weekLabel(start),
      value: known ? count : null,
      recorded: !!recorded,
    };
  });
}

// Split out so the "no record" test reads as the one condition it is, and
// so it stays next to the rule it mirrors in emailsSentFor.
function hasLiveCoverage(cache, start) {
  if (!cache || typeof cache !== 'object' || !Array.isArray(cache.emails)) return false;
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  return Number.isFinite(fetchedAt) && fetchedAt >= start;
}

// New opps per calendar month for the last `months` months.
//
// Recomputed from the Opps cache the same way the period's own count is, so
// the last bar and the "New opps" list further down the email are the same
// number by construction rather than by two pieces of arithmetic agreeing.
export function newOppsByMonth({ records, refMs = Date.now(), months = TREND_MONTHS } = {}) {
  return recentMonths(refMs, months).map(({ start, end }) => ({
    key: localKey(start).slice(0, 7),
    label: monthLabel(start),
    value: computeOppChanges(records, start, end).newOpps.length,
    recorded: false,
  }));
}
