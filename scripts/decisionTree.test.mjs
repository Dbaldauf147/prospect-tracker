// Assertion tests for the editable decision tree behind the Efficiency
// Decision Tree page. Plain Node — no test framework (the project has none).
// Run:
//   node scripts/decisionTree.test.mjs
//
// The model allows what the real process does: five tiers that all rejoin at
// the economics gate, and a verification step that sends you back for the next
// measure. That makes the graph rejoining AND cyclic, so the two readers that
// walk it — the outline and the path finder — are the ones that have to stay
// finite. Most of what follows pins that, plus the edits the page performs on
// a user's click and the defensive read that has to open a tree saved by an
// older version.
import {
  addBranch, addNextStep, addNode, deleteNode, detailBlocks, makeId, moveBranch, normalizeTree,
  orphanIds, outlineRows, pathFromRoot, removeBranch, setRoot, strandedByDelete, treeStats,
  updateBranch, updateNode, childIds, reachableIds,
} from '../src/utils/decisionTree.js';
import { DEFAULT_EFFICIENCY_TREE } from '../src/data/efficiencyDecisionTree.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }

// ── the shipped template ─────────────────────────────────────────────────

const seed = normalizeTree(DEFAULT_EFFICIENCY_TREE);
eq(seed.rootId, 'gate1', 'the template starts at Gate 1');
ok(Object.keys(seed.nodes).length >= 25, 'the template has the full seven-gate flow');
eq(treeStats(seed).unlinked, 0, 'every branch in the template points somewhere');
eq(orphanIds(seed), [], 'every step in the template is reachable from Gate 1');

// The seven gates are all on a route from the start.
const reachable = reachableIds(seed);
for (const gate of ['gate1', 'gate2', 'gate3', 'gate4', 'gate5', 'gate6', 'gate7']) {
  ok(reachable.has(gate), `${gate} is reachable`);
}

// Rejoin: all five tiers continue at the economics gate.
eq(childIds(seed, 'gate3'), ['tier1', 'tier2', 'tier3', 'tier4', 'tier5'], 'Gate 3 offers five tiers');
for (const tier of ['tier1', 'tier2', 'tier3', 'tier4', 'tier5']) {
  eq(childIds(seed, tier), ['gate4'], `${tier} leads to the economics gate`);
}

// Loop: verification sends you back to pick the next measure. A reader that
// didn't handle this would not return at all.
eq(childIds(seed, 'persistence'), ['gate3'], 'persistence loops back to the measure hierarchy');
const rows = outlineRows(seed);
ok(rows.length > 0 && rows.length < 200, 'the outline of a looping tree is finite');
eq(rows.filter(r => r.nodeId === 'gate4' && !r.repeat).length, 1, 'a rejoining step is drawn in full exactly once');
eq(rows.filter(r => r.nodeId === 'gate4' && r.repeat).length, 4, 'and marked as a rejoin under the other four tiers');
// Gate 3 is reached three ways: straight from Gate 2, again once the metering
// work is done, and again every time verification sends you back for the next
// measure. One of those draws it; the other two say where the flow goes.
eq(rows.filter(r => r.nodeId === 'gate3').map(r => ({ from: r.parentId, repeat: r.repeat })), [
  { from: 'gate2', repeat: false },
  { from: 'persistence', repeat: true },
  { from: 'dataFirst', repeat: true },
], 'the loop back to Gate 3 is marked, not expanded');

// Two terminal routes: the register, and a lease that blocks recovery.
eq(treeStats(seed).ends, 2, 'the template has two dead ends');

// ── walking to a step ────────────────────────────────────────────────────

const path = pathFromRoot(seed, 'register');
eq(path.map(p => p.nodeId), ['gate1', 'gate2', 'gate3', 'tier1', 'gate4', 'payback', 'pbSlow', 'register'],
  'the shortest route to the register runs through the gates in order');
eq(path[1].branchLabel, 'No - this is a choice', 'each step carries the branch you answered to get there');
eq(pathFromRoot(seed, 'gate1').map(p => p.nodeId), ['gate1'], 'the root is its own path');
eq(pathFromRoot(seed, 'nope'), null, 'a step that does not exist has no path');

// ── editing: what each button on the page does ───────────────────────────

let t = normalizeTree({
  rootId: 'a',
  nodes: {
    a: { id: 'a', kind: 'question', title: 'A', branches: [{ id: 'b1', label: 'Yes', to: 'b' }] },
    b: { id: 'b', kind: 'outcome', title: 'B', branches: [] },
  },
});

const added = addNode(t, { parentId: 'a', title: 'C' });
ok(added.id && added.id !== 'a' && added.id !== 'b', 'a new step gets an id of its own');
eq(added.tree.nodes.a.branches.length, 2, 'adding a step under A adds the branch that reaches it');
eq(added.tree.nodes.a.branches[1].to, added.id, 'and points it at the new step');
eq(t.nodes.a.branches.length, 1, 'the original tree is untouched - every edit returns a new one');

