// The Weekly Report snapshot the email is built from, assembled in one
// place so the tab and the cron produce the same document.
//
// The report used to exist only in the browser: the tab computed it off
// local caches, published what it rendered, and the cron mailed that back.
// That kept one copy of the arithmetic, at the cost of a report that was
// only ever as current as the last visit to the tab. The cron now rebuilds
// it from Firestore and HubSpot instead (see api/_lib/weeklyReportBuild.js)
// — which is only safe because everything either side needs lives in pure
// modules both can call. This file holds the last pieces that were still
// inline in the component: the funnel's email cut, and the shape of the
// published document.
//
// Nothing here touches the DOM, IndexedDB or Firebase, so it loads in a
// serverless function as readily as in the tab.

// Exact dollars for the detail lines; compact for a headline figure, where
// "$1.9M" reads at a glance and the extra digits don't.
export const fmtDollars = (n) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '-');

export function fmtCompactMoney(n) {
  if (!Number.isFinite(n)) return '-';
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3).toLocaleString('en-US')}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// The block hanging off the funnel's exit arrow. Sold YTD is null rather
// than 0 when nothing is cached: the funnel then draws what the pipeline
// alone is worth and says the closed figure is missing, rather than adding
// to a hollow zero.
export function funnelOutcomeFor(kpis) {
  return {
    soldLabel: 'Closed YTD',
    soldAmount: kpis?.progressToTarget?.soldYTD ?? null,
    soldCount: kpis?.progressToTarget?.deals ?? null,
    target: Number(kpis?.target) || 0,
  };
}

// Nothing to draw without stage rows — or with rows that are all zero,
// which is what a dashboard record seeded but never filled in looks like.
export function isFunnelReady(funnelStages) {
  const rows = Array.isArray(funnelStages) ? funnelStages : [];
  return rows.length > 0 && rows.some(st => st.amtActual > 0 || st.countActual > 0);
}

// The funnel reduced to the figures an email can carry. The tab draws it as
// a chart — band height for pipeline value, segment length for how long
// deals sit in a stage — which no mail client will render, so the stage
// rows and the outcome block travel as text instead.
export function emailFunnelSummary(funnelStages, funnelOutcome) {
  if (!isFunnelReady(funnelStages)) return null;
  const ordered = funnelStages
    .filter(st => Number.isFinite(st.stageNum))
    .sort((a, b) => a.stageNum - b.stageNum);
  if (!ordered.length) return null;

  // Same arithmetic as the funnel's exit block: each stage's pipeline times
  // the close rate that stage actually runs at, summed.
  const rated = ordered.filter(st => Number(st.closeRate) > 0);
  const weighted = rated.length
    ? rated.reduce((a, st) => a + (Number(st.amtActual) || 0) * Number(st.closeRate), 0)
    : null;
  const sold = funnelOutcome?.soldAmount ?? null;
  const total = sold != null && weighted != null ? sold + weighted : null;
  const target = Number(funnelOutcome?.target) || 0;
  const lives = ordered.map(st => (Number(st.lifeActual) > 0 ? Number(st.lifeActual) : 0));

  return {
    stages: ordered.map((st, i) => ({
      label: st.label,
      count: Number(st.countActual) || 0,
      amount: fmtDollars(Number(st.amtActual) || 0),
      life: lives[i] > 0 ? `${Math.round(lives[i])} days` : null,
      closeRate: Number(st.closeRate) > 0 ? `${Math.round(Number(st.closeRate) * 100)}%` : null,
    })),
    outcome: {
      soldLabel: funnelOutcome?.soldLabel || 'Closed YTD',
      sold: sold == null ? null : fmtCompactMoney(sold),
      weighted: weighted == null ? null : fmtCompactMoney(weighted),
      total: total == null ? null : fmtCompactMoney(total),
      note: total != null && target > 0
        ? `${Math.round((total / target) * 100)}% of ${fmtCompactMoney(target)} target`
        : null,
    },
  };
}

