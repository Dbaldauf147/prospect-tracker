// Recovering lost Weekly Progress weeks from the daily cloud backups.
// Plain Node, no test framework. Run:
//   node scripts/progressHistoryRecovery.test.mjs
//
// Recovery must only ever add weeks: a week the live document holds keeps
// its live numbers, and the newest backup's copy of a week wins.

import {
  weeksFromBackupValue,
  missingWeeksFromBackups,
  mergeRecoveredWeeks,
} from '../src/utils/progressHistoryRecovery.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const w = (week, n) => ({ week, t1Total: n });

// Shapes the backup endpoint can hand back.
check('reads the part value', weeksFromBackupValue({ weeks: [w('2026-09-07', 1)] }).length, 1);
check('reads a whole backup', weeksFromBackupValue({ collections: { progressHistory: { weeks: [w('2026-09-07', 1)] } } }).length, 1);
check('a missing doc is no weeks', weeksFromBackupValue(null).length, 0);
check('rows without a week key are dropped', weeksFromBackupValue({ weeks: [{ t1Total: 3 }, null] }).length, 0);

// The incident: live holds only this week, backups hold the run-up.
const live = [w('2026-10-05', 20)];
const newest = [w('2026-09-21', 18), w('2026-09-28', 19), w('2026-10-05', 99)];
const older = [w('2026-09-14', 17), w('2026-09-21', 5), w('2026-09-28', 5)];
const missing = missingWeeksFromBackups(live, [newest, older]);
check('finds every week live lacks', missing.map(x => x.week).join(','), '2026-09-14,2026-09-21,2026-09-28');
check('the newest backup copy of a week wins', missing.find(x => x.week === '2026-09-21').t1Total, 18);
check('a week live already has is not offered', missing.some(x => x.week === '2026-10-05'), false);

const merged = mergeRecoveredWeeks(live, missing);
check('merged runs oldest first', merged.map(x => x.week).join(','), '2026-09-14,2026-09-21,2026-09-28,2026-10-05');
check('live numbers survive the merge', merged.find(x => x.week === '2026-10-05').t1Total, 20);
check('merging again changes nothing', mergeRecoveredWeeks(merged, missing).length, 4);
check('nothing to recover when backups match', missingWeeksFromBackups(merged, [newest, older]).length, 0);

console.log(failures === 0 ? '\nAll passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
