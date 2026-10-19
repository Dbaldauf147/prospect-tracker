// Which leads made it to the Qualifying stage (the Leads chart on YOY).
// Plain Node, no test framework. Run:
//   node scripts/leadQualifying.test.mjs
import assert from 'node:assert/strict';
import { reachedQualifying } from '../src/utils/leadQualifying.js';

// At Qualifying or past it today.
for (const Stage of ['Qualifying', 'Quoting', 'Quoted', 'Contracting', 'Agreement Sent', 'Sold', ' Quoted ']) {
  assert.equal(reachedQualifying({ Stage }), true, Stage);
}

// Still before it, with nothing in the history.
for (const Stage of ['Lead', 'Not Started', '', undefined]) {
  assert.equal(reachedQualifying({ Stage }), false, String(Stage));
}

// Lost: only the history says how far it got.
assert.equal(reachedQualifying({ Stage: 'Not Sold' }), false);
assert.equal(reachedQualifying({ Stage: 'Not Sold', _stageHistory: [{ stage: 'Lead', days: 4 }] }), false);
assert.equal(reachedQualifying({ Stage: 'Not Sold', _stageHistory: [{ stage: 'Lead' }, { stage: 'Qualifying' }] }), true);
// Back at Lead after a step forward still counts.
assert.equal(reachedQualifying({ Stage: 'Lead', _stageHistory: [{ stage: 'Quoting' }] }), true);

// Junk in the record never throws.
assert.equal(reachedQualifying(null), false);
assert.equal(reachedQualifying({ Stage: 'Lead', _stageHistory: 'nope' }), false);
assert.equal(reachedQualifying({ Stage: 'Lead', _stageHistory: [null, {}] }), false);

console.log('leadQualifying: all assertions passed');
