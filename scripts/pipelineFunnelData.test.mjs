// Assertion tests for the Pipeline Funnel's inputs. Plain Node — no test
// framework (the project has none). Run:
//   node scripts/pipelineFunnelData.test.mjs
//
// The funnel is drawn on two pages — Charts → Pipeline and the Weekly
// Report — off one builder, so what these lock in is the reading of a
// stage row: live BFO actuals when the BFO tab is pasted, the hand-entered
// cells otherwise, Pipeline Goal derived rather than read, and the close
// rate that the weighted projection multiplies through.
import {
  buildFunnelStages, closeRatesByStage, closedOppEntry, closeRateTally,
} from '../src/utils/pipelineFunnelData.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ---- buildFunnelStages ------------------------------------------------------

// One metrics-table row, in the shape the pipeline-dashboard record stores.
const row = (over = {}) => ({
  key: 's5', label: 'Stage 5',
  activeGoal: 12, activeActual: 6,
  dealSizeGoal: 125000, dealSizeActual: 52146,
  pipelineGoal: 999, // stale stored value — never read, always derived
  pipelineActual: 578831,
  closeGoal: 0.4, closeActual: 0.11,
  lifeGoal: 150, lifeActual: 68,
  ...over,
});

{
  // No BFO pasted: every actual is the hand-entered cell.
  const [st] = buildFunnelStages({ stages: [row()] });
  eq(st.stageNum, 5, 'the stage number is read off the row key');
  eq(st.countActual, 6, 'Active Opps Actual comes from the manual cell');
  eq(st.amtActual, 578831, 'so does Pipeline Actual');
  eq(st.lifeActual, 68, 'and Avg Opp Life');
  eq(st.dealSizeActual, 52146, 'and Deal Size Actual');
  eq(st.isLive, false, 'and the row is not marked live');

  // Pipeline Goal is Active Opp Goal × Deal Size Goal, never the stored
  // cell — the metrics table recomputes it on every render, and a funnel
  // that read the stale value would draw a goal line the table denies.
  eq(st.amtGoal, 12 * 125000, 'Pipeline Goal is derived from the two goals, not read');
  eq(st.countGoal, 12, 'the count goal is the Active Opp Goal');
}

{
  // BFO pasted: live actuals win, goals stay the entered ones.
  const bfoMetrics = { 5: { count: 9, total: 1200000, avg: 133333, avgAge: 101 } };
  const [st] = buildFunnelStages({ stages: [row()], bfoMetrics, hasBfo: true });
  eq([st.countActual, st.amtActual, st.dealSizeActual, st.lifeActual], [9, 1200000, 133333, 101],
    'live BFO actuals win over the manual cells');
  eq(st.isLive, true, 'and the row is marked live');
  eq([st.countGoal, st.amtGoal, st.closeGoal, st.lifeGoal], [12, 12 * 125000, 0.4, 150],
    'the goal side is untouched by BFO');

  // hasBfo with nothing for THIS stage falls back rather than zeroing: an
  // empty stage in the paste is not a claim that the stage is empty.
  const [only] = buildFunnelStages({ stages: [row()], bfoMetrics: {}, hasBfo: true });
  eq([only.countActual, only.amtActual, only.isLive], [6, 578831, false],
    'a stage the paste has no rows for keeps its manual cells');
}

{
  // Close rate: the live rolling-365 rate when the Opps cache has one for
  // the stage, the manual Close Rate Actual cell otherwise.
  const withLive = buildFunnelStages({ stages: [row()], closeRates: { 5: { rate: 0.25 } } });
  eq(withLive[0].closeRate, 0.25, 'the live close rate feeds the weighted projection');
  eq(buildFunnelStages({ stages: [row()], closeRates: { 5: null } })[0].closeRate, 0.11,
    'a stage with no closed deals falls back to the manual cell');
  eq(buildFunnelStages({ stages: [row({ closeActual: 0 })] })[0].closeRate, 0,
    'and no rate anywhere is 0, not undefined');
}

