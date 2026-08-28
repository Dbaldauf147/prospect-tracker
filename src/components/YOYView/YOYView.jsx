// YOY tab — recreates the Leads / Quoted Projections / Close Rate
// summary charts off the Opps tab data cached in IndexedDB.

import { useEffect, useMemo, useState, useRef, useCallback, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, LabelList, Cell,
} from 'recharts';
import { dbGet } from '../../utils/db';
import {
  parseMoney, parseYear, parseDateYear, isQuotedPlus, yearElapsedFraction,
} from '../../utils/oppsMetrics';
import { loadOppsFromCache } from '../../utils/oppsCache';
import { loadCommissions, COMMISSIONS_LIST_EVENT } from '../../utils/commissionsStore';
import { loadDealsList } from '../../utils/dealsStore';
import { DEAL_BFO_KEY } from '../../utils/dealCommissions';
import { asNumber, dealYear } from '../../utils/dealsFormat';
import {
  loadQuotedProjections, saveQuotedProjections, QUOTED_FIELDS, QUOTED_HISTORICAL_SEED,
  juneRebuildDone, markJuneRebuildDone, QUOTED_PROJECTIONS_EVENT,
} from '../../utils/quotedProjectionsStore';
import {
  saveQuotedMonthRows, loadQuotedMonthRows, loadAllQuotedMonthRows,
  capturedValuesMatch, QUOTED_ROW_FIELDS,
} from '../../utils/quotedMonthRows';
import { loadYoyOverrides, saveYoyOverrides, YOY_OVERRIDES_EVENT } from '../../utils/yoyOverridesStore';
import { loadHiddenCharts, saveHiddenCharts } from '../../utils/yoyHiddenChartsStore';
import styles from './YOYView.module.css';

const PIPELINE_STORE = 'pipeline-dashboard';
const PIPELINE_KEY = 'current';
const DEFAULT_ANNUAL_TARGET = 1325000;

// Lets any ChartHeader open the shared data editor for its chart without
// threading a callback through every card. Provided by YOYView around the
// chart grid; value is `openEditor(chartId)`.
const EditChartContext = createContext(null);

// Lets any ChartHeader hide its own chart without threading a callback
// through every card. Provided by YOYView around the chart grid; value is
// `hideChart(chartId)`.
const HideChartContext = createContext(null);

// Display names for the hidden-chart restore chips, keyed by the same id
// each ChartHeader hides under.
const YOY_CHART_TITLES = {
  leads: 'Leads',
  quotedProjections: 'Quoted Projections',
  closeRate: 'Close Rate',
  leadSources: 'Lead Sources 2020+',
  quotedByYear: 'Quoted (Thousands)',
  notSolds: 'Not Solds',
  topAccounts: 'Top Accounts',
  annualSales: 'Annual Sales',
  dealSize: 'Deal Size',
  commissions: 'Commissions',
};

// Describes which plotted fields of each chart the "Edit data" popup can
// overwrite. keyField identifies a row (its x-axis category); fields are
// the plotted numbers, each with a display label and a kind that drives
// formatting of the computed-value placeholder. `recompute(row, fields,
// ctx)` optionally re-derives dependent fields (totals / %s) after an
// override is applied so on-chart labels stay consistent. Quoted
// Projections is intentionally absent — it already has its own editor.
const YOY_CHART_EDITS = {
  leads: {
    title: 'Leads', keyField: 'year', keyLabel: 'Year',
    fields: [{ key: 'count', label: 'Leads', kind: 'int' }],
  },
  closeRate: {
    title: 'Close Rate', keyField: 'year', keyLabel: 'Open Year',
    fields: [
      { key: 'totalNotSold', label: 'Total Not Sold %', kind: 'pct' },
      { key: 'totalSold', label: 'Total Sold %', kind: 'pct' },
      { key: 'inProgress', label: 'In Progress %', kind: 'pct' },
      { key: 'quotedCR', label: 'Quoted C/R %', kind: 'pct' },
      { key: 'totalCR', label: 'Total C/R %', kind: 'pct' },
    ],
  },
  leadSources: {
    title: 'Lead Sources 2020+', keyField: 'source', keyLabel: 'Lead Source',
    fields: [
      { key: 'inProgress', label: 'In Progress', kind: 'int' },
      { key: 'notSold', label: 'Not Sold', kind: 'int' },
      { key: 'sold', label: 'Sold', kind: 'int' },
      { key: 'closeRate', label: 'Close Rate %', kind: 'ratioPct' },
    ],
    // Total (used for sorting) and the row-end close-rate label are derived
    // from the counts — unless the close-rate data label was overridden.
    recompute: (r, _fields, _ctx, ov) => {
      const sold = Number(r.sold) || 0;
      const notSold = Number(r.notSold) || 0;
      const inProgress = Number(r.inProgress) || 0;
      const decided = sold + notSold;
      return {
        ...r,
        total: inProgress + notSold + sold,
        closeRate: ov && ov.has('closeRate') ? r.closeRate : (decided ? sold / decided : null),
      };
    },
  },
  quotedByYear: {
    title: 'Quoted (Thousands)', keyField: 'year', keyLabel: 'Quoted Year',
    fields: [{ key: 'thousands', label: 'Quoted ($k)', kind: 'int' }],
  },
  notSolds: {
    title: 'Not Solds', keyField: 'year', keyLabel: 'Open Year',
    fields: [
      { key: 'notSold', label: 'Not Solds', kind: 'int' },
      { key: 'avgOppLife', label: 'Avg Opp Life (days)', kind: 'int' },
      { key: 'ageNotQuoted', label: 'Age of not Quoted (days)', kind: 'int' },
      { key: 'quoteToClose', label: 'Quote to Close (days)', kind: 'int' },
    ],
  },
  topAccounts: {
    title: 'Top Accounts', keyField: 'year', keyLabel: 'Year',
    // Columns are the top-account names + Remaining, so they're supplied
    // per-render from the data rather than fixed here.
    dynamic: true,
    // _total is the bar-top data label = sum of the account stacks +
    // Remaining, unless the user overrode the Total directly.
    recompute: (r, fields, _ctx, ov) => {
      if (ov && ov.has('_total')) return { ...r, _total: Math.round(Number(r._total) || 0) };
      let total = 0;
      for (const f of fields) { if (f.key === '_total') continue; total += Number(r[f.key]) || 0; }
      return { ...r, _total: Math.round(total) };
    },
  },
  annualSales: {
    title: 'Annual Sales', keyField: 'year', keyLabel: 'Year',
    fields: [
      { key: 'currentClient', label: 'Current Client ($)', kind: 'money' },
      { key: 'newClient', label: 'New Client ($)', kind: 'money' },
      { key: '_total', label: 'Total ($)', kind: 'money' },
      { key: 'pctQuota', label: '% Quota', kind: 'pct' },
    ],
    // Total and % Quota are the bar-top data labels. Each derives from the
    // two client segments (and the annual target) unless overridden.
    recompute: (r, _fields, ctx, ov) => {
      const total = (ov && ov.has('_total'))
        ? (Number(r._total) || 0)
        : (Number(r.currentClient) || 0) + (Number(r.newClient) || 0);
      const tgt = ctx?.annualTarget || 0;
      const pctQuota = (ov && ov.has('pctQuota'))
        ? r.pctQuota
        : (tgt > 0 ? Math.round((total / tgt) * 100) : r.pctQuota);
      return { ...r, _total: Math.round(total), pctQuota };
    },
  },
  dealSize: {
    title: 'Deal Size', keyField: 'year', keyLabel: 'Year',
    fields: [
      { key: 'deals', label: 'Deals (Sold)', kind: 'int' },
      { key: 'quoted', label: 'Quoted mean ($)', kind: 'money' },
      { key: 'dealSize', label: 'Deal Size avg ($)', kind: 'money' },
    ],
  },
  commissions: {
    title: 'Commissions', keyField: 'year', keyLabel: 'Year',
    fields: [{ key: 'total', label: 'Commissions ($)', kind: 'money' }],
  },
};

// Apply a chart's saved overrides onto its computed rows. Only the fields
// present in a row's override patch are replaced (with finite numbers);
// everything else stays as computed. When a row is touched, the chart's
// optional recompute() re-derives dependent fields. Returns the original
// array reference untouched when the chart has no overrides.
function applyYoyOverrides(rows, cfg, table, ctx, fieldsOverride) {
  if (!table || !rows || rows.length === 0) return rows;
  const fields = fieldsOverride || cfg.fields || [];
  let changed = false;
  const out = rows.map((r) => {
    const patch = table[String(r[cfg.keyField])];
    if (!patch) return r;
    let next = { ...r };
    const overridden = new Set();
    for (const f of fields) {
      const v = patch[f.key];
      if (v != null && Number.isFinite(Number(v))) { next[f.key] = Number(v); overridden.add(f.key); }
    }
    if (overridden.size === 0) return r;
    // recompute re-derives dependent fields, but must leave any field the
    // user overrode directly (e.g. an edited Total / % Quota data label)
    // untouched — so it's told which keys were explicitly set.
    if (cfg.recompute) next = cfg.recompute(next, fields, ctx, overridden);
    changed = true;
    return next;
  });
  return changed ? out : rows;
}

// Drop empty ($0 / blank) years from the leading and trailing edges of a
// year-series so the chart doesn't open or close on bare axis ticks (e.g.
// 2015–2017 before the first commission). Interior empty years are kept —
// blanking a gap year would misleadingly slide two real years together.
// `field` is the plotted value that defines "empty"; returns the same
// array reference when nothing needs trimming.
function trimEmptyEdgeYears(rows, field = 'total') {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  let start = 0;
  let end = rows.length - 1;
  const hasValue = (r) => Number(r?.[field]) > 0;
  while (start <= end && !hasValue(rows[start])) start++;
  while (end >= start && !hasValue(rows[end])) end--;
  return (start === 0 && end === rows.length - 1) ? rows : rows.slice(start, end + 1);
}

// Format a computed value for the editor's placeholder, so the user sees
// what the live number is before typing a replacement.
function fmtOverrideValue(v, kind) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  if (kind === 'money') return `$${Math.round(n).toLocaleString('en-US')}`;
  if (kind === 'pct') return `${n}%`;
  // A 0–1 ratio the chart draws as a whole-number percent (e.g. close rate).
  if (kind === 'ratioPct') return `${Math.round(n * 100)}%`;
  return n.toLocaleString('en-US');
}
// BFO Activity cache — pasted BFO pipeline rows, used to total the live
// "BFO Pipe Total" for the current Quoted Projections month.
const BFO_ACTIVITY_STORE = 'bfo-activity';
const BFO_ACTIVITY_KEY = 'current';
// Closed stages don't belong in the live quoted pipeline buckets.
const CLOSED_STAGES = new Set(['Sold', 'Not Sold', 'Closed', 'Lost']);

// The three fields a rebuilt month end leans on: which bucket an opp falls in
// (Chance?), whether it feeds Agreements Sent (Stage), and how much it puts
// there (Quoted Amount). Opps 2 stamps each edit per field in
// `_fieldUpdatedAt`, so a stamp later than the month end means the rebuild is
// reading a value the opp did NOT carry at the time — the row is a suspect for
// whatever gap the Totals check reports. The stamp records when a field
// changed, not what it held before, so this can flag a row but never correct
// it.
const REBUILD_SENSITIVE_FIELDS = [
  { label: 'Chance?', keys: ['Chance?', 'Chance'] },
  { label: 'Stage', keys: ['Stage'] },
  { label: 'Quoted Amount', keys: ['Quoted Amount'] },
];

const NOT_TRACKED = 'Not tracked: no edit history on this row';

function changedSinceMonthEnd(record, monthEndMs) {
  const stamps = record && typeof record._fieldUpdatedAt === 'object' && record._fieldUpdatedAt
    ? record._fieldUpdatedAt : null;
  if (!stamps) return { label: NOT_TRACKED, latest: null };
  const hits = [];
  let latest = null;
  for (const field of REBUILD_SENSITIVE_FIELDS) {
    for (const key of field.keys) {
      const stamp = stamps[key];
      if (Number.isFinite(stamp) && stamp > monthEndMs) {
        hits.push(field.label);
        if (latest == null || stamp > latest) latest = stamp;
        break;
      }
    }
  }
  return { label: hits.length ? hits.join(', ') : 'No', latest };
}


// Total pipeline $ from the BFO Activity table — sum of its "Amount"
// column across every pasted row. Returns null when no BFO data is
// cached so the chart leaves that point blank instead of plotting $0.
function sumBfoPipe(bfo) {
  if (!bfo || !Array.isArray(bfo.rows) || bfo.rows.length === 0 || !Array.isArray(bfo.headers)) return null;
  const amountCol = bfo.headers.find(h => /^amount$/i.test(h));
  if (!amountCol) return null;
  let sum = 0;
  let any = false;
  for (const r of bfo.rows) {
    const amt = parseMoney(r[amountCol]);
    if (typeof amt === 'number' && Number.isFinite(amt)) { sum += amt; any = true; }
  }
  return any ? sum : null;
}

// Calendar-month key ("YYYY-MM") matching the Quoted Projections table
// keys, for the month `nowMs` falls in.
function currentMonthKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// The Quoted Projections fiscal year (Dec → Nov) `nowMs` falls in, named
// by the calendar year it ends in. December already belongs to the *next*
// fiscal year — without this the chart would keep showing last year's
// Dec→Nov window all through December, leaving the in-progress month with
// no slot to plot into or auto-capture.
function quotedFiscalYear(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear();
}

// Where a stored Quoted Projections month came from, so the export can say
// whether a figure was hand-entered, auto-captured at month end, or part of
// the supplied Dec–May seed history (the seed merges into the same table,
// so it's identified by its values still matching).
function quotedStoredSource(key, saved) {
  if (!saved) return 'No values recorded';
  if (saved._auto) return 'Auto-captured month-end snapshot (Opps + BFO Activity)';
  if (saved._rebuilt) return 'Rebuilt from Opps as the pipeline stood at month end';
  const seed = QUOTED_HISTORICAL_SEED[key];
  if (seed && QUOTED_FIELDS.every(f => Number(seed[f]) === Number(saved[f]))) {
    return 'Seeded history (supplied figures)';
  }
  return 'Manual entry (“Edit values”)';
}

// Same, for a plotted row — the in-progress month is computed live rather
// than read from the store.
function quotedValueSource(row, quotedTable) {
  if (row._live) return 'Live: computed now from Opps + BFO Activity';
  const saved = quotedTable?.[row.monthKey];
  if (!saved) return row._hasData ? 'Recorded' : 'No values recorded';
  return quotedStoredSource(row.monthKey, saved);
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// June 2026 was never captured before the month-end auto-persist existed. Its
// first fill was a stand-in copy of the then-live totals; it's rebuilt once
// from the Opps data as the pipeline stood at that month end.
const JUNE_2026_KEY = '2026-06';

// Quoted Projections runs on a Dec-to-Nov fiscal year, starting in
// December of the previous calendar year and ending in November of the
// current calendar year. Returns 12 buckets each { label, year,
// monthIdx, key } so a Close Date can be looked up in O(1).
function fiscalMonths(currentYear) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const monthIdx = (11 + i) % 12; // 11 = Dec, 0 = Jan, …, 10 = Nov
    const year = i === 0 ? currentYear - 1 : currentYear;
    months.push({
      label: MONTH_LABELS[monthIdx],
      year,
      monthIdx,
      key: `${year}-${monthIdx}`,
    });
  }
  return months;
}

function fmtMoneyShort(n) {
  if (n == null || !Number.isFinite(n)) return '';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}`;
  return `$${Math.round(n)}`;
}

function fmtMoneyFull(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

// Quoted Projections values are stored in thousands of dollars ($K), so
// e.g. 757 → "$757K" and 4061 → "$4.06M".
function fmtKLabel(v) {
  if (v == null || !Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(2)}M`;
  return `$${Math.round(v).toLocaleString('en-US')}K`;
}

// To keep the explanation from ever covering the bars/points being
// reviewed, the hover content is rendered into a single docked panel
// (sticky strip at the top of the YOY body) instead of floating over
// the plot. This context carries a ref to that panel down to the
// per-chart tooltips; CalcTooltip portals its content into it. Only one
// chart is hovered at a time, so a shared panel is enough.
const CalcPanelContext = createContext(null);

// Recharts still owns the cursor highlight, but we suppress its floating
// box by portaling the content away — keep its wrapper from reserving
// space or eating pointer events just in case the portal target is
// missing (then it falls back to a small floating box).
const TOOLTIP_WRAPPER_STYLE = { pointerEvents: 'none', zIndex: 30 };

