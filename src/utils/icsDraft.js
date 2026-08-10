// Build an Outlook-openable meeting request (.ics). The Draft Emails page's
// "Dan's Drafts" tab uses this for the templates that are Outlook meetings
// rather than mails — double-clicking the downloaded file opens a meeting in
// Outlook with the attendees and dates already filled in, ready to send.

// RFC 5545 escaping for TEXT values: backslash, semicolon, comma and newline.
function escapeIcsText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Fold to the 75-octet line limit. Continuation lines start with a space.
function foldLine(line) {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) parts.push(' ' + rest);
  return parts.join('\r\n');
}

// 'YYYY-MM-DD' → 'YYYYMMDD'. All-day events use DATE values, so no timezone
// is involved and the date can't drift across the UTC boundary.
function toIcsDate(ymd) {
  return String(ymd || '').replace(/-/g, '');
}

// The exclusive DTEND an all-day event needs: the day after the last day off.
function nextDay(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// showAs maps to both the iCalendar TRANSP flag and the Outlook-specific
// busy status, since Outlook reads the latter.
const TRANSP = { FREE: 'TRANSPARENT', BUSY: 'OPAQUE', OOF: 'OPAQUE', TENTATIVE: 'OPAQUE' };

/**
 * @param {object} o
 * @param {string} o.subject           meeting subject
 * @param {string} [o.descriptionHtml] body HTML (also emitted as plain text)
 * @param {string} [o.location]
 * @param {{name?:string,email:string}} [o.organizer]
 * @param {Array<{name?:string,email:string}>} [o.attendees] required attendees
 * @param {Array<{name?:string,email:string}>} [o.optionalAttendees]
 * @param {string} o.startDate         'YYYY-MM-DD', first day
 * @param {string} o.endDate           'YYYY-MM-DD', last day (inclusive)
 * @param {'FREE'|'BUSY'|'OOF'|'TENTATIVE'} [o.showAs]
 * @param {number} [o.reminderMinutes] minutes before start; 0/null for none
 */
export function buildAllDayMeetingIcs({
  subject,
  descriptionHtml = '',
  location = '',
  organizer = null,
  attendees = [],
  optionalAttendees = [],
  startDate,
  endDate,
  showAs = 'FREE',
  reminderMinutes = 0,
}) {
  const last = endDate && endDate >= startDate ? endDate : startDate;
  const plain = String(descriptionHtml || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();

  const person = (prefix, r, extra = '') => {
    const cn = r.name ? `;CN="${String(r.name).replace(/"/g, '')}"` : '';
    return `${prefix}${cn}${extra}:mailto:${r.email}`;
  };

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prospect Tracker//Dan\'s Drafts//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid()}`,
    `DTSTAMP:${nowStamp()}`,
    `DTSTART;VALUE=DATE:${toIcsDate(startDate)}`,
    `DTEND;VALUE=DATE:${toIcsDate(nextDay(last))}`,
    `SUMMARY:${escapeIcsText(subject)}`,
    plain ? `DESCRIPTION:${escapeIcsText(plain)}` : null,
    location ? `LOCATION:${escapeIcsText(location)}` : null,
    organizer?.email ? person('ORGANIZER', organizer) : null,
    ...attendees.filter(a => a?.email).map(a =>
      person('ATTENDEE', a, ';ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE')),
    ...optionalAttendees.filter(a => a?.email).map(a =>
      person('ATTENDEE', a, ';ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE')),
    `TRANSP:${TRANSP[showAs] || 'OPAQUE'}`,
    `X-MICROSOFT-CDO-BUSYSTATUS:${showAs}`,
    'X-MICROSOFT-CDO-ALLDAYEVENT:TRUE',
    'X-MICROSOFT-CDO-INTENDEDSTATUS:' + showAs,
    'CLASS:PUBLIC',
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
  ].filter(Boolean);

  if (reminderMinutes > 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Reminder',
      `TRIGGER:-PT${reminderMinutes}M`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// Kick off a browser download for one generated file.
export function downloadFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
