// Pipeline dashboard — recreation of the Excel pipeline-metrics
// summary. Every numeric cell is editable; goals and actuals are
// stored together in a single IndexedDB record keyed `current` so
// the layout persists across reloads.

import { Component, useEffect, useMemo, useState } from 'react';
import styles from './PipelineView.module.css';
import { dbGet, dbPut, dbDelete } from '../../utils/db';

const STORE = 'pipeline-dashboard';
const KEY = 'current';
const BFO_STORE = 'bfo-activity';
const BFO_KEY = 'current';
const OPPS_STORE = 'opps-cache';
const OPPS_KEY = 'data';

// Parse "USD 15,000.00" / "$15,000" / "15000" -> 15000.
function parseMoney(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Pull the leading stage digit from values like "6 - Negotiate to..."
function stageNumber(v) {
  const m = String(v ?? '').match(/(\d)/);
  return m ? Number(m[1]) : null;
}

// Match BFO rows to the same Sales Stage labels the Excel formulas
// hard-code, so the website's totals line up with the spreadsheet.
//
//   Stage 6 active count   = COUNTIFS(K, "6 - Negotiate to Win")
//   Stage 5 active count   = COUNTIFS(K, "5 - Prepare & Bid")
//   Stage 4 active count   = COUNTIFS(K, "4 - Influence and Develop")
//   Stage 3 active count   = COUNTIFS(K, "3 - Qualify Opportunity")
//   Stage 6 deal size      = AVERAGEIFS(U, U "<>80000", K "6 - Negotiate to Win")
//   Other stages deal size = AVERAGEIFS(U, K "<stage label>")
//   Total deal size        = AVERAGE(U)         (every numeric amount)
//   Stage pipeline (sum)   = SUMIFS(U, K "<stage label>")
const STAGE_LABEL = {
  6: /^\s*6\s*-\s*negotiate\s*to\s*win\b/i,
  5: /^\s*5\s*-\s*prepare\s*&?\s*bid\b/i,
  4: /^\s*4\s*-\s*influence\s*and\s*develop\b/i,
  3: /^\s*3\s*-\s*qualify\s*opportunity\b/i,
};
// Amount values that should be ignored when averaging Stage 6 deal
// size (template default placeholder).
const STAGE_6_DEAL_SIZE_EXCLUDE = 80000;

function matchStage(stageVal) {
  const s = String(stageVal ?? '');
  for (const n of [3, 4, 5, 6]) {
    if (STAGE_LABEL[n].test(s)) return n;
  }
  // Fallback: leading digit match if the label drifts (e.g. truncated).
  const m = s.match(/^\s*([3-6])\b/);
  return m ? Number(m[1]) : null;
}

// Aggregate BFO rows -> { 3: …, 4: …, 5: …, 6: …, all: { allAmtAvg } }.
function bfoStageMetrics(bfo) {
  const out = { 3: null, 4: null, 5: null, 6: null, all: { allAmtAvg: null } };
  if (!bfo || !bfo.headers || !bfo.rows || bfo.rows.length === 0) return out;
  const findCol = (re) => bfo.headers.find(h => re.test(h));
  const stageCol = findCol(/sales\s*stage|^stage$/i);
  const amountCol = findCol(/^amount$/i);
  const ageCol = findCol(/^age$/i);
  if (!stageCol) return out;
  const buckets = {};
  let allAmtSum = 0;
  let allAmtCount = 0;
  for (const r of bfo.rows) {
    const n = matchStage(r[stageCol]);
    if (!n || n < 3 || n > 6) continue;
    const amt = amountCol ? parseMoney(r[amountCol]) : null;
    const age = ageCol ? Number(String(r[ageCol]).replace(/[^0-9.\-]/g, '')) : null;
    if (!buckets[n]) buckets[n] = { count: 0, total: 0, ageSum: 0, ageCount: 0, amtSum: 0, amtCount: 0 };
    buckets[n].count += 1;
    if (amt !== null) {
      buckets[n].total += amt;
      // Stage 6 averaging excludes the $80k template placeholder.
      if (!(n === 6 && amt === STAGE_6_DEAL_SIZE_EXCLUDE)) {
        buckets[n].amtSum += amt;
        buckets[n].amtCount += 1;
      }
      // Total deal size (Excel row-8 formula) averages every amount,
      // including stage 6's placeholder.
      allAmtSum += amt;
      allAmtCount += 1;
    }
    if (Number.isFinite(age)) { buckets[n].ageSum += age; buckets[n].ageCount += 1; }
  }
  for (const n of [3, 4, 5, 6]) {
    const b = buckets[n];
    if (!b) { out[n] = null; continue; }
    out[n] = {
      count: b.count,
      total: b.total,
      avg: b.amtCount ? b.amtSum / b.amtCount : null,
      avgAge: b.ageCount ? Math.round(b.ageSum / b.ageCount) : null,
    };
  }
  out.all = { allAmtAvg: allAmtCount ? allAmtSum / allAmtCount : null };
  return out;
}

const DEFAULT_STATE = {
  // Pipeline metrics by stage. Each stage row is a dict of values.
  stages: [
    { key: 's6', label: 'Stage 6',                       activeGoal: 3,  activeActual: 4,  dealSizeGoal: 125000, dealSizeActual: 58952,  pipelineGoal: 375000,  pipelineActual: 235806,  closeGoal: 0.75, closeActual: 0.50, targetProj: 281250, lifeGoal: 200, lifeActual: 212 },
    { key: 's5', label: 'Stage 5 (3 opp contracting)',   activeGoal: 12, activeActual: 6,  dealSizeGoal: 125000, dealSizeActual: 52146,  pipelineGoal: 1500000, pipelineActual: 578831,  closeGoal: 0.40, closeActual: 0.11, targetProj: 600000, lifeGoal: 150, lifeActual: 68 },
    { key: 's4', label: 'Stage 4 (4 opps quoting)',      activeGoal: 15, activeActual: 13, dealSizeGoal: 150000, dealSizeActual: 154923, pipelineGoal: 2250000, pipelineActual: 1135000, closeGoal: 0.25, closeActual: 0.04, targetProj: 562500, lifeGoal: 90,  lifeActual: 174 },
    { key: 's3', label: 'Stage 3',                       activeGoal: 3,  activeActual: 7,  dealSizeGoal: 150000, dealSizeActual: 153457, pipelineGoal: 450000,  pipelineActual: 1687244, closeGoal: 0.10, closeActual: 0.04, targetProj: 45000,  lifeGoal: 60,  lifeActual: 273 },
  ],

  currentClientCount: 5,
  currentClientAmt: 320500,
  greenfieldCount: 24,
  greenfieldAmt: 3316381,
  clientGoalPct: 0.45,
  clientActualPct: 0.17,

  coverageGoal: 3.21,
  coverageActual: 2.74,

  notQuotedGoal: 0.40,
  notQuotedYear: 0.43,
  notQuotedMonth: 0.40,

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
    if (typeof saved.label === 'string') row.label = saved.label;
    for (const f of STAGE_NUMERIC_FIELDS) {
      const v = saved[f];
      if (v === null) row[f] = null; // user blanked the cell
      else if (typeof v === 'number' && Number.isFinite(v)) row[f] = v;
      // anything else (undefined, object, array, NaN, string) → keep default
    }
    return row;
  });
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
            reloads — your BFO Activity, Opps, and column prefs are not affected.
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