t = updateNode(t, 'b', { title: 'Do this', detail: 'text', kind: 'outcome' });
eq(t.nodes.b.title, 'Do this', 'a step title can be edited');
eq(updateNode(t, 'missing', { title: 'x' }), t, 'editing a step that is gone changes nothing');

t = addBranch(t, 'b', { label: 'Next' });
eq(t.nodes.b.branches.map(b => ({ label: b.label, to: b.to })), [{ label: 'Next', to: null }],
  'a fresh branch starts out pointing nowhere');
t = updateBranch(t, 'b', t.nodes.b.branches[0].id, { to: 'a' });
eq(t.nodes.b.branches[0].to, 'a', 'a branch can be pointed at an existing step - that is how a flow rejoins');
t = updateBranch(t, 'b', t.nodes.b.branches[0].id, { to: 'ghost' });
eq(t.nodes.b.branches[0].to, null, 'pointing a branch at a step that does not exist leaves it unlinked');

// Branch order is the order the choices are offered in, so it is editable.
let ordered = normalizeTree({
  rootId: 'a',
  nodes: {
    a: { id: 'a', title: 'A', branches: [{ id: 'b1', label: 'one' }, { id: 'b2', label: 'two' }, { id: 'b3', label: 'three' }] },
  },
});
eq(moveBranch(ordered, 'a', 'b3', -1).nodes.a.branches.map(b => b.label), ['one', 'three', 'two'], 'a branch moves up');
eq(moveBranch(ordered, 'a', 'b1', 1).nodes.a.branches.map(b => b.label), ['two', 'one', 'three'], 'and down');
eq(moveBranch(ordered, 'a', 'b1', -1), ordered, 'the first branch cannot move up past the top');
eq(moveBranch(ordered, 'a', 'b3', 1), ordered, 'nor the last past the bottom');
eq(removeBranch(ordered, 'a', 'b2').nodes.a.branches.map(b => b.label), ['one', 'three'], 'a branch can be removed');

// ── deleting ────────────────────────────────────────────────────────────

const chain = normalizeTree({
  rootId: 'a',
  nodes: {
    a: { id: 'a', title: 'A', branches: [{ id: 'b1', label: 'Yes', to: 'b' }, { id: 'b2', label: 'No', to: 'd' }] },
    b: { id: 'b', title: 'B', branches: [{ id: 'b1', label: 'on', to: 'c' }] },
    c: { id: 'c', title: 'C', branches: [] },
    d: { id: 'd', title: 'D', branches: [] },
  },
});

const cut = deleteNode(chain, 'b');
eq(Object.keys(cut.nodes).sort(), ['a', 'c', 'd'], 'deleting a step removes just that step by default');
eq(cut.nodes.a.branches[0], { id: 'b1', label: 'Yes', to: null },
  'the branch that pointed at it keeps its label and is unlinked, so it can be re-pointed');
eq(orphanIds(cut), ['c'], 'what it led to is listed as unreachable rather than silently destroyed');

const pruned = deleteNode(chain, 'b', { cascade: true });
eq(Object.keys(pruned.nodes).sort(), ['a', 'd'], 'a cascading delete takes the limb only that step reached');
ok(pruned.nodes.d, 'and leaves the limb reached another way alone');
eq(deleteNode(chain, 'a'), chain, 'the starting step cannot be deleted - the page would have nothing to open on');
eq(deleteNode(chain, 'ghost'), chain, 'deleting something that is not there changes nothing');

// What a delete is about to strand, so the confirmation can name it rather
// than asking about a limb that may not exist.
eq(strandedByDelete(chain, 'b'), ['c'], 'deleting B would strand the step only it reached');
eq(strandedByDelete(chain, 'd'), [], 'deleting a leaf strands nobody, so there is nothing to ask about');
eq(strandedByDelete(chain, 'a'), [], 'the starting step cannot be deleted, so it strands nothing');
eq(strandedByDelete(chain, 'ghost'), [], 'nor can one that is not there');
// A step already unreachable is not this delete's doing and is not counted.
const withOrphan = normalizeTree({
  rootId: 'a',
  nodes: {
    a: { id: 'a', title: 'A', branches: [{ id: 'b1', label: 'Yes', to: 'b' }] },
    b: { id: 'b', title: 'B', branches: [{ id: 'b1', label: 'on', to: 'c' }] },
    c: { id: 'c', title: 'C', branches: [] },
    z: { id: 'z', title: 'Z', branches: [] },
  },
});
eq(orphanIds(withOrphan), ['z'], 'Z is stranded before anything is deleted');
eq(strandedByDelete(withOrphan, 'b'), ['c'], 'so the delete is only charged with what it actually strands');
// A step reached two ways is not stranded when one of them goes.
const rejoin = normalizeTree({
  rootId: 'a',
  nodes: {
    a: { id: 'a', title: 'A', branches: [{ id: 'b1', label: 'Yes', to: 'b' }, { id: 'b2', label: 'No', to: 'c' }] },
    b: { id: 'b', title: 'B', branches: [{ id: 'b1', label: 'on', to: 'c' }] },
    c: { id: 'c', title: 'C', branches: [] },
  },
});
eq(strandedByDelete(rejoin, 'b'), [], 'a step the flow rejoins by another route survives, so nothing is stranded');
// A cascade takes what this delete strands and nothing else, so the count the
// confirmation quotes is the count that actually goes.
const sweep = deleteNode(withOrphan, 'b', { cascade: true });
eq(Object.keys(sweep.nodes).sort(), ['a', 'z'],
  'a cascade takes the limb it stranded and leaves the step that was already unreachable alone');
