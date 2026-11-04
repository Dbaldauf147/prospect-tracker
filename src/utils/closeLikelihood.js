// Likelihood to close, one figure per open opp, for Opps > Close Rates > 6.
//
// Two steps, both read off the stage history (utils/stageProgression):
//
//   1. The chance the opp moves on from the stage it is in now. A logistic
//      model fitted to every finished stint: did it move on, given its
//      stage, days in the stage, days since we heard from the contact
//      (unknown is its own signal), and how old the opp was. The history
//      decides how much each matters; nothing is weighted by hand.
//   2. Times each later stage's historical moved-on rate, up to Sold.
//
// So an opp in Quoted at 42% to move on, where Contracting moves on 45% of
// the time and Agreement Sent 58%, reads 42% x 45% x 58% = 11%.
//
// Every number is on 0..1 inside this module; callers show percentages.
// Pure, so scripts/closeLikelihood.test.mjs can assert it without a browser.

import { toISODate } from './oppsCallIn.js';
import { PROGRESS_STAGES } from './stageProgression.js';

// Below this many finished stints the model has too little to learn from,
// and scores stay blank rather than pretending.
export const MIN_TRAINING = 30;

const dayMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const ageAt = (r, iso) => {
  const start = toISODate(r?.['Start Date']);
  if (!start || !iso) return null;
  return Math.max(0, Math.round((dayMs(iso) - dayMs(start)) / 86400000));
};

// The inputs for one state: an opp sitting in `stage` for `days`, `silence`
// days since we heard from the contact (null = unknown), `age` days old.
// Stage is one indicator per stage; the counts go in as log(1 + n) so a
// 300-day stint doesn't swamp everything.
function featuresOf({ stage, days, silence, age }) {
  const x = PROGRESS_STAGES.map(s => (s === stage ? 1 : 0));
  x.push(Math.log1p(Math.max(0, days || 0)));
  x.push(silence == null ? 0 : Math.log1p(Math.max(0, silence)));
  x.push(silence == null ? 1 : 0);
  x.push(age == null ? 0 : Math.log1p(age));
  x.push(age == null ? 1 : 0);
  return x;
}
export const FEATURE_NAMES = [...PROGRESS_STAGES.map(s => `Stage: ${s}`), 'Days in stage (log)', 'Days since heard from (log)', 'Never heard from', 'Opp age (log)', 'No Start Date'];
const N_STAGE = PROGRESS_STAGES.length;

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * Fit the stage-move model to the finished stints a stageProgression()
 * returns. Plain gradient descent on L2-regularised log loss, with the
 * count features standardised, so the same history always gives the same
 * model. Returns null when there are fewer than MIN_TRAINING stints or
 * every one ended the same way.
 */
export function fitMoveOnModel(stints, { iterations = 600, rate = 0.3, l2 = 0.01 } = {}) {
  const rows = (stints || []).map(s => ({
    x: featuresOf({ stage: s.stage, days: s.days, silence: s.silence, age: ageAt(s.r, s.exitedAt) }),
    y: s.progressed ? 1 : 0,
  }));
  if (rows.length < MIN_TRAINING) return null;
  const pos = rows.reduce((n, r) => n + r.y, 0);
  if (pos === 0 || pos === rows.length) return null;
  const k = rows[0].x.length;
  // Standardise the non-indicator columns (the stage flags stay 0/1).
  const mean = new Array(k).fill(0);
  const sd = new Array(k).fill(1);
  for (let j = N_STAGE; j < k; j += 1) {
    const col = rows.map(r => r.x[j]);
    const m = col.reduce((a, b) => a + b, 0) / col.length;
    const v = col.reduce((a, b) => a + (b - m) ** 2, 0) / col.length;
    mean[j] = m;
    sd[j] = Math.sqrt(v) || 1;
  }
  const z = rows.map(r => ({ x: r.x.map((v, j) => (j < N_STAGE ? v : (v - mean[j]) / sd[j])), y: r.y }));
  const w = new Array(k).fill(0);
  let b = Math.log(pos / (rows.length - pos));
  const n = z.length;
  for (let it = 0; it < iterations; it += 1) {
    const gw = new Array(k).fill(0);
    let gb = 0;
    for (const r of z) {
      let s = b;
      for (let j = 0; j < k; j += 1) s += w[j] * r.x[j];
      const e = sigmoid(s) - r.y;
      gb += e;
      for (let j = 0; j < k; j += 1) gw[j] += e * r.x[j];
    }
    b -= (rate * gb) / n;
    for (let j = 0; j < k; j += 1) w[j] -= rate * (gw[j] / n + l2 * w[j]);
  }
  return { w, b, mean, sd, trainedOn: n };
}

