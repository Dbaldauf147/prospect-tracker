// Which leads made it to the Qualifying stage (the Leads chart on YOY).
// Plain Node, no test framework. Run:
//   node scripts/leadQualifying.test.mjs
import assert from 'node:assert/strict';
import { qualifyingEvidence, reachedQualifying } from '../src/utils/leadQualifying.js';

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

// The words behind each answer, for the export's analysis tab.
{
  const e = qualifyingEvidence({ Stage: 'Quoted', _stageHistory: [{ stage: 'Lead' }, { stage: 'Qualifying' }] });
  assert.equal(e.reached, true);
  assert.equal(e.basis, 'Stage today is Quoted');
  assert.equal(e.path, 'Lead > Qualifying > Quoted');
}
{
  const e = qualifyingEvidence({ Stage: 'Not Sold', _stageHistory: [{ stage: 'Lead' }, { stage: 'Qualifying', enteredAt: '2026-02-01', exitedAt: '2026-03-01' }] });
  assert.equal(e.reached, true);
  assert.equal(e.basis, 'Stage history shows Qualifying from 2026-02-01 to 2026-03-01');
}
{
  const e = qualifyingEvidence({ Stage: 'Lead' });
  assert.equal(e.reached, false);
  assert.equal(e.basis, 'Stage today is Lead, no stage moves recorded');
  assert.equal(e.path, 'Lead');
}
{
  const e = qualifyingEvidence({ Stage: 'Not Sold', _stageHistory: [{ stage: 'Lead' }] });
  assert.equal(e.reached, false);
  assert.equal(e.basis, 'Stage today is Not Sold, history never shows Qualifying or later');
}
// The two functions never disagree.
for (const r of [{ Stage: 'Lead', _stageHistory: [{ stage: 'Quoting' }] }, { Stage: 'Sold' }, { Stage: '' }, null]) {
  assert.equal(qualifyingEvidence(r).reached, reachedQualifying(r));
}
console.log('leadQualifying evidence: all assertions passed');
