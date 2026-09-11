// Assertion tests for the Indicative Savings tab's European volume
// call-out — which country rows clear 10 GWh/yr of a commodity, and in
// what units the comparison is made.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/europeVolume.test.mjs
//
// Two things are worth pinning down. The units, because electric arrives
// in kWh and gas in decatherms and only one of them is within three
// orders of magnitude of the threshold — get the gas conversion wrong and
// every European gas market either fires or none does. And the basis:
// it's total consumption, not the Deregulated Consumption column, so a
// European country whose sites are all unclassified still gets named.
import {
  EUROPE_VOLUME_GWH,
  annualGWh,
  isLargeEuropeanMarket,
  largeEuropeanMarkets,
  largeEuropeanMarketLabel,
} from '../src/components/SitesView/europeVolume.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

// A European country bucket off the savings table. No `isCountry`: the
// bucket carries that flag but the exported row doesn't, which is exactly
// why the European test reads the row's label instead.
const euCountry = (over = {}) => ({
  state: 'Germany',
  status: 'Deregulated',
  consumption: 0,
  totalConsumption: 0,
  ...over,
});

// ---- Threshold, electric (kWh on the row) --------------------------
check('10 GWh electric does not clear the bar (strictly greater)',
  isLargeEuropeanMarket(euCountry({ totalConsumption: 10_000_000 }), 'electric'), false);
check('10.1 GWh electric clears it',
  isLargeEuropeanMarket(euCountry({ totalConsumption: 10_100_000 }), 'electric'), true);
check('9.9 GWh electric does not',
  isLargeEuropeanMarket(euCountry({ totalConsumption: 9_900_000 }), 'electric'), false);
check('electric kWh converts to GWh',
  annualGWh(euCountry({ totalConsumption: 42_500_000 }), 'electric'), 42.5);

// ---- Threshold, gas (decatherms on the row) ------------------------
// 1 Dth = 293.001 kWh, so 10 GWh is ~34,130 Dth. The failure this guards
// against is comparing the Dth count straight to the kWh threshold,
// which would need 10,000,000 Dth (~2.9 TWh) before anything fired.
check('34,000 Dth of gas is just under 10 GWh',
  isLargeEuropeanMarket(euCountry({ totalConsumption: 34_000 }), 'gas'), false);
check('35,000 Dth of gas clears 10 GWh',
  isLargeEuropeanMarket(euCountry({ totalConsumption: 35_000 }), 'gas'), true);
check('gas Dth converts to GWh via energy content',
  Math.round(annualGWh(euCountry({ totalConsumption: 34_130 }), 'gas') * 100) / 100, 10);
check('the Dth count is not read as kWh',
  isLargeEuropeanMarket(euCountry({ totalConsumption: 100_000 }), 'electric'), false);

// ---- Basis: total consumption, not the deregulated slice -----------
// The common European upload: real load, no utility or supplier per site,
// so the classifier places nothing and Deregulated Consumption is 0.
check('unclassified European load still fires',
  isLargeEuropeanMarket(euCountry({ consumption: 0, totalConsumption: 80_000_000 }), 'electric'), true);

// ---- Scope: which rows are European markets at all -----------------
check('a US state row never fires',
  isLargeEuropeanMarket({ state: 'TX', totalConsumption: 900_000_000 }, 'electric'), false);
check('a non-European country row never fires',
  isLargeEuropeanMarket(euCountry({ state: 'Japan', totalConsumption: 900_000_000 }), 'electric'), false);
check('the synthetic United States aggregate never fires',
  isLargeEuropeanMarket({ state: 'United States', isParent: true, totalConsumption: 900_000_000 }, 'electric'), false);
check('a transcontinental Europe/Asia country counts as European',
  isLargeEuropeanMarket(euCountry({ state: 'Turkey', totalConsumption: 50_000_000 }), 'electric'), true);
check('an aliased country spelling resolves',
  isLargeEuropeanMarket(euCountry({ state: 'UK', totalConsumption: 50_000_000 }), 'electric'), true);
check('a market with no volume never fires',
  isLargeEuropeanMarket(euCountry(), 'electric'), false);

// Reading the row label is only safe while no state / province code
// resolves to a country through the reference table's alias list. If one
// ever does, that state's row starts answering a question about a country.
const STATE_CODES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'];
check('no US state or Canadian province code reads as a European country',
  STATE_CODES.filter(c => isLargeEuropeanMarket({ state: c, totalConsumption: 900_000_000 }, 'electric')).join(','), '');

// ---- The findings list ---------------------------------------------
const rows = [
  euCountry({ state: 'Spain', totalConsumption: 12_000_000 }),
  euCountry({ state: 'Germany', totalConsumption: 42_100_000 }),
  { state: 'TX', totalConsumption: 900_000_000 },
  euCountry({ state: 'Portugal', totalConsumption: 400_000 }),
];
const found = largeEuropeanMarkets(rows, 'electric');
check('only the qualifying European markets are listed', found.length, 2);
check('biggest first', found[0].country, 'Germany');
check('then the next', found[1].country, 'Spain');
check('label reads country + volume', largeEuropeanMarketLabel(found[0]), 'Germany 42.1 GWh');
check('an empty list when nothing qualifies', largeEuropeanMarkets([euCountry()], 'electric').length, 0);
check('the threshold is the documented 10 GWh', EUROPE_VOLUME_GWH, 10);

console.log(failures === 0 ? '\nAll europeVolume tests passed.' : `\n${failures} europeVolume test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
