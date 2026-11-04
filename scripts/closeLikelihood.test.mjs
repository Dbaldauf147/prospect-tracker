// Likelihood to close. Plain Node. Run:
//   node scripts/closeLikelihood.test.mjs
import assert from 'node:assert/strict';
import { stageProgression } from '../src/utils/stageProgression.js';
import { fitMoveOnModel, moveOnChance, scoreLikelihood, calibrationOf, modelWeights, MIN_TRAINING } from '../src/utils/closeLikelihood.js';

// A history where long silences and long stints don't move on.
let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const iso = (d) => new Date(Date.UTC(2025, 0, 1) + d * 86400000).toISOString().slice(0, 10);
const recs = [];
for (let i = 0; i < 400; i++) {
  const days = Math.round(rnd() * 80);
  const silence = Math.round(rnd() * 60);
  const moved = rnd() < Math.max(0.05, 0.9 - silence / 70 - days / 200);
  const exit = 30 + days;
  recs.push({
    Stage: moved ? 'Sold' : 'Not Sold', 'Start Date': iso(0),
    'Last Client Heard From Us': iso(exit - silence),
    _stageHistory: [{ stage: 'Quoted', days, exitedAt: iso(exit) }],
  });
}
const prog = stageProgression(recs);
const model = fitMoveOnModel(prog.stints);
assert.ok(model, 'fits with enough history');
assert.equal(model.trainedOn, 400);
const quiet = moveOnChance(model, { stage: 'Quoted', days: 20, silence: 55, age: 60 });
const chatty = moveOnChance(model, { stage: 'Quoted', days: 20, silence: 2, age: 60 });
assert.ok(chatty > quiet + 0.2, `silence lowers the chance (${chatty} vs ${quiet})`);
const long = moveOnChance(model, { stage: 'Quoted', days: 75, silence: 10, age: 60 });
const short = moveOnChance(model, { stage: 'Quoted', days: 3, silence: 10, age: 60 });
assert.ok(short > long, 'long stints lower the chance');
assert.ok(quiet > 0 && chatty < 1);

// Too little history, or one outcome only: no model.
assert.equal(fitMoveOnModel(prog.stints.slice(0, MIN_TRAINING - 1)), null);
assert.equal(fitMoveOnModel(prog.stints.filter(s => s.progressed)), null);

// Chain: the model's step times each later stage's history rate.
const fake = { stages: [
  { stage: 'Quoted', stints: 10, progressed: 5 }, { stage: 'Contracting', stints: 10, progressed: 4 },
  { stage: 'Agreement Sent', stints: 10, progressed: 5 }, { stage: 'Lead', stints: 0, progressed: 0 },
] };
const [s] = scoreLikelihood([{ r: { 'Start Date': iso(0) }, stage: 'Quoted', next: 'Contracting', days: 10, silence: 5 }], fake, model);
assert.equal(s.steps.length, 3);
assert.deepEqual(s.steps.map(x => [x.stage, x.from]), [['Quoted', 'model'], ['Contracting', 'history'], ['Agreement Sent', 'history']]);
assert.ok(Math.abs(s.likelihood - s.moveOn * 0.4 * 0.5) < 1e-12);
const [none] = scoreLikelihood([{ r: {}, stage: 'Quoted', next: 'Contracting', days: 1, silence: null }], fake, null);
assert.equal(none.likelihood, null, 'no model: blank');

// Calibration: bins cover every stint; on this history it should be in order.
const cal = calibrationOf(model, prog.stints);
assert.equal(cal.reduce((n, b) => n + b.n, 0), 400);
const filled = cal.filter(b => b.n >= 20);
for (let i = 1; i < filled.length; i++) assert.ok(filled[i].actual >= filled[i - 1].actual - 0.1, 'higher scores move on more');
assert.equal(modelWeights(model).length, model.w.length);
console.log('PASS closeLikelihood');
