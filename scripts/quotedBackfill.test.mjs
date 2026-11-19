// Plain Node, no framework. Run:
//   node scripts/quotedBackfill.test.mjs
import { backupForMonthEnd, quotedFiguresFromBackup, backfilledMonth } from '../src/utils/quotedBackfill.js';
import { rebuildOwnsMonth, capturedAtMonthEnd } from '../src/utils/quotedMonthRebuild.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const f = (day, time = '11:00:05') => ({ name: `b-${day}`, createdTime: `${day}T${time}.000Z` });
const files = [f('2026-11-19'), f('2026-11-02'), f('2026-11-01'), f('2026-11-01', '15:30:00'), f('2026-10-31'), f('2026-10-30')];
check('first backup after the month end', backupForMonthEnd(files, '2026-10')?.createdTime, '2026-11-01T11:00:05.000Z');
check('the last day\'s own backup is before the close, not used', backupForMonthEnd([f('2026-10-31')], '2026-10'), null);
check('too long after the close', backupForMonthEnd([f('2026-11-05')], '2026-10'), null);
check('within three days', backupForMonthEnd([f('2026-11-03')], '2026-10')?.name, 'b-2026-11-03');
check('none, junk, bad key', [backupForMonthEnd([], '2026-10'), backupForMonthEnd(null, '2026-10'), backupForMonthEnd(files, 'x'), backupForMonthEnd([{ name: 'a' }, { createdTime: 'nope', name: 'b' }], '2026-10')], [null, null, null, null]);

const backup = { collections: {
  opps2Data: { records: [
    { Stage: 'Quoted', 'Quoted Amount': '$100,000', 'Chance?': 'Expected' },
    { Stage: 'Agreement Sent', 'Quoted Amount': '50000', 'Chance?': 'OK' },
    { Stage: 'Sold', 'Quoted Amount': '999999', 'Chance?': 'Expected' },
  ] },
  localMirrors: { 'idb__bfo-activity__current': { headers: ['Amount'], rows: [{ Amount: '2,000,000' }, { Amount: '500000' }] } },
} };
check('figures from a backup', quotedFiguresFromBackup(backup), { ok: 50, expected: 100, agreements: 50, bfoPipe: 2500 });
check('no BFO paste in the backup: no pipe figure', quotedFiguresFromBackup({ collections: { opps2Data: backup.collections.opps2Data } }), { ok: 50, expected: 100, agreements: 50 });
check('no opps: nothing', [quotedFiguresFromBackup({ collections: {} }), quotedFiguresFromBackup(null)], [null, null]);

const entry = backfilledMonth({ ok: 50 }, files[2]);
check('stored entry', entry, { ok: 50, _auto: true, _capturedAt: '2026-11-01T11:00:05.000Z', _fromBackup: 'b-2026-11-01' });
check('counts as a month-end capture, so the rebuild leaves it alone', [capturedAtMonthEnd(entry, '2026-10'), rebuildOwnsMonth(entry, '2026-10')], [true, false]);
check('nothing to store', [backfilledMonth(null, files[0]), backfilledMonth({ ok: 1 }, null)], [null, null]);

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nAll passed');