{
  // Shape guards — the Weekly Report hands over whatever the cached record
  // holds, which may be nothing at all.
  eq(buildFunnelStages({}), [], 'no stages in, no stages out');
  eq(buildFunnelStages({ stages: null }), [], 'a malformed stages field is empty, not a throw');
  const [blank] = buildFunnelStages({ stages: [{ key: 's3' }] });
  eq([blank.countActual, blank.amtActual, blank.amtGoal, blank.closeRate], [0, 0, 0, 0],
    'an empty row reads as zeros rather than NaN');
}

// ---- closeRatesByStage ------------------------------------------------------

const NOW = Date.parse('2026-06-30T00:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

// A closed opp carrying every stage signal: BFO Link (3 + 4), a Quoted On
// date (5), and an Entity Outside the US Approval value (6).
const closed = (stage, days, over = {}) => ({
  Account: 'Acme', Stage: stage, 'Close Date': daysAgo(days),
  'BFO Link': 'OPP-1', 'Quoted On': daysAgo(days + 10),
  'Entity Outside the US Approval': 'Approved',
  'Quoted Amount': '$100,000', Scope: 'GHG',
  ...over,
});

{
  const rates = closeRatesByStage([
    closed('Sold', 30), closed('Not Sold', 60), closed('Sold', 90), closed('Not Sold', 120),
  ], NOW);
  eq(rates[6].rate, 0.5, 'a stage rate is sold ÷ closed in the window');
  eq([rates[3].sold, rates[3].notSold], [2, 2], 'the tally counts both sides');
  eq([rates[3].rate, rates[4].rate, rates[5].rate, rates[6].rate], [0.5, 0.5, 0.5, 0.5],
    'an opp carrying every signal counts toward every stage');
}

{
  // The window is a rolling 365 days off "now", not a calendar year.
  const rates = closeRatesByStage([closed('Sold', 30), closed('Not Sold', 400)], NOW);
  eq(rates[3].rate, 1, 'a deal closed over a year ago is out of the window');
  eq(rates[3].included.length, 1, 'and out of the drill-down list with it');
}

{
  // Stage signals gate the buckets: no Quoted On means the deal never
  // reached Stage 5, so it can't be in Stage 5's denominator.
  const rates = closeRatesByStage([closed('Sold', 10, { 'Quoted On': '', 'Entity Outside the US Approval': '' })], NOW);
  eq([rates[3] && rates[3].sold, rates[4] && rates[4].sold], [1, 1], 'the BFO-link stages still count it');
  eq([rates[5], rates[6]], [null, null], 'the stages it never reached stay empty');

  // Stage 4 excludes AEM scope and "Never connected" — Stage 3 does not.
  const aem = closeRatesByStage([closed('Sold', 10, { Scope: 'AEM install' })], NOW);
  eq([aem[3].sold, aem[4]], [1, null], 'AEM scope is out of Stage 4 but still in Stage 3');
}

{
  // Pull-through opps ride along with a parent sale; counting them would
  // flatter every rate.
  eq(closeRatesByStage([closed('Sold', 10, { 'Pull Through': 'Yes' })], NOW)[3], null,
    'an explicit pull-through is excluded');
  eq(closeRatesByStage([closed('Sold', 10, { Scope: 'Tax Matrix - pull through' })], NOW)[3], null,
    'and so is one named only in the Scope text');
  eq(closeRatesByStage([closed('Sold', 10, { Scope: 'Tax Matrix - pull through', 'Pull Through': 'No' })], NOW)[3].sold, 1,
    '…unless the explicit column overrules the Scope');
}

{
  eq(closeRatesByStage([], NOW), { 3: null, 4: null, 5: null, 6: null }, 'no records, no rates');
  eq(closeRatesByStage(null, NOW), { 3: null, 4: null, 5: null, 6: null }, 'and a missing cache is not a throw');
  // Open opps have nothing to say about close rates.
  eq(closeRatesByStage([closed('Quoted', 10)], NOW)[3], null, 'an open opp is not a closed one');
  eq(closedOppEntry({ Stage: 'Sold', 'Close Date': 'not a date' }), null, 'an unparseable close date is dropped');
  eq(closeRateTally([]), null, 'an empty bucket is null, not a 0% rate');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
