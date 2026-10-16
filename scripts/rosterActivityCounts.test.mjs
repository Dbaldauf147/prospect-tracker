// Assertion tests for the Prospecting > History "who has had activity
// lately" charts: Dan Key Target, Dan Key Prospect and Decision Makers,
// each counted over the last 30, 60 and 120 days. Plain Node - no test
// framework. Run:
//   node scripts/rosterActivityCounts.test.mjs
//
// What's worth pinning:
//   - each roster holds the people the contacts pages put on it (the real
//     roster gates, not a look-alike), less cancelling / Don't Track clients;
//   - activity is the newest of an emailed address, a called number and
//     HubSpot's Last Contacted date, and the windows include their edge;
//   - the windows nest: anyone active in 30 days is active in 60 and 120;
//   - an empty roster reports pct null, not 0.
import { makeRosterGates } from '../src/utils/contactRosters.js';
import { contactLastOutreachMs, rosterActivityCounts } from '../src/utils/tieredAccountActivity.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const DAY = 86400000;
const NOW = new Date(2026, 9, 16, 12).getTime();
const ago = (d) => new Date(NOW - d * DAY).toISOString();

const prospects = [
  { id: 'p1', company: 'Acme Realty', cdm: 'Dan Baldauf', tier: 'Tier 1', status: 'Prospect' },
  { id: 'p2', company: 'Zenith Capital', cdm: 'Dan Baldauf', tier: 'Tier 2', status: 'Prospect' },
  { id: 'p3', company: 'Gone Client', cdm: 'Dan Baldauf', status: 'Client' },
];
const gates = makeRosterGates({
  prospects, cdmName: 'Dan Baldauf', oppsRecords: [{ Account: 'Zenith Capital', Stage: 'Proposal' }],
  clientStatusMap: { 'gone client': 'Cancelling for Sure' }, clientUntrackedMap: {}, showHidden: false,
});
const myCdmGate = (c) => ['acme realty', 'zenith capital', 'gone client'].includes(String(c.company || '').toLowerCase());

const contacts = [
  // Key Target and a Decision Maker at an untouched Tier 1 (so Key Prospect too); emailed 10 days ago.
  { id: '1', email: 'a@acme.com', company: 'Acme Realty', dans_tags: 'Dan Key Target; Decision Maker' },
  // Decision Maker at Acme (Key Prospect), last contacted 45 days ago.
  { id: '2', email: 'b@acme.com', company: 'Acme Realty', dans_tags: 'Decision Maker', notes_last_contacted: ago(45) },
  // Decision Maker at Zenith, which has an opp: not a Key Prospect. Called 100 days ago.
  { id: '3', email: 'c@zenith.com', phone: '(555) 123-4567', company: 'Zenith Capital', dans_tags: 'Decision Maker' },
  // Key Target with nothing on record.
  { id: '4', email: 'd@zenith.com', company: 'Zenith Capital', dans_tags: 'Dan Key Target' },
  // Key Target, contacted 200 days ago: on the roster, outside every window.
  { id: '5', email: 'e@acme.com', company: 'Acme Realty', dans_tags: 'Dan Key Target', notes_last_contacted: ago(200) },
  // Decision Maker at a cancelling client: left off every roster.
  { id: '6', email: 'f@gone.com', company: 'Gone Client', dans_tags: 'Decision Maker; Dan Key Target', notes_last_contacted: ago(5) },
  // Decision Maker at nobody's account of mine: not on the Decision Makers roster.
  { id: '7', email: 'g@else.com', company: 'Elsewhere', dans_tags: 'Decision Maker', notes_last_contacted: ago(5) },
];
const outreachIndex = {
  emails: { 'a@acme.com': { tsMs: NOW - 10 * DAY } },
  phones: { 5551234567: { ts: ago(100) } },
};

// The per-contact reading.
check('newest of email and Last Contacted', contactLastOutreachMs(
  { email: 'A@acme.com', notes_last_contacted: ago(50) }, outreachIndex), NOW - 10 * DAY);
check('a call is found by its number however it is written', contactLastOutreachMs(
  { phone: '+1 555-123-4567' }, outreachIndex) != null, true);
check('nothing on record is null', contactLastOutreachMs({ email: 'x@y.com' }, outreachIndex), null);

const out = rosterActivityCounts({ contacts, gates, myCdmGate, outreachIndex, nowMs: NOW });
const view = Object.fromEntries(out.map(r => [r.key, { total: r.total, active: r.windows.map(w => w.active) }]));
check('rosters in order', out.map(r => r.label), ['Dan Key Target', 'Dan Key Prospect', 'Decision Makers']);
check('windows are 30, 60, 120', out[0].windows.map(w => w.days), [30, 60, 120]);
check('Dan Key Target', view.keyTarget, { total: 3, active: [1, 1, 1] });
check('Dan Key Prospect', view.keyProspect, { total: 2, active: [1, 2, 2] });
check('Decision Makers', view.decisionMakers, { total: 3, active: [1, 2, 3] });
check('percentages are whole', out[2].windows.map(w => w.pct), [33, 67, 100]);

// Window edges count.
{
  const edge = [{ id: 'e', email: 'e@acme.com', company: 'Acme Realty', dans_tags: 'Dan Key Target', notes_last_contacted: new Date(NOW - 30 * DAY).toISOString() }];
  const r = rosterActivityCounts({ contacts: edge, gates, myCdmGate, nowMs: NOW });
  check('exactly 30 days ago is inside the 30-day window', r[0].windows.map(w => w.active), [1, 1, 1]);
}

// Empty rosters.
{
  const r = rosterActivityCounts({ contacts: [], gates, myCdmGate, nowMs: NOW });
  check('an empty roster reports pct null', r.map(x => x.windows[0].pct), [null, null, null]);
  check('no gates yet means nothing counted', rosterActivityCounts({ contacts, gates: null, nowMs: NOW }).map(x => x.total), [0, 0, 0]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
