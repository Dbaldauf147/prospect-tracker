// Assertion tests for headlineKpis — the three numbers the Weekly Report
// leads with (progress to target, coverage ratio, projected year-end sales).
// Plain Node — no test framework (the project has none). Run:
//   node scripts/weeklyReportKpis.test.mjs
//
// The point of pinning these is that all three are quotients with a
// partially-cached denominator. The Pipeline dashboard, BFO Activity and
// Opps 2 each seed a different piece, and any of them can be missing —
// so most of what's guarded here is the difference between "no answer"
// (null, which the card renders as an em dash plus what to open) and a
// real zero. A coverage ratio of 0.00× is a claim about the pipeline;
// a blank one is a claim about the cache, and they must not swap.
import { headlineKpis, buildReviewSnapshot } from '../src/utils/weeklyReview.js';
import { annualSalesProjection } from '../src/utils/oppsMetrics.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

// A snapshot shaped like buildReviewSnapshot's output, with only the fields
// headlineKpis reads. Overrides merge shallowly per section.
function snap({ ytd = {}, quota = {}, coverage = {}, totals = {}, projection = {}, noProjection = false, hasBfo = true, noYoy = false, noPipeline = false } = {}) {
  return {
    yoy: noYoy ? null : {
      ytd: {
        amount: 1_200_000, deals: 8, target: 3_000_000,
        onPaceAmount: 2_000_000, runRateFullYear: 1_800_000, yearElapsedPct: 66.7,
        ...ytd,
      },
      projection: noProjection ? null : {
        currentYear: 2026, currentClient: 400_000, newClient: 1_700_000,
        amount: 2_100_000, soldYTD: 1_200_000, lateStageAmount: 900_000,
        overridden: false, deals: [],
        ...projection,
      },
    },
    pipeline: noPipeline ? null : {
      hasBfo,
      quota: { target: 3_000_000, closedYTD: 900_000, pctOfQuota: 30, ...quota },
      coverage: { goal: 3.21, actual: 2.74, ...coverage },
      totals: { pipelineActual: 8_220_000, ...totals },
    },
  };
}

// ---- Progress to target --------------------------------------------------
// Sold YTD ÷ annual target, and the verdict against a straight-line year.
{
  const k = headlineKpis(snap());
  check('progress: 1.2M of 3M → 40.0%', k.progressToTarget.pct, 40);
  check('progress: sold YTD is the Opps figure, not Closed YTD',
    k.progressToTarget.soldYTD, 1_200_000);
  check('progress: 800K behind a 2M pace', k.progressToTarget.paceDelta, -800_000);
  check('progress: behind pace', k.progressToTarget.status, 'behind');
  check('progress: 1.8M still to sell', k.progressToTarget.gapToTarget, 1_800_000);
}
{
  const k = headlineKpis(snap({ ytd: { amount: 2_400_000 } }));
  check('progress: past the pace line → ahead', k.progressToTarget.status, 'ahead');
  check('progress: +400K against pace', k.progressToTarget.paceDelta, 400_000);
}
{
  // Exactly on pace counts as ahead — "behind" should mean behind.
  const k = headlineKpis(snap({ ytd: { amount: 2_000_000 } }));
  check('progress: dead on pace → ahead', k.progressToTarget.status, 'ahead');
  check('progress: dead on pace → zero delta', k.progressToTarget.paceDelta, 0);
}

// A target of 0 is the un-set Pipeline dashboard, not a target you have
// already beaten: no percentage, and no verdict either way.
{
  const k = headlineKpis(snap({ quota: { target: 0 }, ytd: { target: 0, onPaceAmount: 0 } }));
  check('progress: no target → no percentage', k.progressToTarget.pct, null);
  check('progress: no target → no gap', k.progressToTarget.gapToTarget, null);
  check('progress: no target → target null not 0', k.progressToTarget.target, null);
}

// Without Opps 2 cached the hand-entered Closed YTD still answers the
// question, just without the pace comparison that needs the year fraction.
{
  const k = headlineKpis(snap({ noYoy: true }));
  check('progress: falls back to Closed YTD', k.progressToTarget.soldYTD, 900_000);
  check('progress: fallback still gives a percentage', k.progressToTarget.pct, 30);
  check('progress: fallback has no pace to compare', k.progressToTarget.paceDelta, null);
  check('progress: fallback has no verdict', k.progressToTarget.status, null);
}

