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

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

// A snapshot shaped like buildReviewSnapshot's output, with only the fields
// headlineKpis reads. Overrides merge shallowly per section.
function snap({ ytd = {}, quota = {}, coverage = {}, totals = {}, hasBfo = true, noYoy = false, noPipeline = false } = {}) {
  return {
    yoy: noYoy ? null : {
      ytd: {
        amount: 1_200_000, deals: 8, target: 3_000_000,
        onPaceAmount: 2_000_000, runRateFullYear: 1_800_000, yearElapsedPct: 66.7,
        ...ytd,
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
{
  const k = headlineKpis(snap());
  check('projected: the run rate lands the year', k.projectedYearEnd.amount, 1_800_000);
  check('projected: 1.2M under a 3M target', k.projectedYearEnd.gap, -1_200_000);
  check('projected: short of target', k.projectedYearEnd.status, 'behind');
}
{
  const k = headlineKpis(snap({ ytd: { runRateFullYear: 3_400_000 } }));
  check('projected: run rate clears target', k.projectedYearEnd.status, 'ahead');
  check('projected: 400K surplus', k.projectedYearEnd.gap, 400_000);
}
{
  // No Opps 2 cache: nothing to run-rate. The Pipeline dashboard's Closed
  // YTD is a total, not a rate, so it must not be projected forward.
  const k = headlineKpis(snap({ noYoy: true }));
  check('projected: no Opps data → no projection', k.projectedYearEnd.amount, null);
  check('projected: no Opps data → no gap', k.projectedYearEnd.gap, null);
  check('projected: no Opps data → no verdict', k.projectedYearEnd.status, null);
}
{
  const k = headlineKpis(snap({ quota: { target: 0 }, ytd: { target: 0 } }));
  check('projected: no target → amount still projected', k.projectedYearEnd.amount, 1_800_000);
  check('projected: no target → nothing to compare against', k.projectedYearEnd.gap, null);
  check('projected: no target → no verdict', k.projectedYearEnd.status, null);
}

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
  // Half a year in at 400K → ~800K for the year, short of 1M.
  check('real snapshot: run rate short of target', k.projectedYearEnd.status, 'behind');
  // No BFO paste, so the stage's hand-entered pipelineActual is what
  // coverage divides — 2M over a 1M target.
  check('real snapshot: coverage from hand-entered actuals', k.coverageRatio.actual, 2);
  check('real snapshot: coverage flagged as not live', k.coverageRatio.live, false);
}

console.log(failures === 0 ? '\nAll headlineKpis tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
