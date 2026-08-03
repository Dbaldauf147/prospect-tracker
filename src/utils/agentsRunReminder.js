// "Run the agent prompts" reminder — the Agents tab's prompts are meant to be
// run every couple of days, and nothing on screen said when they last were.
// The user marks a run with the "Agents Ran" button on the Agents page; that
// stamps a timestamp, and the reminder stays quiet until the interval is up.
//
// The stamp lives on the user's synced settings (`agentsLastRunAt`, an ISO
// string) rather than localStorage so the reminder follows the user across
// devices — running the prompts on the laptop shouldn't leave the desktop
// still nagging.

export const AGENTS_SETTINGS_KEY = 'agentsLastRunAt';
export const AGENTS_RUN_INTERVAL_DAYS = 2;

const MS_PER_DAY = 86400000;

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
  return last == null ? null : last + AGENTS_RUN_INTERVAL_DAYS * MS_PER_DAY;
}

// Is the reminder up? Never marked → yes, so the alert shows until the first
// run is recorded.
export function isAgentsRunDue(lastRunAt, now = Date.now()) {
  const due = agentsRunDueAt(lastRunAt);
  return due == null ? true : now >= due;
}

// Whole days since the last marked run (null when never marked), for the
// "last run N days ago" copy.
export function agentsDaysSinceRun(lastRunAt, now = Date.now()) {
  const last = agentsLastRunMs(lastRunAt);
  if (last == null) return null;
  return Math.max(0, Math.floor((now - last) / MS_PER_DAY));
}

// Whole days until the reminder next fires (0 = today, null when never
// marked), for the "next reminder in N days" copy.
export function agentsDaysUntilDue(lastRunAt, now = Date.now()) {
  const due = agentsRunDueAt(lastRunAt);
  if (due == null) return null;
  return Math.max(0, Math.ceil((due - now) / MS_PER_DAY));
}
