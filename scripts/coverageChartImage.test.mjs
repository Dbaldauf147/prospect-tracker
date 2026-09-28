// The coverage line chart, checked by reading the pixels back out.
//
// The chart is drawn rather than described, so the only honest test is to
// decode what was drawn and look at particular pixels: is the Tier 1 line
// where 88% should put it, is a week at 100% painted the Progress tab's
// dark green, is the picture antialiased and lettered, does it stay inside
// the budget the snapshot allows it. Edges are blended, so a pixel is
// judged by which ink it is closest to rather than by an exact match.
//
// Run: node scripts/coverageChartImage.test.mjs
import zlib from 'node:zlib';
import {
  coverageChartImage, withCoverageImages, SCALE, CHART_W, CHART_H,
} from '../src/utils/coverageChartImage.js';
import { MAX_COVERAGE_IMAGE_CHARS } from '../api/_lib/weeklyReportSnapshot.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const ok = (c, name) => eq(!!c, true, name);

const INKS = {
  t1: [220, 38, 38],
  t2: [59, 130, 246],
  green: [21, 128, 61],
  label: [100, 116, 139],
};

// The drawn image, back as RGB. The encoder writes an indexed PNG with
// filter type 2 ("up") on every row after the first.
function pixelsOf(image) {
  const buf = Buffer.from(image.src.split(',')[1], 'base64');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const chunk = (name) => {
    const at = buf.indexOf(name);
    return buf.subarray(at + 4, at + 4 + buf.readUInt32BE(at - 4));
  };
  const plte = chunk('PLTE');
  const raw = zlib.inflateSync(chunk('IDAT'));
  const idx = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      idx[y * width + x] = (raw[y * (width + 1) + 1 + x] + (y === 0 ? 0 : idx[(y - 1) * width + x])) & 0xFF;
    }
  }
  const rgb = (x, y) => {
    const i = idx[Math.round(y) * width + Math.round(x)] * 3;
    return [plte[i], plte[i + 1], plte[i + 2]];
  };
  // Solidly one ink: within a small distance of it.
  const is = (x, y, ink) => {
    const [r, g, b] = rgb(x, y);
    return Math.hypot(r - ink[0], g - ink[1], b - ink[2]) < 40;
  };
  return {
    width,
    height,
    colours: plte.length / 3,
    is,
    // The rows of a column that are solidly `ink`.
    rows: (x, ink) => {
      const out = [];
      for (let y = 0; y < height; y += 1) if (is(x, y, ink)) out.push(y);
      return out;
    },
  };
}

// Recorded weeks, as coverageByWeek hands them over.
const pointsOf = (values) => values.map((v, i) => ({
  key: `2026-04-${String(1 + i).padStart(2, '0')}`,
  label: `Apr ${1 + i}`,
  t1: Array.isArray(v) ? v[0] : v,
  t2: Array.isArray(v) ? v[1] : v,
}));

// The plot's edges, in raster pixels, as coverageChartImage lays it out.
const PLOT_T = 10 * SCALE;
const PLOT_B = (CHART_H - 35) * SCALE;
const yOf = (pct) => PLOT_B - ((PLOT_B - PLOT_T) * pct) / 100;

// ---- Nothing to draw -----------------------------------------------------
{
  eq(coverageChartImage(null), null, 'no chart at all is no picture');
  eq(coverageChartImage({ points: [] }), null, 'no points is no picture');
  eq(coverageChartImage({ points: pointsOf([50]) }), null, 'a single week is a reading, not a line');
  eq(coverageChartImage({ points: [{ label: 'a', t1: null, t2: null }, { label: 'b', t1: null, t2: null }] }), null,
    'weeks with no reading are no picture, rather than an empty frame');
}

// ---- Where the lines land ------------------------------------------------
{
  const image = coverageChartImage({ title: 'Contacts', points: pointsOf([[20, 60], [20, 60], [20, 60], [20, 60]]) });
  eq([image.width, image.height], [CHART_W, CHART_H], 'the picture is laid out at the card’s size');
  const px = pixelsOf(image);
  eq([px.width, px.height], [CHART_W * SCALE, CHART_H * SCALE], 'and drawn at twice that, for a high-density screen');

  // Between two weeks, clear of the dots: each tier's line sits at its
  // reading on the 0-100 axis, within the thickness of the line.
  const between = Math.round((65 * SCALE + (CHART_W - 20) * SCALE) / 2 - 40);
  const t1 = px.rows(between, INKS.t1);
  const t2 = px.rows(between, INKS.t2);
  ok(t1.length > 0 && t2.length > 0, 'both tiers are drawn');
  ok(Math.abs(t1[0] - yOf(20)) <= 3 * SCALE, 'Tier 1 at 20% sits a fifth of the way up the axis');
  ok(Math.abs(t2[0] - yOf(60)) <= 3 * SCALE, 'Tier 2 at 60% sits three fifths of the way up');
}