export function YOYView() {
  const [opps, setOpps] = useState(null);
  const [bfo, setBfo] = useState(null);
  const [target, setTarget] = useState(DEFAULT_ANNUAL_TARGET);
  const [commissions, setCommissions] = useState(() => loadCommissions().data);
  const [deals, setDeals] = useState(() => loadDealsList().data);
  // Quoted Projections is now a user-maintained table of month-end values
  // (seeded with the supplied Dec–May history) rather than a live compute.
  const [quotedTable, setQuotedTable] = useState(loadQuotedProjections);
  const updateQuotedTable = (next) => { setQuotedTable(next); saveQuotedProjections(next); };
  // User overrides for every chart's data points (per-user localStorage).
  // Applied on top of the live-computed rows so a corrected value wins.
  const [overrides, setOverrides] = useState(loadYoyOverrides);
  // Which chart's data editor is open (chartId | null).
  const [editingChart, setEditingChart] = useState(null);
  // Charts the user has hidden (per-user localStorage). A Set backs the
  // per-render lookups; the stored form is a plain array.
  const [hiddenCharts, setHiddenCharts] = useState(loadHiddenCharts);
  const hiddenSet = useMemo(() => new Set(hiddenCharts), [hiddenCharts]);
  const hideChart = useCallback((chartId) => {
    setHiddenCharts((prev) => {
      if (prev.includes(chartId)) return prev;
      const next = [...prev, chartId];
      saveHiddenCharts(next);
      return next;
    });
  }, []);
  const showChart = useCallback((chartId) => {
    setHiddenCharts((prev) => {
      if (!prev.includes(chartId)) return prev;
      const next = prev.filter((id) => id !== chartId);
      saveHiddenCharts(next);
      return next;
    });
  }, []);
  const showAllCharts = useCallback(() => {
    setHiddenCharts([]);
    saveHiddenCharts([]);
  }, []);
  // Persist a chart's override table; an empty table clears it entirely.
  // The save is deliberately OUTSIDE the state updater: saveYoyOverrides now
  // dispatches a change event, and React may run an updater during render
  // (twice under StrictMode), which would setState mid-render. Reading
  // `overrides` directly is safe here — the editor is modal, so there is no
  // second write racing this one.
  const saveChartOverrides = useCallback((chartId, table) => {
    const next = { ...overrides };
    if (table && Object.keys(table).length) next[chartId] = table;
    else delete next[chartId];
    setOverrides(next);
    saveYoyOverrides(next);
    setEditingChart(null);
  }, [overrides]);
  // Fiscal target that the Annual Sales % Quota override recompute needs.
  const editCtx = useMemo(
    () => ({ annualTarget: target > 0 ? target : DEFAULT_ANNUAL_TARGET }),
    [target],
  );
  useEffect(() => {
    function onStorage(e) {
      if (!e || e.key === 'commissions-list-override') {
        setCommissions(loadCommissions().data);
      }
      if (!e || e.key === 'deals-list-override') {
        setDeals(loadDealsList().data);
      }
    }
    function onFocus() {
      setCommissions(loadCommissions().data);
      setDeals(loadDealsList().data);
    }
    // Same-window change events. These also fire when the Firestore mirror
    // hydrates a newer copy at signin, which is what makes a restored
    // browser show its projections without a reload.
    const onCommissions = () => setCommissions(loadCommissions().data);
    const onQuoted = () => setQuotedTable(loadQuotedProjections());
    const onOverrides = () => setOverrides(loadYoyOverrides());
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    window.addEventListener(COMMISSIONS_LIST_EVENT, onCommissions);
    window.addEventListener(QUOTED_PROJECTIONS_EVENT, onQuoted);
    window.addEventListener(YOY_OVERRIDES_EVENT, onOverrides);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(COMMISSIONS_LIST_EVENT, onCommissions);
      window.removeEventListener(QUOTED_PROJECTIONS_EVENT, onQuoted);
      window.removeEventListener(YOY_OVERRIDES_EVENT, onOverrides);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const oppsSaved = await loadOppsFromCache();
        if (!cancelled && oppsSaved) setOpps(oppsSaved);
      } catch (e) {
        console.warn('YOY opps hydrate failed', e);
      }
      try {
        const bfoSaved = await dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY);
        if (!cancelled && bfoSaved) setBfo(bfoSaved);
      } catch {
        // BFO Pipe Total just stays blank for the live month — no-op.
      }
      try {
        const pipe = await dbGet(PIPELINE_STORE, PIPELINE_KEY);
        if (!cancelled && pipe && Number.isFinite(Number(pipe.target))) {
          setTarget(Number(pipe.target));
        }
      } catch {
        // Pipeline target falls back to DEFAULT_ANNUAL_TARGET — no-op.
      }
    })();
    function onFocus() {
      loadOppsFromCache().then(o => setOpps(o || null)).catch(() => {});
      dbGet(BFO_ACTIVITY_STORE, BFO_ACTIVITY_KEY).then(b => setBfo(b || null)).catch(() => {});
      dbGet(PIPELINE_STORE, PIPELINE_KEY).then(p => {
        if (p && Number.isFinite(Number(p.target))) setTarget(Number(p.target));
      }).catch(() => {});
    }
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

  const records = useMemo(() => (opps && Array.isArray(opps.records)) ? opps.records : [], [opps]);

  const currentYear = new Date().getFullYear();
  // Quoted Projections runs Dec→Nov, so its year rolls a month before the
  // calendar one.
  const quotedYear = quotedFiscalYear();

  // Leads — count of opps by Open Year. Bars go from earliest non-empty
  // year through the current year, then a separate "Projected" bar that
  // annualizes the current year's YTD count.
  const leadsBase = useMemo(() => {
    if (records.length === 0) return [];
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      byYear.set(y, (byYear.get(y) || 0) + 1);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      rows.push({ year: String(y), count: byYear.get(y) || 0, isProjected: false });
    }
    const ytdCount = byYear.get(currentYear) || 0;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round(ytdCount / frac) : ytdCount;
    // _ytd / _frac feed the hover tooltip so the Projected bar can show
    // its annualization (YTD count ÷ fraction of year elapsed).
    rows.push({ year: 'Projected', count: projected, isProjected: true, _ytd: ytdCount, _frac: frac });
    return rows;
  }, [records, currentYear]);
  const leadsData = useMemo(
    () => applyYoyOverrides(leadsBase, YOY_CHART_EDITS.leads, overrides.leads, editCtx),
    [leadsBase, overrides, editCtx],
  );

  // Quoted Projections — month-end snapshots the user records (editable
  // via "Edit values"), plotted across the Dec→Nov fiscal year. Values
  // are in $K: weak/ok/expected are the quoted-$ Chance buckets,
  // agreements is Agreements Sent, and bfoPipe is the total BFO pipeline
  // $ (its own right-hand axis since it runs larger). Months with no
  // recorded value are left null so the lines break rather than zeroing.
  // Live snapshot for the in-progress (current calendar) month, computed
  // off the Opps 2 cache + BFO Activity so the user doesn't have to hand-
  // enter it. weak/ok/expected = open quoted-$ by Chance bucket;
  // agreements = open Quoted-$ with Status "Agreement Sent"; bfoPipe =
  // total BFO Activity Amount. All in $K. A 0 bucket → null so the line
  // doesn't dip to $0 for an empty category.
  const liveCurrentMonth = useMemo(() => {
    if (records.length === 0) return null;
    let weak = 0, ok = 0, expected = 0, agreements = 0;
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      if (CLOSED_STAGES.has(stage)) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      if (!amt) continue;
      const chance = String(r['Chance?'] ?? r['Chance'] ?? '').trim().toLowerCase();
      if (chance === 'weak') weak += amt;
      else if (chance === 'ok') ok += amt;
      else if (chance === 'expected') expected += amt;
      // "Agreement Sent" is a Stage value (the Stage column uses the
      // `status` dropdown list — see OppsView2 DROPDOWN config), not the
      // free-text Status column. Match on Stage so the live month's
      // Agreements Sent total isn't always $0.
      if (stage === 'Agreement Sent') agreements += amt;
    }
    const toK = (n) => (n > 0 ? n / 1000 : null);
    const pipe = sumBfoPipe(bfo);
    return {
      weak: toK(weak), ok: toK(ok), expected: toK(expected),
      agreements: toK(agreements), bfoPipe: pipe != null ? pipe / 1000 : null,
    };
  }, [records, bfo]);

  const quotedData = useMemo(() => {
    const num = (x) => {
      if (x === '' || x == null) return null;
      const n = Number(x);
      return Number.isFinite(n) ? n : null;
    };
    const liveKey = currentMonthKey();
    return fiscalMonths(quotedYear).map((m) => {
      const key = `${m.year}-${String(m.monthIdx + 1).padStart(2, '0')}`;
      // Manually-recorded values win; otherwise the current month falls
      // back to the live Opps 2 / BFO computation. An `_auto` entry is the
      // persisted copy of a live snapshot (written by the auto-capture
      // effect below) — while it's still the current month we keep showing
      // the freshly-computed live values, and once the month rolls over the
      // persisted copy becomes the fixed month-end figure so it doesn't
      // vanish. A manual save clears `_auto` and always wins.
      const rawSaved = quotedTable[key] || null;
      const manualSaved = rawSaved && !rawSaved._auto ? rawSaved : null;
      const isLive = !manualSaved && key === liveKey && liveCurrentMonth != null;
      const v = manualSaved || (isLive ? liveCurrentMonth : rawSaved);
      const weak = v ? num(v.weak) : null;
      const ok = v ? num(v.ok) : null;
      const expected = v ? num(v.expected) : null;
      const agreements = v ? num(v.agreements) : null;
      const bfoPipe = v ? num(v.bfoPipe) : null;
      const _hasData = [weak, ok, expected, agreements, bfoPipe].some(x => x != null);
      return { month: m.label, year: m.year, monthKey: key, weak, ok, expected, agreements, bfoPipe, _hasData, _live: isLive && _hasData };
    });
  }, [quotedTable, quotedYear, liveCurrentMonth]);

  // Persist the live current-month snapshot so it survives the calendar
  // roll-over, and rebuild any past month that was never captured. Previously
  // the in-progress month was only ever computed live and never written, so on
  // the 1st of the next month it reverted to a gap — that's how June's
  // figures vanished once July began. The writes are batched into a single
  // update to avoid one clobbering the other.
  useEffect(() => {
    if (!liveCurrentMonth) return;
    // Round the live snapshot to whole $K, matching what "Edit values"
    // stores. Returns null when nothing computed.
    const liveSnap = () => {
      const snap = {};
      let any = false;
      for (const f of QUOTED_FIELDS) {
        const val = liveCurrentMonth[f];
        if (val != null && Number.isFinite(val)) { snap[f] = Math.round(val); any = true; }
      }
      return any ? snap : null;
    };
    const patch = {};
    // 1) Mirror the live current month under an `_auto` flag. The flag keeps
    //    the month "live" — still recomputed for display and overwritable —
    //    until it rolls over into a fixed month-end figure. A manual save
    //    clears it and always wins.
    const curKey = currentMonthKey();
    const curExisting = quotedTable[curKey];
    if (!curExisting || curExisting._auto) {
      const snap = liveSnap();
      const unchanged = snap && curExisting && curExisting._auto &&
        QUOTED_FIELDS.every(f => (curExisting[f] ?? null) === (snap[f] ?? null));
      if (snap && !unchanged) patch[curKey] = { ...snap, _auto: true };
    }
    // 2) Any already-finished month on the chart with nothing recorded gets
    //    rebuilt from the Opps data as the pipeline stood at that month end
    //    (the same reconstruction the per-month Excel export attaches), not
    //    from today's totals. A month only gets filled once — the write makes
    //    it a recorded entry that "Edit values" can correct.
    for (const m of fiscalMonths(quotedYear)) {
      const key = `${m.year}-${String(m.monthIdx + 1).padStart(2, '0')}`;
      if (key >= curKey || quotedTable[key]) continue; // in progress / future / already recorded
      const snap = quotedMonthSnapshot(key);
      if (snap) patch[key] = snap;
    }
    // 3) June 2026 was filled once with today's live totals as a stand-in
    //    before the reconstruction above existed, so it's carrying July's
    //    numbers rather than its own month end. Replace it with the rebuild,
    //    once per user — a manual correction after that stands.
    if (quotedYear === 2026 && !juneRebuildDone()) {
      const snap = quotedMonthSnapshot(JUNE_2026_KEY);
      if (snap) {
        patch[JUNE_2026_KEY] = snap;
        markJuneRebuildDone();
      }
    }
    if (Object.keys(patch).length === 0) return;
    updateQuotedTable({ ...quotedTable, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCurrentMonth]);

  // Close Rate — stacked bar of In Progress / Sold / Not Sold per Open
  // Year (percentages summing to 100), plus two C/R lines.
  const closeRateBase = useMemo(() => {
    if (records.length === 0) return [];
    // Group records by year.
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(r);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const list = byYear.get(y) || [];
      let sold = 0, notSold = 0, inProgress = 0, quotedNotSold = 0;
      for (const r of list) {
        const stage = String(r.Stage || '').trim();
        if (stage === 'Sold') sold += 1;
        else if (stage === 'Not Sold') {
          notSold += 1;
          if (isQuotedPlus(r)) quotedNotSold += 1;
        } else {
          inProgress += 1;
        }
      }
      const total = sold + notSold + inProgress;
      // Total C/R — every Sold/Not Sold opp counts.
      const totalCR = (sold + notSold) > 0 ? (sold / (sold + notSold)) * 100 : null;
      // Quoted C/R — Not Sold restricted to opps that actually reached
      // Quoted+ (priced). Sold opps are Quoted+ by definition.
      const quotedDenom = sold + quotedNotSold;
      const quotedCR = quotedDenom > 0 ? (sold / quotedDenom) * 100 : null;
      rows.push({
        year: String(y),
        totalNotSold: total > 0 ? +((notSold / total) * 100).toFixed(2) : 0,
        totalSold: total > 0 ? +((sold / total) * 100).toFixed(2) : 0,
        inProgress: total > 0 ? +((inProgress / total) * 100).toFixed(2) : 0,
        totalCR: totalCR == null ? null : +totalCR.toFixed(2),
        quotedCR: quotedCR == null ? null : +quotedCR.toFixed(2),
        // Raw counts behind the percentages / C/R lines, surfaced in the
        // hover tooltip so each year's math can be audited.
        _sold: sold,
        _notSold: notSold,
        _inProgress: inProgress,
        _quotedNotSold: quotedNotSold,
        _total: total,
      });
    }
    return rows;
  }, [records, currentYear]);
  const closeRateData = useMemo(
    () => applyYoyOverrides(closeRateBase, YOY_CHART_EDITS.closeRate, overrides.closeRate, editCtx),
    [closeRateBase, overrides, editCtx],
  );

  // Lead Sources 2020+ — horizontal stacked bars per source value with
  // counts of In Progress / Not Sold / Sold plus the Sold-count and
  // close-rate (Sold / (Sold + Not Sold)) label at the end of each row.
  // `Lead Source` is preferred; we fall back to `Source` per the column
  // names already used elsewhere (PipelineView).
  const leadSourcesBase = useMemo(() => {
    if (records.length === 0) return [];
    const byKey = new Map();
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null || y < 2020) continue;
      const src = String(r['Lead Source'] || r['Source'] || '').trim();
      if (!src || src === '-' || src === '#N/A') continue;
      const stage = String(r.Stage || '').trim();
      let bucket;
      if (stage === 'Sold') bucket = 'sold';
      else if (stage === 'Not Sold') bucket = 'notSold';
      else bucket = 'inProgress';
      if (!byKey.has(src)) byKey.set(src, { source: src, inProgress: 0, notSold: 0, sold: 0 });
      byKey.get(src)[bucket] += 1;
    }
    if (byKey.size === 0) return [];
    const rows = Array.from(byKey.values()).map(r => {
      const closeDenom = r.sold + r.notSold;
      const closeRate = closeDenom > 0 ? r.sold / closeDenom : null;
      const total = r.inProgress + r.notSold + r.sold;
      return { ...r, total, closeRate };
    });
    // Sort descending by total so the biggest source sits on top, matching
    // the screenshot layout.
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [records]);
  const leadSourcesData = useMemo(
    () => applyYoyOverrides(leadSourcesBase, YOY_CHART_EDITS.leadSources, overrides.leadSources, editCtx),
    [leadSourcesBase, overrides, editCtx],
  );

  // Quoted (Thousands) — sum of Quoted Amount bucketed by the calendar
  // year of each opp's Quoted On date (any stage), displayed in $k. Opps
  // without a parseable Quoted On date are excluded since they have no
  // quote year to attribute. Includes a Projected bar for the current year.
  const quotedByYearBase = useMemo(() => {
    if (records.length === 0) return [];
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const ts = Date.parse(r['Quoted On'] || r['Quoted Date'] || '');
      if (Number.isNaN(ts)) continue;
      const y = new Date(ts).getFullYear();
      if (!Number.isFinite(y) || y < 1900 || y > 2100) continue;
      const amt = parseMoney(r['Quoted Amount']);
      const v = (typeof amt === 'number' && Number.isFinite(amt)) ? amt : 0;
      byYear.set(y, (byYear.get(y) || 0) + v);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const total = byYear.get(y) || 0;
      rows.push({
        year: String(y),
        thousands: Math.round(total / 1000),
        isProjected: false,
      });
    }
    const ytd = byYear.get(currentYear) || 0;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round((ytd / frac) / 1000) : Math.round(ytd / 1000);
    // _ytdThousands / _frac let the tooltip explain the Projected bar.
    rows.push({
      year: 'Projected', thousands: projected, isProjected: true,
      _ytdThousands: Math.round(ytd / 1000), _frac: frac,
    });
    return rows;
  }, [records, currentYear]);
  const quotedByYearData = useMemo(
    () => applyYoyOverrides(quotedByYearBase, YOY_CHART_EDITS.quotedByYear, overrides.quotedByYear, editCtx),
    [quotedByYearBase, overrides, editCtx],
  );

  // Not Solds — count of Stage=Not Sold per Open Year + Projected, with
  // three day-count lines on the same axis:
  //   Avg Opp Life      — mean Age across Sold + Not Sold opps that year.
  //   Age of not Quoted — mean Age across opps still in pre-quote stages
  //                       (Lead / Not Started / Qualifying / Quoting).
  //   Quote to Close    — mean (Close Date − Quoted On) for closed opps
  //                       that have a parseable Quoted On / Quoted Date.
  const notSoldsBase = useMemo(() => {
    if (records.length === 0) return [];
    const NOT_QUOTED_STAGES = new Set(['Lead', 'Not Started', 'Qualifying', 'Quoting']);
    const byYear = new Map();
    let minYear = currentYear;
    let maxYear = currentYear;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(r);
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (byYear.size === 0) return [];
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const list = byYear.get(y) || [];
      let notSold = 0;
      let lifeSum = 0, lifeCount = 0;
      let notQuotedSum = 0, notQuotedCount = 0;
      let qtcSum = 0, qtcCount = 0;
      for (const r of list) {
        const stage = String(r.Stage || '').trim();
        if (stage === 'Not Sold') notSold += 1;
        const age = Number(String(r.Age ?? '').replace(/[^0-9.-]/g, ''));
        const closedStage = (stage === 'Sold' || stage === 'Not Sold');
        if (closedStage && Number.isFinite(age)) { lifeSum += age; lifeCount += 1; }
        if (NOT_QUOTED_STAGES.has(stage) && Number.isFinite(age)) {
          notQuotedSum += age; notQuotedCount += 1;
        }
        if (closedStage) {
          const quotedOn = r['Quoted On'] || r['Quoted Date'] || '';
          const closeDate = r['Close Date'] || '';
          const qt = Date.parse(quotedOn);
          const ct = Date.parse(closeDate);
          if (!Number.isNaN(qt) && !Number.isNaN(ct) && ct >= qt) {
            qtcSum += (ct - qt) / 86400000;
            qtcCount += 1;
          }
        }
      }
      rows.push({
        year: String(y),
        notSold,
        isProjected: false,
        avgOppLife: lifeCount > 0 ? Math.round(lifeSum / lifeCount) : null,
        ageNotQuoted: notQuotedCount > 0 ? Math.round(notQuotedSum / notQuotedCount) : null,
        quoteToClose: qtcCount > 0 ? Math.round(qtcSum / qtcCount) : null,
        // Sample sizes behind each averaged line, surfaced in the tooltip.
        _lifeCount: lifeCount,
        _notQuotedCount: notQuotedCount,
        _qtcCount: qtcCount,
      });
    }
    // Projected Not Sold bar — annualize the current year's count.
    const ytdNotSold = (byYear.get(currentYear) || []).filter(r => String(r.Stage || '').trim() === 'Not Sold').length;
    const frac = yearElapsedFraction(currentYear);
    const projected = frac > 0 ? Math.round(ytdNotSold / frac) : ytdNotSold;
    rows.push({
      year: 'Projected', notSold: projected, isProjected: true,
      avgOppLife: null, ageNotQuoted: null, quoteToClose: null,
      _ytdNotSold: ytdNotSold, _frac: frac,
    });
    return rows;
  }, [records, currentYear]);
  const notSoldsData = useMemo(
    () => applyYoyOverrides(notSoldsBase, YOY_CHART_EDITS.notSolds, overrides.notSolds, editCtx),
    [notSoldsBase, overrides, editCtx],
  );

  // Year range for the Top Accounts chart — min-year-with-data →
  // max(currentYear, maxYearInData) span by Open Year so future-dated
  // Open Years (e.g. 2026 entered while the browser clock still reads
  // 2025) still get a bar. (Annual Sales and Deal Size derive their own
  // spans from Close Date years.)
  const yearRange = useMemo(() => {
    if (records.length === 0) return [];
    let minYear = currentYear;
    let maxYear = currentYear;
    let any = false;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y === null) continue;
      any = true;
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (!any) return [];
    const out = [];
    for (let y = minYear; y <= maxYear; y++) out.push(y);
    return out;
  }, [records, currentYear]);

  // Top Accounts — pick the top 4 accounts by lifetime Sold $, then
  // stack per Open Year. Everything outside the top-4 lumps into the
  // "Remaining" bucket. The Projected bar for the current year adds
  // YTD Sold $ + the in-progress pipeline (opps opened this year that
  // haven't closed yet) using the same per-account breakdown.
  const topAccountsBase = useMemo(() => {
    if (records.length === 0 || yearRange.length === 0) return { years: [], topAccounts: [], colors: {} };
    const lifetimeSold = new Map();
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      if (stage !== 'Sold') continue;
      const account = String(r.Account || '').trim();
      if (!account) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      lifetimeSold.set(account, (lifetimeSold.get(account) || 0) + amt);
    }
    const topAccounts = Array.from(lifetimeSold.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name]) => name);
    const topSet = new Set(topAccounts);
    // Positional colors so the 1st top account is always blue, then red,
    // yellow, purple. Remaining is always green.
    const colors = {
      [topAccounts[0]]: '#3b82f6',
      [topAccounts[1]]: '#ef4444',
      [topAccounts[2]]: '#facc15',
      [topAccounts[3]]: '#a855f7',
      Remaining: '#22c55e',
    };
    // Year buckets — Sold $ split per top account + Remaining.
    const buckets = new Map();
    for (const y of yearRange) {
      const row = { year: String(y), _total: 0, Remaining: 0 };
      for (const a of topAccounts) row[a] = 0;
      buckets.set(y, row);
    }
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      if (stage !== 'Sold') continue;
      const y = parseYear(r['Open Year']);
      if (y === null || !buckets.has(y)) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      const account = String(r.Account || '').trim();
      const row = buckets.get(y);
      if (topSet.has(account)) row[account] += amt;
      else row.Remaining += amt;
      row._total += amt;
    }
    const rows = Array.from(buckets.values()).map(r => ({
      ...r,
      year: r.year,
      _total: Math.round(r._total),
      Remaining: Math.round(r.Remaining),
      ...Object.fromEntries(topAccounts.map(a => [a, Math.round(r[a])])),
    }));
    // Projected bar — sum of pipeline (any opp with Open Year = current,
    // Stage NOT in Sold/Not Sold) added to YTD Sold $.
    const projected = { year: 'Projected', _total: 0, Remaining: 0, _isProjected: true };
    for (const a of topAccounts) projected[a] = 0;
    for (const r of records) {
      const y = parseYear(r['Open Year']);
      if (y !== currentYear) continue;
      const stage = String(r.Stage || '').trim();
      if (stage === 'Not Sold') continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      if (!amt) continue;
      const account = String(r.Account || '').trim();
      if (topSet.has(account)) projected[account] += amt;
      else projected.Remaining += amt;
      projected._total += amt;
    }
    projected._total = Math.round(projected._total);
    projected.Remaining = Math.round(projected.Remaining);
    for (const a of topAccounts) projected[a] = Math.round(projected[a]);
    rows.push(projected);
    return { years: rows, topAccounts, colors };
  }, [records, yearRange, currentYear]);
  // The overridable columns for Top Accounts are the per-account stacks +
  // Remaining, discovered from the computed data.
  const topAccountsFields = useMemo(() => ([
    ...(topAccountsBase.topAccounts || []).map(a => ({ key: a, label: a, kind: 'money' })),
    { key: 'Remaining', label: 'Remaining', kind: 'money' },
    { key: '_total', label: 'Total ($)', kind: 'money' },
  ]), [topAccountsBase]);
  const topAccountsData = useMemo(() => {
    const years = applyYoyOverrides(topAccountsBase.years, YOY_CHART_EDITS.topAccounts, overrides.topAccounts, editCtx, topAccountsFields);
    return years === topAccountsBase.years ? topAccountsBase : { ...topAccountsBase, years };
  }, [topAccountsBase, topAccountsFields, overrides, editCtx]);

  // Annual Sales — Sold Quoted Amount per *Close Date* year split into
  // Current Client vs New Client buckets. Current Client classification
  // mirrors the regex PipelineView uses (client|existing|renewal|
  // cross-sell|expansion|upsell on the Lead Source value). Each bar also
  // carries the list of deals that make up its total (`_deals`) so the
  // hover panel can show — and the user can export — the contributors.
  const annualSalesBase = useMemo(() => {
    if (records.length === 0) return [];
    const CLIENT_RE = /client|existing|renewal|cross[\s-]?sell|expansion|upsell/i;
    const annualTarget = target > 0 ? target : DEFAULT_ANNUAL_TARGET;
    const dealFor = (r, y, src, amt) => ({
      Account: String(r.Account || '').trim(),
      'Close Date': r['Close Date'] || '',
      Year: y,
      'Lead Source': src,
      'Client Bucket': CLIENT_RE.test(src) ? 'Current Client' : 'New Client',
      'Quoted Amount': Math.round(amt),
    });
    // Collect Sold deals keyed by the year of their Close Date (falling
    // back to Open Year if the Close Date is missing/unparseable), and
    // track the min→max span so every year in between gets a bar.
    const sold = [];
    let minYear = currentYear, maxYear = currentYear, any = false;
    for (const r of records) {
      if (String(r.Stage || '').trim() !== 'Sold') continue;
      const y = parseDateYear(r['Close Date']) ?? parseYear(r['Open Year']);
      if (y === null) continue;
      const amt = parseMoney(r['Quoted Amount']) || 0;
      const src = String(r['Lead Source'] || r['Source'] || '');
      sold.push({ y, amt, isClient: CLIENT_RE.test(src), deal: dealFor(r, y, src, amt) });
      any = true;
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    }
    if (!any) return [];
    const buckets = new Map();
    for (let y = minYear; y <= maxYear; y++) {
      buckets.set(y, { year: String(y), currentClient: 0, newClient: 0, _total: 0, _isProjected: false, _deals: [] });
    }
    for (const s of sold) {
      const row = buckets.get(s.y);
      if (!row) continue;
      if (s.isClient) row.currentClient += s.amt;
      else row.newClient += s.amt;
      row._total += s.amt;
      row._deals.push(s.deal);
    }
    const sortDeals = (a, b) => b['Quoted Amount'] - a['Quoted Amount'] || a.Account.localeCompare(b.Account);
    const rows = Array.from(buckets.values()).map(r => ({
      ...r,
      currentClient: Math.round(r.currentClient),
      newClient: Math.round(r.newClient),
      _total: Math.round(r._total),
      pctQuota: annualTarget > 0 ? Math.round((r._total / annualTarget) * 100) : null,
      _deals: r._deals.sort(sortDeals),
    }));
    // Projected — this year's Sold deals plus every still-open opp in the
    // late-stage pipeline: Stage "Agreement Sent" or "Contracting".
    // Closed/Not-Sold opps and prior-year Sold are excluded; Sold is counted
    // once here, so the pipeline branch skips closed stages to avoid
    // double-counting.
    let projCurrent = 0, projNew = 0;
    const projDeals = [];
    for (const r of records) {
      const stage = String(r.Stage || '').trim();
      const amt = parseMoney(r['Quoted Amount']) || 0;
      if (!amt) continue;
      let include = false;
      if (stage === 'Sold') {
        const y = parseDateYear(r['Close Date']) ?? parseYear(r['Open Year']);
        include = y === currentYear;
      } else {
        include = stage === 'Agreement Sent' || stage === 'Contracting';
      }
      if (!include) continue;
      const src = String(r['Lead Source'] || r['Source'] || '');
      if (CLIENT_RE.test(src)) projCurrent += amt;
      else projNew += amt;
      projDeals.push({ ...dealFor(r, currentYear, src, amt), Stage: stage });
    }
    const projTotal = projCurrent + projNew;
    rows.push({
      year: 'Projected',
      currentClient: Math.round(projCurrent),
      newClient: Math.round(projNew),
      _total: Math.round(projTotal),
      pctQuota: annualTarget > 0 ? Math.round((projTotal / annualTarget) * 100) : null,
      _isProjected: true,
      _deals: projDeals.sort(sortDeals),
    });
    return rows;
  }, [records, currentYear, target]);
  const annualSalesData = useMemo(
    () => applyYoyOverrides(annualSalesBase, YOY_CHART_EDITS.annualSales, overrides.annualSales, editCtx),
    [annualSalesBase, overrides, editCtx],
  );

  // Deal Size — composed chart. The bars and blue line are bucketed by
  // Closed Year (calendar year of Close Date, falling back to Open Year
  // when Close Date is missing/unparseable); the red line is bucketed
  // independently by the year each opp was quoted (its Quoted On date):
  //   Deals (gray bars)     = count of Sold opps (won deals), by Closed Year
  //   Deal Size (blue line) = avg Quoted Amount of Sold opps, by Closed Year
  //   Quoted (red line)     = avg Quoted Amount of opps quoted that year,
  //                           by Quoted Year (Quoted On date)
  // The year span covers both the closed years (bars/blue) and the quoted
  // years (red) so neither series is clipped. The Projected bar counts
  // this year's Sold deals plus opps in the Agreement Sent stage, treated
  // as expected future wins.
  const dealSizeBase = useMemo(() => {
    if (records.length === 0) return [];
    // Closed opps feed the bars + blue line (by Closed Year); quoted opps
    // feed the red line (by Quoted Year). Track the combined min→max span.
    let minYear = currentYear, maxYear = currentYear, any = false;
    const bump = (y) => {
      if (y == null) return;
      any = true;
      if (y < minYear) minYear = y;
      if (y > maxYear) maxYear = y;
    };
    const closed = []; // { cy, stage, amt|null }
    const quoted = []; // { qy, amt }
    for (const r of records) {
      const amt = parseMoney(r['Quoted Amount']);
      const hasAmt = typeof amt === 'number' && amt > 0;
      // Red line: any opp quoted (has a Quoted On date + positive amount),
      // regardless of stage — an average of every quote written that year.
      const qy = hasAmt ? parseDateYear(r['Quoted On'] || r['Quoted Date'] || '') : null;
      if (qy != null) { quoted.push({ qy, amt }); bump(qy); }
      // Bars + blue line: closed opps only, by Closed Year.
      const stage = String(r.Stage || '').trim();
      if (stage !== 'Sold' && stage !== 'Not Sold') continue;
      const cy = parseDateYear(r['Close Date']) ?? parseYear(r['Open Year']);
      if (cy === null) continue;
      closed.push({ cy, stage, amt: hasAmt ? amt : null });
      bump(cy);
    }
    if (!any) return [];
    const stats = new Map();
    for (let y = minYear; y <= maxYear; y++) {
      stats.set(y, { soldOppCount: 0, quotedSum: 0, quotedCount: 0, soldSum: 0, soldCount: 0 });
    }
    for (const { cy, stage, amt } of closed) {
      const s = stats.get(cy);
      if (!s) continue;
      // Grey bars count won deals — every Sold opp, regardless of amount.
      if (stage === 'Sold') {
        s.soldOppCount += 1;
        if (amt != null) { s.soldSum += amt; s.soldCount += 1; }
      }
    }
    for (const { qy, amt } of quoted) {
      const s = stats.get(qy);
      if (!s) continue;
      s.quotedSum += amt;
      s.quotedCount += 1;
    }
    const rows = [];
    for (let y = minYear; y <= maxYear; y++) {
      const s = stats.get(y);
      rows.push({
        year: String(y),
        deals: s.soldOppCount,
        quoted: s.quotedCount > 0 ? Math.round(s.quotedSum / s.quotedCount) : null,
        dealSize: s.soldCount > 0 ? Math.round(s.soldSum / s.soldCount) : null,
        _isProjected: false,
        // Sample sizes behind the Quoted / Deal Size mean lines.
        _quotedCount: s.quotedCount,
        _soldCount: s.soldCount,
      });
    }
    // Projected — deals Sold this year (by Closed Year) plus every opp
    // still in the Agreement Sent stage, counted as expected future wins.
    // Not Sold opps and earlier-stage pipeline are excluded from the bar
    // count. The red Quoted point is the average of every opp quoted this
    // calendar year; the blue Deal Size point is the average Sold $ closed
    // this year.
    // Projected point: the Deals bar counts this year's Sold deals plus
    // every Agreement Sent opp (expected future wins). The Quoted point is
    // the mean Quoted Amount across *only* those same opps — this year's
    // Sold deals and the active Agreement Sent pipeline — deliberately
    // excluding opps in any other stage. Deal Size is intentionally not
    // projected, so its point is left blank (null) for this bar.
    let projWon = 0, projPipeline = 0, projQuotedSum = 0, projQuotedCount = 0;
    for (const r of records) {
      const amt = parseMoney(r['Quoted Amount']);
      const hasAmt = typeof amt === 'number' && amt > 0;
      const stage = String(r.Stage || '').trim();
      const isClosed = (stage === 'Sold' || stage === 'Not Sold');
      if (isClosed) {
        const y = parseDateYear(r['Close Date']) ?? parseYear(r['Open Year']);
        if (y !== currentYear) continue;
        if (stage === 'Sold') {
          projWon += 1;
          if (hasAmt) { projQuotedSum += amt; projQuotedCount += 1; }
        }
      } else if (stage === 'Agreement Sent') {
        projPipeline += 1;
        if (hasAmt) { projQuotedSum += amt; projQuotedCount += 1; }
      }
    }
    rows.push({
      year: 'Projected',
      deals: projWon + projPipeline,
      quoted: projQuotedCount > 0 ? Math.round(projQuotedSum / projQuotedCount) : null,
      dealSize: null,
      _isProjected: true,
      _quotedCount: projQuotedCount,
      _soldCount: 0,
    });
    return rows;
  }, [records, currentYear]);
  const dealSizeData = useMemo(
    () => applyYoyOverrides(dealSizeBase, YOY_CHART_EDITS.dealSize, overrides.dealSize, editCtx),
    [dealSizeBase, overrides, editCtx],
  );

  const hasOpps = records.length > 0;

  // Commissions — the Deals tab's Commission column summed by year. Each
  // deal row is bucketed by its Year — the same value the Deals tab shows,
  // derived from Original Contract Start (dealYear), NOT the raw stored
  // 'Year' cell, which is often blank even when the deal clearly falls in a
  // year. Its "Commission" dollar amount is added to that year's total.
  // Rows without a usable year are skipped; a blank/zero Commission still
  // counts its row (so the year is represented) but adds nothing. Years
  // between the earliest and latest are kept even when empty so a missing
  // year shows as a $0 bar instead of a gap in the axis.
  const commissionsBase = useMemo(() => {
    const byYear = new Map();
    const countByYear = new Map();
    for (const row of (deals || [])) {
      const year = Number(dealYear(row));
      if (!Number.isFinite(year) || year < 1900 || year > 2100) continue;
      const commission = asNumber(row?.['Commission']) || 0;
      byYear.set(year, (byYear.get(year) || 0) + commission);
      countByYear.set(year, (countByYear.get(year) || 0) + 1);
    }
    if (byYear.size === 0) return [];
    const minY = Math.min(...byYear.keys());
    const maxY = Math.max(...byYear.keys());
    const rows = [];
    for (let y = minY; y <= maxY; y++) {
      // _rowCount = deal rows that fed this year's total (tooltip input).
      rows.push({ year: String(y), total: byYear.get(y) || 0, _rowCount: countByYear.get(y) || 0 });
    }
    return rows;
  }, [deals]);
  const commissionsData = useMemo(
    () => trimEmptyEdgeYears(applyYoyOverrides(commissionsBase, YOY_CHART_EDITS.commissions, overrides.commissions, editCtx)),
    [commissionsBase, overrides, editCtx],
  );
  const hasCommissions = commissionsData.length > 0;

  // Per-chart underlying records. Each entry mirrors the filter used by
  // the matching useMemo above so the downloaded Excel rows tie back to
  // the chart values.
  const contributingRecords = useMemo(() => {
    const leads = [];
    const quotedSource = [];
    const closeRate = [];
    const leadSources = [];
    const quotedByYear = [];
    const notSolds = [];
    const NOT_QUOTED_STAGES = new Set(['Lead', 'Not Started', 'Qualifying', 'Quoting']);
    for (const r of records) {
      const oy = parseYear(r['Open Year']);
      const account = String(r.Account || '').trim();
      const stage = String(r.Stage || '').trim();
      const status = String(r.Status || '').trim();
      const chance = String(r['Chance?'] || r['Chance'] || '').trim();
      const closeDate = r['Close Date'] || '';
      const quotedOn = r['Quoted On'] || r['Quoted Date'] || '';
      const leadSource = String(r['Lead Source'] || r['Source'] || '').trim();
      const quotedAmtRaw = r['Quoted Amount'] || '';
      const quotedAmt = parseMoney(quotedAmtRaw);
      const scope = String(r.Scope || '').trim();
      const ageNum = Number(String(r.Age ?? '').replace(/[^0-9.-]/g, ''));
      const age = Number.isFinite(ageNum) ? ageNum : '';

      // Quoted (Thousands) contributors — grouped by the calendar year of
      // the Quoted On date, so include any row with a parseable Quoted On
      // regardless of Open Year.
      const quotedOnTs = Date.parse(quotedOn);
      if (!Number.isNaN(quotedOnTs)) {
        const qy = new Date(quotedOnTs).getFullYear();
        if (Number.isFinite(qy) && qy >= 1900 && qy <= 2100) {
          quotedByYear.push({
            Account: account,
            'Quoted On': quotedOn,
            'Quoted Year': qy,
            Stage: stage,
            'Open Year': oy ?? '',
            'Quoted Amount': quotedAmt ?? 0,
          });
        }
      }

      if (oy !== null) {
        leads.push({
          Account: account,
          Stage: stage,
          Status: status,
          'Open Year': oy,
          'Close Date': closeDate,
          'Quoted Amount': quotedAmt ?? '',
          Scope: scope,
        });
        closeRate.push({
          Account: account,
          'Open Year': oy,
          Stage: stage,
          Status: status,
          'Quoted Amount': quotedAmt ?? '',
          Bucket: (stage === 'Sold') ? 'Sold'
            : (stage === 'Not Sold')
              ? (isQuotedPlus(r) ? 'Not Sold (Quoted+)' : 'Not Sold (pre-quote)')
              : 'In Progress',
          'Close Date': closeDate,
        });
        // Not Solds chart contributors — keep every row that fed any of
        // the bars or lines so the user can audit each year's stats.
        const closedStage = (stage === 'Sold' || stage === 'Not Sold');
        const isAgeForNotQuoted = NOT_QUOTED_STAGES.has(stage);
        const qt = Date.parse(quotedOn);
        const ct = Date.parse(closeDate);
        const quoteToClose = (!Number.isNaN(qt) && !Number.isNaN(ct) && ct >= qt && closedStage)
          ? Math.round((ct - qt) / 86400000) : '';
        notSolds.push({
          Account: account,
          'Open Year': oy,
          Stage: stage,
          Status: status,
          Age: age,
          'Counts in Not Sold bar': stage === 'Not Sold' ? 'Yes' : 'No',
          'Counts in Avg Opp Life': closedStage && Number.isFinite(ageNum) ? 'Yes' : 'No',
          'Counts in Age of not Quoted': isAgeForNotQuoted && Number.isFinite(ageNum) ? 'Yes' : 'No',
          'Quoted On': quotedOn,
          'Close Date': closeDate,
          'Quote to Close (days)': quoteToClose,
        });
      }
      // Lead Sources 2020+ contributors — Open Year ≥ 2020 with a
      // non-empty source value.
      if (oy !== null && oy >= 2020 && leadSource && leadSource !== '-' && leadSource !== '#N/A') {
        leadSources.push({
          'Lead Source': leadSource,
          Account: account,
          'Open Year': oy,
          Stage: stage,
          Status: status,
          Bucket: stage === 'Sold' ? 'Sold' : stage === 'Not Sold' ? 'Not Sold' : 'In Progress',
          'Quoted Amount': quotedAmt ?? '',
        });
      }
      // Quoted Projections source rows — the raw opps the live (current
      // month) point is summed from. Mirrors `liveCurrentMonth` exactly:
      // open stages only (closed opps leave the pipeline) carrying a
      // Quoted Amount, bucketed by the Chance? column, with the same $
      // counting toward Agreements Sent when the Stage is "Agreement Sent".
      // Rows with no Chance value are kept and flagged — they're in the
      // scanned population but feed no bucket, which is usually why a
      // month's lines don't add up to the pipeline total.
      if (!CLOSED_STAGES.has(stage) && quotedAmt && quotedAmt > 0) {
        const lowerChance = chance.toLowerCase();
        const series =
          lowerChance === 'weak' ? 'Quoted Weak'
          : lowerChance === 'ok' ? 'Quoted OK'
          : lowerChance === 'expected' ? 'Quoted Expected'
          : '';
        quotedSource.push({
          Account: account,
          Stage: stage,
          Status: status,
          'Chance?': chance,
          'Quoted Amount ($)': quotedAmt,
          'Quoted Amount ($K)': Math.round(quotedAmt / 100) / 10,
          'Chart Series': series || '(no Chance: feeds no bucket)',
          'Feeds Agreements Sent': stage === 'Agreement Sent' ? 'Yes' : 'No',
          'Open Year': oy ?? '',
          'Quoted On': quotedOn,
          'Close Date': closeDate,
          Scope: scope,
        });
      }
    }
    leads.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    closeRate.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    quotedByYear.sort((a, b) => a['Quoted Year'] - b['Quoted Year'] || a.Account.localeCompare(b.Account));
    notSolds.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    leadSources.sort((a, b) =>
      a['Lead Source'].localeCompare(b['Lead Source'])
      || a['Open Year'] - b['Open Year']
      || a.Account.localeCompare(b.Account));
    // Group the Quoted Projections source rows by the line they feed, then
    // biggest $ first, so the export reads like the chart's legend.
    const SERIES_ORDER = ['Quoted Weak', 'Quoted OK', 'Quoted Expected'];
    quotedSource.sort((a, b) => {
      const ia = SERIES_ORDER.indexOf(a['Chart Series']);
      const ib = SERIES_ORDER.indexOf(b['Chart Series']);
      return (ia < 0 ? SERIES_ORDER.length : ia) - (ib < 0 ? SERIES_ORDER.length : ib)
        || b['Quoted Amount ($)'] - a['Quoted Amount ($)']
        || a.Account.localeCompare(b.Account);
    });
    // Row-3 chart contributors. Built from the same `records` loop in
    // a second pass so we don't disrupt the existing classifications.
    const topAccountsRecs = [];
    const dealSizeRecs = [];
    const topSet = new Set(topAccountsData.topAccounts || []);
    // Annual Sales contributors are carried per-bar on annualSalesData
    // (`_deals`, bucketed by Close Date), so they aren't rebuilt here.
    for (const r of records) {
      const oy = parseYear(r['Open Year']);
      const account = String(r.Account || '').trim();
      const stage = String(r.Stage || '').trim();
      const closedStage = (stage === 'Sold' || stage === 'Not Sold');
      const amt = parseMoney(r['Quoted Amount']);
      const hasAmt = typeof amt === 'number' && amt > 0;
      const quotedOn = r['Quoted On'] || r['Quoted Date'] || '';
      const closeDate = r['Close Date'] || '';
      // Bucketing keys: bars/blue use Closed Year, the red line uses Quoted
      // Year — mirror the same fallbacks dealSizeBase applies.
      const closedYear = closedStage ? (parseDateYear(closeDate) ?? oy) : null;
      const quotedYear = hasAmt ? parseDateYear(quotedOn) : null;
      // Agreement Sent opps (with a real amount) feed the Projected point:
      // they count toward its Deals bar as expected wins and toward its
      // Quoted average alongside this year's Sold deals. Tie them to the
      // current year so a pinned Projected export pulls them in — mirrors
      // the Projected branch in dealSizeBase, which filters Agreement Sent
      // by stage only (no date filter).
      const feedsProjected = stage === 'Agreement Sent' && hasAmt;
      const projectedYear = feedsProjected ? currentYear : null;
      // The Projected Quoted average is the mean Quoted Amount across this
      // year's Sold deals plus every Agreement Sent opp — the same
      // population the Projected bar counts. Flag both so the export ties
      // back to that number.
      const inProjectedQuoted = hasAmt && (
        (stage === 'Sold' && closedYear === currentYear) || stage === 'Agreement Sent'
      );
      if (oy !== null && stage === 'Sold') {
        topAccountsRecs.push({
          Account: account,
          'Open Year': oy,
          'Quoted Amount': amt ?? '',
          'Top-4 Bucket': topSet.has(account) ? account : 'Remaining',
        });
      }
      // Deal Size contributors — every closed opp (bars + blue Deal Size
      // line, by Closed Year), every quoted opp (red Quoted line, by Quoted
      // Year), and every Agreement Sent opp that feeds the Projected point.
      // An opp filling more than one role appears once with each year set.
      if (closedStage || quotedYear != null || feedsProjected) {
        dealSizeRecs.push({
          Account: account,
          Stage: stage,
          'Closed Year': closedYear ?? '',
          'Close Date': closeDate,
          'Open Year': oy ?? '',
          'Quoted Year': quotedYear ?? '',
          'Quoted Date': quotedOn,
          'Projected Year': projectedYear ?? '',
          'Quoted Amount': amt ?? '',
          'Counts in Deals (Sold)': stage === 'Sold' ? 'Yes' : 'No',
          'Counts in Quoted avg': quotedYear != null ? 'Yes' : 'No',
          'Counts in Deal Size avg': (stage === 'Sold' && hasAmt) ? 'Yes' : 'No',
          'Counts in Projected Quoted avg': inProjectedQuoted ? 'Yes' : 'No',
        });
      }
    }
    topAccountsRecs.sort((a, b) => a['Open Year'] - b['Open Year'] || a.Account.localeCompare(b.Account));
    const dsSortYear = (r) => Number(r['Closed Year'] || r['Quoted Year'] || r['Projected Year'] || 0);
    dealSizeRecs.sort((a, b) => dsSortYear(a) - dsSortYear(b) || a.Account.localeCompare(b.Account));
    // Commissions contributors — one row per deal that fed a year's total.
    // Mirrors commissionsBase exactly: bucketed by the deal's derived year
    // (dealYear, from Original Contract Start) and carrying its Commission
    // column value, so the rows tie back to each bar.
    const commissionsRecs = [];
    for (const row of (deals || [])) {
      const year = Number(dealYear(row));
      if (!Number.isFinite(year) || year < 1900 || year > 2100) continue;
      const commission = asNumber(row?.['Commission']) || 0;
      commissionsRecs.push({
        'Client Name': String(row?.['Client Name'] || '').trim(),
        'BFO Name': String(row?.[DEAL_BFO_KEY] || '').trim(),
        Year: year,
        'Commission ($)': Math.round(commission),
      });
    }
    commissionsRecs.sort((a, b) => a.Year - b.Year || a['Client Name'].localeCompare(b['Client Name']));
    return {
      leads, quotedSource, closeRate, leadSources, quotedByYear, notSolds,
      topAccounts: topAccountsRecs, dealSize: dealSizeRecs,
      commissions: commissionsRecs,
    };
  }, [records, currentYear, topAccountsData, deals, commissions]);

  // Capture the opp rows behind the live month alongside its values. Until
  // now only the five figures were kept, so once a month rolled over its
  // export had to rebuild the pipeline out of today's Opps — carrying today's
  // Chance? and Stage, which is why the Totals check on a past month shows a
  // gap. Storing the rows as the month is captured means a month captured
  // from here on exports the pipeline as it actually stood. Past months
  // already recorded have no rows and still fall back to the rebuild.
  // Declared after `contributingRecords` since it reads the same rows.
  useEffect(() => {
    if (!liveCurrentMonth || records.length === 0) return undefined;
    const monthKey = currentMonthKey();
    const values = {};
    for (const f of QUOTED_FIELDS) {
      const val = liveCurrentMonth[f];
      if (val != null && Number.isFinite(val)) values[f] = Math.round(val);
    }
    const rows = contributingRecords.quotedSource;
    let cancelled = false;
    (async () => {
      const existing = await loadQuotedMonthRows(monthKey);
      if (cancelled) return;
      // Nothing moved since the last capture — skip the rewrite.
      if (existing
        && existing.rows.length === rows.length
        && capturedValuesMatch(existing, values, QUOTED_FIELDS)) return;
      await saveQuotedMonthRows(monthKey, values, rows, bfoActivityRows());
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCurrentMonth, contributingRecords, bfo]);

  // Download just the opportunity rows behind one pinned chart point, so a
  // pinned bar/line can be deep-dived in Excel. Each chart's contributing
  // set already carries the point's key (Open Year / Closed Year / Quoted
  // Year / Lead Source), so we filter that set to the pinned row. A
  // "Projected" bar
  // annualizes the current year, so its raw opps are the current year's.
  function exportPinnedOpps(chartId, row) {
    if (!row) return;
    const CONF = {
      leads: { list: contributingRecords.leads, keyCol: 'Open Year', sheet: 'Leads' },
      closeRate: { list: contributingRecords.closeRate, keyCol: 'Open Year', sheet: 'Close Rate' },
      leadSources: { list: contributingRecords.leadSources, keyCol: 'Lead Source', sheet: 'Lead Sources' },
      quotedByYear: { list: contributingRecords.quotedByYear, keyCol: 'Quoted Year', sheet: 'Quoted' },
      notSolds: { list: contributingRecords.notSolds, keyCol: 'Open Year', sheet: 'Not Solds' },
      topAccounts: { list: contributingRecords.topAccounts, keyCol: 'Open Year', sheet: 'Top Accounts' },
      // Deal Size conflates two year dimensions per point (bars/blue by
      // Closed Year, red by Quoted Year), so a pinned year pulls opps that
      // match on either.
      dealSize: {
        list: contributingRecords.dealSize,
        match: (rec, key) => String(rec['Closed Year']) === key
          || String(rec['Quoted Year']) === key
          || String(rec['Projected Year']) === key,
        sheet: 'Deal Size',
      },
      commissions: { list: contributingRecords.commissions, keyCol: 'Year', sheet: 'Commissions' },
    };
    const conf = CONF[chartId];
    if (!conf) return;
    const rawKey = chartId === 'leadSources'
      ? String(row.source ?? '')
      : (row.isProjected || row.year === 'Projected') ? String(currentYear) : String(row.year);
    const rows = (conf.list || []).filter(
      conf.match ? (rec) => conf.match(rec, rawKey) : (rec) => String(rec[conf.keyCol]) === rawKey
    );
    if (rows.length === 0) {
      window.alert('No opportunity rows are tied to this point.');
      return;
    }
    const wb = XLSX.utils.book_new();
    appendSheet(wb, `${conf.sheet} ${rawKey}`, rows);
    const tag = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'point';
    XLSX.writeFile(wb, `yoy-${chartId}-${tag}-${todayStamp()}.xlsx`);
  }

  function downloadLeads() {
    const summary = leadsData.map(r => ({
      Year: r.year,
      'Lead Count': r.count,
      Type: r.isProjected ? 'Projected (annualized YTD)' : 'Actual',
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Leads by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.leads);
    XLSX.writeFile(wb, `yoy-leads-${todayStamp()}.xlsx`);
  }
  // One plotted month, as an export row.
  function quotedSummaryRow(r) {
    return {
      Month: r.month,
      Year: r.year,
      'Month Key': r.monthKey,
      'Quoted Weak ($K)': r.weak ?? '',
      'Quoted OK ($K)': r.ok ?? '',
      'Quoted Expected ($K)': r.expected ?? '',
      'Agreements Sent ($K)': r.agreements ?? '',
      'BFO Pipe Total ($K)': r.bfoPipe ?? '',
      Source: quotedValueSource(r, quotedTable),
    };
  }
  // Every month held in the store — including months outside the charted
  // Dec→Nov window — so the export carries the whole raw table the chart
  // reads, not just the twelve points currently drawn.
  function quotedStoredRows(capturedMap) {
    const charted = new Set(quotedData.map(r => r.monthKey));
    return Object.keys(quotedTable || {}).sort().map((key) => {
      const v = quotedTable[key] || {};
      const captured = capturedMap ? capturedMap[key] : null;
      return {
        'Month Key': key,
        'Quoted Weak ($K)': v.weak ?? '',
        'Quoted OK ($K)': v.ok ?? '',
        'Quoted Expected ($K)': v.expected ?? '',
        'Agreements Sent ($K)': v.agreements ?? '',
        'BFO Pipe Total ($K)': v.bfoPipe ?? '',
        Source: quotedStoredSource(key, v),
        'On the current chart': charted.has(key) ? 'Yes' : 'No',
        // Whether this month's export can show the pipeline as it stood, or
        // has to rebuild it from today's Opps.
        'Opp rows captured': !captured ? 'No: export rebuilds from today'
          : capturedValuesMatch(captured, v) ? `Yes: ${captured.rows.length} rows`
          : `Captured, but the values were edited since: export rebuilds from today`,
      };
    });
  }
  // Rows behind the "BFO Pipe Total" line for the live month — every
  // pasted BFO Activity row, with its Amount parsed to a number so the
  // sheet sums to the plotted total.
  function bfoActivityRows() {
    if (!bfo || !Array.isArray(bfo.rows) || !Array.isArray(bfo.headers)) return [];
    const amountCol = bfo.headers.find(h => /^amount$/i.test(h));
    return bfo.rows.map((r) => {
      const out = {};
      for (const h of bfo.headers) out[h] = r[h] ?? '';
      out['Amount ($ parsed)'] = amountCol ? (parseMoney(r[amountCol]) ?? '') : '';
      return out;
    });
  }
  // Opp-level rows behind one month's figures.
  //
  // The live month is a straight read of today's pipeline — the same rows the
  // chart sums. A past month is a recorded snapshot with no opp rows kept
  // behind it, so this rebuilds the pipeline as it stood at that month end
  // out of today's Opps data: every opp carrying a quoted amount that had
  // been quoted by then and hadn't closed yet. Chance? and Stage are today's
  // values, so an opp re-graded or advanced since is counted where it sits
  // now — the totals land close to the recorded figures rather than on them,
  // and the Totals check sheet shows by how much.
  function quotedMonthOpps(monthKey, isLive) {
    if (isLive) return contributingRecords.quotedSource;
    const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
    if (!m) return [];
    const y = Number(m[1]);
    const mo = Number(m[2]);
    // Last day of the month, end of day — the month-end the snapshot recorded.
    const monthEndMs = Date.UTC(y, mo, 0) + 86399999;
    const out = [];
    for (const r of records) {
      const amt = parseMoney(r['Quoted Amount']) || 0;
      if (!amt) continue;
      const stage = String(r.Stage || '').trim();
      const closed = CLOSED_STAGES.has(stage);
      const quotedOn = r['Quoted On'] || r['Quoted Date'] || '';
      const closeDate = r['Close Date'] || '';
      const qts = Date.parse(quotedOn);
      const cts = Date.parse(closeDate);
      const quotedKnown = !Number.isNaN(qts);
      // Quoted after this month end — it wasn't in the pipeline yet.
      if (quotedKnown && qts > monthEndMs) continue;
      // Closed on or before this month end — it had already left.
      if (closed && !Number.isNaN(cts) && cts <= monthEndMs) continue;
      // Closed at some unknown date: nothing places it in this month.
      if (closed && Number.isNaN(cts)) continue;
      const chance = String(r['Chance?'] ?? r['Chance'] ?? '').trim();
      const changed = changedSinceMonthEnd(r, monthEndMs);
      const lower = chance.toLowerCase();
      const series =
        lower === 'weak' ? 'Quoted Weak'
        : lower === 'ok' ? 'Quoted OK'
        : lower === 'expected' ? 'Quoted Expected'
        : '';
      out.push({
        Account: String(r.Account || '').trim(),
        Stage: stage,
        Status: String(r.Status || '').trim(),
        'Chance?': chance,
        'Quoted Amount ($)': amt,
        'Quoted Amount ($K)': Math.round(amt / 100) / 10,
        'Chart Series': series || '(no Chance: feeds no bucket)',
        'Feeds Agreements Sent': stage === 'Agreement Sent' ? 'Yes' : 'No',
        'In the pipeline because': quotedKnown
          ? `Quoted ${quotedOn}, still open at month end`
          : 'No Quoted On date: open today, assumed open then',
        // Which of the fields this rebuild depends on have been edited since
        // the month end — i.e. how far to trust this row's bucket.
        'Changed since month end': changed.label,
        'Changed on': changed.latest ? new Date(changed.latest).toISOString().slice(0, 10) : '',
        'Open Year': parseYear(r['Open Year']) ?? '',
        'Quoted On': quotedOn,
        'Close Date': closeDate,
        Scope: String(r.Scope || '').trim(),
      });
    }
    const ORDER = ['Quoted Weak', 'Quoted OK', 'Quoted Expected'];
    out.sort((a, b) => {
      const ia = ORDER.indexOf(a['Chart Series']);
      const ib = ORDER.indexOf(b['Chart Series']);
      return (ia < 0 ? ORDER.length : ia) - (ib < 0 ? ORDER.length : ib)
        || b['Quoted Amount ($)'] - a['Quoted Amount ($)']
        || a.Account.localeCompare(b.Account);
    });
    return out;
  }
  // A finished month's figures rebuilt from the Opps data, by summing the same
  // rows the per-month export attaches — the opps that were quoted by that
  // month end and hadn't closed yet. Values in whole $K, matching the store.
  //
  // It reads today's Chance? / Stage on those opps, so a bucket an opp has
  // since moved between lands where it sits now; that's the same caveat the
  // export's "Totals check" sheet already spells out. `bfoPipe` is left out
  // entirely — BFO Activity is a pasted current snapshot with no history, so
  // there's nothing to reconstruct it from and a blank beats today's total
  // wearing a past month's label.
  function quotedMonthSnapshot(monthKey) {
    const opps = quotedMonthOpps(monthKey, false);
    if (opps.length === 0) return null;
    const totals = { weak: 0, ok: 0, expected: 0, agreements: 0 };
    const BUCKET = { 'Quoted Weak': 'weak', 'Quoted OK': 'ok', 'Quoted Expected': 'expected' };
    for (const o of opps) {
      const amt = Number(o['Quoted Amount ($)']) || 0;
      if (!amt) continue;
      const bucket = BUCKET[o['Chart Series']];
      if (bucket) totals[bucket] += amt;
      if (o['Feeds Agreements Sent'] === 'Yes') totals.agreements += amt;
    }
    const snap = {};
    let any = false;
    for (const f of ['weak', 'ok', 'expected', 'agreements']) {
      if (totals[f] > 0) { snap[f] = Math.round(totals[f] / 1000); any = true; }
    }
    return any ? { ...snap, _rebuilt: true } : null;
  }
  // What the attached opp rows add up to, against what the chart plots. On the
  // live month the two agree; on a past month the gap is what has changed in
  // the Opps data since the snapshot was recorded.
  function quotedTotalsCheck(row, opps) {
    const sumK = (pick) => {
      const total = opps.reduce((n, o) => n + (pick(o) ? Number(o['Quoted Amount ($)']) : 0), 0);
      return total ? Math.round(total / 100) / 10 : 0;
    };
    const series = [
      ['Quoted Weak', row.weak, sumK(o => o['Chart Series'] === 'Quoted Weak')],
      ['Quoted OK', row.ok, sumK(o => o['Chart Series'] === 'Quoted OK')],
      ['Quoted Expected', row.expected, sumK(o => o['Chart Series'] === 'Quoted Expected')],
      ['Agreements Sent', row.agreements, sumK(o => o['Feeds Agreements Sent'] === 'Yes')],
    ];
    return series.map(([name, plotted, fromOpps]) => ({
      Series: name,
      'Plotted ($K)': plotted ?? '',
      'These opp rows ($K)': fromOpps,
      'Difference ($K)': plotted == null ? '' : Math.round((fromOpps - plotted) * 10) / 10,
    }));
  }
  // How much of a rebuilt month sits on rows the rebuild can't vouch for.
  // Groups the attached rows by what has been edited since the month end and
  // totals the quoted $ on each group, so the gap the Totals check reports can
  // be sized against the rows that could explain it. Rows stamped as changed
  // are the prime suspects; "Not tracked" rows are unknowable either way.
  function quotedChangedSummary(opps) {
    const groups = new Map();
    for (const o of opps) {
      const label = o['Changed since month end'] || NOT_TRACKED;
      const g = groups.get(label) || { rows: 0, amount: 0 };
      g.rows += 1;
      g.amount += Number(o['Quoted Amount ($)']) || 0;
      groups.set(label, g);
    }
    // Changed rows first (they're the ones to look at), "No" last.
    const order = (label) => (label === 'No' ? 2 : label === NOT_TRACKED ? 1 : 0);
    return [...groups.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]) || b[1].amount - a[1].amount)
      .map(([label, g]) => ({
        'Changed since month end': label,
        'Opp rows': g.rows,
        'Quoted $K on those rows': Math.round(g.amount / 100) / 10,
        'What it means': label === 'No'
          ? 'Untouched since the month end: this row sat in the same bucket then.'
          : label === NOT_TRACKED
            ? 'Imported row with no edit history, so nothing says whether it moved. Treat as unknown.'
            : 'Edited since the month end, so the rebuild is reading a value this opp did not carry then. The old value is not recorded: only that it changed.',
      }));
  }
  // Where each series comes from, spelled out in the workbook — the chart
  // mixes a live compute with recorded snapshots, so "which rows made this
  // number" has a different answer per month. `row` narrows the note to the
  // pinned month when the export is for one.
  function quotedNotesRows(row, capture) {
    const live = row ? !!row._live : null;
    const captured = capture?.entry || null;
    const useCaptured = !!capture?.useCaptured;
    const oppSheet = row
      ? (live ? 'Opps (live pipeline)' : useCaptured ? 'Opps (captured at month end)' : 'Opps (rebuilt from today)')
      : 'Live Opps (source rows)';
    const notes = [
      { Series: 'Quoted Weak / OK / Expected', 'Where the number comes from': 'Sum of Quoted Amount on open (non-Sold/Not Sold/Closed/Lost) opps, split by the Chance? column. Divided by 1,000 for the $K axis.', 'Raw rows in this file': oppSheet },
      { Series: 'Agreements Sent', 'Where the number comes from': 'Sum of Quoted Amount on open opps whose Stage is "Agreement Sent": the same $ also sits in its Chance bucket.', 'Raw rows in this file': oppSheet },
      { Series: 'BFO Pipe Total', 'Where the number comes from': 'Sum of the Amount column across every row pasted into BFO Activity. Plotted on the right-hand axis.', 'Raw rows in this file': live === false ? (capture?.useCapturedBfo ? 'BFO Activity (captured at month end)' : 'Not available: BFO Activity was not captured for this month') : 'BFO Activity' },
    ];
    if (live === false && useCaptured) {
      notes.push({
        Series: 'How this month\'s opp rows were built',
        'Where the number comes from': `These are the actual opp rows captured with the month-end snapshot on ${String(captured.capturedAt || '').slice(0, 10)}: the pipeline as it stood, with the Chance? and Stage each opp carried at the time. The Totals check ties out to within rounding: the plotted figures are stored in whole $K.`,
        'Raw rows in this file': oppSheet,
      });
    }
    if (live === false && !useCaptured) {
      notes.push({
        Series: 'How this month\'s opp rows were built',
        'Where the number comes from': captured
          ? 'Opp rows WERE captured for this month, but the plotted figures have been edited since (via "Edit values") and no longer match them. The attached rows are rebuilt from today\'s Opps data instead (quoted by that month end, not yet closed), and carry today\'s Chance? and Stage. The Totals check sheet shows the gap.'
          : quotedTable[row.monthKey]?._rebuilt
            ? 'This month was never captured live, so both the plotted figures and these rows are reconstructions from the Opps data: the opps quoted by that month end that hadn\'t closed yet, carrying today\'s Chance? and Stage. They were reconstructed at different moments, so any Opps edit in between shows up on the Totals check sheet. Months captured live from now on carry their own rows and tie exactly.'
            : 'This month is a recorded month-end snapshot from before the opp rows were kept, so the rows behind it were never stored. The attached rows are rebuilt from today\'s Opps data (quoted by that month end, not yet closed), and carry today\'s Chance? and Stage. Opps edited, re-graded or deleted since won\'t tie back exactly; the Totals check sheet shows the gap. Months captured from now on carry their own rows and tie exactly.',
        'Raw rows in this file': 'Totals check',
      });
      notes.push({
        Series: 'Which rebuilt rows to trust',
        'Where the number comes from': 'Every attached row carries a "Changed since month end" column: whether its Chance?, Stage or Quoted Amount has been edited since, from the per-field edit stamps Opps 2 keeps. A stamped row is one the rebuild is reading today\'s value for, so it is a suspect for the gap on the Totals check. The stamps record when a field changed, not what it held before, so a flagged row can be identified but not corrected. "Changed since" totals the quoted $ per group.',
        'Raw rows in this file': 'Changed since',
      });
    }
    if (!row) {
      notes.push({ Series: 'Past months', 'Where the number comes from': 'Month-end snapshots: the figures captured at the time (auto-captured, seeded, typed via "Edit values", or rebuilt from the Opps data for a month that was never captured). Pin a month on the chart and use its ⬇ Excel button for the opp rows behind that month.', 'Raw rows in this file': 'Recorded Months (store)' });
    }
    return notes;
  }
  async function downloadQuoted() {
    const capturedMap = await loadAllQuotedMonthRows();
    const wb = XLSX.utils.book_new();
    appendSheet(wb, `Quoted Projections ${quotedYear}`, quotedData.map(quotedSummaryRow));
    appendSheet(wb, 'Recorded Months (store)', quotedStoredRows(capturedMap));
    appendSheet(wb, 'Live Opps (source rows)', contributingRecords.quotedSource);
    appendSheet(wb, 'Live BFO Activity', bfoActivityRows());
    appendSheet(wb, 'Notes', quotedNotesRows());
    XLSX.writeFile(wb, `yoy-quoted-projections-${quotedYear}-${todayStamp()}.xlsx`);
  }
  // Excel for a single pinned month: its plotted values and the opp rows
  // behind them — today's pipeline for the live month, the pipeline rebuilt
  // as it stood at month end for a past one — plus a totals check tying the
  // rows back to the plotted figures.
  async function exportQuotedMonth(row) {
    if (!row || !row.monthKey) return;
    // A past month prefers the opp rows captured with its snapshot; they only
    // stand in for the plotted figures while those figures still match what
    // was captured, so a hand-edit since falls back to the rebuild.
    const entry = row._live ? null : await loadQuotedMonthRows(row.monthKey);
    const useCaptured = !!entry && capturedValuesMatch(entry, row, QUOTED_ROW_FIELDS);
    const useCapturedBfo = !!entry && entry.bfoRows?.length > 0 && capturedValuesMatch(entry, row, ['bfoPipe']);
    const opps = useCaptured ? entry.rows : quotedMonthOpps(row.monthKey, row._live);
    const oppSheet = row._live ? 'Opps (live pipeline)'
      : useCaptured ? 'Opps (captured at month end)'
      : 'Opps (rebuilt from today)';
    const wb = XLSX.utils.book_new();
    appendSheet(wb, `${row.month} ${row.year}`, [quotedSummaryRow(row)]);
    appendSheet(wb, oppSheet, opps);
    appendSheet(wb, 'Totals check', quotedTotalsCheck(row, opps));
    // Only a rebuild needs the changed-since breakdown — captured rows carry
    // the values they had at the time, and the live month has no "since".
    if (!row._live && !useCaptured) appendSheet(wb, 'Changed since', quotedChangedSummary(opps));
    if (row._live) appendSheet(wb, 'BFO Activity', bfoActivityRows());
    else if (useCapturedBfo) appendSheet(wb, 'BFO Activity (captured)', entry.bfoRows);
    appendSheet(wb, 'Notes', quotedNotesRows(row, { entry, useCaptured, useCapturedBfo }));
    XLSX.writeFile(wb, `yoy-quoted-projections-${row.monthKey}-${todayStamp()}.xlsx`);
  }
  function downloadCloseRate() {
    const summary = closeRateData.map(r => ({
      'Open Year': r.year,
      'Total Not Sold (%)': r.totalNotSold,
      'Total Sold (OY) (%)': r.totalSold,
      'In Progress (OY) (%)': r.inProgress,
      'Quoted C/R (%)': r.quotedCR == null ? '' : r.quotedCR,
      'Total C/R (%)': r.totalCR == null ? '' : r.totalCR,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Close Rate by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.closeRate);
    XLSX.writeFile(wb, `yoy-close-rate-${todayStamp()}.xlsx`);
  }
  function downloadLeadSources() {
    const summary = leadSourcesData.map(r => ({
      'Lead Source': r.source,
      'In Progress': r.inProgress,
      'Not Sold': r.notSold,
      Sold: r.sold,
      Total: r.total,
      'Close Rate (%)': r.closeRate == null ? '' : Math.round(r.closeRate * 100),
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Lead Sources 2020+', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.leadSources);
    XLSX.writeFile(wb, `yoy-lead-sources-${todayStamp()}.xlsx`);
  }
  function downloadQuotedByYear() {
    const summary = quotedByYearData.map(r => ({
      'Quoted Year': r.year,
      'Quoted ($k)': r.thousands,
      Type: r.isProjected ? 'Projected (annualized YTD)' : 'Actual',
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Quoted by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.quotedByYear);
    XLSX.writeFile(wb, `yoy-quoted-by-year-${todayStamp()}.xlsx`);
  }
  function downloadNotSolds() {
    const summary = notSoldsData.map(r => ({
      'Open Year': r.year,
      'Not Solds': r.notSold,
      Type: r.isProjected ? 'Projected (annualized YTD)' : 'Actual',
      'Avg Opp Life (days)': r.avgOppLife == null ? '' : r.avgOppLife,
      'Age of not Quoted (days)': r.ageNotQuoted == null ? '' : r.ageNotQuoted,
      'Quote to Close (days)': r.quoteToClose == null ? '' : r.quoteToClose,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Not Solds by Year', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.notSolds);
    XLSX.writeFile(wb, `yoy-not-solds-${todayStamp()}.xlsx`);
  }
  function downloadTopAccounts() {
    const tops = topAccountsData.topAccounts || [];
    const summary = (topAccountsData.years || []).map(r => {
      const out = {
        Year: r.year,
        Type: r._isProjected ? 'Projected (YTD + active pipeline)' : 'Actual',
        Total: r._total,
      };
      for (const a of tops) out[a] = r[a] ?? 0;
      out.Remaining = r.Remaining ?? 0;
      return out;
    });
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Top Accounts', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.topAccounts);
    XLSX.writeFile(wb, `yoy-top-accounts-${todayStamp()}.xlsx`);
  }
  function downloadAnnualSales() {
    const annualTarget = target > 0 ? target : DEFAULT_ANNUAL_TARGET;
    const summary = annualSalesData.map(r => ({
      Year: r.year,
      Type: r._isProjected ? 'Projected (Sold + Agreement Sent + Contracting)' : 'Actual',
      'Current Client ($)': r.currentClient,
      'New Client ($)': r.newClient,
      'Total Sold ($)': r._total,
      'Annual Target ($)': annualTarget,
      '% Quota': r.pctQuota == null ? '' : r.pctQuota,
    }));
    // Contributing deals come straight from each actual bar's `_deals`
    // so the export matches the Close-Date bucketing shown in the chart.
    const contributing = annualSalesData
      .filter(r => !r._isProjected)
      .flatMap(r => r._deals);
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Annual Sales', summary);
    appendSheet(wb, 'Contributing Deals', contributing);
    XLSX.writeFile(wb, `yoy-annual-sales-${todayStamp()}.xlsx`);
  }
  // Export just the deals behind a single year's bar (triggered by
  // clicking that bar in the chart).
  function downloadAnnualSalesYear(row) {
    if (!row || !Array.isArray(row._deals) || row._deals.length === 0) return;
    const wb = XLSX.utils.book_new();
    appendSheet(wb, `Sold ${row.year}`, row._deals);
    const tag = String(row.year).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    XLSX.writeFile(wb, `yoy-annual-sales-${tag}-${todayStamp()}.xlsx`);
  }
  function downloadCommissions() {
    const summary = commissionsData.map(r => ({
      Year: r.year,
      'Total Commissions ($)': round0(r.total),
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Commissions by Year', summary);
    appendSheet(wb, 'Contributing Deals', contributingRecords.commissions);
    XLSX.writeFile(wb, `yoy-commissions-${todayStamp()}.xlsx`);
  }

  function downloadDealSize() {
    const summary = dealSizeData.map(r => ({
      Year: r.year,
      Type: r._isProjected ? 'Projected (YTD Sold + Agreement Sent)' : 'Actual',
      'Deals (Sold count)': r.deals,
      'Quoted (avg by Quoted Year, $)': r.quoted == null ? '' : r.quoted,
      'Deal Size (avg, $)': r.dealSize == null ? '' : r.dealSize,
    }));
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Deal Size', summary);
    appendSheet(wb, 'Contributing Opps', contributingRecords.dealSize);
    XLSX.writeFile(wb, `yoy-deal-size-${todayStamp()}.xlsx`);
  }

  // The single panel every chart's hover content portals into. It's
  // docked (sticky) at the top of the body so the explanation is always
  // visible while hovering any chart and never floats over the plot.
  // Held in state (via a callback ref) rather than a ref so the element
  // is provided through context and is safe to read during render.
  const [calcPanelEl, setCalcPanelEl] = useState(null);

  // Click-to-pin: hovering a point reports its content into hoverRef (set
  // by CalcTooltip); a click anywhere in the body then "sticks" that exact
  // content into a pinned panel that survives mouse-out until the user
  // clicks an empty area, clicks another point (re-pins), or hits the ✕.
  const hoverRef = useRef({ active: false, content: null });
  const [pinned, setPinned] = useState(null); // snapshot { payload, label, labelText, valueFormat, explain }
  // Charts report their hovered point here (the ref is owned by this
  // component, so the mutation stays local) for the click-to-pin handler.
  const reportHover = useCallback((content) => {
    hoverRef.current = content
      ? { active: true, content }
      : { active: false, content: hoverRef.current?.content || null };
  }, []);
  const calcCtx = useMemo(
    () => ({ el: calcPanelEl, pinned: !!pinned, reportHover }),
    [calcPanelEl, pinned, reportHover],
  );
  const handleBodyClick = useCallback(() => {
    const h = hoverRef.current;
    if (h?.active && h.content) setPinned(h.content); // stick / re-pin to hovered point
    else if (pinned) setPinned(null);                 // clicked empty area → unstick
  }, [pinned]);
  const stop = useCallback((e) => e.stopPropagation(), []);

  // Data the editor reads for the open chart: the computed (pre-override)
  // rows shown as placeholders, and the overridable field list. Top
  // Accounts' columns are dynamic, so it supplies its own field list.
  const editRegistry = {
    leads: { rows: leadsBase, fields: YOY_CHART_EDITS.leads.fields },
    closeRate: { rows: closeRateBase, fields: YOY_CHART_EDITS.closeRate.fields },
    leadSources: { rows: leadSourcesBase, fields: YOY_CHART_EDITS.leadSources.fields },
    quotedByYear: { rows: quotedByYearBase, fields: YOY_CHART_EDITS.quotedByYear.fields },
    notSolds: { rows: notSoldsBase, fields: YOY_CHART_EDITS.notSolds.fields },
    topAccounts: { rows: topAccountsBase.years, fields: topAccountsFields },
    annualSales: { rows: annualSalesBase, fields: YOY_CHART_EDITS.annualSales.fields },
    dealSize: { rows: dealSizeBase, fields: YOY_CHART_EDITS.dealSize.fields },
    commissions: { rows: commissionsBase, fields: YOY_CHART_EDITS.commissions.fields },
  };
  const editReg = editingChart ? editRegistry[editingChart] : null;
  const editCfg = editingChart ? YOY_CHART_EDITS[editingChart] : null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>YOY</h1>
          <div className={styles.subtitle}>
            Year-over-year summary, computed off the Opps tab cache. Hover a chart’s bars or points to see how that number is calculated: details appear in a panel on the right. Click a point to pin that panel; click an empty spot or the ✕ to unpin.
            {opps?.fetchedAt ? ` Opps fetched ${new Date(opps.fetchedAt).toLocaleString()}.` : ' Open the Opps tab to load data.'}
          </div>
        </div>
        <div className={styles.headerRight}>
          <address className={styles.nomadworks}>
            <span className={styles.nomadworksName}>Nomadworks</span>
            1216 Broadway (Entrance on W 30th St)<br />
            New York, NY 10001: 3rd floor
          </address>
          {hiddenCharts.length > 0 && (
            <div className={styles.hiddenBar}>
              <span className={styles.hiddenBarLabel}>Hidden charts:</span>
              {hiddenCharts.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={styles.hiddenChip}
                  onClick={() => showChart(id)}
                  title={`Show the ${YOY_CHART_TITLES[id] || id} chart`}
                >{YOY_CHART_TITLES[id] || id} <span aria-hidden="true">＋</span></button>
              ))}
              <button type="button" className={styles.showAllBtn} onClick={showAllCharts}>Show all</button>
            </div>
          )}
        </div>
      </div>
      <div className={styles.body} onClick={handleBodyClick}>
        <CalcPanelContext.Provider value={calcCtx}>
        <EditChartContext.Provider value={setEditingChart}>
        <HideChartContext.Provider value={hideChart}>
        <div
          ref={setCalcPanelEl}
          className={styles.calcPanel}
          onClick={stop}
        />
        {pinned ? (
          <div className={styles.calcPanel} onClick={stop}>
            <CalcContent {...pinned} pinned onUnpin={() => setPinned(null)} />
          </div>
        ) : null}
        {/* Charts flow three per row in a single ordered list. Hidden
            charts drop out and the visible ones repack left-to-right so no
            gaps are left behind; only the final row is padded with spacers
            to keep every card at its one-third column width. */}
        {(() => {
          const charts = [
            { id: 'leads', node: <LeadsCard key="leads" data={leadsData} hasOpps={hasOpps} onDownload={downloadLeads} onExportPoint={(row) => exportPinnedOpps('leads', row)} /> },
            { id: 'quotedProjections', node: <QuotedProjectionsCard key="quotedProjections" data={quotedData} quotedTable={quotedTable} live={liveCurrentMonth} onSaveTable={updateQuotedTable} onDownload={downloadQuoted} onExportPoint={exportQuotedMonth} /> },
            { id: 'closeRate', node: <CloseRateCard key="closeRate" data={closeRateData} hasOpps={hasOpps} onDownload={downloadCloseRate} onExportPoint={(row) => exportPinnedOpps('closeRate', row)} /> },
            { id: 'leadSources', node: <LeadSourcesCard key="leadSources" data={leadSourcesData} hasOpps={hasOpps} onDownload={downloadLeadSources} onExportPoint={(row) => exportPinnedOpps('leadSources', row)} /> },
            { id: 'quotedByYear', node: <QuotedByYearCard key="quotedByYear" data={quotedByYearData} hasOpps={hasOpps} onDownload={downloadQuotedByYear} onExportPoint={(row) => exportPinnedOpps('quotedByYear', row)} /> },
            { id: 'notSolds', node: <NotSoldsCard key="notSolds" data={notSoldsData} hasOpps={hasOpps} onDownload={downloadNotSolds} onExportPoint={(row) => exportPinnedOpps('notSolds', row)} /> },
            { id: 'topAccounts', node: <TopAccountsCard key="topAccounts" data={topAccountsData} hasOpps={hasOpps} onDownload={downloadTopAccounts} onExportPoint={(row) => exportPinnedOpps('topAccounts', row)} /> },
            { id: 'annualSales', node: <AnnualSalesCard key="annualSales" data={annualSalesData} hasOpps={hasOpps} target={target} onDownload={downloadAnnualSales} onExportYear={downloadAnnualSalesYear} /> },
            { id: 'dealSize', node: <DealSizeCard key="dealSize" data={dealSizeData} hasOpps={hasOpps} onDownload={downloadDealSize} onExportPoint={(row) => exportPinnedOpps('dealSize', row)} /> },
            { id: 'commissions', node: <CommissionsCard key="commissions" data={commissionsData} hasCommissions={hasCommissions} onDownload={downloadCommissions} onExportPoint={(row) => exportPinnedOpps('commissions', row)} /> },
          ];
          const visible = charts.filter((c) => !hiddenSet.has(c.id));
          const rows = [];
          for (let i = 0; i < visible.length; i += 3) rows.push(visible.slice(i, i + 3));
          return rows.map((row, ri) => {
            const slots = [...row];
            while (slots.length < 3) slots.push(null);
            return (
              <div className={styles.row} key={ri}>
                {slots.map((c, ci) => c
                  ? c.node
                  : <div key={`spacer-${ri}-${ci}`} style={{ flex: '1 1 0' }} aria-hidden="true" />)}
              </div>
            );
          });
        })()}
        </HideChartContext.Provider>
        </EditChartContext.Provider>
        </CalcPanelContext.Provider>
      </div>
      {editReg && editCfg && (
        <ChartDataEditor
          chartId={editingChart}
          cfg={editCfg}
          rows={editReg.rows}
          fields={editReg.fields}
          table={overrides[editingChart]}
          onClose={() => setEditingChart(null)}
          onSave={saveChartOverrides}
        />
      )}
    </div>
  );
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function round0(n) {
  return n == null || !Number.isFinite(n) ? 0 : Math.round(n);
}

// Build a worksheet from an array of plain-object rows and append it to
// the workbook. Auto-sizes columns based on header + the first 50 rows.
function appendSheet(wb, name, rows) {
  const ws = rows.length > 0
    ? XLSX.utils.json_to_sheet(rows)
    : XLSX.utils.aoa_to_sheet([['No rows']]);
  if (rows.length > 0) {
    const keys = Object.keys(rows[0]);
    ws['!cols'] = keys.map(key => ({
      wch: Math.min(60, Math.max(
        key.length,
        ...rows.slice(0, 50).map(r => String(r[key] ?? '').length),
      ) + 2),
    }));
  }
  // Excel sheet names cap at 31 chars and can't contain []:?*/\
  const safe = String(name).replace(/[[\]:?*/\\]/g, ' ').slice(0, 31) || 'Sheet';
  XLSX.utils.book_append_sheet(wb, ws, safe);
}

// Makes a chart's <Legend> interactive: clicking a series label toggles
// it on/off. Spread `legendProps` onto <Legend> and set `hide={hidden[key]}`
// on each series (key = its dataKey). Hidden labels render struck-through
// and greyed so it's clear what's currently filtered out. Pass
// `initialHidden` (keyed by dataKey) to start a series toggled off.
function useInteractiveLegend(initialHidden) {
  const [hidden, setHidden] = useState(initialHidden ?? {});
  const legendProps = {
    wrapperStyle: { fontSize: 12, cursor: 'pointer' },
    onClick: (o) => {
      const key = o?.dataKey ?? o?.value;
      if (key == null) return;
      setHidden(h => ({ ...h, [key]: !h[key] }));
    },
    formatter: (value, entry) => {
      const key = entry?.dataKey ?? value;
      const off = hidden[key];
      return (
        <span style={{ color: off ? '#9ca3af' : '#374151', textDecoration: off ? 'line-through' : 'none' }}>
          {value}
        </span>
      );
    },
  };
  return { hidden, legendProps };
}

function ChartHeader({ title, onDownload, canDownload, chartId, hideId }) {
  const openEditor = useContext(EditChartContext);
  const hideChart = useContext(HideChartContext);
  const hideKey = hideId || chartId;
  return (
    <div className={styles.chartHeader}>
      <h2 className={styles.chartTitle}>{title}</h2>
      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
        {chartId && openEditor && (
          <button
            type="button"
            className={styles.downloadBtn}
            onClick={() => openEditor(chartId)}
            title={`View and overwrite the ${title} data points`}
          >✎ Edit data</button>
        )}
        <button
          type="button"
          className={styles.downloadBtn}
          onClick={onDownload}
          disabled={!canDownload}
          title={canDownload
            ? `Download ${title} data as Excel (.xlsx)`
            : 'No data to download'}
        >Download .xlsx</button>
        {hideKey && hideChart && (
          <button
            type="button"
            className={styles.hideBtn}
            onClick={() => hideChart(hideKey)}
            title={`Hide the ${title} chart`}
            aria-label={`Hide the ${title} chart`}
          >✕</button>
        )}
      </div>
    </div>
  );
}

// Generic "Edit data" popup for a YOY chart. Each row's computed value is
// shown as the input placeholder; typing a replacement stores it as an
// override that wins over the live number until cleared. A blank cell
// keeps the computed value, and a value equal to the computed one is not
// stored (so an override always represents a real change). "Clear
// overrides" drops every saved value for the chart at once.
function ChartDataEditor({ chartId, cfg, rows, fields, table, onClose, onSave }) {
  const keyField = cfg.keyField;
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const r of rows) {
      const key = String(r[keyField]);
      const saved = table?.[key] || {};
      const cells = {};
      for (const f of fields) {
        const sv = saved[f.key];
        // ratioPct is stored as a 0–1 ratio but edited as a whole percent.
        cells[f.key] = sv != null
          ? (f.kind === 'ratioPct' ? String(+(sv * 100).toFixed(2)) : String(sv))
          : '';
      }
      d[key] = cells;
    }
    return d;
  });
  const setCell = (key, field, value) =>
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));

  const handleSave = () => {
    const next = {};
    for (const r of rows) {
      const key = String(r[keyField]);
      const cells = draft[key] || {};
      const out = {};
      for (const f of fields) {
        const raw = String(cells[f.key] ?? '').trim().replace(/[$,%\s]/g, '');
        if (raw === '') continue;
        const typed = Number(raw);
        if (!Number.isFinite(typed)) continue;
        // ratioPct cells are typed as a whole percent but stored as a ratio.
        const value = f.kind === 'ratioPct' ? typed / 100 : typed;
        const base = r[f.key];
        if (base != null && Number(base) === value) continue; // no real change
        out[f.key] = value;
      }
      if (Object.keys(out).length) next[key] = out;
    }
    onSave(chartId, next);
  };

  return createPortal(
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalTitle}>{cfg.title}: edit data</div>
            <div className={styles.modalSub}>
              Type a value to overwrite that data point; it wins over the live-computed
              number until you clear it. Leave a cell blank to keep the computed value
              (shown greyed as the placeholder).
            </div>
          </div>
          <button type="button" className={styles.downloadBtn} onClick={onClose}>Close</button>
        </div>
        <div className={styles.modalBody}>
          <table className={styles.editTable}>
            <thead>
              <tr>
                <th>{cfg.keyLabel}</th>
                {fields.map(f => <th key={f.key}>{f.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const key = String(r[keyField]);
                return (
                  <tr key={key}>
                    <td className={styles.editMonthCell}>{key}</td>
                    {fields.map(f => (
                      <td key={f.key}>
                        <input
                          type="text"
                          inputMode="decimal"
                          className={styles.editInput}
                          value={draft[key]?.[f.key] ?? ''}
                          onChange={(e) => setCell(key, f.key, e.target.value)}
                          placeholder={fmtOverrideValue(r[f.key], f.kind) || '-'}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={styles.modalFoot}>
          <button type="button" className={styles.downloadBtn} onClick={() => onSave(chartId, {})}>Clear overrides</button>
          <button type="button" className={styles.downloadBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.saveBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Shared hover tooltip for every YOY chart. Recharts clones this element
// with `active` / `payload` / `label` injected at hover time. Beyond the
// usual per-series values it makes two things explicit:
//   1. None of the YOY numbers are static — they're recomputed live from
//      the Opps cache — so a "∑ calculated" badge sits in the header.
//   2. The formula and the specific inputs that produced *this* point, so
//      a number can be sanity-checked without opening the .xlsx export.
// `valueFormat(value, name, row)` formats each series line; `explain(row)`
// returns { formula, inputs: [{label, value}], note } for the lower block.
// Inner content shared by the docked panel (normal case) and the
// floating fallback. Laid out as a horizontal strip — heading + badge,
// then the per-series values, then the formula and its inputs — so it
// reads left-to-right in the wide docked panel without growing tall.
function CalcContent({ payload, label, labelText, valueFormat, explain, pinned, onUnpin }) {
  const row = payload[0]?.payload || {};
  const info = explain ? explain(row, payload, label) : null;
  const heading = labelText ? labelText(label, row) : label;
  return (
    <div className={styles.calcDock}>
      <div className={styles.calcDockLabel}>
        <span className={styles.calcDockHeading}>{heading}</span>
        {pinned && typeof info?.exportOpps === 'function' ? (
          <button
            type="button"
            className={styles.calcExportBtn}
            onClick={info.exportOpps}
            title="Download the opportunity rows behind this point to Excel"
          >⬇ Excel</button>
        ) : null}
        {pinned ? (
          <button type="button" className={styles.calcPinBtn} onClick={onUnpin} title="Unstick this panel">📌 Pinned ✕</button>
        ) : (
          <span className={styles.calcTipBadge} title="Recomputed live from the Opps cache: not a stored value">∑ calculated</span>
        )}
      </div>
      <div className={styles.calcDockSeries}>
        {payload.map((p, i) => (
          <span key={i} className={styles.calcDockSeriesItem}>
            <span className={styles.calcTipSwatch} style={{ background: p.color || p.stroke || p.fill || '#94a3b8' }} />
            <span className={styles.calcDockName}>{p.name}</span>
            <span className={styles.calcDockVal}>
              {valueFormat ? valueFormat(p.value, p.name, row) : (p.value == null ? '-' : p.value)}
            </span>
          </span>
        ))}
      </div>
      {info && (info.formula || (info.inputs && info.inputs.length) || info.note) ? (
        <div className={styles.calcDockExplain}>
          {info.formula ? <div className={styles.calcDockFormula}>{info.formula}</div> : null}
          {Array.isArray(info.inputs) && info.inputs.length > 0 ? (
            <div className={styles.calcDockInputs}>
              {info.inputs.map((it, i) => (
                <span key={i} className={styles.calcDockInput}>
                  <span className={styles.calcDockInputLabel}>{it.label}</span>
                  <span className={styles.calcDockInputVal}>{it.value}</span>
                </span>
              ))}
            </div>
          ) : null}
          {info.note ? <span className={styles.calcDockNote}>{info.note}</span> : null}
        </div>
      ) : null}
      {Array.isArray(info?.deals) && info.deals.length > 0 ? (
        <div className={styles.calcDockDeals}>
          <div className={styles.calcDockDealsHead}>
            {info.deals.length} deal{info.deals.length === 1 ? '' : 's'}
            {typeof info.exportDeals === 'function' ? (
              <button type="button" className={styles.calcExportBtn} onClick={info.exportDeals} title="Download these deals to Excel">⬇ Excel</button>
            ) : null}
          </div>
          <div className={styles.calcDockDealsList}>
            {info.deals.map((d, i) => (
              <span key={i} className={styles.calcDockDeal}>
                <span className={styles.calcDockDealAcct}>{d.Account || '-'}</span>
                <span className={styles.calcDockDealVal}>{fmtMoneyLabel(d['Quoted Amount']) || '$0'}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Shared hover tooltip for every YOY chart. Recharts clones this element
// with `active` / `payload` / `label` injected at hover time and would
// normally float it over the plot — which covers the very point being
// reviewed. Instead we portal the content into the docked panel at the
// top of the YOY body so the chart and its data stay fully visible. If
// no panel is mounted (defensive), it falls back to a small floating box.
function CalcTooltip({
  active, payload, label,
  labelText, valueFormat, explain, onExportPoint,
}) {
  const ctx = useContext(CalcPanelContext);
  const isActive = !!(active && payload && payload.length > 0);
  // When the chart can export the opps behind a point, fold an `exportOpps`
  // callback into whatever the chart's explain() returns, so the pinned
  // panel can offer a per-point Excel download. Wrapped here (rather than in
  // every card's explain) and captured in the pinned snapshot below.
  const wrappedExplain = (onExportPoint && explain)
    ? (row, ...rest) => ({ ...(explain(row, ...rest) || {}), exportOpps: () => onExportPoint(row) })
    : (onExportPoint
        ? (row) => ({ exportOpps: () => onExportPoint(row) })
        : explain);
  // Report the currently-hovered point up to the page so a click anywhere
  // in the YOY body can pin (stick) this exact content. Runs in an effect
  // so we never setState/refs mid-render. Snapshot the payload (Recharts
  // mutates its array between events) so the pinned copy stays stable.
  const reportHover = ctx?.reportHover;
  useEffect(() => {
    if (!reportHover) return;
    reportHover(isActive ? { payload: payload.slice(), label, labelText, valueFormat, explain: wrappedExplain } : null);
  });
  if (!isActive) return null;
  // While a panel is pinned, the hover panel steps aside so it doesn't
  // fight the pinned one for the docked slot.
  if (ctx?.pinned) return null;
  const body = (
    <CalcContent
      payload={payload}
      label={label}
      labelText={labelText}
      valueFormat={valueFormat}
      explain={wrappedExplain}
    />
  );
  if (ctx?.el) return createPortal(body, ctx.el);
  return <div className={styles.calcTip}>{body}</div>;
}

function LeadsCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Leads" chartId="leads" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data: open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row.isProjected ? 'Projected (annualized YTD)' : `Open Year ${label}`}
                valueFormat={(v) => (v == null ? '-' : v.toLocaleString('en-US'))}
                explain={(row) => row.isProjected
                  ? {
                      formula: 'Annualized: YTD lead count ÷ fraction of the year elapsed.',
                      inputs: [
                        { label: 'YTD leads', value: (row._ytd ?? 0).toLocaleString('en-US') },
                        { label: 'Year elapsed', value: `${Math.round((row._frac ?? 0) * 100)}%` },
                        { label: 'Projected', value: (row.count ?? 0).toLocaleString('en-US') },
                      ],
                    }
                  : {
                      formula: 'Count of Opps rows whose Open Year equals this year.',
                      inputs: [{ label: 'Leads counted', value: (row.count ?? 0).toLocaleString('en-US') }],
                    }}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="count" name="Leads" fill="#3b82f6" isAnimationActive={false} hide={hidden.count}>
              {data.map((row, i) => (
                <Cell key={i} fill={row.isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function QuotedProjectionsCard({ data, quotedTable, live, onSaveTable, onDownload, onExportPoint }) {
  const [editing, setEditing] = useState(false);
  const hasAnyValues = data.some(r => r._hasData);
  // The in-progress month plots live figures unless it's been pinned to
  // saved values — say so, otherwise a frozen point looks like a bug.
  const liveRow = data.find(r => r.monthKey === currentMonthKey());
  const pinned = !!live && !!liveRow && !liveRow._live && liveRow._hasData;
  // BFO Pipe Total starts hidden — it rides its own right-hand axis and
  // overwhelms the quoted buckets, so surface it only on demand via the legend.
  const { hidden, legendProps } = useInteractiveLegend({ bfoPipe: true });
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Quoted Projections" hideId="quotedProjections" onDownload={onDownload} canDownload={hasAnyValues} />
      <div className={styles.quotedEditRow}>
        {pinned && (
          <span className={styles.quotedPinNote} title="This month is showing saved values instead of the live Opps + BFO figures. Tick “Auto (live)” in Edit values to resume auto-updating.">
            {liveRow.month} pinned: not auto-updating
          </span>
        )}
        <span className={styles.quotedUnitNote}>values in $K</span>
        <button type="button" className={styles.editValuesBtn} onClick={() => setEditing(true)}>Edit values</button>
      </div>
      {!hasAnyValues ? (
        <div className={styles.empty}>No values yet: click “Edit values” to record each month’s figures.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="dollars"
              tick={{ fontSize: 12 }}
              tickFormatter={fmtKLabel}
            />
            <YAxis
              yAxisId="pipe"
              orientation="right"
              tick={{ fontSize: 12 }}
              tickFormatter={fmtKLabel}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => `${label} ${row.year}`}
                valueFormat={(v) => (v == null ? '-' : fmtKLabel(v))}
                explain={(row) => ({
                  formula: 'Recorded month-end values (in $K). Quoted Weak/OK/Expected are the quoted-$ Chance buckets, Agreements Sent is contracts out, and BFO Pipe Total is the total pipeline $ (its own right-hand axis). Edit via “Edit values”.',
                  inputs: [
                    { label: 'Quoted Weak', value: row.weak == null ? '-' : fmtKLabel(row.weak) },
                    { label: 'Quoted OK', value: row.ok == null ? '-' : fmtKLabel(row.ok) },
                    { label: 'Quoted Expected', value: row.expected == null ? '-' : fmtKLabel(row.expected) },
                    { label: 'Agreements Sent', value: row.agreements == null ? '-' : fmtKLabel(row.agreements) },
                    { label: 'BFO Pipe Total', value: row.bfoPipe == null ? '-' : fmtKLabel(row.bfoPipe) },
                  ],
                  note: row._live
                    ? 'Live: computed now from Opps (quoted $ by Chance / Agreements Sent) + BFO Activity (Pipe Total). Pin this point and hit ⬇ Excel for the opp-level rows behind it. Use “Edit values” to record a fixed month-end snapshot.'
                    : (row._hasData
                        ? 'Recorded month-end snapshot: pin this point and hit ⬇ Excel for the opp rows rebuilt as the pipeline stood at that month end.'
                        : 'No values recorded for this month yet.'),
                })}
              />
            } />
            <Legend {...legendProps} />
            <Line yAxisId="dollars" dataKey="weak" name="Quoted Weak" stroke="#22c55e" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.weak}>
              <LabelList dataKey="weak" position="top" style={{ fontSize: 10, fill: '#15803d' }} formatter={fmtKLabel} />
            </Line>
            <Line yAxisId="dollars" dataKey="ok" name="Quoted OK" stroke="#eab308" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.ok}>
              <LabelList dataKey="ok" position="top" style={{ fontSize: 10, fill: '#a16207' }} formatter={fmtKLabel} />
            </Line>
            <Line yAxisId="dollars" dataKey="expected" name="Quoted Expected" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.expected}>
              <LabelList dataKey="expected" position="top" style={{ fontSize: 10, fill: '#1d4ed8' }} formatter={fmtKLabel} />
            </Line>
            <Line yAxisId="dollars" dataKey="agreements" name="Agreements Sent" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.agreements}>
              <LabelList dataKey="agreements" position="bottom" style={{ fontSize: 10, fill: '#b91c1c' }} formatter={fmtKLabel} />
            </Line>
            <Line
              yAxisId="pipe"
              dataKey="bfoPipe"
              name="BFO Pipe Total"
              stroke="#111827"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.bfoPipe}
            >
              <LabelList dataKey="bfoPipe" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#111827' }} formatter={fmtKLabel} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
      {editing && (
        <QuotedProjectionsEditor
          rows={data}
          table={quotedTable}
          live={live}
          onClose={() => setEditing(false)}
          onSave={(next) => { onSaveTable(next); setEditing(false); }}
        />
      )}
    </div>
  );
}

// Editable month-by-month table behind the Quoted Projections "Edit
// values" button. Lets the user record each month's figures (in $K);
// blank cells are omitted. Seeded values come from the store.
function QuotedProjectionsEditor({ rows, table, live, onClose, onSave }) {
  const liveKey = currentMonthKey();
  // The in-progress month's live figures as editor cells (whole $K). Read
  // from the live computation rather than the row so the values are there
  // even while the month is pinned and the chart is plotting typed ones.
  const liveCells = useMemo(() => {
    if (!live) return null;
    const cells = {};
    let any = false;
    for (const f of QUOTED_FIELDS) {
      const v = live[f];
      const ok = v != null && Number.isFinite(v);
      cells[f] = ok ? String(Math.round(v)) : '';
      if (ok) any = true;
    }
    return any ? cells : null;
  }, [live]);
  // The in-progress month tracks the live Opps + BFO figures until it's
  // deliberately pinned. Saving used to write every row as a fixed value,
  // so editing any older month silently froze the current one — hence the
  // explicit toggle, which also un-pins a month frozen that way.
  const [autoLive, setAutoLive] = useState(() => {
    if (!liveCells) return false;
    const stored = table[liveKey];
    return !stored || !!stored._auto;
  });
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const r of rows) {
      const saved = table[r.monthKey];
      // Pre-fill the live current month from its computed values so the
      // cells start on what the chart already shows.
      const rowLive = r._live ? { weak: r.weak, ok: r.ok, expected: r.expected, agreements: r.agreements, bfoPipe: r.bfoPipe } : null;
      const useLive = r._live && !!rowLive;
      const v = (useLive ? rowLive : saved) || saved || rowLive || {};
      const cells = {};
      for (const f of QUOTED_FIELDS) {
        const raw = v[f];
        cells[f] = (raw == null || raw === '') ? '' : String(useLive ? Math.round(raw) : raw);
      }
      d[r.monthKey] = cells;
    }
    return d;
  });
  const setCell = (key, field, value) =>
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  // While "Auto (live)" is on, the current month's row shows the live
  // figures read-only — they're what will be saved for it.
  const isAutoRow = (key) => key === liveKey && autoLive && !!liveCells;
  const cellValue = (key, field) =>
    (isAutoRow(key) ? liveCells[field] : (draft[key]?.[field] ?? ''));
  const handleSave = () => {
    const next = { ...table };
    for (const r of rows) {
      const cells = isAutoRow(r.monthKey) ? liveCells : (draft[r.monthKey] || {});
      const out = {};
      let any = false;
      for (const f of QUOTED_FIELDS) {
        const raw = String(cells[f] ?? '').trim().replace(/[$,]/g, '');
        if (raw === '') continue;
        const n = Number(raw);
        if (Number.isFinite(n)) { out[f] = n; any = true; }
      }
      // `_auto` keeps the month live — recomputed for display and
      // overwritten by the auto-capture effect until it rolls over.
      if (any) next[r.monthKey] = isAutoRow(r.monthKey) ? { ...out, _auto: true } : out;
      else delete next[r.monthKey];
    }
    onSave(next);
  };
  const labels = [
    ['weak', 'Quoted Weak'], ['ok', 'Quoted OK'], ['expected', 'Quoted Expected'],
    ['agreements', 'Agreements Sent'], ['bfoPipe', 'BFO Pipe Total'],
  ];
  return createPortal(
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <div>
            <div className={styles.modalTitle}>Quoted Projections: monthly values</div>
            <div className={styles.modalSub}>All figures in thousands of dollars ($K). Leave a cell blank to omit it. Saved per month for the Dec→Nov fiscal year. The in-progress month stays on “Auto (live)” unless you pin it.</div>
          </div>
          <button type="button" className={styles.downloadBtn} onClick={onClose}>Close</button>
        </div>
        <div className={styles.modalBody}>
          <table className={styles.editTable}>
            <thead>
              <tr>
                <th>Month</th>
                {labels.map(([f, lbl]) => <th key={f}>{lbl}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.monthKey}>
                  <td className={styles.editMonthCell}>
                    <div>{r.month} {r.year}</div>
                    {r.monthKey === liveKey && liveCells && (
                      <label className={styles.editAutoToggle}>
                        <input
                          type="checkbox"
                          checked={autoLive}
                          onChange={(e) => setAutoLive(e.target.checked)}
                        />
                        Auto (live)
                      </label>
                    )}
                  </td>
                  {labels.map(([f]) => (
                    <td key={f}>
                      <input
                        type="number"
                        className={styles.editInput}
                        value={cellValue(r.monthKey, f)}
                        onChange={(e) => setCell(r.monthKey, f, e.target.value)}
                        disabled={isAutoRow(r.monthKey)}
                        title={isAutoRow(r.monthKey) ? 'Auto-updating from Opps + BFO Activity: untick “Auto (live)” to pin a value' : undefined}
                        placeholder="-"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.modalFoot}>
          <button type="button" className={styles.downloadBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.saveBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CloseRateCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Close Rate" chartId="closeRate" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data: open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="pct"
              tick={{ fontSize: 12 }}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <YAxis
              yAxisId="cr"
              orientation="right"
              tick={{ fontSize: 12 }}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label) => `Open Year ${label}`}
                valueFormat={(v) => (v == null ? '-' : `${v.toFixed(0)}%`)}
                explain={(row) => ({
                  formula: 'Bars = each stage as a % of all opps that year. Total C/R = Sold ÷ (Sold + Not Sold). Quoted C/R = Sold ÷ (Sold + Not Sold that reached Quoted+).',
                  inputs: [
                    { label: 'Sold', value: (row._sold ?? 0).toLocaleString('en-US') },
                    { label: 'Not Sold', value: (row._notSold ?? 0).toLocaleString('en-US') },
                    { label: 'In Progress', value: (row._inProgress ?? 0).toLocaleString('en-US') },
                    { label: 'Not Sold (Quoted+)', value: (row._quotedNotSold ?? 0).toLocaleString('en-US') },
                    { label: 'Total opps', value: (row._total ?? 0).toLocaleString('en-US') },
                  ],
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar yAxisId="pct" dataKey="totalNotSold" stackId="cr" name="Total Not Sold" fill="#ef4444" isAnimationActive={false} hide={hidden.totalNotSold} />
            <Bar yAxisId="pct" dataKey="totalSold" stackId="cr" name="Total Sold (OY)" fill="#facc15" isAnimationActive={false} hide={hidden.totalSold} />
            <Bar yAxisId="pct" dataKey="inProgress" stackId="cr" name="In Progress (OY)" fill="#3b82f6" isAnimationActive={false} hide={hidden.inProgress} />
            <Line yAxisId="cr" dataKey="quotedCR" name="Quoted C/R" stroke="#374151" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.quotedCR}>
              <LabelList dataKey="quotedCR" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#1f2937' }} formatter={(v) => v == null ? '' : `${Math.round(v)}%`} />
            </Line>
            <Line yAxisId="cr" dataKey="totalCR" name="Total C/R" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} connectNulls hide={hidden.totalCR}>
              <LabelList dataKey="totalCR" position="bottom" style={{ fontSize: 10, fontWeight: 600, fill: '#15803d' }} formatter={(v) => v == null ? '' : `${Math.round(v)}%`} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function LeadSourcesCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  // Per-row height keeps the chart legible even when source values
  // accumulate (e.g. opps tagged with novel sources over time). Pad
  // the wrapper height so the LabelList sold count + close-rate label
  // never collides with the rightmost gridline.
  const rowHeight = 28;
  const minHeight = 320;
  const height = Math.max(minHeight, data.length * rowHeight + 80);
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Lead Sources 2020+" chartId="leadSources" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data: open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with a Lead Source and Open Year ≥ 2020.</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 70, left: 4, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="source"
              tick={{ fontSize: 11 }}
              width={155}
              interval={0}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label) => `Lead Source: ${label}`}
                valueFormat={(v) => (v == null ? '-' : v.toLocaleString('en-US'))}
                explain={(row) => ({
                  formula: 'Opps with this Lead Source (Open Year ≥ 2020), counted by stage. Row-end green % = Close Rate = Sold ÷ (Sold + Not Sold).',
                  inputs: [
                    { label: 'In Progress', value: (row.inProgress ?? 0).toLocaleString('en-US') },
                    { label: 'Not Sold', value: (row.notSold ?? 0).toLocaleString('en-US') },
                    { label: 'Sold', value: (row.sold ?? 0).toLocaleString('en-US') },
                    { label: 'Total', value: (row.total ?? 0).toLocaleString('en-US') },
                    { label: 'Close Rate', value: row.closeRate == null ? '-' : `${Math.round(row.closeRate * 100)}%` },
                  ],
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="inProgress" stackId="ls" name="In Progress" fill="#3b82f6" isAnimationActive={false} hide={hidden.inProgress} />
            <Bar dataKey="notSold" stackId="ls" name="Not Sold" fill="#ef4444" isAnimationActive={false} hide={hidden.notSold} />
            <Bar dataKey="sold" stackId="ls" name="Sold" fill="#facc15" isAnimationActive={false} hide={hidden.sold}>
              <LabelList
                dataKey="sold"
                position="right"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(value) => value || ''}
              />
              <LabelList
                dataKey="closeRate"
                position="right"
                offset={28}
                style={{ fontSize: 11, fontWeight: 600, fill: '#16a34a' }}
                formatter={(v) => v == null ? '' : `${Math.round(v * 100)}%`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function QuotedByYearCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Quoted (Thousands)" chartId="quotedByYear" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data: open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => `$${v.toLocaleString('en-US')}`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row.isProjected ? 'Projected (annualized YTD)' : `Quoted ${label}`}
                valueFormat={(v) => (v == null ? '-' : `$${v.toLocaleString('en-US')}k`)}
                explain={(row) => row.isProjected
                  ? {
                      formula: 'Annualized: YTD quoted $ (by Quoted On date) ÷ fraction of the year elapsed, shown in $k.',
                      inputs: [
                        { label: 'YTD quoted', value: `$${(row._ytdThousands ?? 0).toLocaleString('en-US')}k` },
                        { label: 'Year elapsed', value: `${Math.round((row._frac ?? 0) * 100)}%` },
                        { label: 'Projected', value: `$${(row.thousands ?? 0).toLocaleString('en-US')}k` },
                      ],
                    }
                  : {
                      formula: 'Sum of Quoted Amount for every opp whose Quoted On date falls in this year (any stage), shown in $k.',
                      inputs: [{ label: 'Quoted total', value: `$${(row.thousands ?? 0).toLocaleString('en-US')}k` }],
                    }}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="thousands" name="Quoted ($k)" fill="#3b82f6" isAnimationActive={false} hide={hidden.thousands}>
              {data.map((row, i) => (
                <Cell key={i} fill={row.isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              <LabelList
                dataKey="thousands"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => `$${v.toLocaleString('en-US')}`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function NotSoldsCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Not Solds" chartId="notSolds" onDownload={onDownload} canDownload={hasOpps && data.length > 0} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data: open the Opps tab to load.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No opps with an Open Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row.isProjected ? 'Projected (annualized YTD)' : `Open Year ${label}`}
                valueFormat={(v, name) => {
                  if (v == null) return '-';
                  if (name === 'Not Solds') return v.toLocaleString('en-US');
                  return `${v.toLocaleString('en-US')} days`;
                }}
                explain={(row) => row.isProjected
                  ? {
                      formula: 'Not Sold bar annualized: YTD Not Sold ÷ fraction of year elapsed. The day-count lines are actuals only: not projected.',
                      inputs: [
                        { label: 'YTD Not Sold', value: (row._ytdNotSold ?? 0).toLocaleString('en-US') },
                        { label: 'Year elapsed', value: `${Math.round((row._frac ?? 0) * 100)}%` },
                        { label: 'Projected', value: (row.notSold ?? 0).toLocaleString('en-US') },
                      ],
                    }
                  : {
                      formula: 'Bar = count of Not Sold opps. Lines = mean days: Avg Opp Life (closed opps), Age of not Quoted (pre-quote opps), Quote to Close (Close Date − Quoted On).',
                      inputs: [
                        { label: 'Not Solds', value: (row.notSold ?? 0).toLocaleString('en-US') },
                        { label: 'Avg Opp Life', value: row.avgOppLife == null ? '-' : `${row.avgOppLife} d (n=${row._lifeCount ?? 0})` },
                        { label: 'Age of not Quoted', value: row.ageNotQuoted == null ? '-' : `${row.ageNotQuoted} d (n=${row._notQuotedCount ?? 0})` },
                        { label: 'Quote to Close', value: row.quoteToClose == null ? '-' : `${row.quoteToClose} d (n=${row._qtcCount ?? 0})` },
                      ],
                    }}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="notSold" name="Not Solds" isAnimationActive={false} hide={hidden.notSold}>
              {data.map((row, i) => (
                <Cell key={i} fill={row.isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              <LabelList dataKey="notSold" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }} />
            </Bar>
            <Line
              dataKey="avgOppLife"
              name="Avg Opp Life"
              stroke="#dc2626"
              strokeWidth={2.5}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.avgOppLife}
            >
              <LabelList dataKey="avgOppLife" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#991b1b' }} formatter={(v) => v == null ? '' : v} />
            </Line>
            <Line
              dataKey="ageNotQuoted"
              name="Age of not Quoted"
              stroke="#22c55e"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.ageNotQuoted}
            />
            <Line
              dataKey="quoteToClose"
              name="Quote to Close"
              stroke="#eab308"
              strokeWidth={2}
              dot={{ r: 3 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.quoteToClose}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// Compact `$1,234,567` formatter for label lists on $-axis charts.
function fmtMoneyLabel(v) {
  if (v == null || !Number.isFinite(v) || v === 0) return '';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

// Compact "thousands" form for the Annual Sales bar totals: 1,823,986
// shows as "$1,823k" (the sub-thousand remainder is dropped).
function fmtThousandsLabel(v) {
  if (v == null || !Number.isFinite(v) || v === 0) return '';
  return `$${Math.trunc(v / 1000).toLocaleString('en-US')}k`;
}

function TopAccountsCard({ data, hasOpps, onDownload, onExportPoint }) {
  const { years = [], topAccounts = [], colors = {} } = data || {};
  const hasAny = years.some(r => r._total > 0);
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Top Accounts" chartId="topAccounts" onDownload={onDownload} canDownload={hasOpps && hasAny} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data: open the Opps tab to load.</div>
      ) : !hasAny ? (
        <div className={styles.empty}>No Sold opps with a Quoted Amount yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={years} margin={{ top: 20, right: 8, left: 16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => `$${(v / 1_000_000).toFixed(0)}M`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row._isProjected ? 'Projected (YTD + active pipeline)' : `Year ${label}`}
                valueFormat={(v) => (v ? fmtMoneyLabel(v) : '$0')}
                explain={(row) => ({
                  formula: 'Sold Quoted Amount summed per Account for this year. The top 4 accounts by lifetime Sold $ get their own slice; everyone else is grouped as Remaining.',
                  inputs: [{ label: 'Year total', value: row._total ? fmtMoneyLabel(row._total) : '$0' }],
                  note: row._isProjected ? 'Projected adds active pipeline (non-closed current-year opps) to YTD Sold $.' : null,
                })}
              />
            } />
            <Legend {...legendProps} />
            {/* Stack order: largest (Brookfield) at bottom; Remaining at top. */}
            {topAccounts.map((a, i) => (
              <Bar
                key={a}
                dataKey={a}
                stackId="ta"
                name={a}
                fill={colors[a] || '#94a3b8'}
                isAnimationActive={false}
                hide={hidden[a]}
              >
                {i === 0 ? (
                  <LabelList
                    dataKey={a}
                    position="center"
                    style={{ fontSize: 10, fontWeight: 600, fill: '#fff' }}
                    formatter={(v) => v && v >= 50_000 ? fmtMoneyLabel(v) : ''}
                  />
                ) : null}
              </Bar>
            ))}
            <Bar dataKey="Remaining" stackId="ta" name="Remaining" fill={colors.Remaining || '#22c55e'} isAnimationActive={false} hide={hidden.Remaining}>
              <LabelList
                dataKey="_total"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => fmtMoneyLabel(v)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function AnnualSalesCard({ data, hasOpps, target, onDownload, onExportYear, onExportPoint }) {
  const hasAny = data.some(r => r._total > 0);
  const annualTarget = target > 0 ? target : DEFAULT_ANNUAL_TARGET;
  const { hidden, legendProps } = useInteractiveLegend();
  // Drive the Y axis off the stacked total (currentClient + newClient).
  // A function domain like `dataMax => dataMax * 1.18` can clip stacked
  // bars: Recharts may hand the function the per-series max rather than
  // the stack total, so a bar whose two segments sum higher than either
  // segment alone renders shorter than its real value (while the tooltip,
  // which reads the row, still shows the right number). Computing the max
  // from `_total` here guarantees every bar scales to its true height.
  const yMax = useMemo(() => {
    const max = data.reduce((m, r) => Math.max(m, r._total || 0), 0);
    return max > 0 ? Math.ceil(max * 1.18) : 1;
  }, [data]);
  // Bar clicks now pin the panel (handled at the page level); the per-bar
  // Excel export lives as a button inside that panel (see explain → exportDeals).
  // Draw the total (+ % Quota) above each bar. Pinning the label to one
  // segment breaks when that segment is $0 — a year whose Sold deals are
  // all Current Client has newClient = 0, so a label on the New Client
  // (top) segment silently disappeared. Instead draw it on whichever
  // segment actually sits on top: New Client when it has value, else
  // Current Client.
  //
  // The row comes from the bar entry's own payload (fed in via the
  // LabelList `valueAccessor` below) — NOT `data[props.index]`. Recharts
  // drops zero-dimension bars from its rendered set, so `props.index` is
  // an index into that filtered set; using it against the full `data`
  // array drew a year's total over the wrong bar once any segment was $0.
  // Reading the payload keeps the amount, the %, and the x/y position all
  // tied to the same bar.
  const renderTotalLabel = (segment) => (props) => {
    const row = props.value;
    if (!row || typeof row !== 'object' || !row._total) return null;
    const newClientOnTop = (row.newClient || 0) > 0;
    if (segment === 'new' ? !newClientOnTop : newClientOnTop) return null;
    const vb = (props.viewBox && props.viewBox.x != null) ? props.viewBox : props;
    const cx = (vb.x || 0) + (vb.width || 0) / 2;
    const top = vb.y || 0;
    return (
      <g>
        <text x={cx} y={top - 7} textAnchor="middle" style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}>{fmtThousandsLabel(row._total)}</text>
        {!hidden.pctQuota && row.pctQuota != null ? (
          <text x={cx} y={top - 22} textAnchor="middle" style={{ fontSize: 10, fontWeight: 600, fill: '#a16207' }}>{`${row.pctQuota}%`}</text>
        ) : null}
      </g>
    );
  };
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Annual Sales" chartId="annualSales" onDownload={onDownload} canDownload={hasOpps && hasAny} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data: open the Opps tab to load.</div>
      ) : !hasAny ? (
        <div className={styles.empty}>No Sold opps with a Quoted Amount yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 48, right: 8, left: 16, bottom: 4 }} style={{ cursor: 'pointer' }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              domain={[0, yMax]}
              allowDataOverflow={false}
              tickFormatter={(v) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(0)}M` : v.toLocaleString('en-US')}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row._isProjected ? 'Projected (Sold + Agreement Sent + Contracting)' : `Sold in ${label}`}
                valueFormat={(v, name) => (name === '% Quota' ? `${v}%` : (v ? fmtMoneyLabel(v) : '$0'))}
                explain={(row) => ({
                  formula: 'Sold Quoted Amount bucketed by the year of the Close Date, split Current vs New Client by the Lead Source text. % Quota = Total Sold ÷ annual target.',
                  inputs: [
                    { label: 'Current Client', value: row.currentClient ? fmtMoneyLabel(row.currentClient) : '$0' },
                    { label: 'New Client', value: row.newClient ? fmtMoneyLabel(row.newClient) : '$0' },
                    { label: 'Total Sold', value: row._total ? fmtMoneyLabel(row._total) : '$0' },
                    { label: 'Annual target', value: fmtMoneyLabel(annualTarget) },
                    { label: '% Quota', value: row.pctQuota == null ? '-' : `${row.pctQuota}%` },
                  ],
                  deals: row._deals || [],
                  exportDeals: (Array.isArray(row._deals) && row._deals.length > 0)
                    ? () => onExportYear?.(row)
                    : undefined,
                  note: row._isProjected
                    ? 'Projected = this year’s Sold (by Close Date) + every open Agreement Sent or Contracting opp. Click the bar to pin this panel, then ⬇ Excel to export.'
                    : 'Click the bar to pin this panel, then ⬇ Excel to export these deals.',
                })}
              />
            } />
            <Legend
              {...legendProps}
              payload={[
                { value: '% Quota', type: 'circle', color: '#eab308', id: 'pct', dataKey: 'pctQuota' },
                { value: 'New Client', type: 'rect', color: '#ef4444', id: 'new', dataKey: 'newClient' },
                { value: 'Current Client', type: 'rect', color: '#3b82f6', id: 'cur', dataKey: 'currentClient' },
              ]}
            />
            <Bar dataKey="currentClient" stackId="as" name="Current Client" fill="#3b82f6" isAnimationActive={false} hide={hidden.currentClient}>
              {data.map((row, i) => (
                <Cell key={i} fill={row._isProjected ? '#facc15' : '#3b82f6'} />
              ))}
              {/* Total sits here only for years whose top segment (New
                  Client) is $0 — otherwise it's drawn on the New Client bar.
                  valueAccessor hands the label its bar's own payload row so
                  the amount stays tied to the bar it's drawn over. */}
              <LabelList valueAccessor={(entry) => entry?.payload} content={renderTotalLabel('cur')} />
            </Bar>
            <Bar dataKey="newClient" stackId="as" name="New Client" fill="#ef4444" isAnimationActive={false} hide={hidden.newClient}>
              {data.map((row, i) => (
                <Cell key={i} fill={row._isProjected ? '#facc15' : '#ef4444'} />
              ))}
              <LabelList valueAccessor={(entry) => entry?.payload} content={renderTotalLabel('new')} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function DealSizeCard({ data, hasOpps, onDownload, onExportPoint }) {
  const hasAny = data.some(r => r.deals > 0);
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Deal Size" chartId="dealSize" onDownload={onDownload} canDownload={hasOpps && hasAny} />
      {!hasOpps ? (
        <div className={styles.empty}>No Opps data: open the Opps tab to load.</div>
      ) : !hasAny ? (
        <div className={styles.empty}>No sold opps yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ top: 20, right: 2, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              yAxisId="deals"
              tick={{ fontSize: 12 }}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="dollars"
              orientation="right"
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label, row) => row._isProjected ? 'Projected (YTD Sold + Agreement Sent)' : `Year ${label}`}
                valueFormat={(v, name) => {
                  if (v == null) return '-';
                  if (name === 'Deals') return v.toLocaleString('en-US');
                  return v ? fmtMoneyLabel(v) : '$0';
                }}
                explain={(row) => ({
                  formula: 'Deals = count of Sold opps (won deals), by Closed Year. Quoted = mean Quoted Amount of opps quoted that year, by Quoted On date. Deal Size = average deal size (mean Quoted Amount of Sold opps), by Closed Year.',
                  inputs: [
                    { label: 'Deals (Sold)', value: (row.deals ?? 0).toLocaleString('en-US') },
                    { label: row._isProjected ? 'Quoted mean (Sold + Agreement Sent)' : 'Quoted mean (by Quoted Year)', value: row.quoted == null ? '-' : `${fmtMoneyLabel(row.quoted)} (n=${row._quotedCount ?? 0})` },
                    { label: 'Deal Size mean', value: row.dealSize == null ? '-' : `${fmtMoneyLabel(row.dealSize)} (n=${row._soldCount ?? 0})` },
                  ],
                  note: row._isProjected ? 'Projected = this year’s Sold deals + every opp in the Agreement Sent stage, counted as expected future closes. Quoted is the mean Quoted Amount across only those Sold and Agreement Sent opps; Deal Size isn’t projected.' : null,
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar yAxisId="deals" dataKey="deals" name="Deals" isAnimationActive={false} hide={hidden.deals}>
              {data.map((row, i) => (
                <Cell key={i} fill={row._isProjected ? '#facc15' : '#94a3b8'} />
              ))}
              <LabelList dataKey="deals" position="top" style={{ fontSize: 11, fontWeight: 600, fill: '#475569' }} />
            </Bar>
            <Line
              yAxisId="dollars"
              dataKey="quoted"
              name="Quoted"
              stroke="#dc2626"
              strokeWidth={2}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.quoted}
            >
              <LabelList dataKey="quoted" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#991b1b' }} formatter={(v) => fmtThousandsLabel(v)} />
            </Line>
            <Line
              yAxisId="dollars"
              dataKey="dealSize"
              name="Deal Size"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
              hide={hidden.dealSize}
            >
              <LabelList dataKey="dealSize" position="bottom" style={{ fontSize: 10, fontWeight: 600, fill: '#1d4ed8' }} formatter={(v) => fmtThousandsLabel(v)} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function CommissionsCard({ data, hasCommissions, onDownload, onExportPoint }) {
  const { hidden, legendProps } = useInteractiveLegend();
  return (
    <div className={styles.chartCard}>
      <ChartHeader title="Commissions" chartId="commissions" onDownload={onDownload} canDownload={hasCommissions && data.length > 0} />
      {!hasCommissions ? (
        <div className={styles.empty}>No deals with a Year value: add a Year and Commission on the Clients › Deals tab.</div>
      ) : data.length === 0 ? (
        <div className={styles.empty}>No deals with a Year value.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 22, right: 8, left: 16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="year" interval={0} tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              tickFormatter={(v) => fmtMoneyShort(v)}
            />
            <Tooltip wrapperStyle={TOOLTIP_WRAPPER_STYLE} content={
              <CalcTooltip
                onExportPoint={onExportPoint}
                labelText={(label) => `Year ${label}`}
                valueFormat={(v) => (v == null ? '-' : fmtMoneyFull(v))}
                explain={(row) => ({
                  formula: 'Sum of the Deals tab’s Commission column for every deal whose Year column equals this year.',
                  inputs: [
                    { label: 'Deals counted', value: (row._rowCount ?? 0).toLocaleString('en-US') },
                    { label: 'Total', value: fmtMoneyFull(row.total) },
                  ],
                })}
              />
            } />
            <Legend {...legendProps} />
            <Bar dataKey="total" name="Commissions" fill="#3b82f6" isAnimationActive={false} hide={hidden.total}>
              <LabelList
                dataKey="total"
                position="top"
                style={{ fontSize: 11, fontWeight: 600, fill: '#1f2937' }}
                formatter={(v) => fmtMoneyFull(v)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
