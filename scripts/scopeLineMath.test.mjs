// The working behind one service's price, as the popup off a scope bullet
// prints it.
//
// The panel has exactly one job beyond looking tidy: THE STEPS ADD UP TO
// YEAR ONE. It exists because somebody wants to check a range before they
// quote it, and a breakdown that doesn't foot to the figure it explains
// sends them away trusting neither number.
//
// Four ways that goes quietly wrong.
//
//   1. Setup. It is one-time money charged on the same bases the fee is,
//      and year one pays both. Leave it out of the steps and every deal
//      with a setup fee is short by it.
//   2. A percentage. Its cut is of the bundle the service rides in, not of
//      the deal on the bar, so the base has to be recovered from the fee
//      rather than read off the estimator - otherwise the panel prints an
//      arithmetic that doesn't produce the number beside it.
//   3. A minimum fee. Money the estimator adds that no rate line accounts
//      for. Folded into a rate it would misstate the rate; left out it
//      would break the sum.
//   4. The unpriced and the no-fee. Both have no working, and they are not
//      the same claim: one is unknown and one is free.
//
// Run: node scripts/scopeLineMath.test.mjs
import { estimateScope, PRICING_BASES } from '../src/utils/servicePricing.js';
import { scopeLineMath } from '../src/utils/scopeLineMath.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${actual}\n      want: ${expected}`}`);
}

const bases = PRICING_BASES;
const recurring = { serviceType: 'recurring', years: 3 };
// A project that runs for a term: the job is done once and the annual
// beside it keeps billing, which is the case the two totals disagree on.
const project = { serviceType: 'project', years: 3 };
const rows = [
  { name: 'Bill payment', bucket: 'DATA', meta: recurring },
  { name: 'Client management', bucket: 'DATA', meta: recurring },
  { name: 'Retrofit', bucket: 'DATA', meta: project },
  { name: 'Bespoke consulting', bucket: 'DATA', meta: recurring },
  { name: 'Portal access', bucket: 'DATA', meta: recurring },
];
const pricing = {
  // 100 sites at $400-$800 a site, plus a flat $10,000 to stand it up.
  'Bill payment': {
    basis: 'per_site', rate: 400, rateHigh: 800,
    setupLines: [{ basis: 'flat', rate: 10000 }],
  },
  // A cut of the deal it rides in, which is the bill payment above and not
  // the scope total.
  'Client management': { basis: 'pct_deal', rate: 10, rateHigh: 20 },
  // A job, and the annual that keeps it running: two lines, two kinds of
  // money, one service.
  'Retrofit': {
    basis: 'flat', rate: 180000,
    lines: [{ basis: 'recurring_annual', rate: 12000 }],
  },
  'Bespoke consulting': {},
  'Portal access': { noFee: true },
};
const counts = { sites: 100 };
const scope = ['Bill payment', 'Client management', 'Retrofit', 'Bespoke consulting', 'Portal access'];
// Client management's cut is of the bill payment deal, priced low-to-high.
const dealSizeByService = new Map([['Client management', { low: 40000, high: 80000 }]]);
const estimate = estimateScope({
  rows, services: scope, pricing, counts, bases, dealSizeByService,
});
const byName = new Map(estimate.lines.map(l => [l.name, l]));
const mathFor = (name) => scopeLineMath(byName.get(name), {
  bases, dealTotal: estimate.year1Total,
});

// ---- the steps add up to year one ----------------------------------------
{
  for (const name of scope) {
    const m = mathFor(name);
    if (!m.priced) continue;
    const low = Math.round(m.steps.reduce((n, s) => n + s.low, 0) * 100) / 100;
    const high = Math.round(m.steps.reduce((n, s) => n + s.high, 0) * 100) / 100;
    check(`${name}: the steps foot to year one`, low, m.year1);
    check(`${name}: and at the top of the range`, high, m.year1High);
  }
}

// ---- and year one is the figure the bullet shows --------------------------
{
  const summed = scope.reduce((n, name) => n + (mathFor(name).year1 || 0), 0);
  check('every popup together is the deal on the bar', summed, estimate.year1Total);
}

