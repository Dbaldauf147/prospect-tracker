// The stored call records, as a history table.
//
// Every call that has ever reached this app is already saved — one
// `callRecordings` document per call, holding its transcript, its AI
// summary, and which company and opportunity it was tagged to. The cards
// on the Call Recordings page only show the calls the ACTIVE source can
// currently see: a Granola call is listed because it was synced, a
// OneDrive one only while that folder is connected. So a call whose
// folder was disconnected, or whose file was deleted, silently stopped
// being visible even though everything derived from it was still stored.
//
// This turns those records into rows — all of them, whatever they came
// from and whether or not that source is reachable now. It is the answer
// to "what calls have I had", which the cards were never asked to be.
//
// Everything here is pure: records in, rows out. No React, no Firestore,
// no clock except what a caller passes in.

// Extension included: this module is exercised under plain Node
// (scripts/callHistory.test.mjs), where extensionless specifiers don't
// resolve. Vite is happy either way.
import { talkTimeSplit } from './talkTime.js';
import { oppTagStateOf, oppTagLabelOf } from './callOppTag.js';

// How each source reads in the table. Kept here rather than in the view
// so the exported spreadsheet says the same words as the screen.
const SOURCE_LABELS = {
  granola: 'Granola',
  onedrive: 'OneDrive',
  local: 'This computer',
};

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || (source ? String(source) : 'Unknown');
}

function msOf(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * How far a call got through the pipeline, as one of four states.
 *
 * A call is only useful once there is text to read, and only finished
 * once that text has been summarised and filed onto the deal. Collapsing
 * that into one column is what makes the table scannable — the question
 * a history answers is "which of these still needs something doing".
 */
export function callStage(record) {
  if (record?.pushedToOppAt) return 'pushed';
  if (textOf(record?.summary)) return 'summarized';
  if (textOf(record?.transcript) || (record?.utterances || []).length > 0) return 'transcribed';
  return 'stored';
}

export const STAGE_LABELS = {
  stored: 'No transcript',
  transcribed: 'Transcribed',
  summarized: 'Summarized',
  pushed: 'Pushed to opp',
};

// Ranked so a sort on the column runs along the pipeline rather than
// alphabetically, which would put "Pushed to opp" between the two states
// that come before it.
export const STAGE_ORDER = { stored: 0, transcribed: 1, summarized: 2, pushed: 3 };

function domainOf(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase().trim() : '';
}

/**
 * Who was on the call, from the other side only.
 *
 * The note's owner tells us which domain is "us", so no domain is
 * hard-coded. With no owner on the record every attendee is kept — the
 * safe way round, since dropping the wrong ones would misreport who a
 * call was with.
 */
export function externalAttendees(record) {
  const attendees = Array.isArray(record?.attendees) ? record.attendees : [];
  const ownDomain = domainOf(record?.owner?.email);
  return ownDomain ? attendees.filter(a => domainOf(a?.email) !== ownDomain) : attendees;
}

/** One stored record → one history row, or null when it isn't a call. */
export function historyRowFromRecord(record) {
  if (!record?.id) return null;

  const external = externalAttendees(record);
  const recordedAt = record.recordedAt || null;
  const stage = callStage(record);
  // Derived on render from the turns already stored, so it cannot go
  // stale against the transcript it describes. Null when the turns were
  // dropped to fit Firestore — a flat transcript genuinely cannot say.
  const talk = talkTimeSplit(record.utterances);

  return {
    id: record.id,
    _record: record,
    name: textOf(record.name) || 'Untitled call',
    source: record.source || '',
    sourceLabel: sourceLabel(record.source),
    recordedAt,
    // Sorting on a date column needs a number; the raw value can be an
    // ISO string, or null on a record that never carried one.
    recordedAtMs: msOf(recordedAt),
    durationSeconds: Number.isFinite(Number(record.durationSeconds)) ? Number(record.durationSeconds) : null,
    company: textOf(record.company),
    oppLabel: textOf(record.oppLabel),
    oppId: textOf(record.oppId),
    // 'tagged' | 'na' | 'none'. Kept beside the label rather than folded
    // into it: the label is what a cell reads, this is what a filter and
    // a sort need, and "N/A" as a label must not be mistaken for the
    // name of an opportunity somebody called N/A.
    oppTag: oppTagStateOf(record),
    oppTagLabel: oppTagLabelOf(record),
    oppNaAt: textOf(record.oppNaAt),
    attendees: external.map(a => textOf(a?.name) || textOf(a?.email)).filter(Boolean).join(', '),
    attendeeEmails: external.map(a => textOf(a?.email)).filter(Boolean).join(', '),
    attendeeCount: external.length,
    meetingType: textOf(record.meetingType),
    stage,
    stageLabel: STAGE_LABELS[stage],
    stageRank: STAGE_ORDER[stage] ?? 0,
    hasTranscript: !!(textOf(record.transcript) || (record.utterances || []).length > 0),
    // The turns were dropped to fit the document, so the transcript is
    // there but the per-speaker detail derived from it is not.
    transcriptTrimmed: !!record.utterancesDropped,
    summary: textOf(record.summary),
    granolaSummary: textOf(record.granolaSummary),
    talkBasis: talk?.basis || '',
    youShare: talk?.youShare ?? null,
    granolaUrl: textOf(record.granolaUrl),
    folders: Array.isArray(record.folders) ? record.folders.join(', ') : '',
    pushedToOppAt: record.pushedToOppAt || null,
    summarizedAt: record.summarizedAt || null,
    syncedAt: record.syncedAt || null,
  };
}

/**
 * Every stored call as a row, newest first.
 *
 * Records with no date sort to the end rather than being dropped: an
 * undated call is still a call that happened, and hiding it here would
 * repeat the disappearance this table exists to fix.
 */
export function callHistoryRows(records) {
  const list = Array.isArray(records) ? records : Object.values(records || {});
  return list
    .map(historyRowFromRecord)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.recordedAtMs == null && b.recordedAtMs == null) return a.name.localeCompare(b.name);
      if (a.recordedAtMs == null) return 1;
      if (b.recordedAtMs == null) return -1;
      return b.recordedAtMs - a.recordedAtMs;
    });
}

