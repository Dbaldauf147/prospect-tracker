// Parser for Outlook day-view / daily agenda paste.
// Handles a range of formats: daily agenda emails, Outlook day view Ctrl+A copy,
// Teams/calendar exports. Output is an array of meeting objects:
// { start, end, startMinutes, endMinutes, subject, location, attendees[], body, raw }

const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([APap][Mm])?\b/;
// Matches a full range like "9:00 AM - 10:00 AM", "9–10 AM", "09:00-10:00"
const RANGE_RE = /^\s*(\d{1,2})(?::(\d{2}))?\s*([APap][Mm])?\s*[-–—to]{1,2}\s*(\d{1,2})(?::(\d{2}))?\s*([APap][Mm])?\s*$/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const ATTENDEE_LINE_HINT = /^(attendees?|required|optional|organizer|participants|invitees|with)\s*[:：]/i;
const LOCATION_LINE_HINT = /^(location|where|room)\s*[:：]/i;
const DAY_HEADER_RE = /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s*\w+\s+\d{1,2}(,?\s*\d{4})?$/i;
const ALL_DAY_RE = /^\s*all\s*day\s*$/i;

function toMinutes(h, m, ampm) {
  let hh = parseInt(h, 10);
  const mm = m ? parseInt(m, 10) : 0;
  if (ampm) {
    const ap = ampm.toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
  }
  return hh * 60 + mm;
}

function fmtTime(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Parse a full range line. Handles cases where the first time lacks AM/PM
// (Outlook sometimes writes "9 – 10 AM"). Infers AM/PM from the end time.
function parseRangeLine(line) {
  const m = line.match(RANGE_RE);
  if (!m) return null;
  let [, h1, m1, ap1, h2, m2, ap2] = m;
  if (!ap1 && ap2) ap1 = ap2;
  // If neither am/pm — assume AM.
  if (!ap1 && !ap2) { ap1 = 'AM'; ap2 = 'AM'; }
  if (!ap2 && ap1) ap2 = ap1;
  const start = toMinutes(h1, m1, ap1);
  let end = toMinutes(h2, m2, ap2);
  // Handle wrap (e.g., 11 AM – 1 PM where AM/PM implicit)
  if (end < start) end += 12 * 60;
  return { startMinutes: start, endMinutes: end, start: fmtTime(start), end: fmtTime(end) };
}

// Try to detect a standalone single-time line like "9:00 AM" followed by a
// separate end time on another line.
function parseSingleTime(line) {
  const trimmed = line.trim();
  const m = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*([APap][Mm])\s*$/);
  if (!m) return null;
  return toMinutes(m[1], m[2], m[3]);
}

// Split paste into meeting blocks. A block starts at a range line; everything
// until the next range line (or day header) is body for the current block.
function segmentBlocks(lines) {
  const blocks = [];
  let current = null;
  let singleStart = null;

  const flush = () => {
    if (current) { blocks.push(current); current = null; }
    singleStart = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (!trimmed) {
      // Blank line — don't flush aggressively, keep accumulating body. But if
      // the current block already has a subject, a blank line is a soft boundary.
      if (current?.lines.length) current.lines.push('');
      continue;
    }

    if (DAY_HEADER_RE.test(trimmed)) { flush(); continue; }
    if (ALL_DAY_RE.test(trimmed)) { continue; }

    const range = parseRangeLine(trimmed);
    if (range) {
      flush();
      current = { ...range, lines: [] };
      continue;
    }

    // "9:00 AM" alone, possibly followed by "10:00 AM" on next line.
    const single = parseSingleTime(trimmed);
    if (single != null && !current) {
      if (singleStart == null) { singleStart = single; continue; }
      const startM = singleStart;
      const endM = single < startM ? single + 12 * 60 : single;
      current = { startMinutes: startM, endMinutes: endM, start: fmtTime(startM), end: fmtTime(endM), lines: [] };
      singleStart = null;
      continue;
    }

    if (current) current.lines.push(trimmed);
    // Ignore non-meeting preamble lines
  }
  flush();
  return blocks;
}

function extractBlockDetails(block) {
  const body = block.lines.filter(Boolean);
  let subject = '';
  let location = '';
  const attendees = new Set();
  const bodyLeftover = [];

  // First non-hint line is the subject.
  for (const line of body) {
    if (!subject && !ATTENDEE_LINE_HINT.test(line) && !LOCATION_LINE_HINT.test(line) && !EMAIL_RE.test(line)) {
      subject = line;
      continue;
    }

    if (LOCATION_LINE_HINT.test(line)) {
      location = line.replace(LOCATION_LINE_HINT, '').trim();
      continue;
    }

    if (ATTENDEE_LINE_HINT.test(line)) {
      const rest = line.replace(ATTENDEE_LINE_HINT, '').trim();
      splitAttendees(rest).forEach(a => attendees.add(a));
      continue;
    }

    const emails = line.match(EMAIL_RE);
    if (emails) {
      // Line with emails — collect emails plus any preceding name tokens.
      splitAttendees(line).forEach(a => attendees.add(a));
      continue;
    }

    // Teams / conference hints often indicate location.
    if (!location && /microsoft teams|zoom\.us|webex|google meet|conference room|meeting room/i.test(line)) {
      location = line;
      continue;
    }

    bodyLeftover.push(line);
  }

  // If subject still empty but we collected body lines, first of those is subject.
  if (!subject && bodyLeftover.length) subject = bodyLeftover.shift();

  return {
    start: block.start,
    end: block.end,
    startMinutes: block.startMinutes,
    endMinutes: block.endMinutes,
    subject: subject || '(untitled meeting)',
    location,
    attendees: Array.from(attendees),
    body: bodyLeftover.join('\n'),
    raw: block.lines.join('\n'),
  };
}

function splitAttendees(text) {
  if (!text) return [];
  return text.split(/[;,\n]|\s+and\s+/i)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => s.length > 1);
}

export function parseOutlookAgenda(text) {
  if (!text || typeof text !== 'string') return [];
  // Normalise whitespace / non-breaking spaces that Outlook sometimes pastes.
  const normalized = text
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ');
  const lines = normalized.split('\n');
  const blocks = segmentBlocks(lines);
  return blocks
    .map(extractBlockDetails)
    .sort((a, b) => (a.startMinutes ?? 0) - (b.startMinutes ?? 0));
}

export function durationMinutes(meeting) {
  if (meeting.startMinutes == null || meeting.endMinutes == null) return null;
  return Math.max(0, meeting.endMinutes - meeting.startMinutes);
}

export { fmtTime };