eq(strandedByDelete(withOrphan, 'b').length,
  Object.keys(withOrphan.nodes).length - Object.keys(sweep.nodes).length - 1,
  'and what it takes is exactly what was counted, plus the step itself');

// An unreachable step can be adopted as the new start, which is the way back
// from deleting the root's only route.
eq(setRoot(cut, 'c').rootId, 'c', 'any step can be made the start');
eq(setRoot(cut, 'ghost'), cut, 'but not one that does not exist');

// ── reading a tree that was saved by someone else ────────────────────────

const messy = normalizeTree({
  rootId: 'gone',
  nodes: {
    keep: { title: 'Kept', kind: 'nonsense', branches: [{ id: 'b1', label: 'dangling', to: 'vanished' }, null, 'junk'] },
    '': { title: 'no id' },
  },
});
eq(Object.keys(messy.nodes), ['keep'], 'a step with no id is dropped');
eq(messy.rootId, 'keep', 'a root pointing at a step that is gone falls back to a real step');
eq(messy.nodes.keep.kind, 'question', 'an unknown kind reads as a question');
eq(messy.nodes.keep.branches, [{ id: 'b1', label: 'dangling', to: null }],
  'a branch pointing at a vanished step is unlinked, and junk branches are dropped');
eq(normalizeTree(null).nodes[normalizeTree(null).rootId].kind, 'question',
  'even nothing at all opens as an empty first question');
eq(Object.keys(normalizeTree({ nodes: {} }).nodes).length, 1, 'so does an empty tree');

// Duplicate branch ids would make two rows of the editor edit each other.
const dupes = normalizeTree({ rootId: 'a', nodes: { a: { id: 'a', branches: [{ id: 'b1', label: 'x' }, { id: 'b1', label: 'y' }] } } });
eq(new Set(dupes.nodes.a.branches.map(b => b.id)).size, 2, 'duplicate branch ids are made unique');

// Free text is capped: this all lives in one size-limited settings document,
// and a pasted report must not be what breaks every later save.
const huge = normalizeTree({ rootId: 'a', nodes: { a: { id: 'a', title: 'x'.repeat(5000), detail: 'y'.repeat(9000), branches: [] } } });
eq(huge.nodes.a.title.length, 200, 'a title is capped');
eq(huge.nodes.a.detail.length, 4000, 'so is the detail');

eq(makeId('b', new Set(['b', 'b-1'])), 'b-2', 'ids step past the ones already taken');
eq(makeId('', new Set()), 'n', 'an empty prefix still produces a usable id');

// ── adding the next step from the diagram ───────────────────────────────
//
// The + on a box asks two things and no more: what kind of step, and what
// to call it. Everything else about the new step has to be right without
// being asked, because the point of the button is not having to open the
// editor to get a box on the canvas.

const oneBox = normalizeTree({ rootId: 'a', nodes: { a: { id: 'a', title: 'Start', branches: [] } } });

// A decision point you cannot answer is not a decision point.
const withGate = addNextStep(oneBox, { fromId: 'a', kind: 'question', title: 'Forced?' });
eq(withGate.tree.nodes[withGate.id].kind, 'question', 'a decision point is a question');
eq(withGate.tree.nodes[withGate.id].branches.map(b => b.label), ['Yes', 'No'],
  'and arrives with its two ways out');
eq(withGate.tree.nodes[withGate.id].branches.map(b => b.to), [null, null],
  'both pointing nowhere, for the steps that have not been added yet');
eq(withGate.tree.nodes.a.branches.map(b => b.to), [withGate.id],
  'the step it was added after now reaches it');

