// Assertion tests for the Email Campaign Tracker's per-contact hold / avoid.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/campaignContactHold.test.mjs
//
// What's worth pinning: a hold lifts on its own on the day after the date it
// names, an avoid never lifts, an existing roster (no outreach field at all)
// is contactable, and — the one that decides whether anybody gets an email
// they asked not to get — "don't contact" never reads as "contact" because a
// date was missing or malformed.
import {
  CONTACT_HOLD_DAYS, contactHoldUntil, isContactAvoided, isContactOnHold,
  contactOutreach, canEmailContact, contactOutreachLabel, outreachCounts,
  outreachPatch,
} from '../src/utils/campaignContactHold.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const now = Date.parse('2026-09-11T10:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

// --- the default: nothing set ------------------------------------------
// Every contact saved before this existed has no outreach field at all.
check('a plain contact is contactable', canEmailContact({ email: 'sam@acme.com' }, now), true);
check('a plain contact has no state', contactOutreach({ email: 'sam@acme.com' }, now), 'open');
check('a plain contact has no label', contactOutreachLabel({ email: 'sam@acme.com' }, now), '');
check('an empty outreach is contactable', canEmailContact({ outreach: '' }, now), true);
check('an undefined contact is contactable', canEmailContact(undefined, now), true);

// --- hold ---------------------------------------------------------------
const held = { outreach: 'hold', holdUntil: '2026-09-25' };
check('a live hold holds', isContactOnHold(held, now), true);
check('a live hold blocks the email', canEmailContact(held, now), false);
check('a live hold is labelled', contactOutreachLabel(held, now), 'On hold');
// The date names the last day held, so it covers that whole day.
check('held through the named day', isContactOnHold(held, Date.parse('2026-09-25T23:00:00Z')), true);
check('free the morning after', isContactOnHold(held, Date.parse('2026-09-26T08:00:00Z')), false);
check('a lifted hold is contactable', canEmailContact(held, Date.parse('2026-10-01T08:00:00Z')), true);
check('a lifted hold shows nothing', contactOutreachLabel(held, Date.parse('2026-10-01T08:00:00Z')), '');
// A hold the user set with no date, or one whose date got mangled, is a
// standing "not yet" — it must never read as "go ahead".
check('a hold with no date holds', isContactOnHold({ outreach: 'hold' }, now), true);
check('a hold with a junk date holds', isContactOnHold({ outreach: 'hold', holdUntil: 'next tuesday' }, now), true);
check('a full timestamp works too', isContactOnHold({ outreach: 'hold', holdUntil: '2026-09-12T09:00:00Z' }, now), true);

// --- avoid --------------------------------------------------------------
const avoided = { outreach: 'avoid' };
check('avoid blocks the email', canEmailContact(avoided, now), false);
check('avoid is not a hold', isContactOnHold(avoided, now), false);
check('avoid is flagged', isContactAvoided(avoided), true);
check('avoid is labelled', contactOutreachLabel(avoided, now), 'Avoid');
// No clock on it: a year later it still means no.
check('avoid never lifts', canEmailContact(avoided, now + 365 * DAY), false);
// Both reasons at once — the standing one is the one shown.
check('avoid outranks a live hold', contactOutreach({ outreach: 'avoid', holdUntil: '2026-09-25' }, now), 'avoid');

// --- the default hold length --------------------------------------------
const until = contactHoldUntil(now);
check('the default hold is a plain date', /^\d{4}-\d{2}-\d{2}$/.test(until), true);
check('the default hold runs two weeks', until, '2026-09-25');
check('two weeks is what it says', CONTACT_HOLD_DAYS, 14);
check('the default hold is live', isContactOnHold({ outreach: 'hold', holdUntil: until }, now), true);
check('and lifts when it says', isContactOnHold({ outreach: 'hold', holdUntil: until }, now + 15 * DAY), false);

// --- what a change writes ------------------------------------------------
check('holding stamps the default date', outreachPatch({}, 'hold', now), { outreach: 'hold', holdUntil: '2026-09-25' });
check('holding keeps a date already set',
  outreachPatch({ outreach: 'hold', holdUntil: '2026-10-02' }, 'hold', now), { outreach: 'hold', holdUntil: '2026-10-02' });
check('a junk date is replaced, not kept',
  outreachPatch({ outreach: 'hold', holdUntil: 'soon' }, 'hold', now), { outreach: 'hold', holdUntil: '2026-09-25' });
check('avoiding clears the hold date',
  outreachPatch({ outreach: 'hold', holdUntil: '2026-10-02' }, 'avoid', now), { outreach: 'avoid', holdUntil: '' });
check('clearing clears both',
  outreachPatch({ outreach: 'hold', holdUntil: '2026-10-02' }, '', now), { outreach: '', holdUntil: '' });
check('an unknown state reads as cleared', outreachPatch({}, 'nonsense', now), { outreach: '', holdUntil: '' });

// --- the roster roll-up ---------------------------------------------------
const roster = [
  { email: 'a@x.com' },
  { email: 'b@x.com', outreach: 'hold', holdUntil: '2026-09-25' },
  { email: 'c@x.com', outreach: 'hold', holdUntil: '2026-08-01' }, // lifted
  { email: 'd@x.com', outreach: 'avoid' },
  { email: 'e@x.com', outreach: '' },
];
check('the roll-up counts each once', outreachCounts(roster, now), { onHold: 1, avoided: 1, blocked: 2, open: 3 });
check('an empty roster', outreachCounts([], now), { onHold: 0, avoided: 0, blocked: 0, open: 0 });
check('no roster at all', outreachCounts(undefined, now), { onHold: 0, avoided: 0, blocked: 0, open: 0 });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
