// The All Missing Steps line (My Accounts > All Missing History) for the
// Weekly Report email: the recorded days as points, the headline the
// subtab prints over its chart, and the chart drawn as a PNG.
//
// Read off the same day-by-day history the subtab charts
// (utils/missingHistory, mirrored to Firestore as
// `company-data-missing-history`), so the email and the tab show one line.
// That module talks to localStorage; this one is pure so the scheduled
// send can build the same thing on a serverless runner, which is why the
// two small rules it shares with it (which days count, which is the
// baseline) are restated here rather than imported.
//
// Drawn through utils/chartRaster for the same reason the coverage charts
// are: there is no canvas where Monday's email is built.

import { createRaster, fillRect, fillCircle, strokePolyline, drawText, textWidth, rasterToPngDataUrl } from './chartRaster.js';

// How far back the email's chart reaches, in days before the period end.
export const MISSING_TREND_DAYS = 56;

// Days counted the way the chart counts now (missingHistory's isStepsDay).
const isStepsDay = (row) => row?.basis === 'steps';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 14" from "2026-10-14". */
export function missingDayLabel(day) {
  const [, m, d] = String(day).split('-').map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : String(day || '');
}

// YYYY-MM-DD of an instant, in `timeZone` when given, else local time.
function dayOf(ms, timeZone = '') {
  const d = new Date(ms);
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch { /* an unknown zone falls through to local time */ }
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The series for the email, or null when no day in the window is recorded.
 *
 *   history   the stored history ({ 'YYYY-MM-DD': row })
 *   endMs     the end of the reported period: days after it are left out
 *   days      how far back from it the chart reaches
 *
 * Returns { points: [{ key, label, value }], latest, companies, since,
 * delta, sinceBaseline }. `since` is the day the headline measures from:
 * the frozen baseline when one is set, as the subtab does, else the first
 * day on record (which may be older than the chart's window).
 */
export function missingStepsTrend(history, { endMs = Date.now(), days = MISSING_TREND_DAYS, timeZone = '' } = {}) {
  const h = history && typeof history === 'object' && !Array.isArray(history) ? history : {};
  const last = dayOf(endMs - 1, timeZone);
  const first = dayOf(endMs - 1 - days * 24 * 60 * 60 * 1000, timeZone);
  const all = Object.keys(h).sort()
    .filter(k => k <= last && isStepsDay(h[k]) && Number.isFinite(Number(h[k]?.total)));
  const shown = all.filter(k => k > first);
  if (!shown.length) return null;
  const points = shown.map(k => ({ key: k, label: missingDayLabel(k), value: Math.max(0, Math.round(Number(h[k].total))) }));
  const latest = points[points.length - 1];
  const baseDay = all.find(k => h[k]?.baseline) || null;
  const since = baseDay && baseDay < latest.key ? baseDay : all[0];
  const sinceRow = since < latest.key ? h[since] : null;
  return {
    points,
    latest: latest.value,
    latestDay: latest.key,
    companies: Math.max(0, Math.round(Number(h[latest.key]?.companies) || 0)),
    since: sinceRow ? since : null,
    sinceLabel: sinceRow ? missingDayLabel(since) : '',
    delta: sinceRow ? latest.value - Math.round(Number(sinceRow.total) || 0) : null,
    sinceBaseline: !!(sinceRow && since === baseDay),
  };
}

// ---- The picture ----------------------------------------------------------
//
// The subtab's chart: a red line over light gridlines, a dot on each day,
// the latest figure written beside the last dot.

export const MISSING_CHART_W = 720;
export const MISSING_CHART_H = 200;
const SCALE = 2;
const INK = {
  line: '#DC2626',
  grid: '#E2E8F0',
  label: '#94A3B8',
  value: '#334155',
};

// A round step that gives three to five gridlines.
function niceStep(top) {
  const raw = top / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

/** The series as `{ src, width, height, alt }`, or null with nothing to draw. */
export function missingStepsChartImage(trend) {
  const points = Array.isArray(trend?.points) ? trend.points : [];
  if (!points.length) return null;
  const W = MISSING_CHART_W * SCALE;
  const H = MISSING_CHART_H * SCALE;
  const r = createRaster(W, H);
  const size = 11 * SCALE;

  const plotL = 46 * SCALE;
  const lastText = points[points.length - 1].value.toLocaleString('en-US');
  const plotR = W - (textWidth(lastText, size) + 22 * SCALE);
  const plotT = 10 * SCALE;
  const plotB = H - 26 * SCALE;
  const peak = Math.max(...points.map(p => p.value), 1);
  const step = niceStep(peak * 1.05);
  const top = Math.ceil((peak * 1.05) / step) * step;
  const n = points.length;
  const xAt = (i) => (n === 1 ? (plotL + plotR) / 2 : plotL + ((plotR - plotL) * i) / (n - 1));
  const yAt = (v) => plotB - ((plotB - plotT) * v) / top;

  for (let v = 0; v <= top + 1e-9; v += step) {
    fillRect(r, plotL, yAt(v) - SCALE / 2, plotR - plotL, SCALE, INK.grid);
    drawText(r, v.toLocaleString('en-US'), plotL - 6 * SCALE, yAt(v) + 0.355 * size, size, INK.label, 'right');
  }

  // Day labels: the last always, the rest walking back while they clear.
  let leftEdge = Infinity;
  for (let i = n - 1; i >= 0; i -= 1) {
    const w = textWidth(points[i].label, size);
    const at = Math.max(w / 2, Math.min(xAt(i), W - w / 2));
    if (i !== n - 1 && at + w / 2 + 10 * SCALE > leftEdge) continue;
    drawText(r, points[i].label, at, H - 8 * SCALE, size, INK.label, 'center');
    leftEdge = at - w / 2;
  }

  if (n > 1) strokePolyline(r, points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) })), 2 * SCALE, INK.line);
  points.forEach((p, i) => fillCircle(r, xAt(i), yAt(p.value), (n > 40 ? 2 : 3) * SCALE, INK.line));
  const lx = xAt(n - 1);
  const ly = yAt(points[n - 1].value);
  fillCircle(r, lx, ly, 4 * SCALE, INK.line);
  drawText(r, lastText, lx + 8 * SCALE, ly + 0.355 * size, size, INK.value, 'left');

  return {
    src: rasterToPngDataUrl(r),
    width: MISSING_CHART_W,
    height: MISSING_CHART_H,
    alt: `All missing steps by day: ${lastText} on ${points[n - 1].label}`,
  };
}

/** The series with its picture attached, for the snapshot. */
export function withMissingStepsImage(trend) {
  if (!trend || typeof trend !== 'object') return trend || null;
  return { ...trend, image: missingStepsChartImage(trend) };
}
