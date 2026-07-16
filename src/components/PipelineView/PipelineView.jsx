// Pipeline dashboard — recreation of the Excel pipeline-metrics
// summary. Every numeric cell is editable; goals and actuals are
// stored together in a single IndexedDB record keyed `current` so
// the layout persists across reloads.

import { Component, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './PipelineView.module.css';
import { dbGet, dbPut, dbDelete } from '../../utils/db';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { loadDealsList } from '../../utils/dealsStore';
import { loadDealClientMap } from '../../utils/dealClientMap';
import { loadClientManagerMap, loadClientUntrackedMap, loadClientStatusMap } from '../../utils/clientManagerStore';
import { computeExpiringClients, normClientName } from '../../utils/clientIssues';
import { getHubspotContacts } from '../../utils/hubspotContactsCache';

// Contracts expiring within this many days feed the Pipeline "Client
// Renewals" table — mirrors the Clients tab's renewal-warning threshold.
const RENEWAL_WINDOW_DAYS = 270;

const STORE = 'pipeline-dashboard';
const KEY = 'current';
const BFO_STORE = 'bfo-activity';
const BFO_KEY = 'current';

// The Opps tab's BFO Opportunity Name lives in the column whose data key is
// still "BFO Link" (the visible label was renamed). New opps are seeded with a
// dash placeholder and sheet imports leave #N/A — neither is a real name, so
// treat them as empty. Mirrors bfoOppName in BFOActivityView.
const BFO_BLANK_SENTINELS = new Set(['', '-', '#n/a', 'n/a']);
function bfoOppNameOf(r) {
  const v = String(r?.['BFO Link'] || '').trim();
  return BFO_BLANK_SENTINELS.has(v.toLowerCase()) ? '' : v;
}

// Parse "USD 15,000.00" / "$15,000" / "15000" -> 15000.
function parseMoney(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Pull the leading stage digit from values like "6 - Negotiate to..."
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
  const accountCol = findCol(/^account\s*name$/i) || findCol(/^account$/i);
  const oppCol = findCol(/opportunity\s*name|^opportunity$/i);
  const scopeCol = findCol(/^scope$/i);
  if (!stageCol) return out;
  const buckets = {};
  let allAmtSum = 0;
  let allAmtCount = 0;
  for (const r of bfo.rows) {
    const n = matchStage(r[stageCol]);
    if (!n || n < 3 || n > 6) continue;
    const amt = amountCol ? parseMoney(r[amountCol]) : null;
    const age = ageCol ? Number(String(r[ageCol]).replace(/[^0-9.\-]/g, '')) : null;
    if (!buckets[n]) buckets[n] = { count: 0, total: 0, ageSum: 0, ageCount: 0, amtSum: 0, amtCount: 0, rows: [] };
    buckets[n].count += 1;
    // Keep the contributing row so hover breakdowns can list exactly
    // which BFO opps fed each live cell.
    buckets[n].rows.push({
      account: accountCol ? String(r[accountCol] ?? '').trim() : '',
      oppName: oppCol ? String(r[oppCol] ?? '').trim() : '',
      scope: scopeCol ? String(r[scopeCol] ?? '').trim() : '',
      amount: amt,
      age: Number.isFinite(age) ? age : null,
      excludedFromAvg: n === 6 && amt === STAGE_6_DEAL_SIZE_EXCLUDE,
    });
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
      amtCount: b.amtCount,
      ageCount: b.ageCount,
      rows: b.rows,
    };
  }
  out.all = { allAmtAvg: allAmtCount ? allAmtSum / allAmtCount : null };
  return out;
}

