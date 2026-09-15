// Assertion tests for the savings bands behind Utility Lookup > Market
// Savings.
// Plain Node - no test framework (the project has none). Run:
//   node scripts/marketSavings.test.mjs
//
// Two things are worth pinning down here, and both are about money.
//
// The first is that an override reaches the band and stops there. Typing a
// percentage has to change what a market earns, on every surface, or the
// tab is decoration. It must NOT change whether the market is competitive:
// that status decides which sites count as deregulated, which tier a
// market lands in, and what the exports say about the market itself, and a
// seller adjusting a percentage is not making a claim about any of that.
//
// The second is that the shipped tables survive being read. They are plain
// objects shared by every caller, so an override that wrote through to one
// of them would quietly change the figure for every market and every later
// render, not just the row somebody edited.
import {
  applySavingsOverride,
  bandIsEditable,
  countrySavings,
  countrySavingsKey,
  countrySavingsOverride,
  countSavingsOverrides,
  defaultCountryBand,
  defaultStateBand,
  formatSavingsRange,
  NA_MARKET_ROWS,
  COUNTRY_MARKET_ROWS,
  stateSavingsBands,
  stateSavingsOverride,
} from '../src/utils/marketSavings.js';
import { STATE_ELECTRIC_BANDS, STATE_GAS_BANDS } from '../src/data/marketSavingsBands.js';

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`}`);
}

const settingsWith = (marketSavings) => ({ marketSavings });

// ---- the rows the editor lists -------------------------------------------

check('every US state, DC and every Canadian province is listed',
  NA_MARKET_ROWS.length, 64);
check('the list carries codes, not just names',
  NA_MARKET_ROWS.some(r => r.code === 'TX' && r.nation === 'United States'), true);
check('Canadian provinces are named as Canada',
  NA_MARKET_ROWS.find(r => r.code === 'ON')?.nation, 'Canada');
check('countries come off the deregulation reference',
  COUNTRY_MARKET_ROWS.length > 150, true);
check('and they are alphabetical',
  COUNTRY_MARKET_ROWS[0].name < COUNTRY_MARKET_ROWS[1].name, true);

// ---- which markets can be retyped ----------------------------------------

check('a deregulated state earns a band',
  bandIsEditable(defaultStateBand('TX', 'electric')), true);
check('a gated market earns one too, at 0 - 0 %',
  bandIsEditable(defaultStateBand('CA', 'electric')), true);
check('Vermont has no gas band to retype',
  bandIsEditable(defaultStateBand('VT', 'gas')), false);
check('and no electric one either',
  bandIsEditable(defaultStateBand('VT', 'electric')), false);
// Europe is the case this tab exists for: a real market the reference table
// has never carried a committed figure for.
check('a European TBD is editable even with no figures on it',
  bandIsEditable(defaultCountryBand('Germany', 'electric')), true);
check('a no-opportunity country is not',
  bandIsEditable(defaultCountryBand('Cuba', 'electric')), false);

// ---- the range string ----------------------------------------------------

check('a band reads the way the shipped tables spell one',
  formatSavingsRange(0.02, 0.04), '2 - 4%');
check('a flat band reads as one figure', formatSavingsRange(0.03, 0.03), '3%');
check('a quarter point survives the round trip', formatSavingsRange(0.0025, 0.005), '0.25 - 0.5%');
check('no band, no range', formatSavingsRange(null, null), '');

// ---- an override moves the band, and only the band -----------------------

const texas = settingsWith({ states: { TX: { electric: { low: 3, high: 5 } } } });

check('the stored pair reads back',
  JSON.stringify(stateSavingsOverride(texas, 'TX', 'electric')), '{"low":3,"high":5}');
check('a half-typed pair is not a band',
  stateSavingsOverride(settingsWith({ states: { TX: { electric: { low: 3 } } } }), 'TX', 'electric'), null);
check('nor is a negative one',
  stateSavingsOverride(settingsWith({ states: { TX: { electric: { low: -1, high: 5 } } } }), 'TX', 'electric'), null);

const texasBands = stateSavingsBands(texas);
check('the override sets the low end', texasBands.electric.TX.lowPct, 0.03);
check('and the high end', texasBands.electric.TX.highPct, 0.05);
check('and the range that is quoted with them', texasBands.electric.TX.range, '3 - 5%');
check('the market is still exactly as competitive as it was',
  texasBands.electric.TX.status, STATE_ELECTRIC_BANDS.TX.status);
