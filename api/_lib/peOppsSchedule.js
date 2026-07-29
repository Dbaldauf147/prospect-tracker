// Recurrence math for PE Opps scheduled emails. All scheduling is done
// in UTC; the client converts the user's chosen local hour to `hourUtc`
// at save time. This same logic is mirrored in
// src/utils/peOppsSchedulesStore.js so the client can show the next run.
//
// frequency:
//   'daily'   — every day at hourUtc
//   'weekly'  — on dayOfWeek (0=Sun … 6=Sat) at hourUtc
//   'monthly' — on dayOfMonth (1–28) at hourUtc

function clamp(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// Returns the epoch-millis of the next run strictly after `from`.
export function computeNextRun(schedule, from = Date.now()) {
  const hour = clamp(schedule.hourUtc, 0, 23, 13);
  const now = new Date(from);
  const freq = schedule.frequency || 'daily';

  if (freq === 'weekly') {
    const target = clamp(schedule.dayOfWeek, 0, 6, 1);
    let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0));
    const delta = (target - d.getUTCDay() + 7) % 7;
    d.setUTCDate(d.getUTCDate() + delta);
    if (d.getTime() <= from) d.setUTCDate(d.getUTCDate() + 7);
    return d.getTime();
  }

  if (freq === 'monthly') {
    const dom = clamp(schedule.dayOfMonth, 1, 28, 1);
    let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dom, hour, 0, 0, 0));
    if (d.getTime() <= from) d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, dom, hour, 0, 0, 0));
    return d.getTime();
  }

  // daily (default)
  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0));
  if (d.getTime() <= from) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}
