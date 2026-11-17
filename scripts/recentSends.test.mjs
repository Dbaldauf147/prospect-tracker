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

// Prospects leave out anybody who is also a Key Contact or a client.
{
  const extra = [
    ...contacts,
    { id: 8, firstname: 'Fay', lastname: 'F', email: 'fay@f.com', g: ['prospect', 'key'] },
    { id: 9, firstname: 'Gus', lastname: 'G', email: 'gus@g.com', g: ['prospect', 'client'] },
  ];
  const sent = [...campaigns, { title: 'X', contacts: [{ email: 'fay@f.com', sentDate: day(1) }, { email: 'gus@g.com', sentDate: day(1) }] }];
  const r = recentSendsByGroup({ contacts: extra, gates, groupKeys: ['prospect'], campaigns: sent, nowMs: now });
  assert.deepEqual(r.rows.map(x => x.name), ['Cy C'], 'Key Contacts and clients are not Prospects');
  assert.equal(r.counts.prospect.total, 1);
  const k = recentSendsByGroup({ contacts: extra, gates, groupKeys: ['key'], campaigns: sent, nowMs: now });
  assert.ok(k.rows.some(x => x.name === 'Fay F'), 'still listed under Key Contacts');
}

assert.equal(sendTone(1), 'green');
assert.equal(sendTone(2), 'yellow');
assert.equal(sendTone(5), 'red');
assert.deepEqual(RECENT_SENDS_GROUPS.map(g => g.label), ['Clients', 'Key Contacts', 'Prospects']);
console.log('recentSends ok');

// Company on each row, a Company typed in the app winning.
{
  const { recentSendsByGroup } = await import('../src/utils/recentSends.js');
  const out = recentSendsByGroup({
    contacts: [{ id: 9, firstname: 'Pat', lastname: 'Q', email: 'pat@q.com', company: 'HubSpot Co', g: ['key'] },
      { id: 10, firstname: 'Ray', lastname: 'R', email: 'ray@r.com', company: 'Raw Name', g: ['key'] }],
    gates, groupKeys: ['key'], nowMs: now,
    campaigns: [{ title: 'X', contacts: [{ email: 'pat@q.com; ray@r.com', sentDate: day(1) }] }],
    localFields: { 9: { _companyOverride: 'Typed Co' } },
  });
  assert.deepEqual(out.rows.map(r => r.company), ['Typed Co', 'Raw Name']);
}

// When people drop below three campaigns, and when most of the list does.
{
  const { belowThreeAt, threePlusClearDates } = await import('../src/utils/recentSends.js');
  const D = 86400000;
  const row = (...ago) => ({ campaigns: ago.map(n => ({ lastSentDate: new Date(now - n * D).toISOString() })) });
  assert.equal(belowThreeAt(row(1, 2)), null, 'two campaigns: already below');
  assert.equal(belowThreeAt(row(1, 5, 10), { nowMs: now }), now - 10 * D + 21 * D, 'three: when the oldest ages out');
  assert.equal(belowThreeAt(row(10, 1, 5, 12), { nowMs: now }), now - 10 * D + 21 * D, 'four: when the third-newest ages out');
  assert.equal(belowThreeAt({ campaigns: [{}, {}, {}] }, { nowMs: now }), now + 21 * D, 'no dates: as if sent today');

  // 5 people: 1 under 3 now, so 2 more must drop for a majority (3 of 5).
  const rows = [row(1), row(1, 2, 3), row(1, 2, 8), row(1, 2, 15), row(1, 2, 5)];
  const d = threePlusClearDates(rows, { nowMs: now });
  assert.equal(d.total, 5);
  assert.equal(d.threePlus, 4);
  assert.equal(d.majorityAt, now - 8 * D + 21 * D, 'the second person to drop: day-15 goes first, then day-8');
  assert.equal(d.allClearAt, now - 3 * D + 21 * D, 'the last to drop is the newest third campaign');
  const done = threePlusClearDates([row(1), row(1, 2), row(1, 2, 3)], { nowMs: now });
  assert.equal(done.majorityAt, null, 'already a majority below three');
  assert.equal(done.allClearAt, now - 3 * D + 21 * D);
  assert.deepEqual(threePlusClearDates([], { nowMs: now }), { total: 0, threePlus: 0, majorityAt: null, allClearAt: null });
}
console.log('recentSends dates ok');

// Campaigns queued but not sent yet count toward the total.
{
  const { recentSendsByGroup, pendingCampaignsByEmail, belowThreeAt } = await import('../src/utils/recentSends.js');
  const fresh = new Date(now - 2 * 86400000).toISOString();
  const stale = new Date(now - 200 * 86400000).toISOString();
  const camps = [
    { title: 'Sent One', savedAt: fresh, contacts: [{ email: 'q@q.com', sentDate: day(2) }] },
    { title: 'Year End', savedAt: fresh, contacts: [{ email: 'q@q.com; r@r.com' }, { email: 'held@h.com', outreach: 'hold' }] },
    { title: 'Old Draft', savedAt: stale, contacts: [{ email: 'q@q.com' }] },
    { title: 'Paused', savedAt: fresh, pausedUntil: new Date(now + 86400000).toISOString(), contacts: [{ email: 'q@q.com' }] },
    { title: 'Half Sent', savedAt: fresh, contacts: [{ email: 'q@q.com', sentDate: day(3) }, { email: 'Q@q.com' }] },
  ];
  const pend = pendingCampaignsByEmail(camps, now);
  assert.deepEqual(pend.get('q@q.com').map(x => x.label), ['Year End', 'Half Sent'], 'active, unsent rows only; stale and paused campaigns are out');
  assert.deepEqual(pend.get('r@r.com').map(x => x.label), ['Year End'], 'a grouped row queues each address');
  assert.equal(pend.has('held@h.com'), false, 'Hold off is not queued');

  const ppl = [{ id: 20, firstname: 'Quinn', lastname: 'Q', email: 'q@q.com', g: ['key'] },
    { id: 21, firstname: 'Rae', lastname: 'R', email: 'r@r.com', g: ['key'] },
    { id: 22, firstname: 'Sam', lastname: 'S', email: 's@s.com', g: ['key'] }];
  const out = recentSendsByGroup({ contacts: ppl, gates, groupKeys: ['key'], campaigns: camps, nowMs: now });
  const quinn = out.rows.find(r => r.name === 'Quinn Q');
  assert.deepEqual(quinn.campaigns.map(c => `${c.label}${c.pending ? '*' : ''}`), ['Sent One', 'Half Sent', 'Year End*'],
    'Half Sent already reached them, so it is not pending as well; Year End is queued');
  assert.equal(quinn.pending, 1);
  const rae = out.rows.find(r => r.name === 'Rae R');
  assert.deepEqual(rae.campaigns.map(c => c.pending), [true], 'someone only queued is listed');
  assert.equal(rae.emails, 0);
  assert.deepEqual(out.counts.key, { total: 3, none: 1, one: 1, two: 0, three: 1 }, 'queued campaigns add to the group tallies');
  assert.equal(belowThreeAt(quinn, { nowMs: now }), now - 3 * 86400000 + 21 * 86400000, 'third-newest: Half Sent (day 3), the queued one reads as today');
}
console.log('recentSends pending ok');
