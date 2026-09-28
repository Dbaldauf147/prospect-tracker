// The two account-coverage charts, drawn as the Weekly Report email's own
// picture of the Progress tab's charts: same weeks, same axis, same curve,
// same dots, so the email and the tab show one chart rather than two
// readings of it.
//
// Drawn without a canvas, because the email that matters is rebuilt on a
// serverless runner (api/_lib/weeklyReportBuild) where there is none. The
// coverage charts go through utils/chartRaster, which antialiases every
// edge and letters the axes from real glyph outlines. The coverage-ratio
// chart further down (and the funnel, which borrows these helpers) still
// use the older whole-pixel drawing and the 5x7 bitmap font.
//
// Every picture is drawn at twice the size it is laid out at, so it stays
// sharp on a phone and on a high-density screen.

import { pngDataUrl } from './pngEncode.js';
import {
  createRaster, fillRect, fillCircle, strokePolyline, drawText, textWidth as typeWidth,
  rasterToPngDataUrl,
} from './chartRaster.js';
import { monotonePolyline, numberRuns } from './monotoneCurve.js';
import { COVERAGE_T1, COVERAGE_T2 } from './progressCoverage.js';

export const SCALE = 2;
// Laid-out size, in CSS pixels: the email's full 800px column, less the
// card's border and padding. The Progress tab's chart is 250px tall with
// its legend; the legend here is the HTML row under the picture.
export const CHART_W = 720;
export const CHART_H = 230;

// ---- A raster to draw on --------------------------------------------------

// One byte per pixel, a palette index; every palette that draws on one of
// these keeps its background at index 0.
export function raster(width, height) {
  return { width, height, px: new Uint8Array(width * height).fill(0) };
}

function dot(r, x, y, c) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= r.width || yi >= r.height) return;
  r.px[yi * r.width + xi] = c;
}

export function fill(r, x, y, w, h, c) {
  for (let yy = Math.round(y); yy < Math.round(y) + h; yy += 1) {
    for (let xx = Math.round(x); xx < Math.round(x) + w; xx += 1) dot(r, xx, yy, c);
  }
}

// A straight line of a given thickness, stepped one pixel at a time along
// whichever axis it travels furthest on, so there are no gaps in a steep
// segment. No antialiasing: the palette has no in-between shades to spend
// on one, and at twice the laid-out size a hard edge reads as a smooth one.
function stroke(r, x0, y0, x1, y1, c, weight) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  const half = Math.floor(weight / 2);
  for (let i = 0; i <= steps; i += 1) {
    const x = x0 + (dx * i) / steps;
    const y = y0 + (dy * i) / steps;
    fill(r, x - half, y - half, weight, weight, c);
  }
}

// The marker on a point. Square-cornered circles at this size, which is
// what a 5px disc is in whole pixels anyway.
function marker(r, x, y, c, radius) {
  for (let yy = -radius; yy <= radius; yy += 1) {
    for (let xx = -radius; xx <= radius; xx += 1) {
      if (xx * xx + yy * yy <= radius * radius + 1) dot(r, x + xx, y + yy, c);
    }
  }
}

