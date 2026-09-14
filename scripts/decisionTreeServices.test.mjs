// Assertion tests for the service tags on the Efficiency Decision Tree —
// which of our services deliver the thing a step describes.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/decisionTreeServices.test.mjs
//
// A tag is the service's NAME, because that is the key the Solutions list,
// the rate card and the Scope picker all share. That choice is the thing to
// pin: it makes a rename a real event (the tag has to follow it, or a step
// ends up pointing at a service nothing lists), and it makes a name the
// catalog no longer has something to KEEP and mark rather than quietly drop
// — a dropped tag takes a decision somebody made with it.
import {
  normalizeTree, normalizeServices, toggleNodeService, serviceUsage,
  renameServiceInTree, treeStats, updateNode, addNode, getNode,
} from '../src/utils/decisionTree.js';
import { DEFAULT_EFFICIENCY_TREE } from '../src/data/efficiencyDecisionTree.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; } else { failed++; console.error(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}
function ok(cond, name) { eq(!!cond, true, name); }

// ── the stored shape ─────────────────────────────────────────────────────

eq(normalizeServices(['  Sub-metering  ', 'API/ETL', 'Sub-metering', '', null, 'API/ETL']),
  ['Sub-metering', 'API/ETL'],
  'tags are trimmed, blanks dropped, duplicates dropped, order kept');
eq(normalizeServices('Sub-metering'), [], 'a string that is not a list is not one tag, it is none');
eq(normalizeServices(undefined), [], 'a step saved before tags existed has none');
eq(normalizeServices(Array.from({ length: 60 }, (_, i) => `S${i}`)).length, 40, 'the list per step is capped');
eq(normalizeServices(['x'.repeat(300)])[0].length, 120, 'and each name is capped');

// A tree written before this feature opens with every step untagged rather
// than with `services: undefined` for the view to guard against.
const seed = normalizeTree(DEFAULT_EFFICIENCY_TREE);
ok(Object.values(seed.nodes).every(n => Array.isArray(n.services)), 'every step of the template has a tag list');
eq(treeStats(seed).tagged, 0, 'the shipped template tags nothing - the services are the user\'s');

// ── tagging and untagging ────────────────────────────────────────────────
{
  let tree = toggleNodeService(seed, 'gate2', 'Sub-metering');
  tree = toggleNodeService(tree, 'gate2', 'API/ETL');
  eq(tree.nodes.gate2.services, ['Sub-metering', 'API/ETL'], 'a tag goes on, in the order it was added');
  eq(toggleNodeService(tree, 'gate2', 'Sub-metering').nodes.gate2.services, ['API/ETL'],
    'the same click takes it off again');
  eq(toggleNodeService(tree, 'gate2', '  API/ETL  ').nodes.gate2.services, ['Sub-metering'],
    'a name is matched trimmed, so a padded click still toggles the tag it means');

  // The tree comes back untouched rather than half-written.
  eq(toggleNodeService(tree, 'nope', 'Sub-metering'), tree, 'a step that is not there is a no-op');
  eq(toggleNodeService(tree, 'gate2', '   '), tree, 'so is a blank name');
  eq(tree.nodes.gate1.services, [], 'tagging one step leaves the others alone');

  // Full is full: the 41st is refused rather than silently dropping one.
  let many = seed;
  for (let i = 0; i < 45; i += 1) many = toggleNodeService(many, 'gate1', `S${i}`);
  eq(many.nodes.gate1.services.length, 40, 'a step stops at the cap');
  eq(many.nodes.gate1.services.includes('S39'), true, 'keeping the first forty');
  eq(many.nodes.gate1.services.includes('S40'), false, 'and refusing the rest');

  // The other way in: the editor writes the whole list at once.
  eq(updateNode(seed, 'gate1', { services: ['A', 'A', ' B '] }).nodes.gate1.services, ['A', 'B'],
    'setting the list outright cleans it the same way');
  eq(addNode(seed, { parentId: 'gate1', title: 'New' }).tree.nodes[
    addNode(seed, { parentId: 'gate1', title: 'New' }).id].services, [],
    'a new step starts with no tags');
}

// ── reading them back ────────────────────────────────────────────────────
{
  let tree = toggleNodeService(seed, 'gate2', 'Sub-metering');
  tree = toggleNodeService(tree, 'gate3', 'Sub-metering');
  tree = toggleNodeService(tree, 'gate3', 'Audits');

  const usage = serviceUsage(tree);
  eq([...usage.get('Sub-metering')].sort(), ['gate2', 'gate3'],
    'the reverse lookup says where a service lands in the flow');
  eq(usage.get('Audits'), ['gate3'], 'a service tagged once shows one step');
  eq(usage.has('Nothing'), false, 'a service tagged nowhere is not in it');

  const stats = treeStats(tree);
  eq([stats.tagged, stats.services], [2, 2],
    'the header counts steps tagged and distinct services, not tags');
}

// ── a rename has to take the tags with it ────────────────────────────────
{
  let tree = toggleNodeService(seed, 'gate2', 'Sub-metering');
  tree = toggleNodeService(tree, 'gate3', 'Sub-metering');
  tree = toggleNodeService(tree, 'gate3', 'Audits');

  const renamed = renameServiceInTree(tree, 'Sub-metering', 'Metering & data');
  eq(renamed.nodes.gate2.services, ['Metering & data'], 'the tag follows the rename');
  eq(renamed.nodes.gate3.services, ['Metering & data', 'Audits'], 'on every step carrying it, in place');
  eq(getNode(renamed, 'gate1').services, [], 'and nowhere else');

  eq(renameServiceInTree(tree, 'Never tagged', 'Something'), null,
    'nothing carried the old name, so there is nothing to write');
  eq(renameServiceInTree(tree, 'Sub-metering', '  '), null, 'a blank new name is not a rename');
  eq(renameServiceInTree(tree, 'Sub-metering', 'Sub-metering'), null, 'neither is renaming to itself');

  // Renaming INTO a name a step already carries must not tag it twice.
  const collided = renameServiceInTree(tree, 'Sub-metering', 'Audits');
  eq(collided.nodes.gate3.services, ['Audits'], 'a rename onto an existing tag merges rather than duplicates');
}

// ── a tag the catalog no longer has survives the read ────────────────────
//
// The page marks these rather than dropping them: the service may be renamed,
// retired, or simply on another user's list, and the tag is a decision.
{
  const stored = { rootId: 'a', nodes: { a: { id: 'a', title: 'A', services: ['Retired service'], branches: [] } } };
  eq(normalizeTree(stored).nodes.a.services, ['Retired service'],
    'a tag naming a service nothing lists is kept, not swept up');
  eq(normalizeTree({ rootId: 'a', nodes: { a: { id: 'a', services: 'nope', branches: [] } } }).nodes.a.services, [],
    'and junk in the field reads as no tags rather than throwing the page away');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