/** The model's chance (0..1) of moving on from a state. */
export function moveOnChance(model, state) {
  if (!model) return null;
  const x = featuresOf(state);
  let s = model.b;
  for (let j = 0; j < x.length; j += 1) {
    const v = j < N_STAGE ? x[j] : (x[j] - model.mean[j]) / model.sd[j];
    s += model.w[j] * v;
  }
  return sigmoid(s);
}

/**
 * Each stage's chance of moving on, read flat off the history (no days or
 * silence): the later-stage factors in step 2. A stage with no history
 * borrows the pooled rate so the chain never breaks.
 */
function laterRates(progression) {
  let moved = 0; let all = 0;
  for (const s of progression.stages) { moved += s.progressed; all += s.stints; }
  const pooled = all ? moved / all : null;
  return new Map(progression.stages.map(s => [s.stage, s.stints ? s.progressed / s.stints : pooled]));
}

/**
 * Score open opps:
 *   [{ ...opp row from openOppChances, likelihood, moveOn, steps: [{ stage, next, chance, from }] }]
 * `likelihood` is null when the model couldn't be fitted. `steps` is the
 * chain, current stage first ('model'), then each later stage ('history').
 */
export function scoreLikelihood(openRows, progression, model, { nowMs = Date.now() } = {}) {
  const rates = laterRates(progression);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return (openRows || []).map(o => {
    const moveOn = moveOnChance(model, { stage: o.stage, days: o.days, silence: o.silence, age: ageAt(o.r, today) });
    if (moveOn == null) return { ...o, likelihood: null, moveOn: null, steps: [] };
    const steps = [{ stage: o.stage, next: o.next, chance: moveOn, from: 'model' }];
    const at = PROGRESS_STAGES.indexOf(o.stage);
    let p = moveOn;
    for (let i = at + 1; i < PROGRESS_STAGES.length; i += 1) {
      const st = PROGRESS_STAGES[i];
      const c = rates.get(st);
      if (c == null) continue;
      steps.push({ stage: st, next: PROGRESS_STAGES[i + 1] || 'Sold', chance: c, from: 'history' });
      p *= c;
    }
    return { ...o, likelihood: p, moveOn, steps };
  });
}

/**
 * How well the stage-move model sorts the history it learned from: past
 * stints grouped by the chance it gives them, with how many really moved
 * on. Read it as "when it said ~30%, about 30% did". In-sample, so a
 * sanity check rather than a forecast test.
 *   [{ label, lo, hi, n, predicted, actual }]   predicted / actual 0..1
 */
export function calibrationOf(model, stints) {
  if (!model) return [];
  const bins = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0001]].map(([lo, hi]) => ({ lo, hi, n: 0, sumP: 0, moved: 0 }));
  for (const s of stints || []) {
    const p = moveOnChance(model, { stage: s.stage, days: s.days, silence: s.silence, age: ageAt(s.r, s.exitedAt) });
    const bin = bins.find(x => p >= x.lo && p < x.hi);
    bin.n += 1; bin.sumP += p; if (s.progressed) bin.moved += 1;
  }
  return bins.map(x => ({
    label: `${Math.round(x.lo * 100)}-${Math.min(100, Math.round(x.hi * 100))}%`,
    lo: x.lo, hi: Math.min(1, x.hi), n: x.n,
    predicted: x.n ? x.sumP / x.n : null,
    actual: x.n ? x.moved / x.n : null,
  }));
}

/**
 * Which way each input pushes the stage-move chance, for the export: the
 * fitted weight per (standardised) feature. Positive = more likely to move.
 */
export function modelWeights(model) {
  if (!model) return [];
  return FEATURE_NAMES.map((name, j) => ({ Input: name, Weight: Math.round(model.w[j] * 1000) / 1000 }));
}
