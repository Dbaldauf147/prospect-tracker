// Walking a decision tree: what the routes through it become when somebody
// answers a question.
//
// A route is a list of node ids, root first, and a walk holds SEVERAL of
// them. One customer is rarely one pathway: the same account is compliance
// driven and has a target of its own, and the work that follows is the two
// routes together. So answering a second way out of a step already answered
// opens another route beside the first rather than replacing it, and the
// diagram lights up every one of them.
//
// The routes are shared by the two screens that walk a tree - the big Yes /
// No buttons on Walk it, and the answers sitting on the arrows of the
// diagram. Same act either way, so the arithmetic is here rather than in the
// view, and it can be pinned under plain Node
// (scripts/decisionWalk.test.mjs).
//
// Four cases, in the order they are tested:
//
//   the answer already given  - taken BACK, so a tick is a toggle and a
//                               wrong turn is undone where it was made
//                               rather than by starting the route again.
//   the step being stood on   - that route carries on down.
//   a step answered above     - a SECOND route, following the first as far
//                               as that step and going the other way from
//                               there. This is what picking more than one
//                               pathway is: the route already taken stays
//                               exactly as it was.
//   a step on no route at all - a route of its own, entered from the root,
//                               since splicing an answer into the middle of
//                               a route it doesn't belong to would leave a
//                               trail that never happened.
//
// `lastIndexOf`, not `indexOf`: a flow that loops (verification sends you
// back to pick the next measure) can have a step on a route twice, and the
// answer belongs to the visit you are on.

import { getNode, pathFromRoot, reachableIds } from './decisionTree.js';

/** Whether a route goes straight from `from` to `to` anywhere along it. */
function hasArrow(route, from, to) {
  for (let i = 0; i < route.length - 1; i += 1) {
    if (route[i] === from && route[i + 1] === to) return true;
  }
  return false;
}

/** The route cut back to the last `from` it answers `to` on. */
function withoutArrow(route, from, to) {
  for (let i = route.length - 2; i >= 0; i -= 1) {
    if (route[i] === from && route[i + 1] === to) return route.slice(0, i + 1);
  }
  return route;
}

/** Whether `a` is `b` as far as it goes and no further. */
function isPrefix(a, b) {
  if (a.length >= b.length) return false;
  return a.every((id, i) => b[i] === id);
}

/**
 * The routes as a walk can hold them: no route that has answered nothing, no
 * two the same, and none that is only the first half of another.
 *
 * A route cut back to where a longer one still runs through is not a second
 * pathway, it is the same pathway said twice - and left in, it would put a
 * "you are here" on a step the walk has already gone past.
 *
 * `keep` is a route index the caller wants to follow through the tidy-up;
 * the answer says where it ended up, or 0 when it didn't survive.
 */
function settle(list, keep = 0) {
  const kept = [];
  let active = 0;
  list.forEach((route, i) => {
    if (!Array.isArray(route) || route.length < 2) return;
    if (kept.some(other => isPrefix(route, other) || String(other) === String(route))) return;
    if (i === keep) active = kept.length;
    kept.push(route);
  });
  // A route already kept can be made redundant by a later one, so the drop
  // runs again over the finished list rather than only forwards.
  const out = kept.filter((route, i) => !kept.some((other, j) => j !== i && isPrefix(route, other)));
  const stillThere = out.indexOf(kept[active]);
  return { routes: out, active: stillThere === -1 ? 0 : stillThere };
}

/**
 * The routes after answering `branch` on the step `fromId`.
 *
 * `active` is the route the walk is following, which only decides which one
 * carries on when two of them are standing on the same step.
 *
 * @returns {{routes: string[][], active: number}|null} null when there is
 *   nothing to do: no such step, or a branch that isn't pointed at a step
 *   yet. Null rather than the routes unchanged, so the caller can skip the
 *   state write instead of re-rendering on a click that meant nothing.
 */
export function answerRoutes(tree, routes, fromId, branch, active = 0) {
  if (!getNode(tree, fromId)) return null;
  if (!branch?.to || !getNode(tree, branch.to)) return null;
  const list = (routes || []).length ? routes.map(r => [...r]) : [[tree.rootId]];
  // The route being followed gets first refusal on every question below it,
  // so answering on a step two routes share carries on the one in front of
  // you rather than the one that happens to be first in the list.
  const order = [active, ...list.map((_, i) => i)].filter((i, at, all) => (
    i >= 0 && i < list.length && all.indexOf(i) === at
  ));

  // Already answered: take it back, wherever it was given.
  const answered = order.filter(i => hasArrow(list[i], fromId, branch.to));
  if (answered.length) {
    const cut = list.map((route, i) => (
      answered.includes(i) ? withoutArrow(route, fromId, branch.to) : route
    ));
    return settle(cut, answered[0]);
  }

  // Standing on it: that route carries on.
  const standing = order.find(i => list[i][list[i].length - 1] === fromId);
  if (standing !== undefined) {
    const next = list.map((route, i) => (i === standing ? [...route, branch.to] : route));
    return settle(next, standing);
  }

  // Answered above: a second pathway from there, leaving the first alone.
  const through = order.find(i => list[i].includes(fromId));
  if (through !== undefined) {
    const route = list[through];
    const next = [...list, [...route.slice(0, route.lastIndexOf(fromId) + 1), branch.to]];
    return settle(next, next.length - 1);
  }

  // Nowhere near any of them: its own route, by the way in.
  const path = pathFromRoot(tree, fromId);
  const next = [...list, [...(path ? path.map(p => p.nodeId) : [fromId]), branch.to]];
  return settle(next, next.length - 1);
}

