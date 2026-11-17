// Draft Emails > Recent Sends: who in each group was emailed in the window.
import assert from 'node:assert/strict';
import { recentSendsByGroup, sendTone, RECENT_SENDS_GROUPS } from '../src/utils/recentSends.js';

const now = Date.parse('2026-11-17T12:00:00Z');
const day = (n) => new Date(now - n * 86400000).toISOString();
const campaigns = [
  { title: 'CAP Webinar', contacts: [{ email: 'ann@a.com', sentDate: day(1) }, { email: 'bo@b.com; cy@c.com', sentDate: day(2) }] },
  { title: 'Midterm Results', contacts: [{ email: 'ann@a.com', sentDate: day(8) }, { email: 'me@se.com', sentDate: day(1) }] },
  { title: 'Perspectives', contacts: [{ email: 'ANN@a.com', sentDate: day(6) }, { email: 'bo@b.com', sentDate: day(40) }] },
];
const contacts = [
  { id: 1, firstname: 'Ann', lastname: 'A', email: 'ann@a.com', g: ['client', 'key'] },
  { id: 2, firstname: 'Bo', lastname: 'B', email: 'bo@b.com', g: ['key'] },
  { id: 3, firstname: 'Cy', lastname: 'C', email: 'cy@c.com', g: ['prospect'] },
  { id: 4, firstname: 'Di', lastname: 'D', email: 'di@d.com', g: ['client'] },
  { id: 5, firstname: 'Ed', lastname: 'E', email: 'ed@e.com', g: [] },
  { id: 6, firstname: 'Me', lastname: 'Self', email: 'me@se.com', g: ['client'] },
  { id: 7, firstname: 'Ann', lastname: 'Dupe', email: 'Ann@a.com', g: ['client'] },
];
const has = (k) => (c) => c.g.includes(k);
const gates = { isClient: has('client'), isKey: has('key'), isKeyProspect: has('prospect') };

const all = recentSendsByGroup({ contacts, gates, groupKeys: ['client', 'key', 'prospect'], campaigns, nowMs: now });
assert.deepEqual(all.rows.map(r => r.name), ['Ann A', 'Bo B', 'Cy C'], 'most campaigns first; nobody unemailed, outside a group, Schneider or a duplicate address');
assert.deepEqual(all.rows[0].campaigns.map(c => c.label), ['CAP Webinar', 'Perspectives', 'Midterm Results'], 'newest send first, as the Drafts warning lists them');
assert.deepEqual(all.rows[0].groups, ['Clients', 'Key Contacts'], 'every group the person is in');
assert.equal(all.rows[1].campaigns.length, 1, 'a send outside the window does not count, a group send counts for each address');
assert.deepEqual(all.counts.client, { total: 2, none: 1, one: 0, two: 0, three: 1 }, 'Clients: Ann (3) and Di (0)');
assert.deepEqual(all.counts.key, { total: 2, none: 0, one: 1, two: 0, three: 1 });
assert.deepEqual(all.counts.prospect, { total: 1, none: 0, one: 1, two: 0, three: 0 });

const prospects = recentSendsByGroup({ contacts, gates, groupKeys: ['prospect'], campaigns, nowMs: now });
assert.deepEqual(prospects.rows.map(r => r.name), ['Cy C'], 'only the picked group');
assert.deepEqual(Object.keys(prospects.counts), ['prospect']);
assert.deepEqual(recentSendsByGroup({ contacts, gates, groupKeys: [], campaigns, nowMs: now }), { rows: [], counts: {} });

assert.equal(sendTone(1), 'green');
assert.equal(sendTone(2), 'yellow');
assert.equal(sendTone(5), 'red');
assert.deepEqual(RECENT_SENDS_GROUPS.map(g => g.label), ['Clients', 'Key Contacts', 'Prospects']);
console.log('recentSends ok');
