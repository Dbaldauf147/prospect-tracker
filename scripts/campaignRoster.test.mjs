// Assertion tests for who ends up on an Email Campaign's contact list.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/campaignRoster.test.mjs
//
// What's worth pinning, in the order it would hurt:
//   - somebody sent the campaign's email SHOWS UP without being added, which
//     is the whole point of the change;
//   - somebody taken off the campaign STAYS off, which is the only brake on
//     the line above and has to beat it every time;
//   - a row somebody curated - their RSVP, their hold, their note, the
//     company recorded against them - survives a refresh untouched;
//   - nobody is listed twice, however many sends they appear in.
import {
  mergeCampaignContacts, adoptedRow, adoptedCount, rowAddresses, normEmail,
} from '../src/utils/campaignRoster.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// A send, shaped the way api/email-campaign.js returns one.
const send = (email, over = {}) => ({
  email,
  name: 'Lori Mabardi',
  sentDate: '2026-09-10T09:00:00Z',
  sendCount: 1,
  firstSentDate: '2026-09-10T09:00:00Z',
  sendHistory: ['2026-09-10T09:00:00Z'],
  replied: false,
  replyDate: null,
  repliedBy: null,
  bounced: false,
  bounceDate: null,
  outOfOffice: false,
  oooDate: null,
  oooSubject: '',
  recipientCount: 1,
  ...over,
});

const emailsOf = (rows) => rows.map(r => r.email);

// --- reading a row's addresses ------------------------------------------
check('one address', rowAddresses({ email: 'a@x.com' }), ['a@x.com']);
check('a grouped send', rowAddresses({ email: 'a@x.com; b@y.com' }), ['a@x.com', 'b@y.com']);
check('case and padding are levelled', rowAddresses({ email: ' A@X.com ' }), ['a@x.com']);
check('no address at all', rowAddresses({}), []);
check('normEmail handles rubbish', normEmail(null), '');

// --- the point of the change: recipients arrive on their own -------------
{
  // The campaign in front of the user: created by hand, one contact on it,
  // nothing sent yet. Two people have since been emailed.
  const roster = [{ email: 'lori.mabardi@barings.com', eventStatus: 'going', outreach: 'hold', holdUntil: '2026-09-30' }];
  const fetched = [send('lori.mabardi@barings.com'), send('dana@acme.com', { name: 'Dana Reed' })];
  const merged = mergeCampaignContacts(roster, fetched, []);

  check('the new recipient is pulled in', emailsOf(merged), ['lori.mabardi@barings.com', 'dana@acme.com']);
  check('and is marked as pulled in', merged[1].autoAdded, true);
  check('with the send behind it', merged[1].sentDate, '2026-09-10T09:00:00Z');
  check('and nothing recorded against it yet', [merged[1].eventStatus, merged[1].outreach, merged[1].notes], ['', '', '']);
  check('one pulled in', adoptedCount(merged), 1);

  // The row somebody curated keeps everything they put on it.
  check('the RSVP survives', merged[0].eventStatus, 'going');
  check('the hold survives', [merged[0].outreach, merged[0].holdUntil], ['hold', '2026-09-30']);
  check('the roster row is not marked pulled in', !!merged[0].autoAdded, false);
  check('and it picks up its send', merged[0].sentDate, '2026-09-10T09:00:00Z');
}

// --- removals beat the pull-in ------------------------------------------
{
  // The only way to say "not this one" about somebody who really was sent
  // it. If this ever stops holding, a removed contact comes back on every
  // refresh and there is no way at all to keep them off.
  const fetched = [send('dana@acme.com'), send('sam@acme.com')];
  const merged = mergeCampaignContacts([], fetched, ['dana@acme.com']);
  check('a tombstoned recipient is not pulled in', emailsOf(merged), ['sam@acme.com']);

  check(
    'tombstones ignore case',
    emailsOf(mergeCampaignContacts([], fetched, ['DANA@Acme.com '])),
    ['sam@acme.com'],
  );
  check(
    'and it stays out however many refreshes run',
    emailsOf(mergeCampaignContacts(mergeCampaignContacts([], fetched, ['dana@acme.com']), fetched, ['dana@acme.com'])),
    ['sam@acme.com'],
  );
  // A roster row that was removed goes too, the way it always has.
  check(
    'a removed roster row stays gone',
    emailsOf(mergeCampaignContacts([{ email: 'dana@acme.com' }], fetched, ['dana@acme.com'])),
    ['sam@acme.com'],
  );
}

