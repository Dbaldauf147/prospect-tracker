// The Excel download behind Prospecting History's "Contacts with activity"
// charts (utils/rosterActivityExport). Plain Node. Run:
//   node scripts/rosterActivityExport.test.mjs
import assert from 'node:assert/strict';
import { activityBand, rosterActivityWorkbook } from '../src/utils/rosterActivityExport.js';

const DAY = 86400000;
const NOW = new Date(2026, 9, 16, 12).getTime();

// Bands match the chart's windows, edges inclusive.
assert.equal(activityBand(NOW - 30 * DAY, NOW), 'Last 30 days');
assert.equal(activityBand(NOW - 31 * DAY, NOW), '31-90 days');
assert.equal(activityBand(NOW - 120 * DAY, NOW), '91-120 days');
assert.equal(activityBand(NOW - 121 * DAY, NOW), 'No activity in 120 days');
assert.equal(activityBand(null, NOW), 'No activity in 120 days');

const data = [
  { iso: '2026-10-15', weekday: 'Thu', recorded: true, total: 10, w30: 3, w60: 4, w90: 5, w120: 6 },
  { iso: '2026-10-16', weekday: 'Fri', recorded: true, total: 10, w30: 4, w60: 5, w90: 6, w120: 6 },
  { iso: '2026-10-19', weekday: 'Mon', recorded: false, total: null, w30: null, w60: null, w90: null, w120: null },
];
const people = [
  { contact: { name: 'Old Timer', email: 'o@x.com' }, lastMs: null },
  { contact: { firstname: 'Ann', lastname: 'Lee', email: 'a@x.com', company: 'Acme', jobtitle: 'CFO' }, lastMs: NOW - 2 * DAY },
  { contact: { name: 'Bo', email: 'b@x.com' }, lastMs: NOW - 45 * DAY },
];

const wb = rosterActivityWorkbook({ label: 'Dan Key Target', day: data[1], data, people, today: '2026-10-16', nowMs: NOW });
assert.equal(wb.filename, 'dan-key-target-activity-2026-10-16.xlsx');
assert.deepEqual(wb.sheets.map(s => s.name), ['Summary', 'Contacts']);
const [summary, contacts] = wb.sheets.map(s => s.rows);
// The clicked day's bands, then every day on the chart.
assert.deepEqual(summary.find(r => r[0] === 'Last 30 days'), ['Last 30 days', 4, 40]);
assert.deepEqual(summary.find(r => r[0] === '31-90 days'), ['31-90 days', 2, 20]);
assert.deepEqual(summary.find(r => r[0] === 'No activity in 120 days'), ['No activity in 120 days', 4, 40]);
assert.ok(!summary.some(r => String(r[0]).startsWith('The history keeps')), 'today needs no caveat');
assert.deepEqual(summary.find(r => r[0] === '2026-10-15').slice(0, 7), ['2026-10-15', 'Yes', 10, 3, 2, 1, 4]);
assert.deepEqual(summary.find(r => r[0] === '2026-10-19').slice(0, 3), ['2026-10-19', 'No', null]);
// Contacts: newest activity first, nobody-reached last.
assert.deepEqual(contacts[0], ['Name', 'Email', 'Company', 'Title', 'Phone', 'Last activity', 'Days since', 'Band']);
assert.deepEqual(contacts.slice(1).map(r => [r[0], r[6], r[7]]), [
  ['Ann Lee', 2, 'Last 30 days'], ['Bo', 45, '31-90 days'], ['Old Timer', null, 'No activity in 120 days'],
]);

// An earlier day says the people are today's.
const past = rosterActivityWorkbook({ label: 'Dan Key Target', day: data[0], data, people, today: '2026-10-16', nowMs: NOW });
assert.ok(past.sheets[0].rows.some(r => String(r[0]).startsWith('The history keeps')));
assert.equal(past.filename, 'dan-key-target-activity-2026-10-15.xlsx');
// A day not recorded still downloads, saying so.
const none = rosterActivityWorkbook({ label: 'Decision Makers', day: data[2], data, people, today: '2026-10-16', nowMs: NOW });
assert.ok(none.sheets[0].rows.some(r => r[0] === 'Not recorded'));

console.log('rosterActivityExport: all assertions passed');
