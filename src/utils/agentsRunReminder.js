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

export const AGENTS_SETTINGS_KEY = 'agentsLastRunAt';
export const AGENTS_RUN_INTERVAL_BUSINESS_DAYS = 2;

const MS_PER_DAY = 86400000;

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

// Is the reminder up? Never marked → yes, so the alert shows until the first
// run is recorded.
export function isAgentsRunDue(lastRunAt, now = Date.now()) {
  const due = agentsRunDueAt(lastRunAt);
  return due == null ? true : now >= due;
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