const DEFAULT_STATE = {
  // Pipeline metrics by stage. Each stage row is a dict of values.
  stages: [
    { key: 's6', label: 'Stage 6',                       activeGoal: 3,  activeActual: 4,  dealSizeGoal: 125000, dealSizeActual: 58952,  pipelineGoal: 375000,  pipelineActual: 235806,  closeGoal: 0.75, closeActual: 0.50, targetProj: 281250, lifeGoal: 200, lifeActual: 212 },
    { key: 's5', label: 'Stage 5',                       activeGoal: 12, activeActual: 6,  dealSizeGoal: 125000, dealSizeActual: 52146,  pipelineGoal: 1500000, pipelineActual: 578831,  closeGoal: 0.40, closeActual: 0.11, targetProj: 600000, lifeGoal: 150, lifeActual: 68 },
    { key: 's4', label: 'Stage 4',                       activeGoal: 15, activeActual: 13, dealSizeGoal: 150000, dealSizeActual: 154923, pipelineGoal: 2250000, pipelineActual: 1135000, closeGoal: 0.25, closeActual: 0.04, targetProj: 562500, lifeGoal: 90,  lifeActual: 174 },
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
  notesUpdates: `1.  Screen opps with Keith each week for Stage 3 - avoiding smaller opps coming into the pipeline before Dan works on them
2.  Take PE prospects out for lunch in NYC 1 on 1
3.  Leverage Keith and Gabe on sourcing calls vs. Beth
4.  Figure out how to accelerate sourcing pilots w/PCs faster and at a larger deal size
5.
6.`,
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
  const { max = 50, exportMapFn = null, exportColumns = null } = opts;
  const arr = source || [];
  const all = arr.map(mapFn);
  const out = { data: all.slice(0, max), more: Math.max(0, all.length - max), allData: all };
  // The Excel export can carry extra columns (e.g. Scope) the compact
  // on-screen panel omits — supplied here so the two stay decoupled.
  if (exportMapFn) out.exportData = arr.map(exportMapFn);
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
      o.amount > 0 ? fmtMoney(Math.round(o.amount)) : '—',
    ], {
      exportColumns: ['Result', 'Account', 'BFO Opportunity Name', 'Scope', 'Close', 'Amount'],
      exportMapFn: o => [
        o.stage,
        o.account || '(no account)',
        o.bfoName || '',
        o.scope || '',
        fmtShortDate(o.closeDate),
        o.amount > 0 ? fmtMoney(Math.round(o.amount)) : '—',
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
  XLSX.writeFile(wb, `pipeline-${slug}-${stamp}.xlsx`);
  } catch (err) {
    console.error('Pipeline breakdown export failed', err);
    if (typeof window !== 'undefined') window.alert('Sorry — the Excel export failed to generate.');
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
            <span className={styles.calcBadge} title="Recomputed live — not a stored value. Click to pin.">∑ live</span>
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
          stages: sanitizeStages(saved.stages),
        }));
        const bfoSaved = await dbGet(BFO_STORE, BFO_KEY);
        if (!cancelled && bfoSaved) setBfo(bfoSaved);
        const oppsSaved = await loadOppsFromCache();
        if (!cancelled && oppsSaved) setOpps(oppsSaved);
        const contacts = await getHubspotContacts();
        if (!cancelled && contacts) setHubspotContacts(contacts);
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

  // Decision-maker contacts grouped by normalized company name, so each
  // renewals row can show every DM at that account and whether they've been
  // invited to Louisville. Mirrors the HubSpot-contact source + "Decision
  // Maker" tag test the Progress and contact views use. The Louisville flag
  // is a local-only setting keyed by the contact's HubSpot id.
  const dmsByCompany = useMemo(() => {
    const invitedMap = settings.contactInvitedToLouisville || {};
    const map = new Map();
    for (const c of hubspotContacts) {
      const tags = String(c.dans_tags || c.dan_s_tags || c.dans_tag || '')
        .split(';').map(t => t.trim().toLowerCase());
      if (!tags.includes('decision maker')) continue;
      const key = normClientName(c.company);
      if (!key) continue;
      const cid = c.id || c.vid;
      const name = [c.firstname, c.lastname].filter(Boolean).join(' ').trim()
        || c.name || c.email || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ contact: c, name, invited: cid != null ? !!invitedMap[cid] : false });
    }
    return map;
  }, [hubspotContacts, settings.contactInvitedToLouisville]);

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
    const PULL_THROUGH = /pull[\s-]?through/i;
    let sold = 0;
    let notSold = 0;
    const included = [];
    for (const r of oppsRecords) {
      const stage = (r.Stage || '').trim();
      if (stage !== 'Sold' && stage !== 'Not Sold') continue;
      const cd = r['Close Date'];
      if (!cd) continue;
      const ts = Date.parse(cd);
      if (Number.isNaN(ts) || ts < cutoff) continue;
      if (PULL_THROUGH.test(String(r.Scope || ''))) continue;
      if (stage === 'Sold') sold += 1;
      else notSold += 1;
      included.push({
        account: String(r.Account || '').trim(),
        bfoName: bfoOppNameOf(r),
        scope: String(r.Scope || '').trim(),
        stage,
        closeDate: cd,
        ts,
        amount: parseMoney(r['Quoted Amount']) || 0,
      });
    }
    const total = sold + notSold;
    if (total === 0) return null;
    included.sort((a, b) => b.ts - a.ts);
    return { sold, notSold, rate: sold / total, included };
  }, [oppsRecords]);

  // Per-stage Close Rate Actual on a rolling 365-day window. Each
  // stage uses a different "did it actually reach this stage?" signal
  // on the Opps tab:
  //   Stage 3 (Qualify Opportunity)    — has a BFO opportunity value, i.e.
  //                                      a non-empty BFO Link (every opp
  //                                      that made it into BFO).
  //   Stage 5 (Prepare & Bid / Quoted) — non-empty Quoted On date.
  //   Stage 6 (Negotiate to Win)       — non-empty Entity Outside the US
  //                                      Approval value (blank or "-"
  //                                      means it never made it to 6).
  // Stage 4 returns null until we get a comparable signal column.
  const oppsCloseRateByStage = useMemo(() => {
    const out = { 3: null, 4: null, 5: null, 6: null };
    if (oppsRecords.length === 0) return out;
    const cutoff = Date.now() - 365 * 86400000;
    const PULL_THROUGH = /pull[\s-]?through/i;
    const hasBfoOpportunity = (r) => {
      const v = String(r['BFO Link'] ?? '').trim();
      if (!v) return false;
      if (v === '-' || v === '—' || v === 'N/A' || v === '#N/A') return false;
      return true;
    };
    const hasQuotedOn = (r) => {
      const v = r['Quoted On'] || r['Quoted Date'] || '';
      if (!v) return false;
      const ts = Date.parse(v);
      return !Number.isNaN(ts);
    };
    const hasEntityApproval = (r) => {
      const v = String(r['Entity Outside the US Approval'] || '').trim();
      if (!v) return false;
      if (v === '-' || v === '—' || v === 'N/A' || v === '#N/A') return false;
      return true;
    };
    const stagePredicates = {
      3: hasBfoOpportunity,
      5: hasQuotedOn,
      6: hasEntityApproval,
    };
    const tallies = {
      3: { sold: 0, notSold: 0, included: [] },
      5: { sold: 0, notSold: 0, included: [] },
      6: { sold: 0, notSold: 0, included: [] },
    };
    for (const r of oppsRecords) {
      const stage = (r.Stage || '').trim();
      if (stage !== 'Sold' && stage !== 'Not Sold') continue;
      const cd = r['Close Date'];
      if (!cd) continue;
      const ts = Date.parse(cd);
      if (Number.isNaN(ts) || ts < cutoff) continue;
      if (PULL_THROUGH.test(String(r.Scope || ''))) continue;
      const entry = {
        account: String(r.Account || '').trim(),
        bfoName: bfoOppNameOf(r),
        scope: String(r.Scope || '').trim(),
        stage,
        closeDate: cd,
        ts,
        amount: parseMoney(r['Quoted Amount']) || 0,
      };
      for (const stageNum of Object.keys(stagePredicates)) {
        if (!stagePredicates[stageNum](r)) continue;
        if (stage === 'Sold') tallies[stageNum].sold += 1;
        else tallies[stageNum].notSold += 1;
        tallies[stageNum].included.push(entry);
      }
    }
    for (const stageNum of [3, 5, 6]) {
      const { sold, notSold, included } = tallies[stageNum];
      const total = sold + notSold;
      if (total > 0) {
        included.sort((a, b) => b.ts - a.ts);
        out[stageNum] = { sold, notSold, rate: sold / total, included };
      }
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

  // Count of new opps opened in the past 30 days, derived from the
  // Opps tab. Skips rows without a BFO Link so we don't count drafts /
  // unlinked records. Open date = Close Date − Age for closed opps
  // (Sold / Not Sold), or today − Age for active opps.
  const newOppsPast30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    // Age fields go stale between paste-imports — an opp paste-imported
    // months ago with Age=7 would otherwise look 7 days old today. To
    // protect against that, we prefer:
    //   1. The opp's `Start Date` column when it parses as a real date.
    //   2. Otherwise: fetchedAt − Age days (so Age is interpreted at
    //      the time the data was pasted, not today).
    //   3. Last resort: today − Age days.
    const fetchedAt = opps && opps.fetchedAt ? Date.parse(opps.fetchedAt) : NaN;
    const ageRef = Number.isFinite(fetchedAt) ? fetchedAt : Date.now();
    const items = [];
    for (const r of oppsRecords) {
      const bfoLink = String(r['BFO Link'] ?? '').trim();
      if (!bfoLink || bfoLink === '-' || bfoLink === '#N/A') continue;
      const stage = (r.Stage || '').trim();
      let openTs = NaN;
      // 1. Prefer Start Date when it's a parseable real date.
      const startRaw = String(r['Start Date'] || '').trim();
      if (startRaw) {
        const ts = Date.parse(startRaw);
        if (!Number.isNaN(ts)) openTs = ts;
      }
      // 2. Fall back to Age-based.
      if (Number.isNaN(openTs)) {
        const age = Number(String(r.Age ?? '').replace(/[^0-9.\-]/g, ''));
        if (!Number.isFinite(age) || age < 0) continue;
        if (stage === 'Sold' || stage === 'Not Sold') {
          const closeTs = Date.parse(r['Close Date'] || '');
          if (Number.isNaN(closeTs)) continue;
          openTs = closeTs - age * 86400000;
        } else {
          openTs = ageRef - age * 86400000;
        }
      }
      if (Number.isNaN(openTs)) continue;
      if (openTs >= cutoff) {
        items.push({
          account: String(r.Account || '').trim() || '(no company)',
          opp: String(r['Opportunity Name'] || r.Opportunity || r.Name || '').trim() || '(unnamed opp)',
          bfoName: bfoOppNameOf(r),
          scope: String(r.Scope || '').trim(),
          stage,
          openDate: new Date(openTs).toISOString().slice(0, 10),
        });
      }
    }
    items.sort((a, b) => a.account.localeCompare(b.account) || a.opp.localeCompare(b.opp));
    return { count: items.length, items };
  }, [oppsRecords, opps]);
  const newOppsPast30Count = newOppsPast30.count;

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
  const effectiveClosedYTD = oppsClosedYTD !== null ? oppsClosedYTD.total : (Number(state.closedYTD) || 0);
  const closedPctOfQuota = state.target ? effectiveClosedYTD / state.target : 0;
  // Weighted-by-count averages — SUMPRODUCT(life, count) / SUM(count).
  // Goal weights are activeGoal; Actual weights are the live count
  // (BFO when loaded, manual activeActual otherwise).
  const lifeGoalAvg = stageTotals.lifeGoalWeight > 0
    ? Math.round(stageTotals.lifeGoalProduct / stageTotals.lifeGoalWeight) : null;
  const lifeActualAvg = stageTotals.lifeActualWeight > 0
    ? Math.round(stageTotals.lifeActualProduct / stageTotals.lifeActualWeight) : null;

  return (
    <CalcContext.Provider value={calcCtx}>
    <div
      className={styles.wrapper}
      onClick={() => { if (calcPinned) calcUnpin(); }}
    >
      {calcPopover}
      <div className={styles.header}>
        <h1 className={styles.title}>Pipeline</h1>
        <div className={styles.subtitle}>Pipeline metrics dashboard. Every cell is editable; values save to your browser. Hover a <span className={styles.liveCell} style={{ cursor: 'default' }}>live value</span> to see what feeds it; click to pin the panel, then <strong>⬇ Excel</strong> to export the full breakdown.</div>
      </div>
      <div className={styles.body}>
        {/* Quota header — sits directly above the Pipeline Metrics
            table so the YTD / % of Quota framing is visible before
            you read any of the per-stage rows. */}
        <div className={styles.section} style={{ maxWidth: 480 }}>
          <table className={styles.grid}>
            <thead><tr><th>Target</th><th>Closed YTD</th><th>% of Quota</th></tr></thead>
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
          <table className={styles.grid} style={{ width: 1295, tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 140 }} /> {/* Stage label */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Active Opps */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Deal Size */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Pipeline */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Close Rate */}
              <col style={{ width: 105 }} /> {/* Target Projection */}
              <col style={{ width: 105 }} /><col style={{ width: 105 }} /> {/* Avg Opp Life */}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className={styles.headerLeft}>Stage</th>
                <th colSpan={2}>Active Opportunities</th>
                <th colSpan={2}>Deal Size</th>
                <th colSpan={2}>Pipeline</th>
                <th colSpan={2}>Close Rate (Rolling 365 days)</th>
                <th>Target Projection</th>
                <th colSpan={2}>Avg Opp Life</th>
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
                // Build the row list (account / opportunity / amount-or-age)
                // that feeds the hover breakdown for the BFO-driven cells.
                const mkBfoRows = (head, includeAge) => ({
                  head,
                  columns: ['Account', 'Opportunity', includeAge ? 'Age' : 'Amount'],
                  aligns: ['', '', 'num'],
                  ...mapRows(m?.rows || [], r => [
                    r.account || '—',
                    r.oppName || '—',
                    includeAge
                      ? (r.age ?? '—')
                      : (r.amount == null ? '—' : `${fmtMoney(Math.round(r.amount))}${r.excludedFromAvg ? ' *' : ''}`),
                  ], {
                    exportColumns: ['Account', 'Opportunity', 'Scope', includeAge ? 'Age' : 'Amount'],
                    exportMapFn: r => [
                      r.account || '—',
                      r.oppName || '—',
                      r.scope || '',
                      includeAge
                        ? (r.age ?? '—')
                        : (r.amount == null ? '—' : `${fmtMoney(Math.round(r.amount))}${r.excludedFromAvg ? ' *' : ''}`),
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
                              title: `${st.label} — Active Opportunities`,
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
                              title: `${st.label} — Deal Size (Actual)`,
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
                    <td><NumCell value={st.pipelineGoal} kind="money" onCommit={(v) => setStage(i, { pipelineGoal: v })} /></td>
                    <td className={compareClass(pipelineActual, st.pipelineGoal, 'higher-better')}>
                      {fromBfo(m?.total)
                        ? <LiveValue
                            id={`pipeline-${stageNum}`}
                            className={styles.liveCell}
                            breakdown={{
                              title: `${st.label} — Pipeline (Actual)`,
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
                                title: `${st.label} — Close Rate (rolling 365 days)`,
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
                              title: `${st.label} — Avg Opp Life`,
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
                <td className={styles.numCell} title="Stage goals weighted by Active Opp Goal — SUMPRODUCT(lifeGoal, activeGoal) ÷ SUM(activeGoal). Less is better.">{lifeGoalAvg ?? ''}</td>
                <td className={`${styles.numCell} ${compareClass(lifeActualAvg, lifeGoalAvg, 'lower-better')}`.trim()} title="Stage actuals weighted by Active Opp Actual (live BFO count when loaded). SUMPRODUCT(lifeActual, activeActual) ÷ SUM(activeActual).">{lifeActualAvg ?? ''}</td>
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
                <tr><th /><th>Count / $</th><th>Goal - Client</th><th>Actual - Client</th></tr>
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
                    ...mapRows(arr || [], r => [r.oppName, r.source, r.amount == null ? '—' : fmtMoney(Math.round(r.amount))], {
                      exportColumns: ['Opportunity', 'Lead Source', 'Scope', 'Amount'],
                      exportMapFn: r => [r.oppName, r.source, r.scope || '', r.amount == null ? '—' : fmtMoney(Math.round(r.amount))],
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
                        <td className={styles.label}>Current client opps</td>
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
                        <td className={styles.label}>Greenfield opps</td>
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
                        <td className={styles.label}>Current client $</td>
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
                        <td className={styles.label}>Greenfield $</td>
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
                <tr><th colSpan={2}>Coverage Ratio</th></tr>
                <tr><th>Goal</th><th>Actual</th></tr>
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
                          <span className={styles.noBfoCell}>—</span>
                        )}
                      </td>
                    );
                  })()}
                </tr>
              </tbody>
            </table>
          </div>

          <div className={styles.section} style={{ flex: '0 0 315px' }}>
            <table className={styles.grid} style={{ width: '100%' }}>
              <thead>
                <tr><th colSpan={3}>% of deals not Quoted</th></tr>
                <tr><th>Goal</th><th>Actual Year</th><th>Actual Month</th></tr>
              </thead>
              <tbody>
                <tr>
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

        </div>

        {/* Goals / Activities */}
        <div className={styles.section} style={{ maxWidth: 480 }}>
          <table className={styles.grid}>
            <thead><tr><th>Goals</th><th>Opportunities</th></tr></thead>
            <tbody>
              <tr>
                <td className={styles.label}>{state.newOppsGoal} New Opps Past 30 Days</td>
                <td className={compareClass(newOppsPast30Count, state.newOppsGoal, 'higher-better')}>
                  <LiveValue
                    id="new-opps-30"
                    className={styles.liveCell}
                    breakdown={{
                      title: 'New Opps — Past 30 Days',
                      value: String(newOppsPast30Count),
                      formula: 'COUNT of Opps with a BFO Link opened in the last 30 days. Open date prefers Start Date, else fetchedAt − Age.',
                      inputs: [{ label: 'New opps', value: newOppsPast30Count }],
                      rows: {
                        head: 'New opps (by account)',
                        columns: ['Account', 'Opportunity', 'Opened'],
                        aligns: ['', '', ''],
                        ...mapRows(newOppsPast30.items, it => [it.account, it.opp, it.openDate], {
                          exportColumns: ['Account', 'Opportunity', 'BFO Opportunity Name', 'Scope', 'Opened'],
                          exportMapFn: it => [it.account, it.opp, it.bfoName || '', it.scope || '', it.openDate],
                        }),
                      },
                      note: 'Auto-fed from the Opps tab. Re-paste the Opps tab to refresh.',
                    }}
                  >{newOppsPast30Count}</LiveValue>
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

        {/* Client renewals — active clients whose soonest contract End Date
            is within the renewal window. Pulled from the Clients tab. */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Client Renewals — Contracts Expiring Within {RENEWAL_WINDOW_DAYS} Days</div>
          <table className={styles.tinyTable} title={`Auto-fed from the Clients tab — active clients (CDM = ${cdmName || 'your CDM'} and Status = Client) whose soonest contract End Date is within ${RENEWAL_WINDOW_DAYS} days. Sorted soonest first; negative = already overdue.`}>
            <thead>
              <tr>
                <th>Client</th>
                <th>Renewal Status</th>
                <th>Client Manager</th>
                <th>Decision Maker</th>
                <th>Invited to Louisville</th>
                <th>Days Until Expiration</th>
              </tr>
            </thead>
            <tbody>
              {expiringClients.length > 0 ? (
                expiringClients.map((c) => {
                  const dms = dmsByCompany.get(normClientName(c.company)) || [];
                  return (
                  <tr key={c.id}>
                    <td>
                      {onSelectProspect ? (
                        <span className={styles.linkCell} onClick={() => openClientModal(c)}>{c.company}</span>
                      ) : c.company}
                    </td>
                    <td>{c.renewalStatus || '—'}</td>
                    <td>{c.clientManager || '—'}</td>
                    <td>
                      {dms.length > 0 ? dms.map((dm, i) => (
                        <div key={i}>
                          {onSelectProspect ? (
                            <span className={styles.linkCell} onClick={() => openClientModal(c, dm.contact)}>{dm.name}</span>
                          ) : dm.name}
                        </div>
                      )) : '—'}
                    </td>
                    <td>
                      {dms.length > 0 ? dms.map((dm, i) => (
                        <div key={i} style={{ color: dm.invited ? '#16a34a' : '#94a3b8' }}>
                          {dm.invited ? 'Yes' : 'No'}
                        </div>
                      )) : '—'}
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

        {/* Strategy notes — free-text, editable, saved to the browser. */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Eliminating Distractions</div>
          <div className={styles.notesBody}>
            <NotesBox value={state.notesDistractions} onCommit={(v) => setField('notesDistractions', v)} minRows={6} />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Prospecting Approach</div>
          <div className={`${styles.notesBody} ${styles.notesTwoCol}`}>
            <NotesBox value={state.notesProspectingLeft} onCommit={(v) => setField('notesProspectingLeft', v)} minRows={5} />
            <NotesBox value={state.notesProspectingRight} onCommit={(v) => setField('notesProspectingRight', v)} minRows={5} />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Efficient Time Utilization</div>
          <div className={styles.notesBody}>
            <NotesBox value={state.notesEfficientTime} onCommit={(v) => setField('notesEfficientTime', v)} minRows={6} />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Updates</div>
          <div className={styles.notesBody}>
            <NotesBox value={state.notesUpdates} onCommit={(v) => setField('notesUpdates', v)} minRows={6} />
          </div>
        </div>
      </div>
    </div>
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
