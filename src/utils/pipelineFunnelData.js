// The inputs the Pipeline Funnel draws, derived in one place.
//
// The funnel is drawn on two pages now — Charts → Pipeline, under the
// metrics table it visualises, and the Weekly Report, under the headline
// KPIs — off the same two cached records (the pipeline-dashboard goals and
// manual actuals, and the pasted BFO Activity rows) plus the Opps 2 cache.
// Deriving the stage rows here rather than in each view is what keeps the
// two pictures identical: a change to how a stage's actual is read lands on
// both, or neither.
//
// Everything here is pure — the caller passes the already-loaded blobs.

import { parseDateMs, parseMoney } from './oppsMetrics.js';
import { isPullThroughOpp } from './pullThrough.js';

// The Opps tab's BFO Opportunity Name lives in the column whose data key is
// still "BFO Link" (the visible label was renamed). New opps are seeded with a
// dash placeholder and sheet imports leave #N/A — neither is a real name, so
// treat them as empty. Mirrors bfoOppName in BFOActivityView.
const BFO_BLANK_SENTINELS = new Set(['', '-', '#n/a', 'n/a']);
export function bfoOppNameOf(r) {
  const v = String(r?.['BFO Link'] || '').trim();
  return BFO_BLANK_SENTINELS.has(v.toLowerCase()) ? '' : v;
}

// ---- Close-rate stage signals ---------------------------------------------
// "Did this opp actually reach stage N?" read off the Opps tab. Defined
// once here and shared by the rolling-365-day Close Rate Actual column in
// Pipeline Metrics, the month-by-month close-rate table under it, and the
// funnel's weighted projection, so the views of the same number can never
// drift apart.
//
// Pull-through opps are excluded from every close rate — they ride along
// with another deal rather than being won on their own merits. The test
// lives in utils/pullThrough so this and the Days-in-Stage board answer
// the same question the same way: the opp's explicit "Pull Through"
// column when it's set, its Scope text otherwise.

// A value that's present and isn't one of the spreadsheet's null markers.
export const filledCell = (v) => {
  const s = String(v ?? '').trim();
  return !!s && s !== '-' && s !== '—' && s !== 'N/A' && s !== '#N/A';
};
export const hasBfoOpportunity = (r) => filledCell(r['BFO Link']);
const isAemScope = (r) => /\baem\b/i.test(String(r.Scope || ''));
const isNeverConnected = (r) => String(r.Status || '').trim().toLowerCase() === 'never connected';
const hasQuotedOn = (r) => {
  const v = r['Quoted On'] || r['Quoted Date'] || '';
  return !!v && !Number.isNaN(Date.parse(v));
};

// Listed high stage → low, matching the Pipeline Metrics table's row order.
export const CLOSE_RATE_STAGES = [
  {
    num: 6,
    label: 'Stage 6: Negotiate to Win',
    signal: 'a non-empty Entity Outside the US Approval value',
    test: (r) => filledCell(r['Entity Outside the US Approval']),
  },
  {
    num: 5,
    label: 'Stage 5: Prepare & Bid',
    signal: 'a Quoted On date',
    test: hasQuotedOn,
  },
  {
    num: 4,
    label: 'Stage 4: Influence and Develop',
    signal: 'a BFO opportunity value (non-empty BFO Link), excluding AEM scope and "Never connected" status',
    test: (r) => hasBfoOpportunity(r) && !isAemScope(r) && !isNeverConnected(r),
  },
  {
    num: 3,
    label: 'Stage 3: Qualify Opportunity',
    signal: 'a BFO opportunity value (non-empty BFO Link)',
    test: hasBfoOpportunity,
  },
];

// A closed opp (Sold / Not Sold) that counts toward close rates, or null.
// `ts` is the parsed Close Date — the month bucket and the rolling window
// both key off it.
export function closedOppEntry(r) {
  const stage = String(r.Stage || '').trim();
  if (stage !== 'Sold' && stage !== 'Not Sold') return null;
  const closeDate = r['Close Date'];
  if (!closeDate) return null;
  const ts = Date.parse(closeDate);
  if (Number.isNaN(ts)) return null;
  if (isPullThroughOpp(r)) return null;
  return {
    account: String(r.Account || '').trim(),
    bfoName: bfoOppNameOf(r),
    scope: String(r.Scope || '').trim(),
    stage,
    closeDate,
    ts,
    amount: parseMoney(r['Quoted Amount']) || 0,
  };
}