// How an opp is named in the change lists: the account and scope the user
// would recognise, falling back to the id when a row has neither.
export const oppLabel = (x) => [x.account, x.scope].filter(Boolean).join(': ') || `Opp ${x.id}`;
const who = oppLabel;
const list = (arr, fmt) => (Array.isArray(arr) ? arr : []).map(fmt);

/**
 * The published snapshot, from pieces the caller has already computed with
 * the shared builders (headlineKpis, computeOppChanges, buildFunnelStages,
 * emailsSentFor and friends). Bounding and the capturedAt stamp happen
 * server-side in buildSnapshotDoc; this is the payload that goes in.
 */
export function emailSnapshotPayload({
  scope = 'week',
  periodLabel = '',
  periodStart = null,
  periodEnd = null,
  kpiCards = [],
  funnelSummary = null,
  funnelImage = null,
  closeRateTrend = null,
  trends = null,
  oppChanges = {},
  goalsProgress = {},
  narrative = '',
} = {}) {
  const oc = oppChanges || {};
  const gp = goalsProgress || {};
  return {
    scope,
    periodLabel,
    periodStart,
    periodEnd,
    // Not the tab's own cards: the email leads with the dollars sold and
    // carries only the line under each figure that gives it a scale. See
    // emailKpiCards for why the tab's working is left on the tab.
    kpiCards,
    funnel: funnelSummary,
    // The chart itself. Absent when it couldn't be captured — a serverless
    // build never can — and the email carries the same figures as a table
    // underneath it either way.
    funnelImage: funnelSummary && funnelImage
      ? {
        src: funnelImage.src,
        width: funnelImage.width,
        height: funnelImage.height,
        alt: funnelImage.alt,
      }
      : null,
    // Independent of the funnel: the trend reads the Opps cache alone, so a
    // report with no stage volumes cached still carries it.
    closeRateTrend,
    // Emails by week and new opps by month, in place of the two tiles this
    // email used to lead with. A tile said how one week went against a
    // target; the reader wants to know which way the line is going, and a
    // number over a goal cannot say that. Built by the caller (both of them
    // hold the caches these read) via utils/weeklyReportTrends.
    trends: trends && (trends.emailsByWeek?.length || trends.newOppsByMonth?.length)
      ? {
        emailsByWeek: trends.emailsByWeek || [],
        newOppsByMonth: trends.newOppsByMonth || [],
      }
      : null,
    oppChanges: {
      closed: list(oc.closed, x => `${who(x)} → ${x.stage}${x.amount ? ` (${x.amount})` : ''}`),
      newOpps: list(oc.newOpps, x => `${who(x)}${x.stage ? ` (${x.stage})` : ''}`),
      stageChanges: list(oc.stageChanges, x => `${who(x)} → ${x.stage}`),
      closeDateMoves: list(oc.closeDateMoves, x => `${who(x)}${x.closeDate ? ` → ${x.closeDate}` : ''}`),
      amountUpdates: list(oc.amountUpdates, x => `${who(x)}${x.amount ? ` → ${x.amount}` : ''}`),
      bfoTags: list(oc.bfoTags, x => `${who(x)}${x.bfo ? ` → ${x.bfo}` : ''}`),
    },
    goals: {
      created: list(gp.created, g => String(g.text || '').trim()).filter(Boolean),
      completed: list(gp.archived, g => String(g.text || '').trim()).filter(Boolean),
      // The tab caps the active list at 12; the email shows the same ones
      // rather than a longer list the reader can't reconcile with it.
      active: list((gp.active || []).slice(0, 12), g => (
        `${g.priority != null ? `#${g.priority} ` : ''}${String(g.text || '').trim()}`
      )).filter(Boolean),
    },
    narrative,
  };
}

// When a tile's number came from the Activity tab's recording rather than
// the live feed, the tile says so — and when: a stale recording explains a
// number that doesn't match what you did this morning.
export function fmtRecordedAt(ms) {
  if (!Number.isFinite(ms)) return 'from Activity';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
