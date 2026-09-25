// The weekly coverage-ratio series in the Weekly Report email. Plain Node,
// no framework. Run:
//   node scripts/coverageRatioWeekly.test.mjs
//
// The ratio (open pipeline ÷ annual target) is a level computed off
// whatever is cached at the moment, so it had no history: the email could
// say where it stood and never which way it was going. These pin the log
// that remembers it, the series drawn from that log, and how the series
// survives the stored snapshot and lands in the email.
import {
  coverageReading, sameReading, withCoverageReading, coverageRatioByWeek, weekKeyAt,
  COVERAGE_RATIO_WEEKS,
} from '../src/utils/weeklyReportTrends.js';
import { emailSnapshotPayload } from '../src/utils/weeklyReportEmailSnapshot.js';
import { buildSnapshotDoc } from '../api/_lib/weeklyReportSnapshot.js';
import { renderWeeklyReportHtml, coverageRatioHtml } from '../api/_lib/weeklyReportEmailHtml.js';
import { coverageRatioChartImage, withCoverageRatioImage, RATIO_CHART_W, RATIO_CHART_H } from '../src/utils/coverageChartImage.js';
import { coverageRatioAttachment } from '../api/_lib/weeklyReportEmail.js';
import { MAX_COVERAGE_IMAGE_CHARS } from '../api/_lib/weeklyReportSnapshot.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${a}\n      want: ${e}`}`);
}

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const REF = at(2026, 9, 23); // a Wednesday; its week starts Mon Sep 21

// ---- the reading ---------------------------------------------------------
{
  const kpis = { coverageRatio: { actual: 1.78, goal: 3.21, pipelineActual: 2_358_500, target: 1_325_000 } };
  check('a reading carries the ratio and what it divides', coverageReading(kpis),
    { ratio: 1.78, goal: 3.21, pipeline: 2_358_500, target: 1_325_000 });
  check('no ratio, no reading', coverageReading({ coverageRatio: { actual: null, goal: 3 } }), null);
  check('no KPIs at all, no reading', coverageReading(null), null);
  check('a missing goal is null, not 0',
    coverageReading({ coverageRatio: { actual: 2 } }).goal, null);
}

// ---- the log -------------------------------------------------------------
{
  check('weeks are keyed by their Monday', weekKeyAt(REF), '2026-09-21');
  check('a late-Monday timestamp still lands on that Monday', weekKeyAt(at(2026, 9, 21, 23)), '2026-09-21');

  const r = { ratio: 2, goal: 3, pipeline: 200, target: 100 };
  const log = withCoverageReading({}, '2026-09-21', r, { at: 5 });
  check('a reading is recorded with its time', log['2026-09-21'], { ...r, at: 5 });

  const later = withCoverageReading(log, '2026-09-21', { ...r, ratio: 2.2 }, { at: 9 });
  check('the latest reading in a week wins', later['2026-09-21'].ratio, 2.2);
  check('an unchanged reading returns the same log', withCoverageReading(log, '2026-09-21', r, { at: 9 }) === log, true);
  check('onlyIfMissing leaves a measured week alone',
    withCoverageReading(log, '2026-09-21', { ...r, ratio: 9 }, { onlyIfMissing: true }) === log, true);
  check('onlyIfMissing fills an empty week',
    withCoverageReading(log, '2026-09-14', r, { onlyIfMissing: true })['2026-09-14'].ratio, 2);
  check('a null reading changes nothing', withCoverageReading(log, '2026-09-28', null) === log, true);
  check('sameReading ignores the timestamp', sameReading(log['2026-09-21'], r), true);
  check('sameReading notices a moved goal', sameReading(log['2026-09-21'], { ...r, goal: 4 }), false);

  // Three years is the cap; the oldest weeks go first.
  let big = {};
  for (let i = 0; i < 160; i++) {
    big = withCoverageReading(big, `2020-01-${String(i).padStart(3, '0')}`, { ratio: i + 1 });
  }
  const keys = Object.keys(big).sort();
  check('the log is capped', keys.length, 156);
  check('and keeps the newest', keys[keys.length - 1], '2020-01-159');
}

// ---- the series ----------------------------------------------------------
{
  const log = {
    '2026-08-31': { ratio: 1.5, goal: 3 },
    '2026-09-07': { ratio: 1.456, goal: 3 },
    '2026-09-21': { ratio: 1.9, goal: 3.25 },
  };
  const s = coverageRatioByWeek({ log, refMs: REF });
  check('eight weeks by default', s.points.length, COVERAGE_RATIO_WEEKS);
  check('oldest first, ending on the week of the ref date',
    [s.points[0].key, s.points[7].key], ['2026-08-03', '2026-09-21']);
  check('a week with no reading is null, not 0', s.points[6].value, null);
  check('ratios keep two decimals', s.points[5].value, 1.46);
  check('the goal is the latest one recorded', s.goal, 3.25);
  check('the note runs from the first reading to the last', s.note,
    'Up 0.40× since Aug 31, from 1.50× to 1.90×.');
  check('a series with no readings in the window is null',
    coverageRatioByWeek({ log: { '2025-01-06': { ratio: 2 } }, refMs: REF }), null);
  check('an empty log is null', coverageRatioByWeek({ log: {}, refMs: REF }), null);
  check('a single reading has no movement to report',
    coverageRatioByWeek({ log: { '2026-09-21': { ratio: 2 } }, refMs: REF }).note, '');
  check('a falling ratio says so',
    coverageRatioByWeek({ log: { '2026-09-14': { ratio: 2 }, '2026-09-21': { ratio: 1.75 } }, refMs: REF }).note,
    'Down 0.25× since Sep 14, from 2.00× to 1.75×.');
}

