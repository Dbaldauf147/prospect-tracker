// Assertion tests for what the page says about Granola and the calendar.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/granolaCalendar.test.mjs
//
// describeGranolaCalendar carries the answer to the question this panel
// keeps being asked: Granola is sitting in these meetings and syncing
// this calendar, so why is the list empty? Getting that sentence wrong
// costs the user a retry loop against an API that will never serve the
// thing they are retrying for, so the wording is pinned here rather than
// left to the component.
//
// It lives in granolaShape.js, the import-free module, for the same
// reason diagnoseEmptySync does: granolaCalls.js pulls in apiFetch,
// which initialises Firebase on import, and this wording is worth
// pinning under plain Node.

import { describeGranolaCalendar } from '../src/utils/granolaShape.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
function has(actual, needle, name) {
  if (String(actual).includes(needle)) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        "${actual}"\n        does not contain "${needle}"`); }
}

// Nothing has been asked yet.
eq(describeGranolaCalendar({}), '', 'before anything is asked, nothing is claimed');

// Granola served a calendar and it had meetings in it: the list speaks
// for itself.
eq(
  describeGranolaCalendar({ supported: true, events: 4 }),
  '',
  'a calendar with meetings on it needs no explaining',
);
eq(
  describeGranolaCalendar({ supported: true, events: 0 }),
  'Granola served a calendar, but it holds no meetings in this window.',
  'a served-but-empty calendar is distinguishable from an unserved one',
);

// The case this is really for: every candidate path 404s.
const unsupported = describeGranolaCalendar({
  supported: false,
  attempts: [
    { path: '/calendar/events', status: 404 },
    { path: '/calendar-events', status: 404 },
    { path: '/events', status: 404 },
    { path: '/meetings', status: 404 },
  ],
});
has(unsupported, 'doesn’t serve your calendar', 'an absent endpoint is reported as absent');
has(unsupported, 'already happened', 'and it says WHY: notes are of meetings that are over');
has(unsupported, 'can’t come from Granola', 'and it does not leave the user retrying for something unreachable');

// A key problem is not the same as a missing endpoint, and the fixes
// differ — one is a new key, the other is nothing the user can do.
has(
  describeGranolaCalendar({ supported: false, attempts: [{ path: '/calendar/events', status: 401 }] }),
  'rejected the API key',
  'a rejected key says so rather than blaming the endpoint',
);
has(
  describeGranolaCalendar({ supported: false, attempts: [{ path: '/calendar/events', status: 403 }] }),
  'isn’t allowed to read a calendar',
  'an under-scoped key says so rather than blaming the endpoint',
);
eq(
  describeGranolaCalendar({ error: 'Granola didn’t respond within 20s.' }),
  'Granola calendar: Granola didn’t respond within 20s.',
  'a transport failure is reported as itself, not as a missing feature',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
