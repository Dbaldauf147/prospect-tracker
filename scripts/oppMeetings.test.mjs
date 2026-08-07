// Assertion tests for the Granola meetings the Agents page's Activity
// table picks up. Plain Node — no test framework (the project has none).
// Run:
//   node scripts/oppMeetings.test.mjs
//
// Two rules carry the feature and both are easy to get quietly wrong: only
// meetings that tie to an opportunity belong on this table, and a call that
// HubSpot already logged must not appear twice because Granola also sat in
// it. Everything below is one of those two.
import { oppMeetingsFromRecords, withUnloggedGranolaMeetings } from '../src/utils/granolaMeetings.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// A local-time day, so the window matches how boundsForDate builds one.
const DAY = new Date(2026, 7, 7);
const start = DAY.getTime();
const end = start + 24 * 60 * 60 * 1000;
const at = (h, m = 0) => new Date(2026, 7, 7, h, m).toISOString();

const record = (over = {}) => ({
  source: 'granola',
  id: 'rec1',
  owner: { email: 'me@se.com' },
  attendees: [
    { name: 'Me', email: 'me@se.com' },
    { name: 'Dana Rowe', email: 'dana@acme.com' },
  ],
  calendarEvent: { title: 'Acme renewal call', start: at(10), end: at(11), location: 'Teams' },
  granolaUrl: 'https://granola.example/n/1',
  ...over,
});

// An opp matcher in the shape the page's findOppForRecipient returns.
const ACME = { account: 'Acme Industrial', bfoOpp: 'Acme Industrial - Retail Power', raw: { id: 1 } };
const resolveAcme = (email, company) => (
  String(email).endsWith('@acme.com') || /acme/i.test(String(company)) ? ACME : null
);
const resolveNothing = () => null;

const run = (records, opts = {}) => oppMeetingsFromRecords(records, {
  start, end, resolve: resolveAcme, bfoUrlFor: () => 'https://bfo/opp/1', ...opts,
});

// ---- tied to an opp -----------------------------------------------------

{
  const rows = run({ rec1: record() });
  eq(rows.length, 1, 'a call that ties to an opp becomes a row');
  eq(rows[0].bfoOpp, 'Acme Industrial - Retail Power', 'the row carries the matched opportunity');
  eq(rows[0].company, 'Acme Industrial', "the row's company is the opp's account");
  eq(rows[0].title, 'Acme renewal call', 'the row is titled from the calendar event');
  eq([rows[0].ts, rows[0].endTs], [at(10), at(11)], 'the row keeps the meeting start and end');
  eq(rows[0].source, 'granola', 'the row is tagged with where it came from');
  eq(rows[0].granolaUrl, 'https://granola.example/n/1', 'the note link travels with the row');
  eq(rows[0].bfoUrl, 'https://bfo/opp/1', 'the matched opp supplies the BFO link');
  eq(rows[0].attendees, 'Dana Rowe', 'attendees are the external ones only — colleagues are not who it was with');
}

eq(run({ rec1: record() }, { resolve: resolveNothing }).length, 0,
  'a call that ties to nothing is left off — this table is work against the pipeline');

eq(run({
  rec1: record({
    attendees: [{ name: 'Me', email: 'me@se.com' }, { name: 'Colleague', email: 'pat@se.com' }],
    calendarEvent: { title: 'Weekly team stand-up', start: at(9) },
  }),
}).length, 0,
  'an internal stand-up ties to nothing and is left off');

// The title fallback cuts both ways, and deliberately: an internal call
// ABOUT a customer is still work against that customer's opportunity, and
// the HubSpot meetings on this table match on their title the same way.
eq(run({
  rec1: record({
    attendees: [{ name: 'Me', email: 'me@se.com' }, { name: 'Colleague', email: 'pat@se.com' }],
    calendarEvent: { title: 'Acme renewal prep', start: at(9) },
  }),
}).length, 1,
  'an internal call whose title names a customer ties to that opp');

