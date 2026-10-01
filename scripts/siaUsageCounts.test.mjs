// Assertion tests for the SIA's kWh / Dth as Unit Counts for Per kWh and
// Per Dth fees, and the rate per kWh / Dth per month they give.
// Plain Node - no test framework. Run:
//   node scripts/siaUsageCounts.test.mjs
import { usageCountsFor, withUsageCounts, fmtFeePerUnit, isUsageUnit } from '../src/utils/siaUsageCounts.js';
import { altFeeUnitCount, siaUnitCount } from '../src/utils/altFeeAutoBuild.js';
import { feeStructureRowToAltRow, usageRatesFor, FEE_STRUCTURE_UNITS } from '../src/utils/pricingServices.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}
const near = (label, actual, expected) => check(label, Math.abs(actual - expected) < 1e-9, true);

const o1 = { optionNumber: 1, sheetName: 'Option 1', headerDetails: [{ label: 'Client', value: 'Acme' }, { label: 'Annual kWh', value: '1,000,000' }, { label: 'Annual MMBtu', value: '2,000' }] };
const o2 = { optionNumber: 2, sheetName: 'Option 2', headerDetails: [{ label: 'kWh', value: '500000' }] };
const o3 = { optionNumber: 3, sheetName: 'Option 3', headerDetails: [] };
const opts = [o1, o2, o3];

check('own figures', usageCountsFor(o1, opts), { kwhCount: 1000000, dthCount: 2000 });
check('own kWh, gas from another option', usageCountsFor(o2, opts), { kwhCount: 500000, dthCount: 2000 });
check('none of its own: the first that has them', usageCountsFor(o3, opts), { kwhCount: 1000000, dthCount: 2000 });
check('nothing anywhere', usageCountsFor({ headerDetails: [] }, []), { kwhCount: null, dthCount: null });

const filled = withUsageCounts(opts);
check('options filled', filled.map(o => [o.kwhCount, o.dthCount]), [[1000000, 2000], [500000, 2000], [1000000, 2000]]);
check('same array when nothing changes', withUsageCounts(filled) === filled, true);
check('a count already carried is kept', withUsageCounts([{ ...o3, kwhCount: 7 }])[0].kwhCount, 7);

const counts = { siteCount: 12, accountCount: 30, kwhCount: 1000000, dthCount: 2000 };
check('Per kWh', altFeeUnitCount('Per kWh', counts), 1000000);
check('Per Dth', altFeeUnitCount('Per Dth', counts), 2000);
check('Per Site unchanged', altFeeUnitCount('Per Site', counts), 12);
check('Per kWh with no volume counts as one', altFeeUnitCount('Per kWh', { siteCount: 3 }), 1);
check('siaUnitCount null for Fixed', siaUnitCount('Fixed', counts), null);
check('structure row bills on the kWh', feeStructureRowToAltRow({ feeName: 'Sourcing', unit: 'Per kWh' }, counts).unitCount, 1000000);
check('typed count wins', feeStructureRowToAltRow({ feeName: 'Sourcing', unit: 'Per kWh', unitCount: 5 }, counts).unitCount, 5);
check('units offered', FEE_STRUCTURE_UNITS.includes('Per kWh') && FEE_STRUCTURE_UNITS.includes('Per Dth'), true);

check('usage unit', [isUsageUnit('Per kWh'), isUsageUnit('Per Dth'), isUsageUnit('Per Site')], [true, true, false]);
check('fraction of a cent shown', fmtFeePerUnit(0.0012345, 'Per kWh'), '$0.00123');
check('per site to the cent', fmtFeePerUnit(0.0012345, 'Per Site'), '$0.00');
check('plain', fmtFeePerUnit(1234.5, 'Per Dth', { currency: false }), '1,234.50');

// $1,000 a month of sourcing cost (priced) and a $3,600 setup rolled over a
// 36-month term: $1,100 a month to recover, over 1,000,000 kWh a month.
const costs = [
  { description: 'Sourcing analyst', type: 'Recurring (monthly)', price: 1000, startMonth: 1 },
  { description: 'Sourcing setup', type: 'Setup', price: 3600, startMonth: 1 },
];
const r = usageRatesFor(costs, { termMonths: 36, kwhCount: 1000000, dthCount: 2000 });
near('rate per kWh per month', r.perKwh, 1100 / 1000000);
near('rate per Dth per month', r.perDth, 1100 / 2000);
check('no volume, no rate', usageRatesFor(costs, { termMonths: 36 }), { perKwh: null, perDth: null });
check('no costs, no rate', usageRatesFor([], { termMonths: 36, kwhCount: 5 }), { perKwh: null, perDth: null });

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
