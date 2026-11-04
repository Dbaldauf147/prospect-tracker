// Chance of moving to the next stage, by days in stage, for Opps > Close
// Rates > 6.
//
// Read off `_stageHistory`, which logs each stage as it is LEFT ({ stage,
// enteredAt, exitedAt, days }). Each entry is one stint in a stage, and what
// came after it (the next entry, or the opp's Stage today) says how the stint
// ended:
//
//   progressed  the next stage is further down the pipeline (Sold counts)
//   stalled     the opp went back a stage, or was lost (Not Sold)
//   (skipped)   a sideways move (Quoted to Repricing) or a stage the
//               pipeline doesn't rank: neither answer, so left out
//
// For a stage and a number of days d, the chance is: of the finished stints
// in that stage that lasted at least d days, the share that progressed. That
// is the question an open opp sitting d days in a stage asks ("deals that
// were still here this long, how many still moved on?"), so the open opps'
// table reads its figure off the band its days fall in.
//
// Stints still running (an open opp's current stage) haven't ended, so they
// don't count toward the history; they are what the chance is FOR.
// Pull-throughs are left out, as everywhere on the Close Rates tab.
//
// The same question is also asked against how long it had been since we
// heard from the contact when the stint ended (`silence`): of the stints
// that ended with at least d days of silence, the share that moved on. The
// heard-from dates come from the opp's contact response log
// (utils/contactResponse) plus its Last Client Heard From Us date. The
// latest known date on or before the exit is the last time we heard before
// it: any date the log never saw is older than the log's opening entry, so
// it can't be the latest. With no known date on or before the exit, the
// silence is unknown and the stint sits out of that view.
//
// Pure, so scripts/stageProgression.test.mjs can assert it without a browser.

import { toISODate } from './oppsCallIn.js';
import { isPullThroughOpp } from './pullThrough.js';
import { HEARD_FROM_FIELD, HEARD_FROM_LOG, primaryContactOf, contactResponseSummary } from './contactResponse.js';

// The stages a stint can be measured in, in pipeline order, and what moving
// on from each means.
export const PROGRESS_STAGES = ['Not Started', 'Lead', 'Qualifying', 'Quoting', 'Quoted', 'Contracting', 'Agreement Sent'];
const RANK = {
  'Not Started': 0, 'Lead': 1, 'Qualifying': 2, 'Quoting': 3,
  'Quoted': 4, 'Repricing': 4, 'Contracting': 5, 'Agreement Sent': 6, 'Sold': 7,
};
const LOST = new Set(['Not Sold', 'Closed', 'Lost']);
// Repricing is a re-quote: its stints are Quoted stints.
const stageKey = (s) => (s === 'Repricing' ? 'Quoted' : s);

/** What "moving on" from a stage reads as: "Lead" from Not Started, etc. */
export function nextStageOf(stage) {
  const i = PROGRESS_STAGES.indexOf(stage);
  return i < 0 ? '' : (PROGRESS_STAGES[i + 1] || 'Sold');
}

// Days-in-stage bands, each from `min` days up to the next band's start.
export const DAY_BANDS = [
  { min: 0, label: '0-6 days' },
  { min: 7, label: '7-13 days' },
  { min: 14, label: '14-29 days' },
  { min: 30, label: '30-59 days' },
  { min: 60, label: '60-89 days' },
  { min: 90, label: '90-179 days' },
  { min: 180, label: '180+ days' },
];
export function bandOf(days) {
  let at = 0;
  DAY_BANDS.forEach((b, i) => { if (days >= b.min) at = i; });
  return at;
}

const dayMs = (v) => {
  const iso = toISODate(v);
  return iso ? Date.parse(`${iso}T00:00:00Z`) : null;
};
function stintDays(h) {
  const d = Number(h?.days);
  if (h?.days != null && h.days !== '' && Number.isFinite(d) && d >= 0) return d;
  const a = dayMs(h?.enteredAt);
  const b = dayMs(h?.exitedAt);
  return a != null && b != null && b >= a ? Math.round((b - a) / 86400000) : null;
}

/** Every heard-from day known for an opp, oldest first, deduped. */
export function heardDatesOf(r) {
  const out = new Set();
  for (const e of (Array.isArray(r?.[HEARD_FROM_LOG]) ? r[HEARD_FROM_LOG] : [])) {
    const iso = toISODate(e?.date);
    if (iso) out.add(iso);
  }
  const cur = toISODate(r?.[HEARD_FROM_FIELD]);
  if (cur) out.add(cur);
  return [...out].sort();
}

/** Days from the last heard-from on or before `iso` to `iso`, or null. */
export function silenceAt(dates, iso) {
  if (!iso) return null;
  let last = null;
  for (const d of dates) { if (d <= iso) last = d; else break; }
  return last ? Math.round((dayMs(iso) - dayMs(last)) / 86400000) : null;
}

/**
 * Every finished stint an opp's history shows, oldest first:
 * [{ stage, days, exitedAt, next, progressed, silence }]. Sideways moves
 * and stages the pipeline doesn't rank are left out. `silence` is the days
 * since we last heard from the contact when the stint ended (null: unknown).
 */