/** Free-text filter across everything a row shows. */
export function filterHistoryRows(rows, query) {
  const term = String(query || '').trim().toLowerCase();
  if (!term) return rows || [];
  return (rows || []).filter(row => [
    row.name, row.company, row.oppLabel, row.oppTagLabel, row.attendees, row.attendeeEmails,
    row.sourceLabel, row.stageLabel, row.meetingType, row.folders,
    row.summary, row.granolaSummary,
  ].filter(Boolean).join(' ').toLowerCase().includes(term));
}

/**
 * The counts above the table: how many calls, and how far through the
 * pipeline they got. `withCompany` is the one worth acting on — an
 * untagged call can't have its summary pushed anywhere.
 */
export function historyTotals(rows) {
  const list = rows || [];
  const totals = {
    calls: list.length,
    transcribed: 0,
    summarized: 0,
    pushed: 0,
    withCompany: 0,
    // Calls with neither an opp nor an N/A on them — the queue, and the
    // only one of these numbers that names work still to do.
    needsOppTag: 0,
    durationSeconds: 0,
  };
  for (const row of list) {
    if (row.hasTranscript) totals.transcribed += 1;
    if (row.oppTag === 'none') totals.needsOppTag += 1;
    // Cumulative, not exclusive: a pushed call has been summarised, and
    // a count that said otherwise would read as work still to do.
    if (row.stageRank >= STAGE_ORDER.summarized) totals.summarized += 1;
    if (row.stageRank >= STAGE_ORDER.pushed) totals.pushed += 1;
    if (row.company) totals.withCompany += 1;
    if (Number.isFinite(row.durationSeconds) && row.durationSeconds > 0) {
      totals.durationSeconds += row.durationSeconds;
    }
  }
  return totals;
}

// ---- local cache ------------------------------------------------------

/**
 * A row trimmed to what it takes to redraw the table, for storing in the
 * browser.
 *
 * The full record hanging off `_record` carries the transcript and its
 * speaker turns, which are most of a call's bytes and none of what the
 * history shows — the expansion needs the summary, key items, follow-ups
 * and next steps, all of which are already on the row or are kept here.
 * Dropping the rest is what keeps a cache of years of calls small enough
 * to read back instantly.
 */
export function trimRowForCache(row) {
  if (!row) return null;
  const rec = row._record || {};
  return {
    ...row,
    _record: {
      keyItems: Array.isArray(rec.keyItems) ? rec.keyItems : [],
      followUps: Array.isArray(rec.followUps) ? rec.followUps : [],
      nextSteps: typeof rec.nextSteps === 'string' ? rec.nextSteps : '',
    },
  };
}

export function cacheableHistoryRows(rows) {
  return (rows || []).map(trimRowForCache).filter(Boolean);
}

/**
 * Should this freshly-built set of rows replace what is cached?
 *
 * The one case that must never happen is a failed Firestore read — which
 * comes back as zero records — wiping a good cache and leaving the page
 * claiming you have no calls. So a read that did not succeed never
 * writes, and a successful one only writes an EMPTY list when the cache
 * is empty too: going from "50 calls" to "none" is the shape of a
 * failure, not of a user deleting fifty calls one at a time.
 */
export function shouldReplaceCache({ ok, rowCount, cachedCount }) {
  if (!ok) return false;
  if (rowCount > 0) return true;
  return !cachedCount;
}