// --- nobody twice --------------------------------------------------------
{
  // Already on the list: matched, not appended.
  const merged = mergeCampaignContacts(
    [{ email: 'Dana@Acme.com', notes: 'met at the summit' }],
    [send('dana@acme.com')],
    [],
  );
  check('a differently-cased roster row is not duplicated', emailsOf(merged), ['Dana@Acme.com']);
  check('and keeps its note', merged[0].notes, 'met at the summit');

  // The same address in two sends - a first mail and a chase - is one person.
  const twice = mergeCampaignContacts([], [
    send('dana@acme.com', { replied: true, replyDate: '2026-09-11T10:00:00Z', repliedBy: 'Dana Reed' }),
    send('dana@acme.com', { sentDate: '2026-09-02T09:00:00Z' }),
  ], []);
  check('two sends to one address is one row', emailsOf(twice), ['dana@acme.com']);
  // The search returns replies first, so the answered send is the one kept.
  check('and the reply is the one kept', twice[0].replied, true);
}

// --- a send that went to a group ----------------------------------------
{
  // Every column beside the address is about a person, so a group send
  // becomes a row each: either of them can be held or marked Going alone.
  const merged = mergeCampaignContacts([], [send('a@x.com; b@y.com', { recipientCount: 2 })], []);
  check('a grouped send becomes a row each', emailsOf(merged), ['a@x.com', 'b@y.com']);
  check('both say how many it went to', merged.map(r => r.recipientCount), [2, 2]);
  // HubSpot reports one name per send - the To contact's - so on a group it
  // belongs to one of these two and would be a lie on the other.
  check('and neither claims the name', merged.map(r => r.name), ['', '']);
  check('a single send keeps its name', mergeCampaignContacts([], [send('a@x.com')], [])[0].name, 'Lori Mabardi');

  // One of the group is already on the roster: they are matched, and only
  // the other one is appended.
  const partial = mergeCampaignContacts(
    [{ email: 'a@x.com', eventStatus: 'going' }],
    [send('a@x.com; b@y.com', { recipientCount: 2 })],
    [],
  );
  check('the known one is not duplicated', emailsOf(partial), ['a@x.com', 'b@y.com']);
  check('the known one keeps its RSVP', partial[0].eventStatus, 'going');
  check('and picks up the send', partial[0].sentDate, '2026-09-10T09:00:00Z');
  check('only the unknown one is marked pulled in', partial.map(r => !!r.autoAdded), [false, true]);

  // A legacy roster row carrying both addresses covers both of them.
  const legacy = mergeCampaignContacts(
    [{ email: 'a@x.com; b@y.com' }],
    [send('a@x.com; b@y.com', { recipientCount: 2 })],
    [],
  );
  check('a legacy grouped row is not split or duplicated', emailsOf(legacy), ['a@x.com; b@y.com']);
}

// --- the other direction: added before the send -------------------------
{
  // The reason the manual add still exists. Nobody has been emailed, so
  // there is nothing to pull in, and the row has to stay put as "Not Sent"
  // or "Add unsent to Draft" has nobody to queue.
  const merged = mergeCampaignContacts([{ email: 'lori.mabardi@barings.com', eventStatus: 'going' }], [], []);
  check('an unsent roster member stays', emailsOf(merged), ['lori.mabardi@barings.com']);
  check('with no send date', !!merged[0].sentDate, false);
  check('and its RSVP', merged[0].eventStatus, 'going');
  check('nothing pulled in', adoptedCount(merged), 0);
}

