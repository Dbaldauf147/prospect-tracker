// End-of-week (or end-of-day) work summary. Reads what already lives in
// the tool — the HubSpot activity cache, the Opps 2 field-change
// timestamps, and the Daily Success goals — scopes it to the selected
// week or day, shows the hard numbers, and (on demand) asks Claude to
// write a short narrative recap over them.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './WeeklyReportView.module.css';
import { WeeklyReportEmailModal } from './WeeklyReportEmailModal';
import { publishSnapshot } from '../../utils/weeklyReportSchedulesStore';
import { useAuth } from '../../contexts/AuthContext';
import { userLsGet } from '../../utils/userLs';
import { dbGet } from '../../utils/db';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { loadGoals } from '../DailySuccess/goalsStore';
import { subscribeToCoachingRules } from '../DailySuccess/coachingRulesStore';
import { apiFetch } from '../../utils/apiFetch';
import {
  weekBounds, dayBounds, periodLabel,
  computeActivity, computeOppChanges, computeGoalsProgress,
  serializeReport, pipelineSnapshotLines,
} from '../../utils/weeklyReport';
import {
  buildReviewSnapshot, serializeReviewSnapshot, serializeReview,
  reviewHighlights, weekRangeLabel, headlineKpis,
} from '../../utils/weeklyReview';
import { loadProgressWeeks, loadWeeklyReviews, saveWeeklyReview } from '../../utils/weeklyReviewStore';
import { loadYoyOverrides, YOY_OVERRIDES_EVENT } from '../../utils/yoyOverridesStore';
import { buildFunnelStages, closeRatesByStage } from '../../utils/pipelineFunnelData';
import { bfoStageMetrics } from '../../utils/bfoStageMetrics';
import { PipelineFunnel } from '../PipelineView/PipelineFunnel';

const ACTIVITY_CACHE_KEY = 'hubspot-activity-cache';
const PIPELINE_STORE = 'pipeline-dashboard';
const PIPELINE_KEY = 'current';
const BFO_STORE = 'bfo-activity';
const BFO_KEY = 'current';

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readActivityCache() {
  try {
    const raw = userLsGet(ACTIVITY_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Minimal, safe Markdown renderer for the LLM narrative — handles ##/#
// headings, - / • bullet lists, blank-line paragraphs, and **bold**.
// Renders React elements (no raw HTML injection).
function inlineBold(text, keyBase) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1
    ? <strong key={`${keyBase}-b${i}`}>{p}</strong>
    : <span key={`${keyBase}-s${i}`}>{p}</span>));
}

function renderNarrative(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null;
  const flushList = () => {
    if (list) { out.push(<ul key={`ul${out.length}`} className={styles.narList}>{list}</ul>); list = null; }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) { flushList(); return; }
    const h2 = line.match(/^##\s+(.*)$/);
    const h1 = line.match(/^#\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (h2) { flushList(); out.push(<h4 key={`h${idx}`} className={styles.narHead}>{inlineBold(h2[1], `h${idx}`)}</h4>); return; }
    if (h1) { flushList(); out.push(<h3 key={`h${idx}`} className={styles.narHead}>{inlineBold(h1[1], `h${idx}`)}</h3>); return; }
    if (bullet) { list = list || []; list.push(<li key={`li${idx}`}>{inlineBold(bullet[1], `li${idx}`)}</li>); return; }
    flushList();
    out.push(<p key={`p${idx}`} className={styles.narP}>{inlineBold(line, `p${idx}`)}</p>);
  });
  flushList();
  return out;
}

// A tile can carry a standing weekly target. `goal` is the number to hit
// (null when none is set) and `onGoal` commits a new one; pass neither and
// the tile renders exactly as it always did. The target is weekly, so the
// caller only wires it up in week mode — a week's worth of work measured
// against a single day would read as failure every day.
const EMPTY_TARGETS = {};

function StatTile({ value, label, accent, sub, goal = null, onGoal }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editable = typeof onGoal === 'function';

  function open() {
    setDraft(goal == null ? '' : String(goal));
    setEditing(true);
  }
  function commit() {
    const t = draft.trim();
    // An emptied box clears the target rather than storing 0, which would
    // otherwise read as "hit it" on a week with no activity at all.
    if (t === '') onGoal(null);
    else {
      const n = Math.round(Number(t));
      if (Number.isFinite(n) && n > 0) onGoal(n);
    }
    setEditing(false);
  }

  const pct = goal > 0 ? Math.min(100, Math.round((Number(value) || 0) / goal * 100)) : 0;
  const hit = goal > 0 && (Number(value) || 0) >= goal;

  return (
    <div className={styles.tile} data-accent={accent || undefined}>
      <div className={styles.tileValue}>{value}</div>
      <div className={styles.tileLabel}>{label}</div>
      {sub ? <div className={styles.tileSub}>{sub}</div> : null}
      {editable && (
        editing ? (
          <input
            className={styles.goalInput}
            type="number"
            min="1"
            step="1"
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder="per week"
            aria-label={`Weekly target for ${label}`}
          />
        ) : goal > 0 ? (
          <button type="button" className={styles.goalRow} onClick={open} title={`Weekly target: ${goal}. Click to change, clear the box to drop it.`}>
            <span className={styles.goalBar} data-hit={hit ? 'yes' : undefined}>
              <span className={styles.goalFill} style={{ width: `${pct}%` }} />
            </span>
            <span className={styles.goalNum}>/{goal}</span>
          </button>
        ) : (
          <button type="button" className={styles.goalSet} onClick={open} title={`Set a weekly target for ${label}`}>
            + Set goal
          </button>
        )
      )}
    </div>
  );
}


