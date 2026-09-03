// Assertion tests for machine-reply classification on a campaign's incoming
// mail. Plain Node — no test framework (the project has none). Run:
//   node scripts/autoReply.test.mjs
//
// The classifier replaced a boolean isAutoReply() that already existed and was
// already tuned. The first thing asserted here is therefore not the new
// behaviour but the OLD one: every message the boolean suppressed is still
// suppressed, and nothing new is. A refactor that quietly lets an
// "Undeliverable:" notification count as a reply inflates every campaign's
// response rate, and nobody would notice.
//
// The second is that a bounce is attributed conservatively. An out-of-office
// arrives from the recipient's own auto-responder, so it names them exactly.
// A bounce arrives from postmaster@ or MAILER-DAEMON@ with the failed address
// buried in a body we never fetched — all we have is a domain. Pinning that on
// somebody when the campaign emailed five people at that domain marks four
// good addresses dead.
import { classifyAutoReply, isAutoReply, attributeBounce, domainOf } from '../api/_lib/autoReply.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

const mail = (subject, from = 'someone@acme.com') => ({
  hs_email_subject: subject,
  hs_email_from_email: from,
});

// ---- bounces -------------------------------------------------------------

check('bounce: Undeliverable', classifyAutoReply(mail('Undeliverable: Q3 energy procurement')), 'bounce');
check('bounce: delivery status notification',
  classifyAutoReply(mail('Delivery Status Notification (Failure)')), 'bounce');
check('bounce: returned mail', classifyAutoReply(mail('Returned mail: see transcript')), 'bounce');
check('bounce: mail delivery subsystem', classifyAutoReply(mail('Mail delivery failed: returning message')), 'bounce');
check('bounce: from a postmaster mailbox',
  classifyAutoReply(mail('Q3 energy procurement', 'postmaster@acme.com')), 'bounce');
check('bounce: from mailer-daemon',
  classifyAutoReply(mail('Q3 energy procurement', 'MAILER-DAEMON@acme.com')), 'bounce');
// A bounce wrapping an auto-reply is a bounce — the delivery failure is the
// more important half, which is why the bounce patterns run first.
check('bounce: a delivery failure carrying an OOO subject is still a bounce',
  classifyAutoReply(mail('Undeliverable: Automatic reply: Out of Office')), 'bounce');

// ---- out of office -------------------------------------------------------

check('ooo: Automatic reply', classifyAutoReply(mail('Automatic reply: Q3 energy procurement')), 'ooo');
check('ooo: Out of Office', classifyAutoReply(mail('Out of Office: back on the 14th')), 'ooo');
check('ooo: OOO', classifyAutoReply(mail('OOO until Monday')), 'ooo');
check('ooo: on parental leave', classifyAutoReply(mail("I'm on parental leave")), 'ooo');
check('ooo: prefixed with Re:', classifyAutoReply(mail('Re: Automatic reply: Q3 energy procurement')), 'ooo');

// ---- other machine mail --------------------------------------------------

check('other: a do-not-reply mailbox with an ordinary subject',
  classifyAutoReply(mail('Q3 energy procurement', 'no-reply@acme.com')), 'auto');

// ---- real replies are left alone -----------------------------------------

check('a real reply classifies as nothing',
  classifyAutoReply(mail('Re: Q3 energy procurement', 'dana@acme.com')), null);
check('a reply merely MENTIONING the office is not an auto-reply',
  classifyAutoReply(mail('Re: Q3 energy procurement — I am out of the office next week, but call me', 'dana@acme.com')), null);
check('an empty email is not an auto-reply', classifyAutoReply({}), null);

// ---- the union is unchanged from the boolean it replaced -----------------