// The widening walk: no matchable attendee, but the title names the customer.
eq(run({
  rec1: record({
    attendees: [{ name: 'Me', email: 'me@se.com' }, { name: 'Guest', email: 'guest@unknown.io' }],
    calendarEvent: { title: 'Acme quarterly review', start: at(9) },
  }),
}).length, 1, 'a customer named only in the title still resolves');

// ---- the day window, the ignore list, overrides -------------------------

eq(run({ rec1: record({ calendarEvent: { title: 'Acme call', start: new Date(2026, 7, 6, 10).toISOString() } }) }).length, 0,
  'a call from another day is outside the window');
eq(run({ rec1: record({ calendarEvent: { title: 'Acme call', start: new Date(2026, 7, 8, 0, 1).toISOString() } }) }).length, 0,
  'the window ends at midnight, exclusive');
eq(run({ rec1: record({ calendarEvent: { title: 'Acme call', start: at(0, 0) } }) }).length, 1,
  'a call at midnight is inside the day it starts');

eq(run({ rec1: record() }, { isIgnored: (id) => id === 'rec1' }).length, 0,
  'a meeting the user dismissed stays dismissed');

{
  // The override key is the first external attendee's email.
  const rows = run({ rec1: record() }, {
    overrides: { 'dana@acme.com': { account: 'Beta Foods', bfoOpp: 'Beta Foods - Gas' } },
  });
  eq([rows[0].bfoOpp, rows[0].company, rows[0].isManual], ['Beta Foods - Gas', 'Beta Foods', true],
    'a manual tag beats the automatic match');
}
{
  // No external attendee to key on — falls back to the meeting id, and an
  // override there rescues a call that matched nothing.
  const rows = run({
    rec1: record({ attendees: [{ name: 'Me', email: 'me@se.com' }], calendarEvent: { title: 'Site walk', start: at(14) } }),
  }, {
    resolve: resolveNothing,
    overrides: { 'meeting:rec1': { account: 'Beta Foods', bfoOpp: 'Beta Foods - Gas' } },
  });
  eq([rows.length, rows[0]?.overrideKey, rows[0]?.bfoOpp], [1, 'meeting:rec1', 'Beta Foods - Gas'],
    'a call with no external attendee can still be tagged by hand');
}

{
  const rows = run({
    a: record({ id: 'a', calendarEvent: { title: 'Acme 3pm', start: at(15) } }),
    b: record({ id: 'b', calendarEvent: { title: 'Acme 9am', start: at(9) } }),
  });
  eq(rows.map(r => r.title), ['Acme 9am', 'Acme 3pm'], 'rows run in the order the day happened');
}

// ---- not twice for one meeting ------------------------------------------

const logged = [{ id: 'hs1', title: 'Acme renewal call', ts: at(10), bfoOpp: 'Acme Industrial - Retail Power' }];
const granola = [{ id: 'rec1', title: 'Acme renewal call', ts: at(10), source: 'granola' }];

eq(withUnloggedGranolaMeetings(logged, granola).map(r => r.id), ['hs1'],
  'a meeting HubSpot already logged keeps the logged copy and drops the Granola one');

eq(withUnloggedGranolaMeetings(logged, [{ ...granola[0], ts: at(10, 8) }]).map(r => r.id), ['hs1'],
  'the same meeting stamped a few minutes apart is still one meeting');

eq(withUnloggedGranolaMeetings(logged, [{ ...granola[0], ts: at(13) }]).map(r => r.id).sort(), ['hs1', 'rec1'],
  'the same title hours apart is two meetings, not one');

eq(withUnloggedGranolaMeetings(logged, [{ id: 'rec2', title: 'Beta pricing review', ts: at(14), source: 'granola' }])
  .map(r => r.id), ['hs1', 'rec2'],
  'a call nobody logged is added');

eq(withUnloggedGranolaMeetings(logged, [{ id: 'rec2', title: 'Beta pricing review', ts: at(8), source: 'granola' }])
  .map(r => r.id), ['rec2', 'hs1'],
  'the merged list is back in time order');

eq(withUnloggedGranolaMeetings(logged, []), logged,
  'nothing to add returns the logged list untouched');
eq(withUnloggedGranolaMeetings([], granola).map(r => r.id), ['rec1'],
  'with nothing logged, every Granola call is new');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
