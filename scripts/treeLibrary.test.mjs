// Assertion tests for the decision-tree library — the subtabs on the
// Efficiency Decision Tree page, one per tree the user keeps.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/treeLibrary.test.mjs
//
// The page held exactly one tree for its whole life and its tree lives in a
// settings document people already have. So the thing to pin hardest is the
// migration: somebody who customised the single tree must open the library
// with THEIR tree in front of them, named, intact, and still the thing the
// page saves to — not the shipped template with their work one key away.
//
// After that it is the ordinary library arithmetic, and one rule that keeps
// the page openable at all: there is always at least one tree.
import {
  normalizeLibrary, getTreeLibrary, hasSavedTrees, activeEntry, treeEntry,
  setActiveTree, putTree, addTree, renameTree, removeTree, duplicateTree,
  blankTree, renameServiceInLibrary, TEMPLATE_TREE_NAME, LIBRARY_KEY, LEGACY_KEY,
} from '../src/utils/treeLibrary.js';
import { toggleNodeService, treeStats, updateNode } from '../src/utils/decisionTree.js';
import { DEFAULT_EFFICIENCY_TREE } from '../src/data/efficiencyDecisionTree.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; } else { failed++; console.error(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }

// ── opening it for the first time ────────────────────────────────────────
{
  const fresh = getTreeLibrary({});
  eq(fresh.trees.length, 1, 'a settings document with nothing in it still opens one tree');
  eq(fresh.trees[0].name, TEMPLATE_TREE_NAME, 'and it is the shipped C&I flow, named');
  eq(fresh.activeId, fresh.trees[0].id, 'which is the subtab in front of you');
  eq(treeStats(fresh.trees[0].tree).nodes, treeStats(DEFAULT_EFFICIENCY_TREE).nodes, 'with the template in it');
  eq(hasSavedTrees({}), false, 'nothing is saved yet, and the page says so');
}

// ── the page's old single tree becomes the first subtab ──────────────────
{
  const mine = { rootId: 'a', nodes: { a: { id: 'a', title: 'My own gate', branches: [] } } };
  const migrated = getTreeLibrary({ [LEGACY_KEY]: mine });
  eq(migrated.trees.length, 1, 'one tree, not the template beside it');
  eq(migrated.trees[0].tree.nodes.a.title, 'My own gate', 'and it is the user\'s, not the shipped one');
  eq(hasSavedTrees({ [LEGACY_KEY]: mine }), true, 'a legacy tree counts as saved');

  // Once the library is written it wins: the old key is a snapshot, not a
  // second source of truth to be merged back in on every read.
  const both = getTreeLibrary({
    [LEGACY_KEY]: mine,
    [LIBRARY_KEY]: { activeId: 't', trees: [{ id: 't', name: 'Live', tree: { rootId: 'b', nodes: { b: { id: 'b', title: 'Newer', branches: [] } } } }] },
  });
  eq(both.trees.map(t => t.name), ['Live'], 'the library is what the page reads once there is one');
}

// ── a library that will not parse still opens the page ───────────────────
{
  eq(normalizeLibrary(null).trees.length, 1, 'null reads as a fresh library');
  eq(normalizeLibrary({ trees: 'nope' }).trees.length, 1, 'so does junk in the trees field');
  eq(normalizeLibrary({ trees: [{ id: 'x', name: '', tree: null }] }).trees[0].name, 'Untitled tree',
    'a tree with no name gets one rather than an empty tab');
  ok(normalizeLibrary({ trees: [{ id: 'x', tree: null }] }).trees[0].tree.rootId,
    'and a tree with no steps opens on one, the way a single tree always did');
  eq(normalizeLibrary({ activeId: 'gone', trees: [{ id: 'x', name: 'X', tree: null }] }).activeId, 'x',
    'an active id pointing at nothing falls back to the first subtab');
  eq(normalizeLibrary({ trees: [{ id: 'x', name: 'A', tree: null }, { id: 'x', name: 'B', tree: null }] })
    .trees.map(t => t.id), ['x', 'x-1'], 'two trees saved under one id are told apart');
  eq(normalizeLibrary({ trees: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, tree: null })) })
    .trees.length, 20, 'the library is capped');
}

