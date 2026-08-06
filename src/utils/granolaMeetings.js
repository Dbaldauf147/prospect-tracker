// Granola notes → meetings on the Activity page.
//
// Granola sits in the meetings on the user's calendar and writes a note
// for each one, which makes the notes it has synced a usable mirror of
// that calendar — and one we already hold, since the Call Recordings
// page stores every note as a `callRecordings` record. This module turns
// those records into the meeting rows the Activity page renders, and
// reconciles them with the meetings the page already gets from HubSpot
// and from the Outlook webhook.
//
// Everything here is pure: no fetch, no Firestore, no React. The record
// goes in, a row comes out. That keeps the reconciliation rules — the
// part most likely to be wrong about somebody's real calendar — testable
// on their own (scripts/granolaMeetings.test.mjs).

// Sources ranked by how authoritative they are about the CALENDAR. The
// Outlook webhook is the calendar itself; HubSpot holds meetings logged
// against a deal; Granola is a notetaker that happened to be invited. So
// when the same meeting arrives from more than one, the calendar's copy
// is the row and the others fill in its blanks.
const SOURCE_RANK = { outlook: 0, hubspot: 1, granola: 2 };

// How far apart two copies of "the same meeting" may start. Calendar
// sources stamp the scheduled start; Granola stamps the event it joined,
// which can be a few minutes off when a meeting is moved in place or the
// note is created after the fact.
const SAME_MEETING_WINDOW_MS = 15 * 60 * 1000;

function domainOf(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase().trim() : '';
}

