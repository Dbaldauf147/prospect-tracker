// Outlook Sent Items → the Sent Log tab.
//
// ---- What this replaces --------------------------------------------------
// Email activity used to be logged by HubSpot, via an Outlook add-in that
// auto-BCC'd every send to a HubSpot address. The BCC is not the feature;
// it is the workaround a third party needs because it cannot see the
// mailbox. This app can: the Microsoft Graph sign-in it already uses for
// Draft Emails asks for Mail.ReadWrite, which covers reading Sent Items.
// So the log is built from the folder directly, with no BCC, no add-in
// and no rule to maintain.
//
// What that buys over the BCC, beyond dropping the vendor:
//   - mail sent from a phone or from Outlook on the web is logged too,
//     because the folder is the folder wherever the send came from;
//   - the first read backfills history instead of starting from the day
//     the habit began;
//   - a forgotten BCC cannot silently lose a week of activity.
//
// What it does not do is opens and clicks. Those need a pixel in the body
// at send time, which is the app's own tracking path (api/_lib/tracking.js
// and the Email Tracking tab). A Sent Log row is the record that a mail
// went out, which is exactly what the BCC gave and no more.
//
// Pure mapping - no fetch, no React - so the rules that decide what counts
// as activity stay testable (scripts/outlookSent.test.mjs).

// The user's own company. A mail whose only recipients are here went to
// colleagues, and is not outreach. Same rule the Activity page, the
// Agenda page and the calendar mapper already apply.
export const INTERNAL_EMAIL_DOMAIN = 'se.com';

// Mail providers whose domain says nothing about who somebody works for,
// so a row from one of these is not attributed to a company invented out
// of the domain name.
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
  'mac.com', 'comcast.net', 'verizon.net', 'sbcglobal.net', 'att.net',
  'protonmail.com', 'proton.me', 'mail.com', 'gmx.com', 'zoho.com',
]);

export function domainOf(email) {
  const at = String(email || '').lastIndexOf('@');
  return at >= 0 ? String(email).slice(at + 1).toLowerCase().trim() : '';
}

export function isInternal(email, internalDomain = INTERNAL_EMAIL_DOMAIN) {
  const domain = domainOf(email);
  if (!domain || !internalDomain) return false;
  return domain === internalDomain || domain.endsWith(`.${internalDomain}`);
}

export function isFreeMail(email) {
  return FREE_MAIL.has(domainOf(email));
}

/** An ISO instant, or null when the value isn't a real moment. */
function isoOf(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
}

function personOf(entry) {
  const email = String(entry?.email || '').trim();
  const name = String(entry?.name || '').trim();
  if (!email && !name) return null;
  return { name, email };
}

function label(person) {
  return person?.name || person?.email || '';
}

/**
 * One Sent Items message (as /api/outlook-sent normalises it) → a Sent Log
 * row, or null when it has no usable send time.
 *
 * Nothing is dropped here for looking unimportant. A mail to colleagues, a
 * one-line reply, a message with no external recipient at all: they were
 * all sent, and a log that quietly omits them is a log that disagrees with
 * Outlook. `_internalOnly` is carried instead, so a caller that wants to
 * hide them can, and the count it hid is still knowable.
 *
 * BCC is carried as a COUNT, never as addresses. Graph returns the field
 * to the mailbox owner, but a blind copy is blind on purpose, and a log
 * that reprints the list on screen undoes that the first time somebody
 * shares it.
 */
export function sentRowFromMessage(message, { internalDomain = INTERNAL_EMAIL_DOMAIN } = {}) {
  if (!message) return null;
  const sentAt = isoOf(message.sentAt);
  if (!sentAt) return null;

  const to = (Array.isArray(message.to) ? message.to : []).map(personOf).filter(Boolean);
  const cc = (Array.isArray(message.cc) ? message.cc : []).map(personOf).filter(Boolean);
  const bccCount = (Array.isArray(message.bcc) ? message.bcc : []).length;

  const everyone = [...to, ...cc];
  const external = everyone.filter(p => p.email && !isInternal(p.email, internalDomain));
  const externalTo = to.filter(p => p.email && !isInternal(p.email, internalDomain));

  return {
    // Graph ids are long and opaque but stable, which is what a React key
    // and the dedupe below both want. The prefix keeps them from ever
    // colliding with a tracking id or a calendar row.
    id: message.id ? `outlook-sent:${message.id}` : '',
    _type: 'sent',
    _source: 'outlook-sent',
    _subject: String(message.subject || '').trim() || '(No subject)',
    _timestamp: sentAt,
    _sentAt: sentAt,
    _to: externalTo.map(label).filter(Boolean).join(', '),
    _toDetails: externalTo,
    _cc: cc.filter(p => p.email && !isInternal(p.email, internalDomain)).map(label).filter(Boolean).join(', '),
    _ccDetails: cc,
    // A number, not a list. See the note above.
    _bccCount: bccCount,
    _recipients: external.map(p => p.email.toLowerCase()),
    _recipientCount: external.length,
    // Everyone on the mail including colleagues, so a row can say "and 4
    // others" without the internal ones vanishing from the count.
    _allRecipientCount: everyone.length + bccCount,
    _preview: String(message.preview || '').replace(/\s+/g, ' ').trim(),
    _hasAttachments: !!message.hasAttachments,
    // A mail with colleagues on it and nobody else. Not the same as a mail
    // with no recipients, and the log says which.
    _internalOnly: everyone.length > 0 && external.length === 0,
    _conversationId: String(message.conversationId || ''),
    // Filled in by the page from its own domain → company index, the same
    // way Activity rows are.
    _company: '',
  };
}

