// The decision-tree data model, as pure functions.
//
// A tree is `{ rootId, nodes: { [id]: node } }` and a node is:
//
//   { id, kind: 'question' | 'outcome', title, detail,
//     branches: [{ id, label, to }] }
//
// `to` is another node's id, or null for a branch that hasn't been pointed
// anywhere yet. Branches are an ARRAY, not a yes/no pair: a gate asks
// "forced? yes / no", but the payback gate asks "<2 years / 2-5 / >5", and
// the tier gate has five ways out. One shape covers all of them, and the
// user can relabel any branch without the model caring.
//
// Every mutation returns a NEW tree and shares the subtrees it didn't touch,
// so React sees a changed reference exactly when something changed.
//
// Nodes are addressed by id and a branch may point at any node, so the graph
// can rejoin (five tiers all continue at the economics gate) and can loop
// (verification sends you back to pick the next measure). That's the real
// process, so the model allows it and the readers below are the ones that
// stay finite — see outlineRows.

const KINDS = new Set(['question', 'outcome']);

// Free text the user types. Capped because this all lives in one Firestore
// settings document with a hard size limit, and an accidental paste of a
// whole report shouldn't be the thing that refuses every later save.
const MAX_TITLE = 200;
const MAX_DETAIL = 4000;
const MAX_LABEL = 120;
const MAX_NODES = 500;

const text = (v, max) => String(v ?? '').slice(0, max);

/** A short unique id, avoiding anything already in `taken`. */
export function makeId(prefix, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  const base = String(prefix || 'n').replace(/[^a-zA-Z0-9_-]/g, '') || 'n';
  for (let i = 0; i < 10000; i += 1) {
    const id = i === 0 ? base : `${base}-${i}`;
    if (!used.has(id)) return id;
  }
  return `${base}-${Date.now()}`;
}

function normalizeNode(raw, id) {
  const kind = KINDS.has(raw?.kind) ? raw.kind : 'question';
  const seen = new Set();
  const branches = [];
  for (const b of Array.isArray(raw?.branches) ? raw.branches : []) {
    if (!b || typeof b !== 'object') continue;
    const bid = makeId(String(b.id || 'b'), seen);
    seen.add(bid);
    branches.push({
      id: bid,
      label: text(b.label, MAX_LABEL),
      to: b.to == null ? null : String(b.to),
    });
  }
  return { id, kind, title: text(raw?.title, MAX_TITLE), detail: text(raw?.detail, MAX_DETAIL), branches };
}

// Read a tree from anywhere it might have been stored — a settings document
// written by an older version, a pasted export, a half-saved write. Anything
// unusable is dropped rather than thrown: a tree that won't parse must still
// open, because the alternative is a page the user can't get back into to
// fix it. A branch pointing at a node that no longer exists is unlinked, not
// dropped, so the label survives and the user can re-point it.
export function normalizeTree(raw) {
  const nodes = {};
  const entries = raw && typeof raw.nodes === 'object' && raw.nodes ? Object.entries(raw.nodes) : [];
  for (const [key, value] of entries.slice(0, MAX_NODES)) {
    const id = String(value?.id || key || '').trim();
    if (!id) continue;
    nodes[id] = normalizeNode(value, id);
  }
  for (const node of Object.values(nodes)) {
    for (const b of node.branches) {
      if (b.to != null && !nodes[b.to]) b.to = null;
    }
  }
  let rootId = raw?.rootId == null ? '' : String(raw.rootId);
  if (!nodes[rootId]) rootId = Object.keys(nodes)[0] || '';
  if (!rootId) {
    // Nothing salvageable. One empty question beats an unopenable page.
    const id = 'start';
    nodes[id] = { id, kind: 'question', title: 'Start here', detail: '', branches: [] };
    rootId = id;
  }
  return { rootId, nodes };
}

export function getNode(tree, id) {
  return (id && tree?.nodes?.[id]) || null;
}

/** Ids a branch of `id` points at, in branch order, deduped. */
export function childIds(tree, id) {
  const out = [];
  const seen = new Set();
  for (const b of getNode(tree, id)?.branches || []) {
    if (!b.to || seen.has(b.to) || !tree.nodes[b.to]) continue;
    seen.add(b.to);
    out.push(b.to);
  }
  return out;
}