// Free text is the other half of the choice: a step that just says what
// happens, with nothing to answer.
const withText = addNextStep(oneBox, { fromId: 'a', kind: 'outcome', title: 'Fix the leak' });
eq(withText.tree.nodes[withText.id].kind, 'outcome', 'free text is an outcome');
eq(withText.tree.nodes[withText.id].branches, [], 'and branches nowhere until somebody adds one');
eq(withText.tree.nodes[withText.id].title, 'Fix the leak', 'the title asked for is the title kept');

// The third shape a flowchart is drawn with: the terminator. It is a claim
// about the route rather than about the branches - a step with no branches
// is where the route ran out, an End is where it was MEANT to - so what has
// to hold is that the kind survives, and that it arrives with nothing
// hanging off it.
const withEnd = addNextStep(oneBox, { fromId: 'a', kind: 'end', title: 'Close it out' });
eq(withEnd.tree.nodes[withEnd.id].kind, 'end', 'an end is its own kind, not an outcome');
eq(withEnd.tree.nodes[withEnd.id].branches, [], 'and arrives with no ways out');
eq(withEnd.tree.nodes.a.branches.map(b => b.to), [withEnd.id],
  'reached from the step it was added after, like any other');
eq(treeStats(withEnd.tree).ends, 1, 'and counts as an end of the route');
eq(JSON.stringify(normalizeTree(withEnd.tree)), JSON.stringify(withEnd.tree),
  'an end reads back identically after a save');
// A tree written by a version that had only two kinds still opens, and a
// kind this version does not know still reads as a question.
eq(normalizeTree({ rootId: 'x', nodes: { x: { id: 'x', kind: 'end', title: 'Stop', branches: [] } } }).nodes.x.kind,
  'end', 'an end saved on another device opens as an end');
eq(updateNode(withText.tree, withText.id, { kind: 'end' }).nodes[withText.id].kind, 'end',
  'the editor can turn a step into an end');

// Added onto a branch that was waiting: the gate's Yes finally goes
// somewhere, and no second Yes is created alongside it.
const gate = withGate.tree;
const yesId = gate.nodes[withGate.id].branches[0].id;
const filled = addNextStep(gate, { fromId: withGate.id, branchId: yesId, kind: 'outcome', title: 'Do it' });
eq(filled.tree.nodes[withGate.id].branches.map(b => [b.label, b.to]),
  [['Yes', filled.id], ['No', null]], 'an existing branch is pointed at the new step rather than duplicated');

// Added with no branch to hang off: one is made, and it carries the label
// the user typed so the arrow reads.
const labelled = addNextStep(oneBox, { fromId: 'a', branchLabel: 'If funded', kind: 'outcome', title: 'Scope it' });
eq(labelled.tree.nodes.a.branches.map(b => [b.label, b.to]), [['If funded', labelled.id]],
  'a new branch is made and labelled');
eq(addNextStep(oneBox, { fromId: 'a', kind: 'outcome' }).tree.nodes.a.branches[0].label, '',
  'no label asked for is an unlabelled arrow, not a made-up one');

// A branch id from another step (or one since deleted) must not leave the
// new step floating where nothing reaches it.
const bogus = addNextStep(oneBox, { fromId: 'a', branchId: 'not-a-branch', kind: 'outcome', title: 'X' });
eq(bogus.tree.nodes.a.branches.map(b => b.to), [bogus.id],
  'an unknown branch id still leaves the new step reachable');
eq(orphanIds(bogus.tree), [], 'so nothing is stranded');

// Every step it makes has to survive a save and a reload unchanged.
eq(JSON.stringify(normalizeTree(withGate.tree)), JSON.stringify(withGate.tree),
  'what it builds reads back identically');

// ── the detail text ─────────────────────────────────────────────────────

eq(detailBlocks('One line'), [{ type: 'p', text: 'One line' }], 'a line of prose is a paragraph');
eq(detailBlocks('A\n\nB'), [{ type: 'p', text: 'A' }, { type: 'p', text: 'B' }], 'a blank line starts a new paragraph');
eq(detailBlocks('* one\n* two'), [{ type: 'ul', items: ['one', 'two'] }], 'starred lines become one list');
eq(detailBlocks('- one\n- two'), [{ type: 'ul', items: ['one', 'two'] }], 'dashes work the same way');
eq(detailBlocks('Intro:\n* a\nAfter'),
  [{ type: 'p', text: 'Intro:' }, { type: 'ul', items: ['a'] }, { type: 'p', text: 'After' }],
  'prose, bullets and prose stay in the order they were typed');
eq(detailBlocks(''), [], 'empty detail draws nothing');
eq(detailBlocks('  \n  '), [], 'so does whitespace');
eq(detailBlocks('10 - 20 years'), [{ type: 'p', text: '10 - 20 years' }], 'a dash inside a sentence is not a bullet');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
