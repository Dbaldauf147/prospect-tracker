// Pipeline dashboard — recreation of the Excel pipeline-metrics
// summary. Every numeric cell is editable; goals and actuals are
// stored together in a single IndexedDB record keyed `current` so
// the layout persists across reloads.

import { Component, createContext, Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './PipelineView.module.css';
import { PipelineFunnel } from './PipelineFunnel';
import { dbGet, dbDelete } from '../../utils/db';
import { bfoStageMetrics, matchStage } from '../../utils/bfoStageMetrics';
import { parseMoney } from '../../utils/oppsMetrics';
import {
  CLOSE_RATE_STAGES, bfoOppNameOf, buildFunnelStages, closeRateTally,
  closeRatesByStage, closedOppEntry,
} from '../../utils/pipelineFunnelData';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { isPullThroughOpp } from '../../utils/pullThrough';
import { sanitizeSheetJsWorkbook } from '../../utils/exportSanitize.js';
import { loadDealsList } from '../../utils/dealsStore';
import { fmtDate } from '../../utils/dealsFormat';
import { loadDealClientMap } from '../../utils/dealClientMap';
import { loadClientManagerMap, loadClientUntrackedMap, loadClientStatusMap } from '../../utils/clientManagerStore';
import { computeExpiringClients, normClientName } from '../../utils/clientIssues';
import { dealSoldTs, daysToFollowUpGoal, followUpGoalLabel, postSaleFollowUpRows } from '../../utils/postSaleFollowUp';
import {
  buildOppStagesByClient,
  buildServiceCatalog,
  computeServiceCoverage,
  coverageClientsOf,
  coverageExclusions,
  serviceLabelMap,
} from '../../utils/serviceCoverage';
import { notifyPipelineDashboardChanged } from '../../utils/pipelineDashboardStore';
import { mirrorDbPut } from '../../utils/localMirrorSync';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';
import { downloadPipelineWorkbook } from '../../utils/pipelineWorkbook';
import { loadList as loadUploadedList } from '../../utils/uploadedListStore';
import { normalizeCompany, pickNameKey } from '../../utils/companyNorm';
import { userLsGet } from '../../utils/userLs';

// Uploaded Strategic Accounts list — same storageKey the Lists tab uses.
const STRATEGIC_STORAGE_KEY = 'strategic-accounts-override';

// Contracts expiring within this many days feed the Pipeline "Client
// Renewals" table — mirrors the Clients tab's renewal-warning threshold.
const RENEWAL_WINDOW_DAYS = 270;

const STORE = 'pipeline-dashboard';
const KEY = 'current';
const BFO_STORE = 'bfo-activity';
const BFO_KEY = 'current';

// Best-effort "opened" timestamp for an Opps row (ms, or NaN when it can't be
// placed on the calendar). Age fields go stale between paste-imports, so we
// prefer, in order:
//   1. The opp's Start Date column when it parses as a real date.
//   2. Otherwise Age interpreted at import time (ageRef − Age days); closed
//      opps (Sold / Not Sold) count back from their Close Date instead.
// Shared by the past-30-days and by-month new-opp tallies.
function oppOpenTs(r, ageRef) {
  const startRaw = String(r['Start Date'] || '').trim();
  if (startRaw) {
    const ts = Date.parse(startRaw);
    if (!Number.isNaN(ts)) return ts;
  }
  const age = Number(String(r.Age ?? '').replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(age) || age < 0) return NaN;
  const stage = (r.Stage || '').trim();
  if (stage === 'Sold' || stage === 'Not Sold') {
    const closeTs = Date.parse(r['Close Date'] || '');
    if (Number.isNaN(closeTs)) return NaN;
    return closeTs - age * 86400000;
  }
  return ageRef - age * 86400000;
}

// Colored countdown cell for the "Days Since Sold — 60 Day Goal" column:
// green while there's a week+ of runway, amber in the final week, red once
// the 60-day deadline has passed. Undated rows render an em dash.
function renderDaysToGoal(soldRaw) {
  const left = daysToFollowUpGoal(soldRaw);
  if (left == null) return <span style={{ color: '#94a3b8' }}>-</span>;
  const color = left < 0 ? '#b91c1c'
    : left <= 7 ? '#92400e'
    : '#166534';
  const title = left < 0
    ? `${Math.abs(left)} days past the 60-day follow-up goal`
    : left === 0 ? 'Follow-up is due today (60-day goal)'
    : `${left} days left to hit the 60-day follow-up goal`;
  return <span style={{ color, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }} title={title}>{followUpGoalLabel(left)}</span>;
}

// The close-rate stage signals, the closed-opp reader and the tally they
// roll into now live in utils/pipelineFunnelData, next to the funnel stage
// rows they also feed — the Weekly Report draws the same funnel and needs
// the same numbers. Imported above; unchanged in behaviour.

// Stages that mean a deal was genuinely quoted. A closed deal that never
// logged time in either of these counts as "not quoted" for the
// "% of deals not Quoted" table.
const QUOTE_STAGES = new Set(['Quoted', 'Agreement Sent']);

// Total days a deal spent in the Quoted / Agreement Sent stages, read from
// its `_stageHistory`. A closed deal (live Stage = Sold / Not Sold) carries
// all of its Quoted / Agreement Sent time in history — the stage it left was
// pushed there with the days it sat in it — so history alone is sufficient.
// Returns 0 when the deal never logged any time in those stages.
function quotedStageDays(r) {
  let total = 0;
  for (const h of (Array.isArray(r?._stageHistory) ? r._stageHistory : [])) {
    if (!QUOTE_STAGES.has(String(h?.stage || '').trim())) continue;
    const d = Number(h?.days);
    if (Number.isFinite(d) && d > 0) total += d;
  }
  return total;
}

// The windows the "% of deals not Quoted" table reports, shortest first.
// Rolling rather than calendar: the table used to show the current
// calendar year beside the current calendar month, which meant the month
// cell was a full month of deals on the 31st and two days of them on the
// 2nd — a number that moved for reasons that had nothing to do with how
// the quoting was going. A trailing window always covers the same span,
// so the three cells are comparable with each other and with themselves
// last week. The 365-day window matches Close Rate's, which is already
// rolling.
//
// `field` is the manual fallback in state, used when the Opps cache has
// no closed deals in that window.
const NOT_QUOTED_WINDOWS = [
  { key: 'd30', days: 30, label: 'Past 30 days', labelId: 'nq-30', field: 'notQuoted30' },
  { key: 'd90', days: 90, label: 'Past 90 days', labelId: 'nq-90', field: 'notQuoted90' },
  { key: 'd365', days: 365, label: 'Past year', labelId: 'nq-365', field: 'notQuoted365' },
];

// The "next move" an opp trips when it sits in a stage past its max target
// age (the Avg Opp Life "Goal (less than)" for that stage). Mirrors the
// STAGE_AGE_GUIDANCE next-move copy so a stalled Stage 4 reads "Quote or kill"
// and a stalled Stage 5 reads "Contract or kill". Stage 6 has no kill move.
const STAGE_KILL_FLAG = {
  3: 'Qualify or kill',
  4: 'Quote or kill',
  5: 'Contract or kill',
  6: null,
};

const DEFAULT_STATE = {
  // User overrides for the fixed table titles / headers / row labels, keyed by
  // the <EL id="…">. Empty means every label shows its code default.
  labels: {},

  // Pipeline metrics by stage. Each stage row is a dict of values.
  // pipelineGoal is seeded here for shape only — it's recomputed on every
  // render as activeGoal × dealSizeGoal (see renderStages).
  stages: [
    { key: 's6', label: 'Stage 6',                       activeGoal: 3,  activeActual: 4,  dealSizeGoal: 125000, dealSizeActual: 58952,  pipelineGoal: 375000,  pipelineActual: 235806,  closeGoal: 0.75, closeActual: 0.50, targetProj: 281250, lifeGoal: 200, lifeActual: 212 },
    { key: 's5', label: 'Stage 5',                       activeGoal: 12, activeActual: 6,  dealSizeGoal: 125000, dealSizeActual: 52146,  pipelineGoal: 1500000, pipelineActual: 578831,  closeGoal: 0.40, closeActual: 0.11, targetProj: 600000, lifeGoal: 150, lifeActual: 68 },
    { key: 's4', label: 'Stage 4',                       activeGoal: 15, activeActual: 13, dealSizeGoal: 150000, dealSizeActual: 154923, pipelineGoal: 2250000, pipelineActual: 1135000, closeGoal: 0.25, closeActual: 0.04, targetProj: 562500, lifeGoal: 90,  lifeActual: 174 },
    { key: 's3', label: 'Stage 3',                       activeGoal: 3,  activeActual: 7,  dealSizeGoal: 150000, dealSizeActual: 153457, pipelineGoal: 450000,  pipelineActual: 1687244, closeGoal: 0.10, closeActual: 0.04, targetProj: 45000,  lifeGoal: 60,  lifeActual: 273 },
  ],

  // Services tracked in the "Service Exploration Coverage" table (canonical
  // service keys). Empty by default — the user adds the services they want to
  // watch, and each row's client breakdown stays collapsed until expanded.
  coverageServices: [],

  currentClientCount: 5,
  currentClientAmt: 320500,
  greenfieldCount: 24,
  greenfieldAmt: 3316381,
  clientGoalPct: 0.45,
  clientActualPct: 0.17,

  coverageGoal: 3.21,
  coverageActual: 2.74,

  // One manual fallback per NOT_QUOTED_WINDOWS entry, shown only when the
  // Opps cache has no closed deals in that window.
  notQuotedGoal: 0.40,
  notQuoted30: 0.40,
  notQuoted90: 0.43,
  notQuoted365: 0.43,

  target: 1325000,
  closedYTD: 17000,

  newOppsGoal: 5,
  newOppsThisMonth: 0,
  newOppsLastMonth: 7,
  activitiesGoal: 45,
  activitiesProjected: 37,
  activitiesThisWeek: 33,
  activitiesLastWeek: 35,

  smallestDeals: [
    { id: '1', account: 'Piedmont Office Realty Trust', oppName: 'SB - SUSUP', amount: 10500 },
    { id: '2', account: 'Divco Capital', oppName: 'SB - SUECO', amount: 15000 },
    { id: '3', account: 'Edward Jones', oppName: 'SB - SUSUP', amount: 17375 },
    { id: '4', account: 'Deloitte', oppName: 'SB - SUSUP', amount: 22000 },
    { id: '5', account: 'Brookfield Asset Management', oppName: 'SB - SUSUP', amount: 25000 },
  ],
  notSoldQuoted: [
    { id: '1', account: 'Lineage Logistics (a B...)', scope: 'Audits', age: 51, finalMargin: 0.46, quoted: 105400 },
    { id: '2', account: 'Brookfield (Self Storage)', scope: 'Audits', age: 32, finalMargin: 0.47, quoted: 16000 },
    { id: '3', account: 'CBRE Inc (CBRE) - H', scope: 'Invoice collection', age: 54, finalMargin: 0.47, quoted: 59100 },
    { id: '4', account: 'Park Hotels & Resorts', scope: 'ECH, BPS Reporting', age: 48, finalMargin: 0.46, quoted: 15000 },
    { id: '5', account: 'Westinghouse (a Brod...)', scope: 'Cat 1 & 2', age: 505, finalMargin: 0.45, quoted: 18500 },
  ],
  notQuoted: [
    { id: '1', account: 'Edens (a Blacks...)', scope: 'Strategic sourcing', closeDate: '2026-04-29', age: 28 },
    { id: '2', account: 'Tishman Speyer', scope: 'RA dashboards', closeDate: '2026-04-22', age: 85 },
    { id: '3', account: 'Liberty Mutual', scope: 'Capital asset planning', closeDate: '2026-04-13', age: 53 },
    { id: '4', account: 'Realterm', scope: 'E.E.D.', closeDate: '2026-04-13', age: 96 },
  ],

  // Free-text strategy notes shown at the bottom of the page. Each is an
  // editable textarea that saves to the browser alongside the metrics.
  notesDistractions: `1.  Deprioritize these services (Arc, GRESB, ECH, etc.)
2.  Refocus energy away from Brookfield (or other accounts that need saving)
3.  Partner on smaller opportunities
4.  Focus on quality vs. quantity outeach (targeting 50 quality relationships - 10 being strategic)
5.  Minimize broader SE opp bandwidth
6.  Avoiding offer building where possible`,
  notesProspectingLeft: ` - Leverage SE to get in where possible (SAEs and broader BFO opps)
 - PE dinner partnership w/Cristy
 - Event prospecting (even if not attending)
 - Direct email/calls
 - Leverage Zoom intents and contacts`,
  notesProspectingRight: ` - Sourcing outreach with market intel
 - Going back to Not Solds with RA+?
 - Blocking out first hour of each day`,
  notesEfficientTime: ` - ChatGPT for writing exec summary, propsecting drafts, LinkedIn posts, and for company research
 - Leverage AI tools like Notebook LM or Gamma for slides/podcast generation
 - Calendly for meeting scheduling
 - Leverage fee floating tools
 - SCLP partnership where possible on company/prospect research
 - Afternoons for calls/mornings for focused work and outreach`,
};

// Per-stage numeric fields. Anything not in this list is left to the
// default — keeps render-time `<NumCell value={…} />` from receiving
// objects/arrays that would crash the metrics table.
const STAGE_NUMERIC_FIELDS = [
  'activeGoal', 'activeActual',
  'dealSizeGoal', 'dealSizeActual',
  'pipelineGoal', 'pipelineActual',
  'closeGoal', 'closeActual',
  'targetProj',
  'lifeGoal', 'lifeActual',
];

// Merge each saved stage row with the matching DEFAULT_STATE row so
// every field has the expected shape. If a saved row is missing or
// malformed (wrong length, non-object, non-string key/label, non-numeric
// numeric field), the default for that slot is used. Returns an array
// the same length as DEFAULT_STATE.stages.
function sanitizeStages(savedStages) {
  if (!Array.isArray(savedStages) || savedStages.length !== DEFAULT_STATE.stages.length) {
    return DEFAULT_STATE.stages;
  }
  return savedStages.map((saved, i) => {
    const def = DEFAULT_STATE.stages[i];
    if (!saved || typeof saved !== 'object') return def;
    const row = { ...def };
    if (typeof saved.key === 'string' && saved.key) row.key = saved.key;
    // Labels are defined in code (not user-editable), so always take the
    // default label — this lets label changes propagate even when a saved
    // state already carries the old text.
    for (const f of STAGE_NUMERIC_FIELDS) {
      const v = saved[f];
      if (v === null) row[f] = null; // user blanked the cell
      else if (typeof v === 'number' && Number.isFinite(v)) row[f] = v;
      // anything else (undefined, object, array, NaN, string) → keep default
    }
    return row;
  });
}

// State saved before the "% of deals not Quoted" table went to rolling
// windows carries notQuotedMonth / notQuotedYear — the manual fallbacks
// for the calendar-month and calendar-year cells the windows replaced.
// Those are the closest thing anyone typed to a 30-day and a 1-year
// number, so they carry across rather than being silently dropped back to
// the code defaults. The 90-day cell has no predecessor and starts at its
// default. Returns only the keys worth overriding, to be spread after the
// saved state.
function migrateNotQuoted(saved) {
  const out = {};
  const carry = (to, from) => {
    if (saved[to] == null && typeof saved[from] === 'number' && Number.isFinite(saved[from])) {
      out[to] = saved[from];
    }
  };
  carry('notQuoted30', 'notQuotedMonth');
  carry('notQuoted365', 'notQuotedYear');
  return out;
}

// Outermost safety net for the entire Pipeline page. If anything below
// the title bar throws — sanitizer, BFO aggregation, JSX render — we
// show a "wipe Pipeline state and reload" button so the user can
// recover without DevTools, hard-refresh, or clear-site-data.
class PipelineRootBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('PipelineView render crashed', error, info);
  }
  async resetAndReload() {
    try { await dbDelete(STORE, KEY); } catch {}
    window.location.reload();
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '1.25rem 1.5rem', fontFamily: 'inherit' }}>
          <h2 style={{ marginTop: 0 }}>Pipeline failed to render</h2>
          <p style={{ color: '#475569', fontSize: 14 }}>
            Something in your saved Pipeline state crashed the page. The fix wipes
            the saved <code>pipeline-dashboard</code> record from this browser and
            reloads: your BFO Activity, Opps, and column prefs are not affected.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', margin: '0.75rem 0' }}>
            <button
              type="button"
              onClick={() => this.resetAndReload()}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '0.45rem 0.9rem', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600 }}
            >Wipe Pipeline state and reload</button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              style={{ background: 'transparent', color: '#334155', border: '1px solid #94a3b8', borderRadius: 6, padding: '0.45rem 0.9rem', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
            >Try again</button>
          </div>
          <details style={{ fontSize: 12, color: '#64748b', marginTop: '0.75rem' }}>
            <summary style={{ cursor: 'pointer' }}>Error details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '0.5rem', background: '#f1f5f9', padding: '0.5rem', borderRadius: 4 }}>
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