// ---- through the snapshot ------------------------------------------------
{
  const series = coverageRatioByWeek({
    log: { '2026-09-14': { ratio: 1.5, goal: 3 }, '2026-09-21': { ratio: 1.9, goal: 3 } },
    refMs: REF,
  });
  const payload = emailSnapshotPayload({ coverageRatio: series });
  check('the payload carries the series', payload.coverageRatio.points.length, 8);
  check('an empty series is dropped from the payload', emailSnapshotPayload({ coverageRatio: null }).coverageRatio, null);

  const doc = buildSnapshotDoc(payload, { uid: 'u' });
  check('the stored snapshot keeps the points', doc.coverageRatio.points.map(p => p.value),
    [null, null, null, null, null, null, 1.5, 1.9]);
  check('and the goal', doc.coverageRatio.goal, 3);
  const junk = buildSnapshotDoc({ coverageRatio: { points: [
    { label: 'a', value: 'x' }, { label: 'b', value: -4 }, { label: 'c', value: 1e9 },
  ] } }, {});
  check('garbage values are blank or clamped', junk.coverageRatio.points.map(p => p.value), [null, 0, 100]);
  check('a stored series with no readings is dropped',
    buildSnapshotDoc({ coverageRatio: { points: [{ label: 'a', value: null }] } }, {}).coverageRatio, null);

  // ---- into the email ----------------------------------------------------
  const html = renderWeeklyReportHtml(doc);
  check('the email has the section', html.includes('Coverage ratio by week'), true);
  check('with the span it covers', html.includes('Last 8 weeks, open pipeline ÷ annual target'), true);
  check('each reading is printed', html.includes('1.90×') && html.includes('1.50×'), true);
  check('the goal is the end of the track while no week has reached it',
    html.includes('A full bar is the 3.00× goal.'), true);
  const past = coverageRatioHtml({ goal: 1.5, points: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] });
  check('a week past the goal ends the track instead', past.includes('Goal 1.50×.'), true);
  check('and the track is not painted as if it were the goal', past.includes('#EDF1F6'), false);
  check('unmeasured weeks are explained', html.includes('- marks a week with no reading'), true);
  check('the bars are pixel tracks Outlook can hold', /width="480"/.test(html), true);
  check('and drop on a phone', html.includes('class="cbar" width="480"'), true);
  check('it sits under the KPI row',
    html.indexOf('Where the year stands') < html.indexOf('Coverage ratio by week'), true);
  check('no section without readings', renderWeeklyReportHtml({}).includes('Coverage ratio by week'), false);
  check('the card alone is empty with nothing to draw', coverageRatioHtml(null), '');
  check('nothing in it is an em dash', /—/.test(coverageRatioHtml(doc.coverageRatio)), false);
}

// ---- the line chart ------------------------------------------------------
{
  const series = coverageRatioByWeek({
    log: { '2026-08-31': { ratio: 1.4, goal: 3.21 }, '2026-09-14': { ratio: 1.5, goal: 3.21 }, '2026-09-21': { ratio: 1.68, goal: 3.21 } },
    refMs: REF,
  });
  const img = coverageRatioChartImage(series);
  check('the series is drawn as a PNG', /^data:image\/png;base64,/.test(img.src), true);
  check('laid out at the chart size', [img.width, img.height], [RATIO_CHART_W, RATIO_CHART_H]);
  check('within the budget the snapshot allows', img.src.length < MAX_COVERAGE_IMAGE_CHARS, true);
  check('the alt text says where it stands', img.alt.includes('1.68x') && img.alt.includes('3.21x goal'), true);
  check('one reading is still drawn',
    !!coverageRatioChartImage({ points: [{ label: 'a', value: null }, { label: 'b', value: 1.2 }] }), true);
  check('no readings is no picture', coverageRatioChartImage({ points: [{ label: 'a', value: null }] }), null);
  check('no series is no picture', coverageRatioChartImage(null), null);

  // The picture survives the payload and the stored snapshot, and becomes
  // an attachment for a sent message.
  const payload = emailSnapshotPayload({ coverageRatio: withCoverageRatioImage(series) });
  const doc = buildSnapshotDoc(payload, { uid: 'u' });
  check('the stored snapshot keeps the picture', doc.coverageRatio.image?.src, img.src);
  check('a picture that is not a PNG is dropped',
    buildSnapshotDoc({ coverageRatio: { ...series, image: { src: 'javascript:x', width: 1, height: 1 } } }, {}).coverageRatio.image, null);
  const att = coverageRatioAttachment(doc);
  check('it travels as an inline attachment', [att.cid, att.contentType], ['weekly-report-coverage-ratio@prospect-tracker', 'image/png']);
  check('no picture, no attachment', coverageRatioAttachment({ coverageRatio: { points: [] } }), null);

  // With a src the card is the line chart; without one it is the bars.
  const drawn = renderWeeklyReportHtml(doc, { coverageRatioImageSrc: 'cid:ratio@x' });
  check('the card draws the line chart', /<img src="cid:ratio@x" width="720" height="160"/.test(drawn), true);
  check('and drops the bars', drawn.includes('class="cbar" width="480"'), false);
  check('the latest reading and the goal are text under it',
    drawn.includes('Week of Sep 21') && drawn.includes('1.68×') && drawn.includes('3.21×'), true);
  check('joined-across weeks are explained', drawn.includes('Weeks with no reading are joined across'), true);
  check('no src falls back to the bars', renderWeeklyReportHtml(doc).includes('class="cbar" width="480"'), true);
  check('nothing in the chart card is an em dash', /—/.test(coverageRatioHtml(doc.coverageRatio, 'cid:x')), false);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
