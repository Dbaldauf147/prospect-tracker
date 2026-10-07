// How many times you've emailed someone without hearing back.
//
// Drives the All Contacts "No Reply" column. Read off the same HubSpot email
// feed the Activity tab loads: for every address, count the emails you sent
// to it after the last email it sent you. A reply resets the count to 0, so
// the number is "unanswered in a row", not a lifetime tally.
//
// Direction follows the Activity tab's rule: a sender at @se.com (or the
// user's own work email) is you; any other sender is them; a blank sender
// falls back to HubSpot's hs_email_direction (INCOMING_EMAIL = received).
// Only the To line counts as reaching out. Being cc'd on someone else's
// thread isn't an ask of that person.

function splitAddresses(raw) {
  return String(raw || '')
    .split(/[;,]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function emailDirection(e, workEmail = '') {
  const from = String(e?.hs_email_from_email || '').toLowerCase().trim();
  const own = String(workEmail || '').toLowerCase().trim();
  if (from) return from.includes('@se.com') || (own && from === own) ? 'out' : 'in';
  const rawDir = String(e?.hs_email_direction || '').toUpperCase();
  if (rawDir === 'INCOMING_EMAIL') return 'in';
  return rawDir ? 'out' : '';
}

// emails: raw HubSpot email records. Returns { [address]: { count, lastSentMs,
// lastReplyMs } } for every address with at least one unanswered email.
export function buildUnansweredIndex(emails, workEmail = '') {
  const sent = new Map();      // address -> [tsMs]
  const replied = new Map();   // address -> latest reply tsMs
  for (const e of (emails || [])) {
    const subj = String(e?.hs_email_subject || '').toLowerCase();
    if (subj.includes('(sample email)')) continue;
    const tsMs = new Date(e?.hs_timestamp).getTime();
    if (!Number.isFinite(tsMs)) continue;
    const dir = emailDirection(e, workEmail);
    if (dir === 'out') {
      for (const addr of new Set(splitAddresses(e.hs_email_to_email))) {
        if (!sent.has(addr)) sent.set(addr, []);
        sent.get(addr).push(tsMs);
      }
    } else if (dir === 'in') {
      for (const addr of splitAddresses(e.hs_email_from_email)) {
        if (tsMs > (replied.get(addr) || 0)) replied.set(addr, tsMs);
      }
    }
  }
  const out = {};
  for (const [addr, list] of sent) {
    const lastReplyMs = replied.get(addr) || 0;
    const after = list.filter(ms => ms > lastReplyMs);
    if (after.length === 0) continue;
    out[addr] = { count: after.length, lastSentMs: Math.max(...after), lastReplyMs: lastReplyMs || null };
  }
  return out;
}