// ---- Coverage ratio ------------------------------------------------------
{
  const k = headlineKpis(snap());
  check('coverage: reads the pipeline actual', k.coverageRatio.actual, 2.74);
  check('coverage: 2.74 under a 3.21 goal', k.coverageRatio.status, 'behind');
  check('coverage: carries the numerator', k.coverageRatio.pipelineActual, 8_220_000);
  check('coverage: live off BFO', k.coverageRatio.live, true);
}
{
  const k = headlineKpis(snap({ coverage: { actual: 3.21 } }));
  check('coverage: exactly at goal → at goal', k.coverageRatio.status, 'ahead');
}

// The distinction the strict null check exists for: no BFO paste means the
// ratio is unknown, and must not read as a pipeline of zero.
{
  const k = headlineKpis(snap({ hasBfo: false, coverage: { actual: null }, totals: { pipelineActual: null } }));
  check('coverage: no BFO → unknown, not 0.00', k.coverageRatio.actual, null);
  check('coverage: no BFO → no numerator', k.coverageRatio.pipelineActual, null);
  check('coverage: no BFO → no verdict', k.coverageRatio.status, null);
  check('coverage: no BFO → flagged as not live', k.coverageRatio.live, false);
  check('coverage: goal survives without an actual', k.coverageRatio.goal, 3.21);
}
{
  // A genuinely empty pipeline IS a 0.00× coverage ratio, and a bad one.
  const k = headlineKpis(snap({ coverage: { actual: 0 }, totals: { pipelineActual: 0 } }));
  check('coverage: empty pipeline → 0, not blank', k.coverageRatio.actual, 0);
  check('coverage: empty pipeline → behind', k.coverageRatio.status, 'behind');
}
{
  const k = headlineKpis(snap({ coverage: { goal: null } }));
  check('coverage: no goal → number but no verdict', k.coverageRatio.status, null);
  check('coverage: no goal → actual still shown', k.coverageRatio.actual, 2.74);
}

// ---- Projected year-end sales -------------------------------------------
// The tile plots the YOY Annual Sales chart's "Projected" bar — sold this
// year plus the agreements already out — NOT the run rate. The two are
// different questions and give different answers, and the tile quoting the
// run rate while the chart quoted the commitment is the bug this replaced.
{
  const k = headlineKpis(snap());
  check('projected: the chart figure, not the run rate',
    k.projectedYearEnd.amount, 2_100_000);
  check('projected: run rate is carried, but is not the headline',
    k.projectedYearEnd.runRateFullYear, 1_800_000);
  check('projected: shows the sold half', k.projectedYearEnd.soldYTD, 1_200_000);
  check('projected: shows the committed half', k.projectedYearEnd.committedAmount, 900_000);
  check('projected: 900K under a 3M target', k.projectedYearEnd.gap, -900_000);
  check('projected: short of target', k.projectedYearEnd.status, 'behind');
}
{
  const k = headlineKpis(snap({ projection: { amount: 3_400_000 } }));
  check('projected: commitment clears target', k.projectedYearEnd.status, 'ahead');
  check('projected: 400K surplus', k.projectedYearEnd.gap, 400_000);
}
{
  // No Opps 2 cache: nothing to project from. The Pipeline dashboard's
  // Closed YTD is a total, not a forecast, so it must not stand in.
  const k = headlineKpis(snap({ noYoy: true }));
  check('projected: no Opps data → no projection', k.projectedYearEnd.amount, null);
  check('projected: no Opps data → no gap', k.projectedYearEnd.gap, null);
  check('projected: no Opps data → no verdict', k.projectedYearEnd.status, null);
}
{
  const k = headlineKpis(snap({ noProjection: true }));
  check('projected: no projection section → no figure', k.projectedYearEnd.amount, null);
  check('projected: no projection section → no verdict', k.projectedYearEnd.status, null);
}
{
  const k = headlineKpis(snap({ quota: { target: 0 }, ytd: { target: 0 } }));
  check('projected: no target → figure still shown', k.projectedYearEnd.amount, 2_100_000);
  check('projected: no target → nothing to compare against', k.projectedYearEnd.gap, null);
  check('projected: no target → no verdict', k.projectedYearEnd.status, null);
}
{
  const k = headlineKpis(snap({ projection: { overridden: true } }));
  check('projected: a pinned chart value is flagged as pinned',
    k.projectedYearEnd.overridden, true);
}

// ---- annualSalesProjection ----------------------------------------------
// The shared definition the YOY chart and the tile both read. These are the
// rules that decide which rows count, and they are the whole reason the two
// numbers used to differ.
const NOW = new Date(2026, 8, 2).getTime(); // Sep 2, 2026
const proj = (records) => annualSalesProjection(records, { nowMs: NOW });
const row = (over) => ({ 'Lead Source': 'Cold call', 'Quoted Amount': '$100,000', ...over });

