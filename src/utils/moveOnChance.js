// Chance of moving on, one figure per open opp, for the Opps table's
// "Chance of moving on" column and the popup behind it.
//
// The same reading as Opps > Close Rates > 6 (utils/stageProgression), run
// over every opp's stage history in any window: for an opp sitting d days
// in its stage, of the past stints in that stage that lasted at least as
// long as d's band starts, the share that moved on to a later stage. The
// popup also shows the other two reads that chart offers (by days since
// heard from, and the fitted model) plus the likelihood to close, so the
// column's figure can be checked against them.
//
// Pure, so scripts/moveOnChance.test.mjs can assert it without a browser.

import { stageProgression, openOppChances, bandOf, DAY_BANDS } from './stageProgression.js';
import { fitMoveOnModel, scoreLikelihood } from './closeLikelihood.js';

// Under this many past stints the figure is drawn faint: one or two deals
// make a 0% or 100% that means nothing. Matches Close Rates > 6.
export const MOVE_ON_MIN_N = 5;

/**
 * Score every open opp in `records`:
 *   { byId: Map(_id -> scored row), prog, model }
 * A scored row is openOppChances' row plus scoreLikelihood's fields
 * (likelihood, moveOn, steps). Opps out of the pipeline stages (Sold, Not
 * Sold), pull-throughs and opps with no date to count days from are not in
 * the map.
 */
export function moveOnChancesById(records, { nowMs = Date.now() } = {}) {
  const prog = stageProgression(records);
  const model = fitMoveOnModel(prog.stints);
  const scored = scoreLikelihood(openOppChances(records, prog, { nowMs }), prog, model, { nowMs });
  const byId = new Map();
  for (const o of scored) {
    const id = o.r?._id;
    if (id != null) byId.set(id, o);
  }
  return { byId, prog, model };
}

/**
 * The past stints behind an open opp's figure: every finished stint in its
 * stage that lasted at least as long as the start of the band its days fall
 * in, longest first. `moved` of `stints.length` is the chance.
 */
export function stintsBehind(prog, stage, days) {
  const min = DAY_BANDS[bandOf(days)].min;
  const stints = (prog?.stints || [])
    .filter(s => s.stage === stage && s.days >= min)
    .sort((a, b) => b.days - a.days || String(b.exitedAt).localeCompare(String(a.exitedAt)));
  return { min, stints, moved: stints.filter(s => s.progressed).length };
}
