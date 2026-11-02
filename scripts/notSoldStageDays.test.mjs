// Assertion tests for the Not Sold Analysis days-in-stage filter and the
// per-opp export sheet. Plain Node. Run:
//   node scripts/notSoldStageDays.test.mjs
import {
  stageDaysOf, filterByStageDays, notSoldOppRows, stageDaysFilterActive, STAGE_DAYS_TOTAL, NOT_SOLD_STAGE_COLUMNS,
} from '../src/utils/notSoldStageDays.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`}`);
}

const lost = {
  _id: 'a', Account: 'Acme', Stage: 'Not Sold', 'Close Date': '2025-05-01', 'Quoted Amount': '$12,000',
  _stageHistory: [
    { stage: 'Lead', enteredAt: '2025-01-01', exitedAt: '2025-01-21', days: 20 },
    { stage: 'Qualifying', enteredAt: '2025-01-21', exitedAt: '2025-03-01', days: 39 },
    // Revisited, and this entry lost its count: worked out from the dates.
    { stage: 'Lead', enteredAt: '2025-03-01', exitedAt: '2025-03-06' },
    { stage: 'Quoted', enteredAt: '2025-03-06', exitedAt: '2025-05-01', days: 56 },
  ],
};
const oldLoss = { _id: 'b', Account: 'Old Co', Stage: 'Not Sold', 'Close Date': '2019-02-01' };
const won = { _id: 'c', Account: 'Win Co', Stage: 'Sold', _stageHistory: [{ stage: 'Lead', days: 3 }] };
const open = { _id: 'd', Account: 'Open Co', Stage: 'Lead' };

const d = stageDaysOf(lost);
check('stages add up, revisits included', [d.byStage.Lead, d.byStage.Qualifying, d.byStage.Quoted, d.total], [25, 39, 56, 120]);
check('no history is not zero days', stageDaysOf(oldLoss).hasHistory, false);
check('stage columns follow the pipeline', NOT_SOLD_STAGE_COLUMNS.map(c => c.label).slice(0, 3), ['Not Started', 'Stage 3 - Lead', 'Stage 4 - Qualifying']);

const all = [lost, oldLoss, won, open];
check('blank bounds: no filter', filterByStageDays(all, {}).records.length, 4);
check('filter inactive when blank', stageDaysFilterActive({ min: '', max: '' }), false);
const lead = filterByStageDays(all, { stage: 'Lead', min: '10' });
check('min on one stage keeps the loss, drops the quick win', lead.records.map(r => r._id), ['a', 'd']);
check('loss with no history counted as left out', lead.noHistory, 1);
check('max on the total', filterByStageDays(all, { stage: STAGE_DAYS_TOTAL, max: '100' }).records.map(r => r._id), ['c', 'd']);
check('a stage never visited reads 0', filterByStageDays(all, { stage: 'Contracting', max: '0' }).records.map(r => r._id), ['a', 'c', 'd']);

const [row, oldRow] = notSoldOppRows([lost, oldLoss]);
check('export row: who and why', [row.Account, row['Quoted $'], row['Close Date']], ['Acme', 12000, '2025-05-01']);
check('export row: days per stage', [row['Days in Stage 3 - Lead'], row['Days in Stage 4 - Qualifying'], row['Days in Stage 5 - Quoted'], row['Total days in stages']], [25, 39, 56, 120]);
check('export row: no history leaves days blank', [oldRow['Days in Stage 3 - Lead'], oldRow['Total days in stages']], ['', '']);

console.log(failures ? `${failures} failed.` : 'All passed.');
process.exit(failures ? 1 : 0);
