// Rebuilding the Weekly Report server-side, so a scheduled email carries
// current figures whether or not anyone opened the tab.
//
// The report was snapshot-only for a good reason: its numbers came from
// caches that existed only in the browser, and recomputing them on the
// server would have been a second copy of the same arithmetic, free to
// drift from what the user sees. Both halves of that have since stopped
// being true. Every input now has a home the server can read —
//
//   Opps 2                opps2Data/{uid}
//   Pipeline dashboard    userSettings/{uid}/localMirrors/idb__pipeline-dashboard__current
//   BFO activity          …/idb__bfo-activity__current
//   Daily Success goals   …/idb__daily-success-goals__list
//   Weekly activity log   …/weekly-activity-log
//   YOY pins              …/yoy-chart-overrides
//   Progress weeks        progressHistory/{uid}
//   Targets, work email   userSettings/{uid}
//   Emails / calls / mtgs  the HubSpot API itself, live
//
// — and the arithmetic lives in pure modules under src/utils that load in
// a serverless function unchanged. So this builds the same document the
// tab publishes by calling the same functions, rather than restating them.
//
// Two things the tab can do that this cannot, both handled rather than
// hidden: it rasterises the funnel chart into a PNG (a server build has
// no picture, so its email leaves the funnel section out), and it can ask Claude
// for a narrative recap (left out; the email omits the section when it is
// empty). Everything numeric is here.
//
// The period is the last *completed* one — for a weekly report, the week
// that ended most recently. A report of a week still in progress is
// partial by definition, and would be flagged stale by freshnessNote on
// every single send.

import {
  weekBounds, dayBounds, periodLabel,
  computeOppChanges, computeGoalsProgress,
} from '../../src/utils/weeklyReport.js';
import { buildReviewSnapshot, headlineKpis, emailKpiCards } from '../../src/utils/weeklyReview.js';
import {
  emailsByWeek, newOppsByMonth, coverageByWeek,
  recentWeeks, TREND_WEEKS, TREND_MONTHS, COVERAGE_WEEKS,
} from '../../src/utils/weeklyReportTrends.js';
import { withCoverageImages } from '../../src/utils/coverageChartImage.js';
import {
  buildFunnelStages, closeRateTrendByStage, closeRatesByStage, emailCloseRateTrend,
} from '../../src/utils/pipelineFunnelData.js';
import { bfoStageMetrics } from '../../src/utils/bfoStageMetrics.js';
import {
  funnelOutcomeFor, emailFunnelSummary, emailSnapshotPayload,
} from '../../src/utils/weeklyReportEmailSnapshot.js';
import { loadOpps2, loadMirror, MIRROR } from './firestoreChunks.js';
import { fetchActivityWindow } from './hubspotActivityWindow.js';
import { zonedToUtc, localParts } from './weeklyReportSchedule.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = ({ y, mo, d }) => `${y}-${pad2(mo + 1)}-${pad2(d)}`;

/**
 * The most recently completed reporting period, in the user's own zone.
 *
 * A runner in UTC computing a Chicago user's week would put the boundary
 * six hours off, so Sunday evening's sends would land in the wrong week.
 * With a zone on the schedule the boundaries are the exact instants local
 * midnight falls at; without one this is the same local-midnight maths the
 * tab does, on the runner's clock.
 */
export function completedPeriodBounds(now, { scope = 'week', timeZone = '' } = {}) {
  const back = scope === 'day' ? DAY_MS : 7 * DAY_MS;
  const tz = String(timeZone || '').trim();
  if (!tz) {
    const d = new Date(now - back);
    const iso = isoOf({ y: d.getFullYear(), mo: d.getMonth(), d: d.getDate() });
    const b = scope === 'day' ? dayBounds(iso) : weekBounds(iso);
    return { ...b, iso, scope, label: periodLabel(iso, scope) };
  }
  try {
    const here = localParts(now - back, tz);
    if (scope === 'day') {
      const start = zonedToUtc(here.y, here.mo, here.d, 0, tz);
      const next = new Date(Date.UTC(here.y, here.mo, here.d + 1));
      const end = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 0, tz);
      const iso = isoOf(here);
      return { start, end, iso, scope, label: periodLabel(iso, scope) };
    }
    // Back to the Monday of that local date, then forward a calendar week.
    // Both edges go through zonedToUtc so a DST change inside the week
    // shortens or lengthens it the way the user's calendar does.
    const backToMonday = (here.dow + 6) % 7;
    const mon = new Date(Date.UTC(here.y, here.mo, here.d - backToMonday));
    const nextMon = new Date(Date.UTC(here.y, here.mo, here.d - backToMonday + 7));
    const start = zonedToUtc(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate(), 0, tz);
    const end = zonedToUtc(nextMon.getUTCFullYear(), nextMon.getUTCMonth(), nextMon.getUTCDate(), 0, tz);
    const iso = isoOf({ y: mon.getUTCFullYear(), mo: mon.getUTCMonth(), d: mon.getUTCDate() });
    return { start, end, iso, scope, label: periodLabel(iso, scope) };
  } catch {
    // An unrecognised zone string throws on the first Intl call. Fall back
    // rather than failing the whole build over a bad setting.
    return completedPeriodBounds(now, { scope, timeZone: '' });
  }
}