// Roll an array of closed-opp entries into { sold, notSold, rate, included }.
// Returns null for an empty bucket so a cell reads "—" rather than "0%".
export function closeRateTally(entries) {
  if (!entries.length) return null;
  let sold = 0;
  for (const e of entries) if (e.stage === 'Sold') sold += 1;
  const included = entries.slice().sort((a, b) => b.ts - a.ts);
  return { sold, notSold: entries.length - sold, rate: sold / entries.length, included };
}

// Per-stage Close Rate Actual on a rolling 365-day window, using the
// CLOSE_RATE_STAGES signals above for "did it actually reach this stage?".
// An opp counts toward every stage whose signal it carries, so Stage 3's
// denominator is the widest and Stage 6's the narrowest. A stage with no
// closed deal in the window is null, not 0 — no evidence is not a 0% rate.
export function closeRatesByStage(oppsRecords, nowMs = Date.now()) {
  const out = { 3: null, 4: null, 5: null, 6: null };
  const rows = Array.isArray(oppsRecords) ? oppsRecords : [];
  if (rows.length === 0) return out;
  const cutoff = nowMs - 365 * 86400000;
  const buckets = { 3: [], 4: [], 5: [], 6: [] };
  for (const r of rows) {
    const entry = closedOppEntry(r);
    if (!entry || entry.ts < cutoff) continue;
    for (const st of CLOSE_RATE_STAGES) {
      if (st.test(r)) buckets[st.num].push(entry);
    }
  }
  for (const st of CLOSE_RATE_STAGES) out[st.num] = closeRateTally(buckets[st.num]);
  return out;
}

// Short month labels for the trend's column heads — "Apr", and the year
// too whenever the run crosses into a new one, so a six-month window that
// spans a year boundary can't read as six months of the same year.
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Close rate by stage, month by month, over a trailing run of whole months.
 *
 * The rolling-365-day figure in closeRatesByStage answers "what is our close
 * rate"; this answers "is it moving". Same signals, same exclusions, same
 * tally — only the window differs, so a stage's trend and its headline rate
 * can never be measured two different ways.
 *
 * Months are calendar months ending with the one `nowMs` falls in, oldest
 * first, and an opp lands in the month of its Close Date. A month with no
 * closed deal in a stage is null rather than 0: no evidence is not a 0%
 * rate, and drawing it as one would put a cliff in the trend that nothing
 * in the pipeline did.
 *
 * @returns {
 *   months: [{ key: '2026-04', label: 'Apr', year, month }],
 *   rows:   [{ key, num, label, short, cells: [tally|null], overall: tally|null }],
 *   closed: how many closed opps fell in the window at all
 * }
 * where each tally is closeRateTally's { sold, notSold, rate, included }.
 * `rows` carries the four stages high-to-low, matching the Pipeline Metrics
 * table, and an "All closed" row underneath them — the stage denominators
 * nest inside each other, so the total is what says whether a stage's move
 * is a real change or just a change in volume.
 */
