// Assertion tests for contract-price unit detection — what the Utility
// Lookup page's "contract price isn't in the unit we're reading it as"
// warning fires on. Plain Node — no test framework (the project has none).
// Run:
//   node scripts/contractPriceUom.test.mjs
//
// The warning is only worth anything if it's quiet when nothing is wrong.
// Most of what's below is that half: headers that name a unit for something
// other than the price, unreadable unit strings, and the plain canonical
// cases all have to resolve as "nothing to say".
import {
  normalizeElectricPriceUom, normalizeGasPriceUom,
  resolveContractPriceUom, priceUomLabel, CANONICAL_PRICE_UOM,
  summarizePriceUomFlags,
} from '../src/utils/utilityRates.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ---- normalization ------------------------------------------------------

eq(normalizeElectricPriceUom('kWh'), 'kWh', 'electric: kWh');
eq(normalizeElectricPriceUom('$/MWh'), 'MWh', 'electric: $/MWh');
eq(normalizeElectricPriceUom('  Megawatt hour '), 'MWh', 'electric: spelled-out megawatt');
eq(normalizeElectricPriceUom('therms'), '', 'electric: a gas unit is not an electric one');
eq(normalizeElectricPriceUom(''), '', 'electric: blank reads as nothing said');
eq(normalizeElectricPriceUom('per unit'), '', 'electric: unreadable reads as nothing said');

eq(normalizeGasPriceUom('therm'), 'therm', 'gas: therm');
eq(normalizeGasPriceUom('Therms'), 'therm', 'gas: plural therms normalize to the singular denominator');
eq(normalizeGasPriceUom('Dth'), 'Dth', 'gas: Dth');
eq(normalizeGasPriceUom('dekatherm'), 'Dth', 'gas: spelled-out dekatherm');
eq(normalizeGasPriceUom('MMBtu'), 'MMBtu', 'gas: MMBtu');
eq(normalizeGasPriceUom('$/MMBtu'), 'MMBtu', 'gas: MMBtu is not mistaken for anything else');
eq(normalizeGasPriceUom('Mcf'), 'Mcf', 'gas: Mcf');
eq(normalizeGasPriceUom('Ccf'), 'Ccf', 'gas: Ccf');
eq(normalizeGasPriceUom('MWh'), 'MWh', 'gas: gas priced per MWh (as the template offers)');
eq(normalizeGasPriceUom('n/a'), '', 'gas: unreadable reads as nothing said');

// ---- resolution ---------------------------------------------------------

const res = (commodity, opts) => resolveContractPriceUom(commodity, opts);

eq(res('electric', {}), { unit: 'kWh', source: 'default', canonical: true },
  'nothing said: the assumed unit stands and nothing is flagged');
eq(res('gas', {}), { unit: 'therm', source: 'default', canonical: true },
  'gas assumes $/therm');

eq(res('gas', { cellValue: 'Dth' }), { unit: 'Dth', source: 'column', canonical: false },
  'a UoM column naming Dth is flagged as not canonical');
eq(res('electric', { cellValue: 'MWh' }), { unit: 'MWh', source: 'column', canonical: false },
  'a UoM column naming MWh is flagged');
eq(res('electric', { cellValue: 'kWh' }), { unit: 'kWh', source: 'column', canonical: true },
  'a UoM column naming the canonical unit is not flagged');

eq(res('electric', { header: 'Electric Contract Price ($/MWh)' }),
  { unit: 'MWh', source: 'header', canonical: false },
  'the price column header is read when there is no UoM column');
eq(res('gas', { header: 'Gas Supply Rate per Dth' }),
  { unit: 'Dth', source: 'header', canonical: false },
  '"per Dth" in the header counts');
eq(res('gas', { header: 'Gas Contract Price (Dth)' }),
  { unit: 'Dth', source: 'header', canonical: false },
  'a parenthesised unit counts');
eq(res('gas', { header: 'Gas Contract Price (per Dth)' }),
  { unit: 'Dth', source: 'header', canonical: false },
  'a bracket whose first word is "per" does not swallow the unit behind it');
eq(res('electric', { header: 'Electric Contract Price (USD)' }),
  { unit: 'kWh', source: 'default', canonical: true },
  'a currency in the header is not a unit');
eq(res('electric', { header: 'Electric Contract Price ($ per MWh)' }),
  { unit: 'MWh', source: 'header', canonical: false },
  'a currency ahead of the unit does not hide it');

// The UoM column beats the header — that's the whole point of the column.
eq(res('gas', { cellValue: 'therm', header: 'Gas Contract Price ($/Dth)' }),
  { unit: 'therm', source: 'column', canonical: true },
  'an explicit UoM column overrides a header that disagrees');

// Quiet where it should be quiet.
eq(res('gas', { header: 'Gas Contract Price' }),
  { unit: 'therm', source: 'default', canonical: true },
  'a header with no unit in it says nothing');
eq(res('gas', { header: 'Gas Contract Price', cellValue: 'gallons' }),
  { unit: 'therm', source: 'default', canonical: true },
  'an unreadable unit is not reported as a mismatch — that would be a claim we can\'t make');
eq(res('gas', { header: 'Gas Annual Consumption Dth' }),
  { unit: 'therm', source: 'default', canonical: true },
  'a unit naming the CONSUMPTION column, not a price, is ignored');
eq(res('electric', { header: 'Electric Contract Price ($/kWh)' }),
  { unit: 'kWh', source: 'header', canonical: true },
  'a header naming the canonical unit is not flagged');

eq(priceUomLabel('gas', 'Dth'), '$/Dth', 'label renders the resolved unit');
eq(priceUomLabel('electric', ''), '$/kWh', 'label falls back to the canonical unit');
eq(CANONICAL_PRICE_UOM, { electric: 'kWh', gas: 'therm' }, 'the canonical units are kWh and therm');

// ---- the page-level summary --------------------------------------------
// What the warning chip on the Utility Lookup header actually says.

const site = (electric, gas) => ({
  electric: electric ? res('electric', electric) : null,
  gas: gas ? res('gas', gas) : null,
});

eq(summarizePriceUomFlags([]), null, 'no sites: nothing to warn about');
eq(summarizePriceUomFlags([site(null, null), site(null, null)]), null,
  'sites with no contract price at all: nothing to warn about');
eq(summarizePriceUomFlags([site({ cellValue: 'kWh' }, { cellValue: 'therm' })]), null,
  'prices already in the assumed units: no warning');
eq(summarizePriceUomFlags([site(null, { cellValue: 'gallons' })]), null,
  'an unreadable unit raises nothing — the page cannot claim it is wrong');

eq(summarizePriceUomFlags([
  site(null, { cellValue: 'Dth' }),
  site(null, { cellValue: 'Dth' }),
  site({ cellValue: 'MWh' }, { cellValue: 'MMBtu' }),
  site({ cellValue: 'kWh' }, { cellValue: 'therm' }),
]), {
  total: 4,
  detail: 'Electric: 1 $/MWh (read as $/kWh) · Gas: 2 $/Dth, 1 $/MMBtu (read as $/therm)',
}, 'the summary counts each mis-quoted price and names the units, commonest first');

eq(summarizePriceUomFlags([site({ header: 'Electric Contract Price ($/MWh)' }, null)]), {
  total: 1,
  detail: 'Electric: 1 $/MWh (read as $/kWh)',
}, 'a unit found in the column header counts the same as one in a UoM column');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
