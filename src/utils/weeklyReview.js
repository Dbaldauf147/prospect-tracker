// Weekly review snapshot — the deterministic read of the three chart tabs
// (YOY, Pipeline, Progress) that the "what's holding me back" review is
// written over.
//
// Everything here is pure. The caller passes the already-loaded blobs:
//   pipeline      — the pipeline-dashboard IndexedDB record (goals + manual actuals)
//   bfo           — the bfo-activity record (live stage actuals)
//   oppsRecords   — Opps 2 rows (YOY history + today's open pipeline)
//   progressWeeks — the progressHistory week snapshots from Firestore
//
// The numbers are computed here rather than read off the charts so the review
// works from whatever data is cached, without the user having to open each
// tab first. Anything missing is reported as missing rather than guessed.

import { bfoStageMetrics } from './bfoStageMetrics.js';
import { yoyReviewMetrics } from './oppsMetrics.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Monday-of-week ISO key ("YYYY-MM-DD"). Matches the Progress tab's week
// keys so a review row lines up with the progress snapshot it reviewed.
export function weekKeyOf(dateLike = new Date()) {
  const d = dateLike instanceof Date ? new Date(dateLike) : new Date(String(dateLike));
  if (Number.isNaN(d.getTime())) return weekKeyOf(new Date());
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0 = Sun … 6 = Sat
  d.setTime(d.getTime() - ((dow + 6) % 7) * DAY_MS);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// "Mon Aug 3 – Sun Aug 9, 2026" for a Monday week key.
export function weekRangeLabel(weekKey) {
  const [y, m, d] = String(weekKey || '').split('-').map(n => parseInt(n, 10));
  if (!y || !m || !d) return String(weekKey || '');
  const start = new Date(y, m - 1, d);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const fmt = (dt, withYear) => dt.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}),
  });
  return `${fmt(start, false)} – ${fmt(end, true)}`;
}

// The Progress-tab series worth reviewing, with the direction that counts as
// improvement. Keys match the fields ProgressView writes into each weekly
// snapshot; a key the snapshot doesn't carry is skipped rather than reported
// as zero.
const PROGRESS_SERIES = [
  { key: 't1ContactPct', label: 'Tier 1 accounts with HubSpot contacts', unit: '%', dir: 'up' },
  { key: 't2ContactPct', label: 'Tier 2 accounts with HubSpot contacts', unit: '%', dir: 'up' },
  { key: 't1DMPct', label: 'Tier 1 accounts with a decision maker identified', unit: '%', dir: 'up' },
  { key: 't2DMPct', label: 'Tier 2 accounts with a decision maker identified', unit: '%', dir: 'up' },
  { key: 't1ConnectedPct', label: 'Tier 1 accounts connected (had an opportunity)', unit: '%', dir: 'up' },
  { key: 't2ConnectedPct', label: 'Tier 2 accounts connected (had an opportunity)', unit: '%', dir: 'up' },
  { key: 't1InactivePct', label: 'Tier 1 accounts inactive (lost / hold off / old client)', unit: '%', dir: 'down' },
  { key: 't2InactivePct', label: 'Tier 2 accounts inactive (lost / hold off / old client)', unit: '%', dir: 'down' },
  { key: 't1Total', label: 'Tier 1 accounts', unit: '', dir: 'flat' },
  { key: 't2Total', label: 'Tier 2 accounts', unit: '', dir: 'flat' },
  { key: 'noOppsAccountCount', label: 'Accounts with no opportunities', unit: '', dir: 'down' },
  { key: 'noOppsActivityTotal', label: 'Activity on no-opportunity accounts (30d)', unit: '', dir: 'up' },
  { key: 'peTotal', label: 'PE firms tracked', unit: '', dir: 'flat' },
  { key: 'peExistingPartnership', label: 'PE firms in existing partnership', unit: '', dir: 'up' },
];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

// ---- Pipeline (metrics table + BFO live actuals) ------------------------