function msOf(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** End of a meeting from its start plus a duration, when it has one. */
function endFromDuration(start, durationSeconds) {
  const startMs = msOf(start);
  const secs = Number(durationSeconds);
  if (startMs == null || !Number.isFinite(secs) || secs <= 0) return null;
  return new Date(startMs + secs * 1000).toISOString();
}

/**
 * One stored Granola record → an Activity meeting row, or null when the
 * record has no usable time on it.
 *
 * A note with no calendar event behind it (an ad-hoc call, a voice memo)
 * still becomes a row: it happened, it has attendees, and it belongs on
 * an activity feed. What it doesn't get is an invented end time.
 */
export function meetingFromRecord(record) {
  if (!record) return null;
  const event = record.calendarEvent || null;
  const start = event?.start || record.recordedAt || null;
  if (msOf(start) == null) return null;

  const end = event?.end || endFromDuration(start, record.durationSeconds);
  const attendees = Array.isArray(record.attendees) ? record.attendees : [];

  // Colleagues aren't who the meeting was WITH. The note's owner tells
  // us which domain is "us" without hard-coding one; with no owner on
  // the record every attendee stays, which is the safe way round.
  const ownDomain = domainOf(record.owner?.email);
  const external = ownDomain
    ? attendees.filter(a => domainOf(a?.email) !== ownDomain)
    : attendees;

  const durationSeconds = Number(record.durationSeconds);
  const startMs = msOf(start);
  const endMs = msOf(end);
  const durationMs = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds * 1000
    : (startMs != null && endMs != null && endMs > startMs ? endMs - startMs : null);

  return {
    id: record.id || (record.granolaNoteId ? `granola:${record.granolaNoteId}` : ''),
    _type: 'meeting',
    _source: 'granola',
    _subject: event?.title || record.name || 'Granola call',
    _timestamp: start,
    _meetingStart: start,
    _meetingEnd: end,
    _location: event?.location || event?.conferenceUrl || '',
    _attendees: external.map(a => a?.name || a?.email).filter(Boolean).join(', '),
    _attendeeDetails: external,
    _attendeeCount: external.length,
    // An internal meeting, not a meeting nobody was in. The page says so
    // rather than showing "No attendees" over a room full of colleagues.
    _internalOnly: attendees.length > 0 && external.length === 0,
    _externalEmails: external.map(a => String(a?.email || '').toLowerCase()).filter(Boolean),
    // Whatever the Call Recordings page matched this call to. Blank when
    // it never matched, which the Activity page fills from its own
    // domain → company index.
    _company: record.company || '',
    _granolaUrl: record.granolaUrl || '',
    _granolaSummary: record.granolaSummary || '',
    _organizer: event?.organizer || record.owner || null,
    _duration: durationMs,
    _direction: '',
    _status: '',
    _to: external.map(a => a?.email).filter(Boolean).join(', '),
    _toName: '',
    _from: '',
    _fromName: '',
    _cc: '',
  };
}

function granolaRecordList(records) {
  const list = Array.isArray(records) ? records : Object.values(records || {});
  return list.filter(r => r?.source === 'granola');
}

/** Every stored Granola record that describes a meeting, newest first. */
export function granolaMeetingsFromRecords(records) {
  return granolaRecordList(records)
    .map(meetingFromRecord)
    .filter(Boolean)
    .sort((a, b) => msOf(b._meetingStart) - msOf(a._meetingStart));
}

/**
 * The stored Granola records that could NOT become a meeting row, because
 * nothing on them parses as a start time.
 *
 * `granolaMeetingsFromRecords` drops these silently, which is right for
 * rendering and wrong for explaining. diagnoseEmptySync covers the case
 * where Granola returned nothing; this covers the one after it — notes
 * that arrived, stored fine, and still produced no row. Without it that
 * failure reads as an empty calendar, which is the one reading that
 * points the user nowhere.
 */
export function undatedGranolaRecords(records) {
  return granolaRecordList(records).filter(r => meetingFromRecord(r) == null);
}

// Titles are compared with the noise stripped: calendar clients prepend
// their own markers, and Granola drops them. What's left has to match
// exactly or contain the other, so two genuinely different meetings that
// start at the same minute stay two rows.
function titleKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^(canceled|cancelled|updated|fw|fwd|re|accepted|declined|tentative):\s*/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titlesMatch(a, b) {
  const ka = titleKey(a);
  const kb = titleKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const [longer, shorter] = ka.length >= kb.length ? [ka, kb] : [kb, ka];
  return shorter.length >= 6 && longer.includes(shorter);
}

/** Are these two rows the same real-world meeting seen from two sources? */
export function isSameMeeting(a, b) {
  if (a?._source === b?._source) return false;
  const ta = msOf(a?._meetingStart);
  const tb = msOf(b?._meetingStart);
  if (ta == null || tb == null) return false;
  if (Math.abs(ta - tb) > SAME_MEETING_WINDOW_MS) return false;
  return titlesMatch(a._subject, b._subject);
}

// Fields a lower-ranked source may fill in on the surviving row, but
// never overwrite. Granola's note link is the reason this merge exists:
// without it the calendar row and the notes for that meeting would sit
// on the page as two separate things.
const FILLABLE = [
  '_location', '_company', '_granolaUrl', '_granolaSummary',
  '_meetingEnd', '_duration', '_organizer',
];

/**
 * Collapse the same meeting seen from several sources into one row.
 *
 * The highest-ranked source keeps the row (it is the one the user's
 * calendar agrees with); every other copy donates whatever the row is
 * missing and is dropped. `_sources` records who contributed, so the
 * page can badge a row as coming from more than one place.
 *
 * A meeting only one source knows about passes through untouched — this
 * never drops anything, it only ever merges duplicates.
 */
export function mergeMeetings(rows) {
  const byRank = [...(rows || [])].filter(Boolean).sort(
    (a, b) => (SOURCE_RANK[a._source] ?? 99) - (SOURCE_RANK[b._source] ?? 99),
  );

  const merged = [];
  for (const row of byRank) {
    const target = merged.find(m => isSameMeeting(m, row));
    if (!target) {
      merged.push({ ...row, _sources: [row._source].filter(Boolean) });
      continue;
    }
    if (row._source && !target._sources.includes(row._source)) target._sources.push(row._source);
    for (const field of FILLABLE) {
      if (!target[field] && row[field]) target[field] = row[field];
    }
    if (!target._attendeeDetails?.length && row._attendeeDetails?.length) {
      target._attendeeDetails = row._attendeeDetails;
    }
    if (!target._attendees && row._attendees) target._attendees = row._attendees;
  }

  return merged.sort((a, b) => (msOf(a._meetingStart) ?? 0) - (msOf(b._meetingStart) ?? 0));
}

/**
 * The window covering today and the `days - 1` days before it, as local
 * calendar days: `days: 1` is today, `days: 7` is this day last week
 * through tonight.
 *
 * Built by walking the date rather than subtracting 24-hour blocks, so a
 * window spanning a daylight-saving change still starts at midnight
 * instead of at 23:00 the evening before.
 *
 * The window ends at the end of TODAY. These are meetings that have
 * happened or are about to; a longer look back is not an invitation to
 * start showing next week.
 */
export function rangeForDays(days, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today);
  end.setDate(end.getDate() + 1);
  const start = new Date(today);
  start.setDate(start.getDate() - Math.max(0, (Number(days) || 1) - 1));
  return { start: start.getTime(), end: end.getTime() };
}

/**
 * The window covering today and the `days` days after it — today through
 * the end of next week for `days: 7`.
 *
 * The mirror of rangeForDays, and it exists because a calendar is read in
 * both directions. Every source the panel had until Outlook was connected
 * could only describe meetings that had already happened, so a forward
 * window would have been an empty one; the calendar itself knows what is
 * coming, and that is most of what a calendar is for.
 *
 * It starts at the top of TODAY rather than at `now` — a meeting you are
 * sitting in has already started, and dropping it off the list the minute
 * it begins is the one moment it matters most.
 *
 * Walks the date like rangeForDays does, so a window spanning a
 * daylight-saving change still ends at midnight.
 */