{
  // The reported case, to the dollar: $484K sold + $315K out for signature
  // reads $799K, where annualizing the pace would have said ~$724K.
  const p = proj([
    row({ Stage: 'Sold', 'Close Date': '3/1/2026', 'Quoted Amount': '$484,000' }),
    row({ Stage: 'Agreement Sent', 'Open Year': '2026', 'Quoted Amount': '$200,000' }),
    row({ Stage: 'Contracting', 'Open Year': '2026', 'Quoted Amount': '$115,000' }),
  ]);
  check('projection: sold + agreements out', p.amount, 799_000);
  check('projection: sold half', p.soldYTD, 484_000);
  check('projection: committed half', p.lateStageAmount, 315_000);
}

// Which stages count. Everything mid-funnel is excluded — the bar is what
// is committed, not what is hoped for.
check('projection: Agreement Sent counts',
  proj([row({ Stage: 'Agreement Sent', 'Open Year': '2026' })]).amount, 100_000);
check('projection: Contracting counts',
  proj([row({ Stage: 'Contracting', 'Open Year': '2026' })]).amount, 100_000);
check('projection: Quoted does not count',
  proj([row({ Stage: 'Quoted', 'Open Year': '2026' })]).amount, 0);
check('projection: Not Sold does not count',
  proj([row({ Stage: 'Not Sold', 'Open Year': '2026' })]).amount, 0);

// Sold is year-scoped; open commitments are not, because an agreement out
// today lands this year whichever year the opp was opened.
check('projection: this year\u2019s Sold counts',
  proj([row({ Stage: 'Sold', 'Close Date': '2/1/2026' })]).amount, 100_000);
check('projection: last year\u2019s Sold does not',
  proj([row({ Stage: 'Sold', 'Close Date': '2/1/2025' })]).amount, 0);
check('projection: Sold with no close date falls back to Open Year',
  proj([row({ Stage: 'Sold', 'Open Year': '2026' })]).amount, 100_000);
check('projection: an old opp still in Contracting counts',
  proj([row({ Stage: 'Contracting', 'Open Year': '2023' })]).amount, 100_000);

// A Sold opp is counted once. Before this was shared, the two branches of
// the loop were the place a double-count could hide.
{
  const p = proj([row({ Stage: 'Sold', 'Close Date': '4/1/2026', 'Quoted Amount': '$250,000' })]);
  check('projection: Sold counted once, not in both halves', p.amount, 250_000);
  check('projection: Sold does not land in the committed half', p.lateStageAmount, 0);
}

// Unpriced rows contribute nothing and are kept out of the drilldown.
check('projection: a $0 opp adds nothing',
  proj([row({ Stage: 'Agreement Sent', 'Open Year': '2026', 'Quoted Amount': '$0' })]).amount, 0);
check('projection: an unparseable amount adds nothing',
  proj([row({ Stage: 'Agreement Sent', 'Open Year': '2026', 'Quoted Amount': '-' })]).amount, 0);

// The client / new-business split the chart stacks its bars by.
{
  const p = proj([
    row({ Stage: 'Sold', 'Close Date': '3/1/2026', 'Lead Source': 'Existing client' }),
    row({ Stage: 'Sold', 'Close Date': '3/1/2026', 'Lead Source': 'Renewal' }),
    row({ Stage: 'Sold', 'Close Date': '3/1/2026', 'Lead Source': 'Cold call' }),
  ]);
  check('projection: client sources bucket together', p.currentClient, 200_000);
  check('projection: everything else is new business', p.newClient, 100_000);
  check('projection: the split sums to the total', p.currentClient + p.newClient, p.amount);
}

// `deals` only materializes for the chart, which passes a row-builder.
check('projection: no drilldown rows without a builder', proj([
  row({ Stage: 'Contracting', 'Open Year': '2026' }),
]).deals.length, 0);
check('projection: drilldown rows built when asked', annualSalesProjection([
  row({ Stage: 'Contracting', 'Open Year': '2026' }),
], { nowMs: NOW, dealFor: (r, y, src, amt) => ({ Year: y, src, amt }) }).deals.length, 1);

// ---- Chart overrides -----------------------------------------------------
// The YOY charts let a value be pinned onto a data point. A pin on the
// Annual Sales Projected bar has to reach the tile, or the two disagree
// again — by exactly the amount the user corrected.
const OPPS_FOR_OVERRIDE = [
  row({ Stage: 'Sold', 'Close Date': '3/1/2026', 'Quoted Amount': '$484,000' }),
  row({ Stage: 'Agreement Sent', 'Open Year': '2026', 'Quoted Amount': '$315,000' }),
];
const withOverride = (yoyOverrides) => headlineKpis(buildReviewSnapshot({
  pipeline: { target: 1_325_000, stages: [] },
  oppsRecords: OPPS_FOR_OVERRIDE,
  yoyOverrides,
  now: new Date(NOW),
})).projectedYearEnd;

