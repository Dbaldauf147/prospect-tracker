// The coverage line chart, checked by reading the pixels back out.
//
// The chart is drawn rather than described, so the only honest test is to
// decode what was drawn and look at particular pixels: is the Tier 1 line
// where 88% should put it, is an unrecorded week joined across the way the
// Progress tab draws it, does the picture stay inside the budget the
// snapshot allows it. Every colour is flat and exact, which is what makes
// that tractable - there is no antialiasing to soften a comparison.
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

const BG = 0, T1 = 4, T2 = 5;

// The drawn image, back as a grid of palette indices.
function pixelsOf(image) {
  const buf = Buffer.from(image.src.split(',')[1], 'base64');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const at = buf.indexOf('IDAT');
  const raw = zlib.inflateSync(buf.subarray(at + 4, at + 4 + buf.readUInt32BE(at - 4)));
  const px = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      px[y * width + x] = (raw[y * (width + 1) + 1 + x] + (y === 0 ? 0 : px[(y - 1) * width + x])) & 0xFF;
    }
  }
  return {
    width,
    height,
    at: (x, y) => px[Math.round(y) * width + Math.round(x)],
    // Which rows of a column carry a given colour.
    column: (x) => {
      const rows = [];
      for (let y = 0; y < height; y += 1) if (px[y * width + Math.round(x)] !== BG) rows.push([y, px[y * width + Math.round(x)]]);
      return rows;
    },
    count: (colour) => px.reduce((n, v) => n + (v === colour ? 1 : 0), 0),
  };
}

const pointsOf = (values) => values.map((v, i) => ({
  key: `2026-0${1 + (i % 9)}-0${1 + (i % 9)}`,
  label: `Wk ${i}`,
  t1: Array.isArray(v) ? v[0] : v,
  t2: Array.isArray(v) ? v[1] : v,
}));

// ---- Nothing to draw -----------------------------------------------------
{
  eq(coverageChartImage(null), null, 'no chart at all is no picture');
  eq(coverageChartImage({ points: [] }), null, 'no points is no picture');
  eq(coverageChartImage({ points: pointsOf([50]) }), null, 'a single week is a reading, not a line');
  eq(coverageChartImage({ points: [{ label: 'a', t1: null, t2: null }, { label: 'b', t1: null, t2: null }] }), null,
    'weeks nobody recorded are no picture, rather than an empty frame');
}

// ---- Where the lines land ------------------------------------------------
{
  const image = coverageChartImage({ title: 'Contacts', points: pointsOf([[0, 100], [0, 100], [0, 100]]) });
  eq([image.width, image.height], [CHART_W, CHART_H], 'the picture is laid out at the card’s size');
  const px = pixelsOf(image);
  eq([px.width, px.height], [CHART_W * SCALE, CHART_H * SCALE], 'and drawn at twice that, for a high-density screen');

  // 0% and 100% are the two ends of the axis, so the flat lines sit at the
  // bottom and the top of the plot and nowhere in between.
  const middle = Math.round(px.width / 2);
  const t1Rows = px.column(middle).filter(([, c]) => c === T1).map(([y]) => y);
  const t2Rows = px.column(middle).filter(([, c]) => c === T2).map(([y]) => y);
  ok(t1Rows.length > 0 && t2Rows.length > 0, 'both tiers are drawn');
  ok(Math.min(...t1Rows) > Math.max(...t2Rows), 'the 0% line is below the 100% line');
  ok(Math.max(...t1Rows) > px.height * 0.7, 'a tier flat at 0% sits on the baseline');
  ok(Math.min(...t2Rows) < px.height * 0.2, 'a tier flat at 100% sits at the top of the plot');

  // Halfway up is halfway between them, within the thickness of the line.
  const half = pixelsOf(coverageChartImage({ points: pointsOf([50, 50, 50]) }));
  const halfRows = half.column(middle).filter(([, c]) => c === T1 || c === T2).map(([y]) => y);
  const mid = (Math.min(...t1Rows) + Math.max(...t2Rows)) / 2;
  ok(Math.abs(Math.min(...halfRows) - mid) <= 3 * SCALE, '50% lands halfway up the axis');
}

// ---- A week nobody recorded ----------------------------------------------
{
  const drawn = pixelsOf(coverageChartImage({ points: pointsOf([80, 80, 80, 80, 80]) }));
  const gapped = pixelsOf(coverageChartImage({
    points: pointsOf([80, 80, 80, 80, 80]).map((p, i) => (i === 2 ? { ...p, t1: null, t2: null } : p)),
  }));
  // Joined straight across, the way the Progress tab draws it: a flat
  // 80% either side of the gap is the same flat line as five recorded weeks.
  const middle = Math.round(gapped.width / 2);
  ok(gapped.column(middle).some(([, c]) => c === T1 || c === T2),
    'an unrecorded week is joined across, with no break in the line');
  ok(gapped.count(T1) > drawn.count(T1) * 0.9, 'the line across the gap is as long as a recorded one');
}

// ---- What the card carries -----------------------------------------------
{
  const weeks = pointsOf(new Array(26).fill(0).map((_, i) => [60 + (i % 7), 30 + (i % 11)]));
  const image = coverageChartImage({ title: '% of Accounts with HubSpot Contacts', points: weeks });
  ok(image.alt.includes('% of Accounts with HubSpot Contacts') && image.alt.includes('Tier 1'),
    'the picture carries a label for a reader who cannot see it');
  ok(image.src.startsWith('data:image/png;base64,'), 'it travels as a PNG data URL, as the snapshot stores it');
  // Indexed colour and a filter that flattens unchanged rows is what keeps
  // half a year of two lines inside the snapshot's budget for it.
  ok(image.src.length < MAX_COVERAGE_IMAGE_CHARS,
    `half a year of weeks fits the snapshot budget (${image.src.length} of ${MAX_COVERAGE_IMAGE_CHARS})`);
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
