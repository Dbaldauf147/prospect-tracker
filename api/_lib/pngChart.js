// A line chart, rasterised to a PNG, with no dependencies.
//
// Email is the reason this exists. A mail client won't run JavaScript,
// Gmail strips inline <svg>, and it drops `position` off any style, which
// rules out every way of drawing a sloping line in HTML. What every
// client does render is an image, so the chart is drawn pixel by pixel
// here and attached to the message.
//
// Text is deliberately NOT drawn: no font means no glyphs, and shipping a
// bitmap font to letter an axis is a lot of bytes for a job the email's
// own HTML can do better. The plot area is the image; the axis labels sit
// around it as real text, which also means they stay legible when the
// reader's client blocks the picture.

import { deflateSync } from 'node:zlib';

// ---- raster -----------------------------------------------------------

function createCanvas(width, height, background) {
  const data = new Uint8Array(width * height * 4);
  const [r, g, b] = background;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { width, height, data };
}

// Source-over blend of one pixel. `alpha` is 0..1 coverage; everything
// draws onto an opaque canvas, so the result stays opaque.
function blend(canvas, x, y, color, alpha) {
  if (alpha <= 0) return;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= canvas.width || yi >= canvas.height) return;
  const a = alpha > 1 ? 1 : alpha;
  const i = (yi * canvas.width + xi) * 4;
  const d = canvas.data;
  d[i] = Math.round(d[i] * (1 - a) + color[0] * a);
  d[i + 1] = Math.round(d[i + 1] * (1 - a) + color[1] * a);
  d[i + 2] = Math.round(d[i + 2] * (1 - a) + color[2] * a);
}

function fillRect(canvas, x, y, w, h, color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(canvas.width, Math.ceil(x + w));
  const y1 = Math.min(canvas.height, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) blend(canvas, px, py, color, alpha);
  }
}

// An antialiased disc: coverage falls off over the last pixel of the
// radius, which is what keeps a stroked line from looking like stairs.
function fillCircle(canvas, cx, cy, radius, color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const x1 = Math.min(canvas.width - 1, Math.ceil(cx + radius + 1));
  const y1 = Math.min(canvas.height - 1, Math.ceil(cy + radius + 1));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const coverage = radius + 0.5 - dist;
      if (coverage > 0) blend(canvas, px, py, color, Math.min(1, coverage) * alpha);
    }
  }
}

// Stroke a polyline by stamping discs along it. Sub-pixel steps, so the
// stamps overlap into a continuous stroke of even width — cheap, and at
// 90 points it costs nothing worth measuring.
function strokePolyline(canvas, pts, width, color) {
  const radius = width / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist / 0.35));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      fillCircle(canvas, ax + (bx - ax) * t, ay + (by - ay) * t, radius, color);
    }
  }
  if (pts.length === 1) fillCircle(canvas, pts[0][0], pts[0][1], radius, color);
}

// Fill between the polyline and a baseline, column by column. The points
// are monotonic in x, so each pixel column has exactly one line height:
// interpolate it, fill down to the baseline, and let the boundary pixel
// carry partial coverage.
function fillUnderPolyline(canvas, pts, baselineY, color, alpha) {
  if (pts.length < 2) return;
  const startX = Math.max(0, Math.ceil(pts[0][0]));
  const endX = Math.min(canvas.width - 1, Math.floor(pts[pts.length - 1][0]));
  let seg = 1;
  for (let px = startX; px <= endX; px++) {
    const x = px + 0.5;
    while (seg < pts.length - 1 && pts[seg][0] < x) seg++;
    const [ax, ay] = pts[seg - 1];
    const [bx, by] = pts[seg];
    const t = bx === ax ? 0 : (x - ax) / (bx - ax);
    const y = ay + (by - ay) * Math.max(0, Math.min(1, t));
    const top = Math.floor(y);
    blend(canvas, px, top, color, (1 - (y - top)) * alpha);
    for (let py = top + 1; py <= baselineY; py++) blend(canvas, px, py, color, alpha);
  }
}

