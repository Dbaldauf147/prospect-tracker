// Pipeline dashboard — recreation of the Excel pipeline-metrics
// summary. Every numeric cell is editable; goals and actuals are
// stored together in a single IndexedDB record keyed `current` so
// the layout persists across reloads.

import { useEffect, useMemo, useState } from 'react';
import styles from './PipelineView.module.css';
import { dbGet, dbPut } from '../../utils/db';

const STORE = 'pipeline-dashboard';
const KEY = 'current';
const BFO_STORE = 'bfo-activity';
const BFO_KEY = 'current';

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
  const [state, setState] = useState(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [bfo, setBfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await dbGet(STORE, KEY);
        if (cancelled) return;
        if (saved) setState(s => ({ ...DEFAULT_STATE, ...saved, stages: saved.stages || s.stages }));
        const bfoSaved = await dbGet(BFO_STORE, BFO_KEY);
        if (!cancelled && bfoSaved) setBfo(bfoSaved);
      } catch (e) {
        console.warn('Pipeline hydrate failed', e);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    // Refresh BFO data whenever the user navigates back to this tab.
    function onFocus() {
      // Always reflect the current BFO record — including its absence
      // (e.g. user clicked Clear on the BFO tab). Without the explicit
      // null fallback, deletions wouldn't propagate to this view.
      dbGet(BFO_STORE, BFO_KEY).then(b => setBfo(b || null)).catch(() => setBfo(null));
    }
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

  const bfoMetrics = useMemo(() => bfoStageMetrics(bfo), [bfo]);
  const hasBfo = bfo && bfo.rows && bfo.rows.length > 0;

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
      .sort((a, b) => a.amount - b.amount)
      .slice(0, 5);
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

  const stageTotals = state.stages.reduce((acc, st) => {
    const stageNum = Number(String(st.key).replace(/[^0-9]/g, ''));
    const m = bfoMetrics[stageNum];
    const liveCount = hasBfo && m?.count !== null && m?.count !== undefined ? m.count : null;
    const liveTotal = hasBfo && m?.total !== null && m?.total !== undefined ? m.total : null;
    return {
      activeActual: acc.activeActual + (liveCount ?? (Number(st.activeActual) || 0)),
      activeGoal: acc.activeGoal + (Number(st.activeGoal) || 0),
      pipelineActual: acc.pipelineActual + (liveTotal ?? (Number(st.pipelineActual) || 0)),
      pipelineGoal: acc.pipelineGoal + (Number(st.pipelineGoal) || 0),
      targetProj: acc.targetProj + (Number(st.targetProj) || 0),
    };
  }, { activeActual: 0, activeGoal: 0, pipelineActual: 0, pipelineGoal: 0, targetProj: 0 });

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

  const closedPctOfQuota = state.target ? state.closedYTD / state.target : 0;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Pipeline</h1>
        <div className={styles.subtitle}>Pipeline metrics dashboard. Every cell is editable; values save to your browser.</div>
      </div>
      <div className={styles.body} key={hydrated ? 'h' : 'pre'}>
        {/* Pipeline metrics */}
        <div className={styles.section}>
          <div className={styles.sectionTitle}>PIPELINE METRICS</div>
          <table className={styles.grid}>
            <thead>
              <tr>
                <th rowSpan={2} className={styles.headerLeft}>Stage</th>
                <th colSpan={2}>Active Opportunities</th>
                <th colSpan={2}>Deal Size</th>
                <th colSpan={2}>Pipeline</th>
                <th colSpan={2}>Close Rate</th>
                <th>Target Projection</th>
                <th colSpan={2}>Avg Opp Life</th>
              </tr>
              <tr>
                <th>Goal (above)</th><th>Actual</th>
                <th>Goal (above)</th><th>Actual</th>
                <th>Goal (above)</th><th>Actual</th>
                <th>Goal (above)</th><th>Actual</th>
                <th>Actual</th>
                <th>Goal (less than)</th><th>Actual</th>
              </tr>
            </thead>
            <tbody>
              {state.stages.map((st, i) => {
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
                        : <span className={styles.noBfoCell}>—</span>}
                    </td>
                    <td><NumCell value={st.dealSizeGoal} kind="money" onCommit={(v) => setStage(i, { dealSizeGoal: v })} /></td>
                    <td className={compareClass(dealSizeActual, st.dealSizeGoal, 'higher-better')}>
                      {fromBfo(m?.avg)
                        ? <span title={liveTip} className={styles.liveCell}>{fmtMoney(Math.round(dealSizeActual))}</span>
                        : <span className={styles.noBfoCell}>—</span>}
                    </td>
                    <td><NumCell value={st.pipelineGoal} kind="money" onCommit={(v) => setStage(i, { pipelineGoal: v })} /></td>
                    <td className={compareClass(pipelineActual, st.pipelineGoal, 'higher-better')}>
                      {fromBfo(m?.total)
                        ? <span title={liveTip} className={styles.liveCell}>{fmtMoney(Math.round(pipelineActual))}</span>
                        : <span className={styles.noBfoCell}>—</span>}
                    </td>
                    <td><NumCell value={st.closeGoal} kind="pct" onCommit={(v) => setStage(i, { closeGoal: v })} /></td>
                    <td className={compareClass(st.closeActual, st.closeGoal, 'higher-better')}>
                      <NumCell value={st.closeActual} kind="pct" onCommit={(v) => setStage(i, { closeActual: v })} />
                    </td>
                    <td><NumCell value={st.targetProj} kind="money" onCommit={(v) => setStage(i, { targetProj: v })} /></td>
                    <td><NumCell value={st.lifeGoal} onCommit={(v) => setStage(i, { lifeGoal: v })} /></td>
                    <td className={compareClass(lifeActual, st.lifeGoal, 'lower-better')}>
                      {fromBfo(m?.avgAge)
                        ? <span title={liveTip} className={styles.liveCell}>{lifeActual}</span>
                        : <span className={styles.noBfoCell}>—</span>}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className={styles.label}>Total</td>
                <td className={styles.numCell}>{stageTotals.activeGoal}</td>
                <td className={styles.numCell}>{hasBfo ? stageTotals.activeActual : <span className={styles.noBfoCell}>—</span>}</td>
                <td className={styles.numCell}>{fmtMoney(dealSizeAvgGoal)}</td>
                <td className={styles.numCell}>{hasBfo ? fmtMoney(dealSizeAvgActual) : <span className={styles.noBfoCell}>—</span>}</td>
                <td className={styles.numCell}>{fmtMoney(stageTotals.pipelineGoal)}</td>
                <td className={styles.numCell}>{hasBfo ? fmtMoney(stageTotals.pipelineActual) : <span className={styles.noBfoCell}>—</span>}</td>
                <td colSpan={2} />
                <td className={styles.numCell}>{fmtMoney(stageTotals.targetProj)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
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
                  <td><NumCell value={state.closedYTD} kind="money" onCommit={(v) => setField('closedYTD', v)} /></td>
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
            <EditableList
              rows={state.notSoldQuoted}
              setRows={(rows) => setField('notSoldQuoted', rows)}
              cols={[
                { key: 'account', label: 'Account', kind: 'text' },
                { key: 'scope', label: 'Scope', kind: 'text' },
                { key: 'age', label: 'Age', kind: 'num' },
                { key: 'finalMargin', label: 'Final Margin', kind: 'pct' },
                { key: 'quoted', label: 'Quoted Amount', kind: 'money' },
              ]}
              newRow={() => ({ id: `n_${Date.now()}`, account: '', scope: '', age: 0, finalMargin: 0, quoted: 0 })}
            />
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Not Quoted Opps</div>
            <EditableList
              rows={state.notQuoted}
              setRows={(rows) => setField('notQuoted', rows)}
              cols={[
                { key: 'account', label: 'Account', kind: 'text' },
                { key: 'scope', label: 'Scope', kind: 'text' },
                { key: 'closeDate', label: 'Close Date', kind: 'text' },
                { key: 'age', label: 'Age', kind: 'num' },
              ]}
              newRow={() => ({ id: `q_${Date.now()}`, account: '', scope: '', closeDate: '', age: 0 })}
            />
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
