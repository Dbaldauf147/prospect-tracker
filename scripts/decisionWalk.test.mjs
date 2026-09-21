// Assertion tests for walking a decision tree: what answering a question
// does to the routes. Plain Node - no test framework (the project has none).
// Run:
//   node scripts/decisionWalk.test.mjs
//
// A walk holds several routes at once, because one account is several
// pathways: compliance driven AND carrying a target of its own. So the cases
// worth pinning are the ones where the answers stop being a single line -
// answering a second way out of a step already answered, taking one of those
// answers back, and what the diagram lights up when two routes overlap - plus
// the awkward ones the single route always had: answering above where you had
// got to, answering somewhere else entirely, and a loop that puts the same
// step on a route twice.
import {
  answerRoutes, answeredArrows, answeredSteps, prunedTree, rewindRoute, routeArrows, routeEnds,
  routeSteps,
} from '../src/utils/decisionWalk.js';
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
// Answering, in the shape the view uses it: routes in, routes out.
const answer = (routes, nodeId, branchId, active = 0) => (
  answerRoutes(tree, routes, nodeId, branch(nodeId, branchId), active)
);

// --- the first answer ---------------------------------------------------------
{
  eq(answer([], 'gate1', 'b-yes'), { routes: [['gate1', 'forced']], active: 0 },
    'answering from nothing starts a route at the root');
  eq(answer([['gate1']], 'gate1', 'b-no'), { routes: [['gate1', 'choice']], active: 0 },
    'and from a route holding only the root');
}

// --- carrying on, and taking it back -----------------------------------------
{
  const two = answer([['gate1', 'forced']], 'forced', 'b-on');
  eq(two.routes, [['gate1', 'forced', 'gate2']], 'answering where you are standing carries that route on');
  eq(answer(two.routes, 'forced', 'b-on').routes, [['gate1', 'forced']],
    'answering the same way again takes that answer back');
}

// --- a second way out of the same step is a second pathway --------------------
{
  const one = answer([], 'gate1', 'b-yes');
  const both = answer(one.routes, 'gate1', 'b-no');
  eq(both.routes, [['gate1', 'forced'], ['gate1', 'choice']],
    'answering the other way out opens a second pathway beside the first');
  eq(both.active, 1, 'and the walk follows the one just opened');
  // The whole point: the first answer is untouched.
  eq(both.routes[0], ['gate1', 'forced'], 'the pathway already taken is left exactly as it was');

  // A third, further down one of them, and the two stay apart.
  const deeper = answer(both.routes, 'forced', 'b-on', 0);
  eq(deeper.routes, [['gate1', 'forced', 'gate2'], ['gate1', 'choice']],
    'carrying one pathway on leaves the other where it is');

  // And taking the first back leaves the second standing.
  eq(answer(deeper.routes, 'gate1', 'b-yes').routes, [['gate1', 'choice']],
    'taking one pathway back leaves the other');
  eq(answer(deeper.routes, 'gate1', 'b-no').routes, [['gate1', 'forced', 'gate2']],
    'either way round');
}

// --- answering above where a route had got to ---------------------------------
{
  const deep = [['gate1', 'forced', 'gate2']];
  const forked = answer(deep, 'gate1', 'b-no');
  eq(forked.routes, [['gate1', 'forced', 'gate2'], ['gate1', 'choice']],
    'answering a step further up adds a pathway rather than dropping what followed it');
}

// --- answering somewhere else entirely ---------------------------------------
{
  eq(answer([], 'gate2', 'b-data').routes, [['gate1', 'forced', 'gate2', 'gate1']],
    'an answer off every route enters by the way in');
  // Standing on gate1 already, an answer down at gate2 is still its own
  // route from the top - and the short one is inside it, so it goes.
  eq(answer([['gate1', 'forced']], 'gate2', 'b-data').routes, [['gate1', 'forced', 'gate2', 'gate1']],
    'a route that is only the first half of another is not a second pathway');
}

// --- a loop puts a step on a route twice --------------------------------------
{
  const looped = [['gate1', 'forced', 'gate2', 'gate1']];
  eq(answer(looped, 'gate1', 'b-no').routes, [['gate1', 'forced', 'gate2', 'gate1', 'choice']],
    'the answer belongs to the visit you are on, not the first one');
  // Taking back the first visit's answer cuts the route at that visit, loop
  // and all: everything after it followed from the answer being taken back.
  eq(answer(looped, 'gate1', 'b-yes').routes, [], 'taking back the answer that started the loop clears it');
}