export function closeRateTrendByStage(oppsRecords, { months = 6, nowMs = Date.now() } = {}) {
  const span = Math.max(1, Math.floor(Number(months) || 0) || 6);
  const now = new Date(nowMs);
  const monthCols = [];
  const colOf = new Map();
  for (let i = span - 1; i >= 0; i -= 1) {
    // Day 1 of the month `i` months back. Reading it off a Date built with
    // an out-of-range month index is what rolls the year over for us.
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;
    colOf.set(key, monthCols.length);
    monthCols.push({ key, label: MONTH_SHORT[month], year, month });
  }
  // Only worth labelling the year when the window crosses one.
  if (monthCols.length > 1 && monthCols[0].year !== monthCols[monthCols.length - 1].year) {
    for (const c of monthCols) c.label = `${c.label} ’${String(c.year).slice(2)}`;
  }

  const defs = [
    ...CLOSE_RATE_STAGES.map(st => ({
      key: `stage${st.num}`, num: st.num, label: st.label,
      short: `Stage ${st.num}`, test: st.test,
    })),
    // Every closed opp, whatever it reached. Same population as the
    // metrics table's Total row.
    { key: 'all', num: null, label: 'All closed opps', short: 'All closed', test: () => true },
  ];
  const buckets = defs.map(() => monthCols.map(() => []));

  let closed = 0;
  for (const r of Array.isArray(oppsRecords) ? oppsRecords : []) {
    const entry = closedOppEntry(r);
    if (!entry) continue;
    // Bucketed off a local-midnight reading of the Close Date, not the raw
    // Date.parse: a bare ISO date parses as UTC midnight, which is the
    // previous day west of Greenwich — and on the 1st of a month that is
    // the previous MONTH, which would move deals between columns.
    const ms = parseDateMs(entry.closeDate);
    if (ms === null) continue;
    const d = new Date(ms);
    const col = colOf.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    if (col === undefined) continue;
    closed += 1;
    for (let i = 0; i < defs.length; i += 1) {
      if (defs[i].test(r)) buckets[i][col].push(entry);
    }
  }

  const rows = defs.map((def, i) => {
    const cells = buckets[i].map(closeRateTally);
    return {
      key: def.key, num: def.num, label: def.label, short: def.short,
      cells,
      // The whole window as one figure, so a row that moves around can still
      // be read against where it sits overall.
      overall: closeRateTally(buckets[i].flat()),
    };
  });

  return { months: monthCols, rows, closed };
}

// One pipeline-metrics stage row flattened to the numbers the funnel draws.
//
// Actuals are the live BFO figures when the BFO Activity tab has been
// pasted, and the hand-entered cells otherwise — the same precedence the
// metrics table renders with, so the picture and the table can never
// disagree. Pipeline Goal is derived, never read: Active Opp Goal × Deal
// Size Goal, matching what the table recomputes on every render.
export function buildFunnelStages({ stages = [], bfoMetrics = {}, hasBfo = false, closeRates = null } = {}) {
  return (Array.isArray(stages) ? stages : []).map((st) => {
    const stageNum = Number(String(st?.key ?? '').replace(/[^0-9]/g, ''));
    const m = bfoMetrics?.[stageNum];
    const live = (v) => (hasBfo && v !== null && v !== undefined ? v : null);
    const activeGoal = Number(st?.activeGoal) || 0;
    const dealSizeGoal = Number(st?.dealSizeGoal) || 0;
    return {
      key: st?.key,
      stageNum,
      label: st?.label,
      countActual: live(m?.count) ?? (Number(st?.activeActual) || 0),
      countGoal: activeGoal,
      amtActual: live(m?.total) ?? (Number(st?.pipelineActual) || 0),
      amtGoal: activeGoal * dealSizeGoal,
      // Avg Opp Life — the funnel draws each stage as long as deals sit in it.
      lifeActual: live(m?.avgAge) ?? (Number(st?.lifeActual) || 0),
      lifeGoal: Number(st?.lifeGoal) || 0,
      // Close Rate Actual — live rolling-365 rate when the Opps tab is
      // loaded, the manual cell otherwise. Feeds the funnel's weighted
      // "projected" figure, one stage at a time.
      closeRate: closeRates?.[stageNum]?.rate ?? (Number(st?.closeActual) || 0),
      // Goal-side inputs — the deal size and close rate the stage is
      // MEANT to run at. The funnel's "To target" view plans off these,
      // falling back to the actuals where a goal cell is blank.
      dealSizeGoal,
      dealSizeActual: live(m?.avg) ?? (Number(st?.dealSizeActual) || 0),
      closeGoal: Number(st?.closeGoal) || 0,
      isLive: hasBfo && m?.count !== null && m?.count !== undefined,
    };
  });
}