check('an electric override leaves gas alone',
  texasBands.gas.TX.lowPct, STATE_GAS_BANDS.TX.lowPct);
check('and leaves every other state alone',
  texasBands.electric.PA.lowPct, STATE_ELECTRIC_BANDS.PA.lowPct);

// The whole point of the module: reading it must not rewrite the tables.
// Texas ships at 1 - 2 %, not the 2 - 4 % most markets carry, so the
// literals below are the shipped Texas figure rather than the house one.
check('the shipped Texas figure is untouched afterwards',
  STATE_ELECTRIC_BANDS.TX.lowPct, 0.01);
check('and a second read still sees the shipped one when nothing is stored',
  stateSavingsBands({}).electric.TX.lowPct, 0.01);

// A regulated market has nothing to override. Typing a figure against one
// would read as making it competitive, which is not this tab's to do.
const vermont = settingsWith({ states: { VT: { gas: { low: 2, high: 4 } } } });
check('a stored figure cannot conjure a band for a regulated market',
  stateSavingsBands(vermont).gas.VT, undefined);

// ---- Virginia is gated on the upload, not on the setting -----------------

check('Virginia is out of the electric map by default',
  stateSavingsBands({}).electric.VA, undefined);
check('and in it once a site clears the large-load threshold',
  stateSavingsBands({}, { includeVirginiaElectric: true }).electric.VA?.status, 'Limited');
check('the editor still offers the row either way',
  bandIsEditable(defaultStateBand('VA', 'electric')), true);
check('and an override applies once Virginia is in',
  stateSavingsBands(
    settingsWith({ states: { VA: { electric: { low: 1, high: 2 } } } }),
    { includeVirginiaElectric: true },
  ).electric.VA.highPct, 0.02);

// ---- countries -----------------------------------------------------------

check('a country key survives being a dotted Firestore path',
  countrySavingsKey('Bosnia and Herzegovina'), 'bosnia-and-herzegovina');
check('accents fold out of it', countrySavingsKey('Côte d’Ivoire'), 'cote-d-ivoire');

const germany = settingsWith({ countries: { germany: { name: 'Germany', electric: { low: 2, high: 6 } } } });
check('a European TBD takes the figure it is given',
  countrySavings(germany, 'Germany', 'electric').lowPct, 0.02);
check('and stops reading TBD',
  countrySavings(germany, 'Germany', 'electric').range, '2 - 6%');
check('the country is still as deregulated as the reference says',
  countrySavings(germany, 'Germany', 'electric').status,
  defaultCountryBand('Germany', 'electric').status);
check('a spelling the sheets use resolves to the same override',
  countrySavings(germany, 'DEU', 'electric').highPct, 0.06);
check('an untouched country reads the reference',
  countrySavings(germany, 'Australia', 'electric').range,
  defaultCountryBand('Australia', 'electric').range);
check('a country nobody has heard of is still null',
  countrySavings(germany, 'Atlantis', 'electric'), null);
check('the override lookup canonicalizes too',
  countrySavingsOverride(germany, 'Germany', 'electric')?.high, 6);

// A no-opportunity market earns nothing whatever is stored against it.
const cuba = settingsWith({ countries: { cuba: { electric: { low: 5, high: 9 } } } });
check('a stored figure cannot conjure a band for a no-opportunity country',
  countrySavings(cuba, 'Cuba', 'electric').lowPct, null);

// ---- applying a pair directly --------------------------------------------

const base = { status: 'yes', range: '2 - 4%', lowPct: 0.02, highPct: 0.04 };
const applied = applySavingsOverride(base, { low: 1, high: 2 });
check('applying a pair returns a new object', applied === base, false);
check('and leaves the one it was given alone', base.lowPct, 0.02);
check('no pair, no change', applySavingsOverride(base, null).range, '2 - 4%');

// ---- the header count ----------------------------------------------------

check('nothing stored is no edits', countSavingsOverrides({}), 0);
check('a name filed beside the figures is not an edit',
  countSavingsOverrides({ marketSavings: { countries: { germany: { name: 'Germany' } } } }), 0);
check('each commodity counts once',
  countSavingsOverrides({
    marketSavings: {
      states: { TX: { electric: { low: 1, high: 2 }, gas: { low: 1, high: 2 } } },
      countries: { germany: { name: 'Germany', electric: { low: 2, high: 6 } } },
    },
  }), 3);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