// Exact dollars for the KPI detail lines; compact for the headline figure,
// where "$1.9M" reads at a glance and the extra digits don't.
const fmtDollars = (n) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '-');
function fmtCompactMoney(n) {
  if (!Number.isFinite(n)) return '-';
  const a = Math.abs(n);
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3).toLocaleString('en-US')}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

// One headline KPI: the number, a verdict chip, and the arithmetic behind
// it. `status` ('ahead' | 'behind' | null) colours the card and the chip;
// without one the card stays neutral rather than guessing a verdict.
function KpiTile({ label, value, status, chip, lines = [] }) {
  return (
    <div className={styles.kpi} data-status={status || undefined}>
      <div className={styles.kpiLabel}>{label}</div>
      {/* Chip beside the number rather than beside the label: the labels are
          different lengths, and hanging the chip off them dropped one card's
          value a line below the others. */}
      <div className={styles.kpiValueRow}>
        <span className={styles.kpiValue}>{value}</span>
        {chip && <span className={styles.kpiChip}>{chip}</span>}
      </div>
      {lines.filter(Boolean).map((line, i) => (
        <div key={i} className={styles.kpiLine}>{line}</div>
      ))}
    </div>
  );
}

// A named change list with the account/scope + a per-row suffix.
function ChangeList({ title, items, suffix }) {
  if (!items || !items.length) return null;
  const who = (x) => [x.account, x.scope].filter(Boolean).join(': ') || `Opp ${x.id}`;
  return (
    <div className={styles.changeGroup}>
      <div className={styles.changeTitle}>{title} <span className={styles.changeCount}>{items.length}</span></div>
      <ul className={styles.changeItems}>
        {items.slice(0, 30).map((x, i) => (
          <li key={x.id || i}>
            <span className={styles.changeWho}>{who(x)}</span>
            {suffix ? <span className={styles.changeSuffix}>{suffix(x)}</span> : null}
          </li>
        ))}
        {items.length > 30 && <li className={styles.changeMore}>…and {items.length - 30} more</li>}
      </ul>
    </div>
  );
}