// ---- Text -----------------------------------------------------------------
//
// A 5x7 bitmap font, drawn at twice that, because there is no font to ask
// for glyphs from out here. Only the characters a chart axis uses are
// defined: the digits, a per-cent sign, and capitals for the month names,
// plus the dollar sign and the few letters the funnel's figures spell out
// (utils/funnelChartImage borrows this font and the raster above).
// Each glyph is five columns; each column is seven bits, top row first.
const GLYPH_W = 5;
export const GLYPH_H = 7;
const FONT = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  // Two blocks and the stroke between them. The stock 5x7 per-cent sign
  // loses its blocks at this size and reads as a small x.
  '%': [0x43, 0x23, 0x08, 0x62, 0x61],
  '$': [0x24, 0x2A, 0x7F, 0x2A, 0x12],
  '+': [0x08, 0x08, 0x3E, 0x08, 0x08],
  ',': [0x00, 0x50, 0x30, 0x00, 0x00],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '=': [0x14, 0x14, 0x14, 0x14, 0x14],
  '.': [0x00, 0x60, 0x60, 0x00, 0x00],
  '0': [0x3E, 0x51, 0x49, 0x45, 0x3E],
  '1': [0x00, 0x42, 0x7F, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4B, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7F, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3C, 0x4A, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1E],
  A: [0x7E, 0x11, 0x11, 0x11, 0x7E],
  B: [0x7F, 0x49, 0x49, 0x49, 0x36],
  C: [0x3E, 0x41, 0x41, 0x41, 0x22],
  D: [0x7F, 0x41, 0x41, 0x22, 0x1C],
  E: [0x7F, 0x49, 0x49, 0x49, 0x41],
  F: [0x7F, 0x09, 0x09, 0x09, 0x01],
  G: [0x3E, 0x41, 0x49, 0x49, 0x7A],
  H: [0x7F, 0x08, 0x08, 0x08, 0x7F],
  I: [0x00, 0x41, 0x7F, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3F, 0x01],
  K: [0x7F, 0x08, 0x14, 0x22, 0x41],
  L: [0x7F, 0x40, 0x40, 0x40, 0x40],
  M: [0x7F, 0x02, 0x0C, 0x02, 0x7F],
  N: [0x7F, 0x04, 0x08, 0x10, 0x7F],
  O: [0x3E, 0x41, 0x41, 0x41, 0x3E],
  P: [0x7F, 0x09, 0x09, 0x09, 0x06],
  R: [0x7F, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31],
  T: [0x01, 0x01, 0x7F, 0x01, 0x01],
  U: [0x3F, 0x40, 0x40, 0x40, 0x3F],
  V: [0x1F, 0x20, 0x40, 0x20, 0x1F],
  W: [0x3F, 0x40, 0x38, 0x40, 0x3F],
  // Stands in for the multiplication sign the ratio is written with.
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
};

export const textWidth = (s, size) => (s.length * (GLYPH_W + 1) - 1) * size;

// `x` is the left edge unless `align` says otherwise; `y` is the top.
export function text(r, s, x, y, c, size, align = 'left') {
  const str = String(s).toUpperCase();
  const w = textWidth(str, size);
  let left = x;
  if (align === 'right') left = x - w;
  if (align === 'center') left = x - Math.round(w / 2);
  for (const ch of str) {
    const glyph = FONT[ch];
    if (glyph) {
      for (let col = 0; col < GLYPH_W; col += 1) {
        for (let row = 0; row < GLYPH_H; row += 1) {
          if ((glyph[col] >> row) & 1) {
            fill(r, left + col * size, y + row * size, size, size, c);
          }
        }
      }
    }
    left += (GLYPH_W + 1) * size;
  }
}

// ---- The coverage chart ---------------------------------------------------
//
// Every size below is the Progress tab's recharts chart in CSS pixels
// (ProgressView's ProgressChart, line view), multiplied up by SCALE.

const INK = {
  grid: '#E2E8F0',       // CartesianGrid stroke
  axis: '#666666',       // recharts' default axis and tick-line colour
  label: '#64748B',      // the tick labels' fill
  green: '#15803D',      // ProgressView's DARK_GREEN, for a maxed-out week
};
const FONT_PX = 11;              // the axes' fontSize
const TICK = 6;                  // recharts' tick-line length
const Y_AXIS_W = 60;             // recharts' default YAxis width
const X_AXIS_H = 30;             // and XAxis height
const MARGIN = 5;                // the chart's default margin
// The last week's label is centred on the right-hand end of the axis, so
// the plot stops short of the edge by half of it.
const PAD_R = 20;
const PAD_T = 10;
const LINE_W = 2;
const GREEN_W = 2.5;
const DOT_R = 4;

// The value a recharts "__green" key would hold: the week's own reading
// where it, or the week either side, is at 100%, and nothing elsewhere.
// ProgressView's withGreenKeys, restated for one series.
function greenValues(values) {
  return values.map((v, i) => (
    v === 100 || values[i - 1] === 100 || values[i + 1] === 100 ? v : null
  ));
}

// A dashed rule, 3 on and 3 off, as the grid is drawn.
function dashed(r, x0, y0, x1, y1, color) {
  const dash = 3 * SCALE;
  if (y0 === y1) {
    for (let x = x0; x < x1; x += dash * 2) fillRect(r, x, y0 - SCALE / 2, Math.min(dash, x1 - x), SCALE, color);
  } else {
    for (let y = y0; y < y1; y += dash * 2) fillRect(r, x0 - SCALE / 2, y, SCALE, Math.min(dash, y1 - y), color);
  }
}

