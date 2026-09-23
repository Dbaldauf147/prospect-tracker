// Assertion tests for filling a whole column across every site.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/siteColumnFill.test.mjs
//
// The rules worth pinning: a mapped column wins so the fill moves the
// value the page reads, the created flag is what tells the user a column
// is being added to their data, and the header created is one the mapping
// detector picks back up on reload.
import { fillHeaderFor, describeColumnFill, FILL_HEADERS, applyColumnFill, SUMMARY_ROW_FIELDS } from '../src/utils/siteColumnFill.js';
import { detectColumn, pickZipColumn } from '../src/utils/siteColumns.js';
import { detectConsumptionColumns } from '../src/utils/utilityRates.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const FILE = ['SITE', 'ADDRESS', 'CITY', 'STATE', 'ZIP CODE'];

// --- picking the header ----------------------------------------------
check('a mapped column wins',
  fillHeaderFor('ASSET CLASS', [...FILE, 'ASSET CLASS'], 'Property Type'),
  { header: 'ASSET CLASS', created: false });
check('nothing mapped creates the preferred name',
  fillHeaderFor(null, FILE, 'Property Type'),
  { header: 'Property Type', created: true });
// A header the import kept but the detector never placed: claim it rather
// than adding a second column beside it.
check('an unmapped column of the right name is claimed, not duplicated',
  fillHeaderFor(null, [...FILE, 'Property Type'], 'Property Type'),
  { header: 'Property Type', created: false });
// A mapping left over from a file that had the column, against a file that
// doesn't — falls through to creating it rather than writing nowhere.
check('a stale mapping to a column the file lacks',
  fillHeaderFor('ASSET CLASS', FILE, 'Property Type'),
  { header: 'Property Type', created: true });
check('a blank mapping is no mapping', fillHeaderFor('   ', FILE, 'Property Type').created, true);
check('no preferred name, nothing to do', fillHeaderFor(null, FILE, ''), { header: '', created: false });
check('no headers at all', fillHeaderFor(null, null, 'Property Type'), { header: 'Property Type', created: true });

// --- the header created must survive a reload ------------------------
// The page re-derives its mapping from the persisted headers by pattern, so
// a created column only stays mapped if the detector matches its name.
// These are the patterns from detectSitesMapping's propertyType entry.
const PT_PATTERNS = [/property\s*type/i, /building\s*type/i, /property\s*class/i, /asset\s*type/i, /^use$/i, /\buse\s*type\b/i, /\bsegment\b/i];
check('the created Property Type header is re-detected on reload',
  detectColumn([...FILE, FILL_HEADERS.propertyType], PT_PATTERNS),
  FILL_HEADERS.propertyType);

// --- the prompt -------------------------------------------------------
check('adding a column says so',
  describeColumnFill({ label: 'Property Type', value: 'Office - Mid-Rise', count: 97, header: 'Property Type', created: true }),
  'Add a “Property Type” column to your uploaded sites and set it to “Office - Mid-Rise” on all 97 sites?');
check('overwriting an existing column says that instead',
  describeColumnFill({ label: 'Property Type', value: 'Office - Mid-Rise', count: 97, header: 'ASSET CLASS', created: false }),
  'Set Property Type to “Office - Mid-Rise” on all 97 sites, replacing whatever the “ASSET CLASS” column holds now?');
check('one site reads as one', 
  describeColumnFill({ label: 'Property Type', value: 'Data Center', count: 1, header: 'Property Type', created: true }),
  'Add a “Property Type” column to your uploaded sites and set it to “Data Center” on all 1 site?');
check('a big portfolio is grouped',
  describeColumnFill({ label: 'Property Type', value: 'X', count: 1204, header: 'Property Type', created: true }).includes('1,204 sites'),
  true);

// --- scoped fills from the data summary --------------------------------
{
  const a = { SITE: 'A', DIV: 'East', SQFT: '' };
  const b = { SITE: 'B', DIV: 'East', SQFT: 5000 };
  const c = { SITE: 'C', DIV: 'West', SQFT: '' };
  const rows = [a, b, c];
  const r1 = applyColumnFill(rows, new Set([a, b]), 'SQFT', 1200);
  check('fills only the targets', r1.rows.map(r => r.SQFT), [1200, 1200, '']);
  check('counts what moved', [r1.changed, r1.skipped], [2, 0]);
  check('untouched rows keep identity', r1.rows[2] === c, true);
  const r2 = applyColumnFill(rows, new Set(rows), 'SQFT', 1200, { onlyBlank: true });
  check('only-blank keeps an uploaded figure', r2.rows.map(r => r.SQFT), [1200, 5000, 1200]);
  check('only-blank counts the kept one as skipped', [r2.changed, r2.skipped], [2, 1]);
  const r3 = applyColumnFill(rows, new Set([c]), 'Division', 'West');
  check('a created column lands on every row, so the first row carries the header',
    r3.rows.map(r => r.Division), [undefined, undefined, 'West']);
  const r4 = applyColumnFill(rows, new Set([c]), 'Division', 'West', { created: true });
  check('with created, the other rows get it blank', r4.rows.map(r => r.Division), ['', '', 'West']);
  const r5 = applyColumnFill(rows, new Set([b]), 'SQFT', 5000);
  check('same value is not a change', [r5.changed, r5.rows === rows], [0, true]);
}

// Each created column must come back under its own field and no other on
// reload, or a fill of one silently maps another.
check('created zip is the zip column', pickZipColumn(['SITE', FILL_HEADERS.zip]), FILL_HEADERS.zip);
check('created kWh is electric consumption',
  detectConsumptionColumns(['SITE', FILL_HEADERS.electric, FILL_HEADERS.electricCost], 'electric'), [FILL_HEADERS.electric]);
check('created therms is gas consumption',
  detectConsumptionColumns(['SITE', FILL_HEADERS.gas, FILL_HEADERS.gasCost], 'gas'), [FILL_HEADERS.gas]);
check('cost columns never read as consumption',
  [detectConsumptionColumns([FILL_HEADERS.electricCost], 'electric'), detectConsumptionColumns([FILL_HEADERS.gasCost], 'gas')], [[], []]);
check('every summary row that edits has a column name to create',
  Object.values(SUMMARY_ROW_FIELDS).every(f => FILL_HEADERS[f]), true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