check('override: none → the computed figure', withOverride(null).amount, 799_000);
check('override: none → not flagged as pinned', withOverride(null).overridden, false);
check('override: a pinned Total wins outright',
  withOverride({ annualSales: { Projected: { _total: 900_000 } } }).amount, 900_000);
check('override: a pinned Total is flagged',
  withOverride({ annualSales: { Projected: { _total: 900_000 } } }).overridden, true);
// Matching the chart's own recompute(): with no Total pinned, the total is
// the sum of the segments, so pinning one segment moves it.
check('override: a pinned segment re-totals the rest',
  withOverride({ annualSales: { Projected: { currentClient: 100_000 } } }).amount, 899_000);
check('override: a pinned Total beats a pinned segment',
  withOverride({ annualSales: { Projected: { _total: 500_000, newClient: 1_000_000 } } }).amount, 500_000);
// Junk in the store must not blank the tile.
check('override: a non-numeric pin is ignored',
  withOverride({ annualSales: { Projected: { _total: 'lots' } } }).amount, 799_000);
check('override: an empty patch is ignored',
  withOverride({ annualSales: { Projected: {} } }).amount, 799_000);
check('override: another chart\u2019s pin is ignored',
  withOverride({ leads: { Projected: { count: 5 } } }).amount, 799_000);
check('override: a pin on a real year is not a pin on Projected',
  withOverride({ annualSales: { 2026: { _total: 12 } } }).amount, 799_000);

// ---- Nothing cached ------------------------------------------------------
// The cold-start case. Every figure is null and nothing claims a verdict,
// so the section can render its "open Charts → Pipeline" hint instead.
{
  const k = headlineKpis(snap({ noYoy: true, noPipeline: true }));
  check('empty: no target', k.target, null);
  check('empty: no progress', k.progressToTarget.pct, null);
  check('empty: no coverage', k.coverageRatio.actual, null);
  check('empty: no projection', k.projectedYearEnd.amount, null);
  check('empty: no progress verdict', k.progressToTarget.status, null);
  check('empty: no coverage verdict', k.coverageRatio.status, null);
  check('empty: no projection verdict', k.projectedYearEnd.status, null);
}
check('no snapshot at all → no crash', headlineKpis(undefined).progressToTarget.pct, null);
check('null snapshot → no crash', headlineKpis(null).coverageRatio.actual, null);

// ---- Against a real buildReviewSnapshot ----------------------------------
// The shapes above are hand-written; this pins them to what the snapshot
// builder actually emits, so a field rename can't leave the tests green.
{
  const now = new Date(2026, 6, 2); // ~50% through 2026
  const snapshot = buildReviewSnapshot({
    pipeline: {
      target: 1_000_000,
      closedYTD: 100_000,
      coverageGoal: 3,
      stages: [
        { key: 'stage3', label: 'Stage 3', activeGoal: 10, dealSizeGoal: 50_000, closeGoal: 0.5, pipelineActual: 2_000_000 },
      ],
    },
    bfo: null,
    oppsRecords: [
      { Stage: 'Sold', 'Open Year': '2026', 'Close Date': '3/15/2026', 'Quoted Amount': '$400,000' },
    ],
    progressWeeks: [],
    now,
  });
  const k = headlineKpis(snapshot);
  check('real snapshot: target read off the dashboard', k.target, 1_000_000);
  check('real snapshot: 400K of 1M sold', k.progressToTarget.pct, 40);
  check('real snapshot: Opps total beats the typed Closed YTD',
    k.progressToTarget.soldYTD, 400_000);
  // The only Sold deal is this year's 400K and nothing is out for
  // signature, so the projection is that 400K — short of 1M.
  check('real snapshot: projection is the committed 400K', k.projectedYearEnd.amount, 400_000);
  check('real snapshot: projection short of target', k.projectedYearEnd.status, 'behind');
  // No BFO paste, so the stage's hand-entered pipelineActual is what
  // coverage divides — 2M over a 1M target.
  check('real snapshot: coverage from hand-entered actuals', k.coverageRatio.actual, 2);
  check('real snapshot: coverage flagged as not live', k.coverageRatio.live, false);
}

console.log(failures === 0 ? '\nAll headlineKpis tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