// Which week labels fit, recharts' "preserveEnd": the last is always shown
// and the rest are taken walking back from it, each only if it clears the
// one after it by the axis' minimum gap.
function visibleLabels(points, xAt, size) {
  const keep = new Set();
  let leftEdge = Infinity;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const w = typeWidth(points[i].label, size);
    const right = xAt(i) + w / 2;
    if (i === points.length - 1 || right + 5 * SCALE <= leftEdge) {
      keep.add(i);
      leftEdge = xAt(i) - w / 2;
    }
  }
  return keep;
}

/**
 * One coverage chart as a PNG data URL, or null when there is nothing to
 * draw. Shape matches the funnel's image: `{ src, width, height, alt }`,
 * with the width and height being the size it is laid out at.
 *
 * `chart.points` are the recorded weeks only, oldest first, as the Progress
 * tab plots them: evenly spaced, whatever the calendar gap between them.
 */
export function coverageChartImage(chart) {
  const points = Array.isArray(chart?.points) ? chart.points : [];
  if (points.length < 2) return null;
  if (!points.some(p => p.t1 != null || p.t2 != null)) return null;

  const W = CHART_W * SCALE;
  const H = CHART_H * SCALE;
  const r = createRaster(W, H);
  const size = FONT_PX * SCALE;

  const plotL = (MARGIN + Y_AXIS_W) * SCALE;
  const plotR = W - PAD_R * SCALE;
  const plotT = PAD_T * SCALE;
  const plotB = H - (MARGIN + X_AXIS_H) * SCALE;
  const n = points.length;
  const xAt = (i) => plotL + ((plotR - plotL) * i) / (n - 1);
  const yAt = (pct) => plotB - ((plotB - plotT) * pct) / 100;

  // The grid, under everything: a dashed rule at every tick of both axes.
  for (const pct of [25, 50, 75, 100]) dashed(r, plotL, yAt(pct), plotR, yAt(pct), INK.grid);
  for (let i = 1; i < n; i += 1) dashed(r, xAt(i), plotT, xAt(i), plotB, INK.grid);

  // The two axes, their tick marks, and the labels off them.
  fillRect(r, plotL - SCALE / 2, plotT, SCALE, plotB - plotT, INK.axis);
  fillRect(r, plotL, plotB - SCALE / 2, plotR - plotL, SCALE, INK.axis);
  for (const pct of [0, 25, 50, 75, 100]) {
    const y = yAt(pct);
    fillRect(r, plotL - TICK * SCALE, y - SCALE / 2, TICK * SCALE, SCALE, INK.axis);
    drawText(r, `${pct}%`, plotL - (TICK + 3) * SCALE, y + 0.355 * size, size, INK.label, 'right');
  }
  const shown = visibleLabels(points, xAt, size);
  points.forEach((p, i) => {
    fillRect(r, xAt(i) - SCALE / 2, plotB, SCALE, TICK * SCALE, INK.axis);
    if (!shown.has(i)) return;
    const w = typeWidth(p.label, size);
    // Centred on its week, but never off either edge of the picture.
    const at = Math.max(w / 2, Math.min(xAt(i), W - w / 2));
    drawText(r, p.label, at, plotB + (TICK + 2) * SCALE + 0.71 * size, size, INK.label, 'center');
  });

  // The lines: Tier 1, then Tier 2 over it, each broken where a week has
  // no reading, then the green stretches over both.
  const series = [{ key: 't1', colour: COVERAGE_T1 }, { key: 't2', colour: COVERAGE_T2 }];
  const curve = (values, width, colour) => {
    for (const run of numberRuns(values)) {
      const line = monotonePolyline(run.map(i => ({ x: xAt(i), y: yAt(values[i]) })));
      strokePolyline(r, line, width * SCALE, colour);
    }
  };
  for (const s of series) curve(points.map(p => p[s.key]), LINE_W, s.colour);
  for (const s of series) curve(greenValues(points.map(p => p[s.key])), GREEN_W, INK.green);

  // A dot on every week, green and a size up where the week is at 100%.
  for (const s of series) {
    points.forEach((p, i) => {
      const v = p[s.key];
      if (v == null) return;
      const hit = v === 100;
      // The Progress dot is r=4 with a 1px stroke of its own colour.
      fillCircle(r, xAt(i), yAt(v), ((hit ? DOT_R + 1 : DOT_R) + 0.5) * SCALE, hit ? INK.green : s.colour);
    });
  }

  return {
    src: rasterToPngDataUrl(r),
    width: CHART_W,
    height: CHART_H,
    alt: `${chart.title || 'Account coverage'}: Tier 1 and Tier 2 by week`,
  };
}