// --- what a refresh may and may not overwrite ---------------------------
{
  // The roster row owns what somebody typed; the fetch owns what HubSpot
  // knows. A refresh that overwrote a recorded company or a note would lose
  // work quietly, which is the worst way to lose it.
  const roster = [{
    email: 'dana@acme.com',
    name: 'Dana Reed',
    company: 'Acme Holdings',
    notes: 'wants the Tuesday slot',
    eventStatus: 'maybe',
    outreach: 'avoid',
    holdUntil: '',
    autoAdded: true,
  }];
  const merged = mergeCampaignContacts(roster, [send('dana@acme.com', {
    name: 'D. Reed',
    replied: true,
    replyDate: '2026-09-11T10:00:00Z',
    repliedBy: 'Dana Reed',
    bounced: true,
    bounceDate: '2026-09-10T09:05:00Z',
    outOfOffice: true,
    oooDate: '2026-09-10T09:02:00Z',
    oooSubject: 'Away until the 20th',
    sendCount: 3,
    firstSentDate: '2026-08-01T09:00:00Z',
  })], []);

  check('the recorded company is kept', merged[0].company, 'Acme Holdings');
  check('the note is kept', merged[0].notes, 'wants the Tuesday slot');
  check('the RSVP is kept', merged[0].eventStatus, 'maybe');
  check('the Avoid is kept', merged[0].outreach, 'avoid');
  check('the stored name is kept', merged[0].name, 'Dana Reed');
  // Once pulled in, still pulled in: it is where the row came from, not a
  // state that changes.
  check('the provenance is kept', merged[0].autoAdded, true);

  check('the reply is taken', [merged[0].replied, merged[0].repliedBy], [true, 'Dana Reed']);
  check('the bounce is taken', [merged[0].bounced, merged[0].bounceDate], [true, '2026-09-10T09:05:00Z']);
  check('the out-of-office is taken', [merged[0].outOfOffice, merged[0].oooSubject], [true, 'Away until the 20th']);
  check('the follow-up count is taken', [merged[0].sendCount, merged[0].firstSentDate], [3, '2026-08-01T09:00:00Z']);
}

// --- order ---------------------------------------------------------------
{
  // A refresh must not reshuffle a list somebody is reading: the roster
  // keeps its order and the new arrivals land at the bottom, in the order
  // the search returned them.
  const merged = mergeCampaignContacts(
    [{ email: 'first@x.com' }, { email: 'second@x.com' }],
    [send('third@x.com'), send('second@x.com'), send('fourth@x.com')],
    [],
  );
  check('roster first, arrivals after', emailsOf(merged), ['first@x.com', 'second@x.com', 'third@x.com', 'fourth@x.com']);
}

// --- rubbish in --------------------------------------------------------
{
  check('no roster and no activity', mergeCampaignContacts(null, null, null), []);
  check('a send with no address is skipped', emailsOf(mergeCampaignContacts([], [send('')], [])), []);
  check('a blank tombstone tombstones nothing', emailsOf(mergeCampaignContacts([], [send('a@x.com')], ['', '  '])), ['a@x.com']);
  // A row with no address can't be matched to anything, but it is still
  // somebody's row and is not silently dropped.
  check('a roster row with no address survives', mergeCampaignContacts([{ notes: 'no email yet' }], [], []).length, 1);
  // Defaults, so a send missing the newer fields doesn't write undefined
  // into a saved campaign (Firestore refuses one).
  const bare = adoptedRow('a@x.com', { sentDate: '2026-09-10T09:00:00Z' });
  check('sendHistory defaults to a list', bare.sendHistory, []);
  check('sendCount defaults to null', bare.sendCount, null);
  check('recipientCount defaults to one', bare.recipientCount, 1);
  check('firstSentDate falls back to the send', bare.firstSentDate, '2026-09-10T09:00:00Z');
  check('no undefined anywhere', Object.values(bare).some(v => v === undefined), false);
  check('adoptedCount on nothing', adoptedCount(null), 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