export function stintsOf(r) {
  const heard = heardDatesOf(r);
  const hist = (Array.isArray(r?._stageHistory) ? r._stageHistory : [])
    .filter(h => h && String(h.stage ?? '').trim())
    .map((h, i) => ({ h, i, at: dayMs(h.exitedAt) }))
    // Logged in order already; the exit date only settles a shuffled array.
    .sort((a, b) => (a.at != null && b.at != null && a.at !== b.at ? a.at - b.at : a.i - b.i))
    .map(x => x.h);
  const out = [];
  hist.forEach((h, i) => {
    const stage = stageKey(String(h.stage).trim());
    if (!PROGRESS_STAGES.includes(stage)) return;
    const next = String((i + 1 < hist.length ? hist[i + 1].stage : r?.Stage) ?? '').trim();
    let progressed;
    if (LOST.has(next)) progressed = false;
    else if (RANK[next] == null) return;
    else if (RANK[next] > RANK[stage]) progressed = true;
    else if (RANK[next] < RANK[stage]) progressed = false;
    else return;
    const days = stintDays(h);
    if (days == null) return;
    const exitedAt = toISODate(h.exitedAt) || '';
    out.push({ stage, days, exitedAt, next, progressed, silence: silenceAt(heard, exitedAt) });
  });
  return out;
}

/**
 * The history, rolled up:
 *   {
 *     stages: [{ stage, next, stints, progressed, rate, medianDaysToMove,
 *                bands: [{ label, min, n, moved, rate }],        // by days in stage
 *                silenceBands: [...same],                        // by days since heard from
 *                withSilence }],                                 // pipeline order
 *     stints: [{ r, stage, days, exitedAt, next, progressed }],  // every one counted
 *     withHistory,                                             // opps that had any
 *   }
 *
 *   from/to   ISO bounds on the stint's exit date, inclusive; blank = open
 *
 * A band's `n` is the stints that lasted at least its `min` days, `moved`
 * how many of those progressed; rate is null when n is 0.
 */
export function stageProgression(records, { from = '', to = '' } = {}) {
  const stints = [];
  let withHistory = 0;
  for (const r of records || []) {
    if (isPullThroughOpp(r)) continue;
    const mine = stintsOf(r).filter(s => (!from || (s.exitedAt && s.exitedAt >= from)) && (!to || (s.exitedAt && s.exitedAt <= to)));
    if (mine.length) withHistory += 1;
    for (const s of mine) stints.push({ r, ...s });
  }
  const stages = PROGRESS_STAGES.map(stage => {
    const mine = stints.filter(s => s.stage === stage);
    const moved = mine.filter(s => s.progressed);
    const ups = moved.map(s => s.days).sort((a, b) => a - b);
    const median = ups.length
      ? (ups.length % 2 ? ups[(ups.length - 1) / 2] : (ups[ups.length / 2 - 1] + ups[ups.length / 2]) / 2)
      : null;
    const bandsBy = (list, val) => DAY_BANDS.map(b => {
      const still = list.filter(s => val(s) >= b.min);
      const m = still.filter(s => s.progressed).length;
      return { label: b.label, min: b.min, n: still.length, moved: m, rate: still.length ? (m / still.length) * 100 : null };
    });
    const heard = mine.filter(s => s.silence != null);
    return {
      stage, next: nextStageOf(stage), stints: mine.length, progressed: moved.length,
      rate: mine.length ? (moved.length / mine.length) * 100 : null, medianDaysToMove: median,
      bands: bandsBy(mine, s => s.days),
      silenceBands: bandsBy(heard, s => s.silence),
      withSilence: heard.length,
    };
  });
  return { stages, stints, withHistory };
}

/**
 * The open opps scored against the history: each one's current stage, days
 * in it so far (from `_stageEnteredAt`, else Start Date, as Days in Stage
 * counts it) and the chance read off that stage's band for those days.
 *   [{ r, stage, next, days, band, rate, n,
 *      contact, silence, silenceBand, silenceRate, silenceN, usualGap }]
 * longest in stage first. `silence` is days since we last heard from the
 * starred contact (null without a heard-from date), scored on the stage's
 * silence bands; `usualGap` the contact's median reply gap so far.
 */
export function openOppChances(records, progression, { nowMs = Date.now() } = {}) {
  const byStage = new Map(progression.stages.map(s => [s.stage, s]));
  const today = Date.parse(`${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00Z`);
  const out = [];
  for (const r of records || []) {
    if (isPullThroughOpp(r)) continue;
    const stage = stageKey(String(r?.Stage ?? '').trim());
    const s = byStage.get(stage);
    if (!s) continue;
    const since = dayMs(r?._stageEnteredAt) ?? dayMs(r?.['Start Date']);
    if (since == null) continue;
    const days = Math.max(0, Math.round((today - since) / 86400000));
    const band = bandOf(days);
    const cell = s.bands[band];
    const resp = contactResponseSummary(r, { nowMs });
    const silence = resp.daysSince;
    const sb = silence == null ? null : bandOf(silence);
    const sCell = sb == null ? null : s.silenceBands[sb];
    out.push({
      r, stage, next: s.next, days, band: DAY_BANDS[band].label, rate: cell.rate, n: cell.n,
      contact: primaryContactOf(r), silence, silenceBand: sb == null ? '' : DAY_BANDS[sb].label,
      silenceRate: sCell ? sCell.rate : null, silenceN: sCell ? sCell.n : 0, usualGap: resp.medianGap,
    });
  }
  return out.sort((a, b) => b.days - a.days);
}
