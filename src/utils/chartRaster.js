// An antialiased raster for the email's chart pictures, with real type.
//
// The first coverage pictures were drawn a whole pixel at a time in six
// flat colours and lettered in a 5x7 bitmap font, which is why they read
// as pixelated next to the Progress tab's SVG charts. This draws the same
// kind of picture the way a browser would: every edge gets a fractional
// coverage and is blended into the pixel, and text is filled from real
// glyph outlines (utils/chartFontData), so a label at 11px looks like an
// 11px label and not a scaled-up grid of squares.
//
// It still runs anywhere: no canvas, no DOM, no Node built-ins, for the
// same reason utils/pngEncode exists - the email that lands on Monday is
// rebuilt on a serverless runner. The finished picture is folded down to
// at most 256 colours so the indexed-colour encoder can write it; a chart
// is a few inks over white, so that costs nothing visible.

import { pngDataUrl } from './pngEncode.js';
import { GLYPHS, UNITS_PER_EM } from './chartFontData.js';

export function hexRgb(hex) {
  const h = String(hex).replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** A white RGB raster `width` x `height` pixels. */
export function createRaster(width, height) {
  const data = new Uint8ClampedArray(width * height * 3).fill(255);
  return { width, height, data };
}

// Composite `rgb` over one pixel at coverage `a` (0..1).
function blend(r, x, y, rgb, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= r.width || y >= r.height) return;
  const k = a > 1 ? 1 : a;
  const i = (y * r.width + x) * 3;
  const d = r.data;
  d[i] = d[i] + (rgb[0] - d[i]) * k;
  d[i + 1] = d[i + 1] + (rgb[1] - d[i + 1]) * k;
  d[i + 2] = d[i + 2] + (rgb[2] - d[i + 2]) * k;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * An axis-aligned rectangle, its edges weighted by how much of each pixel
 * they cover, so a 1px rule at a half-pixel position is two soft pixels
 * rather than one that jumps.
 */
export function fillRect(r, x, y, w, h, color) {
  const rgb = hexRgb(color);
  const x0 = Math.max(0, Math.floor(x));
  const x1 = Math.min(r.width, Math.ceil(x + w));
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(r.height, Math.ceil(y + h));
  for (let py = y0; py < y1; py += 1) {
    const cy = Math.min(py + 1, y + h) - Math.max(py, y);
    for (let px = x0; px < x1; px += 1) {
      const cx = Math.min(px + 1, x + w) - Math.max(px, x);
      blend(r, px, py, rgb, cx * cy);
    }
  }
}

/** A filled disc, its rim antialiased by distance from the centre. */
export function fillCircle(r, cx, cy, radius, color) {
  const rgb = hexRgb(color);
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(r.width, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(r.height, Math.ceil(cy + radius + 1));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
      blend(r, px, py, rgb, clamp01(radius + 0.5 - d));
    }
  }
}

// Distance from (px, py) to the segment a-b.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * A polyline `width` pixels wide with round joins and caps. Coverage is
 * taken as the most any one segment gives a pixel, so where two segments
 * meet the joint is not painted twice and darkened.
 */
export function strokePolyline(r, pts, width, color) {
  if (pts.length < 2) return;
  const rgb = hexRgb(color);
  const hw = width / 2;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const bx0 = Math.max(0, Math.floor(minX - hw - 1));
  const by0 = Math.max(0, Math.floor(minY - hw - 1));
  const bx1 = Math.min(r.width, Math.ceil(maxX + hw + 1));
  const by1 = Math.min(r.height, Math.ceil(maxY + hw + 1));
  const bw = bx1 - bx0;
  const mask = new Float32Array(bw * Math.max(0, by1 - by0));
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const sx0 = Math.max(bx0, Math.floor(Math.min(a.x, b.x) - hw - 1));
    const sx1 = Math.min(bx1, Math.ceil(Math.max(a.x, b.x) + hw + 1));
    const sy0 = Math.max(by0, Math.floor(Math.min(a.y, b.y) - hw - 1));
    const sy1 = Math.min(by1, Math.ceil(Math.max(a.y, b.y) + hw + 1));
    for (let py = sy0; py < sy1; py += 1) {
      for (let px = sx0; px < sx1; px += 1) {
        const c = clamp01(hw + 0.5 - segDist(px + 0.5, py + 0.5, a.x, a.y, b.x, b.y));
        const k = (py - by0) * bw + (px - bx0);
        if (c > mask[k]) mask[k] = c;
      }
    }
  }
  for (let py = by0; py < by1; py += 1) {
    for (let px = bx0; px < bx1; px += 1) {
      const c = mask[(py - by0) * bw + (px - bx0)];
      if (c > 0) blend(r, px, py, rgb, c);
    }
  }
}

// ---- Filled outlines (the type) ------------------------------------------

// Sub-scanlines per pixel row. Horizontal coverage is exact; vertical is
// sampled this many times, which is plenty for type at chart sizes.
const SUBSAMPLES = 5;

/**
 * Fill closed polygons (each a list of { x, y }) by the nonzero winding
 * rule, the way a font's contours are meant to be filled.
 */
