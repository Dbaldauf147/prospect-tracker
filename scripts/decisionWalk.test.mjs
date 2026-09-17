// Assertion tests for walking a decision tree: what answering a question
// does to the trail. Plain Node - no test framework (the project has none).
// Run:
//   node scripts/decisionWalk.test.mjs
//
// The diagram answers questions anywhere on the flow, not just the one being
// stood on, so the cases worth pinning are the awkward ones: taking an answer
// back, answering above where you had got to, answering somewhere else
// entirely, and a loop that puts the same step on the trail twice.
import { answerTrail, answeredArrows } from '../src/utils/decisionWalk.js';
import { normalizeTree } from '../src/utils/decisionTree.js';

let pass = 0, fail = 0;
const ok = (c, n) => (c ? (pass += 1, console.log('PASS ', n)) : (fail += 1, console.log('FAIL ', n)));
const eq = (a, b, n) => ok(JSON.stringify(a) === JSON.stringify(b), `${n} (got ${JSON.stringify(a)})`);

// gate1 --yes--> forced --on--> gate2 --data--> gate1  (the loop)
//   \--no--> choice
const tree = normalizeTree({
  rootId: 'gate1',
  nodes: {
    gate1: {
      id: 'gate1', kind: 'question', title: 'Gate 1', branches: [
        { id: 'b-yes', label: 'Yes', to: 'forced' },
        { id: 'b-no', label: 'No', to: 'choice' },
      ],
    },
    forced: { id: 'forced', kind: 'outcome', title: 'Forced', branches: [{ id: 'b-on', label: 'Carry on', to: 'gate2' }] },
    choice: { id: 'choice', kind: 'outcome', title: 'A choice', branches: [] },
    gate2: {
      id: 'gate2', kind: 'question', title: 'Gate 2', branches: [
        { id: 'b-data', label: 'Data is in place', to: 'gate1' },
        { id: 'b-nowhere', label: 'Not linked yet', to: null },
      ],
    },
  },
});
const branch = (nodeId, branchId) => tree.nodes[nodeId].branches.find(b => b.id === branchId);

// --- the first answer ---------------------------------------------------------
{
  eq(answerTrail(tree, [], 'gate1', branch('gate1', 'b-yes')), ['gate1', 'forced'],
    'answering from an empty trail starts it at the root');
  eq(answerTrail(tree, ['gate1'], 'gate1', branch('gate1', 'b-no')), ['gate1', 'choice'],
    'and from a trail holding only the root');
}

// --- carrying on, and taking it back -----------------------------------------
{
  const two = answerTrail(tree, ['gate1', 'forced'], 'forced', branch('forced', 'b-on'));
  eq(two, ['gate1', 'forced', 'gate2'], 'answering where you are standing carries the route on');
  eq(answerTrail(tree, two, 'forced', branch('forced', 'b-on')), ['gate1', 'forced'],
    'answering the same way again takes that answer back');
  // The answers after the one being changed followed FROM it, so they go too.
  eq(answerTrail(tree, two, 'gate1', branch('gate1', 'b-no')), ['gate1', 'choice'],
    'changing an earlier answer drops what was answered after it');
}

// --- answering somewhere else entirely ---------------------------------------
{
  eq(answerTrail(tree, [], 'gate2', branch('gate2', 'b-data')), ['gate1', 'forced', 'gate2', 'gate1'],
    'an answer off the trail moves the route there first, by the way in');
}

// --- a loop puts a step on the trail twice ------------------------------------
{
  const looped = ['gate1', 'forced', 'gate2', 'gate1'];
  eq(answerTrail(tree, looped, 'gate1', branch('gate1', 'b-no')), [...looped, 'choice'],
    'the answer belongs to the visit you are on, not the first one');
}

// --- nothing to do ------------------------------------------------------------
{
  eq(answerTrail(tree, ['gate1'], 'gate2', branch('gate2', 'b-nowhere')), null,
    'a branch pointed nowhere is not an answer');
  eq(answerTrail(tree, ['gate1'], 'nosuch', branch('gate1', 'b-yes')), null, 'nor is one on a step that is gone');
  eq(answerTrail(tree, ['gate1'], 'gate1', null), null, 'nor is no branch at all');
}

// --- the arrows a trail has answered ------------------------------------------
{
  eq([...answeredArrows(['gate1', 'forced', 'gate2'])], ['gate1->forced', 'forced->gate2'],
    'each consecutive pair is an answered arrow');
  eq([...answeredArrows(['gate1'])], [], 'a route standing at the start has answered nothing');
  eq([...answeredArrows()], [], 'and neither has no route at all');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
