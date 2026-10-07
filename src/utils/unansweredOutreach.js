// How many times you've emailed someone without hearing back.
//
// Drives the All Contacts "No Reply" column. Read off the same HubSpot email
// feed the Activity tab loads: for every person, count the emails you sent
// them after the last email they sent you. A reply resets the count to 0, so
// the number is "unanswered in a row", not a lifetime tally.
//
// A person is found two ways, because HubSpot logs mail two ways. A 1:1
// email carries the addresses in hs_email_to_email / hs_email_from_email;
// a one-to-many or sequence send logs with those blank and names its
// recipients only through the associated contact IDs (`_contactIds`, added
// by /api/hubspot?action=activity). So the index is kept both by address and
// by contact ID, and a contact's figure is the two merged.
//
// Direction follows the Activity tab's rule: a sender at @se.com (or the
// user's own work email) is you; any other sender is them; a blank sender
// falls back to HubSpot's hs_email_direction (INCOMING_EMAIL = received).
// Only the To line (or the association) counts as reaching out. Being cc'd
// on someone else's thread isn't an ask of that person.

// Bumped whenever the stored shape changes, so a page holding an index
// built by older code knows to rebuild it instead of reading it wrongly.
export const UNANSWERED_VERSION = 2;

function splitAddresses(raw) {
  return String(raw || '')
    .toLowerCase()
    .split(/[;,]/)
    .map(a => {
      const m = a.match(/<([^>]+)>/);
      return (m ? m[1] : a).trim();
    })
    .filter(Boolean);
}

export function emailDirection(e, workEmail = '') {
  const from = splitAddresses(e?.hs_email_from_email)[0] || '';
  const own = String(workEmail || '').toLowerCase().trim();
  if (from) return from.includes('@se.com') || (own && from === own) ? 'out' : 'in';
  const rawDir = String(e?.hs_email_direction || '').toUpperCase();
  if (rawDir === 'INCOMING_EMAIL') return 'in';
  return rawDir ? 'out' : '';
}

// emails: raw HubSpot email records. Returns
//   { v, byEmail: { addr: entry }, byId: { contactId: entry } }
// where entry = { sends: [tsMs...], lastReplyMs }. `sends` holds only the
// sends after that key's own last reply, so the index stays small; a key
// with a reply and nothing since keeps just its lastReplyMs, which the
// merge needs (an address reply can answer an association send).
export function buildUnansweredIndex(emails, workEmail = '') {
  const byEmail = {};
  const byId = {};
  const slot = (bucket, key) => (bucket[key] ||= { sends: [], lastReplyMs: 0 });
  for (const e of (emails || [])) {
    const subj = String(e?.hs_email_subject || '').toLowerCase();
    if (subj.includes('(sample email)')) continue;
    const tsMs = new Date(e?.hs_timestamp).getTime();
    if (!Number.isFinite(tsMs)) continue;
    const dir = emailDirection(e, workEmail);
    if (!dir) continue;
    const addrs = dir === 'out' ? splitAddresses(e.hs_email_to_email) : splitAddresses(e.hs_email_from_email).slice(0, 1);
    // Associations on an inbound mail can include everyone on the thread,
    // so only the sender's own address counts as the reply.
    const ids = dir === 'out' ? (e._contactIds || []).map(String) : [];
    const touch = (s) => {
      if (dir === 'out') s.sends.push(tsMs);
      else if (tsMs > s.lastReplyMs) s.lastReplyMs = tsMs;
    };
    for (const a of new Set(addrs)) touch(slot(byEmail, a));
    for (const id of new Set(ids)) touch(slot(byId, id));
  }
  const prune = (bucket) => {
    for (const [k, s] of Object.entries(bucket)) {
      s.sends = s.sends.filter(ms => ms > s.lastReplyMs);
      if (s.sends.length === 0 && !s.lastReplyMs) delete bucket[k];
    }
    return bucket;
  };
  return { v: UNANSWERED_VERSION, byEmail: prune(byEmail), byId: prune(byId) };
}

// One contact's figure from the index: { count, lastSentMs, lastReplyMs }.
// A send logged both ways (address and association) is the same email, so
// sends are de-duplicated by timestamp.
export function unansweredFor(index, { id, email } = {}) {
  if (!index) return null;
  const parts = [
    email ? index.byEmail?.[String(email).toLowerCase().trim()] : null,
    id ? index.byId?.[String(id)] : null,
  ].filter(Boolean);
  if (parts.length === 0) return { count: 0, lastSentMs: null, lastReplyMs: null };
  const lastReplyMs = Math.max(0, ...parts.map(p => p.lastReplyMs || 0));
  const sends = new Set();
  for (const p of parts) for (const ms of p.sends || []) if (ms > lastReplyMs) sends.add(ms);
  return {
    count: sends.size,
    lastSentMs: sends.size ? Math.max(...sends) : null,
    lastReplyMs: lastReplyMs || null,
  };
}