export function fillPolygons(r, polys, color) {
  const rgb = hexRgb(color);
  const edges = [];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x);
      minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y);
      if (a.y === b.y) continue;
      edges.push(a.y < b.y
        ? { y0: a.y, y1: b.y, x0: a.x, x1: b.x, dir: 1 }
        : { y0: b.y, y1: a.y, x0: b.x, x1: a.x, dir: -1 });
    }
  }
  if (!edges.length) return;
  const bx0 = Math.max(0, Math.floor(minX));
  const bx1 = Math.min(r.width, Math.ceil(maxX) + 1);
  const by0 = Math.max(0, Math.floor(minY));
  const by1 = Math.min(r.height, Math.ceil(maxY) + 1);
  const bw = bx1 - bx0;
  if (bw <= 0 || by1 <= by0) return;
  const row = new Float32Array(bw);
  const w = 1 / SUBSAMPLES;

  for (let py = by0; py < by1; py += 1) {
    row.fill(0);
    let touched = false;
    for (let s = 0; s < SUBSAMPLES; s += 1) {
      const sy = py + (s + 0.5) * w;
      const xs = [];
      for (const e of edges) {
        if (sy < e.y0 || sy >= e.y1) continue;
        xs.push({ x: e.x0 + ((sy - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0), dir: e.dir });
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a.x - b.x);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k += 1) {
        wind += xs[k].dir;
        if (!wind) continue;
        // The span xs[k].x .. xs[k+1].x is inside: add its exact
        // horizontal coverage of each pixel it crosses.
        const a = Math.max(bx0, xs[k].x);
        const b = Math.min(bx1, xs[k + 1].x);
        if (b <= a) continue;
        touched = true;
        const pa = Math.floor(a);
        const pb = Math.floor(b);
        if (pa === pb) { row[pa - bx0] += (b - a) * w; continue; }
        row[pa - bx0] += (pa + 1 - a) * w;
        for (let p = pa + 1; p < pb; p += 1) row[p - bx0] += w;
        if (pb < bx1) row[pb - bx0] += (b - pb) * w;
      }
    }
    if (!touched) continue;
    for (let i = 0; i < bw; i += 1) if (row[i] > 0) blend(r, bx0 + i, py, rgb, row[i]);
  }
}

// A glyph's outline, parsed once, in font units: a list of contours, each
// a list of commands. Quadratic pieces are flattened when placed, at a
// step count that suits the size they are drawn at.
const parsed = new Map();
function glyphContours(ch) {
  if (parsed.has(ch)) return parsed.get(ch);
  const g = GLYPHS[ch];
  const contours = [];
  if (g && g.d) {
    const tokens = g.d.match(/[MLQZ]|-?\d+(?:\.\d+)?/g) || [];
    let cur = null;
    for (let i = 0; i < tokens.length;) {
      const t = tokens[i++];
      if (t === 'M') { cur = [{ x: +tokens[i++], y: +tokens[i++] }]; contours.push(cur); }
      else if (t === 'L') cur.push({ x: +tokens[i++], y: +tokens[i++] });
      else if (t === 'Q') cur.push({ q: true, cx: +tokens[i++], cy: +tokens[i++], x: +tokens[i++], y: +tokens[i++] });
    }
  }
  parsed.set(ch, contours);
  return contours;
}

/** How wide `str` is at `size` pixels, in pixels. */
export function textWidth(str, size) {
  let units = 0;
  for (const ch of String(str)) units += (GLYPHS[ch] || GLYPHS[' ']).a;
  return (units * size) / UNITS_PER_EM;
}

/**
 * Letter `str` with its baseline at `y`. `align` places `x` at the left
 * edge, the centre, or the right edge of the text. Characters the font
 * extract does not carry take a space's width and draw nothing.
 */
export function drawText(r, str, x, y, size, color, align = 'left') {
  const s = String(str);
  const scale = size / UNITS_PER_EM;
  const w = textWidth(s, size);
  let pen = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  const polys = [];
  for (const ch of s) {
    for (const contour of glyphContours(ch)) {
      const poly = [];
      let prev = null;
      for (const c of contour) {
        const px = pen + c.x * scale;
        const py = y - c.y * scale;
        if (c.q && prev) {
          const qx = pen + c.cx * scale;
          const qy = y - c.cy * scale;
          const steps = 6;
          for (let k = 1; k <= steps; k += 1) {
            const u = k / steps;
            const v = 1 - u;
            poly.push({ x: v * v * prev.x + 2 * v * u * qx + u * u * px, y: v * v * prev.y + 2 * v * u * qy + u * u * py });
          }
        } else {
          poly.push({ x: px, y: py });
        }
        prev = { x: px, y: py };
      }
      if (poly.length > 2) polys.push(poly);
    }
    pen += ((GLYPHS[ch] || GLYPHS[' ']).a) * scale;
  }
  fillPolygons(r, polys, color);
}

// ---- Out to a PNG ---------------------------------------------------------

/**
 * The raster as a PNG data URL. Blended edges make many near-identical
 * colours; if there are more than an indexed PNG holds, each channel is
 * rounded to a coarser step until they fit, which moves an edge pixel by a
 * shade nobody can see.
 */
export function rasterToPngDataUrl(r) {
  const n = r.width * r.height;
  const d = r.data;
  for (let step = 1; step <= 64; step *= 2) {
    const q = (v) => (step === 1 ? v : Math.min(255, Math.round(v / step) * step));
    const index = new Map();
    const palette = [];
    const pixels = new Uint8Array(n);
    let fits = true;
    for (let i = 0; i < n; i += 1) {
      const key = (q(d[i * 3]) << 16) | (q(d[i * 3 + 1]) << 8) | q(d[i * 3 + 2]);
      let idx = index.get(key);
      if (idx === undefined) {
        if (palette.length === 256) { fits = false; break; }
        idx = palette.length;
        index.set(key, idx);
        palette.push([key >> 16, (key >> 8) & 255, key & 255]);
      }
      pixels[i] = idx;
    }
    if (fits) return pngDataUrl({ width: r.width, height: r.height, palette, pixels });
  }
  throw new Error('chartRaster: too many colours to index');
}
