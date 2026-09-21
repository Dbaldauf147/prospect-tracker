// Assertion tests for the per-service counts a deal carries - today that
// means project counts. Plain Node - no test framework (the project has
// none). Run:
//   node scripts/oppServiceUnits.test.mjs
//
// The rules worth pinning: a project count belongs to the service and to
// this deal (never to the account's card), a typed zero is an answer while
// a blank is not, a name re-cased later still finds its number and can
// never end up stored twice, an opp with no answers carries no field, and
// the boxes offered are whatever the rate card charges per project today.
import {
  serviceUnitsMap, serviceUnitsForScope, setServiceUnitValue, projectCountRows,
  SERVICE_UNITS_FIELD, COUNT_SOURCE_SERVICE,
} from '../src/utils/oppDealCounts.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const oppWith = (v) => ({ [SERVICE_UNITS_FIELD]: v });

// ── reading what is stored ───────────────────────────────────────────────
check('nothing stored reads empty', serviceUnitsMap({}), {});
check('junk reads empty', serviceUnitsMap(oppWith('not json')), {});
check('an array is not a map', serviceUnitsMap(oppWith('[1,2]')), {});
check('names are keyed without case', serviceUnitsMap(oppWith('{"LED Retrofit":3}')), { 'led retrofit': 3 });
// A zero is somebody saying "none of these", which is not the same as never
// having been asked.
check('a typed zero survives', serviceUnitsMap(oppWith('{"Retrofit":0}')), { retrofit: 0 });
check('a negative is not a count', serviceUnitsMap(oppWith('{"Retrofit":-2}')), {});
check('an object stores as well as a string', serviceUnitsMap(oppWith({ Retrofit: 2 })), { retrofit: 2 });

// ── handing them to the estimator ────────────────────────────────────────
// estimateScope looks a service up by its exact name, so the map it is
// given has to be spelled the way the scope spells it.
check('respelled to match the scope', serviceUnitsForScope(oppWith('{"led retrofit":3}'), ['LED Retrofit', 'GHG']),
  { 'LED Retrofit': 3 });
check('a service out of scope is left out', serviceUnitsForScope(oppWith('{"Retrofit":3}'), ['GHG']), null);
check('nothing stored hands over nothing', serviceUnitsForScope({}, ['GHG']), null);

// ── writing one ──────────────────────────────────────────────────────────
check('an answer is stored under the name given', setServiceUnitValue({}, 'LED Retrofit', 3), '{"LED Retrofit":3}');
check('a zero is stored', setServiceUnitValue({}, 'Retrofit', 0), '{"Retrofit":0}');
// Clearing the box is "nobody has said", which prices the service on its
// fallback again rather than on a nought.
check('null clears it', setServiceUnitValue(oppWith('{"Retrofit":3}'), 'Retrofit', null), '');
check('and leaves the others alone',
  setServiceUnitValue(oppWith('{"Retrofit":3,"Chiller":1}'), 'Retrofit', null), '{"Chiller":1}');
// The stored spelling is replaced, never doubled up.
check('a re-cased name replaces rather than duplicates',
  setServiceUnitValue(oppWith('{"retrofit":3}'), 'Retrofit', 5), '{"Retrofit":5}');
check('a blank name changes nothing', setServiceUnitValue(oppWith('{"Retrofit":3}'), '  ', 5), '{"Retrofit":3}');

// ── the boxes ────────────────────────────────────────────────────────────
// Lines as estimateScope returns them: the per-project ones are picked out
// by their basis, not by anything a caller lists.
const lines = [
  {
    name: 'LED Retrofit', priced: true, units: 1,
    breakdown: [{ basis: 'perProject', fee: 40000, feeHigh: 40000 }],
  },
  {
    name: 'Bill payment', priced: true, units: 131,
    breakdown: [{ basis: 'perAccount', fee: 4192, feeHigh: 6026 }],
  },
  {
    name: 'Chiller replacement', priced: true, units: 2,
    breakdown: [{ basis: 'perProject', fee: 90000, feeHigh: 120000 }],
  },
];
const bases = [
  { key: 'perProject', label: 'Per project', kind: 'unit', unit: 'projects', unitLabel: 'Projects' },
  { key: 'perAccount', label: 'Per account', kind: 'unit', unit: 'accounts', unitLabel: 'Accounts' },
];

const rows = projectCountRows({ lines, opp: oppWith('{"chiller replacement":2}'), bases });
check('one box per project service', rows.map(r => r.service), ['LED Retrofit', 'Chiller replacement']);
check('every one of them counts projects', rows.map(r => r.unit), ['projects', 'projects']);
// An untyped box shows what the estimate is falling back to; a typed one
// shows the answer, and says it came from this opp.
check('an untyped box is blank over its fallback',
  [rows[0].value, rows[0].placeholder, rows[0].source], [null, '1', null]);
check('a typed one carries the number',
  [rows[1].value, rows[1].placeholder, rows[1].source], [2, '2', COUNT_SOURCE_SERVICE]);
check('and saves to the service, not the card', rows.map(r => r.target), [COUNT_SOURCE_SERVICE, COUNT_SOURCE_SERVICE]);
check('nothing is waiting on either', rows.map(r => r.needed), [false, false]);

// A line the estimate could not price for want of this count is one the
// box is waiting on, and says so.
const wanting = projectCountRows({
  lines: [{ ...lines[0], units: 0, gap: { kind: 'units', unit: 'projects' } }], bases,
});
check('a blocked line marks its box needed', wanting[0].needed, true);

// Nowhere to write: the row still shows - it is why the fee reads what it
// reads - but it does not offer a box that drops what is typed into it.
const readOnly = projectCountRows({ lines, bases, canWrite: false });
check('read-only rows say so', [readOnly[0].target, readOnly[0].blocked], [null, 'no-field']);

// A scope with no project work asks nothing.
check('no project services, no boxes', projectCountRows({ lines: [lines[1]], bases }).length, 0);
check('no lines at all is not a crash', projectCountRows({}).length, 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
