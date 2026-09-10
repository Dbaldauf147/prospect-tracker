// Assertion tests for setting every property type at once.
// Plain Node — no test framework (the project has none). Run:
//   node scripts/propertyTypeBulkMap.test.mjs
//
// The rules worth pinning: the draft covers every row (a row left out would
// read as untouched rather than as cleared), '' clears rather than skips,
// and the summary counts sites rather than rows.
import { bulkMapDraft, bulkMapSummary } from '../src/utils/propertyTypeBulkMap.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

const ITEMS = [
  { key: 'warehouse/distribution', raw: 'warehouse/distribution', count: 412 },
  { key: 'climate controlled', raw: 'climate controlled', count: 88 },
  { key: 'other', raw: 'other', count: 3 },
];

// --- the draft --------------------------------------------------------
check('every row gets the target', bulkMapDraft(ITEMS, 'Refrigerated Warehouse'), {
  'warehouse/distribution': 'Refrigerated Warehouse',
  'climate controlled': 'Refrigerated Warehouse',
  'other': 'Refrigerated Warehouse',
});
// N/A is just another target as far as this is concerned — the popup gives
// it its own label, the draft stores the same sentinel the dropdown does.
check('N/A applies to every row too', bulkMapDraft(ITEMS, '__excluded__')['other'], '__excluded__');
// The cleared rows must still be IN the draft: the popup counts what is
// mapped by reading it, and its save path deletes a mapping on a '' value.
check('clearing writes an empty target for every row', bulkMapDraft(ITEMS, ''), {
  'warehouse/distribution': '', 'climate controlled': '', 'other': '',
});
check('a missing target clears rather than storing undefined',
  bulkMapDraft(ITEMS, undefined)['other'], '');
check('rows without a key are skipped',
  bulkMapDraft([{ key: 'a', count: 1 }, { raw: 'no key' }, null], 'Office - Mid-Rise'),
  { a: 'Office - Mid-Rise' });
check('nothing to map is an empty draft', bulkMapDraft([], 'Office - Mid-Rise'), {});
check('no items at all', bulkMapDraft(null, 'Office - Mid-Rise'), {});

// --- the summary ------------------------------------------------------
check('rows and the sites behind them', bulkMapSummary(ITEMS), { types: 3, sites: 503 });
check('a row with no count contributes none',
  bulkMapSummary([{ key: 'a' }, { key: 'b', count: 2 }]), { types: 2, sites: 2 });
check('a junk count is not NaN', bulkMapSummary([{ key: 'a', count: 'lots' }]), { types: 1, sites: 0 });
check('keyless rows do not count', bulkMapSummary([{ count: 99 }]), { types: 0, sites: 0 });
check('nothing at all', bulkMapSummary(undefined), { types: 0, sites: 0 });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
