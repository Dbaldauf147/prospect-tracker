// The two history series the Weekly Report email carries in place of the
// "Emails sent" and "New opps" tiles.
//
// A tile answered one question — how did this week go against its target —
// and the email is read once a week by someone who wants to know whether
// the line is going the right way. "27 emails, /50" cannot say that; ten
// months side by side can. So the email trades the two tiles for the two
// series, both by calendar month so the two charts share an axis.
//
// These live here rather than in the tab because they are pure functions of
// data the tab already holds, and because a series that decides what an
// email says is worth testing without a browser.
import { computeActivity, computeOppChanges } from './weeklyReport.js';
import { emailsSentFor } from './weeklyActivityLog.js';
import { COVERAGE_CHARTS } from './progressCoverage.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// How far back each series looks. Ten months, drawn as columns, is what
// fits across half the email column and still shows a season's direction.
export const TREND_MONTHS = 10;
// Coverage looks back further than the two bar series do, because it is
// drawn as a line and a line wants a shape rather than five readings. Half
// a year is what the Progress tab's own charts show, and at the size the
// email draws it 26 points still resolve into weekly steps.
export const COVERAGE_WEEKS = 26;

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

// Emails sent per calendar month for the last `months` months.
//
// Each month is answered by the live HubSpot feed where it covers that
// month (the same rule the tile used, via emailsSentFor). Where it doesn't,
// the Activity tab's recordings stand in, and those are kept per week: the
// month is then the sum of each week's answer for the weeks that begin in
// it. That files a week straddling two months under the one it starts in,
// which is the price of a log that has no finer grain than a week, and it
// only applies to months the feed can no longer speak for.
//
// A series that counted the feed alone would read zero across the months it
// has nothing for and look like a collapse in outbound that never happened.
//
// A month with neither source is `null`, not 0: "we have no record of that
// month" and "that month had no sends" are different facts, and drawing the
// first as an empty bar is the kind of quiet lie this report keeps having
// to be talked out of.
export function emailsByMonth({ cache, log, senderEmail, refMs = Date.now(), months = TREND_MONTHS } = {}) {
  return recentMonths(refMs, months).map(({ start, end }) => {
    const point = { key: localKey(start).slice(0, 7), label: monthLabel(start) };
    if (hasLiveCoverage(cache, start)) {
      const live = computeActivity(cache, senderEmail, start, end).emails.length;
      return { ...point, value: live, recorded: false };
    }
    let total = 0;
    let known = false;
    let recorded = false;
    for (const wk of weeksStartingIn(start, end)) {
      const live = computeActivity(cache, senderEmail, wk.start, wk.end).emails.length;
      const answer = emailsSentFor({ cache, log, start: wk.start, live, weekly: true });
      total += answer.count;
      if (answer.recorded) recorded = true;
      if (answer.recorded || live > 0) known = true;
    }
    return { ...point, value: known ? total : null, recorded };
  });
}

