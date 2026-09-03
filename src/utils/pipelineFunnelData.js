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

import { parseMoney } from './oppsMetrics.js';
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