// ---- a per-unit line prints the rate and the count ------------------------
{
  const m = mathFor('Bill payment');
  const fee = m.steps.find(s => s.key === 'fee:per_site');
  check('the rate and the count are both on the line', fee.math, '$400–$800 per site × 100');
  check('the low end is the low rate on that count', fee.low, 40000);
  check('and the high end the high rate', fee.high, 80000);
  check('a per-site fee bills again next year', fee.when, 'Every year');
  check('the count says where it came from', fee.source, 'Sites taken from the shared count above the table');
}

// ---- setup is a step of its own, billed once -----------------------------
{
  const m = mathFor('Bill payment');
  const setup = m.steps.find(s => s.key === 'setup:flat');
  check('the setup fee is its own step', setup.low, 10000);
  check('marked as one-time', setup.when, 'Once, to set up');
  check('and it is the last step, where the invoice puts it', m.steps[m.steps.length - 1].key, 'setup:flat');
  check('year one carries it', m.year1, 50000);
  check('but the annual does not', m.recurring, 40000);
  check('and the term bills it once, not three times', m.contract, 40000 * 3 + 10000);
}

// ---- a percentage names the deal it is a cut OF --------------------------
{
  const m = mathFor('Client management');
  const fee = m.steps.find(s => s.key === 'fee:pct_deal');
  // 10% of $40,000 and 20% of $80,000 - the bundle it rides in, not the
  // $240,000-odd scope on the bar.
  check('the cut is priced against its own bundle', fee.math, '10%–20% of $40,000 – $80,000');
  check('which produces the figure beside it', fee.low, 4000);
  check('at both ends', fee.high, 16000);
}

// ---- two lines, two kinds of money ---------------------------------------
{
  const m = mathFor('Retrofit');
  check('a service priced on two lines shows two steps', m.steps.length, 2);
  const job = m.steps.find(s => s.key === 'fee:flat');
  const annual = m.steps.find(s => s.key === 'fee:recurring_annual');
  check('the job is billed once', job.when, 'Once');
  check('the annual beside it is not', annual.when, 'Every year');
  check('and it says so in words', annual.math, '$12,000 a year');
  check('year one pays both', m.year1, 192000);
  check('the term runs the annual out and the job once', m.contract, 180000 + 12000 * 3);
}

// ---- unknown is not free -------------------------------------------------
{
  const m = mathFor('Bespoke consulting');
  check('a service the card cannot price has no working', m.steps.length, 0);
  check('and no figure', m.year1, null);
  check('it says what is missing', m.note, 'No pricing basis set');
  check('and it is not a no-fee service', m.noFee, false);
}

// ---- free is not unknown -------------------------------------------------
{
  const m = mathFor('Portal access');
  check('a no-fee service is priced, at nothing', m.priced, true);
  check('it is marked as given away', m.noFee, true);
  check('with nothing to work out', m.steps.length, 0);
  check('and no share of the deal', m.share, 0);
}

// ---- a count nobody entered says so --------------------------------------
{
  const noCounts = estimateScope({
    rows, services: ['Bill payment'], pricing, counts: {}, bases,
  });
  const m = scopeLineMath(noCounts.lines[0], { bases, dealTotal: noCounts.year1Total });
  const fee = m.steps.find(s => s.key === 'fee:per_site');
  check('a line with no count to multiply names the gap', fee.note, 'No sites entered');
  check('and prices at nothing rather than at a guess', fee.low, 0);
  // The setup fee is flat, so it stands up on its own: year one is real
  // money even though the per-site line came to nothing.
  check('the steps still foot', m.steps.reduce((n, s) => n + s.low, 0), m.year1);
}

// ---- the share matches the row the popup opened from ----------------------
{
  const m = mathFor('Bill payment');
  check('the share is of the deal, rounded as the panel rounds it',
    m.share, Math.round((m.year1 / estimate.year1Total) * 100));
}

// ---- junk is not a line --------------------------------------------------
{
  check('null is not a line', scopeLineMath(null), null);
  check('and neither is an object without a name', scopeLineMath({ priced: true }), null);
}

console.log(`\n${failures ? `${failures} FAILED` : 'All passed'}`);
process.exit(failures ? 1 : 0);
