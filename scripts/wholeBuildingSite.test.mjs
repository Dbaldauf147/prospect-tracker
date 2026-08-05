// Assertion tests for the per-commodity whole-building answer behind the
// site table's three columns. Plain Node — no test framework (the project
// has none). Run:
//   node scripts/wholeBuildingSite.test.mjs
//
// wholeBuildingForSite takes the loaded lookup as an argument, so these run
// without the 934 KB reference: a stub stands in for it. What's worth pinning
// is what the answer MEANS — each commodity must be answered by its own
// utility, and "Not Available" must never be reported as a refusal.
import { wholeBuildingForSite, WB_COMMODITIES } from '../src/utils/wholeBuildingLookup.js';

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// Stands in for the loaded lookup: only `terms` is used here.
function stub(table) {
  return { terms: (zip, name) => (table[`${zip}|${name}`] || {}) };
}
const verdicts = s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.verdict]));

// --- each commodity is answered by its own utility -----------------------
// The Washington DC case, which is why this is per-commodity at all: Pepco
// says yes to electric and NO to gas; Washington Gas says yes to gas. One
// lookup per site would get half of every DC row wrong.
{
  const lookup = stub({
    '20009|Pepco': { 'Electric?': 'Yes', 'Gas?': 'No', 'Water?': 'Not Available' },
    '20009|Washington Gas': { 'Electric?': 'Not Available', 'Gas?': 'Yes', 'Water?': 'Not Available' },
  });
  const split = wholeBuildingForSite(lookup, {
    zip: '20009', electricUtility: 'Pepco', gasUtility: 'Washington Gas', waterUtility: '',
  });

  eq(split.electric.verdict, 'yes', "electric reads the ELECTRIC utility's row");
  eq(split.electric.utility, 'Pepco', 'and names the utility that answered');
  eq(split.gas.verdict, 'yes', "gas reads the GAS utility's row, not the electric one");
  eq(split.gas.utility, 'Washington Gas', 'and names the gas utility');
  // The whole point: reading gas off Pepco would have said "No" here.
  eq(lookup.terms('20009', 'Pepco')['Gas?'], 'No', 'the electric utility would have answered gas wrongly');
}

// --- "Not Available" is unknown, never "no" -------------------------------
// 2,024 of the reference's 2,137 utilities say "Not Available" for electric.
// Reporting that as a refusal would turn "nobody has asked" into "they won't".
{
  const lookup = stub({ '1|U': { 'Electric?': 'Not Available', 'Gas?': '', 'Water?': 'N/A' } });
  const split = wholeBuildingForSite(lookup, {
    zip: '1', electricUtility: 'U', gasUtility: 'U', waterUtility: 'U',
  });
  eq(verdicts(split), { electric: 'unknown', gas: 'unknown', water: 'unknown' }, '"Not Available", "" and "N/A" are all unknown');
}

// An explicit "No" is a real finding and must survive as one.
{
  const lookup = stub({ '1|U': { 'Electric?': 'No' } });
  const split = wholeBuildingForSite(lookup, { zip: '1', electricUtility: 'U' });
  eq(split.electric.verdict, 'no', 'an explicit No is reported as No, not as unknown');
  eq(split.electric.value, 'No', 'the reference’s own wording is kept for display');
}

// The reference carries qualified answers ("Yes (4/50)", "Yes(5)") and the
// occasional value this doesn't model. A leading yes/no still classifies;
// anything else surfaces rather than being flattened.
{
  const lookup = stub({ '1|U': { 'Electric?': 'Yes (4/50)', 'Gas?': 'Sometimes' } });
  const split = wholeBuildingForSite(lookup, { zip: '1', electricUtility: 'U', gasUtility: 'U' });
  eq(split.electric.verdict, 'yes', 'a qualified yes still reads as yes');
  eq(split.electric.value, 'Yes (4/50)', 'the qualification is preserved for display');
  eq(split.gas.verdict, 'other', 'an unmodelled value is "other", not silently yes or no');
}

// --- water reads its own utility ------------------------------------------
// The reference re-sources a waterUtility onto the site. Without one there is
// nothing to ask about, and the zip alone would answer for whichever utility
// happens to serve it — a different question than the column asks.
{
  const lookup = stub({
    '1|City Water': { 'Water?': 'Yes' },
    '1|Big Electric': { 'Water?': 'Yes' },
  });
  const withWater = wholeBuildingForSite(lookup, {
    zip: '1', electricUtility: 'Big Electric', waterUtility: 'City Water',
  });
  eq(withWater.water.verdict, 'yes', 'water reads the water utility');
  eq(withWater.water.utility, 'City Water', 'and names it');

  const noWater = wholeBuildingForSite(lookup, { zip: '1', electricUtility: 'Big Electric' });
  eq(noWater.water.verdict, 'unknown', 'with no water utility on the site, water is unknown');
  eq(noWater.water.utility, '', 'and no utility is claimed to have answered');
}

// --- missing inputs -------------------------------------------------------
// Every one of these renders a table row, so none may throw.
{
  const lookup = stub({ '1|A': { 'Electric?': 'Yes' } });
  const empty = { electric: 'unknown', gas: 'unknown', water: 'unknown' };
  eq(verdicts(wholeBuildingForSite(lookup, { zip: '1' })), empty, 'a site with no utility names is unknown throughout');
  eq(verdicts(wholeBuildingForSite(lookup, { electricUtility: 'A' })), empty, 'a site with no zip is unknown throughout');
  eq(verdicts(wholeBuildingForSite(null, { zip: '1', electricUtility: 'A' })), empty, 'no lookup yet (still loading) is unknown, not an error');
  eq(verdicts(wholeBuildingForSite({}, { zip: '1', electricUtility: 'A' })), empty, 'a lookup without terms() is unknown, not a crash');
  eq(verdicts(wholeBuildingForSite(lookup, null)), empty, 'no site is unknown throughout');
  eq(verdicts(wholeBuildingForSite(lookup, { zip: '1', electricUtility: '   ' })), empty, 'a whitespace-only utility name is no utility');
}

// terms() walks the zip map, and this runs for every visible row — so a site
// whose commodities share one utility must cost one call, not three.
{
  let calls = 0;
  const counting = { terms: () => { calls += 1; return { 'Electric?': 'Yes', 'Gas?': 'Yes', 'Water?': 'Yes' }; } };
  wholeBuildingForSite(counting, { zip: '1', electricUtility: 'A', gasUtility: 'A', waterUtility: 'A' });
  eq(calls, 1, 'one utility serving all three commodities costs one lookup');

  calls = 0;
  wholeBuildingForSite(counting, { zip: '1', electricUtility: 'A', gasUtility: 'B', waterUtility: 'C' });
  eq(calls, 3, 'three distinct utilities cost three lookups');
}

// --- the commodity list itself -------------------------------------------
{
  eq(WB_COMMODITIES.map(c => c.key), ['electric', 'gas', 'water'], 'the columns are electric, gas, water, in that order');
  eq(WB_COMMODITIES.map(c => c.label), ['Electric', 'Gas', 'Water'], 'each carries its column label');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
