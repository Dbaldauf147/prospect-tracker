// Assertion tests for the per-property-type utility-account estimate — the
// figure the Utility Lookup headline reports, the saved site list carries,
// and (now) the Master Analysis' Site Detail sheet shows per site. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/propertyTypeAccounts.test.mjs
//
// The total is not a plain sum of numbers: the reference table's cells are
// labels ("Multiple", "0 – 1", "N/A") standing in for counts, and the
// roll-up rule behind them (3 / 0.5 / 0) is what these pin down. A Site
// Detail cell reading 3.5 has to be defensible.
import {
  propertyTypeAccountTotal,
  propertyTypeAccounts,
  ACCOUNT_ESTIMATES,
  CONSUMPTION_ESTIMATES,
} from '../src/data/propertyTypeEstimates.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// --- the table lines up with the rest of the reference data -------------
{
  eq(Object.keys(CONSUMPTION_ESTIMATES).filter(t => !(t in ACCOUNT_ESTIMATES)), [],
    'every property type carries account estimates');
  eq(Object.keys(ACCOUNT_ESTIMATES).filter(t => !(t in CONSUMPTION_ESTIMATES)), [],
    'and no account row names a type nothing else knows');
}

// --- the totals, commodity by commodity ---------------------------------
{
  // Water 1 + Steam 0 + Gas N/A + Electric 2 + Waste 1.
  eq(propertyTypeAccountTotal('Data Center'), 4, 'an N/A commodity contributes nothing');

  // Water 8 + Steam N/A + Gas Multiple + Electric Multiple + Waste 1,
  // with "Multiple" standing in for 3 on each side.
  eq(propertyTypeAccountTotal('University / College Campus'), 15, '"Multiple" counts as 3');

  // Water 1 + Steam 0 + Gas "0 – 1" + Electric 1 + Waste 1: the range is
  // its midpoint, which is why this column carries decimals.
  eq(propertyTypeAccountTotal('Non-Refrigerated Warehouse'), 3.5, 'a "0 – 1" range counts as its midpoint');

  // Water 1 + Steam 0 + Gas 1 + Electric 1 + Waste 1 — the ordinary case.
  eq(propertyTypeAccountTotal('Office - High-Rise'), 4, 'a site billed once per commodity totals four');

  // Every cell N/A: a real zero, for a tenant who is billed for nothing.
  eq(propertyTypeAccountTotal('Office Occupier'), 0, 'an occupier with no bills totals zero');
}

// --- no answer is not zero ----------------------------------------------
{
  eq(propertyTypeAccountTotal('Cell tower'), null, 'an unrecognized type has no estimate');
  eq(propertyTypeAccountTotal(''), null, 'nor does a blank');
  eq(propertyTypeAccountTotal(null), null, 'nor does nothing at all');
  eq(propertyTypeAccounts('warehouse')?.electric?.count, 1, 'an alias resolves to its row');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
