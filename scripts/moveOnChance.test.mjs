// The Opps table's Chance of moving on column. Plain Node. Run:
//   node scripts/moveOnChance.test.mjs
import assert from 'node:assert/strict';
import { moveOnChancesById, stintsBehind } from '../src/utils/moveOnChance.js';

const h = (stage, days, exitedAt) => ({ stage, days, enteredAt: '', exitedAt });
const nowMs = Date.parse('2026-06-01T12:00:00Z');

// Past Quoted stints: 40d moved on, 35d lost, 10d moved on, 50d back a stage.
const past = [
  { _id: 1, Stage: 'Sold', _stageHistory: [h('Quoted', 40, '2026-02-01'), h('Contracting', 5, '2026-02-06')] },
  { _id: 2, Stage: 'Not Sold', _stageHistory: [h('Quoted', 35, '2026-03-01')] },
  { _id: 3, Stage: 'Contracting', _stageHistory: [h('Quoted', 10, '2026-03-05')] },
  { _id: 4, Stage: 'Quoting', _stageHistory: [h('Quoted', 50, '2026-04-01')] },
];
// Open: in Quoted since May 1 (31 days, the 30-59 band).
const open = { _id: 9, Stage: 'Quoted', _stageEnteredAt: '2026-05-01', 'Start Date': '2026-01-01' };
const sold = { _id: 10, Stage: 'Sold', 'Start Date': '2026-01-01' };
const noDate = { _id: 11, Stage: 'Lead' };

const { byId, prog } = moveOnChancesById([...past, open, sold, noDate], { nowMs });
const o = byId.get(9);
assert.equal(o.days, 31);
assert.equal(o.band, '30-59 days');
assert.equal(o.n, 3, 'Quoted stints of 30+ days: 40, 35, 50');
assert.equal(Math.round(o.rate), 33, '1 of 3 moved on');
assert.equal(byId.has(10), false, 'closed opps are not scored');
assert.equal(byId.has(11), false, 'no date to count from, not scored');
assert.equal(o.likelihood, null, 'too little history for the model');

const b = stintsBehind(prog, 'Quoted', 31);
assert.equal(b.min, 30);
assert.deepEqual(b.stints.map(s => s.days), [50, 40, 35], 'longest first');
assert.equal(b.moved, 1);
assert.equal(b.moved / b.stints.length * 100, o.rate, 'the popup list adds up to the cell');

console.log('moveOnChance tests passed');