function pipelineSection(pipeline, bfo) {
  if (!pipeline || typeof pipeline !== 'object') return null;
  const metrics = bfoStageMetrics(bfo);
  const hasBfo = !!(bfo && Array.isArray(bfo.rows) && bfo.rows.length);
  const stagesIn = Array.isArray(pipeline.stages) ? pipeline.stages : [];

  const stages = stagesIn.map((st) => {
    const stageNum = Number(String(st?.key ?? '').replace(/[^0-9]/g, ''));
    const m = metrics[stageNum];
    const live = (v) => (hasBfo && v !== null && v !== undefined ? v : null);
    const activeActual = live(m?.count) ?? num(st?.activeActual);
    const dealSizeActual = live(m?.avg) ?? num(st?.dealSizeActual);
    const pipelineActual = live(m?.total) ?? num(st?.pipelineActual);
    const lifeActual = live(m?.avgAge) ?? num(st?.lifeActual);
    const activeGoal = num(st?.activeGoal) || 0;
    const dealSizeGoal = num(st?.dealSizeGoal) || 0;
    const closeGoal = num(st?.closeGoal) || 0;
    const lifeGoal = num(st?.lifeGoal);
    // Opps sitting past the stage's max target age — the stalled-deal count
    // the metrics table flags in its "Flagged Opps" column.
    const stalled = (hasBfo && lifeGoal != null && m?.rows)
      ? m.rows.filter(r => r.age != null && r.age > lifeGoal).length
      : null;
    return {
      label: String(st?.label ?? `Stage ${stageNum}`),
      activeGoal,
      activeActual: activeActual == null ? null : Math.round(activeActual),
      dealSizeGoal,
      dealSizeActual: dealSizeActual == null ? null : Math.round(dealSizeActual),
      pipelineGoal: activeGoal * dealSizeGoal,
      pipelineActual: pipelineActual == null ? null : Math.round(pipelineActual),
      closeGoal,
      closeActual: num(st?.closeActual),
      lifeGoal,
      lifeActual: lifeActual == null ? null : Math.round(lifeActual),
      // What this stage is worth if it hits all three of its goals.
      targetProjGoal: Math.round(activeGoal * dealSizeGoal * closeGoal),
      stalledCount: stalled,
    };
  });

  const sum = (fn) => stages.reduce((acc, s) => acc + (fn(s) || 0), 0);
  const target = num(pipeline.target) || 0;
  const closedYTD = num(pipeline.closedYTD) || 0;
  const pipelineActualTotal = stages.some(s => s.pipelineActual != null) ? sum(s => s.pipelineActual) : null;

  return {
    hasBfo,
    quota: {
      target,
      closedYTD,
      pctOfQuota: target > 0 ? +((closedYTD / target) * 100).toFixed(1) : null,
    },
    stages,
    totals: {
      activeGoal: sum(s => s.activeGoal),
      activeActual: stages.some(s => s.activeActual != null) ? sum(s => s.activeActual) : null,
      pipelineGoal: sum(s => s.pipelineGoal),
      pipelineActual: pipelineActualTotal,
      // Sum of the per-stage target projections vs the annual target: does
      // the pipeline, run at goal conversion, even reach quota?
      targetProjGoal: sum(s => s.targetProjGoal),
      targetProjGap: sum(s => s.targetProjGoal) - target,
    },
    coverage: {
      goal: num(pipeline.coverageGoal),
      actual: (pipelineActualTotal != null && target > 0)
        ? +(pipelineActualTotal / target).toFixed(2)
        : null,
    },
    clientMix: {
      goalPct: num(pipeline.clientGoalPct),
      actualPct: num(pipeline.clientActualPct),
      clientCount: num(pipeline.currentClientCount),
      greenfieldCount: num(pipeline.greenfieldCount),
    },
    // Trailing windows. The `??` arms read state saved before the table
    // moved off calendar month / calendar year, so a review run against an
    // older save still reports a number rather than a dash.
    notQuoted: {
      goalPct: num(pipeline.notQuotedGoal),
      d30Pct: num(pipeline.notQuoted30 ?? pipeline.notQuotedMonth),
      d90Pct: num(pipeline.notQuoted90),
      d365Pct: num(pipeline.notQuoted365 ?? pipeline.notQuotedYear),
    },
    activity: {
      newOppsGoal: num(pipeline.newOppsGoal),
      newOppsThisMonth: num(pipeline.newOppsThisMonth),
      newOppsLastMonth: num(pipeline.newOppsLastMonth),
      activitiesGoal: num(pipeline.activitiesGoal),
      activitiesThisWeek: num(pipeline.activitiesThisWeek),
      activitiesLastWeek: num(pipeline.activitiesLastWeek),
    },
  };
}

// ---- Progress (weekly account-coverage snapshots) -----------------------