// The start of the oldest week the emails-by-week series covers, which is
// how far back the live feed has to reach. Exported so the scheduler asks
// for the same span the build will read.
export function trendHistoryStart(periodStart) {
  return recentWeeks(periodStart, TREND_WEEKS)[0].start;
}

/**
 * Every input the report needs, read from Firestore and HubSpot.
 *
 * Each source is fetched independently and a failure is recorded rather
 * than thrown: a missing pipeline dashboard should cost the KPI cards, not
 * the whole email. `errors` is what the caller logs.
 */
export async function loadReportSources(db, uid, { token = '', start, end, historyStart, fetchOpts } = {}) {
  const errors = [];
  const settle = async (name, fn, fallback) => {
    try { return await fn(); } catch (err) {
      errors.push(`${name}: ${String(err?.message || err).slice(0, 200)}`);
      return fallback;
    }
  };

  const [opps2, pipeline, bfo, goals, activityLog, yoyOverrides, progress, settings, activityCache] =
    await Promise.all([
      settle('opps2', () => loadOpps2(db, uid), null),
      settle('pipeline', () => loadMirror(db, uid, MIRROR.pipeline), null),
      settle('bfo', () => loadMirror(db, uid, MIRROR.bfo), null),
      settle('goals', () => loadMirror(db, uid, MIRROR.goals, []), []),
      settle('activityLog', () => loadMirror(db, uid, MIRROR.activityLog, {}), {}),
      settle('yoyOverrides', () => loadMirror(db, uid, MIRROR.yoyOverrides, {}), {}),
      settle('progressHistory', async () => {
        const snap = await db.collection('progressHistory').doc(uid).get();
        const weeks = snap.exists ? snap.data()?.weeks : null;
        return Array.isArray(weeks)
          ? weeks.filter(w => w && typeof w === 'object' && typeof w.week === 'string')
            .sort((a, b) => a.week.localeCompare(b.week))
          : [];
      }, []),
      settle('userSettings', async () => {
        const snap = await db.collection('userSettings').doc(uid).get();
        return snap.exists ? (snap.data() || {}) : {};
      }, {}),
      // The one live source. When it fails — no token, HubSpot down — the
      // build carries on and emailsSentFor falls back to the recorded
      // weekly total, which is exactly what the tab does with a feed the
      // storage quota dropped.
      // Back to the first week of the emails-by-week series, not just the
      // reported window. The feed is stamped `fetchedAt: now`, so
      // liveCacheCovers treats it as an answer for every week in the
      // series — and a feed holding only the current week would then
      // answer 0 for the four behind it and draw a collapse in outbound
      // that never happened.
      settle('hubspotActivity', () => fetchActivityWindow(token, historyStart ?? start, end, fetchOpts), null),
    ]);

  return {
    oppsRecords: Array.isArray(opps2?.records) ? opps2.records : [],
    pipeline,
    bfo,
    goals: Array.isArray(goals) ? goals : [],
    activityLog: (activityLog && typeof activityLog === 'object') ? activityLog : {},
    yoyOverrides: (yoyOverrides && typeof yoyOverrides === 'object') ? yoyOverrides : {},
    progressWeeks: progress,
    settings: settings || {},
    activityCache,
    errors,
  };
}

/**
 * The snapshot payload, from already-loaded sources. Pure — no I/O — so the
 * whole shape of a built report can be tested against fixtures.
 */
