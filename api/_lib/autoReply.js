// Telling the three kinds of machine-generated reply apart.
//
// A campaign's incoming mail is not all replies. Some of it is a mail server
// saying the address is dead, and some is the recipient's assistant saying
// they're on leave until the 14th. Both were already being detected — and both
// were then thrown into one `autoRepliesSuppressed` counter and forgotten,
// which loses the two most actionable things in the pile:
//
//   • a bounce is an address to fix, and every future send to it is wasted
//   • an out-of-office is a date to send again on, and a non-answer that
//     isn't a no
//
// So the same patterns now return WHICH kind they matched. The union of what
// they suppress is unchanged by design — no reply count moves because of this
// — they are only sorted.
//
// HubSpot doesn't surface RFC 'Auto-Submitted' headers, so the evidence is
// still just the subject line (where every major mail server stamps its
// prefix) and the from address (where system mailboxes give themselves away).

// Delivery failures. Checked first: a bounce notification can carry the
// original "Automatic reply" subject inside its own, and it is the more
// important of the two to get right.
const BOUNCE_SUBJECT_PATTERNS = [
  /^\s*undeliverable:?\b/i,
  /^\s*delivery (?:status notification|failure|notification|has failed)/i,
  /^\s*returned mail\b/i,
  /^\s*mail delivery (?:failed|subsystem|failure)/i,
  /^\s*postmaster\b/i,
  /\bbounce notification\b/i,
];
const BOUNCE_FROM_PATTERNS = [
  /^postmaster@/i,
  /^mailer-daemon@/i,
  /^bounce[s]?@/i,
];

// The recipient's own auto-responder: out of office, on leave, vacation.
const OOO_SUBJECT_PATTERNS = [
  /^\s*(?:re:\s*)?automatic reply\b/i,
  /^\s*(?:re:\s*)?auto[\s-]?reply\b/i,
  /^\s*(?:re:\s*)?auto[\s-]?response\b/i,
  /^\s*(?:re:\s*)?out of (?:the )?office\b/i,
  /^\s*(?:re:\s*)?ooo\b/i,
  /^\s*(?:re:\s*)?(?:i am |i'm )?away from (?:the )?office\b/i,
  /^\s*(?:re:\s*)?(?:i am |i'm )?on (?:vacation|leave|holiday|pto|parental leave|maternity leave|paternity leave|sabbatical)\b/i,
  /^\s*(?:re:\s*)?vacation (?:reply|notification|message)\b/i,
  /\b(automatic|auto)[\s-]?reply\b/i,
];

// Everything else that came from a machine — a do-not-reply mailbox with
// nothing in the subject to say what it is.
const AUTO_FROM_PATTERNS = [
  /^no-?reply@/i,
  /^do-?not-?reply@/i,
];

/**
 * Which kind of machine-generated mail this is, if any.
 *
 * @param email a HubSpot email object (hs_email_subject / hs_email_from_email)
 * @returns 'bounce' | 'ooo' | 'auto' | null — null means a real reply
 */
export function classifyAutoReply(email) {
  const subject = String(email?.hs_email_subject || '');
  const from = String(email?.hs_email_from_email || '');
  for (const re of BOUNCE_SUBJECT_PATTERNS) if (re.test(subject)) return 'bounce';
  for (const re of BOUNCE_FROM_PATTERNS) if (re.test(from)) return 'bounce';
  for (const re of OOO_SUBJECT_PATTERNS) if (re.test(subject)) return 'ooo';
  for (const re of AUTO_FROM_PATTERNS) if (re.test(from)) return 'auto';
  return null;
}

/** Kept as the single "is this a real reply" test, in terms of the above. */
export function isAutoReply(email) {
  return classifyAutoReply(email) !== null;
}

export const domainOf = (address) => String(address || '').toLowerCase().split('@')[1] || '';

/**
 * Which send a bounce belongs to.
 *
 * An out-of-office comes FROM the recipient, so it matches a send exactly by
 * address. A bounce doesn't: it comes from postmaster@ or MAILER-DAEMON@,
 * either at the recipient's domain or at ours, and the address that actually
 * failed is in a body we never fetched. All we can match on is the domain.
 *
 * That is only safe when the domain names one send. A campaign that emailed
 * five people at acme.com and got one bounce from postmaster@acme.com cannot
 * say which of the five is dead, and guessing marks four good addresses bad —
 * so an ambiguous bounce is counted and left unattributed rather than pinned
 * on somebody.
 *
 * @param bounceFrom the notification's from address
 * @param sends      [{ recipients: [address] }]
 * @returns the index of the one send it belongs to, or -1
 */
export function attributeBounce(bounceFrom, sends) {
  const domain = domainOf(bounceFrom);
  if (!domain) return -1;
  let found = -1;
  for (let i = 0; i < (sends?.length || 0); i++) {
    const recipients = sends[i]?.recipients || [];
    if (!recipients.some(r => domainOf(r) === domain)) continue;
    if (found !== -1) return -1; // a second send at this domain — ambiguous
    found = i;
  }
  return found;
}
