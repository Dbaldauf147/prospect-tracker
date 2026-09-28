// The pipeline funnel, drawn as the Weekly Report email's own picture.
//
// The tab rasterises its funnel off the SVG on screen (utils/svgToPng), but
// the email that lands on Monday is rebuilt on a serverless runner with no
// DOM and no canvas (api/_lib/weeklyReportBuild). With nothing to rasterise
// there, the scheduled send used to go out with the funnel section missing
// altogether. So the chart is drawn here pixel by pixel instead, the way
// utils/coverageChartImage draws the coverage lines, and encoded by
// utils/pngEncode.
//
// It is PipelineFunnel's "Pipeline $" view, in PipelineFunnel's own layout
// units: band height for pipeline value, segment length for average opp
// life, a red dotted goal line over the shortfall (green where a stage met
// it), the stage number in a badge, and the exit arrow with the projected
// total beside it. The constants below are that component's, so the two
// pictures agree on where everything sits.

import { STAGE_FILL, STAGE_FILL_DEFAULT } from '../components/PipelineView/funnelPalette.js';
import { pngDataUrl } from './pngEncode.js';
import { raster, fill, text, GLYPH_H } from './coverageChartImage.js';

// PipelineFunnel's canvas, in its layout units.
const W = 1200;
const VIEW_TOP = 108;
const VIEW_H = 262;
const BASE_Y = 348;
const MAX_H = 208;
const MIN_H = 6;
const X0 = 150;
const X1 = 890;
const AXIS_X = X0 - 14;
const OUT_X = X1 + 92;
const SEG_GAP = 4;
const MIN_SEG_W = 72;

// Pixels per layout unit. Laid out at the email's ~770px column, this is
// about three pixels per CSS pixel, so the bitmap text stays sharp.
const S = 2;

const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// Palette indices.
const BG = 0;
const AXIS_BAR = 1;
const CHROME = 2;
const MUTED = 3;
const INK = 4;
const ARROW = 5;
const GAP_RED = 6;
const MET_GREEN = 7;
const GAP_SHADE = 8;
const STAGE_BASE = 9;

const STAGES = [3, 4, 5, 6];
const PALETTE = [
  [255, 255, 255],
  hex('#94a3b8'),
  hex('#c3c2b7'),
  hex('#898781'),
  hex('#0b0b0b'),
  hex('#dfe3e8'),
  hex('#d03b3b'),
  hex('#0ca30c'),
  // rgba(208, 59, 59, 0.14) over the white card, since the palette is flat.
  [248, 228, 228],
  ...STAGES.map(n => hex(STAGE_FILL[n])),
  hex(STAGE_FILL_DEFAULT),
];
const stageColour = (n) => {
  const i = STAGES.indexOf(n);
  return STAGE_BASE + (i >= 0 ? i : STAGES.length);
};

// Same scales as PipelineFunnel, so the axis reads the same figures.
function niceTicks(max, count = 5) {
  if (!(max > 0)) return [];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = step; v <= max * 1.0001; v += step) out.push(v);
  return out;
}

function fmtCompactMoney(n) {
  if (!Number.isFinite(n)) return '-';
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3).toLocaleString('en-US')}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// ---- Drawing in layout units ---------------------------------------------

const px = (x) => Math.round(x * S);
const py = (y) => Math.round((y - VIEW_TOP) * S);

function box(r, x0, y0, x1, y1, c) {
  const l = px(Math.min(x0, x1));
  const t = py(Math.min(y0, y1));
  fill(r, l, t, px(Math.max(x0, x1)) - l, py(Math.max(y0, y1)) - t, c);
}

function disc(r, cx, cy, radius, c) {
  const x = px(cx);
  const y = py(cy);
  const rr = Math.round(radius * S);
  for (let dy = -rr; dy <= rr; dy += 1) {
    const span = Math.floor(Math.sqrt(rr * rr - dy * dy));
    fill(r, x - span, y + dy, 2 * span + 1, 1, c);
  }
}

// A horizontal dashed rule, the SVG's `strokeDasharray="6 5"`.
function dashed(r, x0, x1, y, c, weight) {
  for (let x = x0; x < x1; x += 11) {
    box(r, x, y - weight / 2, Math.min(x + 6, x1), y + weight / 2, c);
  }
}

// `baseline` is where SVG text would sit, so the glyph's top is a cap
// height above it. Bold is the same glyph again one pixel over, which is
// how a 5x7 font gets a heavier weight.
function label(r, s, x, baseline, c, size, align = 'left', bold = false) {
  const top = py(baseline) - GLYPH_H * size;
  text(r, s, px(x), top, c, size, align);
  if (bold) text(r, s, px(x) + 1, top, c, size, align);
}

/**
 * The funnel as a PNG data URL, or null when there is nothing to draw.
 * Same shape as the tab's capture: `{ src, width, height, alt }`, with the
 * width and height being the chart's layout size.
 *
 * @param {Array} stages   buildFunnelStages rows
 * @param {object} outcome funnelOutcomeFor(kpis)
 */
