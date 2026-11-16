// Reading delivery-failure notices (api/_lib/bounceAddress.js).
// Run: node scripts/bounceAddress.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { isBounceNotice, bouncedAddresses, bounceReason } = await import('../api/_lib/bounceAddress.js');
const { fetchForwardedBounces, bounceForwardAddress, forwardedText } = await import('../api/_lib/bounceInbox.js');

let passed = 0, failed = 0;
function eq(a, e, name) {
  const A = JSON.stringify(a), E = JSON.stringify(e);
  if (A === E) { passed++; console.log(`PASS  ${name}`); } else { failed++; console.log(`FAIL  ${name}\n   expected ${E}\n   got      ${A}`); }
}
const me = ['daniel.baldauf@se.com'];

// Nationwide's notice: its own noreply sends it.
const nationwide = `The following message to <harveyw@nationwide.com> was undeliverable.
The reason for the problem:
5.1.0 - Unknown address error 550-'5.4.1 Recipient address rejected: Access denied. For more information see https://aka.ms/EXOSmtpErrors [BL6PEPF0006C3DE.namprd02.prod.outlook.com 2026-11-16T16:26:07.428Z 08DF434B9A8DFE68]'`;
eq(isBounceNotice({ subject: 'Delivery Status Notification (Failure)', from: 'noreply@nationwide.com' }), true, 'DSN subject is a bounce');
eq(bouncedAddresses(nationwide, { exclude: me }), ['harveyw@nationwide.com'], 'the failed address, from "message to <x> was undeliverable"');
eq(bounceReason(nationwide).startsWith("5.1.0 - Unknown address error 550-'5.4.1 Recipient address rejected: Access denied."), true, 'the reason line');

// Mimecast (our own outbound filter) on whitestonereit.com.
const mimecast = `Your message couldn't be delivered
The message you sent to kchatman@whitestonereit.com couldn't be delivered due to: Recipient email address is possibly incorrect.
Further information
5.1.1 <kchatman@whitestonereit.com>: Recipient address rejected: undeliverable address: host whitestonereit.mail.protection.outlook.com[52.101.11.17] said: 550 5.4.1 Recipient address rejected: Access denied.
If you sent this message to multiple addresses, you'll receive a notification like this for every one that didn't arrive.`;
eq(isBounceNotice({ subject: "Your message couldn't be delivered", from: 'postmaster@mimecast.se.com' }), true, 'Mimecast notice is a bounce (from postmaster)');
eq(isBounceNotice({ subject: "Your message couldn't be delivered", from: 'alerts@mimecast.se.com' }), true, 'and by its subject alone');
eq(bouncedAddresses(mimecast, { exclude: me }), ['kchatman@whitestonereit.com'], 'one address, named twice');
eq(bounceReason(mimecast), 'Recipient email address is possibly incorrect.', 'the "due to" reason');

// Exchange NDR and RFC 3464 report.
eq(bouncedAddresses('Delivery has failed to these recipients or groups:\nJohn Doe <jdoe@acme.com>\nThe email address you entered couldn\'t be found.'), ['jdoe@acme.com'], 'Exchange "Delivery has failed to these recipients"');
eq(bouncedAddresses('Final-Recipient: rfc822; a@x.com\nOriginal-Recipient: rfc822;A@X.com\nAction: failed'), ['a@x.com'], 'Final-Recipient');
eq(bouncedAddresses('<postmaster@x.com>: user unknown'), [], 'system mailboxes are never the bounced address');
eq(bouncedAddresses('Please contact daniel.baldauf@se.com or sales@acme.com for help.'), [], 'an address merely mentioned is not a bounce');

// Not bounces.
eq(isBounceNotice({ subject: 'RE: Capital Planning Webinar Invite', from: 'kchatman@whitestonereit.com' }), false, 'a real reply');
eq(isBounceNotice({ subject: 'Automatic reply: Capital Planning Webinar Invite', from: 'x@y.com' }), false, 'an out-of-office');

// Forwarded notices, read out of the app mailbox's label (a fake session).
eq(bounceForwardAddress('prospect.tracker.app@gmail.com'), 'prospect.tracker.app+bounces@gmail.com', 'forward to the +bounces alias');
eq(bounceForwardAddress('x+old@gmail.com'), 'x+bounces@gmail.com', 'an existing alias is replaced');
const fwdNationwide = { from: 'daniel.baldauf@se.com', date: Date.parse('2026-11-16T17:00:00Z'), subject: 'FW: Delivery Status Notification (Failure)', messageId: 'a',
  text: `From: Mail Delivery System <noreply@nationwide.com>\nSent: Monday, November 16, 2026 11:26 AM\nTo: Daniel Baldauf <daniel.baldauf@se.com>\nSubject: Delivery Status Notification (Failure)\n\n${nationwide}` };
const fwdMimecastAttached = { from: 'Daniel.Baldauf@se.com', date: Date.parse('2026-11-16T17:05:00Z'), subject: "FW: Your message couldn't be delivered", messageId: 'b',
  text: 'See attached.', attachments: [{ filename: "Your message couldn't be delivered.eml", contentType: 'message/rfc822', content: Buffer.from(`Subject: Your message couldn't be delivered\n\n${mimecast}`) }] };
const stranger = { from: 'someone@else.com', date: Date.parse('2026-11-16T17:10:00Z'), subject: 'FW: Undeliverable', messageId: 'c', text: 'The following message to <ceo@competitor.com> was undeliverable.' };
const opened = [];
const connect = async (o) => { opened.push(o.label); return { async *messages() { yield fwdNationwide; yield fwdMimecastAttached; yield stranger; }, async close() {} }; };
const got = await fetchForwardedBounces({ user: 'app@gmail.com', pass: 'x', label: 'bounce-notices', allowed: ['daniel.baldauf@se.com'], connect });
eq(opened, ['bounce-notices'], 'only the bounce label is opened');
eq(got.bounces.map(b => b.address), ['harveyw@nationwide.com', 'kchatman@whitestonereit.com'], 'a forwarded body and a forwarded attachment both give their address');
eq(got.bounces[0].subject, 'Delivery Status Notification (Failure)', 'FW: is taken off the subject');
eq(got.bounces[1].reason, 'Recipient email address is possibly incorrect.', 'reason from the attached original');
eq(got.read, 2, 'mail from anyone but Dan is ignored');
let missing = '';
try { await fetchForwardedBounces({ user: 'app@gmail.com', pass: 'x', connect: async () => { throw new Error('label not found'); } }); } catch (e) { missing = e.message; }
eq(/doesn't exist yet in app@gmail.com.*app\+bounces@gmail.com/.test(missing), true, 'a missing label says how to set it up');
eq(forwardedText({ html: '<p>The following message to &lt;a@b.com&gt; was undeliverable.</p>' }).includes('<a@b.com>'), true, 'an HTML-only forward is read as text');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
