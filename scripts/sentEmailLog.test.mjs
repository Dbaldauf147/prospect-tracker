// Assertion tests for the compact sent-email log. Plain Node, no test
// framework (the project has none). Run:
//   node scripts/sentEmailLog.test.mjs
//
// The log exists because the Activity feed is too big for localStorage. What
// is worth holding: it keeps what a "was it sent" question needs and nothing
// else, and sentPerActivity reads it exactly as it reads the full feed.
import assert from 'node:assert/strict';
import { buildSentEmailLog } from '../src/utils/sentEmailLog.js';
import { sentPerActivity } from '../src/utils/recentCampaignWarning.js';

const feed = {
  fetchedAt: '2026-11-23T16:20:00Z',
  emails: [
    { id: '1', hs_email_subject: 'Capital Planning Webinar Invite', hs_email_from_email: 'daniel.baldauf@se.com', hs_email_to_email: 'jimdietz@lennar.com', hs_email_direction: 'EMAIL', hs_timestamp: '2026-11-23T15:47:00Z', hs_email_text: 'x'.repeat(4000), hs_email_html: '<p>long</p>' },
    { id: '2', hs_email_subject: 'RE: Capital Planning Webinar Invite', hs_email_from_email: 'jimdietz@lennar.com', hs_email_to_email: 'daniel.baldauf@se.com', hs_email_direction: 'INCOMING_EMAIL', hs_timestamp: '2026-11-23T16:00:00Z' },
    { id: '3', hs_email_subject: 'No time on this one', hs_email_to_email: 'a@b.com' },
    null,
  ],
  calls: [{ hs_call_title: 'not kept' }],
};
const log = buildSentEmailLog(feed);

assert.equal(log.v, 1);
assert.equal(log.fetchedAt, '2026-11-23T16:20:00Z');
assert.equal(log.emails.length, 2, 'emails with a time are kept; calls, blanks and undated rows are not');
assert.deepEqual(Object.keys(log.emails[0]).sort(),
  ['hs_email_direction', 'hs_email_from_email', 'hs_email_subject', 'hs_email_to_email', 'hs_timestamp'],
  'only the five fields the question needs: no body, no id');
assert.ok(JSON.stringify(log).length < 600, 'the body is what made the feed too big, and it is gone');

assert.deepEqual([...sentPerActivity(log, 'Capital Planning Webinar Invite')], [...sentPerActivity(feed, 'Capital Planning Webinar Invite')],
  'the log answers the same as the feed it came from');
assert.deepEqual([...sentPerActivity(log, 'Capital Planning Webinar Invite').keys()], ['jimdietz@lennar.com'],
  'the send counts, the reply that came back does not');

assert.deepEqual(buildSentEmailLog(null).emails, [], 'no feed, an empty log');

console.log('PASS  sent email log');