/**
 * Every sent message that describes a send, newest first.
 *
 * Graph can hand back the same message twice across a page boundary when
 * the folder is written to mid-read, which is normal for a mailbox in use.
 * They collapse on the message id.
 */
export function sentRowsFromMessages(messages, options = {}) {
  const rows = [];
  const seen = new Set();
  for (const message of (Array.isArray(messages) ? messages : [])) {
    const row = sentRowFromMessage(message, options);
    if (!row) continue;
    const key = row.id || `${row._sentAt}|${row._subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows.sort((a, b) => new Date(b._sentAt).getTime() - new Date(a._sentAt).getTime());
}

/**
 * Sent rows rolled up per external recipient: who was emailed, how often,
 * and when last.
 *
 * This is the half of the HubSpot BCC that was actually read day to day.
 * Nobody scrolled the log; they looked at a contact and asked when it last
 * heard from them. Sorted by how long ago that was, longest first, so the
 * top of the list is the part of the book going cold.
 */
export function recipientRollup(rows) {
  const byEmail = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    if (!row || row._internalOnly) continue;
    for (const person of [...(row._toDetails || []), ...(row._ccDetails || [])]) {
      const email = String(person?.email || '').toLowerCase().trim();
      if (!email || isInternal(email)) continue;
      const existing = byEmail.get(email);
      const sentMs = new Date(row._sentAt).getTime();
      if (!existing) {
        byEmail.set(email, {
          email,
          name: person.name || '',
          company: row._company || '',
          count: 1,
          lastSentAt: row._sentAt,
          lastSubject: row._subject,
        });
        continue;
      }
      existing.count += 1;
      if (!existing.name && person.name) existing.name = person.name;
      if (!existing.company && row._company) existing.company = row._company;
      if (sentMs > new Date(existing.lastSentAt).getTime()) {
        existing.lastSentAt = row._sentAt;
        existing.lastSubject = row._subject;
      }
    }
  }
  return [...byEmail.values()].sort(
    (a, b) => new Date(a.lastSentAt).getTime() - new Date(b.lastSentAt).getTime(),
  );
}

/**
 * Narrow the log to what the page is asking for.
 *
 * `query` matches a subject, a recipient name, a recipient address or the
 * company the row was attributed to, so one box searches the row rather
 * than one field of it.
 */
export function filterSentRows(rows, { query = '', includeInternal = false } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter(row => {
    if (!row) return false;
    if (!includeInternal && row._internalOnly) return false;
    if (!q) return true;
    const haystack = [
      row._subject,
      row._to,
      row._cc,
      row._company,
      row._preview,
      ...(row._recipients || []),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

/** How many days ago an instant was, rounded down. Null when unreadable. */
export function daysAgo(iso, now = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  return Math.max(0, Math.floor((now - t) / (24 * 60 * 60 * 1000)));
}

/**
 * What the tab says about its Outlook connection, as one sentence, or ''
 * when the connection needs no explaining.
 *
 * These states all render as an empty log, and telling them apart is the
 * difference between "sign in" and "you sent nothing that week":
 *
 *   - never connected: nothing has ever been fetched;
 *   - token expired: Graph tokens last about an hour, so a page left open
 *     overnight is the normal case rather than an error;
 *   - connected and read, but everything in the window was internal;
 *   - connected and read, and the folder really was empty.
 */
export function describeOutlookSent({
  connected = false, expired = false, loaded = false,
  messages = 0, shown = 0, rangeLabel = 'the last 30 days',
} = {}) {
  if (!connected) return 'Outlook is not connected. Use Connect Outlook to read your Sent Items: it is the same sign-in the Drafts tab uses.';
  if (expired) return 'Your Outlook sign-in has expired. Use Reconnect Outlook to sign in again, it lasts about an hour.';
  if (!loaded) return '';
  if (messages === 0) return `Outlook returned no sent mail for this window (${rangeLabel}).`;
  if (shown === 0) return `Outlook has ${messages} sent message${messages === 1 ? '' : 's'} in ${rangeLabel}, all of them to colleagues only.`;
  return '';
}
