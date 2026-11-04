// How long the opp's main contact takes to come back to us, logged on the
// opp so it has a history.
//
// The starred contact is the first name in the opp's Contact list (the
// star just moves a name to the front). Every time the opp's "Last Client
// Heard From Us" date moves on, an entry lands in `_heardFromLog`:
//
//   { date,        ISO day we heard from them
//     contact,     the starred contact at that moment
//     gapDays,     calendar days since the entry before (null for the first)
//     stage,       the opp's Stage then
//     oppAgeDays,  days since the opp's Start Date then (null without one)
//     loggedAt }   when the entry was written (ISO timestamp)
//
// Kept oldest first. The heard-from date that was on the opp before the
// first logged change is kept as the opening entry (source: 'existing'),
// so the very first gap can be measured. A second change on the same day
// replaces that day's entry rather than adding one: that is a correction
// (a mistyped date), not the contact writing twice. Clearing the date logs
// nothing and keeps the history.
//
// This is the raw material for a later "how likely is this to close" read
// (time since we last heard, the usual gap, the stage and the opp's age);
// the entries carry all four so that can be worked out from the log alone.
//
// Pure, so scripts/contactResponse.test.mjs can assert it without a browser.

import { toISODate } from './oppsCallIn.js';

export const HEARD_FROM_FIELD = 'Last Client Heard From Us';
export const HEARD_FROM_LOG = '_heardFromLog';

/** The starred (first) contact on an opp, or '' when there is none. */
export function primaryContactOf(row) {
  return String(row?.Contact ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] || '';
}

const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / 86400000);

function cleanLog(row) {
  const raw = Array.isArray(row?.[HEARD_FROM_LOG]) ? row[HEARD_FROM_LOG] : [];
  return raw.filter(e => e && toISODate(e.date)).map(e => ({ ...e, date: toISODate(e.date) }));
}

// Re-derive every gap from the dates, oldest first, so an entry slotted in
// out of order (a back-dated heard-from) leaves the gaps right.
function withGaps(entries) {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.map((e, i) => ({ ...e, gapDays: i === 0 ? null : daysBetween(sorted[i - 1].date, e.date) }));
}

const ageOn = (row, iso) => {
  const start = toISODate(row?.['Start Date']);
  return start ? Math.max(0, daysBetween(start, iso)) : null;
};

/**
 * The log the opp should carry once `next` replaces `prev`, or null when
 * the edit doesn't touch it (the heard-from date didn't move to a new day,
 * or was cleared).
 *   now   Date for the loggedAt stamp and the same-day correction test
 */
export function nextHeardFromLog(prev, next, { now = new Date() } = {}) {
  const before = toISODate(prev?.[HEARD_FROM_FIELD]);
  const after = toISODate(next?.[HEARD_FROM_FIELD]);
  if (!after || after === before) return null;
  const stamp = now.toISOString();
  const today = stamp.slice(0, 10);
  let log = cleanLog(prev);
  if (!log.length && before) {
    log.push({ date: before, contact: primaryContactOf(prev), stage: String(prev?.Stage ?? '').trim(), oppAgeDays: ageOn(prev, before), loggedAt: stamp, source: 'existing' });
  }
  // A same-day re-edit corrects the entry it made rather than adding one.
  const last = log[log.length - 1];
  if (last && last.source !== 'existing' && String(last.loggedAt || '').slice(0, 10) === today && last.date === before) {
    log = log.slice(0, -1);
  }
  // Already logged for that day (heard from them twice on one date): keep one.
  log = log.filter(e => e.date !== after);
  log.push({ date: after, contact: primaryContactOf(next), stage: String(next?.Stage ?? '').trim(), oppAgeDays: ageOn(next, after), loggedAt: stamp });
  return withGaps(log);
}

/** Apply nextHeardFromLog to a row being built: returns the row, logged. */
export function withHeardFromLog(prev, next, opts) {
  const log = nextHeardFromLog(prev, next, opts);
  return log ? { ...next, [HEARD_FROM_LOG]: log } : next;
}

/**
 * What the opp popup shows about it:
 *   { contact, lastHeard, daysSince, entries, gaps, medianGap, lastGap }
 * `entries` newest first. With no log yet, the opp's heard-from date
 * stands in as a one-entry history so the days-since still reads.
 */
export function contactResponseSummary(row, { nowMs = Date.now() } = {}) {
  let entries = withGaps(cleanLog(row));
  const current = toISODate(row?.[HEARD_FROM_FIELD]);
  if (!entries.length && current) {
    entries = [{ date: current, contact: primaryContactOf(row), stage: String(row?.Stage ?? '').trim(), oppAgeDays: ageOn(row, current), gapDays: null, source: 'existing' }];
  }
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const lastHeard = entries.length ? entries[entries.length - 1].date : null;
  const gaps = entries.map(e => e.gapDays).filter(g => typeof g === 'number');
  const sorted = [...gaps].sort((a, b) => a - b);
  const medianGap = sorted.length
    ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : null;
  return {
    contact: primaryContactOf(row),
    lastHeard,
    daysSince: lastHeard ? Math.max(0, daysBetween(lastHeard, today)) : null,
    entries: [...entries].reverse(),
    gaps,
    medianGap,
    lastGap: gaps.length ? gaps[gaps.length - 1] : null,
  };
}
