// The Charts tab of the savings-by-category workbook, drawn as pictures.
//
// ExcelJS cannot write a native Excel chart, so the three charts go in as
// PNGs, rasterised here on a <canvas> the way the compliance report's
// utility-feed charts are. Browser-only for that reason; what gets plotted
// is decided by chartData in savingsCategoriesExport.js, which is pure and
// tested, so this file is only the drawing.
//
// Drawn at twice the size they are placed at so they stay sharp when the
// sheet is zoomed or printed.

import { INDEX_KIND_LABEL } from './savingsCategoriesExport.js';

const SCALE = 2;
export const CHART_W = 880;
export const CHART_H = 300;

const PAD = { l: 64, r: 16, t: 58, b: 34 };
const TITLE_X = 16;
const FONT = '"Nunito Sans", "Segoe UI", Arial, sans-serif';

const INK = '#1E293B';
const MUTED = '#64748B';
const GRID = '#E2E8F0';
const AXIS = '#CBD5E1';

// Checked with the dataviz palette validator (light surface, all pass).
const GREEN = '#009530';
const BLUE = '#2563EB';
const ORANGE = '#C2410C';

// Consumption: a volume somebody entered is solid, one spread off the
// annual number and the shape is the same green, lighter.
const BAR_COLOR = { entered: GREEN, shape: '#7FCA97' };
const SERIES_COLOR = { contract2: GREEN, index: BLUE, contract1: ORANGE };
// The index: settled is the past, forecast is the forward curve. Same blue
// the Index column uses for a forecast month.
const INDEX_STYLE = {
  settled: { color: INK, dash: [] },
  forward: { color: BLUE, dash: [7, 5] },
  assumed: { color: MUTED, dash: [2, 4] },
};

function niceStep(span, ticks = 5) {
  const raw = span / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

// A y scale from `lo` to `hi` on round numbers. Volumes start at zero;
// prices do not, since a $/Dth line pinned to zero is a flat line.
function yScale(values, { zero = false } = {}) {
  const finite = values.filter(Number.isFinite);
  let lo = zero ? 0 : Math.min(...finite);
  let hi = Math.max(...finite);
  if (!finite.length) { lo = 0; hi = 1; }
  if (hi === lo) { hi += 1; if (!zero) lo -= 1; }
  const step = niceStep(hi - lo);
  lo = zero ? 0 : Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks, step };
}

function frame(spec, scale, fmtTick) {
  const canvas = document.createElement('canvas');
  canvas.width = CHART_W * SCALE;
  canvas.height = CHART_H * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, CHART_W, CHART_H);

  ctx.fillStyle = INK;
  ctx.font = `bold 14px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText(spec.title, TITLE_X, 10);

  const plot = { x: PAD.l, y: PAD.t, w: CHART_W - PAD.l - PAD.r, h: CHART_H - PAD.t - PAD.b };
  const y = v => plot.y + plot.h - ((v - scale.lo) / (scale.hi - scale.lo)) * plot.h;

  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  for (const t of scale.ticks) {
    ctx.strokeStyle = t === scale.lo ? AXIS : GRID;
    ctx.beginPath();
    ctx.moveTo(plot.x, Math.round(y(t)) + 0.5);
    ctx.lineTo(plot.x + plot.w, Math.round(y(t)) + 0.5);
    ctx.stroke();
    ctx.fillStyle = MUTED;
    ctx.fillText(fmtTick(t), plot.x - 6, y(t));
  }
  return { canvas, ctx, plot, y };
}

// Month labels along the bottom, thinned so they never collide.
function xLabels(ctx, plot, labels, xAt) {
  ctx.fillStyle = MUTED;
  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const every = Math.max(1, Math.ceil(labels.length / Math.floor(plot.w / 52)));
  labels.forEach((l, i) => {
    if (i % every === 0) ctx.fillText(l, xAt(i), plot.y + plot.h + 8);
  });
}

// A legend under the title: a swatch (or a short line in the series' own
// dash) and the name in text ink, left to right.
function legend(ctx, items) {
  ctx.font = `12px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let x = TITLE_X;
  const yy = 38;
  for (const it of items) {
    if (it.bar) {
      ctx.fillStyle = it.color;
      ctx.fillRect(x + 4, yy - 5, 14, 10);
    } else {
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash(it.dash || []);
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x + 20, yy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = INK;
    ctx.fillText(it.name, x + 26, yy);
    x += 26 + ctx.measureText(it.name).width + 20;
  }
}

const money = (d) => v => `$${v.toFixed(d)}`;
const volume = v => (v >= 1000 ? `${Math.round(v / 1000).toLocaleString('en-US')}k` : String(Math.round(v)));

function png(canvas) {
  return { dataUrl: canvas.toDataURL('image/png'), width: CHART_W, height: CHART_H };
}