export function buildReportPayload(sources, period) {
  const s = sources || {};
  const { start, end, scope, label } = period;
  const settings = s.settings || {};
  const workEmail = String(settings.workEmail || '').toLowerCase().trim();
  const oppChanges = computeOppChanges(s.oppsRecords, start, end);
  const goalsProgress = computeGoalsProgress(s.goals, start, end);

  // The two history series the email carries in place of the old tiles.
  // Same pure functions the tab calls, over the same caches — the weekly
  // one leans on emailsSentFor per week, so a week the feed cannot answer
  // for falls back to the Activity tab's banked total rather than to zero.
  // A day-scoped report gets no weekly series: the log is kept per week,
  // and a week's total is not an answer about a day.
  const trends = {
    emailsByWeek: scope === 'day' ? [] : emailsByWeek({
      cache: s.activityCache,
      log: s.activityLog,
      senderEmail: workEmail,
      refMs: start,
      weeks: TREND_WEEKS,
    }),
    newOppsByMonth: newOppsByMonth({
      records: s.oppsRecords, refMs: start, months: TREND_MONTHS,
    }),
  };

  // The Progress tab's account-coverage charts, off the same
  // progressHistory weeks the review snapshot below reads. Not scoped to
  // the period: coverage is a level, not a count, so a day-scoped report
  // gets the same weekly series a week-scoped one does.
  // Drawn here as well as counted: unlike the funnel, whose picture needs a
  // canvas the tab has and this does not, the coverage chart is encoded
  // pixel by pixel (utils/coverageChartImage), so a scheduled send carries
  // the same picture the preview shows.
  const coverage = withCoverageImages(coverageByWeek({
    progressWeeks: s.progressWeeks, refMs: start, weeks: COVERAGE_WEEKS,
  }));

  const reviewSnapshot = buildReviewSnapshot({
    pipeline: s.pipeline,
    bfo: s.bfo,
    oppsRecords: s.oppsRecords,
    progressWeeks: s.progressWeeks,
    yoyOverrides: s.yoyOverrides,
    cdmName: String(settings.cdmName || ''),
  });
  const kpis = headlineKpis(reviewSnapshot);
  const kpisReady = !!(reviewSnapshot.pipeline || reviewSnapshot.yoy);

  const funnelStages = buildFunnelStages({
    stages: Array.isArray(s.pipeline?.stages) ? s.pipeline.stages : [],
    bfoMetrics: bfoStageMetrics(s.bfo),
    hasBfo: !!(s.bfo && Array.isArray(s.bfo.rows) && s.bfo.rows.length),
    closeRates: closeRatesByStage(s.oppsRecords),
  });

  return emailSnapshotPayload({
    scope,
    periodLabel: label,
    periodStart: start,
    periodEnd: end,
    kpiCards: kpisReady ? emailKpiCards(kpis) : [],
    funnelSummary: emailFunnelSummary(funnelStages, funnelOutcomeFor(kpis)),
    // No chart: rasterising one needs a DOM. The email draws the stage
    // table in its place, which it already does whenever the tab failed to
    // capture a picture.
    funnelImage: null,
    closeRateTrend: emailCloseRateTrend(closeRateTrendByStage(s.oppsRecords, { months: 6 })),
    trends,
    coverage,
    oppChanges,
    goalsProgress,
    // The recap is the tab's one on-demand piece; a cron that wrote its own
    // prose would be a different report arriving under the same heading.
    narrative: '',
  });
}

// Whether a built payload is worth mailing in place of the stored
// snapshot. A build that found no figures at all means the Firestore side
// is empty or unreadable, and the last thing the tab published — however
// old — is a better report than a blank one.
export function payloadHasFigures(payload) {
  if (!payload) return false;
  if ((payload.kpiCards || []).length) return true;
  if (payload.funnel) return true;
  if (payload.closeRateTrend) return true;
  if (payload.coverage) return true;
  const tr = payload.trends || {};
  const points = [...(tr.emailsByWeek || []), ...(tr.newOppsByMonth || [])];
  if (points.some(p => Number(p.value) > 0)) return true;
  const oc = payload.oppChanges || {};
  return Object.values(oc).some(v => Array.isArray(v) && v.length > 0);
}

/**
 * Build the report for one schedule's owner. Returns the payload plus the
 * period it covers and any source errors, or null when there was nothing
 * to build from.
 */
export async function buildWeeklyReport(db, uid, {
  now = Date.now(), scope = 'week', timeZone = '', token = process.env.HUBSPOT_ACCESS_TOKEN || '', fetchOpts,
} = {}) {
  const period = completedPeriodBounds(now, { scope, timeZone });
  const sources = await loadReportSources(db, uid, {
    token,
    start: period.start,
    end: period.end,
    // The live feed has to reach back across the whole emails-by-week
    // series, not just the reported week.
    historyStart: trendHistoryStart(period.start),
    fetchOpts,
  });
  const payload = buildReportPayload(sources, period);
  return { payload, period, errors: sources.errors, usable: payloadHasFigures(payload) };
}
