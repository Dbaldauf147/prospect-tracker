// Assertion tests for tagging SIA line items on the S2C tab. Plain Node, no
// test framework (the project has none). Run:
//   node scripts/s2cTags.test.mjs
//
// The tags are curated by hand and outlive the workbook they were made
// against, so the failures worth pinning are the ones that lose them or hide
// them: a key built differently from the one the rest of the page uses, a
// blank tag left behind as a hollow "tagged" entry, and a tagged line item the
// current workbook no longer carries dropping off the table (invisible, and
// impossible to clear).
import {
  S2C_TAG_FIELDS, s2cTagKey, hasAnyTag, setS2cTag, clearS2cTags,
  collectS2cLineItems, countTagged, s2cTagSuggestions,
} from '../src/utils/s2cTags.js';

let passed = 0, failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
}

// ── The three columns, and the key ────────────────────────────────────────
check('fields', S2C_TAG_FIELDS.map(f => f.key), ['serviceSegment', 'productName', 'deliverable']);

// Must match PricingView's linkedToDefaultKey — a key built differently here
// tags a pair nothing else on the page can find.
check('key: lowercased and joined', s2cTagKey('CCM NAM', 'Setup'), 'ccm nam::setup');
check('key: trims both halves', s2cTagKey('  CCM NAM ', ' Setup '), 'ccm nam::setup');
check('key: type is part of it', s2cTagKey('CCM NAM', 'Recurring (monthly)') === s2cTagKey('CCM NAM', 'Setup'), false);

// ── What counts as tagged ─────────────────────────────────────────────────
check('hasAnyTag: nothing', hasAnyTag(undefined), false);
check('hasAnyTag: empty entry', hasAnyTag({}), false);
check('hasAnyTag: whitespace is not a tag', hasAnyTag({ productName: '   ' }), false);
check('hasAnyTag: one is enough', hasAnyTag({ deliverable: 'Report' }), true);

// ── Setting and clearing ──────────────────────────────────────────────────
{
  const a = setS2cTag({}, 'ccm nam::setup', 'serviceSegment', 'Sustainability');
  check('set: creates the entry', a, { 'ccm nam::setup': { serviceSegment: 'Sustainability' } });

  const b = setS2cTag(a, 'ccm nam::setup', 'productName', '  ESL  ');
  check('set: trims on the way in', b['ccm nam::setup'].productName, 'ESL');
  check('set: leaves the sibling alone', b['ccm nam::setup'].serviceSegment, 'Sustainability');

  // Typing a tag back to blank clears it rather than storing an empty string.
  const c = setS2cTag(b, 'ccm nam::setup', 'productName', '');
  check('set: blank removes the field', Object.keys(c['ccm nam::setup']), ['serviceSegment']);

  // Clearing the last tag drops the entry — otherwise the map fills with
  // hollow entries that count as tagged everywhere they are counted.
  const d = setS2cTag(c, 'ccm nam::setup', 'serviceSegment', '   ');
  check('set: last tag out drops the entry', d, {});
  check('set: and it is not merely empty', 'ccm nam::setup' in d, false);

  // A no-op returns the original map, so React state doesn't churn.
  const same = setS2cTag(d, 'nothing::here', 'deliverable', '');
  check('set: clearing what was never set is a no-op', same, d);

  check('clear: removes everything for the pair',
    clearS2cTags(b, 'ccm nam::setup'), {});
  check('clear: unknown key is a no-op', clearS2cTags(b, 'nope::nope'), b);
}

// ── Which line items the table lists ──────────────────────────────────────
const workbook = [
  {
    optionNumber: 1, sheetName: 'Option 1',
    sections: [{ items: [
      { description: 'CCM NAM', type: 'Recurring (monthly)', cts: 3796 },
      { description: 'CCM NAM', type: 'Setup', cts: 9224 },
      { description: 'ENERGY STAR Link (RA)', type: 'Recurring (monthly)', cts: 725.83 },
    ] }],
  },
  {
    optionNumber: 2, sheetName: 'Option 2',
    sections: [{ items: [
      { description: 'CCM NAM', type: 'Recurring (monthly)', cts: 4100 },
      { description: 'Budgets', type: 'Recurring (monthly)', cts: 140 },
    ] }],
  },
];

{
  const pairs = collectS2cLineItems({ options: workbook, activeOptionNumber: 1 });
  check('collect: one row per (Line Item, Type), sorted',
    pairs.map(p => `${p.lineItem}|${p.type}`), [
      'Budgets|Recurring (monthly)',
      'CCM NAM|Recurring (monthly)',
      'CCM NAM|Setup',
      'ENERGY STAR Link (RA)|Recurring (monthly)',
    ]);
  const ccm = pairs.find(p => p.key === 'ccm nam::recurring (monthly)');
  check('collect: CTS is the active option only', ccm.activeCts, 3796);
  check('collect: every option it appears on', ccm.options, ['Option 1', 'Option 2']);
}

{
  // A pair tagged against a workbook since replaced still gets a row —
  // otherwise the tags are invisible and can never be cleared.
  const tags = { 'supplier charges::one time': { productName: 'Pass-through energy' } };
  const pairs = collectS2cLineItems({ options: workbook, tags, activeOptionNumber: 1 });
  const orphan = pairs.find(p => p.key === 'supplier charges::one time');
  check('collect: a tagged pair the workbook lost still shows', !!orphan, true);
  check('collect: ...and is marked as not in this workbook', orphan.reachable, false);
}
{
  // An entry of three blanks is not a tagged line item and must not drag a
  // row onto the table.
  const tags = { 'ghost::setup': { serviceSegment: '', productName: '  ' } };
  const pairs = collectS2cLineItems({ options: workbook, tags, activeOptionNumber: 1 });
  check('collect: hollow entries pull in no row',
    pairs.some(p => p.key === 'ghost::setup'), false);
}
{
  // No workbook yet: the table has nothing to list but still surfaces tags
  // already made, so they can be read and cleared.
  const tags = { 'ccm nam::setup': { productName: 'CCM' } };
  check('collect: no workbook, tags still listed',
    collectS2cLineItems({ tags }).map(p => p.key), ['ccm nam::setup']);
  check('collect: nothing at all', collectS2cLineItems(), []);
}

// ── Counting, for the heading ─────────────────────────────────────────────
{
  const pairs = collectS2cLineItems({ options: workbook, activeOptionNumber: 1 });
  const tags = {
    'ccm nam::setup': { productName: 'CCM' },
    'budgets::recurring (monthly)': { serviceSegment: 'Ops' },
    'ghost::setup': { productName: '   ' },
  };
  check('count: tagged pairs only', countTagged(pairs, tags), 2);
  check('count: nothing tagged', countTagged(pairs, {}), 0);
}

// ── Suggestions ───────────────────────────────────────────────────────────
{
  const tags = {
    a: { serviceSegment: 'Sustainability' },
    b: { serviceSegment: 'sustainability' },
    c: { serviceSegment: 'Ops', deliverable: 'Monthly report' },
    d: { serviceSegment: '   ' },
  };
  check('suggest: deduped case-insensitively, sorted',
    s2cTagSuggestions(tags, 'serviceSegment'), ['Ops', 'Sustainability']);
  check('suggest: first spelling wins',
    s2cTagSuggestions({ a: { productName: 'esl' }, b: { productName: 'ESL' } }, 'productName'), ['esl']);
  check('suggest: empty column', s2cTagSuggestions(tags, 'productName'), []);
  check('suggest: no tags at all', s2cTagSuggestions({}, 'deliverable'), []);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
