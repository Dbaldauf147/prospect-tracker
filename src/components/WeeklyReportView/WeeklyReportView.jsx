// End-of-week (or end-of-day) work summary. Reads what already lives in
// the tool — the HubSpot activity cache, the Opps 2 field-change
// timestamps, and the Daily Success goals — scopes it to the selected
// week or day, shows the hard numbers, and (on demand) asks Claude to
// write a short narrative recap over them.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './WeeklyReportView.module.css';
import { WeeklyReportEmailModal } from './WeeklyReportEmailModal';
import { WeeklyReportEmailPreview } from './WeeklyReportEmailPreview';
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
import { buildReviewSnapshot, headlineKpis } from '../../utils/weeklyReview';
import { loadProgressWeeks } from '../../utils/weeklyReviewStore';
import { loadYoyOverrides, YOY_OVERRIDES_EVENT } from '../../utils/yoyOverridesStore';
import {
  loadWeeklyActivityLog, weeklyActivityEntry, liveCacheCovers, WEEKLY_ACTIVITY_EVENT,
} from '../../utils/weeklyActivityLog';
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

// When a tile's number came from the Activity tab's recording rather
// than the live feed, the tile says so — and when: a stale recording
// explains a number that doesn't match what you did this morning.
function fmtRecordedAt(ms) {
  if (!Number.isFinite(ms)) return 'from Activity';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// A tile can carry a standing weekly target. `goal` is the number to hit
// (null when none is set) and `onGoal` commits a new one; pass neither and
// the tile renders exactly as it always did. The target is weekly, so the
// caller only wires it up in week mode — a week's worth of work measured
// against a single day would read as failure every day.
const EMPTY_TARGETS = {};

function StatTile({ value, label, accent, sub, subTitle, goal = null, onGoal }) {
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
      {sub ? <div className={styles.tileSub} title={subTitle || undefined}>{sub}</div> : null}
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
  // Per-week totals the Activity tab banked off the full HubSpot feed.
  // The raw feed above is routinely too big for localStorage and gets
  // dropped, which is why last week's "Emails sent" used to read 0.
  const [activityLog, setActivityLog] = useState(loadWeeklyActivityLog);
  const [oppsRecords, setOppsRecords] = useState([]);
  const [goals, setGoals] = useState([]);
  const [pipeline, setPipeline] = useState(null);
  const [coachingRules, setCoachingRules] = useState(null);
  // Values the user has pinned onto the YOY charts. The projection tile
  // reads the Annual Sales "Projected" bar, so a pin on that bar has to
  // reach here or the tile and the chart disagree again.
  const [yoyOverrides, setYoyOverrides] = useState(loadYoyOverrides);

  // Cached YOY / Pipeline / Progress data behind the headline KPI cards
  // and the funnel.
  const [bfo, setBfo] = useState(null);
  const [progressWeeks, setProgressWeeks] = useState([]);

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
      setActivityLog(loadWeeklyActivityLog());
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
    // Same reasoning for a recording made on the Activity tab.
    window.addEventListener(WEEKLY_ACTIVITY_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
      window.removeEventListener(YOY_OVERRIDES_EVENT, refresh);
      window.removeEventListener(WEEKLY_ACTIVITY_EVENT, refresh);
    };
  }, []);

  // Coaching rules stream (optional context for the narrative).
  useEffect(() => {
    if (!user?.uid) return undefined;
    const unsub = subscribeToCoachingRules(user.uid, (r) => setCoachingRules(r || null));
    return () => { try { unsub && unsub(); } catch { /* noop */ } };
  }, [user?.uid]);

  // Progress-tab weekly snapshots, from Firestore. They feed the headline
  // KPI cards; without them the cards fall back to what the other caches
  // carry, so a failure here is logged rather than surfaced.
  useEffect(() => {
    if (!user?.uid) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const weeks = await loadProgressWeeks(user.uid);
        if (!cancelled) setProgressWeeks(weeks);
      } catch (err) {
        console.warn('Weekly Report: progress history load failed', err);
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

  // Emails sent, from whichever source can actually answer for this
  // period. The live feed wins when it covers the window; otherwise the
  // week's recording from the Activity tab stands in, which is the only
  // thing that survives once the feed has rolled off or been dropped by
  // the storage quota. A day never falls back — the log is weekly.
  const emailsSent = useMemo(() => {
    const live = activity.emails.length;
    if (liveCacheCovers(cache, bounds.start)) return { count: live, recorded: false };
    const entry = mode === 'week' ? weeklyActivityEntry(activityLog, bounds.start) : null;
    if (!entry) return { count: live, recorded: false };
    return { count: entry.emails, recorded: true, at: entry.at };
  }, [activity, cache, activityLog, bounds, mode]);

  const statsText = useMemo(() => serializeReport({
    label, activity, oppChanges, goals: goalsProg, pipelineSummary,
    emailsSent: emailsSent.count,
  }), [label, activity, oppChanges, goalsProg, pipelineSummary, emailsSent]);

  // ---- Chart-data snapshot ----------------------------------------------
  // The KPI cards and funnel below read the latest cached chart data for the
  // year as a whole; the date picker above only scopes the activity report.
  const reviewSnapshot = useMemo(() => buildReviewSnapshot({
    pipeline, bfo, oppsRecords, progressWeeks, yoyOverrides, cdmName,
  }), [pipeline, bfo, oppsRecords, progressWeeks, yoyOverrides, cdmName]);

  // ---- Headline KPIs ----------------------------------------------------
  // Year-scoped, so they ignore the week/day picker above:
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
  // The funnel, reduced to the figures an email can carry. The tab draws it
  // as a chart — band height for pipeline value, segment length for how
  // long deals sit in a stage — which no email client will render, so the
  // stage rows and the outcome block travel as text instead. The numbers
  // are formatted here rather than server-side for the same reason the KPI
  // cards are: a second copy of the arithmetic is free to disagree with
  // what's on screen.
  const funnelSummary = useMemo(() => {
    if (!funnelReady) return null;
    const ordered = funnelStages
      .filter(st => Number.isFinite(st.stageNum))
      .sort((a, b) => a.stageNum - b.stageNum);
    if (!ordered.length) return null;

    // Same arithmetic as the funnel's exit block: each stage's pipeline
    // times the close rate that stage actually runs at, summed.
    const rated = ordered.filter(st => Number(st.closeRate) > 0);
    const weighted = rated.length
      ? rated.reduce((a, st) => a + (Number(st.amtActual) || 0) * Number(st.closeRate), 0)
      : null;
    const sold = funnelOutcome.soldAmount;
    const total = sold != null && weighted != null ? sold + weighted : null;
    const target = Number(funnelOutcome.target) || 0;

    const lives = ordered.map(st => (Number(st.lifeActual) > 0 ? Number(st.lifeActual) : 0));
    const byLife = lives.every(d => d > 0);
    const totalLife = lives.reduce((a, b) => a + b, 0);

    return {
      caption: `Band height = pipeline value, segment length = ${byLife
        ? `avg opp life: ${Math.round(totalLife)} days end to end`
        : 'even (no avg opp life yet)'}.`,
      stages: ordered.map((st, i) => ({
        label: st.label,
        count: Number(st.countActual) || 0,
        amount: fmtDollars(Number(st.amtActual) || 0),
        life: lives[i] > 0 ? `${Math.round(lives[i])} days` : null,
        closeRate: Number(st.closeRate) > 0 ? `${Math.round(Number(st.closeRate) * 100)}%` : null,
      })),
      outcome: {
        soldLabel: funnelOutcome.soldLabel,
        sold: sold == null ? null : fmtCompactMoney(sold),
        weighted: weighted == null ? null : fmtCompactMoney(weighted),
        total: total == null ? null : fmtCompactMoney(total),
        note: total != null && target > 0
          ? `${Math.round((total / target) * 100)}% of ${fmtCompactMoney(target)} target`
          : null,
      },
    };
  }, [funnelReady, funnelStages, funnelOutcome]);

  // Nothing cached at all — three dashes teach nothing, so say what to open.
  const kpisReady = !!(reviewSnapshot.pipeline || reviewSnapshot.yoy);
  const periodKey = `${mode}:${refDate}`;
  const narrativeStale = narrative && genForRef.current && genForRef.current !== periodKey;

  const anyData = emailsSent.count || activity.calls.length || activity.meetings.length
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
  const [previewOpen, setPreviewOpen] = useState(false);

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
      kpiNote: 'Year to date — not scoped to the week picker',
      funnel: funnelSummary,
      // `emailsSent.count`, not the raw live count: for a week the HubSpot
      // feed no longer covers, the Activity tab's recording is the only
      // thing that can answer, and the tile on screen reads off it. Mailing
      // the live count instead is what made a week of sent mail arrive as 0.
      tiles: [
        {
          label: 'Emails sent',
          value: emailsSent.count,
          goal: weeklyTargets.emails ?? null,
          accent: 'blue',
          sub: emailsSent.recorded ? `recorded ${fmtRecordedAt(emailsSent.at)}` : null,
        },
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
      goals: {
        created: list(goalsProg.created, g => String(g.text || '').trim()).filter(Boolean),
        completed: list(goalsProg.archived, g => String(g.text || '').trim()).filter(Boolean),
        // The tab caps the active list at 12; the email shows the same ones
        // rather than a longer list the reader can't reconcile with it.
        active: list(goalsProg.active.slice(0, 12), g => (
          `${g.priority != null ? `#${g.priority} ` : ''}${String(g.text || '').trim()}`
        )).filter(Boolean),
      },
      // Only ship a recap that was written for this period; a stale one
      // would describe a different week under this week's heading.
      narrative: narrativeStale ? '' : narrative,
    };
  }, [mode, label, bounds, kpisReady, kpiCards, funnelSummary, emailsSent, oppChanges,
    goalsProg, weeklyTargets, narrative, narrativeStale]);

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
    // The Charts tab host clips its content (each sub-view lays itself out
    // full-height and scrolls its own body), so the page owns its scroll
    // container. Without it the report is simply cut off at the fold —
    // everything below whatever fits is unreachable. The scroller is the
    // full width so the scrollbar sits at the edge of the pane; the
    // 1100px measure stays on the content column inside it.
    <div className={styles.scroller}>
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
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => setPreviewOpen(true)}
              title="See exactly what the emailed report looks like in an inbox"
            >Preview email</button>
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
            value={emailsSent.count}
            label="Emails sent"
            accent="blue"
            sub={emailsSent.recorded ? `recorded ${fmtRecordedAt(emailsSent.at)}` : null}
            subTitle={"Counted on the Activity tab while it still had this week's HubSpot feed, and kept since."}
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

        {/* The same preview the scheduler offers, reachable without opening
            it: "what does this look like when it lands" is a question about
            the report, not about the schedule. */}
        <WeeklyReportEmailPreview
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          snapshot={anyData || kpisReady ? emailSnapshot : null}
          uid={user?.uid}
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
    </div>
  );
}
