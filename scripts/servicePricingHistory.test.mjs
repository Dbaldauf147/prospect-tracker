// The day-by-day record behind Dropdowns > Service Pricing History
// (utils/servicePricingHistory). Plain Node. Run:
//   node scripts/servicePricingHistory.test.mjs
import assert from 'node:assert/strict';
import {
  readingFromCoverage, withServicePricingReading, previousDay,
  servicePricingCoverage, servicePricingHistoryRows,
} from '../src/utils/servicePricingHistory.js';
import { pricingCoverage } from '../src/utils/servicePricing.js';

const cov = (priced, noFee, total = 142) => pricingCoverage([
  ...Array.from({ length: priced }, () => ({ priced: true })),
  ...Array.from({ length: noFee }, () => ({ noFee: true })),
  ...Array.from({ length: total - priced - noFee }, () => ({})),
]);

const r = readingFromCoverage(cov(38, 18));
assert.deepEqual(
  { total: r.total, priced: r.priced, noFee: r.noFee, answered: r.answered, answeredPct: r.answeredPct },
  { total: 142, priced: 38, noFee: 18, answered: 56, answeredPct: 39 },
);
assert.equal(readingFromCoverage(null), null);
assert.equal(readingFromCoverage(cov(0, 0, 0)), null, 'nothing tracked is no reading');

assert.equal(previousDay('2026-10-21'), '2026-10-20');
assert.equal(previousDay('2026-10-19'), '2026-10-18', 'calendar day, weekends included');
assert.equal(previousDay('2026-03-01'), '2026-02-28');

// The first reading is also yesterday, seeded.
const h1 = withServicePricingReading({}, '2026-10-21', r, 100);
assert.deepEqual(Object.keys(h1).sort(), ['2026-10-20', '2026-10-21']);
assert.equal(h1['2026-10-20'].seeded, true);
assert.equal(h1['2026-10-20'].answeredPct, 39);
assert.ok(!h1['2026-10-21'].seeded);
// Unchanged: same object, no write.
assert.equal(withServicePricingReading(h1, '2026-10-21', readingFromCoverage(cov(38, 18)), 200), h1);
// The seed follows the day's reading while it is the only real one.
const h2 = withServicePricingReading(h1, '2026-10-21', readingFromCoverage(cov(40, 18)), 300);
assert.equal(h2['2026-10-21'].priced, 40);
assert.equal(h2['2026-10-20'].priced, 40);
// Next day: a real earlier day exists, so yesterday is left as it was.
const h3 = withServicePricingReading(h2, '2026-10-22', readingFromCoverage(cov(45, 20)), 400);
assert.equal(h3['2026-10-21'].priced, 40);
assert.equal(h3['2026-10-22'].priced, 45);
assert.ok(!h3['2026-10-21'].seeded);
assert.deepEqual(servicePricingHistoryRows(h3).map(x => x.iso), ['2026-10-20', '2026-10-21', '2026-10-22']);

// Off the default settings it is a real reading, over the tracked services.
const c = servicePricingCoverage({});
assert.ok(c.total > 0, 'the built-in service list is tracked');
assert.equal(c.answered, c.priced + c.noFee);

console.log('servicePricingHistory: ok');