export function consumptionChart(spec) {
  const scale = yScale(spec.bars.map(b => b.value), { zero: true });
  const { canvas, ctx, plot, y } = frame(spec, scale, volume);
  const n = spec.bars.length || 1;
  const slot = plot.w / n;
  // A 2px gap between neighbours, and never wider than it needs to be.
  const bw = Math.max(1, Math.min(slot - 2, 36));
  const xAt = i => plot.x + slot * (i + 0.5);
  spec.bars.forEach((b, i) => {
    if (!Number.isFinite(b.value) || b.value <= 0) return;
    const top = y(b.value);
    const h = plot.y + plot.h - top;
    ctx.fillStyle = BAR_COLOR[b.kind] || BAR_COLOR.shape;
    ctx.beginPath();
    const r = Math.min(3, bw / 2, h);
    ctx.moveTo(xAt(i) - bw / 2, plot.y + plot.h);
    ctx.lineTo(xAt(i) - bw / 2, top + r);
    ctx.quadraticCurveTo(xAt(i) - bw / 2, top, xAt(i) - bw / 2 + r, top);
    ctx.lineTo(xAt(i) + bw / 2 - r, top);
    ctx.quadraticCurveTo(xAt(i) + bw / 2, top, xAt(i) + bw / 2, top + r);
    ctx.lineTo(xAt(i) + bw / 2, plot.y + plot.h);
    ctx.closePath();
    ctx.fill();
  });
  xLabels(ctx, plot, spec.labels, xAt);
  const kinds = new Set(spec.bars.map(b => b.kind));
  legend(ctx, [
    ...(kinds.has('entered') ? [{ name: 'Entered', color: BAR_COLOR.entered, bar: true }] : []),
    ...(kinds.has('shape') ? [{ name: 'Annual volume and shape', color: BAR_COLOR.shape, bar: true }] : []),
  ]);
  return png(canvas);
}

function lineX(plot, n) {
  return i => (n <= 1 ? plot.x + plot.w / 2 : plot.x + (plot.w * i) / (n - 1));
}

export function allInChart(spec) {
  const scale = yScale(spec.series.flatMap(s => s.values));
  const { canvas, ctx, plot, y } = frame(spec, scale, money(2));
  const xAt = lineX(plot, spec.labels.length);
  ctx.lineJoin = 'round';
  // Contract 2 goes down first and wider, so where it runs on the index (an
  // unhedged index deal) it shows as a green edge rather than vanishing.
  for (const s of spec.series) {
    ctx.lineWidth = s.key === 'contract2' ? 6 : 2.5;
    ctx.strokeStyle = SERIES_COLOR[s.key] || MUTED;
    ctx.beginPath();
    let pen = false;
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      if (pen) ctx.lineTo(xAt(i), y(v)); else ctx.moveTo(xAt(i), y(v));
      pen = true;
    });
    ctx.stroke();
  }
  xLabels(ctx, plot, spec.labels, xAt);
  legend(ctx, spec.series.map(s => ({ name: s.name, color: SERIES_COLOR[s.key] || MUTED })));
  return png(canvas);
}

// The index, one segment at a time so each takes the style of the month it
// runs into: settled solid ink, forecast dashed blue, a flat assumption
// dotted grey. A rule marks where the term opens.
export function indexChart(spec) {
  const scale = yScale(spec.points.map(p => p.value));
  const { canvas, ctx, plot, y } = frame(spec, scale, money(2));
  const xAt = lineX(plot, spec.points.length);

  if (spec.termStart > 0 && spec.termStart < spec.points.length) {
    const tx = Math.round((xAt(spec.termStart - 1) + xAt(spec.termStart)) / 2) + 0.5;
    ctx.strokeStyle = AXIS;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(tx, plot.y);
    ctx.lineTo(tx, plot.y + plot.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = MUTED;
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Term starts', tx + 4, plot.y + 2);
  }

  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (let i = 1; i < spec.points.length; i += 1) {
    const a = spec.points[i - 1];
    const b = spec.points[i];
    if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) continue;
    const st = INDEX_STYLE[b.kind] || INDEX_STYLE.assumed;
    ctx.strokeStyle = st.color;
    ctx.setLineDash(st.dash);
    ctx.beginPath();
    ctx.moveTo(xAt(i - 1), y(a.value));
    ctx.lineTo(xAt(i), y(b.value));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // A lone point has no segment to show it; give each a small dot.
  spec.points.forEach((p, i) => {
    if (!Number.isFinite(p.value)) return;
    ctx.fillStyle = (INDEX_STYLE[p.kind] || INDEX_STYLE.assumed).color;
    ctx.beginPath();
    ctx.arc(xAt(i), y(p.value), 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  xLabels(ctx, plot, spec.labels, xAt);
  const kinds = new Set(spec.points.map(p => p.kind));
  legend(ctx, ['settled', 'forward', 'assumed'].filter(k => kinds.has(k)).map(k => ({
    name: INDEX_KIND_LABEL[k], color: INDEX_STYLE[k].color, dash: INDEX_STYLE[k].dash,
  })));
  return png(canvas);
}

/** All three, in the order the Charts tab stacks them. */
export function renderSavingsCharts(data) {
  return [consumptionChart(data.consumption), allInChart(data.allIn), indexChart(data.index)];
}
