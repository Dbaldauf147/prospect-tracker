// The curve recharts draws for `type="monotone"`: d3's curveMonotoneX
// (Fritsch-Carlson). A smooth line through every point that never
// overshoots it, so a week at 100% is drawn at 100% and not above.
//
// Kept separate so the email's picture of a Progress chart and the Weekly
// Report page's copy of it bend exactly where the Progress tab does.

const sign = (x) => (x < 0 ? -1 : 1);

/**
 * The cubic Bézier segments through `pts` ([{ x, y }], x increasing), as
 * [{ x0, y0, c1x, c1y, c2x, c2y, x1, y1 }]. One point gives none; two give
 * a straight segment (its control points on the line).
 */
export function monotoneSegments(pts) {
  const n = pts.length;
  if (n < 2) return [];
  if (n === 2) {
    const [a, b] = pts;
    const dx = (b.x - a.x) / 3;
    const dy = (b.y - a.y) / 3;
    return [{ x0: a.x, y0: a.y, c1x: a.x + dx, c1y: a.y + dy, c2x: b.x - dx, c2y: b.y - dy, x1: b.x, y1: b.y }];
  }
  // Tangent at every interior point, as d3's slope3.
  const t = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i += 1) {
    const h0 = pts[i].x - pts[i - 1].x;
    const h1 = pts[i + 1].x - pts[i].x;
    const s0 = (pts[i].y - pts[i - 1].y) / (h0 || (h1 < 0 && -0));
    const s1 = (pts[i + 1].y - pts[i].y) / (h1 || (h0 < 0 && -0));
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    t[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  // The two ends, as d3's slope2: from the neighbouring tangent.
  const endSlope = (a, b, tn) => {
    const h = b.x - a.x;
    return h ? (3 * (b.y - a.y) / h - tn) / 2 : tn;
  };
  t[0] = endSlope(pts[0], pts[1], t[1]);
  t[n - 1] = endSlope(pts[n - 2], pts[n - 1], t[n - 2]);

  const out = [];
  for (let i = 0; i < n - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = (b.x - a.x) / 3;
    out.push({
      x0: a.x, y0: a.y,
      c1x: a.x + dx, c1y: a.y + dx * t[i],
      c2x: b.x - dx, c2y: b.y - dx * t[i + 1],
      x1: b.x, y1: b.y,
    });
  }
  return out;
}

/** The same curve as an SVG path `d`, starting with a move to the first point. */
export function monotonePath(pts) {
  if (!pts.length) return '';
  const f = (v) => (Math.round(v * 100) / 100).toString();
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (const s of monotoneSegments(pts)) {
    d += `C${f(s.c1x)},${f(s.c1y)},${f(s.c2x)},${f(s.c2y)},${f(s.x1)},${f(s.y1)}`;
  }
  return d;
}

/** The curve flattened to a polyline, `steps` straight pieces per segment. */
export function monotonePolyline(pts, steps = 12) {
  if (pts.length < 2) return pts.map(p => ({ x: p.x, y: p.y }));
  const out = [{ x: pts[0].x, y: pts[0].y }];
  for (const s of monotoneSegments(pts)) {
    for (let k = 1; k <= steps; k += 1) {
      const u = k / steps;
      const v = 1 - u;
      out.push({
        x: v * v * v * s.x0 + 3 * v * v * u * s.c1x + 3 * v * u * u * s.c2x + u * u * u * s.x1,
        y: v * v * v * s.y0 + 3 * v * v * u * s.c1y + 3 * v * u * u * s.c2y + u * u * u * s.y1,
      });
    }
  }
  return out;
}

/**
 * The runs of a series that recharts would draw as one line with
 * connectNulls off: consecutive entries whose value is a number, each
 * returned as its list of indices.
 */
export function numberRuns(values) {
  const runs = [];
  let cur = [];
  values.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) cur.push(i);
    else if (cur.length) { runs.push(cur); cur = []; }
  });
  if (cur.length) runs.push(cur);
  return runs;
}
