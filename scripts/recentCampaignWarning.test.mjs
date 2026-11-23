// The Draft Emails "emailed by another campaign in the last 3 weeks" warning.
import assert from 'node:assert/strict';
import { recentCampaignWarnings } from '../src/utils/recentCampaignWarning.js';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 864e5).toISOString();
const campaigns = [
  { subject: 'Energy market update', contacts: [{ email: 'joe@tishman.com', sentDate: daysAgo(5) }] },
  { subject: 'Old webinar', contacts: [{ email: 'joe@tishman.com', sentDate: daysAgo(40) }, { email: 'amy@x.com', sentDate: daysAgo(30) }] },
  { subjects: ['Climate risk factsheet', 'RE: Climate risk factsheet'], contacts: [{ email: 'amy@x.com', sentDate: daysAgo(2) }] },
  { subject: 'Group send', contacts: [{ email: 'kim@y.com; lee@y.com', sentDate: daysAgo(20) }] },
  { subject: 'Self test', contacts: [{ email: 'daniel.baldauf@se.com', sentDate: daysAgo(1) }] },
];
const to = [
  { name: 'Joseph Doran', email: 'JOE@tishman.com' },
  { name: 'Amy', email: 'amy@x.com' },
  { name: 'Lee', email: 'lee@y.com' },
  { name: 'Dan', email: 'daniel.baldauf@se.com' },
  { name: 'New', email: 'new@z.com' },
];

const w = recentCampaignWarnings(campaigns, to, { currentSubject: 'Climate Risk Factsheet', nowMs: NOW });
assert.deepEqual(w.map(x => x.name), ['Joseph Doran', 'Lee'], 'this campaign, older sends, Schneider and the never-emailed are left out');
assert.deepEqual(w[0].campaigns.map(c => c.label), ['Energy market update']);
assert.equal(w[1].campaigns[0].label, 'Group send', 'each address in a group send counts');

const noSubject = recentCampaignWarnings(campaigns, to, { nowMs: NOW });
assert.deepEqual(noSubject.map(x => x.name), ['Joseph Doran', 'Amy', 'Lee'], 'with no subject every campaign is another campaign');
assert.deepEqual(recentCampaignWarnings(campaigns, to, { nowMs: NOW, days: 3 }).map(x => x.name), ['Amy']);
assert.deepEqual(recentCampaignWarnings(null, to, { nowMs: NOW }), []);
console.log('PASS  recent campaign warning');

// sentThisCampaign: who this draft's own campaign has already emailed.
{
  const { sentThisCampaign } = await import('../src/utils/recentCampaignWarning.js');
  const s = sentThisCampaign([
    ...campaigns,
    { subject: 'climate risk factsheet', contacts: [{ email: 'Amy@x.com', sentDate: daysAgo(1) }, { email: 'pending@x.com', sentDate: '' }] },
  ], 'Climate Risk Factsheet');
  assert.deepEqual([...s.keys()], ['amy@x.com'], 'only sent rows of the matching campaign count');
  assert.equal(s.get('amy@x.com'), daysAgo(1), 'latest send wins');
  assert.equal(sentThisCampaign(campaigns, 'Group send').has('lee@y.com'), true, 'group sends split');
  assert.equal(sentThisCampaign(campaigns, '').size, 0);
}

// The same sends, read off the Activity tab's feed, so a To pill turns green
// as soon as the Activity tab lists the send rather than when the campaign
// is next refreshed.
{
  const { sentPerActivity, mergeSent } = await import('../src/utils/recentCampaignWarning.js');
  const at = (d) => new Date(Date.parse('2026-11-23T15:47:00Z') - d * 864e5).toISOString();
  const feed = { emails: [
    { hs_email_subject: 'Capital Planning Webinar Invite', hs_email_from_email: 'daniel.baldauf@se.com', hs_email_to_email: 'JimDietz@lennar.com', hs_timestamp: at(0) },
    { hs_email_subject: 'Capital Planning Webinar Invite', hs_email_from_email: 'daniel.baldauf@se.com', hs_email_to_email: 'jimdietz@lennar.com', hs_timestamp: at(3) },
    { hs_email_subject: 'RE: Capital Planning Webinar Invite', hs_email_from_email: 'jimdietz@lennar.com', hs_email_to_email: 'daniel.baldauf@se.com; other@lennar.com', hs_timestamp: at(0) },
    { hs_email_subject: 'Capital Planning Webinar Invite', hs_email_from_email: '', hs_email_direction: 'EMAIL', hs_email_to_email: 'kim@y.com, lee@y.com; boss@se.com', hs_timestamp: at(1) },
    { hs_email_subject: 'Capital Planning Webinar Invite', hs_email_from_email: '', hs_email_direction: 'INCOMING_EMAIL', hs_email_to_email: 'in@y.com', hs_timestamp: at(1) },
    { hs_email_subject: 'Something else', hs_email_from_email: 'daniel.baldauf@se.com', hs_email_to_email: 'amy@x.com', hs_timestamp: at(1) },
    { hs_email_subject: 'Capital Planning Webinar Invite', hs_email_from_email: 'daniel.baldauf@se.com', hs_email_to_email: 'nodate@x.com', hs_timestamp: '' },
    { hs_email_subject: 'Savings for Lennar this quarter', hs_email_from_email: 'daniel.baldauf@se.com', hs_email_to_email: 'var@lennar.com', hs_timestamp: at(2) },
  ] };
  const s = sentPerActivity(feed, 'capital planning webinar invite');
  assert.deepEqual([...s.keys()].sort(), ['jimdietz@lennar.com', 'kim@y.com', 'lee@y.com'],
    'outbound sends under the subject, every external address, no incoming mail and no @se.com');
  assert.equal(s.get('jimdietz@lennar.com'), at(0), 'the latest send wins');
  assert.equal(sentPerActivity(feed, '').size, 0, 'no subject, nobody');
  assert.equal(sentPerActivity(null, 'Capital Planning Webinar Invite').size, 0, 'no feed, nobody');
  assert.equal(sentPerActivity(feed, 'Savings for {company} this quarter').has('var@lennar.com'), true, 'a variable matches whatever the send filled in');
  assert.equal(sentPerActivity(feed, '{company}').size, 0, 'a subject that is only a variable matches nothing');

  const merged = mergeSent(new Map([['a@x.com', at(5)], ['b@x.com', at(1)]]), new Map([['a@x.com', at(2)], ['c@x.com', at(0)]]));
  assert.deepEqual([merged.get('a@x.com'), merged.get('b@x.com'), merged.get('c@x.com')], [at(2), at(1), at(0)], 'merged: the later send per address');
}
