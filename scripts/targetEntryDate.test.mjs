// Assertion tests for reading the Target Accounts List's entry date (the
// Account MRI's "Assigned since"). Plain Node. Run:
//   node scripts/targetEntryDate.test.mjs
import { targetEntryDateColumn, parseEntryDate, targetEntryDates, entryDateFor } from '../src/utils/targetEntryDate.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}

eq(targetEntryDateColumn(['Account Name', 'Tier', 'Entry Date']), 'Entry Date', 'Entry Date header');
eq(targetEntryDateColumn(['Account', 'Date Entered']), 'Date Entered', 'Date Entered header');
eq(targetEntryDateColumn(['Account', 'entry date (list)']), 'entry date (list)', 'any case, extra words');
eq(targetEntryDateColumn(['Account', 'Entered By', 'Tier']), '', 'Entered By is a person, not a date');
eq(targetEntryDateColumn(['Account', 'Tier']), '', 'no such column');

eq(parseEntryDate('2025-03-14'), '2025-03-14', 'ISO');
eq(parseEntryDate('3/14/2025'), '2025-03-14', 'US date');
eq(parseEntryDate('3/14/25'), '2025-03-14', 'two-digit year');
eq(parseEntryDate('45730'), '2025-03-14', 'spreadsheet day number');
eq(parseEntryDate('Mar 14, 2025'), '2025-03-14', 'written date');
eq(parseEntryDate('13/45/2025'), '', 'not a real day');
eq(parseEntryDate('12'), '', 'a small number is not a date');
eq(parseEntryDate(''), '', 'blank');
eq(parseEntryDate('TBD'), '', 'text');

const data = {
  sheetNames: ['Tier 1-3', 'Other'],
  sheets: {
    'Tier 1-3': { headers: ['Account Name', 'Tier', 'Entry Date'], records: [
      { 'Account Name': 'BlackRock, Inc.', Tier: 'Tier 2', 'Entry Date': '45730' },
      { 'Account Name': 'Acme', Tier: 'Tier 1', 'Entry Date': '' },
    ] },
    Other: { headers: ['Account Name', 'Date Entered'], records: [
      { 'Account Name': 'BlackRock, Inc.', 'Date Entered': '1/2/2024' },
      { 'Account Name': 'Zeta Corp', 'Date Entered': '2026-06-01' },
    ] },
  },
};
const dates = targetEntryDates(data);
eq(dates.get('blackrock, inc.'), '2024-01-02', 'earliest date across rows');
eq(dates.has('acme'), false, 'a blank date is left out');
eq(entryDateFor(dates, { targetNames: ['Zeta Corp'], company: 'Zeta' }), '2026-06-01', 'through the mapped target name');
eq(entryDateFor(dates, { company: 'BlackRock Inc' }), '2024-01-02', 'by its own name, loosely');
eq(entryDateFor(dates, { company: 'Nobody' }), '', 'not on the list');
eq(entryDateFor(targetEntryDates(null), { company: 'Zeta Corp' }), '', 'no list loaded');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
