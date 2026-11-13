// Assertion tests for event series: the contact popup groups an event's
// yearly records into one, so it can list every year and whether this
// person went. Run:
//   node scripts/eventSeries.test.mjs
import { eventSeriesLabel, eventSeriesKey, eventYear, groupEventSeries } from '../src/utils/eventsStore.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n     got ${JSON.stringify(actual)}\n     want ${JSON.stringify(expected)}`}`);
}

check('year taken out of the name', eventSeriesLabel('Greenbuild 2024'), 'Greenbuild');
check('year in front, with a dash', eventSeriesLabel('2025 - NAREIM Fall'), 'NAREIM Fall');
check('a name with no year is itself', eventSeriesLabel('CoreNet Global Summit'), 'CoreNet Global Summit');
check('a name that is only a year is kept', eventSeriesLabel('2024'), '2024');
check('keys are case and spacing blind', eventSeriesKey('GreenBuild  2023') === eventSeriesKey('greenbuild'), true);
check('year from the date first', eventYear({ name: 'Greenbuild 2023', date: '2024-11-12' }), '2024');
check('year from the name with no date', eventYear({ name: 'Greenbuild 2023', date: '' }), '2023');
check('no year at all', eventYear({ name: 'Greenbuild', date: '' }), '');

const series = groupEventSeries([
  { id: 'g24', name: 'Greenbuild 2024', date: '2024-11-12' },
  { id: 'n25', name: 'NAREIM Fall', date: '2025-10-01' },
  { id: 'g25', name: 'Greenbuild', date: '2025-11-04' },
  { id: 'gx', name: 'greenbuild', date: '' },
  { id: 'g23', name: 'Greenbuild 2023', date: '' },
]);
check('series ordered by newest year', series.map(s => s.label), ['Greenbuild', 'NAREIM Fall']);
check('years newest first, undated last', series[0].events.map(e => e.id), ['g25', 'g24', 'g23', 'gx']);

if (failures) { console.error(`\n${failures} failing`); process.exit(1); }
console.log('\nall passed');
