// Pure recurrence math for Weekly Report email schedules — no Firebase, no
// fetch, so it is importable from plain Node and covered by
// scripts/weeklyReportSchedule.test.mjs.
//
// Scheduling is anchored in UTC. The user picks a *local* hour/day in the
// UI; we resolve the first concrete run instant in local time, then derive
// the UTC recurrence fields (hourUtc / dayOfWeek / dayOfMonth) from that
// same instant, so the server's recurrence math
// (api/_lib/peOppsSchedule.computeNextRun, shared with the other digests)
// lines up with what the user intended. Picking "Monday 06:00" west of
// Greenwich stores a Monday-or-Tuesday UTC anchor accordingly — the point
// is that the derived instant, not the literal day name, is what recurs.

export const FREQUENCIES = ['daily', 'weekly', 'monthly'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clamp(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// First concrete run at/after `from`, computed in the browser's local
// timezone, as a Date.
export function firstLocalRun({ frequency, hourLocal, dayOfWeekLocal, dayOfMonthLocal }, from = new Date()) {
  const hour = clamp(hourLocal, 0, 23, 6);
  const d = new Date(from);
  d.setHours(hour, 0, 0, 0);

  if (frequency === 'weekly') {
    const target = clamp(dayOfWeekLocal, 0, 6, 1);
    const delta = (target - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + delta);
    if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 7);
    return d;
  }
  if (frequency === 'monthly') {
    const dom = clamp(dayOfMonthLocal, 1, 28, 1);
    d.setDate(dom);
    if (d.getTime() <= from.getTime()) d.setMonth(d.getMonth() + 1);
    return d;
  }
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

// Build the persisted recurrence fields from the user's local choices.
export function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
  catch { return ''; }
}

export function buildRecurrenceFields(local, from = new Date()) {
  const first = firstLocalRun(local, from);
  return {
    // The zone the hour was chosen in. api/_lib/weeklyReportSchedule uses
    // it to hold that wall-clock hour across DST; the hourUtc/dayOfWeek
    // anchors below remain the fallback when it is absent.
    timeZone: local.timeZone || localTimeZone(),
    frequency: local.frequency,
    hourLocal: clamp(local.hourLocal, 0, 23, 6),
    dayOfWeekLocal: local.frequency === 'weekly' ? clamp(local.dayOfWeekLocal, 0, 6, 1) : null,
    dayOfMonthLocal: local.frequency === 'monthly' ? clamp(local.dayOfMonthLocal, 1, 28, 1) : null,
    hourUtc: first.getUTCHours(),
    dayOfWeek: first.getUTCDay(),
    dayOfMonth: Math.min(first.getUTCDate(), 28),
    nextRunAt: first.getTime(),
  };
}

export function describeSchedule(s) {
  const time = `${String(s.hourLocal ?? 6).padStart(2, '0')}:00`;
  if (s.frequency === 'weekly') return `Weekly · ${WEEKDAYS[s.dayOfWeekLocal ?? 1]} at ${time}`;
  if (s.frequency === 'monthly') return `Monthly · day ${s.dayOfMonthLocal ?? 1} at ${time}`;
  return `Daily at ${time}`;
}

export function normalizeRecipients(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw || '').split(/[,;\n]/);
  const seen = new Set();
  const out = [];
  for (const e of arr) {
    const v = String(e || '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export function isValidEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
}
