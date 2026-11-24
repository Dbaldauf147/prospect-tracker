// Bounce notices Dan forwards to the app's Gmail mailbox, read for the
// address each one failed for (api/_lib/bounceAddress.js), so the app can
// flag it as a bad email (src/utils/badEmails.js).
//
// The forwarding address is the app mailbox's "+bounces" alias
// (GMAIL_USER with +bounces before the @: Gmail delivers it to the same
// mailbox). A Gmail filter on that address files the mail under
// BOUNCE_LABEL, and this reads only the labels named there, the way the
// HubSpot export and newsletter readers do (newsletterInbox.openGmailLabel):
// never INBOX, and only mail from an allowed sender (Dan's work address, as
// for the export), so nobody else can flag an address by mailing the alias.
//
// Two labels by default: bounce-notices, and "Schneider Emails", the folder
// Dan's work mail is filed under (skipping the inbox), so a notice that
// reached the mailbox without the +bounces filter catching it is still read.
// A message under both is read once. A label that doesn't exist is passed
// over as long as one of them opens.
//
// A forwarded notice carries the original's text in its body, or the
// original itself as an attachment (Outlook's "Forward as attachment"); both
// are read. A forward that names no failed address is skipped, not guessed.
import { openGmailLabel } from './newsletterInbox.js';
import { exportSenders, isExportSender } from './hubspotExportGmail.js';
import { bouncedAddresses, bounceReason, isBounceNotice } from './bounceAddress.js';

export const DEFAULT_BOUNCE_LABEL = 'bounce-notices';
export const DEFAULT_BOUNCE_LABELS = [DEFAULT_BOUNCE_LABEL, 'Schneider Emails'];
export const BOUNCE_ALIAS = 'bounces';
const MAX_DAYS = 120;

/** The labels to read: BOUNCE_LABEL (comma-separated), else the defaults. */
export function bounceLabels(env = process.env) {
  const named = String(env.BOUNCE_LABEL || '').split(',').map(s => s.trim()).filter(Boolean);
  return named.length ? [...new Set(named)] : DEFAULT_BOUNCE_LABELS;
}

/** The address to forward bounce notices to: GMAIL_USER's +bounces alias. */
export function bounceForwardAddress(user = process.env.GMAIL_USER) {
  const u = String(user || '').trim();
  const at = u.lastIndexOf('@');
  if (at <= 0) return '';
  const local = u.slice(0, at).split('+')[0];
  return `${local}+${BOUNCE_ALIAS}@${u.slice(at + 1)}`;
}

const stripHtml = (h) => String(h || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/[ \t]+/g, ' ');

// The readable text of a forwarded message: its body, plus any attached
// original (an .eml / message/rfc822, or plain text) as text.
export function forwardedText(m) {
  const parts = [m?.text || stripHtml(m?.html)];
  for (const a of m?.attachments || []) {
    const name = String(a?.filename || '').toLowerCase();
    const type = String(a?.contentType || '').toLowerCase();
    const isMail = name.endsWith('.eml') || type.includes('message/rfc822') || type.startsWith('text/');
    if (!isMail || !a.content || a.content.length > 2_000_000) continue;
    const raw = Buffer.from(a.content).toString('utf8');
    parts.push(type.includes('html') ? stripHtml(raw) : raw);
  }
  return parts.join('\n');
}

const bareSubject = (s) => String(s || '').replace(/^\s*((fwd?|fw)\s*:\s*)+/i, '');

/**
 * The bounces in the labels from the last `days` days:
 * { bounces: [{ address, at, subject, reason, messageId }], read, skipped,
 *   unread, labels, missing }.
 * `read` is the forwards from an allowed sender, `skipped` the mail from
 * anybody else, `unread` the subjects of forwards that read as a delivery
 * failure but name no address this could find (so a notice in a wording
 * not handled yet shows up instead of vanishing), `labels` the labels
 * opened and `missing` the ones that couldn't be. Throws an Error with a
 * `status` when the mailbox or every label can't be opened.
 */
export async function fetchForwardedBounces({
  user = process.env.GMAIL_USER,
  pass = process.env.GMAIL_APP_PASSWORD,
  label,
  labels = label ? [label] : bounceLabels(),
  allowed = exportSenders(),
  days = 30,
  connect = openGmailLabel,
  now = () => Date.now(),
} = {}) {
  if (!user || !pass) throw Object.assign(new Error('Gmail is not configured on the server (GMAIL_USER and GMAIL_APP_PASSWORD).'), { status: 500 });
  // Never flag the forwarder or the app's own mailbox.
  const exclude = [user, bounceForwardAddress(user), ...allowed.filter(a => a.includes('@'))];
  const since = new Date(now() - Math.min(Math.max(1, days), MAX_DAYS) * 864e5);
  const bounces = [];
  const unread = [];
  const opened = [];
  const missing = [];
  const seen = new Set();
  let read = 0;
  let skipped = 0;
  let firstError = null;
  for (const name of labels) {
    let session;
    try {
      session = await connect({ user, pass, label: name });
    } catch (err) {
      const why = String(err?.message || err).slice(0, 160);
      const notFound = /not found/i.test(why);
      firstError = firstError || Object.assign(new Error(notFound
        ? `The Gmail label "${name}" doesn't exist yet in ${user}. Create it, and a filter that puts mail to ${bounceForwardAddress(user)} under it.`
        : `Couldn't open the Gmail mailbox: ${why}`), { status: 502 });
      missing.push(name);
      // A wrong password or an unreachable mailbox fails for every label.
      if (!notFound) break;
      continue;
    }
    opened.push(name);
    try {
      for await (const m of session.messages(since)) {
        // The same message under two labels is one notice.
        const id = m.messageId || `${m.from}|${m.date}|${m.subject}`;
        if (seen.has(id)) continue;
        seen.add(id);
        if (!isExportSender(m.from, allowed)) { skipped += 1; continue; }
        read += 1;
        const text = forwardedText(m);
        const reason = bounceReason(text);
        const at = new Date(Number(m.date) || now()).toISOString();
        const subject = bareSubject(m.subject);
        const found = bouncedAddresses(text, { exclude });
        for (const address of found) bounces.push({ address, at, subject, reason, messageId: m.messageId || '' });
        if (!found.length && isBounceNotice({ subject }) && unread.length < 20) unread.push(subject.slice(0, 120));
      }
    } finally {
      try { await session.close(); } catch { /* already closed */ }
    }
  }
  if (!opened.length) throw firstError;
  return { bounces, read, skipped, unread, labels: opened, missing };
}