// Render-time safety net for the PIPELINE METRICS table. If a single
// row throws (e.g., saved data shaped unexpectedly after a schema
// change) we show a recoverable fallback instead of blanking the whole
// section. Click "Try again" after fixing state, or use the Reset
// table button above to restore defaults.
class MetricsTableBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.warn('Pipeline metrics table render error', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '0.85rem 1rem', fontSize: 13, color: '#475569', background: '#fef9c3', borderTop: '1px solid #fde68a' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
            Couldn't render the metrics table.
          </div>
          <div style={{ marginBottom: '0.5rem' }}>
            Click <strong>Reset table</strong> above to restore defaults, or{' '}
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              style={{ background: 'transparent', border: '1px solid #94a3b8', borderRadius: 4, padding: '0.1rem 0.45rem', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#334155' }}
            >Try again</button>
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const fmtMoney = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};
const fmtNum = (n) => (n === null || n === undefined || Number.isNaN(n)) ? '' : n.toLocaleString('en-US');

// Cell that commits its value on blur — text input that round-trips
// to numbers, percentages, money, etc. depending on `kind`.
function formatNumDisplay(v, kind) {
  if (v === null || v === undefined || v === '') return '';
  if (kind === 'pct') return `${(Number(v) * 100).toFixed(0)}%`;
  if (kind === 'money') return fmtMoney(Number(v));
  if (kind === 'ratio') return Number(v).toFixed(2);
  return fmtNum(Number(v));
}

// Editable numeric cell. The input keeps a local draft while typing and
// commits on blur, but the draft must follow the committed value whenever
// that value changes underneath it — the page mounts on DEFAULT_STATE and
// only swaps in the saved record once IndexedDB hydration resolves, so a
// draft that never re-syncs would keep showing the seed defaults while
// every calculated cell used the saved numbers.
function NumCell({ value, kind = 'num', onCommit }) {
  const initial = formatNumDisplay(value, kind);
  const [draft, setDraft] = useState(initial);
  // Render-phase sync (React's documented "adjust state when props change"
  // pattern): only fires when the committed value actually changes, so
  // typing — which never moves `value` — is left alone.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(initial);
  }
  function commit() {
    const raw = String(draft).replace(/[$,\s%]/g, '').trim();
    if (raw === '') { onCommit(null); setDraft(''); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { setDraft(initial); return; }
    const next = (kind === 'pct' && n > 1) ? n / 100 : n;
    onCommit(next);
    // Re-format in place so a committed entry reads back the way the cell
    // displays it, even when the value didn't change (no prop-sync then).
    setDraft(formatNumDisplay(next, kind));
  }
  // Escape cancels the edit. blur() fires onBlur synchronously, so without
  // this flag the cancelled draft would still be committed on the way out —
  // the cell would snap back to the old number while the calculated cells
  // used the abandoned one.
  const cancelling = useRef(false);
  return (
    <input
      className={styles.cell}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => {
        if (cancelling.current) { cancelling.current = false; return; }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { cancelling.current = true; setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

function TextCell({ value, onCommit }) {
  const [draft, setDraft] = useState(value ?? '');
  // Same prop-sync as NumCell — hydration/reset has to reach the input.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value ?? '');
  }
  // Same Escape-cancels-without-committing guard as NumCell.
  const cancelling = useRef(false);
  return (
    <input
      className={styles.cellLeft}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelling.current) { cancelling.current = false; return; }
        onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { cancelling.current = true; setDraft(value ?? ''); e.currentTarget.blur(); }
      }}
    />
  );
}

// Carries the fixed-label overrides (state.labels) + setter down to every
// <EL> without threading props through the whole render tree.
const LabelCtx = createContext(null);

// Inline-editable fixed label — the table titles, column headers and static
// row labels the user asked to be able to rename. Renders plain text until
// double-clicked, then swaps in a content-sized input. Committing stores an
// override in state.labels[id] (persisted to the browser like every other
// cell); clearing it, or typing the original text back, drops the override so
// later code-side default changes still show through. `children` is the
// default text and MUST be a plain string.
function EL({ id, children }) {
  const ctx = useContext(LabelCtx);
  const fallback = String(children ?? '');
  const value = (ctx && ctx.labels && ctx.labels[id] != null) ? ctx.labels[id] : fallback;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    return (
      <input
        className={styles.editInput}
        size={Math.max(6, draft.length + 1)}
        style={{ maxWidth: '100%' }}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => {
          setEditing(false);
          const text = draft.trim();
          if (ctx) ctx.setLabel(id, (text === '' || text === fallback) ? null : text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
    );
  }
  return (
    <span
      className={styles.editLabel}
      title="Double-click to edit"
      onDoubleClick={(e) => { e.stopPropagation(); setDraft(value); setEditing(true); }}
    >{value}</span>
  );
}

// Color a cell green/red depending on whether the actual hits the goal.
// dir = 'higher-better' or 'lower-better'.
function compareClass(actual, goal, dir = 'higher-better') {
  if (actual === null || actual === undefined || goal === null || goal === undefined || goal === 0) return '';
  if (dir === 'higher-better') return actual >= goal ? styles.cellGreen : styles.cellRed;
  return actual <= goal ? styles.cellGreen : styles.cellRed;
}

// ---------------------------------------------------------------------------
// Hover / pin "what goes into this number" breakdowns.
//
// Mirrors the YOY page's hover-with-pin behaviour, adapted for the table:
// every live (auto-computed) cell is wrapped in <LiveValue>. Hovering a cell
// pops out a panel showing the formula, inputs and the exact rows that fed
// the number; clicking the cell pins that panel open so it survives mouse-out
// (click it again, click the ✕, or click elsewhere on the page to dismiss).
// ---------------------------------------------------------------------------
const CalcContext = createContext(null);

// Short date like 6/22/26 for the breakdown row lists.
function fmtShortDate(s) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s || '';
  return new Date(t).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

// Map a full source array into breakdown rows: the capped display slice
// (`data` + a `more` overflow count so a busy stage can't render thousands
// of <tr>) plus the full uncapped set (`allData`) so the "Export to Excel"
// button can write every contributing row, not just the ~50 shown.
function mapRows(source, mapFn, opts = {}) {
  const { max = 50, exportMapFn = null, exportColumns = null, exportSource = null } = opts;
  const arr = source || [];
  const all = arr.map(mapFn);
  const out = { data: all.slice(0, max), more: Math.max(0, all.length - max), allData: all };
  // The Excel export can carry extra columns (e.g. Scope) the compact
  // on-screen panel omits, and can draw from a separately filtered row set
  // (via exportSource) — supplied here so the two stay decoupled.
  if (exportMapFn) out.exportData = (exportSource || arr).map(exportMapFn);
  if (exportColumns) out.exportColumns = exportColumns;
  return out;
}

// Build a breakdown row list from a close-rate `included` opp array.
function closeRateRows(included, head) {
  return {
    head,
    columns: ['Result', 'Account', 'Close', 'Amount'],
    aligns: ['', '', '', 'num'],
    ...mapRows(included, o => [
      o.stage,
      o.account || '(no account)',
      fmtShortDate(o.closeDate),
      o.amount > 0 ? fmtMoney(Math.round(o.amount)) : '-',
    ], {
      exportColumns: ['Result', 'Account', 'BFO Opportunity Name', 'Scope', 'Close', 'Amount'],
      exportMapFn: o => [
        o.stage,
        o.account || '(no account)',
        o.bfoName || '',
        o.scope || '',
        fmtShortDate(o.closeDate),
        o.amount > 0 ? fmtMoney(Math.round(o.amount)) : '-',
      ],
    }),
  };
}

// Build a breakdown row list from a "% not Quoted" closed-deal array. Each
// row shows whether the deal was quoted and how many days it logged in the
// Quoted / Agreement Sent stages, so the popover doubles as an audit of
// which closed deals fell on each side of the ratio.
function notQuotedRows(deals, head) {
  return {
    head,
    columns: ['Account', 'Result', 'Close', 'Quoted days'],
    aligns: ['', '', '', 'num'],
    ...mapRows(deals, o => [
      o.account,
      o.stage,
      fmtShortDate(o.closeDate),
      o.quoted ? `${o.quotedDays}d` : '-',
    ], {
      // Excel export drops deals with no BFO Opportunity Name and adds
      // Quoted Amount / Quoted Date and a Reason Not Sold column; the
      // on-screen panel keeps every row and its compact columns.
      exportSource: deals.filter(o => (o.bfoName || '').trim() !== ''),
      exportColumns: ['Account', 'BFO Opportunity Name', 'Scope', 'Result', 'Close', 'Quoted days', 'Quoted Amount', 'Quoted Date', 'Not quoted', 'Reason Not Sold'],
      exportMapFn: o => [
        o.account,
        o.bfoName || '',
        o.scope || '',
        o.stage,
        fmtShortDate(o.closeDate),
        o.quoted ? o.quotedDays : 0,
        Number.isFinite(o.quotedAmount) ? fmtMoney(Math.round(o.quotedAmount)) : '',
        o.quotedDate ? fmtShortDate(o.quotedDate) : '',
        o.quoted ? 'No' : 'Yes',
        o.reasonNotSold || '',
      ],
    }),
  };
}

// Export a live-value breakdown to a one-sheet .xlsx: the metric's value,
// formula and inputs up top, then the FULL (uncapped) contributing rows —
// so a pinned panel can be dropped into Excel for deeper analysis.
async function exportBreakdown(data) {
  try {
  const mod = await import('xlsx');
  const XLSX = mod.utils ? mod : (mod.default || mod);
  const aoa = [];
  if (data.title) aoa.push([data.title]);
  if (data.value != null && data.value !== '') aoa.push(['Value', data.value]);
  if (data.formula) aoa.push(['Formula', data.formula]);
  if (Array.isArray(data.inputs)) for (const it of data.inputs) aoa.push([it.label, it.value]);
  const rows = data.rows;
  if (rows && Array.isArray(rows.exportColumns || rows.columns)) {
    aoa.push([]);
    if (rows.head) aoa.push([rows.head]);
    aoa.push(rows.exportColumns || rows.columns);
    for (const r of (rows.exportData || rows.allData || rows.data || [])) aoa.push(r);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Breakdown');
  const slug = String(data.title || 'live-value')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'live-value';
  const stamp = new Date().toISOString().slice(0, 10);
  sanitizeSheetJsWorkbook(wb);
  XLSX.writeFile(wb, `pipeline-${slug}-${stamp}.xlsx`);
  } catch (err) {
    console.error('Pipeline breakdown export failed', err);
    if (typeof window !== 'undefined') window.alert('Sorry: the Excel export failed to generate.');
  }
}

// Wraps a live value: handles hover-to-preview and click-to-pin. Falls back
// to a plain span (with native title) when rendered outside a CalcContext.
function LiveValue({ id, breakdown, className, style, title, children }) {
  const ctx = useContext(CalcContext);
  if (!ctx) {
    return <span className={className} style={style} title={title}>{children}</span>;
  }
  const data = { id, ...breakdown };
  const isPinned = ctx.pinnedId === id;
  return (
    <span
      className={`${className || ''} ${styles.liveValue} ${isPinned ? styles.liveValuePinned : ''}`.trim()}
      style={style}
      onMouseEnter={(e) => ctx.enter(data, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => ctx.leave(id)}
      onClick={(e) => { e.stopPropagation(); ctx.toggle(data, e.currentTarget.getBoundingClientRect()); }}
    >
      {children}
    </span>
  );
}

// The floating panel itself. Portaled to <body> and positioned next to the
// anchored cell (below it, or above when there's no room below), clamped to
// the viewport. Stays put once pinned.
function CalcPopover({ data, anchor, pinned, onClose, onKeepOpen, onLeave }) {
  const W = 360;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let left = anchor.left;
  if (left + W > vw - 8) left = vw - 8 - W;
  if (left < 8) left = 8;
  const spaceBelow = vh - anchor.bottom - 12;
  const spaceAbove = anchor.top - 12;
  const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
  const style = placeAbove
    ? { left, bottom: vh - anchor.top + 6, maxHeight: Math.max(160, spaceAbove) }
    : { left, top: anchor.bottom + 6, maxHeight: Math.max(160, spaceBelow) };
  return createPortal(
    <div
      className={styles.calcPanel}
      style={{ width: W, ...style }}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={onKeepOpen}
      onMouseLeave={onLeave}
    >
      <CalcContent data={data} pinned={pinned} onClose={onClose} />
    </div>,
    document.body,
  );
}

function CalcContent({ data, pinned, onClose }) {
  const rows = data.rows;
  const aligns = rows?.aligns || [];
  return (
    <>
      <div className={styles.calcHead}>
        <span className={styles.calcTitle}>{data.title}</span>
        <div className={styles.calcHeadActions}>
          {data.rows && Array.isArray(data.rows.columns) && (
            <button
              type="button"
              className={styles.calcExportBtn}
              onClick={() => exportBreakdown(data)}
              title="Export the full breakdown to Excel for further analysis"
            >⬇ Excel</button>
          )}
          {pinned ? (
            <button type="button" className={styles.calcPinBtn} onClick={onClose} title="Unpin this panel">📌 Pinned ✕</button>
          ) : (
            <span className={styles.calcBadge} title="Recomputed live: not a stored value. Click to pin.">∑ live</span>
          )}
        </div>
      </div>
      {data.value != null && data.value !== '' ? <div className={styles.calcValue}>{data.value}</div> : null}
      {data.formula ? <div className={styles.calcFormula}>{data.formula}</div> : null}
      {Array.isArray(data.inputs) && data.inputs.length > 0 ? (
        <div className={styles.calcInputs}>
          {data.inputs.map((it, i) => (
            <div key={i} className={styles.calcInputRow}>
              <span className={styles.calcInputLabel}>{it.label}</span>
              <span className={styles.calcInputVal}>{it.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {rows && rows.data && rows.data.length > 0 ? (
        <div className={styles.calcRows}>
          {rows.head ? <div className={styles.calcRowsHead}>{rows.head}</div> : null}
          <table className={styles.calcTable}>
            <thead>
              <tr>{rows.columns.map((c, i) => <th key={i} className={aligns[i] === 'num' ? styles.calcNum : undefined}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.data.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => <td key={ci} className={aligns[ci] === 'num' ? styles.calcNum : undefined}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.more > 0 ? <div className={styles.calcMore}>…and {rows.more} more</div> : null}
        </div>
      ) : null}
      {data.note ? <div className={styles.calcSource}>{data.note}</div> : null}
    </>
  );
}

// Owns the hover/pin state and renders the single active popover. Hover has a
// short close delay so the cursor can travel into the panel (to scroll a long
// row list) without it vanishing.
function useCalc() {
  const [hover, setHover] = useState(null);   // { data, anchor }
  const [pinned, setPinned] = useState(null); // { data, anchor }
  const hideTimer = useRef(null);
  const clearTimer = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  const ctx = useMemo(() => ({
    pinnedId: pinned?.data.id ?? null,
    enter: (data, anchor) => { clearTimer(); setHover({ data, anchor }); },
    leave: (id) => {
      clearTimer();
      hideTimer.current = setTimeout(() => setHover(h => (h && h.data.id === id ? null : h)), 160);
    },
    keepOpen: () => clearTimer(),
    closeHover: () => { clearTimer(); setHover(null); },
    toggle: (data, anchor) => {
      clearTimer();
      setHover(null);
      setPinned(p => (p && p.data.id === data.id ? null : { data, anchor }));
    },
    unpin: () => setPinned(null),
  }), [pinned]);
  const active = pinned || hover;
  const popover = active ? (
    <CalcPopover
      key={(active.data.id || '') + (pinned ? '-pin' : '-hover')}
      data={active.data}
      anchor={active.anchor}
      pinned={!!pinned}
      onClose={() => { setPinned(null); setHover(null); }}
      onKeepOpen={ctx.keepOpen}
      onLeave={() => { if (!pinned) ctx.closeHover(); }}
    />
  ) : null;
  return { ctx, popover, pinned, unpin: () => setPinned(null) };
}

// "Service Exploration Coverage" — a table of services (one row each) showing
// what share of your active clients have explored each, per their company
// page's Services Explored section. Add services with the picker below the
// table; each row's client breakdown stays hidden until the row is expanded.
// The client set mirrors the renewals table: Status = Client and matching the
// configured CDM (or all clients when no CDM is set). The tracked-service list
// is passed in from persisted Pipeline state via `services` / `onChangeServices`.
function ServiceCoverageSection({ prospects = [], cdmName = '', settings = {}, onSelectProspect, services = [], onChangeServices, oppsRecords = [], clientStatusMap = {}, clientUntrackedMap = {} }) {
  const catalog = useMemo(
    () => buildServiceCatalog(settings),
    [settings.hiddenServices, settings.serviceRenames, settings.customServiceCategories],
  );

  // Canonical key -> display label, honoring renames. Falls back to the raw
  // key so a tracked service that's since been hidden still shows a name.
  const labelOf = useMemo(() => {
    const m = serviceLabelMap(catalog);
    return (key) => m.get(key) || key;
  }, [catalog]);

  // Active clients: Status = Client, and matching the configured CDM. When no
  // CDM is configured, include every client so the table still works. Clients
  // the Clients tab marks "Cancelling for Sure" or "Don't Track" are left out.
  const exclusions = useMemo(
    () => ({ statusMap: clientStatusMap, untrackedMap: clientUntrackedMap }),
    [clientStatusMap, clientUntrackedMap],
  );
  const clients = useMemo(
    () => coverageClientsOf(prospects, cdmName, exclusions),
    [prospects, cdmName, exclusions],
  );

  // How many clients each exclusion dropped, so the table can say why its
  // totals are smaller than the client count elsewhere.
  const excluded = useMemo(
    () => coverageExclusions(prospects, cdmName, exclusions),
    [prospects, cdmName, exclusions],
  );

  // Opp-derived service statuses per client, so a client with an active (or
  // closed) opportunity naming a service counts as having explored it — the
  // same rule the company page uses. Recomputed only when the client set or
  // the opps cache changes.
  const oppStagesByClient = useMemo(
    () => buildOppStagesByClient(clients, oppsRecords),
    [clients, oppsRecords],
  );

  // Coverage for every tracked service, computed once per client/service change.
  const coverageByService = useMemo(() => {
    const m = new Map();
    for (const key of services) m.set(key, computeServiceCoverage(clients, key, oppStagesByClient));
    return m;
  }, [clients, services, oppStagesByClient]);

  // Which rows are expanded to show their client breakdown. Local-only (not
  // persisted) — every row starts collapsed so the breakdown is hidden by
  // default.
  const [expanded, setExpanded] = useState(() => new Set());
  function toggleRow(key) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function addService(key) {
    if (!key || services.includes(key) || !onChangeServices) return;
    onChangeServices([...services, key]);
  }
  function removeService(key) {
    if (!onChangeServices) return;
    onChangeServices(services.filter(s => s !== key));
    setExpanded(prev => { const n = new Set(prev); n.delete(key); return n; });
  }

  function openProspect(p) {
    if (onSelectProspect && p) onSelectProspect(p);
  }

  const tracked = new Set(services);
  // Add-picker options: every catalogue service not already in the table.
  const addCatalog = catalog
    .map(cat => ({ name: cat.name, items: cat.items.filter(it => !tracked.has(it.key)) }))
    .filter(cat => cat.items.length > 0);
  const noClients = clients.length === 0;

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}><EL id="svc-cov-title">Service Exploration Coverage</EL></div>
      <div className={styles.svcCovBody}>
        {noClients && (
          <div className={styles.svcCovEmpty}>
            No active clients found{cdmName ? ` for ${cdmName}` : ''}.
          </div>
        )}
        {excluded.total > 0 && (
          <div className={styles.svcCovEmpty}>
            Excludes {excluded.total} client{excluded.total === 1 ? '' : 's'} on the Clients tab
            {' '}({[
              excluded.cancelling > 0 ? `${excluded.cancelling} \u201CCancelling for Sure\u201D` : '',
              excluded.untracked > 0 ? `${excluded.untracked} \u201CDon\u2019t Track\u201D` : '',
            ].filter(Boolean).join(', ')}).
          </div>
        )}

        <div className={styles.scrollX}>
          <table className={styles.svcCovTable}>
            <thead>
              <tr>
                <th className={styles.svcCovThService}><EL id="svc-cov-col-service">Service</EL></th>
                <th className={styles.svcCovThNum}><EL id="svc-cov-col-explored">Explored</EL></th>
                <th><EL id="svc-cov-col-coverage">Coverage</EL></th>
                <th aria-label="Remove" className={styles.svcCovThRemove}></th>
              </tr>
            </thead>
            <tbody>
              {services.length === 0 ? (
                <tr>
                  <td colSpan={4} className={styles.svcCovTableEmpty}>
                    No services tracked yet: add one below to see how many of your clients have explored it.
                  </td>
                </tr>
              ) : services.map(key => {
                const cov = coverageByService.get(key) || { explored: [], exploredActive: [], na: [], notExplored: [], total: clients.length, pct: 0 };
                const isOpen = expanded.has(key);
                return (
                  <Fragment key={key}>
                    <tr
                      className={styles.svcCovRow}
                      onClick={() => toggleRow(key)}
                      title={isOpen ? 'Collapse client breakdown' : 'Expand to see which clients have explored this'}
                    >
                      <td className={styles.svcCovServiceCell}>
                        <span className={`${styles.svcCovChevron} ${isOpen ? styles.svcCovChevronOpen : ''}`}>&#9656;</span>
                        {labelOf(key)}
                      </td>
                      <td className={styles.svcCovNumCell}>{cov.explored.length} / {cov.total}</td>
                      <td>
                        <div className={styles.svcCovRowCoverage}>
                          <div className={styles.svcCovBarTrack}>
                            <div className={styles.svcCovBarFill} style={{ width: `${cov.pct}%` }} />
                          </div>
                          <span className={styles.svcCovRowPct}>{cov.pct}%</span>
                        </div>
                      </td>
                      <td className={styles.svcCovRemoveCell}>
                        <button
                          type="button"
                          className={styles.svcCovRemoveBtn}
                          title="Remove this service from the table"
                          onClick={(e) => { e.stopPropagation(); removeService(key); }}
                        >&times;</button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className={styles.svcCovDetailRow}>
                        <td colSpan={4}>
                          <div className={styles.svcCovLists}>
                            <div className={styles.svcCovCol}>
                              <div className={styles.svcCovListHead}>Explored ({cov.exploredActive.length})</div>
                              <div className={styles.svcCovChips}>
                                {cov.exploredActive.length ? cov.exploredActive.map(({ p, status }) => (
                                  <span
                                    key={p.id}
                                    className={`${styles.svcCovChip} ${styles.svcCovChipYes}`}
                                    onClick={(e) => { e.stopPropagation(); openProspect(p); }}
                                    title={`${p.company} · ${status}`}
                                  >
                                    {p.company}
                                    <span className={styles.svcCovChipStatus}>{status}</span>
                                  </span>
                                )) : <span className={styles.svcCovNone}>No clients have explored this service yet.</span>}
                              </div>
                            </div>
                            {/* N/A gets its own column: the service doesn't apply to these
                                clients, so listing them beside real activity overstates it.
                                They still count toward the row's coverage number. */}
                            <div className={styles.svcCovCol}>
                              <div className={styles.svcCovListHead}>N/A ({cov.na.length})</div>
                              <div className={styles.svcCovChips}>
                                {cov.na.length ? cov.na.map(({ p }) => (
                                  <span
                                    key={p.id}
                                    className={`${styles.svcCovChip} ${styles.svcCovChipNa}`}
                                    onClick={(e) => { e.stopPropagation(); openProspect(p); }}
                                    title={`${p.company}: not applicable`}
                                  >
                                    {p.company}
                                  </span>
                                )) : <span className={styles.svcCovNone}>No clients marked this service N/A.</span>}
                              </div>
                            </div>
                            <div className={styles.svcCovCol}>
                              <div className={styles.svcCovListHead}>Not yet explored ({cov.notExplored.length})</div>
                              <div className={styles.svcCovChips}>
                                {cov.notExplored.length ? cov.notExplored.map(({ p }) => (
                                  <span
                                    key={p.id}
                                    className={`${styles.svcCovChip} ${styles.svcCovChipNo}`}
                                    onClick={(e) => { e.stopPropagation(); openProspect(p); }}
                                    title={`${p.company}: not explored`}
                                  >
                                    {p.company}
                                  </span>
                                )) : <span className={styles.svcCovNone}>Every client has explored this service.</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.svcCovAddRow}>
          <label className={styles.svcCovLabel} htmlFor="svc-cov-add">Add service</label>
          <select
            id="svc-cov-add"
            className={styles.svcCovSelect}
            value=""
            disabled={addCatalog.length === 0}
            onChange={(e) => { addService(e.target.value); e.target.value = ''; }}
          >
            <option value="" disabled>
              {addCatalog.length === 0 ? 'All services added' : 'Choose a service…'}
            </option>
            {addCatalog.map(cat => (
              <optgroup key={cat.name} label={cat.name}>
                {cat.items.map(it => <option key={it.key} value={it.key}>{it.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export function PipelineView({ prospects = [], cdmName = '', settings = {}, onSelectProspect }) {
  return (
    <PipelineRootBoundary>
      <PipelineViewInner prospects={prospects} cdmName={cdmName} settings={settings} onSelectProspect={onSelectProspect} />
    </PipelineRootBoundary>
  );
}

// Snapshot the Clients-tab localStorage stores that feed the renewals
// table (deals, name remapping, managers, untracked flags). Re-read on
// focus so an upload/edit on the Clients tab shows up here.
function readClientStores() {
  return {
    deals: loadDealsList().data,
    clientMap: loadDealClientMap(),
    managerMap: loadClientManagerMap(),
    untrackedMap: loadClientUntrackedMap(),
    statusMap: loadClientStatusMap(),
  };
}

function PipelineViewInner({ prospects = [], cdmName = '', settings = {}, onSelectProspect }) {
  const [state, setState] = useState(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [bfo, setBfo] = useState(null);
  const [opps, setOpps] = useState(null);
  const [clientStores, setClientStores] = useState(readClientStores);
  const [hubspotContacts, setHubspotContacts] = useState([]);
  const [exporting, setExporting] = useState(''); // '' | 'multi' | 'single' — which Excel export is building
  const [strategicRows, setStrategicRows] = useState([]);
  // Hover/pin "what goes into this number" breakdown panels.
  const { ctx: calcCtx, popover: calcPopover, pinned: calcPinned, unpin: calcUnpin } = useCalc();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await dbGet(STORE, KEY);
        if (cancelled) return;
        if (saved) setState(() => ({
          ...DEFAULT_STATE,
          ...saved,
          ...migrateNotQuoted(saved),
          stages: sanitizeStages(saved.stages),
          // Label overrides must be a plain object; anything else falls back to
          // "no overrides" so a corrupt value can't crash the header render.
          labels: (saved.labels && typeof saved.labels === 'object' && !Array.isArray(saved.labels)) ? saved.labels : {},
          // Coverage services must be an array of non-empty strings; a corrupt
          // value falls back to "none tracked" so the table can't crash.
          coverageServices: Array.isArray(saved.coverageServices)
            ? saved.coverageServices.filter(s => typeof s === 'string' && s)
            : [],
        }));
        const bfoSaved = await dbGet(BFO_STORE, BFO_KEY);
        if (!cancelled && bfoSaved) setBfo(bfoSaved);
        const oppsSaved = await loadOppsFromCache();
        if (!cancelled && oppsSaved) setOpps(oppsSaved);
        const contacts = await getHubspotContacts();
        if (!cancelled && contacts) setHubspotContacts(contacts);
        const stratRows = await loadUploadedList(STRATEGIC_STORAGE_KEY);
        if (!cancelled && Array.isArray(stratRows)) setStrategicRows(stratRows);
      } catch (e) {
        console.warn('Pipeline hydrate failed', e);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    // Refresh BFO data whenever the user navigates back to this tab.
    function onFocus() {
      // Always reflect the current BFO + Opps records — including their
      // absence (e.g. user clicked Clear). Without explicit null
      // fallback, deletions wouldn't propagate to this view.
      dbGet(BFO_STORE, BFO_KEY).then(b => setBfo(b || null)).catch(() => setBfo(null));
      loadOppsFromCache().then(o => setOpps(o || null)).catch(() => setOpps(null));
      getHubspotContacts().then(c => setHubspotContacts(c || [])).catch(() => {});
      loadUploadedList(STRATEGIC_STORAGE_KEY).then(r => setStrategicRows(Array.isArray(r) ? r : [])).catch(() => {});
      setClientStores(readClientStores());
    }
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

  const bfoMetrics = useMemo(() => bfoStageMetrics(bfo), [bfo]);
  const hasBfo = bfo && bfo.rows && bfo.rows.length > 0;

  // Active clients (from the Clients tab) whose soonest contract expires
  // within the renewal window. Pulled from the same prospects + Clients-tab
  // stores the Clients page uses, so this table agrees with that one.
  const expiringClients = useMemo(
    () => computeExpiringClients({
      prospects,
      cdmName,
      dealsList: clientStores.deals,
      clientMap: clientStores.clientMap,
      managerMap: clientStores.managerMap,
      untrackedMap: clientStores.untrackedMap,
      statusMap: clientStores.statusMap,
      withinDays: RENEWAL_WINDOW_DAYS,
    }),
    [prospects, cdmName, clientStores],
  );

  // Post-Sale Follow-Up: every uploaded deal (Deals subtab) with no "Follow
  // Up On Sale" value — the deals still needing a post-sale follow-up. Mirrors
  // the Clients tab's Post-Sale Follow-Up subtab, sorted by how long it's been
  // since the deal was sold (Original Contract Start) — longest since sold
  // first, since those are the most overdue for a follow-up.
  const postSaleFollowUps = useMemo(
    () => postSaleFollowUpRows(clientStores.deals),
    [clientStores.deals],
  );

  // Decision-maker contacts grouped by normalized company name, so each
  // renewals row can show the DM(s) at that account and whether they've been
  // invited to Louisville. Mirrors the HubSpot-contact source + "Decision
  // Maker" tag test the Progress and contact views use. The Louisville flag
  // is a local-only setting keyed by the contact's HubSpot id.
  const dmsByCompany = useMemo(() => {
    const invitedMap = settings.contactInvitedToLouisville || {};
    // Per-contact local overrides (Firestore settings). A _companyOverride is
    // the user's typed company name for a contact whose HubSpot company
    // association refused to update; the contact views (HubSpot / All Contacts
    // / Key Contacts) all key off it, so this renewals join must too. Without
    // it, an overridden DM matches on their raw HubSpot company here and goes
    // missing from the table even though they show up correctly everywhere else.
    const localFieldsMap = settings.contactLocalFields || {};
    const map = new Map();
    for (const c of hubspotContacts) {
      const tags = String(c.dans_tags || c.dan_s_tags || c.dans_tag || '')
        .split(';').map(t => t.trim().toLowerCase());
      if (!tags.includes('decision maker')) continue;
      const cid = c.id || c.vid;
      const override = cid != null ? localFieldsMap[cid]?._companyOverride : null;
      const company = (typeof override === 'string' && override) ? override : c.company;
      const key = normClientName(company);
      if (!key) continue;
      const name = [c.firstname, c.lastname].filter(Boolean).join(' ').trim()
        || c.name || c.email || '-';
      const isPrimary = tags.includes('primary point of contact');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ contact: c, name, invited: cid != null ? !!invitedMap[cid] : false, isPrimary });
    }
    // Show exactly one decision maker per account: prefer the one tagged
    // "Primary Point of Contact", otherwise fall back to the first DM found.
    for (const [key, list] of map) {
      if (list.length > 1) {
        map.set(key, [list.find(d => d.isPrimary) || list[0]]);
      }
    }
    return map;
  }, [hubspotContacts, settings.contactInvitedToLouisville, settings.contactLocalFields]);

  // My Accounts that are mapped to a row on the uploaded Strategic Accounts
  // list, each with that row's Account Owner + Type. Reads the same per-user
  // My-Accounts mapping the Lists tab writes (Firestore-synced copy first,
  // then the local cache), keyed the exact way UploadedListView builds it —
  // pickNameKey over the union of headers + normalizeCompany of the raw name —
  // so our lookups line up with the stored mapping.
  const strategicMyAccounts = useMemo(() => {
    if (!strategicRows.length) return [];
    const remote = settings?.listMappings?.[STRATEGIC_STORAGE_KEY];
    let mapping = remote && remote.myAccountMapping && typeof remote.myAccountMapping === 'object'
      ? remote.myAccountMapping
      : null;
    if (!mapping) {
      try {
        const raw = userLsGet(`${STRATEGIC_STORAGE_KEY}:my-accounts-mapping`);
        mapping = raw ? (JSON.parse(raw) || {}) : {};
      } catch { mapping = {}; }
    }
    const headers = [];
    const seen = new Set();
    for (const row of strategicRows) for (const k of Object.keys(row)) {
      if (!seen.has(k)) { seen.add(k); headers.push(k); }
    }
    const nameKey = pickNameKey(headers);
    const ownerKey = headers.find(h => /owner/i.test(h));
    const typeKey = headers.find(h => /^type$/i.test(h)) || headers.find(h => /type/i.test(h));
    const out = [];
    const dedupe = new Set();
    for (const row of strategicRows) {
      const rawName = nameKey ? String(row[nameKey] || '').trim() : '';
      if (!rawName) continue;
      const norm = normalizeCompany(rawName);
      if (!norm) continue;
      const confirmed = mapping[`name::${norm}`];
      if (typeof confirmed !== 'string' || !confirmed) continue;
      const owner = ownerKey ? String(row[ownerKey] || '').trim() : '';
      const type = typeKey ? String(row[typeKey] || '').trim() : '';
      const key = `${confirmed.toLowerCase()}|${owner.toLowerCase()}|${type.toLowerCase()}`;
      if (dedupe.has(key)) continue;
      dedupe.add(key);
      out.push({ account: confirmed, owner, type });
    }
    out.sort((a, b) => a.account.localeCompare(b.account) || a.owner.localeCompare(b.owner));
    return out;
  }, [strategicRows, settings.listMappings]);

  // Deep-link a Strategic Accounts row to its account modal by company name.
  function openStrategicAccount(company) {
    if (!onSelectProspect) return;
    const p = prospects.find(pp => normClientName(pp.company) === normClientName(company));
    if (p) onSelectProspect(p);
  }

  // Open the account modal for a renewals row (by matching prospect id, then
  // company name as a fallback). Optionally deep-links straight into a
  // contact's editor.
  function openClientModal(row, editContact) {
    if (!onSelectProspect) return;
    const p = prospects.find(pp => pp.id === row.id)
      || prospects.find(pp => normClientName(pp.company) === normClientName(row.company));
    if (p) onSelectProspect(p, editContact);
  }

  // Lists derived from the Opps tab.
  const oppsRecords = opps && Array.isArray(opps.records) ? opps.records : [];

  // Sum of Quoted Amount for Opps tab records with Stage === 'Sold' and
  // a Close Date in the current calendar year. Drives the Closed YTD
  // cell on the Pipeline header. Returns null when the Opps cache has
  // no records — Closed YTD then falls back to the editable input.
  const oppsClosedYTD = useMemo(() => {
    if (oppsRecords.length === 0) return null;
    const thisYear = new Date().getFullYear();
    let total = 0;
    const deals = [];
    for (const r of oppsRecords) {
      if ((r.Stage || '').trim() !== 'Sold') continue;
      const cd = r['Close Date'];
      if (!cd) continue;
      const ts = Date.parse(cd);
      if (Number.isNaN(ts)) continue;
      if (new Date(ts).getFullYear() !== thisYear) continue;
      const amt = parseMoney(r['Quoted Amount']);
      if (typeof amt === 'number' && Number.isFinite(amt)) {
        total += amt;
        deals.push({
          account: String(r.Account || '').trim() || '(no account)',
          bfoName: bfoOppNameOf(r),
          scope: String(r.Scope || '').trim(),
          closeDate: cd,
          ts,
          amount: amt,
        });
      }
    }
    deals.sort((a, b) => b.ts - a.ts);
    return { total: Math.round(total), year: thisYear, deals };
  }, [oppsRecords]);

  // Overall Close Rate (Actual) for the Pipeline Metrics Total row.
  // Rolling 365-day window per the user's spec:
  //   Total Sold     — Sold within the last 365 days, Scope without "pull through".
  //   Total Not Sold — Not Sold within the last 365 days, Scope without "pull through".
  // Close Rate = Sold / (Sold + Not Sold). Returns null when the Opps
  // cache has no usable records so the Total cell stays blank rather
  // than reading "0%".
  const oppsCloseRateActual = useMemo(() => {
    if (oppsRecords.length === 0) return null;
    const cutoff = Date.now() - 365 * 86400000;
    const entries = [];
    for (const r of oppsRecords) {
      const e = closedOppEntry(r);
      if (e && e.ts >= cutoff) entries.push(e);
    }
    return closeRateTally(entries);
  }, [oppsRecords]);

  // Per-stage Close Rate Actual on a rolling 365-day window, using the
  // shared CLOSE_RATE_STAGES signals for "did it actually reach this
  // stage?". An opp counts toward every stage whose signal it carries,
  // so Stage 3's denominator is the widest and Stage 6's the narrowest.
  const oppsCloseRateByStage = useMemo(() => closeRatesByStage(oppsRecords), [oppsRecords]);

  // % of closed deals that were never quoted, per NOT_QUOTED_WINDOWS. A
  // deal counts as "quoted" when it logged at least one day in the Quoted
  // or Agreement Sent stage (from its stage history); a closed deal
  // (Sold / Not Sold) with no time in either stage is "not quoted".
  // Pull-through opps are excluded, mirroring the Close Rate metrics.
  //
  // Each window is a trailing span ending now, so the windows nest: every
  // deal in the 30-day cell is also in the 90-day and 1-year cells. Only a
  // lower bound is applied — a closed deal dated ahead of today counts in
  // all three rather than falling out of the table entirely, which is what
  // oppsCloseRateByStage does with its own rolling window.
  //
  // Returns null when no closed deal falls in even the longest window, so
  // the manual cells stay in place; an individual window with no deals is
  // null on its own and falls back to its manual cell.
  const oppsNotQuoted = useMemo(() => {
    if (oppsRecords.length === 0) return null;
    const now = Date.now();
    const cutoffFor = (days) => now - days * 86400000;
    const longest = NOT_QUOTED_WINDOWS[NOT_QUOTED_WINDOWS.length - 1].days;
    const oldest = cutoffFor(longest);
    const closed = [];
    for (const r of oppsRecords) {
      const stage = (r.Stage || '').trim();
      if (stage !== 'Sold' && stage !== 'Not Sold') continue;
      const cd = r['Close Date'];
      if (!cd) continue;
      const ts = Date.parse(cd);
      if (Number.isNaN(ts)) continue;
      if (ts < oldest) continue;
      if (isPullThroughOpp(r)) continue;
      const quotedDays = quotedStageDays(r);
      closed.push({
        account: String(r.Account || '').trim() || '(no account)',
        bfoName: bfoOppNameOf(r),
        scope: String(r.Scope || '').trim(),
        reasonNotSold: String(r['Reason Not Sold'] || '').trim(),
        stage,
        closeDate: cd,
        ts,
        quotedDays,
        quoted: quotedDays > 0,
        quotedAmount: parseMoney(r['Quoted Amount']),
        quotedDate: String(r['Quoted On'] || r['Quoted Date'] || '').trim(),
      });
    }
    if (closed.length === 0) return null;
    const byNewest = closed.slice().sort((a, b) => b.ts - a.ts);
    const out = {};
    for (const w of NOT_QUOTED_WINDOWS) {
      const cutoff = cutoffFor(w.days);
      const deals = byNewest.filter(e => e.ts >= cutoff);
      const notQuoted = deals.filter(e => !e.quoted).length;
      out[w.key] = deals.length === 0
        ? null
        : { total: deals.length, notQuoted, pct: notQuoted / deals.length, deals };
    }
    return out;
  }, [oppsRecords]);

  // Live Current Client vs Greenfield stats. Joins BFO Activity rows
  // to the Opps tab's Lead Source / Source via the BFO Opportunity
  // Name → Opps "BFO Link" map, then classifies each BFO opp using
  // a keyword heuristic (anything mentioning client / existing /
  // renewal / cross-sell / expansion / upsell counts as "current
  // client", everything else — including unmatched rows — counts as
  // "greenfield"). Returns null when BFO data isn't loaded so the
  // editable manual cells stay in place.
  const clientGreenfieldFromBfo = useMemo(() => {
    if (!hasBfo) return null;
    const findCol = (re) => bfo.headers.find(h => re.test(h));
    const oppCol = findCol(/opportunity\s*name/i);
    const amountCol = findCol(/^amount$/i);
    const stageCol = findCol(/sales\s*stage|^stage$/i);
    if (!oppCol) return null;
    const sourceByName = new Map();
    const scopeByName = new Map();
    for (const r of oppsRecords) {
      const k = String(r['BFO Link'] || '').trim().toLowerCase();
      if (!k) continue;
      const src = (r['Lead Source'] || r['Source'] || '').toString().trim();
      sourceByName.set(k, src);
      scopeByName.set(k, String(r.Scope || '').trim());
    }
    const isClient = (src) => /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i.test(src || '');
    let clientCount = 0;
    let greenfieldCount = 0;
    let clientAmt = 0;
    let greenfieldAmt = 0;
    const clientRows = [];
    const greenfieldRows = [];
    for (const r of bfo.rows) {
      // Active opps only — skip any closed-stage rows so the figures
      // mirror the rest of the Pipeline table (Stages 3-6 plus
      // anything BFO marks as in-stream).
      const stageVal = stageCol ? r[stageCol] : '';
      const stageMatch = matchStage(stageVal);
      if (stageMatch !== null && (stageMatch < 3 || stageMatch > 6)) continue;
      const oppNameRaw = String(r[oppCol] || '').trim();
      const oppName = oppNameRaw.toLowerCase();
      const src = sourceByName.get(oppName) || '';
      const amt = amountCol ? parseMoney(r[amountCol]) : null;
      const entry = { oppName: oppNameRaw || '(unnamed opp)', source: src || '(no lead source)', scope: scopeByName.get(oppName) || '', amount: amt };
      if (isClient(src)) {
        clientCount += 1;
        clientRows.push(entry);
        if (typeof amt === 'number' && Number.isFinite(amt)) clientAmt += amt;
      } else {
        greenfieldCount += 1;
        greenfieldRows.push(entry);
        if (typeof amt === 'number' && Number.isFinite(amt)) greenfieldAmt += amt;
      }
    }
    const total = clientCount + greenfieldCount;
    const clientActualPct = total > 0 ? clientCount / total : null;
    return {
      clientCount,
      greenfieldCount,
      clientAmt: Math.round(clientAmt),
      greenfieldAmt: Math.round(greenfieldAmt),
      clientActualPct,
      total,
      clientRows,
      greenfieldRows,
    };
  }, [hasBfo, bfo, oppsRecords]);

  // New opps created in each of the past 6 calendar months, derived from the
  // Opps tab. Only counts opps that carry a BFO Opportunity Name (drafts /
  // unlinked records are skipped). "Created" = the opp's open date, resolved by
  // oppOpenTs (Start Date preferred, else Age at import time). Buckets run
  // oldest → newest and always include the current month.
  const newOppsByMonth = useMemo(() => {
    const fetchedAt = opps && opps.fetchedAt ? Date.parse(opps.fetchedAt) : NaN;
    const ageRef = Number.isFinite(fetchedAt) ? fetchedAt : Date.now();
    const now = new Date();
    const buckets = [];
    const indexByKey = new Map();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      indexByKey.set(key, buckets.length);
      buckets.push({
        key,
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        count: 0,
        items: [],
      });
    }
    for (const r of oppsRecords) {
      if (!bfoOppNameOf(r)) continue;
      const openTs = oppOpenTs(r, ageRef);
      if (Number.isNaN(openTs)) continue;
      const d = new Date(openTs);
      const bi = indexByKey.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (bi == null) continue; // outside the 6-month window
      buckets[bi].count += 1;
      buckets[bi].items.push({
        account: String(r.Account || '').trim() || '(no company)',
        opp: String(r['Opportunity Name'] || r.Opportunity || r.Name || '').trim() || '(unnamed opp)',
        bfoName: bfoOppNameOf(r),
        scope: String(r.Scope || '').trim(),
        openDate: new Date(openTs).toISOString().slice(0, 10),
      });
    }
    for (const b of buckets) {
      b.items.sort((a, c) => a.account.localeCompare(c.account) || a.opp.localeCompare(c.opp));
    }
    return buckets;
  }, [oppsRecords, opps]);

  // Largest Stage 5 & 6 deals above $100k, biggest first — from the live BFO
  // rows for those stages. Shared by the on-screen section and the one-page
  // export so both stay in sync. Empty when BFO isn't loaded.
  const LARGE_DEAL_MIN = 100000;
  const largeStage56Deals = useMemo(() => {
    const collect = (n) => (hasBfo && bfoMetrics[n]?.rows ? bfoMetrics[n].rows : [])
      .filter(row => Number(row.amount) > LARGE_DEAL_MIN)
      .map(row => ({
        account: String(row.account || '').trim() || row.oppName || '(no account)',
        oppName: String(row.oppName || '').trim() || '-',
        stage: `Stage ${n}`,
        amount: Number(row.amount),
      }));
    return [...collect(6), ...collect(5)].sort((a, b) => b.amount - a.amount);
  }, [hasBfo, bfoMetrics]);

  useEffect(() => {
    if (!hydrated) return;
    // mirrorDbPut is dbPut plus the Firestore mirror, so the dashboard
    // survives a cleared browser.
    mirrorDbPut(STORE, KEY, state)
      // Tell the Issues tab (and the sidebar badge) the dashboard moved —
      // it reads coverageServices from this record.
      .then(notifyPipelineDashboardChanged)
      .catch(err => console.warn('Pipeline save failed', err));
  }, [state, hydrated]);

  function setStage(idx, patch) {
    setState(s => ({ ...s, stages: s.stages.map((row, i) => i === idx ? { ...row, ...patch } : row) }));
  }
  function setField(key, value) {
    setState(s => ({ ...s, [key]: value }));
  }
  // Set (or, with a null value, clear) a fixed-label override.
  function setLabel(id, value) {
    setState(s => {
      const labels = { ...(s.labels || {}) };
      if (value == null) delete labels[id];
      else labels[id] = value;
      return { ...s, labels };
    });
  }
  // setLabel only calls setState (stable), so a fresh closure each render is
  // fine — memoize on the labels map so <EL> consumers re-render only when a
  // label actually changes, not on every unrelated Pipeline re-render.
  const labelCtx = useMemo(() => ({ labels: state.labels || {}, setLabel }), [state.labels]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always have a usable stages array to render — sanitizeStages merges
  // each row with its DEFAULT_STATE counterpart and replaces any wrong-
  // typed field, so render-time `<NumCell value={…} />` and `{st.label}`
  // can never receive an object/array that would crash the table.
  // Pipeline Goal is derived, never entered: Active Opp Goal × Deal Size
  // Goal. Deriving it here (rather than at each use site) means the row,
  // the Total, the funnel and the Excel export all read the same number,
  // and the self-heal effect below writes it back so a stored record can
  // never drift from the two goals that produce it.
  const renderStages = useMemo(() => sanitizeStages(state.stages).map((st) => ({
    ...st,
    pipelineGoal: (Number(st.activeGoal) || 0) * (Number(st.dealSizeGoal) || 0),
  })), [state.stages]);
  // Self-heal: if the sanitized rows differ from what's in state, write
  // them back so the persisted record is no longer malformed.
  useEffect(() => {
    if (!hydrated) return;
    if (state.stages !== renderStages
        && JSON.stringify(state.stages) !== JSON.stringify(renderStages)) {
      setState(s => ({ ...s, stages: renderStages }));
    }
  }, [hydrated, state.stages, renderStages]);

  const stageTotals = renderStages.reduce((acc, st) => {
    const stageNum = Number(String(st.key).replace(/[^0-9]/g, ''));
    const m = bfoMetrics[stageNum];
    const liveCount = hasBfo && m?.count !== null && m?.count !== undefined ? m.count : null;
    const liveTotal = hasBfo && m?.total !== null && m?.total !== undefined ? m.total : null;
    const liveAvg = hasBfo && m?.avg !== null && m?.avg !== undefined ? m.avg : null;
    const liveLife = hasBfo && m?.avgAge !== null && m?.avgAge !== undefined ? m.avgAge : null;
    const lifeGoal = Number(st.lifeGoal);
    const lifeActual = liveLife ?? Number(st.lifeActual);
    // Target Projection — Goal: Active Opp Goal × Deal Size Goal × Close Rate Goal.
    // Actual: live BFO actuals (when present) × Close Rate Actual.
    const projGoal = (Number(st.activeGoal) || 0) * (Number(st.dealSizeGoal) || 0) * (Number(st.closeGoal) || 0);
    const projActual = ((liveCount ?? Number(st.activeActual)) || 0)
      * ((liveAvg ?? Number(st.dealSizeActual)) || 0)
      * (Number(st.closeActual) || 0);
    // Weighted-average inputs for Avg Opp Life — Goal weighted by
    // Active Opp Goal, Actual weighted by Active Opp Actual (live BFO
    // count when loaded). Mirrors =SUMPRODUCT(life, count)/SUM(count).
    const goalCount = Number(st.activeGoal) || 0;
    const actualCount = Number(liveCount ?? st.activeActual) || 0;
    return {
      activeActual: acc.activeActual + (liveCount ?? (Number(st.activeActual) || 0)),
      activeGoal: acc.activeGoal + (Number(st.activeGoal) || 0),
      pipelineActual: acc.pipelineActual + (liveTotal ?? (Number(st.pipelineActual) || 0)),
      pipelineGoal: acc.pipelineGoal + (Number(st.pipelineGoal) || 0),
      targetProjGoal: acc.targetProjGoal + projGoal,
      targetProjActual: acc.targetProjActual + projActual,
      lifeGoalProduct: acc.lifeGoalProduct + (Number.isFinite(lifeGoal) ? lifeGoal * goalCount : 0),
      lifeGoalWeight: acc.lifeGoalWeight + (Number.isFinite(lifeGoal) ? goalCount : 0),
      lifeActualProduct: acc.lifeActualProduct + (Number.isFinite(lifeActual) ? lifeActual * actualCount : 0),
      lifeActualWeight: acc.lifeActualWeight + (Number.isFinite(lifeActual) ? actualCount : 0),
    };
  }, { activeActual: 0, activeGoal: 0, pipelineActual: 0, pipelineGoal: 0, targetProjGoal: 0, targetProjActual: 0, lifeGoalProduct: 0, lifeGoalWeight: 0, lifeActualProduct: 0, lifeActualWeight: 0 });

  // Stage rows for the funnel chart. Same live-BFO-or-manual resolution
  // the metrics table uses, flattened to the four numbers the funnel
  // draws (count + pipeline $, each with its goal), so the picture and
  // the table can never disagree.
  const funnelStages = useMemo(
    () => buildFunnelStages({ stages: renderStages, bfoMetrics, hasBfo, closeRates: oppsCloseRateByStage }),
    [renderStages, bfoMetrics, hasBfo, oppsCloseRateByStage],
  );

  const dealSizeAvgGoal = stageTotals.pipelineGoal && stageTotals.activeGoal
    ? Math.round(stageTotals.pipelineGoal / stageTotals.activeGoal) : 0;
  // Total Deal Size Actual matches the Excel `=AVERAGE(Activity!U2:U70)`
  // — straight average of every Amount across all stages — when BFO
  // data is loaded. Falls back to the weighted average otherwise.
  const dealSizeAvgActual = hasBfo && bfoMetrics.all && typeof bfoMetrics.all.allAmtAvg === 'number'
    ? Math.round(bfoMetrics.all.allAmtAvg)
    : (stageTotals.pipelineActual && stageTotals.activeActual
        ? Math.round(stageTotals.pipelineActual / stageTotals.activeActual)
        : 0);

  // Prefer the live Opps-derived Closed YTD when the Opps cache is
  // populated; falls back to the manually entered state.closedYTD.
  const effectiveClosedYTD = oppsClosedYTD !== null ? oppsClosedYTD.total : (Number(state.closedYTD) || 0);
  const closedPctOfQuota = state.target ? effectiveClosedYTD / state.target : 0;

  // Prefer the live Opps-derived "% not Quoted" when closed deals exist in
  // that window; fall back to the manually entered state value otherwise.
  // Decided per window, so a quiet month can fall back to its manual cell
  // while the longer windows stay live.
  const notQuotedCells = NOT_QUOTED_WINDOWS.map((w) => {
    const live = oppsNotQuoted?.[w.key] || null;
    return { ...w, live, pct: live ? live.pct : state[w.field] };
  });
  // Weighted-by-count averages — SUMPRODUCT(life, count) / SUM(count).
  // Goal weights are activeGoal; Actual weights are the live count
  // (BFO when loaded, manual activeActual otherwise).
  const lifeGoalAvg = stageTotals.lifeGoalWeight > 0
    ? Math.round(stageTotals.lifeGoalProduct / stageTotals.lifeGoalWeight) : null;
  const lifeActualAvg = stageTotals.lifeActualWeight > 0
    ? Math.round(stageTotals.lifeActualProduct / stageTotals.lifeActualWeight) : null;

  // Resolve a fixed label to its user override (state.labels) or code default —
  // the same lookup <EL> does — so the export mirrors any renamed headers.
  const lbl = (id, def) => (state.labels && state.labels[id] != null ? state.labels[id] : def);

  // Gather every table's currently-displayed values into a plain payload for
  // the Schneider-formatted Excel builder. Mirrors the render logic: live BFO /
  // Opps actuals when loaded, manual state fallbacks otherwise.
  function buildExportPayload() {
    const stages = renderStages.map((st) => {
      const n = Number(String(st.key).replace(/[^0-9]/g, ''));
      const m = bfoMetrics[n];
      const live = (v) => hasBfo && v !== null && v !== undefined;
      const activeActual = live(m?.count) ? m.count : st.activeActual;
      const dealSizeActual = live(m?.avg) ? m.avg : st.dealSizeActual;
      const pipelineActual = live(m?.total) ? m.total : st.pipelineActual;
      const lifeActual = live(m?.avgAge) ? m.avgAge : st.lifeActual;
      const liveRate = oppsCloseRateByStage[n]?.rate;
      const closeActual = liveRate != null ? liveRate : st.closeActual;
      const killFlag = STAGE_KILL_FLAG[n];
      const flaggedRows = killFlag
        ? (m?.rows || []).filter(r => r.age != null && st.lifeGoal != null && r.age > st.lifeGoal)
        : [];
      // Same naming the on-screen flagged cell uses (account, else opp name).
      const flaggedNames = flaggedRows.map(r => r.account || r.oppName || '(no account)');
      return {
        label: st.label,
        activeGoal: st.activeGoal, activeActual,
        dealSizeGoal: st.dealSizeGoal, dealSizeActual,
        pipelineGoal: st.pipelineGoal, pipelineActual,
        closeGoal: st.closeGoal, closeActual,
        targetProjGoal: (Number(st.activeGoal) || 0) * (Number(st.dealSizeGoal) || 0) * (Number(st.closeGoal) || 0),
        lifeGoal: st.lifeGoal, lifeActual,
        flaggedLabel: killFlag || '', flaggedCount: flaggedRows.length, flaggedNames,
      };
    });
    const cg = clientGreenfieldFromBfo;
    const coverageActual = hasBfo && state.target > 0 ? stageTotals.pipelineActual / state.target : null;
    return {
      lbl,
      generatedAt: new Date(),
      cdmName,
      hasBfo,
      quota: { target: state.target, closedYTD: effectiveClosedYTD, pctOfQuota: closedPctOfQuota },
      stages,
      totals: {
        activeGoal: stageTotals.activeGoal, activeActual: stageTotals.activeActual,
        dealSizeGoal: dealSizeAvgGoal, dealSizeActual: dealSizeAvgActual,
        pipelineGoal: stageTotals.pipelineGoal, pipelineActual: stageTotals.pipelineActual,
        closeRate: oppsCloseRateActual ? oppsCloseRateActual.rate : null,
        targetProjGoal: stageTotals.targetProjGoal,
        lifeGoal: lifeGoalAvg, lifeActual: lifeActualAvg,
      },
      clientGreenfield: {
        clientCount: cg ? cg.clientCount : state.currentClientCount,
        greenfieldCount: cg ? cg.greenfieldCount : state.greenfieldCount,
        clientAmt: cg ? cg.clientAmt : state.currentClientAmt,
        greenfieldAmt: cg ? cg.greenfieldAmt : state.greenfieldAmt,
        clientGoalPct: state.clientGoalPct,
        clientActualPct: cg && cg.clientActualPct != null ? cg.clientActualPct : state.clientActualPct,
      },
      coverage: { goal: state.coverageGoal, actual: coverageActual },
      notQuoted: {
        goal: state.notQuotedGoal,
        // Labels resolved here so the export mirrors any renamed header,
        // the same way every other exported label does.
        windows: notQuotedCells.map(c => ({ label: lbl(c.labelId, c.label), pct: c.pct })),
      },
      // Largest Stage 5 & 6 deals above $100k, sorted by amount (biggest
      // first). Same rows shown on-screen (largeStage56Deals); empty when
      // BFO isn't loaded or nothing clears the threshold.
      largeDeals: {
        title: lbl('bigdeals-title', 'Largest Stage 5 & 6 Deals: Above $100k'),
        headers: [
          lbl('bigdeals-account', 'Account'),
          lbl('bigdeals-opp', 'Opportunity'),
          lbl('bigdeals-stage', 'Stage'),
          lbl('bigdeals-amount', 'Amount'),
        ],
        rows: largeStage56Deals,
        minAmount: LARGE_DEAL_MIN,
      },
      newOppsByMonth: newOppsByMonth.map(m => ({ label: m.label, count: m.count })),
      renewals: {
        windowDays: RENEWAL_WINDOW_DAYS,
        rows: expiringClients.map((c) => {
          const dms = dmsByCompany.get(normClientName(c.company)) || [];
          return {
            company: c.company,
            renewalStatus: c.renewalStatus,
            clientManager: c.clientManager,
            decisionMaker: dms.map(d => d.name).join(', '),
            invited: dms.length ? dms.map(d => (d.invited ? 'Yes' : 'No')).join(', ') : '',
            daysUntil: c.daysUntil,
          };
        }),
      },
      // Service Exploration Coverage: one summary row per tracked service —
      // explored count, client total and coverage %. Mirrors the on-screen
      // table (client set and "explored" rule identical). Omitted downstream
      // when the user tracks no services.
      serviceCoverage: (() => {
        const services = state.coverageServices || [];
        const clients = coverageClientsOf(prospects, cdmName, { statusMap: clientStores.statusMap, untrackedMap: clientStores.untrackedMap });
        const oppStagesByClient = buildOppStagesByClient(clients, oppsRecords);
        const labels = serviceLabelMap(buildServiceCatalog(settings));
        return {
          title: lbl('svc-cov-title', 'Service Exploration Coverage'),
          headers: [
            lbl('svc-cov-col-service', 'Service'),
            lbl('svc-cov-col-explored', 'Explored'),
            'Clients',
            lbl('svc-cov-col-coverage', 'Coverage'),
          ],
          rows: services.map((key) => {
            const cov = computeServiceCoverage(clients, key, oppStagesByClient);
            return {
              service: labels.get(key) || key,
              explored: cov.explored.length,
              total: cov.total,
              pct: cov.total ? cov.explored.length / cov.total : 0,
            };
          }),
        };
      })(),
      // Post-Sale Follow-Up: deals missing a Follow Up On Sale value, sorted
      // by date closed/sold (most recent first) — same rows as on screen.
      postSaleFollowUp: {
        title: lbl('postsale-title', 'Post-Sale Follow-Up: Deals Missing Follow Up On Sale'),
        headers: [
          lbl('postsale-client', 'Client'),
          lbl('postsale-agreement', 'Agreement Name'),
          lbl('postsale-sold', 'Date Closed / Sold'),
          lbl('postsale-goal', 'Days Since Sold: 60 Day Goal'),
        ],
        rows: postSaleFollowUps.map((d) => ({
          client: String(d['Client Name'] ?? d['Client Name '] ?? '').trim() || '-',
          agreement: String(d['Agreement Name'] ?? '').trim() || '-',
          soldDate: Number.isNaN(dealSoldTs(d)) ? '' : fmtDate(d['Original Contract Start']),
          goal: followUpGoalLabel(daysToFollowUpGoal(d['Original Contract Start'])),
        })),
      },
      // Strategic Accounts — My Accounts: the same on-screen table
      // (My Accounts mapped to the uploaded Strategic Accounts list), verbatim.
      strategicAccounts: {
        title: lbl('strat-title', 'Strategic Accounts: My Accounts'),
        headers: [lbl('strat-account', 'Account'), lbl('strat-owner', 'Account Owner'), lbl('strat-type', 'Type')],
        rows: strategicMyAccounts.map(s => ({ account: s.account, owner: s.owner, type: s.type })),
      },
      notes: [
        { title: lbl('notes-distractions-title', 'Eliminating Distractions'), text: state.notesDistractions },
        { title: lbl('notes-prospecting-title', 'Prospecting Approach'), text: [state.notesProspectingLeft, state.notesProspectingRight].filter(Boolean).join('\n') },
        { title: lbl('notes-efficient-title', 'Efficient Time Utilization'), text: state.notesEfficientTime },
      ],
    };
  }

  async function handleExportExcel(layout = 'multi') {
    if (exporting) return;
    setExporting(layout);
    try {
      await downloadPipelineWorkbook({ ...buildExportPayload(), layout });
    } catch (err) {
      alert('Failed to build the Excel report: ' + (err?.message || err));
    } finally {
      setExporting('');
    }
  }

  return (
    <CalcContext.Provider value={calcCtx}>
    <LabelCtx.Provider value={labelCtx}>
    <div
      className={styles.wrapper}
      onClick={() => { if (calcPinned) calcUnpin(); }}
    >
      {calcPopover}
      <div className={styles.header} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <h1 className={styles.title}>Pipeline</h1>
          <div className={styles.subtitle}>Pipeline metrics dashboard. Every cell is editable; values save to your browser. Hover a <span className={styles.liveCell} style={{ cursor: 'default' }}>live value</span> to see what feeds it; click to pin the panel, then <strong>⬇ Excel</strong> to export the full breakdown.</div>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={() => handleExportExcel('multi')}
            disabled={!!exporting}
            title="Download the Pipeline tab as a Schneider-formatted Excel report: one sheet per section"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.4rem 0.8rem', border: 'none', borderRadius: 6,
              background: exporting ? '#94A3B8' : '#3DCD58', color: '#fff',
              fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit',
              cursor: exporting ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <span>⬇</span>{exporting === 'multi' ? 'Exporting…' : 'Export Excel (tabs)'}
          </button>
          <button
            type="button"
            onClick={() => handleExportExcel('single')}
            disabled={!!exporting}
            title="Download the whole Pipeline tab on a single, polished Excel sheet"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.4rem 0.8rem', borderRadius: 6, border: '1px solid #009530',
              background: exporting ? '#F1F5F9' : '#fff', color: '#009530',
              fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit',
              cursor: exporting ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <span>⬇</span>{exporting === 'single' ? 'Exporting…' : 'Export Excel (one page)'}
          </button>
        </div>
      </div>
      <div className={styles.body}>
        {/* Quota header — sits directly above the Pipeline Metrics
            table so the YTD / % of Quota framing is visible before
            you read any of the per-stage rows. */}
        <div className={styles.section} style={{ maxWidth: 480 }}>
          <table className={styles.grid}>
            <thead><tr><th><EL id="q-target">Target</EL></th><th><EL id="q-closed-ytd">Closed YTD</EL></th><th><EL id="q-pct-quota">% of Quota</EL></th></tr></thead>
            <tbody>
              <tr>
                <td><NumCell value={state.target} kind="money" onCommit={(v) => setField('target', v)} /></td>
                <td>
                  {oppsClosedYTD !== null
                    ? (
                          <LiveValue
                            id="closedYTD"
                            className={styles.liveCell}
                            breakdown={{
                              title: `Closed YTD (${oppsClosedYTD.year})`,
                              value: fmtMoney(oppsClosedYTD.total),
                              formula: "Σ Quoted Amount where Stage = 'Sold' and Close Date is in the current calendar year.",
                              inputs: [
                                { label: 'Sold deals', value: oppsClosedYTD.deals.length },
                                { label: 'Total', value: fmtMoney(oppsClosedYTD.total) },
                              ],
                              rows: {
                                head: 'Contributing deals (newest close first)',
                                columns: ['Account', 'Close', 'Amount'],
                                aligns: ['', '', 'num'],
                                ...mapRows(oppsClosedYTD.deals, d => [d.account, fmtShortDate(d.closeDate), fmtMoney(d.amount)], {
                                  exportColumns: ['Account', 'BFO Opportunity Name', 'Scope', 'Close', 'Amount'],
                                  exportMapFn: d => [d.account, d.bfoName || '', d.scope || '', fmtShortDate(d.closeDate), fmtMoney(d.amount)],
                                }),
                              },
                              note: 'Auto-fed from the Opps tab. Re-paste the Opps tab to refresh.',
                            }}
                          >{fmtMoney(oppsClosedYTD.total)}</LiveValue>
                        )
                    : <NumCell value={state.closedYTD} kind="money" onCommit={(v) => setField('closedYTD', v)} />}
                </td>
                <td className={styles.numCell}>{(closedPctOfQuota * 100).toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Pipeline funnel — the stage volumes from the metrics table drawn
            as a horizontal funnel, with a red dotted goal line (and shaded
            shortfall) on every stage that's running under its goal. */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="t-pipeline-funnel">PIPELINE FUNNEL</EL></div>
          <PipelineFunnel
            stages={funnelStages}
            outcome={{
              soldLabel: 'Closed YTD',
              soldAmount: effectiveClosedYTD,
              soldCount: oppsClosedYTD ? oppsClosedYTD.deals.length : null,
              target: Number(state.target) || 0,
            }}
          />
        </div>

        {/* Pipeline metrics */}
        <div className={styles.section}>
          <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span><EL id="t-pipeline-metrics">PIPELINE METRICS</EL></span>
            <button
              type="button"
              onClick={() => {
                if (!confirm('Reset all Pipeline Metrics rows to default values?')) return;
                setState(s => ({ ...s, stages: DEFAULT_STATE.stages }));
              }}
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 4, fontSize: 11, padding: '0.15rem 0.5rem', cursor: 'pointer', fontFamily: 'inherit' }}
              title="Restore the stage rows + goal seeds to defaults if the table looks blank or corrupted."
            >Reset table</button>
          </div>
          <MetricsTableBoundary>
          <div style={{ overflowX: 'auto' }}>
          <table className={`${styles.grid} ${styles.metricsGrid}`} style={{ width: 1515, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 140 }} /> {/* Stage label */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Active Opps */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Deal Size */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Pipeline */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Close Rate */}
              <col style={{ width: 105 }} /> {/* Target Projection */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Avg Opp Life */}
              <col style={{ width: 220 }} /> {/* Flagged Opps */}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className={styles.headerLeft}><EL id="m-stage">Stage</EL></th>
                <th colSpan={2}><EL id="m-active-opps">Active Opportunities</EL></th>
                <th colSpan={2}><EL id="m-deal-size">Deal Size</EL></th>
                <th colSpan={2}><EL id="m-pipeline">Pipeline</EL></th>
                <th colSpan={2}><EL id="m-close-rate">Close Rate (Rolling 365 days)</EL></th>
                <th><EL id="m-target-proj">Target Projection</EL></th>
                <th colSpan={2}><EL id="m-opp-life">Avg Opp Life</EL></th>
                <th><EL id="m-flagged-opps">Flagged Opps</EL></th>
              </tr>
              <tr>
                <th><EL id="m-active-goal">Goal (above)</EL></th><th><EL id="m-active-actual">Actual</EL></th>
                <th><EL id="m-dealsize-goal">Goal (above)</EL></th><th><EL id="m-dealsize-actual">Actual</EL></th>
                <th><EL id="m-pipeline-goal">Goal (above)</EL></th><th><EL id="m-pipeline-actual">Actual</EL></th>
                <th><EL id="m-closerate-goal">Goal (above)</EL></th><th><EL id="m-closerate-actual">Actual</EL></th>
                <th><EL id="m-targetproj-goal">Goal</EL></th>
                <th><EL id="m-opplife-goal">Goal (less than)</EL></th><th><EL id="m-opplife-actual">Actual</EL></th>
                <th><EL id="m-flagged-kill">Quote / Contract or Kill</EL></th>
              </tr>
            </thead>
            <tbody>
              {renderStages.map((st, i) => {
                const stageNum = Number(String(st.key).replace(/[^0-9]/g, ''));
                const m = bfoMetrics[stageNum];
                const live = (val) => hasBfo && val !== null && val !== undefined ? val : null;
                const activeActual = live(m?.count) ?? st.activeActual;
                const dealSizeActual = live(m?.avg) ?? st.dealSizeActual;
                const pipelineActual = live(m?.total) ?? st.pipelineActual;
                const lifeActual = live(m?.avgAge) ?? st.lifeActual;
                const fromBfo = (v) => hasBfo && v !== null && v !== undefined;
                const liveTip = 'Auto-fed from BFO Activity. Re-paste BFO data to refresh.';
                // Build the row list (account / opportunity / amount-or-age)
                // that feeds the hover breakdown for the BFO-driven cells.
                const mkBfoRows = (head, includeAge) => ({
                  head,
                  columns: ['Account', 'Opportunity', includeAge ? 'Age' : 'Amount'],
                  aligns: ['', '', 'num'],
                  ...mapRows(m?.rows || [], r => [
                    r.account || '-',
                    r.oppName || '-',
                    includeAge
                      ? (r.age ?? '-')
                      : (r.amount == null ? '-' : `${fmtMoney(Math.round(r.amount))}${r.excludedFromAvg ? ' *' : ''}`),
                  ], {
                    exportColumns: ['Account', 'Opportunity', 'Scope', includeAge ? 'Age' : 'Amount'],
                    exportMapFn: r => [
                      r.account || '-',
                      r.oppName || '-',
                      r.scope || '',
                      includeAge
                        ? (r.age ?? '-')
                        : (r.amount == null ? '-' : `${fmtMoney(Math.round(r.amount))}${r.excludedFromAvg ? ' *' : ''}`),
                    ],
                  }),
                });
                return (
                  <tr key={st.key}>
                    <td className={styles.label}>{st.label}</td>
                    <td><NumCell value={st.activeGoal} onCommit={(v) => setStage(i, { activeGoal: v })} /></td>
                    <td className={compareClass(activeActual, st.activeGoal, 'higher-better')}>
                      {fromBfo(m?.count)
                        ? <LiveValue
                            id={`active-${stageNum}`}
                            className={styles.liveCell}
                            breakdown={{
                              title: `${st.label}: Active Opportunities`,
                              value: String(activeActual),
                              formula: `COUNT of BFO Activity rows whose Sales Stage matches "${st.label}".`,
                              inputs: [{ label: 'Matching rows', value: m.count }],
                              rows: mkBfoRows('Matching BFO opps', false),
                              note: liveTip,
                            }}
                          >{activeActual}</LiveValue>
                        : <NumCell value={st.activeActual} onCommit={(v) => setStage(i, { activeActual: v })} />}
                    </td>
                    <td><NumCell value={st.dealSizeGoal} kind="money" onCommit={(v) => setStage(i, { dealSizeGoal: v })} /></td>
                    <td className={compareClass(dealSizeActual, st.dealSizeGoal, 'higher-better')}>
                      {fromBfo(m?.avg)
                        ? <LiveValue
                            id={`dealsize-${stageNum}`}
                            className={styles.liveCell}
                            breakdown={{
                              title: `${st.label}: Deal Size (Actual)`,
                              value: fmtMoney(Math.round(dealSizeActual)),
                              formula: stageNum === 6
                                ? 'AVERAGE(Amount) across matching BFO rows, excluding the $80k template placeholder (marked *).'
                                : 'AVERAGE(Amount) across matching BFO rows.',
                              inputs: [
                                { label: 'Rows averaged', value: m.amtCount },
                                { label: 'Average', value: fmtMoney(Math.round(dealSizeActual)) },
                              ],
                              rows: mkBfoRows('Amounts averaged', false),
                              note: liveTip,
                            }}
                          >{fmtMoney(Math.round(dealSizeActual))}</LiveValue>
                        : <NumCell value={st.dealSizeActual} kind="money" onCommit={(v) => setStage(i, { dealSizeActual: v })} />}
                    </td>
                    {/* Calculated from the two goals to its left — the cell
                        isn't editable; change Active Opportunities Goal or
                        Deal Size Goal to move it. */}
                    <td className={styles.numCell}>
                      <LiveValue
                        id={`pipelinegoal-${stageNum}`}
                        className={styles.liveCell}
                        breakdown={{
                          title: `${st.label}: Pipeline (Goal)`,
                          value: fmtMoney(st.pipelineGoal),
                          formula: 'Active Opportunities Goal × Deal Size Goal.',
                          inputs: [
                            { label: 'Active opp goal', value: Number(st.activeGoal) || 0 },
                            { label: 'Deal size goal', value: fmtMoney(Number(st.dealSizeGoal) || 0) },
                            { label: 'Pipeline goal', value: fmtMoney(st.pipelineGoal) },
                          ],
                          note: 'Calculated: edit the Active Opportunities or Deal Size goal to change it.',
                        }}
                      >{st.pipelineGoal ? fmtMoney(st.pipelineGoal) : ''}</LiveValue>
                    </td>
                    <td className={compareClass(pipelineActual, st.pipelineGoal, 'higher-better')}>
                      {fromBfo(m?.total)
                        ? <LiveValue
                            id={`pipeline-${stageNum}`}
                            className={styles.liveCell}
                            breakdown={{
                              title: `${st.label}: Pipeline (Actual)`,
                              value: fmtMoney(Math.round(pipelineActual)),
                              formula: 'SUM(Amount) across matching BFO rows.',
                              inputs: [
                                { label: 'Rows summed', value: m.count },
                                { label: 'Total', value: fmtMoney(Math.round(pipelineActual)) },
                              ],
                              rows: mkBfoRows('Amounts summed', false),
                              note: liveTip,
                            }}
                          >{fmtMoney(Math.round(pipelineActual))}</LiveValue>
                        : <NumCell value={st.pipelineActual} kind="money" onCommit={(v) => setStage(i, { pipelineActual: v })} />}
                    </td>
                    <td><NumCell value={st.closeGoal} kind="pct" onCommit={(v) => setStage(i, { closeGoal: v })} /></td>
                    {(() => {
                      const live = oppsCloseRateByStage[stageNum];
                      const liveRate = live ? live.rate : null;
                      const actualForCmp = liveRate !== null ? liveRate : st.closeActual;
                      const cls = compareClass(actualForCmp, st.closeGoal, 'higher-better');
                      if (liveRate !== null) {
                        const signal = stageNum === 3
                          ? 'a BFO opportunity value (non-empty BFO Link)'
                          : stageNum === 4
                          ? 'a BFO opportunity value (non-empty BFO Link), excluding AEM scope and "Never connected" status'
                          : stageNum === 5
                          ? 'a Quoted On date'
                          : stageNum === 6
                          ? 'a non-empty Entity Outside the US Approval value'
                          : 'the stage signal';
                        return (
                          <td className={`${cls} ${styles.numCell}`.trim()}>
                            <LiveValue
                              id={`closerate-${stageNum}`}
                              className={styles.liveCell}
                              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}
                              breakdown={{
                                title: `${st.label}: Close Rate (rolling 365 days)`,
                                value: `${(liveRate * 100).toFixed(0)}%  (${live.sold}/${live.sold + live.notSold})`,
                                formula: `Sold ÷ (Sold + Not Sold), over Opps closed in the last 365 days that reached this stage (signal: ${signal}) with a Scope without "pull through".`,
                                inputs: [
                                  { label: 'Sold', value: live.sold },
                                  { label: 'Not Sold', value: live.notSold },
                                  { label: 'Close rate', value: `${(liveRate * 100).toFixed(0)}%` },
                                ],
                                rows: closeRateRows(live.included, 'Opps included (newest close first)'),
                                note: 'Auto-fed from the Opps tab. Re-paste the Opps tab to refresh.',
                              }}
                            >
                              <span>{`${(liveRate * 100).toFixed(0)}%`}</span>
                              <span style={{ fontSize: '0.65rem', opacity: 0.75, fontWeight: 500 }}>{live.sold}/{live.sold + live.notSold}</span>
                            </LiveValue>
                          </td>
                        );
                      }
                      return (
                        <td className={cls}>
                          <NumCell value={st.closeActual} kind="pct" onCommit={(v) => setStage(i, { closeActual: v })} />
                        </td>
                      );
                    })()}
                    {(() => {
                      const ag = Number(st.activeGoal) || 0;
                      const dg = Number(st.dealSizeGoal) || 0;
                      const cg = Number(st.closeGoal) || 0;
                      const projGoal = Math.round(ag * dg * cg);
                      // Tooltip shows the exact numbers feeding the
                      // formula so a wrong-looking total can be traced
                      // back to which input is off.
                      const tip = `${ag} × ${fmtMoney(dg)} × ${(cg * 100).toFixed(2)}% = ${fmtMoney(projGoal)}`;
                      return (
                        <td className={styles.numCell} title={tip}>
                          {projGoal ? fmtMoney(projGoal) : ''}
                        </td>
                      );
                    })()}
                    <td><NumCell value={st.lifeGoal} onCommit={(v) => setStage(i, { lifeGoal: v })} /></td>
                    <td className={compareClass(lifeActual, st.lifeGoal, 'lower-better')}>
                      {fromBfo(m?.avgAge)
                        ? <LiveValue
                            id={`life-${stageNum}`}
                            className={styles.liveCell}
                            breakdown={{
                              title: `${st.label}: Avg Opp Life`,
                              value: `${lifeActual}`,
                              formula: 'AVERAGE(Age, in days) across matching BFO rows that carry an Age.',
                              inputs: [
                                { label: 'Rows with Age', value: m.ageCount },
                                { label: 'Average (days)', value: lifeActual },
                              ],
                              rows: mkBfoRows('Ages averaged', true),
                              note: liveTip,
                            }}
                          >{lifeActual}</LiveValue>
                        : <NumCell value={st.lifeActual} onCommit={(v) => setStage(i, { lifeActual: v })} />}
                    </td>
                    {/* Flagged opps — active opps past this stage's max target
                        age (the "Goal (less than)" days), tagged with the
                        stage's kill move. Names truncate rather than wrap;
                        hover for the full list with ages. */}
                    {(() => {
                      const killFlag = STAGE_KILL_FLAG[stageNum];
                      const flaggedOpps = killFlag
                        ? (m?.rows || []).filter(r => r.age != null && st.lifeGoal != null && r.age > st.lifeGoal)
                        : [];
                      const label = (r) => r.account || r.oppName || '(no account)';
                      return (
                        <td
                          style={{ textAlign: 'left', padding: '0.3rem 0.5rem', fontSize: '0.72rem' }}
                          title={killFlag && flaggedOpps.length
                            ? `${killFlag}: age > ${st.lifeGoal}d:\n` + flaggedOpps.map(r => `• ${label(r)} · ${r.age}d`).join('\n')
                            : killFlag
                              ? `No ${st.label} opps past their ${st.lifeGoal ?? '-'}-day target.`
                              : 'No kill move for this stage.'}
                        >
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {killFlag && flaggedOpps.length
                              ? <span style={{ color: '#B45309', fontWeight: 600 }}>{killFlag}: {flaggedOpps.map(label).join(', ')}</span>
                              : <span style={{ color: '#94A3B8' }}>-</span>}
                          </div>
                        </td>
                      );
                    })()}
                  </tr>
                );
              })}
              <tr>
                <td className={styles.label}><EL id="m-total">Total</EL></td>
                <td className={styles.numCell}>{stageTotals.activeGoal}</td>
                <td className={styles.numCell}>{stageTotals.activeActual}</td>
                <td className={styles.numCell}>{fmtMoney(dealSizeAvgGoal)}</td>
                <td className={styles.numCell}>{fmtMoney(dealSizeAvgActual)}</td>
                <td className={styles.numCell}>{fmtMoney(stageTotals.pipelineGoal)}</td>
                <td className={styles.numCell}>{fmtMoney(stageTotals.pipelineActual)}</td>
                <td />
                <td className={styles.numCell} title={oppsCloseRateActual ? undefined
                  : 'Add Sold / Not Sold opps with a Close Date in the past 365 days (and a Scope without "pull through") on the Opps tab to populate.'}>
                  {oppsCloseRateActual ? (
                    <LiveValue
                      id="closerate-total"
                      className={styles.liveCell}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.15 }}
                      breakdown={{
                        title: 'Overall Close Rate (rolling 365 days)',
                        value: `${(oppsCloseRateActual.rate * 100).toFixed(0)}%  (${oppsCloseRateActual.sold}/${oppsCloseRateActual.sold + oppsCloseRateActual.notSold})`,
                        formula: 'Sold ÷ (Sold + Not Sold) for Opps closed in the past 365 days, with "pull through" Scopes excluded.',
                        inputs: [
                          { label: 'Sold', value: oppsCloseRateActual.sold },
                          { label: 'Not Sold', value: oppsCloseRateActual.notSold },
                          { label: 'Close rate', value: `${(oppsCloseRateActual.rate * 100).toFixed(0)}%` },
                        ],
                        rows: closeRateRows(oppsCloseRateActual.included, 'Opps included (newest close first)'),
                        note: 'Auto-fed from the Opps tab. Re-paste the Opps tab to refresh.',
                      }}
                    >
                      <span>{`${(oppsCloseRateActual.rate * 100).toFixed(0)}%`}</span>
                      <span style={{ fontSize: '0.65rem', opacity: 0.75, fontWeight: 500 }}>{oppsCloseRateActual.sold}/{oppsCloseRateActual.sold + oppsCloseRateActual.notSold}</span>
                    </LiveValue>
                  ) : ''}
                </td>
                <td className={styles.numCell} title="Sum of stage Target Projection Goals (Active Goal × Deal Size Goal × Close Rate Goal).">{fmtMoney(Math.round(stageTotals.targetProjGoal))}</td>
                <td className={styles.numCell} title="Stage goals weighted by Active Opp Goal: SUMPRODUCT(lifeGoal, activeGoal) ÷ SUM(activeGoal). Less is better.">{lifeGoalAvg ?? ''}</td>
                <td className={`${styles.numCell} ${compareClass(lifeActualAvg, lifeGoalAvg, 'lower-better')}`.trim()} title="Stage actuals weighted by Active Opp Actual (live BFO count when loaded). SUMPRODUCT(lifeActual, activeActual) ÷ SUM(activeActual).">{lifeActualAvg ?? ''}</td>
                <td />
              </tr>
            </tbody>
          </table>
          </div>
          </MetricsTableBoundary>
        </div>

        {/* Mid row — Client/Greenfield + Coverage Ratio + % deals
            not Quoted. Widths are pinned to the metrics colgroup
            above (Stage 140 + 4×105 = 560 px to the left edge of
            Pipeline, then 2×105 = 210 px for Pipeline itself) so
            Coverage Ratio sits directly under the Pipeline column
            and the two blue borders read as a single vertical block. */}
        <div className={styles.midRow} style={{ flexWrap: 'nowrap' }}>
          <div className={styles.section} style={{ flex: '0 0 544px' }}>
            <table className={styles.grid} style={{ width: '100%' }}>
              <thead>
                <tr><th /><th><EL id="cg-count">Count / $</EL></th><th><EL id="cg-goal-client">Goal - Client</EL></th><th><EL id="cg-actual-client">Actual - Client</EL></th></tr>
              </thead>
              <tbody>
                {(() => {
                  const cg = clientGreenfieldFromBfo;
                  const live = !!cg;
                  const liveTip = 'Auto-fed from BFO Activity rows (Stages 3–6) joined to the Opps tab Lead Source. Re-paste BFO or Opps to refresh.';
                  const liveCell = (val, id, breakdown) => (
                    <LiveValue id={id} className={styles.liveCell} breakdown={breakdown}>{val}</LiveValue>
                  );
                  const cgRows = (arr, head) => ({
                    head,
                    columns: ['Opportunity', 'Lead Source', 'Amount'],
                    aligns: ['', '', 'num'],
                    ...mapRows(arr || [], r => [r.oppName, r.source, r.amount == null ? '-' : fmtMoney(Math.round(r.amount))], {
                      exportColumns: ['Opportunity', 'Lead Source', 'Scope', 'Amount'],
                      exportMapFn: r => [r.oppName, r.source, r.scope || '', r.amount == null ? '-' : fmtMoney(Math.round(r.amount))],
                    }),
                  });
                  const liveActualPct = cg && cg.clientActualPct !== null
                    ? `${(cg.clientActualPct * 100).toFixed(0)}%`
                    : null;
                  const goalForCompare = Number(state.clientGoalPct);
                  const actualForCompare = cg?.clientActualPct ?? state.clientActualPct;
                  return (
                    <>
                      <tr>
                        <td className={styles.label}><EL id="cg-row-client-opps">Current client opps</EL></td>
                        <td>{live
                          ? liveCell(cg.clientCount, 'cg-client-count', {
                              title: 'Current client opps',
                              value: String(cg.clientCount),
                              formula: 'COUNT of active BFO opps (Stages 3–6) whose joined Opps Lead Source mentions client / existing / renewal / cross-sell / expansion / upsell.',
                              inputs: [
                                { label: 'Client opps', value: cg.clientCount },
                                { label: 'Greenfield opps', value: cg.greenfieldCount },
                              ],
                              rows: cgRows(cg.clientRows, 'Client-classified opps'),
                              note: liveTip,
                            })
                          : <NumCell value={state.currentClientCount} onCommit={(v) => setField('currentClientCount', v)} />}
                        </td>
                        <td rowSpan={2}><NumCell value={state.clientGoalPct} kind="pct" onCommit={(v) => setField('clientGoalPct', v)} /></td>
                        <td rowSpan={2} className={compareClass(actualForCompare, goalForCompare, 'lower-better')}>
                          {live && liveActualPct !== null
                            ? liveCell(liveActualPct, 'cg-client-pct', {
                                title: '% Current client',
                                value: liveActualPct,
                                formula: 'Client opps ÷ (Client + Greenfield opps).',
                                inputs: [
                                  { label: 'Client opps', value: cg.clientCount },
                                  { label: 'Greenfield opps', value: cg.greenfieldCount },
                                  { label: 'Total', value: cg.total },
                                ],
                                rows: cgRows(cg.clientRows, 'Client-classified opps'),
                                note: liveTip,
                              })
                            : <NumCell value={state.clientActualPct} kind="pct" onCommit={(v) => setField('clientActualPct', v)} />}
                        </td>
                      </tr>
                      <tr>
                        <td className={styles.label}><EL id="cg-row-green-opps">Greenfield opps</EL></td>
                        <td>{live
                          ? liveCell(cg.greenfieldCount, 'cg-green-count', {
                              title: 'Greenfield opps',
                              value: String(cg.greenfieldCount),
                              formula: 'COUNT of active BFO opps (Stages 3–6) that are not client-classified (including rows with no matched Lead Source).',
                              inputs: [
                                { label: 'Greenfield opps', value: cg.greenfieldCount },
                                { label: 'Client opps', value: cg.clientCount },
                              ],
                              rows: cgRows(cg.greenfieldRows, 'Greenfield-classified opps'),
                              note: liveTip,
                            })
                          : <NumCell value={state.greenfieldCount} onCommit={(v) => setField('greenfieldCount', v)} />}
                        </td>
                      </tr>
                      <tr>
                        <td className={styles.label}><EL id="cg-row-client-amt">Current client $</EL></td>
                        <td>{live
                          ? liveCell(fmtMoney(cg.clientAmt), 'cg-client-amt', {
                              title: 'Current client $',
                              value: fmtMoney(cg.clientAmt),
                              formula: 'Σ Amount of client-classified BFO opps.',
                              inputs: [
                                { label: 'Client opps', value: cg.clientCount },
                                { label: 'Total', value: fmtMoney(cg.clientAmt) },
                              ],
                              rows: cgRows(cg.clientRows, 'Client-classified opps'),
                              note: liveTip,
                            })
                          : <NumCell value={state.currentClientAmt} kind="money" onCommit={(v) => setField('currentClientAmt', v)} />}
                        </td>
                        <td colSpan={2} />
                      </tr>
                      <tr>
                        <td className={styles.label}><EL id="cg-row-green-amt">Greenfield $</EL></td>
                        <td>{live
                          ? liveCell(fmtMoney(cg.greenfieldAmt), 'cg-green-amt', {
                              title: 'Greenfield $',
                              value: fmtMoney(cg.greenfieldAmt),
                              formula: 'Σ Amount of greenfield-classified BFO opps.',
                              inputs: [
                                { label: 'Greenfield opps', value: cg.greenfieldCount },
                                { label: 'Total', value: fmtMoney(cg.greenfieldAmt) },
                              ],
                              rows: cgRows(cg.greenfieldRows, 'Greenfield-classified opps'),
                              note: liveTip,
                            })
                          : <NumCell value={state.greenfieldAmt} kind="money" onCommit={(v) => setField('greenfieldAmt', v)} />}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>

          <div className={styles.section} style={{ flex: '0 0 210px' }}>
            <table className={styles.grid} style={{ width: '100%' }}>
              <thead>
                <tr><th colSpan={2}><EL id="cov-title">Coverage Ratio</EL></th></tr>
                <tr><th><EL id="cov-goal">Goal</EL></th><th><EL id="cov-actual">Actual</EL></th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><NumCell value={state.coverageGoal} kind="ratio" onCommit={(v) => setField('coverageGoal', v)} /></td>
                  {(() => {
                    // Coverage Ratio Actual = total Actual Pipeline ÷ Target.
                    // Auto-fed; only meaningful when BFO data is loaded
                    // (otherwise we'd be dividing by seeded numbers).
                    const computedCoverage = hasBfo && state.target > 0
                      ? stageTotals.pipelineActual / state.target
                      : null;
                    return (
                      <td className={compareClass(computedCoverage, state.coverageGoal, 'higher-better')}>
                        {computedCoverage !== null ? (
                          <LiveValue
                            id="coverage-actual"
                            className={styles.liveCell}
                            breakdown={{
                              title: 'Coverage Ratio (Actual)',
                              value: computedCoverage.toFixed(2),
                              formula: 'Total Actual Pipeline ÷ Target.',
                              inputs: [
                                { label: 'Actual Pipeline', value: fmtMoney(stageTotals.pipelineActual) },
                                { label: 'Target', value: fmtMoney(state.target) },
                                { label: 'Ratio', value: computedCoverage.toFixed(2) },
                              ],
                              note: 'Actual Pipeline is the live BFO sum across Stages 3–6. Re-paste BFO to refresh.',
                            }}
                          >{computedCoverage.toFixed(2)}</LiveValue>
                        ) : (
                          <span className={styles.noBfoCell}>-</span>
                        )}
                      </td>
                    );
                  })()}
                </tr>
              </tbody>
            </table>
          </div>

          {/* One column per NOT_QUOTED_WINDOWS entry beside the Goal, at
              the same 105 px the metrics colgroup uses. */}
          <div className={styles.section} style={{ flex: `0 0 ${105 * (NOT_QUOTED_WINDOWS.length + 1)}px` }}>
            <table className={styles.grid} style={{ width: '100%' }}>
              <thead>
                <tr><th colSpan={NOT_QUOTED_WINDOWS.length + 1}><EL id="nq-title">% of deals not Quoted</EL></th></tr>
                <tr>
                  <th><EL id="nq-goal">Goal</EL></th>
                  {NOT_QUOTED_WINDOWS.map(w => (
                    <th key={w.key}><EL id={w.labelId}>{w.label}</EL></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><NumCell value={state.notQuotedGoal} kind="pct" onCommit={(v) => setField('notQuotedGoal', v)} /></td>
                  {notQuotedCells.map(({ key, days, label, field, live, pct }) => (
                    <td key={key} className={compareClass(pct, state.notQuotedGoal, 'lower-better')}>
                      {live
                        ? (
                            <LiveValue
                              id={`notQuoted-${key}`}
                              className={styles.liveCell}
                              breakdown={{
                                title: `% Not Quoted: ${label}`,
                                value: `${Math.round(live.pct * 100)}%  (${live.notQuoted}/${live.total})`,
                                formula: `Closed deals (Sold or Not Sold) with a close date in the last ${days} days and no days logged in the Quoted or Agreement Sent stages, ÷ all closed deals in that window.`,
                                inputs: [
                                  { label: 'Not quoted', value: live.notQuoted },
                                  { label: 'Closed deals', value: live.total },
                                  { label: '% not quoted', value: `${Math.round(live.pct * 100)}%` },
                                ],
                                rows: notQuotedRows(live.deals, `Closed deals in the last ${days} days (newest close first)`),
                                note: 'Auto-fed from the Opps tab stage history. Pull-through opps are excluded. Re-paste the Opps tab to refresh.',
                              }}
                            >{`${Math.round(live.pct * 100)}%`}</LiveValue>
                          )
                        : <NumCell value={state[field]} kind="pct" onCommit={(v) => setField(field, v)} />}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

        </div>

        {/* Largest Stage 5 & 6 Deals — late-stage opps above $100k, biggest
            first. Mirrors the section in the one-page export; sits directly
            above New Opps by Month. */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>
            <EL id="bigdeals-title">Largest Stage 5 &amp; 6 Deals: Above $100k</EL>
          </div>
          <div className={styles.scrollX}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={styles.headerLeft}><EL id="bigdeals-account">Account</EL></th>
                <th className={styles.headerLeft}><EL id="bigdeals-opp">Opportunity</EL></th>
                <th className={styles.headerLeft}><EL id="bigdeals-stage">Stage</EL></th>
                <th><EL id="bigdeals-amount">Amount</EL></th>
              </tr>
            </thead>
            <tbody>
              {largeStage56Deals.length === 0 ? (
                <tr>
                  <td className={styles.label} colSpan={4} style={{ color: '#64748b', fontWeight: 500 }}>
                    {hasBfo
                      ? `No Stage 5 or 6 deals above $${LARGE_DEAL_MIN.toLocaleString('en-US')}.`
                      : `Load BFO Activity to list Stage 5 & 6 deals above $${LARGE_DEAL_MIN.toLocaleString('en-US')}.`}
                  </td>
                </tr>
              ) : largeStage56Deals.map((d, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{d.account}</td>
                  <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{d.oppName}</td>
                  <td style={{ textAlign: 'left' }}>{d.stage}</td>
                  <td className={styles.numCell} style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        {/* New Opps by Month — BFO-linked opps created in each of the past 6
            months, laid out horizontally (months across). Each count is green
            when it's 5 or more, red when it's below 5. */}
        <div className={styles.section} style={{ maxWidth: 760 }}>
          <div className={styles.sectionTitle}><EL id="nom-title">New Opps by Month</EL></div>
          <div className={styles.scrollX}>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th className={styles.headerLeft}><EL id="nom-month">Month</EL></th>
                {newOppsByMonth.map(m => <th key={m.key}>{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={styles.label}><EL id="nom-new-opps">New Opps</EL></td>
                {newOppsByMonth.map(m => {
                  const color = m.count >= 5 ? '#16a34a' : '#dc2626';
                  return (
                    <td key={m.key} className={styles.numCell} style={{ textAlign: 'center' }}>
                      <LiveValue
                        id={`new-opps-${m.key}`}
                        className={styles.liveCell}
                        style={{ color, borderBottomColor: color, fontWeight: 700 }}
                        breakdown={{
                          title: `New Opps: ${m.label}`,
                          value: String(m.count),
                          formula: 'COUNT of Opps with a BFO Opportunity Name created in this month. Open date prefers Start Date, else fetchedAt − Age.',
                          inputs: [{ label: 'New opps', value: m.count }],
                          rows: {
                            head: 'New opps (by account)',
                            columns: ['Account', 'Opportunity', 'Opened'],
                            aligns: ['', '', ''],
                            ...mapRows(m.items, it => [it.account, it.opp, it.openDate], {
                              exportColumns: ['Account', 'Opportunity', 'BFO Opportunity Name', 'Scope', 'Opened'],
                              exportMapFn: it => [it.account, it.opp, it.bfoName || '', it.scope || '', it.openDate],
                            }),
                          },
                          note: 'Auto-fed from the Opps tab. Re-paste the Opps tab to refresh.',
                        }}
                      >{m.count}</LiveValue>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
          </div>
        </div>

        {/* Service exploration coverage — pick a service, see what share of
            active clients have explored it (from each company page's Services
            Explored section). Sits above the renewals table. */}
        <ServiceCoverageSection
          prospects={prospects}
          cdmName={cdmName}
          settings={settings}
          onSelectProspect={onSelectProspect}
          services={state.coverageServices || []}
          onChangeServices={(next) => setField('coverageServices', next)}
          oppsRecords={oppsRecords}
          clientStatusMap={clientStores.statusMap}
          clientUntrackedMap={clientStores.untrackedMap}
        />

        {/* Client renewals — active clients whose soonest contract End Date
            is within the renewal window. Pulled from the Clients tab. */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="ren-title">{`Client Renewals: Contracts Expiring Within ${RENEWAL_WINDOW_DAYS} Days`}</EL></div>
          <table className={styles.tinyTable} title={`Auto-fed from the Clients tab: active clients (CDM = ${cdmName || 'your CDM'} and Status = Client) whose soonest contract End Date is within ${RENEWAL_WINDOW_DAYS} days. Sorted soonest first; negative = already overdue.`}>
            <thead>
              <tr>
                <th><EL id="ren-client">Client</EL></th>
                <th><EL id="ren-status">Renewal Status</EL></th>
                <th><EL id="ren-client-manager">Client Manager</EL></th>
                <th><EL id="ren-decision-maker">Decision Maker</EL></th>
                <th><EL id="ren-invited">Invited to Louisville</EL></th>
                <th><EL id="ren-days-until">Days Until Expiration</EL></th>
              </tr>
            </thead>
            <tbody>
              {expiringClients.length > 0 ? (
                expiringClients.map((c) => {
                  const dms = dmsByCompany.get(normClientName(c.company)) || [];
                  // Grey out clients who've told us they're cancelling for
                  // sure — they're effectively lost, so they recede from the
                  // renewals still worth chasing.
                  const isCancelling = String(c.renewalStatus || '').trim().toLowerCase() === 'cancelling for sure';
                  return (
                  <tr key={c.id} className={isCancelling ? styles.cancelledRow : undefined}>
                    <td>
                      {onSelectProspect ? (
                        <span className={styles.linkCell} onClick={() => openClientModal(c)}>{c.company}</span>
                      ) : c.company}
                    </td>
                    <td>{c.renewalStatus || '-'}</td>
                    <td>{c.clientManager || '-'}</td>
                    <td>
                      {dms.length > 0 ? dms.map((dm, i) => (
                        <div key={i}>
                          {onSelectProspect ? (
                            <span className={styles.linkCell} onClick={() => openClientModal(c, dm.contact)}>{dm.name}</span>
                          ) : dm.name}
                        </div>
                      )) : '-'}
                    </td>
                    <td>
                      {dms.length > 0 ? dms.map((dm, i) => (
                        <div key={i} style={{ color: dm.invited ? '#16a34a' : '#94a3b8' }}>
                          {dm.invited ? 'Yes' : 'No'}
                        </div>
                      )) : '-'}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', color: c.daysUntil < 0 ? '#dc2626' : undefined }}>
                      {c.daysUntil < 0 ? `${c.daysUntil} (overdue)` : c.daysUntil}
                    </td>
                  </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} style={{ color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', padding: '0.6rem' }}>
                    No clients with contracts expiring in the next {RENEWAL_WINDOW_DAYS} days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Post-Sale Follow-Up — deals from the Deals subtab with no "Follow
            Up On Sale" value, sorted by date closed/sold (most recent first).
            Mirrors the Clients tab's Post-Sale Follow-Up subtab. */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="postsale-title">Post-Sale Follow-Up: Deals Missing Follow Up On Sale</EL></div>
          <table className={styles.tinyTable} title="Deals from the Clients → Deals subtab with no Follow Up On Sale value. Sorted by how long it's been since the deal was sold (Original Contract Start): longest since sold first.">
            <thead>
              <tr>
                <th><EL id="postsale-client">Client</EL></th>
                <th><EL id="postsale-agreement">Agreement Name</EL></th>
                <th><EL id="postsale-sold">Date Closed / Sold</EL></th>
                <th><EL id="postsale-goal">Days Since Sold: 60 Day Goal</EL></th>
              </tr>
            </thead>
            <tbody>
              {postSaleFollowUps.length > 0 ? (
                postSaleFollowUps.map((d, i) => (
                  <tr key={i}>
                    <td>{String(d['Client Name'] ?? d['Client Name '] ?? '').trim() || '-'}</td>
                    <td>{String(d['Agreement Name'] ?? '').trim() || '-'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{Number.isNaN(dealSoldTs(d)) ? '-' : fmtDate(d['Original Contract Start'])}</td>
                    <td>{renderDaysToGoal(d['Original Contract Start'])}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} style={{ color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', padding: '0.6rem' }}>
                    {(clientStores.deals && clientStores.deals.length)
                      ? 'Every uploaded deal has a Follow Up On Sale value: nothing to follow up on.'
                      : 'No deals uploaded yet. Upload contract data on the Clients → Deals subtab.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* My Accounts mapped to the uploaded Strategic Accounts list, with
            each mapped row's Account Owner + Type. Hidden when nothing is
            mapped so the section doesn't show an empty shell. */}
        {strategicMyAccounts.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}><EL id="strat-title">Strategic Accounts: My Accounts</EL></div>
            <table className={styles.tinyTable} title="Your accounts mapped to the uploaded Strategic Accounts list (from the Lists tab), with each mapped row's Account Owner and Type.">
              <thead>
                <tr>
                  <th><EL id="strat-account">Account</EL></th>
                  <th><EL id="strat-owner">Account Owner</EL></th>
                  <th><EL id="strat-type">Type</EL></th>
                </tr>
              </thead>
              <tbody>
                {strategicMyAccounts.map((s, i) => (
                  <tr key={i}>
                    <td>
                      {onSelectProspect ? (
                        <span className={styles.linkCell} onClick={() => openStrategicAccount(s.account)}>{s.account}</span>
                      ) : s.account}
                    </td>
                    <td>{s.owner || '-'}</td>
                    <td>{s.type || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Strategy notes — free-text, editable, saved to the browser. */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="notes-distractions-title">Eliminating Distractions</EL></div>
          <div className={styles.notesBody}>
            <NotesBox value={state.notesDistractions} onCommit={(v) => setField('notesDistractions', v)} minRows={6} />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="notes-prospecting-title">Prospecting Approach</EL></div>
          <div className={`${styles.notesBody} ${styles.notesTwoCol}`}>
            <NotesBox value={state.notesProspectingLeft} onCommit={(v) => setField('notesProspectingLeft', v)} minRows={5} />
            <NotesBox value={state.notesProspectingRight} onCommit={(v) => setField('notesProspectingRight', v)} minRows={5} />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}><EL id="notes-efficient-title">Efficient Time Utilization</EL></div>
          <div className={styles.notesBody}>
            <NotesBox value={state.notesEfficientTime} onCommit={(v) => setField('notesEfficientTime', v)} minRows={6} />
          </div>
        </div>
      </div>
    </div>
    </LabelCtx.Provider>
    </CalcContext.Provider>
  );
}

// Auto-growing editable text area for the strategy-notes sections at the
// bottom of the page. Keeps a local draft while typing and commits to the
// persisted state on blur (matching the numeric cells) so IndexedDB isn't
// written on every keystroke.
function NotesBox({ value, onCommit, minRows = 5 }) {
  const [draft, setDraft] = useState(value ?? '');
  const ref = useRef(null);
  // Reflect external changes (hydration / reset) into the draft.
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  return (
    <textarea
      ref={ref}
      className={styles.notesArea}
      rows={minRows}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      spellCheck={false}
    />
  );
}

function EditableList({ rows, setRows, cols, newRow }) {
  function update(id, patch) {
    setRows(rows.map(r => r.id === id ? { ...r, ...patch } : r));
  }
  function remove(id) {
    setRows(rows.filter(r => r.id !== id));
  }
  function add() {
    setRows([...rows, newRow()]);
  }
  return (
    <div>
      <table className={styles.tinyTable}>
        <thead>
          <tr>
            {cols.map(c => <th key={c.key}>{c.label}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              {cols.map(c => (
                <td key={c.key}>
                  {c.kind === 'text'
                    ? <TextCell value={r[c.key]} onCommit={(v) => update(r.id, { [c.key]: v })} />
                    : <NumCell value={r[c.key]} kind={c.kind} onCommit={(v) => update(r.id, { [c.key]: v })} />}
                </td>
              ))}
              <td>
                <button type="button" className={styles.delBtn} onClick={() => remove(r.id)} title="Remove row">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '0.4rem 0.5rem' }}>
        <button type="button" className={styles.actionBtn} onClick={add}>+ Add row</button>
      </div>
    </div>
  );
}
