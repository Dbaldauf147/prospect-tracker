// Walking a decision tree: what the trail of answers becomes when somebody
// answers a question.
//
// The trail is a list of node ids, root first, and it is shared by the two
// screens that walk a tree - the big Yes / No buttons on Walk it, and the
// answers sitting on the arrows of the diagram. Same act either way, so the
// arithmetic is here rather than in the view, and it can be pinned under
// plain Node (scripts/decisionWalk.test.mjs).
//
// Three cases, in the order they are tested:
//
//   the answer already given  - taken BACK, so a tick is a toggle and a
//                               wrong turn is undone where it was made
//                               rather than by starting the route again.
//   a step on the trail       - the route carries on from there, and
//                               anything answered after it is dropped,
//                               because those answers followed from the one
//                               just changed.
//   a step off the trail      - the route moves there first (from the root)
//                               and then takes the answer, since splicing an
//                               answer into the middle of a route it doesn't
//                               belong to would leave a trail that never
//                               happened.
//
// `lastIndexOf`, not `indexOf`: a flow that loops (verification sends you
// back to pick the next measure) can have a step on the trail twice, and the
// answer belongs to the visit you are on.

import { getNode, pathFromRoot } from './decisionTree.js';

/**
 * The trail after answering `branch` on the step `fromId`.
 *
 * @returns {string[]|null} the new trail, or null when there is nothing to
 *   do: no such step, or a branch that isn't pointed at a step yet. Null
 *   rather than the trail unchanged, so the caller can skip the state write
 *   instead of re-rendering on a click that meant nothing.
 */
export function answerTrail(tree, trail, fromId, branch) {
  if (!getNode(tree, fromId)) return null;
  if (!branch?.to || !getNode(tree, branch.to)) return null;
  const steps = (trail || []).length ? [...trail] : [tree.rootId];
  const at = steps.lastIndexOf(fromId);
  if (at !== -1) {
    return steps[at + 1] === branch.to
      ? steps.slice(0, at + 1)
      : [...steps.slice(0, at + 1), branch.to];
  }
  const path = pathFromRoot(tree, fromId);
  return [...(path ? path.map(p => p.nodeId) : [fromId]), branch.to];
}

/** The consecutive pairs of a trail, as `from->to` keys: the arrows answered. */
export function answeredArrows(trailSteps = []) {
  const out = new Set();
  for (let i = 0; i < trailSteps.length - 1; i += 1) {
    out.add(`${trailSteps[i]}->${trailSteps[i + 1]}`);
  }
  return out;
}