const fmtMoneySigned = (n) => (Number.isFinite(n)
  ? `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
  : '-');

// One stored week in the review history. Collapsed it's a row of the headline
// numbers; expanded it shows the full review the way the current week renders.
function ReviewCard({ review, weekLabel }) {
  if (!review) return null;
  return (
    <div className={styles.reviewBody}>
      {review.headline && <p className={styles.reviewHeadline}>{review.headline}</p>}
      {review.targetOutlook && <p className={styles.reviewOutlook}>{review.targetOutlook}</p>}
      {Array.isArray(review.blockers) && review.blockers.length > 0 && (
        <>
          <h4 className={styles.reviewSubhead}>What&rsquo;s holding you back</h4>
          <ol className={styles.blockerList}>
            {review.blockers.map((b, i) => (
              <li key={`${weekLabel}-b${i}`} className={styles.blocker}>
                <div className={styles.blockerTop}>
                  <span className={styles.areaChip} data-area={b.area}>{b.area}</span>
                  {b.severity && <span className={styles.sevChip} data-sev={b.severity}>{b.severity}</span>}
                  <span className={styles.blockerTitle}>{b.title}</span>
                </div>
                {b.evidence && <div className={styles.blockerLine}><span className={styles.blockerLabel}>Evidence</span>{b.evidence}</div>}
                {b.impact && <div className={styles.blockerLine}><span className={styles.blockerLabel}>Impact</span>{b.impact}</div>}
                {b.action && <div className={styles.blockerLine}><span className={styles.blockerLabel}>Do this</span>{b.action}</div>}
              </li>
            ))}
          </ol>
        </>
      )}
      {Array.isArray(review.working) && review.working.length > 0 && (
        <>
          <h4 className={styles.reviewSubhead}>Working</h4>
          <ul className={styles.narList}>{review.working.map((w, i) => <li key={`w${i}`}>{w}</li>)}</ul>
        </>
      )}
      {Array.isArray(review.focus) && review.focus.length > 0 && (
        <>
          <h4 className={styles.reviewSubhead}>Focus next week</h4>
          <ul className={styles.narList}>{review.focus.map((f, i) => <li key={`f${i}`}>{f}</li>)}</ul>
        </>
      )}
    </div>
  );
}

export function WeeklyReportView({ settings, updateSettings, cdmName = '' }) {
  const { user } = useAuth();
  const senderEmail = String(settings?.workEmail || '').toLowerCase().trim();

  // Standing weekly targets for the tiles, in settings so they hold from one
  // week to the next: { emails: 25, newOpps: 5 }. A metric with no entry has
  // no target, and setting one to null drops it again.
  const weeklyTargets = settings?.weeklyTargets || EMPTY_TARGETS;
  const setWeeklyTarget = useCallback((key, n) => {
    if (typeof updateSettings !== 'function') return;
    const next = { ...(settings?.weeklyTargets || {}) };
    if (n == null) delete next[key];
    else next[key] = n;
    updateSettings({ weeklyTargets: next });
  }, [settings, updateSettings]);

  const [mode, setMode] = useState('week'); // 'week' | 'day'
  const [refDate, setRefDate] = useState(todayIso);

  const [cache, setCache] = useState(() => readActivityCache());
  const [oppsRecords, setOppsRecords] = useState([]);
  const [goals, setGoals] = useState([]);
  const [pipeline, setPipeline] = useState(null);
  const [coachingRules, setCoachingRules] = useState(null);
  // Values the user has pinned onto the YOY charts. The projection tile
  // reads the Annual Sales "Projected" bar, so a pin on that bar has to
  // reach here or the tile and the chart disagree again.
  const [yoyOverrides, setYoyOverrides] = useState(loadYoyOverrides);

  // Weekly review (YOY + Pipeline + Progress) and its saved history.
  const [bfo, setBfo] = useState(null);
  const [progressWeeks, setProgressWeeks] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [expandedWeek, setExpandedWeek] = useState('');
  // Guards the once-per-week auto-run so a re-render (or a failed attempt)
  // can't fire a second request for the same week.
  const autoRunRef = useRef('');

  const [narrative, setNarrative] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [copyFlash, setCopyFlash] = useState('');
  // The period the current narrative was generated for — so switching
  // week/day or date makes the stale recap obvious.
  const genForRef = useRef('');

  // Load everything on mount and whenever the window regains focus (so a
  // fresh Opps paste or HubSpot refresh elsewhere shows up here).
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setCache(readActivityCache());
      loadOppsFromCache().then(o => { if (!cancelled) setOppsRecords(o?.records || []); }).catch(() => {});
      loadGoals().then(g => { if (!cancelled) setGoals(Array.isArray(g) ? g : []); }).catch(() => {});
      dbGet(PIPELINE_STORE, PIPELINE_KEY).then(p => { if (!cancelled) setPipeline(p || null); }).catch(() => {});
      dbGet(BFO_STORE, BFO_KEY).then(b => { if (!cancelled) setBfo(b || null); }).catch(() => { if (!cancelled) setBfo(null); });
      setYoyOverrides(loadYoyOverrides());
    };
    refresh();
    window.addEventListener('focus', refresh);
    // Saving an override fires this in the same window; 'focus' alone would
    // miss a pin made on the YOY tab without leaving the browser.
    window.addEventListener(YOY_OVERRIDES_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      window.removeEventListener(YOY_OVERRIDES_EVENT, refresh);
    };
  }, []);

  // Coaching rules stream (optional context for the narrative).
  useEffect(() => {
    if (!user?.uid) return undefined;
    const unsub = subscribeToCoachingRules(user.uid, (r) => setCoachingRules(r || null));
    return () => { try { unsub && unsub(); } catch { /* noop */ } };
  }, [user?.uid]);

  // Progress-tab weekly snapshots + this user's saved reviews. Both live in
  // Firestore; a failure here leaves the review generatable but unsaved, so
  // the error is surfaced rather than swallowed.
  useEffect(() => {
    if (!user?.uid) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const weeks = await loadProgressWeeks(user.uid);
        if (!cancelled) setProgressWeeks(weeks);
      } catch (err) {
        console.warn('Weekly review: progress history load failed', err);
      }
      try {
        const saved = await loadWeeklyReviews(user.uid);
        if (!cancelled) setReviews(saved);
      } catch (err) {
        if (!cancelled) {
          setReviewError(`Couldn’t load saved reviews: ${err?.message || err}`);
        }
      } finally {
        if (!cancelled) setReviewsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  const bounds = useMemo(
    () => (mode === 'day' ? dayBounds(refDate) : weekBounds(refDate)),
    [mode, refDate],
  );
  const label = useMemo(() => periodLabel(refDate, mode), [refDate, mode]);

  const activity = useMemo(
    () => computeActivity(cache, senderEmail, bounds.start, bounds.end),
    [cache, senderEmail, bounds],
  );
  const oppChanges = useMemo(
    () => computeOppChanges(oppsRecords, bounds.start, bounds.end),
    [oppsRecords, bounds],
  );
  const goalsProg = useMemo(
    () => computeGoalsProgress(goals, bounds.start, bounds.end),
    [goals, bounds],
  );
  const pipelineSummary = useMemo(() => pipelineSnapshotLines(pipeline), [pipeline]);

  const statsText = useMemo(() => serializeReport({
    label, activity, oppChanges, goals: goalsProg, pipelineSummary,
  }), [label, activity, oppChanges, goalsProg, pipelineSummary]);

  // ---- Weekly review ----------------------------------------------------
  // The review always covers the current week off the latest cached chart
  // data; the date picker above only scopes the activity report below it.
  const reviewSnapshot = useMemo(() => buildReviewSnapshot({
    pipeline, bfo, oppsRecords, progressWeeks, yoyOverrides, cdmName,
  }), [pipeline, bfo, oppsRecords, progressWeeks, yoyOverrides, cdmName]);
  const currentWeekKey = reviewSnapshot.weekKey;

  // ---- Headline KPIs ----------------------------------------------------
  // Year-scoped, so like the review they ignore the week/day picker above:
  // "am I going to make the number" doesn't change because you looked at
  // last Tuesday. Each card carries the arithmetic behind it so a figure
  // that looks wrong can be traced without opening the Pipeline tab.
  const kpis = useMemo(() => headlineKpis(reviewSnapshot), [reviewSnapshot]);

  // ---- Pipeline funnel --------------------------------------------------
  // The same chart the Pipeline tab draws under its metrics table, from the
  // same three cached sources (dashboard goals + manual actuals, pasted BFO
  // rows for live stage actuals, Opps 2 for the rolling close rates) via the
  // shared builder — so the two pages can't show different funnels.
  //
  // Its outcome block reads the KPI row's own sold-YTD and target rather
  // than the dashboard's hand-entered Closed YTD, so the "Closed YTD" it
  // draws is the figure printed in the card directly above it.
  const funnelStages = useMemo(() => buildFunnelStages({
    stages: Array.isArray(pipeline?.stages) ? pipeline.stages : [],
    bfoMetrics: bfoStageMetrics(bfo),
    hasBfo: !!(bfo && Array.isArray(bfo.rows) && bfo.rows.length),
    closeRates: closeRatesByStage(oppsRecords),
  }), [pipeline, bfo, oppsRecords]);
  const funnelOutcome = useMemo(() => ({
    soldLabel: 'Closed YTD',
    // Null, not 0, when nothing is cached: the funnel then draws what the
    // pipeline alone is worth and says the closed figure is missing, rather
    // than adding to a hollow zero.
    soldAmount: kpis.progressToTarget.soldYTD,
    soldCount: kpis.progressToTarget.deals,
    target: kpis.target || 0,
  }), [kpis]);
  // Nothing to draw without stage rows — or with rows that are all zero,
  // which is what a dashboard record seeded but never filled in looks like.
  const funnelReady = funnelStages.length > 0
    && funnelStages.some(st => st.amtActual > 0 || st.countActual > 0);
  const kpiCards = useMemo(() => {
    const { progressToTarget: p, coverageRatio: c, projectedYearEnd: j } = kpis;
    const yearGone = (v) => (v == null ? '' : `${v.toFixed(0)}% of the year gone`);
    const dealsBit = p.deals ? ` across ${p.deals} deal${p.deals === 1 ? '' : 's'}` : '';

    const progressLines = [];
    if (p.target == null) {
      progressLines.push('Set an annual target on Charts → Pipeline.');
    } else if (p.soldYTD == null) {
      progressLines.push(`Target ${fmtDollars(p.target)} · open Opps 2 so this year’s closes are cached.`);
    } else {
      progressLines.push(`${fmtDollars(p.soldYTD)} sold of ${fmtDollars(p.target)}${dealsBit}`);
      if (p.paceDelta != null) {
        progressLines.push(`${fmtDollars(Math.abs(p.paceDelta))} ${p.paceDelta >= 0 ? 'ahead of' : 'behind'} pace · ${yearGone(p.yearElapsedPct)}`);
      }
      if (p.gapToTarget != null && p.gapToTarget > 0) {
        progressLines.push(`${fmtDollars(p.gapToTarget)} still to sell this year`);
      }
    }

    const coverageLines = [];
    if (c.actual == null) {
      coverageLines.push(c.target == null
        ? 'Set an annual target on Charts → Pipeline.'
        : 'Paste BFO Activity so open pipeline can be measured.');
      if (c.goal != null) coverageLines.push(`Goal ${c.goal.toFixed(2)}×`);
    } else {
      coverageLines.push(`${fmtDollars(c.pipelineActual)} open pipeline ÷ ${fmtDollars(c.target)} target`);
      if (c.goal != null) {
        const d = c.actual - c.goal;
        coverageLines.push(`Goal ${c.goal.toFixed(2)}× · ${Math.abs(d).toFixed(2)}× ${d >= 0 ? 'above' : 'short'}`);
      }
      if (!c.live) coverageLines.push('Stage actuals are the last hand-entered values.');
    }

    const projectedLines = [];
    if (j.amount == null) {
      projectedLines.push('Open Opps 2 so this year’s closes can be projected.');
    } else if (j.overridden) {
      projectedLines.push('Pinned on the YOY Annual Sales chart');
    } else if (j.soldYTD != null && j.committedAmount != null) {
      projectedLines.push(`${fmtDollars(j.soldYTD)} sold + ${fmtDollars(j.committedAmount)} in agreements out`);
    }
    if (j.amount != null && j.gap != null) {
      projectedLines.push(`${fmtDollars(Math.abs(j.gap))} ${j.gap >= 0 ? 'above' : 'under'} the ${fmtDollars(j.target)} target`);
    }

    return [
      {
        key: 'progress',
        label: 'Progress to target',
        value: p.pct == null ? '—' : `${p.pct.toFixed(1)}%`,
        status: p.status,
        chip: p.status ? (p.status === 'ahead' ? 'Ahead of pace' : 'Behind pace') : null,
        lines: progressLines,
      },
      {
        key: 'coverage',
        label: 'Coverage ratio',
        value: c.actual == null ? '—' : `${c.actual.toFixed(2)}×`,
        status: c.status,
        chip: c.status ? (c.status === 'ahead' ? 'At goal' : 'Below goal') : null,
        lines: coverageLines,
      },
      {
        key: 'projected',
        label: 'Projected year-end sales',
        value: j.amount == null ? '—' : fmtCompactMoney(j.amount),
        status: j.status,
        chip: j.status ? (j.status === 'ahead' ? 'Clears target' : 'Short of target') : null,
        lines: projectedLines,
      },
    ];
  }, [kpis]);
  // Nothing cached at all — three dashes teach nothing, so say what to open.
  const kpisReady = !!(reviewSnapshot.pipeline || reviewSnapshot.yoy);
  const currentReview = useMemo(
    () => reviews.find(r => r.week === currentWeekKey) || null,
    [reviews, currentWeekKey],
  );
  // Enough of the picture to be worth reviewing: the pipeline goals plus at
  // least one of the data sets that carry actuals.
  const reviewReady = !!(reviewSnapshot.pipeline
    && (reviewSnapshot.yoy || reviewSnapshot.progress || reviewSnapshot.pipeline.hasBfo));

  const runReview = useCallback(async () => {
    if (reviewLoading || !user?.uid) return;
    setReviewLoading(true);
    setReviewError('');
    try {
      const statsText = serializeReviewSnapshot(reviewSnapshot);
      const resp = await apiFetch('/api/weekly-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stats: statsText,
          weekLabel: reviewSnapshot.weekLabel,
          userName: cdmName || user?.displayName || user?.email || '',
          coachingRules,
          // Recent history so the review can track what has and hasn't moved.
          priorReviews: reviews
            .filter(r => r.week !== currentWeekKey)
            .slice(-6)
            .reverse()
            .map(r => ({ week: r.week, headline: r.review?.headline, blockers: r.review?.blockers })),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      // The endpoint streams, so it commits a 200 before it knows whether the
      // review succeeded — a failure after that point arrives as `error` in
      // the body rather than as a status code.
      if (!resp.ok || data?.error) throw new Error(data?.error || `HTTP ${resp.status}`);
      if (!data?.review) throw new Error('No review returned.');

      const entry = {
        week: currentWeekKey,
        weekLabel: reviewSnapshot.weekLabel,
        generatedAt: new Date().toISOString(),
        review: data.review,
        metrics: reviewHighlights(reviewSnapshot),
        statsText,
      };
      // Show it immediately, then persist — a Firestore failure leaves the
      // review on screen with the error rather than losing it silently.
      setReviews(prev => {
        const next = prev.filter(r => r.week !== entry.week);
        next.push(entry);
        next.sort((a, b) => a.week.localeCompare(b.week));
        return next;
      });
      try {
        const merged = await saveWeeklyReview(user.uid, entry, reviews);
        setReviews(merged);
      } catch (err) {
        setReviewError(`Review written but not saved: ${err?.message || err}`);
      }
    } catch (err) {
      setReviewError(err?.message || String(err));
    } finally {
      setReviewLoading(false);
    }
  }, [reviewLoading, user, reviewSnapshot, cdmName, coachingRules, reviews, currentWeekKey]);

  // Auto-run once per week: the first time the page is opened in a week that
  // has no saved review, generate one. Manual re-runs stay available.
  useEffect(() => {
    if (!reviewsLoaded || !user?.uid) return;
    if (currentReview || reviewLoading || reviewError) return;
    if (!reviewReady) return;
    if (autoRunRef.current === currentWeekKey) return;
    autoRunRef.current = currentWeekKey;
    runReview();
  }, [reviewsLoaded, user, currentReview, reviewLoading, reviewError, reviewReady, currentWeekKey, runReview]);

  const reviewHistory = useMemo(
    () => reviews.slice().sort((a, b) => b.week.localeCompare(a.week)),
    [reviews],
  );

  async function copyReview() {
    const entry = currentReview;
    if (!entry) return;
    const text = [
      serializeReview(entry.review, entry.weekLabel || weekRangeLabel(entry.week)),
      '',
      entry.statsText || serializeReviewSnapshot(reviewSnapshot),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyFlash('Copied review to clipboard.');
    } catch {
      setCopyFlash('Copy failed: select and copy manually.');
    }
    window.setTimeout(() => setCopyFlash(''), 2500);
  }

  const periodKey = `${mode}:${refDate}`;
  const narrativeStale = narrative && genForRef.current && genForRef.current !== periodKey;

  const anyData = activity.emails.length || activity.calls.length || activity.meetings.length
    || oppChanges.newOpps.length || oppChanges.closed.length || oppChanges.stageChanges.length
    || oppChanges.closeDateMoves.length || oppChanges.amountUpdates.length || oppChanges.bfoTags.length
    || goalsProg.created.length || goalsProg.archived.length;

  async function generate() {
    if (genLoading) return;
    setGenLoading(true);
    setGenError('');
    try {
      const resp = await apiFetch('/api/week-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stats: statsText,
          periodLabel: label,
          scope: mode,
          userName: user?.displayName || user?.email || '',
          pipelineSummary,
          coachingRules,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);
      if (!data?.narrative) throw new Error('No recap returned.');
      setNarrative(data.narrative);
      genForRef.current = periodKey;
    } catch (err) {
      setGenError(err?.message || String(err));
    } finally {
      setGenLoading(false);
    }
  }

  async function copyReport() {
    const parts = [];
    if (narrative && !narrativeStale) parts.push(narrative.trim(), '');
    parts.push(statsText);
    const text = parts.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyFlash('Copied report to clipboard.');
    } catch {
      setCopyFlash('Copy failed: select and copy manually.');
    }
    window.setTimeout(() => setCopyFlash(''), 2500);
  }

  const isCurrent = refDate === todayIso();

  const [emailModalOpen, setEmailModalOpen] = useState(false);

  // What the scheduled email will send. The report's numbers come from
  // caches that only exist in this browser, so rather than have the server
  // recompute them (a second copy of the same arithmetic, free to drift)
  // the tab publishes what it rendered and the cron mails that back.
  const emailSnapshot = useMemo(() => {
    const who = (x) => [x.account, x.scope].filter(Boolean).join(': ') || `Opp ${x.id}`;
    const list = (arr, fmt) => (Array.isArray(arr) ? arr : []).map(fmt);
    return {
      scope: mode,
      periodLabel: label,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      kpiCards: kpisReady ? kpiCards.map(c => ({ label: c.label, value: c.value, status: c.status, chip: c.chip, lines: c.lines })) : [],
      tiles: [
        { label: 'Emails sent', value: activity.emails.length, goal: weeklyTargets.emails ?? null, accent: 'blue' },
        { label: 'New opps', value: oppChanges.newOpps.length, goal: weeklyTargets.newOpps ?? null, accent: 'green' },
      ],
      oppChanges: {
        closed: list(oppChanges.closed, x => `${who(x)} → ${x.stage}${x.amount ? ` (${x.amount})` : ''}`),
        newOpps: list(oppChanges.newOpps, x => `${who(x)}${x.stage ? ` (${x.stage})` : ''}`),
        stageChanges: list(oppChanges.stageChanges, x => `${who(x)} → ${x.stage}`),
        closeDateMoves: list(oppChanges.closeDateMoves, x => `${who(x)}${x.closeDate ? ` → ${x.closeDate}` : ''}`),
        amountUpdates: list(oppChanges.amountUpdates, x => `${who(x)}${x.amount ? ` → ${x.amount}` : ''}`),
        bfoTags: list(oppChanges.bfoTags, x => `${who(x)}${x.bfo ? ` → ${x.bfo}` : ''}`),
      },
      // Only ship a recap that was written for this period; a stale one
      // would describe a different week under this week's heading.
      narrative: narrativeStale ? '' : narrative,
    };
  }, [mode, label, bounds, kpisReady, kpiCards, activity, oppChanges, weeklyTargets, narrative, narrativeStale]);

  // Publish on a debounce whenever the snapshot changes and there is
  // something in it worth sending. Only the current period is published:
  // paging back to an old week is a look, not a new thing to email. A
  // failed upload is swallowed — it must never break the page being read.
  useEffect(() => {
    if (!user?.uid || !isCurrent || !anyData) return undefined;
    const t = setTimeout(() => { publishSnapshot(emailSnapshot).catch(() => {}); }, 2000);
    return () => clearTimeout(t);
  }, [user?.uid, isCurrent, anyData, emailSnapshot]);


  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Weekly Report</h1>
          <span className={styles.subtitle}>{label}</span>
        </div>
        <div className={styles.toolbar}>
          <div className={styles.modeToggle} role="tablist" aria-label="Report period">
            <button
              type="button"
              className={mode === 'week' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('week')}
            >Week</button>
            <button
              type="button"
              className={mode === 'day' ? styles.modeBtnActive : styles.modeBtn}
              onClick={() => setMode('day')}
            >Day</button>
          </div>
          <label className={styles.dateField} title="Pick any date; the report covers that day or the Mon–Sun week containing it.">
            <input
              type="date"
              className={styles.dateInput}
              value={refDate}
              max={todayIso()}
              onChange={(e) => setRefDate(e.target.value || todayIso())}
            />
          </label>
          {!isCurrent && (
            <button type="button" className={styles.ghostBtn} onClick={() => setRefDate(todayIso())} title="Jump to the current period">
              {mode === 'day' ? 'Today' : 'This week'}
            </button>
          )}
          <button type="button" className={styles.primaryBtn} onClick={generate} disabled={genLoading || !anyData}>
            {genLoading ? 'Writing…' : (narrative && !narrativeStale ? 'Regenerate summary' : 'Generate AI summary')}
          </button>
          <button type="button" className={styles.ghostBtn} onClick={copyReport}>Copy report</button>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => setEmailModalOpen(true)}
            title="Send this report on a schedule — e.g. every Monday at 06:00"
          >Email this report</button>
          {copyFlash && <span className={styles.flash}>{copyFlash}</span>}
        </div>
      </div>

      {!senderEmail && (
        <div className={styles.note}>
          Set your work email in <strong>Settings → CDM Name</strong> so sent-email counts can match your outbound HubSpot mail. Calls, meetings, opp changes, and goals still work without it.
        </div>
      )}

      <section className={styles.kpiSection}>
        <div className={styles.kpiHead}>
          <h2 className={styles.sectionHead}>Where the year stands</h2>
          <span className={styles.kpiHeadNote}>
            Year to date — not scoped to the week picker
          </span>
        </div>
        {kpisReady ? (
          <div className={styles.kpiRow}>
            {kpiCards.map(({ key, ...card }) => <KpiTile key={key} {...card} />)}
          </div>
        ) : (
          <div className={styles.empty}>
            No chart data cached yet. Open <strong>Charts → Pipeline</strong> (and paste BFO Activity) to seed the target, pipeline and run rate.
          </div>
        )}
      </section>

      <section className={styles.funnelSection}>
        <div className={styles.kpiHead}>
          <h2 className={styles.sectionHead}>Pipeline funnel</h2>
          <span className={styles.kpiHeadNote}>
            The Charts → Pipeline funnel, off the same cached numbers
          </span>
        </div>
        {funnelReady ? (
          <div className={styles.funnelCard}>
            <PipelineFunnel stages={funnelStages} outcome={funnelOutcome} />
          </div>
        ) : (
          <div className={styles.empty}>
            No stage volumes cached yet. Open <strong>Charts → Pipeline</strong> (and paste BFO Activity) so the funnel has stage actuals to draw.
          </div>
        )}
      </section>

      {/* Emails sent and New opps are the two the week is steered by, so they
          are the two that carry a target. Everything else that used to have a
          tile here — calls, meetings, deals closed, stage changes, amount
          updates, BFO tags, goals opened and closed — is still counted and
          still listed in full further down the page; it just no longer takes
          up a tile. */}
      <div className={styles.tiles}>
        <StatTile
          value={activity.emails.length}
          label="Emails sent"
          accent="blue"
          goal={weeklyTargets.emails ?? null}
          onGoal={mode === 'week' ? (n => setWeeklyTarget('emails', n)) : undefined}
        />
        <StatTile
          value={oppChanges.newOpps.length}
          label="New opps"
          accent="green"
          goal={weeklyTargets.newOpps ?? null}
          onGoal={mode === 'week' ? (n => setWeeklyTarget('newOpps', n)) : undefined}
        />
      </div>

      <section className={styles.reviewSection}>
        <div className={styles.reviewHead}>
          <div>
            <h2 className={styles.sectionHead}>Weekly review: what&rsquo;s holding you back</h2>
            <div className={styles.reviewSub}>
              Reads your YOY, Pipeline and Progress numbers for {reviewSnapshot.weekLabel} and records the verdict each week.
            </div>
          </div>
          <div className={styles.reviewActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={runReview}
              disabled={reviewLoading || !reviewReady || !user?.uid}
              title={reviewReady ? 'Re-run this week’s review against the latest data' : 'Load the Pipeline dashboard first'}
            >
              {reviewLoading ? 'Reviewing…' : (currentReview ? 'Re-run review' : 'Run review')}
            </button>
            {currentReview && (
              <button type="button" className={styles.ghostBtn} onClick={copyReview}>Copy review</button>
            )}
          </div>
        </div>

        {reviewError && <div className={styles.error}>{reviewError}</div>}
        {reviewLoading && <div className={styles.note}>Reviewing your charts against the target…</div>}

        {!reviewReady && !reviewLoading && (
          <div className={styles.empty}>
            Not enough chart data cached yet. Open <strong>Charts → Pipeline</strong> (and paste BFO Activity) so the review has goals and actuals to work from.
          </div>
        )}

        {reviewSnapshot.missing.length > 0 && reviewReady && (
          <div className={styles.note}>
            Reviewed without: {reviewSnapshot.missing.join('; ')}.
          </div>
        )}

        {currentReview && !reviewLoading && (
          <>
            <ReviewCard review={currentReview.review} weekLabel={currentReview.week} />
            <div className={styles.reviewStamp}>
              Recorded {new Date(currentReview.generatedAt).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
            </div>
          </>
        )}

        {reviewHistory.length > 0 && (
          <div className={styles.historyWrap}>
            <h3 className={styles.historyHead}>Review history <span className={styles.changeCount}>{reviewHistory.length}</span></h3>
            <table className={styles.historyTable}>
              <thead>
                <tr>
                  <th>Week</th>
                  <th className={styles.numCol}>Quota</th>
                  <th className={styles.numCol}>Gap to target</th>
                  <th className={styles.numCol}>Coverage</th>
                  <th className={styles.numCol}>Stalled</th>
                  <th>Top blocker</th>
                  <th className={styles.numCol}>Blockers</th>
                </tr>
              </thead>
              <tbody>
                {reviewHistory.map((entry) => {
                  const m = entry.metrics || {};
                  const top = entry.review?.blockers?.[0];
                  const open = expandedWeek === entry.week;
                  return (
                    <Fragment key={entry.week}>
                      <tr
                        className={open ? styles.historyRowOpen : styles.historyRow}
                        onClick={() => setExpandedWeek(open ? '' : entry.week)}
                        title="Click to show the full review"
                      >
                        <td>{entry.weekLabel || weekRangeLabel(entry.week)}</td>
                        <td className={styles.numCol}>{m.pctOfQuota == null ? '-' : `${m.pctOfQuota}%`}</td>
                        <td className={styles.numCol}>{fmtMoneySigned(m.gapToTarget)}</td>
                        <td className={styles.numCol}>
                          {m.coverageActual == null ? '-' : `${m.coverageActual}${m.coverageGoal != null ? ` / ${m.coverageGoal}` : ''}`}
                        </td>
                        <td className={styles.numCol}>{m.stalledOpps == null ? '-' : m.stalledOpps}</td>
                        <td>
                          {top ? (
                            <>
                              <span className={styles.areaChip} data-area={top.area}>{top.area}</span>
                              {top.title}
                            </>
                          ) : '-'}
                        </td>
                        <td className={styles.numCol}>{entry.review?.blockers?.length ?? 0}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} className={styles.historyDetail}>
                            <ReviewCard review={entry.review} weekLabel={entry.week} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {reviewsLoaded && reviewHistory.length === 0 && !reviewLoading && reviewReady && (
          <div className={styles.mutedRow}>No reviews recorded yet: the first one runs automatically.</div>
        )}
      </section>

      {(narrative || genError || genLoading) && (
        <div className={styles.narrative}>
          {genLoading && <div className={styles.note}>Writing your {mode === 'day' ? 'day' : 'week'} recap…</div>}
          {genError && <div className={styles.error}>Couldn’t write the recap: {genError}</div>}
          {narrative && !genLoading && (
            <>
              {narrativeStale && (
                <div className={styles.staleTag}>This recap was written for a different period: regenerate to refresh.</div>
              )}
              <div className={styles.narBody}>{renderNarrative(narrative)}</div>
            </>
          )}
        </div>
      )}

      <WeeklyReportEmailModal
        open={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        uid={user?.uid}
        defaultRecipient={settings?.workEmail || user?.email || ''}
        snapshot={emailSnapshot}
      />

      {!anyData && (
        <div className={styles.empty}>
          No tracked work found for this {mode === 'day' ? 'day' : 'week'}. Activity comes from the HubSpot cache (refresh it on the Activity tab), opp changes from edits made on the Opps tab, and goals from your Daily Success goals. Older changes made before the tool started stamping timestamps won’t appear.
        </div>
      )}

      <div className={styles.sections}>
        <section className={styles.section}>
          <h2 className={styles.sectionHead}>Opportunity changes</h2>
          {(oppChanges.closed.length + oppChanges.newOpps.length + oppChanges.stageChanges.length
            + oppChanges.closeDateMoves.length + oppChanges.amountUpdates.length + oppChanges.bfoTags.length) === 0 ? (
            <div className={styles.mutedRow}>No opp changes recorded this {mode === 'day' ? 'day' : 'week'}.</div>
          ) : (
            <>
              <ChangeList title="Deals closed" items={oppChanges.closed} suffix={x => ` → ${x.stage}${x.amount ? ` (${x.amount})` : ''}`} />
              <ChangeList title="New opps" items={oppChanges.newOpps} suffix={x => (x.stage ? ` (${x.stage})` : '')} />
              <ChangeList title="Stage changes" items={oppChanges.stageChanges} suffix={x => ` → ${x.stage}`} />
              <ChangeList title="Close-date moves" items={oppChanges.closeDateMoves} suffix={x => (x.closeDate ? ` → ${x.closeDate}` : '')} />
              <ChangeList title="Amount updates" items={oppChanges.amountUpdates} suffix={x => (x.amount ? ` → ${x.amount}` : '')} />
              <ChangeList title="BFO Opportunity Names tagged" items={oppChanges.bfoTags} suffix={x => (x.bfo ? ` → ${x.bfo}` : '')} />
              <div className={styles.caveat}>
                “New opps” is a best-effort estimate: opps first edited in the tool this period may appear here even if created earlier, since the data carries no dedicated creation date.
              </div>
            </>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionHead}>Goals</h2>
          {goalsProg.created.length > 0 && (
            <div className={styles.changeGroup}>
              <div className={styles.changeTitle}>Set this {mode === 'day' ? 'day' : 'week'} <span className={styles.changeCount}>{goalsProg.created.length}</span></div>
              <ul className={styles.changeItems}>
                {goalsProg.created.map(g => <li key={g.id}><span className={styles.changeWho}>{String(g.text || '').trim()}</span></li>)}
              </ul>
            </div>
          )}
          {goalsProg.archived.length > 0 && (
            <div className={styles.changeGroup}>
              <div className={styles.changeTitle}>Completed / closed <span className={styles.changeCount}>{goalsProg.archived.length}</span></div>
              <ul className={styles.changeItems}>
                {goalsProg.archived.map(g => <li key={g.id}><span className={styles.changeWho}>{String(g.text || '').trim()}</span></li>)}
              </ul>
            </div>
          )}
          {goalsProg.active.length > 0 ? (
            <div className={styles.changeGroup}>
              <div className={styles.changeTitle}>Active goals <span className={styles.changeCount}>{goalsProg.active.length}</span></div>
              <ul className={styles.changeItems}>
                {goalsProg.active.slice(0, 12).map(g => (
                  <li key={g.id}>
                    {g.priority != null && <span className={styles.pill}>#{g.priority}</span>}
                    <span className={styles.changeWho}>{String(g.text || '').trim()}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className={styles.mutedRow}>No active goals. Add some in the Daily Success Log → Goals.</div>
          )}
          {pipelineSummary && (
            <div className={styles.changeGroup}>
              <div className={styles.changeTitle}>Pipeline snapshot</div>
              <pre className={styles.pipelinePre}>{pipelineSummary}</pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