/** Every id reachable from the root by following branches. */
export function reachableIds(tree) {
  const seen = new Set();
  const stack = tree?.rootId ? [tree.rootId] : [];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id) || !tree.nodes[id]) continue;
    seen.add(id);
    for (const b of tree.nodes[id].branches) if (b.to) stack.push(b.to);
  }
  return seen;
}

// Nodes no route from the root reaches any more — usually the remains of a
// deleted step. They're listed rather than swept up: the text in them is work
// the user did, and a delete that silently takes five more nodes with it is
// the kind of thing you only notice a week later.
export function orphanIds(tree) {
  const reachable = reachableIds(tree);
  return Object.keys(tree?.nodes || {}).filter(id => !reachable.has(id)).sort();
}

// The outline: one row per place a node is drawn, depth-first in branch
// order. A node is expanded the FIRST time it's reached and marked `repeat`
// every time after, which is what keeps a rejoining or looping graph finite
// — and readable, since the economics gate is drawn once rather than under
// all five tiers.
export function outlineRows(tree) {
  const rows = [];
  const expanded = new Set();
  const walk = (id, depth, parentId, branch) => {
    const node = getNode(tree, id);
    if (!node) return;
    const repeat = expanded.has(id);
    rows.push({
      nodeId: id,
      depth,
      parentId,
      branchId: branch?.id || null,
      branchLabel: branch?.label || '',
      repeat,
    });
    if (repeat) return;
    expanded.add(id);
    for (const b of node.branches) {
      if (b.to && tree.nodes[b.to]) walk(b.to, depth + 1, id, b);
      else rows.push({ nodeId: null, depth: depth + 1, parentId: id, branchId: b.id, branchLabel: b.label, repeat: false });
    }
  };
  if (tree?.rootId) walk(tree.rootId, 0, null, null);
  return rows;
}

// The shortest route from the root to `targetId`, as the steps you'd answer
// to get there. Breadth-first, so a node that can be reached two ways
// reports the short way. Null when nothing reaches it.
export function pathFromRoot(tree, targetId) {
  if (!getNode(tree, targetId)) return null;
  if (tree.rootId === targetId) return [{ nodeId: targetId, branchLabel: '' }];
  const queue = [[tree.rootId]];
  const seen = new Set([tree.rootId]);
  while (queue.length) {
    const path = queue.shift();
    const node = getNode(tree, path[path.length - 1]);
    if (!node) continue;
    for (const b of node.branches) {
      if (!b.to || seen.has(b.to) || !tree.nodes[b.to]) continue;
      const next = [...path, b.to];
      if (b.to === targetId) {
        return next.map((id, i) => ({
          nodeId: id,
          branchLabel: i === 0 ? '' : labelBetween(tree, next[i - 1], id),
        }));
      }
      seen.add(b.to);
      queue.push(next);
    }
  }
  return null;
}

function labelBetween(tree, fromId, toId) {
  return (getNode(tree, fromId)?.branches || []).find(b => b.to === toId)?.label || '';
}

export function treeStats(tree) {
  const nodes = Object.values(tree?.nodes || {});
  let branches = 0;
  let unlinked = 0;
  for (const n of nodes) {
    branches += n.branches.length;
    unlinked += n.branches.filter(b => !b.to).length;
  }
  return {
    nodes: nodes.length,
    branches,
    unlinked,
    orphans: orphanIds(tree).length,
    ends: nodes.filter(n => n.branches.length === 0).length,
  };
}

// ── mutations ────────────────────────────────────────────────────────────

function withNode(tree, id, node) {
  return { ...tree, nodes: { ...tree.nodes, [id]: node } };
}

export function updateNode(tree, id, patch) {
  const node = getNode(tree, id);
  if (!node) return tree;
  const next = { ...node };
  if ('title' in patch) next.title = text(patch.title, MAX_TITLE);
  if ('detail' in patch) next.detail = text(patch.detail, MAX_DETAIL);
  if ('kind' in patch && KINDS.has(patch.kind)) next.kind = patch.kind;
  return withNode(tree, id, next);
}

/**
 * Add a node and, when `parentId`/`branchId` are given, point that branch at
 * it. Returns `{ tree, id }` — the caller usually wants to select the new
 * node straight away.
 */