// --- nothing to do ------------------------------------------------------------
{
  eq(answer([['gate1']], 'gate2', 'b-nowhere'), null, 'a branch pointed nowhere is not an answer');
  eq(answerRoutes(tree, [['gate1']], 'nosuch', branch('gate1', 'b-yes')), null,
    'nor is one on a step that is gone');
  eq(answerRoutes(tree, [['gate1']], 'gate1', null), null, 'nor is no branch at all');
}

// --- what the diagram lights up ----------------------------------------------
{
  const routes = [['gate1', 'forced', 'gate2'], ['gate1', 'choice']];
  eq([...routeArrows(routes)], ['gate1->forced', 'forced->gate2', 'gate1->choice'],
    'every arrow on every pathway is lit, the shared ones once');
  eq([...answeredSteps(routes)], ['gate1', 'forced'],
    'a step is answered when some pathway carries on past it');
  eq([...routeEnds(routes)], ['gate2', 'choice'], 'and each pathway says where it has got to');
  eq([...routeSteps(routes)], ['gate1', 'forced', 'gate2', 'choice'], 'the boxes on any of them are on the walk');
  eq(routeArrows([]).size, 0, 'nothing answered, nothing lit');
  eq([...answeredArrows(['gate1', 'forced', 'gate2'])], ['gate1->forced', 'forced->gate2'],
    'one route on its own still reads as its consecutive pairs');
  eq([...answeredArrows(['gate1'])], [], 'a route standing at the start has answered nothing');
  eq([...answeredArrows()], [], 'and neither has no route at all');
}

// --- going back up one pathway ------------------------------------------------
{
  const routes = [['gate1', 'forced', 'gate2'], ['gate1', 'choice']];
  eq(rewindRoute(routes, 0, 1), { routes: [['gate1', 'forced'], ['gate1', 'choice']], active: 0 },
    'going back up a pathway leaves the others alone');
  eq(rewindRoute(routes, 0, 0), { routes: [['gate1', 'choice']], active: 0 },
    'and back to the top drops it, since it has answered nothing');
  eq(rewindRoute(routes, 1, 1), null, 'standing where you already are is nothing to do');
  eq(rewindRoute(routes, 0, 9), null, 'nor is a step the pathway hasn’t got to');
}

// --- what the diagram is left showing ----------------------------------------
//
// Answering closes the flow up around the pathway picked: the way out you
// didn't take goes, and so does everything hanging off it.
{
  const shown = routes => Object.keys(prunedTree(tree, routes).nodes).sort();
  const waysOut = (routes, id) => prunedTree(tree, routes).nodes[id].branches.map(b => b.label);

  ok(prunedTree(tree, []) === tree, 'nothing answered, nothing hidden - the same tree comes back');
  ok(prunedTree(tree, [['gate1']]) === tree, 'and a walk standing at the start has answered nothing');

  eq(shown([['gate1', 'choice']]), ['choice', 'gate1'],
    'answering No drops the Yes side and the two steps that hang off it');
  eq(waysOut([['gate1', 'choice']], 'gate1'), ['No'],
    'and the step that drove it keeps only the answer given');

  eq(shown([['gate1', 'forced']]), ['forced', 'gate1', 'gate2'],
    'answering Yes drops the No side, and keeps what Yes leads on to');

  // Two pathways out of one question is what picking both means, so neither
  // side is a road not taken.
  eq(shown([['gate1', 'forced'], ['gate1', 'choice']]), ['choice', 'forced', 'gate1', 'gate2'],
    'both answers picked keeps both sides');
  eq(waysOut([['gate1', 'forced'], ['gate1', 'choice']], 'gate1'), ['Yes', 'No'],
    'and the question keeps both its ways out');

  // gate2 loops back to gate1, so answering it rules nothing out: everything
  // it could have hidden is still reached the way the walk came in.
  eq(shown([['gate1', 'forced', 'gate2', 'gate1']]), ['forced', 'gate1', 'gate2'],
    'a loop back to the start hides nothing it is still standing on');

  // A step nothing points at is the user's unwired work, not a road not
  // taken, so an answer elsewhere leaves it alone.
  const withStray = normalizeTree({
    rootId: 'gate1',
    nodes: {
      ...tree.nodes,
      stray: { id: 'stray', kind: 'outcome', title: 'Not wired in', branches: [] },
    },
  });
  eq(Object.keys(prunedTree(withStray, [['gate1', 'choice']]).nodes).sort(), ['choice', 'gate1', 'stray'],
    'a step the start never reached stays put');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
