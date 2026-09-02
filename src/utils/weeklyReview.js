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
const money = (n) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '-');
const pct = (n, digits = 0) => (Number.isFinite(n) ? `${n.toFixed(digits)}%` : '-');

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

// The handful of numbers the history table shows per week, so a stored review
// can be tabulated without re-reading the whole snapshot.
export function reviewHighlights(snapshot) {
  const s = snapshot || {};
  return {
    target: s.pipeline?.quota?.target ?? null,
    closedYTD: s.pipeline?.quota?.closedYTD ?? null,
    pctOfQuota: s.pipeline?.quota?.pctOfQuota ?? null,
    gapToTarget: s.yoy?.ytd?.gapToTarget ?? null,
    onPaceAmount: s.yoy?.ytd?.onPaceAmount ?? null,
    runRateFullYear: s.yoy?.ytd?.runRateFullYear ?? null,
    projectedYearEnd: s.yoy?.projection?.amount ?? null,
    coverageActual: s.pipeline?.coverage?.actual ?? null,
    coverageGoal: s.pipeline?.coverage?.goal ?? null,
    openPipelineAmount: s.yoy?.openPipeline?.amount ?? null,
    targetProjGap: s.pipeline?.totals?.targetProjGap ?? null,
    stalledOpps: Array.isArray(s.pipeline?.stages)
      ? s.pipeline.stages.reduce((a, st) => a + (st.stalledCount || 0), 0)
      : null,
  };
}

// ---- Serialization ------------------------------------------------------

