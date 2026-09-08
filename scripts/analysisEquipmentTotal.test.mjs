// Assertion tests for the equipment total the Master Analysis save stamps
// on a company. Plain Node — no test framework (the project has none). Run:
//   node scripts/analysisEquipmentTotal.test.mjs
//
// Saving a Master Analysis to a company writes the portfolio's estimated
// equipment into the popup's Equipment box, as
//
//   Math.max(<sum over the loaded sites>, <the company's saved site list>)
//
// The max is only safe while both halves are portfolio totals on the same
// scale — one is summed here from propertyTypeEquipment, the other is read
// back out of the stored site list by siteListFacts, through the
// "Est. Equipment" column the save writes per site. Two implementations of
// "how much equipment", so the thing worth pinning is that they agree over
// the same sites: if either drifted, the max would silently pick the wrong
// one and the popup would read high.
import { propertyTypeEquipment } from '../src/data/propertyTypeEstimates.js';
import { siteListFacts } from '../src/utils/siteListFacts.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// What the page sums: one row per loaded site, keyed off the canonical
// property type it resolved to (SitesView's `__propertyType__`).
const loadedTotal = (types) => Math.round(
  types.reduce((sum, t) => sum + (propertyTypeEquipment(t) || 0), 0),
);

// What the save writes into the company's site list: the same per-site
// number under "Est. Equipment", beside the canonical type.
const asSiteList = (types) => ({
  headers: ['Site Name', 'Property Type (analysis)', 'Est. Equipment'],
  rows: types.map((t, i) => ({
    'Site Name': `Site ${i + 1}`,
    'Property Type (analysis)': t,
    'Est. Equipment': propertyTypeEquipment(t),
  })),
});

// Canonical names from the reference table, so every one of them resolves
// — a typo here would make the assertions below pass on two nulls.
const TYPES = [
  'University / College Campus',
  'Industrial (Heavy Manufacturing)',
  'Office - High-Rise',
  'Non-Refrigerated Warehouse',
];
check('every fixture type is one the reference table knows',
  TYPES.map(t => propertyTypeEquipment(t) != null), TYPES.map(() => true));

// --- the two halves are the same number ------------------------------
check('the page sum and the stored list agree over the same sites',
  siteListFacts(asSiteList(TYPES)).equipment, loadedTotal(TYPES));
check('every site counted, none twice',
  siteListFacts(asSiteList(TYPES)).equipmentSites, TYPES.length);
check('and the total is the sum of the per-site estimates',
  loadedTotal(TYPES), TYPES.reduce((s, t) => s + propertyTypeEquipment(t), 0));

// A site list that predates the Est. Equipment column — or came from a
// plain upload on the company popup — still totals, because siteListFacts
// falls back to the property type. Same answer either way, which is what
// lets the max compare them.
const noColumn = {
  headers: ['Site Name', 'Property Type'],
  rows: TYPES.map((t, i) => ({ 'Site Name': `Site ${i + 1}`, 'Property Type': t })),
};
check('a list with no equipment column falls back to the same figure',
  siteListFacts(noColumn).equipment, loadedTotal(TYPES));

// --- unknown is not zero ---------------------------------------------
// propertyTypeEquipment returns null for a type it does not recognize.
// Both halves skip those rather than counting them as zero sites' worth,
// so a portfolio the reference table can't place reads as partial, not as
// "no equipment".
check('an unrecognized type is skipped, not counted as zero',
  propertyTypeEquipment('Something nobody has mapped'), null);
const mixed = ['Office', 'Something nobody has mapped'];
check('a partial list totals only what resolved',
  siteListFacts(asSiteList(mixed)).equipment, propertyTypeEquipment('Office'));
check('and says how many sites that was',
  siteListFacts(asSiteList(mixed)).equipmentSites, 1);
// Nothing resolved at all is null, not 0 — the save only stamps a total
// above zero, so this is what keeps an unmappable upload from wiping a
// number someone typed into the popup by hand.
check('nothing resolved is null, so nothing is stamped',
  siteListFacts(asSiteList(['Something nobody has mapped'])).equipment, null);

// --- the max picks up sites the page never had ------------------------
// The page holds one file at a time. A company whose sites arrived as
// three uploads owns all of them, so the stored list can legitimately
// exceed this upload — which is the whole reason the save takes the max
// rather than the loaded figure alone.
{
  const loaded = ['Office'];
  const stored = asSiteList(TYPES);
  const stamped = Math.max(loadedTotal(loaded), siteListFacts(stored).equipment || 0);
  check('the whole site list wins over a partial upload', stamped, loadedTotal(TYPES));
}
// And the other way: sites on screen that the list could not store (the
// 900 KB cap returns the company's previous rows) still get counted.
{
  const loaded = TYPES;
  const stored = asSiteList(['Office']);
  const stamped = Math.max(loadedTotal(loaded), siteListFacts(stored).equipment || 0);
  check('a loaded portfolio wins over a stale stored list', stamped, loadedTotal(TYPES));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
