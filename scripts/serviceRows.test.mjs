// Assertion tests for the shared service-row builder.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/serviceRows.test.mjs
//
// Three separate things have to agree about what a service IS — its name
// (the Solutions dropdown), its metadata (seed catalog + the user's
// overrides), and the board box it lives in — and until this existed the
// Services subtab assembled them itself. The Deal Sizing subtab now prices
// against the same rows, and two assemblies would let them drift: a service
// that is "recurring over 3 years" on one page and a one-off project on the
// other prices to two different deals from the same rate.
//
// So what is worth pinning here is not the mapping (which is three lines) but
// the three inputs actually reaching it, and a retired service being out.
import { buildServiceRows, pricedServiceRows } from '../src/utils/serviceRows.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`PASS  ${label}`); }
  else { failures += 1; console.log(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`); }
}

// The shipped vocabulary, with no settings at all — what a new user sees.
const seeded = buildServiceRows({});
check('the seed catalog builds rows', seeded.length > 0, true);
check('every row carries a name, metadata and a bucket',
  seeded.every(r => r.name && r.meta && typeof r.bucket === 'string'), true);

// Metadata reaches the row: serviceType and years are what decide whether a
// fee recurs and for how long, which is the difference between a $60k/yr
// service and a $60k job.
const withMeta = seeded.find(r => r.meta?.serviceType);
check('metadata comes through on the row',
  Boolean(withMeta && withMeta.meta.serviceType), true);

// A user override beats the seed catalog. This is the one that would silently
// misprice a deal if it stopped working: the override is where a service's
// term is corrected, and a stale 1-year term understates a 3-year contract by
// two thirds.
const target = seeded[0].name;
const overridden = buildServiceRows({
  serviceOverrides: { [target]: { serviceType: 'Recurring', years: '5 years' } },
});
check('an override beats the seed catalog',
  overridden.find(r => r.name === target)?.meta?.years, '5 years');

// A retired service is out of the Scope picker everywhere else, so it cannot
// be in a deal — pricing or estimating it would be money against a service
// nobody can sell.
check('a hidden service is still in the full list',
  buildServiceRows({ hiddenServices: [target] }).some(r => r.name === target), true);
check('but is out of the priced list',
  pricedServiceRows({ hiddenServices: [target] }).some(r => r.name === target), false);
check('and hiding one drops exactly one row',
  seeded.length - pricedServiceRows({ hiddenServices: [target] }).length, 1);
check('nothing hidden, nothing dropped',
  pricedServiceRows({}).length, seeded.length);

// No settings object at all — the same as a user who has never touched the
// dropdowns page, and not a crash.
check('undefined settings behave as empty ones',
  buildServiceRows().length, seeded.length);

console.log(failures === 0 ? '\nAll service-row tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
