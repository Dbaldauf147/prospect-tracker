// DST-correct recurrence for Weekly Report email schedules.
//
// The other digests (PE Opps, New Opps, Company News) recur on a fixed UTC
// hour via peOppsSchedule.computeNextRun. That is stable, but it is not the
// same wall-clock time all year: a schedule saved as "Monday 06:00" in a
// zone that observes DST arrives an hour early or late for half of it,
// because the UTC anchor cannot move when the zone's offset does.
//
// "Monday morning at 6" means six in the morning in both June and December,
// so this resolves each run against the user's stored IANA zone instead.
// Schedules saved before the zone was recorded fall back to the shared UTC
// math, which is exactly what they have always done.
//
// The shared helper is deliberately left alone: it is live for three other
// digests, and changing their send times is not this feature's business.

import { computeNextRun as computeNextRunUtc } from './peOppsSchedule.js';

function clamp(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// How far ahead of UTC `timeZone` is at this instant, in milliseconds.
function offsetAt(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return asUtc - utcMs;
}

// The instant at which `timeZone` reads y-mo-d hh:00 local. Iterates because
// the offset depends on the answer: the first guess uses the offset at the
// wrong instant, which is off by an hour across a DST boundary.
export function zonedToUtc(y, mo, d, hour, timeZone) {
  const wall = Date.UTC(y, mo, d, hour, 0, 0, 0);
  let guess = wall;
  for (let i = 0; i < 3; i += 1) {
    const next = wall - offsetAt(guess, timeZone);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

// The calendar date `timeZone` is on at this instant.
function localParts(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { y: Number(p.year), mo: Number(p.month) - 1, d: Number(p.day), dow: wd };
}

// Next run strictly after `from`, holding the user's local wall-clock time
// across DST. Falls back to the shared UTC math when no zone is stored.
export function computeNextRunZoned(schedule, from = Date.now()) {
  const timeZone = String(schedule?.timeZone || '').trim();
  if (!timeZone) return computeNextRunUtc(schedule, from);

  const hour = clamp(schedule.hourLocal, 0, 23, 6);
  const freq = schedule.frequency || 'weekly';

  // Everything that touches Intl sits inside the guard: a zone string
  // Intl doesn't recognise throws on the first call, and a schedule that
  // throws here would stop the whole cron run, not just its own send.
  try {
    const here = localParts(from, timeZone);
    if (freq === 'weekly') {
      const target = clamp(schedule.dayOfWeekLocal, 0, 6, 1);
      // At most 8 candidates: the matching weekday this week, and the next
      // one if that instant has already passed.
      for (let add = 0; add <= 8; add += 1) {
        const probe = Date.UTC(here.y, here.mo, here.d + add);
        const day = new Date(probe);
        const dow = (here.dow + add) % 7;
        if (dow !== target) continue;
        const t = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, timeZone);
        if (t > from) return t;
      }
      return computeNextRunUtc(schedule, from);
    }

    if (freq === 'monthly') {
      const dom = clamp(schedule.dayOfMonthLocal, 1, 28, 1);
      const thisMonth = zonedToUtc(here.y, here.mo, dom, hour, timeZone);
      if (thisMonth > from) return thisMonth;
      return zonedToUtc(here.y, here.mo + 1, dom, hour, timeZone);
    }

    // daily
    const today = zonedToUtc(here.y, here.mo, here.d, hour, timeZone);
    if (today > from) return today;
    return zonedToUtc(here.y, here.mo, here.d + 1, hour, timeZone);
  } catch {
    // An unrecognised zone string must not stop a schedule from recurring.
    return computeNextRunUtc(schedule, from);
  }
}
