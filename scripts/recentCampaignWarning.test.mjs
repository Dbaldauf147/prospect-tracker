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
