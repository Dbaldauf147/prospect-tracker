// Assertion tests for the flowchart layout behind the Efficiency Decision
// Tree page's Diagram mode. Plain Node — no test framework (the project has
// none). Run:
//   node scripts/treeLayout.test.mjs
//
// The layout is the part of a diagram that can be wrong without looking
// broken: boxes that overlap, arrows that point back up the page as if the
// flow continued, a step drawn twice, a loop that never terminates. None of
// that needs a browser to catch, so it's pinned here.
import { layoutTree, edgePath, LAYOUT } from '../src/utils/treeLayout.js';
import { normalizeTree } from '../src/utils/decisionTree.js';
import { DEFAULT_EFFICIENCY_TREE } from '../src/data/efficiencyDecisionTree.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${b}\n        got      ${a}`); }
}
function ok(cond, name, detail = '') { eq(!!cond, true, `${name}${cond ? '' : ` — ${detail}`}`); }

const tree = normalizeTree(DEFAULT_EFFICIENCY_TREE);
const layout = layoutTree(tree);
const at = (id) => layout.byId.get(id);

// ── one box per step, exactly once ───────────────────────────────────────

eq(layout.nodes.length, Object.keys(tree.nodes).length, 'every step gets a box');
eq(new Set(layout.nodes.map(n => n.id)).size, layout.nodes.length, 'and only one box each');

// ── rows are "how many decisions in" ─────────────────────────────────────

eq(at('gate1').layer, 0, 'the start is the top row');
eq(at('gate2').layer, 1, 'Gate 2 is one decision in');
eq(new Set(['tier1', 'tier2', 'tier3', 'tier4', 'tier5'].map(id => at(id).layer)).size, 1,
  'the five tiers share a row');
ok(at('gate4').layer > at('tier1').layer, 'the economics gate sits below the tiers it rejoins from');
ok(at('gate7').layer > at('gate6').layer, 'and the gates run down the page in order');

// A step reachable two ways is drawn at the shorter distance, not the longer.
eq(at('gate3').layer, 2, 'Gate 3 sits at its shortest distance from the start');

// ── no box lands on another ──────────────────────────────────────────────

const overlaps = [];
for (let i = 0; i < layout.nodes.length; i += 1) {
  for (let j = i + 1; j < layout.nodes.length; j += 1) {
    const a = layout.nodes[i], b = layout.nodes[j];
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    if (!apart) overlaps.push(`${a.id}/${b.id}`);
  }
}
eq(overlaps, [], 'no two boxes overlap');

// Everything is inside the canvas the page scrolls.
const outside = layout.nodes.filter(n => n.x < 0 || n.y < 0 || n.x + n.w > layout.width || n.y + n.h > layout.height);
eq(outside.map(n => n.id), [], 'every box is inside the canvas');

// ── arrows ───────────────────────────────────────────────────────────────

eq(layout.edges.length, Object.values(tree.nodes).reduce((n, node) => n + node.branches.filter(b => b.to).length, 0),
  'one arrow per branch that points somewhere');

const forward = layout.edges.filter(e => !e.back);
ok(forward.every(e => e.y2 > e.y1), 'a forward arrow always travels down the page');
ok(forward.every(e => e.y1 === at(e.fromId).y + at(e.fromId).h), 'leaving the bottom of its box');
ok(forward.every(e => e.y2 === at(e.toId).y), 'and arriving at the top of the next');

// The loop back to the measure hierarchy is the one that has to be drawn
// differently — as a forward arrow it would read as "carry on downward".
const loop = layout.edges.find(e => e.fromId === 'persistence' && e.toId === 'gate3');
ok(loop, 'the verification loop is drawn');
eq(loop.back, true, 'and marked as a back edge, not an ordinary arrow');
eq(loop.label, 'Re-survey scheduled — take the next measure', 'carrying the branch label');

const rejoin = layout.edges.filter(e => e.toId === 'gate4');
eq(rejoin.length, 5, 'all five tiers arrow into the economics gate');
eq(rejoin.filter(e => e.back).length, 0, 'and none of those is a back edge — they all come from above');

// Back edges leave and re-enter on the right, clear of the boxes.
const backs = layout.edges.filter(e => e.back);
ok(backs.length > 0, 'the template has at least one back edge');
ok(backs.every(e => e.x1 === at(e.fromId).x + at(e.fromId).w), 'a back edge leaves the right side of its box');
ok(backs.every(e => e.labelX > Math.max(e.x1, e.x2)), 'and its label sits out in the margin it is routed through');
ok(layout.width > LAYOUT.padding * 2, 'the canvas leaves room for that routing');

// ── the path strings the SVG draws ───────────────────────────────────────

const straight = edgePath({ back: false, x1: 0, y1: 0, x2: 0, y2: 100 });
ok(straight.startsWith('M 0 0 C'), 'a forward edge is a cubic from its start', straight);
ok(straight.endsWith('0 100'), 'ending at its target', straight);
const backPath = edgePath({ back: true, x1: 100, y1: 50, x2: 40, y2: 10 });
ok(backPath.includes(`${100 + LAYOUT.backBulge}`), 'a back edge bulges past the wider of its two ends', backPath);
// A same-row edge would divide by zero if the curve assumed a drop.
ok(!edgePath({ back: false, x1: 0, y1: 10, x2: 50, y2: 10 }).includes('NaN'), 'a zero-height forward edge still draws');

// ── unreachable steps, and other awkward trees ───────────────────────────

const stranded = normalizeTree({
  rootId: 'a',
  nodes: {
    a: { id: 'a', title: 'A', branches: [{ id: 'b1', label: 'go', to: 'b' }] },
    b: { id: 'b', title: 'B', branches: [] },
    lost: { id: 'lost', title: 'Lost', branches: [] },
  },
});
const strandedLayout = layoutTree(stranded);
eq(strandedLayout.byId.get('lost').orphan, true, 'a step nothing reaches is flagged so the page can dim it');
ok(strandedLayout.byId.get('lost').layer > strandedLayout.byId.get('b').layer,
  'and parked below the flow rather than inside it');
eq(strandedLayout.byId.get('a').orphan, false, 'a step on the flow is not flagged');

// Self-reference: a branch pointing at its own step. Real enough to survive a
// user's edit, and it must not produce a zero-length arrow or a stuck loop.
const selfLoop = layoutTree(normalizeTree({
  rootId: 'a', nodes: { a: { id: 'a', title: 'A', branches: [{ id: 'b1', label: 'again', to: 'a' }] } },
}));
eq(selfLoop.edges.length, 1, 'a self-reference draws one arrow');
eq(selfLoop.edges[0].back, true, 'routed as a back edge');

const empty = layoutTree({ rootId: '', nodes: {} });
eq(empty.nodes, [], 'an empty tree lays out to nothing');
ok(empty.width > 0 && empty.height > 0, 'with a canvas that still has a size');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