export function funnelChartImage(stages, outcome = null) {
  const rows = (Array.isArray(stages) ? stages : [])
    .filter(s => Number.isFinite(s?.stageNum))
    .sort((a, b) => a.stageNum - b.stageNum)
    .map(s => ({ ...s, actual: Number(s.amtActual) || 0, goal: Number(s.amtGoal) || 0 }));
  if (!rows.length) return null;
  const max = Math.max(...rows.map(r => Math.max(r.actual, r.goal)), 0);
  if (!(max > 0)) return null;

  const scale = (v) => (v / max) * MAX_H;
  const half = (v) => (v > 0 ? Math.max(MIN_H, scale(v)) : 0);

  const totalW = X1 - X0;
  const lives = rows.map(r => (Number(r.lifeActual) > 0 ? Number(r.lifeActual) : 0));
  const byLife = lives.every(d => d > 0);
  const totalLife = lives.reduce((a, b) => a + b, 0);
  const flex = totalW - MIN_SEG_W * rows.length;
  const widths = byLife
    ? lives.map(d => MIN_SEG_W + flex * (d / totalLife))
    : rows.map(() => totalW / rows.length);
  const segs = [];
  let x = X0;
  rows.forEach((r, i) => {
    const w = widths[i];
    const gap = r.goal - r.actual;
    segs.push({
      ...r, x0: x, x1: x + w - SEG_GAP, w, cx: (x + x + w - SEG_GAP) / 2,
      h: half(r.actual), goalH: half(r.goal),
      gap: gap > 0 ? gap : 0, hasGoal: r.goal > 0,
    });
    x += w;
  });

  const r = raster(W * S, VIEW_H * S);

  // Left axis: the grey entry bar, the baseline, and the ticks.
  box(r, AXIS_X, BASE_Y - MAX_H - 24, AXIS_X + 12, BASE_Y + 2, AXIS_BAR);
  box(r, X0, BASE_Y, X1, BASE_Y + 1, CHROME);
  box(r, AXIS_X - 8, BASE_Y, AXIS_X, BASE_Y + 1, CHROME);
  label(r, '0', AXIS_X - 12, BASE_Y + 4, MUTED, 2, 'right');
  for (const v of niceTicks(max)) {
    const y = BASE_Y - scale(v);
    box(r, AXIS_X - 8, y, AXIS_X, y + 1, CHROME);
    label(r, fmtCompactMoney(v), AXIS_X - 12, y + 4, MUTED, 2, 'right');
  }

  // The exit arrow, and what the funnel is worth on the way out.
  const last = segs[segs.length - 1];
  const outY = Math.min(Math.max(BASE_Y - Math.max(last.h, 56) / 2, 150), 300);
  box(r, X1 + 8, outY - 24, X1 + 44, outY + 24, ARROW);
  for (let ax = px(X1 + 44); ax < px(X1 + 84); ax += 1) {
    const reach = 40 * (1 - (ax / S - (X1 + 44)) / 40);
    const t = py(outY - reach);
    fill(r, ax, t, 1, py(outY + reach) - t, ARROW);
  }
  const rated = segs.filter(g => Number(g.closeRate) > 0);
  const proj = rated.length ? rated.reduce((a, g) => a + g.actual * Number(g.closeRate), 0) : null;
  const sold = Number.isFinite(outcome?.soldAmount) ? outcome.soldAmount : null;
  const total = sold != null && proj != null ? sold + proj : null;
  const rx = W - 8;
  const row = (y, name, value, strong) => {
    label(r, name, OUT_X, y, strong ? INK : MUTED, 2, 'left', strong);
    label(r, value, rx, y, INK, 2, 'right', true);
  };
  if (sold != null) {
    row(outY - 26, outcome?.soldLabel || 'Closed YTD', fmtCompactMoney(sold), true);
    row(outY - 6, '+ weighted pipeline', proj == null ? '-' : fmtCompactMoney(proj), false);
    box(r, OUT_X, outY + 4, rx, outY + 5, CHROME);
    row(outY + 22, '= projected total', total == null ? '-' : fmtCompactMoney(total), true);
    const target = Number(outcome?.target) || 0;
    if (target > 0 && total != null) {
      label(r, `${Math.round((total / target) * 100)}% of ${fmtCompactMoney(target)} target`, rx, outY + 40, MUTED, 2, 'right');
    }
  } else {
    row(outY - 10, 'weighted pipeline', proj == null ? '-' : fmtCompactMoney(proj), true);
  }

  // The stages.
  for (const g of segs) {
    const c = stageColour(g.stageNum);
    box(r, g.x0, BASE_Y - g.h, g.x1, BASE_Y, c);
    if (g.gap > 0) {
      box(r, g.x0, BASE_Y - g.goalH, g.x1, BASE_Y - g.h, GAP_SHADE);
      dashed(r, g.x0, g.x1, BASE_Y - g.goalH, GAP_RED, 2);
    } else if (g.hasGoal) {
      dashed(r, g.x0, g.x1, BASE_Y - g.goalH, BG, 5);
      dashed(r, g.x0, g.x1, BASE_Y - g.goalH, MET_GREEN, 2);
    }
    const n = String(g.stageNum);
    if (g.h >= 52 && g.w >= 58) {
      const cy = BASE_Y - g.h / 2;
      disc(r, g.cx, cy, 23, BG);
      disc(r, g.cx, cy, 21, c);
      const size = 4;
      const top = py(cy) - Math.round((GLYPH_H * size) / 2);
      text(r, n, px(g.cx), top, BG, size, 'center');
      text(r, n, px(g.cx) + 1, top, BG, size, 'center');
    } else {
      label(r, n, g.cx, BASE_Y - Math.max(g.h, g.gap > 0 ? g.goalH : 0) - 10, c, 4, 'center', true);
    }
  }

  const short = segs.filter(g => g.gap > 0).length;
  return {
    src: pngDataUrl({ width: W * S, height: VIEW_H * S, palette: PALETTE, pixels: r.px }),
    width: W,
    height: VIEW_H,
    alt: `Pipeline funnel: Pipeline value by stage, segment length by average opportunity life. ${short} of ${segs.length} stages are short of goal.`,
  };
}