// ---- PNG encoding -----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** Encode an RGBA canvas as a PNG buffer. */
export function encodePng(canvas) {
  const { width, height, data } = canvas;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // 8 bits per channel
  ihdr[9] = 6;   // truecolour with alpha
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace
  // Every scanline gets filter type 0 (None) in front of it — the raw
  // bytes compress well enough for a chart's flat colour fields.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- chart ------------------------------------------------------------

function hexToRgb(hex) {
  const s = String(hex).replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * A single-series line chart as a PNG.
 *
 * One series, so there's no palette to assign and no legend to draw — the
 * email's heading names what the line is. Everything except the line is
 * recessive: hairline grid, hairline baseline, no frame.
 *
 * Rendered at `scale`× and displayed at 1× in the email, so it stays sharp
 * on a phone. Not zero-based: for a price series the movement is the
 * point, and the caller's caption says the axis is scaled to the window.
 *
 *   { values, width, height, scale, line, fill, grid, axis, background,
 *     gridLines, padding }
 *
 * Returns { buffer, width, height, min, max, axisMin, axisMax } —
 * width/height are the DISPLAY size to put on the <img>, not the pixel
 * size of the buffer, and the axis bounds are what the top and bottom of
 * the plot actually represent (the series min/max plus the padding), so a
 * caller labelling the axis labels the line's edges and not its data.
 */
export function renderLineChartPng({
  values,
  width = 660,
  height = 200,
  scale = 2,
  line = '#009530',
  fill = '#009530',
  fillAlpha = 0.1,
  grid = '#E2E8F0',
  axis = '#CBD5E1',
  background = '#FFFFFF',
  gridLines = 4,
  padding = { top: 10, right: 8, bottom: 8, left: 8 },
  lastPointDot = true,
} = {}) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) throw new Error('renderLineChartPng needs at least two values');

  const W = Math.round(width * scale);
  const H = Math.round(height * scale);
  const pad = {
    top: padding.top * scale,
    right: padding.right * scale,
    bottom: padding.bottom * scale,
    left: padding.left * scale,
  };
  const canvas = createCanvas(W, H, hexToRgb(background));

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  // A flat series would divide by zero; give it a nominal band so the line
  // lands mid-plot instead of on an edge.
  const span = max - min || Math.abs(max) * 0.02 || 1;
  const lo = min - span * 0.08;
  const hi = max + span * 0.08;

  const plotLeft = pad.left;
  const plotRight = W - pad.right;
  const plotTop = pad.top;
  const plotBottom = H - pad.bottom;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const yOf = (v) => plotTop + (1 - (v - lo) / (hi - lo)) * plotH;
  const xOf = (i) => plotLeft + (i / (nums.length - 1)) * plotW;

  const hairline = Math.max(1, Math.round(scale));
  // Horizontal grid only: the x axis is time, and vertical rules across a
  // 90-day line add ink without adding a reading.
  for (let g = 0; g <= gridLines; g++) {
    const y = plotTop + (g / gridLines) * plotH;
    fillRect(canvas, plotLeft, Math.round(y), plotW, hairline, hexToRgb(grid));
  }

  const pts = nums.map((v, i) => [xOf(i), yOf(v)]);
  fillUnderPolyline(canvas, pts, plotBottom, hexToRgb(fill), fillAlpha);
  fillRect(canvas, plotLeft, plotBottom, plotW, hairline, hexToRgb(axis));
  strokePolyline(canvas, pts, 2 * scale, hexToRgb(line));

  // The latest close is the number the reader came for: a dot with a
  // surface-coloured ring so it reads as a point on the line rather than
  // a thickening of it.
  if (lastPointDot) {
    const [lx, ly] = pts[pts.length - 1];
    fillCircle(canvas, lx, ly, 5 * scale, hexToRgb(background));
    fillCircle(canvas, lx, ly, 3.5 * scale, hexToRgb(line));
  }

  return { buffer: encodePng(canvas), width, height, min, max, axisMin: lo, axisMax: hi };
}