function progressSection(progressWeeks, weekKey) {
  const weeks = (Array.isArray(progressWeeks) ? progressWeeks : [])
    .filter(w => w && typeof w === 'object' && typeof w.week === 'string')
    .slice()
    .sort((a, b) => a.week.localeCompare(b.week));
  if (!weeks.length) return null;

  // The snapshot for the week under review (or the most recent one before it).
  const upto = weeks.filter(w => w.week <= weekKey);
  const latest = upto.length ? upto[upto.length - 1] : weeks[weeks.length - 1];
  const idx = weeks.indexOf(latest);
  const prior = idx > 0 ? weeks[idx - 1] : null;
  const fourBack = idx >= 4 ? weeks[idx - 4] : (weeks.length > 1 ? weeks[0] : null);

  const series = PROGRESS_SERIES.map(s => {
    const value = num(latest[s.key]);
    if (value === null) return null;
    const priorValue = prior ? num(prior[s.key]) : null;
    const baseValue = fourBack ? num(fourBack[s.key]) : null;
    return {
      key: s.key,
      label: s.label,
      unit: s.unit,
      dir: s.dir,
      value,
      weekChange: priorValue === null ? null : +(value - priorValue).toFixed(1),
      fourWeekChange: baseValue === null ? null : +(value - baseValue).toFixed(1),
    };
  }).filter(Boolean);

  return {
    week: latest.week,
    comparedWith: fourBack ? fourBack.week : null,
    weeksTracked: weeks.length,
    // A snapshot dated before the week under review means the Progress tab
    // wasn't opened that week — worth saying rather than silently comparing.
    stale: latest.week !== weekKey,
    series,
  };
}

// ---- Snapshot -----------------------------------------------------------

// The YOY charts let the user pin a corrected value onto a data point, and
// the Annual Sales "Projected" bar is one of them. Apply that pin here too,
// so the Weekly Report's projection tile shows what the chart shows rather
// than the computed number the user has already overruled.
//
// Precedence mirrors the chart's own recompute(): an overridden Total wins
// outright; otherwise the total is the sum of the two client segments with
// any of their overrides applied.
function applyProjectionOverride(projection, yoyOverrides) {
  if (!projection) return null;
  const patch = yoyOverrides?.annualSales?.Projected;
  const ov = (key) => {
    const v = patch?.[key];
    return (v != null && Number.isFinite(Number(v))) ? Number(v) : null;
  };
  if (!patch) return { ...projection, overridden: false };
  const total = ov('_total');
  if (total !== null) return { ...projection, amount: Math.round(total), overridden: true };
  const currentClient = ov('currentClient');
  const newClient = ov('newClient');
  if (currentClient === null && newClient === null) return { ...projection, overridden: false };
  const nextCurrent = currentClient ?? projection.currentClient;
  const nextNew = newClient ?? projection.newClient;
  return {
    ...projection,
    currentClient: Math.round(nextCurrent),
    newClient: Math.round(nextNew),
    amount: Math.round(nextCurrent + nextNew),
    overridden: true,
  };
}

