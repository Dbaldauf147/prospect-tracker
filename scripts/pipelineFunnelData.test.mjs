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
  aheadOfRollingYear, buildFunnelStages, closeRateTrendByStage, closeRatesByStage,
  closedOppEntry, closeRateTally, emailCloseRateTrend,
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

// ---- closeRateTrendByStage --------------------------------------------------
// Every figure in the Weekly Report's trend table is hoverable, and the panel
// behind it names the population it counted and lists the deals. Both come off
// the row: `signal` says what made an opp count toward that stage, and every
// tally carries the opps themselves. A row that lost either would leave the
// panel asserting a rate with nothing to check it against.
{
  const trend = closeRateTrendByStage([
    closed('Sold', 10),
    closed('Not Sold', 20),
  ], { months: 6, nowMs: NOW });

  const stage5 = trend.rows.find(r => r.num === 5);
  eq(stage5.signal, 'a Quoted On date', 'a stage row carries the signal that defined it');
  eq(trend.rows.find(r => r.num === null).signal, null,
    'and the all-closed row has none — it counts every closed opp');

  // The current month's cell, and both aggregate columns: each is a tally
  // with the deals behind it, which is what the hover panel lists.
  const thisMonth = stage5.cells[stage5.cells.length - 1];
  eq([thisMonth.sold, thisMonth.notSold], [1, 1], 'the month cell tallies both results');
  eq(thisMonth.included.length, 2, 'and carries the opps behind it');
  eq(stage5.overall.included.length, 2, 'so does the months-shown total');
  eq(stage5.rolling12.included.length, 2, 'and the rolling year');
  eq(thisMonth.included[0].account, 'Acme', 'the deals are the ones that closed');
}

// ---- emailCloseRateTrend ----------------------------------------------------
// The trend travels in the emailed report as formatted strings, because the
// tab's sparklines and hover panels have no equivalent in an inbox. What
// matters is that the strings are the ones on screen: a rate, the count
// under it, the blank where a stage closed nothing, and the flag that puts
// the green ▲ on a row running ahead of its rolling year.
{
  const trend = closeRateTrendByStage([
    // Two closes this month, one lost 40 days back: Stage 5 runs 2/3 across
    // the months shown and the rolling year alike.
    closed('Sold', 1), closed('Sold', 2), closed('Not Sold', 40),
  ], { months: 6, nowMs: NOW });
  const mail = emailCloseRateTrend(trend);

  eq(mail.months.length, 6, 'the month labels travel, one per column');
  eq(mail.months[5], 'Jun', 'and read as the tab heads them');
  eq(mail.rows.length, 5, 'four stages and the all-closed row');

  const s5 = mail.rows.find(r => r.stage === 5);
  eq(s5.cells.length, 6, 'a row carries one cell per month, filled or not');
  eq(s5.cells[5], { rate: '100%', count: '2/2' },
    'a month cell is the rate with the count it rests on');
  eq(s5.cells[4], { rate: '0%', count: '0/1' },
    'a month that closed only losses is a real 0%, count and all');
  eq(s5.cells[0], null, 'a month the stage closed nothing in stays blank, not 0%');
  eq(s5.overall.rate, '67%', 'the months-shown total is formatted the same way');
  eq(s5.rolling12, { rate: '67%', count: '2/3' }, 'so is the rolling year');
  eq(s5.overall.ahead, null, 'a row level with its year is not flagged');
  eq(mail.rows.find(r => r.stage === null).label, 'All closed opps',
    'the total row travels with no stage of its own');
}

{
  // Ahead of the year: the recent months better than the run rate behind
  // them, which is the one thing the email marks in green.
  const trend = closeRateTrendByStage([
    closed('Sold', 10), closed('Sold', 20),          // in the months shown
    closed('Not Sold', 250), closed('Not Sold', 300), // only in the rolling year
  ], { months: 3, nowMs: NOW });
  const s6 = emailCloseRateTrend(trend).rows.find(r => r.stage === 6);
  eq([s6.overall.rate, s6.rolling12.rate], ['100%', '50%'], 'the two windows differ');
  eq(s6.overall.ahead, 50, 'and the gap in points travels, for the ▲');

  // Compared on the printed figures, so a cue the reader can't check
  // against the page never appears.
  eq(aheadOfRollingYear({ rate: 0.4649 }, { rate: 0.4551 }), null,
    'two rates that both print 46% are not "ahead"');
  eq(aheadOfRollingYear({ rate: 0.5 }, null), null, 'and a missing year cannot be beaten');
}

{
  // Nothing to draw → nothing to mail, which is what keeps an empty
  // heading out of the email.
  eq(emailCloseRateTrend(closeRateTrendByStage([], { months: 6, nowMs: NOW })), null,
    'an empty book mails no trend');
  eq(emailCloseRateTrend(null), null, 'and a missing trend is not a throw');
  // A book that closed nothing lately but has a rolling year still mails.
  const old = emailCloseRateTrend(closeRateTrendByStage([closed('Sold', 200)], { months: 2, nowMs: NOW }));
  eq(old.rows.find(r => r.stage === 3).rolling12, { rate: '100%', count: '1/1' },
    'a quiet couple of months still mails the year behind it');
  eq(old.rows.find(r => r.stage === 3).cells, [null, null], 'with the months themselves blank');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