// Every chart in a coverage payload, drawn. Returns the payload with an
// `image` on each chart that could be drawn, so a caller can hand the whole
// thing to the snapshot builder.
export function withCoverageImages(coverage) {
  const charts = Array.isArray(coverage?.charts) ? coverage.charts : [];
  if (!charts.length) return coverage || null;
  return {
    ...coverage,
    charts: charts.map(c => ({ ...c, image: coverageChartImage(c) })),
  };
}

// ---- The coverage ratio ---------------------------------------------------
//
// The coverage ratio by week (open pipeline / annual target) as a line: a
// point per week, the goal as a dashed rule across the plot, and the latest
// reading written beside its point. Drawn the same way as the charts above,
// for the same reason: the email that lands on Monday is rebuilt where
// there is no canvas.

const RATIO_BG = 0;
const RATIO_GRID = 1;
const RATIO_AXIS = 2;
const RATIO_LABEL = 3;
const RATIO_LINE = 4;
const RATIO_GOAL = 5;

const RATIO_PALETTE = [
  [255, 255, 255],  // the card it sits on
  [237, 241, 246],  // gridlines
  [203, 213, 225],  // the baseline
  [136, 150, 166],  // --color-text-muted, for the labels
  [124, 58, 237],   // the ratio, in the card's own purple accent
  [167, 139, 250],  // the goal, a lighter purple so it reads as the target and not a second series
];

// Laid out across the full content column, less the card's border and
// padding, since this card has the row to itself.
export const RATIO_CHART_W = 720;
export const RATIO_CHART_H = 160;

const RATIO_PAD_L = 40 * SCALE;
// Room to the right of the plot for the goal's label, which sits beside the
// end of its dashed rule rather than on it, so a line running at or near the
// goal never strikes it through.
const RATIO_PAD_R = 72 * SCALE;
// The first and last weeks are held in from the plot's edges, so their
// labels centre under them instead of running into the axis figures.
const RATIO_INSET_X = 18 * SCALE;
const RATIO_PAD_T = 12 * SCALE;
const RATIO_PAD_B = 14 * SCALE;

// A gridline step that gives three to six lines whatever the scale.
function ratioStep(top) {
  if (top <= 1.5) return 0.25;
  if (top <= 3) return 0.5;
  if (top <= 6) return 1;
  return 2;
}

const ratioText = (v, step) => `${step < 0.5 ? v.toFixed(2) : v.toFixed(1)}X`;

/**
 * The coverage-ratio series as a PNG data URL, or null when no week has a
 * reading. Same shape as the other chart images: `{ src, width, height,
 * alt }`, sized as laid out.
 */