// ---- 100%, as the Progress tab marks it ----------------------------------
{
  const px = pixelsOf(coverageChartImage({ points: pointsOf([[100, 40], [100, 40], [100, 40]]) }));
  const between = Math.round((65 * SCALE + (CHART_W - 20) * SCALE) / 2 - 40);
  ok(px.rows(between, INKS.green).some(y => Math.abs(y - yOf(100)) <= 3 * SCALE),
    'a run at 100% is drawn over in dark green');
  ok(px.rows(between, INKS.t2).some(y => Math.abs(y - yOf(40)) <= 3 * SCALE),
    'and a tier below it keeps its own colour');
}

// ---- A dot on every week ---------------------------------------------------
{
  const n = 6;
  const px = pixelsOf(coverageChartImage({ points: pointsOf(new Array(n).fill([30, 70])) }));
  const plotL = 65 * SCALE;
  const plotR = (CHART_W - 20) * SCALE;
  let dots = 0;
  for (let i = 0; i < n; i += 1) {
    const x = plotL + ((plotR - plotL) * i) / (n - 1);
    // A dot is wider than the line: solid ink 3px above the line's centre.
    if (px.is(x, yOf(30) - 3 * SCALE, INKS.t1)) dots += 1;
  }
  eq(dots, n, 'every recorded week carries a dot');
}

// ---- A reading the week did not record -------------------------------------
{
  // A recorded week missing one field breaks that tier's line there, as
  // recharts does with connectNulls off, and draws no dot for it.
  const points = pointsOf([50, 50, 50, 50, 50]).map((p, i) => (i === 2 ? { ...p, t1: null } : p));
  const px = pixelsOf(coverageChartImage({ points }));
  const plotL = 65 * SCALE;
  const plotR = (CHART_W - 20) * SCALE;
  const at = (i) => plotL + ((plotR - plotL) * i) / 4;
  const midGap = (at(1) + at(2)) / 2;
  eq(px.rows(midGap, INKS.t1).length, 0, 'a missing Tier 1 reading breaks the Tier 1 line');
  ok(px.rows(midGap, INKS.t2).length > 0, 'while Tier 2 runs on through the same week');
}

// ---- Smooth, and lettered ---------------------------------------------------
{
  const weeks = pointsOf(new Array(26).fill(0).map((_, i) => [60 + (i % 7), 30 + (i % 11)]));
  const image = coverageChartImage({ title: '% of Accounts with HubSpot Contacts', points: weeks });
  const px = pixelsOf(image);
  // Six flat inks is what the old whole-pixel drawing produced; blended
  // edges bring many more.
  ok(px.colours > 40, `edges are antialiased (${px.colours} shades)`);

  // The y-axis labels sit left of the axis, in the label slate.
  let lettered = 0;
  for (let x = 20 * SCALE; x < 62 * SCALE; x += 1) {
    for (let y = yOf(50) - 6 * SCALE; y < yOf(50) + 6 * SCALE; y += 1) if (px.is(x, y, INKS.label)) lettered += 1;
  }
  ok(lettered > 20, 'the axis is lettered beside each tick');

  ok(image.alt.includes('% of Accounts with HubSpot Contacts') && image.alt.includes('Tier 1'),
    'the picture carries a label for a reader who cannot see it');
  ok(image.src.startsWith('data:image/png;base64,'), 'it travels as a PNG data URL, as the snapshot stores it');
  ok(image.src.length < MAX_COVERAGE_IMAGE_CHARS,
    `half a year of weeks fits the snapshot budget (${image.src.length} of ${MAX_COVERAGE_IMAGE_CHARS})`);
}

// ---- Ten months of weeks ---------------------------------------------------
{
  const points = pointsOf(new Array(43).fill(0).map((_, i) => [80 + (i % 21), 20 + ((i * 7) % 80)]));
  const img = coverageChartImage({ title: 'Contacts', points });
  ok(img, 'ten months of weekly readings is drawn');
  ok(img.src.length < MAX_COVERAGE_IMAGE_CHARS,
    `and stays inside the snapshot budget (${img.src.length} of ${MAX_COVERAGE_IMAGE_CHARS})`);
}

// ---- The whole payload ---------------------------------------------------
{
  const coverage = {
    weeks: 3,
    charts: [
      { id: 'contactPct', title: 'Contacts', points: pointsOf([50, 60, 70]), note: 'x' },
      { id: 'dmPct', title: 'Decision makers', points: pointsOf([10]), note: '' },
    ],
  };
  const out = withCoverageImages(coverage);
  eq(out.charts.map(c => !!c.image), [true, false], 'every chart that can be drawn is, and one that cannot says so');
  eq(out.charts.map(c => c.id), ['contactPct', 'dmPct'], 'the charts keep their ids, which pair a card with its picture');
  eq(out.charts[0].note, 'x', 'and everything else about a chart is left alone');
  eq(withCoverageImages(null), null, 'no coverage at all stays no coverage');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
