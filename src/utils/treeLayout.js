// Turning a decision tree into a flowchart: where each box goes, and how the
// arrows get from one to the next.
//
// A layered layout, top to bottom. Every step's row is its distance from the
// start, so the diagram reads as "how many decisions in" — and because the
// graph rejoins and loops, two edge shapes fall out of that:
//
//   forward  — down a row or more. The ordinary arrow.
//   back     — to the same row or an earlier one, which is the loop
//              (verification → pick the next measure) and the rejoins that
//              arrive from below. Routed out to the right so it can't be
//              mistaken for the flow continuing downward.
//
// Coordinates are plain numbers in one space the page renders twice: HTML
// boxes positioned absolutely, and an SVG layer under them for the arrows.
// Keeping the arithmetic here means the geometry can be tested without a
// browser, and the view holds no layout logic at all.

export const LAYOUT = {
  nodeWidth: 212,
  nodeHeight: 68,
  hGap: 30,
  vGap: 60,
  padding: 30,
  backBulge: 46,
  // Where a branch label sits along its arrow (0 = the step it leaves, 1 =
  // the step it reaches) and how far alternate labels are nudged apart.
  labelAlong: 0.7,
  labelStagger: 8,
};

/**
 * @returns {{ width, height, nodes: Array, edges: Array, byId: Map }}
 *   nodes: { id, x, y, w, h, layer, column, orphan }
 *   edges: { fromId, toId, branchId, label, back, x1, y1, x2, y2, labelX, labelY }
 */
