// Assertion tests for the Utility Lookup Data quality card: per-measure
// thresholds and the sites outside them. Plain Node. Run:
//   node scripts/dataOutliers.test.mjs
import {
  findOutliers, normalizeThresholds, parseBound, DEFAULT_OUTLIER_THRESHOLDS,
} from '../src/components/SitesView/dataOutliers.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

check('blank bound is no bound', parseBound(''), null);
check('commas and dollars are read', parseBound('$2,000,000'), 2000000);
check('junk is no bound', parseBound('abc'), null);

check('missing storage falls back to defaults', normalizeThresholds(null), DEFAULT_OUTLIER_THRESHOLDS);
check('a stored blank stays blank', normalizeThresholds({ sqft: { min: '', max: '10' } }).sqft, { min: '', max: '10' });

const rows = [
  { id: 1, __propertySizeFt2__: 100 },
  { id: 2, __propertySizeFt2__: 50000 },
  { id: 3, __propertySizeFt2__: 9000000 },
  { id: 4 },
  // Actual cost over actual kWh: $0.12.
  { id: 5, __electricCostActual__: 1200, __kwh__: 10000, __kwhSource__: 'kWh' },
  // $4.00 a kWh: a unit mix-up.
  { id: 6, __electricCostActual__: 40000, __kwh__: 10000, __kwhSource__: 'kWh' },
  // Estimated kWh: not measured, whatever the cost says.
  { id: 7, __electricCostActual__: 40000, __kwh__: 10000, __kwhFromEstimate__: true },
  // Estimated cost: the state rate by construction, never measured.
  { id: 8, __electricCostEstimated__: 1, __kwh__: 10000, __kwhSource__: 'kWh' },
  // Gas: $0.10 a therm, below the default floor.
  { id: 9, __gasCostActual__: 100, __therms__: 1000, __thermsSource__: 'Therms' },
  { id: 10, __gasCostActual__: 1000, __therms__: 1000, __thermsSource__: 'Therms' },
];

const r = findOutliers(rows, DEFAULT_OUTLIER_THRESHOLDS);
check('sqft measured', r.sqft.measured, 3);
check('sqft low / high', [r.sqft.low, r.sqft.high], [1, 1]);
check('sqft ids', [...r.sqft.ids], [1, 3]);
check('sqft range', [r.sqft.min, r.sqft.max], [100, 9000000]);
check('kWh rate only where both are actual', r.ratePerKwh.measured, 2);
check('kWh rate outlier', [...r.ratePerKwh.ids], [6]);
check('therm rate outlier', [...r.ratePerTherm.ids], [9]);
check('therm low', r.ratePerTherm.low, 1);

const open = findOutliers(rows, { sqft: { min: '', max: '' }, ratePerKwh: { min: '', max: '' }, ratePerTherm: { min: '', max: '' } });
check('no bounds, no outliers', [open.sqft.ids.size, open.ratePerKwh.ids.size, open.ratePerTherm.ids.size], [0, 0, 0]);
check('no bounds still measures', open.sqft.measured, 3);

check('no rows', findOutliers([], DEFAULT_OUTLIER_THRESHOLDS).sqft, { measured: 0, low: 0, high: 0, ids: {}, min: null, max: null });

console.log(`dataOutliers: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
