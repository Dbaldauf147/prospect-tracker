// Tier 3 rides along on the Weekly Report email's two account-coverage
// charts: in the series, the summary line, the snapshot the cron stores,
// and both ways the card is drawn (picture + legend, or the bar table).
//
// Run: node scripts/coverageTier3.test.mjs
import { coverageByWeek } from '../src/utils/weeklyReportTrends.js';
import { withCoverageImages } from '../src/utils/coverageChartImage.js';
import { coverageHtml } from '../api/_lib/weeklyReportEmailHtml.js';
import { buildSnapshotDoc } from '../api/_lib/weeklyReportSnapshot.js';

let passed = 0, failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n  expected ${e}\n  actual   ${a}`); }
}

const refMs = new Date(2026, 9, 12, 12).getTime();
const monday = (weeksAgo) => {
  const d = new Date(refMs - weeksAgo * 7 * 86400000);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const progressWeeks = [
  { week: monday(1), t1ContactPct: 60, t2ContactPct: 40, t3ContactPct: 10, t1DMPct: 30, t2DMPct: 20, t3DMPct: 5 },
  { week: monday(0), t1ContactPct: 62, t2ContactPct: 45, t3ContactPct: 18, t1DMPct: 31, t2DMPct: 22, t3DMPct: 9 },
];
const cov = withCoverageImages(coverageByWeek({ progressWeeks, refMs, weeks: 4 }));
const contact = cov.charts.find(c => c.id === 'contactPct');
check('points carry Tier 3', contact.points.map(p => p.t3), [10, 18]);
check('summary names Tier 3', /Tier 3 \+8 pts to 18%/.test(contact.note), true);
check('chart drawn', Boolean(contact.image?.src), true);

const onlyT3 = coverageByWeek({ progressWeeks: [{ week: monday(0), t3ContactPct: 12 }], refMs, weeks: 4 });
check('a chart with only Tier 3 readings still shows', onlyT3?.charts?.[0]?.points?.[0]?.t3, 12);

const withPic = coverageHtml(cov, { contactPct: contact.image.src, dmPct: cov.charts[1].image.src });
check('legend under the picture has Tier 3 and its figure', /Tier 3<\/td>\s*<td[^>]*>18%/.test(withPic), true);
const table = coverageHtml(cov, {});
check('bar table heads a Tier 3 column', table.includes('>Tier 3</td>'), true);
check('bar table shows the Tier 3 figure', table.includes('>18%</td>'), true);

const stored = buildSnapshotDoc({ coverage: cov }, { uid: 'u' }).coverage;
check('stored snapshot keeps Tier 3', stored.charts[0].points.map(p => p.t3), [10, 18]);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
