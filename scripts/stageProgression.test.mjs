// Chance of moving to the next stage by days in stage. Plain Node. Run:
//   node scripts/stageProgression.test.mjs
import assert from 'node:assert/strict';
import { stintsOf, stageProgression, openOppChances, bandOf, nextStageOf, heardDatesOf, silenceAt } from '../src/utils/stageProgression.js';

const h = (stage, days, exitedAt) => ({ stage, days, enteredAt: '', exitedAt });

// Lead 5d -> Qualifying 40d -> Quoted (progressed twice), now Sold.
const won = { Stage: 'Sold', _stageHistory: [h('Lead', 5, '2026-01-06'), h('Qualifying', 40, '2026-02-15'), h('Quoted', 20, '2026-03-07')] };
// Lead 20d -> Not Sold (stalled).
const lost = { Stage: 'Not Sold', _stageHistory: [h('Lead', 20, '2026-02-01')] };
// Quoted 10d -> back to Quoting (stalled), Quoting 3d -> Quoted (progressed), still Quoted.
const back = { Stage: 'Quoted', _stageHistory: [h('Quoted', 10, '2026-03-01'), h('Quoting', 3, '2026-03-04')] };
// Quoted -> Repricing: sideways, not counted.
const side = { Stage: 'Repricing', _stageHistory: [h('Quoted', 15, '2026-03-10')] };
// Pull-through: never counted.
const pt = { Stage: 'Sold', 'Pull Through': 'Yes', _stageHistory: [h('Lead', 2, '2026-01-02')] };

assert.deepEqual(stintsOf(won).map(s => [s.stage, s.days, s.next, s.progressed]), [
  ['Lead', 5, 'Qualifying', true], ['Qualifying', 40, 'Quoted', true], ['Quoted', 20, 'Sold', true],
]);
assert.deepEqual(stintsOf(back).map(s => [s.stage, s.progressed]), [['Quoted', false], ['Quoting', true]]);
assert.deepEqual(stintsOf(side), [], 'sideways move is neither');
assert.deepEqual(stintsOf({ Stage: 'Lead' }), [], 'no history, no stints');
// Days fall back to the two dates.
assert.equal(stintsOf({ Stage: 'Sold', _stageHistory: [{ stage: 'Lead', enteredAt: '2026-01-01', exitedAt: '2026-01-11' }] })[0].days, 10);

const p = stageProgression([won, lost, back, side, pt]);
const lead = p.stages.find(s => s.stage === 'Lead');
assert.equal(lead.stints, 2, 'pull-through left out');
assert.equal(lead.rate, 50);
assert.equal(lead.medianDaysToMove, 5);
assert.deepEqual(lead.bands.slice(0, 4).map(b => [b.n, b.moved]), [[2, 1], [1, 0], [1, 0], [0, 0]], 'band n = stints lasting at least its start');
assert.equal(lead.bands[0].rate, 50);
assert.equal(lead.bands[3].rate, null, 'no stints that long: blank, not 0%');
const quoted = p.stages.find(s => s.stage === 'Quoted');
assert.deepEqual([quoted.stints, quoted.progressed], [2, 1]);
assert.equal(p.withHistory, 3);
assert.equal(nextStageOf('Agreement Sent'), 'Sold');
assert.equal(nextStageOf('Lead'), 'Qualifying');
assert.equal(bandOf(0), 0); assert.equal(bandOf(13), 1); assert.equal(bandOf(14), 2); assert.equal(bandOf(400), 6);

// Window on the exit date.
assert.equal(stageProgression([won, lost], { from: '2026-02-01' }).stages.find(s => s.stage === 'Lead').stints, 1);

// Open opps scored on their current stage's band.
const open = [
  { Account: 'Open A', Stage: 'Lead', _stageEnteredAt: '2026-03-01' },
  { Account: 'Open B', Stage: 'Lead', 'Start Date': '2026-03-28' },
  { Account: 'Done', Stage: 'Sold' },
  { Account: 'No date', Stage: 'Lead' },
];
const scored = openOppChances(open, p, { nowMs: Date.parse('2026-03-31T15:00:00Z') });
assert.deepEqual(scored.map(o => [o.r.Account, o.days, o.band, o.rate, o.n]), [
  ['Open A', 30, '30-59 days', null, 0],
  ['Open B', 3, '0-6 days', 50, 2],
]);

// Silence: days since we last heard from the contact when a stint ended.
const F = 'Last Client Heard From Us';
const heardOpp = {
  Stage: 'Not Sold', [F]: '2026-02-20',
  _heardFromLog: [{ date: '2026-01-02' }, { date: '2026-01-25' }, { date: '2026-02-20' }],
  _stageHistory: [h('Lead', 10, '2026-01-10'), h('Qualifying', 40, '2026-03-20')],
};
assert.deepEqual(heardDatesOf(heardOpp), ['2026-01-02', '2026-01-25', '2026-02-20'], 'log and current date, deduped');
assert.equal(silenceAt(['2026-01-02', '2026-02-20'], '2026-01-10'), 8);
assert.equal(silenceAt(['2026-02-20'], '2026-01-10'), null, 'nothing heard by then: unknown');
assert.deepEqual(stintsOf(heardOpp).map(s => [s.stage, s.silence, s.progressed]), [['Lead', 8, true], ['Qualifying', 28, false]]);
// A closed opp with no log still has its current heard-from date.
const plain = { Stage: 'Sold', [F]: '2026-03-01', _stageHistory: [h('Quoted', 12, '2026-03-11')] };
assert.equal(stintsOf(plain)[0].silence, 10);
assert.equal(stintsOf(won)[0].silence, null, 'no heard-from dates: unknown');

const ps = stageProgression([heardOpp, plain, won, lost]);
const q = ps.stages.find(s => s.stage === 'Qualifying');
assert.equal(q.withSilence, 1);
assert.deepEqual(q.silenceBands.slice(0, 4).map(b => [b.n, b.moved]), [[1, 0], [1, 0], [1, 0], [0, 0]]);
const leadS = ps.stages.find(s => s.stage === 'Lead');
assert.deepEqual([leadS.withSilence, leadS.silenceBands[1].n, leadS.silenceBands[1].rate], [1, 1, 100]);

// Open opps get the contact, silence and its chance.
const openH = [{ Account: 'Live', Contact: 'Jane, Bob', Stage: 'Lead', _stageEnteredAt: '2026-03-25', [F]: '2026-03-20',
  _heardFromLog: [{ date: '2026-03-01' }, { date: '2026-03-11', gapDays: 10 }, { date: '2026-03-20', gapDays: 9 }] }];
const sc = openOppChances(openH, ps, { nowMs: Date.parse('2026-03-31T15:00:00Z') })[0];
assert.deepEqual([sc.contact, sc.silence, sc.silenceBand, sc.silenceRate, sc.silenceN, sc.usualGap], ['Jane', 11, '7-13 days', 100, 1, 9.5]);
const noHeard = openOppChances([{ Account: 'Quiet', Stage: 'Lead', _stageEnteredAt: '2026-03-25' }], ps, { nowMs: Date.parse('2026-03-31T15:00:00Z') })[0];
assert.deepEqual([noHeard.silence, noHeard.silenceRate, noHeard.silenceN], [null, null, 0]);
console.log('PASS stageProgression');