// Cells use `key` to force remount when the upstream value changes
// (driven by parents passing the value into key) so internal draft
// state never has to sync to props.
function NumCell({ value, kind = 'num', onCommit }) {
  const initial = formatNumDisplay(value, kind);
  const [draft, setDraft] = useState(initial);
  function commit() {
    const raw = String(draft).replace(/[$,\s%]/g, '').trim();
    if (raw === '') { onCommit(null); return; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { setDraft(initial); return; }
    if (kind === 'pct') onCommit(n > 1 ? n / 100 : n);
    else onCommit(n);
  }
  return (
    <input
      className={styles.cell}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(initial); e.currentTarget.blur(); }
      }}
    />
  );
}

function TextCell({ value, onCommit }) {
  const [draft, setDraft] = useState(value ?? '');
  return (
    <input
      className={styles.cellLeft}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(value ?? ''); e.currentTarget.blur(); }
      }}
    />
  );
}

// Color a cell green/red depending on whether the actual hits the goal.
// dir = 'higher-better' or 'lower-better'.
function compareClass(actual, goal, dir = 'higher-better') {
  if (actual === null || actual === undefined || goal === null || goal === undefined || goal === 0) return '';
  if (dir === 'higher-better') return actual >= goal ? styles.cellGreen : styles.cellRed;
  return actual <= goal ? styles.cellGreen : styles.cellRed;
}

