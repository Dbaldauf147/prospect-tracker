// Reading a delivery-failure notice ("bounce"): is this one, which address
// did it fail for, and why. Pure, shared by the inbox scan
// (api/outlook-bounces.js) and its tests.
//
// The address comes out of the notice's own words, not from who sent it.
// A bounce is sent by a system mailbox that may sit on the recipient's
// domain (noreply@nationwide.com) or on our own (postmaster@mimecast.se.com,
// the outbound filter), so guessing the recipient from the sender's domain
// gets it wrong exactly when the filter is ours. Every mail system writes
// the failed address into the text in one of a handful of ways; a notice
// that names none is left alone rather than guessed at.
import { classifyAutoReply } from './autoReply.js';

// Subjects the shared auto-reply rules don't cover yet, and senders that
// only ever send these.
const EXTRA_SUBJECTS = [
  /^\s*your message (?:couldn'?t|could not|wasn'?t|was not) be(?:en)? delivered/i,
  /^\s*(?:message|mail) (?:not delivered|delivery failed)/i,
  /^\s*undelivered mail returned to sender/i,
  /^\s*failure notice\b/i,
];

/** Is this message (subject, from address) a delivery-failure notice? */
export function isBounceNotice({ subject = '', from = '' } = {}) {
  if (classifyAutoReply({ hs_email_subject: subject, hs_email_from_email: from }) === 'bounce') return true;
  return EXTRA_SUBJECTS.some(re => re.test(String(subject)));
}

const ADDR = '([A-Za-z0-9._%+\'-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})';
// Each names the failed address in a sentence a mail system writes.
const PATTERNS = [
  new RegExp(`message to\\s*<?${ADDR}>?\\s*was undeliverable`, 'gi'),
  new RegExp(`message you sent to\\s*<?${ADDR}>?\\s*(?:couldn'?t|could not|wasn'?t|was not) be(?:en)? delivered`, 'gi'),
  new RegExp(`(?:couldn'?t|could not|wasn'?t|was not) be(?:en)? delivered to\\s*<?${ADDR}`, 'gi'),
  new RegExp(`delivery has failed to these recipients or groups:\\s*(?:[^<\\n]*<)?${ADDR}`, 'gi'),
  new RegExp(`(?:final|original)-recipient:\\s*rfc822;\\s*<?${ADDR}`, 'gi'),
  new RegExp(`<${ADDR}>\\s*:?\\s*(?:recipient address rejected|user unknown|mailbox (?:unavailable|not found)|does not exist|no such user)`, 'gi'),
  new RegExp(`${ADDR}\\s*(?:<[^>]*>)?\\s*\\(?(?:user unknown|recipient address rejected|mailbox unavailable)`, 'gi'),
];
const SYSTEM_LOCAL = /^(?:postmaster|mailer-daemon|no-?reply|do-?not-?reply|bounces?)$/i;

/**
 * The failed addresses a notice names, lowercased, each once. `exclude` is
 * addresses never to return (the mailbox's own).
 */
export function bouncedAddresses(text, { exclude = [] } = {}) {
  const skip = new Set((exclude || []).map(e => String(e || '').trim().toLowerCase()).filter(Boolean));
  const out = [];
  const body = String(text || '');
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(body))) {
      const addr = m[1].toLowerCase().replace(/[.;,]+$/, '');
      if (skip.has(addr) || SYSTEM_LOCAL.test(addr.split('@')[0]) || out.includes(addr)) continue;
      out.push(addr);
    }
  }
  return out;
}

/** The notice's one-line reason, when it gives one ('' otherwise). */
export function bounceReason(text) {
  const body = String(text || '').replace(/\r/g, '');
  const tidy = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 200);
  let m = body.match(/reason for the problem:\s*([\s\S]{0,300})/i);
  if (m) return tidy(m[1].split(/\n\s*\n|\[|For more information/i)[0]);
  m = body.match(/couldn'?t be delivered due to:\s*([^\n]+)/i);
  if (m) return tidy(m[1]);
  m = body.match(/\b(5\.\d\.\d+[^\n]{0,180})/);
  if (m) return tidy(m[1].split(/For more information/i)[0]);
  return '';
}
