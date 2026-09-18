// Assertion tests for what the DMs contacts tab is a list OF.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/decisionMakersRoster.test.mjs
//
// The tab is the All Contacts page with a different front gate, so the two
// things worth pinning are the gate and the count over it.
//
// THE GATE. Tagged Decision Maker, minus the people every contacts page
// leaves out. "Left" is the one that matters most: a contact who has moved
// on is the opposite of a decision maker who can be rung, and leaving them
// in would mark an account covered by somebody who is not there. Show Hidden
// inverts the Hide check and nothing else, so the review mode is the hidden
// decision makers rather than a second definition of one.
//
// THE COUNT. The All pill has to be every contact the page shows. A decision
// maker at an account on none of the four rosters is still a decision maker,
// and the roster coverage helper skips exactly those - so `countAll` is what
// keeps the pill and the table under it describing the same set. The other
// four pills stay what they are everywhere else, which is why they are
// checked here too rather than assumed.
import {
  isDecisionMakerContact, makeDecisionMakerGate,
} from '../src/utils/decisionMakerCoverage.js';
import { makeRosterGates, rosterTagCoverage } from '../src/utils/contactRosters.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
function ok(label, cond) { check(label, !!cond, true); }

const CDM = 'Dan Baldauf';
const contact = (id, tags, over = {}) => ({
  id: String(id), firstname: `C${id}`, lastname: 'X',
  email: `c${id}@acme.com`, company: 'Acme Corp', dans_tags: tags, ...over,
});

// ── the gate ─────────────────────────────────────────────────────────────
const dm = makeDecisionMakerGate();
ok('the tag alone puts somebody on the page', dm(contact(1, 'Decision Maker')));
ok('case and spacing in the tag string do not matter', dm(contact(2, 'ESG;decision maker')));
ok('a contact with other tags too is still one', dm(contact(3, 'Decision Maker;Met In Person')));
ok('no tag, no page', !dm(contact(4, 'ESG;Procurement')));
ok('no tags at all, no page', !dm(contact(5, '')));
ok('hidden is out', !dm(contact(6, 'Decision Maker;Hide')));
ok('and so is somebody who has left', !dm(contact(7, 'Decision Maker;Left')));
ok('a coworker was never one', !dm(contact(8, 'Decision Maker', { company: 'Schneider Electric' })));
ok('by email domain as well as by name',
  !dm(contact(9, 'Decision Maker', { company: 'Acme', email: 'x@se.com' })));

// The alternate spellings HubSpot and the bulk editor write the tag string
// under. All three are read, or a contact tagged through one path would be
// missing from a page built on another.
ok('dan_s_tags is read', dm({ id: '10', dan_s_tags: 'Decision Maker' }));
ok('dans_tag is read', dm({ id: '11', dans_tag: 'Decision Maker' }));

// Show Hidden inverts ONE check. Everything else holds, so the review list
// is hidden decision makers and not a looser definition of one.
const dmHidden = makeDecisionMakerGate({ showHidden: true });
ok('review mode shows the hidden ones', dmHidden(contact(12, 'Decision Maker;Hide')));
ok('and only the hidden ones', !dmHidden(contact(13, 'Decision Maker')));
ok('a hidden contact who is not a decision maker is still not one',
  !dmHidden(contact(14, 'ESG;Hide')));
ok('and somebody hidden who has also left stays out',
  !dmHidden(contact(15, 'Decision Maker;Hide;Left')));

// The exported plain case is the gate in its default mode - one definition,
// so the account mapping and this page cannot disagree about who counts.
for (const c of [contact(16, 'Decision Maker'), contact(17, 'Decision Maker;Hide'), contact(18, 'ESG')]) {
  check(`isDecisionMakerContact agrees with the gate for ${c.dans_tags || 'no tags'}`,
    isDecisionMakerContact(c), dm(c));
}

// ── the count over it ────────────────────────────────────────────────────
// One decision maker on a roster (tagged Dan Key Target), one on none at
// all, and one at a Don't Track account.
const prospects = [
  { company: 'Acme Corp', status: 'Prospect', cdm: CDM, tier: 'Tier 3' },
  { company: 'Untracked Inc', status: 'Client', cdm: CDM, emailDomain: 'untracked.com' },
];
const gates = makeRosterGates({
  prospects,
  cdmName: CDM,
  oppsRecords: [],
  clientStatusMap: {},
  clientUntrackedMap: { 'untracked inc': true },
  showHidden: false,
});

const onKey = contact(20, 'Decision Maker;Dan Key Target');
const offRoster = contact(21, 'Decision Maker');
const atUntracked = contact(22, 'Decision Maker', { company: 'Untracked Inc', email: 'c22@untracked.com' });
const decisionMakers = [onKey, offRoster, atUntracked];

const counted = rosterTagCoverage({ contacts: decisionMakers, gates, countAll: true });
check('every decision maker the page shows is in the All bucket', counted.all.contacts, 2);
check('the Key pill is the ones who are also Key', counted.key.contacts, 1);
check('a decision maker on no roster is in none of the roster buckets',
  [counted.active.contacts, counted.client.contacts, counted.keyProspect.contacts], [0, 0, 0]);
check('the Don\'t Track account is named rather than silently dropped', counted.untracked, 1);
check('and it is not in the total', counted.all.people.map(p => p.id).sort(), ['20', '21']);

// Without the flag the helper keeps its old meaning - the union of the four
// rosters - which is what All Contacts and the Prospecting ladder read.
const union = rosterTagCoverage({ contacts: decisionMakers, gates });
check('by default All is still the roster union, not everyone handed in',
  union.all.contacts, 1);
check('and the roster buckets are unchanged by the flag',
  [union.key.contacts, counted.key.contacts], [1, 1]);
check('the account exclusion is counted either way', union.untracked, 1);

// The off-roster note on the page is counted, not subtracted: the pills
// overlap, so the total minus their sum is not that number.
const offRosterCount = decisionMakers
  .filter(c => isDecisionMakerContact(c) && !gates.clientExclusionOf(c))
  .filter(c => gates.categorize(c).length === 0).length;
check('one of these decision makers is on no roster', offRosterCount, 1);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
