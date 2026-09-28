// The pipeline funnel drawn for the email, checked by reading the pixels
// back out - and through the scheduled rebuild, which is where the funnel
// went missing: a server build has no DOM to rasterise the tab's SVG with,
// so without this picture the email dropped the whole section.
//
// Run: node scripts/funnelChartImage.test.mjs
import zlib from 'node:zlib';
import { funnelChartImage } from '../src/utils/funnelChartImage.js';
import { buildSnapshotDoc, MAX_FUNNEL_IMAGE_CHARS } from '../api/_lib/weeklyReportSnapshot.js';
import { renderWeeklyReportHtml } from '../api/_lib/weeklyReportEmailHtml.js';
import { funnelAttachment } from '../api/_lib/weeklyReportEmail.js';
import { emailFunnelSummary, emailSnapshotPayload } from '../src/utils/weeklyReportEmailSnapshot.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}
const ok = (c, name) => eq(!!c, true, name);

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
  return { width, height, at: (x, y) => px[Math.round(y) * width + Math.round(x)] };
}

// Palette indices, as funnelChartImage lays them out.
const BG = 0, GAP_SHADE = 8, STAGE3 = 9, STAGE4 = 10;
// Layout-to-pixel: two pixels per unit, the view starting at y=108.
const X = (x) => x * 2;
const Y = (y) => (y - 108) * 2;

const stages = [
  { stageNum: 4, amtActual: 800000, amtGoal: 2000000, lifeActual: 100, closeRate: 0.2, countActual: 4 },
  { stageNum: 3, amtActual: 500000, amtGoal: 400000, lifeActual: 100, closeRate: 0.1, countActual: 3 },
];
const outcome = { soldLabel: 'Closed YTD', soldAmount: 485000, target: 1300000 };

// ---- Nothing to draw -----------------------------------------------------
{
  eq(funnelChartImage([], outcome), null, 'no stages is no picture');
  eq(funnelChartImage([{ stageNum: 3, amtActual: 0, amtGoal: 0 }], outcome), null, 'all-zero stages are no picture');
}

// ---- Where the bands land ------------------------------------------------
{
  const image = funnelChartImage(stages, outcome);
  eq([image.width, image.height], [1200, 262], 'laid out at the tab chart\'s own size');
  ok(image.src.length < MAX_FUNNEL_IMAGE_CHARS, 'inside the budget the snapshot allows the funnel');
  ok(/1 of 2 stages are short of goal/.test(image.alt), 'the alt text counts the stages short of goal');

  const px = pixelsOf(image);
  // Equal lives split 740 units evenly: stage 3 first (earliest left), from
  // x=150 to 516; stage 4 from 520 to 886. The tallest mark is stage 4's
  // $2M goal, so its $800K band is 40% of 208 units tall.
  eq(px.at(X(160), Y(347)), STAGE3, 'stage 3 is drawn first, at the left');
  eq(px.at(X(530), Y(347)), STAGE4, 'stage 4 follows it');
  eq(px.at(X(530), Y(348 - 208 * 0.4 + 3)), STAGE4, 'a band reaches up to its own value');
  eq(px.at(X(530), Y(348 - 208 * 0.4 - 10)), GAP_SHADE, 'and the shortfall to the goal above it is shaded');
  eq(px.at(X(530), Y(348 - 208 - 10)), BG, 'nothing is drawn above the goal line');
}

// ---- Through the scheduled send -----------------------------------------
{
  const summary = emailFunnelSummary(stages, outcome);
  const payload = emailSnapshotPayload({ funnelSummary: summary, funnelImage: funnelChartImage(stages, outcome) });
  const doc = buildSnapshotDoc(payload, { uid: 'u', email: 'e@example.com' });
  ok(doc.funnelImage, 'the drawn picture survives the snapshot\'s checks');
  const attachment = funnelAttachment(doc);
  ok(attachment, 'and is attached to the message');
  const html = renderWeeklyReportHtml(doc, { funnelImageSrc: 'cid:funnel' });
  ok(html.includes('Pipeline funnel') && html.includes('src="cid:funnel"'), 'so the email carries the funnel section again');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