// Build the full review input. `now` is injectable so a review can be
// regenerated for a past week from the same code path.
export function buildReviewSnapshot({
  pipeline = null,
  bfo = null,
  oppsRecords = [],
  progressWeeks = [],
  yoyOverrides = null,
  cdmName = '',
  now = new Date(),
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const weekKey = weekKeyOf(now);
  const pipe = pipelineSection(pipeline, bfo);
  const target = pipe ? pipe.quota.target : 0;
  const yoy = Array.isArray(oppsRecords) && oppsRecords.length
    ? yoyReviewMetrics(oppsRecords, { target, nowMs })
    : null;
  return {
    weekKey,
    weekLabel: weekRangeLabel(weekKey),
    cdmName: String(cdmName || ''),
    generatedAt: new Date(nowMs).toISOString(),
    yoy: yoy && { ...yoy, projection: applyProjectionOverride(yoy.projection, yoyOverrides) },
    pipeline: pipe,
    progress: progressSection(progressWeeks, weekKey),
    missing: [
      ...(pipe ? [] : ['Pipeline dashboard (open the Charts → Pipeline tab once to seed it)']),
      ...(pipe && !pipe.hasBfo ? ['BFO Activity (paste it on the BFO Activity tab for live stage actuals)'] : []),
      ...(Array.isArray(oppsRecords) && oppsRecords.length ? [] : ['Opps 2 records (open the Opps 2 tab to cache them)']),
      ...((Array.isArray(progressWeeks) && progressWeeks.length) ? [] : ['Progress history (open the Charts → Progress tab to record a week)']),
    ],
  };
}

// The three headline numbers the Weekly Report leads with: how far through
// the annual target the year is, whether the open pipeline covers what's
// left, and where the year lands at the current run rate.
//
// All three are year-scoped, not week-scoped — they answer "am I going to
// make the number", which is the question the rest of the report is
// evidence for. Each reads from the snapshot the weekly review already
// builds, so the tiles and the review can never quote different figures.
//
// Sold YTD prefers the Opps-derived total over the Pipeline dashboard's
// hand-entered Closed YTD: the former moves whenever Opps 2 is refreshed,
// the latter only when somebody retypes it. Anything the snapshot can't
// supply comes back null, and the tile shows why rather than a zero.
export function headlineKpis(snapshot) {
  // Strict: unlike `num`, a null reads as "not available" rather than 0.
  // The snapshot uses null for "no actual to report" throughout, and a
  // coverage ratio of 0.00 is a very different claim from a blank one.
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const s = snapshot || {};
  const ytd = s.yoy?.ytd || null;
  const pipe = s.pipeline || null;

  // One target across all three tiles — the Pipeline dashboard's, which is
  // also what yoyReviewMetrics was handed.
  const target = fin(pipe?.quota?.target) ?? fin(ytd?.target) ?? 0;

  const soldYTD = ytd ? fin(ytd.amount) : fin(pipe?.quota?.closedYTD);
  const onPaceAmount = ytd ? fin(ytd.onPaceAmount) : null;
  // Positive = ahead of where a straight-line year would have you today.
  const paceDelta = (soldYTD != null && onPaceAmount != null)
    ? Math.round(soldYTD - onPaceAmount)
    : null;

  const coverageActual = fin(pipe?.coverage?.actual);
  const coverageGoal = fin(pipe?.coverage?.goal);

  // The projection is the Annual Sales chart's Projected bar — sold this
  // year plus the agreements already out — not ytd.runRateFullYear. The
  // two are different questions with different answers, and the chart's is
  // the one the user is reading elsewhere.
  const proj = s.yoy?.projection || null;
  const projected = fin(proj?.amount);

  return {
    target: target || null,
    progressToTarget: {
      pct: (target > 0 && soldYTD != null) ? +((soldYTD / target) * 100).toFixed(1) : null,
      soldYTD,
      target: target || null,
      deals: ytd ? fin(ytd.deals) : null,
      onPaceAmount,
      paceDelta,
      yearElapsedPct: ytd ? fin(ytd.yearElapsedPct) : null,
      gapToTarget: (target > 0 && soldYTD != null) ? Math.round(target - soldYTD) : null,
      status: paceDelta == null ? null : (paceDelta >= 0 ? 'ahead' : 'behind'),
    },
    coverageRatio: {
      actual: coverageActual,
      goal: coverageGoal,
      pipelineActual: fin(pipe?.totals?.pipelineActual),
      target: target || null,
      // Only meaningful against a goal; without one the number still shows,
      // just without a verdict on it.
      status: (coverageActual == null || coverageGoal == null)
        ? null
        : (coverageActual >= coverageGoal ? 'ahead' : 'behind'),
      // The ratio is computed off live BFO stage totals; say so when the
      // stage actuals are the last hand-entered ones instead.
      live: !!pipe?.hasBfo,
    },
    projectedYearEnd: {
      amount: projected,
      target: target || null,
      // Positive = the projection clears the target.
      gap: (projected != null && target > 0) ? Math.round(projected - target) : null,
      // The two halves of the projection, so the tile can show its working.
      soldYTD: fin(proj?.soldYTD),
      committedAmount: fin(proj?.lateStageAmount),
      // True when the user has pinned a value onto the chart's Projected
      // bar; the tile says so rather than passing it off as computed.
      overridden: !!proj?.overridden,
      // No run rate here on purpose. The tile used to carry it as a
      // contrast line and it read as a second claim about the headline
      // rather than the separate question it is. The review's prose still
      // gets both off the snapshot, where the contrast is worth drawing.
      status: (projected == null || target <= 0)
        ? null
        : (projected >= target ? 'ahead' : 'behind'),
    },
  };
}
