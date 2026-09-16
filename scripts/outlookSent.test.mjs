// Assertion tests for the Outlook Sent Items → Sent Log mapping.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/outlookSent.test.mjs
//
// src/utils/outlookSent.js is deliberately import-free so it can be
// exercised here. It is what replaced the HubSpot BCC, and the ways it can
// be wrong are quiet ones: logging a mail to colleagues as outreach,
// counting a send twice when Graph repeats it across a page boundary, or
// printing a BCC list that was blind for a reason.
import {
  sentRowFromMessage, sentRowsFromMessages, recipientRollup,
  filterSentRows, describeOutlookSent, daysAgo, isInternal, isFreeMail, domainOf,
} from '../src/utils/outlookSent.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

function message(overrides = {}) {
  return {
    id: 'AAMkAD_sent_1',
    subject: 'Following up on the Q3 energy spend',
    sentAt: '2026-09-10T14:30:00.000Z',
    to: [{ name: 'Simon Reed', email: 'simon@acme.com' }],
    cc: [{ name: 'Me', email: 'me@se.com' }],
    bcc: [],
    preview: 'Simon,   thanks for the time today.  ',
    hasAttachments: false,
    conversationId: 'conv_1',
    internetMessageId: '<abc@acme.com>',
    ...overrides,
  };
}

// ---- one message → one row --------------------------------------------------

const row = sentRowFromMessage(message());
eq(row._source, 'outlook-sent', 'row is tagged as coming from Sent Items');
eq(row._subject, 'Following up on the Q3 energy spend', 'subject carries over');
eq(row._sentAt, '2026-09-10T14:30:00.000Z', 'send time carries over as an instant');
eq(row.id, 'outlook-sent:AAMkAD_sent_1', 'id is namespaced so it cannot collide with a tracking id');
eq(row._to, 'Simon Reed', 'the To line shows the external recipient by name');
eq(row._recipients, ['simon@acme.com'], 'recipients are lowercased addresses');
eq(row._recipientCount, 1, 'a colleague on CC is not an external recipient');
eq(row._allRecipientCount, 2, 'the colleague is still counted in everyone on the mail');
eq(row._internalOnly, false, 'a mail with an outside recipient is outreach');
eq(row._preview, 'Simon, thanks for the time today.', 'preview whitespace is collapsed');
eq(row._company, '', 'company is left for the page to fill from its own index');

eq(sentRowFromMessage(null), null, 'nothing in, nothing out');
eq(sentRowFromMessage(message({ sentAt: '' })), null, 'a message with no send time is not a send');
eq(sentRowFromMessage(message({ sentAt: 'not a date' })), null, 'an unparseable send time is not a send');
eq(sentRowFromMessage(message({ subject: '' }))._subject, '(No subject)', 'a blank subject still names itself');

// ---- colleagues are not prospects -------------------------------------------

const internal = sentRowFromMessage(message({
  to: [{ name: 'Colleague', email: 'colleague@se.com' }],
  cc: [],
}));
eq(internal._internalOnly, true, 'a mail only to colleagues is marked internal');
eq(internal._recipientCount, 0, 'an internal-only mail has no external recipients');

const subdomain = sentRowFromMessage(message({
  to: [{ name: 'Colleague', email: 'colleague@mail.se.com' }],
  cc: [],
}));
eq(subdomain._internalOnly, true, 'a subdomain of the internal domain is still internal');

eq(isInternal('a@se.com'), true, 'the internal domain is internal');
eq(isInternal('a@se.com.co'), false, 'a domain that merely starts with the internal one is not internal');
eq(isInternal('a@notse.com'), false, 'a domain that merely ends with the internal name is not internal');
eq(isInternal(''), false, 'an empty address is not internal');
eq(domainOf('Simon@ACME.com'), 'acme.com', 'domains are lowercased');
eq(domainOf('nonsense'), '', 'a string with no @ has no domain');
eq(isFreeMail('someone@gmail.com'), true, 'a consumer mailbox is free mail');
eq(isFreeMail('simon@acme.com'), false, 'a company mailbox is not free mail');

const noRecipients = sentRowFromMessage(message({ to: [], cc: [], bcc: [] }));
eq(noRecipients._internalOnly, false, 'a mail with no recipients at all is not "internal only"');

// ---- BCC is a count, never a list -------------------------------------------

const blind = sentRowFromMessage(message({
  bcc: [{ name: 'Hidden', email: 'hidden@acme.com' }, { name: 'Also', email: 'also@acme.com' }],
}));
eq(blind._bccCount, 2, 'the number of blind copies is kept');
eq(JSON.stringify(blind).includes('hidden@acme.com'), false, 'a blind copy address never reaches the row');
eq(blind._allRecipientCount, 4, 'blind copies count towards everyone on the mail');

// ---- many messages → the log ------------------------------------------------

