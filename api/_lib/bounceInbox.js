// Bounce notices Dan forwards to the app's Gmail mailbox, read for the
// address each one failed for (api/_lib/bounceAddress.js), so the app can
// flag it as a bad email (src/utils/badEmails.js).
//
// The forwarding address is the app mailbox's "+bounces" alias
// (GMAIL_USER with +bounces before the @: Gmail delivers it to the same
// mailbox). A Gmail filter on that address files the mail under
// BOUNCE_LABEL, and this reads only that label, the way the HubSpot export
// and newsletter readers do (newsletterInbox.openGmailLabel): never INBOX,
// and only mail from an allowed sender (Dan's work address, as for the
// export), so nobody else can flag an address by mailing the alias.
//
// A forwarded notice carries the original's text in its body, or the
// original itself as an attachment (Outlook's "Forward as attachment"); both
// are read. A forward that names no failed address is skipped, not guessed.
import { openGmailLabel } from './newsletterInbox.js';
import { exportSenders, isExportSender } from './hubspotExportGmail.js';
import { bouncedAddresses, bounceReason } from './bounceAddress.js';

export const DEFAULT_BOUNCE_LABEL = 'bounce-notices';
export const BOUNCE_ALIAS = 'bounces';
const MAX_DAYS = 120;

export function bounceLabel(env = process.env) {
  return String(env.BOUNCE_LABEL || '').trim() || DEFAULT_BOUNCE_LABEL;
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

/**
 * The bounces in the label from the last `days` days:
 * [{ address, at, subject, reason, messageId }]. Throws an Error with a
 * `status` when the mailbox or the label can't be opened.
 */
export async function fetchForwardedBounces({
  user = process.env.GMAIL_USER,
  pass = process.env.GMAIL_APP_PASSWORD,
  label = bounceLabel(),
  allowed = exportSenders(),
  days = 30,
  connect = openGmailLabel,
  now = () => Date.now(),
} = {}) {
  if (!user || !pass) throw Object.assign(new Error('Gmail is not configured on the server (GMAIL_USER and GMAIL_APP_PASSWORD).'), { status: 500 });
  let session;
  try {
    session = await connect({ user, pass, label });
  } catch (err) {
    const why = String(err?.message || err).slice(0, 160);
    throw Object.assign(new Error(/not found/i.test(why)
      ? `The Gmail label "${label}" doesn't exist yet in ${user}. Create it, and a filter that puts mail to ${bounceForwardAddress(user)} under it.`
      : `Couldn't open the Gmail mailbox: ${why}`), { status: 502 });
  }
  // Never flag the forwarder or the app's own mailbox.
  const exclude = [user, bounceForwardAddress(user), ...allowed.filter(a => a.includes('@'))];
  const bounces = [];
  let read = 0;
  try {
    const since = new Date(now() - Math.min(Math.max(1, days), MAX_DAYS) * 864e5);
    for await (const m of session.messages(since)) {
      if (!isExportSender(m.from, allowed)) continue;
      read += 1;
      const text = forwardedText(m);
      const reason = bounceReason(text);
      const at = new Date(Number(m.date) || now()).toISOString();
      for (const address of bouncedAddresses(text, { exclude })) {
        bounces.push({ address, at, subject: String(m.subject || '').replace(/^\s*((fwd?|fw)\s*:\s*)+/i, ''), reason, messageId: m.messageId || '' });
      }
    }
  } finally {
    try { await session.close(); } catch { /* already closed */ }
  }
  return { bounces, read };
}
