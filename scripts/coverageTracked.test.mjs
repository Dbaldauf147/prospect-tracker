// Assertion tests for "is this service one the Pipeline page tracks coverage
// on?" Plain Node — no test framework (the project has none). Run:
//   node scripts/coverageTracked.test.mjs
//
// This is the join behind the star every service board now shows. It is a
// one-line comparison and it is exactly the kind that goes wrong quietly:
//
//   * The coverage table stores canonical service names; the boards list the
//     same strings but with their own trimming and casing. Compare them raw
//     and half the marks silently never appear.
//   * It has to be an EXACT name match. Anything looser — a substring, a
//     token overlap — would star "Local Law 88" because "Local Law 97" is
//     tracked, which is a mark that lies about what is being measured.
//   * A user with no coverage table set up must get no marks at all, not a
//     crash and not a board where everything looks tracked.

import {
  coverageServicesOf, coverageTrackedSet, isCoverageTracked,
} from '../src/utils/pipelineDashboardStore.js';

let failures = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); return; }
  failures += 1;
  console.log(`FAIL  ${label}`);
}
function eq(label, actual, expected) {
  check(`${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

// --- reading the list off the dashboard record ----------------------------

eq('a saved dashboard yields its tracked services',
  coverageServicesOf({ coverageServices: ['LEED', 'SE metering'] }), ['LEED', 'SE metering']);
eq('no dashboard yet is nothing tracked', coverageServicesOf(null), []);
eq('a dashboard with no coverage table is nothing tracked', coverageServicesOf({}), []);
eq('junk entries are dropped rather than reaching the boards',
  coverageServicesOf({ coverageServices: ['LEED', '', null, 7, 'SE metering'] }), ['LEED', 'SE metering']);

// --- the lookup the boards use --------------------------------------------

const tracked = coverageTrackedSet({ coverageServices: ['LEED', 'SE metering', '  Sensor audit  '] });

check('a tracked service is marked', isCoverageTracked(tracked, 'LEED'));
check('casing does not matter — the boards and the table trim and case alike',
  isCoverageTracked(tracked, 'se metering'));
check('nor does surrounding whitespace', isCoverageTracked(tracked, '  LEED '));
check('a stored value with whitespace still matches a clean name',
  isCoverageTracked(tracked, 'Sensor audit'));
check('an untracked service is not marked', isCoverageTracked(tracked, 'Bill Pay') === false);

// The mark says "this exact service is being measured". A looser match would
// star a service that no coverage row is counting.
check('a service that merely contains a tracked name is not marked',
  isCoverageTracked(coverageTrackedSet(['Local Law 97']), 'Local Law 977') === false);
check('nor one a tracked name contains',
  isCoverageTracked(coverageTrackedSet(['LEED certification']), 'LEED') === false);

// Nothing here should be able to put a mark on a nameless row or fall over on
// a board that renders before the dashboard has loaded.
check('a blank name is never tracked', isCoverageTracked(tracked, '') === false);
check('an undefined name is never tracked', isCoverageTracked(tracked, undefined) === false);
check('no set at all is never tracked', isCoverageTracked(undefined, 'LEED') === false);
check('an empty set marks nothing', isCoverageTracked(coverageTrackedSet([]), 'LEED') === false);

// The hook builds the set from a list; the store builds it from the record.
// Both have to land in the same place.
eq('a list and a record build the same set',
  [...coverageTrackedSet(['LEED'])], [...coverageTrackedSet({ coverageServices: ['LEED'] })]);

console.log(failures === 0 ? '\nAll coverage-tracked tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
