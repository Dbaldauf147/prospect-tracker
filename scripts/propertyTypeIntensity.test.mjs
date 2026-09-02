// Assertion tests for the per-square-foot energy intensities the Master
// Analysis' Site Detail tab benchmarks each site against. Plain Node.
// Run:  node scripts/propertyTypeIntensity.test.mjs
import {
  propertyTypeIntensity, varianceVsEstimate, estimateConsumption,
  CONSUMPTION_ESTIMATES, KWH_PER_DTH,
} from '../src/data/propertyTypeEstimates.js';

let pass = 0, fail = 0;
const ok = (c, n) => c ? (pass++, console.log('PASS ', n)) : (fail++, console.log('FAIL ', n));
const near = (a, b, n, tol = 1e-6) =>
  ok(typeof a === 'number' && Math.abs(a - b) <= tol, `${n} (got ${a}, want ~${b})`);

// --- reference intensities -------------------------------------------------
// Straight division of the reference profile by its reference size.
const dc = propertyTypeIntensity('Data Center');
near(dc.electricKwhPerFt2, 300, 'Data Center: 30,000,000 kWh / 100,000 ft² = 300');
near(dc.gasDthPerFt2, 0.005, 'Data Center: 500 Dth / 100,000 ft²');
near(dc.totalKwhPerFt2, 301.46542, 'Data Center total intensity');

const mid = propertyTypeIntensity('Office - Mid-Rise');
near(mid.electricKwhPerFt2, 20, 'Office - Mid-Rise: 4,000,000 kWh / 200,000 ft² = 20');
near(mid.gasDthPerFt2, 0.035, 'Office - Mid-Rise: 7,000 Dth / 200,000 ft²');
ok(mid.category === 'Medium', 'intensity carries the type category');
ok(mid.referenceSizeFt2 === 200_000, 'intensity carries the reference size');

// Alias resolution rides on the same normalizer the estimates use.
near(
  propertyTypeIntensity('mid rise office').electricKwhPerFt2, 20,
  'aliases resolve ("mid rise office")'
);

// --- no profile -> no benchmark --------------------------------------------
ok(propertyTypeIntensity('Land') === null, 'Land has no intensity');
ok(propertyTypeIntensity('Debt') === null, 'Debt has no intensity');
ok(propertyTypeIntensity('Nonsense Type 1234') === null, 'unrecognized type -> null');
ok(propertyTypeIntensity('') === null, 'empty type -> null');
ok(propertyTypeIntensity(null) === null, 'null type -> null');

// --- every profiled type produces a finite, positive intensity -------------
{
  const profiled = Object.entries(CONSUMPTION_ESTIMATES).filter(([, v]) => v.electricKwh != null);
  ok(profiled.length === 32, `32 property types carry a consumption profile (got ${profiled.length})`);
  const bad = profiled.filter(([name]) => {
    const i = propertyTypeIntensity(name);
    return !i || !Number.isFinite(i.electricKwhPerFt2) || i.electricKwhPerFt2 <= 0
      || !Number.isFinite(i.totalKwhPerFt2) || i.totalKwhPerFt2 <= 0;
  });
  ok(bad.length === 0, `every profiled type has a positive intensity (bad: ${bad.map(b => b[0]).join(', ')})`);
}

// --- intensity is size-invariant -------------------------------------------
// The whole point of the benchmark: estimateConsumption scales linearly, so a
// site of any square footage estimated from a type lands exactly on that
// type's intensity. That is what makes a 0% variance the signature of a
// modelled row on the Site Detail sheet.
{
  const bench = propertyTypeIntensity('Laboratory / R&D');
  for (const size of [10_000, 80_000, 250_000]) {
    const est = estimateConsumption('Laboratory / R&D', size);
    near(est.electricKwh / size, bench.electricKwhPerFt2, `lab @ ${size} ft²: electric intensity = reference`, 0.01);
    near((est.gasDth / 1) / size, bench.gasDthPerFt2, `lab @ ${size} ft²: gas intensity = reference`, 0.001);
    near(
      varianceVsEstimate(est.electricKwh / size, bench.electricKwhPerFt2), 0,
      `lab @ ${size} ft²: modelled usage varies 0% from its own estimate`, 0.001
    );
  }
}

// --- the Dth -> kWh factor matches the reference table ---------------------
// The Site Detail total intensity converts a site's own Dth with KWH_PER_DTH;
// the estimate side it is compared against uses the table's pre-computed
// gasKwh. If the two drifted apart, every total-intensity variance would
// carry a constant bias.
{
  const worst = Object.entries(CONSUMPTION_ESTIMATES)
    .filter(([, v]) => v.gasDth > 0)
    .map(([name, v]) => [name, Math.abs(v.gasDth * KWH_PER_DTH - v.gasKwh) / v.gasKwh])
    .sort((a, b) => b[1] - a[1])[0];
  ok(worst[1] < 0.0005, `KWH_PER_DTH reproduces the table's gasKwh within 0.05% (worst: ${worst[0]}, ${(worst[1] * 100).toFixed(4)}%)`);
}

// --- variance --------------------------------------------------------------
near(varianceVsEstimate(25, 20), 0.25, '25 vs 20 -> +25%');
near(varianceVsEstimate(15, 20), -0.25, '15 vs 20 -> -25%');
near(varianceVsEstimate(20, 20), 0, '20 vs 20 -> 0%');
ok(varianceVsEstimate(null, 20) === null, 'no measured value -> null, not 0%');
ok(varianceVsEstimate(20, null) === null, 'no estimate -> null');
ok(varianceVsEstimate(20, 0) === null, 'zero estimate -> null rather than Infinity');
ok(varianceVsEstimate(NaN, 20) === null, 'NaN measured -> null');
ok(varianceVsEstimate(0, 20) === -1, 'a measured zero is -100%, not "no answer"');

// Sub-0.01% noise snaps to a clean zero. The export's '+0%;-0%;0%' format
// only reaches its third section on an exact 0, so an unrounded -1.8e-5
// prints as "-0%" on a site that is sitting exactly on its own estimate.
{
  const lab = propertyTypeIntensity('Laboratory / R&D');
  const est = estimateConsumption('Laboratory / R&D', 40_000);
  const total = est.electricKwh + (est.gasDth * KWH_PER_DTH);
  const v = varianceVsEstimate(total / 40_000, lab.totalKwhPerFt2);
  ok(Object.is(v, 0), `a site modelled off the table shows exactly 0% total variance (got ${v})`);
  ok(varianceVsEstimate(20.001, 20) === 0.0001, 'a 0.01% gap survives rounding');
  ok(varianceVsEstimate(20.2, 20) === 0.01, 'a 1% gap is unaffected');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
