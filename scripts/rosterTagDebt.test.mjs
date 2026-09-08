// The two ends of the tag-mapping rule: which rosters still owe answers,
// and whether there are any left to owe.
//
// They are read by different things — the sidebar badge and the Prospecting
// page's Tagged row count the debt, the ladder's contact-mapping step clears
// itself on the other — and the reason they are separate functions is the
// case that makes them disagree: a roster with no contacts has no percentage,
// which is not a debt and is not finished either.

import { missingTagRosters, tagsAllMapped } from '../src/utils/contactRosters.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// Coverage as rosterTagCoverage reports it: `pct` is null for a roster with
// nobody on it. `all` and `active` are along for the ride — neither counts
// (all is the union of the others, active is a rolling window).
const cov = ({ key = null, client = null, keyProspect = null, active = 42, all = 50 }) => ({
  all: { contacts: 10, pct: all },
  key: { contacts: key == null ? 0 : 5, pct: key },
  active: { contacts: 4, pct: active },
  client: { contacts: client == null ? 0 : 6, pct: client },
  keyProspect: { contacts: keyProspect == null ? 0 : 3, pct: keyProspect },
});

const ALL_MAPPED = cov({ key: 100, client: 100, keyProspect: 100 });

eq(tagsAllMapped(ALL_MAPPED), true, 'Key, Client and Key Prospect all at 100% is finished');
eq(missingTagRosters(ALL_MAPPED).length, 0, 'and nothing is short');

eq(tagsAllMapped(cov({ key: 100, client: 78, keyProspect: 100 })), false,
  'one roster short of 100% is not finished');
eq(missingTagRosters(cov({ key: 100, client: 78, keyProspect: 100 })).map(r => r.key), ['client'],
  'and that is the roster the debt names');

// Active is deliberately out of both: it is whoever has been in touch
// lately, so it would never read as done.
eq(tagsAllMapped(cov({ key: 100, client: 100, keyProspect: 100, active: 12 })), true,
  'a part-tagged Active roster does not hold the answer back');

// The two cases the debt count can't tell apart, which is why this is its
// own function: nothing loaded, and nothing to score.
eq(tagsAllMapped(null), null, 'no coverage yet is unknown, not finished');
eq(tagsAllMapped(cov({})), false, 'an empty book proves nothing, so it falls back to being marked by hand');
eq(missingTagRosters(cov({})).length, 0, 'even though it owes no debt either');

// A roster nobody is on doesn't drag the answer down when the others are done.
eq(tagsAllMapped(cov({ key: 100, client: 100 })), true,
  'a roster with no contacts on it is not something left to tag');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
