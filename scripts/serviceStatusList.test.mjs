// Assertion tests for the editable service status list (the company card's
// service status dropdowns). Plain Node. Run:
//   node scripts/serviceStatusList.test.mjs
import { SERVICE_STATUSES } from '../src/data/enums.js';
import { DROPDOWN_LISTS } from '../src/data/dropdownLists.js';
import {
  cleanServiceStatusList, serviceStatusOptions, serviceStatusesPatch, isLockedServiceStatus, SERVICE_STATUS_LIST_KEY,
  publishServiceStatuses, currentServiceStatuses, subscribeServiceStatuses,
} from '../src/utils/serviceStatusList.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`); }
}

eq(serviceStatusOptions({}), SERVICE_STATUSES, 'nothing saved: the built-in list');
eq(DROPDOWN_LISTS.find(l => l.key === SERVICE_STATUS_LIST_KEY)?.options, SERVICE_STATUSES, 'on the Dropdowns page as a built-in list');
eq(serviceStatusOptions({ dropdownLists: { serviceStatuses: ['-', 'Sold', 'Pilot', 'Not Sold', 'N/A'] } }), ['-', 'Sold', 'Pilot', 'Not Sold', 'N/A'], 'a saved list, in its order');
eq(cleanServiceStatusList(['Pilot', ' sold ', '', 'Pilot', 'pilot', '-']), ['-', 'Pilot', 'Sold', 'Not Sold', 'N/A'], 'tidied: blanks and repeats out, locked spelled right, - first, missing locked added');
eq(cleanServiceStatusList([]), ['-', 'Sold', 'Not Sold', 'N/A'], 'an emptied list keeps the locked ones');
eq(isLockedServiceStatus('not sold'), true, 'locked, any case');
eq(isLockedServiceStatus('Quoting'), false, 'not locked');
eq(serviceStatusesPatch({ dropdownLists: { vertical: ['A'] } }, ['Pilot']), { dropdownLists: { vertical: ['A'], serviceStatuses: ['-', 'Pilot', 'Sold', 'Not Sold', 'N/A'] } }, 'the patch keeps the other lists');

// The live list other pages read.
eq(currentServiceStatuses(), SERVICE_STATUSES, 'live list starts as the built-in one');
let calls = 0;
const off = subscribeServiceStatuses(() => { calls++; });
publishServiceStatuses({});
eq(calls, 0, 'publishing the same list tells nobody');
publishServiceStatuses({ dropdownLists: { serviceStatuses: ['-', 'Pilot', 'Sold', 'Not Sold', 'N/A'] } });
eq([calls, currentServiceStatuses()], [1, ['-', 'Pilot', 'Sold', 'Not Sold', 'N/A']], 'an edit reaches subscribers');
const same = currentServiceStatuses();
publishServiceStatuses({ dropdownLists: { serviceStatuses: ['-', 'Pilot', 'Sold', 'Not Sold', 'N/A'] } });
eq(currentServiceStatuses() === same, true, 'unchanged list keeps the same array');
off();
publishServiceStatuses({});
eq(calls, 1, 'unsubscribed');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
