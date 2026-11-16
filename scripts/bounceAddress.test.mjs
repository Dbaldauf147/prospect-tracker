// Reading delivery-failure notices (api/_lib/bounceAddress.js).
// Run: node scripts/bounceAddress.test.mjs
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);
const { isBounceNotice, bouncedAddresses, bounceReason } = await import('../api/_lib/bounceAddress.js');
const { scanBounces } = await import('../api/outlook-bounces.js');

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

// The inbox scan, over a fake Graph: two pages, a real reply skipped, a
// notice whose preview is cut short read in full.
const pages = {
  first: { value: [
    { id: 'm1', subject: 'Delivery Status Notification (Failure)', from: { emailAddress: { address: 'noreply@nationwide.com' } }, receivedDateTime: '2026-11-16T16:26:08Z', bodyPreview: nationwide },
    { id: 'm2', subject: 'RE: Capital Planning Webinar Invite', from: { emailAddress: { address: 'a@b.com' } }, bodyPreview: 'Thanks, see you there' },
  ], '@odata.nextLink': 'NEXT' },
  NEXT: { value: [
    { id: 'm3', subject: "Your message couldn't be delivered", from: { emailAddress: { address: 'postmaster@mimecast.se.com' } }, receivedDateTime: '2026-11-16T16:25:09Z', bodyPreview: 'Your message couldn\'t be delivered. Right-click or tap and hold here to download pictures.' },
  ] },
};
const calls = [];
const get = async (_t, url) => {
  calls.push(url);
  if (url.startsWith('/me?')) return { mail: 'Daniel.Baldauf@se.com' };
  if (url === 'NEXT') return pages.NEXT;
  if (url.includes('/me/messages/m3')) return { body: { content: mimecast } };
  return pages.first;
};
const scan = await scanBounces('tok', { days: 30, get });
eq(scan.bounces.map(b => b.address), ['harveyw@nationwide.com', 'kchatman@whitestonereit.com'], 'both notices give their address');
eq([scan.scanned, scan.notices], [3, 2], 'every message looked at, two notices');
eq(calls.filter(u => u.includes('/me/messages/')).length, 1, 'only the cut-short notice is read in full');
eq(scan.bounces[1].reason, 'Recipient email address is possibly incorrect.', 'reason from the full text');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