/** The consecutive pairs of a route, as `from->to` keys: the arrows answered. */
export function answeredArrows(trailSteps = []) {
  const out = new Set();
  for (let i = 0; i < trailSteps.length - 1; i += 1) {
    out.add(`${trailSteps[i]}->${trailSteps[i + 1]}`);
  }
  return out;
}

/**
 * Every arrow any route has answered.
 *
 * A Set of `from->to` keys rather than branch ids, because a route stores
 * where it went and not which way out it took: on the rare step with two
 * arrows to the same box both read as picked, which is the truth anyway -
 * either answer put you there.
 */
export function routeArrows(routes = []) {
  const out = new Set();
  for (const route of routes || []) for (const key of answeredArrows(route)) out.add(key);
  return out;
}

/**
 * The steps answered THROUGH on some route: on it, and with the route
 * carrying on past it.
 *
 * The last step of a route is where that route is standing and is still
 * waiting for an answer - unless another route runs on through it, in which
 * case it has been answered and says so.
 */
export function answeredSteps(routes = []) {
  const out = new Set();
  for (const route of routes || []) {
    for (let i = 0; i < route.length - 1; i += 1) out.add(route[i]);
  }
  return out;
}

/** Where each route has got to: one "you are here" per pathway. */
export function routeEnds(routes = []) {
  const out = new Set();
  for (const route of routes || []) {
    if (route.length) out.add(route[route.length - 1]);
  }
  return out;
}

/** Every step on any route, for the boxes the diagram lights up. */
export function routeSteps(routes = []) {
  const out = new Set();
  for (const route of routes || []) for (const id of route) out.add(id);
  return out;
}

/**
 * The tree as the diagram should draw it, given what has been answered.
 *
 * Answering a step rules out its OTHER ways out: you said No, so the Yes
 * side is not work this account is going to see, and neither is anything
 * hanging off it. Those arrows go, and every step reachable only through one
 * of them goes with them, so the diagram closes up around the pathways
 * actually picked instead of carrying the whole catalogue of what might have
 * been. That is the difference between a flowchart and the one flow you are
 * walking somebody through.
 *
 * Two things are deliberately left where they are:
 *
 *   a step the start never reached - somebody's unwired work rather than a
 *     road not taken, and it still has to be findable to get wired in.
 *   a step another pathway still reaches - picking two answers out of one
 *     question keeps both sides, which is what picking two of them means.
 *
 * The tree itself comes back untouched when nothing is ruled out, so the
 * diagram is only re-laid-out when the walk has actually narrowed it.
 */
export function prunedTree(tree, routes = []) {
  const nodes = tree?.nodes;
  if (!nodes) return tree;
  const answered = answeredSteps(routes);
  if (!answered.size) return tree;

  // The ways out of an answered step that no pathway took.
  const picked = routeArrows(routes);
  const ruled = new Set();
  for (const id of answered) {
    for (const b of nodes[id]?.branches || []) {
      const arrow = `${id}->${b.to}`;
      if (b.to && nodes[b.to] && !picked.has(arrow)) ruled.add(arrow);
    }
  }
  if (!ruled.size) return tree;

  // What the start can still get to with those arrows gone. Breadth-first
  // from the root, the same way the layout decides what is reachable at all.
  const live = new Set();
  const rootId = nodes[tree.rootId] ? tree.rootId : null;
  if (rootId) {
    live.add(rootId);
    const queue = [rootId];
    while (queue.length) {
      const id = queue.shift();
      for (const b of nodes[id].branches || []) {
        if (!b.to || !nodes[b.to] || live.has(b.to) || ruled.has(`${id}->${b.to}`)) continue;
        live.add(b.to);
        queue.push(b.to);
      }
    }
  }
  const reached = reachableIds(tree);
  const keep = id => live.has(id) || !reached.has(id);

  const out = {};
  for (const [id, node] of Object.entries(nodes)) {
    if (!keep(id)) continue;
    const branches = (node.branches || []).filter(b => (
      !ruled.has(`${id}->${b.to}`) && (!b.to || keep(b.to))
    ));
    out[id] = branches.length === (node.branches || []).length ? node : { ...node, branches };
  }
  return { ...tree, nodes: out };
}

/**
 * A route cut back to the step at `index`, with the rest of the walk kept.
 *
 * What the Back button and a click further up the trail both do. The answers
 * after the step went from it, so they go with it; the other pathways are
 * somebody else's answers and stay.
 */
export function rewindRoute(routes, active, index) {
  const list = (routes || []).map(r => [...r]);
  const route = list[active];
  if (!route || index < 0 || index >= route.length - 1) return null;
  list[active] = route.slice(0, index + 1);
  return settle(list, active);
}