// ── building one from scratch ────────────────────────────────────────────
{
  const blank = blankTree();
  eq(treeStats(blank).nodes, 1, 'a new tree is one step');
  eq(treeStats(blank).branches, 0, 'with nothing wired yet');
  eq(blank.nodes[blank.rootId].services, [], 'and no service tags on it');

  const base = getTreeLibrary({});
  const { library, id } = addTree(base, { name: 'Water', tree: blankTree() });
  eq(library.trees.map(t => t.name), [TEMPLATE_TREE_NAME, 'Water'], 'the new tree is a subtab beside the first');
  eq(library.activeId, base.activeId, 'adding one does not switch to it — the caller decides that');
  eq(activeEntry(setActiveTree(library, id)).name, 'Water', 'and switching to it opens it');
  eq(setActiveTree(library, 'nope').activeId, library.activeId, 'switching to a tree that is gone changes nothing');

  // Full is full, and the caller is told rather than left wondering.
  let many = base;
  for (let i = 0; i < 25; i += 1) many = addTree(many, { name: `T${i}` }).library;
  eq(many.trees.length, 20, 'the library stops at the cap');
  eq(addTree(many, { name: 'One more' }).id, null, 'and says so instead of silently dropping the click');
}

// ── editing one subtab leaves the others alone ───────────────────────────
{
  const base = getTreeLibrary({});
  const { library, id } = addTree(base, { name: 'Water', tree: blankTree() });
  const edited = putTree(library, id, updateNode(treeEntry(library, id).tree, 'start', { title: 'Is it metered?' }));
  eq(treeEntry(edited, id).tree.nodes.start.title, 'Is it metered?', 'the edit lands on the tree it was made on');
  eq(treeEntry(edited, 'main').tree, treeEntry(library, 'main').tree, 'and the other subtab is the same object it was');
  eq(putTree(library, 'gone', blankTree()), library, 'a write to a tree that is not there is a no-op');

  eq(renameTree(library, id, '  Water  and  steam ').trees[1].name, 'Water and steam', 'a rename is tidied');
  eq(renameTree(library, id, '   '), library, 'a blank rename is refused rather than clearing the tab');
}

// ── deleting, and the one tree that can't go ─────────────────────────────
{
  const base = getTreeLibrary({});
  eq(removeTree(base, base.activeId), base, 'the last tree stays — the page has to open on something');

  const { library, id } = addTree(base, { name: 'Water' });
  const after = removeTree(setActiveTree(library, id), id);
  eq(after.trees.map(t => t.name), [TEMPLATE_TREE_NAME], 'deleting takes the tree out');
  eq(after.activeId, 'main', 'and lands you on its neighbour rather than on nothing');
  eq(removeTree(library, 'gone'), library, 'deleting a tree that is not there changes nothing');

  const { library: copied, id: copyId } = duplicateTree(library, id);
  eq(treeEntry(copied, copyId).name, 'Water copy', 'a duplicate is named after what it came from');
  eq(treeEntry(copied, copyId).tree, treeEntry(library, id).tree, 'and carries the same steps');
  eq(duplicateTree(library, 'gone').id, null, 'there is nothing to duplicate from a tree that is not there');
}

// ── a service rename reaches every tree, open or not ─────────────────────
{
  const base = getTreeLibrary({});
  const { library, id } = addTree(base, { name: 'Water', tree: blankTree() });
  let full = putTree(library, 'main', toggleNodeService(treeEntry(library, 'main').tree, 'gate2', 'Sub-metering'));
  full = putTree(full, id, toggleNodeService(treeEntry(full, id).tree, 'start', 'Sub-metering'));

  const renamed = renameServiceInLibrary(full, 'Sub-metering', 'Metering & data');
  eq(treeEntry(renamed, 'main').tree.nodes.gate2.services, ['Metering & data'], 'the open tree follows the rename');
  eq(treeEntry(renamed, id).tree.nodes.start.services, ['Metering & data'], 'and so does the one nobody is looking at');
  eq(renameServiceInLibrary(full, 'Never tagged', 'Other'), null, 'nothing carried it, so there is nothing to write');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