// Compact plain-text block — the LLM's input and what "Copy review" puts on
// the clipboard. Deterministic, so it's useful with or without the network.
export function serializeReviewSnapshot(snapshot) {
  const s = snapshot || {};
  const L = [];
  L.push(`WEEKLY REVIEW INPUT: week of ${s.weekLabel || s.weekKey || ''}${s.cdmName ? ` (${s.cdmName})` : ''}`);

  if (s.yoy) {
    const y = s.yoy;
    L.push('');
    L.push('YOY: SALES AGAINST TARGET');
    L.push(`- Annual target: ${money(y.ytd.target)}`);
    L.push(`- Sold YTD (${y.ytd.year}): ${money(y.ytd.amount)} across ${y.ytd.deals} deals: ${pct(y.ytd.pctOfTarget, 1)} of target`);
    L.push(`- Year elapsed: ${pct(y.ytd.yearElapsedPct, 1)}: on pace would be ${money(y.ytd.onPaceAmount)}`);
    L.push(`- Gap to target: ${money(y.ytd.gapToTarget)}; current run rate lands the year at ${money(y.ytd.runRateFullYear)}`);
    if (y.projection) {
      // The YOY Annual Sales "Projected" bar. Reported next to the run rate
      // because they answer different questions: this one counts only what
      // is already committed, so a big gap between them is itself a signal.
      L.push(`- Projected year-end (sold ${money(y.projection.soldYTD)} + ${money(y.projection.lateStageAmount)} in agreements out): ${money(y.projection.amount)}${y.projection.overridden ? ' (pinned on the Annual Sales chart)' : ''}`);
    }
    L.push(`- Same point last year (${y.priorYearSameDate.year}): ${money(y.priorYearSameDate.amount)} across ${y.priorYearSameDate.deals} deals (delta ${money(y.priorYearSameDate.deltaAmount)})`);
    if (y.years.length) {
      L.push('- By year (opened leads / sold / not sold / in progress / sold $ / avg deal / total C-R / quoted C-R):');
      for (const row of y.years.slice(-6)) {
        L.push(`  • ${row.year}: ${row.leads} leads, ${row.sold} sold, ${row.notSold} not sold, ${row.inProgress} in progress, ${money(row.soldAmount)}, avg ${money(row.avgDealSize)}, ${pct(row.totalCR, 1)}, ${pct(row.quotedCR, 1)}`);
      }
    }
    L.push(`- Open pipeline today: ${y.openPipeline.count} opps worth ${money(y.openPipeline.amount)} (late stage: ${y.openPipeline.lateStageCount} worth ${money(y.openPipeline.lateStageAmount)})`);
    for (const st of y.openPipeline.byStage.slice(0, 8)) {
      L.push(`  • ${st.stage}: ${st.count} opps, ${money(st.amount)}`);
    }
  }

  if (s.pipeline) {
    const p = s.pipeline;
    L.push('');
    L.push(`PIPELINE METRICS${p.hasBfo ? ' (stage actuals live from BFO Activity)' : ' (no BFO data: stage actuals are the last hand-entered values)'}`);
    L.push(`- Quota: ${money(p.quota.closedYTD)} closed of ${money(p.quota.target)} · ${pct(p.quota.pctOfQuota, 1)}`);
    L.push('- Stage goal vs actual:');
    for (const st of p.stages) {
      const parts = [
        `active ${st.activeActual ?? '-'}/${st.activeGoal}`,
        `deal size ${money(st.dealSizeActual)} vs ${money(st.dealSizeGoal)}`,
        `pipeline ${money(st.pipelineActual)} vs ${money(st.pipelineGoal)}`,
        `close rate ${pct(st.closeActual == null ? null : st.closeActual * 100)} vs ${pct(st.closeGoal * 100)}`,
        `opp life ${st.lifeActual ?? '-'}d vs ${st.lifeGoal ?? '-'}d max`,
      ];
      if (st.stalledCount) parts.push(`${st.stalledCount} past max age`);
      L.push(`  • ${st.label}: ${parts.join('; ')}`);
    }
    L.push(`- Totals: ${p.totals.activeActual ?? '-'}/${p.totals.activeGoal} active opps; pipeline ${money(p.totals.pipelineActual)} vs ${money(p.totals.pipelineGoal)} goal`);
    L.push(`- Target projection at goal conversion: ${money(p.totals.targetProjGoal)} vs ${money(p.quota.target)} target (${p.totals.targetProjGap >= 0 ? 'surplus' : 'shortfall'} ${money(Math.abs(p.totals.targetProjGap))})`);
    if (p.coverage.actual != null || p.coverage.goal != null) {
      L.push(`- Coverage ratio: ${p.coverage.actual ?? '-'} vs ${p.coverage.goal ?? '-'} goal`);
    }
    if (p.clientMix.goalPct != null || p.clientMix.actualPct != null) {
      L.push(`- Current-client mix: ${pct(p.clientMix.actualPct == null ? null : p.clientMix.actualPct * 100)} vs ${pct(p.clientMix.goalPct == null ? null : p.clientMix.goalPct * 100)} goal (${p.clientMix.clientCount ?? '-'} client / ${p.clientMix.greenfieldCount ?? '-'} greenfield opps)`);
    }
    if (p.notQuoted.goalPct != null) {
      const nq = (v) => pct(v == null ? null : v * 100);
      L.push(`- Deals not quoted: ${nq(p.notQuoted.d30Pct)} past 30d / ${nq(p.notQuoted.d90Pct)} past 90d / ${nq(p.notQuoted.d365Pct)} past year vs ${pct(p.notQuoted.goalPct * 100)} goal (lower is better)`);
    }
    const a = p.activity;
    if (a.newOppsGoal != null || a.activitiesGoal != null) {
      L.push(`- New opps: ${a.newOppsThisMonth ?? '-'} this month (${a.newOppsLastMonth ?? '-'} last) vs ${a.newOppsGoal ?? '-'} goal; activities: ${a.activitiesThisWeek ?? '-'} this week (${a.activitiesLastWeek ?? '-'} last) vs ${a.activitiesGoal ?? '-'} goal`);
    }
  }

  if (s.progress) {
    const pr = s.progress;
    L.push('');
    L.push(`PROGRESS: ACCOUNT COVERAGE (snapshot ${pr.week}${pr.stale ? ', not refreshed this week' : ''}; ${pr.weeksTracked} weeks tracked${pr.comparedWith ? `, 4-week change vs ${pr.comparedWith}` : ''})`);
    for (const m of pr.series) {
      const wk = m.weekChange == null ? '-' : `${m.weekChange > 0 ? '+' : ''}${m.weekChange}`;
      const four = m.fourWeekChange == null ? '-' : `${m.fourWeekChange > 0 ? '+' : ''}${m.fourWeekChange}`;
      L.push(`  • ${m.label}: ${m.value}${m.unit} (week ${wk}, 4-week ${four}; ${m.dir === 'up' ? 'higher is better' : m.dir === 'down' ? 'lower is better' : 'context only'})`);
    }
  }

  if (s.missing && s.missing.length) {
    L.push('');
    L.push('DATA NOT AVAILABLE THIS RUN');
    for (const m of s.missing) L.push(`- ${m}`);
  }

  return L.join('\n');
}

// Plain-text rendering of a stored review, for the clipboard.
export function serializeReview(review, weekLabel) {
  const r = review || {};
  const L = [];
  L.push(`WEEKLY REVIEW: ${weekLabel || ''}`.trim());
  if (r.headline) { L.push(''); L.push(r.headline); }
  if (r.targetOutlook) { L.push(''); L.push(`Target outlook: ${r.targetOutlook}`); }
  if (Array.isArray(r.blockers) && r.blockers.length) {
    L.push('');
    L.push("WHAT'S HOLDING YOU BACK");
    r.blockers.forEach((b, i) => {
      L.push(`${i + 1}. [${b.area}${b.severity ? ` · ${b.severity}` : ''}] ${b.title}`);
      if (b.evidence) L.push(`   Evidence: ${b.evidence}`);
      if (b.impact) L.push(`   Impact: ${b.impact}`);
      if (b.action) L.push(`   Do this: ${b.action}`);
    });
  }
  if (Array.isArray(r.working) && r.working.length) {
    L.push('');
    L.push('WORKING');
    for (const w of r.working) L.push(`- ${w}`);
  }
  if (Array.isArray(r.focus) && r.focus.length) {
    L.push('');
    L.push('FOCUS NEXT WEEK');
    for (const f of r.focus) L.push(`- ${f}`);
  }
  return L.join('\n');
}
