// "Run the agent prompts" reminder — the Agents tab's prompts are meant to be
// run every couple of days, and nothing on screen said when they last were.
// The user marks a run with the "Agents Ran" button on the Agents page; that
// stamps a timestamp, and the reminder stays quiet until the interval is up.
//
// The interval is counted in *business* days: prompts drive Salesforce work,
// so a run finished Thursday evening shouldn't nag on Saturday — it comes back
// Monday. Weekends are skipped when counting; the time of day is preserved, so
// a Thursday 6pm run is due again Monday 6pm.
//
// The stamp lives on the user's synced settings (`agentsLastRunAt`, an ISO
// string) rather than localStorage so the reminder follows the user across
// devices — running the prompts on the laptop shouldn't leave the desktop
// still nagging.
//
// The alert can also be snoozed: "not now, ask me again later" without
// claiming a run that didn't happen. The snooze end (`agentsRunSnoozedUntil`,
// also an ISO string on synced settings) suppresses the banner and the
// Sidebar dot until it passes, then the reminder comes back on its own if
// the run still hasn't been marked. Marking a run clears any snooze, so the
// two stamps can't disagree.

export const AGENTS_SETTINGS_KEY = 'agentsLastRunAt';
export const AGENTS_SNOOZE_SETTINGS_KEY = 'agentsRunSnoozedUntil';
export const AGENTS_RUN_INTERVAL_BUSINESS_DAYS = 2;

const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;

// Snooze lengths offered on the alert's Snooze menu, in the order shown.
// Anything a day or longer is counted in *business* days for the same
// reason the interval is: a Friday afternoon "1 day" should land Monday,
// not Saturday. `1 week` is five business days, i.e. the same weekday next
// week. Sub-day options are plain clock hours.
export const AGENTS_SNOOZE_DURATIONS = [
  { key: '1h', label: '1 hour', hours: 1 },
  { key: '4h', label: '4 hours', hours: 4 },
  { key: '1d', label: '1 day', businessDays: 1 },
  { key: '3d', label: '3 days', businessDays: 3 },
  { key: '1w', label: '1 week', businessDays: 5 },
];

// Sat/Sun in the viewer's own timezone — the reminder is a local-calendar
// thing, so local weekdays are what matter.
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// `count` business days after `ms`, keeping the time of day. Walks a day at a
// time and only counts the ones that land on a weekday, so Thursday + 2 is
// Monday and Friday + 2 is Tuesday. Day-at-a-time via setDate (rather than
// adding MS_PER_DAY) so a DST change shifts the clock, not the weekday.
export function addBusinessDays(ms, count) {
  const date = new Date(ms);
  let added = 0;
  while (added < count) {
    date.setDate(date.getDate() + 1);
    if (!isWeekend(date)) added += 1;
  }
  return date.getTime();
}

// Parse a stored stamp into epoch ms, or null when absent / unparseable.
export function agentsLastRunMs(lastRunAt) {
  if (!lastRunAt) return null;
  const ms = new Date(lastRunAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// When the next run comes due, or null when the prompts have never been
// marked as run (in which case they're due now — see isAgentsRunDue).
export function agentsRunDueAt(lastRunAt) {
  const last = agentsLastRunMs(lastRunAt);
  return last == null ? null : addBusinessDays(last, AGENTS_RUN_INTERVAL_BUSINESS_DAYS);
}

// When an active snooze ends, or null when there is none. A stamp in the
// past is treated as no snooze at all — expiry is evaluated on read, so a
// lapsed snooze needs nothing to clean it up.
export function agentsSnoozedUntilMs(snoozedUntil, now = Date.now()) {
  if (!snoozedUntil) return null;
  const ms = new Date(snoozedUntil).getTime();
  if (!Number.isFinite(ms) || ms <= now) return null;
  return ms;
}

export function isAgentsRunSnoozed(snoozedUntil, now = Date.now()) {
  return agentsSnoozedUntilMs(snoozedUntil, now) != null;
}

// When a snooze of `duration` (an AGENTS_SNOOZE_DURATIONS entry) taken now
// would end, or null for an unrecognised duration.
export function agentsSnoozeEndAt(duration, from = Date.now()) {
  if (!duration) return null;
  if (duration.businessDays > 0) return addBusinessDays(from, duration.businessDays);
  if (duration.hours > 0) return from + duration.hours * MS_PER_HOUR;
  return null;
}

// Is the reminder up? Never marked → yes, so the alert shows until the first
// run is recorded. An active snooze wins over both: the run is still owed,
// but the user asked not to be told about it yet.
export function isAgentsRunDue(lastRunAt, now = Date.now(), snoozedUntil = '') {
  if (isAgentsRunSnoozed(snoozedUntil, now)) return false;
  const due = agentsRunDueAt(lastRunAt);
  return due == null ? true : now >= due;
}

// Rough "how much snooze is left" copy for the status line — hours while
// under a day, then whole days. Rounded up, so it never reads as 0.
export function agentsSnoozeRemainingLabel(untilMs, now = Date.now()) {
  if (untilMs == null) return '';
  const left = untilMs - now;
  if (left <= 0) return '';
  if (left <= MS_PER_HOUR) return 'under an hour';
  if (left < MS_PER_DAY) {
    const hours = Math.ceil(left / MS_PER_HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.ceil(left / MS_PER_DAY);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// Whole days since the last marked run (null when never marked), for the
// "last run N days ago" copy. Calendar days, not business ones — this is how
// long ago it actually was, not how much of the interval has burned down.
export function agentsDaysSinceRun(lastRunAt, now = Date.now()) {
  const last = agentsLastRunMs(lastRunAt);
  if (last == null) return null;
  return Math.max(0, Math.floor((now - last) / MS_PER_DAY));
}

// Whole days until the reminder next fires (0 = today, null when never
// marked), for the "next reminder in N days" copy. Calendar days again, so it
// reads off the wall calendar: mark a run Friday and it's 4 days, not 2.
export function agentsDaysUntilDue(lastRunAt, now = Date.now()) {
  const due = agentsRunDueAt(lastRunAt);
  if (due == null) return null;
  return Math.max(0, Math.ceil((due - now) / MS_PER_DAY));
}
