// Assertion tests for Year 1 read off the rate card alone — the two columns
// the Services Pricing subtab shows. Plain Node — no test framework (the
// project has none). Run:
//   node scripts/year1FromCard.test.mjs
//
// The column answers "what does this service cost in its first year?" from
// the card and nothing else: no counts, no deal size, nothing the estimator
// holds. That is the whole distinction against Deal Pricing's Estimated
// Year 1 Fee, which has an account's counts to multiply by and says what one
// deal will pay.
//
// Which makes the question here "what can be added to what". Money of the
// same shape adds — an annual and a setup fee are both plain figures, and
// the first invoice pays both — and money of different shapes does not: a
// per-site rate and a flat setup cannot be one number without a site count,
// and inventing one would be the exact mistake this column exists to avoid.
import { formatYear1, pricingFor, year1FromCard } from '../src/utils/servicePricing.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// The card as the tab reads it, which is the shape both functions take.
const card = (stored) => pricingFor({ S: stored }, 'S');
const low = (stored) => formatYear1(card(stored));
const high = (stored) => formatYear1(card(stored), undefined, 'hi');

// ── Setup plus the ongoing fee, where they can be added ───────────────
{
  check('an annual and its setup are one figure',
    low({ basis: 'recurring_annual', rate: 42000, setupLines: [{ basis: 'flat', rate: 8000 }] }),
    '$50,000');
  check('a flat fee with no setup is just the fee',
    low({ basis: 'flat', rate: 45000 }), '$45,000');
  check('a service that is nothing but setup says so',
    low({ setupLines: [{ basis: 'flat', rate: 45000 }] }), '$45,000 setup');
  // Both are charged against the same count, so year one is the sum per unit.
  check('a per-site fee and a per-site setup add per site',
    low({ basis: 'per_site', rate: 625, setupLines: [{ basis: 'per_site', rate: 75 }] }),
    '$700/site');
  check('an empty card has nothing to say', low({}), '');
}

// ── …and where they can't ─────────────────────────────────────────────
{
  // The case the column exists to get right: adding these would need a site
  // count, and the rate card doesn't have one.
  check('a per-site fee and a flat setup stay side by side',
    low({ basis: 'per_site', rate: 625, setupLines: [{ basis: 'flat', rate: 5000 }] }),
    '$625/site + $5,000 setup');
  check('two different counts are two parts',
    low({ basis: 'per_site', rate: 100, lines: [{ basis: 'per_meter', rate: 9 }] }),
    '$100/site + $9/meter');
  // Mandated sites are their own count, not a share of the site count, so
  // they do not fold into the per-site part.
  check('per site and per site w/ mandate are two counts',
    low({ basis: 'per_site', rate: 100, lines: [{ basis: 'per_site_mandate', rate: 40 }] }),
    '$100/site + $40/site w/ mandate');
  check('a percentage of the deal keeps its own wording',
    low({ basis: 'pct_deal', rate: 3, setupLines: [{ basis: 'flat', rate: 12000 }] }),
    '3% of deal size + $12,000 setup');
  // "setup" names a part that is nothing else. Where setup and fee were
  // added, the sum is not setup and must not say it is.
  const parts = year1FromCard(card({
    basis: 'per_site', rate: 625, setupLines: [{ basis: 'per_site', rate: 75 }, { basis: 'flat', rate: 5000 }],
  })).parts;
  check('a merged part is marked as both, a setup-only part as setup alone',
    parts.map(p => [p.ongoing, p.setup]), [[true, true], [false, true]]);
}

// ── The high end is only there when the card quotes one ───────────────
{
  check('no range on the card means no high figure at all',
    high({ basis: 'per_site', rate: 625, setupLines: [{ basis: 'flat', rate: 5000 }] }), '');
  check('a range on the fee gives both ends',
    [low({ basis: 'per_site', rate: 625, rateHigh: 825 }), high({ basis: 'per_site', rate: 625, rateHigh: 825 })],
    ['$625/site', '$825/site']);
  // A single rate with a setup range is still a range in year one, which is
  // the case a high end read off the fee alone would miss.
  check('a range on the setup alone still gives a high figure',
    [
      low({ basis: 'recurring_annual', rate: 42000, setupLines: [{ basis: 'flat', rate: 8000, rateHigh: 15000 }] }),
      high({ basis: 'recurring_annual', rate: 42000, setupLines: [{ basis: 'flat', rate: 8000, rateHigh: 15000 }] }),
    ],
    ['$50,000', '$57,000']);
  // A high end typed below the low one is a typo, read low-to-high — the
  // same reading the estimate gives it.
  check('an inverted range is read the right way round',
    [low({ basis: 'flat', rate: 900, rateHigh: 600 }), high({ basis: 'flat', rate: 900, rateHigh: 600 })],
    ['$600', '$900']);
}

// ── Nothing from the deal reaches this ────────────────────────────────
{
  // Counts are the estimator's, not the card's: the same card reads the same
  // way whatever any deal has in its boxes. (Nothing here takes counts at
  // all — this pins that the signature stays that way.)
  check('the figure takes the card and the bases, nothing else',
    formatYear1.length <= 3, true);
  check('a card with units typed against it prices the same',
    low({ basis: 'per_site', rate: 625, units: 20 }), '$625/site');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