// Reproduces the exact predicate that shipped before the split. If the two
// ever disagree, campaign response rates move without anyone asking them to.
const LEGACY_SUBJECT = [
  /^\s*(?:re:\s*)?automatic reply\b/i, /^\s*(?:re:\s*)?auto[\s-]?reply\b/i,
  /^\s*(?:re:\s*)?auto[\s-]?response\b/i, /^\s*(?:re:\s*)?out of (?:the )?office\b/i,
  /^\s*(?:re:\s*)?ooo\b/i, /^\s*(?:re:\s*)?(?:i am |i'm )?away from (?:the )?office\b/i,
  /^\s*(?:re:\s*)?(?:i am |i'm )?on (?:vacation|leave|holiday|pto|parental leave|maternity leave|paternity leave|sabbatical)\b/i,
  /^\s*(?:re:\s*)?vacation (?:reply|notification|message)\b/i,
  /^\s*undeliverable:?\b/i, /^\s*delivery (?:status notification|failure|notification|has failed)/i,
  /^\s*returned mail\b/i, /^\s*mail delivery (?:failed|subsystem|failure)/i,
  /^\s*postmaster\b/i, /\b(automatic|auto)[\s-]?reply\b/i, /\bbounce notification\b/i,
];
const LEGACY_FROM = [/^postmaster@/i, /^mailer-daemon@/i, /^no-?reply@/i, /^do-?not-?reply@/i, /^bounce[s]?@/i];
const legacyIsAutoReply = (e) =>
  LEGACY_SUBJECT.some(re => re.test(e.hs_email_subject || ''))
  || LEGACY_FROM.some(re => re.test(e.hs_email_from_email || ''));

const CORPUS = [
  mail('Automatic reply: Q3'), mail('Re: Auto-Reply'), mail('Auto-response'),
  mail('Out of the Office'), mail('OOO til Fri'), mail('Away from office'),
  mail('I am on sabbatical'), mail('Vacation reply'), mail('Undeliverable: Q3'),
  mail('Delivery has failed to these recipients'), mail('Returned mail'),
  mail('Mail Delivery Subsystem'), mail('Postmaster notification'),
  mail('Your bounce notification is here'), mail('Q3', 'postmaster@x.com'),
  mail('Q3', 'mailer-daemon@x.com'), mail('Q3', 'noreply@x.com'),
  mail('Q3', 'do-not-reply@x.com'), mail('Q3', 'bounces@x.com'),
  mail('Re: Q3 energy procurement', 'dana@acme.com'),
  mail('Interested — can we talk Thursday?', 'p.okafor@harbor.com'),
  mail('', ''),
];
const disagreements = CORPUS.filter(e => isAutoReply(e) !== legacyIsAutoReply(e))
  .map(e => e.hs_email_subject || e.hs_email_from_email);
check('every message the old boolean suppressed is still suppressed, and no others',
  disagreements, []);

// ---- bounce attribution --------------------------------------------------

const sends = [
  { recipients: ['dana@northbay.com'] },
  { recipients: ['priya@harbor.com', 'ops@harbor.com'] },
  { recipients: ['marcus@vertex.com'] },
];
check('domainOf pulls the domain', domainOf('Dana@Northbay.com'), 'northbay.com');
check('a bounce from a domain with one send is attributed to it',
  attributeBounce('postmaster@northbay.com', sends), 0);
check('a bounce from a domain covered by ONE send with two recipients still attributes',
  attributeBounce('mailer-daemon@harbor.com', sends), 1);

// The case the conservatism exists for: two separate sends at one domain.
const ambiguous = [
  { recipients: ['a@acme.com'] },
  { recipients: ['b@acme.com'] },
  { recipients: ['c@other.com'] },
];
check('a bounce from a domain covering TWO sends is left unattributed',
  attributeBounce('postmaster@acme.com', ambiguous), -1);
check('a bounce from a domain nobody was emailed at is unattributed',
  attributeBounce('mailer-daemon@ourmailserver.com', sends), -1);
check('a bounce with no from address is unattributed', attributeBounce('', sends), -1);
check('no sends, nothing to attribute to', attributeBounce('postmaster@acme.com', []), -1);

console.log(failures === 0 ? '\nAll auto-reply tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
