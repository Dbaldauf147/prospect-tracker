// Mexico on the Master Analysis NAM sheet. Plain Node - no test framework
// (the project has none). Run:
//   node scripts/namMexicoMarket.test.mjs
//
// The bug this pins: the NAM map drew Mexico from the world-country
// outlines purely as backdrop, hard-filled with the same grey the legend
// calls "No portfolio sites", so a portfolio with Mexican sites got a map
// that coloured every state it had a site in and left Mexico reading as
// empty. Nothing on the sheet said otherwise, because Mexican sites were
// dropped from it before the map was drawn.
//
// Three things have to hold for the fix, and none of them is visible in a
// screenshot of a map:
//
//   1. There is a Mexico market row at all, and it resolves to a category
//      the map can colour. A row naming a category nobody defines colours
//      Mexico "Regulated" by the fallback, which is a wrong answer rather
//      than a missing one.
//
//   2. It says what the rest of the site says. Mexico's status comes from
//      COUNTRY_DEREGULATION - the country table every non-NA sheet reads -
//      and the NAM sheet must not quietly disagree with the world map two
//      tabs over. naMarkets.js has a header warning about exactly this kind
//      of drift between two tables describing one market.
//
//   3. The map has a Mexico shape to fill. The admin-1 dataset behind the
//      states and provinces is US + Canada only, so Mexico is drawn from
//      the world-country outlines, under whatever name that dataset uses.

// worldGeo bundles its map geometry as plain JSON imports, which Node only
// takes with an import attribute the source file cannot carry - see the
// loader's json branch.
import { register } from 'node:module';
register('./stubs/loader.mjs', import.meta.url);

const { NA_CATEGORIES, US_MARKETS, CA_MARKETS, MX_MARKETS } = await import('../src/data/naMarkets.js');
const { COUNTRY_DEREGULATION } = await import('../src/data/countryDeregulation.js');
const { getCountryFeatures, TOPO_NAME_TO_DEREG_KEY } = await import('../src/data/worldGeo.js');

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}\n        expected ${e}\n        got      ${a}`); }
}

// ---- one market, and it resolves -----------------------------------------
{
  eq(MX_MARKETS.length, 1, 'Mexico is one market, not thirty-two states');
  const [mx] = MX_MARKETS;
  eq(mx.code, 'MX', 'and its code is the one the map keys on');
  eq(mx.name, 'Mexico', 'named as the country');
  eq(!!NA_CATEGORIES[mx.category], true, 'its category is one the table defines');

  // The keys are namespaced by country (US/TX, CA/ON, MX/MX), so a code
  // colliding across lists is harmless - but a Mexico row whose code
  // matched a US state would still read wrong in the Code column.
  const usCodes = new Set(US_MARKETS.map(m => m.code));
  const caCodes = new Set(CA_MARKETS.map(m => m.code));
  eq(usCodes.has('MX') || caCodes.has('MX'), false, 'and no state or province already answers to it');
}

// ---- it agrees with the country table ------------------------------------
//
// The one that matters. Mexico is not in ELECTRIC_DEREGULATION or
// GAS_DEREGULATION - those are US + Canada - so its authority is
// COUNTRY_DEREGULATION, and this is the assertion that catches the NAM
// sheet and the world map drifting apart.
{
  const cat = NA_CATEGORIES[MX_MARKETS[0].category];
  const country = COUNTRY_DEREGULATION['Mexico'];
  eq(!!country, true, 'Mexico is on the country reference list');
  eq(cat.ep.startsWith(country.electric), true,
    'the NAM sheet says what the country table says about electric power');
  eq(cat.ng.startsWith(country.gas), true,
    'and what it says about natural gas');
  // Spelled out, so a change to either table has to be a decision rather
  // than a diff that still passes because both moved.
  eq([country.electric, country.gas], ['Deregulated', 'Deregulated'],
    'both commodities read deregulated today');
}

// ---- the map has a shape to fill -----------------------------------------
{
  const features = getCountryFeatures();
  // The same predicate the panel draws with: the TopoJSON name, or what
  // the alias map turns it into.
  const mexico = features.filter(f => (TOPO_NAME_TO_DEREG_KEY[f.name] || f.name) === 'Mexico' || f.name === 'Mexico');
  eq(mexico.length, 1, 'exactly one country outline answers to Mexico');
  eq(mexico[0].rings.length > 0, true, 'and it has polygon rings to fill');
  // Inside the NAM panel's bounding box (lng -170..-52, lat 18..84), or it
  // would be filled off-canvas. Mexico's mainland runs to about 14.5 °N,
  // which is why the panel clips: the point is that most of it is inside.
  const pts = mexico[0].rings.flat();
  const inBox = pts.filter(([lng, lat]) => lng >= -170 && lng <= -52 && lat >= 18 && lat <= 84);
  eq(inBox.length > pts.length / 2, true, 'and most of it falls inside the NAM panel');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
