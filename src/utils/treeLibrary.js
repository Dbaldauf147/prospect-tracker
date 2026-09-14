// More than one decision tree on the Efficiency Decision Tree page.
//
// The page shipped with exactly one tree — the C&I efficiency flow — stored
// at settings.efficiencyDecisionTree. That is the right tree for the
// question it answers and the wrong one for every other question somebody
// wants to sequence, so the page now holds a LIBRARY: named trees, one
// subtab each, any of which can be built from nothing.
//
//   { activeId, trees: [{ id, name, tree }] }
//
// `tree` is the same shape decisionTree.js has always read and written, so
// every step, branch and service tag on it works in a tree the user built
// exactly as it does in the shipped one.
//
// The old single-tree key is still read: a user who customised it opens the
// library with their tree as the first subtab, named and intact. Nothing
// writes back to that key — the first save here is what makes the library
// authoritative — so it stays behind as the last pre-library snapshot
// rather than as a second source of truth.

import { makeId, normalizeTree, renameServiceInTree } from './decisionTree.js';
import { DEFAULT_EFFICIENCY_TREE } from '../data/efficiencyDecisionTree.js';

export const LIBRARY_KEY = 'efficiencyTrees';
export const LEGACY_KEY = 'efficiencyDecisionTree';

// The name the shipped flow takes when it becomes one subtab among several.
export const TEMPLATE_TREE_NAME = 'C&I efficiency';

// Enough for the handful of flows a team actually keeps, and few enough that
// the subtab strip stays a strip. Everything here lives in one size-limited
// settings document, which is the real ceiling.
const MAX_TREES = 20;
const MAX_NAME = 60;

const name = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

/** A tree with one step and nothing else — what "build one from scratch" starts from. */
export function blankTree(title = 'Start here') {
  return normalizeTree({
    rootId: 'start',
    nodes: { start: { id: 'start', kind: 'question', title, detail: '', services: [], branches: [] } },
  });
}

/**
 * Read the library from anywhere it might be: the library key, the old
 * single-tree key, or nothing at all.
 *
 * Like normalizeTree, this never throws and never returns empty — the page
 * has to open on something, and a library that won't parse is exactly when
 * the user needs the page to open so they can fix it.
 */
export function normalizeLibrary(raw, { legacy = null } = {}) {
  const trees = [];
  const taken = new Set();
  for (const entry of Array.isArray(raw?.trees) ? raw.trees.slice(0, MAX_TREES) : []) {
    if (!entry || typeof entry !== 'object') continue;
    const id = makeId(String(entry.id || 't'), taken);
    taken.add(id);
    trees.push({ id, name: name(entry.name) || 'Untitled tree', tree: normalizeTree(entry.tree) });
  }
  if (trees.length === 0) {
    // First open, or a library too broken to read: the user's own tree if
    // they ever edited the single-tree page, the shipped template if not.
    trees.push({
      id: 'main',
      name: TEMPLATE_TREE_NAME,
      tree: normalizeTree(legacy || DEFAULT_EFFICIENCY_TREE),
    });
  }
  const activeId = trees.some(t => t.id === raw?.activeId) ? String(raw.activeId) : trees[0].id;
  return { activeId, trees };
}

/** The library as stored in a settings document, migrating the old key. */
export function getTreeLibrary(settings) {
  return normalizeLibrary(settings?.[LIBRARY_KEY], { legacy: settings?.[LEGACY_KEY] || null });
}

/** Whether anything is saved yet — the page says so, since until then the template is on loan. */
export function hasSavedTrees(settings) {
  return !!(settings?.[LIBRARY_KEY] || settings?.[LEGACY_KEY]);
}

/** The subtab being edited. Never null: the library always has at least one tree. */
export function activeEntry(library) {
  return library.trees.find(t => t.id === library.activeId) || library.trees[0];
}

export function treeEntry(library, id) {
  return library.trees.find(t => t.id === id) || null;
}

export function setActiveTree(library, id) {
  return treeEntry(library, id) ? { ...library, activeId: id } : library;
}

/** Write one tree back into the library, leaving every other subtab alone. */
export function putTree(library, id, tree) {
  if (!treeEntry(library, id)) return library;
  return { ...library, trees: library.trees.map(t => (t.id === id ? { ...t, tree } : t)) };
}

/**
 * Add a subtab. Returns `{ library, id }` — id is null when the library is
 * full, which the caller says out loud rather than dropping the click.
 */
export function addTree(library, { name: label = '', tree = null } = {}) {
  if (library.trees.length >= MAX_TREES) return { library, id: null };
  const id = makeId('t', new Set(library.trees.map(t => t.id)));
  const entry = { id, name: name(label) || 'Untitled tree', tree: normalizeTree(tree || blankTree()) };
  return { library: { ...library, trees: [...library.trees, entry] }, id };
}

export function renameTree(library, id, label) {
  const clean = name(label);
  if (!clean || !treeEntry(library, id)) return library;
  return { ...library, trees: library.trees.map(t => (t.id === id ? { ...t, name: clean } : t)) };
}

/**
 * Delete a subtab. The last one can't go — the page would have nothing to
 * open on — and deleting the active tab moves to its neighbour rather than
 * leaving the page pointing at something that isn't there.
 */
export function removeTree(library, id) {
  if (library.trees.length <= 1 || !treeEntry(library, id)) return library;
  const index = library.trees.findIndex(t => t.id === id);
  const trees = library.trees.filter(t => t.id !== id);
  const activeId = library.activeId === id
    ? trees[Math.min(index, trees.length - 1)].id
    : library.activeId;
  return { activeId, trees };
}

/** A copy of one tree as its own subtab — how a variant starts from a flow that mostly works. */
export function duplicateTree(library, id) {
  const entry = treeEntry(library, id);
  if (!entry) return { library, id: null };
  return addTree(library, { name: `${entry.name} copy`, tree: entry.tree });
}

/**
 * Follow a service rename through every tree in the library. Returns the
 * next library, or null when no step anywhere carried the old name.
 *
 * Every tree, not just the open one: a tag is the service's name, and a
 * subtab nobody has looked at this month is exactly where a stale tag would
 * sit unnoticed.
 */
export function renameServiceInLibrary(library, from, to) {
  let touched = false;
  const trees = library.trees.map((entry) => {
    const next = renameServiceInTree(entry.tree, from, to);
    if (!next) return entry;
    touched = true;
    return { ...entry, tree: next };
  });
  return touched ? { ...library, trees } : null;
}