export function PipelineView() {
  return (
    <PipelineRootBoundary>
      <PipelineViewInner />
    </PipelineRootBoundary>
  );
}

function PipelineViewInner() {
  const [state, setState] = useState(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [bfo, setBfo] = useState(null);
  const [opps, setOpps] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await dbGet(STORE, KEY);
        if (cancelled) return;
        if (saved) setState(() => ({
          ...DEFAULT_STATE,
          ...saved,
          stages: sanitizeStages(saved.stages),
        }));
        const bfoSaved = await dbGet(BFO_STORE, BFO_KEY);
        if (!cancelled && bfoSaved) setBfo(bfoSaved);
        const oppsSaved = await dbGet(OPPS_STORE, OPPS_KEY);
        if (!cancelled && oppsSaved) setOpps(oppsSaved);
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
      dbGet(OPPS_STORE, OPPS_KEY).then(o => setOpps(o || null)).catch(() => setOpps(null));
    }
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

  const bfoMetrics = useMemo(() => bfoStageMetrics(bfo), [bfo]);
  const hasBfo = bfo && bfo.rows && bfo.rows.length > 0;

  // Lists derived from the Opps tab.
  const oppsRecords = opps && Array.isArray(opps.records) ? opps.records : [];
  const notSoldFromOpps = useMemo(() => {
    return oppsRecords
      .filter(r => (r.Stage || '').trim() === 'Not Sold')
      .map(r => ({
        account: r.Account || '',
        scope: r.Scope || '',
        age: Number(r.Age) || null,
        finalMargin: r['Final Margin'] || r['Margin'] || '',
        quoted: parseMoney(r['Quoted Amount']),
      }))
      .filter(r => typeof r.quoted === 'number' && r.quoted > 0)
      .sort((a, b) => (a.age ?? 0) - (b.age ?? 0));
  }, [oppsRecords]);

  // Sum of Quoted Amount for Opps tab records with Stage === 'Sold' and
  // a Close Date in the current calendar year. Drives the Closed YTD
  // cell on the Pipeline header. Returns null when the Opps cache has
  // no records — Closed YTD then falls back to the editable input.
  const oppsClosedYTD = useMemo(() => {
    if (oppsRecords.length === 0) return null;
    const thisYear = new Date().getFullYear();
    let total = 0;
    for (const r of oppsRecords) {
      if ((r.Stage || '').trim() !== 'Sold') continue;
      const cd = r['Close Date'];
      if (!cd) continue;
      const ts = Date.parse(cd);
      if (Number.isNaN(ts)) continue;
      if (new Date(ts).getFullYear() !== thisYear) continue;
      const amt = parseMoney(r['Quoted Amount']);
      if (typeof amt === 'number' && Number.isFinite(amt)) total += amt;
    }
    return Math.round(total);
  }, [oppsRecords]);

  const notQuotedFromOpps = useMemo(() => {
    const NOT_QUOTED_STAGES = new Set(['Lead', 'Not Started', 'Qualifying']);
    return oppsRecords
      .filter(r => NOT_QUOTED_STAGES.has((r.Stage || '').trim()))
      .map(r => ({
        account: r.Account || '',
        scope: r.Scope || '',
        closeDate: r['Close Date'] || '',
        age: Number(r.Age) || null,
      }))
      .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
  }, [oppsRecords]);

  // Smallest stage-5 and stage-6 deals from BFO, sorted by amount asc.
  const bfoSmallestDeals = useMemo(() => {
    if (!hasBfo) return null;
    const findCol = (re) => bfo.headers.find(h => re.test(h));
    const stageCol = findCol(/sales\s*stage|^stage$/i);
    const amountCol = findCol(/^amount$/i);
    const accountCol = findCol(/^account\s*name$/i) || findCol(/^account$/i);
    const oppCol = findCol(/opportunity\s*name|^opportunity$/i);
    if (!stageCol || !amountCol) return null;
    return bfo.rows
      .map(r => ({
        account: accountCol ? r[accountCol] : '',
        oppName: oppCol ? r[oppCol] : '',
        amount: parseMoney(r[amountCol]),
        stage: stageNumber(r[stageCol]),
      }))
      .filter(r => (r.stage === 5 || r.stage === 6) && typeof r.amount === 'number')
      .sort((a, b) => a.amount - b.amount);
  }, [bfo, hasBfo]);

  useEffect(() => {
    if (!hydrated) return;
    dbPut(STORE, state, KEY).catch(err => console.warn('Pipeline save failed', err));
  }, [state, hydrated]);

  function setStage(idx, patch) {
    setState(s => ({ ...s, stages: s.stages.map((row, i) => i === idx ? { ...row, ...patch } : row) }));
  }
  function setField(key, value) {
    setState(s => ({ ...s, [key]: value }));
  }

  // Always have a usable stages array to render — sanitizeStages merges
  // each row with its DEFAULT_STATE counterpart and replaces any wrong-
  // typed field, so render-time `<NumCell value={…} />` and `{st.label}`
  // can never receive an object/array that would crash the table.
  const renderStages = useMemo(() => sanitizeStages(state.stages), [state.stages]);
  // Self-heal: if the sanitized rows differ from what's in state, write
  // them back so the persisted record is no longer malformed.
  useEffect(() => {
    if (!hydrated) return;
    if (state.stages !== renderStages
        && JSON.stringify(state.stages) !== JSON.stringify(renderStages)) {
      setState(s => ({ ...s, stages: renderStages }));
    }
  }, [hydrated, state.stages, renderStages]);

  // Per-row Opps Needed columns + their totals, computed outside the
  // JSX so any future error here surfaces in dev tools instead of
  // silently dropping the metrics table.
  const stageOppsNeeded = renderStages.map(st => {
    const ds = Number(st.dealSizeActual) || 0;
    const pg = Number(st.pipelineGoal) || 0;
    const cr = Number(st.closeActual) || 0;
    return {
      key: st.key,
      forDeal: ds > 0 ? Math.round(pg / ds) : null,
      forClose: ds > 0 && cr > 0 ? Math.round(pg / (ds * cr)) : null,
    };
  });
  const totalOppsForDeal = stageOppsNeeded.reduce((s, r) => s + (r.forDeal || 0), 0);
  const totalOppsForClose = stageOppsNeeded.reduce((s, r) => s + (r.forClose || 0), 0);

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
  const effectiveClosedYTD = oppsClosedYTD !== null ? oppsClosedYTD : (Number(state.closedYTD) || 0);
  const closedPctOfQuota = state.target ? effectiveClosedYTD / state.target : 0;
  // Weighted-by-count averages — SUMPRODUCT(life, count) / SUM(count).
  // Goal weights are activeGoal; Actual weights are the live count
  // (BFO when loaded, manual activeActual otherwise).
  const lifeGoalAvg = stageTotals.lifeGoalWeight > 0
    ? Math.round(stageTotals.lifeGoalProduct / stageTotals.lifeGoalWeight) : null;
  const lifeActualAvg = stageTotals.lifeActualWeight > 0
    ? Math.round(stageTotals.lifeActualProduct / stageTotals.lifeActualWeight) : null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Pipeline</h1>
        <div className={styles.subtitle}>Pipeline metrics dashboard. Every cell is editable; values save to your browser.</div>
      </div>
      <div className={styles.body}>
        {/* Pipeline metrics */}
        <div className={styles.section}>
          <div className={styles.sectionTitle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>PIPELINE METRICS</span>
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
          <table className={styles.grid} style={{ minWidth: 1400 }}>
            <thead>
              <tr>
                <th rowSpan={2} className={styles.headerLeft}>Stage</th>
                <th colSpan={2}>Active Opportunities</th>
                <th colSpan={2}>Deal Size</th>
                <th colSpan={2}>Pipeline</th>
                <th colSpan={2}>Close Rate</th>
                <th>Target Projection</th>
                <th colSpan={2}>Avg Opp Life</th>
                <th rowSpan={2}>Opps Needed w Deal Sizes</th>
                <th rowSpan={2}>Opps Needed w Close Rates</th>
              </tr>
              <tr>
                <th>Goal (above)</th><th>Actual</th>
                <th>Goal (above)</th><th>Actual</th>
                <th>Goal (above)</th><th>Actual</th>
                <th>Goal (above)</th><th>Actual</th>
                <th>Goal</th>
                <th>Goal (less than)</th><th>Actual</th>
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
                return (
                  <tr key={st.key}>
                    <td className={styles.label}>{st.label}</td>
                    <td><NumCell value={st.activeGoal} onCommit={(v) => setStage(i, { activeGoal: v })} /></td>
                    <td className={compareClass(activeActual, st.activeGoal, 'higher-better')}>
                      {fromBfo(m?.count)
                        ? <span title={liveTip} className={styles.liveCell}>{activeActual}</span>
                        : <NumCell value={st.activeActual} onCommit={(v) => setStage(i, { activeActual: v })} />}
                    </td>
                    <td><NumCell value={st.dealSizeGoal} kind="money" onCommit={(v) => setStage(i, { dealSizeGoal: v })} /></td>
                    <td className={compareClass(dealSizeActual, st.dealSizeGoal, 'higher-better')}>
                      {fromBfo(m?.avg)
                        ? <span title={liveTip} className={styles.liveCell}>{fmtMoney(Math.round(dealSizeActual))}</span>
                        : <NumCell value={st.dealSizeActual} kind="money" onCommit={(v) => setStage(i, { dealSizeActual: v })} />}
                    </td>
                    <td><NumCell value={st.pipelineGoal} kind="money" onCommit={(v) => setStage(i, { pipelineGoal: v })} /></td>
                    <td className={compareClass(pipelineActual, st.pipelineGoal, 'higher-better')}>
                      {fromBfo(m?.total)
                        ? <span title={liveTip} className={styles.liveCell}>{fmtMoney(Math.round(pipelineActual))}</span>
                        : <NumCell value={st.pipelineActual} kind="money" onCommit={(v) => setStage(i, { pipelineActual: v })} />}
                    </td>
                    <td><NumCell value={st.closeGoal} kind="pct" onCommit={(v) => setStage(i, { closeGoal: v })} /></td>
                    <td className={compareClass(st.closeActual, st.closeGoal, 'higher-better')}>
                      <NumCell value={st.closeActual} kind="pct" onCommit={(v) => setStage(i, { closeActual: v })} />
                    </td>
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
                        ? <span title={liveTip} className={styles.liveCell}>{lifeActual}</span>
                        : <NumCell value={st.lifeActual} onCommit={(v) => setStage(i, { lifeActual: v })} />}
                    </td>
                    <td className={styles.numCell} title="Pipeline Goal ÷ Deal Size Actual">
                      {stageOppsNeeded[i]?.forDeal ?? ''}
                    </td>
                    <td className={styles.numCell} title="Pipeline Goal ÷ (Deal Size Actual × Close Rate Actual)">
                      {stageOppsNeeded[i]?.forClose ?? ''}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className={styles.label}>Total</td>
                <td className={styles.numCell}>{stageTotals.activeGoal}</td>
                <td className={styles.numCell}>{stageTotals.activeActual}</td>
                <td className={styles.numCell}>{fmtMoney(dealSizeAvgGoal)}</td>
                <td className={styles.numCell}>{fmtMoney(dealSizeAvgActual)}</td>
                <td className={styles.numCell}>{fmtMoney(stageTotals.pipelineGoal)}</td>
                <td className={styles.numCell}>{fmtMoney(stageTotals.pipelineActual)}</td>
                <td colSpan={2} />
                <td className={styles.numCell} title="Sum of stage Target Projection Goals (Active Goal × Deal Size Goal × Close Rate Goal).">{fmtMoney(Math.round(stageTotals.targetProjGoal))}</td>
                <td className={styles.numCell} title="Stage goals weighted by Active Opp Goal — SUMPRODUCT(lifeGoal, activeGoal) ÷ SUM(activeGoal). Less is better.">{lifeGoalAvg ?? ''}</td>
                <td className={`${styles.numCell} ${compareClass(lifeActualAvg, lifeGoalAvg, 'lower-better')}`.trim()} title="Stage actuals weighted by Active Opp Actual (live BFO count when loaded). SUMPRODUCT(lifeActual, activeActual) ÷ SUM(activeActual).">{lifeActualAvg ?? ''}</td>
                <td className={styles.numCell}>{totalOppsForDeal}</td>
                <td className={styles.numCell}>{totalOppsForClose}</td>
              </tr>
            </tbody>
          </table>
          </div>
          </MetricsTableBoundary>
        </div>

        {/* Mid row — Client/Greenfield + Coverage + % not Quoted + Quota */}
        <div className={styles.midRow}>
          <div className={styles.section}>
            <table className={styles.grid}>
              <thead>
                <tr><th /><th>Count / $</th><th>Goal - Client</th><th>Actual - Client</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td className={styles.label}>Current client opps</td>
                  <td><NumCell value={state.currentClientCount} onCommit={(v) => setField('currentClientCount', v)} /></td>
                  <td rowSpan={2}><NumCell value={state.clientGoalPct} kind="pct" onCommit={(v) => setField('clientGoalPct', v)} /></td>
                  <td rowSpan={2} className={compareClass(state.clientActualPct, state.clientGoalPct, 'higher-better')}>
                    <NumCell value={state.clientActualPct} kind="pct" onCommit={(v) => setField('clientActualPct', v)} />
                  </td>
                </tr>
                <tr>
                  <td className={styles.label}>Greenfield opps</td>
                  <td><NumCell value={state.greenfieldCount} onCommit={(v) => setField('greenfieldCount', v)} /></td>
                </tr>
                <tr>
                  <td className={styles.label}>Current client $</td>
                  <td><NumCell value={state.currentClientAmt} kind="money" onCommit={(v) => setField('currentClientAmt', v)} /></td>
                  <td colSpan={2} />
                </tr>
                <tr>
                  <td className={styles.label}>Greenfield $</td>
                  <td><NumCell value={state.greenfieldAmt} kind="money" onCommit={(v) => setField('greenfieldAmt', v)} /></td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.section}>
            <table className={styles.grid}>
              <thead>
                <tr><th colSpan={2}>Coverage Ratio</th><th colSpan={3}>% of deals not Quoted</th></tr>
                <tr><th>Goal</th><th>Actual</th><th>Goal</th><th>Actual Year</th><th>Actual Month</th></tr>
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
                          <span
                            className={styles.liveCell}
                            title={`Actual Pipeline (${fmtMoney(stageTotals.pipelineActual)}) ÷ Target (${fmtMoney(state.target)})`}
                          >{computedCoverage.toFixed(2)}</span>
                        ) : (
                          <span className={styles.noBfoCell}>—</span>
                        )}
                      </td>
                    );
                  })()}
                  <td><NumCell value={state.notQuotedGoal} kind="pct" onCommit={(v) => setField('notQuotedGoal', v)} /></td>
                  <td className={compareClass(state.notQuotedYear, state.notQuotedGoal, 'lower-better')}>
                    <NumCell value={state.notQuotedYear} kind="pct" onCommit={(v) => setField('notQuotedYear', v)} />
                  </td>
                  <td className={compareClass(state.notQuotedMonth, state.notQuotedGoal, 'lower-better')}>
                    <NumCell value={state.notQuotedMonth} kind="pct" onCommit={(v) => setField('notQuotedMonth', v)} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.section}>
            <table className={styles.grid}>
              <thead><tr><th>Target</th><th>Closed YTD</th><th>% of Quota</th></tr></thead>
              <tbody>
                <tr>
                  <td><NumCell value={state.target} kind="money" onCommit={(v) => setField('target', v)} /></td>
                  <td>
                    {oppsClosedYTD !== null
                      ? <span title="Auto-fed from Opps tab — sum of Quoted Amount for Stage = 'Sold' opps with a Close Date in the current calendar year." className={styles.liveCell}>{fmtMoney(oppsClosedYTD)}</span>
                      : <NumCell value={state.closedYTD} kind="money" onCommit={(v) => setField('closedYTD', v)} />}
                  </td>
                  <td className={styles.numCell}>{(closedPctOfQuota * 100).toFixed(2)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Goals / Activities */}
        <div className={styles.section} style={{ maxWidth: 480 }}>
          <table className={styles.grid}>
            <thead><tr><th>Goals</th><th>Opportunities</th></tr></thead>
            <tbody>
              <tr>
                <td className={styles.label}>{state.newOppsGoal} New Opps This Month</td>
                <td className={compareClass(state.newOppsThisMonth, state.newOppsGoal, 'higher-better')}>
                  <NumCell value={state.newOppsThisMonth} onCommit={(v) => setField('newOppsThisMonth', v)} />
                </td>
              </tr>
              <tr>
                <td className={styles.label}>{state.newOppsGoal} New Opps Last Month</td>
                <td className={compareClass(state.newOppsLastMonth, state.newOppsGoal, 'higher-better')}>
                  <NumCell value={state.newOppsLastMonth} onCommit={(v) => setField('newOppsLastMonth', v)} />
                </td>
              </tr>
              <tr>
                <td className={styles.label}>{state.activitiesGoal} activities this week (projected {state.activitiesProjected})</td>
                <td className={compareClass(state.activitiesThisWeek, state.activitiesGoal, 'higher-better')}>
                  <NumCell value={state.activitiesThisWeek} onCommit={(v) => setField('activitiesThisWeek', v)} />
                </td>
              </tr>
              <tr>
                <td className={styles.label}>{state.activitiesGoal} activities last week</td>
                <td className={compareClass(state.activitiesLastWeek, state.activitiesGoal, 'higher-better')}>
                  <NumCell value={state.activitiesLastWeek} onCommit={(v) => setField('activitiesLastWeek', v)} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Bottom three tables */}
        <div className={styles.bottomRow}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Smallest 5 &amp; 6 Deals</div>
            <table className={styles.tinyTable} title="Auto-fed from BFO Activity. Paste BFO rows on the BFO Activity tab to populate.">
              <thead>
                <tr>
                  <th>Account Name</th>
                  <th>Opportunity Name</th>
                  <th>Amount USD</th>
                </tr>
              </thead>
              <tbody>
                {(bfoSmallestDeals && bfoSmallestDeals.length > 0) ? (
                  bfoSmallestDeals.map((r, i) => (
                    <tr key={i}>
                      <td>{r.account}</td>
                      <td>{r.oppName}</td>
                      <td>{fmtMoney(r.amount)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} style={{ color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', padding: '0.6rem' }}>
                      No BFO data — paste an export on the BFO Activity tab.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Not Sold Quoted Deals</div>
            <table className={styles.tinyTable} title="Auto-fed from Opps tab — opportunities with Stage = 'Not Sold' and a Quoted Amount.">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Scope</th>
                  <th>Age</th>
                  <th>Final Margin</th>
                  <th>Quoted Amount</th>
                </tr>
              </thead>
              <tbody>
                {notSoldFromOpps.length > 0 ? (
                  notSoldFromOpps.map((r, i) => (
                    <tr key={i}>
                      <td>{r.account}</td>
                      <td>{r.scope}</td>
                      <td>{r.age ?? ''}</td>
                      <td>{r.finalMargin}</td>
                      <td>{fmtMoney(r.quoted)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', padding: '0.6rem' }}>
                      No "Not Sold" quoted opps found in the Opps tab.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Not Quoted Opps</div>
            <table className={styles.tinyTable} title="Auto-fed from Opps tab — active opportunities (Lead / Not Started / Qualifying) that haven't been quoted yet.">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Scope</th>
                  <th>Close Date</th>
                  <th>Age</th>
                </tr>
              </thead>
              <tbody>
                {notQuotedFromOpps.length > 0 ? (
                  notQuotedFromOpps.map((r, i) => (
                    <tr key={i}>
                      <td>{r.account}</td>
                      <td>{r.scope}</td>
                      <td>{r.closeDate}</td>
                      <td>{r.age ?? ''}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', padding: '0.6rem' }}>
                      No un-quoted active opps found in the Opps tab.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
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
