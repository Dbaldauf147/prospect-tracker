// Days in stage for the Not Sold Analysis tab: how long each closed opp
// sat in each pipeline stage before it was decided, a filter on that, and
// the per-opp sheet the tab's Excel exports carry.
//
// A closed opp's clock has stopped, so unlike the Stage History tab there
// is no live "days so far" to add - every day comes from `_stageHistory`,
// which logs each stage as it is LEFT ({ stage, enteredAt, exitedAt, days }).
// A stage the opp revisited adds up. An opp that closed before stage
// history was recorded has no entries at all; it is "no history" rather
// than "0 days everywhere", and the filter leaves it out (and says so)
// instead of pretending it moved through the pipeline in no time.
//
// Pure, so scripts/notSoldStageDays.test.mjs can assert it without a browser.

import { STAGE_BANDS } from './stageBands.js';
import { NOT_SOLD, stageOf, sourceOf, reasonOf, bfoStatusOf } from './notSoldAnalysis.js';
import { parseMoney } from './oppsMetrics.js';

// The pipeline stages in order, each with the label the app shows for it
// ("Stage 4 - Qualifying"). Not Started has no number.
export const NOT_SOLD_STAGE_COLUMNS = STAGE_BANDS.flatMap(b => b.stages.map(stage => ({
  stage,
  label: b.label ? `${b.label} - ${stage}` : stage,
})));
const STAGE_SET = new Set(NOT_SOLD_STAGE_COLUMNS.map(c => c.stage));

// The filter's "which stage" option that sums every stage.
export const STAGE_DAYS_TOTAL = 'total';

const isoDay = (v) => {
  const m = String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? Date.parse(`${m[1]}T00:00:00Z`) : null;
};

function entryDays(h) {
  const d = Number(h?.days);
  if (h?.days != null && h.days !== '' && Number.isFinite(d) && d >= 0) return d;
  // An entry missing its count still has its two dates on it.
  const a = isoDay(h?.enteredAt);
  const b = isoDay(h?.exitedAt);
  if (a != null && b != null && b >= a) return Math.round((b - a) / 86400000);
  return null;
}

/**
 * { hasHistory, byStage: { Lead: 12, ... }, total } for one opp. Stages the
 * opp never sat in read 0; `hasHistory` is false when nothing was logged.
 */
export function stageDaysOf(row) {
  const byStage = Object.fromEntries(NOT_SOLD_STAGE_COLUMNS.map(c => [c.stage, 0]));
  let hasHistory = false;
  for (const h of (Array.isArray(row?._stageHistory) ? row._stageHistory : [])) {
    const s = String(h?.stage ?? '').trim();
    if (!STAGE_SET.has(s)) continue;
    const d = entryDays(h);
    if (d == null) continue;
    byStage[s] += d;
    hasHistory = true;
  }
  const total = Object.values(byStage).reduce((a, b) => a + b, 0);
  return { hasHistory, byStage, total };
}

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Whether the filter is doing anything: a min or a max is set. */
export function stageDaysFilterActive({ min = '', max = '' } = {}) {
  return num(min) != null || num(max) != null;
}

/**
 * The records the Days in stage filter keeps. Only decided opps (Sold /
 * Not Sold) are judged - nothing else reaches the analysis anyway - so the
 * loss rate stays the losses and wins that both meet the same bar.
 *
 *   stage  a stage name, or STAGE_DAYS_TOTAL for every stage together
 *   min    at least this many days ('' = no floor)
 *   max    at most this many days ('' = no ceiling)
 *
 * => { records, noHistory } where noHistory counts the losses left out
 *    because they have no stage history to judge.
 */
export function filterByStageDays(records, { stage = STAGE_DAYS_TOTAL, min = '', max = '' } = {}) {
  const list = Array.isArray(records) ? records : [];
  const lo = num(min);
  const hi = num(max);
  if (lo == null && hi == null) return { records: list, noHistory: 0 };
  let noHistory = 0;
  const kept = list.filter((r) => {
    const s = stageOf(r);
    if (s !== NOT_SOLD && s !== 'Sold') return true;
    const d = stageDaysOf(r);
    if (!d.hasHistory) {
      if (s === NOT_SOLD) noHistory += 1;
      return false;
    }
    const days = stage === STAGE_DAYS_TOTAL ? d.total : (d.byStage[stage] ?? 0);
    if (lo != null && days < lo) return false;
    if (hi != null && days > hi) return false;
    return true;
  });
  return { records: kept, noHistory };
}

/**
 * One row per lost opp for the Excel exports: who, why, and the days it
 * spent in each stage, then the total. Opps with no stage history leave the
 * day columns blank rather than reading 0.
 */
export function notSoldOppRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const d = stageDaysOf(r);
    const amount = parseMoney(r?.['Quoted Amount']);
    const out = {
      Account: r?.['Account'] || '',
      Source: sourceOf(r),
      'Reason Not Sold': reasonOf(r),
      Scope: r?.['Scope'] || '',
      Competition: r?.['Competition'] || '',
      'BFO Status': bfoStatusOf(r),
      'Quoted $': amount != null && amount > 0 ? Math.round(amount) : '',
      'Close Date': r?.['Close Date'] || '',
    };
    for (const c of NOT_SOLD_STAGE_COLUMNS) out[`Days in ${c.label}`] = d.hasHistory ? d.byStage[c.stage] : '';
    out['Total days in stages'] = d.hasHistory ? d.total : '';
    return out;
  });
}

export const NOT_SOLD_OPPS_SHEET = 'Lost opps - days in stage';