export function layoutTree(tree, opts = {}) {
  const cfg = { ...LAYOUT, ...opts };
  const nodes = tree?.nodes || {};
  const rootId = tree?.rootId && nodes[tree.rootId] ? tree.rootId : null;

  // 1. Row per step: breadth-first from the start, so a step that can be
  //    reached two ways sits at its SHORTEST distance. Anything the start
  //    can't reach is parked on a row of its own below everything, where the
  //    page dims it — it's still the user's work, just not wired in.
  const layer = new Map();
  const discovered = [];
  if (rootId) {
    layer.set(rootId, 0);
    discovered.push(rootId);
    const queue = [rootId];
    while (queue.length) {
      const id = queue.shift();
      for (const b of nodes[id].branches) {
        if (!b.to || !nodes[b.to] || layer.has(b.to)) continue;
        layer.set(b.to, layer.get(id) + 1);
        discovered.push(b.to);
        queue.push(b.to);
      }
    }
  }
  const reachedDepth = discovered.length ? Math.max(...discovered.map(id => layer.get(id))) : -1;
  const orphanLayer = reachedDepth + 1;
  const orphans = new Set();
  for (const id of Object.keys(nodes)) {
    if (layer.has(id)) continue;
    layer.set(id, orphanLayer);
    orphans.add(id);
    discovered.push(id);
  }
  if (discovered.length === 0) {
    return { width: cfg.padding * 2, height: cfg.padding * 2, nodes: [], edges: [], byId: new Map() };
  }

  // 2. Order within each row. A step sits above the average position of the
  //    steps that lead to it, which is what keeps the five tiers under Gate 3
  //    instead of scattered across the row with their arrows crossing.
  const rows = new Map();
  for (const id of discovered) {
    const l = layer.get(id);
    if (!rows.has(l)) rows.set(l, []);
    rows.get(l).push(id);
  }
  const parents = new Map();
  for (const [id, node] of Object.entries(nodes)) {
    for (const b of node.branches) {
      if (!b.to || !nodes[b.to]) continue;
      if (!parents.has(b.to)) parents.set(b.to, []);
      parents.get(b.to).push(id);
    }
  }
  const columnOf = new Map();
  const orderedRows = [...rows.keys()].sort((a, b) => a - b);
  for (const l of orderedRows) {
    const ids = rows.get(l);
    if (l > 0) {
      const score = new Map();
      ids.forEach((id, i) => {
        const above = (parents.get(id) || []).filter(p => layer.get(p) < l && columnOf.has(p));
        // No parent above (an orphan, or reached only from below): hold the
        // position discovery gave it rather than jumping to column zero.
        const bary = above.length
          ? above.reduce((sum, p) => sum + columnOf.get(p), 0) / above.length
          : i;
        score.set(id, bary);
      });
      ids.sort((a, b) => (score.get(a) - score.get(b)) || ids.indexOf(a) - ids.indexOf(b));
    }
    ids.forEach((id, i) => columnOf.set(id, i));
  }

  // 3. Coordinates. Rows are centred against the widest one, so a single
  //    step sits over the middle of the five below it.
  const widest = Math.max(...orderedRows.map(l => rows.get(l).length));
  const spanOf = (count) => count * cfg.nodeWidth + (count - 1) * cfg.hGap;
  const fullSpan = spanOf(widest);
  const placed = [];
  const byId = new Map();
  for (const l of orderedRows) {
    const ids = rows.get(l);
    const left = cfg.padding + (fullSpan - spanOf(ids.length)) / 2;
    ids.forEach((id, i) => {
      const box = {
        id,
        layer: l,
        column: i,
        x: left + i * (cfg.nodeWidth + cfg.hGap),
        y: cfg.padding + l * (cfg.nodeHeight + cfg.vGap),
        w: cfg.nodeWidth,
        h: cfg.nodeHeight,
        orphan: orphans.has(id),
      };
      placed.push(box);
      byId.set(id, box);
    });
  }

  // 4. Arrows. Forward ones leave the bottom and arrive at the top; a back
  //    edge leaves and arrives on the right-hand side, bulging outward.
  const edges = [];
  for (const [id, node] of Object.entries(nodes)) {
    const from = byId.get(id);
    if (!from) continue;
    node.branches.forEach((b, branchIndex) => {
      const to = b.to ? byId.get(b.to) : null;
      if (!to) return;
      const back = to.layer <= from.layer;
      const edge = {
        fromId: id,
        toId: b.to,
        branchId: b.id,
        label: b.label,
        back,
        x1: back ? from.x + from.w : from.x + from.w / 2,
        y1: back ? from.y + from.h / 2 : from.y + from.h,
        x2: back ? to.x + to.w : to.x + to.w / 2,
        y2: back ? to.y + to.h / 2 : to.y,
      };
      if (back) {
        edge.labelX = Math.max(edge.x1, edge.x2) + cfg.backBulge * 0.75;
        edge.labelY = (edge.y1 + edge.y2) / 2;
      } else {
        // Not the midpoint: branches leaving one box start at the same point
        // and only separate as they approach their own targets, so midpoint
        // labels pile up on each other. Sit them near the target end, where
        // the arrows have already fanned out, and nudge alternate branches
        // up and down so two short hops can't collide either.
        edge.labelX = edge.x1 + (edge.x2 - edge.x1) * cfg.labelAlong;
        edge.labelY = (edge.y1 + edge.y2) / 2
          + (node.branches.length > 1 ? (branchIndex % 2 ? cfg.labelStagger : -cfg.labelStagger) : 0);
      }
      edges.push(edge);
    });
  }

  const width = cfg.padding * 2 + fullSpan + cfg.backBulge * 2;
  const height = cfg.padding * 2 + (orderedRows.length * (cfg.nodeHeight + cfg.vGap)) - cfg.vGap;
  return { width, height, nodes: placed, edges, byId };
}

/** The SVG `d` for one edge from layoutTree. */
export function edgePath(edge, opts = {}) {
  const cfg = { ...LAYOUT, ...opts };
  const { x1, y1, x2, y2 } = edge;
  if (!edge.back) {
    const dy = Math.max(y2 - y1, 1);
    return `M ${x1} ${y1} C ${x1} ${y1 + dy * 0.45}, ${x2} ${y2 - dy * 0.45}, ${x2} ${y2}`;
  }
  // Out of the right side, up (or across), and back in on the right.
  const out = Math.max(x1, x2) + cfg.backBulge;
  return `M ${x1} ${y1} C ${out} ${y1}, ${out} ${y2}, ${x2} ${y2}`;
}
