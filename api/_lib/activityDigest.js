// A contact's activity history, boiled down to one line per email, meeting,
// note, call or task: when, what kind, and its subject. Read out of a saved
// HubSpot backup (hubspotBackup.js) so the history can travel to a portal
// that only takes file imports, where activities themselves can't be
// imported and the history goes in as a contact field instead.
//
// Pure, so it runs under plain Node in scripts/activityDigest.test.mjs.

// The backup's engagement types, and what each line calls it.
export const ACTIVITY_TYPES = ['emails', 'meetings', 'calls', 'notes', 'tasks', 'communications'];

const SUBJECT_MAX = 120;

function plain(html) {
  return String(html || '')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function cut(s, max = SUBJECT_MAX) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 3).trimEnd()}...` : t;
}

// When it happened, as ms. hs_timestamp is the activity's own time; the
// record's createdAt is the fallback.
function whenOf(rec) {
  const raw = rec?.properties?.hs_timestamp || rec?.createdAt || '';
  const n = /^\d+$/.test(String(raw)) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(n) ? n : 0;
}

/** The kind and subject of one engagement record. */
export function describeActivity(type, rec) {
  const p = rec?.properties || {};
  if (type === 'emails') {
    const dir = String(p.hs_email_direction || '').toUpperCase();
    const kind = dir === 'INCOMING_EMAIL' ? 'Email received' : dir === 'FORWARDED_EMAIL' ? 'Email forwarded' : 'Email sent';
    return { kind, subject: cut(p.hs_email_subject) || '(no subject)' };
  }
  if (type === 'meetings') return { kind: 'Meeting', subject: cut(p.hs_meeting_title) || '(untitled)' };
  if (type === 'calls') return { kind: 'Call', subject: cut(p.hs_call_title || plain(p.hs_call_body)) || '(no title)' };
  if (type === 'tasks') return { kind: 'Task', subject: cut(p.hs_task_subject) || '(no subject)' };
  // A note has no subject; its first words stand in for one.
  if (type === 'notes') return { kind: 'Note', subject: cut(plain(p.hs_note_body), 80) || '(empty)' };
  const channel = String(p.hs_communication_channel_type || '').replace(/_/g, ' ').toLowerCase();
  return { kind: channel ? `Message (${channel})` : 'Message', subject: cut(plain(p.hs_communication_body), 80) || '(empty)' };
}

/**
 * One backup part file's records as digest entries:
 *   [[contactId, whenMs, kind, subject], ...]
 * one per contact the activity is associated with. An activity linked to no
 * contact has nobody to land on and is skipped.
 */
export function digestRecords(type, records) {
  const out = [];
  for (const rec of records || []) {
    const contacts = rec?.associations?.contacts || [];
    if (!contacts.length) continue;
    const { kind, subject } = describeActivity(type, rec);
    const when = whenOf(rec);
    for (const c of contacts) {
      const id = String(c?.id || '');
      if (id) out.push([id, when, kind, subject]);
    }
  }
  return out;
}