export function addNode(tree, { parentId = null, branchId = null, title = '', kind = 'question', detail = '' } = {}) {
  if (Object.keys(tree.nodes).length >= MAX_NODES) return { tree, id: null };
  const id = makeId('n', new Set(Object.keys(tree.nodes)));
  let next = withNode(tree, id, { id, kind: KINDS.has(kind) ? kind : 'question', title: text(title, MAX_TITLE), detail: text(detail, MAX_DETAIL), branches: [] });
  if (parentId && next.nodes[parentId]) {
    if (branchId) next = setBranchTarget(next, parentId, branchId, id);
    else next = addBranch(next, parentId, { label: '', to: id });
  }
  return { tree: next, id };
}

export function addBranch(tree, nodeId, { label = '', to = null } = {}) {
  const node = getNode(tree, nodeId);
  if (!node) return tree;
  const id = makeId('b', new Set(node.branches.map(b => b.id)));
  const branch = { id, label: text(label, MAX_LABEL), to: to && tree.nodes[to] ? to : null };
  return withNode(tree, nodeId, { ...node, branches: [...node.branches, branch] });
}

export function updateBranch(tree, nodeId, branchId, patch) {
  const node = getNode(tree, nodeId);
  if (!node) return tree;
  const branches = node.branches.map(b => {
    if (b.id !== branchId) return b;
    const next = { ...b };
    if ('label' in patch) next.label = text(patch.label, MAX_LABEL);
    if ('to' in patch) next.to = patch.to && tree.nodes[patch.to] ? patch.to : null;
    return next;
  });
  return withNode(tree, nodeId, { ...node, branches });
}

export function setBranchTarget(tree, nodeId, branchId, to) {
  return updateBranch(tree, nodeId, branchId, { to });
}

export function removeBranch(tree, nodeId, branchId) {
  const node = getNode(tree, nodeId);
  if (!node) return tree;
  return withNode(tree, nodeId, { ...node, branches: node.branches.filter(b => b.id !== branchId) });
}

/** Move a branch up (-1) or down (+1) in its node's order. */
export function moveBranch(tree, nodeId, branchId, delta) {
  const node = getNode(tree, nodeId);
  if (!node) return tree;
  const from = node.branches.findIndex(b => b.id === branchId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= node.branches.length) return tree;
  const branches = [...node.branches];
  const [moved] = branches.splice(from, 1);
  branches.splice(to, 0, moved);
  return withNode(tree, nodeId, { ...node, branches });
}

/**
 * Delete a node. Every branch pointing at it is unlinked (the label stays, so
 * the question still reads correctly and can be re-pointed). The root can't
 * be deleted — there'd be nothing to open the page on.
 *
 * `cascade` also deletes whatever the node led to that nothing else reaches,
 * for throwing away a whole wrong limb.
 */
export function deleteNode(tree, id, { cascade = false } = {}) {
  if (!getNode(tree, id) || id === tree.rootId) return tree;
  const nodes = {};
  for (const [key, node] of Object.entries(tree.nodes)) {
    if (key === id) continue;
    nodes[key] = { ...node, branches: node.branches.map(b => (b.to === id ? { ...b, to: null } : b)) };
  }
  let next = { ...tree, nodes };
  if (cascade) {
    // Anything the deleted node was the only route to goes with it. Repeated
    // until nothing new is stranded, since a limb strands one layer at a time.
    for (;;) {
      const stranded = orphanIds(next);
      if (stranded.length === 0) break;
      const pruned = { ...next.nodes };
      for (const orphan of stranded) delete pruned[orphan];
      next = { ...next, nodes: pruned };
    }
  }
  return next;
}

/** Make `id` the node the walk starts from. */
export function setRoot(tree, id) {
  return getNode(tree, id) ? { ...tree, rootId: id } : tree;
}

// ── reading the detail text ──────────────────────────────────────────────

// The detail field is a plain textarea — whatever the user types is what they
// meant — but two conventions are worth honouring when drawing it: a blank
// line starts a new paragraph, and a line opening with "* " or "- " is a
// bullet. Returns blocks of `{ type: 'p', text }` and `{ type: 'ul', items }`
// so the view can render them without parsing anything itself.
export function detailBlocks(detail) {
  const blocks = [];
  let para = [];
  let bullets = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
    para = [];
  };
  const flushBullets = () => {
    if (bullets.length) blocks.push({ type: 'ul', items: bullets });
    bullets = [];
  };
  for (const raw of String(detail ?? '').split('\n')) {
    const line = raw.trim();
    const bullet = /^[*-]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      bullets.push(bullet[1].trim());
    } else if (!line) {
      flushBullets();
      flushPara();
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushBullets();
  flushPara();
  return blocks;
}
