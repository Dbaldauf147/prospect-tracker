// Assertion tests for the Services Pricing coverage figure — the
// "141 services · 29 priced (21%)" line at the top of the rate card.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/pricingCoverage.test.mjs
//
// The count was already there; the share is the part that is easy to get
// subtly wrong, because a percentage has two ends where rounding tells a
// lie. "100% priced" on a card with one service left is the lie that
// matters: it stops the work. So what has to hold is that the three states
// stay apart (a rate, a deliberate zero, and a gap), and that the share
// never reads 0% for a row that IS priced or 100% for a card that isn't.
import { pricingCoverage, sharePct, estimateScope, setNoFee } from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// ── The three states are counted apart ────────────────────────────────
{
  const c = pricingCoverage([
    { priced: true }, { priced: true },
    { priced: true, noFee: true },
    { priced: false },
    // A service the estimate never reached has no line at all. That is a
    // gap, not a crash.
    undefined,
  ]);
  check('priced rows carry a rate', c.priced, 2);
  check('no-fee rows are counted on their own', c.noFee, 1);
  check('a missing line reads as unpriced', c.unpriced, 2);
  check('answered is the two answers together', c.answered, 3);
  check('the total is every service', c.total, 5);
  check('the share is the priced ones over the total', c.pricedPct, 40);
  check('and the answered share counts the giveaways in', c.answeredPct, 60);
  check('an empty card divides by nothing', pricingCoverage([]),
    { total: 0, priced: 0, noFee: 0, answered: 0, unpriced: 0, pricedPct: 0, answeredPct: 0 });
}

// ── Neither end of the percentage lies ────────────────────────────────
{
  check('nothing priced is 0%', sharePct(0, 400), 0);
  check('one of 400 is not "0%"', sharePct(1, 400), 1);
  check('399 of 400 is not "100%"', sharePct(399, 400), 99);
  check('every one of them is', sharePct(400, 400), 100);
  check('one of one is', sharePct(1, 1), 100);
  check('an empty list has no share', sharePct(0, 0), 0);
  check('the middle rounds normally', [sharePct(29, 141), sharePct(1, 3)], [21, 33]);
}

// ── It reads the same states the rate card does ───────────────────────
//
// Not a re-test of the estimate: the point is that the figure is fed by
// estimateScope, so a basis picked with no rate under it is a gap here for
// the same reason it is a gap there, and a no-fee row is an answer.
{
  const rows = [
    { name: 'Priced',   meta: { serviceType: 'Recurring', years: '3 years' } },
    { name: 'BasisOnly',meta: { serviceType: 'Recurring', years: '3 years' } },
    { name: 'Free',     meta: { serviceType: 'Recurring', years: '3 years' } },
    { name: 'Untouched',meta: { serviceType: 'Recurring', years: '3 years' } },
  ];
  const pricing = setNoFee({
    Priced: { basis: 'flat', rate: 1000 },
    // A basis picked and nothing typed against it. Not a price.
    BasisOnly: { basis: 'per_site' },
  }, ['Free']);
  const { lines } = estimateScope({
    rows, services: rows.map(r => r.name), pricing, counts: {}, dealSize: '',
  });
  const c = pricingCoverage(lines);
  check('a rate counts', c.priced, 1);
  check('a basis with no rate under it does not', c.unpriced, 2);
  check('the no-fee mark is an answer, not a price', [c.noFee, c.answered], [1, 2]);
  check('half the card is answered', c.answeredPct, 50);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
