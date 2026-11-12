// Assertion tests for tagging a contact with a new event, and the newest-
// first order the contact popup lists events in. Plain Node.
//   node scripts/contactNewEvent.test.mjs
import { addContactToNewEvent, eventsNewestFirst, isContactInEvent } from '../src/utils/eventsStore.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const contact = { id: '42', firstname: 'Somalia', lastname: 'Jones', email: 'sj@x.com', company: 'White Oak', jobtitle: 'Manager' };
const existing = [{ id: 'e1', name: 'GRESB 2025', date: '2025-10-01', attendees: [] }];
const next = addContactToNewEvent(existing, { name: '  IMN Fall 2025 ', date: '2025-11-05' }, contact);
check('adds one event, keeps the rest', next.length, 2);
check('new event: name trimmed, date kept', [next[1].name, next[1].date], ['IMN Fall 2025', '2025-11-05']);
check('new event has the contact on it', isContactInEvent(next[1], '42'), true);
check('the old event is untouched', next[0], existing[0]);
check('blank name adds nothing', addContactToNewEvent(existing, { name: '  ' }, contact), existing);
check('no contact id adds nothing', addContactToNewEvent(existing, { name: 'X' }, {}), existing);

const order = eventsNewestFirst([
  { id: 'a', name: 'Old', date: '2024-01-01' },
  { id: 'b', name: 'Undated' },
  { id: 'c', name: 'New', date: '2026-03-01' },
]).map(e => e.id);
check('newest first, undated last', order, ['c', 'a', 'b']);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nAll passed');