// The week windows whose Monday falls inside [start, end).
function weeksStartingIn(start, end) {
  const out = [];
  let s = mondayOf(start);
  if (s < start) s += 7 * DAY_MS;
  // Stepped by calendar date, not by 7 * DAY_MS, so a daylight-saving
  // change inside the month can't slide a Monday off local midnight.
  for (let d = new Date(s); d.getTime() < end; d.setDate(d.getDate() + 7)) {
    const ws = d.getTime();
    const we = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
    out.push({ start: ws, end: we });
  }
  return out;
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

// Account coverage per week, for the two Progress-tab charts the email
// carries: the share of Tier 1 and Tier 2 accounts with a HubSpot contact,
// and the share with a decision maker identified.
//
// Unlike the two series above, this is not a count of what happened in the
// period — it is where coverage stands, read off the Progress tab's own
// weekly snapshots. Which is why a day-scoped report gets it too: "79% of
// Tier 2 has a contact" is as true on a Tuesday as it is for the week.
//
// A week with no snapshot is null, not 0, for the same reason a week with
// no email recording is: the Progress tab writes a snapshot when it is
// opened, so a week nobody opened it has no reading, and drawing that as
// 0% would put a cliff in the line that no account ever fell off.
export function coverageByWeek({ progressWeeks = [], refMs = Date.now(), weeks = COVERAGE_WEEKS } = {}) {
  const byWeek = new Map();
  for (const w of (Array.isArray(progressWeeks) ? progressWeeks : [])) {
    if (w && typeof w === 'object' && typeof w.week === 'string') byWeek.set(w.week, w);
  }
  if (!byWeek.size) return null;

  const windows = recentWeeks(refMs, weeks);
  const charts = COVERAGE_CHARTS.map((c) => {
    const points = windows.map(({ start }) => {
      const snap = byWeek.get(localKey(start));
      return {
        key: localKey(start),
        label: weekLabel(start),
        t1: coveragePct(snap?.[c.t1Key]),
        t2: coveragePct(snap?.[c.t2Key]),
      };
    });
    return { id: c.id, title: c.label, points, note: coverageNote(points) };
  }).filter(c => c.points.some(p => p.t1 != null || p.t2 != null));

  return charts.length ? { weeks: windows.length, charts } : null;
}

// A percentage the snapshot actually carries, or null. Out-of-range values
// are clamped rather than dropped: a bar is drawn from this, and a 140%
// would run off the end of its track.
function coveragePct(v) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

// The one line under a coverage card: where each tier stands now and how
// far it has moved across the window. Five bars show the shape; this says
// what the shape amounts to, which is the sentence a reader repeats.
function coverageNote(points) {
  const known = (p) => p.t1 != null || p.t2 != null;
  const base = points.find(known);
  const last = [...points].reverse().find(known);
  if (!base || !last || base === last) return '';
  const phrase = (name, key) => {
    if (base[key] == null || last[key] == null) return '';
    const d = last[key] - base[key];
    if (d === 0) return `${name} flat at ${last[key]}%`;
    return `${name} ${d > 0 ? '+' : ''}${d} ${Math.abs(d) === 1 ? 'pt' : 'pts'} to ${last[key]}%`;
  };
  const parts = [phrase('Tier 1', 't1'), phrase('Tier 2', 't2')].filter(Boolean);
  return parts.length ? `${parts.join(', ')} since ${base.label}.` : '';
}

// ---- Coverage ratio by week ----------------------------------------------
//
// The KPI card says what the coverage ratio (open pipeline ÷ annual target)
// is today. Nothing said what it was last week, because the ratio is
// computed off whatever pipeline is cached at the moment and nothing kept
// the answer. So a reading is written down per week (utils/coverageRatioStore
// on the tab, the cron's rebuild for a week nobody opened it) and this turns
// those readings into the series the email draws.
//
// Eight weeks: long enough for a direction to show through a week of noise,
// short enough to sit as one card of bars under the KPI row.
export const COVERAGE_RATIO_WEEKS = 8;
// How long the log is kept. A reading is ~80 bytes, so three years of them
// is still a rounding error against a Firestore document.
const MAX_COVERAGE_READINGS = 156;

// The Monday key of the week containing `ms`, in the same local terms the
// series windows are built in. The one function both writers key a reading
// by, so a reading always lands in the window that will look for it.
export function weekKeyAt(ms) {
  return localKey(mondayOf(ms));
}

const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// What a week's reading holds, off the headline KPIs: the ratio and the
// two figures it divides, plus the goal it stood against at the time (the
// goal is edited on the Pipeline tab, and a later edit should not rewrite
// what last month was measured against). Null when there is no ratio to
// record: a blank card is an absent answer, and writing it down as one
// would put a hole in a week that may yet get a real reading.
export function coverageReading(kpis) {
  const c = kpis?.coverageRatio || {};
  const ratio = finiteOrNull(c.actual);
  if (ratio == null) return null;
  return {
    ratio,
    goal: finiteOrNull(c.goal),
    pipeline: finiteOrNull(c.pipelineActual),
    target: finiteOrNull(c.target),
  };
}

// Whether two readings say the same thing, so an unchanged figure is not
// rewritten on every render of the tab.
export function sameReading(a, b) {
  if (!a || !b) return false;
  return a.ratio === b.ratio && (a.goal ?? null) === (b.goal ?? null)
    && (a.pipeline ?? null) === (b.pipeline ?? null) && (a.target ?? null) === (b.target ?? null);
}

// The log with `reading` recorded under `key`. The latest reading in a week
// wins - the ratio is a level, and where it stood when the week closed is
// the figure that week is remembered by - unless `onlyIfMissing`, which is
// how the cron fills a week without overwriting one the tab measured while
// the week was still running. Returns the same object when nothing changes.
export function withCoverageReading(log, key, reading, { at = Date.now(), onlyIfMissing = false } = {}) {
  const prev = (log && typeof log === 'object') ? log : {};
  if (!key || !reading || finiteOrNull(reading.ratio) == null) return prev;
  if (onlyIfMissing && prev[key]) return prev;
  if (sameReading(prev[key], reading)) return prev;
  const out = { ...prev, [key]: { ...reading, at } };
  const keys = Object.keys(out).sort();
  if (keys.length <= MAX_COVERAGE_READINGS) return out;
  const trimmed = {};
  for (const k of keys.slice(keys.length - MAX_COVERAGE_READINGS)) trimmed[k] = out[k];
  return trimmed;
}

// The coverage ratio for the last `weeks` weeks, oldest first, ending with
// the week containing `refMs`.
//
// A week with no reading is null, not 0, for the reason every series here
// keeps: nobody measured it, and a 0.00× bar would draw the week the
// pipeline emptied out. The goal the card reports is the latest one
// recorded, which is the one the reader is being held to now.
export function coverageRatioByWeek({ log, refMs = Date.now(), weeks = COVERAGE_RATIO_WEEKS } = {}) {
  const readings = (log && typeof log === 'object') ? log : {};
  const points = recentWeeks(refMs, weeks).map(({ start }) => {
    const key = localKey(start);
    const r = readings[key];
    const value = finiteOrNull(r?.ratio);
    return { key, label: weekLabel(start), value: value == null ? null : +value.toFixed(2) };
  });
  const known = points.filter(p => p.value != null);
  if (!known.length) return null;

  const latestKey = [...points].reverse().find(p => p.value != null).key;
  const goal = finiteOrNull(readings[latestKey]?.goal);
  return { weeks: points.length, goal, points, note: coverageRatioNote(known) };
}

// The one line under the card: how far the ratio has moved across the
// weeks shown. The bars show the shape; this is the sentence a reader
// repeats.
function coverageRatioNote(known) {
  if (known.length < 2) return '';
  const base = known[0];
  const last = known[known.length - 1];
  const d = +(last.value - base.value).toFixed(2);
  if (d === 0) return `Flat at ${last.value.toFixed(2)}× since ${base.label}.`;
  return `${d > 0 ? 'Up' : 'Down'} ${Math.abs(d).toFixed(2)}× since ${base.label}, from ${base.value.toFixed(2)}× to ${last.value.toFixed(2)}×.`;
}
