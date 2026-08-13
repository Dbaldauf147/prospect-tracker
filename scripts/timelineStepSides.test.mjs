// Assertion tests for which side of contract signature a step sits on. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/timelineStepSides.test.mjs
//
// The flag alone isn't the feature: the stages array IS the plan order, since
// the chart numbers steps from it and stacks its rows in it. So the thing
// worth pinning down is that changing a step's side MOVES it — the run-up has
// to physically precede the engagement — and that the reorder arrows can't
// smuggle a step across the line without that move happening.
import {
  setStagePreKickoff, canSwapStages, getTimelineTemplates, makeTimelineStage,
} from '../src/utils/timelineTemplatesStore.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}
function same(label, actual, expected) {
  check(label, JSON.stringify(actual), JSON.stringify(expected));
}

const st = (id, pre = false) => ({ id, name: id, preKickoff: pre });
// Reads as "A B | C D", the bar being signature.
const shape = (list) => list.map(s => `${s.id}${s.preKickoff ? '*' : ''}`).join(' ');

// ---- moving into the run-up ------------------------------------------------

const plain = [st('A'), st('B'), st('C')];
check('a step moved before signature leads the plan',
  shape(setStagePreKickoff(plain, 1, true)), 'B* A C');
// After the first move the list is "B* A C", so index 2 is still C — and it
// joins the run-up behind B rather than displacing it.
check('a second one lands at the end of the run-up, not the front',
  shape(setStagePreKickoff(setStagePreKickoff(plain, 1, true), 2, true)), 'B* C* A');
check('moving the last step up still puts it after the existing run-up',
  shape(setStagePreKickoff([st('P', true), st('A'), st('B')], 2, true)), 'P* B* A');

// ---- moving back into the engagement --------------------------------------

check('a step moved after signature heads the engagement',
  shape(setStagePreKickoff([st('P', true), st('Q', true), st('A')], 1, false)), 'P* Q A');
check('the last run-up step leaving empties the run-up',
  shape(setStagePreKickoff([st('P', true), st('A')], 0, false)), 'P A');
check('and the flag actually clears',
  setStagePreKickoff([st('P', true), st('A')], 0, false)[0].preKickoff, false);

// ---- the invariant everything else depends on -----------------------------

function runUpFirst(list) {
  const firstPost = list.findIndex(s => !s.preKickoff);
  if (firstPost === -1) return true;
  return list.slice(firstPost).every(s => !s.preKickoff);
}
let churn = [st('A'), st('B'), st('C'), st('D')];
// Every side-change, in an order chosen to interleave the two halves.
for (const [i, pre] of [[0, true], [3, true], [1, true], [0, false], [2, false], [1, true]]) {
  churn = setStagePreKickoff(churn, i, pre);
  check(`run-up stays ahead of the engagement after ${pre ? 'pre' : 'post'}(${i}) → ${shape(churn)}`,
    runUpFirst(churn), true);
}
check('and no step is lost or duplicated along the way',
  [...new Set(churn.map(s => s.id))].length, 4);

// ---- the arrows stay on their own side ------------------------------------

const mixed = [st('P', true), st('Q', true), st('A'), st('B')];
check('two run-up steps can swap', canSwapStages(mixed, 0, 1), true);
check('two engagement steps can swap', canSwapStages(mixed, 2, 3), true);
check('but not across the signature', canSwapStages(mixed, 1, 2), false);
check('nor off the end of the list', canSwapStages(mixed, 3, 4), false);
check('nor off the front', canSwapStages(mixed, 0, -1), false);

// ---- what the store keeps --------------------------------------------------

const stored = getTimelineTemplates({
  timelineTemplates: [{
    id: 'tl-1', name: 'T', services: ['S'], format: 'phased',
    stages: [{ id: 'st-a', name: 'A', preKickoff: true }, { id: 'st-b', name: 'B' }],
  }],
})[0];
check('a pre-signature step round-trips', stored.stages[0].preKickoff, true);
check('and an ordinary one stays false', stored.stages[1].preKickoff, false);
check('a fresh step is not pre-signature', makeTimelineStage().preKickoff, false);
check('unless it is asked to be', makeTimelineStage({ preKickoff: true }).preKickoff, true);
check('the signature point has a default name', stored.signatureLabel, 'Contract signature');
same('and a timeline authored before any of this reads as all-engagement',
  getTimelineTemplates({
    timelineTemplates: [{ id: 't', name: 'Old', services: [], stages: [{ id: 'x', name: 'X' }] }],
  })[0].stages.map(s => s.preKickoff), [false]);

console.log(failures === 0 ? '\nAll passed.' : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