const rows = sentRowsFromMessages([
  message({ id: 'a', sentAt: '2026-09-01T10:00:00.000Z' }),
  message({ id: 'c', sentAt: '2026-09-12T10:00:00.000Z' }),
  message({ id: 'b', sentAt: '2026-09-05T10:00:00.000Z' }),
]);
eq(rows.map(r => r.id), ['outlook-sent:c', 'outlook-sent:b', 'outlook-sent:a'], 'the log runs newest first');

const deduped = sentRowsFromMessages([
  message({ id: 'a' }), message({ id: 'a' }), message({ id: 'b' }),
]);
eq(deduped.length, 2, 'a message Graph repeats across a page boundary is logged once');
eq(sentRowsFromMessages(null), [], 'no messages is an empty log, not a throw');
eq(sentRowsFromMessages([null, message({ sentAt: '' })]), [], 'unusable messages are skipped rather than logged blank');

// ---- who has gone cold ------------------------------------------------------

const rollup = recipientRollup(sentRowsFromMessages([
  message({ id: '1', sentAt: '2026-09-12T10:00:00.000Z', to: [{ name: 'Simon Reed', email: 'simon@acme.com' }], cc: [] }),
  message({ id: '2', sentAt: '2026-09-02T10:00:00.000Z', to: [{ name: '', email: 'simon@acme.com' }], cc: [] }),
  message({ id: '3', sentAt: '2026-08-01T10:00:00.000Z', to: [{ name: 'Dana Chu', email: 'dana@globex.com' }], cc: [] }),
  message({ id: '4', sentAt: '2026-09-14T10:00:00.000Z', to: [{ name: 'Colleague', email: 'colleague@se.com' }], cc: [] }),
]));
eq(rollup.map(r => r.email), ['dana@globex.com', 'simon@acme.com'], 'the coldest contact sorts to the top');
eq(rollup[1].count, 2, 'both mails to the same person are counted');
eq(rollup[1].lastSentAt, '2026-09-12T10:00:00.000Z', 'the most recent send is the one remembered');
eq(rollup[1].name, 'Simon Reed', 'a name is kept even when a later mail carried none');
eq(rollup.some(r => r.email.endsWith('@se.com')), false, 'colleagues never appear in the rollup');
eq(recipientRollup(null), [], 'no rows is an empty rollup');

// ---- narrowing the log ------------------------------------------------------

const all = sentRowsFromMessages([
  message({ id: '1', subject: 'Q3 energy spend', to: [{ name: 'Simon Reed', email: 'simon@acme.com' }], cc: [] }),
  message({ id: '2', subject: 'Team standup', to: [{ name: 'Colleague', email: 'colleague@se.com' }], cc: [] }),
]);
eq(filterSentRows(all).length, 1, 'internal mail is out of the log by default');
eq(filterSentRows(all, { includeInternal: true }).length, 2, 'internal mail can be asked for');
eq(filterSentRows(all, { query: 'acme' }).length, 1, 'a search matches the recipient address');
eq(filterSentRows(all, { query: 'SIMON' }).length, 1, 'a search ignores case');
eq(filterSentRows(all, { query: 'energy' }).length, 1, 'a search matches the subject');
eq(filterSentRows(all, { query: 'nothing here' }).length, 0, 'a search that matches nothing shows nothing');
eq(filterSentRows(null).length, 0, 'no rows filters to no rows');

// ---- how long ago -----------------------------------------------------------

const now = new Date('2026-09-16T00:00:00.000Z').getTime();
eq(daysAgo('2026-09-16T00:00:00.000Z', now), 0, 'today is nought days ago');
eq(daysAgo('2026-09-06T00:00:00.000Z', now), 10, 'ten days back is ten days ago');
eq(daysAgo('2026-09-20T00:00:00.000Z', now), 0, 'a clock skew into the future does not report negative days');
eq(daysAgo('nonsense', now), null, 'an unreadable date has no age');

// ---- what the tab says about its connection ---------------------------------

eq(
  describeOutlookSent({ connected: false }),
  'Outlook is not connected. Use Connect Outlook to read your Sent Items: it is the same sign-in the Drafts tab uses.',
  'a tab that was never connected says how to connect it',
);
eq(
  describeOutlookSent({ connected: true, expired: true }),
  'Your Outlook sign-in has expired. Use Reconnect Outlook to sign in again, it lasts about an hour.',
  'an hour-old token is a sign-in to repeat, not an error',
);
eq(describeOutlookSent({ connected: true, loaded: false }), '', 'nothing is claimed before the first read lands');
eq(
  describeOutlookSent({ connected: true, loaded: true, messages: 0, rangeLabel: 'the last 30 days' }),
  'Outlook returned no sent mail for this window (the last 30 days).',
  'an empty folder is distinguishable from an unread one',
);
eq(
  describeOutlookSent({ connected: true, loaded: true, messages: 6, shown: 0, rangeLabel: 'the last 7 days' }),
  'Outlook has 6 sent messages in the last 7 days, all of them to colleagues only.',
  'a week of internal mail says so rather than showing an empty log',
);
eq(
  describeOutlookSent({ connected: true, loaded: true, messages: 6, shown: 1, rangeLabel: 'the last 7 days' }),
  '',
  'a log with rows in it needs no explaining',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
