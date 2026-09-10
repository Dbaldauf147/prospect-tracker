// Assertion tests for the Email Campaign Tracker's follow-up count.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/campaignFollowUp.test.mjs
//
// What's worth pinning: a send counts once no matter how many of the
// campaign's subject-line searches returned it, a contact chased on their own
// after a group send is still one person emailed twice, the first send stays
// reportable when the detail is capped, and — the one that matters most on
// screen — "not counted yet" never turns into "no follow-up".
import {
  SEND_HISTORY_CAP, sendHistoryByAddress, sendHistoryFor, followUpInfo, followUpLabel,
} from '../src/utils/campaignFollowUp.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const send = (id, date, subject, recipients) => ({ id, timestamp: date, subject, recipients });

// --- one contact, chased ----------------------------------------------
const chased = sendHistoryByAddress([
  send('1', '2026-09-01T14:00:00Z', 'Power prices, September', ['sam@acme.com']),
  send('2', '2026-09-08T09:00:00Z', 'RE: Power prices, September', ['sam@acme.com']),
  send('3', '2026-09-02T10:00:00Z', 'Power prices, September', ['lee@acme.com']),
]);
check('two sends counted', sendHistoryFor(chased, ['sam@acme.com']).sendCount, 2);
check('first send is the first', sendHistoryFor(chased, ['sam@acme.com']).firstSentDate, '2026-09-01T14:00:00Z');
check('history is oldest first', sendHistoryFor(chased, ['sam@acme.com']).history.map(h => h.subject),
  ['Power prices, September', 'RE: Power prices, September']);
check('a contact emailed once', sendHistoryFor(chased, ['lee@acme.com']).sendCount, 1);
check('a contact never emailed', sendHistoryFor(chased, ['nobody@acme.com']), { sendCount: 0, firstSentDate: null, history: [] });

// The same email reached through two of a campaign's subject-line searches is
// one send. Ids are what deduplicates, exactly as they do in the API.
const twice = sendHistoryByAddress([
  send('1', '2026-09-01T14:00:00Z', 'Power prices, September', ['sam@acme.com']),
  send('1', '2026-09-01T14:00:00Z', 'Power prices, September', ['sam@acme.com']),
]);
check('one email is one send', sendHistoryFor(twice, ['sam@acme.com']).sendCount, 1);

// A group send followed by a chase to one of its recipients: two recipient
// SETS, and to the person reading the row one contact emailed twice.
const group = sendHistoryByAddress([
  send('1', '2026-09-01T14:00:00Z', 'Power prices, September', ['sam@acme.com', 'dana@acme.com']),
  send('2', '2026-09-09T09:00:00Z', 'RE: Power prices, September', ['sam@acme.com']),
]);
check('the chased recipient', sendHistoryFor(group, ['sam@acme.com']).sendCount, 2);
check('the recipient left alone', sendHistoryFor(group, ['dana@acme.com']).sendCount, 1);
// A row that carries both addresses counts each send once, not once per address.
check('a group row counts sends, not addresses', sendHistoryFor(group, ['sam@acme.com', 'dana@acme.com']).sendCount, 2);

// --- the cap ----------------------------------------------------------
const many = sendHistoryByAddress(
  Array.from({ length: SEND_HISTORY_CAP + 3 }, (_, n) =>
    send(String(n), `2026-09-${String(n + 1).padStart(2, '0')}T09:00:00Z`, `Send ${n}`, ['sam@acme.com'])),
);
const capped = sendHistoryFor(many, ['sam@acme.com']);
check('the count is exact', capped.sendCount, SEND_HISTORY_CAP + 3);
check('the detail is capped', capped.history.length, SEND_HISTORY_CAP);
check('the newest are kept', capped.history[capped.history.length - 1].subject, `Send ${SEND_HISTORY_CAP + 2}`);
// The oldest kept entry is no longer the campaign's first send, which is
// why the first date is reported on its own.
check('the first send survives the cap', capped.firstSentDate, '2026-09-01T09:00:00Z');

// --- what the column shows --------------------------------------------
const contact = { sentDate: '2026-09-08T09:00:00Z', sendCount: 2, firstSentDate: '2026-09-01T14:00:00Z' };
check('a follow-up', followUpInfo(contact).followUp, true);
check('how many chases', followUpInfo(contact).followUpCount, 1);
check('first and last', [followUpInfo(contact).firstSentDate, followUpInfo(contact).lastSentDate],
  ['2026-09-01T14:00:00Z', '2026-09-08T09:00:00Z']);
check('says Yes', followUpLabel(contact), 'Yes');

const once = { sentDate: '2026-09-01T14:00:00Z', sendCount: 1 };
check('one send is no follow-up', followUpInfo(once).followUp, false);
check('says No', followUpLabel(once), 'No');
check('one send is still known', followUpInfo(once).known, true);

// A roster member nobody has emailed: sent is false, and the column has
// nothing to say rather than "No".
check('never sent', followUpInfo({ email: 'new@acme.com' }).sent, false);
check('never sent says nothing', followUpLabel({ email: 'new@acme.com' }), '');

// A campaign saved before the count existed. This is the one that must NOT
// read as "no follow-up": the answer isn't in the snapshot, and it fills in
// on the next refresh.
const old = { sentDate: '2026-09-01T14:00:00Z' };
check('an uncounted send is not known', followUpInfo(old).known, false);
check('an uncounted send is not a "no"', followUpLabel(old), '');
check('an uncounted send claims no follow-up', followUpInfo(old).followUp, false);
// A count that arrived as something other than a number is no count at all.
check('a string count is not counted', followUpInfo({ sentDate: 'x', sendCount: '2' }).known, false);
check('a null contact', followUpLabel(null), '');

// The first send falls back to the history, then to the send date, so a
// contact stored without one still dates its first email.
check('first sent falls back to history',
  followUpInfo({ sentDate: '2026-09-08', sendCount: 2, sendHistory: [{ date: '2026-09-01', subject: 'x' }] }).firstSentDate,
  '2026-09-01');
check('first sent falls back to the send date',
  followUpInfo({ sentDate: '2026-09-08', sendCount: 1 }).firstSentDate, '2026-09-08');

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
