// The stored calls, as pickable talk-time breakdowns.
//
// The talk-time split already existed in two places: a bar on the card
// you happen to be looking at, and one "You spoke" column in the history
// table. Neither answers the question a rep actually asks — "on THAT
// call, how much of it was me" — because the card requires the call to be
// visible in the active source and the column gives one number with
// nothing behind it.
//
// This turns every stored call into a row that carries its whole split,
// so a view can list the calls, let one be picked, and show who did the
// talking without going back to Firestore.
//
// Calls with no transcript at all are left out: there is nothing to
// divide, and a row that could never be measured is noise in a list whose
// entire job is picking something to measure. Calls that HAVE a
// transcript but can't be split stay in, carrying the reason — a call
// silently missing from this list would read as a call that never
// happened.
//
// Everything here is pure: records in, rows out. No React, no Firestore.

// Extension included so this resolves under plain Node for the tests.
import { talkTimeSplit } from './talkTime.js';
import { sourceLabel, externalAttendees } from './callHistory.js';

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function msOf(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * Why a transcribed call still has no split, as one of four causes.
 *
 * Each has a different remedy, which is the only reason to distinguish
 * them: the user can re-sync a flat transcript, but no amount of
 * re-syncing will name the speakers on a call Granola never labelled.
 */
export const BLOCKED_REASONS = {
  'turns-dropped': 'The transcript was too long to store its speaker turns, so who spoke when wasn’t kept.',
  'no-turns': 'This transcript arrived as one block of text with no speaker turns. Re-syncing the call may bring them back.',
  unmeasurable: 'The speaker turns on this call carry no text and no timings, so there is nothing to divide.',
  'you-unknown': 'None of the turns on this call are attributed to you, so your share can’t be separated from the rest.',
};

/** One stored record → one breakdown row, or null when it can't be one. */
export function breakdownRowFromRecord(record) {
  if (!record?.id) return null;

  const utterances = Array.isArray(record.utterances) ? record.utterances : [];
  const hasTranscript = !!(textOf(record.transcript) || utterances.length > 0);
  // Nothing was ever transcribed: not a call this list can be about.
  if (!hasTranscript) return null;

  // Derived from the stored turns on every read, so it can never go stale
  // against the transcript it describes.
  const split = talkTimeSplit(utterances);
  const blocked = split
    ? (split.youShare == null ? 'you-unknown' : '')
    : record.utterancesDropped
      ? 'turns-dropped'
      : utterances.length > 0 ? 'unmeasurable' : 'no-turns';

  const external = externalAttendees(record);
  const recordedAt = record.recordedAt || null;

  return {
    id: record.id,
    name: textOf(record.name) || 'Untitled call',
    recordedAt,
    recordedAtMs: msOf(recordedAt),
    durationSeconds: Number.isFinite(Number(record.durationSeconds)) ? Number(record.durationSeconds) : null,
    company: textOf(record.company),
    oppLabel: textOf(record.oppLabel),
    source: record.source || '',
    sourceLabel: sourceLabel(record.source),
    attendees: external.map(a => textOf(a?.name) || textOf(a?.email)).filter(Boolean).join(', '),
    meetingType: textOf(record.meetingType),
    granolaUrl: textOf(record.granolaUrl),
    split,
    basis: split?.basis || '',
    youShare: split?.youShare ?? null,
    speakerCount: split?.speakers.length || 0,
    // The me-versus-them question can be answered for this call.
    measurable: !!split && split.youShare != null,
    blocked,
    blockedReason: blocked ? BLOCKED_REASONS[blocked] : '',
  };
}

/**
 * Every transcribed call as a breakdown row, newest first.
 *
 * Undated calls sort to the end rather than being dropped — an undated
 * call still has a transcript, and a split is exactly as valid without a
 * date on it.
 */
export function callBreakdownRows(records) {
  const list = Array.isArray(records) ? records : Object.values(records || {});
  return list
    .map(breakdownRowFromRecord)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.recordedAtMs == null && b.recordedAtMs == null) return a.name.localeCompare(b.name);
      if (a.recordedAtMs == null) return 1;
      if (b.recordedAtMs == null) return -1;
      return b.recordedAtMs - a.recordedAtMs;
    });
}

/** Free-text filter over what the picker list shows. */
export function filterBreakdownRows(rows, query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return rows || [];
  return (rows || []).filter(row => [
    row.name, row.company, row.oppLabel, row.attendees, row.sourceLabel, row.meetingType,
  ].filter(Boolean).join(' ').toLowerCase().includes(term));
}

/**
 * How the picked call compares with the rest: the mean of the user's
 * share across the calls that could be measured.
 *
 * Time-based and word-based splits are NEVER averaged together — they are
 * different measurements, and a mean of the two would be a number about
 * nothing. Time wins when any call has it, and `otherBasis` reports how
 * many calls were left out so the average can say what it covers.
 *
 *   { calls, measurable, basis, avgYouShare, averaged, otherBasis }
 */
export function breakdownAverages(rows) {
  const list = rows || [];
  const measurable = list.filter(r => r.measurable);
  const timed = measurable.filter(r => r.basis === 'time');
  const worded = measurable.filter(r => r.basis === 'words');
  const used = timed.length > 0 ? timed : worded;

  return {
    calls: list.length,
    measurable: measurable.length,
    basis: used.length > 0 ? (timed.length > 0 ? 'time' : 'words') : '',
    avgYouShare: used.length > 0
      ? used.reduce((t, r) => t + r.youShare, 0) / used.length
      : null,
    averaged: used.length,
    // Measurable calls held out of the average because they were measured
    // the other way. Zero whenever every call agrees.
    otherBasis: timed.length > 0 ? worded.length : 0,
  };
}