export function rangeForUpcoming(days, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today);
  end.setDate(end.getDate() + Math.max(0, Number(days) || 0) + 1);
  return { start: today.getTime(), end: end.getTime() };
}

/** The rows that start inside `{ start, end }`. */
export function meetingsInRange(rows, { start, end } = {}) {
  return (rows || []).filter((r) => {
    const t = msOf(r?._meetingStart);
    return t != null && (start == null || t >= start) && (end == null || t < end);
  });
}

/**
 * Why the Granola meeting count is what it is, as one sentence — or ''
 * when the count needs no explaining.
 *
 * This is NOT diagnoseEmptySync's job. That one explains a fetch that
 * came back with nothing, and it can only speak while an import is
 * running in this session. Two very common states fall outside it and
 * were, until now, completely silent:
 *
 *   - a fresh page load with nothing stored, where no import has run at
 *     all, so nothing has anything to report;
 *   - meetings stored and visible in the data, but none inside the day
 *     range the panel is currently showing.
 *
 * Both render as "0 meetings / No meetings scheduled for today", which
 * is indistinguishable from a broken import. Naming them is the whole
 * point of this function.
 *
 * `imported` is { seen } from an import that ran this session, or null.
 *
 * `rangeName` names the window the panel is showing, carrying its own
 * preposition ("today", "in the last 7 days", "in the next 7 days"). The
 * default describes a look-back, which is all this could describe before
 * the panel could look forward.
 */
export function describeGranolaMeetings({
  total = 0, inRange = 0, undated = 0, imported = null,
  rangeDays = 1, windowDays = 30, syncedAt = '', rangeName = '',
} = {}) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // Carries its own preposition: "none today" but "none IN the last 7
  // days", and the two read as one phrase at the call site.
  const windowName = rangeName || (rangeDays === 1 ? 'today' : `in the last ${rangeDays} days`);

  // Nothing stored and nothing undated. Either no import has ever run,
  // or every one of them came back empty — and the user can only act on
  // the first, so say which it is.
  if (total === 0 && undated === 0) {
    if (imported) {
      // An import ran this session and saw notes, yet none became a
      // meeting. diagnoseEmptySync covers seen === 0; this is the case
      // after it.
      return imported.seen > 0
        ? `Granola returned ${plural(imported.seen, 'note')}, but none of them describe a meeting.`
        : '';
    }
    return syncedAt
      ? 'Nothing is stored from Granola. The last import brought back no meetings: use ↻ Granola to try again.'
      : 'Nothing has been imported from Granola yet: use ↻ Granola.';
  }

  const parts = [];
  if (total > 0 && inRange === 0) {
    // The commonest benign cause of an empty panel once the import
    // works, and the one the range buttons fix in a click.
    parts.push(`Granola has ${plural(total, 'meeting')} in the last ${windowDays} days, none ${windowName}`);
  }
  if (undated > 0) {
    parts.push(`${plural(undated, 'note')} had no readable date and could not be placed`);
  }
  return parts.length ? `${parts.join('; ')}.` : '';
}

/** The rows that start inside the local day containing `now`. */
export function meetingsOnDay(rows, now = new Date()) {
  return meetingsInRange(rows, rangeForDays(1, now));
}

/**
 * Rows bucketed into local calendar days — most recent day first, and
 * each day's meetings in the order they happened.
 *
 * That order is deliberate: the day is read forwards, the way a calendar
 * shows it, but the list of days is read backwards, because a look back
 * starts from what just happened.
 *
 * `order: 'asc'` flips the days, which is what a forward window wants:
 * looking ahead starts from today and runs into next week, and a
 * "coming up" list that opened on the furthest day would be read bottom
 * to top.
 */
export function groupMeetingsByDay(rows, { order = 'desc' } = {}) {
  const buckets = new Map();
  for (const row of (rows || [])) {
    const t = msOf(row?._meetingStart);
    if (t == null) continue;
    const at = new Date(t);
    const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    if (!buckets.has(dayStart)) buckets.set(dayStart, { dayStart, meetings: [] });
    buckets.get(dayStart).meetings.push(row);
  }
  const byDay = order === 'asc'
    ? (a, b) => a.dayStart - b.dayStart
    : (a, b) => b.dayStart - a.dayStart;
  return [...buckets.values()]
    .sort(byDay)
    .map(group => ({
      ...group,
      meetings: group.meetings.sort((a, b) => (msOf(a._meetingStart) ?? 0) - (msOf(b._meetingStart) ?? 0)),
    }));
}
