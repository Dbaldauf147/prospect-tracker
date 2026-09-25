// The two account-coverage charts, drawn as the Weekly Report email's own
// picture: a line per tier, a point per week, the way the Progress tab
// draws them.
//
// Drawn pixel by pixel rather than from an SVG, because the email that
// matters is rebuilt on a serverless runner (api/_lib/weeklyReportBuild)
// where there is no canvas to rasterise one with. See utils/pngEncode for
// the rest of that argument. Everything here is arithmetic over a byte per
// pixel, so it runs the same in the tab's preview and in the cron.
//
// The picture is drawn at twice the size it is laid out at, so it stays
// sharp on a phone and on a high-density screen - the same trade the
// funnel's rasteriser makes.

import { pngDataUrl } from './pngEncode.js';

// Palette indices. Kept to the few flat colours a chart needs, which is
// what lets the whole thing be one byte per pixel.
const BG = 0;
const GRID = 1;
const AXIS = 2;
const LABEL = 3;
const T1 = 4;
const T2 = 5;

const PALETTE = [
  [255, 255, 255],  // the card it sits on
  [237, 241, 246],  // gridlines, a shade lighter than the page border
  [203, 213, 225],  // the baseline, which is a rule rather than a gridline
  [136, 150, 166],  // --color-text-muted, for the labels
  [220, 38, 38],    // Tier 1, the Progress chart's red
  [59, 130, 246],   // Tier 2, its blue
];

export const SCALE = 2;
// Laid-out size, in CSS pixels: half the email's 800px column, less the
// card's border and padding, and short enough that two of these plus the
// figures under them do not push the rest of the report below the fold.
export const CHART_W = 360;
export const CHART_H = 132;

// Room for the "100%" up the left and the week labels along the bottom.
const PAD_L = 30 * SCALE;
const PAD_R = 6 * SCALE;
const PAD_T = 7 * SCALE;
const PAD_B = 14 * SCALE;

// ---- A raster to draw on --------------------------------------------------

function raster(width, height) {
  return { width, height, px: new Uint8Array(width * height).fill(BG) };
}

function dot(r, x, y, c) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= r.width || yi >= r.height) return;
  r.px[yi * r.width + xi] = c;
}

function fill(r, x, y, w, h, c) {
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
// defined: the digits, a per-cent sign, and capitals for the month names.
// Each glyph is five columns; each column is seven bits, top row first.
const GLYPH_W = 5;
const GLYPH_H = 7;
const FONT = {
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
  // Two blocks and the stroke between them. The stock 5x7 per-cent sign
  // loses its blocks at this size and reads as a small x.
  '%': [0x43, 0x23, 0x08, 0x62, 0x61],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
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
  J: [0x20, 0x40, 0x41, 0x3F, 0x01],
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
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
};

const textWidth = (s, size) => (s.length * (GLYPH_W + 1) - 1) * size;

// `x` is the left edge unless `align` says otherwise; `y` is the top.
function text(r, s, x, y, c, size, align = 'left') {
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

// ---- The chart ------------------------------------------------------------

/**
 * One coverage chart as a PNG data URL, or null when there is nothing to
 * draw. Shape matches the funnel's image: `{ src, width, height, alt }`,
 * with the width and height being the size it is laid out at.
 */
export function coverageChartImage(chart) {
  const points = Array.isArray(chart?.points) ? chart.points : [];
  if (points.length < 2) return null;
  if (!points.some(p => p.t1 != null || p.t2 != null)) return null;

  const W = CHART_W * SCALE;
  const H = CHART_H * SCALE;
  const r = raster(W, H);

  const plotL = PAD_L;
  const plotR = W - PAD_R;
  const plotT = PAD_T;
  const plotB = H - PAD_B;
  const plotW = plotR - plotL;
  const plotH = plotB - plotT;

  const xAt = (i) => plotL + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
  const yAt = (pct) => plotB - (plotH * pct) / 100;

  // The axis. Four gridlines and a baseline, which is all the structure a
  // chart this size can carry before the lines are competing with it.
  for (const pct of [25, 50, 75, 100]) {
    fill(r, plotL, yAt(pct), plotW, SCALE, GRID);
    text(r, `${pct}%`, plotL - 4 * SCALE, yAt(pct) - GLYPH_H, LABEL, SCALE, 'right');
  }
  fill(r, plotL, yAt(0), plotW, SCALE, AXIS);
  text(r, '0%', plotL - 4 * SCALE, yAt(0) - GLYPH_H, LABEL, SCALE, 'right');

  // Week labels along the bottom. Every week would be a smear at this
  // width, so they are thinned to about five and the last one is always
  // among them: the right-hand end is the week the report is about.
  const step = Math.max(1, Math.ceil((points.length - 1) / 4));
  for (let i = points.length - 1; i >= 0; i -= step) {
    const label = String(points[i].label || '');
    const half = textWidth(label, SCALE) / 2;
    // The last label is the week the report is about and always sits at
    // the end of the axis, so it is pinned inside the right edge rather
    // than centred on its point - centred, its tail runs off the picture
    // and "Sep 7" arrives as "SEP".
    const at = Math.min(xAt(i), W - half);
    // Anywhere else, only where it clears the per-cent labels up the left.
    if (at - half < plotL - PAD_L / 2) continue;
    text(r, label, at, plotB + 5 * SCALE, LABEL, SCALE, 'center');
  }

  // The two series. A week the Progress tab never recorded is joined
  // across rather than breaking the line: the tab only writes a snapshot
  // when somebody opens it, so gaps are about who looked, not about the
  // accounts, and the tab's own chart (which plots recorded weeks only)
  // draws one unbroken line. The points still sit at their real weeks, so
  // a long stretch with no reading shows as one long straight segment.
  const series = [{ key: 't2', colour: T2 }, { key: 't1', colour: T1 }];
  for (const s of series) {
    let prev = null;
    points.forEach((p, i) => {
      const v = p[s.key];
      if (v == null) return;
      const here = { x: xAt(i), y: yAt(v) };
      if (prev) stroke(r, prev.x, prev.y, here.x, here.y, s.colour, 2 * SCALE);
      prev = here;
    });
  }
  // Markers go on after both lines, so a point is never half-buried under
  // the other tier's line where the two cross.
  for (const s of series) {
    points.forEach((p, i) => {
      if (p[s.key] == null) return;
      // Every week gets a marker on a short series; on a long one only the
      // last, which is the figure the card repeats underneath.
      if (points.length > 14 && i !== points.length - 1) return;
      marker(r, Math.round(xAt(i)), Math.round(yAt(p[s.key])), s.colour, points.length > 14 ? 3 : 2);
    });
  }

  return {
    src: pngDataUrl({ width: W, height: H, palette: PALETTE, pixels: r.px }),
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
