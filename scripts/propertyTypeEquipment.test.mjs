// Assertion tests for the per-property-type equipment estimate. Plain
// Node — no test framework (the project has none). Run:
//   node scripts/propertyTypeEquipment.test.mjs
//
// The table is a reference the user supplied, so most of what can go
// wrong is bookkeeping: a type in one table and not the other, a number
// typed twice, a lookup that answers 0 when it means "no idea". Those
// are what these check.
import {
  EQUIPMENT_ESTIMATES,
  CONSUMPTION_ESTIMATES,
  propertyTypeEquipment,
} from '../src/data/propertyTypeEstimates.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// --- the table lines up with the rest of the reference data -------------
{
  const consumption = Object.keys(CONSUMPTION_ESTIMATES);
  const equipment = Object.keys(EQUIPMENT_ESTIMATES);
  eq(consumption.filter(t => !(t in EQUIPMENT_ESTIMATES)), [],
    'every property type carries an equipment count');
  eq(equipment.filter(t => !(t in CONSUMPTION_ESTIMATES)), [],
    'and no equipment row names a type nothing else knows');
  eq(equipment.filter(t => !Number.isFinite(EQUIPMENT_ESTIMATES[t])), [],
    'every count is a number');
  eq(equipment.filter(t => EQUIPMENT_ESTIMATES[t] < 0), [],
    'and none is negative');
}

// --- the counts as supplied ---------------------------------------------
{
  // Spot-checks at both ends and across the middle, so a transcription
  // slip in the table shows up as a failure rather than as a plausible
  // portfolio total.
  eq(propertyTypeEquipment('University / College Campus'), 750, 'the heaviest site');
  eq(propertyTypeEquipment('Hospital / Healthcare'), 350, 'hospitals');
  eq(propertyTypeEquipment('BTR Residential'), 310, 'BTR');
  eq(propertyTypeEquipment('Multifamily Low-Rise'), 170, 'low-rise multifamily beats mid-rise');
  eq(propertyTypeEquipment('Multifamily Mid-Rise'), 160, 'mid-rise multifamily');
  eq(propertyTypeEquipment('Office - Mid-Rise'), 40, 'mid-rise office');
  eq(propertyTypeEquipment('Retail - High Street'), 7, 'high street retail');
  eq(propertyTypeEquipment('Self-Storage (Non-Climate Controlled)'), 4, 'the lightest site');
}

// --- how a source value gets there --------------------------------------
{
  // The lookup runs through normalizePropertyType, so everything the rest
  // of the app resolves resolves here too.
  eq(propertyTypeEquipment('warehouse'), 28, 'an alias resolves');
  eq(propertyTypeEquipment('Cold Storage'), 55, 'so does another spelling of one');
  eq(propertyTypeEquipment('  data center  '), 200, 'whitespace and case are ignored');
  eq(propertyTypeEquipment('Industrial Heavy Manufacturing Plant'), 120,
    'a longer source string still finds its type');
}

// --- no answer is not zero ----------------------------------------------
{
  eq(propertyTypeEquipment('Cell tower'), null, 'an unrecognized type has no estimate');
  eq(propertyTypeEquipment(''), null, 'nor does a blank');
  eq(propertyTypeEquipment(null), null, 'nor does nothing at all');
  eq(propertyTypeEquipment(undefined), null, 'nor undefined');
  // Land and Debt are the one case where 0 is the answer: there is no
  // building, so there is no equipment in it. A caller can tell the two
  // apart, which is the whole point of returning null above.
  eq(propertyTypeEquipment('Land'), 0, 'land has no equipment, and says so');
  eq(propertyTypeEquipment('Debt'), 0, 'and neither does debt');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
