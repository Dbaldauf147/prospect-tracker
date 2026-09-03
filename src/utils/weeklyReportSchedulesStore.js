// Client helpers for Weekly Report email schedules. CRUD goes through the
// authenticated /api/weekly-report-schedules route (admin SDK on the
// server) so the feature works without deploying client-side Firestore
// rules. The hourly cron (api/weekly-report-scheduler) reads the same
// collection.
//
// The recurrence math is in weeklyReportSchedule.js; this module is the
// network half.
//
// Deliberately a near-copy of peOppsSchedulesStore rather than a shared
// module: the two features' payloads differ (a report snapshot vs. opp
// rows) and keeping them separate means a change to one digest cannot
// quietly alter another's send behaviour.

import { apiFetch } from './apiFetch.js';
import { buildRecurrenceFields, normalizeRecipients } from './weeklyReportSchedule.js';

// The timezone math lives in weeklyReportSchedule.js so plain Node can test
// it; re-exported here so callers still import one module.
export {
  FREQUENCIES, WEEKDAYS, firstLocalRun, buildRecurrenceFields,
  describeSchedule, normalizeRecipients, isValidEmail, localTimeZone,
} from './weeklyReportSchedule.js';

async function call(action, payload = {}) {
  const res = await apiFetch('/api/weekly-report-schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Returns { schedules, snapshotAt } — the latter is when the tab last
// published, which the UI shows so a stale snapshot is visible before it
// turns into a stale email.
export async function listSchedules() {
  const data = await call('list');
  return { schedules: data.schedules || [], snapshotAt: data.snapshotAt || null };
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

// Publish what the tab is currently showing, so the cron has something to
// mail. Failures are the caller's to swallow: a snapshot that doesn't
// upload must never break the page the user is reading.
export async function publishSnapshot(snapshot) {
  await call('publishSnapshot', { snapshot });
}

export async function sendNow({ recipients, subject, message, snapshot }) {
  const res = await apiFetch('/api/weekly-report-send-now', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients, subject, message, snapshot }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