export function coverageRatioChartImage(cr) {
  const points = Array.isArray(cr?.points) ? cr.points : [];
  const known = points.filter(p => typeof p?.value === 'number' && Number.isFinite(p.value));
  if (!points.length || !known.length) return null;
  const goal = typeof cr?.goal === 'number' && Number.isFinite(cr.goal) && cr.goal > 0 ? cr.goal : null;

  const W = RATIO_CHART_W * SCALE;
  const H = RATIO_CHART_H * SCALE;
  const r = raster(W, H);

  const plotL = RATIO_PAD_L;
  const plotR = W - RATIO_PAD_R;
  const plotT = RATIO_PAD_T;
  const plotB = H - RATIO_PAD_B;
  const plotW = plotR - plotL;
  const plotH = plotB - plotT;

  // The axis runs a little past the higher of the goal and the best week,
  // so neither sits on the top edge, and ends on a whole step.
  const peak = Math.max(goal || 0, ...known.map(p => p.value), 0.5);
  const step = ratioStep(peak * 1.1);
  const top = Math.ceil((peak * 1.1) / step) * step;

  // A single week is drawn in the middle rather than pinned to one edge.
  const spanL = plotL + RATIO_INSET_X;
  const spanW = plotW - 2 * RATIO_INSET_X;
  const xAt = (i) => spanL + (points.length === 1 ? spanW / 2 : (spanW * i) / (points.length - 1));
  const yAt = (v) => plotB - (plotH * Math.max(0, v)) / top;

  for (let v = step; v <= top + 1e-9; v += step) {
    fill(r, plotL, yAt(v), plotW, SCALE, RATIO_GRID);
    text(r, ratioText(v, step), plotL - 4 * SCALE, yAt(v) - GLYPH_H, RATIO_LABEL, SCALE, 'right');
  }
  fill(r, plotL, yAt(0), plotW, SCALE, RATIO_AXIS);
  text(r, ratioText(0, step), plotL - 4 * SCALE, yAt(0) - GLYPH_H, RATIO_LABEL, SCALE, 'right');

  // Week labels, thinned on a long series, the last one always shown and
  // kept inside the right edge.
  const labelStep = points.length > 13 ? Math.ceil((points.length - 1) / 8) : 1;
  for (let i = points.length - 1; i >= 0; i -= labelStep) {
    const label = String(points[i].label || '');
    const half = textWidth(label.toUpperCase(), SCALE) / 2;
    const at = Math.min(xAt(i), W - half);
    if (at - half < plotL - RATIO_PAD_L / 2) continue;
    text(r, label, at, plotB + 5 * SCALE, RATIO_LABEL, SCALE, 'center');
  }

  // The goal: a dashed rule, labelled in the margin past its right-hand end.
  if (goal != null) {
    const gy = yAt(goal);
    const dash = 6 * SCALE;
    for (let x = plotL; x < plotR; x += dash * 2) {
      fill(r, x, gy, Math.min(dash, plotR - x), SCALE, RATIO_GOAL);
    }
    text(r, `GOAL ${goal.toFixed(2)}X`, plotR + 5 * SCALE, gy - Math.round((GLYPH_H * SCALE) / 2) + 1, RATIO_GOAL, SCALE, 'left');
  }

  // The line. A week with no reading is joined across, the way the
  // account-coverage charts join theirs: the gap is about nobody measuring
  // that week, not about the pipeline.
  let prev = null;
  points.forEach((p, i) => {
    if (typeof p?.value !== 'number') return;
    const here = { x: xAt(i), y: yAt(p.value) };
    if (prev) stroke(r, prev.x, prev.y, here.x, here.y, RATIO_LINE, 2 * SCALE);
    prev = here;
  });
  points.forEach((p, i) => {
    if (typeof p?.value !== 'number') return;
    marker(r, Math.round(xAt(i)), Math.round(yAt(p.value)), RATIO_LINE, points.length > 14 ? 3 : 4);
  });

  // The latest reading, written above its point, which is the figure the
  // KPI card shows.
  const lastIdx = points.map(p => typeof p?.value === 'number').lastIndexOf(true);
  const last = points[lastIdx];
  const label = `${last.value.toFixed(2)}X`;
  const lw = textWidth(label, SCALE);
  const lx = Math.max(plotL + lw / 2, Math.min(xAt(lastIdx), plotR - lw / 2));
  // Above its point, or under it where the top of the plot would clip it.
  const above = yAt(last.value) - GLYPH_H * SCALE - 8 * SCALE;
  const ly = above >= 0 ? above : yAt(last.value) + 8 * SCALE;
  text(r, label, lx, ly, RATIO_LINE, SCALE, 'center');

  return {
    src: pngDataUrl({ width: W, height: H, palette: RATIO_PALETTE, pixels: r.px }),
    width: RATIO_CHART_W,
    height: RATIO_CHART_H,
    alt: `Coverage ratio by week: ${last.value.toFixed(2)}x in the week of ${last.label}${goal != null ? `, against a ${goal.toFixed(2)}x goal` : ''}`,
  };
}

// The coverage-ratio series with its picture attached, for the snapshot.
export function withCoverageRatioImage(cr) {
  if (!cr || typeof cr !== 'object') return cr || null;
  return { ...cr, image: coverageRatioChartImage(cr) };
}
