// Client helpers for Company Acquisition News email schedules. CRUD goes
// through the authenticated /api/company-news-schedules route (admin SDK on
// the server) so the feature works without deploying client-side Firestore
// rules. The hourly cron (api/company-news-scheduler) reads the same
// collection.
//
// Scheduling is anchored in UTC. The user picks a *local* hour/day in the
// UI; we resolve the first concrete run instant in local time, then derive
// the UTC recurrence fields (hourUtc / dayOfWeek / dayOfMonth) from that
// same instant so the server's recurrence math (api/_lib/peOppsSchedule,
// shared with the PE Opps digest) lines up with what the user intended.

import { apiFetch } from './apiFetch';

export const FREQUENCIES = ['daily', 'weekly', 'monthly'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function call(action, payload = {}) {
  const res = await apiFetch('/api/company-news-schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// First concrete run at/after `from`, computed in the browser's local
// timezone, as a Date.
export function firstLocalRun({ frequency, hourLocal, dayOfWeekLocal, dayOfMonthLocal }, from = new Date()) {
  const hour = clamp(hourLocal, 0, 23, 9);
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
  // daily
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

// Build the persisted recurrence fields from the user's local choices.
export function buildRecurrenceFields(local) {
  const first = firstLocalRun(local);
  return {
    frequency: local.frequency,
    hourLocal: clamp(local.hourLocal, 0, 23, 9),
    dayOfWeekLocal: local.frequency === 'weekly' ? clamp(local.dayOfWeekLocal, 0, 6, 1) : null,
    dayOfMonthLocal: local.frequency === 'monthly' ? clamp(local.dayOfMonthLocal, 1, 28, 1) : null,
    // UTC anchors derived from the first concrete instant.
    hourUtc: first.getUTCHours(),
    dayOfWeek: first.getUTCDay(),
    dayOfMonth: Math.min(first.getUTCDate(), 28),
    nextRunAt: first.getTime(),
  };
}

export function describeSchedule(s) {
  const time = `${String(s.hourLocal ?? 9).padStart(2, '0')}:00`;
  if (s.frequency === 'weekly') return `Weekly · ${WEEKDAYS[s.dayOfWeekLocal ?? 1]} at ${time}`;
  if (s.frequency === 'monthly') return `Monthly · day ${s.dayOfMonthLocal ?? 1} at ${time}`;
  return `Daily at ${time}`;
}

export async function listSchedules() {
  const data = await call('list');
  return data.schedules || [];
}

export async function createSchedule(input) {
  const schedule = {
    ...input,
    ...buildRecurrenceFields(input),
    recipients: normalizeRecipients(input.recipients),
  };
  const data = await call('create', { schedule });
  return data.id;
}

export async function updateSchedule(id, input) {
  const schedule = {
    ...input,
    ...buildRecurrenceFields(input),
    recipients: normalizeRecipients(input.recipients),
  };
  await call('update', { id, schedule });
}

export async function setEnabled(id, enabled) {
  await call('setEnabled', { id, enabled: !!enabled });
}

export async function removeSchedule(id) {
  await call('delete', { id });
}

// One-off send. `scheduleId` reuses a saved schedule's recipients/subject/
// message; otherwise pass them explicitly. `lookbackDays` overrides the
// window for a test send.
export async function sendNow({ scheduleId, recipients, subject, message, lookbackDays }) {
  const res = await apiFetch('/api/company-news-send-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scheduleId, recipients, subject, message, lookbackDays }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Send failed (${res.status})`);
  return data;
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

function clamp(n, lo, hi, dflt) {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
