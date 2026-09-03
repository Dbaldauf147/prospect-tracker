// Assertion tests for the market-coverage warning on the Utility Lookup
// page. Plain Node — no test framework (the project has none). Run:
//   node scripts/marketCoverage.test.mjs
//
// The warning exists because an unclassified site is invisible in the
// figure it moves: it counts in Total Sites and not in Deregulated Sites,
// so a portfolio whose upload carries no utility data reads exactly like
// one with no competitive supply. What these lock in is when that gap is
// worth interrupting for — big enough to change the conclusion, and not a
// handful of stragglers on an otherwise clean upload.
import {
  commodityGap, marketCoverageWarning, marketWarningKey, MARKET_GAP_MIN_SHARE,
} from '../src/components/SitesView/marketCoverage.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// One commodity's tally, in the shape marketSummary builds.
const bucket = (over = {}) => ({
  deregulated: 0, regulated: 0, unknown: 0, unknownNoUtility: 0, unknownNoPlace: 0, ...over,
});

// ---- when a gap is worth showing -------------------------------------------
{
  // The case this was written for: 716 sites, no utility data anywhere, so
  // one country-classified site is the entire "Deregulated Sites" column.
  const almanac = bucket({ deregulated: 1, unknown: 715, unknownNoUtility: 715 });
  const gap = commodityGap(almanac, 716);
  eq([gap.unknown, gap.deregulated, gap.pct], [715, 1, 99], 'the whole-portfolio gap is reported with its share');
  eq(gap.all, false, 'one classified site means it is not quite all of them');
  eq(commodityGap(bucket({ deregulated: 1, unknown: 715, unknownNoUtility: 715 }), 716).pct, 99,
    'the share never rounds up to 100 while a site is still classified');
  eq(commodityGap(bucket({ unknown: 716, unknownNoUtility: 716 }), 716).pct, 100,
    '…and reads 100 only when every site is unclassified');
  eq(commodityGap(bucket({ unknown: 716, unknownNoUtility: 716 }), 716).all, true,
    'and every site unclassified says so');
}

{
  // Below either bar, the gap is a footnote rather than a banner.
  eq(commodityGap(bucket({ deregulated: 400, unknown: 3, unknownNoUtility: 3 }), 700), null,
    'a few stragglers against a real deregulated count stay quiet');
  eq(commodityGap(bucket({ deregulated: 0, unknown: 5, unknownNoPlace: 5 }), 700), null,
    'and so does a gap under the minimum share, even with nothing deregulated');
  eq(commodityGap(bucket({ deregulated: 0, regulated: 700 }), 700), null,
    'a portfolio the classifier placed entirely has no gap at all');

  // The two bars, right at their edges.
  const share = Math.ceil(700 * MARKET_GAP_MIN_SHARE);
  eq(commodityGap(bucket({ deregulated: 0, unknown: share, unknownNoPlace: share }), 700) !== null, true,
    'the minimum share is enough on its own when nothing is deregulated');
  eq(commodityGap(bucket({ deregulated: 100, unknown: 99, unknownNoUtility: 99 }), 700), null,
    'fewer unknowns than deregulated sites is the deregulated count being the story');
  eq(commodityGap(bucket({ deregulated: 100, unknown: 100, unknownNoUtility: 100 }), 700) !== null, true,
    '…and matching it is the gap being the story');
}

{
  eq(commodityGap(null, 700), null, 'no bucket, no gap');
  eq(commodityGap(bucket({ unknown: 5 }), 0), null, 'and no sites, no gap');
}

// ---- the warning across both commodities ------------------------------------
{
  const summary = {
    total: 716,
    electric: bucket({ deregulated: 1, unknown: 715, unknownNoUtility: 715 }),
    gas: bucket({ deregulated: 0, regulated: 716 }),
  };
  const w = marketCoverageWarning(summary);
  eq(w.gaps.map(g => g.key), ['electric'], 'only the commodity with a gap is reported');
  eq(w.gaps[0].label, 'Electric', 'and it carries the label the banner prints');
  eq(w.total, 716, 'the site count both commodities are measured against comes along');

  const both = marketCoverageWarning({
    total: 716,
    electric: bucket({ deregulated: 1, unknown: 715, unknownNoUtility: 715 }),
    gas: bucket({ unknown: 716, unknownNoUtility: 700, unknownNoPlace: 16 }),
  });
  eq(both.gaps.map(g => g.key), ['electric', 'gas'], 'both commodities report when both are short');
  eq([both.gaps[1].noUtility, both.gaps[1].noPlace], [700, 16],
    'the two Unknown reasons stay apart — they have different fixes');
}

{
  eq(marketCoverageWarning(null), null, 'no summary, no warning');
  eq(marketCoverageWarning({ total: 0 }), null, 'an empty page raises nothing');
  eq(marketCoverageWarning({
    total: 700,
    electric: bucket({ deregulated: 400, regulated: 300 }),
    gas: bucket({ deregulated: 400, regulated: 300 }),
  }), null, 'a fully classified portfolio raises nothing');
}

// ---- dismissal key ----------------------------------------------------------
{
  // Dismissing hides the banner until the shape of the gap changes — a new
  // upload, a utility file loaded, a re-mapped column — never forever.
  const a = marketCoverageWarning({ total: 716, electric: bucket({ unknown: 715, unknownNoUtility: 715 }), gas: bucket() });
  const b = marketCoverageWarning({ total: 716, electric: bucket({ unknown: 715, unknownNoUtility: 715 }), gas: bucket() });
  const c = marketCoverageWarning({ total: 716, electric: bucket({ deregulated: 300, unknown: 400, unknownNoUtility: 400 }), gas: bucket() });
  eq(marketWarningKey(a) === marketWarningKey(b), true, 'the same gap keys the same');
  eq(marketWarningKey(a) === marketWarningKey(c), false, 'a gap that shrank keys differently, so the warning comes back');
  eq(marketWarningKey(null), '', 'and no warning has no key');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
