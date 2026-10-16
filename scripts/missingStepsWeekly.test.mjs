// The All Missing Steps line in the Weekly Report email. Plain Node, no
// framework. Run:
//   node scripts/missingStepsWeekly.test.mjs
//
// Pins the series read off My Accounts > All Missing History, how it
// survives the stored snapshot, and how it lands in the email.
import { missingStepsTrend, withMissingStepsImage, missingDayLabel, MISSING_CHART_W } from '../src/utils/missingStepsTrend.js';
import { emailSnapshotPayload } from '../src/utils/weeklyReportEmailSnapshot.js';
import { buildSnapshotDoc } from '../api/_lib/weeklyReportSnapshot.js';
import { renderWeeklyReportHtml, missingStepsHtml } from '../api/_lib/weeklyReportEmailHtml.js';
import { missingStepsAttachment } from '../api/_lib/weeklyReportEmail.js';
import { buildReportPayload, payloadHasFigures } from '../api/_lib/weeklyReportBuild.js';

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${a}\n      want: ${e}`}`);
}

const END = new Date(2026, 9, 19, 0, 0).getTime(); // the week ends Sun Oct 18, local midnight
const history = {
  '2026-08-01': { total: 9000, companies: 120, basis: 'steps' },  // before the window
  '2026-10-13': { total: 3700, companies: 139, basis: 'steps', seeded: true },
  '2026-10-14': { total: 3684, companies: 139, basis: 'steps' },
  '2026-10-15': { total: 3690, companies: 139 },                   // old basis: not charted
  '2026-10-16': { total: 2370, companies: 139, basis: 'steps' },
  '2026-10-20': { total: 2000, companies: 139, basis: 'steps' },  // after the period
};

{
  const t = missingStepsTrend(history, { endMs: END });
  check('points: steps days inside the window, oldest first',
    t.points.map(p => [p.key, p.label, p.value]),
    [['2026-10-13', 'Oct 13', 3700], ['2026-10-14', 'Oct 14', 3684], ['2026-10-16', 'Oct 16', 2370]]);
  check('latest and companies', [t.latest, t.companies], [2370, 139]);
  check('with no baseline, measured from the first day on record',
    [t.sinceLabel, t.delta, t.sinceBaseline], ['Aug 1', 2370 - 9000, false]);
  const based = missingStepsTrend({ ...history, '2026-10-14': { ...history['2026-10-14'], baseline: true } }, { endMs: END });
  check('a frozen baseline is what it is measured against', [based.sinceLabel, based.delta, based.sinceBaseline], ['Oct 14', -1314, true]);
  check('nothing recorded in the window is null', missingStepsTrend(history, { endMs: new Date(2026, 6, 1).getTime() }), null);
  check('garbage in is null', missingStepsTrend('nope'), null);
  const one = missingStepsTrend({ '2026-10-16': { total: 5, companies: 1, basis: 'steps' } }, { endMs: END });
  check('one day alone has no move to report', [one.points.length, one.delta, one.sinceLabel], [1, null, '']);
  check('day label', missingDayLabel('2026-01-05'), 'Jan 5');
}

{
  const t = withMissingStepsImage(missingStepsTrend(history, { endMs: END }));
  check('drawn as a PNG at the laid-out size', [t.image.src.startsWith('data:image/png;base64,'), t.image.width], [true, MISSING_CHART_W]);
  const one = withMissingStepsImage(missingStepsTrend({ '2026-10-16': { total: 5, basis: 'steps' } }, { endMs: END }));
  check('one day still draws', !!one.image, true);

  const doc = buildSnapshotDoc(emailSnapshotPayload({ missingSteps: t }), { uid: 'u' });
  check('survives the stored snapshot', [doc.missingSteps.points.length, doc.missingSteps.latest, doc.missingSteps.delta, !!doc.missingSteps.image], [3, 2370, -6630, true]);
  check('a bad picture is dropped, the points kept',
    !!buildSnapshotDoc({ missingSteps: { ...t, image: { src: 'javascript:1', width: 1, height: 1 } } }).missingSteps.image, false);
  check('no series, no section', buildSnapshotDoc(emailSnapshotPayload({})).missingSteps, null);

  const html = renderWeeklyReportHtml(doc, { missingStepsImageSrc: 'cid:x' });
  check('the email carries the section, picture and headline',
    [html.includes('All missing steps'), html.includes('src="cid:x"'), html.includes('2,370'), html.includes('across 139 companies')], [true, true, true, true]);
  const bare = missingStepsHtml(doc.missingSteps, '');
  check('without the picture, the days as rows', [bare.includes('<img'), bare.includes('3,684')], [false, true]);
  check('nothing in it is an em dash', /—/.test(html.slice(html.indexOf('All missing steps'))), false);
  check('attached for the sent message', missingStepsAttachment(doc)?.filename, 'all-missing-steps.png');
  check('no picture, no attachment', missingStepsAttachment({}), null);
}

{
  const period = { start: END - 7 * 86400000, end: END, scope: 'week', label: 'wk' };
  const payload = buildReportPayload({ missingHistory: history }, period);
  check('the scheduled build reads the mirrored history', payload.missingSteps?.points?.length, 3);
  check('and counts it as something to send', payloadHasFigures({ missingSteps: payload.missingSteps }), true);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
