// Assertion tests for tagging SIA line items on the S2C tab. Plain Node, no
// test framework (the project has none). Run:
//   node scripts/s2cTags.test.mjs
//
// The tags are curated by hand and outlive the workbook they were made
// against, so the failures worth pinning are the ones that lose them or hide
// them: a blank tag left behind as a hollow "tagged" entry, a tagged line item
// the current workbook no longer carries dropping off the table (invisible,
// and impossible to clear), and — the one that actually bit — a key built out
// of workbook data.
//
// The mapping used to be keyed by (Line Item, Type). The Type is whatever the
// parser found in that column, which on a real SIA is often fee prose carrying
// the deal's own numbers ("Fee = $25,800 one-time estimate for..."), and it is
// overridable per row against the workbook's own item ids. So the next SIA
// produced different keys and the tags silently stopped applying, and clearing
// the file moved the keys again for line items nobody had touched. It is now
// keyed by Line Item alone: one service, one answer, covering its Setup row,
// its Recurring row, every option and every later workbook.
//
// A note lives on the same entry, and the rules that keep it are the ones
// worth pinning: it never counts as a tag (the heading counts finished
// mappings, not thinking out loud), it holds an entry open on its own, and
// clearing the tags leaves it alone — a note is the one thing on the row that
// can't be got back by re-reading the workbook.
import {
  S2C_TAG_FIELDS, s2cTagKey, hasAnyTag, setS2cTag, clearS2cTags,
  collectS2cLineItems, countTagged, s2cTagSuggestions, migrateS2cTags,
  setS2cNote, s2cNote, hasS2cNote, hasS2cContent,
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

check('key: lowercased', s2cTagKey('CCM NAM'), 'ccm nam');
check('key: trimmed', s2cTagKey('  CCM NAM '), 'ccm nam');
check('key: nothing to key', s2cTagKey(''), '');
check('key: missing name', s2cTagKey(null), '');
// The point of the rekey: the two billing halves of one service are one
// answer. Under the old pair key these were two rows to fill in twice.
check('key: the Setup and Recurring halves share one key',
  s2cTagKey('CCM NAM') === s2cTagKey('ccm nam '), true);

// ── What counts as tagged ─────────────────────────────────────────────────
check('hasAnyTag: nothing', hasAnyTag(undefined), false);
check('hasAnyTag: empty entry', hasAnyTag({}), false);
check('hasAnyTag: whitespace is not a tag', hasAnyTag({ productName: '   ' }), false);
check('hasAnyTag: one is enough', hasAnyTag({ deliverable: 'Report' }), true);
// The remembered spelling rides along on the entry but is not one of the
// three tags, so it can never make an untagged line item look tagged.
check('hasAnyTag: a label alone is not a tag', hasAnyTag({ label: 'CCM NAM' }), false);

// ── Setting and clearing ──────────────────────────────────────────────────
{
  const a = setS2cTag({}, 'ccm nam', 'serviceSegment', 'Sustainability');
  check('set: creates the entry', a, { 'ccm nam': { serviceSegment: 'Sustainability' } });

  const b = setS2cTag(a, 'ccm nam', 'productName', '  ESL  ');
  check('set: trims on the way in', b['ccm nam'].productName, 'ESL');
  check('set: leaves the sibling alone', b['ccm nam'].serviceSegment, 'Sustainability');

  // Typing a tag back to blank clears it rather than storing an empty string.
  const c = setS2cTag(b, 'ccm nam', 'productName', '');
  check('set: blank removes the field', Object.keys(c['ccm nam']), ['serviceSegment']);

  // Clearing the last tag drops the entry — otherwise the map fills with
  // hollow entries that count as tagged everywhere they are counted.
  const d = setS2cTag(c, 'ccm nam', 'serviceSegment', '   ');
  check('set: last tag out drops the entry', d, {});
  check('set: and it is not merely empty', 'ccm nam' in d, false);

  // A no-op returns the original map, so React state doesn't churn.
  const same = setS2cTag(d, 'nothing', 'deliverable', '');
  check('set: clearing what was never set is a no-op', same, d);

  check('clear: removes everything for the line item',
    clearS2cTags(b, 'ccm nam'), {});
  check('clear: unknown key is a no-op', clearS2cTags(b, 'nope'), b);
}

// ── The remembered spelling ───────────────────────────────────────────────
{
  // The key is lower-cased so it can match across workbooks. Once the SIA is
  // gone there is nothing else to read a display name off, so tagging records
  // how the line item was spelled — otherwise removing the file turns a tidy
  // table of names into a table of lower-case keys.
  const t = setS2cTag({}, 'ccm nam', 'serviceSegment', 'Sustainability', 'CCM NAM');
  check('label: recorded when tagging', t, { 'ccm nam': { serviceSegment: 'Sustainability', label: 'CCM NAM' } });
  check('label: shown on a row with no workbook',
    collectS2cLineItems({ options: [], tags: t })[0].lineItem, 'CCM NAM');
  check('label: goes when the last tag goes', setS2cTag(t, 'ccm nam', 'serviceSegment', ''), {});
  // Entries written before labels existed must fall back, not break.
  check('label: falls back to the key when never recorded',
    collectS2cLineItems({ options: [], tags: { 'ccm nam': { serviceSegment: 'X' } } })[0].lineItem, 'ccm nam');
  // Refreshed on every edit, so a better-spelled workbook updates it.
  check('label: refreshed by a later edit',
    setS2cTag(t, 'ccm nam', 'productName', 'ESL', 'CCM NAM (Americas)')['ccm nam'].label,
    'CCM NAM (Americas)');
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
  const rows = collectS2cLineItems({ options: workbook });
  check('collect: one row per Line Item, sorted',
    rows.map(r => r.lineItem), ['Budgets', 'CCM NAM', 'ENERGY STAR Link (RA)']);
  // The same name across two options and two Types is one row: the mapping
  // asks about a service once, and what those rows cost is the Pricing
  // subtab's business, not this table's.
  check('collect: a name spanning options and Types is listed once',
    rows.filter(r => r.key === 'ccm nam').length, 1);
  check('collect: the workbook spelling is kept for display',
    rows.find(r => r.key === 'energy star link (ra)').lineItem, 'ENERGY STAR Link (RA)');
}

{
  // A line item tagged against a workbook since replaced still gets a row —
  // otherwise the tags are invisible and can never be cleared.
  const tags = { 'supplier charges': { productName: 'Pass-through energy' } };
  const rows = collectS2cLineItems({ options: workbook, tags });
  const orphan = rows.find(r => r.key === 'supplier charges');
  check('collect: a tagged line item the workbook lost still shows', !!orphan, true);
  check('collect: ...and is marked as not in this workbook', orphan.reachable, false);
  // And it must not be listed twice once a workbook carrying it loads.
  check('collect: a tagged line item the workbook has is listed once',
    collectS2cLineItems({ options: workbook, tags: { 'ccm nam': { productName: 'CCM' } } })
      .filter(r => r.key === 'ccm nam').length, 1);
  check('collect: ...reading as reachable', collectS2cLineItems({
    options: workbook, tags: { 'ccm nam': { productName: 'CCM' } },
  }).find(r => r.key === 'ccm nam').reachable, true);
}
{
  // An entry of three blanks is not a tagged line item and must not drag a
  // row onto the table.
  const tags = { ghost: { serviceSegment: '', productName: '  ' } };
  const rows = collectS2cLineItems({ options: workbook, tags });
  check('collect: hollow entries pull in no row', rows.some(r => r.key === 'ghost'), false);
}
{
  // No workbook yet: the table has nothing to list but still surfaces tags
  // already made, so they can be read and cleared.
  const tags = { 'ccm nam': { productName: 'CCM' } };
  check('collect: no workbook, tags still listed',
    collectS2cLineItems({ tags }).map(r => r.key), ['ccm nam']);
  check('collect: nothing at all', collectS2cLineItems(), []);
  // A row with no name at all can't be keyed and must not become a blank row.
  check('collect: an unnamed workbook row is skipped', collectS2cLineItems({
    options: [{ optionNumber: 1, sheetName: 'O', sections: [{ items: [{ description: '  ', cts: 5 }] }] }],
  }), []);
}

// ── The mapping survives a different SIA ──────────────────────────────────
{
  // The scenario that started this. Same two services, fee prose carrying
  // different numbers, and a per-row Type override on the first file. Under
  // the old pair key none of these tags matched the second workbook.
  const tags = {
    'demand side response': { serviceSegment: 'Sourcing' },
    'ccm nam': { serviceSegment: 'Sustainability' },
  };
  const first = [{ optionNumber: 1, sheetName: 'Option 1', sections: [{ items: [
    { description: 'Demand Side Response', type: 'Fee = 3% of revenue split (min. $2,500)' },
    { description: 'CCM NAM', type: 'Setup' },
  ] }] }];
  const second = [{ optionNumber: 1, sheetName: 'Option A', sections: [{ items: [
    { description: 'Demand Side Response', type: 'Fee = 5% of revenue split (min. $9,900)' },
    { description: 'CCM NAM', type: 'Recurring (monthly)' },
  ] }] }];
  check('cross-SIA: tagged on the first workbook',
    countTagged(collectS2cLineItems({ options: first, tags }), tags), 2);
  check('cross-SIA: still tagged on the second, despite different fee prose',
    countTagged(collectS2cLineItems({ options: second, tags }), tags), 2);
  check('cross-SIA: and with no workbook at all',
    countTagged(collectS2cLineItems({ options: [], tags }), tags), 2);
}

// ── Migrating the stored (Line Item, Type) keys ───────────────────────────
{
  // Without this every existing tag would read as untagged — the mapping
  // would look wiped rather than moved.
  check('migrate: the two halves merge field by field', migrateS2cTags({
    'ccm nam::setup': { serviceSegment: 'Sustainability' },
    'ccm nam::recurring (monthly)': { deliverable: 'Monthly report' },
  }), { 'ccm nam': { serviceSegment: 'Sustainability', deliverable: 'Monthly report' } });

  // A Type carrying "::" of its own must not cut the Line Item short.
  check('migrate: only the first :: splits the key',
    migrateS2cTags({ 'gresb::fee = a::b': { productName: 'GRESB' } }),
    { gresb: { productName: 'GRESB' } });

  // First non-empty wins, walked in sorted key order, so the answer doesn't
  // depend on whatever order the map happened to be written in.
  const clash = { 'x::b type': { serviceSegment: 'Second' }, 'x::a type': { serviceSegment: 'First' } };
  check('migrate: a conflict resolves deterministically', migrateS2cTags(clash), { x: { serviceSegment: 'First' } });
  check('migrate: same answer every time', migrateS2cTags({ ...clash }), migrateS2cTags(clash));

  check('migrate: hollow entries migrate to nothing', migrateS2cTags({ 'x::setup': { serviceSegment: '  ' } }), {});
  check('migrate: the remembered spelling carries across',
    migrateS2cTags({ 'gresb::setup': { serviceSegment: 'X', label: 'GRESB' } }),
    { gresb: { serviceSegment: 'X', label: 'GRESB' } });
  check('migrate: a missing map', migrateS2cTags(null), {});
  check('migrate: an empty map', migrateS2cTags({}), {});

  // Nothing to do means nothing written back on load.
  const current = { gresb: { serviceSegment: 'Sustainability' } };
  check('migrate: an already-migrated map is returned by identity', migrateS2cTags(current) === current, true);
}

// ── Counting, for the heading ─────────────────────────────────────────────
{
  const rows = collectS2cLineItems({ options: workbook, activeOptionNumber: 1 });
  const tags = { 'ccm nam': { serviceSegment: 'Ops' }, budgets: { productName: 'Sustainability' } };
  check('count: tagged line items only', countTagged(rows, tags), 2);
  check('count: nothing tagged', countTagged(rows, {}), 0);
  check('count: no rows', countTagged([], tags), 0);
}

// ── What each column offers back ──────────────────────────────────────────
{
  const tags = {
    a: { serviceSegment: 'Sourcing' },
    b: { serviceSegment: 'sourcing' },
    c: { serviceSegment: 'Advisory' },
  };
  check('suggest: deduped case-insensitively, sorted, first spelling wins',
    s2cTagSuggestions(tags, 'serviceSegment'), ['Advisory', 'Sourcing']);
  check('suggest: empty column', s2cTagSuggestions(tags, 'deliverable'), []);
  check('suggest: no tags at all', s2cTagSuggestions({}, 'serviceSegment'), []);
  // The remembered spelling must never leak into a tag column's suggestions.
  check('suggest: the label is not offered as a tag',
    s2cTagSuggestions({ a: { label: 'CCM NAM', serviceSegment: 'Ops' } }, 'serviceSegment'), ['Ops']);
}

if (failed === 0) console.log(`PASS  s2cTags: ${passed} assertions`);
else { console.error(`\n${failed} failed, ${passed} passed`); process.exit(1); }
