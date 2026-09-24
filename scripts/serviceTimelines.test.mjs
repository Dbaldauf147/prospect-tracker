// Assertion tests for utils/serviceTimelines.js: which timeline-driven
// services the Flags column warns about.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/serviceTimelines.test.mjs
import { missingServiceTimelines, timelineRowAnswered, isServiceTimelineRow } from '../src/utils/serviceTimelines.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; } else { failed++; console.error(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}

const services = ['RFP', 'Bill payment', 'Strategic sourcing', 'Budgets (account level)', 'BBS reporting'];
const row = (type, extra = {}) => ({ type, value: '', kickoff: '', leadTime: '', hidden: false, ...extra });

eq(missingServiceTimelines([], services), services, 'with no rows, every timeline-driven service is missing, not only Budgets');
eq(missingServiceTimelines(services.map(s => row(s)), services), services, 'seeded blank rows are still missing');
eq(
  missingServiceTimelines([row('RFP', { kickoff: '2026-10-09' }), row('bill PAYMENT', { value: 'Q3' }), row('Strategic sourcing', { hidden: true })], services),
  ['Budgets (account level)', 'BBS reporting'],
  'a kickoff or details answers a row (any casing), and a hidden row is not warned about',
);
eq(missingServiceTimelines([row('Other', { value: 'x' })], ['RFP']), ['RFP'], 'a row for another type does not answer a service');
eq(missingServiceTimelines(null, null), [], 'nothing in, nothing missing');
eq(timelineRowAnswered(row('RFP', { leadTime: '6 weeks' })), false, 'a lead time alone is the catalog default, not a timeline');
eq(isServiceTimelineRow(row('rfp'), services), true, 'a row named after a Scope service is a service row');
eq(isServiceTimelineRow(row('Something I added'), services), false, 'a row the user added is not');
eq(isServiceTimelineRow(row(''), services), false, 'an untyped row is not');

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
